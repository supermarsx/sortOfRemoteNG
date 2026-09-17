//! t95 W0b: Windows-only, hidden and disposable WebView2 measurement of the
//! legacy-page jail. It reproduces the production website frame (an iframe with
//! `PROXY_WEB_FRAME_SANDBOX`, on a per-session `p<hex>.localhost` authority,
//! inside an app document) and measures the three things the blocking dialog
//! bridge depends on in the engine the app really ships:
//!
//!   1. engine dialogs without `allow-modals`;
//!   2. whether the frame blocks alone (its own renderer) or stalls the app;
//!   3. whether the app can answer a held synchronous XHR, and over which
//!      channel it can learn the dialog exists at all.
//!
//! No application database, user profile, app binary, real remote host or GUI.
//! Everything is synthetic and stays on 127.0.0.1.

#[cfg(not(target_os = "windows"))]
fn main() {
    eprintln!("native_legacy_frame_probe: the WebView2 fixture is Windows-only");
}

/// The exact sandbox string the product applies to a validated proxy document.
#[cfg(target_os = "windows")]
const SANDBOX_SOURCE: &str = include_str!("../../../../src/utils/protocol/webBrowserFrame.ts");

/// Read a `export const NAME = "…";` string literal out of the product source.
#[cfg(target_os = "windows")]
fn sandbox_constant(name: &str) -> Result<String, String> {
    let marker = format!("export const {name} =");
    let rest = SANDBOX_SOURCE
        .split(&marker)
        .nth(1)
        .ok_or_else(|| format!("{name} is no longer declared; update this mirror"))?;
    let open = rest
        .find('"')
        .ok_or_else(|| format!("{name} is no longer a string literal"))?
        + 1;
    let close = rest[open..]
        .find('"')
        .ok_or_else(|| format!("{name} is no longer a string literal"))?
        + open;
    Ok(rest[open..close].to_string())
}

#[cfg(target_os = "windows")]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    use std::{
        collections::HashMap,
        io::{Read, Write},
        net::TcpListener,
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc, Mutex,
        },
        time::{Duration, Instant},
    };
    use tao::{
        event::Event,
        event_loop::{ControlFlow, EventLoopBuilder},
        platform::run_return::EventLoopExtRunReturn,
        window::WindowBuilder,
    };
    use wry::{WebContext, WebViewBuilder, WebViewBuilderExtWindows};

    let empty = sandbox_constant("EMPTY_WEB_FRAME_SANDBOX")?;
    let proxy_sandbox = sandbox_constant("PROXY_WEB_FRAME_SANDBOX")?;
    if !empty.is_empty() {
        return Err(format!("The blank frame gained sandbox tokens: {empty:?}").into());
    }
    let mut tokens: Vec<&str> = proxy_sandbox.split_whitespace().collect();
    tokens.sort_unstable();
    if tokens != ["allow-forms", "allow-same-origin", "allow-scripts"] {
        return Err(format!("PROXY_WEB_FRAME_SANDBOX drifted: {proxy_sandbox:?}").into());
    }

    #[derive(Default)]
    struct Shared {
        /// Dialogs the proxy has received and not yet announced to the app.
        pending: Mutex<Vec<String>>,
        /// Answers the app sent back, by dialog id.
        answers: Mutex<HashMap<String, String>>,
        /// The website frame's own findings.
        report: Mutex<Option<String>>,
        /// The app document's tick/message record.
        dump: Mutex<Option<String>>,
    }
    let shared = Arc::new(Shared::default());
    let stopped = Arc::new(AtomicBool::new(false));

    let listener = TcpListener::bind("127.0.0.1:0")?;
    listener.set_nonblocking(true)?;
    let port = listener.local_addr()?.port();
    let proxy_origin = format!("http://p0123456789abcdef0123456789abcdef.localhost:{port}");
    // `dev` mirrors `npm run tauri dev`; `app.localhost` mirrors the packaged
    // app's `tauri.localhost`, a sibling label of the proxy authority.
    let app_hosts = ["localhost", "app.localhost"];

    let server = {
        let shared = shared.clone();
        let stopped = stopped.clone();
        let proxy_origin = proxy_origin.clone();
        let proxy_sandbox = proxy_sandbox.clone();
        std::thread::spawn(move || {
            let mut handlers = Vec::new();
            while !stopped.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((mut socket, _)) => {
                        if handlers.len() >= 64 {
                            continue;
                        }
                        let shared = shared.clone();
                        let proxy_origin = proxy_origin.clone();
                        let proxy_sandbox = proxy_sandbox.clone();
                        handlers.push(std::thread::spawn(move || {
                            let mut raw = Vec::new();
                            let mut chunk = [0u8; 8192];
                            let mut head_end = None;
                            while head_end.is_none() {
                                match socket.read(&mut chunk) {
                                    Ok(0) => return,
                                    Ok(size) => {
                                        raw.extend_from_slice(&chunk[..size]);
                                        head_end = raw
                                            .windows(4)
                                            .position(|window| window == b"\r\n\r\n")
                                            .map(|at| at + 4);
                                    }
                                    Err(_) => return,
                                }
                            }
                            let head_end = head_end.unwrap();
                            let head = String::from_utf8_lossy(&raw[..head_end]).to_string();
                            let length = head
                                .lines()
                                .find_map(|line| {
                                    line.strip_prefix("Content-Length: ")
                                        .or_else(|| line.strip_prefix("content-length: "))
                                })
                                .and_then(|value| value.trim().parse::<usize>().ok())
                                .unwrap_or(0);
                            while raw.len() < head_end + length {
                                match socket.read(&mut chunk) {
                                    Ok(0) => break,
                                    Ok(size) => raw.extend_from_slice(&chunk[..size]),
                                    Err(_) => break,
                                }
                            }
                            let body =
                                String::from_utf8_lossy(&raw[head_end..raw.len().min(head_end + length)])
                                    .to_string();
                            let path = head
                                .lines()
                                .next()
                                .and_then(|line| line.split_whitespace().nth(1))
                                .unwrap_or("/")
                                .to_string();
                            let host = head
                                .lines()
                                .find_map(|line| {
                                    line.strip_prefix("Host: ").or_else(|| line.strip_prefix("host: "))
                                })
                                .unwrap_or("")
                                .trim()
                                .to_string();
                            let app_origin = format!("http://{host}");
                            let (status, content_type, payload) = match path.as_str() {
                                "/favicon.ico" => ("204 No Content", "text/plain", String::new()),
                                "/outer" => (
                                    "200 OK",
                                    "text/html",
                                    app_document(&proxy_origin, &proxy_sandbox),
                                ),
                                "/page" => ("200 OK", "text/html", frame_document()),
                                "/report" => {
                                    *shared.report.lock().unwrap() = Some(body.clone());
                                    ("200 OK", "text/plain", "ok".to_string())
                                }
                                "/__sortofremoteng_dialog_v1" => {
                                    let id = json_string(&body, "dialogId");
                                    let hold = json_number(&body, "holdMs");
                                    shared.pending.lock().unwrap().push(body.clone());
                                    let deadline = Instant::now()
                                        + Duration::from_millis(if hold > 0 { hold } else { 15_000 });
                                    let mut answer = None;
                                    while Instant::now() < deadline {
                                        if let Some(value) = shared.answers.lock().unwrap().get(&id) {
                                            answer = Some(value.clone());
                                            if hold == 0 {
                                                break;
                                            }
                                        }
                                        std::thread::sleep(Duration::from_millis(10));
                                    }
                                    (
                                        "200 OK",
                                        "application/json",
                                        answer.unwrap_or_else(|| "{\"outcome\":\"cancel\"}".to_string()),
                                    )
                                }
                                _ => ("404 Not Found", "text/plain", String::new()),
                            };
                            let _ = app_origin;
                            let response = format!(
                                "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
                                payload.len()
                            );
                            let _ = socket.write_all(response.as_bytes());
                        }));
                    }
                    Err(_) => std::thread::sleep(Duration::from_millis(5)),
                }
            }
            for handler in handlers {
                let _ = handler.join();
            }
        })
    };

    let mut outcomes = Vec::new();
    for host in app_hosts {
        shared.pending.lock().unwrap().clear();
        shared.answers.lock().unwrap().clear();
        *shared.report.lock().unwrap() = None;
        *shared.dump.lock().unwrap() = None;

        let profile = tempfile::Builder::new()
            .prefix("sorng-legacy-frame-")
            .tempdir()?;
        let mut context = WebContext::new(Some(profile.path().join("profile")));
        let mut events = EventLoopBuilder::<()>::with_user_event().build();
        let window = WindowBuilder::new()
            .with_visible(false)
            .with_title("Legacy frame probe")
            .build(&events)?;
        let ipc_shared = shared.clone();
        let webview = WebViewBuilder::new_with_web_context(&mut context)
            .with_incognito(true)
            .with_additional_browser_args(
                "--disable-background-networking --disable-component-update --disable-sync --no-first-run --disable-extensions",
            )
            .with_ipc_handler(move |request| {
                let body = request.body().to_string();
                match json_string(&body, "kind").as_str() {
                    "answer" => {
                        ipc_shared
                            .answers
                            .lock()
                            .unwrap()
                            .insert(json_string(&body, "dialogId"), body.clone());
                    }
                    "dump" => *ipc_shared.dump.lock().unwrap() = Some(body.clone()),
                    _ => {}
                }
            })
            .with_url(format!("http://{host}:{port}/outer"))
            .build(&window)?;

        let started = Instant::now();
        let mut asked_for_dump = false;
        let mut retried = false;
        events.run_return(|event, _, flow| {
            *flow = ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(20));
            if let Event::MainEventsCleared = event {
                // Stands in for the proxy telling the app about a held dialog
                // over its own channel, which never crosses the blocked page.
                let announced: Vec<String> = shared.pending.lock().unwrap().drain(..).collect();
                for dialog in announced {
                    let _ = webview.evaluate_script(&format!(
                        "window.__sorngDialog({});",
                        json_literal(&dialog)
                    ));
                }
                if !asked_for_dump && shared.report.lock().unwrap().is_some() {
                    asked_for_dump = true;
                    let _ = webview.evaluate_script("window.__sorngDump();");
                }
                // WebView2 occasionally drops the very first navigation of a
                // brand new environment; ask once more rather than report a
                // measurement failure that is really a start-up race.
                if !retried && !asked_for_dump && started.elapsed() > Duration::from_secs(20) {
                    retried = true;
                    let _ = webview.load_url(&format!("http://{host}:{port}/outer"));
                }
                if shared.dump.lock().unwrap().is_some()
                    || started.elapsed() > Duration::from_secs(90)
                {
                    *flow = ControlFlow::Exit;
                }
            }
        });

        let report = shared.report.lock().unwrap().clone();
        let dump = shared.dump.lock().unwrap().clone();
        outcomes.push((host, report, dump));
        drop(webview);
        drop(window);
        drop(context);
        drop(events);
        // Closing a WebView2 is asynchronous, so only this fixture's freshly
        // allocated path is removed, and only once its handles are released.
        let path = profile.keep();
        let deadline = Instant::now() + Duration::from_secs(15);
        while std::fs::remove_dir_all(&path).is_err() {
            if Instant::now() >= deadline {
                eprintln!("Fixture-owned profile retained: {}", path.display());
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }

    stopped.store(true, Ordering::SeqCst);
    let _ = server.join();

    let mut failures = Vec::new();
    for (host, report, dump) in &outcomes {
        println!("--- WebView2 app host {host} ---");
        match report {
            Some(value) => println!("frame: {value}"),
            None => failures.push(format!("{host}: the website frame never reported")),
        }
        match dump {
            Some(value) => println!("app window: {value}"),
            None => failures.push(format!("{host}: the app document never reported")),
        }
    }
    if !failures.is_empty() {
        return Err(failures.join("; ").into());
    }
    println!(
        "Legacy frame probe complete for {} app host variants; sandbox mirrored from the product: {proxy_sandbox:?}",
        outcomes.len()
    );
    Ok(())
}

/// Minimal field readers: the probe exchanges flat objects it generates itself.
#[cfg(target_os = "windows")]
fn json_string(body: &str, key: &str) -> String {
    let needle = format!("\"{key}\":\"");
    match body.find(&needle) {
        Some(at) => {
            let rest = &body[at + needle.len()..];
            rest[..rest.find('"').unwrap_or(0)].to_string()
        }
        None => String::new(),
    }
}

#[cfg(target_os = "windows")]
fn json_number(body: &str, key: &str) -> u64 {
    let needle = format!("\"{key}\":");
    match body.find(&needle) {
        Some(at) => {
            let rest = &body[at + needle.len()..];
            let end = rest
                .find(|c: char| !c.is_ascii_digit())
                .unwrap_or(rest.len());
            rest[..end].parse().unwrap_or(0)
        }
        None => 0,
    }
}

/// Embed a JSON document inside a script as a string, then parse it in page.
#[cfg(target_os = "windows")]
fn json_literal(value: &str) -> String {
    let escaped = value
        .replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace('<', "\\u003c")
        .replace('\n', "\\n")
        .replace('\r', "\\r");
    format!("JSON.parse('{escaped}')")
}

/// The app window: a stand-in for the Tauri document that embeds the frame.
#[cfg(target_os = "windows")]
fn app_document(proxy_origin: &str, sandbox: &str) -> String {
    format!(
        r#"<!doctype html><html><head><meta charset="utf-8"><title>app window</title></head><body>
<script>
window.SORNG_APP_MARKER = "app-window-secret";
var state = {{ ticks: [], frames: 0, messages: [], announced: [] }};
setInterval(function () {{ state.ticks.push(Date.now()); }}, 10);
(function paint() {{ state.frames++; requestAnimationFrame(paint); }})();
var frame = document.createElement("iframe");
frame.setAttribute("sandbox", {sandbox});
addEventListener("message", function (event) {{
  state.messages.push({{
    type: event.data && event.data.type,
    sourceIsFrameRoot: event.source === frame.contentWindow,
    deliveryMs: event.data && event.data.sentAt ? Date.now() - event.data.sentAt : null,
  }});
}});
// Called by the host when the proxy receives a held dialog.
window.__sorngDialog = function (dialog) {{
  state.announced.push({{ kind: dialog.kind, message: dialog.message, at: Date.now() }});
  window.ipc.postMessage(JSON.stringify({{
    kind: "answer", dialogId: dialog.dialogId, outcome: "accept", value: "typed-by-host",
  }}));
}};
window.__sorngDump = function () {{
  var gaps = [];
  for (var i = 1; i < state.ticks.length; i++) gaps.push(state.ticks[i] - state.ticks[i - 1]);
  window.ipc.postMessage(JSON.stringify({{
    kind: "dump",
    sandbox: frame.getAttribute("sandbox"),
    ticks: state.ticks.length,
    longestTickGapMs: gaps.length ? Math.max.apply(null, gaps) : -1,
    animationFrames: state.frames,
    proxyAnnouncements: state.announced.length,
    postMessagesFromFrame: state.messages.length,
    postMessageDeliveryMs: state.messages.map(function (m) {{ return m.deliveryMs; }}),
    postMessageSourceIsFrameRoot: state.messages.every(function (m) {{ return m.sourceIsFrameRoot; }}),
  }}));
}};
frame.src = {proxy};
document.body.appendChild(frame);
</script></body></html>"#,
        sandbox = js_string(sandbox),
        proxy = js_string(&format!("{proxy_origin}/page")),
    )
}

/// The synthetic legacy device page. No vendor source is copied.
#[cfg(target_os = "windows")]
fn frame_document() -> String {
    r#"<!doctype html><html><head><meta charset="utf-8"><title>legacy device fixture</title>
<script>
var F = [];
function note(name, outcome, detail) { F.push({ name: name, outcome: outcome, detail: String(detail) }); }
function probe(name, fn) {
  try { var v = fn(); note(name, "ok", typeof v === "string" ? JSON.stringify(v) : String(v)); }
  catch (e) { note(name, "throw", ((e && e.name) || "Error") + ": " + String(e && e.message).slice(0, 180)); }
}
// The compatibility shim prototype: capture first, override parent last.
var realParent = window.parent;
var nested = false;
try { realParent.location.href; nested = true; } catch (e) { nested = false; }
function ask(kind, message, defaultValue, holdMs) {
  var bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  var dialogId = "";
  for (var i = 0; i < bytes.length; i++) dialogId += (bytes[i] + 256).toString(16).slice(1);
  var began = Date.now();
  try {
    (window.__sorngAppParent || window.parent).postMessage({
      type: "sorng_script_dialog", version: 1, dialogId: dialogId, kind: kind,
      message: String(message), sentAt: began,
    }, "*");
  } catch (e) {}
  var xhr = new XMLHttpRequest();
  xhr.open("POST", "/__sortofremoteng_dialog_v1", false);
  xhr.setRequestHeader("Content-Type", "application/json");
  try {
    xhr.send(JSON.stringify({
      dialogId: dialogId, kind: kind, holdMs: holdMs || 0,
      message: String(message), defaultValue: String(defaultValue === undefined ? "" : defaultValue),
    }));
  } catch (e) { return { blockedMs: Date.now() - began, error: String(e && e.name) }; }
  var answer = {};
  try { answer = JSON.parse(xhr.responseText); } catch (e) {}
  return { blockedMs: Date.now() - began, outcome: answer.outcome, value: answer.value };
}
Object.defineProperty(window, "__sorngAppParent", {
  value: realParent, writable: false, configurable: false, enumerable: false,
});
probe("parent.document before the override", function () { return !!parent.document; });
probe("top.document", function () { return !!top.document; });
Object.defineProperty(window, "parent", { value: window, writable: true, configurable: true });
probe("parent.document after the override", function () { return !!parent.document; });
probe("top.document after the override", function () { return !!top.document; });
probe("defineProperty(window,top)", function () { Object.defineProperty(window, "top", { value: window }); return "redefined"; });
// 1. engine dialogs without allow-modals
probe("alert()", function () { return typeof alert("probe"); });
probe("confirm()", function () { return confirm("probe"); });
probe("prompt()", function () { return prompt("probe", "default"); });
probe("print()", function () { print(); return "returned"; });
// 2. renderer placement: block this frame and see whether the app kept running
var busyStart = Date.now();
while (Date.now() < busyStart + 1200) { /* occupy this frame's main thread */ }
note("frame busy loop ms", "ok", Date.now() - busyStart);
var held = ask("confirm", "held probe", undefined, 1200);
note("held synchronous XHR ms", "ok", held.blockedMs);
// 3. the bridge: the app answers a dialog the proxy announced
var answered = ask("confirm", "Apply the new configuration?", undefined, 0);
note("bridge round trip ms", "ok", answered.blockedMs);
note("bridge answer", answered.outcome === "accept" ? "ok" : "failed", JSON.stringify(answered));
fetch("/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ findings: F }) });
</script></head><body>legacy fixture</body></html>"#
        .to_string()
}

#[cfg(target_os = "windows")]
fn js_string(value: &str) -> String {
    format!(
        "\"{}\"",
        value
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('<', "\\u003c")
    )
}
