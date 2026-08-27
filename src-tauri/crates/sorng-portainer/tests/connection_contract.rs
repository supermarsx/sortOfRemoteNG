//! Loopback HTTP contract tests (hand-rolled `TcpListener` server, no mock
//! crate — same pattern as `sorng-netbox/tests/connection_contract.rs`).

use base64::Engine;
use sorng_portainer::client::PortainerClient;
use sorng_portainer::error::PortainerErrorKind;
use sorng_portainer::service::PortainerService;
use sorng_portainer::types::{PortainerAuthMode, PortainerConnectionConfig};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

struct Expected {
    method: &'static str,
    path: &'static str,
    /// Header line that must be present (case-insensitive), if any.
    require_header: Option<String>,
    /// Header name that must be absent, if any.
    forbid_header: Option<&'static str>,
    status: &'static str,
    body: Vec<u8>,
}

fn json(method: &'static str, path: &'static str, status: &'static str, body: &str) -> Expected {
    Expected {
        method,
        path,
        require_header: None,
        forbid_header: None,
        status,
        body: body.as_bytes().to_vec(),
    }
}

fn with_header(mut e: Expected, header: impl Into<String>) -> Expected {
    e.require_header = Some(header.into());
    e
}

fn without_header(mut e: Expected, header: &'static str) -> Expected {
    e.forbid_header = Some(header);
    e
}

struct Server {
    addr: std::net::SocketAddr,
    task: tokio::task::JoinHandle<()>,
    accepted: Arc<AtomicUsize>,
    auth_posts: Arc<AtomicUsize>,
}

async fn spawn_server(responses: Vec<Expected>) -> Server {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let accepted = Arc::new(AtomicUsize::new(0));
    let auth_posts = Arc::new(AtomicUsize::new(0));
    let accepted2 = accepted.clone();
    let auth_posts2 = auth_posts.clone();
    let task = tokio::spawn(async move {
        for expected in responses {
            let (mut stream, _) = listener.accept().await.unwrap();
            accepted2.fetch_add(1, Ordering::SeqCst);
            let mut request = Vec::new();
            loop {
                let mut chunk = [0_u8; 2048];
                let read = stream.read(&mut chunk).await.unwrap();
                assert!(read > 0, "client closed before headers");
                request.extend_from_slice(&chunk[..read]);
                if let Some(pos) = request.windows(4).position(|w| w == b"\r\n\r\n") {
                    let head = String::from_utf8_lossy(&request[..pos]).to_string();
                    let content_length = head
                        .lines()
                        .find_map(|l| {
                            let (k, v) = l.split_once(':')?;
                            k.eq_ignore_ascii_case("content-length")
                                .then(|| v.trim().parse::<usize>().ok())
                                .flatten()
                        })
                        .unwrap_or(0);
                    if request.len() >= pos + 4 + content_length {
                        break;
                    }
                }
            }
            let text = String::from_utf8_lossy(&request).to_string();
            let request_line = text.lines().next().unwrap().to_string();
            assert_eq!(
                request_line,
                format!("{} {} HTTP/1.1", expected.method, expected.path),
                "unexpected request"
            );
            if expected.method == "POST" && expected.path == "/api/auth" {
                auth_posts2.fetch_add(1, Ordering::SeqCst);
                assert!(text.contains("\"username\":\"admin\""));
                assert!(text.contains("\"password\":\"secret-pw\""));
            }
            if let Some(ref h) = expected.require_header {
                assert!(
                    text.lines().any(|l| l.eq_ignore_ascii_case(h)),
                    "missing header {h} in:\n{text}"
                );
            }
            if let Some(name) = expected.forbid_header {
                assert!(
                    !text
                        .lines()
                        .any(|l| l.to_ascii_lowercase().starts_with(&format!("{name}:"))),
                    "header {name} must be absent in:\n{text}"
                );
            }
            let mut response = format!(
                "HTTP/1.1 {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                expected.status,
                expected.body.len()
            )
            .into_bytes();
            response.extend_from_slice(&expected.body);
            stream.write_all(&response).await.unwrap();
            stream.shutdown().await.ok();
        }
    });
    Server {
        addr,
        task,
        accepted,
        auth_posts,
    }
}

fn jwt(exp: i64) -> String {
    let payload = format!(r#"{{"id":1,"username":"admin","role":1,"exp":{exp}}}"#);
    let p = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(payload);
    format!("eyJhbGciOiJIUzI1NiJ9.{p}.sig")
}

fn far_future() -> i64 {
    chrono::Utc::now().timestamp() + 8 * 3600
}

fn password_config(addr: std::net::SocketAddr) -> PortainerConnectionConfig {
    PortainerConnectionConfig {
        base_url: format!("http://{addr}/"),
        username: Some("admin".into()),
        password: Some("secret-pw".into()),
        api_key: None,
        skip_tls_verify: Some(false),
        acknowledge_invalid_cert_risk: false,
        timeout_secs: Some(5),
        proxy_url: None,
    }
}

fn api_key_config(addr: std::net::SocketAddr) -> PortainerConnectionConfig {
    PortainerConnectionConfig {
        api_key: Some("ptr_test_key".into()),
        username: None,
        password: None,
        ..password_config(addr)
    }
}

const STATUS: &str = r#"{"Version":"2.21.4","InstanceID":"abc-123"}"#;
const ME: &str = r#"{"Id":1,"Username":"admin","Role":1}"#;
const ENDPOINTS: &str = r#"[{"Id":1,"Name":"local","Type":1,"URL":"unix:///var/run/docker.sock","Status":1,"GroupId":1,"Snapshots":[{"RunningContainerCount":2,"StoppedContainerCount":0}]}]"#;

fn auth_ok() -> Expected {
    json(
        "POST",
        "/api/auth",
        "200 OK",
        &format!(r#"{{"jwt":"{}"}}"#, jwt(far_future())),
    )
}

fn bearer() -> String {
    format!("authorization: Bearer {}", jwt(far_future()))
}

#[tokio::test]
async fn password_login_sets_bearer_and_ping_reports_identity() {
    let server = spawn_server(vec![
        auth_ok(),
        without_header(
            json("GET", "/api/system/status", "200 OK", STATUS),
            "authorization",
        ),
        with_header(json("GET", "/api/users/me", "200 OK", ME), bearer()),
    ])
    .await;
    let mut svc = PortainerService::new(None);
    let summary = svc
        .connect("p".into(), password_config(server.addr))
        .await
        .unwrap();
    assert_eq!(summary.version.as_deref(), Some("2.21.4"));
    assert_eq!(summary.instance_id.as_deref(), Some("abc-123"));
    assert_eq!(summary.user.as_deref(), Some("admin"));
    assert_eq!(summary.role, Some(1));
    assert_eq!(summary.auth_mode, PortainerAuthMode::Password);
    assert_eq!(svc.list_connections(), vec!["p"]);
    assert_eq!(
        svc.connect("p".into(), password_config(server.addr))
            .await
            .unwrap_err()
            .kind,
        PortainerErrorKind::AlreadyConnected
    );
    assert_eq!(
        svc.web_ui_url("p").unwrap(),
        format!("http://{}", server.addr)
    );
    svc.disconnect("p").await.unwrap();
    assert!(svc.list_connections().is_empty());
    server.task.await.unwrap();
    assert_eq!(server.auth_posts.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn api_key_mode_sends_x_api_key_and_never_logs_in() {
    let server = spawn_server(vec![
        json("GET", "/api/system/status", "200 OK", STATUS),
        without_header(
            with_header(
                json("GET", "/api/users/me", "200 OK", ME),
                "x-api-key: ptr_test_key",
            ),
            "authorization",
        ),
    ])
    .await;
    let mut svc = PortainerService::new(None);
    let summary = svc
        .connect("k".into(), api_key_config(server.addr))
        .await
        .unwrap();
    assert_eq!(summary.auth_mode, PortainerAuthMode::ApiKey);
    server.task.await.unwrap();
    assert_eq!(server.auth_posts.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn unauthorized_then_ok_triggers_exactly_one_relogin() {
    let server = spawn_server(vec![
        auth_ok(),
        json("GET", "/api/system/status", "200 OK", STATUS),
        json("GET", "/api/users/me", "200 OK", ME),
        json(
            "GET",
            "/api/endpoints",
            "401 Unauthorized",
            r#"{"message":"Unauthorized"}"#,
        ),
        auth_ok(),
        with_header(json("GET", "/api/endpoints", "200 OK", ENDPOINTS), bearer()),
        // second scenario: 401 twice → TokenExpired after the single retry
        json("GET", "/api/stacks", "401 Unauthorized", "{}"),
        auth_ok(),
        json("GET", "/api/stacks", "401 Unauthorized", "{}"),
    ])
    .await;
    let mut svc = PortainerService::new(None);
    svc.connect("p".into(), password_config(server.addr))
        .await
        .unwrap();
    let eps = svc.list_endpoints("p").await.unwrap();
    assert_eq!(eps.len(), 1);
    assert_eq!(eps[0].name, "local");
    assert_eq!(eps[0].snapshots[0].running_container_count, Some(2));
    assert_eq!(eps[0].snapshots[0].stopped_container_count, Some(0));
    assert_eq!(server.auth_posts.load(Ordering::SeqCst), 2);

    let err = svc.list_stacks("p").await.unwrap_err();
    assert_eq!(err.kind, PortainerErrorKind::TokenExpired);
    server.task.await.unwrap();
    assert_eq!(server.auth_posts.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn api_key_401_is_authentication_failed_without_retry() {
    let server = spawn_server(vec![
        json("GET", "/api/system/status", "200 OK", STATUS),
        json("GET", "/api/users/me", "401 Unauthorized", "{}"),
    ])
    .await;
    let mut svc = PortainerService::new(None);
    let err = svc
        .connect("k".into(), api_key_config(server.addr))
        .await
        .unwrap_err();
    assert_eq!(err.kind, PortainerErrorKind::AuthenticationFailed);
    server.task.await.unwrap();
    assert_eq!(server.accepted.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn bad_password_maps_to_authentication_failed() {
    let server = spawn_server(vec![json(
        "POST",
        "/api/auth",
        "422 Unprocessable Entity",
        r#"{"message":"Invalid credentials"}"#,
    )])
    .await;
    let mut svc = PortainerService::new(None);
    let err = svc
        .connect("p".into(), password_config(server.addr))
        .await
        .unwrap_err();
    assert_eq!(err.kind, PortainerErrorKind::AuthenticationFailed);
    server.task.await.unwrap();
}

#[tokio::test]
async fn status_falls_back_to_legacy_path_and_users_me_404_uses_jwt_claims() {
    let server = spawn_server(vec![
        auth_ok(),
        json("GET", "/api/system/status", "404 Not Found", "{}"),
        json("GET", "/api/status", "200 OK", r#"{"Version":"2.18.0"}"#),
        json("GET", "/api/users/me", "404 Not Found", "{}"),
    ])
    .await;
    let mut svc = PortainerService::new(None);
    let summary = svc
        .connect("old".into(), password_config(server.addr))
        .await
        .unwrap();
    assert_eq!(summary.version.as_deref(), Some("2.18.0"));
    assert_eq!(summary.instance_id, None);
    assert_eq!(summary.user.as_deref(), Some("admin"));
    assert_eq!(summary.role, Some(1));
    server.task.await.unwrap();
}

#[tokio::test]
async fn container_operations_and_log_demux_end_to_end() {
    let mut logs = vec![1u8, 0, 0, 0, 0, 0, 0, 6];
    logs.extend_from_slice(b"hello\n");
    logs.extend_from_slice(&[2u8, 0, 0, 0, 0, 0, 0, 4]);
    logs.extend_from_slice(b"err\n");
    let containers = r#"[{"Id":"c1","Names":["/portainer"],"Image":"portainer/portainer-ce:lts","State":"running","Status":"Up","Ports":[],"Created":1}]"#;
    let server = spawn_server(vec![
        json("GET", "/api/system/status", "200 OK", STATUS),
        json("GET", "/api/users/me", "200 OK", ME),
        json(
            "GET",
            "/api/endpoints/1/docker/containers/json?all=1",
            "200 OK",
            containers,
        ),
        json(
            "POST",
            "/api/endpoints/1/docker/containers/c1/start",
            "304 Not Modified",
            "",
        ),
        json(
            "POST",
            "/api/endpoints/1/docker/containers/c1/stop",
            "204 No Content",
            "",
        ),
        json(
            "POST",
            "/api/endpoints/1/docker/containers/c1/restart",
            "204 No Content",
            "",
        ),
        json(
            "POST",
            "/api/endpoints/1/docker/containers/missing/start",
            "404 Not Found",
            r#"{"message":"No such container"}"#,
        ),
        Expected {
            method: "GET",
            path:
                "/api/endpoints/1/docker/containers/c1/logs?stdout=1&stderr=1&tail=50&timestamps=1",
            require_header: None,
            forbid_header: None,
            status: "200 OK",
            body: logs,
        },
        json(
            "GET",
            "/api/stacks",
            "200 OK",
            r#"[{"Id":7,"Name":"web","Type":2,"EndpointId":1,"Status":1}]"#,
        ),
        json("POST", "/api/stacks/7/stop?endpointId=1", "200 OK", "{}"),
        json(
            "POST",
            "/api/stacks/7/start?endpointId=1",
            "403 Forbidden",
            "{}",
        ),
    ])
    .await;
    let mut svc = PortainerService::new(None);
    svc.connect("k".into(), api_key_config(server.addr))
        .await
        .unwrap();
    let cs = svc.list_containers("k", 1, true).await.unwrap();
    assert_eq!(cs[0].names, vec!["portainer"]);
    svc.start_container("k", 1, "c1").await.unwrap();
    svc.stop_container("k", 1, "c1").await.unwrap();
    svc.restart_container("k", 1, "c1").await.unwrap();
    assert_eq!(
        svc.start_container("k", 1, "missing")
            .await
            .unwrap_err()
            .kind,
        PortainerErrorKind::NotFound
    );
    let lines = svc.container_logs("k", 1, "c1", 50).await.unwrap();
    assert_eq!(lines.len(), 2);
    assert_eq!(
        (lines[0].stream.as_str(), lines[0].text.as_str()),
        ("stdout", "hello")
    );
    assert_eq!(
        (lines[1].stream.as_str(), lines[1].text.as_str()),
        ("stderr", "err")
    );
    let stacks = svc.list_stacks("k").await.unwrap();
    assert_eq!(stacks[0].id, 7);
    svc.stop_stack("k", 7, 1).await.unwrap();
    assert_eq!(
        svc.start_stack("k", 7, 1).await.unwrap_err().kind,
        PortainerErrorKind::PermissionDenied
    );
    server.task.await.unwrap();
}

#[tokio::test]
async fn expired_jwt_is_refreshed_before_the_next_request() {
    let stale = chrono::Utc::now().timestamp() + 10; // inside the 60s margin
    let server = spawn_server(vec![
        json(
            "POST",
            "/api/auth",
            "200 OK",
            &format!(r#"{{"jwt":"{}"}}"#, jwt(stale)),
        ),
        json("GET", "/api/system/status", "200 OK", STATUS),
        // ensure_token sees the near-expiry token → re-login before /users/me
        auth_ok(),
        with_header(json("GET", "/api/users/me", "200 OK", ME), bearer()),
    ])
    .await;
    let client = PortainerClient::new(password_config(server.addr), None).unwrap();
    client.login().await.unwrap();
    client.ping().await.unwrap();
    server.task.await.unwrap();
    assert_eq!(server.auth_posts.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn no_credentials_is_a_config_error_without_any_request() {
    let server = spawn_server(vec![]).await;
    let mut svc = PortainerService::new(None);
    let cfg = PortainerConnectionConfig {
        username: None,
        password: None,
        api_key: None,
        ..password_config(server.addr)
    };
    let err = svc.connect("x".into(), cfg).await.unwrap_err();
    assert_eq!(err.kind, PortainerErrorKind::ConfigError);
    server.task.await.unwrap();
    assert_eq!(server.accepted.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn unreachable_host_is_connection_failed() {
    // Bind then drop → port is closed.
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    drop(listener);
    let mut svc = PortainerService::new(None);
    let err = svc
        .connect("x".into(), api_key_config(addr))
        .await
        .unwrap_err();
    assert_eq!(err.kind, PortainerErrorKind::ConnectionFailed);
}
