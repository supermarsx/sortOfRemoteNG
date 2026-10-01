//! PTisp's exact first-party API over the actual protected Axum handler and a
//! loopback-only CONNECT/TLS peer. Accounts, passwords and hashes are fixtures.
use super::*;
use tokio_rustls::rustls;

const SOURCE: &str = tactical_rmm::PTISP_SOURCE;
const API: &str = tactical_rmm::PTISP_API;

struct Peer {
    proxy: String,
    certificate: Vec<u8>,
    seen: Arc<std::sync::Mutex<Vec<String>>>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Peer {
    fn drop(&mut self) {
        self.task.abort();
    }
}
impl Peer {
    fn transport(&self, trust: bool) -> reqwest::Client {
        let mut builder = reqwest::Client::builder()
            .no_proxy()
            .proxy(reqwest::Proxy::all(&self.proxy).unwrap())
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

async fn peer(host: &str, reply: &str) -> Peer {
    let cert = rcgen::generate_simple_self_signed(vec![host.into()]).unwrap();
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
    let proxy = format!("http://{}", listener.local_addr().unwrap());
    let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
    let captured = seen.clone();
    let reply = reply.to_owned();
    let task = tokio::spawn(async move {
        loop {
            let (mut socket, _) = listener.accept().await.unwrap();
            let connect = head(&mut socket).await;
            captured.lock().unwrap().push(connect);
            socket
                .write_all(b"HTTP/1.1 200 Connection established\r\n\r\n")
                .await
                .unwrap();
            let Ok(mut socket) = acceptor.accept(socket).await else {
                continue;
            };
            let headers = head(&mut socket).await;
            let length = headers
                .lines()
                .find_map(|line| {
                    line.split_once(':')
                        .filter(|(name, _)| name.eq_ignore_ascii_case("content-length"))
                        .map(|(_, value)| value.trim().parse::<usize>().unwrap())
                })
                .unwrap_or(0);
            assert!(length < 4096);
            let mut body = vec![0; length];
            socket.read_exact(&mut body).await.unwrap();
            captured
                .lock()
                .unwrap()
                .push(format!("{headers}{}", String::from_utf8(body).unwrap()));
            socket.write_all(reply.as_bytes()).await.unwrap();
        }
    });
    Peer {
        proxy,
        certificate,
        seen,
        task,
    }
}

async fn fixture(peer: &Peer, trust: bool, reviewed: bool) -> FixtureProxy {
    let route = tactical_rmm::TacticalRmmApiRoute::new(
        reviewed.then_some(ReviewedApplicationProfile::Ptisp),
        &reqwest::Url::parse(SOURCE).unwrap(),
        None,
        peer.transport(trust),
    );
    // Even an incorrectly selected permissive dashboard client stays local.
    let jar = Arc::new(reqwest::cookie::Jar::default());
    jar.add_cookie_str(
        "dashboard=private-native-cookie",
        &reqwest::Url::parse(API).unwrap(),
    );
    let dashboard = reqwest::Client::builder()
        .no_proxy()
        .proxy(reqwest::Proxy::all(&peer.proxy).unwrap())
        .cookie_provider(jar)
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_secs(3))
        .build()
        .unwrap();
    let result = proxy_with_tactical_api(
        SOURCE.into(),
        dashboard,
        UpstreamAuthMode::Basic,
        HttpProxyPolicy {
            query_parameters: vec![proxy_policy::QueryParameter {
                name: "private-dashboard-query".into(),
                value: "private-value".into(),
            }],
            ..Default::default()
        },
        HashMap::from([
            (
                "Authorization".into(),
                "Basic private-configured-header".into(),
            ),
            ("X-Dashboard-Secret".into(), "private-header".into()),
        ]),
        Arc::new(
            ProxyNetworkState::default().with_reviewed_application_profile(
                reviewed.then_some(ReviewedApplicationProfile::Ptisp),
            ),
        ),
        None,
        route,
    )
    .await;
    *result.state.username.write().unwrap() = "private-dashboard-user".into();
    *result.state.password.write().unwrap() = "private-dashboard-password".into();
    *result.state.yealink_session.write().unwrap() = Some("JSESSIONID=private-session".into());
    result.state.document_sequence.store(1, Ordering::SeqCst);
    result.state.network.document_issued(1, true);
    result
}

fn request(fixture: &FixtureProxy, destination: &str) -> reqwest::RequestBuilder {
    client()
        .post(format!("{}{}", fixture.base, tactical_rmm::PTISP_PATH))
        .query(&[
            ("destination", destination),
            ("__sorng_ptisp_document_v1", "1"),
        ])
        .header("Host", &fixture.state.proxy_authority)
        .header("Origin", &fixture.state.proxy_origin)
        .header(
            "Referer",
            format!("{}/private-dashboard-path", fixture.state.proxy_origin),
        )
        .header("Cookie", "dashboard=private-browser-cookie")
        .header("Content-Type", "application/json")
}

fn assert_redacted(fixture: &FixtureProxy) {
    let manager = fixture.state.global_sessions.lock().unwrap();
    assert!(!manager.request_log.is_empty());
    for entry in &manager.request_log {
        assert_eq!(entry.url, API);
    }
    let serialized = serde_json::to_string(&manager.request_log).unwrap();
    assert!(
        !serialized.contains("fixture%40")
            && !serialized.contains("fixture-password")
            && !serialized.contains("fixture-hash")
            && !serialized.contains("private-")
    );
}

#[tokio::test]
async fn ptisp_login_post_and_info_basic_preserve_page_credentials_only_over_connect() {
    let peer = peer("api3.ptisp.pt", "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nSet-Cookie: api=private-api-cookie; Path=/\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}").await;
    let fixture = fixture(&peer, true, true).await;
    let destination = format!("{API}/user/security/fixture%40example.test/login?raw=%2F+");
    let body = r#"{"password":"fixture-password","authcode":"","remmemberme":false}"#;
    let response = request(&fixture, &destination)
        .body(body)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert!(!response.headers().contains_key("set-cookie"));
    assert_eq!(response.text().await.unwrap(), "{}");
    let authorization = format!(
        "Basic {}",
        base64::engine::general_purpose::STANDARD.encode("fixture@example.test:fixture-hash")
    );
    let mut info = request(&fixture, &format!("{API}/user/info"))
        .header("Authorization", &authorization)
        .build()
        .unwrap();
    *info.method_mut() = reqwest::Method::GET;
    let response = client().execute(info).await.unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(response.text().await.unwrap(), "{}");
    let seen = peer.seen.lock().unwrap();
    assert_eq!(seen.len(), 4);
    assert!(seen[0].starts_with("CONNECT api3.ptisp.pt:443 HTTP/1.1"));
    assert!(seen[2].starts_with("CONNECT api3.ptisp.pt:443 HTTP/1.1"));
    assert!(
        seen[1].starts_with("POST /user/security/fixture%40example.test/login?raw=%2F+ HTTP/1.1")
    );
    assert!(seen[1].ends_with(body));
    assert!(!seen[1].to_ascii_lowercase().contains("authorization:"));
    assert!(seen[3].starts_with("GET /user/info HTTP/1.1"));
    assert!(seen[3].contains(&authorization));
    for headers in [&seen[1], &seen[3]] {
        let lower = headers.to_ascii_lowercase();
        assert!(lower.contains("origin: https://my.ptisp.pt"));
        assert!(
            !lower.contains("cookie:")
                && !lower.contains("referer:")
                && !lower.contains("private-")
                && !lower.contains("__sorng")
        );
    }
    assert_redacted(&fixture);
}

#[tokio::test]
async fn ptisp_unreviewed_wrong_origin_stale_document_and_other_capabilities_never_send() {
    let peer = peer("api3.ptisp.pt", "").await;
    let generic = fixture(&peer, true, false).await;
    assert_eq!(request(&generic, API).send().await.unwrap().status(), 403);
    let fixture = fixture(&peer, true, true).await;
    for target in [
        "http://api3.ptisp.pt/user/info",
        "https://api3.ptisp.pt:8443/user/info",
        "https://api3.ptisp.pt.evil.test/",
        "https://api4.ptisp.pt/",
        "https://user:secret@api3.ptisp.pt/",
        "https://api3.ptisp.pt/#fragment",
    ] {
        assert_eq!(
            request(&fixture, target).send().await.unwrap().status(),
            403
        );
    }
    assert_eq!(
        request(&fixture, API)
            .header("Sec-Fetch-Dest", "document")
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    let mut ws = request(&fixture, API)
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", KEY)
        .build()
        .unwrap();
    *ws.method_mut() = reqwest::Method::GET;
    ws.url_mut()
        .query_pairs_mut()
        .append_pair("__sorng_ws_document_v1", "1");
    assert_eq!(client().execute(ws).await.unwrap().status(), 403);
    let mut tactical = request(&fixture, API).build().unwrap();
    tactical.url_mut().set_path(tactical_rmm::PATH);
    tactical.url_mut().set_query(Some(
        "destination=https%3A%2F%2Fapi3.ptisp.pt%2F&__sorng_tactical_document_v1=1",
    ));
    assert_eq!(client().execute(tactical).await.unwrap().status(), 403);
    fixture.state.network.document_issued(2, true);
    fixture.state.network.activate_document(2).unwrap();
    assert_eq!(request(&fixture, API).send().await.unwrap().status(), 403);
    assert!(!fixture.state.network.permits_tactical_popup_parent(2));
    assert!(!fixture.state.network.mesh_manifest_eligible(2));
    assert!(peer.seen.lock().unwrap().is_empty());
}

#[tokio::test]
async fn ptisp_tls_rejection_never_uses_dashboard_bypass_and_redacts_login_path() {
    for (host, trust) in [("api3.ptisp.pt", false), ("wrong.example.test", true)] {
        let peer = peer(host, "").await;
        let fixture = fixture(&peer, trust, true).await;
        let response = request(
            &fixture,
            &format!("{API}/user/security/fixture%40example.test/login?password=fixture-password"),
        )
        .body("fixture-password")
        .send()
        .await
        .unwrap();
        assert!(!response.status().is_success());
        let body = response.text().await.unwrap();
        assert!(!body.contains("fixture%40") && !body.contains("fixture-password"));
        let seen = peer.seen.lock().unwrap();
        assert_eq!(
            seen.len(),
            1,
            "POST must neither retry nor reach the API after TLS rejection"
        );
        assert!(seen[0].starts_with("CONNECT api3.ptisp.pt:443 HTTP/1.1"));
        assert_redacted(&fixture);
    }
}

#[tokio::test]
async fn ptisp_cross_origin_redirect_is_not_followed_or_promoted_to_navigation() {
    let peer = peer("api3.ptisp.pt", "HTTP/1.1 307 Temporary Redirect\r\nLocation: https://other.ptisp.pt/private-email?password=fixture-password\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
    let fixture = fixture(&peer, true, true).await;
    let response = request(
        &fixture,
        &format!("{API}/user/security/fixture%40example.test/login"),
    )
    .body("fixture-password")
    .send()
    .await
    .unwrap();
    assert!(!response.status().is_success());
    let body = response.text().await.unwrap();
    assert!(!body.contains("private-email") && !body.contains("fixture-password"));
    assert_eq!(peer.seen.lock().unwrap().len(), 2);
    assert_redacted(&fixture);
}
