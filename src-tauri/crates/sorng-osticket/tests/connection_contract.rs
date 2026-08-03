use sorng_osticket::client::OsticketClient;
use sorng_osticket::error::OsticketErrorKind;
use sorng_osticket::service::OsticketService;
use sorng_osticket::types::OsticketConnectionConfig;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread::{self, JoinHandle};

struct ExpectedResponse {
    status: &'static str,
    body: &'static str,
    content_length: Option<usize>,
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
                    Some("GET /api/tickets?limit=1 HTTP/1.1")
                );
                assert!(
                    request
                        .lines()
                        .any(|line| line.eq_ignore_ascii_case("x-api-key: osticket-key")),
                    "missing osTicket API key: {request}"
                );

                let content_length = expected.content_length.unwrap_or(expected.body.len());
                write!(
                    stream,
                    "HTTP/1.1 {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    expected.status,
                    content_length,
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

#[test]
fn insecure_tls_requires_a_matching_runtime_acknowledgement() {
    let mut cfg = OsticketConnectionConfig {
        name: "TLS acknowledgement contract".into(),
        host: "https://helpdesk.example.test".into(),
        api_key: "test-key".into(),
        timeout_seconds: 5,
        skip_tls_verify: true,
        acknowledge_invalid_cert_risk: false,
        proxy_url: None,
    };
    assert!(OsticketClient::from_config(&cfg).is_err());
    cfg.acknowledge_invalid_cert_risk = true;
    let client = OsticketClient::from_config(&cfg).expect("matching acknowledgement is accepted");
    let config_debug = format!("{cfg:?}");
    let client_debug = format!("{client:?}");
    assert!(!config_debug.contains("test-key"));
    assert!(!config_debug.contains("helpdesk.example.test"));
    assert!(!client_debug.contains("test-key"));
    assert!(!client_debug.contains("helpdesk.example.test"));

    cfg.skip_tls_verify = false;
    assert!(OsticketClient::from_config(&cfg).is_err());
    cfg.acknowledge_invalid_cert_risk = false;
    assert!(OsticketClient::from_config(&cfg).is_ok());
}

fn config(server: &MockHttpServer) -> OsticketConnectionConfig {
    OsticketConnectionConfig {
        name: "osTicket contract".into(),
        host: server.base_url.clone(),
        api_key: "osticket-key".into(),
        timeout_seconds: 2,
        skip_tls_verify: false,
        acknowledge_invalid_cert_risk: false,
        proxy_url: None,
    }
}

#[tokio::test]
async fn connect_and_ping_use_ticket_probe_api_key_and_map_lifecycle() {
    let server = MockHttpServer::start(vec![
        ExpectedResponse {
            status: "200 OK",
            body: r#"{"tickets":[]}"#,
            content_length: None,
        },
        ExpectedResponse {
            status: "204 No Content",
            body: "",
            content_length: None,
        },
    ]);
    let mut service = OsticketService::new();

    let connected = service
        .connect("helpdesk".into(), config(&server))
        .await
        .expect("connect succeeds");
    assert!(connected.connected);
    assert_eq!(service.list_connections(), vec!["helpdesk"]);
    let duplicate = service
        .connect("helpdesk".into(), config(&server))
        .await
        .expect_err("duplicate id must not replace the live client");
    assert!(duplicate.to_string().contains("already exists"));

    let pinged = service.ping("helpdesk").await.expect("ping succeeds");
    assert!(pinged.connected);
    service.disconnect("helpdesk").expect("disconnect succeeds");
    assert!(service.list_connections().is_empty());
    server.finish();
}

#[tokio::test]
async fn connect_rejects_non_success_without_inserting_connection() {
    let server = MockHttpServer::start(vec![ExpectedResponse {
        status: "403 Forbidden",
        body: r#"{"error":"API key denied"}"#,
        content_length: None,
    }]);
    let mut service = OsticketService::new();

    let error = service
        .connect("helpdesk".into(), config(&server))
        .await
        .expect_err("403 must fail connect");
    assert_eq!(error.kind, OsticketErrorKind::Forbidden);
    assert!(error.message.contains("HTTP 403"));
    assert!(!error.message.contains("API key denied"));
    assert!(service.list_connections().is_empty());
    server.finish();
}

#[tokio::test]
async fn ping_rejects_oversized_content_length_without_buffering_the_body() {
    let server = MockHttpServer::start(vec![ExpectedResponse {
        status: "200 OK",
        body: "{}",
        content_length: Some(8 * 1024 * 1024 + 1),
    }]);
    let client = OsticketClient::from_config(&config(&server)).expect("client builds");

    let error = client
        .ping()
        .await
        .expect_err("oversized response must be rejected");
    assert_eq!(error.kind, OsticketErrorKind::ParseError);
    assert!(error.message.contains("8 MiB safety limit"));
    server.finish();
}
