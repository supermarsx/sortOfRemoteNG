use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Inline HTML for the first-stage splash screen. The monitor mark and
/// blue/slate palette intentionally match `icons/app-icon-source.svg` and the
/// React splash so the packaged binary has one identity from process launch
/// through application readiness. It stays self-contained in a data URI and
/// therefore does not wait for the frontend dev server or static build.
const SPLASH_HTML: &str = r##"<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="dark">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 100%; height: 100%;
    background:
      radial-gradient(circle at 50% 34%, rgba(56,189,248,0.18), transparent 44%),
      linear-gradient(145deg, #172554 0%, #0f172a 58%, #020617 100%);
    display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    overflow: hidden; user-select: none;
    -webkit-user-select: none;
  }
  .container {
    width: 100%; height: 100%; padding: 24px;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    text-align: center;
  }
  .logo-wrap { position: relative; width: 68px; height: 68px; margin-bottom: 14px; }
  .logo-glow {
    position: absolute; inset: -9px; border-radius: 24px;
    background: rgba(56,189,248,0.22); filter: blur(12px);
    animation: breathe 1.8s ease-in-out infinite;
  }
  .logo {
    position: relative; width: 68px; height: 68px; border-radius: 18px;
    display: flex; align-items: center; justify-content: center;
    background: linear-gradient(145deg, #2563eb, #38bdf8);
    box-shadow: 0 16px 36px rgba(37,99,235,0.28), inset 0 1px 0 rgba(255,255,255,0.2);
  }
  .logo svg { width: 39px; height: 39px; }
  .title {
    font-size: 18px; font-weight: 700; letter-spacing: 0.35px;
    color: #e2e8f0;
  }
  .title .accent { color: #38bdf8; }
  .sub {
    margin-top: 5px; font-size: 11px; letter-spacing: 0.2px;
    color: #94a3b8;
  }
  .progress {
    width: 152px; height: 3px; margin-top: 17px; border-radius: 999px;
    overflow: hidden; background: rgba(148,163,184,0.18);
  }
  .progress::after {
    content: ""; display: block; width: 42%; height: 100%; border-radius: inherit;
    background: linear-gradient(90deg, #2563eb, #38bdf8);
    animation: progress 1.25s ease-in-out infinite;
  }
  @keyframes breathe { 50% { opacity: 0.58; transform: scale(0.94); } }
  @keyframes progress {
    from { transform: translateX(-110%); }
    to { transform: translateX(350%); }
  }
  @media (prefers-reduced-motion: reduce) {
    .logo-glow, .progress::after { animation: none; }
    .progress::after { width: 100%; opacity: 0.7; }
  }
</style>
</head>
<body data-tauri-drag-region aria-label="sortOfRemoteNG loading">
  <div class="container">
    <div class="logo-wrap" aria-hidden="true">
      <div class="logo-glow"></div>
      <div class="logo" data-brand-mark="monitor">
        <svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" stroke="#e2e8f0" stroke-width="1.8" />
          <line x1="8" y1="21" x2="16" y2="21" stroke="#e2e8f0" stroke-width="1.8" />
          <line x1="12" y1="17" x2="12" y2="21" stroke="#e2e8f0" stroke-width="1.8" />
          <rect x="4.6" y="5.6" width="14.8" height="8.8" rx="1" fill="#0f172a" stroke="#38bdf8" stroke-opacity="0.75" stroke-width="0.35" />
        </svg>
      </div>
    </div>
    <div class="title">sortOf<span class="accent">Remote</span>NG</div>
    <div class="sub">Remote Connection Manager</div>
    <div class="progress" role="progressbar" aria-label="Loading application"></div>
  </div>
</body>
</html>"##;

/// Percent-encode a string for use in a data URI (inline helper).
fn percent_encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len() * 3);
    for b in input.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => {
                out.push('%');
                out.push(char::from(b"0123456789ABCDEF"[(b >> 4) as usize]));
                out.push(char::from(b"0123456789ABCDEF"[(b & 0x0F) as usize]));
            }
        }
    }
    out
}

/// Create and show the splash window.
pub fn show(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let data_uri = format!(
        "data:text/html;charset=utf-8,{}",
        percent_encode(SPLASH_HTML)
    );
    let builder = WebviewWindowBuilder::new(app, "splash", WebviewUrl::External(data_uri.parse()?))
        .title("sortOfRemoteNG")
        .inner_size(340.0, 240.0)
        .resizable(false)
        .decorations(false)
        .center()
        .always_on_top(true);
    // `transparent` on macOS requires Tauri's `macos-private-api` feature,
    // which the app deliberately does not enable. Keep the transparent splash
    // on every other platform; macOS falls back to an opaque window.
    #[cfg(not(target_os = "macos"))]
    let builder = builder.transparent(true);
    builder.build()?;
    Ok(())
}

/// Close the splash window and show the main window.
/// Called from the frontend once the app is ready.
/// (Used by sorng-commands-core via #[path] include, not by this crate directly.)
#[allow(dead_code)]
#[tauri::command]
pub async fn close_splash(app: AppHandle) {
    if let Some(splash) = app.get_webview_window("splash") {
        let _ = splash.close();
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_splash_uses_the_canonical_monitor_brand() {
        let app_icon_source = include_str!("../icons/app-icon-source.svg");
        for shared in [
            "#172554",
            "#0f172a",
            "#020617",
            "#2563eb",
            "#38bdf8",
            "#e2e8f0",
            "<rect x=\"2\" y=\"3\" width=\"20\" height=\"14\" rx=\"2\"",
            "<line x1=\"8\" y1=\"21\" x2=\"16\" y2=\"21\"",
            "<line x1=\"12\" y1=\"17\" x2=\"12\" y2=\"21\"",
            "<rect x=\"4.6\" y=\"5.6\" width=\"14.8\" height=\"8.8\" rx=\"1\"",
        ] {
            assert!(
                app_icon_source.contains(shared),
                "packaged icon is missing canonical brand token {shared}"
            );
            assert!(
                SPLASH_HTML.contains(shared),
                "native splash drifted from packaged icon token {shared}"
            );
        }
        assert!(SPLASH_HTML.contains("data-brand-mark=\"monitor\""));
        assert!(SPLASH_HTML.contains("viewBox=\"0 0 24 24\""));
        assert!(SPLASH_HTML.contains("sortOf<span class=\"accent\">Remote</span>NG"));
        assert!(!SPLASH_HTML.contains("class=\"spinner\""));
    }

    #[test]
    fn encoded_splash_is_a_self_contained_accessible_document() {
        assert!(SPLASH_HTML.contains("aria-label=\"sortOfRemoteNG loading\""));
        assert!(SPLASH_HTML.contains("role=\"progressbar\""));
        assert!(SPLASH_HTML.contains("prefers-reduced-motion"));

        let encoded = percent_encode(SPLASH_HTML);
        assert!(encoded.starts_with("%3C%21DOCTYPE%20html%3E"));
        assert!(!encoded
            .chars()
            .any(|character| matches!(character, '<' | '>' | '#' | ' ')));
    }
}
