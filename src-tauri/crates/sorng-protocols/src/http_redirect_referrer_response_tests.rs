//! Real same-origin redirects, foreign response receipts and consumed handoffs.
//! Synthetic CONNECT/TLS peers only; no provider or NAS network access.
use super::*;

async fn policy_peer() -> CyclePeer {
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
                let connect = head(&mut tcp).await.unwrap();
                assert!(connect.starts_with("CONNECT example.quickconnect.to:443 ")
                    || connect.starts_with("CONNECT example.fr3.quickconnect.to:443 "));
                tcp.write_all(b"HTTP/1.1 200 Connection established\r\n\r\n")
                    .await
                    .unwrap();
                let mut stream = acceptor.accept(tcp).await.unwrap();
                let request = head(&mut stream).await.unwrap();
                let path = request.split_whitespace().nth(1).unwrap().to_owned();
                captured.lock().unwrap().push(request);
                let (status, extra) = match path.as_str() {
                    "/source-no-referrer" => (200, "Referrer-Policy: no-referrer\r\n".into()),
                    "/go-none" => (307, format!("Location: {REGIONAL}\r\n")),
                    "/go-unknown" => (307, format!("Location: {REGIONAL}\r\nReferrer-Policy: unknown\r\n")),
                    "/go-no-referrer" => (307, format!("Location: {REGIONAL}\r\nReferrer-Policy: no-referrer\r\n")),
                    "/go-same-origin" => (307, format!("Location: {REGIONAL}\r\nReferrer-Policy: same-origin\r\n")),
                    "/go-last-restrictive" => (307, format!("Location: {REGIONAL}\r\nReferrer-Policy: origin, no-referrer, unknown\r\n")),
                    "/go-last-origin" => (307, format!("Location: {REGIONAL}\r\nReferrer-Policy: no-referrer, origin\r\n")),
                    "/go-repeated-header" => (307, format!("Location: {REGIONAL}\r\nReferrer-Policy: origin\r\nReferrer-Policy: same-origin, unknown\r\n")),
                    "/internal" => (302, "Location: /go-unknown\r\nReferrer-Policy: no-referrer\r\n".into()),
                    "/internal-reset" => (302, "Location: /go-last-origin\r\nReferrer-Policy: no-referrer\r\n".into()),
                    "/internal-same-origin" => (302, "Location: /go-none\r\nReferrer-Policy: same-origin\r\n".into()),
                    _ => (200, String::new()),
                };
                let body = "<html><head></head><body>Synthetic page</body></html>";
                let response = format!("HTTP/1.1 {status} Synthetic\r\n{extra}Content-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                let _ = stream.write_all(response.as_bytes()).await;
                let _ = stream.shutdown().await;
            });
        }
    });
    CyclePeer {
        certificate: der,
        peer: Peer {
            proxy_url,
            client: transport,
            requests,
            body_gate: Arc::new(tokio::sync::Semaphore::new(0)),
            task,
        },
    }
}

async fn check_handoff(source_path: &str, redirect_path: &str, suppressed: bool, internal: bool) {
    let peer = policy_peer().await;
    let manager = ProxySessionManager::new();
    let source = open(&peer, manager.clone(), ALIAS, None).await;
    assert_eq!(
        request(&source, source_path, true, "document")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    let destination = reqwest::Url::parse(REGIONAL).unwrap();
    let original_policy =
        source
            .state
            .network
            .document_referrer_origin(1, &destination, &source.state.target_origin);
    assert_eq!(
        original_policy.as_deref(),
        if source_path == "/source-no-referrer" {
            None
        } else {
            Some(ALIAS)
        }
    );
    let response = request(&source, redirect_path, true, "document")
        .header("Referer", ALIAS)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::ACCEPTED);
    let receipt = manager
        .lock()
        .unwrap()
        .review_redirect(&source.state.session_id, None)
        .unwrap();
    assert_eq!(receipt.destination_url, REGIONAL);
    let public_receipt = serde_json::to_string(&receipt).unwrap();
    assert!(!public_receipt.contains("referrer"));
    assert!(!public_receipt.contains("no-referrer"));
    // No destination send before review consumption, no policy mutation of
    // the successful source document, and real last-response diagnostics.
    assert_eq!(
        peer.requests.lock().unwrap().len(),
        if internal { 3 } else { 2 }
    );
    if internal {
        let requests = peer.requests.lock().unwrap();
        let next = requests.last().unwrap().to_ascii_lowercase();
        if redirect_path == "/internal-same-origin" {
            assert!(next.contains(&format!("referer: {ALIAS}\r\n")));
        } else {
            assert!(!next.contains("referer:"));
        }
    }
    assert_eq!(
        source
            .state
            .network
            .document_referrer_origin(1, &destination, &source.state.target_origin,),
        original_policy
    );
    let logs = manager.lock().unwrap().request_log_newest_first();
    let diagnostic = logs[0].diagnostic.as_ref().unwrap();
    assert_eq!(diagnostic.upstream_status, Some(307));
    assert_eq!(diagnostic.same_origin_redirects, Some(u32::from(internal)));
    assert!(!serde_json::to_string(diagnostic)
        .unwrap()
        .contains("referrer"));
    let target = open(&peer, manager.clone(), REGIONAL, Some(&source)).await;
    assert_eq!(
        request(&target, "/", true, "document")
            .header(
                "Referer",
                "http://tauri.localhost/private-app-path?never-send=secret"
            )
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    let requests = peer.requests.lock().unwrap();
    let actual = requests.last().unwrap().to_ascii_lowercase();
    assert!(actual.starts_with("get / http/1.1\r\n"));
    assert!(actual.contains("host: example.fr3.quickconnect.to\r\n"));
    assert!(!actual.contains("private-app-path"));
    assert!(!actual.contains("never-send"));
    if suppressed {
        assert!(
            !actual.contains("referer:"),
            "{source_path} {redirect_path}"
        );
    } else {
        assert!(
            actual.contains(&format!("referer: {ALIAS}\r\n")),
            "{source_path} {redirect_path}"
        );
    }
}

#[tokio::test]
async fn actual_foreign_redirect_policy_controls_only_the_consumed_handoff() {
    for (redirect, suppressed) in [
        ("/go-none", false),
        ("/go-unknown", false),
        ("/go-no-referrer", true),
        ("/go-same-origin", true),
        ("/go-last-restrictive", true),
        ("/go-last-origin", false),
        ("/go-repeated-header", true),
    ] {
        check_handoff("/source", redirect, suppressed, false).await;
    }
}

#[tokio::test]
async fn redirect_policy_cannot_weaken_source_document_suppression() {
    check_handoff("/source-no-referrer", "/go-last-origin", true, false).await;
}

#[tokio::test]
async fn same_origin_redirect_policy_survives_unknown_headers_until_valid_override() {
    check_handoff("/source", "/internal", true, true).await;
    check_handoff("/source", "/internal-reset", false, true).await;
    check_handoff("/source", "/internal-same-origin", true, true).await;
}

#[tokio::test]
async fn actual_http_receipt_rejects_selected_child_policy_substitution() {
    let peer = policy_peer().await;
    let manager = ProxySessionManager::new();
    let source = open(&peer, manager.clone(), ALIAS, None).await;
    for (path, destination, marked) in [
        ("/source-no-referrer", "document", true),
        ("/child", "iframe", false),
    ] {
        assert_eq!(
            request(&source, path, marked, destination)
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::OK
        );
    }
    assert!(source.state.network.document_is_current(1));
    assert_eq!(
        request(&source, "/go-none", true, "document")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::ACCEPTED
    );
    let receipt = manager
        .lock()
        .unwrap()
        .review_redirect(&source.state.session_id, None)
        .unwrap();
    assert_eq!(receipt.document_sequence, 3);
    assert!(source.state.network.activate_document(2).unwrap());
    assert_eq!(source.state.document_sequence.load(Ordering::SeqCst), 3);
    assert!(manager
        .lock()
        .unwrap()
        .review_redirect(&source.state.session_id, Some(&receipt.receipt_id))
        .is_none());
    assert_eq!(peer.requests.lock().unwrap().len(), 3);
}

#[tokio::test]
async fn initial_http_redirect_without_source_html_still_transfers_without_referrer() {
    let peer = policy_peer().await;
    let manager = ProxySessionManager::new();
    let source = open(&peer, manager.clone(), ALIAS, None).await;
    assert_eq!(
        request(&source, "/go-none", true, "document")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::ACCEPTED
    );
    // Initial navigation issuance is not successful source-document evidence.
    assert!(source.state.network.document_is_current(1));
    assert!(source
        .state
        .network
        .selected_referrer_document_sequence()
        .is_none());
    let target = open(&peer, manager, REGIONAL, Some(&source)).await;
    assert_eq!(
        request(&target, "/", true, "document")
            .header(
                "Referer",
                "http://tauri.localhost/private-app-path?never-send=secret"
            )
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    let requests = peer.requests.lock().unwrap();
    assert_eq!(requests.len(), 2);
    let target_request = requests.last().unwrap().to_ascii_lowercase();
    assert!(!target_request.contains("referer:"));
    assert!(!target_request.contains("private-app-path"));
}
