//! Themed inline Basic Auth challenge (P3).
//!
//! Pre-P3 an upstream `401 Unauthorized` with a `WWW-Authenticate:
//! Basic` header was forwarded unchanged to the iframe, which means
//! the browser's native chrome popped the platform Basic Auth dialog
//! — un-themed, untranslatable, jarring.
//!
//! P3 intercepts that response inside the proxy:
//!
//! 1. Strip the `WWW-Authenticate` header (this is what suppresses
//!    the native popup — browsers only show the dialog when a 401
//!    carries this header).
//! 2. Return a themed HTML form whose action is
//!    `POST /__sortofremoteng_auth` on the same proxy.
//! 3. The form carries a hidden `return_to` field with the original
//!    request path so we can redirect back after auth.
//! 4. A short-lived nonce (random per challenge) guards the POST
//!    against drive-by submissions from other 127.0.0.1 tabs the
//!    user might have open.
//!
//! After the POST handler in `http_cmds.rs` validates the nonce and
//! updates the session credentials, it 303-redirects back to
//! `return_to`; the iframe re-fetches through the now-authenticated
//! proxy and the user sees the real page.

use axum::body::Body;
use axum::http::{Response, StatusCode};

use crate::themed_errors::escape_html_public as escape_html;

/// Returned by `intercept_basic_auth_challenge` so callers know
/// whether to swap the upstream response for a themed form.
pub enum ChallengeDecision {
    /// Upstream sent a 401 with `WWW-Authenticate: Basic` — render
    /// the themed challenge instead.
    Challenge,
    /// Upstream response is not a Basic-Auth challenge — pass it
    /// through unchanged.
    PassThrough,
}

/// Inspect the upstream status and any `WWW-Authenticate` header
/// values to decide whether we should swap the response for a themed
/// challenge. Takes the header values as a borrowed slice so the call
/// site can extract them from whichever HeaderMap implementation it
/// has (reqwest vs axum vs http crate) without forcing a particular
/// type here.
pub fn intercept_basic_auth_challenge<S: AsRef<str>>(
    status: u16,
    www_auth_values: &[S],
) -> ChallengeDecision {
    if status != 401 {
        return ChallengeDecision::PassThrough;
    }
    // Look for any `WWW-Authenticate` header that starts with
    // "basic" (case-insensitive). Servers sometimes send multiple
    // challenge schemes; we trigger if Basic is offered at all.
    for v in www_auth_values {
        if v.as_ref()
            .trim_start()
            .to_ascii_lowercase()
            .starts_with("basic")
        {
            return ChallengeDecision::Challenge;
        }
    }
    ChallengeDecision::PassThrough
}

/// Render the themed login form. `target` is the upstream URL the
/// user is trying to reach (shown so they know what they're signing
/// in to); `return_to` is the path the POST handler will redirect to
/// after successful credential application; `nonce` is the
/// per-challenge random token the POST handler will require for
/// CSRF hygiene; `existing_username` pre-fills the username field
/// when the connection already has saved creds (the typical case
/// when a saved password is wrong, not missing).
pub fn render_challenge_page(
    target: &str,
    return_to: &str,
    nonce: &str,
    existing_username: &str,
    error_hint: Option<&str>,
    theme: &crate::theme_tokens::ThemeTokens,
) -> String {
    let safe_target = escape_html(target);
    let safe_return = escape_html(return_to);
    let safe_nonce = escape_html(nonce);
    let safe_user = escape_html(existing_username);
    let theme_css = theme.css_block();
    let error_block = match error_hint {
        Some(msg) if !msg.is_empty() => format!(
            r#"<p class="error" role="alert">{}</p>"#,
            escape_html(msg)
        ),
        _ => String::new(),
    };

    format!(
        r##"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in — sortOfRemoteNG</title>
<style>
{theme_css}
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
    background: var(--proxy-surface);
    border: 1px solid var(--proxy-border);
    border-radius: 0.75rem;
    padding: 1.75rem;
    max-width: 24rem;
    width: 100%;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
  }}
  .icon {{
    width: 48px;
    height: 48px;
    border-radius: 0.875rem;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 1rem;
    background: rgba(var(--proxy-primary-rgb), 0.14);
    border: 1px solid rgba(var(--proxy-primary-rgb), 0.22);
  }}
  .icon svg {{
    width: 24px;
    height: 24px;
    color: var(--proxy-primary);
  }}
  h1 {{
    font-size: 1.125rem;
    font-weight: 600;
    text-align: center;
    margin: 0 0 0.375rem;
    color: var(--proxy-text);
  }}
  .target {{
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.75rem;
    color: var(--proxy-text-2);
    text-align: center;
    margin: 0 0 1.25rem;
    word-break: break-all;
  }}
  .error {{
    background: rgba(var(--proxy-error-rgb), 0.08);
    border: 1px solid rgba(var(--proxy-error-rgb), 0.22);
    color: var(--proxy-error);
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    font-size: 0.8125rem;
    margin: 0 0 1rem;
  }}
  label {{
    display: block;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--proxy-text-2);
    margin: 0 0 0.375rem;
  }}
  input[type="text"], input[type="password"] {{
    width: 100%;
    /* Theme-derived input fill: 6% of the text colour, blended with
       transparent. Produces a subtle inset that's darker on dark
       themes (text is near-white → 6% white over the card) and
       lighter on light themes (text is near-black → 6% black over
       the card). Pre-fix this was hardcoded rgba(0, 0, 0, 0.25)
       which looked wrong on every light theme. */
    background: color-mix(in srgb, var(--proxy-text) 6%, transparent);
    border: 1px solid var(--proxy-border);
    border-radius: 0.5rem;
    color: var(--proxy-text);
    padding: 0.5rem 0.75rem;
    font-size: 0.875rem;
    font-family: inherit;
    margin: 0 0 1rem;
    transition: border-color 0.12s ease, background 0.12s ease;
  }}
  input[type="text"]:hover, input[type="password"]:hover {{
    background: color-mix(in srgb, var(--proxy-text) 9%, transparent);
  }}
  input[type="text"]:focus, input[type="password"]:focus {{
    outline: none;
    border-color: var(--proxy-primary);
    box-shadow: 0 0 0 3px rgba(var(--proxy-primary-rgb), 0.20);
  }}
  button {{
    width: 100%;
    background: var(--proxy-primary);
    color: #fff;
    border: 0;
    border-radius: 0.5rem;
    padding: 0.625rem 0.875rem;
    font-size: 0.875rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: filter 0.12s ease;
  }}
  button:hover {{ filter: brightness(1.08); }}
  button:focus {{
    outline: none;
    box-shadow: 0 0 0 3px rgba(var(--proxy-primary-rgb), 0.25);
  }}
  .footer {{
    font-size: 0.6875rem;
    color: var(--proxy-muted);
    text-align: center;
    margin: 1rem 0 0;
  }}
  /* P7: prefers-color-scheme fallback removed — live theme tokens
     come from the parent app at proxy startup so the page always
     matches whichever theme the user has selected in-app. */
</style>
</head>
<body>
  <main class="card">
    <div class="icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
    </div>
    <h1>Sign in required</h1>
    <p class="target">{safe_target}</p>
    {error_block}
    <form method="POST" action="/__sortofremoteng_auth" autocomplete="on">
      <input type="hidden" name="return_to" value="{safe_return}">
      <input type="hidden" name="nonce" value="{safe_nonce}">
      <label for="u">Username</label>
      <input id="u" name="username" type="text" value="{safe_user}"
             autocomplete="username" autofocus required>
      <label for="p">Password</label>
      <input id="p" name="password" type="password"
             autocomplete="current-password" required>
      <button type="submit">Sign in</button>
    </form>
    <p class="footer">Served by the sortOfRemoteNG internal proxy.</p>
  </main>
</body>
</html>"##,
        safe_target = safe_target,
        safe_return = safe_return,
        safe_nonce = safe_nonce,
        safe_user = safe_user,
        error_block = error_block,
    )
}

/// Build the full axum Response for the challenge page. Strips the
/// `WWW-Authenticate` header by virtue of not including it — this is
/// what suppresses the browser-native Basic Auth dialog. `theme`
/// carries the frontend's snapshotted CSS variables so the form
/// matches the user's current theme selection (P7).
pub fn themed_challenge_response(
    target: &str,
    return_to: &str,
    nonce: &str,
    existing_username: &str,
    error_hint: Option<&str>,
    theme: &crate::theme_tokens::ThemeTokens,
) -> Response<Body> {
    let body = render_challenge_page(
        target,
        return_to,
        nonce,
        existing_username,
        error_hint,
        theme,
    );
    Response::builder()
        .status(StatusCode::UNAUTHORIZED)
        .header("Content-Type", "text/html; charset=utf-8")
        .header("Cache-Control", "no-store")
        // Explicitly no WWW-Authenticate header so the browser does
        // NOT show its native popup.
        .body(Body::from(body))
        .expect("themed challenge response builder always valid")
}

/// Generate a short random nonce for the challenge form. Used by the
/// POST handler to reject submissions that didn't come from a form
/// we just served. Not a security boundary on its own (the proxy is
/// bound to 127.0.0.1, randomised port) but cheap hygiene.
pub fn fresh_nonce() -> String {
    use rand::RngCore;
    let mut buf = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut buf);
    // hex-encode without pulling another dep
    let mut s = String::with_capacity(32);
    for b in buf {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    fn theme() -> crate::theme_tokens::ThemeTokens {
        crate::theme_tokens::ThemeTokens::dark_default()
    }

    #[test]
    fn pass_through_non_401() {
        let h: &[&str] = &["Basic realm=\"x\""];
        assert!(matches!(
            intercept_basic_auth_challenge(200, h),
            ChallengeDecision::PassThrough
        ));
        assert!(matches!(
            intercept_basic_auth_challenge(500, h),
            ChallengeDecision::PassThrough
        ));
    }

    #[test]
    fn challenge_on_401_with_basic() {
        let h: &[&str] = &["Basic realm=\"x\""];
        assert!(matches!(
            intercept_basic_auth_challenge(401, h),
            ChallengeDecision::Challenge
        ));
    }

    #[test]
    fn challenge_on_401_with_basic_case_insensitive() {
        let h: &[&str] = &["basic realm=\"x\""];
        assert!(matches!(
            intercept_basic_auth_challenge(401, h),
            ChallengeDecision::Challenge
        ));
    }

    #[test]
    fn challenge_on_401_with_basic_alongside_digest() {
        // Multiple challenge schemes: Basic anywhere triggers swap.
        let h: &[&str] = &["Digest realm=\"x\"", "Basic realm=\"y\""];
        assert!(matches!(
            intercept_basic_auth_challenge(401, h),
            ChallengeDecision::Challenge
        ));
    }

    #[test]
    fn pass_through_401_without_basic() {
        // Digest-only realm: no challenge swap, we don't suppress
        // it. Plain pass-through is fine (Digest isn't covered by P3).
        let h: &[&str] = &["Digest realm=\"x\""];
        assert!(matches!(
            intercept_basic_auth_challenge(401, h),
            ChallengeDecision::PassThrough
        ));
    }

    #[test]
    fn pass_through_401_without_any_header() {
        let h: &[&str] = &[];
        assert!(matches!(
            intercept_basic_auth_challenge(401, h),
            ChallengeDecision::PassThrough
        ));
    }

    #[test]
    fn render_form_includes_all_fields() {
        let html = render_challenge_page(
            "https://example.test/secret",
            "/secret",
            "abcdef",
            "alice",
            None,
            &theme(),
        );
        assert!(html.contains("https://example.test/secret"));
        assert!(html.contains(r#"name="return_to" value="/secret""#));
        assert!(html.contains(r#"name="nonce" value="abcdef""#));
        assert!(html.contains(r#"value="alice""#));
        assert!(html.contains(r#"name="password""#));
        assert!(html.contains("/__sortofremoteng_auth"));
    }

    #[test]
    fn render_form_escapes_user_supplied_strings() {
        let html = render_challenge_page(
            "https://x.test/<script>",
            "/path?q=<x>",
            "n",
            "<img onerror=alert(1)>",
            Some("<script>alert('x')</script>"),
            &theme(),
        );
        assert!(!html.contains("<script>alert"));
        assert!(!html.contains("<img onerror"));
        assert!(html.contains("&lt;script&gt;"));
        assert!(html.contains("&lt;img"));
    }

    #[test]
    fn render_form_includes_error_block_when_provided() {
        let html = render_challenge_page("u", "/", "n", "", Some("bad password"), &theme());
        assert!(html.contains("bad password"));
        assert!(html.contains(r#"class="error""#));
    }

    #[test]
    fn render_form_omits_error_block_when_none() {
        let html = render_challenge_page("u", "/", "n", "", None, &theme());
        assert!(!html.contains(r#"class="error""#));
    }

    #[test]
    fn render_form_includes_theme_css_block() {
        let mut t = theme();
        t.primary = "#ff00ff".into();
        let html = render_challenge_page("u", "/", "n", "", None, &t);
        assert!(html.contains("--proxy-primary: #ff00ff"));
    }

    #[test]
    fn render_form_inputs_use_theme_derived_fill_not_hardcoded_black() {
        // Regression guard: the form's input background must NOT be
        // `rgba(0, 0, 0, ...)` — that fill is invisible on dark
        // themes and a dirty smudge on light themes. It must use
        // `color-mix(in srgb, var(--proxy-text) ...)` so the inset
        // contrasts correctly with whichever theme is live.
        let html = render_challenge_page("u", "/", "n", "", None, &theme());
        assert!(
            !html.contains("background: rgba(0, 0, 0,"),
            "themed auth form leaked a hardcoded black background — \
             that's the P7-theming regression that ships dark-looking \
             inputs onto light themes"
        );
        assert!(
            html.contains("color-mix(in srgb, var(--proxy-text)"),
            "themed auth form must derive input fill from the live \
             text token via color-mix so it works on every theme"
        );
    }

    #[test]
    fn themed_response_is_401_without_www_authenticate() {
        let resp = themed_challenge_response("u", "/", "n", "", None, &theme());
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
        // Critical: NO WWW-Authenticate header. That's what
        // suppresses the browser-native dialog.
        assert!(!resp.headers().contains_key("WWW-Authenticate"));
        assert!(!resp.headers().contains_key("www-authenticate"));
    }

    #[test]
    fn themed_response_is_html() {
        let resp = themed_challenge_response("u", "/", "n", "", None, &theme());
        let ct = resp
            .headers()
            .get("Content-Type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        assert!(ct.starts_with("text/html"));
    }

    #[test]
    fn fresh_nonce_is_hex_of_reasonable_length() {
        let n = fresh_nonce();
        assert_eq!(n.len(), 32);
        assert!(n.chars().all(|c| c.is_ascii_hexdigit()));
        // And not deterministic
        assert_ne!(n, fresh_nonce());
    }
}
