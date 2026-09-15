use super::*;
use crate::{
    client::SynoClient,
    login_handshake::{decode_b64url, first_message, LoginPlan, SharedSigner, NOISE_PATTERN},
    types::{ApiInfoEntry, SynologyConfig},
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde_json::{json, Value};
use std::{
    collections::{BTreeSet, HashMap, VecDeque},
    sync::{atomic::AtomicBool, Arc, Mutex},
};
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
const INITDATA: &str = "SYNO.Core.Desktop.Initdata";
const DSM_INFO: &str = "SYNO.DSM.Info";
const UTILIZATION: &str = "SYNO.Core.System.Utilization";
/// The reply from the user's report: HTTP 200, JSON, exactly 38 bytes.
const DENIED_105: &str = r#"{"error":{"code":105},"success":false}"#;
/// Every private value the fixture NAS or client holds; none may reach a snapshot.
const PRIVATE: &str = "fixture-private";

// ── Loopback DSM ────────────────────────────────────────────────────

#[derive(Clone)]
struct Reply {
    body: Vec<u8>,
    delay: Duration,
}
impl Reply {
    fn after(mut self, delay: Duration) -> Self {
        self.delay = delay;
        self
    }
}
fn raw(body: impl Into<Vec<u8>>) -> Reply {
    Reply {
        body: body.into(),
        delay: Duration::ZERO,
    }
}
fn ok(data: Value) -> Reply {
    raw(json!({"success":true,"data":data}).to_string())
}
fn code(code: i32) -> Reply {
    raw(json!({"success":false,"error":{"code":code,"errors":[{"message":"fixture-private-nested"}]}}).to_string())
}
fn nas_data() -> Reply {
    ok(json!({"items":[{"name":"fixture-private-data","path":"/volume1/fixture-private"}]}))
}
fn initdata(is_admin: Value, applications: Value) -> Reply {
    ok(json!({
        "Session":{"is_admin":is_admin,"hostname":"fixture-private-host","ip_country":"fixture-private"},
        "AppPrivilege":applications,
        "Strings":{"common":{"fixture":"fixture-private-string"}},
        "JSConfig":{"fixture-private-key":true}
    }))
}
fn admin() -> Reply {
    initdata(json!(true), json!({"SYNO.ALLOW.ALL.APPLICATIONS":true}))
}
fn standard() -> Reply {
    initdata(json!(false), json!({}))
}
fn ms(value: u64) -> Duration {
    Duration::from_millis(value)
}

#[derive(Clone, Debug)]
struct Request {
    api: String,
    method: String,
    version: String,
    text: String,
}

struct Nas {
    port: u16,
    requests: Arc<Mutex<Vec<Request>>>,
    task: JoinHandle<()>,
}
impl Drop for Nas {
    fn drop(&mut self) {
        self.task.abort();
    }
}
impl Nas {
    /// Replies are chosen by the request's `api`; a repeated API answers in
    /// order and keeps its last reply. Unlisted APIs answer with NAS data.
    async fn start(replies: Vec<(&str, Reply)>) -> Self {
        let mut script: HashMap<String, VecDeque<Reply>> = HashMap::new();
        for (api, reply) in replies {
            script.entry(api.to_owned()).or_default().push_back(reply);
        }
        let script = Arc::new(Mutex::new(script));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let log = requests.clone();
        let task = tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                let log = log.clone();
                let script = script.clone();
                tokio::spawn(async move {
                    let mut data = Vec::new();
                    loop {
                        let mut bytes = [0; 4096];
                        let Ok(count) = stream.read(&mut bytes).await else {
                            return;
                        };
                        if count == 0 {
                            return;
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
                    let text = String::from_utf8(data).unwrap();
                    let target = text.split_whitespace().nth(1).unwrap().to_owned();
                    let url = url::Url::parse(&format!("http://localhost{target}")).unwrap();
                    let query = |key: &str| {
                        url.query_pairs()
                            .find(|(name, _)| name == key)
                            .map(|(_, value)| value.into_owned())
                            .unwrap_or_default()
                    };
                    let api = query("api");
                    log.lock().unwrap().push(Request {
                        api: api.clone(),
                        method: query("method"),
                        version: query("version"),
                        text,
                    });
                    let reply = match script.lock().unwrap().get_mut(&api) {
                        Some(queue) if queue.len() > 1 => queue.pop_front().unwrap(),
                        Some(queue) => queue[0].clone(),
                        None => nas_data(),
                    };
                    tokio::time::sleep(reply.delay).await;
                    let head = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", reply.body.len());
                    if stream.write_all(head.as_bytes()).await.is_ok() {
                        let _ = stream.write_all(&reply.body).await;
                    }
                    let _ = stream.shutdown().await;
                });
            }
        });
        Self {
            port,
            requests,
            task,
        }
    }

    fn apis(&self) -> Vec<String> {
        self.requests
            .lock()
            .unwrap()
            .iter()
            .map(|request| request.api.clone())
            .collect()
    }

    fn count(&self, api: &str) -> usize {
        self.apis().iter().filter(|seen| *seen == api).count()
    }

    fn client(&self, apis: &[&str]) -> SynoClient {
        let mut client = SynoClient::new(&SynologyConfig {
            host: "127.0.0.1".into(),
            port: self.port,
            username: "nas-admin".into(),
            password: "fixture-private-password".into(),
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
        client.identity = identity(LoginHandshake::Ik, SessionRoute::QuickconnectRelay);
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
        client
    }

    fn context(&self, apis: &[&str]) -> SectionAccessContext {
        lease(self.client(apis))
    }
}

fn lease(client: SynoClient) -> SectionAccessContext {
    SectionAccessContext {
        lease: FileTransferContext {
            client,
            active: Arc::new(AtomicBool::new(true)),
            cancelled: Arc::new(tokio::sync::Notify::new()),
        },
    }
}

fn identity(login_handshake: LoginHandshake, route: SessionRoute) -> SessionIdentity {
    SessionIdentity {
        signed_in_as: "nas-admin".into(),
        session_name: "FileStation",
        login_handshake,
        auth_version: 7,
        route,
        second_factor: SecondFactor::Otp,
        portal_session: false,
    }
}

fn read<'a>(snapshot: &'a SectionAccessSnapshot, field: &str) -> &'a ReadAccess {
    snapshot
        .reads
        .iter()
        .find(|read| read.field == field)
        .unwrap()
}

async fn probe(context: &SectionAccessContext, section: &str) -> SectionAccessSnapshot {
    checked(section, context.probe(section).await.unwrap())
}

async fn probe_within(
    context: &SectionAccessContext,
    section: &str,
    budget: ProbeBudget,
) -> SectionAccessSnapshot {
    checked(
        section,
        context.probe_bounded(section, budget).await.unwrap(),
    )
}

/// Every snapshot a test sees must pass the frontend validator and carry no
/// private fixture value.
fn checked(section: &str, snapshot: SectionAccessSnapshot) -> SectionAccessSnapshot {
    let value = serde_json::to_value(&snapshot).unwrap();
    if let Err(problem) = contract::validate(section, &value) {
        panic!("frontend would reject {section}: {problem}\n{value:#}");
    }
    let text = value.to_string();
    for forbidden in [
        PRIVATE,
        "_sid",
        "SynoToken",
        "127.0.0.1",
        "http://",
        "/webapi",
    ] {
        assert!(!text.contains(forbidden), "{forbidden} in {text}");
    }
    snapshot
}

fn signed_client(client: &mut SynoClient) -> SharedSigner {
    let params: snow::params::NoiseParams = NOISE_PATTERN.parse().unwrap();
    let server = snow::Builder::new(params.clone())
        .generate_keypair()
        .unwrap();
    let key: [u8; 32] = server.public.clone().try_into().unwrap();
    let (message, state) = first_message(&key, 1_726_400_000).unwrap();
    let mut responder = snow::Builder::new(params)
        .local_private_key(&server.private)
        .unwrap()
        .build_responder()
        .unwrap();
    let mut payload = [0_u8; 256];
    responder
        .read_message(&decode_b64url(&message).unwrap(), &mut payload)
        .unwrap();
    let mut reply = [0_u8; 256];
    let length = responder.write_message(&[], &mut reply).unwrap();
    let plan = LoginPlan::Ik {
        ik_message: message,
        state: Box::new(state),
    };
    let (handshake, signer) = plan.finish(Some(&URL_SAFE_NO_PAD.encode(&reply[..length])));
    assert_eq!(handshake, LoginHandshake::Ik);
    let signer = signer.unwrap();
    client.request_signer = Some(signer.clone());
    signer
}

// ── Classification ──────────────────────────────────────────────────

#[tokio::test]
async fn standard_user_gets_partial_system_with_utilization_requiring_administrator() {
    let nas = Nas::start(vec![
        (INITDATA, standard()),
        (DSM_INFO, nas_data()),
        (UTILIZATION, raw(DENIED_105)),
    ])
    .await;
    let context = nas.context(&[INITDATA, DSM_INFO, UTILIZATION]);
    let snapshot = probe(&context, "system").await;
    assert_eq!(
        serde_json::to_value(&snapshot).unwrap(),
        json!({
            "section":"system",
            "status":"partial",
            "requirement":"administrator",
            "reason":"Some data in this section needs additional DSM access; the parts you can read are shown.",
            "account":{"signedInAs":"nas-admin","role":"standard","portalSession":false,"sessionName":"FileStation","loginHandshake":"ik","authVersion":7,"route":"quickconnect_relay","secondFactor":"otp"},
            "reads":[
                {"field":"systemInfo","api":"SYNO.DSM.Info","state":"available","reason":"Read successfully."},
                {"field":"utilization","api":"SYNO.Core.System.Utilization","state":"requires_administrator","reason":"DSM allows SYNO.Core.System.Utilization only for administrators or accounts with a matching delegated administration role."}
            ]
        })
    );
    assert_eq!(nas.apis(), [INITDATA, DSM_INFO, UTILIZATION]);
}

#[tokio::test]
async fn administrator_with_every_read_available_gets_available_sections() {
    let nas = Nas::start(vec![(INITDATA, admin())]).await;
    let context = nas.context(&[INITDATA, DSM_INFO, UTILIZATION]);
    let snapshot = probe(&context, "system").await;
    assert_eq!(snapshot.status, SectionAccessStatus::Available);
    assert_eq!(snapshot.requirement, None);
    assert_eq!(snapshot.reason, SECTION_AVAILABLE);
    assert_eq!(snapshot.account.role, AccountRole::Administrator);
    assert!(snapshot
        .reads
        .iter()
        .all(|read| read.state == ReadState::Available && read.reason == AVAILABLE_READ));
    assert_eq!(nas.apis(), [INITDATA, DSM_INFO, UTILIZATION]);
}

#[tokio::test]
async fn administrator_refused_an_administrator_api_is_a_session_restriction() {
    const HANDSHAKE_TEXT: &str = "DSM identifies nas-admin as an administrator but limited this API session: it was signed in without DSM 7's secure login handshake, which DSM requires for full access over QuickConnect or remote addresses. Reconnect; if this remains, copy the session diagnostics.";
    let cases = [
        (LoginHandshake::Legacy, SessionRoute::QuickconnectRelay, "FileStation", HANDSHAKE_TEXT.to_owned()),
        (LoginHandshake::LegacyUnavailable, SessionRoute::Direct, "FileStation", HANDSHAKE_TEXT.to_owned()),
        (LoginHandshake::IkIncomplete, SessionRoute::QuickconnectDirect, "FileStation", HANDSHAKE_TEXT.to_owned()),
        (
            LoginHandshake::Ik,
            SessionRoute::QuickconnectRelay,
            "FileStation",
            "DSM identifies nas-admin as an administrator but denied SYNO.Core.System.Utilization for this API session (session FileStation, route QuickConnect relay). Use Reconnect as DSM session, then recheck access. If it remains, copy the session diagnostics.".to_owned(),
        ),
        (
            LoginHandshake::Ik,
            SessionRoute::HttpProxy,
            "webui",
            "DSM identifies nas-admin as an administrator but denied SYNO.Core.System.Utilization for this API session (session DSM desktop (webui), route HTTP proxy). Reconnect, then recheck access. If it remains, copy the session diagnostics.".to_owned(),
        ),
    ];
    for (handshake, route, session_name, expected) in cases {
        let nas = Nas::start(vec![(INITDATA, admin()), (UTILIZATION, raw(DENIED_105))]).await;
        let mut client = nas.client(&[INITDATA, DSM_INFO, UTILIZATION]);
        client.identity = SessionIdentity {
            session_name,
            ..identity(handshake, route)
        };
        let snapshot = probe(&lease(client), "system").await;
        let utilization = read(&snapshot, "utilization");
        assert_eq!(
            utilization.state,
            ReadState::SessionRestricted,
            "{handshake:?}"
        );
        assert_ne!(utilization.state, ReadState::RequiresAdministrator);
        assert_eq!(utilization.reason, expected);
        assert_eq!(snapshot.status, SectionAccessStatus::Partial);
        assert_eq!(snapshot.requirement, Some(AccessRequirement::Session));
        assert_eq!(snapshot.account.role, AccountRole::Administrator);
        assert_eq!(snapshot.account.login_handshake, handshake);
        assert_eq!(snapshot.account.route, route);
    }

    // Every read refused: the section explains itself with the session text.
    let nas = Nas::start(vec![
        (INITDATA, admin()),
        ("SYNO.Core.User", raw(DENIED_105)),
        ("SYNO.Core.Group", raw(DENIED_105)),
    ])
    .await;
    let snapshot = probe(
        &nas.context(&[INITDATA, "SYNO.Core.User", "SYNO.Core.Group"]),
        "users",
    )
    .await;
    assert_eq!(snapshot.status, SectionAccessStatus::Denied);
    assert_eq!(snapshot.requirement, Some(AccessRequirement::Session));
    assert_eq!(snapshot.reason, read(&snapshot, "users").reason);
    assert!(snapshot.reason.contains("SYNO.Core.User"));
}

#[tokio::test]
async fn portal_session_explanation_wins_over_role_and_handshake() {
    const PORTAL: &str = "This API session was opened through a DSM application portal, which limits it to that application. Connect to the DSM port (for example 5001) to use SYNO.Core.System.Utilization.";
    for (initdata, handshake) in [
        (admin(), LoginHandshake::Ik),
        (admin(), LoginHandshake::Legacy),
        (standard(), LoginHandshake::Ik),
        (code(105), LoginHandshake::IkIncomplete),
    ] {
        let nas = Nas::start(vec![(INITDATA, initdata), (UTILIZATION, raw(DENIED_105))]).await;
        let mut client = nas.client(&[INITDATA, DSM_INFO, UTILIZATION]);
        client.identity.portal_session = true;
        client.identity.login_handshake = handshake;
        let snapshot = probe(&lease(client), "system").await;
        let utilization = read(&snapshot, "utilization");
        assert_eq!(utilization.state, ReadState::SessionRestricted);
        assert_eq!(utilization.reason, PORTAL);
        assert!(snapshot.account.portal_session);
        assert_eq!(snapshot.requirement, Some(AccessRequirement::Session));
    }
}

#[tokio::test]
async fn account_snapshot_comes_from_the_login_and_survives_a_failed_role_lookup() {
    let nas = Nas::start(vec![(INITDATA, code(105)), (UTILIZATION, raw(DENIED_105))]).await;
    let mut client = nas.client(&[INITDATA, DSM_INFO, UTILIZATION]);
    client.identity = SessionIdentity {
        signed_in_as: "ops\u{7}admin\u{202e}".into(),
        session_name: "webui",
        login_handshake: LoginHandshake::LegacyUnavailable,
        auth_version: 6,
        route: SessionRoute::HttpProxy,
        second_factor: SecondFactor::TrustedDevice,
        portal_session: false,
    };
    let snapshot = probe(&lease(client), "system").await;
    let value = serde_json::to_value(&snapshot).unwrap();
    assert_eq!(
        value["account"],
        json!({"signedInAs":"ops\u{fffd}admin\u{fffd}","role":"unknown","portalSession":false,"sessionName":"webui","loginHandshake":"legacy_unavailable","authVersion":6,"route":"http_proxy","secondFactor":"trusted_device"})
    );
    // Unknown role: DSM's refusal is explained by the API's privilege.
    assert_eq!(
        read(&snapshot, "utilization").state,
        ReadState::RequiresAdministrator
    );
    let text = value.to_string();
    for forbidden in [
        nas.port.to_string().as_str(),
        "fixture-private-sid",
        "fixture-private-token",
        "fixture-private-password",
        "localhost",
        "/webapi",
    ] {
        assert!(!text.contains(forbidden), "{forbidden}");
    }
}

#[tokio::test]
async fn standard_user_is_denied_administrator_only_sections() {
    let nas = Nas::start(vec![
        (INITDATA, standard()),
        ("SYNO.Core.User", raw(DENIED_105)),
        ("SYNO.Core.Group", raw(DENIED_105)),
    ])
    .await;
    let snapshot = probe(
        &nas.context(&[INITDATA, "SYNO.Core.User", "SYNO.Core.Group"]),
        "users",
    )
    .await;
    assert_eq!(snapshot.status, SectionAccessStatus::Denied);
    assert_eq!(snapshot.requirement, Some(AccessRequirement::Administrator));
    assert_eq!(snapshot.reason, SECTION_ADMINISTRATOR);
    assert!(snapshot
        .reads
        .iter()
        .all(|read| read.state == ReadState::RequiresAdministrator));
    assert_eq!(nas.apis(), [INITDATA, "SYNO.Core.User", "SYNO.Core.Group"]);
}

#[tokio::test]
async fn missing_packages_are_reported_without_any_request() {
    let nas = Nas::start(vec![]).await;
    let context = nas.context(&[INITDATA]);
    let docker = probe(&context, "docker").await;
    assert_eq!(docker.status, SectionAccessStatus::Unavailable);
    assert_eq!(docker.requirement, Some(AccessRequirement::Package));
    assert_eq!(
        docker.reason,
        "Container Manager is not installed or not running on this NAS."
    );
    for read in &docker.reads {
        assert_eq!(read.state, ReadState::PackageNotInstalled);
        assert_eq!(read.package, Some("Container Manager"));
        assert_eq!(read.application, None);
        assert_eq!(read.reason, docker.reason);
    }
    assert_eq!(
        read(&docker, "dockerProjects").api,
        "SYNO.ContainerManager.Project"
    );
    let backup = probe(&context, "backup").await;
    assert_eq!(
        backup.reason,
        "Hyper Backup and Active Backup for Business are not installed or not running on this NAS."
    );
    let vms = probe(&context, "vms").await;
    assert_eq!(
        vms.reason,
        "Virtual Machine Manager is not installed or not running on this NAS."
    );
    let downloads = probe(&context, "downloads").await;
    assert_eq!(
        read(&downloads, "downloadTasks").package,
        Some("Download Station")
    );
    assert_eq!(
        read(&downloads, "downloadTasks").application,
        Some("Download Station")
    );
    assert_eq!(docker.account.role, AccountRole::Unknown);
    assert!(
        nas.apis().is_empty(),
        "nothing is requested: {:?}",
        nas.apis()
    );
}

#[tokio::test]
async fn application_privilege_refusals_name_the_application() {
    let tasks = "SYNO.DownloadStation.Task";
    let stats = "SYNO.DownloadStation.Statistic";
    let nas = Nas::start(vec![
        (
            INITDATA,
            initdata(json!(false), json!({"SYNO.SDS.DownloadStation":false})),
        ),
        (tasks, raw(DENIED_105)),
        (stats, raw(DENIED_105)),
    ])
    .await;
    let snapshot = probe(&nas.context(&[INITDATA, tasks, stats]), "downloads").await;
    let task = read(&snapshot, "downloadTasks");
    assert_eq!(task.state, ReadState::RequiresApplicationPrivilege);
    assert_eq!(task.application, Some("Download Station"));
    assert_eq!(task.package, Some("Download Station"));
    assert_eq!(task.reason, "The account needs the Download Station application privilege (Control Panel › Application Privileges) to read SYNO.DownloadStation.Task.");
    assert_eq!(snapshot.status, SectionAccessStatus::Denied);
    assert_eq!(
        snapshot.requirement,
        Some(AccessRequirement::ApplicationPrivilege)
    );
    assert_eq!(
        snapshot.reason,
        "This section needs the Download Station application privilege."
    );

    // DSM says the account has the privilege (itself or all applications):
    // the refusal is some other permission, not the application privilege.
    for applications in [
        json!({"SYNO.SDS.DownloadStation":true}),
        json!({"SYNO.ALLOW.ALL.APPLICATIONS":true,"SYNO.SDS.DownloadStation":false}),
    ] {
        let nas = Nas::start(vec![
            (INITDATA, initdata(json!(false), applications)),
            (tasks, raw(DENIED_105)),
            (stats, nas_data()),
        ])
        .await;
        let snapshot = probe(&nas.context(&[INITDATA, tasks, stats]), "downloads").await;
        let task = read(&snapshot, "downloadTasks");
        assert_eq!(task.state, ReadState::PermissionDenied);
        assert_eq!(task.reason, "DSM denied SYNO.DownloadStation.Task for this account (code 105). Review the account's DSM permissions for this data.");
        assert_eq!(snapshot.requirement, Some(AccessRequirement::Permission));
        assert_eq!(snapshot.status, SectionAccessStatus::Partial);
    }

    for (section, api, application) in [
        (
            "surveillance",
            "SYNO.SurveillanceStation.Camera",
            "Surveillance Station",
        ),
        ("fileStation", "SYNO.FileStation.Info", "File Station"),
    ] {
        let nas = Nas::start(vec![(INITDATA, code(105)), (api, raw(DENIED_105))]).await;
        let snapshot = probe(&nas.context(&[INITDATA, api]), section).await;
        assert_eq!(
            snapshot.reads[0].state,
            ReadState::RequiresApplicationPrivilege
        );
        assert_eq!(snapshot.reads[0].application, Some(application));
        assert_eq!(
            snapshot.reason,
            format!("This section needs the {application} application privilege.")
        );
    }

    // An any-user API refused: a plain permission denial.
    let nas = Nas::start(vec![
        (INITDATA, standard()),
        ("SYNO.Core.SyslogClient.Log", raw(DENIED_105)),
        ("SYNO.Core.CurrentConnection", raw(DENIED_105)),
    ])
    .await;
    let snapshot = probe(
        &nas.context(&[
            INITDATA,
            "SYNO.Core.SyslogClient.Log",
            "SYNO.Core.CurrentConnection",
        ]),
        "logs",
    )
    .await;
    assert_eq!(
        read(&snapshot, "connectionLogs").state,
        ReadState::PermissionDenied
    );
    assert_eq!(snapshot.status, SectionAccessStatus::Denied);
    assert_eq!(snapshot.requirement, Some(AccessRequirement::Administrator));
}

#[tokio::test]
async fn unsupported_apis_versions_and_codes_are_not_permission_problems() {
    let nas = Nas::start(vec![]).await;
    let notifications = probe(&nas.context(&[INITDATA]), "notifications").await;
    assert_eq!(notifications.status, SectionAccessStatus::Unavailable);
    assert_eq!(
        notifications.requirement,
        Some(AccessRequirement::DsmVersion)
    );
    assert_eq!(notifications.reason, SECTION_DSM_VERSION);
    assert_eq!(notifications.reads[0].state, ReadState::NotSupported);
    assert_eq!(
        notifications.reads[0].reason,
        "This DSM version does not provide SYNO.Core.Notification.Setting."
    );
    assert!(nas.apis().is_empty());

    let package = "SYNO.Core.Package";
    for (reply, expected, reason) in [
        (code(102), ReadState::NotSupported, "This DSM version does not support the requested SYNO.Core.Package version or method."),
        (code(103), ReadState::NotSupported, "This DSM version does not support the requested SYNO.Core.Package version or method."),
        (code(104), ReadState::NotSupported, "This DSM version does not support the requested SYNO.Core.Package version or method."),
        (code(105), ReadState::RequiresAdministrator, "DSM allows SYNO.Core.Package only for administrators or accounts with a matching delegated administration role."),
        // DSM answers 120 to invalid or missing parameters; it is not a denial.
        (code(120), ReadState::Unknown, "DSM answered SYNO.Core.Package with code 120, which does not identify a permission problem. Access could not be confirmed; retry explicitly."),
        (code(100), ReadState::Unknown, "DSM answered SYNO.Core.Package with code 100, which does not identify a permission problem. Access could not be confirmed; retry explicitly."),
        (code(101), ReadState::Unknown, "DSM answered SYNO.Core.Package with code 101, which does not identify a permission problem. Access could not be confirmed; retry explicitly."),
        (code(999), ReadState::Unknown, "DSM answered SYNO.Core.Package with code 999, which does not identify a permission problem. Access could not be confirmed; retry explicitly."),
        (raw(r#"{"success":true,"data":"fixture-private"}"#), ReadState::Unknown, UNKNOWN_REASON),
        (raw(r#"{"success":true}"#), ReadState::Unknown, UNKNOWN_REASON),
        (raw("<html>fixture-private</html>"), ReadState::Unknown, UNKNOWN_REASON),
    ] {
        let nas = Nas::start(vec![(package, reply)]).await;
        let snapshot = probe(&nas.context(&[package]), "packages").await;
        assert_eq!(snapshot.reads[0].state, expected, "{reason}");
        assert_eq!(snapshot.reads[0].reason, reason);
        let status = match expected {
            ReadState::NotSupported => SectionAccessStatus::Unavailable,
            ReadState::RequiresAdministrator => SectionAccessStatus::Denied,
            _ => SectionAccessStatus::Unknown,
        };
        assert_eq!(snapshot.status, status);
        assert_eq!(nas.apis(), [package]);
    }

    // A discovered version range the probe cannot use is never requested.
    let nas = Nas::start(vec![]).await;
    let mut client = nas.client(&[package]);
    client.api_info.get_mut(package).unwrap().min_version = 5;
    let snapshot = probe(&lease(client), "packages").await;
    assert_eq!(snapshot.reads[0].state, ReadState::NotSupported);
    assert!(nas.apis().is_empty());
}

/// DSM answers 120 to a missing or invalid request parameter. A request bug
/// must never tell an administrator (or anyone) that access is missing.
#[tokio::test]
async fn code_120_is_a_request_error_for_every_account() {
    const REQUEST_REJECTED: &str = "DSM answered SYNO.Core.User with code 120, which does not identify a permission problem. Access could not be confirmed; retry explicitly.";
    let refused_as_permission = |state: ReadState| {
        matches!(
            state,
            ReadState::RequiresAdministrator
                | ReadState::SessionRestricted
                | ReadState::RequiresApplicationPrivilege
                | ReadState::PermissionDenied
        )
    };
    let users = ["SYNO.Core.User", "SYNO.Core.Group"];
    for (initdata, role, handshake, portal) in [
        (
            admin(),
            AccountRole::Administrator,
            LoginHandshake::Ik,
            false,
        ),
        (
            admin(),
            AccountRole::Administrator,
            LoginHandshake::Legacy,
            false,
        ),
        (
            admin(),
            AccountRole::Administrator,
            LoginHandshake::Ik,
            true,
        ),
        (standard(), AccountRole::Standard, LoginHandshake::Ik, false),
        (code(105), AccountRole::Unknown, LoginHandshake::Ik, false),
    ] {
        let nas = Nas::start(vec![
            (INITDATA, initdata),
            (users[0], code(120)),
            (users[1], code(120)),
        ])
        .await;
        let mut client = nas.client(&[INITDATA, users[0], users[1]]);
        client.identity.login_handshake = handshake;
        client.identity.portal_session = portal;
        let snapshot = probe(&lease(client), "users").await;
        assert_eq!(snapshot.account.role, role);
        for read in &snapshot.reads {
            assert_eq!(read.state, ReadState::Unknown, "{role:?} {handshake:?}");
            assert!(!refused_as_permission(read.state));
        }
        assert_eq!(read(&snapshot, "users").reason, REQUEST_REJECTED);
        assert_eq!(snapshot.status, SectionAccessStatus::Unknown);
        assert_eq!(snapshot.requirement, None);
        assert_eq!(snapshot.reason, UNKNOWN_REASON);
        assert_eq!(nas.apis(), [INITDATA, users[0], users[1]]);

        // Next to a real 105, the 120 read stays a request error.
        let nas = Nas::start(vec![(users[0], raw(DENIED_105)), (users[1], code(120))]).await;
        let mut client = nas.client(&users);
        client.identity.login_handshake = handshake;
        let snapshot = probe(&lease(client), "users").await;
        assert_eq!(read(&snapshot, "groups").state, ReadState::Unknown);
        assert_eq!(snapshot.status, SectionAccessStatus::Unknown);
    }

    // Application-privilege APIs too.
    let tasks = "SYNO.DownloadStation.Task";
    let nas = Nas::start(vec![
        (
            INITDATA,
            initdata(json!(false), json!({"SYNO.SDS.DownloadStation":false})),
        ),
        (tasks, code(120)),
    ])
    .await;
    let snapshot = probe(&nas.context(&[INITDATA, tasks]), "downloads").await;
    assert_eq!(read(&snapshot, "downloadTasks").state, ReadState::Unknown);
    assert_eq!(
        read(&snapshot, "downloadTasks").application,
        Some("Download Station")
    );
}

#[tokio::test]
async fn shared_calls_are_requested_once_per_section() {
    let storage = "SYNO.Storage.CGI.Storage";
    for (reply, state) in [
        (nas_data(), ReadState::Available),
        (raw(DENIED_105), ReadState::RequiresAdministrator),
    ] {
        let nas = Nas::start(vec![(INITDATA, standard()), (storage, reply)]).await;
        let snapshot = probe(&nas.context(&[INITDATA, storage]), "storage").await;
        assert_eq!(snapshot.reads.len(), 3);
        assert!(snapshot.reads.iter().all(|read| read.state == state));
        assert_eq!(nas.apis(), [INITDATA, storage]);
    }
    let nas = Nas::start(vec![(INITDATA, admin())]).await;
    let context = nas.context(&[
        INITDATA,
        DSM_INFO,
        UTILIZATION,
        storage,
        "SYNO.Core.Network",
    ]);
    let snapshot = probe(&context, "dashboard").await;
    assert_eq!(snapshot.status, SectionAccessStatus::Available);
    assert_eq!(
        nas.apis(),
        [
            INITDATA,
            DSM_INFO,
            UTILIZATION,
            storage,
            "SYNO.Core.Network"
        ]
    );
}

#[tokio::test]
async fn alternatives_follow_the_first_present_api_and_every_read_is_probed() {
    let hardware = "SYNO.Core.Hardware.Info";
    let ups = "SYNO.Core.ExternalDevice.UPS";
    let schedule = "SYNO.Core.Hardware.PowerSchedule";
    for (present, api) in [
        (vec![DSM_INFO, ups, schedule], DSM_INFO),
        (vec![hardware, DSM_INFO, ups, schedule], hardware),
    ] {
        let nas = Nas::start(vec![(INITDATA, admin())]).await;
        let snapshot = probe(&nas.context(&present), "hardware").await;
        assert_eq!(read(&snapshot, "hardwareInfo").api, api);
        assert_eq!(read(&snapshot, "hardwareInfo").state, ReadState::Available);
        assert_eq!(nas.apis(), [api, ups, schedule]);
    }
    let nas = Nas::start(vec![]).await;
    let snapshot = probe(&nas.context(&[ups, schedule]), "hardware").await;
    assert_eq!(read(&snapshot, "hardwareInfo").api, hardware);
    assert_eq!(
        read(&snapshot, "hardwareInfo").state,
        ReadState::NotSupported
    );
    assert_eq!(snapshot.status, SectionAccessStatus::Partial);

    let projects = "SYNO.ContainerManager.Project";
    let legacy = "SYNO.Docker.Project";
    for (present, api) in [(vec![legacy], legacy), (vec![projects, legacy], projects)] {
        let nas = Nas::start(vec![]).await;
        let snapshot = probe(&nas.context(&present), "docker").await;
        assert_eq!(read(&snapshot, "dockerProjects").api, api);
        assert_eq!(
            read(&snapshot, "dockerProjects").state,
            ReadState::Available
        );
        assert_eq!(nas.apis(), [api]);
    }

    // The first read failing no longer hides the others, and the first read
    // succeeding no longer marks the section available.
    for (info, utilization, status) in [
        (raw(DENIED_105), nas_data(), SectionAccessStatus::Partial),
        (nas_data(), raw(DENIED_105), SectionAccessStatus::Partial),
        (code(102), raw(DENIED_105), SectionAccessStatus::Denied),
        (
            raw(r#"{"success":true,"data":"fixture-private"}"#),
            raw(DENIED_105),
            SectionAccessStatus::Unknown,
        ),
    ] {
        let nas = Nas::start(vec![(DSM_INFO, info), (UTILIZATION, utilization)]).await;
        let snapshot = probe(&nas.context(&[DSM_INFO, UTILIZATION]), "system").await;
        assert_eq!(snapshot.status, status);
        assert_eq!(nas.apis(), [DSM_INFO, UTILIZATION]);
    }
}

// ── Session expiry, time limits, cancellation ───────────────────────

#[tokio::test]
async fn session_errors_on_a_read_or_the_role_lookup_expire_the_lease() {
    for expired in [106, 107, 119, 150] {
        let nas = Nas::start(vec![(INITDATA, admin()), (DSM_INFO, code(expired))]).await;
        let context = nas.context(&[INITDATA, DSM_INFO, UTILIZATION]);
        let error = context.probe("system").await.unwrap_err();
        assert!(matches!(error.kind, SynologyErrorKind::SessionExpired));
        assert!(crate::error::command_error(error).starts_with("SYNOLOGY_SESSION_EXPIRED: "));
        assert!(!context.lease.active.load(Ordering::Acquire));
        assert!(context.probe("system").await.is_err());
        assert_eq!(nas.apis(), [INITDATA, DSM_INFO], "code {expired}");

        let nas = Nas::start(vec![(INITDATA, code(expired))]).await;
        let context = nas.context(&[INITDATA, DSM_INFO, UTILIZATION]);
        let error = context.probe("system").await.unwrap_err();
        assert!(crate::error::command_error(error).starts_with("SYNOLOGY_SESSION_EXPIRED: "));
        assert!(!context.lease.active.load(Ordering::Acquire));
        assert!(context.lease.client.account.get().is_none());
        assert_eq!(nas.apis(), [INITDATA], "code {expired}");
    }
}

#[tokio::test]
async fn slow_reads_are_unknown_without_ending_the_session() {
    let nas = Nas::start(vec![(UTILIZATION, nas_data().after(ms(2_000)))]).await;
    let context = nas.context(&[DSM_INFO, UTILIZATION]);
    let started = Instant::now();
    let budget = ProbeBudget {
        account: ms(100),
        total: ms(1_000),
        per_read: ms(100),
    };
    let snapshot = probe_within(&context, "system", budget).await;
    assert!(started.elapsed() < ms(900));
    assert_eq!(read(&snapshot, "systemInfo").state, ReadState::Available);
    assert_eq!(read(&snapshot, "utilization").state, ReadState::Unknown);
    assert_eq!(read(&snapshot, "utilization").reason, UNKNOWN_REASON);
    assert_eq!(snapshot.status, SectionAccessStatus::Partial);
    assert_eq!(snapshot.requirement, None);
    assert!(context.lease.active.load(Ordering::Acquire));

    // Once the section deadline has passed, later reads are not sent.
    let nas = Nas::start(vec![(DSM_INFO, nas_data().after(ms(2_000)))]).await;
    let context = nas.context(&[DSM_INFO, UTILIZATION]);
    let budget = ProbeBudget {
        account: ms(100),
        total: ms(150),
        per_read: ms(1_000),
    };
    let snapshot = probe_within(&context, "system", budget).await;
    assert_eq!(snapshot.status, SectionAccessStatus::Unknown);
    assert_eq!(nas.apis(), [DSM_INFO]);
}

#[tokio::test]
async fn revocation_cancels_an_inflight_read_and_role_lookup() {
    for slow in [UTILIZATION, INITDATA] {
        let replies = if slow == INITDATA {
            vec![(INITDATA, admin().after(ms(5_000)))]
        } else {
            vec![
                (INITDATA, admin()),
                (UTILIZATION, nas_data().after(ms(5_000))),
            ]
        };
        let nas = Nas::start(replies).await;
        let context = Arc::new(nas.context(&[INITDATA, DSM_INFO, UTILIZATION]));
        let pending = tokio::spawn({
            let context = context.clone();
            async move { context.probe("system").await }
        });
        tokio::time::timeout(Duration::from_secs(2), async {
            while nas.count(slow) == 0 {
                tokio::time::sleep(ms(5)).await;
            }
        })
        .await
        .unwrap();
        context.lease.active.store(false, Ordering::Release);
        context.lease.cancelled.notify_waiters();
        let error = tokio::time::timeout(ms(300), pending)
            .await
            .unwrap()
            .unwrap()
            .unwrap_err();
        assert!(matches!(error.kind, SynologyErrorKind::SessionExpired));
        assert!(crate::error::command_error(error).starts_with("SYNOLOGY_SESSION_EXPIRED: "));
        if slow == INITDATA {
            assert_eq!(nas.apis(), [INITDATA], "no read after a cancelled lookup");
            assert!(context.lease.client.account.get().is_none());
        }
    }
}

#[tokio::test]
async fn signed_request_queue_waits_count_against_the_deadline_not_the_read() {
    let nas = Nas::start(vec![(UTILIZATION, nas_data().after(ms(50)))]).await;
    let mut client = nas.client(&[DSM_INFO, UTILIZATION]);
    let signer = signed_client(&mut client);
    let context = lease(client);

    // Another signed call of this session is stalled past the section deadline.
    let stalled = signer.clone().lock_owned().await;
    let started = Instant::now();
    let budget = ProbeBudget {
        account: ms(100),
        total: ms(300),
        per_read: Duration::from_secs(3),
    };
    let snapshot = probe_within(&context, "system", budget).await;
    assert!(started.elapsed() < ms(1_500));
    assert_eq!(snapshot.status, SectionAccessStatus::Unknown);
    assert!(nas.apis().is_empty(), "nothing was sent while queued");
    drop(stalled);

    // A queue wait longer than one read's own limit does not use that limit up.
    let stalled = signer.clone().lock_owned().await;
    tokio::spawn(async move {
        tokio::time::sleep(ms(250)).await;
        drop(stalled);
    });
    let budget = ProbeBudget {
        account: ms(100),
        total: Duration::from_secs(3),
        per_read: ms(150),
    };
    let snapshot = probe_within(&context, "system", budget).await;
    assert_eq!(snapshot.status, SectionAccessStatus::Available);
    let requests = nas.requests.lock().unwrap();
    assert_eq!(requests.len(), 2);
    assert!(requests
        .iter()
        .all(|request| request.text.to_ascii_lowercase().contains("x-syno-hash: ")));
}

// ── Role lookup ─────────────────────────────────────────────────────

#[tokio::test]
async fn unusable_role_lookups_leave_the_role_unknown_and_reads_classified() {
    let oversized = {
        let mut body = br#"{"success":true,"data":{"Strings":""#.to_vec();
        body.resize(body.len() + 8 * 1024 * 1024, b'a');
        body.extend_from_slice(br#""}}"#);
        raw(body)
    };
    let cached = [
        code(105),
        code(102),
        oversized,
        raw(r#"{"success":true,"data":{"Session":"fixture-private"}}"#),
        raw(
            r#"{"success":true,"data":{"AppPrivilege":{},"Strings":{"fixture":"fixture-private"}}}"#,
        ),
        raw(r#"{"success":true,"data":{"Session":{"is_admin":"yes"}}}"#),
        raw(r#"{"success":true}"#),
    ];
    for (index, reply) in cached.into_iter().enumerate() {
        let nas = Nas::start(vec![(INITDATA, reply), (UTILIZATION, raw(DENIED_105))]).await;
        let context = nas.context(&[INITDATA, DSM_INFO, UTILIZATION]);
        for _ in 0..2 {
            let snapshot = probe(&context, "system").await;
            assert_eq!(snapshot.account.role, AccountRole::Unknown, "case {index}");
            assert_eq!(read(&snapshot, "systemInfo").state, ReadState::Available);
            assert_eq!(
                read(&snapshot, "utilization").state,
                ReadState::RequiresAdministrator
            );
        }
        assert_eq!(
            nas.count(INITDATA),
            1,
            "case {index}: remembered for the login"
        );
        assert_eq!(nas.count(UTILIZATION), 2);
    }

    // A slow or unreadable transport answer is not remembered.
    for first in [
        admin().after(ms(1_000)),
        raw("<html>fixture-private</html>"),
        code(109),
    ] {
        let nas = Nas::start(vec![
            (INITDATA, first),
            (INITDATA, admin()),
            (UTILIZATION, raw(DENIED_105)),
        ])
        .await;
        let context = nas.context(&[INITDATA, DSM_INFO, UTILIZATION]);
        let budget = ProbeBudget {
            account: ms(200),
            ..PROBE_BUDGET
        };
        let snapshot = probe_within(&context, "system", budget).await;
        assert_eq!(snapshot.account.role, AccountRole::Unknown);
        assert_eq!(
            read(&snapshot, "utilization").state,
            ReadState::RequiresAdministrator
        );
        let snapshot = probe_within(&context, "system", budget).await;
        assert_eq!(snapshot.account.role, AccountRole::Administrator);
        assert_eq!(
            read(&snapshot, "utilization").state,
            ReadState::SessionRestricted
        );
        assert_eq!(nas.count(INITDATA), 2);
    }
}

#[tokio::test]
async fn role_is_looked_up_once_across_concurrent_section_checks() {
    let nas = Nas::start(vec![(INITDATA, admin().after(ms(200)))]).await;
    let client = nas.client(&[
        INITDATA,
        DSM_INFO,
        UTILIZATION,
        "SYNO.Core.User",
        "SYNO.Core.Group",
        "SYNO.Core.Network",
    ]);
    let active = Arc::new(AtomicBool::new(true));
    let cancelled = Arc::new(tokio::sync::Notify::new());
    let share = || SectionAccessContext {
        lease: FileTransferContext {
            client: client.clone(),
            active: active.clone(),
            cancelled: cancelled.clone(),
        },
    };
    let (first, second, third) = (share(), share(), share());
    let (system, users, network) = tokio::join!(
        probe(&first, "system"),
        probe(&second, "users"),
        probe(&third, "network"),
    );
    for snapshot in [&system, &users, &network] {
        assert_eq!(snapshot.account.role, AccountRole::Administrator);
    }
    assert_eq!(nas.count(INITDATA), 1);
    probe(&share(), "dashboard").await;
    assert_eq!(nas.count(INITDATA), 1);
}

// ── Scope and privacy ───────────────────────────────────────────────

#[tokio::test]
async fn every_section_uses_only_static_read_calls_and_never_returns_nas_data() {
    let nas = Nas::start(vec![(INITDATA, admin())]).await;
    let mut apis: Vec<&str> = api_access::READS
        .iter()
        .flat_map(|spec| spec.alternatives.iter().map(|call| call.api))
        .collect();
    apis.push(INITDATA);
    let context = nas.context(&apis);
    let mut expected = 1;
    for section in SECTIONS {
        let snapshot = probe(&context, section).await;
        assert_eq!(snapshot.status, SectionAccessStatus::Available, "{section}");
        assert_eq!(snapshot.section, section);
        let calls: BTreeSet<_> = api_access::section_reads(section)
            .unwrap()
            .1
            .iter()
            .map(|field| {
                let call = &api_access::read_spec(field).unwrap().alternatives[0];
                (call.api, call.method, call.params)
            })
            .collect();
        expected += calls.len();
    }
    let requests = nas.requests.lock().unwrap();
    assert_eq!(requests.len(), expected);
    assert_eq!(requests.iter().filter(|r| r.api == INITDATA).count(), 1);
    for request in requests.iter() {
        let first = request.text.lines().next().unwrap();
        assert!(first.starts_with("POST /webapi/entry.cgi?"), "{first}");
        assert!(!first.contains(PRIVATE));
        let allowed = request.api == INITDATA && request.method == "get"
            || api_access::READS.iter().any(|spec| {
                spec.alternatives.iter().any(|call| {
                    call.api == request.api
                        && call.method == request.method
                        && request.version == call.max_version.min(10).to_string()
                })
            });
        assert!(
            allowed,
            "{} {} v{}",
            request.api, request.method, request.version
        );
        if request.text.contains("limit=") {
            assert!(request.text.contains("offset=0&limit=1"));
        }
        assert!(request.text.contains("_sid=fixture-private-sid"));
    }
}

#[tokio::test]
async fn invalid_sections_are_rejected_without_requests_or_echo() {
    let nas = Nas::start(vec![]).await;
    let context = nas.context(&[INITDATA, DSM_INFO]);
    let error = context
        .probe("fixture-private-invalid-section")
        .await
        .unwrap_err();
    assert!(!error.to_string().contains(PRIVATE));
    assert!(nas.apis().is_empty());
}

#[test]
fn usernames_are_display_safe_for_the_frontend() {
    assert_eq!(display_username("nas-admin"), "nas-admin");
    assert_eq!(
        display_username("a\u{0}b\u{9f}c\u{200b}d\u{2066}e\u{feff}"),
        "a\u{fffd}b\u{fffd}c\u{fffd}d\u{fffd}e\u{fffd}"
    );
    assert_eq!(display_username("  "), "(unnamed account)");
    assert_eq!(display_username(""), "(unnamed account)");
    let long = display_username(&"👍".repeat(200));
    assert_eq!(long.encode_utf16().count(), 256);
    let long = display_username(&format!("x{}", "👍".repeat(200)));
    assert_eq!(long.encode_utf16().count(), 255);
}

// ── Frontend contract ───────────────────────────────────────────────

#[test]
fn rust_enums_serialize_to_the_frontend_values() {
    let names = |values: Vec<Value>| {
        values
            .into_iter()
            .map(|value| value.as_str().unwrap().to_owned())
            .collect::<Vec<_>>()
    };
    let states = [
        ReadState::Available,
        ReadState::RequiresAdministrator,
        ReadState::SessionRestricted,
        ReadState::RequiresApplicationPrivilege,
        ReadState::PermissionDenied,
        ReadState::PackageNotInstalled,
        ReadState::NotSupported,
        ReadState::Unknown,
    ];
    assert_eq!(
        names(states.iter().map(|state| json!(state)).collect()),
        contract::READ_STATES
    );
    for state in states {
        let requirement = state.requirement().map(|value| json!(value));
        let expected = contract::READ_STATE_REQUIREMENT
            .iter()
            .find(|(name, _)| json!(state) == *name)
            .unwrap()
            .1;
        assert_eq!(requirement, expected.map(|value| json!(value)), "{state:?}");
    }
    assert_eq!(
        names(
            [
                SectionAccessStatus::Available,
                SectionAccessStatus::Partial,
                SectionAccessStatus::Denied,
                SectionAccessStatus::Unavailable,
                SectionAccessStatus::Unknown,
            ]
            .iter()
            .map(|status| json!(status))
            .collect()
        ),
        contract::SECTION_STATUSES
    );
    assert_eq!(
        names(
            [
                AccessRequirement::Administrator,
                AccessRequirement::Session,
                AccessRequirement::ApplicationPrivilege,
                AccessRequirement::Permission,
                AccessRequirement::Package,
                AccessRequirement::DsmVersion,
            ]
            .iter()
            .map(|requirement| json!(requirement))
            .collect()
        ),
        contract::REQUIREMENTS
    );
    assert_eq!(
        names(
            [
                AccountRole::Administrator,
                AccountRole::Standard,
                AccountRole::Unknown
            ]
            .iter()
            .map(|role| json!(role))
            .collect()
        ),
        contract::ROLES
    );
    assert_eq!(
        names([json!(SessionName::FileStation), json!(SessionName::Webui)].to_vec()),
        contract::SESSION_NAMES
    );
    assert_eq!(
        names(
            [
                LoginHandshake::Ik,
                LoginHandshake::IkIncomplete,
                LoginHandshake::Legacy,
                LoginHandshake::LegacyUnavailable,
            ]
            .iter()
            .map(|handshake| json!(handshake))
            .collect()
        ),
        contract::HANDSHAKES
    );
    assert_eq!(
        names(
            [
                SessionRoute::Direct,
                SessionRoute::HttpProxy,
                SessionRoute::QuickconnectRelay,
                SessionRoute::QuickconnectDirect,
            ]
            .iter()
            .map(|route| json!(route))
            .collect()
        ),
        contract::ROUTES
    );
    assert_eq!(
        names(
            [
                SecondFactor::None,
                SecondFactor::Otp,
                SecondFactor::TrustedDevice
            ]
            .iter()
            .map(|factor| json!(factor))
            .collect()
        ),
        contract::SECOND_FACTORS
    );
}

/// Every combination of read states, for every section, aggregates to a
/// snapshot the frontend validator accepts.
#[test]
fn every_read_state_combination_passes_the_frontend_validator() {
    const STATES: [ReadState; 8] = [
        ReadState::Available,
        ReadState::RequiresAdministrator,
        ReadState::SessionRestricted,
        ReadState::RequiresApplicationPrivilege,
        ReadState::PermissionDenied,
        ReadState::PackageNotInstalled,
        ReadState::NotSupported,
        ReadState::Unknown,
    ];
    let account = account_access(
        &identity(LoginHandshake::Ik, SessionRoute::Direct),
        AccountRole::Unknown,
    );
    let mut checked_snapshots = 0;
    for (section, fields) in api_access::SECTION_READS {
        let combinations = STATES.len().pow(fields.len() as u32);
        for mut index in 0..combinations {
            let reads = fields
                .iter()
                .map(|field| {
                    let spec = api_access::read_spec(field).unwrap();
                    let call = &spec.alternatives[0];
                    let state = STATES[index % STATES.len()];
                    index /= STATES.len();
                    read_access(
                        spec,
                        call,
                        api_access::privilege_for(call.api),
                        state,
                        format!("Fixture reason for {}.", call.api),
                    )
                })
                .collect::<Vec<_>>();
            let states: Vec<_> = reads.iter().map(|read| read.state).collect();
            let snapshot = snapshot(section, account.clone(), reads);
            let value = serde_json::to_value(&snapshot).unwrap();
            if let Err(problem) = contract::validate(section, &value) {
                panic!("{section} {states:?}: {problem}\n{value:#}");
            }
            assert_eq!(
                value["status"],
                contract::aggregate(&states.iter().map(|state| json!(state)).collect::<Vec<_>>())
            );
            checked_snapshots += 1;
        }
    }
    // 4×8⁴ + 3×8³ + 5×8² + 6×8 section snapshots.
    assert_eq!(checked_snapshots, 18_288);
}

#[test]
fn the_frontend_validator_port_rejects_what_the_frontend_rejects() {
    let account = account_access(
        &identity(LoginHandshake::Ik, SessionRoute::Direct),
        AccountRole::Administrator,
    );
    let reads = ["systemInfo", "utilization"]
        .iter()
        .map(|field| {
            let spec = api_access::read_spec(field).unwrap();
            let call = &spec.alternatives[0];
            read_access(
                spec,
                call,
                api_access::privilege_for(call.api),
                ReadState::Available,
                AVAILABLE_READ.into(),
            )
        })
        .collect();
    let valid = serde_json::to_value(snapshot("system", account, reads)).unwrap();
    assert_eq!(contract::validate("system", &valid), Ok(()));
    let broken = |edit: &dyn Fn(&mut Value)| {
        let mut value = valid.clone();
        edit(&mut value);
        contract::validate("system", &value).is_err()
    };
    assert!(broken(&|value| value["section"] = json!("storage")));
    assert!(broken(&|value| value["status"] = json!("partial")));
    assert!(broken(
        &|value| value["requirement"] = json!("administrator")
    ));
    assert!(broken(&|value| {
        value.as_object_mut().unwrap().remove("requirement");
    }));
    assert!(broken(&|value| value["reads"]
        .as_array_mut()
        .unwrap()
        .truncate(1)));
    assert!(broken(
        &|value| value["reads"][1]["field"] = json!("systemInfo")
    ));
    assert!(broken(
        &|value| value["reads"][0]["api"] = json!("SYNO.Bad_Name")
    ));
    assert!(broken(
        &|value| value["reads"][0]["reason"] = json!("line\nbreak")
    ));
    assert!(broken(&|value| value["reads"][0]["package"] = Value::Null));
    assert!(broken(&|value| value["account"]["authVersion"] = json!(0)));
    assert!(broken(
        &|value| value["account"]["sessionName"] = json!("SortOfRemoteNG")
    ));
    assert!(broken(
        &|value| value["account"]["signedInAs"] = json!("a\u{202e}b")
    ));
    assert!(broken(&|value| value["account"]["hostname"] = json!("nas")));
}

/// Rust copy of the frontend validator, `src/utils/synology/synologyAccess.ts`
/// (t84-e3). Values and rules are copied with their TS line numbers; a change
/// on either side must update both.
mod contract {
    use serde_json::Value;

    /// `READ_STATES`, synologyAccess.ts:153-162.
    pub const READ_STATES: [&str; 8] = [
        "available",
        "requires_administrator",
        "session_restricted",
        "requires_application_privilege",
        "permission_denied",
        "package_not_installed",
        "not_supported",
        "unknown",
    ];
    /// `SECTION_STATUSES`, synologyAccess.ts:163-169.
    pub const SECTION_STATUSES: [&str; 5] =
        ["available", "partial", "denied", "unavailable", "unknown"];
    /// `REQUIREMENTS`, synologyAccess.ts:170-177.
    pub const REQUIREMENTS: [&str; 6] = [
        "administrator",
        "session",
        "application_privilege",
        "permission",
        "package",
        "dsm_version",
    ];
    /// `ROLES`, synologyAccess.ts:178-182.
    pub const ROLES: [&str; 3] = ["administrator", "standard", "unknown"];
    /// `SESSION_NAMES`, synologyAccess.ts:183-186.
    pub const SESSION_NAMES: [&str; 2] = ["FileStation", "webui"];
    /// `HANDSHAKES`, synologyAccess.ts:187-192.
    pub const HANDSHAKES: [&str; 4] = ["ik", "ik_incomplete", "legacy", "legacy_unavailable"];
    /// `ROUTES`, synologyAccess.ts:193-198.
    pub const ROUTES: [&str; 4] = [
        "direct",
        "http_proxy",
        "quickconnect_relay",
        "quickconnect_direct",
    ];
    /// `SECOND_FACTORS`, synologyAccess.ts:199-203.
    pub const SECOND_FACTORS: [&str; 3] = ["none", "otp", "trusted_device"];
    /// `SYNOLOGY_READ_STATE_REQUIREMENT`, synologyAccess.ts:206-218.
    pub const READ_STATE_REQUIREMENT: [(&str, Option<&str>); 8] = [
        ("available", None),
        ("requires_administrator", Some("administrator")),
        ("session_restricted", Some("session")),
        (
            "requires_application_privilege",
            Some("application_privilege"),
        ),
        ("permission_denied", Some("permission")),
        ("package_not_installed", Some("package")),
        ("not_supported", Some("dsm_version")),
        ("unknown", None),
    ];
    /// `DENIED_REQUIREMENTS`, synologyAccess.ts:371-376.
    const DENIED_REQUIREMENTS: [&str; 4] = [
        "administrator",
        "session",
        "application_privilege",
        "permission",
    ];

    /// `API_PATTERN`, synologyAccess.ts:268: `^SYNO\.[A-Za-z0-9.]{1,120}$`.
    fn api_name(value: &Value) -> bool {
        value
            .as_str()
            .and_then(|api| api.strip_prefix("SYNO."))
            .is_some_and(|rest| {
                (1..=120).contains(&rest.len())
                    && rest
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'.')
            })
    }

    /// `safeText` + `UNSAFE_TEXT`, synologyAccess.ts:271-284 (lengths are UTF-16 units).
    fn safe_text(value: &Value, max: usize) -> bool {
        value.as_str().is_some_and(|text| {
            !text.trim().is_empty()
                && text.encode_utf16().count() <= max
                && !text.chars().any(|character| {
                    matches!(character,
                        '\u{0}'..='\u{1f}'
                        | '\u{7f}'..='\u{9f}'
                        | '\u{200b}'..='\u{200f}'
                        | '\u{2028}'..='\u{202e}'
                        | '\u{2060}'..='\u{2069}'
                        | '\u{feff}')
                })
        })
    }

    fn one_of(values: &[&str], value: &Value) -> bool {
        value.as_str().is_some_and(|value| values.contains(&value))
    }

    /// `aggregateSectionStatus`, synologyAccess.ts:349-369.
    pub fn aggregate(states: &[Value]) -> Value {
        let available = states.iter().filter(|state| *state == "available").count();
        Value::from(if !states.is_empty() && available == states.len() {
            "available"
        } else if available > 0 {
            "partial"
        } else if states.iter().any(|state| state == "unknown") {
            "unknown"
        } else if states.iter().any(|state| {
            one_of(
                &[
                    "requires_administrator",
                    "session_restricted",
                    "requires_application_privilege",
                    "permission_denied",
                ],
                state,
            )
        }) {
            "denied"
        } else {
            "unavailable"
        })
    }

    /// `validateAccount`, synologyAccess.ts:286-317, plus: no keys beyond the contract.
    fn account(value: &Value) -> Result<(), String> {
        let object = value.as_object().ok_or("account is not an object")?;
        let keys = [
            "signedInAs",
            "role",
            "portalSession",
            "sessionName",
            "loginHandshake",
            "authVersion",
            "route",
            "secondFactor",
        ];
        if object.len() != keys.len() || !keys.iter().all(|key| object.contains_key(*key)) {
            return Err(format!(
                "account keys {:?}",
                object.keys().collect::<Vec<_>>()
            ));
        }
        let version = value["authVersion"].as_u64();
        (safe_text(&value["signedInAs"], 256)
            && one_of(&ROLES, &value["role"])
            && one_of(&SESSION_NAMES, &value["sessionName"])
            && one_of(&HANDSHAKES, &value["loginHandshake"])
            && one_of(&ROUTES, &value["route"])
            && one_of(&SECOND_FACTORS, &value["secondFactor"])
            && value["portalSession"].is_boolean()
            && version.is_some_and(|version| (1..=64).contains(&version)))
        .then_some(())
        .ok_or_else(|| format!("account {value}"))
    }

    /// `validateRead`, synologyAccess.ts:319-346, plus: no keys beyond the contract.
    fn read(expected: &[&str], value: &Value) -> Result<(), String> {
        let object = value.as_object().ok_or("read is not an object")?;
        if !object.keys().all(|key| {
            ["field", "api", "state", "reason", "package", "application"].contains(&key.as_str())
        }) {
            return Err(format!("read keys {:?}", object.keys().collect::<Vec<_>>()));
        }
        let optional = ["package", "application"]
            .iter()
            .all(|key| object.get(*key).is_none_or(|value| safe_text(value, 64)));
        (one_of(expected, &value["field"])
            && one_of(&READ_STATES, &value["state"])
            && api_name(&value["api"])
            && safe_text(&value["reason"], 1024)
            && optional)
            .then_some(())
            .ok_or_else(|| format!("read {value}"))
    }

    /// `validateSectionAccessSnapshot`, synologyAccess.ts:383-444 (the current
    /// backend always sends `reads`, so the legacy branch does not apply).
    pub fn validate(section: &str, value: &Value) -> Result<(), String> {
        let object = value.as_object().ok_or("snapshot is not an object")?;
        let keys = [
            "section",
            "status",
            "requirement",
            "reason",
            "account",
            "reads",
        ];
        if object.len() != keys.len() || !keys.iter().all(|key| object.contains_key(*key)) {
            return Err(format!(
                "snapshot keys {:?}",
                object.keys().collect::<Vec<_>>()
            ));
        }
        if value["section"] != section {
            return Err("section".into());
        }
        if !one_of(&SECTION_STATUSES, &value["status"]) || !safe_text(&value["reason"], 1024) {
            return Err("status or reason".into());
        }
        let expected = crate::api_access::section_reads(section)
            .ok_or("section")?
            .1;
        let reads = value["reads"].as_array().ok_or("reads")?;
        if reads.len() != expected.len() {
            return Err("read count".into());
        }
        let mut seen = Vec::new();
        for entry in reads {
            read(expected, entry)?;
            if seen.contains(&entry["field"]) {
                return Err("duplicate field".into());
            }
            seen.push(entry["field"].clone());
        }
        account(&value["account"])?;
        let states: Vec<Value> = reads.iter().map(|read| read["state"].clone()).collect();
        if aggregate(&states) != value["status"] {
            return Err(format!(
                "status {} is not the aggregate {}",
                value["status"],
                aggregate(&states)
            ));
        }
        let requirement = &value["requirement"];
        if !requirement.is_null() {
            let implied = states.iter().any(|state| {
                READ_STATE_REQUIREMENT.iter().any(|(name, implies)| {
                    state == name && implies.is_some_and(|implies| requirement == implies)
                })
            });
            if !one_of(&REQUIREMENTS, requirement) || !implied {
                return Err(format!(
                    "requirement {requirement} is not implied by a read"
                ));
            }
        }
        let status = value["status"].as_str().unwrap_or_default();
        let invalid = (status == "available" && !requirement.is_null())
            || (status == "denied" && !one_of(&DENIED_REQUIREMENTS, requirement))
            || (status == "unavailable" && !one_of(&["package", "dsm_version"], requirement));
        if invalid {
            return Err(format!("requirement {requirement} for status {status}"));
        }
        Ok(())
    }
}
