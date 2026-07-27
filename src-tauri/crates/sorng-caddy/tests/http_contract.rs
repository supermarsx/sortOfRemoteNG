use sorng_caddy::error::CaddyErrorKind;
use sorng_caddy::service::CaddyService;
use sorng_caddy::types::CaddyConnectionConfig;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread::{self, JoinHandle};

struct ExpectedResponse {
    target: &'static str,
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
                    request.starts_with(&format!("GET {} HTTP/1.1\r\n", expected.target)),
                    "unexpected request: {request}"
                );
                assert!(
                    request
                        .to_ascii_lowercase()
                        .contains("\r\nauthorization: bearer caddy-secret\r\n"),
                    "missing bearer authorization: {request}"
                );

                let reason = if expected.status == 200 {
                    "OK"
                } else {
                    "Unauthorized"
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

fn config(admin_url: String) -> CaddyConnectionConfig {
    CaddyConnectionConfig {
        admin_url,
        api_key: Some("caddy-secret".into()),
        username: None,
        password: None,
        tls_skip_verify: None,
        timeout_secs: Some(2),
        proxy_url: None,
    }
}

#[tokio::test]
async fn connect_and_ping_use_config_endpoint_and_bearer_auth() {
    let body = r#"{"admin":{"listen":"localhost:2019"}}"#;
    let server = MockHttpServer::start(vec![
        ExpectedResponse {
            target: "/config/",
            status: 200,
            body,
        },
        ExpectedResponse {
            target: "/config/",
            status: 200,
            body,
        },
    ]);
    let mut service = CaddyService::new();

    let connected = service
        .connect("caddy".into(), config(server.base_url.clone()))
        .await
        .expect("connect succeeds");
    assert_eq!(connected.admin_url, server.base_url);
    assert_eq!(connected.version, None);
    let duplicate = service
        .connect("caddy".into(), config(server.base_url.clone()))
        .await
        .expect_err("duplicate id must not replace the live client");
    assert!(duplicate.to_string().contains("already exists"));

    let pinged = service.ping("caddy").await.expect("ping succeeds");
    assert_eq!(pinged.admin_url, connected.admin_url);
    assert_eq!(service.list_connections(), vec!["caddy"]);
    server.finish();
}

#[tokio::test]
async fn connect_refuses_non_success_response() {
    let server = MockHttpServer::start(vec![ExpectedResponse {
        target: "/config/",
        status: 401,
        body: r#"{"error":"bad token"}"#,
    }]);
    let mut service = CaddyService::new();

    let error = service
        .connect("caddy".into(), config(server.base_url.clone()))
        .await
        .expect_err("401 must fail connect");
    assert!(matches!(error.kind, CaddyErrorKind::AuthenticationFailed));
    assert!(error.message.contains("HTTP 401"));
    assert!(service.list_connections().is_empty());
    server.finish();
}
