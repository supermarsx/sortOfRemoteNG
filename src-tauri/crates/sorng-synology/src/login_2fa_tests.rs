//! Loopback DSM fixtures for two-factor sign-in and trusted devices.
//!
//! The mock NAS routes by API, answers DSM 7's secure login handshake with a
//! real Noise IK responder, follows a script of login answers and a
//! `SYNO.API.Auth.Type` reply, and records every request. Only ephemeral
//! loopback listeners, synthetic credentials and generated keys are used.
use crate::{
    auth::{AuthManager, AuthMethod},
    device_trust::{
        self, device_name_for, local_device_name, DeviceLogin, DeviceTrustRequest, TrustedDevice,
    },
    error::{command_error, SynologyError, SynologyErrorKind, SynologyResult},
    http_route::NativeHttpRoute,
    instances::SynologyInstances,
    login_handshake::{decode_b64url, LoginHandshake, LoginOptions, SecondFactor, NOISE_PATTERN},
    scoped_files::FileStationLogin,
    service::SynologyService,
    types::{LoginResult, SynologyConfig},
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    task::JoinHandle,
};

const USER: &str = "fixture-2fa-admin";
const PASSWORD: &str = "synthetic-private-password";
const OTP: &str = "135790";
const SID: &str = "fixture-private-sid";
const TOKEN: &str = "fixture-private-synotoken";
const DID: &str = "fixture-private-issued-device";
const SAVED_DID: &str = "fixture-private-saved-device";
const AUTH: &str = "SYNO.API.Auth";
const AUTH_TYPE: &str = "SYNO.API.Auth.Type";
const FILE_STATION_INFO: &str = "SYNO.FileStation.Info";
const OTHER_COMPUTER: &str = "SortOfRemoteNG · OTHER-COMPUTER";
const SECRETS: [&str; 6] = [PASSWORD, OTP, SID, TOKEN, DID, SAVED_DID];
const ENROLLMENT: &str = "DSM requires this account to set up two-factor authentication before it can sign in. Complete setup once in DSM in your browser (the DSM website view works), then connect again.";
const SECURE_SIGNIN_OTP: &str = "Enter the one-time code from your authenticator app or the code shown in Synology Secure SignIn. Approve-sign-in push and security keys can't complete an API sign-in; use the DSM website view for those.";
const INVALID_DEVICE: &str = "The saved trusted device is invalid, so this sign-in was not sent. Forget the trusted device, then sign in with a one-time code.";

// ── Mock DSM ────────────────────────────────────────────────────────

/// One scripted answer to `SYNO.API.Auth` `login`.
#[derive(Clone)]
enum Login {
    /// A DSM error code, with nested details that must never be forwarded.
    Refuse(i32),
    /// Success; the value's fields are added to `data` (e.g. a `did`).
    Accept(Value),
}

/// The `SYNO.API.Auth.Type` behaviour.
#[derive(Clone)]
enum AuthType {
    /// Not listed in `SYNO.API.Info`.
    Absent,
    /// This JSON body.
    Body(Value),
    /// An HTML page.
    Html,
    /// Answers only after the client's budget.
    Slow,
}

#[derive(Clone, Debug)]
struct Seen {
    api: String,
    method: String,
    ui_config: bool,
    fields: HashMap<String, String>,
}

impl Seen {
    fn is(&self, api: &str, method: &str) -> bool {
        !self.ui_config && self.api == api && self.method == method
    }
}

struct Reply {
    body: String,
    cookie: Option<String>,
    delay: Duration,
}

impl Reply {
    fn json(value: Value) -> Self {
        Self {
            body: value.to_string(),
            cookie: None,
            delay: Duration::ZERO,
        }
    }
}

fn ok(data: Value) -> Value {
    json!({"success":true,"data":data})
}

fn dsm_error(code: i32) -> Value {
    json!({"success":false,"error":{"code":code}})
}

struct State {
    logins: VecDeque<Login>,
    auth_type: AuthType,
    cancel_on_login: Option<Arc<AtomicBool>>,
    server_private: Vec<u8>,
    server_public: Vec<u8>,
    handshakes: usize,
    seen: Vec<Seen>,
}

impl State {
    fn respond(&mut self, seen: &Seen) -> Reply {
        if seen.ui_config {
            let mut reply = Reply::json(ok(json!({"enable_secure_signin":true})));
            reply.cookie = Some(format!(
                "_SSID={}; path=/; HttpOnly",
                URL_SAFE_NO_PAD.encode(&self.server_public)
            ));
            return reply;
        }
        match (seen.api.as_str(), seen.method.as_str()) {
            ("SYNO.API.Info", "query") => return Reply::json(self.discovery()),
            (AUTH, "login") => return self.login(seen),
            (AUTH_TYPE, "get") => return self.auth_type(),
            _ => {}
        }
        if seen.fields.get("_sid").map(String::as_str) != Some(SID) {
            return Reply::json(dsm_error(119));
        }
        Reply::json(match (seen.api.as_str(), seen.method.as_str()) {
            (AUTH, "logout") => ok(json!({})),
            (FILE_STATION_INFO, "get") => ok(json!({"hostname":"fixture"})),
            ("SYNO.Core.Desktop.Initdata", "get") => {
                ok(json!({"Session":{"is_admin":true},"AppPrivilege":{}}))
            }
            _ => dsm_error(102),
        })
    }

    fn discovery(&self) -> Value {
        let mut apis = serde_json::Map::new();
        let mut add = |name: &str, maximum: u32| {
            apis.insert(
                name.into(),
                json!({"path":"entry.cgi","minVersion":1,"maxVersion":maximum}),
            );
        };
        add(AUTH, 7);
        add("SYNO.API.Auth.UIConfig", 1);
        add(FILE_STATION_INFO, 2);
        add("SYNO.Core.Desktop.Initdata", 1);
        if !matches!(self.auth_type, AuthType::Absent) {
            add(AUTH_TYPE, 1);
        }
        ok(Value::Object(apis))
    }

    fn login(&mut self, seen: &Seen) -> Reply {
        if let Some(active) = &self.cancel_on_login {
            active.store(false, Ordering::Release);
        }
        let reply = seen
            .fields
            .get("ik_message")
            .and_then(|message| self.accept_message_one(message));
        match self.logins.pop_front().unwrap_or(Login::Accept(json!({}))) {
            Login::Refuse(code) => Reply::json(json!({"success":false,"error":{
                "code":code,
                "errors":[{"message":SECRETS.join(" ")}]
            }})),
            Login::Accept(extra) => {
                let mut data = json!({"sid":SID,"synotoken":TOKEN});
                if let Some(reply) = reply {
                    data["ik_message"] = json!(reply);
                }
                for (key, value) in extra.as_object().cloned().unwrap_or_default() {
                    data[key] = value;
                }
                let mut reply = Reply::json(ok(data));
                reply.cookie = Some(format!("id={SID}; Path=/; HttpOnly"));
                reply
            }
        }
    }

    fn auth_type(&self) -> Reply {
        match &self.auth_type {
            AuthType::Absent => Reply::json(dsm_error(102)),
            AuthType::Body(body) => Reply::json(body.clone()),
            AuthType::Html => Reply {
                body: "<html><body>DSM</body></html>".into(),
                cookie: None,
                delay: Duration::ZERO,
            },
            AuthType::Slow => Reply {
                delay: Duration::from_secs(6),
                ..Reply::json(ok(json!([{"type":"otp"}])))
            },
        }
    }

    fn accept_message_one(&mut self, message: &str) -> Option<String> {
        let bytes = decode_b64url(message)?;
        let mut responder = snow::Builder::new(NOISE_PATTERN.parse().ok()?)
            .local_private_key(&self.server_private)
            .ok()?
            .build_responder()
            .ok()?;
        let mut payload = vec![0_u8; bytes.len()];
        responder.read_message(&bytes, &mut payload).ok()?;
        let mut reply = [0_u8; 256];
        let length = responder.write_message(&[], &mut reply).ok()?;
        self.handshakes += 1;
        Some(URL_SAFE_NO_PAD.encode(&reply[..length]))
    }
}

struct Dsm {
    state: Arc<Mutex<State>>,
    port: u16,
    worker: JoinHandle<()>,
}

impl Drop for Dsm {
    fn drop(&mut self) {
        self.worker.abort();
    }
}

impl Dsm {
    async fn start(logins: Vec<Login>, auth_type: AuthType) -> Self {
        let keys = snow::Builder::new(NOISE_PATTERN.parse().unwrap())
            .generate_keypair()
            .unwrap();
        let state = Arc::new(Mutex::new(State {
            logins: logins.into(),
            auth_type,
            cancel_on_login: None,
            server_private: keys.private,
            server_public: keys.public,
            handshakes: 0,
            seen: Vec::new(),
        }));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let shared = state.clone();
        let worker = tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                tokio::spawn(exchange(stream, shared.clone()));
            }
        });
        Self {
            state,
            port,
            worker,
        }
    }

    fn state<R>(&self, read: impl FnOnce(&mut State) -> R) -> R {
        read(&mut self.state.lock().unwrap())
    }

    fn config(&self) -> SynologyConfig {
        SynologyConfig {
            host: "127.0.0.1".into(),
            port: self.port,
            username: USER.into(),
            password: PASSWORD.into(),
            use_https: false,
            insecure: false,
            timeout_secs: 10,
            otp_code: None,
            device_token: None,
            access_token: None,
        }
    }

    fn with_code(&self) -> SynologyConfig {
        SynologyConfig {
            otp_code: Some(OTP.into()),
            ..self.config()
        }
    }

    fn with_saved_device(&self) -> SynologyConfig {
        SynologyConfig {
            device_token: Some(SAVED_DID.into()),
            ..self.config()
        }
    }

    fn seen(&self) -> Vec<Seen> {
        self.state(|state| state.seen.clone())
    }

    fn calls(&self, api: &str, method: &str) -> Vec<Seen> {
        self.seen()
            .into_iter()
            .filter(|seen| seen.is(api, method))
            .collect()
    }

    fn logins(&self) -> Vec<Seen> {
        self.calls(AUTH, "login")
    }

    fn method_lookups(&self) -> usize {
        self.calls(AUTH_TYPE, "get").len()
    }
}

async fn exchange(mut stream: TcpStream, state: Arc<Mutex<State>>) {
    let Some((head, body)) = read_request(&mut stream).await else {
        return;
    };
    let target = head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or_default()
        .to_owned();
    let fields: HashMap<String, String> = url::form_urlencoded::parse(&body).into_owned().collect();
    let query: HashMap<String, String> = url::Url::parse(&format!("http://fixture{target}"))
        .map(|url| url.query_pairs().into_owned().collect())
        .unwrap_or_default();
    let pick = |key: &str| {
        query
            .get(key)
            .or_else(|| fields.get(key))
            .cloned()
            .unwrap_or_default()
    };
    let seen = Seen {
        api: pick("api"),
        method: pick("method"),
        ui_config: target.ends_with("/SYNO.API.Auth.UIConfig"),
        fields: fields.clone(),
    };
    let reply = {
        let mut state = state.lock().unwrap();
        let reply = state.respond(&seen);
        state.seen.push(seen);
        reply
    };
    if !reply.delay.is_zero() {
        tokio::time::sleep(reply.delay).await;
    }
    let cookie = reply
        .cookie
        .map(|cookie| format!("Set-Cookie: {cookie}\r\n"))
        .unwrap_or_default();
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n{cookie}Content-Length: {}\r\nConnection: close\r\n\r\n{}",
        reply.body.len(),
        reply.body
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

async fn read_request(stream: &mut TcpStream) -> Option<(String, Vec<u8>)> {
    let mut data = Vec::new();
    let mut chunk = [0_u8; 4096];
    let header_end = loop {
        if let Some(end) = data.windows(4).position(|part| part == b"\r\n\r\n") {
            break end + 4;
        }
        if data.len() > 64 * 1024 {
            return None;
        }
        let count = stream.read(&mut chunk).await.ok()?;
        if count == 0 {
            return None;
        }
        data.extend_from_slice(&chunk[..count]);
    };
    let head = String::from_utf8(data[..header_end].to_vec()).ok()?;
    let length = head
        .lines()
        .find_map(|line| {
            let (key, value) = line.split_once(':')?;
            key.trim()
                .eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().ok())?
        })
        .unwrap_or(0);
    while data.len() < header_end + length {
        let count = stream.read(&mut chunk).await.ok()?;
        if count == 0 {
            return None;
        }
        data.extend_from_slice(&chunk[..count]);
    }
    Some((head, data[header_end..header_end + length].to_vec()))
}

// ── Helpers ─────────────────────────────────────────────────────────

fn enroll() -> Option<DeviceTrustRequest> {
    Some(DeviceTrustRequest {
        enroll: true,
        device_name: None,
    })
}

fn saved_as(name: &str) -> Option<DeviceTrustRequest> {
    Some(DeviceTrustRequest {
        enroll: false,
        device_name: Some(name.into()),
    })
}

fn options(device_trust: Option<DeviceTrustRequest>) -> LoginOptions {
    LoginOptions::default().with_device_trust(device_trust)
}

async fn attempt(
    service: &mut SynologyService,
    config: SynologyConfig,
    device_trust: Option<DeviceTrustRequest>,
) -> SynologyResult<FileStationLogin> {
    service
        .fs_connect_with_options(
            config,
            &AtomicBool::new(true),
            NativeHttpRoute::Direct {},
            options(device_trust),
        )
        .await
}

async fn sign_in(
    config: SynologyConfig,
    device_trust: Option<DeviceTrustRequest>,
) -> (SynologyService, SynologyResult<FileStationLogin>) {
    let mut service = SynologyService::new();
    let result = attempt(&mut service, config, device_trust).await;
    (service, result)
}

fn wire(login: &FileStationLogin) -> Value {
    serde_json::to_value(login).unwrap()
}

/// The `connected` wire form without its random receipt.
fn connected_wire(login: &FileStationLogin) -> Value {
    let mut value = wire(login);
    assert_eq!(value["status"], "connected", "{value}");
    let receipt = value.as_object_mut().unwrap().remove("sessionId").unwrap();
    assert!(receipt.as_str().is_some_and(|receipt| !receipt.is_empty()));
    value
}

fn assert_no_device_fields(login: &Seen) {
    for key in ["enable_device_token", "device_name", "device_id"] {
        assert!(!login.fields.contains_key(key), "{key} was sent");
    }
}

fn diagnostic(error: &SynologyError) -> Value {
    let text = command_error(error.clone());
    let (_, facts) = text
        .split_once("synology-diagnostic:v1:")
        .unwrap_or_else(|| panic!("no diagnostic in {text}"));
    serde_json::from_str(facts).unwrap()
}

fn assert_secret_free(label: &str, text: &str) {
    for secret in SECRETS {
        assert!(!text.contains(secret), "{label} leaked a secret: {text}");
    }
}

// ── 1. Code required, then a code ───────────────────────────────────

#[tokio::test]
async fn otp_required_then_a_code_connects_with_a_fresh_handshake_each_time() {
    let dsm = Dsm::start(vec![Login::Refuse(403)], AuthType::Absent).await;
    let mut service = SynologyService::new();
    let challenge = attempt(&mut service, dsm.config(), None).await.unwrap();
    assert_eq!(
        wire(&challenge),
        json!({"status":"otp_required","message":"Enter the current one-time code from your authenticator."})
    );
    assert!(!service.is_connected());
    let seen = dsm.seen();
    let first: Vec<_> = seen
        .iter()
        .map(|seen| (seen.ui_config, seen.api.as_str(), seen.method.as_str()))
        .collect();
    assert_eq!(
        first,
        [
            (false, "SYNO.API.Info", "query"),
            (true, "SYNO.API.Auth.UIConfig", "get"),
            (false, AUTH, "login"),
        ],
        "no File Station check, keep-alive, logout or retry after a challenge"
    );

    let login = attempt(&mut service, dsm.with_code(), None).await.unwrap();
    assert_eq!(
        connected_wire(&login),
        json!({"status":"connected","message":"Connected to Synology File Station"})
    );
    let logins = dsm.logins();
    assert_eq!(logins.len(), 2);
    for login in &logins {
        assert_eq!(login.fields["passwd"], PASSWORD);
        assert_eq!(login.fields["account"], USER);
        assert_no_device_fields(login);
    }
    assert!(!logins[0].fields.contains_key("otp_code"));
    assert_eq!(logins[1].fields["otp_code"], OTP);
    assert_ne!(
        logins[0].fields["ik_message"],
        logins[1].fields["ik_message"]
    );
    assert_eq!(
        dsm.seen().iter().filter(|seen| seen.ui_config).count(),
        2,
        "a fresh server key per attempt"
    );
    assert_eq!(dsm.state(|state| state.handshakes), 2);
    assert_eq!(dsm.calls(FILE_STATION_INFO, "get").len(), 1);
    let identity = service.client.as_ref().unwrap().session_identity().clone();
    assert_eq!(identity.login_handshake, LoginHandshake::Ik);
    assert_eq!(identity.second_factor, SecondFactor::Otp);
}

// ── 2. Invalid code ─────────────────────────────────────────────────

#[tokio::test]
async fn an_invalid_code_is_otp_invalid_and_publishes_no_session() {
    let dsm = Dsm::start(
        vec![Login::Refuse(404)],
        AuthType::Body(ok(json!([{"type":"otp"}]))),
    )
    .await;
    let registry = SynologyInstances::new();
    let result = registry
        .connect_with_route(
            "nas-2fa",
            "attempt-1",
            dsm.with_code(),
            NativeHttpRoute::Direct {},
            LoginOptions::default(),
        )
        .await
        .unwrap();
    assert_eq!(
        wire(&result),
        json!({"status":"otp_invalid","message":"The one-time code was not accepted. Enter a fresh code."})
    );
    assert!(registry.session_health("nas-2fa", "any-receipt").is_err());
    assert!(registry
        .resolve(Some("nas-2fa"), Some("any-receipt"))
        .await
        .is_err());
    assert_eq!(dsm.method_lookups(), 0, "only 403 and 449 look up methods");
    assert!(dsm.calls(FILE_STATION_INFO, "get").is_empty());
    assert!(dsm.calls(AUTH, "logout").is_empty());
}

// ── 3. Enforced enrollment ──────────────────────────────────────────

#[tokio::test]
async fn enforced_enrollment_is_a_single_login_without_a_method_lookup() {
    for (code_sent, device_trust) in [(false, None), (true, enroll())] {
        let dsm = Dsm::start(
            vec![Login::Refuse(406)],
            AuthType::Body(ok(json!([{"type":"otp"}]))),
        )
        .await;
        let config = if code_sent {
            dsm.with_code()
        } else {
            dsm.config()
        };
        let (service, result) = sign_in(config, device_trust).await;
        assert_eq!(
            wire(&result.unwrap()),
            json!({"status":"otp_enrollment_required","message":ENROLLMENT})
        );
        assert!(!service.is_connected());
        assert_eq!(dsm.logins().len(), 1, "exactly one login request");
        assert_eq!(dsm.method_lookups(), 0);
        assert_eq!(
            dsm.seen().len(),
            3,
            "discovery, server key and the login only"
        );
    }
}

// ── 4. Enroll ───────────────────────────────────────────────────────

#[tokio::test]
async fn enrolling_sends_this_computers_name_and_returns_the_issued_device() {
    let dsm = Dsm::start(
        vec![Login::Refuse(403), Login::Accept(json!({"did":DID}))],
        AuthType::Absent,
    )
    .await;
    let mut service = SynologyService::new();
    // Enrollment needs a code: a code-less attempt sends no device fields.
    let challenge = attempt(&mut service, dsm.config(), enroll()).await.unwrap();
    assert_eq!(wire(&challenge)["status"], "otp_required");
    let login = attempt(&mut service, dsm.with_code(), enroll())
        .await
        .unwrap();
    assert_eq!(
        connected_wire(&login),
        json!({"status":"connected","message":"Connected to Synology File Station",
            "trustedDevice":{"deviceName":local_device_name(),"deviceId":DID}})
    );
    let logins = dsm.logins();
    assert_no_device_fields(&logins[0]);
    let enrolled = &logins[1].fields;
    assert_eq!(enrolled["otp_code"], OTP);
    assert_eq!(enrolled["passwd"], PASSWORD);
    assert_eq!(enrolled["enable_device_token"], "yes");
    assert_eq!(enrolled["device_name"], local_device_name());
    assert!(!enrolled.contains_key("device_id"));
    assert!(enrolled.contains_key("ik_message"));
    let client = service.client.as_ref().unwrap();
    assert!(client.device_token.is_none() && client.config.device_token.is_none());
    assert_eq!(client.session_identity().second_factor, SecondFactor::Otp);
}

#[tokio::test]
async fn only_a_usable_did_from_an_enroll_sign_in_becomes_a_trusted_device() {
    let longest = "d".repeat(1024);
    for (extra, expected) in [
        (json!({"device_id":DID}), Some(DID.to_string())),
        (
            json!({"did":DID,"device_id":"fixture-private-other"}),
            Some(DID.to_string()),
        ),
        (json!({"did":longest}), Some(longest.clone())),
        (json!({}), None),
        (json!({"did":""}), None),
        (json!({"did":"   "}), None),
        (json!({"did":"d".repeat(1025)}), None),
        (json!({"did":"bad\u{7}token"}), None),
        (json!({"did":"line\nbreak"}), None),
        (json!({"did":"c1\u{85}control"}), None),
        (json!({"did":42}), None),
        (json!({"did":null}), None),
    ] {
        let dsm = Dsm::start(vec![Login::Accept(extra.clone())], AuthType::Absent).await;
        let (_, result) = sign_in(dsm.with_code(), enroll()).await;
        let value = connected_wire(&result.unwrap());
        match &expected {
            Some(device_id) => assert_eq!(
                value["trustedDevice"],
                json!({"deviceName":local_device_name(),"deviceId":device_id}),
                "{extra}"
            ),
            None => assert!(value.get("trustedDevice").is_none(), "{extra}: {value}"),
        }
    }
    // A did DSM returns without an enroll request is never passed on.
    for device_trust in [
        None,
        Some(DeviceTrustRequest {
            enroll: false,
            device_name: None,
        }),
    ] {
        let dsm = Dsm::start(vec![Login::Accept(json!({"did":DID}))], AuthType::Absent).await;
        let (_, result) = sign_in(dsm.with_code(), device_trust).await;
        assert!(connected_wire(&result.unwrap())
            .get("trustedDevice")
            .is_none());
        assert_no_device_fields(&dsm.logins()[0]);
    }
}

// ── 5. Reuse ────────────────────────────────────────────────────────

#[tokio::test]
async fn a_device_saved_on_this_computer_signs_in_without_a_code() {
    let dsm = Dsm::start(
        vec![Login::Accept(json!({"did":DID}))],
        AuthType::Body(ok(json!([{"type":"otp"}]))),
    )
    .await;
    let (service, result) = sign_in(dsm.with_saved_device(), saved_as(&local_device_name())).await;
    assert_eq!(
        connected_wire(&result.unwrap()),
        json!({"status":"connected","message":"Connected to Synology File Station"}),
        "no challenge and no newly issued device"
    );
    let logins = dsm.logins();
    assert_eq!(logins.len(), 1);
    let fields = &logins[0].fields;
    assert_eq!(fields["device_id"], SAVED_DID);
    assert_eq!(fields["device_name"], local_device_name());
    assert_eq!(fields["passwd"], PASSWORD);
    assert!(!fields.contains_key("otp_code"));
    assert!(!fields.contains_key("enable_device_token"));
    assert!(
        fields.contains_key("ik_message"),
        "a device sign-in performs the handshake too"
    );
    assert_eq!(dsm.seen().iter().filter(|seen| seen.ui_config).count(), 1);
    assert_eq!(dsm.method_lookups(), 0);
    let client = service.client.as_ref().unwrap();
    let identity = client.session_identity();
    assert_eq!(identity.second_factor, SecondFactor::TrustedDevice);
    assert_eq!(identity.login_handshake, LoginHandshake::Ik);
    assert!(client.device_token.is_none() && client.config.device_token.is_none());
}

// ── 6. Rejected ─────────────────────────────────────────────────────

#[tokio::test]
async fn a_saved_device_dsm_rejects_asks_for_a_code() {
    let dsm = Dsm::start(
        vec![Login::Refuse(403)],
        AuthType::Body(ok(json!([{"type":"otp"}]))),
    )
    .await;
    let (service, result) = sign_in(dsm.with_saved_device(), saved_as(&local_device_name())).await;
    assert_eq!(
        wire(&result.unwrap()),
        json!({"status":"otp_required",
            "message":"This NAS no longer accepts the saved trusted device. Enter a code to continue.",
            "methods":["otp"],"trustedDeviceRejected":true})
    );
    assert!(!service.is_connected());
    assert_eq!(dsm.logins()[0].fields["device_id"], SAVED_DID);
    assert_eq!(dsm.method_lookups(), 1);
}

// ── 7. Mismatch ─────────────────────────────────────────────────────

#[tokio::test]
async fn a_device_saved_on_another_computer_is_never_sent() {
    let dsm = Dsm::start(
        vec![Login::Refuse(403), Login::Accept(json!({}))],
        AuthType::Absent,
    )
    .await;
    let mut service = SynologyService::new();
    let challenge = attempt(
        &mut service,
        dsm.with_saved_device(),
        saved_as(OTHER_COMPUTER),
    )
    .await
    .unwrap();
    assert_eq!(
        wire(&challenge),
        json!({"status":"otp_required",
            "message":"The saved trusted device was set up on another computer, so it wasn't used. Enter a code to continue.",
            "trustedDeviceMismatch":true})
    );
    // An account DSM lets in without a second factor still never sees it.
    let login = attempt(
        &mut service,
        dsm.with_saved_device(),
        saved_as(OTHER_COMPUTER),
    )
    .await
    .unwrap();
    assert!(connected_wire(&login).get("trustedDevice").is_none());
    for login in dsm.logins() {
        assert_no_device_fields(&login);
        assert!(!login.fields.contains_key("otp_code"));
    }
    assert_eq!(
        service
            .client
            .as_ref()
            .unwrap()
            .session_identity()
            .second_factor,
        SecondFactor::None
    );
}

// ── 8. Secure SignIn fallback ───────────────────────────────────────

#[tokio::test]
async fn sign_in_methods_come_from_auth_type_once_after_403_or_449() {
    let dsm = Dsm::start(
        vec![Login::Refuse(449)],
        AuthType::Body(ok(json!([{"type":"authenticator"},{"type":"fido"}]))),
    )
    .await;
    let (_, result) = sign_in(dsm.config(), None).await;
    assert_eq!(
        wire(&result.unwrap()),
        json!({"status":"unsupported_mfa",
            "message":"DSM requires a sign-in method the NAS API can't complete. Approve-sign-in push and security keys can't complete an API sign-in; use the DSM website view for those.",
            "methods":["secure_signin_approval","security_key"]})
    );
    let lookups = dsm.calls(AUTH_TYPE, "get");
    assert_eq!(lookups.len(), 1);
    assert_eq!(
        lookups[0].fields,
        HashMap::from([("account".to_string(), USER.to_string())]),
        "only the account name: no SID, token, password, code or device"
    );
    let order: Vec<_> = dsm.seen().iter().map(|seen| seen.api.clone()).collect();
    assert_eq!(order.last().map(String::as_str), Some(AUTH_TYPE));

    for (types, methods, message) in [
        (
            json!([{"type":"otp"},{"type":"authenticator"}]),
            json!(["otp", "secure_signin_approval"]),
            SECURE_SIGNIN_OTP,
        ),
        (
            json!([{"type":"fido"},{"type":"otp"},{"type":"fido"},{"type":"passkey"}]),
            json!(["otp", "security_key"]),
            SECURE_SIGNIN_OTP,
        ),
        (
            json!([{"type":"otp"}]),
            json!(["otp"]),
            "Enter the current one-time code from your authenticator.",
        ),
    ] {
        let dsm = Dsm::start(vec![Login::Refuse(403)], AuthType::Body(ok(types))).await;
        let (_, result) = sign_in(dsm.config(), None).await;
        assert_eq!(
            wire(&result.unwrap()),
            json!({"status":"otp_required","message":message,"methods":methods})
        );
        assert_eq!(dsm.method_lookups(), 1);
    }
}

#[tokio::test]
async fn unusable_auth_type_answers_omit_methods() {
    for code in [403, 449] {
        for (auth_type, lookups) in [
            (AuthType::Absent, 0),
            (AuthType::Body(dsm_error(105)), 1),
            (AuthType::Body(dsm_error(102)), 1),
            (AuthType::Body(ok(json!("otp"))), 1),
            (AuthType::Body(ok(json!({"type":"otp"}))), 1),
            (AuthType::Body(json!({"success":true})), 1),
            (AuthType::Body(ok(json!([]))), 1),
            (
                AuthType::Body(ok(
                    json!([{"type":"passkey"},{"kind":"otp"},"otp",{"type":7}]),
                )),
                1,
            ),
            (AuthType::Html, 1),
        ] {
            let dsm = Dsm::start(vec![Login::Refuse(code)], auth_type).await;
            let (_, result) = sign_in(dsm.config(), None).await;
            let value = wire(&result.unwrap());
            assert!(value.get("methods").is_none(), "{code}: {value}");
            assert_eq!(dsm.method_lookups(), lookups, "{code}: {value}");
        }
    }
}

#[tokio::test]
async fn a_slow_auth_type_lookup_is_bounded_and_omits_methods() {
    let dsm = Dsm::start(vec![Login::Refuse(403)], AuthType::Slow).await;
    let started = Instant::now();
    let (_, result) = sign_in(dsm.config(), None).await;
    let value = wire(&result.unwrap());
    assert_eq!(value["status"], "otp_required");
    assert!(value.get("methods").is_none());
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "3 s budget, took {:?}",
        started.elapsed()
    );
    assert_eq!(dsm.method_lookups(), 1);
}

// ── 9. Refusals ─────────────────────────────────────────────────────

#[tokio::test]
async fn login_refusals_explain_the_dsm_code_and_keep_closed_diagnostics() {
    for (code, message) in [
        (400, "NAS rejected the username or password"),
        (401, "The DSM account is disabled."),
        (
            402,
            "DSM refused API sign-in for this account. The NAS API view signs in as a File Station session, so check the account's File Station application privilege and DSM login restrictions.",
        ),
        (
            407,
            "This client IP is blocked by the NAS. Review DSM security settings before retrying.",
        ),
        (
            408,
            "The password has expired and this account cannot change it. Ask a DSM administrator to reset it.",
        ),
        (
            409,
            "The NAS password has expired. Change it in DSM, then reconnect.",
        ),
        (
            410,
            "DSM requires a password change. Complete it in your browser, then reconnect.",
        ),
    ] {
        let dsm = Dsm::start(
            vec![Login::Refuse(code)],
            AuthType::Body(ok(json!([{"type":"otp"}]))),
        )
        .await;
        let (service, result) = sign_in(dsm.with_code(), enroll()).await;
        let error = result.unwrap_err();
        assert!(
            matches!(error.kind, SynologyErrorKind::AuthenticationError),
            "{code}"
        );
        assert_eq!(error.message, message);
        let facts = diagnostic(&error);
        assert_eq!(facts["stage"], "api_login", "{code}");
        assert_eq!(facts["category"], "dsm_api");
        assert_eq!(facts["dsmCode"], code);
        assert!(!service.is_connected());
        assert_eq!(dsm.logins().len(), 1);
        assert_eq!(dsm.method_lookups(), 0);
        assert!(dsm.calls(FILE_STATION_INFO, "get").is_empty());
        assert!(dsm.calls(AUTH, "logout").is_empty());
    }
}

// ── 10. Secrets ─────────────────────────────────────────────────────

#[tokio::test]
async fn secrets_never_reach_errors_diagnostics_or_debug_output() {
    // Enroll success: the wire carries the issued id for the vault; Debug never.
    let dsm = Dsm::start(vec![Login::Accept(json!({"did":DID}))], AuthType::Absent).await;
    let (service, result) = sign_in(dsm.with_code(), enroll()).await;
    let login = result.unwrap();
    assert!(wire(&login).to_string().contains(DID));
    assert_secret_free("enrolled result Debug", &format!("{login:?}"));
    assert_secret_free("client Debug", &format!("{:?}", service.client));

    // Challenges after a saved device was sent.
    for code in [403, 404, 406, 449] {
        let dsm = Dsm::start(
            vec![Login::Refuse(code)],
            AuthType::Body(ok(json!([{"type":"otp"}]))),
        )
        .await;
        let (_, result) = sign_in(dsm.with_saved_device(), saved_as(&local_device_name())).await;
        let challenge = result.unwrap();
        assert_secret_free("challenge wire", &wire(&challenge).to_string());
        assert_secret_free("challenge Debug", &format!("{challenge:?}"));
    }

    // Refusals with every secret in DSM's nested error details.
    for code in [400, 401, 402, 407, 408, 409, 410, 599] {
        for saved_device in [false, true] {
            let dsm = Dsm::start(vec![Login::Refuse(code)], AuthType::Absent).await;
            let (config, device_trust) = if saved_device {
                (dsm.with_saved_device(), saved_as(&local_device_name()))
            } else {
                (dsm.with_code(), enroll())
            };
            let (_, result) = sign_in(config, device_trust).await;
            let error = result.unwrap_err();
            assert_secret_free("error Display", &error.to_string());
            assert_secret_free("error Debug", &format!("{error:?}"));
            assert_secret_free("command error", &command_error(error.clone()));
            assert_eq!(diagnostic(&error)["dsmCode"], code);
        }
    }

    // Values that hold the secrets directly.
    let issued = TrustedDevice {
        device_name: local_device_name(),
        device_id: DID.into(),
    };
    let reuse = DeviceLogin::plan(
        saved_as(&local_device_name()).as_ref(),
        Some(SAVED_DID.into()),
        false,
        &local_device_name(),
    );
    assert!(reuse.sent_token());
    let login_result: LoginResult =
        serde_json::from_value(json!({"sid":SID,"synotoken":TOKEN,"did":DID})).unwrap();
    for debug in [
        format!("{issued:?}"),
        format!("{reuse:?}"),
        format!("{:?}", options(saved_as(&local_device_name()))),
        format!("{login_result:?}"),
        format!(
            "{:?}",
            FileStationLogin::Connected {
                session_id: "receipt".into(),
                message: String::new(),
                trusted_device: Some(issued.clone()),
            }
        ),
    ] {
        assert_secret_free("Debug", &debug);
        assert!(debug.contains("<redacted>") || !debug.contains("device_id"));
    }
    assert!(format!("{issued:?}").contains(&local_device_name()));
}

// ── 11. Validation ──────────────────────────────────────────────────

#[tokio::test]
async fn invalid_trusted_device_values_are_refused_before_any_request() {
    let long_name = format!("private-name-{}", "n".repeat(60));
    let wide_name = "😀".repeat(33);
    let long_id = format!("{SAVED_DID}{}", "i".repeat(1024));
    let cases: Vec<(Option<String>, Option<DeviceTrustRequest>)> = vec![
        (None, saved_as(&long_name)),
        (None, saved_as(&wide_name)),
        (None, saved_as("private-name\u{7}")),
        (None, saved_as("")),
        (None, saved_as("   ")),
        (Some(long_id.clone()), saved_as(&local_device_name())),
        (
            Some(format!("{SAVED_DID}\n")),
            saved_as(&local_device_name()),
        ),
        (Some(String::new()), saved_as(&local_device_name())),
        (
            Some(SAVED_DID.into()),
            Some(DeviceTrustRequest {
                enroll: false,
                device_name: None,
            }),
        ),
    ];
    for (device_token, device_trust) in cases {
        let dsm = Dsm::start(vec![], AuthType::Absent).await;
        let label = format!("{device_trust:?}");
        let config = SynologyConfig {
            device_token,
            ..dsm.config()
        };
        let (_, result) = sign_in(config, device_trust).await;
        let error = result.unwrap_err();
        assert!(matches!(error.kind, SynologyErrorKind::AuthenticationError));
        assert_eq!(error.to_string(), INVALID_DEVICE, "{label}");
        assert!(dsm.seen().is_empty(), "{label}: a request was sent");
    }
    // Boundaries are accepted; a token without a request is not checked
    // because it is never sent.
    let widest = "😀".repeat(32);
    assert!(device_trust::check(saved_as(&widest).as_ref(), Some(&"i".repeat(1024))).is_ok());
    assert!(device_trust::check(None, Some("bad\u{7}")).is_ok());
}

#[test]
fn ipc_values_build_a_request_only_when_supplied() {
    assert_eq!(
        device_trust::request_from_ipc(None, None, None).unwrap(),
        None
    );
    assert_eq!(
        device_trust::request_from_ipc(Some(false), None, None).unwrap(),
        None
    );
    assert_eq!(
        device_trust::request_from_ipc(Some(true), None, None).unwrap(),
        enroll()
    );
    assert_eq!(
        device_trust::request_from_ipc(None, Some("name".into()), Some(SAVED_DID)).unwrap(),
        saved_as("name")
    );
    for (name, id) in [
        (None, Some(SAVED_DID)),
        (Some("bad\u{1b}name".to_string()), Some(SAVED_DID)),
        (Some("name".to_string()), Some("")),
    ] {
        let error = device_trust::request_from_ipc(None, name, id).unwrap_err();
        assert_eq!(error.to_string(), INVALID_DEVICE);
    }
}

// ── 12. Cancellation ────────────────────────────────────────────────

#[tokio::test]
async fn cancelling_after_an_enroll_login_logs_out_and_returns_no_device() {
    let dsm = Dsm::start(vec![Login::Accept(json!({"did":DID}))], AuthType::Absent).await;
    let active = Arc::new(AtomicBool::new(true));
    dsm.state(|state| state.cancel_on_login = Some(active.clone()));
    let mut service = SynologyService::new();
    let error = service
        .fs_connect_with_options(
            dsm.with_code(),
            &active,
            NativeHttpRoute::Direct {},
            options(enroll()),
        )
        .await
        .unwrap_err();
    assert!(matches!(error.kind, SynologyErrorKind::SessionExpired));
    assert_secret_free("cancelled error", &command_error(error));
    assert!(!service.is_connected());
    assert_eq!(dsm.calls(AUTH, "logout").len(), 1);
    assert!(dsm.calls(FILE_STATION_INFO, "get").is_empty());
}

// ── Session facts ───────────────────────────────────────────────────

#[tokio::test]
async fn a_new_login_on_an_existing_client_forgets_the_cached_account() {
    let dsm = Dsm::start(vec![], AuthType::Absent).await;
    let (mut service, result) = sign_in(dsm.config(), None).await;
    let FileStationLogin::Connected { session_id, .. } = result.unwrap() else {
        panic!("fixture must connect");
    };
    service
        .section_access_context(&session_id)
        .unwrap()
        .probe("fileStation")
        .await
        .unwrap();
    assert_eq!(dsm.calls("SYNO.Core.Desktop.Initdata", "get").len(), 1);
    let client = service.client.as_mut().unwrap();
    let before = client.account.clone();
    assert!(before.get().is_some(), "the probe cached the account");

    client.config.password = PASSWORD.into();
    let relogin =
        AuthManager::login_file_station(client, &LoginOptions::default(), &AtomicBool::new(true))
            .await;
    assert!(relogin.result.unwrap().is_none());
    assert_eq!(dsm.logins().len(), 2);
    assert!(client.account.get().is_none());
    assert!(!Arc::ptr_eq(&before, &client.account));
    assert!(
        before.get().is_some(),
        "older clones keep their own session"
    );
}

// ── Units ───────────────────────────────────────────────────────────

#[test]
fn device_names_are_prefixed_sanitized_and_bounded() {
    assert_eq!(
        device_name_for(Some("WORKSTATION-7")),
        "SortOfRemoteNG · WORKSTATION-7"
    );
    for empty in [None, Some(""), Some(" \t\n"), Some("\u{200B}\u{7}")] {
        assert_eq!(device_name_for(empty), "SortOfRemoteNG · desktop");
    }
    assert_eq!(
        device_name_for(Some("  my\u{7}\u{200B}  laptop\r\n\u{202E}")),
        "SortOfRemoteNG · my laptop"
    );
    for host in [
        "x".repeat(200),
        "😀".repeat(40),
        format!("a{}", "😀".repeat(40)),
    ] {
        let name = device_name_for(Some(&host));
        assert!(name.encode_utf16().count() <= 64, "{name}");
        assert!(name.encode_utf16().count() >= 63, "{name}");
        assert!(device_trust::valid_device_name(&name));
    }
    let local = local_device_name();
    assert!(local.starts_with("SortOfRemoteNG · "));
    assert!(device_trust::valid_device_name(&local));
    assert_eq!(local, local_device_name(), "stable within a run");
}

#[test]
fn device_sign_in_plans_follow_the_code_the_request_and_the_name() {
    let local = local_device_name();
    let token = || Some(SAVED_DID.to_string());
    let plan = |request: Option<DeviceTrustRequest>, token: Option<String>, code: bool| {
        DeviceLogin::plan(request.as_ref(), token, code, &local)
    };
    assert_eq!(plan(None, token(), false), DeviceLogin::Off);
    assert_eq!(plan(None, token(), true), DeviceLogin::Off);
    assert_eq!(
        plan(enroll(), token(), true),
        DeviceLogin::Enroll {
            device_name: local.clone()
        }
    );
    assert_eq!(plan(enroll(), None, false), DeviceLogin::Off);
    assert_eq!(
        plan(saved_as(&local), token(), false),
        DeviceLogin::Reuse {
            device_name: local.clone(),
            device_id: SAVED_DID.into()
        }
    );
    assert_eq!(plan(saved_as(&local), token(), true), DeviceLogin::Off);
    assert_eq!(plan(saved_as(&local), None, false), DeviceLogin::Off);
    assert_eq!(
        plan(saved_as(OTHER_COMPUTER), token(), false),
        DeviceLogin::Mismatch
    );
    let reuse = plan(saved_as(&local), token(), false);
    assert_eq!(reuse.second_factor(false), SecondFactor::TrustedDevice);
    assert_eq!(
        DeviceLogin::Mismatch.second_factor(false),
        SecondFactor::None
    );
    assert!(DeviceLogin::Mismatch.login_params().is_empty());
}

#[test]
fn auth_method_ipc_values_are_closed() {
    assert_eq!(
        serde_json::to_value([
            AuthMethod::Otp,
            AuthMethod::SecureSigninApproval,
            AuthMethod::SecurityKey
        ])
        .unwrap(),
        json!(["otp", "secure_signin_approval", "security_key"])
    );
}
