use sorng_pfsense::client::PfsenseClient;
use sorng_pfsense::error::PfsenseErrorKind;
use sorng_pfsense::service::PfsenseServiceWrapper;
use sorng_pfsense::types::PfsenseConnectionConfig;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

struct ExpectedResponse {
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
                assert!(read > 0);
                request.extend_from_slice(&chunk[..read]);
                if request.windows(4).any(|window| window == b"\r\n\r\n") {
                    break;
                }
            }
            let request = String::from_utf8(request).unwrap();
            assert_eq!(
                request.lines().next().unwrap(),
                "GET /api/v1/status/system HTTP/1.1"
            );
            assert!(request
                .lines()
                .any(|line| line.eq_ignore_ascii_case("authorization: key-id key-secret")));
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
fn insecure_tls_requires_a_matching_runtime_acknowledgement() {
    let mut cfg = PfsenseConnectionConfig {
        host: "pfsense.example.test".into(),
        port: 443,
        api_key: "test-key".into(),
        api_secret: "test-secret".into(),
        use_tls: true,
        accept_invalid_certs: true,
        acknowledge_invalid_cert_risk: false,
        timeout_secs: 5,
        proxy_url: None,
    };
    assert!(PfsenseClient::new(cfg.clone()).is_err());
    cfg.acknowledge_invalid_cert_risk = true;
    assert!(PfsenseClient::new(cfg).is_ok());
}

fn config(address: std::net::SocketAddr) -> PfsenseConnectionConfig {
    PfsenseConnectionConfig {
        host: address.ip().to_string(),
        port: address.port(),
        api_key: "key-id".into(),
        api_secret: "key-secret".into(),
        use_tls: false,
        accept_invalid_certs: false,
        acknowledge_invalid_cert_risk: false,
        timeout_secs: 5,
        proxy_url: None,
    }
}

const SYSTEM_BODY: &str = r#"{"status":"ok","code":200,"return":0,"message":"","data":{"hostname":"edge-fw","system_version":"2.7.2","platform":"pfSense Plus"}}"#;

#[tokio::test]
async fn connect_and_ping_use_system_status_probe_auth_and_map_lifecycle() {
    let (address, server) = spawn_server(vec![
        ExpectedResponse {
            status: "200 OK",
            body: SYSTEM_BODY,
        },
        ExpectedResponse {
            status: "200 OK",
            body: SYSTEM_BODY,
        },
    ])
    .await;
    let mut service = PfsenseServiceWrapper::new();

    let summary = service
        .connect("primary".into(), config(address))
        .await
        .unwrap();
    assert_eq!(summary.hostname, "edge-fw");
    assert_eq!(summary.version, "2.7.2");
    assert_eq!(service.list_connections(), vec!["primary"]);
    let duplicate = service
        .connect("primary".into(), config(address))
        .await
        .expect_err("duplicate id must not replace the live client");
    assert!(duplicate.to_string().contains("already exists"));

    let ping = service.ping("primary").await.unwrap();
    assert_eq!(ping.platform, "pfSense Plus");
    service.disconnect("primary").unwrap();
    assert!(service.list_connections().is_empty());
    server.await.unwrap();
}

#[tokio::test]
async fn connect_rejects_application_level_probe_failure_without_map_insertion() {
    let body = r#"{"status":"error","code":200,"return":1,"message":"probe denied","data":{"hostname":"","version":"","platform":""}}"#;
    let (address, server) = spawn_server(vec![ExpectedResponse {
        status: "200 OK",
        body,
    }])
    .await;
    let mut service = PfsenseServiceWrapper::new();

    let error = service
        .connect("rejected".into(), config(address))
        .await
        .unwrap_err();
    assert!(matches!(error.kind, PfsenseErrorKind::ApiError));
    assert!(service.list_connections().is_empty());
    server.await.unwrap();
}

#[tokio::test]
async fn connect_rejects_non_success_http_status_without_map_insertion() {
    let (address, server) = spawn_server(vec![ExpectedResponse {
        status: "403 Forbidden",
        body: r#"{"message":"invalid credentials"}"#,
    }])
    .await;
    let mut service = PfsenseServiceWrapper::new();

    let error = service
        .connect("rejected".into(), config(address))
        .await
        .unwrap_err();
    assert!(matches!(error.kind, PfsenseErrorKind::AuthenticationFailed));
    assert!(service.list_connections().is_empty());
    server.await.unwrap();
}
