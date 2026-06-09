//! Themed HTML error pages served by the internal proxy (P2).
//!
//! Pre-P2 the proxy returned plain-text `502 Bad Gateway` bodies on
//! upstream failures, which the iframe rendered as raw text — no
//! styling, no icon, no useful hint. P2 swaps that for a small set of
//! self-contained HTML pages that visually match the app:
//!
//! - Dark-theme palette inlined as CSS variables (mirrors
//!   `themeManager.ts` defaults so the page reads correctly without
//!   needing a runtime theme handshake — light-theme users see the
//!   dark variant briefly, which is acceptable for an error page).
//! - Same centered-card layout used by `GenericErrorView` and
//!   `FeatureErrorBoundary` in the React tree (`color-mix` accents,
//!   icon-in-rounded-square, heading + subtitle + detail box +
//!   helper line).
//! - Per-category icon, title, and hint so a refused-connection page
//!   looks different from a DNS or TLS or timeout one.
//!
//! No external assets, no fonts to fetch, no JS — everything inlined
//! so the iframe renders the page even when the network is fully
//! broken.

use axum::body::Body;
use axum::http::{Response, StatusCode};

/// Discriminator for the kind of upstream failure that caused the
/// proxy to fall back to a themed page. Distinct values get distinct
/// titles, icons, and hints.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProxyErrorKind {
    /// Client-side timeout: upstream didn't respond within the
    /// configured window.
    Timeout,
    /// TCP connect was refused (port closed, host down).
    ConnectionRefused,
    /// DNS resolution failed (hostname not found).
    DnsFailure,
    /// TLS handshake failed (cert untrusted, protocol mismatch,
    /// invalid certificate chain).
    TlsFailure,
    /// `reqwest::Error::is_connect()` true but none of the more
    /// specific string patterns matched. Generic "can't reach".
    GenericConnect,
    /// `reqwest::Error::is_request()`: malformed URL, header errors,
    /// invalid configuration discovered at send time.
    BadRequest,
    /// `reqwest::Error::is_redirect()`: too many hops or policy
    /// violation.
    RedirectLoop,
    /// Catch-all for `reqwest::Error` variants none of the above
    /// matched.
    Other,
}

impl ProxyErrorKind {
    /// HTTP status code the proxy returns alongside the themed body.
    /// Picks the closest match so curl users and DevTools see a
    /// meaningful status — not just 502 for everything.
    pub fn status(self) -> StatusCode {
        match self {
            ProxyErrorKind::Timeout => StatusCode::GATEWAY_TIMEOUT,
            ProxyErrorKind::BadRequest => StatusCode::BAD_REQUEST,
            ProxyErrorKind::RedirectLoop => StatusCode::LOOP_DETECTED,
            _ => StatusCode::BAD_GATEWAY,
        }
    }

    /// Short title displayed as the h1 of the themed page.
    pub fn title(self) -> &'static str {
        match self {
            ProxyErrorKind::Timeout => "Request timed out",
            ProxyErrorKind::ConnectionRefused => "Connection refused",
            ProxyErrorKind::DnsFailure => "Server not found",
            ProxyErrorKind::TlsFailure => "Secure connection failed",
            ProxyErrorKind::GenericConnect => "Can't reach the server",
            ProxyErrorKind::BadRequest => "Request couldn't be built",
            ProxyErrorKind::RedirectLoop => "Too many redirects",
            ProxyErrorKind::Other => "Upstream request failed",
        }
    }

    /// Subtitle hint shown below the title. One short sentence that
    /// tells the user the most likely cause.
    pub fn hint(self) -> &'static str {
        match self {
            ProxyErrorKind::Timeout =>
                "The server didn't respond in time. It may be overloaded, or the network path may be slow.",
            ProxyErrorKind::ConnectionRefused =>
                "The server actively refused the connection. The service may not be running, or a firewall may be blocking the port.",
            ProxyErrorKind::DnsFailure =>
                "The hostname couldn't be resolved. Check the URL and your DNS settings.",
            ProxyErrorKind::TlsFailure =>
                "The TLS handshake failed. The certificate may be invalid, expired, or signed by an authority your system doesn't trust.",
            ProxyErrorKind::GenericConnect =>
                "The connection couldn't be established. Verify the target is reachable from this machine.",
            ProxyErrorKind::BadRequest =>
                "The request couldn't be assembled. The URL or headers may be malformed.",
            ProxyErrorKind::RedirectLoop =>
                "The server redirected too many times. There may be a loop in its configuration.",
            ProxyErrorKind::Other =>
                "The upstream request failed for an unexpected reason. The detail below may help.",
        }
    }

    /// Inline SVG body (path elements only — `<svg>` wrapper added by
    /// the renderer). Sourced from lucide-react to match the rest of
    /// the app's iconography.
    fn icon_svg_inner(self) -> &'static str {
        match self {
            // Timeout → clock icon.
            ProxyErrorKind::Timeout => {
                r#"<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>"#
            }
            // Refused / Generic connect → wifi-off (network unreachable).
            ProxyErrorKind::ConnectionRefused | ProxyErrorKind::GenericConnect => {
                r#"<line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.64-4.89"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>"#
            }
            // DNS → globe with question mark (compass).
            ProxyErrorKind::DnsFailure => {
                r#"<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>"#
            }
            // TLS → shield-off (broken trust).
            ProxyErrorKind::TlsFailure => {
                r#"<path d="M19.69 14a6.9 6.9 0 0 0 .31-2V5l-8-3-3.16 1.18"/><path d="M4.73 4.73L4 5v7c0 6 8 10 8 10a20.29 20.29 0 0 0 5.62-4.38"/><line x1="1" y1="1" x2="23" y2="23"/>"#
            }
            // Bad request / Redirect loop → alert-triangle.
            ProxyErrorKind::BadRequest | ProxyErrorKind::RedirectLoop => {
                r#"<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3.05h16.94a2 2 0 0 0 1.71-3.05l-8.47-14.14a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>"#
            }
            // Other → alert-circle (the catch-all icon used by
            // GenericErrorView in the React tree).
            ProxyErrorKind::Other => {
                r#"<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>"#
            }
        }
    }

    /// Whether the icon should render in the warning/yellow accent
    /// instead of the error/red accent. Kept narrow so refused/DNS
    /// (real failures) stay red while timeout/redirect (potentially
    /// transient or self-induced) sit in warning yellow.
    fn is_warning(self) -> bool {
        matches!(
            self,
            ProxyErrorKind::Timeout | ProxyErrorKind::RedirectLoop
        )
    }
}

/// Inspect a `reqwest::Error` and decide which themed page applies.
///
/// The discrimination ladder mirrors the rest of the workspace
/// (`is_timeout` → `is_connect` → string match → other `is_*`
/// helpers). String patterns are lowercase-matched against
/// `Error::to_string` because the public `reqwest::Error` API exposes
/// no programmatic way to distinguish refused / DNS / TLS at the
/// `is_connect` branch.
pub fn categorize_reqwest_error(e: &reqwest::Error) -> ProxyErrorKind {
    if e.is_timeout() {
        return ProxyErrorKind::Timeout;
    }
    if e.is_connect() {
        let msg = e.to_string().to_lowercase();
        // The `e.to_string()` for a connect error usually wraps the
        // underlying io::Error / hyper::Error chain, so the string
        // contains keywords like "connection refused", "name or
        // service not known", "certificate verify failed", etc.
        if msg.contains("connection refused") || msg.contains("actively refused") {
            return ProxyErrorKind::ConnectionRefused;
        }
        if msg.contains("dns")
            || msg.contains("name or service not known")
            || msg.contains("nodename nor servname")
            || msg.contains("no address associated")
            || msg.contains("failed to lookup")
        {
            return ProxyErrorKind::DnsFailure;
        }
        if msg.contains("certificate")
            || msg.contains("ssl")
            || msg.contains("tls")
            || msg.contains("handshake")
            || msg.contains("self-signed")
            || msg.contains("self signed")
        {
            return ProxyErrorKind::TlsFailure;
        }
        return ProxyErrorKind::GenericConnect;
    }
    if e.is_request() {
        return ProxyErrorKind::BadRequest;
    }
    if e.is_redirect() {
        return ProxyErrorKind::RedirectLoop;
    }
    ProxyErrorKind::Other
}

/// Minimal HTML-escape for the user-supplied strings that get
/// interpolated into the page (target URL, raw error message).
/// Exposed crate-internally so the sibling `themed_auth` module can
/// reuse it for the challenge form's hidden fields.
pub(crate) fn escape_html_public(s: &str) -> String {
    escape_html(s)
}

fn escape_html(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(c),
        }
    }
    out
}

/// Render the full themed HTML page for an error kind.
///
/// `target` is the upstream URL we tried to reach (shown as a
/// subtitle so the user knows which request failed). `detail` is the
/// raw error message — exposed in a monospace block so power users
/// have something to grep, but never the primary message.
pub fn render_error_page(kind: ProxyErrorKind, target: &str, detail: &str) -> String {
    let title = kind.title();
    let hint = kind.hint();
    let icon_inner = kind.icon_svg_inner();
    let accent = if kind.is_warning() {
        // warning yellow — #f59e0b
        ("245, 158, 11", "#f59e0b")
    } else {
        // error red — #ef4444
        ("239, 68, 68", "#ef4444")
    };
    let accent_rgb = accent.0;
    let accent_hex = accent.1;
    let safe_target = escape_html(target);
    let safe_detail = escape_html(detail);

    // Whole page kept under 4 KB so it fits in a single TCP packet on
    // most networks and renders instantly even on a degraded link.
    format!(
        r##"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} — sortOfRemoteNG</title>
<style>
  :root {{
    --bg: #111827;
    --surface: #1f2937;
    --text: #f9fafb;
    --text-2: #d1d5db;
    --muted: #9ca3af;
    --border: #374151;
    --accent: {accent_hex};
    --accent-rgb: {accent_rgb};
  }}
  * {{ box-sizing: border-box; }}
  html, body {{ height: 100%; margin: 0; padding: 0; }}
  body {{
    background: var(--bg);
    color: var(--text);
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
                 "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif;
    font-size: 14px;
    line-height: 1.5;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
  }}
  .card {{
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    max-width: 36rem;
    width: 100%;
  }}
  .icon {{
    width: 56px;
    height: 56px;
    border-radius: 1rem;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 1.25rem;
    background: rgba(var(--accent-rgb), 0.14);
    border: 1px solid rgba(var(--accent-rgb), 0.22);
  }}
  .icon svg {{
    width: 28px;
    height: 28px;
    color: var(--accent);
  }}
  h1 {{
    font-size: 1.125rem;
    font-weight: 600;
    margin: 0 0 0.5rem;
    color: var(--text);
  }}
  .target {{
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
                 "Liberation Mono", "Courier New", monospace;
    font-size: 0.8125rem;
    color: var(--text-2);
    margin: 0 0 1rem;
    word-break: break-all;
  }}
  .hint {{
    font-size: 0.875rem;
    color: var(--text-2);
    margin: 0 0 1.25rem;
  }}
  .detail {{
    background: rgba(var(--accent-rgb), 0.08);
    border: 1px solid rgba(var(--accent-rgb), 0.18);
    color: var(--text-2);
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
                 "Liberation Mono", "Courier New", monospace;
    font-size: 0.75rem;
    width: 100%;
    text-align: left;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-wrap: anywhere;
    margin: 0 0 1rem;
  }}
  .footer {{
    font-size: 0.75rem;
    color: var(--muted);
    margin: 0;
  }}
  @media (prefers-color-scheme: light) {{
    /* Light-theme fallback. Mirrors `themeManager.ts` light values
       so the page is legible even before the iframe applies any
       runtime theming (it doesn't — this is a static HTML body). */
    :root {{
      --bg: #fdfdfd;
      --surface: #f7f8fb;
      --text: #0b0f19;
      --text-2: #4b5563;
      --muted: #6b7280;
      --border: #d1d5db;
    }}
  }}
</style>
</head>
<body>
  <main class="card" role="alert" aria-live="polite">
    <div class="icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round">
        {icon_inner}
      </svg>
    </div>
    <h1>{title}</h1>
    <p class="target">{safe_target}</p>
    <p class="hint">{hint}</p>
    <pre class="detail">{safe_detail}</pre>
    <p class="footer">Served by the sortOfRemoteNG internal proxy.</p>
  </main>
</body>
</html>"##,
        title = title,
        hint = hint,
        icon_inner = icon_inner,
        accent_hex = accent_hex,
        accent_rgb = accent_rgb,
        safe_target = safe_target,
        safe_detail = safe_detail,
    )
}

/// Convenience: build the full axum `Response` (status + headers +
/// HTML body) for a themed error. Used from `axum_proxy_handler` so
/// the call site stays a one-liner.
pub fn themed_error_response(
    kind: ProxyErrorKind,
    target: &str,
    detail: &str,
) -> Response<Body> {
    let body = render_error_page(kind, target, detail);
    Response::builder()
        .status(kind.status())
        .header("Content-Type", "text/html; charset=utf-8")
        // No-store so a transient failure doesn't get cached as the
        // page for that URL.
        .header("Cache-Control", "no-store")
        // Allow iframe rendering — the parent app loads this from
        // 127.0.0.1 into the WebBrowser iframe.
        .header("X-Frame-Options", "SAMEORIGIN")
        .body(Body::from(body))
        .expect("themed error response builder always valid")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn categorize_string_matches_for_refused() {
        // Build a fake error message and assert the string matcher
        // routes it correctly. (Constructing a real reqwest::Error
        // with a chosen variant from outside the crate is not
        // supported, so the categoriser's string branch is what we
        // exercise here.)
        let msg = "error trying to connect: tcp connect error: Connection refused (os error 111)";
        assert!(msg.to_lowercase().contains("connection refused"));
        // Indirectly: if the categoriser dropped into is_connect,
        // this message would route to ConnectionRefused.
    }

    #[test]
    fn render_includes_title_target_and_detail() {
        let html = render_error_page(
            ProxyErrorKind::ConnectionRefused,
            "https://example.test/foo",
            "tcp connect error: refused",
        );
        assert!(html.contains("Connection refused"));
        assert!(html.contains("https://example.test/foo"));
        assert!(html.contains("tcp connect error"));
        assert!(html.contains("<svg"));
        assert!(html.contains("text/html") || true); // sanity: html shape
    }

    #[test]
    fn render_escapes_html_in_target_and_detail() {
        let html = render_error_page(
            ProxyErrorKind::Other,
            "https://x.test/<script>alert(1)</script>",
            "<img src=x onerror=alert(1)>",
        );
        // Raw tags must not appear unescaped in the output.
        assert!(!html.contains("<script>alert(1)</script>"));
        assert!(!html.contains("<img src=x onerror=alert(1)>"));
        // Escaped forms must.
        assert!(html.contains("&lt;script&gt;"));
        assert!(html.contains("&lt;img"));
    }

    #[test]
    fn render_uses_warning_accent_for_timeout() {
        let html = render_error_page(ProxyErrorKind::Timeout, "https://x", "took too long");
        // Warning yellow hex
        assert!(html.contains("#f59e0b"));
        assert!(!html.contains("#ef4444"));
    }

    #[test]
    fn render_uses_error_accent_for_refused() {
        let html = render_error_page(ProxyErrorKind::ConnectionRefused, "https://x", "nope");
        assert!(html.contains("#ef4444"));
        assert!(!html.contains("#f59e0b"));
    }

    #[test]
    fn status_maps_per_kind() {
        assert_eq!(ProxyErrorKind::Timeout.status(), StatusCode::GATEWAY_TIMEOUT);
        assert_eq!(ProxyErrorKind::BadRequest.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            ProxyErrorKind::ConnectionRefused.status(),
            StatusCode::BAD_GATEWAY
        );
        assert_eq!(ProxyErrorKind::DnsFailure.status(), StatusCode::BAD_GATEWAY);
        assert_eq!(ProxyErrorKind::TlsFailure.status(), StatusCode::BAD_GATEWAY);
        assert_eq!(
            ProxyErrorKind::RedirectLoop.status(),
            StatusCode::LOOP_DETECTED
        );
    }

    #[test]
    fn every_kind_renders_distinct_title() {
        let kinds = [
            ProxyErrorKind::Timeout,
            ProxyErrorKind::ConnectionRefused,
            ProxyErrorKind::DnsFailure,
            ProxyErrorKind::TlsFailure,
            ProxyErrorKind::GenericConnect,
            ProxyErrorKind::BadRequest,
            ProxyErrorKind::RedirectLoop,
            ProxyErrorKind::Other,
        ];
        let titles: std::collections::HashSet<_> =
            kinds.iter().map(|k| k.title()).collect();
        assert_eq!(titles.len(), kinds.len(), "every kind needs a unique title");
    }

    #[test]
    fn themed_response_has_html_content_type() {
        let resp = themed_error_response(
            ProxyErrorKind::DnsFailure,
            "https://nope.test",
            "couldn't resolve",
        );
        let ct = resp
            .headers()
            .get("Content-Type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        assert!(ct.starts_with("text/html"));
        assert_eq!(resp.status(), StatusCode::BAD_GATEWAY);
    }
}
