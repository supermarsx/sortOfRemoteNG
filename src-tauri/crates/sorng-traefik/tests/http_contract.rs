use sorng_traefik::error::TraefikErrorKind;
use sorng_traefik::service::TraefikService;
use sorng_traefik::types::TraefikConnectionConfig;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread::{self, JoinHandle};

struct ExpectedResponse {
    status: u16,
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
                let mut bytes = Vec::new();
                let mut buffer = [0_u8; 1024];
                while !bytes.windows(4).any(|window| window == b"\r\n\r\n") {
                    let count = stream.read(&mut buffer).expect("read request");
                    assert_ne!(count, 0, "request ended before headers");
                    bytes.extend_from_slice(&buffer[..count]);
                }
                let request = String::from_utf8(bytes).expect("HTTP request is UTF-8");
                assert!(
                    request.starts_with("GET /api/version HTTP/1.1\r\n"),
                    "unexpected request: {request}"
                );
                assert!(
                    request
                        .to_ascii_lowercase()
                        .contains("\r\nauthorization: bearer traefik-secret\r\n"),
                    "missing bearer authorization: {request}"
                );

                let reason = if expected.status == 200 {
                    "OK"
                } else {
                    "Forbidden"
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
            base_url: format!("http://{address}"),
            thread,
        }
    }

    fn finish(self) {
        self.thread.join().expect("mock server assertions");
    }
}

fn config(api_url: String) -> TraefikConnectionConfig {
    TraefikConnectionConfig {
        api_url,
        username: None,
        password: None,
        api_key: Some("traefik-secret".into()),
        tls_skip_verify: None,
        timeout_secs: Some(2),
        proxy_url: None,
    }
}

#[tokio::test]
async fn connect_and_ping_use_version_endpoint_and_bearer_auth() {
    let body = r#"{"version":"3.4.1","codename":"saintmarcelin"}"#;
    let server = MockHttpServer::start(vec![
        ExpectedResponse { status: 200, body },
        ExpectedResponse { status: 200, body },
    ]);
    let mut service = TraefikService::new();

    let connected = service
        .connect("traefik".into(), config(server.base_url.clone()))
        .await
        .expect("connect succeeds");
    assert_eq!(connected.api_url, server.base_url);
    assert_eq!(connected.version.as_deref(), Some("3.4.1"));
    let duplicate = service
        .connect("traefik".into(), config(server.base_url.clone()))
        .await
        .expect_err("duplicate id must not replace the live client");
    assert!(duplicate.to_string().contains("already exists"));

    let pinged = service.ping("traefik").await.expect("ping succeeds");
    assert_eq!(pinged.version.as_deref(), Some("3.4.1"));
    assert_eq!(service.list_connections(), vec!["traefik"]);
    server.finish();
}

#[tokio::test]
async fn connect_refuses_non_success_response() {
    let server = MockHttpServer::start(vec![ExpectedResponse {
        status: 403,
        body: r#"{"error":"forbidden"}"#,
    }]);
    let mut service = TraefikService::new();

    let error = service
        .connect("traefik".into(), config(server.base_url.clone()))
        .await
        .expect_err("403 must fail connect");
    assert!(matches!(error.kind, TraefikErrorKind::AuthenticationFailed));
    assert!(error.message.contains("HTTP 403"));
    assert!(service.list_connections().is_empty());
    server.finish();
}
