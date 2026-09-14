//! Real loopback response decoding; synthetic credentials only, no NAS access.
use crate::{
    client::SynoClient,
    error::{command_error, SynologyError, SynologyErrorKind},
    scoped_files::FileStationLogin,
    service::SynologyService,
    types::{SynoResponse, SynologyConfig},
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
        "dsmCode"
    ]
    .contains(&key.as_str())));
    value
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
        let peer = Peer::start(vec![reply]).await;
        let error = SynologyService::new()
            .fs_connect(peer.config())
            .await
            .unwrap_err();
        assert!(matches!(error.kind, SynologyErrorKind::ParseError));
        assert_eq!(
            diagnostic(&error),
            json!({"stage":"api_discovery","category":category,"httpStatus":200,"contentType":mime,"bytesRead":length})
        );
        assert_eq!(peer.count(), 1, "discovery failure cannot dispatch login");
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
