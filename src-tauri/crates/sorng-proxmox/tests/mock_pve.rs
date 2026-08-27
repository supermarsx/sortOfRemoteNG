//! In-process TLS mock of a Proxmox VE API server for integration tests.
//!
//! Hand-rolled HTTP/1.1 over `tokio-rustls` (no hyper/axum in the workspace).
//! Serves the subset of `/api2/json` that the auth flows and the smoke
//! endpoints need. Every request is recorded so tests can assert what was
//! (and was not) sent. Other test files include it with `mod mock_pve;`.
//!
//! Behaviour knobs live in [`MockState`] (behind `MockPve::state()`):
//! password login (any `user@realm`), wrong password → 401, PVE 6 inline
//! `otp`, PVE 7+ `NeedTFA` challenge + `tfa-challenge` completion (`totp:`,
//! `recovery:`), ticket-as-password renewal, API tokens, ticket invalidation
//! (to force 401s), and a `/version` body padding knob for response caps.
//!
//! The `ws` section at the bottom (t67-e5) adds the console surface: the
//! `termproxy` ticket endpoints and the `vncwebsocket` upgrade, behind which a
//! minimal PVE termproxy is emulated (`user:ticket\n` → `OK`, then `0:`/`1:`/`2`
//! frames, echoing input back as server output).
#![allow(dead_code)]

use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::sync::{Arc, Mutex, MutexGuard};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::task::JoinHandle;
use tokio_rustls::TlsAcceptor;

pub const MOCK_NODE: &str = "pve-mock";
pub const MOCK_VMID: u64 = 100;
pub const DEFAULT_PASSWORD: &str = "pve";

#[derive(Debug, Clone)]
pub struct RecordedRequest {
    pub method: String,
    pub path: String,
    pub query: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

impl RecordedRequest {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }

    /// Decoded `application/x-www-form-urlencoded` body pairs.
    pub fn form(&self) -> HashMap<String, String> {
        url::form_urlencoded::parse(self.body.as_bytes())
            .into_owned()
            .collect()
    }
}

#[derive(Debug)]
pub struct MockState {
    pub password: String,
    /// PVE 7+: first step answers `NeedTFA`.
    pub require_tfa: bool,
    /// Base32 secret used to validate `totp:<code>` second factors.
    pub totp_secret: Option<String>,
    /// Accepted `recovery:<code>` second factors (single use).
    pub recovery_codes: Vec<String>,
    /// PVE 6: when set, the inline `otp` form field must equal this.
    pub inline_otp: Option<String>,
    /// `token_id -> secret`.
    pub api_tokens: HashMap<String, String>,
    pub valid_tickets: HashSet<String>,
    pub issued_tickets: u64,
    pub requests: Vec<RecordedRequest>,
    /// Extra bytes appended to the `/version` payload (response cap tests).
    pub version_padding: usize,
    pub vm_status: HashMap<u64, String>,
    /// ── `ws` section (t67-e5) ──────────────────────────────────────
    /// Issued termproxy tickets: `vncticket -> user`.
    pub console_tickets: HashMap<String, String>,
    pub console_issued: u64,
    /// Reject every `vncwebsocket` upgrade with 401 (expired-ticket path).
    pub console_reject_upgrade: bool,
    /// Handshake lines (`user:ticket\n`) the websocket endpoint received.
    pub console_handshakes: Vec<String>,
    /// Payloads of the `0:<len>:<data>` input frames, in order.
    pub console_inputs: Vec<Vec<u8>>,
    /// `(cols, rows)` from the `1:<cols>:<rows>:` frames, in order.
    pub console_resizes: Vec<(u16, u16)>,
    /// Count of `2` keepalive frames.
    pub console_pings: usize,
    /// Websocket upgrades that reached the termproxy emulation.
    pub console_connections: usize,
    /// Echo `0:` input payloads back as server output (default `true`).
    pub console_echo: bool,
    /// Malformed frames the emulation could not parse.
    pub console_bad_frames: Vec<String>,
    /// Server-pushed output / close, broadcast to every live console.
    console_directives: tokio::sync::broadcast::Sender<WsDirective>,
}

impl MockState {
    fn new() -> Self {
        let mut vm_status = HashMap::new();
        vm_status.insert(MOCK_VMID, "running".to_string());
        Self {
            password: DEFAULT_PASSWORD.to_string(),
            require_tfa: false,
            totp_secret: None,
            recovery_codes: Vec::new(),
            inline_otp: None,
            api_tokens: HashMap::new(),
            valid_tickets: HashSet::new(),
            issued_tickets: 0,
            requests: Vec::new(),
            version_padding: 0,
            vm_status,
            console_tickets: HashMap::new(),
            console_issued: 0,
            console_reject_upgrade: false,
            console_handshakes: Vec::new(),
            console_inputs: Vec::new(),
            console_resizes: Vec::new(),
            console_pings: 0,
            console_connections: 0,
            console_echo: true,
            console_bad_frames: Vec::new(),
            console_directives: tokio::sync::broadcast::channel(64).0,
        }
    }

    pub fn ticket_requests(&self) -> Vec<&RecordedRequest> {
        self.requests
            .iter()
            .filter(|request| request.path == "/api2/json/access/ticket")
            .collect()
    }

    pub fn count(&self, method: &str, path: &str) -> usize {
        self.requests
            .iter()
            .filter(|request| request.method == method && request.path == path)
            .count()
    }

    /// Expire every issued ticket (next authenticated call → 401).
    pub fn invalidate_tickets(&mut self) {
        self.valid_tickets.clear();
    }

    fn issue_ticket(&mut self, username: &str) -> (String, String) {
        self.issued_tickets += 1;
        let ticket = format!("PVE:{username}:{:08X}::mocksig", self.issued_tickets);
        let csrf = format!("{:08X}:mockcsrf", self.issued_tickets);
        self.valid_tickets.insert(ticket.clone());
        (ticket, csrf)
    }
}

pub struct MockPve {
    pub addr: SocketAddr,
    pub cert_der: Vec<u8>,
    /// Upper-case colon-delimited SHA-256 of the DER certificate.
    pub fingerprint: String,
    state: Arc<Mutex<MockState>>,
    accept_task: JoinHandle<()>,
}

impl Drop for MockPve {
    fn drop(&mut self) {
        self.accept_task.abort();
    }
}

impl MockPve {
    pub async fn start() -> Self {
        // The app installs `ring` process-wide at startup; tests must do the same
        // because both rustls providers are enabled through feature unification.
        let _ = rustls::crypto::ring::default_provider().install_default();
        let cert = rcgen::generate_simple_self_signed(vec![
            "localhost".to_string(),
            "127.0.0.1".to_string(),
            "pve-mock.test".to_string(),
        ])
        .expect("generate self-signed certificate");
        let cert_der = cert.serialize_der().expect("serialize certificate");
        let key_der = cert.serialize_private_key_der();
        let fingerprint = sorng_proxmox::client::format_sha256_fingerprint(&cert_der);

        let server_config = rustls::ServerConfig::builder_with_provider(Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .expect("protocol versions")
        .with_no_client_auth()
        .with_single_cert(
            vec![rustls::pki_types::CertificateDer::from(cert_der.clone())],
            rustls::pki_types::PrivateKeyDer::Pkcs8(key_der.into()),
        )
        .expect("server config");
        let acceptor = TlsAcceptor::from(Arc::new(server_config));

        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("local addr");
        let state = Arc::new(Mutex::new(MockState::new()));

        let loop_state = Arc::clone(&state);
        let accept_task = tokio::spawn(async move {
            loop {
                let Ok((tcp, _)) = listener.accept().await else {
                    break;
                };
                let acceptor = acceptor.clone();
                let state = Arc::clone(&loop_state);
                tokio::spawn(async move {
                    let Ok(tls) = acceptor.accept(tcp).await else {
                        return;
                    };
                    serve_connection(tls, state).await;
                });
            }
        });

        Self {
            addr,
            cert_der,
            fingerprint,
            state,
            accept_task,
        }
    }

    pub fn host(&self) -> String {
        self.addr.ip().to_string()
    }

    pub fn port(&self) -> u16 {
        self.addr.port()
    }

    pub fn state(&self) -> MutexGuard<'_, MockState> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

// ── HTTP plumbing ────────────────────────────────────────────────────

async fn serve_connection<S>(mut stream: S, state: Arc<Mutex<MockState>>)
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let mut buffer: Vec<u8> = Vec::new();
    loop {
        // Read one full request (headers + declared body).
        let request = loop {
            if let Some(request) = try_parse_request(&mut buffer) {
                break request;
            }
            let mut chunk = [0_u8; 4096];
            match stream.read(&mut chunk).await {
                Ok(0) | Err(_) => return,
                Ok(read) => buffer.extend_from_slice(&chunk[..read]),
            }
        };
        // `ws` section: a `vncwebsocket` upgrade hijacks the connection.
        if is_websocket_upgrade(&request) {
            let decision = {
                let mut guard = state
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                guard.requests.push(request.clone());
                console_upgrade(&mut guard, &request)
            };
            match decision {
                Ok(upgrade) => {
                    let response = format!(
                        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {}\r\n\r\n",
                        upgrade.accept_key
                    );
                    if stream.write_all(response.as_bytes()).await.is_err()
                        || stream.flush().await.is_err()
                    {
                        return;
                    }
                    serve_console_ws(stream, state, upgrade).await;
                }
                Err((status, body)) => {
                    let response = format!(
                        "HTTP/1.1 {status} {}\r\nContent-Type: application/json;charset=UTF-8\r\nContent-Length: {}\r\n\r\n",
                        reason(status),
                        body.len()
                    );
                    let _ = stream.write_all(response.as_bytes()).await;
                    let _ = stream.write_all(body.as_bytes()).await;
                    let _ = stream.flush().await;
                }
            }
            return;
        }

        let (status, body) = {
            let mut guard = state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            guard.requests.push(request.clone());
            route(&mut guard, &request)
        };
        let response = format!(
            "HTTP/1.1 {status} {}\r\nContent-Type: application/json;charset=UTF-8\r\nContent-Length: {}\r\n\r\n",
            reason(status),
            body.len()
        );
        if stream.write_all(response.as_bytes()).await.is_err()
            || stream.write_all(body.as_bytes()).await.is_err()
            || stream.flush().await.is_err()
        {
            return;
        }
    }
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "No ticket",
        403 => "Permission check failed",
        404 => "Not Found",
        _ => "Error",
    }
}

fn try_parse_request(buffer: &mut Vec<u8>) -> Option<RecordedRequest> {
    let header_end = buffer.windows(4).position(|window| window == b"\r\n\r\n")?;
    let head = String::from_utf8_lossy(&buffer[..header_end]).into_owned();
    let mut lines = head.split("\r\n");
    let request_line = lines.next()?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next()?.to_string();
    let target = parts.next()?.to_string();
    let mut headers = Vec::new();
    for line in lines {
        if let Some((key, value)) = line.split_once(':') {
            headers.push((key.trim().to_string(), value.trim().to_string()));
        }
    }
    let content_length = headers
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case("content-length"))
        .and_then(|(_, value)| value.parse::<usize>().ok())
        .unwrap_or(0);
    let body_start = header_end + 4;
    if buffer.len() < body_start + content_length {
        return None;
    }
    let body =
        String::from_utf8_lossy(&buffer[body_start..body_start + content_length]).into_owned();
    buffer.drain(..body_start + content_length);
    let (path, query) = match target.split_once('?') {
        Some((path, query)) => (path.to_string(), query.to_string()),
        None => (target, String::new()),
    };
    Some(RecordedRequest {
        method,
        path,
        query,
        headers,
        body,
    })
}

// ── Routing ──────────────────────────────────────────────────────────

fn json(value: serde_json::Value) -> String {
    serde_json::json!({ "data": value }).to_string()
}

fn error_body(message: &str) -> String {
    serde_json::json!({ "data": null, "errors": { "message": message } }).to_string()
}

fn route(state: &mut MockState, request: &RecordedRequest) -> (u16, String) {
    if request.path == "/api2/json/access/ticket" {
        if request.method != "POST" {
            return (400, error_body("method"));
        }
        return access_ticket(state, request);
    }

    if !is_authenticated(state, request) {
        return (401, error_body("No ticket"));
    }

    let segments: Vec<&str> = request
        .path
        .trim_start_matches("/api2/json/")
        .split('/')
        .collect();
    match (request.method.as_str(), segments.as_slice()) {
        ("GET", ["version"]) => {
            let mut value = serde_json::json!({
                "version": "8.2.4",
                "release": "8.2",
                "repoid": "mock0001",
                "console": "xtermjs",
            });
            if state.version_padding > 0 {
                value["pad"] = serde_json::Value::String("x".repeat(state.version_padding));
            }
            (200, json(value))
        }
        ("GET", ["nodes"]) => (
            200,
            json(serde_json::json!([{
                "node": MOCK_NODE,
                "status": "online",
                "cpu": 0.05,
                "maxcpu": 8,
                "mem": 4_000_000_000_u64,
                "maxmem": 16_000_000_000_u64,
                "uptime": 12345,
                "type": "node",
                "id": format!("node/{MOCK_NODE}"),
            }])),
        ),
        ("GET", ["nodes", MOCK_NODE, "qemu"]) => {
            let status = state
                .vm_status
                .get(&MOCK_VMID)
                .cloned()
                .unwrap_or_else(|| "stopped".to_string());
            (
                200,
                json(serde_json::json!([{
                    "vmid": MOCK_VMID,
                    "name": "test-vm",
                    "status": status,
                    "cpus": 2,
                    "maxmem": 2_147_483_648_u64,
                }])),
            )
        }
        ("GET", ["nodes", MOCK_NODE, "lxc"]) => (200, json(serde_json::json!([]))),
        // ── `ws` section: termproxy tickets ────────────────────────
        ("POST", ["nodes", MOCK_NODE, "termproxy"]) => issue_console_ticket(state, request),
        ("POST", ["nodes", MOCK_NODE, kind, vmid, "termproxy"])
            if matches!(*kind, "qemu" | "lxc") =>
        {
            let Ok(vmid) = vmid.parse::<u64>() else {
                return (400, error_body("vmid"));
            };
            if *kind == "qemu" && !state.vm_status.contains_key(&vmid) {
                return (404, error_body("no such vm"));
            }
            issue_console_ticket(state, request)
        }
        ("GET", ["nodes", MOCK_NODE, "qemu", vmid, "status", "current"]) => {
            let Ok(vmid) = vmid.parse::<u64>() else {
                return (400, error_body("vmid"));
            };
            match state.vm_status.get(&vmid) {
                Some(status) => (
                    200,
                    json(serde_json::json!({
                        "status": status,
                        "vmid": vmid,
                        "name": "test-vm",
                    })),
                ),
                None => (404, error_body("no such vm")),
            }
        }
        ("POST", ["nodes", MOCK_NODE, "qemu", vmid, "status", action]) => {
            let Ok(vmid) = vmid.parse::<u64>() else {
                return (400, error_body("vmid"));
            };
            if !state.vm_status.contains_key(&vmid) {
                return (404, error_body("no such vm"));
            }
            let next = match *action {
                "start" | "reboot" => "running",
                "stop" | "shutdown" => "stopped",
                _ => return (404, error_body("no such action")),
            };
            state.vm_status.insert(vmid, next.to_string());
            (
                200,
                json(serde_json::Value::String(format!(
                    "UPID:{MOCK_NODE}:0000{vmid}:qm{action}:root@pam:"
                ))),
            )
        }
        _ => (404, error_body("Not Found")),
    }
}

fn is_authenticated(state: &MockState, request: &RecordedRequest) -> bool {
    if let Some(authorization) = request.header("Authorization") {
        if let Some(token) = authorization.strip_prefix("PVEAPIToken=") {
            if let Some((token_id, secret)) = token.rsplit_once('=') {
                return state.api_tokens.get(token_id).is_some_and(|s| s == secret);
            }
        }
        return false;
    }
    let Some(cookie) = request.header("Cookie") else {
        return false;
    };
    cookie
        .split(';')
        .map(str::trim)
        .filter_map(|pair| pair.strip_prefix("PVEAuthCookie="))
        .any(|ticket| state.valid_tickets.contains(ticket))
}

fn access_ticket(state: &mut MockState, request: &RecordedRequest) -> (u16, String) {
    let form = request.form();
    let Some(username) = form.get("username").filter(|u| u.contains('@')) else {
        return (401, error_body("authentication failure"));
    };
    let Some(password) = form.get("password") else {
        return (401, error_body("authentication failure"));
    };

    // PVE 7+ second step.
    if let Some(challenge) = form.get("tfa-challenge") {
        if !challenge.starts_with("PVE:!tfa!") {
            return (401, error_body("invalid challenge"));
        }
        let accepted = match password.split_once(':') {
            Some(("totp", code)) => state
                .totp_secret
                .as_deref()
                .and_then(|secret| sorng_proxmox::client::totp_code_from_secret(secret).ok())
                .is_some_and(|expected| expected == code),
            Some(("recovery", code)) => {
                if let Some(index) = state.recovery_codes.iter().position(|c| c == code) {
                    state.recovery_codes.remove(index);
                    true
                } else {
                    false
                }
            }
            _ => false,
        };
        if !accepted {
            return (401, error_body("authentication failure"));
        }
        let (ticket, csrf) = state.issue_ticket(username);
        return (
            200,
            json(serde_json::json!({
                "username": username,
                "ticket": ticket,
                "CSRFPreventionToken": csrf,
            })),
        );
    }

    // Ticket-as-password renewal (no TFA re-check, like PVE).
    if password.starts_with("PVE:") {
        if !state.valid_tickets.contains(password) {
            return (401, error_body("invalid ticket"));
        }
        let (ticket, csrf) = state.issue_ticket(username);
        return (
            200,
            json(serde_json::json!({
                "username": username,
                "ticket": ticket,
                "CSRFPreventionToken": csrf,
            })),
        );
    }

    if *password != state.password {
        return (401, error_body("authentication failure"));
    }

    // PVE 6 inline OTP.
    if let Some(expected) = &state.inline_otp {
        if form.get("otp") != Some(expected) {
            return (401, error_body("authentication failure"));
        }
    }

    if state.require_tfa {
        let mut kinds = serde_json::Map::new();
        kinds.insert(
            "totp".into(),
            serde_json::Value::Bool(state.totp_secret.is_some()),
        );
        kinds.insert(
            "recovery".into(),
            serde_json::Value::Bool(!state.recovery_codes.is_empty()),
        );
        kinds.insert("webauthn".into(), serde_json::Value::Null);
        let payload: String = url::form_urlencoded::byte_serialize(
            serde_json::Value::Object(kinds).to_string().as_bytes(),
        )
        .collect();
        let challenge = format!("PVE:!tfa!{payload}:6667ABCD::mocksig");
        return (
            200,
            json(serde_json::json!({
                "username": username,
                "ticket": challenge,
                "CSRFPreventionToken": "tfa-pending:csrf",
                "NeedTFA": 1,
            })),
        );
    }

    let (ticket, csrf) = state.issue_ticket(username);
    (
        200,
        json(serde_json::json!({
            "username": username,
            "ticket": ticket,
            "CSRFPreventionToken": csrf,
        })),
    )
}

// ══════════════════════════════════════════════════════════════════════
//  ws — termproxy tickets + `vncwebsocket` upgrade (t67-e5)
// ══════════════════════════════════════════════════════════════════════

use futures::{SinkExt, StreamExt};
use tokio_tungstenite::tungstenite::handshake::derive_accept_key;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::{CloseFrame, Role};
use tokio_tungstenite::tungstenite::Message;

/// Server-side pushes a test can trigger on every live console.
#[derive(Debug, Clone)]
pub enum WsDirective {
    /// Raw bytes the emulated shell writes back.
    Output(Vec<u8>),
    /// Close the websocket with this reason.
    Close(String),
}

/// What the 101 response and the emulation need from the upgrade request.
pub struct WsUpgrade {
    accept_key: String,
    /// The user the accepted `vncticket` was issued to.
    expected_user: String,
    expected_ticket: String,
    directives: tokio::sync::broadcast::Receiver<WsDirective>,
}

impl MockPve {
    /// Push raw output to every live console (as the emulated shell would).
    pub fn push_console_output(&self, bytes: &[u8]) {
        let sender = self.state().console_directives.clone();
        let _ = sender.send(WsDirective::Output(bytes.to_vec()));
    }

    /// Close every live console with `reason`.
    pub fn close_consoles(&self, reason: &str) {
        let sender = self.state().console_directives.clone();
        let _ = sender.send(WsDirective::Close(reason.to_string()));
    }

    /// Poll until `predicate` holds for the mock state, or `timeout` elapses.
    pub async fn wait_for(
        &self,
        timeout: std::time::Duration,
        predicate: impl Fn(&MockState) -> bool,
    ) -> bool {
        let deadline = std::time::Instant::now() + timeout;
        loop {
            // Scope the guard so it never spans the await below.
            let matched = {
                let state = self.state();
                predicate(&state)
            };
            if matched {
                return true;
            }
            if std::time::Instant::now() >= deadline {
                return false;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    }
}

impl MockState {
    /// Every `vncticket` the mock has handed out, sorted.
    pub fn console_ticket_values(&self) -> Vec<String> {
        let mut tickets: Vec<String> = self.console_tickets.keys().cloned().collect();
        tickets.sort();
        tickets
    }
}

/// Identify the caller from the session credential the request carries.
fn requesting_user(state: &MockState, request: &RecordedRequest) -> Option<String> {
    if let Some(authorization) = request.header("Authorization") {
        let token = authorization.strip_prefix("PVEAPIToken=")?;
        let (token_id, _secret) = token.rsplit_once('=')?;
        return Some(token_id.split('!').next()?.to_string());
    }
    let cookie = request.header("Cookie")?;
    let ticket = cookie
        .split(';')
        .map(str::trim)
        .filter_map(|pair| pair.strip_prefix("PVEAuthCookie="))
        .find(|ticket| state.valid_tickets.contains(*ticket))?;
    // Issued tickets look like `PVE:<user>:<counter>::mocksig`.
    ticket.split(':').nth(1).map(str::to_string)
}

/// `POST …/termproxy` — hand out a single-use console ticket.
fn issue_console_ticket(state: &mut MockState, request: &RecordedRequest) -> (u16, String) {
    let Some(user) = requesting_user(state, request) else {
        return (401, error_body("No ticket"));
    };
    state.console_issued += 1;
    let ticket = format!("PVEVNC:{:08X}::consolesig", state.console_issued);
    let port = format!("{}", 5900 + state.console_issued);
    state.console_tickets.insert(ticket.clone(), user.clone());
    (
        200,
        json(serde_json::json!({
            "ticket": ticket,
            "port": port,
            "user": user,
            "upid": format!("UPID:{MOCK_NODE}:0000:vncproxy:{user}:"),
        })),
    )
}

fn is_websocket_upgrade(request: &RecordedRequest) -> bool {
    request.path.ends_with("/vncwebsocket")
        && request
            .header("Upgrade")
            .is_some_and(|value| value.eq_ignore_ascii_case("websocket"))
}

/// Validate the upgrade; `Err` is an HTTP status + body to answer with.
fn console_upgrade(
    state: &mut MockState,
    request: &RecordedRequest,
) -> Result<WsUpgrade, (u16, String)> {
    if !is_authenticated(state, request) {
        return Err((401, error_body("No ticket")));
    }
    if state.console_reject_upgrade {
        return Err((401, error_body("invalid ticket")));
    }
    let Some(key) = request.header("Sec-WebSocket-Key") else {
        return Err((400, error_body("missing websocket key")));
    };
    let accept_key = derive_accept_key(key.as_bytes());

    let query: HashMap<String, String> = url::form_urlencoded::parse(request.query.as_bytes())
        .into_owned()
        .collect();
    // PVE requires both the port that came with the ticket and the ticket.
    if query.get("port").is_none_or(|port| port.is_empty()) {
        return Err((400, error_body("missing port")));
    }
    let Some(vncticket) = query.get("vncticket") else {
        return Err((401, error_body("missing vncticket")));
    };
    let Some(expected_user) = state.console_tickets.get(vncticket).cloned() else {
        return Err((401, error_body("invalid ticket")));
    };

    Ok(WsUpgrade {
        accept_key,
        expected_user,
        expected_ticket: vncticket.clone(),
        directives: state.console_directives.subscribe(),
    })
}

/// Minimal PVE termproxy: `user:ticket\n` then `OK`, then `0:`/`1:`/`2` frames.
async fn serve_console_ws<S>(stream: S, state: Arc<Mutex<MockState>>, upgrade: WsUpgrade)
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let mut socket =
        tokio_tungstenite::WebSocketStream::from_raw_socket(stream, Role::Server, None).await;
    let mut directives = upgrade.directives;

    // ── Handshake line ─────────────────────────────────────────────
    let Some(Ok(first)) = socket.next().await else {
        return;
    };
    let handshake =
        String::from_utf8_lossy(&message_payload(&first).unwrap_or_default()).into_owned();
    {
        let mut guard = state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        guard.console_handshakes.push(handshake.clone());
    }
    let expected = format!("{}:{}\n", upgrade.expected_user, upgrade.expected_ticket);
    if handshake != expected {
        let _ = socket.send(Message::Close(None)).await;
        let _ = socket.flush().await;
        return;
    }
    if socket.send(Message::Text("OK".into())).await.is_err() {
        return;
    }
    {
        let mut guard = state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        guard.console_connections += 1;
    }

    // ── Frame loop ─────────────────────────────────────────────────
    loop {
        tokio::select! {
            incoming = socket.next() => {
                let Some(Ok(message)) = incoming else { return };
                match message {
                    Message::Close(_) => {
                        let _ = socket.send(Message::Close(None)).await;
                        let _ = socket.flush().await;
                        return;
                    }
                    Message::Ping(payload) => {
                        if socket.send(Message::Pong(payload)).await.is_err() {
                            return;
                        }
                    }
                    Message::Pong(_) | Message::Frame(_) => {}
                    other => {
                        let Some(payload) = message_payload(&other) else {
                            continue;
                        };
                        if let Some(echo) = handle_console_frame(&state, &payload) {
                            if socket.send(Message::Binary(echo.into())).await.is_err() {
                                return;
                            }
                        }
                    }
                }
            }
            directive = directives.recv() => {
                match directive {
                    Ok(WsDirective::Output(bytes)) => {
                        if socket.send(Message::Binary(bytes.into())).await.is_err() {
                            return;
                        }
                    }
                    Ok(WsDirective::Close(reason)) => {
                        let _ = socket
                            .send(Message::Close(Some(CloseFrame {
                                code: CloseCode::Normal,
                                reason: reason.into(),
                            })))
                            .await;
                        let _ = socket.flush().await;
                        return;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
                }
            }
        }
    }
}

fn message_payload(message: &Message) -> Option<Vec<u8>> {
    match message {
        Message::Text(text) => Some(text.as_bytes().to_vec()),
        Message::Binary(bytes) => Some(bytes.to_vec()),
        _ => None,
    }
}

/// Parse one client frame, record it, and return bytes to echo back.
fn handle_console_frame(state: &Arc<Mutex<MockState>>, payload: &[u8]) -> Option<Vec<u8>> {
    let mut guard = state
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    match payload.first() {
        // `0:<len>:<data>`
        Some(b'0') => {
            let mut parts = payload[1..].splitn(3, |byte| *byte == b':');
            let (Some(empty), Some(len), Some(data)) = (parts.next(), parts.next(), parts.next())
            else {
                guard
                    .console_bad_frames
                    .push(String::from_utf8_lossy(payload).into_owned());
                return None;
            };
            let declared = std::str::from_utf8(len)
                .ok()
                .and_then(|value| value.parse::<usize>().ok());
            if !empty.is_empty() || declared != Some(data.len()) {
                guard
                    .console_bad_frames
                    .push(String::from_utf8_lossy(payload).into_owned());
                return None;
            }
            guard.console_inputs.push(data.to_vec());
            guard.console_echo.then(|| data.to_vec())
        }
        // `1:<cols>:<rows>:`
        Some(b'1') => {
            let text = String::from_utf8_lossy(payload).into_owned();
            let fields: Vec<&str> = text.split(':').collect();
            match (
                fields.get(1).and_then(|value| value.parse::<u16>().ok()),
                fields.get(2).and_then(|value| value.parse::<u16>().ok()),
            ) {
                (Some(cols), Some(rows)) if fields.len() == 4 && fields[3].is_empty() => {
                    guard.console_resizes.push((cols, rows));
                }
                _ => guard.console_bad_frames.push(text),
            }
            None
        }
        // `2`
        Some(b'2') if payload.len() == 1 => {
            guard.console_pings += 1;
            None
        }
        _ => {
            guard
                .console_bad_frames
                .push(String::from_utf8_lossy(payload).into_owned());
            None
        }
    }
}
