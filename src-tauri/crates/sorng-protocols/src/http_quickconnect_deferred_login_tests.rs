//! Anonymous QuickConnect traversal followed by the real staged credential
//! endpoint. All certificates, credentials and transport peers are synthetic.
use super::*;

const USERNAME: &str = "synthetic-deferred-user";
const PASSWORD: &str = "synthetic-deferred-password";
const DIRECT: &str = "https://example.direct.quickconnect.to:5001/";
const GLOBAL: &str = "https://global.quickconnect.to/";
const DSM: &str = "<!doctype html><html><head><title>Synthetic DSM</title></head><body><div id=\"sds-login-vue-inst\"><div class=\"login-tabs-content-wrapper\"><form id=\"dsm-user-fieldset\"><input syno-id=\"username\" name=\"username\" type=\"text\" autocomplete=\"username\"><input name=\"password\" type=\"password\" autocomplete=\"current-password\" hidden></form><div role=\"button\" syno-id=\"account-panel-next-btn\">Next</div></div></div></body></html>";

#[derive(Clone, Copy)]
enum ProbeReply {
    Valid,
    WrongIdentity,
    NoCors,
    Redirect,
    ServerError,
}

async fn login_peer(reply: ProbeReply) -> CyclePeer {
    login_peer_with_gate(reply, false).await
}

async fn login_peer_with_gate(reply: ProbeReply, hold_primary: bool) -> CyclePeer {
    let certificate = rcgen::generate_simple_self_signed(vec![
        "example.quickconnect.to".into(),
        "example.fr3.quickconnect.to".into(),
        "example.direct.quickconnect.to".into(),
        "global.quickconnect.to".into(),
    ])
    .unwrap();
    let der = certificate.serialize_der().unwrap();
    let tls = rustls::ServerConfig::builder_with_provider(Arc::new(
        rustls::crypto::aws_lc_rs::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .unwrap()
    .with_no_client_auth()
    .with_single_cert(
        vec![rustls::pki_types::CertificateDer::from(der.clone())],
        rustls::pki_types::PrivatePkcs8KeyDer::from(certificate.serialize_private_key_der()).into(),
    )
    .unwrap();
    let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(tls));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let proxy_url = format!("http://{}", listener.local_addr().unwrap());
    let transport = reqwest::Client::builder()
        .no_proxy()
        .proxy(reqwest::Proxy::all(&proxy_url).unwrap())
        .add_root_certificate(reqwest::Certificate::from_der(&der).unwrap())
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap();
    let requests = Arc::new(std::sync::Mutex::new(Vec::new()));
    let captured = requests.clone();
    let body_gate = Arc::new(tokio::sync::Semaphore::new(0));
    let release = body_gate.clone();
    let task = tokio::spawn(async move {
        let mut children = tokio::task::JoinSet::new();
        loop {
            let (mut tcp, _) = listener.accept().await.unwrap();
            let acceptor = acceptor.clone();
            let captured = captured.clone();
            let release = release.clone();
            children.spawn(async move {
                let first = head(&mut tcp).await.unwrap();
                let (mut io, mut wire): (Box<dyn Io>, String) = if first.starts_with("CONNECT ") {
                    assert!([
                        "CONNECT example.quickconnect.to:443 ",
                        "CONNECT example.fr3.quickconnect.to:443 ",
                        "CONNECT example.direct.quickconnect.to:5001 ",
                        "CONNECT global.quickconnect.to:443 ",
                    ].iter().any(|prefix| first.starts_with(prefix)));
                    tcp.write_all(b"HTTP/1.1 200 Connection established\r\n\r\n").await.unwrap();
                    let mut stream = acceptor.accept(tcp).await.unwrap();
                    let wire = head(&mut stream).await.unwrap();
                    (Box::new(stream), wire)
                } else {
                    assert!(first.starts_with("GET http://example.quickconnect.to/"));
                    (Box::new(tcp), first)
                };
                let size: usize = wire.lines().filter_map(|line| line.split_once(':'))
                    .find(|(name, _)| name.eq_ignore_ascii_case("content-length"))
                    .map(|(_, value)| value.trim().parse().unwrap()).unwrap_or(0);
                assert!(size <= 16 * 1024);
                if size > 0 {
                    let mut body = vec![0; size];
                    io.read_exact(&mut body).await.unwrap();
                    wire.push_str(std::str::from_utf8(&body).unwrap());
                }
                let raw = wire.split_whitespace().nth(1).unwrap();
                let url = reqwest::Url::parse(raw).or_else(|_| reqwest::Url::parse(REGIONAL).unwrap().join(raw)).unwrap();
                let mut status = 200;
                let mut headers = String::new();
                let mut mime = "text/html";
                let body = if url.path() == "/webman/pingpong.cgi" {
                    use md5::{Digest, Md5};
                    mime = "application/json";
                    if !matches!(reply, ProbeReply::NoCors) { headers.push_str("Access-Control-Allow-Origin: *\r\n"); }
                    if matches!(reply, ProbeReply::Redirect) {
                        status = 302;
                        headers.push_str("Location: https://example.quickconnect.to/\r\n");
                    }
                    if matches!(reply, ProbeReply::ServerError) { status = 503; }
                    let alias = if matches!(reply, ProbeReply::WrongIdentity) { b"another".as_slice() } else { b"example".as_slice() };
                    json!({"ezid":hex::encode(Md5::digest(alias))}).to_string()
                } else if url.path() == "/Serv.php" {
                    mime = "application/json";
                    "[]".into()
                } else if url.path() == "/dsm"
                    || url.path() == "/webman/index.cgi"
                    || url.path() == "/" && wire.lines().any(|line| {
                        line.to_ascii_lowercase().starts_with("host: example.fr3.quickconnect.to")
                            || line.to_ascii_lowercase().starts_with("host: example.direct.quickconnect.to:")
                    })
                {
                    DSM.into()
                } else if url.path() == "/connector" {
                    CONNECTOR.into()
                } else {
                    "<html><head></head><body>Synthetic provider portal</body></html>".into()
                };
                let hold = hold_primary && url.path() == "/" && wire.lines().any(|line| {
                    line.to_ascii_lowercase().starts_with("host: example.fr3.quickconnect.to")
                });
                captured.lock().unwrap().push(wire);
                let response = format!("HTTP/1.1 {status} Synthetic\r\n{headers}Content-Type: {mime}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                let _ = io.write_all(response.as_bytes()).await;
                let _ = io.flush().await;
                if hold {
                    let Ok(permit) = release.acquire().await else { return };
                    permit.forget();
                }
                let _ = io.write_all(body.as_bytes()).await;
                let _ = io.shutdown().await;
            });
        }
    });
    CyclePeer {
        certificate: der,
        peer: Peer {
            proxy_url,
            client: transport,
            requests,
            body_gate,
            task,
        },
    }
}

async fn login_proxy(
    peer: &CyclePeer,
    manager: ProxySessionManagerState,
    target: &str,
    previous: Option<&FixtureProxy>,
    opted_in: bool,
) -> FixtureProxy {
    let id = uuid::Uuid::new_v4().to_string();
    let mut config = config(peer, target);
    let session = {
        let mut manager = manager.lock().unwrap();
        if let Some(previous) = previous {
            let pending = manager
                .review_redirect(&previous.state.session_id, None)
                .unwrap();
            assert_eq!(pending.destination_url, target);
            let consumed = manager
                .review_redirect(&previous.state.session_id, Some(&pending.receipt_id))
                .unwrap();
            let ticket = consumed.continuation_id.unwrap();
            manager
                .attempts
                .stop(previous.state.attempt.as_ref().unwrap(), Some(&ticket))
                .unwrap();
            config.continuation_id = Some(ticket);
        } else if opted_in {
            config.username = USERNAME.into();
            config.password = PASSWORD.into();
            config.upstream_auth_mode = UpstreamAuthMode::SynologyForm;
            config.http_auto_login = true;
        }
        manager
            .attempts
            .start(&config, &reqwest::Url::parse(target).unwrap(), &id)
            .unwrap()
            .unwrap()
    };
    session.strip_deferred_login_config(&mut config);
    assert!(config.username.is_empty() && config.password.is_empty());
    assert!(!config.http_auto_login);
    assert_eq!(config.upstream_auth_mode, UpstreamAuthMode::None);
    let template = proxy(target.into(), peer.client.clone()).await;
    let mut state = (*template.state).clone();
    state.attempt = Some(session);
    state.session_id = id.clone();
    state.connection_id = config.connection_id.clone();
    state.proxy_policy = config.proxy_policy.clone().unwrap();
    state.redirect_profile = config.redirect_profile;
    state.global_sessions = manager;
    state.client = reqwest::Client::builder()
        .no_proxy()
        .proxy(reqwest::Proxy::all(&peer.proxy_url).unwrap())
        .add_root_certificate(reqwest::Certificate::from_der(&peer.certificate).unwrap())
        .cookie_provider(state.attempt.as_ref().unwrap().cookie_store())
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap();
    let mut network = ProxyNetworkState::default();
    network.quickconnect_control = Some(
        quickconnect_control::ReviewedQuickConnectControl::fixture(peer.client.clone()),
    );
    state.network = Arc::new(network);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    state.proxy_authority = format!("p{TOKEN}.localhost:{port}");
    state.proxy_origin = format!("http://{}", state.proxy_authority);
    let state = Arc::new(state);
    drop(template);
    state.global_sessions.lock().unwrap().sessions.insert(
        id,
        ProxySessionEntry {
            runtime: Default::default(),
            attempt: state.attempt.clone(),
            network: state.network.clone(),
            website_dark_mode: state.website_dark_mode.clone(),
            target_url: target.into(),
            username: String::new(),
            password: String::new(),
            upstream_auth_mode: UpstreamAuthMode::None,
            proxy_policy: state.proxy_policy.clone(),
            redirect_profile: state.redirect_profile,
            custom_headers: HashMap::new(),
            upstream_proxy_url: Some(peer.proxy_url.clone()),
            target_origin: state.target_origin.clone(),
            connection_id: state.connection_id.clone(),
            created_at: String::new(),
            local_port: port,
            min_tls_version: config.min_tls_version,
            verify_ssl: config.verify_ssl,
            accepted_cert_fingerprint: None,
            require_ca_verification: false,
            request_count: state.request_count.clone(),
            error_count: state.error_count.clone(),
            last_error: state.last_error.clone(),
            shutdown_tx: None,
        },
    );
    let router = axum::Router::new()
        .route(AUTOLOGIN_PATH, axum::routing::get(autologin_cred_handler))
        .fallback(axum_proxy_handler)
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            enforce_proxy_access,
        ))
        .with_state(state.clone());
    let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    FixtureProxy {
        base: format!("http://127.0.0.1:{port}"),
        state,
        task,
    }
}

fn nonce(html: &str) -> Option<String> {
    let start = html.find("var NONCE=\"")? + "var NONCE=\"".len();
    let value = html[start..].split('"').next()?;
    (value.len() == 32 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .then(|| value.to_owned())
}

async fn page(proxy: &FixtureProxy, path: &str, marked: bool, destination: &str) -> String {
    let response = request(proxy, path, marked, destination)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let html = response.text().await.unwrap();
    assert!(!html.contains(USERNAME) && !html.contains(PASSWORD));
    html
}

async fn probe(proxy: &FixtureProxy, target: &str) -> reqwest::Response {
    client()
        .get(format!(
            "{}{}",
            proxy.base,
            quickconnect_control::DISCOVERED_PATH
        ))
        .query(&[(
            "destination",
            format!("{target}webman/pingpong.cgi?action=cors&quickconnect=true"),
        )])
        .header("Host", &proxy.state.proxy_authority)
        .header("Sec-Fetch-Dest", "empty")
        .header("Sec-Fetch-Mode", "cors")
        .header("Sec-Fetch-Site", "same-origin")
        .header("Referer", format!("{}/", proxy.state.proxy_origin))
        .header(
            quickconnect_control::DOCUMENT_HEADER,
            proxy
                .state
                .network
                .selected_document_sequence()
                .unwrap()
                .to_string(),
        )
        .send()
        .await
        .unwrap()
}

async fn grant(proxy: &FixtureProxy, token: &str, password: bool) -> reqwest::Response {
    let mut request = client()
        .get(format!("{}{AUTOLOGIN_PATH}", proxy.base))
        .query(&[("nonce", token)])
        .header("Host", &proxy.state.proxy_authority)
        .header("Sec-Fetch-Dest", "empty")
        .header("Sec-Fetch-Mode", "cors")
        .header("Sec-Fetch-Site", "same-origin");
    if password {
        request = request.query(&[("phase", "password")]);
    }
    request.send().await.unwrap()
}

fn assert_no_transport_or_manager_credentials(peer: &CyclePeer, proxy: &FixtureProxy) {
    for wire in peer.requests.lock().unwrap().iter() {
        assert!(!wire.contains(USERNAME) && !wire.contains(PASSWORD));
        assert!(!wire.to_ascii_lowercase().contains("\r\nauthorization:"));
    }
    assert!(proxy.state.username.read().unwrap().is_empty());
    assert!(proxy.state.password.read().unwrap().is_empty());
    assert_eq!(proxy.state.upstream_auth_mode, UpstreamAuthMode::None);
    let manager = proxy.state.global_sessions.lock().unwrap();
    for entry in manager.sessions.values() {
        assert!(entry.username.is_empty() && entry.password.is_empty());
    }
    for entry in manager.request_log_newest_first() {
        let serialized = serde_json::to_string(&entry).unwrap();
        assert!(!serialized.contains(USERNAME) && !serialized.contains(PASSWORD));
    }
}

async fn discovery(proxy: &FixtureProxy) {
    let body: Vec<_> = ["mainapp_https", "mainapp_http"]
        .into_iter()
        .map(|id| {
            json!({
                "version":1,"command":"get_server_info","stop_when_error":false,
                "stop_when_success":false,"id":id,"serverID":"example","is_gofile":false,"path":""
            })
        })
        .collect();
    let response = client()
        .post(format!("{}{}", proxy.base, quickconnect_control::PATH))
        .header("Host", &proxy.state.proxy_authority)
        .header("Origin", &proxy.state.proxy_origin)
        .header("Referer", format!("{}/", proxy.state.proxy_origin))
        .header("Content-Type", "application/json")
        .header(
            quickconnect_control::DOCUMENT_HEADER,
            proxy
                .state
                .network
                .selected_document_sequence()
                .unwrap()
                .to_string(),
        )
        .body(serde_json::to_vec(&body).unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.text().await.unwrap(), "[]");
}

#[tokio::test]
async fn verified_same_nas_handoff_preserves_anonymous_transport_and_dispenses_stages_once() {
    for destination in [REGIONAL, DIRECT] {
        let peer = login_peer(ProbeReply::Valid).await;
        let manager = ProxySessionManager::new();
        let source = login_proxy(&peer, manager.clone(), ALIAS, None, true).await;
        assert!(nonce(&page(&source, "/", true, "document").await).is_none());
        assert_eq!(
            grant(&source, TOKEN, false).await.status(),
            StatusCode::FORBIDDEN
        );
        discovery(&source).await;
        vendor(&source, GLOBAL).await;
        let portal = login_proxy(&peer, manager.clone(), GLOBAL, Some(&source), false).await;
        assert!(nonce(&page(&portal, "/", true, "document").await).is_none());
        assert_eq!(probe(&portal, destination).await.status(), StatusCode::OK);
        assert_eq!(
            grant(&portal, TOKEN, false).await.status(),
            StatusCode::FORBIDDEN
        );
        vendor(&portal, destination).await;
        let final_proxy =
            login_proxy(&peer, manager.clone(), destination, Some(&portal), false).await;
        let html = page(&final_proxy, "/", true, "document").await;
        let token =
            nonce(&html).expect("verified primary DSM landing must have a staged bootstrap");
        assert!(html.contains("__sorng_synology_login"));
        assert!(html.contains("fetchCredsAndRun(NONCE,SEL, 'synology')"));
        // A later child response neither rebinds nor invalidates the selected
        // parent's deferred grant. The native selected document remains 1.
        assert!(nonce(&page(&final_proxy, "/dsm", false, "iframe").await).is_none());
        assert_eq!(
            final_proxy.state.network.selected_document_sequence(),
            Some(1)
        );
        let account = grant(&final_proxy, &token, false).await;
        assert_eq!(account.status(), StatusCode::OK);
        assert_eq!(account.headers()["cache-control"], "no-store");
        assert!(!account
            .headers()
            .contains_key("access-control-allow-origin"));
        let account: serde_json::Value = account.json().await.unwrap();
        assert_eq!(account["loginFlow"], "synology");
        assert_eq!(account["username"], USERNAME);
        assert!(account.get("password").is_none());
        let next = account["continuation"].as_str().unwrap();
        assert_eq!(
            grant(&final_proxy, &token, false).await.status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            grant(&final_proxy, "invalid-token", true).await.status(),
            StatusCode::FORBIDDEN
        );
        let secret = grant(&final_proxy, next, true).await;
        assert_eq!(secret.status(), StatusCode::OK);
        assert_eq!(secret.headers()["cache-control"], "no-store");
        let secret: serde_json::Value = secret.json().await.unwrap();
        assert_eq!(secret["loginFlow"], "synology");
        assert_eq!(secret["password"], PASSWORD);
        assert_eq!(
            grant(&final_proxy, next, true).await.status(),
            StatusCode::FORBIDDEN
        );
        assert_no_transport_or_manager_credentials(&peer, &final_proxy);

        vendor(&final_proxy, ALIAS).await;
        let returning = login_proxy(&peer, manager.clone(), ALIAS, Some(&final_proxy), false).await;
        assert!(nonce(&page(&returning, "/", true, "document").await).is_none());
        assert_eq!(
            probe(&returning, destination).await.status(),
            StatusCode::OK
        );
        vendor(&returning, destination).await;
        let again = login_proxy(&peer, manager, destination, Some(&returning), false).await;
        assert!(nonce(&page(&again, "/", true, "document").await).is_none());
        assert_eq!(
            grant(&again, &token, false).await.status(),
            StatusCode::FORBIDDEN
        );
        assert_no_transport_or_manager_credentials(&peer, &again);
    }
}

#[tokio::test]
async fn failed_or_missing_probe_never_arms_deferred_credentials() {
    for reply in [
        None,
        Some(ProbeReply::WrongIdentity),
        Some(ProbeReply::NoCors),
        Some(ProbeReply::Redirect),
        Some(ProbeReply::ServerError),
    ] {
        let peer = login_peer(reply.unwrap_or(ProbeReply::Valid)).await;
        let manager = ProxySessionManager::new();
        let source = login_proxy(&peer, manager.clone(), ALIAS, None, true).await;
        page(&source, "/", true, "document").await;
        if reply.is_some() {
            assert!(!probe(&source, REGIONAL).await.status().is_success());
        }
        vendor(&source, REGIONAL).await;
        let target = login_proxy(&peer, manager, REGIONAL, Some(&source), false).await;
        assert!(nonce(&page(&target, "/", true, "document").await).is_none());
        assert_eq!(
            grant(&target, TOKEN, false).await.status(),
            StatusCode::FORBIDDEN
        );
        assert_no_transport_or_manager_credentials(&peer, &target);
    }
}

#[tokio::test]
async fn portal_http_nonprimary_connector_and_manual_pages_do_not_activate_deferred_login() {
    let peer = login_peer(ProbeReply::Valid).await;
    let manager = ProxySessionManager::new();
    let source = login_proxy(&peer, manager.clone(), ALIAS, None, true).await;
    // A provider alias cannot activate even when its initial successful page
    // deliberately contains the reviewed DSM markup at a supported DSM path.
    assert!(nonce(&page(&source, "/webman/index.cgi", true, "document").await).is_none());
    assert_eq!(
        grant(&source, TOKEN, false).await.status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(probe(&source, REGIONAL).await.status(), StatusCode::OK);
    // Even DSM-like markup cannot make a provider alias a NAS origin.
    assert!(nonce(&page(&source, "/webman/index.cgi", false, "iframe").await).is_none());
    vendor(&source, PLAIN_ALIAS).await;
    let plain = login_proxy(&peer, manager.clone(), PLAIN_ALIAS, Some(&source), false).await;
    assert!(nonce(&page(&plain, "/webman/index.cgi", true, "document").await).is_none());
    vendor(&plain, REGIONAL).await;
    let target = login_proxy(&peer, manager, REGIONAL, Some(&plain), false).await;
    assert!(nonce(&page(&target, "/webman/index.cgi", false, "iframe").await).is_none());
    assert!(nonce(&page(&target, "/", true, "empty").await).is_none());
    assert!(nonce(&page(&target, "/connector", true, "document").await).is_none());
    assert_eq!(
        grant(&target, TOKEN, false).await.status(),
        StatusCode::FORBIDDEN
    );
    assert_no_transport_or_manager_credentials(&peer, &target);

    let manager = ProxySessionManager::new();
    let manual = login_proxy(&peer, manager.clone(), ALIAS, None, false).await;
    page(&manual, "/", true, "document").await;
    assert_eq!(probe(&manual, REGIONAL).await.status(), StatusCode::OK);
    vendor(&manual, REGIONAL).await;
    let manual_target = login_proxy(&peer, manager, REGIONAL, Some(&manual), false).await;
    assert!(nonce(&page(&manual_target, "/", true, "document").await).is_none());
    assert_eq!(
        grant(&manual_target, TOKEN, false).await.status(),
        StatusCode::FORBIDDEN
    );
    assert_no_transport_or_manager_credentials(&peer, &manual_target);
}

#[tokio::test]
async fn selected_document_change_or_session_end_revokes_pending_deferred_password() {
    for stop in [false, true] {
        let peer = login_peer(ProbeReply::Valid).await;
        let manager = ProxySessionManager::new();
        let source = login_proxy(&peer, manager.clone(), ALIAS, None, true).await;
        page(&source, "/", true, "document").await;
        assert_eq!(probe(&source, REGIONAL).await.status(), StatusCode::OK);
        vendor(&source, REGIONAL).await;
        let target = login_proxy(&peer, manager.clone(), REGIONAL, Some(&source), false).await;
        let token = nonce(&page(&target, "/", true, "document").await).unwrap();
        let account = grant(&target, &token, false).await;
        assert_eq!(account.status(), StatusCode::OK);
        let account: serde_json::Value = account.json().await.unwrap();
        let continuation = account["continuation"].as_str().unwrap();
        if stop {
            manager
                .lock()
                .unwrap()
                .attempts
                .stop(target.state.attempt.as_ref().unwrap(), None)
                .unwrap();
        } else {
            page(&target, "/dsm", false, "iframe").await;
            let replacement = target.state.document_sequence.load(Ordering::SeqCst);
            target.state.network.activate_document(replacement).unwrap();
        }
        let password = grant(&target, continuation, true).await;
        assert!(!password.status().is_success());
        let body = password.text().await.unwrap();
        assert!(!body.contains(USERNAME) && !body.contains(PASSWORD));
        assert_no_transport_or_manager_credentials(&peer, &target);
    }
}

#[tokio::test]
async fn primary_html_still_binds_after_an_intervening_child_advances_global_sequence() {
    let peer = login_peer_with_gate(ProbeReply::Valid, true).await;
    let manager = ProxySessionManager::new();
    let source = login_proxy(&peer, manager.clone(), ALIAS, None, true).await;
    page(&source, "/", true, "document").await;
    assert_eq!(probe(&source, REGIONAL).await.status(), StatusCode::OK);
    vendor(&source, REGIONAL).await;
    let target = login_proxy(&peer, manager, REGIONAL, Some(&source), false).await;
    let primary = tokio::spawn(request(&target, "/", true, "document").send());
    wait_for_header_log(&target).await;
    assert!(nonce(&page(&target, "/dsm", false, "iframe").await).is_none());
    assert_eq!(target.state.document_sequence.load(Ordering::SeqCst), 2);
    assert_eq!(target.state.network.selected_document_sequence(), Some(1));
    peer.body_gate.add_permits(1);
    let response = primary.await.unwrap().unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let html = response.text().await.unwrap();
    assert!(!html.contains(USERNAME) && !html.contains(PASSWORD));
    let token = nonce(&html).expect("selected primary must bind despite child issuance");
    let account = grant(&target, &token, false).await;
    assert_eq!(account.status(), StatusCode::OK);
    let account: serde_json::Value = account.json().await.unwrap();
    assert_eq!(account["username"], USERNAME);
    assert!(account.get("password").is_none());
    let password = grant(&target, account["continuation"].as_str().unwrap(), true).await;
    assert_eq!(password.status(), StatusCode::OK);
    assert_eq!(
        password.json::<serde_json::Value>().await.unwrap()["password"],
        PASSWORD
    );
    assert_no_transport_or_manager_credentials(&peer, &target);
}

async fn verified_nas_proxy(peer: &CyclePeer, manager: ProxySessionManagerState) -> FixtureProxy {
    let source = login_proxy(peer, manager.clone(), ALIAS, None, true).await;
    page(&source, "/", true, "document").await;
    assert_eq!(probe(&source, REGIONAL).await.status(), StatusCode::OK);
    vendor(&source, REGIONAL).await;
    login_proxy(peer, manager, REGIONAL, Some(&source), false).await
}

#[tokio::test]
async fn account_phase_markerless_successor_rebinds_and_old_page_nonce_dies() {
    let peer = login_peer(ProbeReply::Valid).await;
    let target = verified_nas_proxy(&peer, ProxySessionManager::new()).await;
    let attempt = target.state.attempt.clone().unwrap();
    let first = nonce(&page(&target, "/", true, "document").await).unwrap();
    // DSM reloads or redirects without the app marker before any credential
    // is released. The successor is a candidate, never a selected grant.
    let second = nonce(&page(&target, "/webman/index.cgi", false, "document").await)
        .expect("an Account-phase DSM successor must keep a staged bootstrap");
    assert_ne!(first, second);
    assert_eq!(
        grant(&target, &second, false).await.status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        attempt.deferred_login_status(),
        Some(DeferredSynologyLoginStatus::WaitingForForm)
    );
    assert_eq!(target.state.network.activate_document(2), Ok(true));
    // The old page can never be selected again, so its nonce is dead. A stale
    // old-page request does not cancel the successor's readiness.
    assert_eq!(
        grant(&target, &first, false).await.status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        attempt.deferred_login_status(),
        Some(DeferredSynologyLoginStatus::WaitingForForm)
    );
    let account = grant(&target, &second, false).await;
    assert_eq!(account.status(), StatusCode::OK);
    let account: serde_json::Value = account.json().await.unwrap();
    assert_eq!(account["username"], USERNAME);
    assert!(account.get("password").is_none());
    let secret = grant(&target, account["continuation"].as_str().unwrap(), true).await;
    assert_eq!(secret.status(), StatusCode::OK);
    assert_eq!(
        secret.json::<serde_json::Value>().await.unwrap()["password"],
        PASSWORD
    );
    assert_no_transport_or_manager_credentials(&peer, &target);
}

#[tokio::test]
async fn released_username_never_rebinds_a_successor_and_selection_change_cancels() {
    let peer = login_peer(ProbeReply::Valid).await;
    let target = verified_nas_proxy(&peer, ProxySessionManager::new()).await;
    let attempt = target.state.attempt.clone().unwrap();
    let first = nonce(&page(&target, "/", true, "document").await).unwrap();
    let account = grant(&target, &first, false).await;
    assert_eq!(account.status(), StatusCode::OK);
    let account: serde_json::Value = account.json().await.unwrap();
    let continuation = account["continuation"].as_str().unwrap();
    assert!(nonce(&page(&target, "/webman/index.cgi", false, "document").await).is_none());
    assert_eq!(
        attempt.deferred_login_status(),
        Some(DeferredSynologyLoginStatus::WaitingForPassword)
    );
    assert_eq!(target.state.network.activate_document(2), Ok(true));
    let password = grant(&target, continuation, true).await;
    assert_eq!(password.status(), StatusCode::FORBIDDEN);
    let body = password.text().await.unwrap();
    assert!(!body.contains(USERNAME) && !body.contains(PASSWORD));
    assert_eq!(
        attempt.deferred_login_status(),
        Some(DeferredSynologyLoginStatus::Cancelled)
    );
    assert_no_transport_or_manager_credentials(&peer, &target);
}
