use sorng_mailcow::client::MailcowClient;
use sorng_mailcow::error::MailcowErrorKind;
use sorng_mailcow::service::MailcowService;
use sorng_mailcow::status::StatusManager;
use sorng_mailcow::types::MailcowConnectionConfig;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread::{self, JoinHandle};

struct ExpectedResponse {
    target: &'static str,
    status: &'static str,
    body: &'static str,
}

struct MockHttpServer {
    base_url: String,
    thread: JoinHandle<()>,
}

impl MockHttpServer {
    fn start(responses: Vec<ExpectedResponse>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock HTTP server");
        let address = listener.local_addr().expect("mock server address");
        let thread = thread::spawn(move || {
            for expected in responses {
                let (mut stream, _) = listener.accept().expect("accept request");
                let mut request = Vec::new();
                let mut buffer = [0_u8; 1024];
                while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                    let count = stream.read(&mut buffer).expect("read request");
                    assert_ne!(count, 0, "request ended before headers");
                    request.extend_from_slice(&buffer[..count]);
                }
                let request = String::from_utf8(request).expect("HTTP request is UTF-8");
                assert_eq!(
                    request.lines().next(),
                    Some(format!("GET {} HTTP/1.1", expected.target).as_str())
                );
                assert!(
                    request
                        .lines()
                        .any(|line| line.eq_ignore_ascii_case("x-api-key: mailcow-key")),
                    "missing Mailcow API key: {request}"
                );

                write!(
                    stream,
                    "HTTP/1.1 {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    expected.status,
                    expected.body.len(),
                    expected.body
                )
                .expect("write response");
            }
        });
        Self {
            base_url: format!("http://{address}"),
            thread,
        }
    }

    fn finish(self) {
        self.thread.join().expect("mock server assertions");
    }
}

fn config(server: &MockHttpServer) -> MailcowConnectionConfig {
    MailcowConnectionConfig {
        base_url: server.base_url.clone(),
        api_key: "mailcow-key".into(),
        timeout_secs: 2,
        tls_skip_verify: false,
        proxy_url: None,
    }
}

#[tokio::test]
async fn connect_and_ping_use_container_status_api_key_and_map_lifecycle() {
    let containers = r#"[{"container":"postfix-mailcow","state":"running","health":"healthy"}]"#;
    let server = MockHttpServer::start(vec![
        ExpectedResponse {
            target: "/api/v1/get/status/containers",
            status: "200 OK",
            body: containers,
        },
        ExpectedResponse {
            target: "/api/v1/get/status/containers",
            status: "200 OK",
            body: containers,
        },
    ]);
    let mut service = MailcowService::new();

    let connected = service
        .connect("mail".into(), config(&server))
        .await
        .expect("connect succeeds");
    assert_eq!(connected.hostname.as_deref(), Some("postfix-mailcow"));
    assert_eq!(connected.containers_count, 1);
    assert_eq!(service.list_connections(), vec!["mail"]);
    let duplicate = service
        .connect("mail".into(), config(&server))
        .await
        .expect_err("duplicate id must not replace the live client");
    assert!(duplicate.to_string().contains("already exists"));

    let pinged = service.ping("mail").await.expect("ping succeeds");
    assert_eq!(pinged.containers_count, 1);
    service.disconnect("mail").expect("disconnect succeeds");
    assert!(service.list_connections().is_empty());
    server.finish();
}

#[tokio::test]
async fn connect_rejects_non_success_without_inserting_connection() {
    let server = MockHttpServer::start(vec![ExpectedResponse {
        target: "/api/v1/get/status/containers",
        status: "401 Unauthorized",
        body: r#"{"error":"API key rejected"}"#,
    }]);
    let mut service = MailcowService::new();

    let error = service
        .connect("mail".into(), config(&server))
        .await
        .expect_err("401 must fail connect");
    assert!(matches!(error.kind, MailcowErrorKind::AuthenticationFailed));
    assert!(error.message.contains("API key rejected"));
    assert!(service.list_connections().is_empty());
    server.finish();
}

#[tokio::test]
async fn connect_rejects_http_success_with_mailcow_danger_result() {
    let server = MockHttpServer::start(vec![ExpectedResponse {
        target: "/api/v1/get/status/containers",
        status: "200 OK",
        body: r#"[{"type":"danger","msg":"permission denied"}]"#,
    }]);
    let mut service = MailcowService::new();

    let error = service
        .connect("mail".into(), config(&server))
        .await
        .expect_err("Mailcow danger result must fail connect");
    assert!(matches!(error.kind, MailcowErrorKind::ApiError));
    assert!(error.message.contains("permission denied"));
    assert!(service.list_connections().is_empty());
    server.finish();
}

#[tokio::test]
async fn system_summary_propagates_mandatory_solr_failure() {
    let server = MockHttpServer::start(vec![
        ExpectedResponse {
            target: "/api/v1/get/status/containers",
            status: "200 OK",
            body: "[]",
        },
        ExpectedResponse {
            target: "/api/v1/get/status/solr",
            status: "503 Service Unavailable",
            body: r#"{"error":"solr unavailable"}"#,
        },
    ]);
    let client = MailcowClient::new(config(&server)).expect("client builds");

    let error = StatusManager::get_system_status(&client)
        .await
        .expect_err("mandatory Solr status failure must propagate");
    assert!(matches!(error.kind, MailcowErrorKind::ApiError));
    assert!(error.message.contains("solr unavailable"));
    server.finish();
}
