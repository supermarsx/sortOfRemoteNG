//! Mesh acceptance is entirely loopback TLS behind a synthetic CONNECT proxy.
use super::*;

const SOURCE: &str = "https://rmm.example.test";
const MESH: &str = "https://mesh.example.test:8443";

struct Peer {
    trusted: reqwest::Client,
    untrusted: reqwest::Client,
    relaxed: reqwest::Client,
    connects: Arc<std::sync::Mutex<Vec<String>>>,
    seen: Arc<std::sync::Mutex<Vec<String>>>,
    started: Arc<tokio::sync::Semaphore>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Peer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn peer(reject_proxy: bool) -> Peer {
    let cert = rcgen::generate_simple_self_signed(vec![
        "rmm.example.test".into(),
        "mesh.example.test".into(),
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
    let proxy = reqwest::Proxy::all(format!("http://{}", listener.local_addr().unwrap())).unwrap();
    let builder = || {
        reqwest::Client::builder()
            .no_proxy()
            .proxy(proxy.clone())
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(5))
    };
    let trusted = builder()
        .add_root_certificate(reqwest::Certificate::from_der(&der).unwrap())
        .build()
        .unwrap();
    let untrusted = builder().build().unwrap();
    let relaxed = builder()
        .danger_accept_invalid_certs(true)
        .cookie_store(true)
        .build()
        .unwrap();
    let connects = Arc::new(std::sync::Mutex::new(Vec::new()));
    let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
    let started = Arc::new(tokio::sync::Semaphore::new(0));
    let (captured_connects, captured, slow) = (connects.clone(), seen.clone(), started.clone());
    let task = tokio::spawn(async move {
        let mut children = tokio::task::JoinSet::new();
        loop {
            let (mut tcp, _) = listener.accept().await.unwrap();
            let (acceptor, connects, seen, slow) = (
                acceptor.clone(),
                captured_connects.clone(),
                captured.clone(),
                slow.clone(),
            );
            children.spawn(async move {
                let connect = head(&mut tcp).await;
                let mesh = connect.starts_with("CONNECT mesh.example.test:8443 ");
                assert!(mesh || connect.starts_with("CONNECT rmm.example.test:443 "));
                connects.lock().unwrap().push(connect);
                if reject_proxy && mesh {
                    tcp.write_all(b"HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await.unwrap();
                    return;
                }
                tcp.write_all(b"HTTP/1.1 200 Connection established\r\n\r\n").await.unwrap();
                let Ok(mut socket) = acceptor.accept(tcp).await else { return; };
                let request = head(&mut socket).await;
                seen.lock().unwrap().push(request.clone());
                if request.starts_with("GET /mesh-login?login=synthetic%2F+ ") {
                    socket.write_all(b"HTTP/1.1 302 Found\r\nLocation: /mesh-control\r\nSet-Cookie: xids=synthetic-session; Path=/; Secure; HttpOnly; SameSite=Lax\r\nSet-Cookie: xids.sig=synthetic-signature; Path=/; Secure; HttpOnly; SameSite=Lax\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await.unwrap();
                    return;
                }
                let control_socket = request.starts_with("GET /control.ashx ");
                if request.starts_with("GET /mesh-control ") || request.starts_with("GET /commander.ashx ") || control_socket {
                    let cookies = request.lines().find(|line| line.to_ascii_lowercase().starts_with("cookie:")).unwrap_or("");
                    if !cookies.contains("xids=synthetic-session") || !cookies.contains("xids.sig=synthetic-signature") {
                        if control_socket {
                            // Mesh authentication can fail AFTER a valid upgrade.
                            socket.write_all(VALID.as_bytes()).await.unwrap();
                            let payload = br#"{"action":"close","cause":"noauth"}"#;
                            socket.write_all(&[0x81, payload.len() as u8]).await.unwrap();
                            socket.write_all(payload).await.unwrap();
                            socket.write_all(&[0x88, 0]).await.unwrap();
                        } else {
                            // Commander deliberately conceals its unauthenticated route.
                            socket.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await.unwrap();
                        }
                        return;
                    }
                }
                if request.starts_with("GET /mesh-logout ") {
                    // Default effective path / must replace the explicit Path=/
                    // issued at login, even when deletion omits HttpOnly too.
                    socket.write_all(b"HTTP/1.1 200 OK\r\nSet-Cookie: xids=; Domain=mesh.example.test; Max-Age=0; Secure; SameSite=Lax\r\nSet-Cookie: xids.sig=; Domain=mesh.example.test; Max-Age=0; Secure; SameSite=Lax\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await.unwrap();
                    return;
                }
                if request.starts_with("GET /mesh-login-final ") {
                    socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nSet-Cookie: xids=synthetic-session; Path=/; Secure; HttpOnly; SameSite=Lax\r\nSet-Cookie: xids.sig=synthetic-signature; Path=/; Secure; HttpOnly; SameSite=Lax\r\nContent-Length: 13\r\nConnection: close\r\n\r\n<html></html>").await.unwrap();
                    return;
                }
                if request.starts_with("GET /cookie-scope ") {
                    socket.write_all(b"HTTP/1.1 200 OK\r\nSet-Cookie: private=path-only; Path=/private; Secure; HttpOnly\r\nSet-Cookie: expired=gone; Path=/; Max-Age=0; HttpOnly\r\nSet-Cookie: invalid=foreign; Domain=dashboard.example.test; Path=/; HttpOnly\r\nSet-Cookie: visible=page-managed; Path=/\r\nSet-Cookie: __Host-invalid=prefix; Domain=mesh.example.test; Secure; Path=/; HttpOnly\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await.unwrap();
                    return;
                }
                if request.starts_with("GET /cookie-rotate ") {
                    socket.write_all(b"HTTP/1.1 200 OK\r\nSet-Cookie: xids=rotated-session; Domain=mesh.example.test; Secure; HttpOnly; SameSite=Lax\r\nSet-Cookie: xids.sig=rotated-signature; Domain=mesh.example.test; Secure; HttpOnly; SameSite=Lax\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await.unwrap();
                    return;
                }
                if request.starts_with("GET /cookie-overflow ") {
                    let mut reply = "HTTP/1.1 200 OK\r\n".to_string();
                    for i in 0..129 { reply.push_str(&format!("Set-Cookie: overflow{i}=bad; Path=/; HttpOnly\r\n")); }
                    reply.push_str("Content-Length: 0\r\nConnection: close\r\n\r\n");
                    socket.write_all(reply.as_bytes()).await.unwrap();
                    return;
                }
                if request.to_ascii_lowercase().contains("sec-websocket-key:") {
                    let reply = VALID.replace("\r\n\r\n", "\r\nSec-WebSocket-Protocol: binary\r\nSet-Cookie: socket_session=rotated; Path=/; Secure; HttpOnly; SameSite=Lax\r\n\r\n");
                    socket.write_all(reply.as_bytes()).await.unwrap();
                    let mut frame = [0u8; 8];
                    while socket.read_exact(&mut frame).await.is_ok() {
                        if socket.write_all(&[0x81, 2, b'h', b'i']).await.is_err() { break; }
                    }
                    return;
                }
                if request.starts_with("GET /redirect ") {
                    socket.write_all(b"HTTP/1.1 302 Found\r\nLocation: https://unconfigured.invalid/control?secret=redirect\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await.unwrap();
                    return;
                }
                let body = "<!doctype html><html><head></head><body>control</body></html>";
                let cookie = if mesh { "mesh_session=mesh-only; Domain=mesh.example.test; Path=/; HttpOnly" }
                    else { "dashboard_session=dashboard-only; Path=/; HttpOnly" };
                socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nSet-Cookie: {cookie}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).as_bytes()).await.unwrap();
                if request.starts_with("GET /slow ") {
                    slow.add_permits(1);
                    let mut byte = [0u8; 1];
                    let _ = socket.read(&mut byte).await;
                } else { socket.write_all(body.as_bytes()).await.unwrap(); }
            });
        }
    });
    Peer {
        trusted,
        untrusted,
        relaxed,
        connects,
        seen,
        started,
        task,
    }
}

async fn fixture(peer: &Peer, mesh_client: reqwest::Client) -> FixtureProxy {
    let seed = proxy(SOURCE.into(), peer.relaxed.clone()).await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let origin = format!("http://p{}.localhost:{port}", uuid::Uuid::new_v4().simple());
    let mesh = tactical_mesh::TacticalMeshRoute::new(
        Some(ReviewedApplicationProfile::TacticalRmm),
        &reqwest::Url::parse(SOURCE).unwrap(),
        Some(MESH),
        &origin,
        mesh_client,
    )
    .unwrap();
    let network = ProxyNetworkState::default()
        .with_tactical_mesh(mesh)
        .with_reviewed_application_profile(Some(ReviewedApplicationProfile::TacticalRmm));
    let mut policy = HttpProxyPolicy::default();
    policy.query_parameters.push(proxy_policy::QueryParameter {
        name: "source_secret".into(),
        value: "saved-query".into(),
    });
    let state = Arc::new(AxumProxyState {
        network: Arc::new(network),
        proxy_origin: origin.clone(),
        proxy_authority: origin.trim_start_matches("http://").into(),
        username: Arc::new(std::sync::RwLock::new("saved-user".into())),
        password: Arc::new(std::sync::RwLock::new("saved-password".into())),
        upstream_auth_mode: UpstreamAuthMode::Basic,
        custom_headers: HashMap::from([("X-Dashboard-Secret".into(), "saved-header".into())]),
        proxy_policy: policy,
        auto_login_armed: Arc::new(AtomicBool::new(true)),
        auto_login_nonce: Arc::new(std::sync::RwLock::new(Some("saved-nonce".into()))),
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

fn config(html: &str) -> serde_json::Value {
    serde_json::from_str(
        html.split_once("var sorngNetworkClient=installWebNetworkClient(")
            .unwrap()
            .1
            .split_once(",function(detail)")
            .unwrap()
            .0,
    )
    .unwrap()
}
fn request(fixture: &FixtureProxy, origin: &str, path: &str) -> reqwest::RequestBuilder {
    client()
        .get(format!("{}{path}", fixture.base))
        .header("Host", origin.trim_start_matches("http://"))
        .header("Origin", origin)
}
async fn root(fixture: &FixtureProxy) -> String {
    let response = request(
        fixture,
        &fixture.state.proxy_origin,
        &format!("/?__sorng_navigation_v1={TOKEN}"),
    )
    .header("Sec-Fetch-Dest", "iframe")
    .header("Sec-Fetch-Mode", "navigate")
    .send()
    .await
    .unwrap();
    assert_eq!(response.status(), 200);
    let csp = response.headers()["content-security-policy"]
        .to_str()
        .unwrap()
        .to_string();
    let cfg = config(&response.text().await.unwrap());
    let alias = cfg["tacticalRmmMesh"]["proxyOrigin"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(cfg["tacticalRmmMesh"]["upstreamOrigin"], MESH);
    assert!(csp.contains(&format!("frame-src 'self' {alias}")));
    assert!(csp.contains(&format!(
        "connect-src 'self' {}",
        alias.replacen("http://", "ws://", 1)
    )));
    assert!(!csp.contains(MESH));
    alias
}
fn socket_request(fixture: &FixtureProxy, alias: &str, sequence: u64) -> reqwest::RequestBuilder {
    socket_request_without_origin(fixture, alias, sequence).header("Origin", alias)
}
fn socket_request_without_origin(
    fixture: &FixtureProxy,
    alias: &str,
    sequence: u64,
) -> reqwest::RequestBuilder {
    // The caller supplies exactly one Origin. RequestBuilder::header appends;
    // reusing request() would accidentally send both alias and dashboard.
    client()
        .get(format!(
            "{}/meshrelay.ashx?auth=mesh-token%2F+&__sorng_ws_document_v1={sequence}",
            fixture.base
        ))
        .header("Host", alias.trim_start_matches("http://"))
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", KEY)
        .header("Sec-WebSocket-Protocol", "binary")
}

#[tokio::test]
async fn tactical_mesh_dashboard_socket_translates_only_exact_approved_origin_and_keeps_cookie_scope(
) {
    let peer = peer(false).await;
    let fixture = fixture(&peer, peer.trusted.clone()).await;
    let alias = root(&fixture).await;
    let source_url = reqwest::Url::parse(&fixture.state.proxy_origin).unwrap();
    let mesh_url = reqwest::Url::parse(&alias).unwrap();
    let jar = Arc::new(reqwest::cookie::Jar::default());
    jar.add_cookie_str("dashboard_session=private-dashboard; Path=/", &source_url);
    jar.add_cookie_str("mesh_session=synthetic-mesh; Path=/", &mesh_url);
    let browser = reqwest::Client::builder()
        .no_proxy()
        .cookie_provider(jar)
        .resolve(
            mesh_url.host_str().unwrap(),
            fixture.base.trim_start_matches("http://").parse().unwrap(),
        )
        .timeout(Duration::from_secs(3))
        .build()
        .unwrap();
    let response = browser
        .get(format!(
            "{alias}/meshrelay.ashx?auth=synthetic%2F+&__sorng_ws_document_v1=1"
        ))
        .header("Origin", &fixture.state.proxy_origin)
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", KEY)
        .header("Sec-WebSocket-Protocol", "binary")
        .header("User-Agent", "Synthetic native browser")
        .header(
            "Referer",
            format!("{}/private-dashboard", fixture.state.proxy_origin),
        )
        .send()
        .await
        .unwrap();
    let mut socket = echo(response).await;
    let seen = peer.seen.lock().unwrap().clone();
    let upgrade = seen
        .iter()
        .find(|message| message.starts_with("GET /meshrelay.ashx"))
        .unwrap();
    assert!(upgrade.starts_with("GET /meshrelay.ashx?auth=synthetic%2F+ HTTP/1.1"));
    assert!(upgrade.contains(&format!("origin: {SOURCE}\r\n")));
    assert!(upgrade.contains("user-agent: Synthetic native browser\r\n"));
    assert!(upgrade.contains("cookie: mesh_session=synthetic-mesh\r\n"));
    for denied in [
        "private-dashboard",
        "saved-",
        "source_secret",
        "referer:",
        "__sorng",
        "localhost",
    ] {
        assert!(!upgrade.contains(denied), "unexpected field {denied}");
    }
    assert!(peer
        .connects
        .lock()
        .unwrap()
        .iter()
        .any(|message| message.starts_with("CONNECT mesh.example.test:8443 ")));
    fixture.state.network.document_issued(2, false);
    fixture.state.network.activate_document(2).unwrap();
    let mut byte = [0; 1];
    assert!(matches!(
        tokio::time::timeout(Duration::from_secs(2), socket.read(&mut byte)).await,
        Ok(Ok(0)) | Ok(Err(_))
    ));
}

#[tokio::test]
async fn tactical_mesh_dashboard_socket_requires_exact_origin_alias_and_unambiguous_active_root() {
    let peer = peer(false).await;
    let fixture = fixture(&peer, peer.trusted.clone()).await;
    let alias = root(&fixture).await;
    let before = peer.connects.lock().unwrap().len();
    assert_eq!(
        socket_request_without_origin(&fixture, &alias, 1)
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    for query in [
        "",
        "__sorng_ws_document_v1=0",
        "__sorng_ws_document_v1=2",
        "__sorng_ws_document_v1=1&__sorng_ws_document_v1=1",
        "%5f%5fsorng_ws_document_v1=1",
        "__sorng_ws_document_v1=%31",
    ] {
        let mut request = socket_request_without_origin(&fixture, &alias, 1)
            .header("Origin", &fixture.state.proxy_origin)
            .build()
            .unwrap();
        request.url_mut().set_query(Some(query));
        assert_eq!(client().execute(request).await.unwrap().status(), 410);
    }
    for origin in [
        SOURCE,
        "null",
        "http://foreign.localhost:1234",
        "https://mesh.example.test:8443",
    ] {
        let response = socket_request_without_origin(&fixture, &alias, 1)
            .header("Origin", origin)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 410);
    }
    let mut duplicate = socket_request_without_origin(&fixture, &alias, 1)
        .header("Origin", &fixture.state.proxy_origin)
        .build()
        .unwrap();
    duplicate
        .headers_mut()
        .append("origin", fixture.state.proxy_origin.parse().unwrap());
    assert_eq!(client().execute(duplicate).await.unwrap().status(), 410);
    let mut wrong_alias = socket_request_without_origin(&fixture, &alias, 1)
        .header("Origin", &fixture.state.proxy_origin)
        .build()
        .unwrap();
    wrong_alias.headers_mut().insert(
        "host",
        "pffffffffffffffffffffffffffffffff.localhost:1"
            .parse()
            .unwrap(),
    );
    assert_eq!(client().execute(wrong_alias).await.unwrap().status(), 410);
    for path in [AUTOLOGIN_PATH, tactical_rmm::PATH] {
        let mut request = socket_request_without_origin(&fixture, &alias, 1)
            .header("Origin", &fixture.state.proxy_origin)
            .build()
            .unwrap();
        request.url_mut().set_path(path);
        assert_eq!(client().execute(request).await.unwrap().status(), 410);
    }
    let mut wrong_parent = socket_request_without_origin(&fixture, &alias, 1)
        .header("Origin", &fixture.state.proxy_origin)
        .build()
        .unwrap();
    wrong_parent
        .url_mut()
        .query_pairs_mut()
        .append_pair("__sorng_popup_parent_v1", "2");
    assert_eq!(client().execute(wrong_parent).await.unwrap().status(), 403);
    // Matching Origin/root grants no ordinary HTTP or frame access.
    for destination in ["empty", "iframe"] {
        let mut request = request(&fixture, &alias, "/control")
            .header("Sec-Fetch-Dest", destination)
            .build()
            .unwrap();
        request
            .headers_mut()
            .insert("origin", fixture.state.proxy_origin.parse().unwrap());
        assert_eq!(client().execute(request).await.unwrap().status(), 410);
    }
    fixture.state.network.document_issued(2, false);
    fixture.state.network.activate_document(2).unwrap();
    assert_eq!(
        socket_request_without_origin(&fixture, &alias, 1)
            .header("Origin", &fixture.state.proxy_origin)
            .send()
            .await
            .unwrap()
            .status(),
        410
    );
    assert_eq!(peer.connects.lock().unwrap().len(), before);
}

#[tokio::test]
async fn tactical_mesh_dashboard_socket_proxy_or_tls_failure_never_falls_back() {
    for reject_proxy in [false, true] {
        let peer = peer(reject_proxy).await;
        let transport = if reject_proxy {
            peer.trusted.clone()
        } else {
            peer.untrusted.clone()
        };
        let fixture = fixture(&peer, transport).await;
        let alias = root(&fixture).await;
        let connects_before = peer.connects.lock().unwrap().len();
        let requests_before = peer.seen.lock().unwrap().len();
        assert_eq!(
            socket_request_without_origin(&fixture, &alias, 1)
                .header("Origin", &fixture.state.proxy_origin)
                .send()
                .await
                .unwrap()
                .status(),
            502
        );
        assert_eq!(peer.connects.lock().unwrap().len(), connects_before + 1);
        assert_eq!(peer.seen.lock().unwrap().len(), requests_before);
    }
}

#[tokio::test]
async fn tactical_mesh_exact_alias_http_cookies_bootstrap_and_websocket_are_isolated() {
    let peer = peer(false).await;
    let fixture = fixture(&peer, peer.trusted.clone()).await;
    let alias = root(&fixture).await;
    let before_nonce = fixture.state.auto_login_nonce.read().unwrap().clone();
    let response = request(
        &fixture,
        &alias,
        "/control?auth=mesh-token%2f+&__sorng_popup_parent_v1=1",
    )
    .header("Sec-Fetch-Dest", "iframe")
    .header("Sec-Fetch-Mode", "navigate")
    .header(
        "Referer",
        format!("{}/?private=source-referrer", fixture.state.proxy_origin),
    )
    .send()
    .await
    .unwrap();
    assert_eq!(response.status(), 200);
    let cookie = response.headers()["set-cookie"].to_str().unwrap();
    assert!(
        cookie.contains("mesh_session=mesh-only") && !cookie.to_lowercase().contains("domain=")
    );
    let cfg = config(&response.text().await.unwrap());
    assert_eq!(cfg["sourceOrigin"], MESH);
    assert_eq!(cfg["proxyOrigin"], alias);
    assert_eq!(cfg["documentSequence"], 1);
    assert_eq!(cfg["popupParentDocument"], 1);
    assert_eq!(cfg["popupTabs"], false);
    assert!(cfg.get("tacticalRmmApi").is_none() && cfg.get("tacticalRmmMesh").is_none());
    assert!(cfg["requestGeneration"].is_null());
    assert!(fixture.state.network.activate_document(2).is_err());
    assert_eq!(
        *fixture.state.auto_login_nonce.read().unwrap(),
        before_nonce
    );
    let response = socket_request(&fixture, &alias, 1)
        .header("Cookie", "mesh_session=mesh-only")
        .send()
        .await
        .unwrap();
    assert_eq!(response.headers()["sec-websocket-protocol"], "binary");
    let _socket = echo(response).await;
    let requests = peer.seen.lock().unwrap().clone();
    let mesh: Vec<_> = requests
        .iter()
        .filter(|r| r.to_lowercase().contains("host: mesh.example.test:8443"))
        .collect();
    assert_eq!(mesh.len(), 2);
    assert!(mesh[0].starts_with("GET /control?auth=mesh-token%2f+ HTTP/1.1"));
    assert!(mesh[1].starts_with("GET /meshrelay.ashx?auth=mesh-token%2F+ HTTP/1.1"));
    assert!(mesh[1].contains("mesh_session=mesh-only"));
    for message in mesh {
        let lower = message.to_lowercase();
        for denied in [
            "saved-",
            "dashboard_session",
            "x-dashboard-secret",
            "source_secret",
            "authorization:",
            "referer:",
            "__sorng_",
            "localhost",
        ] {
            assert!(!lower.contains(denied), "{denied} leaked in {message}");
        }
        assert!(lower.contains("origin: https://mesh.example.test:8443"));
    }
    assert!(peer
        .connects
        .lock()
        .unwrap()
        .iter()
        .any(|r| r.starts_with("CONNECT mesh.example.test:8443 ")));
    let logs =
        serde_json::to_string(&fixture.state.global_sessions.lock().unwrap().request_log).unwrap();
    assert!(!logs.contains("mesh-token") && !logs.contains("saved-nonce"));
}

#[tokio::test]
async fn tactical_mesh_embedded_login_keeps_signed_http_only_cookies_through_redirect_and_socket() {
    let peer = peer(false).await;
    let fixture = fixture(&peer, peer.trusted.clone()).await;
    let alias = root(&fixture).await;
    // No browser cookie jar: embedded third-party cookies may be unavailable.
    let response = request(&fixture, &alias, "/mesh-login?login=synthetic%2F+")
        .header("Sec-Fetch-Dest", "iframe")
        .header("Sec-Fetch-Mode", "navigate")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(
        request(&fixture, &alias, "/commander.ashx")
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    let mut upgrade = socket_request(&fixture, &alias, 1).build().unwrap();
    upgrade.url_mut().set_path("/control.ashx");
    upgrade
        .url_mut()
        .set_query(Some("__sorng_ws_document_v1=1"));
    let _socket = echo(client().execute(upgrade).await.unwrap()).await;
    let requests = peer.seen.lock().unwrap().clone();
    let control = requests
        .iter()
        .find(|r| r.starts_with("GET /control.ashx "))
        .unwrap();
    assert!(control.contains("xids=synthetic-session"));
    assert!(control.contains("xids.sig=synthetic-signature"));
    assert!(!control.contains("login=") && !control.contains("__sorng"));
    let dashboard = request(
        &fixture,
        &fixture.state.proxy_origin,
        "/dashboard-after-mesh",
    )
    .send()
    .await
    .unwrap();
    assert_eq!(dashboard.status(), 200);
    let requests = peer.seen.lock().unwrap();
    let dashboard = requests
        .iter()
        .find(|r| r.starts_with("GET /dashboard-after-mesh"))
        .unwrap();
    assert!(!dashboard.contains("xids") && !dashboard.contains("synthetic-signature"));
}

#[tokio::test]
async fn tactical_mesh_signed_pair_rotation_uses_effective_cookie_path() {
    let peer = peer(false).await;
    let fixture = fixture(&peer, peer.trusted.clone()).await;
    let alias = root(&fixture).await;
    for path in ["/mesh-login-final", "/cookie-rotate", "/after-rotation"] {
        assert_eq!(
            request(&fixture, &alias, path)
                .send()
                .await
                .unwrap()
                .status(),
            200
        );
    }
    let seen = peer.seen.lock().unwrap();
    let message = seen
        .iter()
        .find(|r| r.starts_with("GET /after-rotation "))
        .unwrap();
    assert!(
        message.contains("xids=rotated-session") && message.contains("xids.sig=rotated-signature")
    );
    assert!(!message.contains("synthetic-session") && !message.contains("synthetic-signature"));
}

#[tokio::test]
async fn tactical_mesh_logout_and_root_replacement_do_not_reuse_retained_login_cookies() {
    let peer = peer(false).await;
    let fixture = fixture(&peer, peer.trusted.clone()).await;
    let alias = root(&fixture).await;
    assert_eq!(
        request(&fixture, &alias, "/mesh-login?login=synthetic%2F+")
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    assert_eq!(
        request(&fixture, &alias, "/mesh-logout")
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    // An old browser copy cannot resurrect a native server-side deletion.
    let mut upgrade = socket_request(&fixture, &alias, 1)
        .header(
            "Cookie",
            "xids=synthetic-session; xids.sig=synthetic-signature",
        )
        .build()
        .unwrap();
    upgrade.url_mut().set_path("/control.ashx");
    upgrade
        .url_mut()
        .set_query(Some("__sorng_ws_document_v1=1"));
    let response = client().execute(upgrade).await.unwrap();
    assert_eq!(response.status(), 101);
    let mut socket = response.upgrade().await.unwrap();
    let mut frame_header = [0; 2];
    socket.read_exact(&mut frame_header).await.unwrap();
    assert_eq!(frame_header[0], 0x81);
    let mut message = vec![0; usize::from(frame_header[1])];
    socket.read_exact(&mut message).await.unwrap();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&message).unwrap()["cause"],
        "noauth"
    );
    assert_eq!(
        request(&fixture, &alias, "/mesh-login?login=synthetic%2F+")
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    fixture.state.network.document_issued(2, false);
    fixture.state.network.activate_document(2).unwrap();
    let new_alias = fixture
        .state
        .network
        .tactical_mesh
        .as_ref()
        .unwrap()
        .manifest(2, &fixture.state.network)
        .unwrap()["proxyOrigin"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(
        request(&fixture, &new_alias, "/mesh-control")
            .send()
            .await
            .unwrap()
            .status(),
        404
    );
    let before = peer.seen.lock().unwrap().len();
    assert_eq!(
        request(&fixture, &alias, "/mesh-control")
            .send()
            .await
            .unwrap()
            .status(),
        410
    );
    assert_eq!(peer.seen.lock().unwrap().len(), before);
}

#[tokio::test]
async fn tactical_mesh_final_response_cookie_scope_expiry_rotation_and_limits_are_preserved() {
    let peer = peer(false).await;
    let fixture = fixture(&peer, peer.trusted.clone()).await;
    let alias = root(&fixture).await;
    assert_eq!(
        request(&fixture, &alias, "/commander.ashx")
            .send()
            .await
            .unwrap()
            .status(),
        404
    );
    assert_eq!(
        request(&fixture, &alias, "/mesh-login-final")
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    assert_eq!(
        request(&fixture, &alias, "/commander.ashx")
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    assert_eq!(
        request(&fixture, &alias, "/cookie-scope")
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    for path in ["/private/check", "/public/check"] {
        assert_eq!(
            request(&fixture, &alias, path)
                .header(
                    "Cookie",
                    "expired=stale; private=counterfeit; js_preference=dark"
                )
                .send()
                .await
                .unwrap()
                .status(),
            200
        );
    }
    let _socket = echo(socket_request(&fixture, &alias, 1).send().await.unwrap()).await;
    assert_eq!(
        request(&fixture, &alias, "/after-socket")
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    assert_eq!(
        request(&fixture, &alias, "/cookie-overflow")
            .send()
            .await
            .unwrap()
            .status(),
        400
    );
    assert_eq!(
        request(&fixture, &alias, "/after-overflow")
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    let seen = peer.seen.lock().unwrap();
    for path in [
        "/private/check",
        "/public/check",
        "/after-socket",
        "/after-overflow",
    ] {
        let message = seen
            .iter()
            .find(|r| r.starts_with(&format!("GET {path} ")))
            .unwrap();
        assert!(
            message.contains("xids=synthetic-session")
                && message.contains("xids.sig=synthetic-signature")
        );
        assert_eq!(
            message.contains("private=path-only"),
            path == "/private/check"
        );
        for denied in [
            "counterfeit",
            "expired=",
            "invalid=",
            "visible=",
            "overflow0=",
        ] {
            assert!(!message.contains(denied), "unexpected cookie {denied}");
        }
        if path.ends_with("check") {
            assert!(message.contains("js_preference=dark"));
        } else {
            assert!(message.contains("socket_session=rotated"));
        }
    }
}

#[tokio::test]
async fn tactical_mesh_alias_cookie_scope_retains_only_its_own_protected_session() {
    let peer = peer(false).await;
    let fixture = fixture(&peer, peer.trusted.clone()).await;
    let alias = root(&fixture).await;
    let address = fixture.base.trim_start_matches("http://").parse().unwrap();
    let jar = Arc::new(reqwest::cookie::Jar::default());
    let source_url = reqwest::Url::parse(&fixture.state.proxy_origin).unwrap();
    let mesh_url = reqwest::Url::parse(&alias).unwrap();
    jar.add_cookie_str("dashboard_session=browser-source; Path=/", &source_url);
    let browser = reqwest::Client::builder()
        .no_proxy()
        .cookie_provider(jar.clone())
        .resolve(source_url.host_str().unwrap(), address)
        .resolve(mesh_url.host_str().unwrap(), address)
        .build()
        .unwrap();
    let first = browser.get(format!("{alias}/asset")).send().await.unwrap();
    assert_eq!(first.status(), 200);
    let second = browser.get(format!("{alias}/asset2")).send().await.unwrap();
    assert_eq!(second.status(), 200);
    // The alias retains its own HttpOnly session if the browser withholds it.
    assert_eq!(
        request(&fixture, &alias, "/asset3")
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    browser
        .get(format!("{}/dashboard-asset", fixture.state.proxy_origin))
        .send()
        .await
        .unwrap();
    let seen = peer.seen.lock().unwrap();
    let first = seen.iter().find(|r| r.starts_with("GET /asset ")).unwrap();
    let second = seen.iter().find(|r| r.starts_with("GET /asset2 ")).unwrap();
    let third = seen.iter().find(|r| r.starts_with("GET /asset3 ")).unwrap();
    assert!(!first.to_lowercase().contains("cookie:"));
    assert!(second.contains("mesh_session=mesh-only") && !second.contains("browser-source"));
    assert!(third.contains("mesh_session=mesh-only") && !third.contains("browser-source"));
    let dashboard = seen
        .iter()
        .find(|r| r.starts_with("GET /dashboard-asset"))
        .unwrap();
    assert!(!dashboard.contains("mesh_session"));
}

#[tokio::test]
async fn tactical_mesh_alias_rejects_reserved_routes_foreign_origins_and_root_substitution_before_io(
) {
    let peer = peer(false).await;
    let fixture = fixture(&peer, peer.trusted.clone()).await;
    let alias = root(&fixture).await;
    let before = peer.connects.lock().unwrap().len();
    for path in [
        AUTOLOGIN_PATH,
        "/__sortofremoteng_auth",
        tactical_rmm::PATH,
        "/__sortofremoteng_google_cookie_v1",
    ] {
        assert_eq!(
            request(&fixture, &alias, path)
                .send()
                .await
                .unwrap()
                .status(),
            410
        );
    }
    assert_eq!(
        request(&fixture, &alias, "/control?__sorng_popup_parent_v1=2")
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        request(
            &fixture,
            &alias,
            &format!("/control?__sorng_navigation_v1={TOKEN}")
        )
        .send()
        .await
        .unwrap()
        .status(),
        403
    );
    assert_eq!(
        request(&fixture, &alias, "/asset")
            .header("Origin", &fixture.state.proxy_origin)
            .send()
            .await
            .unwrap()
            .status(),
        410
    );
    assert_eq!(
        request(
            &fixture,
            "http://p11111111111111111111111111111111.localhost:9999",
            "/asset"
        )
        .send()
        .await
        .unwrap()
        .status(),
        410
    );
    assert_eq!(
        socket_request(&fixture, &alias, 2)
            .send()
            .await
            .unwrap()
            .status(),
        410
    );
    assert_eq!(peer.connects.lock().unwrap().len(), before);
    assert_eq!(
        request(&fixture, &alias, "/redirect")
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(peer.connects.lock().unwrap().len(), before + 1);
    assert!(fixture.state.network.document_is_current(1));
}

#[tokio::test]
async fn tactical_mesh_root_change_cancels_parser_body_and_socket_and_never_rebinds_old_alias() {
    let peer = peer(false).await;
    let fixture = fixture(&peer, peer.trusted.clone()).await;
    let alias = root(&fixture).await;
    let mut socket = echo(socket_request(&fixture, &alias, 1).send().await.unwrap()).await;
    let slow = tokio::spawn(request(&fixture, &alias, "/slow").send());
    tokio::time::timeout(Duration::from_secs(2), peer.started.acquire())
        .await
        .unwrap()
        .unwrap()
        .forget();
    fixture.state.network.document_issued(3, false);
    fixture.state.network.activate_document(3).unwrap();
    assert_eq!(slow.await.unwrap().unwrap().status(), 410);
    let mut byte = [0u8; 1];
    assert!(matches!(
        tokio::time::timeout(Duration::from_secs(2), socket.read(&mut byte)).await,
        Ok(Ok(0)) | Ok(Err(_))
    ));
    assert!(!crate::webview_origins::allows_frame_url(&alias));
    let before = peer.connects.lock().unwrap().len();
    for path in ["/control", "/asset", "/control?__sorng_popup_parent_v1=3"] {
        assert_eq!(
            request(&fixture, &alias, path)
                .send()
                .await
                .unwrap()
                .status(),
            410
        );
    }
    assert_eq!(
        socket_request(&fixture, &alias, 3)
            .send()
            .await
            .unwrap()
            .status(),
        410
    );
    assert_eq!(peer.connects.lock().unwrap().len(), before);
}

#[tokio::test]
async fn tactical_mesh_pending_alias_order_is_bounded_and_slow_older_bootstrap_cannot_evict_newest()
{
    let peer = peer(false).await;
    let fixture = fixture(&peer, peer.trusted.clone()).await;
    let alias1 = root(&fixture).await;
    let network = &fixture.state.network;
    let route = network.tactical_mesh.as_ref().unwrap();
    network.document_issued(2, false);
    network.document_issued(3, false);
    let third = route.manifest(3, network).unwrap();
    let alias3 = third["proxyOrigin"].as_str().unwrap();
    assert!(route.manifest(2, network).is_none());
    assert_eq!(route.manifest(1, network).unwrap()["proxyOrigin"], alias1);
    assert!(crate::webview_origins::allows_frame_url(alias3));
    assert_eq!(
        request(&fixture, alias3, "/asset")
            .send()
            .await
            .unwrap()
            .status(),
        410
    );
    network.activate_document(2).unwrap();
    assert!(crate::webview_origins::allows_frame_url(alias3));
    network.activate_document(3).unwrap();
    assert_eq!(route.manifest(3, network).unwrap(), third);
    assert!(!crate::webview_origins::allows_frame_url(&alias1));
    assert!(route.manifest(2, network).is_none());
    assert_eq!(
        request(&fixture, alias3, "/asset")
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    network.revoke();
    assert!(!crate::webview_origins::allows_frame_url(alias3));
    assert!(route.manifest(3, network).is_none());
}

#[tokio::test]
async fn tactical_mesh_strict_tls_and_proxy_failure_never_fall_back_to_dashboard_client() {
    for proxy_failure in [false, true] {
        let peer = peer(proxy_failure).await;
        let transport = if proxy_failure {
            peer.trusted.clone()
        } else {
            peer.untrusted.clone()
        };
        let fixture = fixture(&peer, transport).await;
        let alias = root(&fixture).await;
        let response = request(&fixture, &alias, "/control?auth=never-log-token")
            .send()
            .await
            .unwrap();
        assert!(response.status().is_server_error());
        assert!(!response.text().await.unwrap().contains("never-log-token"));
        assert_eq!(
            socket_request(&fixture, &alias, 1)
                .send()
                .await
                .unwrap()
                .status(),
            502
        );
        assert!(peer
            .seen
            .lock()
            .unwrap()
            .iter()
            .all(|r| !r.to_lowercase().contains("host: mesh.example.test")));
        assert!(
            peer.connects
                .lock()
                .unwrap()
                .iter()
                .filter(|r| r.starts_with("CONNECT mesh.example.test:8443 "))
                .count()
                >= 2
        );
        let logs =
            serde_json::to_string(&fixture.state.global_sessions.lock().unwrap().request_log)
                .unwrap();
        assert!(!logs.contains("never-log-token") && !logs.contains("mesh-token"));
    }
}

#[test]
fn tactical_mesh_configuration_is_explicit_canonical_https_and_separate() {
    let make = |configured, profile| {
        tactical_mesh::TacticalMeshRoute::new(
            profile,
            &reqwest::Url::parse(SOURCE).unwrap(),
            configured,
            "http://p0123456789abcdef0123456789abcdef.localhost:43210",
            client(),
        )
    };
    let profile = Some(ReviewedApplicationProfile::TacticalRmm);
    assert!(make(None, profile).unwrap().is_none());
    for origin in [
        MESH,
        "https://mesh.example.test",
        "https://127.0.0.1:4433",
        "https://[::1]:4433",
    ] {
        assert!(make(Some(origin), profile).unwrap().is_some(), "{origin}");
    }
    for origin in [
        SOURCE,
        "http://mesh.example.test",
        "https://mesh.example.test:0",
        "https://mesh.example.test.",
        "https://mesh.example.test/path",
        "https://mesh.example.test/?secret=1",
        "https://mesh.example.test/#fragment",
        "https://user@mesh.example.test",
        "https://*.example.test",
        "https://MESH.example.test",
    ] {
        assert!(make(Some(origin), profile).is_err(), "{origin}");
    }
    assert!(make(Some(MESH), None).is_err());
}
