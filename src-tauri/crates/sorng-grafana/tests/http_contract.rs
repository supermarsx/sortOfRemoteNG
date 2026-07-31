use sorng_grafana::error::GrafanaErrorKind;
use sorng_grafana::service::GrafanaService;
use sorng_grafana::types::GrafanaConnectionConfig;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread::{self, JoinHandle};

struct ExpectedResponse {
    target: &'static str,
    status: u16,
    body: &'static str,
}

struct MockHttpServer {
    host: String,
    port: u16,
    thread: JoinHandle<()>,
}

impl MockHttpServer {
    fn start(responses: Vec<ExpectedResponse>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock HTTP server");
        let address = listener.local_addr().expect("mock server address");
        let thread = thread::spawn(move || {
            for expected in responses {
                let (mut stream, _) = listener.accept().expect("accept request");
                let mut bytes = Vec::new();
                let mut buffer = [0_u8; 1024];
                while !bytes.windows(4).any(|window| window == b"\r\n\r\n") {
                    let count = stream.read(&mut buffer).expect("read request");
                    assert_ne!(count, 0, "request ended before headers");
                    bytes.extend_from_slice(&buffer[..count]);
                }
                let request = String::from_utf8(bytes).expect("HTTP request is UTF-8");
                assert!(
                    request.starts_with(&format!("GET {} HTTP/1.1\r\n", expected.target)),
                    "unexpected request: {request}"
                );
                let lower = request.to_ascii_lowercase();
                assert!(
                    lower.contains("\r\nauthorization: bearer grafana-secret\r\n"),
                    "missing bearer authorization: {request}"
                );
                assert!(
                    lower.contains("\r\nx-grafana-org-id: 42\r\n"),
                    "missing organization header: {request}"
                );

                let reason = if expected.status == 200 {
                    "OK"
                } else {
                    "Service Unavailable"
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
            }
        });
        Self {
            host: address.ip().to_string(),
            port: address.port(),
            thread,
        }
    }

    fn finish(self) {
        self.thread.join().expect("mock server assertions");
    }
}

fn config(server: &MockHttpServer) -> GrafanaConnectionConfig {
    GrafanaConnectionConfig {
        host: server.host.clone(),
        port: Some(server.port),
        use_tls: Some(false),
        accept_invalid_certs: None,
        acknowledge_invalid_cert_risk: None,
        api_key: Some("grafana-secret".into()),
        username: None,
        password: None,
        org_id: Some(42),
        timeout_secs: Some(2),
        proxy_url: None,
    }
}

fn success(target: &'static str, body: &'static str) -> ExpectedResponse {
    ExpectedResponse {
        target,
        status: 200,
        body,
    }
}

fn successful_ping_responses() -> Vec<ExpectedResponse> {
    vec![
        success(
            "/api/health",
            r#"{"database":"ok","version":"11.6.2","commit":"abc"}"#,
        ),
        success("/api/org", r#"{"id":42,"name":"Operations"}"#),
        success(
            "/api/search?type=dash-db",
            r#"[{"uid":"one"},{"uid":"two"}]"#,
        ),
        success("/api/org/users", r#"[{"id":1},{"id":2},{"id":3}]"#),
    ]
}

#[tokio::test]
async fn connect_and_ping_use_mandatory_endpoints_and_auth_headers() {
    let mut responses = successful_ping_responses();
    responses.extend(successful_ping_responses());
    let server = MockHttpServer::start(responses);
    let mut service = GrafanaService::new();

    let connected = service
        .connect("grafana".into(), config(&server))
        .await
        .expect("connect succeeds");
    assert_eq!(connected.host, "127.0.0.1");
    assert_eq!(connected.version, "11.6.2");
    assert_eq!(connected.org_name, "Operations");
    assert_eq!(connected.dashboard_count, 2);
    assert_eq!(connected.user_count, 3);
    let duplicate = service
        .connect("grafana".into(), config(&server))
        .await
        .expect_err("duplicate id must not replace the live client");
    assert!(duplicate.to_string().contains("already exists"));

    let pinged = service.ping("grafana").await.expect("ping succeeds");
    assert_eq!(pinged.org_name, connected.org_name);
    assert_eq!(pinged.dashboard_count, connected.dashboard_count);
    assert_eq!(service.list_connections(), vec!["grafana"]);
    server.finish();
}

#[tokio::test]
async fn connect_fails_when_org_is_refused() {
    let server = MockHttpServer::start(vec![
        success("/api/health", r#"{"database":"ok","version":"11.6.2"}"#),
        ExpectedResponse {
            target: "/api/org",
            status: 503,
            body: r#"{"message":"org unavailable"}"#,
        },
    ]);
    assert_failed_connect(server, "/api/org").await;
}

#[tokio::test]
async fn connect_fails_when_dashboard_search_is_refused() {
    let server = MockHttpServer::start(vec![
        success("/api/health", r#"{"database":"ok","version":"11.6.2"}"#),
        success("/api/org", r#"{"id":42,"name":"Operations"}"#),
        ExpectedResponse {
            target: "/api/search?type=dash-db",
            status: 503,
            body: r#"{"message":"search unavailable"}"#,
        },
    ]);
    assert_failed_connect(server, "/api/search?type=dash-db").await;
}

#[tokio::test]
async fn connect_fails_when_org_users_is_refused() {
    let server = MockHttpServer::start(vec![
        success("/api/health", r#"{"database":"ok","version":"11.6.2"}"#),
        success("/api/org", r#"{"id":42,"name":"Operations"}"#),
        success("/api/search?type=dash-db", r#"[{"uid":"one"}]"#),
        ExpectedResponse {
            target: "/api/org/users",
            status: 503,
            body: r#"{"message":"users unavailable"}"#,
        },
    ]);
    assert_failed_connect(server, "/api/org/users").await;
}

async fn assert_failed_connect(server: MockHttpServer, failed_endpoint: &str) {
    let mut service = GrafanaService::new();
    let error = service
        .connect("grafana".into(), config(&server))
        .await
        .expect_err("mandatory endpoint refusal must fail connect");
    assert!(
        matches!(error.kind, GrafanaErrorKind::HttpError),
        "{failed_endpoint} returned the wrong error kind: {error}"
    );
    assert!(
        error.message.contains("HTTP 503"),
        "{failed_endpoint} did not preserve the refusal: {error}"
    );
    assert!(service.list_connections().is_empty());
    server.finish();
}
