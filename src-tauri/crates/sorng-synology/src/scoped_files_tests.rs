//! Actual HTTP transport fixtures for receipt-scoped File Station operations.
//! Only ephemeral loopback listeners and synthetic credentials are used.
use crate::{
    scoped_files::{FileOperation, FileStationLogin},
    service::SynologyService,
    types::SynologyConfig,
};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    task::JoinHandle,
};

#[derive(Clone, Debug)]
struct Request {
    target: String,
    fields: HashMap<String, String>,
    cookie: Option<String>,
    csrf_header: Option<String>,
}
struct Nas {
    port: u16,
    requests: Arc<Mutex<Vec<Request>>>,
    worker: JoinHandle<()>,
}
impl Drop for Nas {
    fn drop(&mut self) {
        self.worker.abort();
    }
}
impl Nas {
    async fn start(responses: Vec<Value>) -> Self {
        Self::start_paused(responses, None).await
    }
    async fn start_paused(
        responses: Vec<Value>,
        pause: Option<(usize, Arc<tokio::sync::Notify>, Arc<tokio::sync::Notify>)>,
    ) -> Self {
        Self::start_fixture(responses, pause, false).await
    }
    async fn start_fixture(
        responses: Vec<Value>,
        pause: Option<(usize, Arc<tokio::sync::Notify>, Arc<tokio::sync::Notify>)>,
        require_cookie: bool,
    ) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let log = requests.clone();
        let worker = tokio::spawn(async move {
            let mut responses: VecDeque<_> = responses.into();
            loop {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut bytes = Vec::new();
                let (header_end, content_length) = loop {
                    let mut chunk = [0; 4096];
                    let count =
                        tokio::time::timeout(Duration::from_secs(3), stream.read(&mut chunk))
                            .await
                            .unwrap()
                            .unwrap();
                    assert!(
                        count > 0 && bytes.len() + count <= 128 * 1024,
                        "bounded fixture request"
                    );
                    bytes.extend_from_slice(&chunk[..count]);
                    if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                        let headers = std::str::from_utf8(&bytes[..end]).unwrap();
                        let length = headers
                            .lines()
                            .find_map(|line| {
                                let (key, value) = line.split_once(':')?;
                                key.eq_ignore_ascii_case("content-length")
                                    .then(|| value.trim().parse::<usize>().unwrap())
                            })
                            .unwrap_or(0);
                        break (end + 4, length);
                    }
                };
                while bytes.len() < header_end + content_length {
                    let mut chunk = [0; 4096];
                    let count =
                        tokio::time::timeout(Duration::from_secs(3), stream.read(&mut chunk))
                            .await
                            .unwrap()
                            .unwrap();
                    assert!(count > 0 && bytes.len() + count <= 128 * 1024);
                    bytes.extend_from_slice(&chunk[..count]);
                }
                let headers = std::str::from_utf8(&bytes[..header_end]).unwrap();
                let cookie = headers.lines().find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("cookie")
                        .then(|| value.trim().to_string())
                });
                let mut first = headers.lines().next().unwrap().split_whitespace();
                let csrf_header = headers.lines().find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("x-syno-token").then(|| value.trim().to_string())
                });
                assert_eq!(first.next(), Some("POST"));
                let target = first.next().unwrap().to_owned();
                let fields: HashMap<String, String> =
                    url::form_urlencoded::parse(&bytes[header_end..header_end + content_length])
                        .into_owned()
                        .collect();
                let is_login = target.contains("method=login");
                let wants_cookie = fields
                    .get("format")
                    .is_some_and(|value| value == "cookie" || value == "\"cookie\"");
                let cookie_rejected = require_cookie
                    && !is_login
                    && target.contains("SYNO.FileStation.")
                    && (cookie.as_deref() != Some("id=fixture-private-sid") || csrf_header.as_deref() != Some("fixture-private-token"));
                log.lock().unwrap().push(Request {
                    target,
                    fields,
                    cookie,
                    csrf_header,
                });
                if let Some((number, entered, release)) = &pause {
                    if log.lock().unwrap().len() == *number {
                        entered.notify_one();
                        release.notified().await;
                    }
                }
                let response_data = responses
                    .pop_front()
                    .unwrap_or_else(|| json!({"success":false,"error":{"code":999}}));
                let body = if cookie_rejected {
                    json!({"success":false,"error":{"code":119}})
                } else {
                    response_data.clone()
                }
                .to_string();
                let cookie_header = if require_cookie
                    && is_login
                    && wants_cookie
                    && response_data["success"] == true
                {
                    "Set-Cookie: id=fixture-private-sid; Path=/; HttpOnly\r\n"
                } else {
                    ""
                };
                let response = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n{cookie_header}Content-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
                stream.write_all(response.as_bytes()).await.unwrap();
                stream.shutdown().await.unwrap();
            }
        });
        Self {
            port,
            requests,
            worker,
        }
    }
    fn config(&self) -> SynologyConfig {
        SynologyConfig {
            host: "127.0.0.1".into(),
            port: self.port,
            username: "fixture-user".into(),
            password: "fixture-password&=?".into(),
            use_https: false,
            insecure: false,
            timeout_secs: 3,
            otp_code: Some("123456".into()),
            device_token: Some("must-not-enroll".into()),
            access_token: Some("must-not-use-as-sid".into()),
        }
    }
    fn requests(&self) -> Vec<Request> {
        self.requests.lock().unwrap().clone()
    }
}
fn ok(data: Value) -> Value {
    json!({"success":true,"data":data})
}
fn discovery(json_parameters: bool) -> Value {
    let mut entries = serde_json::Map::new();
    for (api, maximum) in [
        ("SYNO.API.Auth", 7),
        ("SYNO.FileStation.Info", 2),
        ("SYNO.FileStation.List", 2),
        ("SYNO.FileStation.CopyMove", 3),
        ("SYNO.FileStation.Delete", 2),
        ("SYNO.FileStation.Search", 2),
        ("SYNO.FileStation.Sharing", 3),
        ("SYNO.DownloadStation.Task", 3),
        ("SYNO.Core.ISCSI.LUN", 1),
        ("SYNO.Core.ISCSI.Target", 1),
    ] {
        let mut entry = json!({"path":"entry.cgi","minVersion":1,"maxVersion":maximum});
        if json_parameters {
            entry["requestFormat"] = json!("JSON");
        }
        entries.insert(api.into(), entry);
    }
    ok(Value::Object(entries))
}
fn login_responses(json_parameters: bool) -> Vec<Value> {
    vec![
        discovery(json_parameters),
        ok(
            json!({"sid":"fixture-private-sid","synotoken":"fixture-private-token","did":"not-enrolled"}),
        ),
        ok(json!({})),
    ]
}
async fn connect(service: &mut SynologyService, nas: &Nas) -> String {
    match service.fs_connect(nas.config()).await.unwrap() {
        FileStationLogin::Connected { session_id, .. } => session_id,
        other => panic!("expected connected receipt, got {other:?}"),
    }
}
fn method(request: &Request) -> String {
    url::Url::parse(&format!("http://fixture{}", request.target))
        .unwrap()
        .query_pairs()
        .find(|(key, _)| key == "method")
        .map(|(_, value)| value.into_owned())
        .unwrap_or_default()
}

#[path = "instances_tests.rs"]
mod instances_tests;
#[path = "wire_contract_tests.rs"]
mod wire_contract_tests;

#[tokio::test]
async fn credentials_are_post_only_and_never_enroll_devices_for_plain_and_json_apis() {
    for json_parameters in [false, true] {
        let nas = Nas::start(login_responses(json_parameters)).await;
        let mut service = SynologyService::new();
        let receipt = connect(&mut service, &nas).await;
        assert_ne!(receipt, "fixture-private-sid");
        let requests = nas.requests();
        assert_eq!(requests.len(), 3);
        assert_eq!(requests[0].target, "/webapi/entry.cgi");
        let login = &requests[1];
        assert_eq!(method(login), "login");
        assert!(login.target.contains("version=6"));
        for (name, value) in [
            ("account", "fixture-user"),
            ("passwd", "fixture-password&=?"),
            ("otp_code", "123456"),
            ("session", "FileStation"),
            ("format", "cookie"),
        ] {
            let expected = if json_parameters {
                json!(value).to_string()
            } else {
                value.into()
            };
            assert_eq!(login.fields[name], expected);
        }
        for request in &requests {
            for secret in [
                "fixture-user",
                "fixture-password",
                "123456",
                "fixture-private-sid",
                "fixture-private-token",
            ] {
                assert!(!request.target.contains(secret));
            }
            for key in [
                "device_id",
                "device_name",
                "enable_device_token",
                "device_token",
            ] {
                assert!(!request.fields.contains_key(key));
            }
        }
        let client = service.client.as_ref().unwrap();
        assert!(client.config.password.is_empty());
        assert!(client.config.otp_code.is_none());
        assert!(client.config.device_token.is_none());
        assert!(client.config.access_token.is_none());
        assert!(client.device_token.is_none());
    }
}

#[tokio::test]
async fn login_cookie_reaches_first_authenticated_request_and_is_not_shared_between_instances() {
    for json_parameters in [false, true] {
        let nas = Nas::start_fixture(login_responses(json_parameters), None, true).await;
        let mut service = SynologyService::new();
        connect(&mut service, &nas).await;
        let requests = nas.requests();
        assert!(requests[0].cookie.is_none());
        assert!(requests[1].cookie.is_none());
        assert_eq!(
            requests[2].cookie.as_deref(),
            Some("id=fixture-private-sid")
        );
        assert_eq!(requests[2].fields["_sid"], "fixture-private-sid");
        assert_eq!(requests[2].csrf_header.as_deref(), Some("fixture-private-token"));
        assert_eq!(requests[2].fields["SynoToken"], "fixture-private-token");
        let other = Nas::start_fixture(login_responses(json_parameters), None, true).await;
        connect(&mut SynologyService::new(), &other).await;
        assert!(other.requests()[1].cookie.is_none());
    }
}

#[tokio::test]
async fn otp_challenges_are_typed_single_attempts_and_keep_existing_session() {
    for (code, status) in [
        (403, "otp_required"),
        (404, "otp_invalid"),
        (406, "otp_required"),
        (449, "unsupported_mfa"),
    ] {
        let mut responses = login_responses(false);
        responses.extend([discovery(false),json!({"success":false,"error":{"code":code,"errors":[{"message":"fixture-private-sid fixture-password"}]}})]);
        let nas = Nas::start(responses).await;
        let mut service = SynologyService::new();
        let receipt = connect(&mut service, &nas).await;
        let result = serde_json::to_value(service.fs_connect(nas.config()).await.unwrap()).unwrap();
        assert_eq!(result["status"], status);
        assert!(!result.to_string().contains("fixture-private"));
        service.fs_assert_session(&receipt).unwrap();
        assert_eq!(
            nas.requests().len(),
            5,
            "no automatic login retry or replacement logout"
        );
    }
}

#[tokio::test]
async fn shares_and_snake_case_optional_metadata_are_preserved_without_fabrication() {
    let mut responses = login_responses(false);
    responses.push(ok(json!({"shares":[{"name":"public","path":"/public","isdir":true,"additional":{"real_path":"/volume1/public","mount_point_type":"local","perm":{"is_acl_mode":true},"time":{"mtime":123}}},{"name":"other","path":"/other","isdir":true}],"total":2,"offset":0})));
    let nas = Nas::start(responses).await;
    let mut service = SynologyService::new();
    let receipt = connect(&mut service, &nas).await;
    let result = service
        .fs_list(&receipt, None, 0, 100, "name", "asc")
        .await
        .unwrap();
    assert_eq!(result.files.len(), 2);
    let metadata = result.files[0].additional.as_ref().unwrap();
    assert_eq!(metadata.real_path.as_deref(), Some("/volume1/public"));
    assert_eq!(metadata.mount_point_type.as_deref(), Some("local"));
    assert_eq!(metadata.perm.as_ref().unwrap().is_acl_mode, Some(true));
    assert!(metadata.size.is_none());
    assert!(result.files[1].additional.is_none());
    assert_eq!(method(nas.requests().last().unwrap()), "list_share");
}

#[tokio::test]
async fn copy_task_uses_opaque_receipt_safe_path_encoding_and_actual_completion() {
    let mut responses = login_responses(true);
    responses.extend([
        ok(json!({"taskid":"nas-private-task"})),
        ok(json!({"finished":false,"progress":0.25})),
        ok(json!({"finished":true,"progress":1.0})),
    ]);
    let nas = Nas::start(responses).await;
    let mut service = SynologyService::new();
    let receipt = connect(&mut service, &nas).await;
    let path = "/public/quote\" & percent% ☃.txt";
    let task = service
        .fs_start_task(
            &receipt,
            FileOperation::Copy,
            vec![path.into()],
            Some("/destination".into()),
            None,
            None,
        )
        .await
        .unwrap();
    assert_ne!(task.task_id, "nas-private-task");
    let request = nas.requests().last().unwrap().clone();
    assert_eq!(
        serde_json::from_str::<Value>(&request.fields["path"]).unwrap(),
        json!([path])
    );
    assert_eq!(request.fields["remove_src"], "false");
    assert!(!request.fields.contains_key("overwrite"));
    assert!(!request.target.contains("quote"));
    let pending = service
        .fs_task_status(&receipt, &task.task_id, 0, 100)
        .await
        .unwrap();
    assert!(!pending.finished);
    assert_eq!(pending.progress, Some(0.25));
    assert!(
        service
            .fs_task_status(&receipt, &task.task_id, 0, 100)
            .await
            .unwrap()
            .finished
    );
    let count = nas.requests().len();
    assert!(service
        .fs_task_status(&receipt, &task.task_id, 0, 100)
        .await
        .is_err());
    assert_eq!(nas.requests().len(), count);
}

#[tokio::test]
async fn foreign_receipts_invalid_paths_and_raw_task_ids_refuse_before_transport() {
    let nas = Nas::start(login_responses(false)).await;
    let mut service = SynologyService::new();
    let receipt = connect(&mut service, &nas).await;
    assert!(service
        .fs_list("foreign", None, 0, 100, "name", "asc")
        .await
        .is_err());
    assert!(!service.fs_disconnect("foreign").await.unwrap());
    assert!(service
        .fs_task_status(&receipt, "nas-private-task", 0, 100)
        .await
        .is_err());
    for path in [
        "/",
        "/public/../private",
        "/public//file",
        "relative",
        "/public/file\n",
    ] {
        assert!(service
            .fs_start_task(
                &receipt,
                FileOperation::Delete,
                vec![path.into()],
                None,
                None,
                None
            )
            .await
            .is_err());
    }
    assert_eq!(nas.requests().len(), 3);
    service.fs_assert_session(&receipt).unwrap();
}

#[tokio::test]
async fn failed_search_status_attempts_stop_and_clean_without_leaking_nas_error_details() {
    let mut responses = login_responses(false);
    responses.extend([ok(json!({"taskid":"nas-search-task"})),json!({"success":false,"error":{"code":105,"errors":[{"message":"fixture-private-sid fixture-password"}]}}),ok(json!({})),ok(json!({}))]);
    let nas = Nas::start(responses).await;
    let mut service = SynologyService::new();
    let receipt = connect(&mut service, &nas).await;
    let task = service
        .fs_start_task(
            &receipt,
            FileOperation::Search,
            vec!["/public".into()],
            None,
            Some("*.txt".into()),
            None,
        )
        .await
        .unwrap();
    let error = service
        .fs_task_status(&receipt, &task.task_id, 0, 100)
        .await
        .unwrap_err();
    assert!(!error.to_string().contains("fixture-private-sid"));
    assert!(!error.to_string().contains("fixture-password"));
    let requests = nas.requests();
    assert_eq!(
        requests.iter().skip(3).map(method).collect::<Vec<_>>(),
        ["start", "list", "stop", "clean"]
    );
    assert!(service
        .fs_task_status(&receipt, &task.task_id, 0, 100)
        .await
        .is_err());
    assert_eq!(nas.requests().len(), requests.len());
}

#[tokio::test]
async fn disconnect_cleans_search_even_if_stop_fails_and_revokes_old_receipt() {
    let mut responses = login_responses(false);
    responses.extend([
        ok(json!({"taskid":"nas-search-task"})),
        json!({"success":false,"error":{"code":599}}),
        ok(json!({})),
        ok(json!({})),
    ]);
    let nas = Nas::start(responses).await;
    let mut service = SynologyService::new();
    let receipt = connect(&mut service, &nas).await;
    service
        .fs_start_task(
            &receipt,
            FileOperation::Search,
            vec!["/public".into()],
            None,
            Some("*".into()),
            None,
        )
        .await
        .unwrap();
    assert!(service.fs_disconnect(&receipt).await.unwrap());
    let requests = nas.requests();
    assert_eq!(
        requests.iter().skip(3).map(method).collect::<Vec<_>>(),
        ["start", "stop", "clean", "logout"]
    );
    assert!(!service.is_connected());
    assert!(service
        .fs_list(&receipt, None, 0, 100, "name", "asc")
        .await
        .is_err());
    assert!(!service.fs_disconnect(&receipt).await.unwrap());
    assert_eq!(nas.requests().len(), requests.len());
}
