use sorng_netbox::error::NetboxErrorKind;
use sorng_netbox::service::NetboxService;
use sorng_netbox::types::NetboxConnectionConfig;
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
                .any(|line| line.eq_ignore_ascii_case("authorization: Token netbox-token")));
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

fn config(address: std::net::SocketAddr) -> NetboxConnectionConfig {
    NetboxConnectionConfig {
        host: address.ip().to_string(),
        port: Some(address.port()),
        use_tls: Some(false),
        accept_invalid_certs: Some(false),
        api_token: "netbox-token".into(),
        timeout_secs: Some(5),
        proxy_url: None,
    }
}

const STATUS: &str = r#"{"netbox-version":"4.1.7"}"#;
const SITES: &str = r#"{"count":2,"next":null,"previous":null,"results":[]}"#;
const DEVICES: &str = r#"{"count":11,"next":null,"previous":null,"results":[]}"#;
const PREFIXES: &str = r#"{"count":23,"next":null,"previous":null,"results":[]}"#;

fn successful_probe() -> Vec<ExpectedResponse> {
    vec![
        ExpectedResponse {
            path: "/api/status/",
            status: "200 OK",
            body: STATUS,
        },
        ExpectedResponse {
            path: "/api/dcim/sites/?limit=1",
            status: "200 OK",
            body: SITES,
        },
        ExpectedResponse {
            path: "/api/dcim/devices/?limit=1",
            status: "200 OK",
            body: DEVICES,
        },
        ExpectedResponse {
            path: "/api/ipam/prefixes/?limit=1",
            status: "200 OK",
            body: PREFIXES,
        },
    ]
}

#[tokio::test]
async fn connect_and_ping_use_exact_probes_token_auth_and_map_lifecycle() {
    let mut responses = successful_probe();
    responses.extend(successful_probe());
    let (address, server) = spawn_server(responses).await;
    let mut service = NetboxService::new();

    let id = service
        .connect("inventory".into(), config(address))
        .await
        .unwrap();
    assert_eq!(id, "inventory");
    assert_eq!(service.list_connections(), vec!["inventory"]);
    let duplicate = service
        .connect("inventory".into(), config(address))
        .await
        .expect_err("duplicate id must not replace the live client");
    assert!(duplicate.to_string().contains("already exists"));

    let summary = service.ping("inventory").await.unwrap();
    assert_eq!(summary.version.as_deref(), Some("4.1.7"));
    assert_eq!(summary.site_count, Some(2));
    assert_eq!(summary.device_count, Some(11));
    assert_eq!(summary.prefix_count, Some(23));
    service.disconnect("inventory").unwrap();
    assert!(service.list_connections().is_empty());
    server.await.unwrap();
}

#[tokio::test]
async fn connect_rejects_malformed_mandatory_summary_call_without_map_insertion() {
    let mut responses = successful_probe();
    responses.truncate(2);
    responses[1].body = r#"{"results":[]}"#;
    let (address, server) = spawn_server(responses).await;
    let mut service = NetboxService::new();

    let error = service
        .connect("inventory".into(), config(address))
        .await
        .unwrap_err();
    assert!(matches!(error.kind, NetboxErrorKind::ParseError));
    assert!(service.list_connections().is_empty());
    server.await.unwrap();
}

#[tokio::test]
async fn connect_rejects_non_success_http_status_without_map_insertion() {
    let (address, server) = spawn_server(vec![ExpectedResponse {
        path: "/api/status/",
        status: "401 Unauthorized",
        body: r#"{"detail":"Invalid token"}"#,
    }])
    .await;
    let mut service = NetboxService::new();

    let error = service
        .connect("inventory".into(), config(address))
        .await
        .unwrap_err();
    assert!(matches!(error.kind, NetboxErrorKind::AuthenticationFailed));
    assert!(service.list_connections().is_empty());
    server.await.unwrap();
}
