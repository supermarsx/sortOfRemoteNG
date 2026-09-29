//! Same-session Tactical secondary documents use only their active root's
//! network lifetime. Every upstream connection terminates on a local fixture.
use super::*;

const SOURCE: &str = "https://rmm.example.test";
const API: &str = "https://api.rmm.example.test";
const MARKER: &str = "__sorng_popup_parent_v1";

struct Peer {
    transport: reqwest::Client,
    seen: Arc<std::sync::Mutex<Vec<String>>>,
    body_started: Arc<tokio::sync::Semaphore>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Peer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn peer() -> Peer {
    let cert = rcgen::generate_simple_self_signed(vec![
        "rmm.example.test".into(),
        "api.rmm.example.test".into(),
    ])
    .unwrap();
    let der = cert.serialize_der().unwrap();
    let tls = rustls::ServerConfig::builder_with_provider(Arc::new(
        rustls::crypto::aws_lc_rs::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .unwrap()
    .with_no_client_auth()
    .with_single_cert(
        vec![rustls::pki_types::CertificateDer::from(der.clone())],
        rustls::pki_types::PrivatePkcs8KeyDer::from(cert.serialize_private_key_der()).into(),
    )
    .unwrap();
    let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(tls));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let transport = reqwest::Client::builder()
        .no_proxy()
        .proxy(reqwest::Proxy::all(format!("http://{}", listener.local_addr().unwrap())).unwrap())
        .add_root_certificate(reqwest::Certificate::from_der(&der).unwrap())
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap();
    let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
    let captured = seen.clone();
    let body_started = Arc::new(tokio::sync::Semaphore::new(0));
    let started = body_started.clone();
    let task = tokio::spawn(async move {
        let mut children = tokio::task::JoinSet::new();
        loop {
            let (mut tcp, _) = listener.accept().await.unwrap();
            let acceptor = acceptor.clone();
            let captured = captured.clone();
            let started = started.clone();
            children.spawn(async move {
                let connect = head(&mut tcp).await;
                assert!(connect.starts_with("CONNECT rmm.example.test:443 ") || connect.starts_with("CONNECT api.rmm.example.test:443 "));
                tcp.write_all(b"HTTP/1.1 200 Connection established\r\n\r\n").await.unwrap();
                let mut socket = acceptor.accept(tcp).await.unwrap();
                let request = head(&mut socket).await;
                captured.lock().unwrap().push(request.clone());
                if request.to_ascii_lowercase().contains("sec-websocket-key:") {
                    socket.write_all(VALID.as_bytes()).await.unwrap();
                    let mut frame = [0u8; 8];
                    while socket.read_exact(&mut frame).await.is_ok() {
                        socket.write_all(&[0x81, 2, b'h', b'i']).await.unwrap();
                    }
                    return;
                }
                if request.starts_with("GET /redirect ") {
                    socket.write_all(b"HTTP/1.1 302 Found\r\nLocation: https://unconfigured.invalid/control\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await.unwrap();
                    return;
                }
                let api = request.starts_with("GET /api");
                let body = if api { "{}" } else { "<!doctype html><html><head></head><body>control</body></html>" };
                let mime = if api { "application/json" } else { "text/html" };
                socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: {mime}\r\nReferrer-Policy: unsafe-url\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).as_bytes()).await.unwrap();
                if request.starts_with("GET /slow ") || request.starts_with("GET /api-slow ") {
                    started.add_permits(1);
                    let mut byte = [0u8; 1];
                    let _ = socket.read(&mut byte).await;
                } else {
                    socket.write_all(body.as_bytes()).await.unwrap();
                }
            });
        }
    });
    Peer {
        transport,
        seen,
        body_started,
        task,
    }
}

async fn fixture(peer: &Peer, profile: bool, capability: bool) -> FixtureProxy {
    let route = capability.then(|| {
        tactical_rmm::TacticalRmmApiRoute::new(
            Some(ReviewedApplicationProfile::TacticalRmm),
            &reqwest::Url::parse(SOURCE).unwrap(),
            None,
            peer.transport.clone(),
        )
        .unwrap()
    });
    let network = ProxyNetworkState::default().with_reviewed_application_profile(
        profile.then_some(ReviewedApplicationProfile::TacticalRmm),
    );
    let fixture = proxy_with_tactical_api(
        SOURCE.into(),
        peer.transport.clone(),
        UpstreamAuthMode::None,
        HttpProxyPolicy::default(),
        HashMap::new(),
        Arc::new(network),
        None,
        route,
    )
    .await;
    fixture.state.document_sequence.store(1, Ordering::SeqCst);
    fixture.state.network.document_issued(1, true);
    fixture
}

fn child_request(fixture: &FixtureProxy, path: &str) -> reqwest::RequestBuilder {
    client()
        .get(format!("{}{path}", fixture.base))
        .header("Host", &fixture.state.proxy_authority)
        .header("Origin", &fixture.state.proxy_origin)
        .header("Sec-Fetch-Dest", "iframe")
        .header("Sec-Fetch-Mode", "navigate")
        .header(
            "Referer",
            format!("{}/parent?private=query", fixture.state.proxy_origin),
        )
}

fn api_request(fixture: &FixtureProxy, sequence: u64, path: &str) -> reqwest::RequestBuilder {
    client()
        .get(format!("{}{}", fixture.base, tactical_rmm::PATH))
        .query(&[
            ("destination", format!("{API}{path}")),
            ("__sorng_tactical_document_v1", sequence.to_string()),
        ])
        .header("Host", &fixture.state.proxy_authority)
        .header("Origin", &fixture.state.proxy_origin)
}

fn routing_config(html: &str) -> serde_json::Value {
    let json = html
        .split_once("var sorngNetworkClient=installWebNetworkClient(")
        .unwrap()
        .1
        .split_once(",function(detail)")
        .unwrap()
        .0;
    serde_json::from_str(json).unwrap()
}

/// Exercise the production listener middleware, not just the fallback handler.
async fn initial_runtime_fixture(peer: &Peer) -> FixtureProxy {
    let seed = fixture(peer, true, true).await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let state = Arc::new(AxumProxyState {
        network: Arc::new(
            ProxyNetworkState::default()
                .with_reviewed_application_profile(Some(ReviewedApplicationProfile::TacticalRmm)),
        ),
        document_sequence: Arc::new(AtomicU64::new(0)),
        proxy_authority: format!("p{TOKEN}.localhost:{port}"),
        proxy_origin: format!("http://p{TOKEN}.localhost:{port}"),
        ..(*seed.state).clone()
    });
    let runtime = ProxySessionRuntime::new(state.clone());
    let router = runtime.router();
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    FixtureProxy {
        base: format!("http://127.0.0.1:{port}"),
        state,
        task,
    }
}

#[tokio::test]
async fn tactical_popup_real_runtime_primary_generation_does_not_enable_synology_fence() {
    let peer = peer().await;
    let fixture = initial_runtime_fixture(&peer).await;
    assert!(fixture.state.attempt.is_none());
    assert!(fixture.state.redirect_profile.is_none());
    let primary = child_request(&fixture, &format!("/control?__sorng_navigation_v1={TOKEN}"))
        .send()
        .await
        .unwrap();
    assert_eq!(primary.status(), 200);
    let html = primary.text().await.unwrap();
    let root_config = routing_config(&html);
    assert_eq!(root_config["documentSequence"], 1);
    assert_eq!(root_config["requestGeneration"], TOKEN);
    assert!(root_config["popupParentDocument"].is_null());
    assert!(!html.contains("var key='__sorng_navigation_v1',token="));
    assert!(fixture.state.network.document_is_current(1));
    let api = api_request(&fixture, 1, "/api")
        .query(&[("__sorng_generation_v1", TOKEN)])
        .send()
        .await
        .unwrap();
    assert_eq!(api.status(), 200);

    // The root mapper can add its generation marker to the initial popup URL.
    // Child reloads and child iframe navigations retain only their root proof.
    for suffix in [
        format!("&__sorng_generation_v1={TOKEN}"),
        String::new(),
        String::new(),
    ] {
        let response = child_request(&fixture, &format!("/control?raw=%2F+&{MARKER}=1{suffix}"))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        let html = response.text().await.unwrap();
        let config = routing_config(&html);
        assert_eq!(config["documentSequence"], 1);
        assert_eq!(config["popupParentDocument"], 1);
        assert!(config["requestGeneration"].is_null());
        assert!(!html.contains("var key='__sorng_navigation_v1',token="));
        assert!(fixture.state.network.document_is_current(1));
        assert_eq!(
            api_request(&fixture, 1, "/api")
                .send()
                .await
                .unwrap()
                .status(),
            200
        );
    }
    let mut parser_resource = child_request(&fixture, "/asset?raw=%2F+").build().unwrap();
    parser_resource
        .headers_mut()
        .insert("sec-fetch-dest", "script".parse().unwrap());
    parser_resource
        .headers_mut()
        .insert("sec-fetch-mode", "no-cors".parse().unwrap());
    parser_resource.headers_mut().insert(
        "referer",
        format!("{}/control?{MARKER}=1", fixture.state.proxy_origin)
            .parse()
            .unwrap(),
    );
    assert_eq!(
        client().execute(parser_resource).await.unwrap().status(),
        200
    );
    for request in peer.seen.lock().unwrap().iter() {
        assert!(
            !request.contains("__sorng_"),
            "local marker leaked upstream: {request}"
        );
    }
    assert!(fixture.state.network.document_is_current(1));
    for child in 2..=4 {
        assert!(fixture.state.network.activate_document(child).is_err());
    }
}

#[tokio::test]
async fn tactical_popup_documents_two_through_seven_share_root_network_without_primary_or_login_grants(
) {
    let peer = peer().await;
    let fixture = fixture(&peer, true, true).await;
    fixture.state.auto_login_armed.store(true, Ordering::SeqCst);
    *fixture.state.auto_login_nonce.write().unwrap() = Some("parent-nonce".into());
    let mut headers = HeaderMap::new();
    headers.insert("referrer-policy", "no-referrer".parse().unwrap());
    fixture
        .state
        .network
        .record_document_referrer(1, &headers, "<html></html>");
    let mut root_socket = echo(ws_request(&fixture).send().await.unwrap()).await;
    for sequence in 2..=7 {
        let response = child_request(
            &fixture,
            &format!("/control?raw=%2F+&&{MARKER}=1&signed=a%26b%3D"),
        )
        .send()
        .await
        .unwrap();
        assert_eq!(response.status(), 200);
        let html = response.text().await.unwrap();
        let config = routing_config(&html);
        assert_eq!(config["documentSequence"], 1);
        assert_eq!(config["popupParentDocument"], 1);
        assert_eq!(config["popupTabs"], true);
        assert!(html.contains("var popupTitleParentSequence=1;"));
        assert!(html.contains("proxy_web_popup_title"));
        assert!(
            html.find("emit('proxy_document_start');").unwrap()
                < html.find("var popupTitleParentSequence=1;").unwrap()
        );
        assert!(config["requestGeneration"].is_null());
        let readiness = html
            .split_once("'use strict';var p=")
            .unwrap()
            .1
            .split_once(';')
            .unwrap()
            .0;
        let readiness: serde_json::Value = serde_json::from_str(readiness).unwrap();
        assert_eq!(readiness["documentSequence"], sequence);
        assert!(readiness["navigationToken"].is_null());
        assert!(fixture.state.network.activate_document(sequence).is_err());
        assert!(fixture.state.network.document_is_current(1));
        assert_eq!(
            fixture.state.auto_login_nonce.read().unwrap().as_deref(),
            Some("parent-nonce")
        );
        assert!(!html.contains("?nonce=parent-nonce"));
        assert_eq!(
            api_request(
                &fixture,
                config["documentSequence"].as_u64().unwrap(),
                "/api"
            )
            .send()
            .await
            .unwrap()
            .status(),
            200
        );
    }
    assert_eq!(fixture.state.document_sequence.load(Ordering::SeqCst), 7);
    assert_eq!(
        fixture
            .state
            .network
            .with_selected_document_referrer_origin(
                &reqwest::Url::parse(API).unwrap(),
                SOURCE,
                Some(1),
                |origin| origin
            )
            .unwrap(),
        None
    );
    let seen = peer.seen.lock().unwrap().clone();
    for request in seen
        .iter()
        .filter(|request| request.starts_with("GET /control"))
    {
        assert!(request.starts_with("GET /control?raw=%2F+&&signed=a%26b%3D HTTP/1.1"));
        assert!(!request.contains(MARKER) && !request.to_ascii_lowercase().contains("referer:"));
    }
    root_socket
        .write_all(&[0x81, 0x82, 1, 2, 3, 4, b'h' ^ 1, b'i' ^ 2])
        .await
        .unwrap();
    let mut reply = [0u8; 4];
    tokio::time::timeout(Duration::from_secs(2), root_socket.read_exact(&mut reply))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(reply, [0x81, 2, b'h', b'i']);
}

#[tokio::test]
async fn tactical_popup_rejects_wrong_profile_capability_metadata_and_unselected_parent_before_network(
) {
    let peer = peer().await;
    for (profile, capability) in [(false, true), (true, false)] {
        let fixture = fixture(&peer, profile, capability).await;
        assert_eq!(
            child_request(&fixture, &format!("/control?{MARKER}=1"))
                .send()
                .await
                .unwrap()
                .status(),
            403
        );
    }
    let fixture = fixture(&peer, true, true).await;
    fixture.state.network.document_issued(2, false);
    for path in [
        format!("/control?{MARKER}=2"),
        format!("/control?{MARKER}=1&{MARKER}=1"),
        format!("/control?%5f%5fsorng_popup_parent_v1=1"),
        format!("/control?{MARKER}=%31"),
        format!("/control?{MARKER}=01"),
        format!("/control?{MARKER}=0"),
        format!("/control?{MARKER}=9007199254740992"),
        format!("/control?{MARKER}=1&__sorng_navigation_v1={TOKEN}"),
        format!("{}?{MARKER}=1", tactical_rmm::PATH),
    ] {
        assert_eq!(
            child_request(&fixture, &path)
                .send()
                .await
                .unwrap()
                .status(),
            403,
            "{path}"
        );
    }
    for (name, value) in [
        ("Sec-Fetch-Dest", "empty"),
        ("Sec-Fetch-Mode", "cors"),
        ("Origin", "https://foreign.invalid"),
        ("Host", "localhost:42"),
    ] {
        let mut request = child_request(&fixture, &format!("/control?{MARKER}=1"))
            .build()
            .unwrap();
        request.headers_mut().insert(
            reqwest::header::HeaderName::from_bytes(name.as_bytes()).unwrap(),
            value.parse().unwrap(),
        );
        assert_eq!(client().execute(request).await.unwrap().status(), 403);
    }
    let mut request = child_request(&fixture, &format!("/control?{MARKER}=1"))
        .build()
        .unwrap();
    *request.method_mut() = reqwest::Method::POST;
    assert_eq!(client().execute(request).await.unwrap().status(), 403);
    assert!(peer.seen.lock().unwrap().is_empty());
}

#[tokio::test]
async fn tactical_popup_parent_navigation_cancels_child_document_and_api_response_bodies() {
    for api in [false, true] {
        let peer = peer().await;
        let fixture = fixture(&peer, true, true).await;
        let request = if api {
            api_request(&fixture, 1, "/api-slow")
        } else {
            child_request(&fixture, &format!("/slow?{MARKER}=1"))
        };
        let loading = tokio::spawn(async move { request.send().await.unwrap() });
        let permit = tokio::time::timeout(Duration::from_secs(3), peer.body_started.acquire())
            .await
            .unwrap()
            .unwrap();
        permit.forget();
        fixture.state.network.document_issued(8, false);
        fixture.state.network.activate_document(8).unwrap();
        let response = tokio::time::timeout(Duration::from_secs(2), loading)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(response.status(), 410);
        assert_eq!(
            child_request(&fixture, &format!("/control?{MARKER}=1"))
                .send()
                .await
                .unwrap()
                .status(),
            403
        );
        assert_eq!(
            api_request(&fixture, 1, "/api")
                .send()
                .await
                .unwrap()
                .status(),
            403
        );
        assert_eq!(peer.seen.lock().unwrap().len(), 1);
    }
}

#[tokio::test]
async fn tactical_popup_cross_origin_redirect_cannot_mint_a_new_proxy_handoff() {
    let peer = peer().await;
    let fixture = fixture(&peer, true, true).await;
    let response = child_request(&fixture, &format!("/redirect?{MARKER}=1"))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 403);
    assert!(!response.headers().contains_key("location"));
    assert!(response
        .text()
        .await
        .unwrap()
        .contains("cannot leave its owning connection origin"));
    assert!(fixture.state.network.document_is_current(1));
    assert_eq!(peer.seen.lock().unwrap().len(), 1);
}

#[test]
fn tactical_popup_marker_is_stripped_without_reencoding_application_query_bytes() {
    assert_eq!(
        proxy_response::popup_parent_request(
            "/control?x=%2f+&&__sorng_popup_parent_v1=7&signed=a%26b%3D&"
        )
        .unwrap(),
        ("/control?x=%2f+&&signed=a%26b%3D&".into(), Some(7))
    );
    assert_eq!(
        proxy_response::popup_parent_request("/control?raw=%2f+").unwrap(),
        ("/control?raw=%2f+".into(), None)
    );
}

#[test]
fn tactical_popup_descendant_requests_suppress_child_referrer_and_parent_proof() {
    let proxy_origin = format!("http://p{TOKEN}.localhost:43123");
    for marker in [MARKER, "%5f%5fsorng_popup_parent_v1"] {
        let mut headers = HeaderMap::new();
        headers.insert(
            "referer",
            format!("{proxy_origin}/control?secret=query&{marker}=1")
                .parse()
                .unwrap(),
        );
        let forwarded =
            collect_upstream_headers(&headers, UpstreamAuthMode::None, &proxy_origin, SOURCE);
        assert!(!forwarded
            .iter()
            .any(|(name, _)| name.eq_ignore_ascii_case("referer")));
    }
}
