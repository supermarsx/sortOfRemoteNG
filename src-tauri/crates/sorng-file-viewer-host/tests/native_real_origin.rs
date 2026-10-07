//! Opt-in, local-only engineering proof of raw WebView2 through the real relay.
//! No production readiness assertion, public websites, app IPC, installed trust,
//! account credentials, UA overrides or sandbox/certificate-ignore switches.
//! Run the harness-free executable with --probe. The default test run skips it.

#[cfg(not(windows))]
fn main() {
    if std::env::args().len() > 1 {
        eprintln!("Usage: native_real_origin --probe (requires Windows WebView2)");
        std::process::exit(2);
    }
    println!("SKIPPED native_real_origin: Windows and --probe required");
}

#[cfg(windows)]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.is_empty() {
        println!("SKIPPED native_real_origin: pass --probe for local-only engineering acceptance");
        return Ok(());
    }
    if args != ["--probe"] {
        return Err("Usage: native_real_origin --probe".into());
    }
    probe::run()
}

#[cfg(windows)]
mod probe {
    use base64::Engine;
    use serde_json::{json, Value};
    use sorng_protocols::{
        origin_browser::{
            BrowserSessionStatus, NativeProxyChallenge, OriginBrowserPolicy, OriginBrowserSession,
        },
        private_forward_proxy::{Authority, BoxedStream, DialFuture, ProxyLimits, RouteDialer},
    };
    use std::{
        error::Error,
        path::{Path, PathBuf},
        sync::{
            atomic::{AtomicBool, AtomicI32, AtomicUsize, Ordering},
            Arc, Mutex,
        },
        time::{Duration, Instant},
    };
    use tao::{
        event_loop::{ControlFlow, EventLoopBuilder},
        platform::run_return::EventLoopExtRunReturn,
        window::WindowBuilder,
    };
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::{TcpListener, TcpStream},
        sync::watch,
    };
    use webview2_com::{
        BasicAuthenticationRequestedEventHandler, Microsoft::Web::WebView2::Win32::*,
        NavigationCompletedEventHandler, NavigationStartingEventHandler,
        NewWindowRequestedEventHandler, ServerCertificateErrorDetectedEventHandler,
        WebResourceRequestedEventHandler,
    };
    use windows::core::{Interface, HSTRING, PWSTR};
    use wry::{WebContext, WebViewBuilder, WebViewBuilderExtWindows, WebViewExtWindows};

    const HOST: &str = "real-origin.sorng-fixture.test";
    const ORIGIN: &str = "https://real-origin.sorng-fixture.test";
    const PAGE: &str = r#"<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><style>html{background:#111827;color:#e5e7eb}</style></head><body>Local real-origin engineering fixture<script>
(async () => {
  const result = {
    originalOrigin: location.origin === 'https://real-origin.sorng-fixture.test',
    topLevel: window.top === window,
    secureContext: window.isSecureContext === true,
    noTauri: typeof window.__TAURI__ === 'undefined' && typeof window.__TAURI_INTERNALS__ === 'undefined',
    noWryIpc: typeof window.ipc === 'undefined'
  };
  try {
    localStorage.setItem('fixture-storage', 'native-storage');
    result.localStorage = localStorage.getItem('fixture-storage') === 'native-storage';
    document.cookie = 'javascript_cookie=js-ok; Secure; SameSite=Lax; Path=/';
    result.javascriptCookie = document.cookie.includes('javascript_cookie=js-ok');
    result.httpOnlyHidden = !document.cookie.includes('native_cookie=');
    const cookies = await fetch('/cookie-check', {credentials:'include'}).then(r => r.json());
    result.nativeCookieSent = cookies.nativeCookieSent === true;
    result.javascriptCookieSent = cookies.javascriptCookieSent === true;
  } catch (_) { result.fixtureError = true; }
  await fetch('/proof', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(result)});
})();
</script></body></html>"#;

    #[derive(Default)]
    struct Observation {
        requests: usize,
        sni_correct: usize,
        sni_wrong: usize,
        proxy_header_leaked: bool,
        proof: Option<Value>,
    }

    fn fixture_url(value: &str) -> bool {
        url::Url::parse(value).is_ok_and(|url| {
            url.origin().ascii_serialization() == ORIGIN
                && url.username().is_empty()
                && url.password().is_none()
        })
    }

    fn pem_identity(value: &str) -> String {
        value.split_whitespace().collect()
    }

    fn owned_profile_path(path: &Path, temp_root: &Path) -> std::io::Result<PathBuf> {
        let resolved = path.canonicalize()?;
        if resolved.parent() != Some(temp_root)
            || !resolved
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("sorng-real-origin-probe-"))
            || std::fs::symlink_metadata(path)?.file_type().is_symlink()
        {
            return Err(std::io::Error::other(
                "Refusing cleanup outside the allocated probe directory",
            ));
        }
        Ok(resolved)
    }

    unsafe fn take_string(value: PWSTR) -> String {
        let result = value.to_string().unwrap_or_default();
        windows::Win32::System::Com::CoTaskMemFree(Some(value.0.cast()));
        result
    }

    async fn serve(
        socket: TcpStream,
        acceptor: tokio_rustls::TlsAcceptor,
        observed: Arc<Mutex<Observation>>,
    ) -> Result<(), Box<dyn Error + Send + Sync>> {
        let mut tls =
            tokio::time::timeout(Duration::from_secs(5), acceptor.accept(socket)).await??;
        {
            let mut state = observed.lock().unwrap();
            if tls.get_ref().1.server_name() == Some(HOST) {
                state.sni_correct += 1;
            } else {
                state.sni_wrong += 1;
            }
        }
        let mut data = Vec::new();
        let mut buffer = [0u8; 2048];
        let end = loop {
            if data.len() > 16 * 1024 {
                return Err("fixture header limit".into());
            }
            let count = tls.read(&mut buffer).await?;
            if count == 0 {
                return Err("fixture header EOF".into());
            }
            data.extend_from_slice(&buffer[..count]);
            if let Some(at) = data.windows(4).position(|part| part == b"\r\n\r\n") {
                break at + 4;
            }
        };
        let header = std::str::from_utf8(&data[..end])?.to_owned();
        let request = header.lines().next().unwrap_or_default();
        let mut pieces = request.split_whitespace();
        let method = pieces.next().unwrap_or_default();
        let path = pieces.next().unwrap_or_default();
        let mut length = 0usize;
        let mut cookies = "";
        let mut leaked = false;
        for line in header.lines().skip(1) {
            if let Some((name, value)) = line.split_once(':') {
                if name.eq_ignore_ascii_case("content-length") {
                    length = value.trim().parse()?;
                }
                if name.eq_ignore_ascii_case("cookie") {
                    cookies = value.trim();
                }
                if name.eq_ignore_ascii_case("proxy-authorization") {
                    leaked = true;
                }
            }
        }
        if length > 4096 {
            return Err("fixture body limit".into());
        }
        while data.len() < end + length {
            let count = tls.read(&mut buffer).await?;
            if count == 0 {
                return Err("fixture body EOF".into());
            }
            data.extend_from_slice(&buffer[..count]);
        }
        {
            let mut state = observed.lock().unwrap();
            state.requests += 1;
            state.proxy_header_leaked |= leaked;
        }
        let has_cookie = |expected: &str| cookies.split(';').any(|part| part.trim() == expected);
        let (status, mime, extra, body) = match (method, path) {
            ("GET", "/") => ("200 OK", "text/html; charset=utf-8", "Set-Cookie: native_cookie=http-only-ok; Secure; HttpOnly; SameSite=Lax; Path=/\r\n", PAGE.to_owned()),
            ("GET", "/cookie-check") => ("200 OK", "application/json", "", json!({
                "nativeCookieSent": has_cookie("native_cookie=http-only-ok"),
                "javascriptCookieSent": has_cookie("javascript_cookie=js-ok")
            }).to_string()),
            ("POST", "/proof") => {
                let raw: Value = serde_json::from_slice(&data[end..end + length])?;
                // Only fixed boolean fields are retained/reported; never arbitrary page data.
                let mut sanitized = json!({});
                for key in ["originalOrigin", "topLevel", "secureContext", "noTauri", "noWryIpc", "localStorage", "javascriptCookie", "httpOnlyHidden", "nativeCookieSent", "javascriptCookieSent", "fixtureError"] {
                    if let Some(value) = raw[key].as_bool() { sanitized[key] = json!(value); }
                }
                observed.lock().unwrap().proof = Some(sanitized);
                ("200 OK", "text/plain", "", "ok".into())
            }
            _ => ("404 Not Found", "text/plain", "", "not found".into()),
        };
        tls.write_all(format!("HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\n{extra}Cache-Control: no-store\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await?;
        tls.shutdown().await?;
        Ok(())
    }

    pub fn run() -> Result<(), Box<dyn Error>> {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()?;
        let _entered = runtime.enter();
        let certificate = rcgen::generate_simple_self_signed(vec![HOST.into()])?;
        // Serialize once: signing again for PEM could produce a different ECDSA
        // signature and therefore a different certificate from the TLS fixture.
        let der = certificate.serialize_der()?;
        let pinned_pem = pem_identity(&format!(
            "-----BEGIN CERTIFICATE-----\n{}\n-----END CERTIFICATE-----",
            base64::engine::general_purpose::STANDARD.encode(&der)
        ));
        let tls = rustls::ServerConfig::builder_with_provider(Arc::new(
            rustls::crypto::aws_lc_rs::default_provider(),
        ))
        .with_safe_default_protocol_versions()?
        .with_no_client_auth()
        .with_single_cert(
            vec![rustls::pki_types::CertificateDer::from(der)],
            rustls::pki_types::PrivatePkcs8KeyDer::from(certificate.serialize_private_key_der())
                .into(),
        )?;
        let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(tls));
        let listener = runtime.block_on(TcpListener::bind("127.0.0.1:0"))?;
        let fixture_address = listener.local_addr()?;
        let observed = Arc::new(Mutex::new(Observation::default()));
        let server_observed = observed.clone();
        let (stop, mut shutdown) = watch::channel(false);
        let server = runtime.spawn(async move {
            let mut handlers = tokio::task::JoinSet::new();
            loop {
                tokio::select! {
                    _ = shutdown.changed() => break,
                    accepted = listener.accept() => {
                        let Ok((socket, _)) = accepted else { break; };
                        let acceptor = acceptor.clone();
                        let observed = server_observed.clone();
                        handlers.spawn(async move {
                            let _ = tokio::time::timeout(Duration::from_secs(8), serve(socket, acceptor, observed)).await;
                        });
                    }
                    _ = handlers.join_next(), if !handlers.is_empty() => {}
                }
            }
            handlers.abort_all();
            while handlers.join_next().await.is_some() {}
        });
        let relay_dials = Arc::new(AtomicUsize::new(0));
        let dial_count = relay_dials.clone();
        // The browser cannot resolve/reach this .test destination directly.
        // Only this relay route maps its exact authority to the retained socket.
        let dialer: Arc<dyn RouteDialer> = Arc::new(move |authority: Authority| -> DialFuture {
            let count = dial_count.clone();
            Box::pin(async move {
                if authority.host() != HOST || authority.port() != 443 {
                    return Err(std::io::Error::other("fixture route rejected"));
                }
                count.fetch_add(1, Ordering::SeqCst);
                Ok(Box::new(TcpStream::connect(fixture_address).await?) as BoxedStream)
            })
        });
        let session = runtime.block_on(OriginBrowserSession::start(
            OriginBrowserPolicy::new("probe-owner", "probe-connection", "probe-session", ORIGIN)?,
            dialer,
            ProxyLimits::default(),
        ))?;
        let identity = session.policy().identity().clone();
        let endpoint = session.proxy_endpoint();
        let session = Arc::new(Mutex::new(session));
        let temp_root = std::env::temp_dir().canonicalize()?;
        let profile = tempfile::Builder::new()
            .prefix("sorng-real-origin-probe-")
            .tempdir_in(&temp_root)?;
        // Disable TempDir's implicit recursive delete: only the exact validated
        // allocation below may be removed after all native handles are closed.
        let profile_path = owned_profile_path(&profile.keep(), &temp_root)?;
        let mut context = WebContext::new(Some(profile_path.join("profile")));
        let mut events = EventLoopBuilder::<()>::with_user_event().build();
        let window = WindowBuilder::new()
            .with_visible(false)
            .with_inner_size(tao::dpi::LogicalSize::new(1000.0, 700.0))
            .with_title("Local real-origin engineering probe")
            .build(&events)?;
        // Engineering flags, not a production containment contract. Explicitly
        // include the proxy: Wry custom arguments replace its generated flags.
        let args = format!("--proxy-server=http://{endpoint} --proxy-bypass-list=\"<-loopback>\" --disable-quic --disable-background-networking --host-resolver-rules=\"MAP * ~NOTFOUND, EXCLUDE 127.0.0.1\"");
        let webview = WebViewBuilder::new_with_web_context(&mut context)
            .with_additional_browser_args(args)
            .with_devtools(false)
            .with_visible(false)
            .with_bounds(wry::Rect {
                position: wry::dpi::LogicalPosition::new(0.0, 0.0).into(),
                size: wry::dpi::LogicalSize::new(1000.0, 700.0).into(),
            })
            .build_as_child(&window)?;
        let core = unsafe { webview.controller().CoreWebView2()? };
        let core10 = core.cast::<ICoreWebView2_10>()?;
        let core14 = core.cast::<ICoreWebView2_14>()?;
        let core22 = core.cast::<ICoreWebView2_22>()?;
        let failed = Arc::new(AtomicBool::new(false));
        let authentications = Arc::new(AtomicUsize::new(0));
        let certificates = Arc::new(AtomicUsize::new(0));
        let denied = Arc::new(AtomicUsize::new(0));
        let auth_challenges = Arc::new(AtomicUsize::new(0));
        let navigation_error = Arc::new(AtomicI32::new(-1));
        let mut auth_token = 0;
        let mut certificate_token = 0;
        let mut resource_token = 0;
        let mut navigation_token = 0;
        let mut completed_token = 0;
        let mut popup_token = 0;
        let web_messaging_disabled;
        let host_objects_disabled;
        unsafe {
            let settings = core.Settings()?;
            settings.SetAreHostObjectsAllowed(false)?;
            settings.SetIsWebMessageEnabled(false)?;
            let mut enabled = windows::core::BOOL::from(true);
            settings.IsWebMessageEnabled(&mut enabled)?;
            web_messaging_disabled = !enabled.as_bool();
            settings.AreHostObjectsAllowed(&mut enabled)?;
            host_objects_disabled = !enabled.as_bool();
            let auth_session = session.clone();
            let auth_id = identity.clone();
            let auth_count = authentications.clone();
            let challenge_count = auth_challenges.clone();
            let failure = failed.clone();
            core10.add_BasicAuthenticationRequested(
                &BasicAuthenticationRequestedEventHandler::create(Box::new(move |_, args| {
                    let result = (|| {
                        challenge_count.fetch_add(1, Ordering::SeqCst);
                        let args = args.ok_or_else(windows::core::Error::from_win32)?;
                        args.SetCancel(true)?;
                        let mut uri = PWSTR::null();
                        let mut challenge = PWSTR::null();
                        args.Uri(&mut uri)?;
                        let uri = take_string(uri);
                        args.Challenge(&mut challenge)?;
                        let challenge = take_string(challenge);
                        let Some((scheme, params)) = challenge.split_once(' ') else {
                            return Ok(());
                        };
                        let Ok(uri) = url::Url::parse(&uri) else {
                            return Ok(());
                        };
                        let host = uri.host_str().unwrap_or_default();
                        let is_proxy = uri.scheme() == "http"
                            && uri.username().is_empty()
                            && uri.password().is_none()
                            && host == endpoint.ip().to_string()
                            && uri.port_or_known_default() == Some(endpoint.port());
                        let realm = if params.trim() == "realm=\"private-forward-proxy\"" {
                            "private-forward-proxy"
                        } else {
                            ""
                        };
                        let answered = auth_session.lock().unwrap().answer_proxy_challenge(
                            &auth_id,
                            NativeProxyChallenge {
                                is_proxy,
                                host,
                                port: uri.port_or_known_default().unwrap_or(0),
                                scheme,
                                realm,
                            },
                            |user, password| -> windows::core::Result<()> {
                                let response = args.Response()?;
                                response.SetUserName(&HSTRING::from(user))?;
                                response.SetPassword(&HSTRING::from(password))?;
                                args.SetCancel(false)
                            },
                        );
                        if let Some(result) = answered {
                            result?;
                            auth_count.fetch_add(1, Ordering::SeqCst);
                        }
                        Ok(())
                    })();
                    if result.is_err() {
                        failure.store(true, Ordering::SeqCst);
                    }
                    result
                })),
                &mut auth_token,
            )?;
            let certificate_count = certificates.clone();
            let failure = failed.clone();
            core14.add_ServerCertificateErrorDetected(
                &ServerCertificateErrorDetectedEventHandler::create(Box::new(move |_, args| {
                    let result = (|| {
                        let args = args.ok_or_else(windows::core::Error::from_win32)?;
                        args.SetAction(COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_CANCEL)?;
                        let mut uri = PWSTR::null();
                        args.RequestUri(&mut uri)?;
                        let uri = take_string(uri);
                        let mut pem = PWSTR::null();
                        args.ServerCertificate()?.ToPemEncoding(&mut pem)?;
                        let actual = pem_identity(&take_string(pem));
                        if fixture_url(&uri) && actual == pinned_pem {
                            args.SetAction(
                                COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_ALWAYS_ALLOW,
                            )?;
                            certificate_count.fetch_add(1, Ordering::SeqCst);
                        }
                        Ok(())
                    })();
                    if result.is_err() {
                        failure.store(true, Ordering::SeqCst);
                    }
                    result
                })),
                &mut certificate_token,
            )?;
            core22.AddWebResourceRequestedFilterWithRequestSourceKinds(
                &HSTRING::from("*"),
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
            )?;
            let environment = webview.environment();
            let denied_count = denied.clone();
            let failure = failed.clone();
            core.add_WebResourceRequested(
                &WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
                    let result = (|| {
                        let args = args.ok_or_else(windows::core::Error::from_win32)?;
                        let mut uri = PWSTR::null();
                        args.Request()?.Uri(&mut uri)?;
                        if !fixture_url(&take_string(uri)) {
                            denied_count.fetch_add(1, Ordering::SeqCst);
                            args.SetResponse(&environment.CreateWebResourceResponse(
                                None,
                                403,
                                &HSTRING::from("Fixture only"),
                                &HSTRING::from("Content-Length: 0\r\nCache-Control: no-store"),
                            )?)?;
                        }
                        Ok(())
                    })();
                    if result.is_err() {
                        failure.store(true, Ordering::SeqCst);
                    }
                    result
                })),
                &mut resource_token,
            )?;
            core.add_NavigationStarting(
                &NavigationStartingEventHandler::create(Box::new(|_, args| {
                    let args = args.ok_or_else(windows::core::Error::from_win32)?;
                    let mut uri = PWSTR::null();
                    args.Uri(&mut uri)?;
                    let uri = take_string(uri);
                    if uri != "about:blank" && !fixture_url(&uri) {
                        args.SetCancel(true)?;
                    }
                    Ok(())
                })),
                &mut navigation_token,
            )?;
            core.add_NewWindowRequested(
                &NewWindowRequestedEventHandler::create(Box::new(|_, args| {
                    args.ok_or_else(windows::core::Error::from_win32)?
                        .SetHandled(true)
                })),
                &mut popup_token,
            )?;
            let last_error = navigation_error.clone();
            core.add_NavigationCompleted(
                &NavigationCompletedEventHandler::create(Box::new(move |_, args| {
                    let args = args.ok_or_else(windows::core::Error::from_win32)?;
                    let mut status = COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN;
                    args.WebErrorStatus(&mut status)?;
                    last_error.store(status.0, Ordering::SeqCst);
                    Ok(())
                })),
                &mut completed_token,
            )?;
        }
        // Explicit engineering capability: navigate only our retained fixture.
        // Deliberately never call report_host(Ready), even if this probe passes.
        assert_eq!(
            session.lock().unwrap().status(),
            BrowserSessionStatus::NotReady
        );
        webview.load_url(&format!("{ORIGIN}/"))?;
        let started = Instant::now();
        while started.elapsed() < Duration::from_secs(25)
            && observed.lock().unwrap().proof.is_none()
            && !failed.load(Ordering::SeqCst)
        {
            let deadline = Instant::now() + Duration::from_millis(25);
            events.run_return(|_, _, flow| {
                *flow = if Instant::now() >= deadline {
                    ControlFlow::Exit
                } else {
                    ControlFlow::WaitUntil(deadline)
                };
            });
        }
        let state = observed.lock().unwrap();
        let proof = state.proof.clone().unwrap_or(Value::Null);
        let checks = [
            "originalOrigin",
            "topLevel",
            "secureContext",
            "noTauri",
            "localStorage",
            "javascriptCookie",
            "httpOnlyHidden",
            "nativeCookieSent",
            "javascriptCookieSent",
        ];
        let passed = checks.iter().all(|key| proof[*key] == true)
            // Wry 0.55 installs an inert window.ipc shim even without a handler.
            // Report its presence honestly; absence is not our security claim.
            && web_messaging_disabled && host_objects_disabled
            && state.sni_correct > 0
            && state.sni_wrong == 0
            && !state.proxy_header_leaked
            && authentications.load(Ordering::SeqCst) > 0
            && certificates.load(Ordering::SeqCst) > 0
            && relay_dials.load(Ordering::SeqCst) > 0
            && !failed.load(Ordering::SeqCst);
        let mut report = json!({"schemaVersion":1,"layer":"raw-wry-top-level-child-real-https-private-connect",
            "engineeringProbeOnly":true,"productionReady":false,"publicWebsiteNavigationRequested":false,
            "nativeWebMessagingDisabled":web_messaging_disabled,"nativeHostObjectsDisabled":host_objects_disabled,
            "wryIpcHandlerInstalled":false,
            "engineVersion":wry::webview_version().ok(),"elapsedMs":started.elapsed().as_millis() as u64,
            "proxyAuthentications":authentications.load(Ordering::SeqCst),"fixtureCertificatePins":certificates.load(Ordering::SeqCst),
            "proxyChallengeEvents":auth_challenges.load(Ordering::SeqCst),"lastNavigationError":navigation_error.load(Ordering::SeqCst),
            "relayDials":relay_dials.load(Ordering::SeqCst),"fixtureRequests":state.requests,
            "correctSni":state.sni_correct,"incorrectSni":state.sni_wrong,"proxyCredentialsLeaked":state.proxy_header_leaked,
            "resourceBlocks":denied.load(Ordering::SeqCst),"nativeHandlerFailed":failed.load(Ordering::SeqCst),
            "proof":proof,"passed":passed,"containmentAcceptance":"not-proven-by-this-probe"});
        drop(state);
        unsafe {
            let _ = core.Stop();
            core10.remove_BasicAuthenticationRequested(auth_token)?;
            core14.remove_ServerCertificateErrorDetected(certificate_token)?;
            core.remove_WebResourceRequested(resource_token)?;
            core.remove_NavigationStarting(navigation_token)?;
            core.remove_NavigationCompleted(completed_token)?;
            core.remove_NewWindowRequested(popup_token)?;
            core22.RemoveWebResourceRequestedFilterWithRequestSourceKinds(
                &HSTRING::from("*"),
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
            )?;
            webview.controller().Close()?;
        }
        runtime.block_on(session.lock().unwrap().stop())?;
        let _ = stop.send(true);
        runtime.block_on(server)?;
        drop((core22, core14, core10, core, webview, window, context));
        // Retain failed cleanup for diagnosis rather than broad directory deletion.
        let cleanup_started = Instant::now();
        let removed = loop {
            if owned_profile_path(&profile_path, &temp_root).ok().as_ref() != Some(&profile_path) {
                break false;
            }
            if std::fs::remove_dir_all(&profile_path).is_ok() {
                break true;
            }
            if cleanup_started.elapsed() >= Duration::from_secs(5) {
                break false;
            }
            let deadline = Instant::now() + Duration::from_millis(50);
            events.run_return(|_, _, flow| {
                *flow = if Instant::now() >= deadline {
                    ControlFlow::Exit
                } else {
                    ControlFlow::WaitUntil(deadline)
                };
            });
        };
        report["temporaryProfileRemoved"] = json!(removed);
        report["passed"] = json!(passed && removed);
        println!("SORNG_REAL_ORIGIN_RESULT={report}");
        if !passed || !removed {
            return Err("Real-origin local engineering probe failed; see sanitized receipt".into());
        }
        Ok(())
    }
}
