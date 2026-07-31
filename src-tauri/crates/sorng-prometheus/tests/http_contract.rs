use sorng_prometheus::error::PrometheusErrorKind;
use sorng_prometheus::service::PrometheusService;
use sorng_prometheus::types::PrometheusConnectionConfig;
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
                assert!(
                    request
                        .to_ascii_lowercase()
                        .contains("\r\nauthorization: bearer prometheus-secret\r\n"),
                    "missing bearer authorization: {request}"
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

fn config(server: &MockHttpServer) -> PrometheusConnectionConfig {
    PrometheusConnectionConfig {
        host: server.host.clone(),
        port: Some(server.port),
        use_tls: Some(false),
        accept_invalid_certs: None,
        acknowledge_invalid_cert_risk: None,
        username: None,
        password: None,
        bearer_token: Some("prometheus-secret".into()),
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

#[tokio::test]
async fn connect_and_ping_use_all_status_endpoints_and_bearer_auth() {
    let build = r#"{"status":"success","data":{"version":"3.5.0"}}"#;
    let runtime = r#"{"status":"success","data":{"storageRetention":"30d","timeSeriesCount":9}}"#;
    let tsdb = r#"{"status":"success","data":{"headStats":{"numSeries":4321}}}"#;
    let server = MockHttpServer::start(vec![
        success("/api/v1/status/buildinfo", build),
        success("/api/v1/status/runtimeinfo", runtime),
        success("/api/v1/status/tsdb", tsdb),
        success("/api/v1/status/buildinfo", build),
        success("/api/v1/status/runtimeinfo", runtime),
        success("/api/v1/status/tsdb", tsdb),
    ]);
    let mut service = PrometheusService::new();

    let connected = service
        .connect("prometheus".into(), config(&server))
        .await
        .expect("connect succeeds");
    assert_eq!(connected.host, "127.0.0.1");
    assert_eq!(connected.version.as_deref(), Some("3.5.0"));
    assert_eq!(connected.uptime.as_deref(), Some("30d"));
    assert_eq!(connected.series_count, Some(4321));
    let duplicate = service
        .connect("prometheus".into(), config(&server))
        .await
        .expect_err("duplicate id must not replace the live client");
    assert!(duplicate.to_string().contains("already exists"));

    let pinged = service.ping("prometheus").await.expect("ping succeeds");
    assert_eq!(pinged.version, connected.version);
    assert_eq!(pinged.series_count, connected.series_count);
    assert_eq!(service.list_connections(), vec!["prometheus"]);
    server.finish();
}

#[tokio::test]
async fn connect_fails_when_runtimeinfo_is_refused() {
    let server = MockHttpServer::start(vec![
        success(
            "/api/v1/status/buildinfo",
            r#"{"status":"success","data":{"version":"3.5.0"}}"#,
        ),
        ExpectedResponse {
            target: "/api/v1/status/runtimeinfo",
            status: 503,
            body: r#"{"status":"error","error":"runtime unavailable"}"#,
        },
    ]);
    let mut service = PrometheusService::new();

    let error = service
        .connect("prometheus".into(), config(&server))
        .await
        .expect_err("runtimeinfo refusal must fail connect");
    assert!(matches!(error.kind, PrometheusErrorKind::ApiError));
    assert!(error.message.contains("HTTP 503"));
    assert!(service.list_connections().is_empty());
    server.finish();
}

#[tokio::test]
async fn connect_fails_when_tsdb_is_refused() {
    let server = MockHttpServer::start(vec![
        success(
            "/api/v1/status/buildinfo",
            r#"{"status":"success","data":{"version":"3.5.0"}}"#,
        ),
        success(
            "/api/v1/status/runtimeinfo",
            r#"{"status":"success","data":{"storageRetention":"30d"}}"#,
        ),
        ExpectedResponse {
            target: "/api/v1/status/tsdb",
            status: 503,
            body: r#"{"status":"error","error":"tsdb unavailable"}"#,
        },
    ]);
    let mut service = PrometheusService::new();

    let error = service
        .connect("prometheus".into(), config(&server))
        .await
        .expect_err("TSDB refusal must fail connect");
    assert!(matches!(error.kind, PrometheusErrorKind::ApiError));
    assert!(error.message.contains("HTTP 503"));
    assert!(service.list_connections().is_empty());
    server.finish();
}
