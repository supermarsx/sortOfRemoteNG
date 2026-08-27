use sorng_budibase::client::BudibaseClient;
use sorng_budibase::error::BudibaseErrorKind;
use sorng_budibase::service::BudibaseService;
use sorng_budibase::types::BudibaseConnectionConfig;
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
                    request.starts_with("GET /api/public/v1/applications?limit=1 HTTP/1.1\r\n"),
                    "unexpected request: {request}"
                );
                let lower = request.to_ascii_lowercase();
                assert!(
                    lower.contains("\r\nx-budibase-api-key: budibase-secret\r\n"),
                    "missing API-key header: {request}"
                );
                assert!(
                    lower.contains("\r\nx-budibase-app-id: app-123\r\n"),
                    "missing app scope header: {request}"
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

/// The TOFU TLS verifier builds a `rustls::ClientConfig`, which needs a
/// process-level crypto provider. `sorng-app` installs ring at startup; a
/// standalone test binary has to do it itself (repo pattern, e.g.
/// `sorng-nginx-proxy-mgr/tests/http_contract.rs`).
fn install_crypto_provider() {
    let _ = rustls::crypto::ring::default_provider().install_default();
}

#[test]
fn insecure_tls_requires_a_matching_runtime_acknowledgement() {
    install_crypto_provider();
    let mut cfg = BudibaseConnectionConfig {
        name: "TLS acknowledgement contract".into(),
        host: "https://budibase.example.test".into(),
        api_key: "test-key".into(),
        app_id: None,
        timeout_seconds: Some(5),
        skip_tls_verify: true,
        acknowledge_invalid_cert_risk: false,
        proxy_url: None,
    };
    assert!(BudibaseClient::from_config(&cfg).is_err());
    cfg.acknowledge_invalid_cert_risk = true;
    assert!(BudibaseClient::from_config(&cfg).is_ok());
}

fn config(host: String) -> BudibaseConnectionConfig {
    BudibaseConnectionConfig {
        name: "local".into(),
        host,
        api_key: "budibase-secret".into(),
        app_id: Some("app-123".into()),
        timeout_seconds: Some(2),
        skip_tls_verify: false,
        acknowledge_invalid_cert_risk: false,
        proxy_url: None,
    }
}

#[tokio::test]
async fn connect_and_ping_use_applications_endpoint_and_budibase_headers() {
    install_crypto_provider();
    let server = MockHttpServer::start(vec![
        ExpectedResponse {
            status: 200,
            body: r#"{"data":[]}"#,
        },
        ExpectedResponse {
            status: 200,
            body: r#"{"data":[]}"#,
        },
    ]);
    let mut service = BudibaseService::new();

    let connected = service
        .connect("budibase".into(), config(server.base_url.clone()))
        .await
        .expect("connect succeeds");
    assert!(connected.connected);
    assert_eq!(connected.host, server.base_url);
    let duplicate = service
        .connect("budibase".into(), config(server.base_url.clone()))
        .await
        .expect_err("duplicate id must not replace the live client");
    assert!(duplicate.to_string().contains("already exists"));

    let pinged = service.ping("budibase").await.expect("ping succeeds");
    assert!(pinged.connected);
    assert_eq!(service.list_connections(), vec!["budibase"]);
    server.finish();
}

#[tokio::test]
async fn connect_refuses_non_success_response() {
    install_crypto_provider();
    let server = MockHttpServer::start(vec![ExpectedResponse {
        status: 401,
        body: r#"{"message":"invalid API key"}"#,
    }]);
    let mut service = BudibaseService::new();

    let error = service
        .connect("budibase".into(), config(server.base_url.clone()))
        .await
        .expect_err("401 must fail connect");
    assert!(matches!(error.kind, BudibaseErrorKind::AuthError));
    assert!(error.message.contains("Authentication failed"));
    assert!(service.list_connections().is_empty());
    server.finish();
}
