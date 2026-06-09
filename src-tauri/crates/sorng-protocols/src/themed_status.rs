//! Themed HTML pages for upstream HTTP error status codes (P5).
//!
//! Where `themed_errors.rs` themes pre-HTTP transport failures (no
//! response was ever received) and `themed_auth.rs` themes the
//! specific case of a 401 + `WWW-Authenticate: Basic` challenge,
//! `themed_status.rs` themes everything else in the 4xx/5xx range —
//! the upstream actually replied, but with an error status.
//!
//! Decision matrix (gates the swap in `axum_proxy_handler`):
//!
//! ```text
//!   status < 400                              → pass through (success / redirect)
//!   status == 401 with WWW-Authenticate Basic → themed_auth (already handled in P3)
//!   status >= 400 AND content-type text/html  → themed_status (this module)
//!   status >= 400 AND content-type empty      → themed_status (assume HTML)
//!   status >= 400 AND content-type JSON/etc.  → pass through (likely an API)
//! ```
//!
//! Themed pages keep the *original* upstream body in a collapsed
//! `<details>` block so power users / admins can still see the
//! diagnostic output the upstream sent — we override the default
//! presentation, not the information.

use axum::body::Body;
use axum::http::{Response, StatusCode};

use crate::themed_errors::escape_html_public as escape_html;

/// Visual tone of a themed status page. Drives the icon-container
/// accent and CSS variable values. Mirrors the React-side
/// `STATUS_META.tone` field so the badge and page agree.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatusTone {
    /// Red — server broken or hard refusal (404, 410, 500, 502...).
    Error,
    /// Yellow — transient or self-induced (408 timeout, 429 rate
    /// limit, 503 service unavailable, 504 gateway timeout, 405).
    Warn,
    /// Sky-blue / info — informational categories that aren't errors
    /// but aren't successes either (418 teapot for one).
    Info,
}

/// Per-code presentation: title, hint, icon, tone.
#[derive(Debug, Clone, Copy)]
pub struct StatusPresentation {
    pub title: &'static str,
    pub hint: &'static str,
    pub tone: StatusTone,
    pub icon_inner: &'static str,
}

/// Map an HTTP status code to its themed presentation. Specific
/// codes get bespoke titles; everything else falls back to a generic
/// "4xx Client Error" / "5xx Server Error" template parameterised by
/// the code number.
///
/// Icons sourced from lucide-react path data (matches the rest of
/// the app's iconography).
pub fn presentation_for(code: u16) -> StatusPresentation {
    // SVG path inner fragments for the icons we use.
    const ICON_LOCK: &str = r#"<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>"#;
    const ICON_SHIELD_X: &str = r#"<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="9.5" y1="9.5" x2="14.5" y2="14.5"/><line x1="14.5" y1="9.5" x2="9.5" y2="14.5"/>"#;
    const ICON_FILE_QUESTION: &str = r#"<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M10 18h.01"/><path d="M8.5 14a2 2 0 0 1 1.5-2.5 2 2 0 0 1 2 2c0 .9-.6 1.4-1.2 1.7"/>"#;
    const ICON_BAN: &str = r#"<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>"#;
    const ICON_CLOCK: &str = r#"<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>"#;
    const ICON_GAUGE: &str = r#"<path d="M12 14l4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>"#;
    const ICON_TRAFFIC_CONE: &str = r#"<path d="M9.3 6.8L4 19h16L14.7 6.8a3 3 0 0 0-5.4 0z"/><line x1="6" y1="14" x2="18" y2="14"/><line x1="8" y1="10" x2="16" y2="10"/>"#;
    const ICON_TEAPOT: &str = r#"<path d="M4 11h12a4 4 0 0 1 0 8h-8a4 4 0 0 1-4-4z"/><line x1="6" y1="3" x2="6" y2="7"/><line x1="10" y1="3" x2="10" y2="7"/><line x1="14" y1="3" x2="14" y2="7"/><line x1="18" y1="13" x2="22" y2="13"/>"#;
    const ICON_SERVER_CRASH: &str = r#"<path d="M6 10H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><path d="M6 14H4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2h-2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/><polyline points="13 6 11 10 13 10 11 14"/>"#;
    const ICON_SERVER_OFF: &str = r#"<path d="M2 6c0-1.1.9-2 2-2h2"/><path d="M14 4h6a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><path d="M22 14v4a2 2 0 0 1-2 2H6"/><path d="M2 12V8"/><path d="M2 18v-4"/><line x1="1" y1="1" x2="23" y2="23"/>"#;
    const ICON_ALERT_TRIANGLE: &str = r#"<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3.05h16.94a2 2 0 0 0 1.71-3.05l-8.47-14.14a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>"#;

    match code {
        // ── 4xx — Client errors ─────────────────────────────────
        400 => StatusPresentation {
            title: "Bad request",
            hint: "The server couldn't understand the request. The URL, headers, or body may be malformed.",
            tone: StatusTone::Error,
            icon_inner: ICON_ALERT_TRIANGLE,
        },
        401 => StatusPresentation {
            title: "Authentication required",
            hint: "The server requires credentials. If a Basic challenge was offered, sortOfRemoteNG would have shown its themed login form — this 401 came back without one.",
            tone: StatusTone::Warn,
            icon_inner: ICON_LOCK,
        },
        402 => StatusPresentation {
            title: "Payment required",
            hint: "The server returned a 402. This status code is rarely used outside of specific APIs and usually means a paywall, billing block, or API quota.",
            tone: StatusTone::Warn,
            icon_inner: ICON_BAN,
        },
        403 => StatusPresentation {
            title: "Forbidden",
            hint: "The server understood the request but is refusing to authorise it. You may need different credentials or elevated permissions.",
            tone: StatusTone::Error,
            icon_inner: ICON_SHIELD_X,
        },
        404 => StatusPresentation {
            title: "Not found",
            hint: "The page or resource doesn't exist at this address. Check the URL for typos, or whether the path was moved.",
            tone: StatusTone::Error,
            icon_inner: ICON_FILE_QUESTION,
        },
        405 => StatusPresentation {
            title: "Method not allowed",
            hint: "The HTTP method (GET, POST, etc.) isn't allowed for this endpoint.",
            tone: StatusTone::Warn,
            icon_inner: ICON_BAN,
        },
        406 => StatusPresentation {
            title: "Not acceptable",
            hint: "The server couldn't produce a response in any of the formats the client asked for.",
            tone: StatusTone::Warn,
            icon_inner: ICON_ALERT_TRIANGLE,
        },
        407 => StatusPresentation {
            title: "Proxy authentication required",
            hint: "An intermediate proxy is asking for credentials.",
            tone: StatusTone::Warn,
            icon_inner: ICON_LOCK,
        },
        408 => StatusPresentation {
            title: "Request timeout",
            hint: "The server gave up waiting for the rest of the request to arrive.",
            tone: StatusTone::Warn,
            icon_inner: ICON_CLOCK,
        },
        409 => StatusPresentation {
            title: "Conflict",
            hint: "The request conflicts with the resource's current state — another change may have landed first.",
            tone: StatusTone::Warn,
            icon_inner: ICON_ALERT_TRIANGLE,
        },
        410 => StatusPresentation {
            title: "Gone",
            hint: "This resource was permanently removed. There is no forwarding address.",
            tone: StatusTone::Error,
            icon_inner: ICON_BAN,
        },
        411 => StatusPresentation {
            title: "Length required",
            hint: "The server requires a Content-Length header but the request didn't include one.",
            tone: StatusTone::Warn,
            icon_inner: ICON_ALERT_TRIANGLE,
        },
        412 => StatusPresentation {
            title: "Precondition failed",
            hint: "An If-Match / If-None-Match / If-Modified-Since header didn't match the server's state.",
            tone: StatusTone::Warn,
            icon_inner: ICON_ALERT_TRIANGLE,
        },
        413 => StatusPresentation {
            title: "Payload too large",
            hint: "The request body is too big for the server to process.",
            tone: StatusTone::Warn,
            icon_inner: ICON_ALERT_TRIANGLE,
        },
        414 => StatusPresentation {
            title: "URI too long",
            hint: "The URL is too long for the server to process — try a shorter path or use POST instead of GET.",
            tone: StatusTone::Warn,
            icon_inner: ICON_ALERT_TRIANGLE,
        },
        415 => StatusPresentation {
            title: "Unsupported media type",
            hint: "The server doesn't accept the request's content type.",
            tone: StatusTone::Warn,
            icon_inner: ICON_ALERT_TRIANGLE,
        },
        416 => StatusPresentation {
            title: "Range not satisfiable",
            hint: "The client asked for a byte range the server can't deliver.",
            tone: StatusTone::Warn,
            icon_inner: ICON_ALERT_TRIANGLE,
        },
        417 => StatusPresentation {
            title: "Expectation failed",
            hint: "The server can't meet the requirements declared in the Expect request header.",
            tone: StatusTone::Warn,
            icon_inner: ICON_ALERT_TRIANGLE,
        },
        418 => StatusPresentation {
            title: "I'm a teapot",
            hint: "The server refuses the attempt to brew coffee with a teapot. (HTCPCP — RFC 2324.)",
            tone: StatusTone::Info,
            icon_inner: ICON_TEAPOT,
        },
        421 => StatusPresentation {
            title: "Misdirected request",
            hint: "The request was sent to a server that can't produce a response for it.",
            tone: StatusTone::Warn,
            icon_inner: ICON_ALERT_TRIANGLE,
        },
        422 => StatusPresentation {
            title: "Unprocessable entity",
            hint: "The request was well-formed but the server can't process its semantics.",
            tone: StatusTone::Warn,
            icon_inner: ICON_ALERT_TRIANGLE,
        },
        423 => StatusPresentation {
            title: "Locked",
            hint: "The resource is currently locked and can't be modified.",
            tone: StatusTone::Warn,
            icon_inner: ICON_LOCK,
        },
        424 => StatusPresentation {
            title: "Failed dependency",
            hint: "This request depended on another request that failed.",
            tone: StatusTone::Warn,
            icon_inner: ICON_ALERT_TRIANGLE,
        },
        425 => StatusPresentation {
            title: "Too early",
            hint: "The server doesn't want to risk processing a replayed request.",
            tone: StatusTone::Warn,
            icon_inner: ICON_CLOCK,
        },
        426 => StatusPresentation {
            title: "Upgrade required",
            hint: "The client must upgrade to a different protocol (e.g. HTTPS or HTTP/2).",
            tone: StatusTone::Warn,
            icon_inner: ICON_ALERT_TRIANGLE,
        },
        428 => StatusPresentation {
            title: "Precondition required",
            hint: "The server requires the request to include a precondition header (If-Match etc.).",
            tone: StatusTone::Warn,
            icon_inner: ICON_ALERT_TRIANGLE,
        },
        429 => StatusPresentation {
            title: "Rate limited",
            hint: "The server is throttling you for sending too many requests. Wait a moment and try again.",
            tone: StatusTone::Warn,
            icon_inner: ICON_GAUGE,
        },
        431 => StatusPresentation {
            title: "Headers too large",
            hint: "The request headers exceed what the server is willing to process.",
            tone: StatusTone::Warn,
            icon_inner: ICON_ALERT_TRIANGLE,
        },
        451 => StatusPresentation {
            title: "Unavailable for legal reasons",
            hint: "The resource was withheld in response to a legal demand. (RFC 7725.)",
            tone: StatusTone::Error,
            icon_inner: ICON_BAN,
        },

        // ── 5xx — Server errors ─────────────────────────────────
        500 => StatusPresentation {
            title: "Internal server error",
            hint: "The server hit an unexpected condition. Try again, or contact whoever owns this service.",
            tone: StatusTone::Error,
            icon_inner: ICON_SERVER_CRASH,
        },
        501 => StatusPresentation {
            title: "Not implemented",
            hint: "The server doesn't recognise the request method or can't fulfil it.",
            tone: StatusTone::Error,
            icon_inner: ICON_SERVER_CRASH,
        },
        502 => StatusPresentation {
            title: "Bad gateway",
            hint: "The server (acting as a gateway) got an invalid response from an upstream service.",
            tone: StatusTone::Error,
            icon_inner: ICON_SERVER_CRASH,
        },
        503 => StatusPresentation {
            title: "Service unavailable",
            hint: "The server is temporarily down — overloaded or under maintenance. Try again in a moment.",
            tone: StatusTone::Warn,
            icon_inner: ICON_SERVER_OFF,
        },
        504 => StatusPresentation {
            title: "Gateway timeout",
            hint: "An upstream gateway didn't respond in time.",
            tone: StatusTone::Warn,
            icon_inner: ICON_CLOCK,
        },
        505 => StatusPresentation {
            title: "HTTP version not supported",
            hint: "The server doesn't support the HTTP protocol version the client used.",
            tone: StatusTone::Error,
            icon_inner: ICON_SERVER_CRASH,
        },
        506 => StatusPresentation {
            title: "Variant also negotiates",
            hint: "Internal content-negotiation configuration on the server is broken.",
            tone: StatusTone::Error,
            icon_inner: ICON_SERVER_CRASH,
        },
        507 => StatusPresentation {
            title: "Insufficient storage",
            hint: "The server doesn't have enough storage to complete the request.",
            tone: StatusTone::Error,
            icon_inner: ICON_SERVER_CRASH,
        },
        508 => StatusPresentation {
            title: "Loop detected",
            hint: "The server detected an infinite loop while processing the request.",
            tone: StatusTone::Error,
            icon_inner: ICON_SERVER_CRASH,
        },
        510 => StatusPresentation {
            title: "Not extended",
            hint: "Further extensions to the request are required for the server to fulfil it.",
            tone: StatusTone::Error,
            icon_inner: ICON_SERVER_CRASH,
        },
        511 => StatusPresentation {
            title: "Network authentication required",
            hint: "A captive portal (or other network-level gate) is intercepting requests.",
            tone: StatusTone::Warn,
            icon_inner: ICON_TRAFFIC_CONE,
        },

        // ── Generic fallbacks ───────────────────────────────────
        c if (400..500).contains(&c) => StatusPresentation {
            title: "Client error",
            hint: "The request was rejected. This status code isn't one of the well-known ones — check the detail below for the upstream's message.",
            tone: StatusTone::Error,
            icon_inner: ICON_ALERT_TRIANGLE,
        },
        c if (500..600).contains(&c) => StatusPresentation {
            title: "Server error",
            hint: "The server failed to fulfil the request for a non-standard reason. Check the detail below.",
            tone: StatusTone::Error,
            icon_inner: ICON_SERVER_CRASH,
        },
        _ => StatusPresentation {
            title: "Unexpected response",
            hint: "The proxy received a status outside the 4xx/5xx range that the iframe wouldn't normally see here.",
            tone: StatusTone::Info,
            icon_inner: ICON_ALERT_TRIANGLE,
        },
    }
}

/// Map a [`StatusTone`] to its (rgb-triplet, hex) accent colour,
/// pulled from the snapshotted theme so the page matches the user's
/// current theme selection (P7).
fn tone_accent<'a>(
    tone: StatusTone,
    theme: &'a crate::theme_tokens::ThemeTokens,
) -> (&'a str, &'a str) {
    match tone {
        StatusTone::Error => theme.error_pair(),
        StatusTone::Warn => theme.warning_pair(),
        StatusTone::Info => theme.info_pair(),
    }
}

/// Truncate the raw upstream body to a reasonable preview length so
/// a 5 MB error page doesn't get inlined into the themed envelope.
fn snippet_for(upstream_body: &[u8]) -> Option<String> {
    if upstream_body.is_empty() {
        return None;
    }
    // Best-effort UTF-8; lossy is fine for diagnostic display.
    let text = String::from_utf8_lossy(upstream_body);
    // Trim leading whitespace so HTML servers' big leading
    // <!DOCTYPE><html><head>... block doesn't dominate the preview.
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    const MAX: usize = 4096;
    if trimmed.len() > MAX {
        // Take a UTF-8-safe prefix.
        let mut end = MAX;
        while !trimmed.is_char_boundary(end) && end > 0 {
            end -= 1;
        }
        Some(format!("{}\n\n[…truncated…]", &trimmed[..end]))
    } else {
        Some(trimmed.to_string())
    }
}

/// Render the full themed HTML page for an HTTP error status code.
///
/// `code` is the upstream status. `target` is the upstream URL we
/// were trying to reach. `upstream_body` is the raw body the upstream
/// returned — included in a collapsed `<details>` block so the user
/// can still see the underlying diagnostic if they want. `theme`
/// carries the frontend's snapshotted CSS variables so the page
/// matches the user's current theme selection (P7).
pub fn render_status_page(
    code: u16,
    target: &str,
    upstream_body: &[u8],
    theme: &crate::theme_tokens::ThemeTokens,
) -> String {
    let pres = presentation_for(code);
    let (accent_rgb, accent_hex) = tone_accent(pres.tone, theme);
    let safe_target = escape_html(target);
    let safe_snippet = snippet_for(upstream_body).map(|s| escape_html(&s));
    let theme_css = theme.css_block();

    let details_block = if let Some(snippet) = safe_snippet {
        format!(
            r#"<details class="raw">
  <summary>Show upstream response body</summary>
  <pre>{snippet}</pre>
</details>"#,
            snippet = snippet,
        )
    } else {
        String::new()
    };

    format!(
        r##"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{code} {title} — sortOfRemoteNG</title>
<style>
{theme_css}
  :root {{
    --accent: {accent_hex};
    --accent-rgb: {accent_rgb};
  }}
  * {{ box-sizing: border-box; }}
  html, body {{ height: 100%; margin: 0; padding: 0; }}
  body {{
    background: var(--proxy-bg);
    color: var(--proxy-text);
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
    max-width: 40rem;
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
  .code-pill {{
    display: inline-block;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    color: var(--accent);
    background: rgba(var(--accent-rgb), 0.10);
    border: 1px solid rgba(var(--accent-rgb), 0.25);
    padding: 0.125rem 0.5rem;
    border-radius: 999px;
    margin-bottom: 0.5rem;
  }}
  h1 {{
    font-size: 1.125rem;
    font-weight: 600;
    margin: 0 0 0.5rem;
    color: var(--proxy-text);
  }}
  .target {{
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.8125rem;
    color: var(--proxy-text-2);
    margin: 0 0 1rem;
    word-break: break-all;
  }}
  .hint {{
    font-size: 0.875rem;
    color: var(--proxy-text-2);
    margin: 0 0 1.25rem;
    max-width: 32rem;
  }}
  details.raw {{
    width: 100%;
    text-align: left;
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid var(--proxy-border);
    border-radius: 0.5rem;
    margin: 0 0 1rem;
  }}
  details.raw summary {{
    cursor: pointer;
    padding: 0.5rem 0.75rem;
    font-size: 0.75rem;
    color: var(--proxy-muted);
    user-select: none;
  }}
  details.raw[open] summary {{
    border-bottom: 1px solid var(--proxy-border);
  }}
  details.raw pre {{
    margin: 0;
    padding: 0.75rem 1rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.6875rem;
    color: var(--proxy-text-2);
    white-space: pre-wrap;
    word-break: break-word;
    overflow-wrap: anywhere;
    max-height: 24rem;
    overflow-y: auto;
  }}
  .footer {{
    font-size: 0.75rem;
    color: var(--proxy-muted);
    margin: 0;
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
    <div class="code-pill">HTTP {code}</div>
    <h1>{title}</h1>
    <p class="target">{safe_target}</p>
    <p class="hint">{hint}</p>
    {details_block}
    <p class="footer">Served by the sortOfRemoteNG internal proxy.</p>
  </main>
</body>
</html>"##,
        code = code,
        title = pres.title,
        hint = pres.hint,
        icon_inner = pres.icon_inner,
        accent_hex = accent_hex,
        accent_rgb = accent_rgb,
        safe_target = safe_target,
        details_block = details_block,
    )
}

/// Build the full axum Response for a themed HTTP error status. The
/// status code is forwarded as-is (so curl users / DevTools still
/// see the upstream code), the body is replaced with the themed
/// HTML, and `Content-Encoding` is explicitly NOT set — the upstream
/// may have gzipped its error page, but reqwest already decoded it
/// for us and we're sending plain HTML now. `theme` carries the
/// frontend's snapshotted CSS variables for P7 themed pages.
pub fn themed_status_response(
    code: u16,
    target: &str,
    upstream_body: &[u8],
    theme: &crate::theme_tokens::ThemeTokens,
) -> Response<Body> {
    let body = render_status_page(code, target, upstream_body, theme);
    // Forward the upstream code if it's a valid HTTP status; fall
    // back to 502 if somehow we got something out of range.
    let status = StatusCode::from_u16(code).unwrap_or(StatusCode::BAD_GATEWAY);
    Response::builder()
        .status(status)
        .header("Content-Type", "text/html; charset=utf-8")
        .header("Content-Length", body.len().to_string())
        .header("Cache-Control", "no-store")
        // Strip the upstream's Content-Encoding (we substituted the
        // body) by simply not adding one.
        .body(Body::from(body))
        .expect("themed status response builder always valid")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn theme() -> crate::theme_tokens::ThemeTokens {
        crate::theme_tokens::ThemeTokens::dark_default()
    }

    #[test]
    fn well_known_codes_have_distinct_titles() {
        let codes = [
            400, 401, 403, 404, 405, 408, 410, 418, 422, 429, 500, 502, 503, 504,
        ];
        let mut titles = std::collections::HashSet::new();
        for c in codes {
            let p = presentation_for(c);
            assert!(
                titles.insert(p.title),
                "duplicate title for {c}: {}",
                p.title
            );
        }
    }

    #[test]
    fn fallback_for_unknown_4xx() {
        let p = presentation_for(499);
        assert_eq!(p.title, "Client error");
        assert!(matches!(p.tone, StatusTone::Error));
    }

    #[test]
    fn fallback_for_unknown_5xx() {
        let p = presentation_for(599);
        assert_eq!(p.title, "Server error");
        assert!(matches!(p.tone, StatusTone::Error));
    }

    #[test]
    fn render_includes_code_pill_and_title() {
        let html = render_status_page(404, "https://example.test/oops", b"", &theme());
        assert!(html.contains("HTTP 404"));
        assert!(html.contains("Not found"));
        assert!(html.contains("https://example.test/oops"));
    }

    #[test]
    fn render_includes_upstream_body_in_details_when_present() {
        let html = render_status_page(
            500,
            "https://x",
            b"Internal explosion: stack trace here",
            &theme(),
        );
        assert!(html.contains("Show upstream response body"));
        assert!(html.contains("Internal explosion: stack trace here"));
    }

    #[test]
    fn render_omits_details_block_when_body_empty() {
        let html = render_status_page(500, "https://x", b"", &theme());
        assert!(!html.contains("Show upstream response body"));
    }

    #[test]
    fn render_escapes_upstream_body() {
        let html = render_status_page(
            500,
            "https://x",
            b"<script>alert(1)</script>",
            &theme(),
        );
        assert!(!html.contains("<script>alert(1)</script>"));
        assert!(html.contains("&lt;script&gt;"));
    }

    #[test]
    fn render_escapes_target() {
        let html = render_status_page(404, "https://x.test/?q=<x>", b"", &theme());
        assert!(!html.contains("?q=<x>"));
        assert!(html.contains("?q=&lt;x&gt;"));
    }

    #[test]
    fn render_includes_theme_css_tokens() {
        // P7: theme tokens reach the served page.
        let mut t = theme();
        t.background = "#abcdef".into();
        t.text = "#123456".into();
        let html = render_status_page(404, "https://x", b"", &t);
        assert!(html.contains("--proxy-bg: #abcdef"));
        assert!(html.contains("--proxy-text: #123456"));
    }

    #[test]
    fn body_snippet_truncation_keeps_valid_utf8() {
        // Build a >4KB string of multibyte chars and verify the
        // returned snippet is still valid UTF-8 (no partial char).
        let big: String = "❄".repeat(5000);
        let snippet = snippet_for(big.as_bytes()).expect("non-empty");
        assert!(snippet.is_char_boundary(snippet.len()));
        // And it actually was truncated.
        assert!(snippet.ends_with("[…truncated…]"));
    }

    #[test]
    fn body_snippet_none_for_whitespace_only() {
        assert!(snippet_for(b"   \n\t  ").is_none());
        assert!(snippet_for(b"").is_none());
    }

    #[test]
    fn tone_accent_distinct_per_tone() {
        let t = theme();
        let e = tone_accent(StatusTone::Error, &t);
        let w = tone_accent(StatusTone::Warn, &t);
        let i = tone_accent(StatusTone::Info, &t);
        assert_ne!(e.1, w.1);
        assert_ne!(w.1, i.1);
        assert_ne!(e.1, i.1);
    }

    #[test]
    fn response_forwards_upstream_status_code() {
        let resp = themed_status_response(429, "https://x", b"", &theme());
        assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
        let ct = resp
            .headers()
            .get("Content-Type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        assert!(ct.starts_with("text/html"));
        // No Content-Encoding — we substituted the body.
        assert!(!resp.headers().contains_key("content-encoding"));
    }

    #[test]
    fn response_handles_unusual_status_code() {
        // 477 isn't standard but is a valid u16 status code.
        let resp = themed_status_response(477, "https://x", b"", &theme());
        assert_eq!(resp.status().as_u16(), 477);
    }

    #[test]
    fn teapot_is_info_toned() {
        assert!(matches!(presentation_for(418).tone, StatusTone::Info));
    }

    #[test]
    fn rate_limit_is_warn_toned() {
        assert!(matches!(presentation_for(429).tone, StatusTone::Warn));
    }

    #[test]
    fn server_error_500_is_error_toned() {
        assert!(matches!(presentation_for(500).tone, StatusTone::Error));
    }
}
