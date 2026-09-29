//! Real protected proxy -> CONNECT -> verified TLS -> API upgrade fixtures.
//! All sockets terminate on loopback; no deployment or system trust changes.
use super::*;

const DASHBOARD: &str = "https://dashboard.example.test";
const API: &str = "https://api.rmm.apps.vogue-homes.com";

struct ApiPeer {
    proxy_url: String,
    certificate: Vec<u8>,
    seen: Arc<std::sync::Mutex<Vec<String>>>,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for ApiPeer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl ApiPeer {
    fn transport(&self, trust: bool) -> reqwest::Client {
        let mut builder = reqwest::Client::builder()
            .no_proxy()
            .proxy(reqwest::Proxy::all(&self.proxy_url).unwrap())
            .cookie_store(false)
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(3));
        if trust {
            builder = builder
                .add_root_certificate(reqwest::Certificate::from_der(&self.certificate).unwrap());
        }
        builder.build().unwrap()
    }
}

async fn api_peer(certificate_host: &str, reply: &str, reject_connect: bool) -> ApiPeer {
    let cert = rcgen::generate_simple_self_signed(vec![certificate_host.into()]).unwrap();
    let certificate = cert.serialize_der().unwrap();
    let tls = rustls::ServerConfig::builder_with_provider(Arc::new(
        rustls::crypto::aws_lc_rs::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .unwrap()
    .with_no_client_auth()
    .with_single_cert(
        vec![rustls::pki_types::CertificateDer::from(certificate.clone())],
        rustls::pki_types::PrivatePkcs8KeyDer::from(cert.serialize_private_key_der()).into(),
    )
    .unwrap();
    let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(tls));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let proxy_url = format!("http://{}", listener.local_addr().unwrap());
    let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
    let captured = seen.clone();
    let reply = reply.to_owned();
    let task = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let connect = head(&mut socket).await;
        captured.lock().unwrap().push(connect);
        if reject_connect {
            socket
                .write_all(
                    b"HTTP/1.1 502 Proxy failure\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .await
                .unwrap();
            return;
        }
        socket
            .write_all(b"HTTP/1.1 200 Connection established\r\n\r\n")
            .await
            .unwrap();
        let Ok(mut socket) = acceptor.accept(socket).await else {
            return;
        };
        let request = head(&mut socket).await;
        captured.lock().unwrap().push(request);
        socket.write_all(reply.as_bytes()).await.unwrap();
        if reply.starts_with("HTTP/1.1 101") {
            let mut frame = [0u8; 8];
            if socket.read_exact(&mut frame).await.is_ok() {
                assert_eq!(frame, [0x81, 0x82, 1, 2, 3, 4, b'h' ^ 1, b'i' ^ 2]);
                socket.write_all(&[0x81, 2, b'h', b'i']).await.unwrap();
                let mut byte = [0u8; 1];
                let _ = socket.read(&mut byte).await;
            }
        }
    });
    ApiPeer {
        proxy_url,
        certificate,
        seen,
        task,
    }
}

async fn tactical_proxy(peer: &ApiPeer, trust: bool, configured: Option<&str>) -> FixtureProxy {
    let route = tactical_rmm::TacticalRmmApiRoute::new(
        Some(ReviewedApplicationProfile::TacticalRmm),
        &reqwest::Url::parse(DASHBOARD).unwrap(),
        configured,
        peer.transport(trust),
    )
    .unwrap();
    let policy = HttpProxyPolicy {
        query_parameters: vec![proxy_policy::QueryParameter {
            name: "dashboard-secret".into(),
            value: "private-query".into(),
        }],
        ..Default::default()
    };
    // A permissive dashboard client must never be selected for the API.
    // Keep even an erroneous dashboard-client selection on the local proxy.
    let dashboard_jar = Arc::new(reqwest::cookie::Jar::default());
    dashboard_jar.add_cookie_str(
        "dashboard=private-native-cookie",
        &reqwest::Url::parse(API).unwrap(),
    );
    let dashboard_client = reqwest::Client::builder()
        .no_proxy()
        .proxy(reqwest::Proxy::all(&peer.proxy_url).unwrap())
        .cookie_provider(dashboard_jar)
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_secs(3))
        .build()
        .unwrap();
    let fixture = proxy_with_tactical_api(
        DASHBOARD.into(),
        dashboard_client,
        UpstreamAuthMode::Basic,
        policy,
        HashMap::from([("X-Dashboard-Secret".into(), "private-header".into())]),
        Arc::new(ProxyNetworkState::default()),
        None,
        Some(route),
    )
    .await;
    *fixture.state.username.write().unwrap() = "private-user".into();
    *fixture.state.password.write().unwrap() = "private-password".into();
    *fixture.state.yealink_session.write().unwrap() = Some("JSESSIONID=private-session".into());
    fixture
}

fn api_request(fixture: &FixtureProxy, destination: &str) -> reqwest::Request {
    let mut request = ws_request(fixture).build().unwrap();
    request.url_mut().set_path(tactical_rmm::PATH);
    request.url_mut().set_query(None);
    request
        .url_mut()
        .query_pairs_mut()
        .append_pair("destination", destination)
        .append_pair("__sorng_tactical_document_v1", "1")
        .append_pair("__sorng_ws_document_v1", "1");
    request
        .headers_mut()
        .insert("cookie", "dashboard=private-cookie".parse().unwrap());
    request.headers_mut().insert(
        "referer",
        format!("{}/private-path", fixture.state.proxy_origin)
            .parse()
            .unwrap(),
    );
    request
        .headers_mut()
        .insert("authorization", "Bearer api-token".parse().unwrap());
    request
}

// Use the production dispatch layer: generation markers are consumed there,
// and its lifetime guards must retain Hyper's upgrade extension.
async fn runtime_proxy(seed: &FixtureProxy) -> FixtureProxy {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let authority = format!("p{TOKEN}.localhost:{port}");
    let state = Arc::new(AxumProxyState {
        proxy_origin: format!("http://{authority}"),
        proxy_authority: authority,
        ..(*seed.state).clone()
    });
    let router = ProxySessionRuntime::new(state.clone()).router();
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    FixtureProxy {
        base: format!("http://127.0.0.1:{port}"),
        state,
        task,
    }
}

fn background_http(mut request: reqwest::Request) -> reqwest::Request {
    for name in [
        "upgrade",
        "connection",
        "sec-websocket-key",
        "sec-websocket-version",
    ] {
        request.headers_mut().remove(name);
    }
    let pairs: Vec<_> = request
        .url()
        .query_pairs()
        .filter(|(name, _)| name != "__sorng_ws_document_v1")
        .map(|(name, value)| (name.into_owned(), value.into_owned()))
        .collect();
    request.url_mut().set_query(None);
    request.url_mut().query_pairs_mut().extend_pairs(pairs);
    request
}

#[tokio::test]
async fn tactical_runtime_dashinfo_upgrade_keeps_native_context_and_generation_local() {
    let peer = api_peer("api.rmm.apps.vogue-homes.com", VALID, false).await;
    let seed = tactical_proxy(&peer, true, Some(API)).await;
    let fixture = runtime_proxy(&seed).await;
    let mut request = api_request(
        &fixture,
        &format!("{API}/ws/dashinfo/?access_token=synthetic%2F+"),
    );
    request
        .url_mut()
        .query_pairs_mut()
        .append_pair("__sorng_generation_v1", TOKEN);
    request
        .headers_mut()
        .insert("user-agent", "Synthetic native WebView UA".parse().unwrap());
    request
        .headers_mut()
        .insert("sec-fetch-mode", "websocket".parse().unwrap());
    let _socket = echo(client().execute(request).await.unwrap()).await;
    let requests = peer.seen.lock().unwrap();
    assert_eq!(requests.len(), 2);
    assert!(requests[1].starts_with("GET /ws/dashinfo/?access_token=synthetic%2F+ HTTP/1.1"));
    assert!(requests[1].contains("user-agent: Synthetic native WebView UA\r\n"));
    assert!(requests[1].contains("origin: https://dashboard.example.test\r\n"));
    assert!(!requests[1].contains("__sorng") && !requests[1].contains(TOKEN));
    let log = fixture
        .state
        .global_sessions
        .lock()
        .unwrap()
        .request_log_newest_first();
    let serialized = serde_json::to_string(&log).unwrap();
    assert!(!serialized.contains("synthetic%2F") && !serialized.contains("access_token"));
}

#[tokio::test]
async fn tactical_api_reload_waits_for_issued_document_selection_before_sending() {
    let peer = api_peer("api.rmm.apps.vogue-homes.com", "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}", false).await;
    let fixture = tactical_proxy(&peer, true, Some(API)).await;
    let mut request = background_http(api_request(&fixture, &format!("{API}/alerts/")));
    request.url_mut().set_query(Some(&format!(
        "destination={API}/alerts/&__sorng_tactical_document_v1=2"
    )));
    fixture.state.network.document_issued(2, false);
    let pending = tokio::spawn(async move { client().execute(request).await.unwrap() });
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(
        !pending.is_finished(),
        "an issued reload must wait for selection, not return 403"
    );
    assert!(peer.seen.lock().unwrap().is_empty());
    fixture.state.network.activate_document(2).unwrap();
    let response = tokio::time::timeout(Duration::from_secs(2), pending)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(response.text().await.unwrap(), "{}");
    assert!(peer.seen.lock().unwrap()[1].starts_with("GET /alerts/ HTTP/1.1"));
}

#[tokio::test]
async fn tactical_api_pending_document_revocation_and_unissued_proofs_never_send() {
    let peer = api_peer("api.rmm.apps.vogue-homes.com", VALID, false).await;
    let fixture = tactical_proxy(&peer, true, Some(API)).await;
    let mut request = background_http(api_request(&fixture, API));
    request.url_mut().set_query(Some(&format!(
        "destination={API}/alerts/&__sorng_tactical_document_v1=99"
    )));
    assert_eq!(client().execute(request).await.unwrap().status(), 403);
    let mut request = background_http(api_request(&fixture, API));
    request.url_mut().set_query(Some(&format!(
        "destination={API}/alerts/&__sorng_tactical_document_v1=2"
    )));
    fixture.state.network.document_issued(2, false);
    let pending = tokio::spawn(async move { client().execute(request).await.unwrap() });
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(!pending.is_finished());
    fixture.state.network.document_issued(3, false);
    fixture.state.network.activate_document(3).unwrap();
    assert_eq!(pending.await.unwrap().status(), 403);
    assert!(peer.seen.lock().unwrap().is_empty());
}

#[tokio::test]
async fn tactical_websocket_diagnostics_distinguish_local_policy_from_upstream_403() {
    let peer = api_peer(
        "api.rmm.apps.vogue-homes.com",
        "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        false,
    )
    .await;
    let fixture = tactical_proxy(&peer, true, Some(API)).await;
    for (destination, stage, code, upstream_status) in [
        (
            "https://unconfigured.invalid/ws/?access_token=synthetic-secret",
            "admission",
            "websocket_origin_or_route_denied",
            None,
        ),
        (
            "https://api.rmm.apps.vogue-homes.com/ws/?access_token=synthetic-secret",
            "upstream",
            "websocket_upstream_rejected",
            Some(403),
        ),
    ] {
        assert_eq!(
            client()
                .execute(api_request(&fixture, destination))
                .await
                .unwrap()
                .status(),
            403
        );
        let log = fixture
            .state
            .global_sessions
            .lock()
            .unwrap()
            .request_log_newest_first();
        let diagnostic = log[0].diagnostic.as_ref().unwrap();
        assert_eq!(diagnostic.stage, stage);
        assert_eq!(diagnostic.code, code);
        assert_eq!(diagnostic.upstream_status, upstream_status);
        assert!(!serde_json::to_string(&log)
            .unwrap()
            .contains("synthetic-secret"));
    }
    assert_eq!(peer.seen.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn websocket_native_cookie_jar_user_agent_and_origin_reach_the_same_upstream() {
    let upstream = upstream_ws(VALID.into(), false, false).await;
    let jar = Arc::new(reqwest::cookie::Jar::default());
    jar.add_cookie_str(
        "native_session=synthetic-native; Path=/; HttpOnly",
        &reqwest::Url::parse(&upstream.url).unwrap(),
    );
    let transport = reqwest::Client::builder()
        .no_proxy()
        .cookie_provider(jar)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();
    let fixture = proxy(upstream.url.clone(), transport).await;
    let response = ws_request(&fixture)
        .header("User-Agent", "Synthetic native browser")
        .header(
            "Referer",
            format!(
                "{}/control?__sorng_generation_v1={TOKEN}",
                fixture.state.proxy_origin
            ),
        )
        .send()
        .await
        .unwrap();
    let _socket = echo(response).await;
    let headers = upstream.headers.lock().unwrap().join("\n");
    assert!(headers.contains("cookie: native_session=synthetic-native\r\n"));
    assert!(headers.contains("user-agent: Synthetic native browser\r\n"));
    assert!(headers.contains(&format!("origin: {}\r\n", fixture.state.target_origin)));
    assert!(headers.contains(&format!(
        "referer: {}/control\r\n",
        fixture.state.target_origin
    )));
    assert!(!headers.contains(TOKEN) && !headers.contains("__sorng"));
}

#[tokio::test]
async fn websocket_refused_upstream_is_502_while_the_local_proxy_remains_listening() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let target = format!("http://{}/", listener.local_addr().unwrap());
    let fixture = proxy(target, client()).await;
    drop(listener);
    for _ in 0..2 {
        let response = ws_request(&fixture).send().await.unwrap();
        assert_eq!(response.status(), 502);
        let log = fixture
            .state
            .global_sessions
            .lock()
            .unwrap()
            .request_log_newest_first();
        let diagnostic = log[0].diagnostic.as_ref().unwrap();
        assert_eq!(diagnostic.stage, "upstream");
        assert_eq!(diagnostic.code, "websocket_upstream_connect_failed");
        assert_eq!(diagnostic.upstream_status, None);
    }
}

#[tokio::test]
async fn tactical_saved_custom_api_wss_uses_connect_verified_tls_and_isolated_headers() {
    let reply = VALID.replace(
        "\r\n\r\n",
        "\r\nSec-WebSocket-Protocol: Tactical.v1\r\n\r\n",
    );
    let peer = api_peer("api.rmm.apps.vogue-homes.com", &reply, false).await;
    let fixture = tactical_proxy(&peer, true, Some(API)).await;
    let mut request = api_request(&fixture, &format!("{API}/ws/agents/?raw=%2F+"));
    request.headers_mut().insert(
        "sec-websocket-protocol",
        "Tactical.v1, binary-v2".parse().unwrap(),
    );
    let response = client().execute(request).await.unwrap();
    assert_eq!(response.headers()["sec-websocket-protocol"], "Tactical.v1");
    let mut socket = echo(response).await;
    let requests = peer.seen.lock().unwrap().clone();
    assert_eq!(requests.len(), 2);
    assert!(requests[0].starts_with("CONNECT api.rmm.apps.vogue-homes.com:443 HTTP/1.1"));
    assert!(requests[1].starts_with("GET /ws/agents/?raw=%2F+ HTTP/1.1"));
    assert!(requests[1].contains("sec-websocket-protocol: Tactical.v1, binary-v2\r\n"));
    let request = requests[1].to_ascii_lowercase();
    assert!(request.contains("origin: https://dashboard.example.test\r\n"));
    assert!(request.contains("authorization: bearer api-token\r\n"));
    for secret in [
        "cookie:",
        "referer:",
        "private-",
        "dashboard-secret",
        "__sorng",
        TOKEN,
    ] {
        assert!(!request.contains(secret), "leaked {secret}");
    }
    fixture.state.network.document_issued(2, false);
    fixture.state.network.activate_document(2).unwrap();
    let mut byte = [0u8; 1];
    assert!(matches!(
        tokio::time::timeout(Duration::from_secs(2), socket.read(&mut byte)).await,
        Ok(Ok(0)) | Ok(Err(_))
    ));
}

#[tokio::test]
async fn tactical_saved_api_http_still_uses_the_same_exact_origin_capability() {
    let peer = api_peer("api.rmm.apps.vogue-homes.com", "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}", false).await;
    let fixture = tactical_proxy(&peer, true, Some(API)).await;
    let mut request = api_request(&fixture, &format!("{API}/v3/checkin/?raw=%2F+"));
    for name in [
        "upgrade",
        "connection",
        "sec-websocket-key",
        "sec-websocket-version",
    ] {
        request.headers_mut().remove(name);
    }
    let pairs: Vec<_> = request
        .url()
        .query_pairs()
        .filter(|(name, _)| name != "__sorng_ws_document_v1")
        .map(|(name, value)| (name.into_owned(), value.into_owned()))
        .collect();
    request.url_mut().set_query(None);
    request.url_mut().query_pairs_mut().extend_pairs(pairs);
    let response = client().execute(request).await.unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(response.text().await.unwrap(), "{}");
    let requests = peer.seen.lock().unwrap();
    assert_eq!(requests.len(), 2);
    assert!(requests[1].starts_with("GET /v3/checkin/?raw=%2F+ HTTP/1.1"));
    assert!(!requests[1].contains("private-") && !requests[1].contains("__sorng"));
}

#[tokio::test]
async fn tactical_websocket_unconfigured_origins_and_stale_proofs_never_reach_proxy() {
    let peer = api_peer("api.rmm.apps.vogue-homes.com", VALID, false).await;
    let unconfigured = tactical_proxy(&peer, true, None).await;
    assert_eq!(
        client()
            .execute(api_request(&unconfigured, &format!("{API}/ws/")))
            .await
            .unwrap()
            .status(),
        403
    );
    let fixture = tactical_proxy(&peer, true, Some(API)).await;
    for destination in [
        "https://other.apps.vogue-homes.com/ws/",
        "https://api.rmm.apps.vogue-homes.com.evil.test/ws/",
        "https://child.api.rmm.apps.vogue-homes.com/ws/",
        "https://api.rmm.apps.vogue-homes.com:8443/ws/",
        "http://api.rmm.apps.vogue-homes.com/ws/",
        "https://user@api.rmm.apps.vogue-homes.com/ws/",
        "https://api.rmm.apps.vogue-homes.com/ws/#fragment",
    ] {
        assert_eq!(
            client()
                .execute(api_request(&fixture, destination))
                .await
                .unwrap()
                .status(),
            403,
            "{destination}"
        );
    }
    for query in [
        format!("destination={API}/ws/&__sorng_ws_document_v1=1"),
        format!("destination={API}/ws/&__sorng_tactical_document_v1=2&__sorng_ws_document_v1=1"),
        format!("destination={API}/ws/&__sorng_tactical_document_v1=1&__sorng_tactical_document_v1=1&__sorng_ws_document_v1=1"),
    ] {
        let mut request = api_request(&fixture, API);
        request.url_mut().set_query(Some(&query));
        assert_eq!(client().execute(request).await.unwrap().status(), 403);
    }
    let request = api_request(&fixture, API);
    let mut stale_api = api_request(&fixture, API);
    stale_api.url_mut().set_query(Some(&format!(
        "destination={API}/ws/&__sorng_tactical_document_v1=1&__sorng_ws_document_v1=2"
    )));
    fixture.state.network.document_issued(2, false);
    fixture.state.network.activate_document(2).unwrap();
    assert_eq!(client().execute(stale_api).await.unwrap().status(), 403);
    assert_eq!(client().execute(request).await.unwrap().status(), 410);
    assert!(peer.seen.lock().unwrap().is_empty());
}

#[tokio::test]
async fn tactical_websocket_tls_rejection_never_uses_dashboard_certificate_bypass() {
    for (host, trust) in [
        ("api.rmm.apps.vogue-homes.com", false),
        ("wrong.example.test", true),
    ] {
        let peer = api_peer(host, VALID, false).await;
        let fixture = tactical_proxy(&peer, trust, Some(API)).await;
        let response = client().execute(api_request(&fixture, API)).await.unwrap();
        assert_eq!(response.status(), 502);
        assert!(response
            .text()
            .await
            .unwrap()
            .contains("no alternate route"));
        assert_eq!(peer.seen.lock().unwrap().len(), 1); // CONNECT only; no API HTTP.
    }
}

#[tokio::test]
async fn tactical_websocket_proxy_failure_and_redirect_never_retry_an_alternate_route() {
    for reject_connect in [true, false] {
        let peer = api_peer("api.rmm.apps.vogue-homes.com", "HTTP/1.1 302 Found\r\nLocation: https://unconfigured.invalid/ws/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", reject_connect).await;
        let fixture = tactical_proxy(&peer, true, Some(API)).await;
        let response = client().execute(api_request(&fixture, API)).await.unwrap();
        assert_eq!(response.status(), 502);
        assert!(response
            .text()
            .await
            .unwrap()
            .contains("no alternate route"));
        assert_eq!(
            peer.seen.lock().unwrap().len(),
            if reject_connect { 1 } else { 2 }
        );
    }
}
