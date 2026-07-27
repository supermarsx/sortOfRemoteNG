use sorng_jira::error::JiraErrorKind;
use sorng_jira::service::JiraService;
use sorng_jira::types::{JiraAuthMethod, JiraConnectionConfig};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread::{self, JoinHandle};

struct ExpectedResponse {
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
                    Some("GET /rest/api/3/serverInfo HTTP/1.1")
                );
                assert!(
                    request.lines().any(|line| line.eq_ignore_ascii_case(
                        "authorization: Basic YWxpY2VAZXhhbXBsZS50ZXN0OmFwaS10b2tlbg=="
                    )),
                    "missing Jira API-token Basic auth: {request}"
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

fn config(server: &MockHttpServer) -> JiraConnectionConfig {
    JiraConnectionConfig {
        name: "Jira contract".into(),
        host: server.base_url.clone(),
        auth: JiraAuthMethod::ApiToken {
            email: "alice@example.test".into(),
            token: "api-token".into(),
        },
        api_version: "3".into(),
        timeout_seconds: 2,
        skip_tls_verify: false,
        proxy_url: None,
    }
}

#[tokio::test]
async fn connect_and_ping_use_server_info_api_token_auth_and_map_lifecycle() {
    let body = r#"{"serverTitle":"Contract Jira","version":"10.4.1","deploymentType":"Server"}"#;
    let server = MockHttpServer::start(vec![
        ExpectedResponse {
            status: "200 OK",
            body,
        },
        ExpectedResponse {
            status: "200 OK",
            body,
        },
    ]);
    let mut service = JiraService::new();

    let connected = service
        .connect("jira".into(), config(&server))
        .await
        .expect("connect succeeds");
    assert!(connected.connected);
    assert_eq!(connected.server_title.as_deref(), Some("Contract Jira"));
    assert_eq!(service.list_connections(), vec!["jira"]);
    let duplicate = service
        .connect("jira".into(), config(&server))
        .await
        .expect_err("duplicate id must not replace the live client");
    assert!(duplicate.to_string().contains("already exists"));

    let pinged = service.ping("jira").await.expect("ping succeeds");
    assert_eq!(pinged.version.as_deref(), Some("10.4.1"));
    service.disconnect("jira").expect("disconnect succeeds");
    assert!(service.list_connections().is_empty());
    server.finish();
}

#[tokio::test]
async fn connect_rejects_non_success_without_inserting_connection() {
    let server = MockHttpServer::start(vec![ExpectedResponse {
        status: "401 Unauthorized",
        body: r#"{"errorMessages":["token rejected"]}"#,
    }]);
    let mut service = JiraService::new();

    let error = service
        .connect("jira".into(), config(&server))
        .await
        .expect_err("401 must fail connect");
    assert_eq!(error.kind, JiraErrorKind::AuthError);
    assert!(error.message.contains("token rejected"));
    assert!(service.list_connections().is_empty());
    server.finish();
}

#[tokio::test]
async fn connect_rejects_malformed_mandatory_server_info() {
    let server = MockHttpServer::start(vec![ExpectedResponse {
        status: "200 OK",
        body: "not-json",
    }]);
    let mut service = JiraService::new();

    let error = service
        .connect("jira".into(), config(&server))
        .await
        .expect_err("malformed mandatory summary must fail connect");
    assert_eq!(error.kind, JiraErrorKind::ParseError);
    assert!(service.list_connections().is_empty());
    server.finish();
}
