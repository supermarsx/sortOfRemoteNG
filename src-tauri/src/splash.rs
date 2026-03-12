use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Inline HTML for the splash screen — a simple centered spinner with the
/// app name, rendered entirely from a data URI so it displays instantly
/// without waiting for the frontend dev server or static build.
const SPLASH_HTML: &str = r#"<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 100%; height: 100%;
    background: #0f0f12;
    display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    overflow: hidden; user-select: none;
    -webkit-user-select: none;
  }
  .container { text-align: center; }
  .spinner {
    width: 36px; height: 36px; margin: 0 auto 18px;
    border: 3px solid rgba(255,255,255,0.08);
    border-top-color: rgba(255,255,255,0.5);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .title {
    font-size: 15px; font-weight: 600; letter-spacing: 0.5px;
    color: rgba(255,255,255,0.75);
  }
  .sub {
    margin-top: 6px; font-size: 11px;
    color: rgba(255,255,255,0.3);
  }
</style>
</head>
<body data-tauri-drag-region>
  <div class="container">
    <div class="spinner"></div>
    <div class="title">sortOfRemoteNG</div>
    <div class="sub">Loading&hellip;</div>
  </div>
</body>
</html>"#;

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
    WebviewWindowBuilder::new(app, "splash", WebviewUrl::External(data_uri.parse()?))
        .title("sortOfRemoteNG")
        .inner_size(340.0, 200.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .center()
        .always_on_top(true)
        .build()?;
    Ok(())
}

/// Close the splash window and show the main window.
/// Called from the frontend once the app is ready.
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
