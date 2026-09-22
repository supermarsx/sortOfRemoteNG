//! Windows-only, hidden and disposable WebView2 proof of the actual production
//! callback. No application database, user profile, real remote host or GUI.

#[cfg(not(target_os = "windows"))]
fn main() {
    eprintln!("native_frame_navigation: Windows WebView2 fixture is unsupported here");
}

#[cfg(target_os = "windows")]
use windows as windows_api;
#[cfg(target_os = "windows")]
#[path = "../../../src/web_network_guard_windows.rs"]
mod guard;
#[cfg(target_os = "windows")]
#[path = "../../sorng-protocols/src/webview_origins.rs"]
mod webview_origins;

#[cfg(target_os = "windows")]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::{
            atomic::{AtomicBool, AtomicUsize, Ordering},
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
    use wry::{WebContext, WebViewBuilder, WebViewBuilderExtWindows, WebViewExtWindows};

    let root = TcpListener::bind("127.0.0.1:0")?;
    let sink = TcpListener::bind("127.0.0.1:0")?;
    root.set_nonblocking(true)?;
    sink.set_nonblocking(true)?;
    let root_port = root.local_addr()?.port();
    let sink_port = sink.local_addr()?.port();
    let proxy_origin = format!("http://p0123456789abcdef0123456789abcdef.localhost:{root_port}");
    let sink_origin = format!("http://127.0.0.1:{sink_port}");
    let lease = webview_origins::acquire_proxy_origin(&proxy_origin)?;
    let stopped = Arc::new(AtomicBool::new(false));
    let sink_requests = Arc::new(AtomicUsize::new(0));
    let sink_connections = Arc::new(AtomicUsize::new(0));
    let sink_observations = Arc::new(Mutex::new(Vec::new()));
    let requests = Arc::new(Mutex::new(Vec::new()));
    // Reuse an installed redistributable font, never a download or user asset.
    let font = Arc::new(std::fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../node_modules/next/dist/next-devtools/server/font/geist-latin.woff2"),
    )?);
    let server = {
        let stopped = stopped.clone();
        let sink_requests = sink_requests.clone();
        let sink_connections = sink_connections.clone();
        let sink_observations = sink_observations.clone();
        let requests = requests.clone();
        let proxy_origin = proxy_origin.clone();
        std::thread::spawn(move || {
            let mut handlers = Vec::new();
            while !stopped.load(Ordering::SeqCst) {
                for (listener, forbidden) in [(&root, false), (&sink, true)] {
                    if let Ok((mut socket, _)) = listener.accept() {
                        if handlers.len() >= 64 {
                            continue;
                        }
                        let sink_requests = sink_requests.clone();
                        let sink_connections = sink_connections.clone();
                        let sink_observations = sink_observations.clone();
                        let requests = requests.clone();
                        let proxy_origin = proxy_origin.clone();
                        let sink_origin = sink_origin.clone();
                        let font = font.clone();
                        handlers.push(std::thread::spawn(move || {
                        let mut bytes = [0; 8192];
                        let mut size = 0;
                        let deadline = Instant::now() + Duration::from_secs(1);
                        // TCP reads are not HTTP message boundaries. In
                        // particular, never answer an empty preconnect with
                        // the root HTML or misroute a partially received GET.
                        while size < bytes.len()
                            && !bytes[..size].windows(4).any(|chunk| chunk == b"\r\n\r\n")
                            && Instant::now() < deadline
                        {
                            let _ = socket.set_read_timeout(Some(deadline.saturating_duration_since(Instant::now()).max(Duration::from_millis(1))));
                            match socket.read(&mut bytes[size..]) {
                                Ok(0) | Err(_) => break,
                                Ok(count) => size += count,
                            }
                        }
                        let request = String::from_utf8_lossy(&bytes[..size]);
                        let mut line = request.split("\r\n").next().unwrap_or("").split_whitespace();
                        let method = line.next().unwrap_or("<none>");
                        let path = line.next().unwrap_or("<incomplete>");
                        let version = line.next().unwrap_or("");
                        if forbidden {
                            sink_connections.fetch_add(1, Ordering::SeqCst);
                            // A preconnected socket can close or time out without
                            // sending HTTP. Count it separately, never hide it.
                            if size != 0 {
                                sink_requests.fetch_add(1, Ordering::SeqCst);
                            }
                            sink_observations.lock().unwrap().push(format!(
                                "bytes={size}, method={}, path={path}",
                                method
                            ));
                        }
                        if !bytes[..size].windows(4).any(|chunk| chunk == b"\r\n\r\n")
                            || !matches!(method, "GET" | "POST") || !matches!(version, "HTTP/1.1" | "HTTP/1.0")
                            || !path.starts_with('/') { return; }
                        if !forbidden { requests.lock().unwrap().push(path.to_string()); }
                        if path == "/worker.js" {
                            let body = format!("fetch('{sink_origin}/foreign-worker',{{mode:'no-cors'}}).catch(()=>{{}});fetch('/observation-worker');");
                            let _ = socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/javascript\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes());
                            return;
                        }
                        if path.starts_with("/observation-") || path.starts_with("/proof-") {
                            let (mime, body): (&str, &[u8]) = if path.starts_with("/observation-font") {
                                ("font/woff2", font.as_slice())
                            } else if path.starts_with("/observation-style") {
                                ("text/css", b"@font-face{font-family:Fixture;src:url('/observation-font')}#font-proof{font-family:Fixture}")
                            } else if path.starts_with("/observation-script") {
                                ("application/javascript", b"window.observationScriptLoaded=true;")
                            } else if path.starts_with("/observation-image") {
                                ("image/svg+xml", b"<svg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/>")
                            } else { ("text/plain", b"fixture response") };
                            let _ = socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n", body.len()).as_bytes());
                            let _ = socket.write_all(body);
                            return;
                        }
                        let (status, extra, body) = match path {
                            "/" => ("200 OK", String::new(), format!(r#"<!doctype html><html><head>
<link rel="stylesheet" href="/observation-style"><script src="/observation-script"></script></head><body>
<span id="font-proof">Font proof</span><img src="/observation-image">
<link rel="stylesheet" href="{sink_origin}/foreign-style"><script src="{sink_origin}/foreign-script"></script>
<img src="{sink_origin}/foreign-image">
<style>@font-face{{font-family:Foreign;src:url('{sink_origin}/foreign-font')}}#foreign-font{{font-family:Foreign}}</style><span id="foreign-font">Foreign font proof</span>
<iframe src="{sink_origin}/parser"></iframe>
<iframe src="{proxy_origin}/redirect"></iframe>
<iframe src="{proxy_origin}/meta"></iframe>
<iframe src="{proxy_origin}/control"></iframe>
<script>var f=document.createElement('iframe');f.src='{sink_origin}/dynamic';document.body.append(f);
var print=document.createElement('iframe');print.srcdoc='<p>Local print content</p>';print.sandbox='allow-same-origin allow-modals';print.onload=()=>{{if(print.contentDocument.body.textContent==='Local print content')fetch('/proof-print');}};document.body.append(print);</script>
<script>
fetch('/observation-fetch?privateQuery=fixture-secret').then(r=>{{if(r.ok)return r.text();}}).then(t=>{{if(t==='fixture response')fetch('/proof-app-fetch');}});
var xhr=new XMLHttpRequest();xhr.open('POST','/observation-xhr?privateQuery=fixture-secret');xhr.onload=()=>{{if(xhr.status===200&&xhr.responseText==='fixture response')fetch('/proof-app-xhr');}};xhr.send('fixture-secret-body');
fetch('{proxy_origin}/observation-proxy-fetch').then(r=>r.text()).then(t=>{{if(t==='fixture response')fetch('/proof-proxy-fetch');}});
var px=new XMLHttpRequest();px.open('GET','{proxy_origin}/observation-proxy-xhr');px.onload=()=>{{if(px.status===200&&px.responseText==='fixture response')fetch('/proof-proxy-xhr');}};px.send();
fetch('{sink_origin}/foreign-fetch',{{mode:'no-cors'}}).catch(()=>{{}});
var foreign=new XMLHttpRequest();foreign.open('POST','{sink_origin}/foreign-xhr');foreign.send('fixture-secret-body');
fetch('http://localhost:{root_port}/alias-fetch',{{mode:'no-cors'}}).catch(()=>{{}});
new Worker('/worker.js');
var localScript=document.createElement('script');localScript.src=URL.createObjectURL(new Blob(["fetch('/proof-blob')"],{{type:'application/javascript'}}));document.body.append(localScript);
</script>
</body></html>"#)),
                            "/self-source" => ("200 OK", String::new(), format!("<script>location.assign('{sink_origin}/self-navigation')</script>")),
                            "/nested" => ("200 OK", String::new(), format!("<iframe src='{proxy_origin}/nested-inner'></iframe>")),
                            "/nested-inner" => ("200 OK", String::new(), format!("<script>location.replace('{sink_origin}/nested-navigation')</script>")),
                            "/redirect" => ("302 Found", format!("Location: {sink_origin}/redirect-destination\r\n"), String::new()),
                            "/meta" => ("200 OK", String::new(), format!("<meta http-equiv='refresh' content='0;url={sink_origin}/meta-destination'>")),
                            _ => ("200 OK", String::new(), "<p>Allowed control</p>".into()),
                        };
                        let response = format!("HTTP/1.1 {status}\r\n{extra}Content-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                        let _ = socket.write_all(response.as_bytes());
                        }));
                    }
                }
                std::thread::sleep(Duration::from_millis(5));
            }
            for handler in handlers {
                handler.join().unwrap();
            }
        })
    };
    let profile = tempfile::Builder::new()
        .prefix("sorng-frame-guard-")
        .tempdir()?;
    let mut context = WebContext::new(Some(profile.path().join("profile")));
    let mut events = EventLoopBuilder::<()>::with_user_event().build();
    let window = WindowBuilder::new()
        .with_visible(false)
        .with_title("Frame guard fixture")
        .build(&events)?;
    let webview = WebViewBuilder::new_with_web_context(&mut context)
        .with_incognito(true)
        .with_additional_browser_args("--disable-background-networking --disable-component-update --disable-sync --no-first-run --disable-extensions")
        .build(&window)?;
    let core = unsafe { webview.controller().CoreWebView2()? };
    let denied = Arc::new(Mutex::new(Vec::new()));
    let failed = Arc::new(AtomicBool::new(false));
    let installed_guard = guard::install(
        &core,
        &webview.environment(),
        {
            let denied = denied.clone();
            Arc::new(move |value| {
                let allowed = webview_origins::allows_frame_url(value);
                if !allowed {
                    denied.lock().unwrap().push(value.to_string());
                }
                allowed
            })
        },
        {
            let shell_origin = format!("http://127.0.0.1:{root_port}");
            let denied = denied.clone();
            Arc::new(move |url| {
                let allowed = webview_origins::allows_resource_url(url, &shell_origin, None);
                if !allowed {
                    // The authoritative request filter can run before the
                    // navigation event (which then need not occur at all).
                    denied.lock().unwrap().push(url.to_string());
                }
                allowed
            })
        },
        {
            let failed = failed.clone();
            Arc::new(move || {
                failed.store(true, Ordering::SeqCst);
                webview_origins::mark_frame_guard_failed();
            })
        },
    )?;
    webview_origins::mark_frame_guard_ready();
    webview_origins::require_frame_guard_ready()?;
    assert_eq!(
        webview_origins::frame_guard_status().frame_navigation,
        "enforced"
    );
    assert!(webview_origins::frame_guard_status().all_network_requests_mediated);
    webview.load_url(&format!("http://127.0.0.1:{root_port}/"))?;
    let started = Instant::now();
    let mut revoked = false;
    let mut self_started = false;
    let mut nested_started = false;
    let mut complete = false;
    events.run_return(|event, _, flow| {
        *flow = ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(20));
        if let Event::MainEventsCleared = event {
            // Initiate this case only after an actual allowed sibling request,
            // independently of initial parser/blocked sibling scheduling.
            if !self_started && requests.lock().unwrap().iter().any(|path| path == "/control") {
                self_started = true;
                webview.evaluate_script(&format!("var sourceSelfNavigation=document.createElement('iframe');sourceSelfNavigation.src='{proxy_origin}/self-source';document.body.append(sourceSelfNavigation);")).unwrap();
            }
            // Start the nested case after the previous explicit source reached
            // the server, not amid parser siblings cancelled during bootstrap.
            if !nested_started && requests.lock().unwrap().iter().any(|path| path == "/self-source") {
                nested_started = true;
                webview.evaluate_script(&format!("var sourceNestedNavigation=document.createElement('iframe');sourceNestedNavigation.src='{proxy_origin}/nested';document.body.append(sourceNestedNavigation);")).unwrap();
            }
            let all_attempts_observed = ["/parser", "/dynamic", "/self-navigation", "/nested-navigation", "/redirect-destination", "/meta-destination", "/foreign-fetch", "/foreign-xhr", "/foreign-image", "/foreign-script", "/foreign-style", "/foreign-font", "/foreign-worker", "/alias-fetch"]
                .iter().all(|path| denied.lock().unwrap().iter().any(|url| url.ends_with(path)));
            let resources_observed = webview_origins::http_observations::snapshot().is_some_and(|snapshot| {
                ["xhr", "stylesheet", "font", "image", "script"].iter()
                    .all(|kind| snapshot.recent.iter().any(|row| row.resource_kind == *kind))
                    && snapshot.recent.iter().any(|row|
                        row.origin == format!("http://127.0.0.1:{sink_port}")
                        && row.method == "GET"
                        && matches!(row.resource_kind, "xhr" | "fetch"))
            });
            let allowed_requests_complete = ["/control", "/proof-app-fetch", "/proof-app-xhr", "/proof-proxy-fetch", "/proof-proxy-xhr", "/proof-print", "/proof-blob", "/observation-worker"]
                .iter().all(|expected| requests.lock().unwrap().iter().any(|path| path == expected));
            if !revoked && all_attempts_observed && resources_observed && allowed_requests_complete {
                lease.revoke();
                revoked = true;
                webview.evaluate_script(&format!("var revoked=document.createElement('iframe');revoked.src='{proxy_origin}/revoked';document.body.append(revoked);fetch('{proxy_origin}/revoked-fetch',{{mode:'no-cors'}}).catch(()=>{{}});var rx=new XMLHttpRequest();rx.open('GET','{proxy_origin}/revoked-xhr');rx.send();var ri=new Image();ri.src='{proxy_origin}/revoked-image';")).unwrap();
            }
            if revoked && ["/revoked", "/revoked-fetch", "/revoked-xhr", "/revoked-image"].iter().all(|path| denied.lock().unwrap().iter().any(|url| url.ends_with(path))) && started.elapsed() > Duration::from_secs(2) {
                complete = true;
                *flow = ControlFlow::Exit;
            } else if failed.load(Ordering::SeqCst) || started.elapsed() > Duration::from_secs(12) {
                *flow = ControlFlow::Exit;
            }
        }
    });
    stopped.store(true, Ordering::SeqCst);
    server.join().unwrap();
    let failed = failed.load(Ordering::SeqCst);
    let sink_requests = sink_requests.load(Ordering::SeqCst);
    let revoked_request = requests
        .lock()
        .unwrap()
        .iter()
        .any(|path| path.starts_with("/revoked"));
    println!("Native frame fixture outcome: complete={complete}, handler_failed={failed}, sink_requests={sink_requests}, sink_tcp_connections={}, revoked_request={revoked_request}, observations={:?}, allowed_requests={:?}, denied={:?}", sink_connections.load(Ordering::SeqCst), sink_observations.lock().unwrap(), requests.lock().unwrap(), denied.lock().unwrap());
    if let Some(snapshot) = webview_origins::http_observations::snapshot() {
        println!(
            "Native HTTP safe snapshot before cleanup: {}",
            serde_json::to_string(&snapshot)?
        );
    }
    let observations = webview_origins::http_observations::snapshot().unwrap();
    drop(installed_guard);
    assert!(!webview_origins::frame_guard_status().all_network_requests_mediated);
    assert!(webview_origins::require_frame_guard_ready().is_err());
    webview_origins::mark_frame_guard_ready();
    assert_eq!(
        webview_origins::frame_guard_status().frame_navigation,
        "failed"
    );
    unsafe {
        webview.controller().Close()?;
    }
    drop(core);
    drop(webview);
    drop(window);
    drop(context);
    // Only this test's freshly allocated path is removed; no broad profile or
    // browser process cleanup. WebView2 may release its file handles shortly
    // after Close even though all COM handlers/controllers are already dropped.
    let profile_path = profile.keep();
    let cleanup_deadline = Instant::now() + Duration::from_secs(5);
    let cleanup_error = loop {
        match std::fs::remove_dir_all(&profile_path) {
            Ok(()) => break None,
            Err(error) if Instant::now() >= cleanup_deadline => {
                eprintln!(
                    "Fixture-owned profile retained after controller Close: {} ({error})",
                    profile_path.display()
                );
                break Some(error);
            }
            Err(_) => {
                // Closing a WebView is asynchronous. Keep pumping this fixture's
                // STA instead of sleeping with its final COM callbacks blocked.
                let until = Instant::now() + Duration::from_millis(100);
                events.run_return(|_, _, flow| {
                    *flow = if Instant::now() >= until {
                        ControlFlow::Exit
                    } else {
                        ControlFlow::WaitUntil(until)
                    };
                });
            }
        }
    };
    drop(events);
    assert!(!failed, "Native event handler failed");
    assert!(
        complete,
        "Fixture did not complete navigation/resource requests: {:?}",
        denied.lock().unwrap()
    );
    assert_eq!(sink_requests, 0, "A blocked destination received a request");
    assert!(!revoked_request);
    assert!(!requests
        .lock()
        .unwrap()
        .iter()
        .any(|path| path == "/alias-fetch"));
    assert_eq!(observations.scope, "application");
    for kind in ["xhr", "stylesheet", "font", "image", "script"] {
        assert!(
            observations
                .recent
                .iter()
                .any(|row| row.resource_kind == kind),
            "Missing native {kind} observation"
        );
    }
    assert!(observations
        .recent
        .iter()
        .any(|row| row.method == "POST" && row.resource_kind == "xhr"));
    assert!(observations.recent.iter().any(|row| row.origin
        == format!("http://127.0.0.1:{sink_port}")
        && row.method == "GET"
        && matches!(row.resource_kind, "xhr" | "fetch")
        && !row.document_blocked));
    assert!(observations.document_blocked > 0);
    let diagnostic = serde_json::to_string(&observations)?;
    assert!(!diagnostic.contains("fixture-secret"));
    assert!(!diagnostic.contains("observation-"));
    assert!(!diagnostic.contains("privateQuery"));
    println!("Native HTTP observation: foreign POST XHR/GET fetch and resource requests denied; app/proxy responses consumed successfully; snapshot contains only canonical origins and fixed native categories. This runtime can classify fetch as xhr.");
    assert!(
        requests
            .lock()
            .unwrap()
            .iter()
            .any(|path| path == "/self-source"),
        "The self-navigation source was never delivered"
    );
    println!("Windows native HTTP(S) guard: foreign frame, fetch, XHR, image, script, stylesheet, font and worker requests denied; live app/proxy requests succeeded; lease revocation blocks subsequent resources; zero sink HTTP bytes. Blob scripts and local print preserved. Speculative TCP is reported separately; this is Windows HTTP(S) defense-in-depth, not cross-platform or other-protocol coverage.");
    if let Some(error) = cleanup_error {
        return Err(error.into());
    }
    Ok(())
}
