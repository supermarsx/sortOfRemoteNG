use serde_json::json;
use sorng_rspamd::actions::ActionManager;
use sorng_rspamd::client::RspamdClient;
use sorng_rspamd::config::RspamdConfigManager;
use sorng_rspamd::error::RspamdErrorKind;
use sorng_rspamd::fuzzy::FuzzyManager;
use sorng_rspamd::maps::MapManager;
use sorng_rspamd::scanning::ScanManager;
use sorng_rspamd::service::RspamdService;
use sorng_rspamd::types::{RspamdAction, RspamdConnectionConfig};
use sorng_rspamd::workers::WorkerManager;
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

    fn text(status: u16, body: impl Into<String>) -> Self {
        Self {
            status,
            body: body.into(),
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

fn config(base_url: String) -> RspamdConnectionConfig {
    RspamdConnectionConfig {
        base_url: format!("{base_url}/"),
        password: Some("controller-password".to_string()),
        timeout_secs: None,
        tls_skip_verify: None,
    }
}

#[tokio::test]
async fn connect_uses_exact_stat_path_and_password_header_then_disconnects_cleanly() {
    let (base_url, requests, task) = spawn_fixture(vec![FixtureResponse::json(
        200,
        json!({
            "version": "3.12.1",
            "config_id": "config-1",
            "uptime": 42,
            "scanned": 7
        }),
    )])
    .await;
    let mut service = RspamdService::new();
    let connection_config = config(base_url);

    let summary = service
        .connect("primary".to_string(), connection_config.clone())
        .await
        .unwrap();

    assert_eq!(summary.version.as_deref(), Some("3.12.1"));
    assert_eq!(summary.scanned, Some(7));
    assert_eq!(service.list_connections(), vec!["primary".to_string()]);
    let duplicate = service
        .connect("primary".to_string(), connection_config)
        .await
        .unwrap_err();
    assert!(matches!(duplicate.kind, RspamdErrorKind::AlreadyConnected));
    service.disconnect("primary").unwrap();
    assert!(service.list_connections().is_empty());
    let error = service.ping("primary").await.unwrap_err();
    assert!(matches!(error.kind, RspamdErrorKind::NotConnected));

    finish_fixture(task).await;
    let requests = requests.lock().await;
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].method, "GET");
    assert_eq!(requests[0].path, "/stat");
    assert_eq!(
        requests[0].headers.get("password").map(String::as_str),
        Some("controller-password")
    );
}

#[tokio::test]
async fn connect_rejects_non_success_and_invalid_schema_without_storing_connection() {
    for (response, expected_kind) in [
        (
            FixtureResponse::json(403, json!({"message": "wrong password level"})),
            "forbidden",
        ),
        (FixtureResponse::json(200, json!({})), "parse"),
    ] {
        let (base_url, _requests, task) = spawn_fixture(vec![response]).await;
        let mut service = RspamdService::new();

        let error = service
            .connect("invalid".to_string(), config(base_url))
            .await
            .unwrap_err();

        match expected_kind {
            "forbidden" => assert!(matches!(error.kind, RspamdErrorKind::Forbidden)),
            "parse" => assert!(matches!(error.kind, RspamdErrorKind::ParseError)),
            _ => unreachable!(),
        }
        assert!(service.list_connections().is_empty());
        finish_fixture(task).await;
    }
}

#[tokio::test]
async fn connect_rejects_http_success_with_application_failure() {
    let (base_url, _requests, task) = spawn_fixture(vec![FixtureResponse::json(
        200,
        json!({"success": false, "message": "controller unavailable"}),
    )])
    .await;
    let mut service = RspamdService::new();

    let error = service
        .connect("invalid".to_string(), config(base_url))
        .await
        .unwrap_err();

    assert!(matches!(error.kind, RspamdErrorKind::ApiError));
    assert!(error.message.contains("controller unavailable"));
    assert!(service.list_connections().is_empty());
    finish_fixture(task).await;
}

#[tokio::test]
async fn stat_reset_uses_get_and_rejects_application_failure() {
    let (base_url, requests, task) = spawn_fixture(vec![
        FixtureResponse::json(
            200,
            json!({"version": "3.12.1", "uptime": 42, "scanned": 7}),
        ),
        FixtureResponse::json(
            200,
            json!({"success": false, "message": "enable password required"}),
        ),
    ])
    .await;
    let mut service = RspamdService::new();
    service
        .connect("primary".to_string(), config(base_url))
        .await
        .unwrap();

    let error = service.reset_stats("primary").await.unwrap_err();

    assert!(matches!(error.kind, RspamdErrorKind::ApiError));
    assert!(error.message.contains("enable password required"));
    finish_fixture(task).await;
    let requests = requests.lock().await;
    assert_eq!(requests[1].method, "GET");
    assert_eq!(requests[1].path, "/statreset");
    assert_eq!(
        requests[1].headers.get("password").map(String::as_str),
        Some("controller-password")
    );
}

#[tokio::test]
async fn fuzzy_add_sends_exactly_one_authenticated_request_with_required_headers() {
    let (base_url, requests, task) =
        spawn_fixture(vec![FixtureResponse::json(200, json!({"success": true}))]).await;
    let client = RspamdClient::new(config(base_url)).unwrap();

    ScanManager::fuzzy_add(&client, "message body", 1, 12.5)
        .await
        .unwrap();

    finish_fixture(task).await;
    let requests = requests.lock().await;
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].method, "POST");
    assert_eq!(requests[0].path, "/fuzzyadd");
    assert_eq!(requests[0].body, "message body");
    assert_eq!(
        requests[0].headers.get("content-type").map(String::as_str),
        Some("text/plain")
    );
    assert_eq!(
        requests[0].headers.get("password").map(String::as_str),
        Some("controller-password")
    );
    assert_eq!(
        requests[0].headers.get("flag").map(String::as_str),
        Some("1")
    );
    assert_eq!(
        requests[0].headers.get("weight").map(String::as_str),
        Some("12.5")
    );
}

#[tokio::test]
async fn map_read_and_save_use_the_required_map_header_and_raw_body() {
    let (base_url, requests, task) = spawn_fixture(vec![
        FixtureResponse::text(200, "alpha one\nbeta two\n"),
        FixtureResponse::json(200, json!({"success": true})),
    ])
    .await;
    let client = RspamdClient::new(config(base_url)).unwrap();

    let entries = MapManager::get_entries(&client, 17).await.unwrap();
    assert_eq!(entries.len(), 2);
    MapManager::save_entries(&client, 17, "alpha updated\n")
        .await
        .unwrap();

    finish_fixture(task).await;
    let requests = requests.lock().await;
    assert_eq!(requests[0].method, "GET");
    assert_eq!(requests[0].path, "/getmap");
    assert_eq!(
        requests[0].headers.get("map").map(String::as_str),
        Some("17")
    );
    assert_eq!(requests[1].method, "POST");
    assert_eq!(requests[1].path, "/savemap");
    assert_eq!(
        requests[1].headers.get("map").map(String::as_str),
        Some("17")
    );
    assert_eq!(requests[1].body, "alpha updated\n");
}

#[tokio::test]
async fn save_actions_uses_the_controller_four_threshold_array() {
    let (base_url, requests, task) =
        spawn_fixture(vec![FixtureResponse::json(200, json!({"success": true}))]).await;
    let client = RspamdClient::new(config(base_url)).unwrap();
    let actions = vec![
        RspamdAction {
            name: "greylist".to_string(),
            threshold: Some(4.0),
            enabled: true,
        },
        RspamdAction {
            name: "add header".to_string(),
            threshold: Some(6.0),
            enabled: true,
        },
        RspamdAction {
            name: "reject".to_string(),
            threshold: Some(15.0),
            enabled: true,
        },
        RspamdAction {
            name: "rewrite subject".to_string(),
            threshold: Some(8.0),
            enabled: false,
        },
    ];

    ActionManager::save(&client, &actions).await.unwrap();

    finish_fixture(task).await;
    let requests = requests.lock().await;
    assert_eq!(requests[0].method, "POST");
    assert_eq!(requests[0].path, "/saveactions");
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&requests[0].body).unwrap(),
        json!([15.0, null, 6.0, 4.0])
    );
}

#[tokio::test]
async fn scan_rejects_a_success_status_with_an_invalid_result_schema() {
    let (base_url, _requests, task) =
        spawn_fixture(vec![FixtureResponse::json(200, json!({}))]).await;
    let client = RspamdClient::new(config(base_url)).unwrap();

    let error = ScanManager::check_message(&client, "message body")
        .await
        .unwrap_err();

    assert!(matches!(error.kind, RspamdErrorKind::ParseError));
    finish_fixture(task).await;
}

#[tokio::test]
async fn unsupported_controller_mutations_fail_before_network_io() {
    let client = RspamdClient::new(config("http://127.0.0.1:1".to_string())).unwrap();

    let plugin_error = RspamdConfigManager::enable_plugin(&client, "neural")
        .await
        .unwrap_err();
    assert!(matches!(plugin_error.kind, RspamdErrorKind::ApiError));
    assert!(plugin_error.message.contains("cannot enable plugin"));

    let reload_error = RspamdConfigManager::reload(&client).await.unwrap_err();
    assert!(matches!(reload_error.kind, RspamdErrorKind::ApiError));
    assert!(reload_error.message.contains("does not expose"));

    let worker_error = WorkerManager::list(&client).await.unwrap_err();
    assert!(matches!(worker_error.kind, RspamdErrorKind::ApiError));
    assert!(worker_error.message.contains("worker inventory"));
}

#[tokio::test]
async fn configured_timeout_is_enforced_and_reported_as_timeout() {
    let (base_url, _requests, task) = spawn_fixture(vec![FixtureResponse::delayed_json(
        200,
        json!({"version": "3.12.1", "uptime": 42, "scanned": 7}),
        Duration::from_millis(1_500),
    )])
    .await;
    let mut connection_config = config(base_url);
    connection_config.timeout_secs = Some(1);
    let client = RspamdClient::new(connection_config).unwrap();

    let result = tokio::time::timeout(Duration::from_secs(2), client.ping())
        .await
        .expect("client request exceeded its configured timeout");
    let error = result.unwrap_err();

    assert!(matches!(error.kind, RspamdErrorKind::Timeout));
    finish_fixture(task).await;
}

#[tokio::test]
async fn learning_rejects_application_level_failure() {
    let (base_url, requests, task) = spawn_fixture(vec![FixtureResponse::json(
        200,
        json!({"success": false, "message": "classifier unavailable"}),
    )])
    .await;
    let client = RspamdClient::new(config(base_url)).unwrap();

    let error = ScanManager::learn_spam(&client, "message body")
        .await
        .unwrap_err();

    assert!(matches!(error.kind, RspamdErrorKind::ApiError));
    assert!(error.message.contains("classifier unavailable"));
    finish_fixture(task).await;
    let requests = requests.lock().await;
    assert_eq!(requests[0].path, "/learnspam");
    assert_eq!(requests[0].body, "message body");
}

#[tokio::test]
async fn fuzzy_status_only_falls_back_on_not_found() {
    let (base_url, requests, task) = spawn_fixture(vec![FixtureResponse::json(
        403,
        json!({"message": "forbidden"}),
    )])
    .await;
    let client = RspamdClient::new(config(base_url)).unwrap();

    let error = FuzzyManager::status(&client).await.unwrap_err();

    assert!(matches!(error.kind, RspamdErrorKind::Forbidden));
    finish_fixture(task).await;
    let requests = requests.lock().await;
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].path, "/plugins/fuzzy/status");
}

#[test]
fn invalid_url_and_zero_timeout_are_rejected_before_io() {
    let invalid_url = RspamdClient::new(config("file://local".to_string()))
        .err()
        .unwrap();
    assert!(matches!(
        invalid_url.kind,
        RspamdErrorKind::ConnectionFailed
    ));

    let mut zero_timeout = config("http://127.0.0.1:1".to_string());
    zero_timeout.timeout_secs = Some(0);
    let error = RspamdClient::new(zero_timeout).err().unwrap();
    assert!(matches!(error.kind, RspamdErrorKind::ConnectionFailed));
}
