//! Real loopback response decoding; synthetic credentials only, no NAS access.
use crate::{
    client::SynoClient,
    download_station::DownloadStationManager,
    error::{command_error, SynologyError, SynologyErrorKind},
    scoped_files::FileStationLogin,
    service::SynologyService,
    system::SystemManager,
    types::{ApiInfoEntry, SynoResponse, SynologyConfig},
};
use serde_json::{json, Value};
use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    task::JoinHandle,
};

const PRIVATE: &str = "synthetic-private-response-marker";
/// The reply from the user's report: HTTP 200, JSON, exactly 38 bytes.
const DENIED_105: &str = r#"{"error":{"code":105},"success":false}"#;
/// What the user's report must read now (plan t84 §4.2).
const USER_REPORT: &str = concat!(
    "SYNO.Core.System.Utilization: requires a DSM administrator account (code 105)\n",
    r#"synology-diagnostic:v1:{"stage":"api_response","category":"dsm_api","httpStatus":200,"contentType":"json","bytesRead":38,"dsmCode":105,"access":"administrator"}"#
);

#[derive(Clone)]
struct Reply {
    status: u16,
    content_type: Option<&'static str>,
    body: Vec<u8>,
}
impl Reply {
    fn json(value: Value) -> Self {
        Self {
            status: 200,
            content_type: Some("application/json"),
            body: value.to_string().into_bytes(),
        }
    }
    fn body(body: impl Into<Vec<u8>>, content_type: Option<&'static str>) -> Self {
        Self {
            status: 200,
            content_type,
            body: body.into(),
        }
    }
}

struct Peer {
    port: u16,
    requests: Arc<AtomicUsize>,
    worker: JoinHandle<()>,
}
impl Drop for Peer {
    fn drop(&mut self) {
        self.worker.abort();
    }
}
impl Peer {
    async fn start(replies: Vec<Reply>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let requests = Arc::new(AtomicUsize::new(0));
        let count = requests.clone();
        let worker = tokio::spawn(async move {
            let mut replies: VecDeque<_> = replies.into();
            loop {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut request = Vec::new();
                loop {
                    let mut chunk = [0u8; 4096];
                    let length =
                        tokio::time::timeout(Duration::from_secs(3), stream.read(&mut chunk))
                            .await
                            .unwrap()
                            .unwrap();
                    assert!(length > 0 && request.len() + length <= 128 * 1024);
                    request.extend_from_slice(&chunk[..length]);
                    if let Some(end) = request.windows(4).position(|value| value == b"\r\n\r\n") {
                        let headers = std::str::from_utf8(&request[..end]).unwrap();
                        let body_length = headers
                            .lines()
                            .find_map(|line| {
                                let (key, value) = line.split_once(':')?;
                                key.eq_ignore_ascii_case("content-length")
                                    .then(|| value.trim().parse::<usize>().unwrap())
                            })
                            .unwrap_or(0);
                        if request.len() >= end + 4 + body_length {
                            break;
                        }
                    }
                }
                count.fetch_add(1, Ordering::SeqCst);
                let reply = replies
                    .pop_front()
                    .unwrap_or_else(|| Reply::json(json!({"success":true,"data":{}})));
                let mime = reply
                    .content_type
                    .map(|value| format!("Content-Type: {value}\r\n"))
                    .unwrap_or_default();
                let headers = format!("HTTP/1.1 {} Fixture\r\n{mime}Set-Cookie: id={PRIVATE}; Path=/; HttpOnly\r\nLocation: https://{PRIVATE}.invalid/path?secret={PRIVATE}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", reply.status, reply.body.len());
                if stream.write_all(headers.as_bytes()).await.is_ok() {
                    let _ = stream.write_all(&reply.body).await;
                }
                let _ = stream.shutdown().await;
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
            password: "fixture-password".into(),
            use_https: false,
            insecure: false,
            timeout_secs: 3,
            otp_code: None,
            device_token: None,
            access_token: None,
        }
    }
    fn count(&self) -> usize {
        self.requests.load(Ordering::SeqCst)
    }
}

fn discovery() -> Reply {
    Reply::json(json!({"success":true,"data":{
        "SYNO.API.Auth":{"path":"entry.cgi","minVersion":1,"maxVersion":7},
        "SYNO.FileStation.Info":{"path":"entry.cgi","minVersion":1,"maxVersion":2}
    }}))
}
fn login() -> Reply {
    Reply::json(json!({"success":true,"data":{"sid":PRIVATE,"synotoken":PRIVATE}}))
}
fn diagnostic(error: &SynologyError) -> Value {
    let wire = command_error(error.clone());
    assert!(!wire.contains(PRIVATE));
    assert!(!wire.contains("fixture-user") && !wire.contains("fixture-password"));
    for forbidden in [
        "unexpected_private_key",
        "private_api",
        "missing field",
        "invalid type",
        " at line ",
    ] {
        assert!(
            !wire.contains(forbidden),
            "parser keys/messages must not be exposed"
        );
    }
    let (_, tail) = wire
        .rsplit_once("\nsynology-diagnostic:v1:")
        .expect("fixed final diagnostic line");
    assert_eq!(wire.matches("synology-diagnostic:v1:").count(), 1);
    let value: Value = serde_json::from_str(tail).unwrap();
    assert!(value.as_object().unwrap().keys().all(|key| [
        "stage",
        "category",
        "httpStatus",
        "contentType",
        "bytesRead",
        "dsmCode",
        "access"
    ]
    .contains(&key.as_str())));
    if value.get("access").is_some() {
        assert_eq!(value["category"], "dsm_api");
        assert_eq!(value["dsmCode"], 105);
    }
    value
}

/// An authenticated client whose discovery lists `apis`.
fn signed_in(peer: &Peer, apis: &[(&str, u32)]) -> SynoClient {
    let mut client = SynoClient::new(&peer.config()).unwrap();
    client.sid = Some(PRIVATE.into());
    client.syno_token = Some(PRIVATE.into());
    for (api, max_version) in apis {
        client.api_info.insert(
            (*api).into(),
            ApiInfoEntry {
                path: "entry.cgi".into(),
                min_version: 1,
                max_version: *max_version,
                request_format: None,
            },
        );
    }
    client
}

#[tokio::test]
async fn discovery_distinguishes_empty_html_syntax_and_schema_without_response_content() {
    let cases = [
        (Reply::body(Vec::new(), None), "empty", "missing"),
        (
            Reply::body(b" \r\n\t".to_vec(), Some("text/plain")),
            "empty",
            "text",
        ),
        (
            Reply::body(
                format!("<!DOCTYPE html><html>{PRIVATE}</html>"),
                Some("text/html; charset=utf-8"),
            ),
            "html",
            "html",
        ),
        (
            Reply::body(format!("<html>{PRIVATE}</html>"), Some("text/plain")),
            "html",
            "text",
        ),
        (
            Reply::body(format!("{{\"{PRIVATE}\":"), Some("application/json")),
            "json_syntax",
            "json",
        ),
        (
            Reply::body(
                b"\xef\xbb\xbf{\"success\":true,\"data\":{}}".to_vec(),
                Some("application/json"),
            ),
            "json_syntax",
            "json",
        ),
        (
            Reply::json(json!({"unexpected_private_key":PRIVATE})),
            "json_schema",
            "json",
        ),
        (
            Reply::json(
                json!({"success":true,"data":{"private_api":{"path":"entry.cgi","minVersion":1}}}),
            ),
            "json_schema",
            "json",
        ),
        (
            Reply::json(
                json!({"success":true,"data":{"private_api":{"path":"entry.cgi","minVersion":"1","maxVersion":7}}}),
            ),
            "json_schema",
            "json",
        ),
    ];
    for (reply, category, mime) in cases {
        let length = reply.body.len();
        // HTML at entry.cgi permits one anonymous GET query.cgi compatibility
        // read, never a login. Both gateway responses remain diagnostic.
        let expected_reads = if category == "html" { 2 } else { 1 };
        let peer = Peer::start(vec![reply; expected_reads]).await;
        let error = SynologyService::new()
            .fs_connect(peer.config())
            .await
            .unwrap_err();
        assert!(matches!(error.kind, SynologyErrorKind::ParseError));
        assert_eq!(
            diagnostic(&error),
            json!({"stage":"api_discovery","category":category,"httpStatus":200,"contentType":mime,"bytesRead":length})
        );
        assert_eq!(
            peer.count(),
            expected_reads,
            "discovery failure cannot dispatch login"
        );
    }
}

#[tokio::test]
async fn login_decode_failures_keep_stage_and_never_accept_cookie_only_or_retry_credentials() {
    for reply in [
        Reply::body(format!("<html>{PRIVATE}</html>"), Some("text/html")),
        Reply::body(b"{".to_vec(), Some("application/json")),
        Reply::json(json!({"success":true,"data":{}})),
        Reply::json(json!({"success":true,"data":{"sid":null}})),
        Reply::json(json!({"success":true,"data":{"sid":42}})),
    ] {
        let expected = if reply.body.starts_with(b"<") {
            "html"
        } else if reply.body == b"{" {
            "json_syntax"
        } else {
            "json_schema"
        };
        let peer = Peer::start(vec![discovery(), reply]).await;
        let error = SynologyService::new()
            .fs_connect(peer.config())
            .await
            .unwrap_err();
        let facts = diagnostic(&error);
        assert_eq!(facts["stage"], "api_login");
        assert_eq!(facts["category"], expected);
        assert_eq!(
            peer.count(),
            2,
            "no automatic sign-in replay or post-login probe"
        );
    }
}

#[tokio::test]
async fn valid_json_is_accepted_under_text_plain_without_changing_request_count() {
    let mut replies = vec![
        discovery(),
        login(),
        Reply::json(json!({"success":true,"data":{}})),
    ];
    for reply in &mut replies {
        reply.content_type = Some("text/plain; charset=utf-8");
    }
    let peer = Peer::start(replies).await;
    assert!(matches!(
        SynologyService::new()
            .fs_connect(peer.config())
            .await
            .unwrap(),
        FileStationLogin::Connected { .. }
    ));
    assert_eq!(peer.count(), 3);
}

#[tokio::test]
async fn null_supplemental_errors_preserve_authentication_codes_and_mfa_flow() {
    for code in [400, 403, 404, 406, 407, 408, 409, 410, 449] {
        let peer = Peer::start(vec![
            discovery(),
            Reply::json(json!({"success":false,"error":{"code":code,"errors":null}})),
        ])
        .await;
        let result = SynologyService::new().fs_connect(peer.config()).await;
        match code {
            403 | 406 => assert!(matches!(
                result.unwrap(),
                FileStationLogin::OtpRequired { .. }
            )),
            404 => assert!(matches!(
                result.unwrap(),
                FileStationLogin::OtpInvalid { .. }
            )),
            449 => assert!(matches!(
                result.unwrap(),
                FileStationLogin::UnsupportedMfa { .. }
            )),
            _ => {
                let error = result.unwrap_err();
                assert!(matches!(error.kind, SynologyErrorKind::AuthenticationError));
                let facts = diagnostic(&error);
                assert_eq!(facts["category"], "dsm_api");
                assert_eq!(facts["stage"], "api_login");
                assert_eq!(facts["dsmCode"], code);
            }
        }
        assert_eq!(peer.count(), 2);
    }
    for errors in [json!({"private":PRIVATE}), json!(PRIVATE), json!(false)] {
        let peer = Peer::start(vec![Reply::json(
            json!({"success":false,"error":{"code":400,"errors":errors}}),
        )])
        .await;
        let error = SynologyService::new()
            .fs_connect(peer.config())
            .await
            .unwrap_err();
        assert_eq!(diagnostic(&error)["category"], "json_schema");
    }
}

#[tokio::test]
async fn http_refusals_stay_transport_errors_and_do_not_read_or_follow_body() {
    for status in [302, 307, 400, 403, 503] {
        let mut reply = Reply::body(
            format!("<html>{PRIVATE}</html>"),
            Some("private/type; token=private"),
        );
        reply.status = status;
        let peer = Peer::start(vec![reply]).await;
        let error = SynologyService::new()
            .fs_connect(peer.config())
            .await
            .unwrap_err();
        assert!(matches!(error.kind, SynologyErrorKind::ConnectionError));
        assert_eq!(
            diagnostic(&error),
            json!({"stage":"api_discovery","category":"http_status","httpStatus":status,"contentType":"other","bytesRead":0})
        );
        assert_eq!(peer.count(), 1);
    }
    let mut reply = Reply::json(json!({"private":PRIVATE}));
    reply.status = 600;
    let peer = Peer::start(vec![reply]).await;
    let error = SynologyService::new()
        .fs_connect(peer.config())
        .await
        .unwrap_err();
    assert!(matches!(error.kind, SynologyErrorKind::ConnectionError));
    assert_eq!(error.to_string(), "NAS HTTP request failed (status 600)");
    assert_eq!(peer.count(), 1);
}

#[tokio::test]
async fn authenticated_check_context_and_session_error_remapping_preserve_safe_metadata() {
    for code in [None, Some(106), Some(107), Some(119), Some(150)] {
        let reply = code
            .map(|code| Reply::json(json!({"success":false,"error":{"code":code,"errors":null}})))
            .unwrap_or_else(|| Reply::body(format!("<html>{PRIVATE}</html>"), Some("text/html")));
        let peer = Peer::start(vec![discovery(), login(), reply]).await;
        let error = SynologyService::new()
            .fs_connect(peer.config())
            .await
            .unwrap_err();
        assert!(error.message.starts_with(
            "DSM accepted sign-in, but the first authenticated File Station check failed."
        ));
        let facts = diagnostic(&error);
        assert_eq!(facts["stage"], "authenticated_file_station");
        assert_eq!(
            facts["category"],
            if code.is_some() { "dsm_api" } else { "html" }
        );
        if let Some(code) = code {
            assert!(matches!(error.kind, SynologyErrorKind::ApiError(_)));
            assert_eq!(facts["dsmCode"], code);
            assert!(command_error(error).starts_with("SYNOLOGY_SESSION_EXPIRED:"));
        }
        assert_eq!(
            peer.count(),
            4,
            "only discovery, login, check and best-effort logout"
        );
    }
}

#[tokio::test]
async fn legacy_typed_login_and_response_limit_also_keep_diagnostics() {
    let peer = Peer::start(vec![
        discovery(),
        Reply::json(json!({"success":true,"data":{}})),
    ])
    .await;
    let error = SynologyService::new()
        .connect(peer.config())
        .await
        .unwrap_err();
    assert_eq!(diagnostic(&error)["stage"], "api_login");
    assert_eq!(diagnostic(&error)["category"], "json_schema");
    assert_eq!(peer.count(), 2);

    let peer = Peer::start(vec![Reply::body(
        vec![b' '; 8 * 1024 * 1024 + 1],
        Some("application/json"),
    )])
    .await;
    let mut client = SynoClient::new(&peer.config()).unwrap();
    let error = client.discover_apis().await.unwrap_err();
    let facts = diagnostic(&error);
    assert_eq!(facts["category"], "response_too_large");
    assert!(facts["bytesRead"].as_u64().unwrap() <= 8 * 1024 * 1024);
    assert_eq!(peer.count(), 1);

    // Numeric code remains authoritative; only nullable supplemental details change.
    for errors in [Value::Null, json!([]), json!([{"private":PRIVATE}])] {
        let value: SynoResponse<Value> =
            serde_json::from_value(json!({"success":false,"error":{"code":400,"errors":errors}}))
                .unwrap();
        assert_eq!(value.error.unwrap().code, 400);
    }
}

#[tokio::test]
async fn the_reported_utilization_refusal_names_the_administrator_requirement() {
    assert_eq!(DENIED_105.len(), 38);
    let peer = Peer::start(vec![Reply::body(DENIED_105, Some("application/json"))]).await;
    let client = signed_in(&peer, &[("SYNO.Core.System.Utilization", 1)]);
    let error = SystemManager::get_utilization(&client).await.unwrap_err();
    assert!(matches!(error.kind, SynologyErrorKind::PermissionDenied));
    assert_eq!(command_error(error.clone()), USER_REPORT);
    assert_eq!(error.to_string(), USER_REPORT);
    assert_eq!(diagnostic(&error)["access"], "administrator");
    assert_eq!(peer.count(), 1);
}

#[tokio::test]
async fn application_apis_name_the_application_privilege() {
    let peer = Peer::start(vec![Reply::body(DENIED_105, Some("application/json"))]).await;
    let client = signed_in(&peer, &[("SYNO.FileStation.List", 2)]);
    let error = client
        .file_call("SYNO.FileStation.List", 2, "list_share", &[])
        .await
        .unwrap_err();
    assert_eq!(
        diagnostic(&error),
        json!({"stage":"authenticated_file_station","category":"dsm_api","httpStatus":200,"contentType":"json","bytesRead":38,"dsmCode":105,"access":"application_privilege"})
    );

    let peer = Peer::start(vec![Reply::json(
        json!({"success":false,"error":{"code":105}}),
    )])
    .await;
    let client = signed_in(&peer, &[("SYNO.DownloadStation.Task", 3)]);
    let error = DownloadStationManager::list_tasks(&client)
        .await
        .unwrap_err();
    assert!(matches!(error.kind, SynologyErrorKind::PermissionDenied));
    assert_eq!(
        error.message,
        "SYNO.DownloadStation.Task: requires the Download Station application privilege (code 105)"
    );
    assert_eq!(diagnostic(&error)["access"], "application_privilege");
}

#[tokio::test]
async fn refusals_without_a_privilege_class_and_code_120_carry_no_access() {
    for (api, message) in [
        (
            "SYNO.Fixture.NotInTable",
            "SYNO.Fixture.NotInTable: Permission denied (code 105)",
        ),
        (
            "SYNO.DSM.Info",
            "SYNO.DSM.Info: Permission denied (code 105)",
        ),
    ] {
        let peer = Peer::start(vec![Reply::body(DENIED_105, Some("application/json"))]).await;
        let client = signed_in(&peer, &[(api, 2)]);
        let error = client
            .api_call::<Value>(api, 1, "get", &[])
            .await
            .unwrap_err();
        assert!(matches!(error.kind, SynologyErrorKind::PermissionDenied));
        assert_eq!(error.message, message);
        let facts = diagnostic(&error);
        assert_eq!(facts["dsmCode"], 105);
        assert!(facts.get("access").is_none(), "{api}");
    }

    // DSM answers 120 to invalid or missing parameters: not a permission refusal.
    let peer = Peer::start(vec![Reply::json(
        json!({"success":false,"error":{"code":120}}),
    )])
    .await;
    let client = signed_in(&peer, &[("SYNO.Core.System.Utilization", 1)]);
    let error = SystemManager::get_utilization(&client).await.unwrap_err();
    assert!(matches!(error.kind, SynologyErrorKind::ApiError(120)));
    assert_eq!(
        error.message,
        "SYNO.Core.System.Utilization: DSM rejected the request parameters (code 120)"
    );
    let facts = diagnostic(&error);
    assert_eq!(facts["dsmCode"], 120);
    assert!(facts.get("access").is_none());
}

#[tokio::test]
async fn access_is_only_ever_attached_to_authenticated_dsm_refusals() {
    let utilization = [("SYNO.Core.System.Utilization", 1)];
    for (reply, category) in [
        (
            Reply::body(format!("<html>{PRIVATE}</html>"), Some("text/html")),
            "html",
        ),
        (
            Reply::json(json!({"success":true,"data":{"cpu":PRIVATE}})),
            "json_schema",
        ),
        (
            Reply::body(format!("{{\"{PRIVATE}\":"), Some("application/json")),
            "json_syntax",
        ),
    ] {
        let peer = Peer::start(vec![reply]).await;
        let client = signed_in(&peer, &utilization);
        let error = SystemManager::get_utilization(&client).await.unwrap_err();
        let facts = diagnostic(&error);
        assert_eq!(facts["category"], category);
        assert!(facts.get("access").is_none(), "{category}");
    }
    let mut refused = Reply::body(DENIED_105, Some("application/json"));
    refused.status = 403;
    let peer = Peer::start(vec![refused]).await;
    let error = SystemManager::get_utilization(&signed_in(&peer, &utilization))
        .await
        .unwrap_err();
    let facts = diagnostic(&error);
    assert_eq!(facts["category"], "http_status");
    assert!(facts.get("access").is_none());

    // Discovery and sign-in refusals never name an account class.
    let peer = Peer::start(vec![Reply::body(DENIED_105, Some("application/json"))]).await;
    let error = SynologyService::new()
        .fs_connect(peer.config())
        .await
        .unwrap_err();
    let facts = diagnostic(&error);
    assert_eq!(facts["stage"], "api_discovery");
    assert!(facts.get("access").is_none());
    let peer = Peer::start(vec![
        discovery(),
        Reply::body(DENIED_105, Some("application/json")),
    ])
    .await;
    let error = SynologyService::new()
        .fs_connect(peer.config())
        .await
        .unwrap_err();
    let facts = diagnostic(&error);
    assert_eq!(facts["stage"], "api_login");
    assert_eq!(facts["dsmCode"], 105);
    assert!(facts.get("access").is_none());
    assert_eq!(peer.count(), 2);
}

#[tokio::test]
async fn session_expiry_on_an_administrator_api_is_unchanged() {
    let peer = Peer::start(vec![Reply::json(
        json!({"success":false,"error":{"code":106}}),
    )])
    .await;
    let client = signed_in(&peer, &[("SYNO.Core.System.Utilization", 1)]);
    let error = SystemManager::get_utilization(&client).await.unwrap_err();
    assert!(matches!(error.kind, SynologyErrorKind::SessionExpired));
    assert!(command_error(error.clone()).starts_with("SYNOLOGY_SESSION_EXPIRED: "));
    let facts = diagnostic(&error);
    assert_eq!(facts["dsmCode"], 106);
    assert!(facts.get("access").is_none());
}

#[test]
fn dsm_permission_messages_follow_the_api_privilege() {
    let message = |code, api| SynologyError::from_dsm_code(code, api).message;
    assert_eq!(
        message(105, "SYNO.Core.User"),
        "SYNO.Core.User: requires a DSM administrator account (code 105)"
    );
    assert_eq!(
        message(105, "SYNO.Docker.Container"),
        "SYNO.Docker.Container: requires a DSM administrator account (code 105)"
    );
    assert_eq!(
        message(105, "SYNO.SurveillanceStation.Camera"),
        "SYNO.SurveillanceStation.Camera: requires the Surveillance Station application privilege (code 105)"
    );
    assert_eq!(
        message(105, "SYNO.Core.CurrentConnection"),
        "SYNO.Core.CurrentConnection: Permission denied (code 105)"
    );
    assert_eq!(
        message(120, "SYNO.Core.User"),
        "SYNO.Core.User: DSM rejected the request parameters (code 120)"
    );
    assert!(matches!(
        SynologyError::from_dsm_code(105, "SYNO.Core.User").kind,
        SynologyErrorKind::PermissionDenied
    ));
    // Without a response there is no DSM code to classify.
    assert!(SynologyError::from_dsm_code(105, "SYNO.Core.User")
        .dsm_code()
        .is_none());
}
