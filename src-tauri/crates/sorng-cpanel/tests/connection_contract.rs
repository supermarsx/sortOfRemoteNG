use sorng_cpanel::error::CpanelErrorKind;
use sorng_cpanel::service::CpanelService;
use sorng_cpanel::types::{CpanelAuthMode, CpanelConnectionConfig};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

struct ExpectedResponse {
    path: &'static str,
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
                format!("GET {} HTTP/1.1", expected.path)
            );
            assert!(request
                .lines()
                .any(|line| line.eq_ignore_ascii_case("authorization: whm root:api-token")));
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

fn config(address: std::net::SocketAddr) -> CpanelConnectionConfig {
    CpanelConnectionConfig {
        host: address.ip().to_string(),
        whm_port: Some(address.port()),
        cpanel_port: Some(address.port()),
        use_tls: Some(false),
        accept_invalid_certs: Some(false),
        auth_mode: CpanelAuthMode::ApiToken,
        username: "root".into(),
        password: None,
        api_token: Some("api-token".into()),
        timeout_secs: Some(5),
        proxy_url: None,
    }
}

const VERSION: &str = r#"{"data":{"version":"11.120.0.9"},"metadata":{"command":"version","reason":"OK","result":1,"version":1}}"#;
const HOSTNAME: &str = r#"{"data":{"hostname":"cpanel.example.test"},"metadata":{"command":"gethostname","reason":"OK","result":1,"version":1}}"#;

fn successful_probe() -> Vec<ExpectedResponse> {
    vec![
        ExpectedResponse {
            path: "/json-api/version?api.version=1",
            status: "200 OK",
            body: VERSION,
        },
        ExpectedResponse {
            path: "/json-api/gethostname?api.version=1",
            status: "200 OK",
            body: HOSTNAME,
        },
    ]
}

#[tokio::test]
async fn connect_and_ping_use_exact_whm_probes_auth_and_map_lifecycle() {
    let mut responses = successful_probe();
    responses.extend(successful_probe());
    let (address, server) = spawn_server(responses).await;
    let mut service = CpanelService::new();

    let summary = service
        .connect("hosting".into(), config(address))
        .await
        .unwrap();
    assert_eq!(summary.version.as_deref(), Some("11.120.0.9"));
    assert_eq!(summary.hostname.as_deref(), Some("cpanel.example.test"));
    assert_eq!(service.list_connections(), vec!["hosting"]);
    let duplicate = service
        .connect("hosting".into(), config(address))
        .await
        .expect_err("duplicate id must not replace the live client");
    assert!(duplicate.to_string().contains("already exists"));

    let ping = service.ping("hosting").await.unwrap();
    assert_eq!(ping.server_type.as_deref(), Some("cPanel/WHM"));
    service.disconnect("hosting").unwrap();
    assert!(service.list_connections().is_empty());
    server.await.unwrap();
}

#[tokio::test]
async fn connect_propagates_mandatory_hostname_failure_without_map_insertion() {
    let (address, server) = spawn_server(vec![
        ExpectedResponse {
            path: "/json-api/version?api.version=1",
            status: "200 OK",
            body: VERSION,
        },
        ExpectedResponse {
            path: "/json-api/gethostname?api.version=1",
            status: "200 OK",
            body: r#"{"metadata":{"command":"gethostname","reason":"permission denied","result":0,"version":1}}"#,
        },
    ])
    .await;
    let mut service = CpanelService::new();

    let error = service
        .connect("hosting".into(), config(address))
        .await
        .unwrap_err();
    assert!(matches!(error.kind, CpanelErrorKind::ApiError));
    assert!(service.list_connections().is_empty());
    server.await.unwrap();
}

#[tokio::test]
async fn connect_rejects_non_success_http_status_without_map_insertion() {
    let (address, server) = spawn_server(vec![ExpectedResponse {
        path: "/json-api/version?api.version=1",
        status: "401 Unauthorized",
        body: r#"{"error":"Access denied"}"#,
    }])
    .await;
    let mut service = CpanelService::new();

    let error = service
        .connect("hosting".into(), config(address))
        .await
        .unwrap_err();
    assert!(matches!(error.kind, CpanelErrorKind::AuthenticationFailed));
    assert!(service.list_connections().is_empty());
    server.await.unwrap();
}

#[tokio::test]
async fn user_api_token_connect_uses_cpanel_uapi_probe_and_auth_scheme() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
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
            "GET /execute/Variables/get_server_information HTTP/1.1"
        );
        assert!(request
            .lines()
            .any(|line| line.eq_ignore_ascii_case("authorization: cpanel alice:user-token")));
        let body = r#"{"result":{"data":{"hostname":"shared.example.test","version":"11.120.0.9"},"errors":null,"messages":null,"metadata":{},"status":1,"warnings":null}}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        stream.write_all(response.as_bytes()).await.unwrap();
    });
    let mut user_config = config(address);
    user_config.auth_mode = CpanelAuthMode::UserApiToken;
    user_config.username = "alice".into();
    user_config.api_token = Some("user-token".into());
    let mut service = CpanelService::new();

    let summary = service.connect("shared".into(), user_config).await.unwrap();
    assert_eq!(summary.hostname.as_deref(), Some("shared.example.test"));
    assert_eq!(summary.server_type.as_deref(), Some("cPanel"));
    assert_eq!(service.list_connections(), vec!["shared"]);
    server.await.unwrap();
}
