//! Loopback DSM fixtures for DSM 7's secure login handshake.
//!
//! The mock NAS is a real Noise IK responder (`snow`) and models DSM's policy
//! for remote sign-ins: a login without a valid `ik_message` gets a limited
//! session in which File Station and `SYNO.DSM.Info` work, but administrator
//! Core APIs return the 38-byte 105 from the user's report. Only ephemeral
//! loopback listeners, synthetic credentials and generated keys are used.
use crate::{
    error::command_error,
    http_route::NativeHttpRoute,
    login_handshake::{
        decode_b64url, first_message, LoginHandshake, LoginOptions, LoginPlan, SecondFactor,
        SessionProfile, SessionRoute, HASH_HEADER, NOISE_PATTERN,
    },
    scoped_files::FileStationLogin,
    service::SynologyService,
    system::SystemManager,
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
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    net::TcpListener,
    task::JoinHandle,
};

const USER: &str = "fixture-admin";
const PASSWORD: &str = "synthetic-private-password";
const OTP: &str = "246810";
const SID: &str = "fixture-private-sid";
const TOKEN: &str = "fixture-private-token";
const AUTH: &str = "SYNO.API.Auth";
const UI_CONFIG: &str = "SYNO.API.Auth.UIConfig";
const UTILIZATION: &str = "SYNO.Core.System.Utilization";
const ALIAS: &str = "fixture-nas";
const RELAY_HOST: &str = "fixture-nas.fr3.quickconnect.to";
const DIRECT_HOST: &str = "fixture-nas.direct.quickconnect.to";
const PROXIED_HOST: &str = "nas.example.test";
/// The reply from the user's report: HTTP 200, JSON, exactly 38 bytes.
const LIMITED_SESSION_105: &str = r#"{"error":{"code":105},"success":false}"#;
const USER_REPORT: &str = concat!(
    "SYNO.Core.System.Utilization: Permission denied (code 105)\n",
    r#"synology-diagnostic:v1:{"stage":"api_response","category":"dsm_api","httpStatus":200,"contentType":"json","bytesRead":38,"dsmCode":105}"#
);

// ── Mock DSM ────────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug, PartialEq)]
enum ServerKey {
    Valid,
    Missing,
    NotBase64,
    WrongLength,
    AllZero,
    HttpError,
    Oversized,
    Slow,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Reply2 {
    Valid,
    Missing,
    NotBase64,
    NotString,
    Undecryptable,
}

#[derive(Clone)]
struct Policy {
    auth_max: u32,
    ui_config: bool,
    server_key: ServerKey,
    reply: Reply2,
    login_errors: VecDeque<i32>,
    portal: Option<Value>,
    delay: Duration,
    relay_reachable: bool,
}

impl Default for Policy {
    fn default() -> Self {
        Self {
            auth_max: 7,
            ui_config: true,
            server_key: ServerKey::Valid,
            reply: Reply2::Valid,
            login_errors: VecDeque::new(),
            portal: None,
            delay: Duration::ZERO,
            relay_reachable: true,
        }
    }
}

#[derive(Clone, Debug)]
struct Seen {
    authority: String,
    target: String,
    api: String,
    method: String,
    version: String,
    fields: HashMap<String, String>,
    hash: Option<String>,
    hash_valid: Option<bool>,
}

impl Seen {
    fn is(&self, api: &str, method: &str) -> bool {
        self.api == api && self.method == method
    }
    fn is_ui_config(&self) -> bool {
        self.target.ends_with("/SYNO.API.Auth.UIConfig")
    }
}

struct Session {
    transport: Option<snow::StatelessTransportState>,
    hash: Vec<u8>,
    last_nonce: Option<u64>,
}

struct State {
    policy: Policy,
    server_private: Vec<u8>,
    server_public: Vec<u8>,
    session: Option<Session>,
    seen: Vec<Seen>,
    ik_messages: Vec<String>,
    replayed_messages: usize,
    initiator_statics: Vec<Vec<u8>>,
    payloads: Vec<Value>,
    replies: Vec<String>,
    handshake_hashes: Vec<Vec<u8>>,
    arrival_nonces: Vec<u64>,
    in_flight: usize,
    max_in_flight: usize,
    in_flight_signed: usize,
    max_in_flight_signed: usize,
    cancel_on_ui_config: Option<Arc<AtomicBool>>,
}

struct Reply {
    status: u16,
    body: Vec<u8>,
    extra: String,
}

impl Reply {
    fn json(value: Value) -> Self {
        Self::raw(&value.to_string())
    }
    fn raw(body: &str) -> Self {
        Self {
            status: 200,
            body: body.as_bytes().to_vec(),
            extra: String::new(),
        }
    }
    fn cookie(mut self, cookie: &str) -> Self {
        self.extra.push_str(&format!("Set-Cookie: {cookie}\r\n"));
        self
    }
}

fn ok(data: Value) -> Reply {
    Reply::json(json!({"success":true,"data":data}))
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

fn noise_builder() -> snow::Builder<'static> {
    snow::Builder::new(NOISE_PATTERN.parse().unwrap())
}

impl State {
    fn respond(&mut self, seen: &mut Seen) -> Reply {
        if seen.is_ui_config() {
            return self.ui_config();
        }
        match (seen.api.as_str(), seen.method.as_str()) {
            ("SYNO.API.Info", "query") => return Reply::json(self.discovery()),
            (AUTH, "login") => return self.login(seen),
            _ => {}
        }
        if seen.fields.get("_sid").map(String::as_str) != Some(SID) {
            return Reply::json(json!({"success":false,"error":{"code":119}}));
        }
        let api = seen.api.clone();
        if seen.hash.is_some() {
            let valid = self.check_hash(seen.hash.as_deref().unwrap_or_default());
            seen.hash_valid = Some(valid);
        }
        if api == AUTH && seen.method == "logout" {
            return ok(json!({}));
        }
        if api.starts_with("SYNO.FileStation.") {
            return ok(json!({"hostname":"fixture"}));
        }
        if api == "SYNO.DSM.Info" {
            return ok(json!({"model":"DS-fixture"}));
        }
        if api.starts_with("SYNO.Core.") {
            let full = self
                .session
                .as_ref()
                .is_some_and(|session| session.transport.is_some());
            return if full && seen.hash_valid == Some(true) {
                ok(
                    json!({"cpu":{"user_load":7.5,"system_load":2.0,"15min_load":0.5},
                    "memory":{"total_real":100,"avail_real":75,"total_swap":20,"avail_swap":20},
                    "network":[],"disk":[]}),
                )
            } else {
                Reply::raw(LIMITED_SESSION_105)
            };
        }
        Reply::json(json!({"success":false,"error":{"code":102}}))
    }

    fn discovery(&self) -> Value {
        let mut apis = serde_json::Map::new();
        let mut add = |name: &str, maximum: u32| {
            apis.insert(
                name.into(),
                json!({"path":"entry.cgi","minVersion":1,"maxVersion":maximum}),
            );
        };
        add(AUTH, self.policy.auth_max);
        if self.policy.ui_config {
            add(UI_CONFIG, 1);
        }
        add("SYNO.FileStation.Info", 2);
        add("SYNO.DSM.Info", 2);
        add(UTILIZATION, 1);
        json!({"success":true,"data":apis})
    }

    fn ui_config(&self) -> Reply {
        let valid = format!(
            "_SSID={}; path=/; HttpOnly",
            URL_SAFE_NO_PAD.encode(&self.server_public)
        );
        let body = json!({"success":true,"data":{"enable_secure_signin":true}});
        match self.policy.server_key {
            ServerKey::Valid | ServerKey::Slow => Reply::json(body).cookie(&valid),
            ServerKey::Missing => Reply::json(body).cookie("unrelated=value; path=/"),
            ServerKey::NotBase64 => Reply::json(body).cookie("_SSID=%%not*base64%%; path=/"),
            ServerKey::WrongLength => Reply::json(body).cookie(&format!(
                "_SSID={}; path=/",
                URL_SAFE_NO_PAD.encode([9_u8; 31])
            )),
            ServerKey::AllZero => Reply::json(body).cookie(&format!(
                "_SSID={}; path=/",
                URL_SAFE_NO_PAD.encode([0_u8; 32])
            )),
            ServerKey::HttpError => Reply {
                status: 500,
                ..Reply::json(body)
            }
            .cookie(&valid),
            ServerKey::Oversized => Reply {
                body: vec![b' '; 64 * 1024 + 1],
                ..Reply::json(body)
            }
            .cookie(&valid),
        }
    }

    fn login(&mut self, seen: &Seen) -> Reply {
        let accepted = seen
            .fields
            .get("ik_message")
            .and_then(|message| self.accept_message_one(message));
        if let Some(code) = self.policy.login_errors.pop_front() {
            self.session = None;
            return Reply::json(json!({"success":false,"error":{"code":code}}));
        }
        let mut data = json!({"sid":SID,"synotoken":TOKEN,"did":"not-enrolled"});
        if let Some(portal) = self.policy.portal.clone() {
            data["is_portal_port"] = portal;
        }
        self.session = Some(match accepted {
            Some((reply, session)) => {
                match self.policy.reply {
                    Reply2::Valid => data["ik_message"] = json!(reply),
                    Reply2::Missing => {}
                    Reply2::NotBase64 => data["ik_message"] = json!("%%not*base64%%"),
                    Reply2::NotString => data["ik_message"] = json!(12345),
                    Reply2::Undecryptable => {
                        data["ik_message"] = json!(URL_SAFE_NO_PAD.encode([7_u8; 48]))
                    }
                }
                session
            }
            // DSM's remote-address policy: no valid handshake, limited session.
            None => Session {
                transport: None,
                hash: Vec::new(),
                last_nonce: None,
            },
        });
        ok(data).cookie(&format!("id={SID}; Path=/; HttpOnly"))
    }

    fn accept_message_one(&mut self, message: &str) -> Option<(String, Session)> {
        if self.ik_messages.iter().any(|seen| seen == message) {
            self.replayed_messages += 1;
            return None;
        }
        self.ik_messages.push(message.to_owned());
        let bytes = decode_b64url(message)?;
        let mut responder = noise_builder()
            .local_private_key(&self.server_private)
            .ok()?
            .build_responder()
            .ok()?;
        let mut payload = vec![0_u8; bytes.len()];
        let length = responder.read_message(&bytes, &mut payload).ok()?;
        let payload: Value = serde_json::from_slice(&payload[..length]).ok()?;
        self.initiator_statics
            .push(responder.get_remote_static()?.to_vec());
        self.payloads.push(payload.clone());
        let time = payload.get("time")?.as_u64()?;
        if now().abs_diff(time) > 300 {
            return None;
        }
        let mut reply = [0_u8; 256];
        let length = responder.write_message(&[], &mut reply).ok()?;
        let hash = responder.get_handshake_hash().to_vec();
        let transport = responder.into_stateless_transport_mode().ok()?;
        let reply = URL_SAFE_NO_PAD.encode(&reply[..length]);
        self.replies.push(reply.clone());
        self.handshake_hashes.push(hash.clone());
        Some((
            reply,
            Session {
                transport: Some(transport),
                hash,
                last_nonce: None,
            },
        ))
    }

    /// Verifies `X-SYNO-HASH` with the responder's receive cipher and requires
    /// strictly increasing nonces.
    fn check_hash(&mut self, header: &str) -> bool {
        let Some(session) = self.session.as_mut() else {
            return false;
        };
        let Some(transport) = session.transport.as_ref() else {
            return false;
        };
        let expected = URL_SAFE_NO_PAD.encode(&session.hash);
        let Some((prefix, rest)) = header.split_at_checked(8) else {
            return false;
        };
        let (Some(tag), Some(nonce)) = (
            rest.split_once('.').and_then(|(tag, _)| decode_b64url(tag)),
            header_nonce(header),
        ) else {
            return false;
        };
        if prefix != &expected[..8]
            || tag.len() != 16
            || session.last_nonce.is_some_and(|last| nonce <= last)
        {
            return false;
        }
        let mut plain = [0_u8; 32];
        if !matches!(transport.read_message(nonce, &tag, &mut plain), Ok(0)) {
            return false;
        }
        session.last_nonce = Some(nonce);
        true
    }
}

fn header_nonce(header: &str) -> Option<u64> {
    let (_, nonce) = header.get(8..)?.split_once('.')?;
    let text = String::from_utf8(decode_b64url(nonce)?).ok()?;
    text.bytes()
        .all(|byte| byte.is_ascii_digit())
        .then(|| text.parse().ok())?
}

fn quickconnect_info() -> Value {
    json!([{"errno":0,
        "server":{"serverID":"canonical-fixture-id","interface":[],"external":{"ip":"192.0.2.1"}},
        "service":{"port":5001,"ext_port":5001},
        "env":{"control_host":"dec.quickconnect.to","relay_region":"fr3"},
        "smartdns":{"host":DIRECT_HOST}}])
}

fn find_header<'a>(head: &'a str, name: &str) -> Option<&'a str> {
    head.lines().skip(1).find_map(|line| {
        let (key, value) = line.split_once(':')?;
        key.trim().eq_ignore_ascii_case(name).then(|| value.trim())
    })
}

async fn read_request<S: AsyncRead + Unpin>(stream: &mut S) -> Option<(String, Vec<u8>)> {
    let mut head = Vec::new();
    while !head.ends_with(b"\r\n\r\n") {
        if head.len() >= 32 * 1024 {
            return None;
        }
        head.push(stream.read_u8().await.ok()?);
    }
    let head = String::from_utf8(head).ok()?;
    let length = find_header(&head, "content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    if length > 256 * 1024 {
        return None;
    }
    let mut body = vec![0_u8; length];
    stream.read_exact(&mut body).await.ok()?;
    Some((head, body))
}

struct Server {
    port: u16,
    worker: JoinHandle<()>,
}

impl Drop for Server {
    fn drop(&mut self) {
        self.worker.abort();
    }
}

struct Proxy {
    route: NativeHttpRoute,
    worker: JoinHandle<()>,
}

impl Drop for Proxy {
    fn drop(&mut self) {
        self.worker.abort();
    }
}

#[derive(Clone)]
struct Dsm(Arc<Mutex<State>>);

impl Dsm {
    fn new(policy: Policy) -> Self {
        let server = noise_builder().generate_keypair().unwrap();
        Self(Arc::new(Mutex::new(State {
            policy,
            server_private: server.private,
            server_public: server.public,
            session: None,
            seen: Vec::new(),
            ik_messages: Vec::new(),
            replayed_messages: 0,
            initiator_statics: Vec::new(),
            payloads: Vec::new(),
            replies: Vec::new(),
            handshake_hashes: Vec::new(),
            arrival_nonces: Vec::new(),
            in_flight: 0,
            max_in_flight: 0,
            in_flight_signed: 0,
            max_in_flight_signed: 0,
            cancel_on_ui_config: None,
        })))
    }

    fn state<R>(&self, read: impl FnOnce(&mut State) -> R) -> R {
        read(&mut self.0.lock().unwrap())
    }

    fn seen(&self) -> Vec<Seen> {
        self.state(|state| state.seen.clone())
    }

    fn requests(&self, api: &str, method: &str) -> Vec<Seen> {
        self.seen()
            .into_iter()
            .filter(|seen| seen.is(api, method))
            .collect()
    }

    fn ui_config_requests(&self) -> Vec<Seen> {
        self.seen().into_iter().filter(Seen::is_ui_config).collect()
    }

    async fn serve(&self) -> Server {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let dsm = self.clone();
        let worker = tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                let dsm = dsm.clone();
                tokio::spawn(async move { dsm.exchange(&mut stream, None).await });
            }
        });
        Server { port, worker }
    }

    /// CONNECT proxy with verified TLS for synthetic QuickConnect and proxied
    /// NAS names (no public DNS, upstreams or TLS bypass).
    async fn serve_proxy(&self) -> Proxy {
        let certificate = rcgen::generate_simple_self_signed(vec![
            "global.quickconnect.to".into(),
            RELAY_HOST.into(),
            DIRECT_HOST.into(),
            PROXIED_HOST.into(),
        ])
        .unwrap();
        let certificate_der = certificate.serialize_der().unwrap();
        let config = rustls::ServerConfig::builder_with_provider(Arc::new(
            rustls::crypto::aws_lc_rs::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(
            vec![rustls::pki_types::CertificateDer::from(
                certificate_der.clone(),
            )],
            rustls::pki_types::PrivateKeyDer::Pkcs8(certificate.serialize_private_key_der().into()),
        )
        .unwrap();
        let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(config));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let proxy = format!("http://{}", listener.local_addr().unwrap());
        let dsm = self.clone();
        let worker = tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                let (acceptor, dsm) = (acceptor.clone(), dsm.clone());
                tokio::spawn(async move {
                    let Some((connect, _)) = read_request(&mut socket).await else {
                        return;
                    };
                    let Some(authority) = connect
                        .strip_prefix("CONNECT ")
                        .and_then(|line| line.split_whitespace().next())
                        .map(str::to_owned)
                    else {
                        return;
                    };
                    if socket
                        .write_all(b"HTTP/1.1 200 Connection established\r\n\r\n")
                        .await
                        .is_err()
                    {
                        return;
                    }
                    if let Ok(mut tls) = acceptor.accept(socket).await {
                        dsm.exchange(&mut tls, Some(authority)).await;
                    }
                });
            }
        });
        Proxy {
            route: NativeHttpRoute::Fixture {
                proxy,
                certificate: certificate_der,
            },
            worker,
        }
    }

    async fn exchange<S: AsyncRead + AsyncWrite + Unpin>(
        &self,
        stream: &mut S,
        authority: Option<String>,
    ) {
        let Some((head, body)) = read_request(stream).await else {
            return;
        };
        let authority = authority
            .or_else(|| find_header(&head, "host").map(str::to_owned))
            .unwrap_or_default();
        let reply = self.handle(&authority, &head, &body).await;
        let response = format!(
            "HTTP/1.1 {} Fixture\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{}Connection: close\r\n\r\n",
            reply.status,
            reply.body.len(),
            reply.extra
        );
        let _ = stream.write_all(response.as_bytes()).await;
        let _ = stream.write_all(&reply.body).await;
        let _ = stream.shutdown().await;
    }

    async fn handle(&self, authority: &str, head: &str, body: &[u8]) -> Reply {
        let target = head
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .unwrap_or_default()
            .to_owned();
        if authority.starts_with("global.quickconnect.to") {
            return Reply::json(quickconnect_info());
        }
        if target.starts_with(sorng_quickconnect::PROBE_PATH) {
            if authority.starts_with(RELAY_HOST)
                && !self.state(|state| state.policy.relay_reachable)
            {
                return Reply {
                    status: 503,
                    ..Reply::raw("{}")
                };
            }
            return Reply::json(
                json!({"ezid":sorng_quickconnect::alias_digest("canonical-fixture-id")}),
            );
        }
        let fields: HashMap<String, String> =
            url::form_urlencoded::parse(body).into_owned().collect();
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
        let mut seen = Seen {
            authority: authority.to_owned(),
            api: pick("api"),
            method: pick("method"),
            version: pick("version"),
            target,
            fields: fields.clone(),
            hash: find_header(head, HASH_HEADER).map(str::to_owned),
            hash_valid: None,
        };
        let (delay, cancel) = self.state(|state| {
            state.in_flight += 1;
            state.max_in_flight = state.max_in_flight.max(state.in_flight);
            if let Some(hash) = &seen.hash {
                state.in_flight_signed += 1;
                state.max_in_flight_signed = state.max_in_flight_signed.max(state.in_flight_signed);
                if let Some(nonce) = header_nonce(hash) {
                    state.arrival_nonces.push(nonce);
                }
            }
            let delay = if seen.is_ui_config() && state.policy.server_key == ServerKey::Slow {
                Duration::from_secs(6)
            } else {
                state.policy.delay
            };
            (
                delay,
                seen.is_ui_config()
                    .then(|| state.cancel_on_ui_config.clone())
                    .flatten(),
            )
        });
        if let Some(active) = cancel {
            active.store(false, Ordering::Release);
            tokio::time::sleep(Duration::from_secs(3)).await;
        }
        if !delay.is_zero() {
            tokio::time::sleep(delay).await;
        }
        self.state(|state| {
            state.in_flight -= 1;
            if seen.hash.is_some() {
                state.in_flight_signed -= 1;
            }
            let reply = state.respond(&mut seen);
            state.seen.push(seen);
            reply
        })
    }
}

// ── Helpers ─────────────────────────────────────────────────────────

fn config(port: u16) -> SynologyConfig {
    SynologyConfig {
        host: "127.0.0.1".into(),
        port,
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

fn tls_config(host: &str, port: u16) -> SynologyConfig {
    SynologyConfig {
        host: host.into(),
        port,
        use_https: true,
        ..config(port)
    }
}

fn legacy_client() -> LoginOptions {
    LoginOptions {
        force_legacy: true,
        ..LoginOptions::default()
    }
}

async fn sign_in(
    service: &mut SynologyService,
    config: SynologyConfig,
    route: NativeHttpRoute,
    options: LoginOptions,
) -> FileStationLogin {
    service
        .fs_connect_with_options(config, &AtomicBool::new(true), route, options)
        .await
        .unwrap()
}

async fn connected(dsm: &Dsm, server: &Server, options: LoginOptions) -> SynologyService {
    let mut service = SynologyService::new();
    let login = sign_in(
        &mut service,
        config(server.port),
        NativeHttpRoute::Direct {},
        options,
    )
    .await;
    assert!(
        matches!(login, FileStationLogin::Connected { .. }),
        "expected a connected receipt, got {login:?}; requests: {:?}",
        dsm.seen()
            .iter()
            .map(|seen| (&seen.api, &seen.method))
            .collect::<Vec<_>>()
    );
    service
}

fn identity(service: &SynologyService) -> crate::login_handshake::SessionIdentity {
    service.client.as_ref().unwrap().session_identity().clone()
}

fn assert_header_layout(header: &str) {
    let (prefix, rest) = header.split_at(8);
    let (tag, nonce) = rest.split_once('.').unwrap();
    assert!(prefix
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte)));
    assert_eq!(tag.len(), 22, "base64url of a 16-byte tag, unpadded");
    assert!(
        decode_b64url(nonce)
            .is_some_and(|text| !text.is_empty() && text.iter().all(u8::is_ascii_digit)),
        "nonce is base64url decimal text"
    );
    assert!(!header.contains('=') && !header.contains('+') && !header.contains('/'));
}

// ── 1. Handshake ────────────────────────────────────────────────────

#[tokio::test]
async fn handshake_signs_in_with_auth_v7_ik_message_and_records_secure_identity() {
    let dsm = Dsm::new(Policy::default());
    let server = dsm.serve().await;
    let service = connected(&dsm, &server, LoginOptions::default()).await;
    let seen = dsm.seen();
    let order: Vec<_> = seen
        .iter()
        .map(|seen| {
            if seen.is_ui_config() {
                "ui_config".to_string()
            } else {
                format!("{}.{}", seen.api, seen.method)
            }
        })
        .collect();
    assert_eq!(
        order,
        [
            "SYNO.API.Info.query",
            "ui_config",
            "SYNO.API.Auth.login",
            "SYNO.FileStation.Info.get"
        ]
    );
    let ui_config = &seen[1];
    assert_eq!(ui_config.target, "/webapi/entry.cgi/SYNO.API.Auth.UIConfig");
    assert_eq!(
        ui_config.fields,
        HashMap::from([
            ("api".to_string(), UI_CONFIG.to_string()),
            ("method".to_string(), "get".to_string()),
            ("version".to_string(), "1".to_string()),
        ]),
        "the server-key request carries no credentials or session"
    );
    let login = &seen[2];
    assert_eq!(login.version, "7");
    for (name, value) in [
        ("account", USER),
        ("passwd", PASSWORD),
        ("session", "FileStation"),
        ("format", "cookie"),
        ("enable_syno_token", "yes"),
    ] {
        assert_eq!(login.fields[name], value);
    }
    assert!(!login.fields.contains_key("otp_code"));
    let message = &login.fields["ik_message"];
    assert!(message
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte)));
    dsm.state(|state| {
        assert_eq!(state.payloads.len(), 1);
        let payload = state.payloads[0].as_object().unwrap();
        assert_eq!(payload.len(), 1, "payload is exactly {{\"time\":…}}");
        assert!(now().abs_diff(payload["time"].as_u64().unwrap()) <= 300);
        assert_eq!(state.replies.len(), 1);
    });
    let identity = identity(&service);
    assert_eq!(identity.login_handshake, LoginHandshake::Ik);
    assert_eq!(identity.auth_version, 7);
    assert_eq!(
        serde_json::to_value(&identity).unwrap(),
        json!({"signedInAs":USER,"sessionName":"FileStation","loginHandshake":"ik","authVersion":7,
            "route":"direct","secondFactor":"none","portalSession":false})
    );
}

// ── 2. Root-cause simulation ────────────────────────────────────────

#[tokio::test]
async fn limited_remote_session_reproduces_the_reported_105_and_the_handshake_gets_data() {
    assert_eq!(LIMITED_SESSION_105.len(), 38);
    let dsm = Dsm::new(Policy::default());
    let server = dsm.serve().await;

    // The client as it was before this fix: Auth v6 login without ik_message.
    let before = connected(&dsm, &server, legacy_client()).await;
    let login = dsm.requests(AUTH, "login").pop().unwrap();
    assert_eq!(login.version, "6");
    assert!(!login.fields.contains_key("ik_message"));
    assert!(dsm.ui_config_requests().is_empty());
    let client = before.client.as_ref().unwrap();
    assert_eq!(
        client
            .post_value("SYNO.DSM.Info", 2, "getinfo", &[])
            .await
            .unwrap()["model"],
        "DS-fixture"
    );
    client
        .file_call("SYNO.FileStation.Info", 2, "get", &[])
        .await
        .unwrap();
    let error = SystemManager::get_utilization(client).await.unwrap_err();
    assert_eq!(command_error(error), USER_REPORT);
    let error = before.get_utilization().await.unwrap_err();
    assert_eq!(error.to_string(), USER_REPORT);
    assert_eq!(identity(&before).login_handshake, LoginHandshake::Legacy);

    // The fixed client on the same NAS policy gets the data.
    let after = connected(&dsm, &server, LoginOptions::default()).await;
    let usage = after.get_utilization().await.unwrap();
    assert_eq!(usage.cpu.user_load, 7.5);
    assert_eq!(usage.memory.avail_real, 75);
    assert_eq!(identity(&after).login_handshake, LoginHandshake::Ik);
}

// ── 3. X-SYNO-HASH ──────────────────────────────────────────────────

#[test]
fn request_hash_header_matches_the_documented_layout() {
    let server = noise_builder().generate_keypair().unwrap();
    let key: [u8; 32] = server.public.clone().try_into().unwrap();
    let (message, state) = first_message(&key, 1_726_400_000).unwrap();
    let mut responder = noise_builder()
        .local_private_key(&server.private)
        .unwrap()
        .build_responder()
        .unwrap();
    let mut payload = [0_u8; 256];
    let length = responder
        .read_message(&decode_b64url(&message).unwrap(), &mut payload)
        .unwrap();
    assert_eq!(&payload[..length], br#"{"time":1726400000}"#);
    let mut reply = [0_u8; 256];
    let length = responder.write_message(&[], &mut reply).unwrap();
    let hash = responder.get_handshake_hash().to_vec();
    let transport = responder.into_stateless_transport_mode().unwrap();
    let plan = LoginPlan::Ik {
        ik_message: message,
        state: Box::new(state),
    };
    assert_eq!(format!("{plan:?}"), "Ik { .. }");
    let (handshake, signer) = plan.finish(Some(&URL_SAFE_NO_PAD.encode(&reply[..length])));
    assert_eq!(handshake, LoginHandshake::Ik);
    let signer = signer.unwrap();
    let mut signer = signer.try_lock().unwrap();
    for nonce in 0..3_u64 {
        let header = signer.next_header().unwrap();
        assert_header_layout(&header);
        assert_eq!(&header[..8], &URL_SAFE_NO_PAD.encode(&hash)[..8]);
        let (tag, encoded) = header[8..].split_once('.').unwrap();
        assert_eq!(encoded, URL_SAFE_NO_PAD.encode(nonce.to_string()));
        let mut plain = [0_u8; 16];
        assert_eq!(
            transport
                .read_message(nonce, &decode_b64url(tag).unwrap(), &mut plain)
                .unwrap(),
            0
        );
    }
    // Nonce 0 encodes as "MA", as in the reference implementation's test.
    assert_eq!(URL_SAFE_NO_PAD.encode("0"), "MA");
}

#[test]
fn base64url_decoding_accepts_dsm_cookie_forms_only() {
    assert_eq!(decode_b64url("-_8").unwrap(), [0xfb, 0xff]);
    assert_eq!(decode_b64url("+/8=").unwrap(), [0xfb, 0xff]);
    assert_eq!(decode_b64url("AQI").unwrap(), [1, 2]);
    for invalid in ["", "%%", "A", &"A".repeat(90_001)] {
        assert!(decode_b64url(invalid).is_none(), "{invalid:.8}");
    }
}

#[tokio::test]
async fn signed_core_requests_carry_a_verifiable_hash_and_file_station_stays_unsigned() {
    let dsm = Dsm::new(Policy::default());
    let server = dsm.serve().await;
    let service = connected(&dsm, &server, LoginOptions::default()).await;
    for _ in 0..3 {
        service.get_utilization().await.unwrap();
    }
    assert!(service.check_session().await.unwrap());
    let seen = dsm.seen();
    let core: Vec<_> = seen.iter().filter(|seen| seen.api == UTILIZATION).collect();
    assert_eq!(core.len(), 3);
    let hash = dsm.state(|state| state.handshake_hashes[0].clone());
    let mut nonces = Vec::new();
    for request in &core {
        let header = request.hash.as_deref().expect("Core request is signed");
        assert_header_layout(header);
        assert_eq!(&header[..8], &URL_SAFE_NO_PAD.encode(&hash)[..8]);
        assert_eq!(request.hash_valid, Some(true));
        nonces.push(header_nonce(header).unwrap());
    }
    assert!(
        nonces.windows(2).all(|pair| pair[0] < pair[1]),
        "{nonces:?}"
    );
    let file_station: Vec<_> = seen
        .iter()
        .filter(|seen| seen.api.starts_with("SYNO.FileStation."))
        .collect();
    assert_eq!(file_station.len(), 2);
    assert!(file_station.iter().all(|seen| seen.hash.is_none()));
    assert!(seen
        .iter()
        .filter(|seen| seen.is(AUTH, "login") || seen.is_ui_config())
        .all(|seen| seen.hash.is_none()));
}

#[tokio::test]
async fn concurrent_core_calls_are_serialized_in_nonce_order_while_file_station_is_not() {
    let dsm = Dsm::new(Policy::default());
    let server = dsm.serve().await;
    let service = connected(&dsm, &server, LoginOptions::default()).await;
    dsm.state(|state| {
        state.policy.delay = Duration::from_millis(60);
        state.max_in_flight = 0;
        state.max_in_flight_signed = 0;
        state.arrival_nonces.clear();
    });
    let client = service.client.as_ref().unwrap();
    let shared = client.clone();
    let core = (0..5).map(|index| {
        let client = if index % 2 == 0 { client } else { &shared };
        SystemManager::get_utilization(client)
    });
    let files = (0..3).map(|_| client.file_call("SYNO.FileStation.Info", 2, "get", &[]));
    let (core, files) = tokio::join!(
        futures::future::join_all(core),
        futures::future::join_all(files)
    );
    assert!(core.iter().all(Result::is_ok), "{core:?}");
    assert!(files.iter().all(Result::is_ok));
    dsm.state(|state| {
        let first = state.arrival_nonces[0];
        assert_eq!(
            state.arrival_nonces,
            (first..first + 5).collect::<Vec<_>>(),
            "signed requests reach DSM in nonce order"
        );
        assert_eq!(
            state.max_in_flight_signed, 1,
            "one signed request at a time"
        );
        assert!(
            state.max_in_flight >= 2,
            "File Station requests are not serialized"
        );
    });
    assert!(dsm
        .seen()
        .iter()
        .filter(|seen| seen.api == UTILIZATION)
        .all(|seen| seen.hash_valid == Some(true)));
}

#[tokio::test]
async fn an_invalid_or_replayed_hash_is_refused_by_the_simulation() {
    let dsm = Dsm::new(Policy::default());
    let server = dsm.serve().await;
    let service = connected(&dsm, &server, LoginOptions::default()).await;
    service.get_utilization().await.unwrap();
    let client = service.client.as_ref().unwrap();
    let used = dsm.requests(UTILIZATION, "get")[0].hash.clone().unwrap();

    let replay = client
        .form_request(UTILIZATION, 1, "get", &[])
        .unwrap()
        .header(HASH_HEADER, &used)
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert_eq!(replay, LIMITED_SESSION_105);
    let unsigned = client
        .form_request(UTILIZATION, 1, "get", &[])
        .unwrap()
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert_eq!(unsigned, LIMITED_SESSION_105);
    service.get_utilization().await.unwrap();

    client
        .request_signer
        .as_ref()
        .unwrap()
        .lock()
        .await
        .corrupt_hash_prefix_for_test();
    let error = service.get_utilization().await.unwrap_err();
    assert!(command_error(error).contains("(code 105)"));
    let verdicts: Vec<_> = dsm
        .requests(UTILIZATION, "get")
        .iter()
        .map(|seen| seen.hash_valid)
        .collect();
    assert_eq!(
        verdicts,
        [Some(true), Some(false), None, Some(true), Some(false)]
    );
}

// ── 4. Fallbacks ────────────────────────────────────────────────────

#[tokio::test]
async fn nas_without_the_handshake_uses_the_documented_v6_login() {
    for policy in [
        Policy {
            ui_config: false,
            ..Policy::default()
        },
        Policy {
            auth_max: 6,
            ..Policy::default()
        },
    ] {
        let dsm = Dsm::new(policy);
        let server = dsm.serve().await;
        let service = connected(&dsm, &server, LoginOptions::default()).await;
        assert!(dsm.ui_config_requests().is_empty());
        let login = &dsm.requests(AUTH, "login")[0];
        assert_eq!(login.version, "6");
        assert!(!login.fields.contains_key("ik_message"));
        let identity = identity(&service);
        assert_eq!(identity.login_handshake, LoginHandshake::Legacy);
        assert_eq!(identity.auth_version, 6);
        assert!(service.client.as_ref().unwrap().request_signer.is_none());
        let _ = service.get_utilization().await;
        assert!(dsm.seen().iter().all(|seen| seen.hash.is_none()));
    }
}

#[tokio::test]
async fn unusable_server_keys_fall_back_to_v6_without_failing_login() {
    for server_key in [
        ServerKey::Missing,
        ServerKey::NotBase64,
        ServerKey::WrongLength,
        ServerKey::AllZero,
        ServerKey::HttpError,
        ServerKey::Oversized,
    ] {
        let dsm = Dsm::new(Policy {
            server_key,
            ..Policy::default()
        });
        let server = dsm.serve().await;
        let service = connected(&dsm, &server, LoginOptions::default()).await;
        assert_eq!(dsm.ui_config_requests().len(), 1, "{server_key:?}");
        let login = &dsm.requests(AUTH, "login")[0];
        assert_eq!(login.version, "6", "{server_key:?}");
        assert!(!login.fields.contains_key("ik_message"));
        let identity = identity(&service);
        assert_eq!(
            identity.login_handshake,
            LoginHandshake::LegacyUnavailable,
            "{server_key:?}"
        );
        assert_eq!(identity.auth_version, 6);
        let _ = service.get_utilization().await;
        assert!(dsm.seen().iter().all(|seen| seen.hash.is_none()));
    }
}

#[tokio::test]
async fn slow_server_key_request_is_bounded_and_falls_back() {
    let dsm = Dsm::new(Policy {
        server_key: ServerKey::Slow,
        ..Policy::default()
    });
    let server = dsm.serve().await;
    let started = std::time::Instant::now();
    let service = connected(&dsm, &server, LoginOptions::default()).await;
    assert!(started.elapsed() < Duration::from_secs(6));
    assert_eq!(
        identity(&service).login_handshake,
        LoginHandshake::LegacyUnavailable
    );
    assert!(!dsm.requests(AUTH, "login")[0]
        .fields
        .contains_key("ik_message"));
}

#[tokio::test]
async fn missing_or_unreadable_login_replies_keep_an_unsigned_session() {
    for reply in [
        Reply2::Missing,
        Reply2::NotBase64,
        Reply2::NotString,
        Reply2::Undecryptable,
    ] {
        let dsm = Dsm::new(Policy {
            reply,
            ..Policy::default()
        });
        let server = dsm.serve().await;
        let service = connected(&dsm, &server, LoginOptions::default()).await;
        let login = &dsm.requests(AUTH, "login")[0];
        assert_eq!(login.version, "7", "{reply:?}");
        assert!(login.fields.contains_key("ik_message"));
        let identity = identity(&service);
        assert_eq!(
            identity.login_handshake,
            LoginHandshake::IkIncomplete,
            "{reply:?}"
        );
        assert_eq!(identity.auth_version, 7);
        assert!(service.client.as_ref().unwrap().request_signer.is_none());
        let _ = service.get_utilization().await;
        assert!(
            dsm.seen().iter().all(|seen| seen.hash.is_none()),
            "{reply:?}"
        );
    }
}

#[tokio::test]
async fn cancellation_while_fetching_the_server_key_sends_no_credentials() {
    let dsm = Dsm::new(Policy::default());
    let server = dsm.serve().await;
    let active = Arc::new(AtomicBool::new(true));
    dsm.state(|state| state.cancel_on_ui_config = Some(active.clone()));
    let mut service = SynologyService::new();
    let started = std::time::Instant::now();
    let error = service
        .fs_connect_with_options(
            config(server.port),
            &active,
            NativeHttpRoute::Direct {},
            LoginOptions::default(),
        )
        .await
        .unwrap_err();
    assert!(error.message.contains("cancelled"));
    // The NAS holds the server-key reply for 3 s; cancellation must not wait.
    assert!(started.elapsed() < Duration::from_secs(2));
    assert!(dsm.requests(AUTH, "login").is_empty());
    assert!(dsm
        .seen()
        .iter()
        .all(|seen| !seen.fields.values().any(|value| value.contains(PASSWORD))));
    assert!(service.client.is_none());
}

// ── 5. One-time-code interplay ──────────────────────────────────────

#[tokio::test]
async fn each_one_time_code_attempt_performs_a_fresh_handshake() {
    let dsm = Dsm::new(Policy {
        login_errors: VecDeque::from([403]),
        ..Policy::default()
    });
    let server = dsm.serve().await;
    let mut service = SynologyService::new();
    let challenge = sign_in(
        &mut service,
        config(server.port),
        NativeHttpRoute::Direct {},
        LoginOptions::default(),
    )
    .await;
    assert!(matches!(challenge, FileStationLogin::OtpRequired { .. }));
    assert_eq!(dsm.requests(AUTH, "login").len(), 1, "no automatic retry");
    let mut retry = config(server.port);
    retry.otp_code = Some(OTP.into());
    let login = sign_in(
        &mut service,
        retry,
        NativeHttpRoute::Direct {},
        LoginOptions::default(),
    )
    .await;
    assert!(matches!(login, FileStationLogin::Connected { .. }));

    let seen = dsm.seen();
    let order: Vec<_> = seen
        .iter()
        .filter(|seen| seen.is_ui_config() || seen.is(AUTH, "login"))
        .map(|seen| {
            if seen.is_ui_config() {
                "ui_config"
            } else {
                "login"
            }
        })
        .collect();
    assert_eq!(order, ["ui_config", "login", "ui_config", "login"]);
    let logins = dsm.requests(AUTH, "login");
    assert!(!logins[0].fields.contains_key("otp_code"));
    assert_eq!(logins[1].fields["otp_code"], OTP);
    assert_ne!(
        logins[0].fields["ik_message"], logins[1].fields["ik_message"],
        "message 1 is never replayed"
    );
    dsm.state(|state| {
        assert_eq!(state.replayed_messages, 0);
        assert_eq!(state.initiator_statics.len(), 2);
        assert_ne!(
            state.initiator_statics[0], state.initiator_statics[1],
            "a new static key pair per attempt"
        );
    });
    let identity = identity(&service);
    assert_eq!(identity.login_handshake, LoginHandshake::Ik);
    assert_eq!(identity.second_factor, SecondFactor::Otp);
    service.get_utilization().await.unwrap();
}

// ── 6. QuickConnect and proxy routes ────────────────────────────────

async fn quickconnect_sign_in(policy: Policy) -> (Dsm, Proxy, SynologyService) {
    let dsm = Dsm::new(policy);
    let proxy = dsm.serve_proxy().await;
    let mut service = SynologyService::new();
    let login = sign_in(
        &mut service,
        tls_config(&format!("{ALIAS}.quickconnect.to"), 443),
        proxy.route.clone(),
        LoginOptions::default(),
    )
    .await;
    assert!(matches!(login, FileStationLogin::Connected { .. }));
    (dsm, proxy, service)
}

fn assert_whole_handshake_at(dsm: &Dsm, origin: &str) {
    let seen = dsm.seen();
    let handshake: Vec<_> = seen
        .iter()
        .filter(|seen| seen.is_ui_config() || seen.is(AUTH, "login") || seen.api == UTILIZATION)
        .collect();
    assert_eq!(handshake.len(), 3);
    assert!(
        handshake.iter().all(|seen| seen.authority == origin),
        "{:?}",
        handshake
            .iter()
            .map(|seen| &seen.authority)
            .collect::<Vec<_>>()
    );
    assert_eq!(
        handshake
            .iter()
            .find(|seen| seen.api == UTILIZATION)
            .unwrap()
            .hash_valid,
        Some(true)
    );
    assert!(seen
        .iter()
        .filter(|seen| seen.target.starts_with("/webapi/"))
        .all(|seen| seen.authority == origin));
}

#[tokio::test]
async fn quickconnect_relay_winner_records_route_and_carries_the_whole_handshake() {
    let (dsm, _proxy, service) = quickconnect_sign_in(Policy::default()).await;
    service.get_utilization().await.unwrap();
    let identity = identity(&service);
    assert_eq!(identity.route, SessionRoute::QuickconnectRelay);
    assert_eq!(identity.login_handshake, LoginHandshake::Ik);
    assert_whole_handshake_at(&dsm, &format!("{RELAY_HOST}:443"));
    assert_eq!(
        serde_json::to_value(identity).unwrap()["route"],
        "quickconnect_relay"
    );
}

#[tokio::test]
async fn quickconnect_smart_dns_winner_records_direct_route() {
    let (dsm, _proxy, service) = quickconnect_sign_in(Policy {
        relay_reachable: false,
        ..Policy::default()
    })
    .await;
    service.get_utilization().await.unwrap();
    let identity = identity(&service);
    assert_eq!(identity.route, SessionRoute::QuickconnectDirect);
    assert_eq!(identity.login_handshake, LoginHandshake::Ik);
    assert_whole_handshake_at(&dsm, &format!("{DIRECT_HOST}:5001"));
    assert_eq!(
        serde_json::to_value(identity).unwrap()["route"],
        "quickconnect_direct"
    );
}

#[tokio::test]
async fn explicit_proxy_route_is_recorded_as_http_proxy() {
    let dsm = Dsm::new(Policy::default());
    let proxy = dsm.serve_proxy().await;
    let mut service = SynologyService::new();
    let login = sign_in(
        &mut service,
        tls_config(PROXIED_HOST, 5001),
        proxy.route.clone(),
        LoginOptions::default(),
    )
    .await;
    assert!(matches!(login, FileStationLogin::Connected { .. }));
    service.get_utilization().await.unwrap();
    assert_eq!(identity(&service).route, SessionRoute::HttpProxy);
    assert_whole_handshake_at(&dsm, &format!("{PROXIED_HOST}:5001"));
}

// ── 7. Session profile ──────────────────────────────────────────────

#[tokio::test]
async fn session_profile_selects_the_login_and_logout_session_name() {
    for (profile, name) in [
        (SessionProfile::FileStation, "FileStation"),
        (SessionProfile::DsmDesktop, "webui"),
    ] {
        let dsm = Dsm::new(Policy::default());
        let server = dsm.serve().await;
        let mut service = connected(
            &dsm,
            &server,
            LoginOptions::default().with_session_profile(profile),
        )
        .await;
        assert_eq!(dsm.requests(AUTH, "login")[0].fields["session"], name);
        assert_eq!(identity(&service).session_name, name);
        service.disconnect().await.unwrap();
        let logout = dsm.requests(AUTH, "logout");
        assert_eq!(logout.len(), 1);
        assert_eq!(logout[0].fields["session"], name);
        assert_eq!(logout[0].hash_valid, Some(true));
    }
    assert_eq!(
        LoginOptions::default().session_profile,
        SessionProfile::FileStation
    );
}

#[test]
fn session_profile_ipc_values_are_closed() {
    assert_eq!(
        serde_json::from_value::<SessionProfile>(json!("file_station")).unwrap(),
        SessionProfile::FileStation
    );
    assert_eq!(
        serde_json::from_value::<SessionProfile>(json!("dsm_desktop")).unwrap(),
        SessionProfile::DsmDesktop
    );
    for invalid in [
        json!("webui"),
        json!("FileStation"),
        json!("DsmDesktop"),
        json!(""),
        json!(1),
        json!(null),
    ] {
        assert!(serde_json::from_value::<SessionProfile>(invalid).is_err());
    }
}

// ── 8. Portal sessions ──────────────────────────────────────────────

#[tokio::test]
async fn portal_port_login_marks_the_session_without_failing_on_odd_values() {
    for (portal, expected) in [
        (None, false),
        (Some(json!(true)), true),
        (Some(json!(false)), false),
        (Some(json!("unexpected")), false),
        (Some(json!({"nested":true})), false),
    ] {
        let dsm = Dsm::new(Policy {
            portal: portal.clone(),
            ..Policy::default()
        });
        let server = dsm.serve().await;
        let service = connected(&dsm, &server, LoginOptions::default()).await;
        assert_eq!(identity(&service).portal_session, expected, "{portal:?}");
    }
}

// ── 9. Secrets ──────────────────────────────────────────────────────

#[test]
fn login_result_is_lenient_and_redacted() {
    let result: LoginResult = serde_json::from_value(json!({"sid":SID,"synotoken":TOKEN,
        "device_id":"device-private-token","ik_message":42,"is_portal_port":1}))
    .unwrap();
    assert_eq!(result.device_token(), Some("device-private-token"));
    assert!(result.ik_message.is_none());
    assert!(result.is_portal_port);
    let both: LoginResult = serde_json::from_value(
        json!({"sid":SID,"did":"did-private-token","device_id":"device-private-token","ik_message":"reply-private"}),
    )
    .unwrap();
    assert_eq!(both.device_token(), Some("did-private-token"));
    for text in [format!("{result:?}"), format!("{both:?}")] {
        for secret in [
            SID,
            TOKEN,
            "device-private-token",
            "did-private-token",
            "reply-private",
        ] {
            assert!(!text.contains(secret), "{text}");
        }
    }
    let minimal: LoginResult = serde_json::from_value(json!({"sid":SID})).unwrap();
    assert!(minimal.synotoken.is_none() && minimal.device_token().is_none());
    assert!(!minimal.is_portal_port);
}

#[tokio::test]
async fn handshake_secrets_never_reach_debug_errors_or_diagnostics() {
    let dsm = Dsm::new(Policy {
        login_errors: VecDeque::from([400]),
        ..Policy::default()
    });
    let server = dsm.serve().await;
    let mut service = SynologyService::new();
    let rejected = service
        .fs_connect_with_options(
            config(server.port),
            &AtomicBool::new(true),
            NativeHttpRoute::Direct {},
            LoginOptions::default(),
        )
        .await
        .unwrap_err();
    let mut texts = vec![command_error(rejected)];

    let mut with_code = config(server.port);
    with_code.otp_code = Some(OTP.into());
    let login = sign_in(
        &mut service,
        with_code,
        NativeHttpRoute::Direct {},
        LoginOptions::default(),
    )
    .await;
    assert!(matches!(login, FileStationLogin::Connected { .. }));
    texts.push(format!("{login:?}"));
    let client = service.client.as_ref().unwrap();
    let signer = client.request_signer.clone().unwrap();
    texts.push(format!("{client:?}"));
    texts.push(format!("{:?}", *signer.lock().await));
    texts.push(format!("{:?}", client.session_identity()));
    texts.push(serde_json::to_string(client.session_identity()).unwrap());
    signer.lock().await.corrupt_hash_prefix_for_test();
    texts.push(command_error(service.get_utilization().await.unwrap_err()));

    let mut secrets = vec![
        SID.to_string(),
        TOKEN.to_string(),
        PASSWORD.to_string(),
        OTP.to_string(),
    ];
    dsm.state(|state| {
        for hash in &state.handshake_hashes {
            let encoded = URL_SAFE_NO_PAD.encode(hash);
            secrets.push(encoded[..8].to_string());
            secrets.push(encoded);
            secrets.push(hash.iter().map(|byte| format!("{byte:02x}")).collect());
            secrets.push(format!("{:?}", &hash[..8]));
        }
        for key in &state.initiator_statics {
            secrets.push(URL_SAFE_NO_PAD.encode(key));
            secrets.push(format!("{:?}", &key[..8]));
        }
        secrets.extend(state.ik_messages.iter().cloned());
        secrets.extend(state.replies.iter().cloned());
    });
    assert!(secrets.len() > 8);
    for text in &texts {
        for secret in &secrets {
            assert!(!text.contains(secret.as_str()), "{text}");
        }
    }
    assert!(texts[0].contains("synology-diagnostic:v1:"));
}

#[test]
fn debug_output_of_handshake_state_is_redacted() {
    assert_eq!(
        format!("{:?}", LoginPlan::Legacy(LoginHandshake::LegacyUnavailable)),
        "Legacy(LegacyUnavailable)"
    );
    let server = noise_builder().generate_keypair().unwrap();
    let key: [u8; 32] = server.public.try_into().unwrap();
    let (message, state) = first_message(&key, now()).unwrap();
    let plan = LoginPlan::Ik {
        ik_message: message.clone(),
        state: Box::new(state),
    };
    let text = format!("{plan:?}");
    assert!(!text.contains(&message) && !text.contains("HandshakeState"));
    let (handshake, signer) = plan.finish(None);
    assert_eq!(handshake, LoginHandshake::IkIncomplete);
    assert!(signer.is_none());
}
