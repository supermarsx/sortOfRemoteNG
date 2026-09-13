//! Real protected handler, native receipt consumption and local CONNECT/TLS.
//! No browser/provider/NAS requests; the provider pages are synthetic HTML.
use super::*;
use tokio::io::AsyncWrite;

const PLAIN_ALIAS: &str = "http://example.quickconnect.to/";
trait Io: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> Io for T {}

async fn cycle_peer(http_upgrade: bool) -> Peer {
    let certificate = rcgen::generate_simple_self_signed(vec![
        "example.quickconnect.to".into(),
        "example.fr3.quickconnect.to".into(),
    ])
    .unwrap();
    let der = certificate.serialize_der().unwrap();
    let config = rustls::ServerConfig::builder_with_provider(Arc::new(
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
    let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(config));
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
    let task = tokio::spawn(async move {
        let mut children = tokio::task::JoinSet::new();
        loop {
            let (mut tcp, _) = listener.accept().await.unwrap();
            let acceptor = acceptor.clone();
            let captured = captured.clone();
            children.spawn(async move {
                let first = head(&mut tcp).await.unwrap();
                let (mut io, request, regional, plain): (Box<dyn Io>, String, bool, bool) = if first.starts_with("CONNECT ") {
                    assert!(first.starts_with("CONNECT example.quickconnect.to:443 ") || first.starts_with("CONNECT example.fr3.quickconnect.to:443 "));
                    let regional = first.starts_with("CONNECT example.fr3.");
                    tcp.write_all(b"HTTP/1.1 200 Connection established\r\n\r\n").await.unwrap();
                    let mut tls = acceptor.accept(tcp).await.unwrap();
                    let request = head(&mut tls).await.unwrap();
                    (Box::new(tls), request, regional, false)
                } else {
                    assert!(first.starts_with("GET http://example.quickconnect.to/"));
                    (Box::new(tcp), first, false, true)
                };
                let raw = request.split_whitespace().nth(1).unwrap();
                let parsed = reqwest::Url::parse(raw).or_else(|_| reqwest::Url::parse(REGIONAL).unwrap().join(raw)).unwrap();
                let path = parsed.path();
                captured.lock().unwrap().push(request.clone());
                let mut status = 200;
                let mut extra = String::new();
                let mut body = "<html><head></head><body>Synthetic provider page</body></html>".to_string();
                if path == "/webman/pingpong.cgi" {
                    use md5::{Digest, Md5};
                    body = json!({"ezid":hex::encode(Md5::digest(b"example"))}).to_string();
                    extra = "Access-Control-Allow-Origin: *\r\n".into();
                } else if regional && path == "/auth-start" {
                    status = 307;
                    extra = "Location: /webman/login.cgi\r\n".into();
                } else if regional && path == "/webman/login.cgi" {
                    status = 303;
                    extra = format!("Location: {PLAIN_ALIAS}?private-token=never-copy#private-fragment\r\n");
                } else if regional && path == "/" {
                    status = 302;
                    extra = format!("Location: {PLAIN_ALIAS}\r\n");
                } else if plain && http_upgrade && path == "/" {
                    status = 308;
                    extra = format!("Location: {ALIAS}\r\n");
                }
                let mime = if path == "/webman/pingpong.cgi" { "application/json" } else { "text/html" };
                let response = format!("HTTP/1.1 {status} Synthetic\r\n{extra}Content-Type: {mime}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                let _ = io.write_all(response.as_bytes()).await;
                let _ = io.shutdown().await;
            });
        }
    });
    Peer {
        proxy_url,
        client: transport,
        requests,
        body_gate: Arc::new(tokio::sync::Semaphore::new(0)),
        task,
    }
}

async fn open(
    peer: &Peer,
    manager: ProxySessionManagerState,
    target: &str,
    previous: Option<&FixtureProxy>,
) -> FixtureProxy {
    let id = uuid::Uuid::new_v4().to_string();
    let mut config = config(peer, target);
    let session = {
        let mut manager = manager.lock().unwrap();
        if let Some(previous) = previous {
            let receipt = manager
                .review_redirect(&previous.state.session_id, None)
                .expect("native receipt");
            assert_eq!(receipt.destination_url, target);
            let review = manager
                .review_redirect(&previous.state.session_id, Some(&receipt.receipt_id))
                .expect("consumed native receipt");
            assert!(manager
                .review_redirect(&previous.state.session_id, Some(&receipt.receipt_id))
                .is_none());
            let ticket = review.continuation_id.expect("native one-use continuation");
            manager
                .attempts
                .stop(previous.state.attempt.as_ref().unwrap(), Some(&ticket))
                .unwrap();
            config.continuation_id = Some(ticket);
        }
        manager
            .attempts
            .start(&config, &reqwest::Url::parse(target).unwrap(), &id)
            .unwrap()
            .unwrap()
    };
    let template = attempt_proxy(peer, target, &id, session).await;
    let mut state = (*template.state).clone();
    state.global_sessions = manager;
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
            attempt: state.attempt.clone(),
            network: state.network.clone(),
            target_url: target.into(),
            username: String::new(),
            password: String::new(),
            upstream_auth_mode: state.upstream_auth_mode,
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

async fn vendor(proxy: &FixtureProxy, target: &str) {
    let response = client()
        .get(format!("{}{}", proxy.base, quickconnect::PATH))
        .query(&[("destination", target)])
        .header("Host", &proxy.state.proxy_authority)
        .header("Sec-Fetch-Dest", "iframe")
        .header("Sec-Fetch-Mode", "navigate")
        .header("Sec-Fetch-Site", "same-origin")
        .header(
            "Referer",
            format!(
                "{}/?__sorng_navigation_v1={TOKEN}",
                proxy.state.proxy_origin
            ),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::ACCEPTED);
}

async fn return_via_aliases(
    peer: &Peer,
    manager: ProxySessionManagerState,
    regional: &FixtureProxy,
    http_upgrade: bool,
    alias_path: &str,
) -> FixtureProxy {
    let plain = open(peer, manager.clone(), PLAIN_ALIAS, Some(regional)).await;
    let response = request(&plain, alias_path, true, "document")
        .send()
        .await
        .unwrap();
    assert_eq!(
        response.status(),
        if http_upgrade {
            StatusCode::ACCEPTED
        } else {
            StatusCode::OK
        }
    );
    if http_upgrade {
        let logs = manager.lock().unwrap().request_log_newest_first();
        assert_eq!(
            logs[0].diagnostic.as_ref().unwrap().upstream_status,
            Some(308)
        );
    } else {
        vendor(&plain, ALIAS).await;
    }
    let secure = open(peer, manager.clone(), ALIAS, Some(&plain)).await;
    assert_eq!(
        request(&secure, "/", true, "document")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    // The user's successful relay candidate must not erase/advance document cycles.
    let probe = client()
        .get(format!(
            "{}{}",
            secure.base,
            quickconnect_control::DISCOVERED_PATH
        ))
        .query(&[(
            "destination",
            format!("{REGIONAL}webman/pingpong.cgi?action=cors&quickconnect=true"),
        )])
        .header("Host", &secure.state.proxy_authority)
        .header("Sec-Fetch-Dest", "empty")
        .header("Sec-Fetch-Mode", "cors")
        .header("Sec-Fetch-Site", "same-origin")
        .header(quickconnect_control::DOCUMENT_HEADER, "1")
        .send()
        .await
        .unwrap();
    assert_eq!(probe.status(), StatusCode::OK);
    vendor(&secure, REGIONAL).await;
    open(peer, manager, REGIONAL, Some(&secure)).await
}

#[tokio::test]
async fn actual_mixed_vendor_http_circuit_allows_one_retry_then_stops_without_next_receipt() {
    for http_upgrade in [false, true] {
        let peer = cycle_peer(http_upgrade).await;
        let manager = ProxySessionManager::new();
        let mut regional = open(&peer, manager.clone(), REGIONAL, None).await;
        let attempt_id = regional
            .state
            .attempt
            .as_ref()
            .unwrap()
            .diagnostic()
            .unwrap()
            .0;
        for circuit in 0..3 {
            let response = request(&regional, "/", true, "document")
                .header("Cookie", "consent=stable-provider-choice")
                .send()
                .await
                .unwrap();
            assert_eq!(
                response.status(),
                if circuit == 2 {
                    StatusCode::LOOP_DETECTED
                } else {
                    StatusCode::ACCEPTED
                }
            );
            let logs = manager.lock().unwrap().request_log_newest_first();
            let diagnostic = logs[0].diagnostic.as_ref().unwrap();
            assert_eq!(diagnostic.upstream_status, Some(302));
            assert_eq!(diagnostic.same_origin_redirects, Some(0));
            assert_eq!(
                diagnostic.redirect_target_origin.as_deref(),
                Some(PLAIN_ALIAS.trim_end_matches('/'))
            );
            assert_eq!(diagnostic.redirect_query_removed, Some(false));
            assert_eq!(diagnostic.attempt_id.as_deref(), Some(attempt_id.as_str()));
            if circuit == 2 {
                assert_eq!(diagnostic.code, "quickconnect_redirect_loop");
                assert_eq!(diagnostic.hop, Some(6));
                assert!(manager
                    .lock()
                    .unwrap()
                    .review_redirect(&regional.state.session_id, None)
                    .is_none());
                assert_eq!(regional.state.error_count.load(Ordering::SeqCst), 1);
                assert!(response.text().await.unwrap().contains("redirect_loop"));
            } else {
                assert_eq!(diagnostic.outcome, "continuing");
                assert_eq!(regional.state.error_count.load(Ordering::SeqCst), 0);
                regional =
                    return_via_aliases(&peer, manager.clone(), &regional, http_upgrade, "/").await;
            }
        }
        assert_eq!(peer.requests.lock().unwrap().len(), 9);
    }
}

#[tokio::test]
async fn changing_cookie_state_or_nonroot_vendor_page_does_not_trigger_exact_root_cycle() {
    for nonroot in [false, true] {
        let peer = cycle_peer(false).await;
        let manager = ProxySessionManager::new();
        let mut regional = open(&peer, manager.clone(), REGIONAL, None).await;
        for circuit in 0..3 {
            let cookie = if nonroot {
                "consent=stable".into()
            } else {
                format!("session=progress-{circuit}")
            };
            let response = request(&regional, "/", true, "document")
                .header("Cookie", cookie)
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::ACCEPTED);
            if circuit < 2 {
                regional = return_via_aliases(
                    &peer,
                    manager.clone(),
                    &regional,
                    false,
                    if nonroot { "/account" } else { "/" },
                )
                .await;
            }
        }
        assert!(manager
            .lock()
            .unwrap()
            .request_log
            .iter()
            .all(|entry| entry.status != 508));
    }
}

#[tokio::test]
async fn upstream_auth_detour_metadata_keeps_real_source_status_and_redacts_target_query() {
    let peer = cycle_peer(false).await;
    let manager = ProxySessionManager::new();
    let regional = open(&peer, manager.clone(), REGIONAL, None).await;
    let response = request(&regional, "/auth-start", true, "document")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::ACCEPTED);
    let logs = manager.lock().unwrap().request_log_newest_first();
    let diagnostic = logs[0].diagnostic.as_ref().unwrap();
    assert_eq!(diagnostic.upstream_status, Some(303));
    assert_eq!(diagnostic.same_origin_redirects, Some(1));
    let value = serde_json::to_value(diagnostic).unwrap();
    assert_eq!(value["redirectSourcePath"], "dsm");
    assert_eq!(value["redirectTargetPath"], "root");
    assert_eq!(value["redirectQueryRemoved"], true);
    let text = value.to_string();
    for forbidden in [
        "private-token",
        "private-fragment",
        "login.cgi",
        "auth-start",
    ] {
        assert!(!text.contains(forbidden));
    }
    let receipt = manager
        .lock()
        .unwrap()
        .review_redirect(&regional.state.session_id, None)
        .unwrap();
    assert_eq!(receipt.destination_url, PLAIN_ALIAS);
    assert!(receipt.removed_query);
    assert_eq!(peer.requests.lock().unwrap().len(), 2);
}
