//! HTTP-contract tests for the Nginx Proxy Manager client against a scripted
//! loopback `TcpListener` mock (no mock crate — same pattern as sorng-grafana).
//!
//! Each `Expected` describes one request the mock must see (method + target,
//! optional body/header assertions) and the response it returns.

use sorng_nginx_proxy_mgr::client::NpmClient;
use sorng_nginx_proxy_mgr::error::NpmErrorKind;
use sorng_nginx_proxy_mgr::service::NpmService;
use sorng_nginx_proxy_mgr::types::{NpmConnectionConfig, NpmProxyHost};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

struct Expected {
    method: &'static str,
    target: &'static str,
    /// Required `Authorization` header value (exact), or `None` = must be absent.
    auth: Option<&'static str>,
    /// Substring the request body must contain (if any).
    body_contains: Option<&'static str>,
    status: u16,
    body: String,
}

fn ex(
    method: &'static str,
    target: &'static str,
    auth: Option<&'static str>,
    status: u16,
    body: &str,
) -> Expected {
    Expected {
        method,
        target,
        auth,
        body_contains: None,
        status,
        body: body.to_string(),
    }
}

struct MockServer {
    url: String,
    seen: Arc<Mutex<Vec<String>>>,
    thread: JoinHandle<()>,
}

impl MockServer {
    fn start(responses: Vec<Expected>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock HTTP server");
        let addr = listener.local_addr().expect("mock server address");
        let seen = Arc::new(Mutex::new(Vec::new()));
        let seen_thread = Arc::clone(&seen);
        let thread = thread::spawn(move || {
            for expected in responses {
                let (mut stream, _) = listener.accept().expect("accept request");
                let mut bytes = Vec::new();
                let mut buffer = [0_u8; 4096];
                let header_end = loop {
                    if let Some(pos) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                        break pos + 4;
                    }
                    let n = stream.read(&mut buffer).expect("read request");
                    assert_ne!(n, 0, "request ended before headers");
                    bytes.extend_from_slice(&buffer[..n]);
                };
                let head = String::from_utf8_lossy(&bytes[..header_end]).to_string();
                let lower = head.to_ascii_lowercase();
                let content_length = lower
                    .lines()
                    .find_map(|l| l.strip_prefix("content-length:"))
                    .and_then(|v| v.trim().parse::<usize>().ok())
                    .unwrap_or(0);
                while bytes.len() < header_end + content_length {
                    let n = stream.read(&mut buffer).expect("read body");
                    assert_ne!(n, 0, "request ended before body");
                    bytes.extend_from_slice(&buffer[..n]);
                }
                let body = String::from_utf8_lossy(&bytes[header_end..header_end + content_length])
                    .to_string();
                let request_line = head.lines().next().unwrap_or_default().to_string();
                seen_thread.lock().unwrap().push(request_line.clone());

                assert_eq!(
                    request_line,
                    format!("{} {} HTTP/1.1", expected.method, expected.target),
                    "unexpected request line; full head:\n{head}"
                );
                match expected.auth {
                    Some(value) => assert!(
                        lower.contains(&format!(
                            "\r\nauthorization: {}\r\n",
                            value.to_ascii_lowercase()
                        )),
                        "expected Authorization {value:?} in:\n{head}"
                    ),
                    None => assert!(
                        !lower.contains("\r\nauthorization:"),
                        "unexpected Authorization header in:\n{head}"
                    ),
                }
                if let Some(needle) = expected.body_contains {
                    assert!(body.contains(needle), "body {body:?} lacks {needle:?}");
                }
                let reason = match expected.status {
                    200 => "OK",
                    401 => "Unauthorized",
                    403 => "Forbidden",
                    404 => "Not Found",
                    _ => "Error",
                };
                write!(
                    stream,
                    "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    expected.status,
                    reason,
                    expected.body.len(),
                    expected.body
                )
                .expect("write response");
                let _ = stream.flush();
            }
        });
        Self {
            url: format!("http://{}:{}", addr.ip(), addr.port()),
            seen,
            thread,
        }
    }

    fn finish(self) -> Vec<String> {
        self.thread.join().expect("mock server assertions");
        let seen = self.seen.lock().unwrap().clone();
        seen
    }
}

fn password_config(server: &MockServer) -> NpmConnectionConfig {
    NpmConnectionConfig {
        api_url: format!("{}/", server.url),
        email: Some("admin@example.com".into()),
        password: Some("changeme".into()),
        token: None,
        skip_tls_verify: None,
        acknowledge_invalid_cert_risk: false,
        timeout_secs: Some(3),
        proxy_url: None,
    }
}

fn token_config(server: &MockServer, token: &str) -> NpmConnectionConfig {
    NpmConnectionConfig {
        email: None,
        password: None,
        token: Some(token.into()),
        ..password_config(server)
    }
}

fn far_expiry() -> String {
    (chrono::Utc::now() + chrono::Duration::hours(1)).to_rfc3339()
}

fn near_expiry() -> String {
    (chrono::Utc::now() + chrono::Duration::seconds(30)).to_rfc3339()
}

fn token_body(token: &str, expires: &str) -> String {
    format!(r#"{{"token":"{token}","expires":"{expires}"}}"#)
}

const ME: &str = r#"{"id":1,"name":"Admin","nickname":"Admin","email":"admin@example.com","is_disabled":0,"roles":["admin"]}"#;
const VERSION: &str = r#"{"status":"OK","version":{"major":2,"minor":11,"revision":3}}"#;

#[tokio::test]
async fn login_sets_bearer_and_ping_reads_version_and_me() {
    let server = MockServer::start(vec![
        Expected {
            body_contains: Some(r#""identity":"admin@example.com""#),
            ..ex(
                "POST",
                "/api/tokens",
                None,
                200,
                &token_body("tok-1", &far_expiry()),
            )
        },
        ex("GET", "/api/", None, 200, VERSION),
        ex("GET", "/api/users/me", Some("Bearer tok-1"), 200, ME),
    ]);
    let mut service = NpmService::new();
    let summary = service
        .connect("c1".into(), password_config(&server))
        .await
        .expect("connect");
    assert_eq!(summary.version.as_deref(), Some("2.11.3"));
    assert_eq!(summary.user.as_deref(), Some("admin@example.com"));
    assert_eq!(summary.roles, vec!["admin".to_string()]);
    assert_eq!(summary.auth_mode, "password");
    assert!(summary.token_expires_at.is_some());
    assert_eq!(summary.api_url, server.url, "trailing slash stripped");
    assert_eq!(service.web_ui_url("c1").unwrap(), server.url);
    server.finish();
}

#[tokio::test]
async fn token_mode_skips_login() {
    let server = MockServer::start(vec![
        ex("GET", "/api/", None, 200, VERSION),
        ex("GET", "/api/users/me", Some("Bearer pre-supplied"), 200, ME),
    ]);
    let mut service = NpmService::new();
    let summary = service
        .connect("c1".into(), token_config(&server, "pre-supplied"))
        .await
        .expect("connect");
    assert_eq!(summary.auth_mode, "token");
    assert!(summary.token_expires_at.is_none());
    let seen = server.finish();
    assert!(!seen.iter().any(|l| l.starts_with("POST /api/tokens")));
}

#[tokio::test]
async fn login_401_is_authentication_failed() {
    let server = MockServer::start(vec![ex(
        "POST",
        "/api/tokens",
        None,
        401,
        r#"{"error":{"code":401,"message":"Invalid password"}}"#,
    )]);
    let mut service = NpmService::new();
    let err = service
        .connect("c1".into(), password_config(&server))
        .await
        .unwrap_err();
    assert_eq!(err.kind, NpmErrorKind::AuthenticationFailed);
    assert!(
        !err.message.contains("changeme"),
        "password leaked: {}",
        err.message
    );
    server.finish();
}

/// The real server (jc21/nginx-proxy-manager:2.15.1) rejects a wrong secret
/// with **400**, not 401 — a generic `HttpError` here would leave the panel
/// unable to say "check your credentials".
#[tokio::test]
async fn login_400_invalid_auth_is_authentication_failed() {
    let server = MockServer::start(vec![ex(
        "POST",
        "/api/tokens",
        None,
        400,
        r#"{"error":{"code":400,"message":"Invalid email or password","message_i18n":"error.invalid-auth"}}"#,
    )]);
    let mut service = NpmService::new();
    let err = service
        .connect("c1".into(), password_config(&server))
        .await
        .unwrap_err();
    assert_eq!(err.kind, NpmErrorKind::AuthenticationFailed);
    assert!(
        !err.message.contains("changeme"),
        "password leaked: {}",
        err.message
    );
    server.finish();
}

/// An unrelated 400 must stay a plain HTTP error.
#[tokio::test]
async fn login_400_other_error_stays_http_error() {
    let server = MockServer::start(vec![ex(
        "POST",
        "/api/tokens",
        None,
        400,
        r#"{"error":{"code":400,"message":"identity must be an email"}}"#,
    )]);
    let mut service = NpmService::new();
    let err = service
        .connect("c1".into(), password_config(&server))
        .await
        .unwrap_err();
    assert_eq!(err.kind, NpmErrorKind::HttpError);
    server.finish();
}

#[tokio::test]
async fn preemptive_refresh_when_expiry_is_near() {
    let server = MockServer::start(vec![
        ex(
            "POST",
            "/api/tokens",
            None,
            200,
            &token_body("tok-old", &near_expiry()),
        ),
        // ensure_token sees < 60 s left → GET /api/tokens with the old bearer
        ex(
            "GET",
            "/api/tokens",
            Some("Bearer tok-old"),
            200,
            &token_body("tok-new", &far_expiry()),
        ),
        ex(
            "GET",
            "/api/nginx/proxy-hosts?expand=certificate,owner,access_list",
            Some("Bearer tok-new"),
            200,
            "[]",
        ),
    ]);
    let client = NpmClient::new(password_config(&server)).unwrap();
    client.login().await.expect("login");
    let hosts: Vec<NpmProxyHost> = client
        .get("/nginx/proxy-hosts?expand=certificate,owner,access_list")
        .await
        .expect("list");
    assert!(hosts.is_empty());
    assert_eq!(client.current_token().await.as_deref(), Some("tok-new"));
    server.finish();
}

#[tokio::test]
async fn refresh_rejected_falls_back_to_relogin_in_password_mode() {
    let server = MockServer::start(vec![
        ex(
            "POST",
            "/api/tokens",
            None,
            200,
            &token_body("tok-old", &near_expiry()),
        ),
        ex("GET", "/api/tokens", Some("Bearer tok-old"), 401, "{}"),
        ex(
            "POST",
            "/api/tokens",
            None,
            200,
            &token_body("tok-relogin", &far_expiry()),
        ),
        ex("GET", "/api/users/me", Some("Bearer tok-relogin"), 200, ME),
    ]);
    let client = NpmClient::new(password_config(&server)).unwrap();
    client.login().await.expect("login");
    let me: serde_json::Value = client.get("/users/me").await.expect("me");
    assert_eq!(me["email"], "admin@example.com");
    server.finish();
}

#[tokio::test]
async fn unauthorized_triggers_exactly_one_relogin_and_retry() {
    let server = MockServer::start(vec![
        ex(
            "POST",
            "/api/tokens",
            None,
            200,
            &token_body("tok-1", &far_expiry()),
        ),
        ex(
            "GET",
            "/api/nginx/streams?expand=owner",
            Some("Bearer tok-1"),
            401,
            "{}",
        ),
        ex(
            "POST",
            "/api/tokens",
            None,
            200,
            &token_body("tok-2", &far_expiry()),
        ),
        ex(
            "GET",
            "/api/nginx/streams?expand=owner",
            Some("Bearer tok-2"),
            200,
            r#"[{"id":7,"incoming_port":2222,"forwarding_host":"10.0.0.2","forwarding_port":22,"tcp_forwarding":1,"udp_forwarding":0,"enabled":1}]"#,
        ),
    ]);
    let client = NpmClient::new(password_config(&server)).unwrap();
    client.login().await.expect("login");
    let streams = sorng_nginx_proxy_mgr::streams::StreamManager::list(&client)
        .await
        .expect("streams");
    assert_eq!(streams.len(), 1);
    assert_eq!(streams[0].tcp_forwarding, Some(true));
    assert_eq!(streams[0].udp_forwarding, Some(false));
    assert_eq!(streams[0].enabled, Some(true));
    let seen = server.finish();
    assert_eq!(
        seen.iter()
            .filter(|l| l.starts_with("POST /api/tokens"))
            .count(),
        2
    );
}

#[tokio::test]
async fn second_unauthorized_is_token_expired() {
    let server = MockServer::start(vec![
        ex(
            "POST",
            "/api/tokens",
            None,
            200,
            &token_body("tok-1", &far_expiry()),
        ),
        ex("GET", "/api/users/me", Some("Bearer tok-1"), 401, "{}"),
        ex(
            "POST",
            "/api/tokens",
            None,
            200,
            &token_body("tok-2", &far_expiry()),
        ),
        ex("GET", "/api/users/me", Some("Bearer tok-2"), 401, "{}"),
    ]);
    let client = NpmClient::new(password_config(&server)).unwrap();
    client.login().await.expect("login");
    let err = client
        .get::<serde_json::Value>("/users/me")
        .await
        .unwrap_err();
    assert_eq!(err.kind, NpmErrorKind::TokenExpired);
    server.finish();
}

#[tokio::test]
async fn token_mode_unauthorized_tries_one_refresh_then_token_expired() {
    let server = MockServer::start(vec![
        ex("GET", "/api/users/me", Some("Bearer stale"), 401, "{}"),
        ex("GET", "/api/tokens", Some("Bearer stale"), 401, "{}"),
    ]);
    let client = NpmClient::new(token_config(&server, "stale")).unwrap();
    let err = client
        .get::<serde_json::Value>("/users/me")
        .await
        .unwrap_err();
    assert_eq!(err.kind, NpmErrorKind::TokenExpired);
    let seen = server.finish();
    assert!(
        !seen.iter().any(|l| l.starts_with("POST /api/tokens")),
        "token mode must never POST /tokens"
    );
}

#[tokio::test]
async fn forbidden_maps_to_permission_denied() {
    let server = MockServer::start(vec![
        ex(
            "POST",
            "/api/tokens",
            None,
            200,
            &token_body("tok-1", &far_expiry()),
        ),
        ex(
            "GET",
            "/api/users",
            Some("Bearer tok-1"),
            403,
            r#"{"error":{"code":403}}"#,
        ),
    ]);
    let client = NpmClient::new(password_config(&server)).unwrap();
    client.login().await.expect("login");
    let err = client.get::<serde_json::Value>("/users").await.unwrap_err();
    assert_eq!(err.kind, NpmErrorKind::PermissionDenied);
    server.finish();
}

#[tokio::test]
async fn service_refresh_token_hits_get_tokens_and_returns_summary() {
    let server = MockServer::start(vec![
        ex(
            "POST",
            "/api/tokens",
            None,
            200,
            &token_body("tok-1", &far_expiry()),
        ),
        ex("GET", "/api/", None, 200, VERSION),
        ex("GET", "/api/users/me", Some("Bearer tok-1"), 200, ME),
        ex(
            "GET",
            "/api/tokens",
            Some("Bearer tok-1"),
            200,
            &token_body("tok-2", &far_expiry()),
        ),
        ex("GET", "/api/", None, 200, VERSION),
        ex("GET", "/api/users/me", Some("Bearer tok-2"), 200, ME),
    ]);
    let mut service = NpmService::new();
    service
        .connect("c1".into(), password_config(&server))
        .await
        .expect("connect");
    let summary = service.refresh_token("c1").await.expect("refresh");
    assert_eq!(summary.auth_mode, "password");
    assert!(summary.token_expires_at.is_some());
    service.disconnect("c1").await.expect("disconnect");
    assert!(service.list_connections().is_empty());
    assert_eq!(
        service.ping("c1").await.unwrap_err().kind,
        NpmErrorKind::NotConnected
    );
    server.finish();
}

#[tokio::test]
async fn proxy_hosts_parse_integer_booleans_and_toggle_paths() {
    let host = r#"{"id":3,"domain_names":["e2e.local"],"forward_host":"127.0.0.1","forward_port":8080,"forward_scheme":"http","ssl_forced":0,"caching_enabled":0,"block_exploits":1,"allow_websocket_upgrade":1,"http2_support":0,"hsts_enabled":0,"hsts_subdomains":0,"enabled":1,"certificate_id":0,"meta":{},"owner":{"id":1},"certificate":null}"#;
    let disabled = host.replace(r#""enabled":1"#, r#""enabled":0"#);
    let server = MockServer::start(vec![
        ex(
            "POST",
            "/api/tokens",
            None,
            200,
            &token_body("tok-1", &far_expiry()),
        ),
        ex("GET", "/api/", None, 200, VERSION),
        ex("GET", "/api/users/me", Some("Bearer tok-1"), 200, ME),
        ex(
            "GET",
            "/api/nginx/proxy-hosts?expand=certificate,owner,access_list",
            Some("Bearer tok-1"),
            200,
            &format!("[{host}]"),
        ),
        // Every toggle answers with the bare literal `true` (NPM 2.15.1) and
        // the client must then re-read the entity for its fresh state.
        ex(
            "POST",
            "/api/nginx/proxy-hosts/3/disable",
            Some("Bearer tok-1"),
            200,
            "true",
        ),
        ex(
            "GET",
            "/api/nginx/proxy-hosts/3",
            Some("Bearer tok-1"),
            200,
            &disabled,
        ),
        ex(
            "POST",
            "/api/nginx/proxy-hosts/3/enable",
            Some("Bearer tok-1"),
            200,
            "true",
        ),
        ex(
            "GET",
            "/api/nginx/proxy-hosts/3",
            Some("Bearer tok-1"),
            200,
            host,
        ),
        ex(
            "POST",
            "/api/nginx/redirection-hosts/4/enable",
            Some("Bearer tok-1"),
            200,
            "true",
        ),
        ex(
            "GET",
            "/api/nginx/redirection-hosts/4",
            Some("Bearer tok-1"),
            200,
            r#"{"id":4,"domain_names":["r.local"],"forward_http_code":301,"forward_domain_name":"x.local","forward_scheme":"https","enabled":1,"preserve_path":1}"#,
        ),
        ex(
            "POST",
            "/api/nginx/redirection-hosts/4/disable",
            Some("Bearer tok-1"),
            200,
            "true",
        ),
        ex(
            "GET",
            "/api/nginx/redirection-hosts/4",
            Some("Bearer tok-1"),
            200,
            r#"{"id":4,"domain_names":["r.local"],"forward_http_code":301,"forward_domain_name":"x.local","forward_scheme":"https","enabled":0,"preserve_path":1}"#,
        ),
        ex(
            "POST",
            "/api/nginx/streams/5/enable",
            Some("Bearer tok-1"),
            200,
            "true",
        ),
        ex(
            "GET",
            "/api/nginx/streams/5",
            Some("Bearer tok-1"),
            200,
            r#"{"id":5,"incoming_port":2222,"forwarding_host":"h","forwarding_port":22,"enabled":true}"#,
        ),
        ex(
            "POST",
            "/api/nginx/streams/5/disable",
            Some("Bearer tok-1"),
            200,
            "true",
        ),
        ex(
            "GET",
            "/api/nginx/streams/5",
            Some("Bearer tok-1"),
            200,
            r#"{"id":5,"incoming_port":2222,"forwarding_host":"h","forwarding_port":22,"enabled":false}"#,
        ),
    ]);
    let mut service = NpmService::new();
    service
        .connect("c1".into(), password_config(&server))
        .await
        .expect("connect");
    let hosts = service.list_proxy_hosts("c1").await.expect("list");
    assert_eq!(hosts.len(), 1);
    assert_eq!(hosts[0].enabled, Some(true));
    assert_eq!(hosts[0].block_exploits, Some(true));
    assert_eq!(hosts[0].ssl_forced, Some(false));
    assert_eq!(hosts[0].certificate_id, Some(0));
    assert_eq!(
        service.disable_proxy_host("c1", 3).await.unwrap().enabled,
        Some(false)
    );
    assert_eq!(
        service.enable_proxy_host("c1", 3).await.unwrap().enabled,
        Some(true)
    );
    assert_eq!(
        service
            .enable_redirection_host("c1", 4)
            .await
            .unwrap()
            .enabled,
        Some(true)
    );
    assert_eq!(
        service
            .disable_redirection_host("c1", 4)
            .await
            .unwrap()
            .enabled,
        Some(false)
    );
    assert_eq!(
        service.enable_stream("c1", 5).await.unwrap().enabled,
        Some(true)
    );
    assert_eq!(
        service.disable_stream("c1", 5).await.unwrap().enabled,
        Some(false)
    );
    server.finish();
}

#[tokio::test]
async fn skip_tls_without_ack_makes_no_request() {
    let server = MockServer::start(vec![]);
    let mut cfg = password_config(&server);
    cfg.api_url = cfg.api_url.replacen("http://", "https://", 1);
    cfg.skip_tls_verify = Some(true);
    let mut service = NpmService::new();
    let err = service.connect("c1".into(), cfg).await.unwrap_err();
    assert_eq!(err.kind, NpmErrorKind::ConfigError);
    assert!(server.finish().is_empty());
}

#[tokio::test]
async fn missing_credentials_makes_no_request() {
    let server = MockServer::start(vec![]);
    let mut cfg = password_config(&server);
    cfg.email = None;
    cfg.password = None;
    let mut service = NpmService::new();
    let err = service.connect("c1".into(), cfg).await.unwrap_err();
    assert_eq!(err.kind, NpmErrorKind::ConfigError);
    assert!(server.finish().is_empty());
}

#[tokio::test]
async fn https_to_plain_listener_surfaces_tls_untrusted_not_a_panic() {
    // A plain-HTTP listener behind an https:// URL fails the TLS handshake;
    // the client must classify that as TlsUntrusted (or a plain connection
    // error), never hang or panic. The listener just closes the socket.
    let _ = rustls::crypto::ring::default_provider().install_default();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let t = thread::spawn(move || {
        if let Ok((stream, _)) = listener.accept() {
            drop(stream);
        }
    });
    let cfg = NpmConnectionConfig {
        api_url: format!("https://{}:{}", addr.ip(), addr.port()),
        email: Some("a@b".into()),
        password: Some("p".into()),
        token: None,
        skip_tls_verify: Some(true),
        acknowledge_invalid_cert_risk: true,
        timeout_secs: Some(3),
        proxy_url: None,
    };
    let client = NpmClient::new(cfg).expect("client builds with skip+ack");
    let err = client.login().await.unwrap_err();
    assert!(
        matches!(
            err.kind,
            NpmErrorKind::TlsUntrusted | NpmErrorKind::ConnectionFailed | NpmErrorKind::Timeout
        ),
        "unexpected kind {:?}: {}",
        err.kind,
        err.message
    );
    assert!(!err.message.contains("\"p\""));
    t.join().unwrap();
}
