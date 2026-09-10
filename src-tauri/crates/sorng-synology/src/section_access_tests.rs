use super::*;
use crate::{
    client::SynoClient,
    types::{ApiInfoEntry, SynologyConfig},
};
use serde_json::{json, Value};
use std::sync::{atomic::AtomicBool, Arc, Mutex};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    task::JoinHandle,
};

const SECTIONS: [&str; 18] = [
    "dashboard",
    "system",
    "storage",
    "fileStation",
    "shares",
    "network",
    "users",
    "packages",
    "services",
    "docker",
    "vms",
    "downloads",
    "surveillance",
    "backup",
    "security",
    "hardware",
    "logs",
    "notifications",
];
struct Nas {
    port: u16,
    requests: Arc<Mutex<Vec<String>>>,
    task: JoinHandle<()>,
}
impl Drop for Nas {
    fn drop(&mut self) {
        self.task.abort();
    }
}
impl Nas {
    async fn start(responses: Vec<Value>, delay: Duration) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let log = requests.clone();
        let task = tokio::spawn(async move {
            let mut responses = responses.into_iter();
            loop {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut data = Vec::new();
                loop {
                    let mut bytes = [0; 4096];
                    let count = stream.read(&mut bytes).await.unwrap();
                    if count == 0 {
                        break;
                    }
                    data.extend_from_slice(&bytes[..count]);
                    assert!(data.len() <= 65536);
                    if let Some(end) = data.windows(4).position(|v| v == b"\r\n\r\n") {
                        let header = String::from_utf8_lossy(&data[..end]);
                        let length = header
                            .lines()
                            .find_map(|line| {
                                let (name, value) = line.split_once(':')?;
                                name.eq_ignore_ascii_case("content-length")
                                    .then(|| value.trim().parse::<usize>().unwrap())
                            })
                            .unwrap_or(0);
                        if data.len() >= end + 4 + length {
                            break;
                        }
                    }
                }
                log.lock().unwrap().push(String::from_utf8(data).unwrap());
                tokio::time::sleep(delay).await;
                let body = responses
                    .next()
                    .unwrap_or_else(|| json!({"success":true,"data":{}}))
                    .to_string();
                let response = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
                let _ = stream.write_all(response.as_bytes()).await;
            }
        });
        Self {
            port,
            requests,
            task,
        }
    }
    fn context(&self, apis: &[&str]) -> SectionAccessContext {
        let mut client = SynoClient::new(&SynologyConfig {
            host: "127.0.0.1".into(),
            port: self.port,
            username: "fixture-user".into(),
            password: "fixture-password".into(),
            use_https: false,
            insecure: false,
            timeout_secs: 5,
            otp_code: None,
            device_token: None,
            access_token: None,
        })
        .unwrap();
        client.sid = Some("fixture-private-sid".into());
        client.syno_token = Some("fixture-private-token".into());
        for api in apis {
            client.api_info.insert(
                (*api).into(),
                ApiInfoEntry {
                    path: "entry.cgi".into(),
                    min_version: 1,
                    max_version: 10,
                    request_format: None,
                },
            );
        }
        SectionAccessContext {
            lease: FileTransferContext {
                client,
                active: Arc::new(AtomicBool::new(true)),
                cancelled: Arc::new(tokio::sync::Notify::new()),
            },
        }
    }
}

#[tokio::test]
async fn section_access_uses_only_static_read_methods_and_never_returns_nas_data() {
    let nas = Nas::start(
        vec![json!({"success":true,"data":{"private":"fixture-secret"}}); 18],
        Duration::ZERO,
    )
    .await;
    let apis: Vec<_> = SECTIONS
        .iter()
        .flat_map(|s| probes(s).unwrap())
        .map(|p| p.api)
        .collect();
    let context = nas.context(&apis);
    for section in SECTIONS {
        let result = context.probe(section).await.unwrap();
        assert_eq!(result.status, SectionAccessStatus::Available);
        let serialized = serde_json::to_string(&result).unwrap();
        assert!(!serialized.contains("fixture"));
        assert!(!serialized.contains("_sid"));
    }
    let requests = nas.requests.lock().unwrap();
    assert_eq!(requests.len(), 18);
    for request in requests.iter() {
        let first = request.lines().next().unwrap();
        assert!(first.starts_with("POST /webapi/entry.cgi?"));
        assert!(!first.contains("fixture-private"));
        let target = first.split_whitespace().nth(1).unwrap();
        let url = url::Url::parse(&format!("http://localhost{target}")).unwrap();
        let method = url
            .query_pairs()
            .find(|(key, _)| key == "method")
            .unwrap()
            .1
            .into_owned();
        assert!([
            "getinfo",
            "get",
            "list",
            "load_info",
            "List",
            "system_get",
            "load",
            "list_all",
            "list_device"
        ]
        .contains(&method.as_str()));
        if request.contains("limit=") {
            assert!(request.contains("limit=1"));
        }
        assert!(request.contains("_sid=fixture-private-sid"));
    }
}

#[tokio::test]
async fn section_access_distinguishes_denied_missing_unknown_and_expired() {
    for (code, expected) in [
        (105, SectionAccessStatus::Denied),
        (120, SectionAccessStatus::Denied),
        (101, SectionAccessStatus::Unknown),
        (102, SectionAccessStatus::Unavailable),
        (103, SectionAccessStatus::Unavailable),
        (104, SectionAccessStatus::Unavailable),
        (999, SectionAccessStatus::Unknown),
    ] {
        let nas = Nas::start(vec![json!({"success":false,"error":{"code":code,"errors":[{"message":"fixture-secret"}]}})],Duration::ZERO).await;
        let result = nas
            .context(&["SYNO.Core.Package"])
            .probe("packages")
            .await
            .unwrap();
        assert_eq!(result.status, expected, "code {code}");
        assert!(!serde_json::to_string(&result)
            .unwrap()
            .contains("fixture-secret"));
    }
    for code in [106, 107, 119, 150] {
        let nas = Nas::start(
            vec![json!({"success":false,"error":{"code":code}})],
            Duration::ZERO,
        )
        .await;
        let context = nas.context(&["SYNO.Core.Package"]);
        let error = context.probe("packages").await.unwrap_err();
        assert!(matches!(error.kind, SynologyErrorKind::SessionExpired));
        assert!(crate::error::command_error(error).starts_with("SYNOLOGY_SESSION_EXPIRED: "));
        assert!(!context.lease.active.load(Ordering::Acquire));
        assert!(context.probe("packages").await.is_err());
        assert_eq!(nas.requests.lock().unwrap().len(), 1);
    }
}

#[tokio::test]
async fn section_access_does_not_probe_missing_apis_or_invalid_sections() {
    let nas = Nas::start(vec![], Duration::ZERO).await;
    let context = nas.context(&[]);
    assert_eq!(
        context.probe("docker").await.unwrap().status,
        SectionAccessStatus::Unavailable
    );
    let error = context
        .probe("fixture-private-invalid-section")
        .await
        .unwrap_err();
    assert!(!error.to_string().contains("fixture-private"));
    assert!(nas.requests.lock().unwrap().is_empty());
}

#[tokio::test]
async fn section_access_alternatives_preserve_partial_availability_and_unknown_priority() {
    for (responses, expected) in [
        (
            vec![
                json!({"success":false,"error":{"code":105}}),
                json!({"success":true,"data":{}}),
            ],
            SectionAccessStatus::Available,
        ),
        (
            vec![
                json!({"success":false,"error":{"code":105}}),
                json!({"success":true,"data":"malformed-private"}),
            ],
            SectionAccessStatus::Unknown,
        ),
        (
            vec![
                json!({"success":false,"error":{"code":105}}),
                json!({"success":false,"error":{"code":102}}),
            ],
            SectionAccessStatus::Denied,
        ),
    ] {
        let nas = Nas::start(responses, Duration::ZERO).await;
        let context = nas.context(&["SYNO.DSM.Info", "SYNO.Core.System.Utilization"]);
        let snapshot = context.probe("system").await.unwrap();
        assert_eq!(snapshot.status, expected);
        assert_eq!(nas.requests.lock().unwrap().len(), 2);
        assert!(!snapshot.reason.contains("private"));
    }
}

#[tokio::test]
async fn section_access_timeout_is_unknown_and_revocation_cancels_inflight_probe() {
    let nas = Nas::start(vec![], Duration::from_secs(2)).await;
    let context = nas.context(&["SYNO.Core.Package"]);
    let result = context
        .probe_bounded(
            "packages",
            Duration::from_millis(30),
            Duration::from_millis(10),
        )
        .await
        .unwrap();
    assert_eq!(result.status, SectionAccessStatus::Unknown);
    assert!(context.lease.active.load(Ordering::Acquire));

    let nas = Nas::start(vec![], Duration::from_secs(2)).await;
    let context = Arc::new(nas.context(&["SYNO.Core.Package"]));
    let clone = context.clone();
    let pending = tokio::spawn(async move { clone.probe("packages").await });
    tokio::time::timeout(Duration::from_secs(1), async {
        while nas.requests.lock().unwrap().is_empty() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    context.lease.active.store(false, Ordering::Release);
    context.lease.cancelled.notify_waiters();
    let error = tokio::time::timeout(Duration::from_millis(200), pending)
        .await
        .unwrap()
        .unwrap()
        .unwrap_err();
    assert!(matches!(error.kind, SynologyErrorKind::SessionExpired));
    assert!(crate::error::command_error(error).starts_with("SYNOLOGY_SESSION_EXPIRED: "));
}
