use sorng_lxd::client::LxdClient;
use sorng_lxd::service::LxdService;
use sorng_lxd::types::{LxdConnectionConfig, LxdErrorKind};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

struct ExpectedResponse {
    path: &'static str,
    authorization: &'static str,
    status: &'static str,
    body: &'static str,
}

async fn spawn_server(
    responses: Vec<ExpectedResponse>,
) -> (std::net::SocketAddr, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move {
        for expected in responses {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            loop {
                let mut chunk = [0_u8; 1024];
                let read = stream.read(&mut chunk).await.unwrap();
                assert!(read > 0, "client closed before sending request headers");
                request.extend_from_slice(&chunk[..read]);
                if request.windows(4).any(|window| window == b"\r\n\r\n") {
                    break;
                }
            }
            let request = String::from_utf8(request).unwrap();
            let request_line = request.lines().next().unwrap();
            assert_eq!(request_line, format!("GET {} HTTP/1.1", expected.path));
            assert!(
                request.lines().any(|line| line
                    .eq_ignore_ascii_case(&format!("authorization: {}", expected.authorization))),
                "missing expected authorization header in {request}"
            );
            let response = format!(
                "HTTP/1.1 {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                expected.status,
                expected.body.len(),
                expected.body
            );
            stream.write_all(response.as_bytes()).await.unwrap();
        }
    });
    (address, task)
}

#[test]
fn secure_tls_defaults_build_without_an_acknowledgement() {
    let cfg = LxdConnectionConfig {
        url: "https://lxd.example.test:8443".into(),
        skip_tls_verify: false,
        acknowledge_invalid_cert_risk: false,
        ..LxdConnectionConfig::default()
    };

    assert!(LxdClient::new(cfg).is_ok());
}

#[test]
fn insecure_tls_requires_an_exact_matching_runtime_acknowledgement() {
    let missing_acknowledgement = LxdConnectionConfig {
        url: "https://lxd.example.test:8443".into(),
        skip_tls_verify: true,
        acknowledge_invalid_cert_risk: false,
        ..LxdConnectionConfig::default()
    };
    assert!(LxdClient::new(missing_acknowledgement).is_err());

    let acknowledgement_without_bypass = LxdConnectionConfig {
        url: "https://lxd.example.test:8443".into(),
        skip_tls_verify: false,
        acknowledge_invalid_cert_risk: true,
        ..LxdConnectionConfig::default()
    };
    assert!(LxdClient::new(acknowledgement_without_bypass).is_err());
}

#[test]
fn insecure_tls_acknowledgement_is_consumed_after_one_client_build() {
    let acknowledged = LxdConnectionConfig {
        url: "https://lxd.example.test:8443".into(),
        skip_tls_verify: true,
        acknowledge_invalid_cert_risk: true,
        ..LxdConnectionConfig::default()
    };

    let client = match LxdClient::new(acknowledged) {
        Ok(client) => client,
        Err(error) => panic!("matching acknowledgement should build the client: {error}"),
    };
    assert!(!client.config.acknowledge_invalid_cert_risk);
    assert!(LxdClient::new(client.config).is_err());
}

fn config(address: std::net::SocketAddr) -> LxdConnectionConfig {
    LxdConnectionConfig {
        url: format!("http://{address}"),
        oidc_token: Some("probe-token".into()),
        skip_tls_verify: false,
        ..LxdConnectionConfig::default()
    }
}

const SERVER_BODY: &str = r#"{"type":"sync","status":"Success","status_code":200,"metadata":{"api_version":"1.0","auth":"trusted","auth_user_name":"contract-user","environment":{"server_name":"node-a","server_version":"5.21","server_clustered":true}}}"#;

#[tokio::test]
async fn connect_and_followup_probe_use_real_root_endpoint_and_bearer_auth() {
    let responses = vec![
        ExpectedResponse {
            path: "/1.0",
            authorization: "Bearer probe-token",
            status: "200 OK",
            body: SERVER_BODY,
        },
        ExpectedResponse {
            path: "/1.0",
            authorization: "Bearer probe-token",
            status: "200 OK",
            body: SERVER_BODY,
        },
    ];
    let (address, server) = spawn_server(responses).await;
    let service = LxdService::new();

    let summary = service.connect(config(address)).await.unwrap();
    assert!(summary.connected);
    assert_eq!(summary.api_version.as_deref(), Some("1.0"));
    assert_eq!(summary.server_name.as_deref(), Some("node-a"));
    assert!(service.is_connected().await);

    let mut replacement = config(address);
    replacement.url = "this is deliberately not a URL".to_string();
    let error = service
        .connect(replacement)
        .await
        .expect_err("a second connect must fail before validating or probing it");
    assert_eq!(error.kind, LxdErrorKind::Conflict);

    let followup = service.get_server().await.unwrap();
    assert_eq!(followup.auth_user_name.as_deref(), Some("contract-user"));
    service.disconnect().await;
    assert!(!service.is_connected().await);
    server.await.unwrap();
}

#[tokio::test]
async fn connect_rejects_success_envelope_without_mandatory_metadata() {
    let (address, server) = spawn_server(vec![ExpectedResponse {
        path: "/1.0",
        authorization: "Bearer probe-token",
        status: "200 OK",
        body: r#"{"type":"sync","status":"Success","status_code":200}"#,
    }])
    .await;
    let service = LxdService::new();

    let error = service.connect(config(address)).await.unwrap_err();
    assert_eq!(error.kind, LxdErrorKind::Api);
    assert!(!service.is_connected().await);
    server.await.unwrap();
}

#[tokio::test]
async fn connect_rejects_non_success_http_status_without_storing_client() {
    let (address, server) = spawn_server(vec![ExpectedResponse {
        path: "/1.0",
        authorization: "Bearer probe-token",
        status: "403 Forbidden",
        body: r#"{"type":"error","error":"certificate is not trusted","error_code":403}"#,
    }])
    .await;
    let service = LxdService::new();

    let error = service.connect(config(address)).await.unwrap_err();
    assert_eq!(error.kind, LxdErrorKind::Auth);
    assert_eq!(error.status_code, Some(403));
    assert!(!service.is_connected().await);
    server.await.unwrap();
}
