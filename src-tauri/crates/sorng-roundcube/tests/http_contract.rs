use serde_json::json;
use sorng_roundcube::client::RoundcubeClient;
use sorng_roundcube::error::RoundcubeErrorKind;
use sorng_roundcube::service::RoundcubeService;
use sorng_roundcube::types::RoundcubeConnectionConfig;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

#[derive(Debug)]
struct CapturedRequest {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: String,
}

struct FixtureResponse {
    status: u16,
    body: String,
    delay: Duration,
}

impl FixtureResponse {
    fn json(status: u16, body: serde_json::Value) -> Self {
        Self {
            status,
            body: body.to_string(),
            delay: Duration::ZERO,
        }
    }

    fn delayed_json(status: u16, body: serde_json::Value, delay: Duration) -> Self {
        Self {
            status,
            body: body.to_string(),
            delay,
        }
    }
}

async fn spawn_fixture(
    responses: Vec<FixtureResponse>,
) -> (String, Arc<Mutex<Vec<CapturedRequest>>>, JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let requests = Arc::new(Mutex::new(Vec::new()));
    let captured = Arc::clone(&requests);
    let task = tokio::spawn(async move {
        for response in responses {
            let (mut stream, _) = listener.accept().await.unwrap();
            captured.lock().await.push(read_request(&mut stream).await);
            let reason = match response.status {
                200 => "OK",
                401 => "Unauthorized",
                403 => "Forbidden",
                500 => "Internal Server Error",
                _ => "Test Response",
            };
            let wire = format!(
                "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response.status,
                reason,
                response.body.len(),
                response.body
            );
            tokio::time::sleep(response.delay).await;
            let _ = stream.write_all(wire.as_bytes()).await;
        }
    });
    (format!("http://{address}"), requests, task)
}

async fn read_request(stream: &mut TcpStream) -> CapturedRequest {
    let mut bytes = Vec::new();
    let mut chunk = [0_u8; 2048];
    let (header_end, content_length) = loop {
        let count = tokio::time::timeout(Duration::from_secs(2), stream.read(&mut chunk))
            .await
            .expect("fixture timed out reading request")
            .unwrap();
        assert!(count > 0, "fixture client closed before sending headers");
        bytes.extend_from_slice(&chunk[..count]);
        if let Some(header_end) = find_header_end(&bytes) {
            let header_text = String::from_utf8_lossy(&bytes[..header_end]);
            let content_length = header_text
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("content-length")
                        .then(|| value.trim().parse::<usize>().unwrap())
                })
                .unwrap_or(0);
            if bytes.len() >= header_end + 4 + content_length {
                break (header_end, content_length);
            }
        }
    };

    let header_text = String::from_utf8_lossy(&bytes[..header_end]);
    let mut lines = header_text.lines();
    let request_line = lines.next().unwrap();
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap().to_string();
    let path = request_parts.next().unwrap().to_string();
    let headers = lines
        .filter_map(|line| {
            let (name, value) = line.split_once(':')?;
            Some((name.to_ascii_lowercase(), value.trim().to_string()))
        })
        .collect();
    let body_start = header_end + 4;
    let body = String::from_utf8(bytes[body_start..body_start + content_length].to_vec()).unwrap();
    CapturedRequest {
        method,
        path,
        headers,
        body,
    }
}

fn find_header_end(bytes: &[u8]) -> Option<usize> {
    bytes.windows(4).position(|window| window == b"\r\n\r\n")
}

async fn finish_fixture(task: JoinHandle<()>) {
    tokio::time::timeout(Duration::from_secs(2), task)
        .await
        .expect("fixture did not receive the expected requests")
        .unwrap();
}

fn config(base_url: String) -> RoundcubeConnectionConfig {
    RoundcubeConnectionConfig {
        base_url: format!("{base_url}/api/"),
        username: "admin@example.test".to_string(),
        password: "secret".to_string(),
        timeout_secs: None,
        tls_skip_verify: None,
    }
}

#[tokio::test]
async fn connect_uses_exact_paths_and_bearer_token_then_disconnects_cleanly() {
    let (base_url, requests, task) = spawn_fixture(vec![
        FixtureResponse::json(200, json!({"token": "session-token"})),
        FixtureResponse::json(
            200,
            json!({
                "version": "1.6.10",
                "skin": "elastic",
                "product_name": "Roundcube",
                "plugins_count": 4
            }),
        ),
    ])
    .await;
    let mut service = RoundcubeService::new();
    let connection_config = config(base_url);

    let summary = service
        .connect("primary".to_string(), connection_config.clone())
        .await
        .unwrap();

    assert_eq!(summary.version.as_deref(), Some("1.6.10"));
    assert_eq!(service.list_connections(), vec!["primary".to_string()]);
    let duplicate = service
        .connect("primary".to_string(), connection_config)
        .await
        .unwrap_err();
    assert!(matches!(
        duplicate.kind,
        RoundcubeErrorKind::AlreadyConnected
    ));
    service.disconnect("primary").unwrap();
    assert!(service.list_connections().is_empty());
    let error = service.ping("primary").await.unwrap_err();
    assert!(matches!(error.kind, RoundcubeErrorKind::NotConnected));

    finish_fixture(task).await;
    let requests = requests.lock().await;
    assert_eq!(requests.len(), 2);
    assert_eq!(requests[0].method, "POST");
    assert_eq!(requests[0].path, "/api/login");
    assert!(!requests[0].headers.contains_key("authorization"));
    assert!(requests[0]
        .headers
        .get("content-type")
        .is_some_and(|value| value.starts_with("application/json")));
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&requests[0].body).unwrap(),
        json!({"user": "admin@example.test", "password": "secret"})
    );
    assert_eq!(requests[1].method, "GET");
    assert_eq!(requests[1].path, "/api/system/info");
    assert_eq!(
        requests[1].headers.get("authorization").map(String::as_str),
        Some("Bearer session-token")
    );
}

#[tokio::test]
async fn connect_rejects_non_success_login_without_storing_connection() {
    let (base_url, _requests, task) = spawn_fixture(vec![FixtureResponse::json(
        401,
        json!({"message": "bad credentials"}),
    )])
    .await;
    let mut service = RoundcubeService::new();

    let error = service
        .connect("rejected".to_string(), config(base_url))
        .await
        .unwrap_err();

    assert!(matches!(
        error.kind,
        RoundcubeErrorKind::AuthenticationFailed
    ));
    assert!(service.list_connections().is_empty());
    finish_fixture(task).await;
}

#[tokio::test]
async fn connect_rejects_application_failure_and_missing_token() {
    for response in [
        json!({"success": false, "message": "account locked"}),
        json!({"success": true}),
    ] {
        let (base_url, _requests, task) =
            spawn_fixture(vec![FixtureResponse::json(200, response)]).await;
        let mut service = RoundcubeService::new();

        let error = service
            .connect("invalid".to_string(), config(base_url))
            .await
            .unwrap_err();

        assert!(matches!(
            error.kind,
            RoundcubeErrorKind::AuthenticationFailed
        ));
        assert!(service.list_connections().is_empty());
        finish_fixture(task).await;
    }
}

#[tokio::test]
async fn connect_rejects_invalid_system_info_schema() {
    let (base_url, _requests, task) = spawn_fixture(vec![
        FixtureResponse::json(200, json!({"token": "session-token"})),
        FixtureResponse::json(200, json!({})),
    ])
    .await;
    let mut service = RoundcubeService::new();

    let error = service
        .connect("invalid".to_string(), config(base_url))
        .await
        .unwrap_err();

    assert!(matches!(error.kind, RoundcubeErrorKind::ParseError));
    assert!(service.list_connections().is_empty());
    finish_fixture(task).await;
}

#[tokio::test]
async fn mutation_rejects_http_success_with_application_failure() {
    let (base_url, requests, task) = spawn_fixture(vec![
        FixtureResponse::json(200, json!({"token": "session-token"})),
        FixtureResponse::json(
            200,
            json!({"success": false, "message": "database is read-only"}),
        ),
    ])
    .await;
    let client = RoundcubeClient::new(config(base_url)).unwrap();
    client.login().await.unwrap();

    let error = client
        .post_no_body("/maintenance/vacuum")
        .await
        .unwrap_err();

    assert!(matches!(error.kind, RoundcubeErrorKind::ApiError));
    assert!(error.message.contains("database is read-only"));
    finish_fixture(task).await;
    let requests = requests.lock().await;
    assert_eq!(requests[1].method, "POST");
    assert_eq!(requests[1].path, "/api/maintenance/vacuum");
    assert_eq!(
        requests[1].headers.get("authorization").map(String::as_str),
        Some("Bearer session-token")
    );
}

#[tokio::test]
async fn configured_timeout_is_enforced_and_reported_as_timeout() {
    let (base_url, _requests, task) = spawn_fixture(vec![FixtureResponse::delayed_json(
        200,
        json!({"token": "too-late"}),
        Duration::from_millis(1_500),
    )])
    .await;
    let mut connection_config = config(base_url);
    connection_config.timeout_secs = Some(1);
    let client = RoundcubeClient::new(connection_config).unwrap();

    let result = tokio::time::timeout(Duration::from_secs(2), client.login())
        .await
        .expect("client request exceeded its configured timeout");
    let error = result.unwrap_err();

    assert!(matches!(error.kind, RoundcubeErrorKind::Timeout));
    finish_fixture(task).await;
}

#[test]
fn invalid_url_and_zero_timeout_are_rejected_before_io() {
    let invalid_url = RoundcubeClient::new(config("file://local".to_string()))
        .err()
        .unwrap();
    assert!(matches!(
        invalid_url.kind,
        RoundcubeErrorKind::ConnectionFailed
    ));

    let mut zero_timeout = config("http://127.0.0.1:1".to_string());
    zero_timeout.timeout_secs = Some(0);
    let error = RoundcubeClient::new(zero_timeout).err().unwrap();
    assert!(matches!(error.kind, RoundcubeErrorKind::ConnectionFailed));
}
