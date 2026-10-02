//! Opt-in anonymous live acceptance: real WebView2 + production proxy + native guard.
//! Never reads an application database, existing browser profile, or saved credentials.
//! Run one site per process: the native guard intentionally latches failure on teardown.
#[cfg(not(windows))]
fn main() {
    if std::env::args().any(|arg| arg == "--live") {
        eprintln!("native_live_browser requires Windows WebView2");
        std::process::exit(2);
    }
    println!("SKIPPED native_live_browser: Windows WebView2 and explicit --live are required");
}

#[cfg(windows)]
use sorng_protocols::webview_origins;
#[cfg(windows)]
use windows as windows_api;
#[cfg(windows)]
#[path = "../../../src/web_network_guard_windows.rs"]
mod guard;

#[cfg(windows)]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    use serde_json::{json, Value};
    use sorng_protocols::http::{start_proxy_session, BasicAuthProxyConfig, ProxySessionManager};
    use std::{
        collections::BTreeMap,
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
    use wry::{WebContext, WebViewBuilder, WebViewExtWindows};

    let args: Vec<_> = std::env::args().skip(1).collect();
    // Cargo's ordinary test run must never contact public services.
    if !args.iter().any(|arg| arg == "--live") {
        println!("SKIPPED native_live_browser: pass --live google|cloudflare|porkbun [--dark]");
        return Ok(());
    }
    if args.len() < 2
        || args[0] != "--live"
        || args.len() > 4
        || args[2..]
            .iter()
            .any(|arg| arg != "--dark" && arg != "--check-workers")
    {
        return Err("Usage: --live google|cloudflare|porkbun [--dark] [--check-workers]".into());
    }
    let (site, target, application) = match args[1].as_str() {
        "google" => (
            "google",
            "https://analytics.google.com/analytics/web/",
            "google-hosted",
        ),
        "cloudflare" => (
            "cloudflare",
            "https://dash.cloudflare.com/login",
            "cloudflare",
        ),
        "porkbun" => ("porkbun", "https://porkbun.com/account/login", "porkbun"),
        _ => return Err("Unknown live site".into()),
    };
    let dark = args.iter().any(|arg| arg == "--dark");
    let check_workers = args.iter().any(|arg| arg == "--check-workers");
    if check_workers && site != "cloudflare" {
        return Err("--check-workers is a separate Cloudflare CSP diagnostic".into());
    }
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()?;
    let _runtime_entered = runtime.enter();
    let sessions = ProxySessionManager::new();
    let shell_listener = TcpListener::bind("127.0.0.1:0")?;
    shell_listener.set_nonblocking(true)?;
    let shell_origin = format!("http://localhost:{}", shell_listener.local_addr()?.port());
    let profile = tempfile::Builder::new()
        .prefix("sorng-live-browser-")
        .tempdir()?;
    let mut context = WebContext::new(Some(profile.path().join("profile")));
    let mut events = EventLoopBuilder::<()>::with_user_event().build();
    let window = WindowBuilder::new()
        .with_visible(false)
        .with_inner_size(tao::dpi::LogicalSize::new(1280.0, 900.0))
        .with_title("Anonymous browser acceptance probe")
        .build(&events)?;
    let messages = Arc::new(Mutex::new(Vec::<(String, Value)>::new()));
    let ipc_messages = messages.clone();
    let builder = WebViewBuilder::new_with_web_context(&mut context)
        .with_incognito(true)
        // No webdriver, UA override, remote-debugging port or disabled web security.
        .with_initialization_script_for_main_only(include_str!("live_browser/observe.js"), false)
        .with_ipc_handler(move |request| {
            if request.body().len() > 8192 {
                return;
            }
            if let (Ok(url), Ok(value)) = (
                url::Url::parse(&request.uri().to_string()),
                serde_json::from_str::<Value>(request.body()),
            ) {
                let mut pending = ipc_messages.lock().unwrap();
                if pending.len() < 128 {
                    pending.push((url.origin().ascii_serialization(), value));
                }
            }
        });
    let builder = if check_workers {
        builder.with_initialization_script_for_main_only(
            include_str!("live_browser/worker_check.js"),
            false,
        )
    } else {
        builder
    };
    let webview = builder.build(&window)?;
    let core = unsafe { webview.controller().CoreWebView2()? };
    let failed = Arc::new(AtomicBool::new(false));
    let denied = Arc::new(Mutex::new(BTreeMap::<String, usize>::new()));
    let failed_guard = failed.clone();
    let denied_guard = denied.clone();
    let resource_shell = shell_origin.clone();
    let installed_guard = guard::install(
        &core,
        &webview.environment(),
        Arc::new(webview_origins::allows_frame_url),
        Arc::new(move |value| {
            let allowed = webview_origins::allows_resource_url(value, &resource_shell, None);
            if !allowed {
                if let Ok(url) = url::Url::parse(value) {
                    let mut counts = denied_guard.lock().unwrap();
                    if counts.len() < 64 {
                        *counts
                            .entry(url.origin().ascii_serialization())
                            .or_default() += 1;
                    }
                }
            }
            allowed
        }),
        Arc::new(move || {
            failed_guard.store(true, Ordering::SeqCst);
            webview_origins::mark_frame_guard_failed();
        }),
    )?;
    webview_origins::mark_frame_guard_ready();
    webview_origins::require_frame_guard_ready()?;
    let upstream = url::Url::parse(target)?;
    let config: BasicAuthProxyConfig = serde_json::from_value(json!({
        "target_url":format!("{}/", upstream.origin().ascii_serialization()), "username":"", "password":"", "upstream_auth_mode":"none",
        "reviewed_application_profile": application, "http_auto_login":false,
        "connection_id":"anonymous-live-acceptance", "verify_ssl":true,
        "website_dark_mode": if dark {json!({"backgroundColor":"#111827","textColor":"#e5e7eb"})} else {Value::Null}
    }))?;
    let proxy = runtime.block_on(start_proxy_session(config, sessions.clone(), None))?;
    let proxy_origin = url::Url::parse(&proxy.proxy_url)?
        .origin()
        .ascii_serialization();
    let mut allowed_origins = vec![proxy_origin.clone()];
    for route in &proxy.google_routes {
        if route.documents && !allowed_origins.contains(&route.proxy_origin) {
            allowed_origins.push(route.proxy_origin.clone());
        }
    }
    let navigation_token = sorng_protocols::themed_auth::fresh_nonce();
    let mut page = url::Url::parse(&proxy.proxy_url)?;
    page.set_path(upstream.path());
    page.set_query(upstream.query());
    let shell_config = json!({"proxyUrl":page.as_str(), "sessionId":proxy.session_id,
        "allowedOrigins":allowed_origins, "navigationToken":navigation_token});
    let shell =
        include_str!("live_browser/shell.html").replace("__CONFIG__", &shell_config.to_string());
    let stopped = Arc::new(AtomicBool::new(false));
    let server_stop = stopped.clone();
    let server = std::thread::spawn(move || {
        while !server_stop.load(Ordering::SeqCst) {
            match shell_listener.accept() {
                Ok((mut socket, _)) => {
                    let _ = socket.set_read_timeout(Some(Duration::from_secs(1)));
                    let _ = socket.set_write_timeout(Some(Duration::from_secs(1)));
                    let mut request = [0; 8192];
                    let mut size = 0;
                    while size < request.len()
                        && !request[..size].windows(4).any(|x| x == b"\r\n\r\n")
                    {
                        match socket.read(&mut request[size..]) {
                            Ok(0) | Err(_) => break,
                            Ok(n) => size += n,
                        }
                    }
                    let body = if request[..size].starts_with(b"GET / HTTP/") {
                        shell.as_str()
                    } else {
                        ""
                    };
                    let _ = write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}", body.len(), body);
                }
                Err(_) => std::thread::sleep(Duration::from_millis(10)),
            }
        }
    });
    eprintln!(
        "Live {site}: isolated WebView2, production proxy, dark={dark}, anonymous, 45 seconds"
    );
    webview.load_url(&format!("{shell_origin}/"))?;
    let started = Instant::now();
    let mut activation_count = 0;
    let mut activation_errors = 0;
    let mut current_sequence = 0;
    let mut snapshots = Vec::new();
    let mut lifecycle = BTreeMap::<String, u64>::new();
    let mut shell_state = json!({});
    let mut user_agent = None::<String>;
    let mut network_blocks = Vec::new();
    events.run_return(|event, _, flow| {
        *flow = ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(20));
        if let Event::MainEventsCleared = event {
            for (origin, message) in messages.lock().unwrap().drain(..) {
                let kind = message["kind"].as_str().unwrap_or("");
                if origin == shell_origin && kind == "activate" {
                    if let Some(sequence) = message["sequence"].as_u64() {
                        let manager = sessions.lock().unwrap();
                        if let Some(entry) = manager.sessions.get(&proxy.session_id) {
                            match entry.network.activate_document(sequence) {
                                Ok(_) => {
                                    activation_count += 1;
                                    current_sequence = sequence;
                                }
                                Err(_) => activation_errors += 1,
                            }
                        }
                    }
                } else if origin == shell_origin && kind == "lifecycle" {
                    let name = message["event"].as_str().unwrap_or("");
                    if matches!(
                        name,
                        "proxy_document_start" | "proxy_dom_ready" | "proxy_navigation_start"
                    ) {
                        *lifecycle.entry(name.into()).or_default() += 1;
                    }
                    for key in ["configAccepted", "documentSeen", "domReady", "darkReady"] {
                        if let Some(value) = message["snapshot"][key].as_bool() {
                            shell_state[key] = json!(value);
                        }
                    }
                    for key in [
                        "documentStart",
                        "navigationStart",
                        "domReady",
                        "darkPending",
                        "darkReady",
                        "frameLoad",
                        "activationRequests",
                        "activationBridgeErrors",
                        "rejectedMessages",
                        "networkBlocked",
                    ] {
                        if let Some(value) = message["snapshot"]["counts"][key]
                            .as_u64()
                            .filter(|v| *v <= 1000)
                        {
                            shell_state["counts"][key] = json!(value);
                        }
                    }
                } else if origin == shell_origin
                    && kind == "network-block"
                    && message["sequence"].as_u64() == Some(current_sequence)
                    && network_blocks.len() < 32
                {
                    let request_kind = match message["requestKind"].as_str() {
                        Some(
                            value @ ("fetch" | "xhr" | "resource" | "css" | "font" | "websocket"
                            | "Worker" | "SharedWorker" | "WebTransport" | "serviceworker"
                            | "worklet" | "window" | "compatibility" | "document"),
                        ) => value,
                        _ => "other",
                    };
                    let reason = match message["reason"].as_str() {
                        Some(
                            value @ ("unsupported-network-context"
                            | "origin-not-approved"
                            | "unavailable-interceptor"
                            | "invalid-url"
                            | "url-credentials"
                            | "unsupported-scheme"
                            | "document-closed"
                            | "document-expired"
                            | "unsupported-request-body"
                            | "request-body-too-large"
                            | "unsupported-srcset"
                            | "unsupported-css-url-syntax"
                            | "reserved-url-parameter"
                            | "popup-origin-not-approved"),
                        ) => value,
                        _ => "other",
                    };
                    network_blocks.push(json!({"kind":request_kind,"reason":reason}));
                } else if origin == shell_origin && kind == "identity" {
                    user_agent = message["userAgent"]
                        .as_str()
                        .filter(|s| s.len() <= 512 && !s.chars().any(char::is_control))
                        .map(str::to_owned);
                } else if origin == shell_origin
                    && kind == "observation"
                    && snapshots.len() < 60
                    && current_sequence > 0
                    && message["sequence"].as_u64() == Some(current_sequence)
                {
                    let mut snapshot = safe_snapshot(&message["snapshot"]);
                    snapshot["elapsedMs"] = json!(started.elapsed().as_millis() as u64);
                    snapshot["documentSequence"] = json!(current_sequence);
                    snapshots.push(snapshot);
                }
            }
            if failed.load(Ordering::SeqCst) || started.elapsed() >= Duration::from_secs(45) {
                *flow = ControlFlow::Exit;
            }
        }
    });
    stopped.store(true, Ordering::SeqCst);
    server.join().map_err(|_| "Shell server failed")?;
    let manager = sessions.lock().unwrap();
    let mut statuses = BTreeMap::<u16, usize>::new();
    for row in manager.request_log_newest_first() {
        if row.session_id == proxy.session_id {
            *statuses.entry(row.status).or_default() += 1;
        }
    }
    let entry = manager
        .sessions
        .get(&proxy.session_id)
        .ok_or("Live session disappeared")?;
    let request_count = entry.request_count.load(Ordering::SeqCst);
    let error_count = entry.error_count.load(Ordering::SeqCst);
    drop(manager);
    let observed = !snapshots.is_empty() && request_count > 0;
    let worker_check_passed = snapshots.iter().any(|snapshot| {
        [
            "workerCheckComplete",
            "workerComputation",
            "workerFetchBlocked",
            "workerSocketBlocked",
            "workerScriptBlocked",
        ]
        .iter()
        .all(|key| snapshot[*key] == true)
    });
    let mut report = json!({"schemaVersion":1,"site":site,"darkMode":dark,
        "engine":"Windows WebView2", "engineVersion":wry::webview_version().ok(),
        "layer":"production-proxy-native-guard-real-webview",
        "authenticatedLogin":"not-run-no-credentials", "observed":observed,
        "workerCheckRequested":check_workers,"workerCheckPassed":check_workers && worker_check_passed,
        "guardFailed":failed.load(Ordering::SeqCst), "activations":activation_count,
        "activationErrors":activation_errors, "documentSequence":current_sequence,
        "elapsedMs":started.elapsed().as_millis() as u64,
        "lifecycle":lifecycle, "shell":shell_state,"userAgent":user_agent,
        "proxyRequests":request_count, "proxyErrors":error_count, "httpStatuses":statuses,
        "blockedResourceOrigins":*denied.lock().unwrap(),"networkBlocks":network_blocks,"snapshots":snapshots});
    if let Some(mut entry) = sessions.lock().unwrap().sessions.remove(&proxy.session_id) {
        entry.network.revoke();
        if let Some(shutdown) = entry.shutdown_tx.take() {
            let _ = shutdown.send(());
        }
    }
    drop(installed_guard);
    unsafe {
        webview.controller().Close()?;
    }
    drop(core);
    drop(webview);
    drop(window);
    drop(context);
    // Remove only the exact disposable profile we allocated above, after COM closes.
    let owned_profile = profile.keep();
    let cleanup_deadline = Instant::now() + Duration::from_secs(5);
    let removed = loop {
        if std::fs::remove_dir_all(&owned_profile).is_ok() {
            break true;
        }
        if Instant::now() >= cleanup_deadline {
            break false;
        }
        let until = Instant::now() + Duration::from_millis(100);
        events.run_return(|_, _, flow| {
            *flow = if Instant::now() >= until {
                ControlFlow::Exit
            } else {
                ControlFlow::WaitUntil(until)
            };
        });
    };
    report["temporaryProfileRemoved"] = json!(removed);
    println!("SORNG_LIVE_BROWSER_RESULT={report}");
    if !observed
        || failed.load(Ordering::SeqCst)
        || !removed
        || activation_errors > 0
        || (check_workers && !worker_check_passed)
    {
        return Err("Live probe incomplete or cleanup/guard failed; see sanitized report".into());
    }
    Ok(())
}

/// Remote pages are untrusted: even test IPC can never dump arbitrary page data.
#[cfg(windows)]
fn safe_snapshot(input: &serde_json::Value) -> serde_json::Value {
    use serde_json::{json, Value};
    let mut out = json!({});
    for key in [
        "emailFields",
        "passwordFields",
        "bodyElements",
        "bodyTextLength",
        "scriptErrors",
        "cspViolations",
        "bootstrapErrors",
        "turnstileErrors",
        "resourceErrors",
    ] {
        if let Some(value) = input[key].as_u64().filter(|v| *v <= 1_000_000) {
            out[key] = json!(value);
        }
    }
    for key in [
        "bodyVisible",
        "darkReady",
        "darkPresented",
        "challenge",
        "turnstile",
        "humanVerificationPrompt",
        "cookiesRequired",
        "verificationFailed",
        "insecureBrowser",
        "accessDenied",
        "workerCheckComplete",
        "workerComputation",
        "workerFetchBlocked",
        "workerSocketBlocked",
        "workerScriptBlocked",
    ] {
        if let Some(value) = input[key].as_bool() {
            out[key] = Value::Bool(value);
        }
    }
    if let Some(value @ ("loading" | "interactive" | "complete")) = input["readyState"].as_str() {
        out["readyState"] = json!(value);
    }
    out
}
