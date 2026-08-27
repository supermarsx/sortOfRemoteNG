//! PVE `termproxy` WebSocket relay backing the xterm.js consoles.
//!
//! A console session is opened in three steps:
//!
//! 1. `POST …/termproxy` on the target ([`crate::console::ConsoleTarget`])
//!    yields `{ ticket, port, user }`.
//! 2. A WebSocket upgrade to `wss://host:port/…/vncwebsocket?port=&vncticket=`
//!    carries the *session* credential (`Cookie: PVEAuthCookie=…` for ticket
//!    sessions, `Authorization: PVEAPIToken=…` for token sessions) and reuses
//!    the HTTP client's TLS posture, including the SHA-256 certificate pin.
//! 3. The relay sends `"<user>:<ticket>\n"` and expects `OK`.
//!
//! Afterwards the PVE termproxy framing applies:
//!
//! | direction | frame | meaning |
//! |---|---|---|
//! | client → server | `0:<len>:<data>` | terminal input |
//! | client → server | `1:<cols>:<rows>:` | resize |
//! | client → server | `2` | keepalive, sent every [`PING_INTERVAL`] |
//! | server → client | raw bytes | terminal output |
//!
//! Output reaches the frontend as [`EVENT_CONSOLE_OUTPUT`] events carrying
//! base64 chunks of at most [`OUTPUT_CHUNK_BYTES`]. Both directions are
//! bounded at [`BUFFER_LIMIT_BYTES`] with a drop-newest policy that reports
//! the loss through [`EVENT_CONSOLE_ERROR`] instead of growing without limit.

use crate::client::{normalize_sha256_fingerprint, PinnedCertificateVerifier, PveClient};
use crate::console::{build_vncwebsocket_url, ConsoleManager, ConsoleTarget};
use crate::error::{ProxmoxError, ProxmoxResult};
use crate::types::{ProxmoxAuthMethod, ProxmoxConfig, TermProxyTicket};

use base64::Engine;
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use sorng_core::events::DynEventEmitter;
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::Connector;

/// `{ sessionId, data }` — `data` is base64 of at most [`OUTPUT_CHUNK_BYTES`] raw bytes.
pub const EVENT_CONSOLE_OUTPUT: &str = "proxmox-console-output";
/// `{ sessionId, reason }` — emitted exactly once per session, last.
pub const EVENT_CONSOLE_CLOSED: &str = "proxmox-console-closed";
/// `{ sessionId, message }` — non-fatal unless a close follows.
pub const EVENT_CONSOLE_ERROR: &str = "proxmox-console-error";

/// Concurrent console sessions allowed per `ProxmoxService`.
pub const MAX_CONSOLE_SESSIONS: usize = 16;
/// Per-direction buffer ceiling; overflow drops the newest bytes.
pub const BUFFER_LIMIT_BYTES: usize = 1024 * 1024;
/// Largest base64-decoded payload in a single output event.
pub const OUTPUT_CHUNK_BYTES: usize = 64 * 1024;
/// Cadence of the `2` keepalive frame.
pub const PING_INTERVAL: Duration = Duration::from_secs(30);

/// Largest single `console_send` payload.
const MAX_INPUT_BYTES: usize = 64 * 1024;
/// Queue slots for pending client→server frames (bytes are capped separately).
const OUTBOUND_QUEUE_SLOTS: usize = 256;
/// Ceiling for the ticket POST + upgrade + `OK` exchange.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(20);
/// PVE answers the handshake line with this literal.
const HANDSHAKE_ACK: &str = "OK";

fn base64_encode(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

// ── Session description ──────────────────────────────────────────────

/// Handle returned by `proxmox_console_open` and echoed by the event payloads.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxmoxConsoleSession {
    /// Opaque id used by every other console command and every event.
    pub session_id: String,
    pub node: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vmid: Option<u64>,
    /// `"qemu"`, `"lxc"` or `"node"`.
    pub vm_type: String,
    /// The `user` the termproxy ticket was issued to (`root@pam`).
    pub user: String,
    /// The termproxy port PVE allocated (opaque; echoed for diagnostics).
    pub port: String,
}

// ── Bounded, drop-newest byte budget ─────────────────────────────────

/// Shared byte ceiling for one direction of a console session.
///
/// `reserve` fails instead of blocking so the caller can drop the newest data
/// and report the loss; `release` is called once the bytes have been handed on.
#[derive(Debug)]
pub struct ByteBudget {
    limit: usize,
    used: AtomicUsize,
}

impl ByteBudget {
    pub fn new(limit: usize) -> Self {
        Self {
            limit,
            used: AtomicUsize::new(0),
        }
    }

    /// Reserve `bytes`; `false` when the reservation would exceed the limit.
    pub fn reserve(&self, bytes: usize) -> bool {
        self.used
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |used| {
                let next = used.checked_add(bytes)?;
                (next <= self.limit).then_some(next)
            })
            .is_ok()
    }

    pub fn release(&self, bytes: usize) {
        self.used.fetch_sub(bytes, Ordering::AcqRel);
    }

    pub fn used(&self) -> usize {
        self.used.load(Ordering::Acquire)
    }

    pub fn limit(&self) -> usize {
        self.limit
    }
}

/// Frames queued towards the PVE end of a session.
#[derive(Debug, PartialEq, Eq)]
enum ConsoleCommand {
    Input(Vec<u8>),
    Resize { cols: u16, rows: u16 },
    Close,
}

impl ConsoleCommand {
    /// Bytes charged against the outbound budget.
    fn cost(&self) -> usize {
        match self {
            Self::Input(data) => data.len(),
            Self::Resize { .. } | Self::Close => 0,
        }
    }
}

/// Producer half of a session's outbound queue: bounded in both slots and bytes.
#[derive(Debug)]
struct OutboundQueue {
    sender: mpsc::Sender<ConsoleCommand>,
    budget: Arc<ByteBudget>,
}

impl OutboundQueue {
    fn new(limit: usize, slots: usize) -> (Self, mpsc::Receiver<ConsoleCommand>, Arc<ByteBudget>) {
        let (sender, receiver) = mpsc::channel(slots);
        let budget = Arc::new(ByteBudget::new(limit));
        (
            Self {
                sender,
                budget: Arc::clone(&budget),
            },
            receiver,
            budget,
        )
    }

    /// Enqueue a frame. `Err(dropped_bytes)` means the newest frame was dropped
    /// because the byte budget or the queue itself was full.
    fn push(&self, command: ConsoleCommand) -> Result<(), usize> {
        let cost = command.cost();
        if !self.budget.reserve(cost) {
            return Err(cost);
        }
        match self.sender.try_send(command) {
            Ok(()) => Ok(()),
            Err(_) => {
                self.budget.release(cost);
                Err(cost)
            }
        }
    }
}

// ── Registry ─────────────────────────────────────────────────────────

struct SessionEntry {
    info: ProxmoxConsoleSession,
    queue: OutboundQueue,
    task: tokio::task::JoinHandle<()>,
}

/// Per-service map of live console sessions.
///
/// Cloneable and lock-free at the service boundary: the relay tasks keep their
/// own `Arc` so they can deregister themselves without taking the service lock.
#[derive(Clone)]
pub struct ConsoleRegistry {
    sessions: Arc<Mutex<HashMap<String, SessionEntry>>>,
    emitter: Option<DynEventEmitter>,
    max_sessions: usize,
    buffer_limit: usize,
    ping_interval: Duration,
}

impl std::fmt::Debug for ConsoleRegistry {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ConsoleRegistry")
            .field("sessions", &self.len())
            .field("has_emitter", &self.emitter.is_some())
            .field("max_sessions", &self.max_sessions)
            .field("buffer_limit", &self.buffer_limit)
            .field("ping_interval", &self.ping_interval)
            .finish()
    }
}

impl Default for ConsoleRegistry {
    fn default() -> Self {
        Self::new(None)
    }
}

impl ConsoleRegistry {
    pub fn new(emitter: Option<DynEventEmitter>) -> Self {
        Self::with_limits(emitter, MAX_CONSOLE_SESSIONS, BUFFER_LIMIT_BYTES)
    }

    /// Same as [`Self::new`] with explicit ceilings (tests drive the overflow
    /// and session-limit paths through this).
    pub fn with_limits(
        emitter: Option<DynEventEmitter>,
        max_sessions: usize,
        buffer_limit: usize,
    ) -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            emitter,
            max_sessions,
            buffer_limit,
            ping_interval: PING_INTERVAL,
        }
    }

    /// Override the keepalive cadence (tests use milliseconds).
    pub fn with_ping_interval(mut self, interval: Duration) -> Self {
        self.ping_interval = interval;
        self
    }

    fn guard(&self) -> std::sync::MutexGuard<'_, HashMap<String, SessionEntry>> {
        self.sessions
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    pub fn len(&self) -> usize {
        self.guard().len()
    }

    pub fn is_empty(&self) -> bool {
        self.guard().is_empty()
    }

    /// Live sessions, ordered by id so the listing is stable.
    pub fn sessions(&self) -> Vec<ProxmoxConsoleSession> {
        let mut sessions: Vec<ProxmoxConsoleSession> = self
            .guard()
            .values()
            .map(|entry| entry.info.clone())
            .collect();
        sessions.sort_by(|left, right| left.session_id.cmp(&right.session_id));
        sessions
    }

    fn emit(&self, event: &str, payload: serde_json::Value) {
        if let Some(emitter) = self.emitter.as_ref() {
            if let Err(error) = emitter.emit_event(event, payload) {
                log::warn!("Proxmox console event {event} could not be emitted: {error}");
            }
        }
    }

    fn emit_error(&self, session_id: &str, message: impl Into<String>) {
        self.emit(
            EVENT_CONSOLE_ERROR,
            serde_json::json!({ "sessionId": session_id, "message": message.into() }),
        );
    }

    fn push(&self, session_id: &str, command: ConsoleCommand) -> ProxmoxResult<()> {
        let outcome = {
            let sessions = self.guard();
            let entry = sessions
                .get(session_id)
                .ok_or_else(|| ProxmoxError::console("Unknown Proxmox console session"))?;
            entry.queue.push(command)
        };
        if let Err(dropped) = outcome {
            // Drop-newest: the session survives, the frontend is told.
            self.emit_error(
                session_id,
                format!(
                    "Proxmox console input buffer is full ({} bytes); dropped {dropped} bytes",
                    self.buffer_limit
                ),
            );
        }
        Ok(())
    }

    /// Queue terminal input (UTF-8, as produced by xterm.js `onData`).
    pub fn send(&self, session_id: &str, data: &str) -> ProxmoxResult<()> {
        if data.is_empty() {
            return Ok(());
        }
        if data.len() > MAX_INPUT_BYTES {
            return Err(ProxmoxError::console(format!(
                "Proxmox console input rejected: at most {MAX_INPUT_BYTES} bytes per call"
            )));
        }
        self.push(session_id, ConsoleCommand::Input(data.as_bytes().to_vec()))
    }

    /// Queue a terminal resize.
    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> ProxmoxResult<()> {
        if cols == 0 || rows == 0 {
            return Err(ProxmoxError::console("Invalid Proxmox console size"));
        }
        self.push(session_id, ConsoleCommand::Resize { cols, rows })
    }

    /// Ask a session to close; the relay task emits [`EVENT_CONSOLE_CLOSED`].
    pub fn close(&self, session_id: &str) -> ProxmoxResult<()> {
        self.push(session_id, ConsoleCommand::Close)
    }

    /// Close every session immediately (disconnect / shutdown).
    pub fn close_all(&self) {
        let entries: Vec<SessionEntry> = self.guard().drain().map(|(_, entry)| entry).collect();
        for entry in entries {
            entry.task.abort();
            self.emit(
                EVENT_CONSOLE_CLOSED,
                serde_json::json!({
                    "sessionId": entry.info.session_id,
                    "reason": "Disconnected from Proxmox VE",
                }),
            );
        }
    }

    fn remove(&self, session_id: &str) {
        self.guard().remove(session_id);
    }
}

// ── Connection parameters ────────────────────────────────────────────

/// Everything the relay task needs, captured while the service lock is held so
/// the task itself never touches the client again.
#[derive(Debug, Clone)]
struct ConsoleConnection {
    url: String,
    /// `("Cookie", "PVEAuthCookie=…")` or `("Authorization", "PVEAPIToken=…")`.
    auth_header: (&'static str, String),
    fingerprint: Option<[u8; 32]>,
    handshake: String,
}

/// Shared with [`crate::vnc_bridge`], which carries the same session
/// credential on its own `vncwebsocket` upgrade.
pub(crate) fn auth_header_for(
    config: &ProxmoxConfig,
    client: &PveClient,
) -> ProxmoxResult<(&'static str, String)> {
    match &config.auth {
        ProxmoxAuthMethod::ApiToken { token_id, secret } => {
            Ok(("Authorization", format!("PVEAPIToken={token_id}={secret}")))
        }
        ProxmoxAuthMethod::Password { .. } => {
            let ticket = client
                .ticket()
                .ok_or_else(|| ProxmoxError::auth("Not authenticated"))?;
            Ok(("Cookie", format!("PVEAuthCookie={}", ticket.ticket)))
        }
    }
}

/// Build the rustls config the WebSocket upgrade uses.
///
/// Mirrors [`PveClient::new`]: a pinned self-signed certificate when the
/// connection opted into `insecure` + fingerprint, otherwise the platform
/// trust store. Both use the `ring` provider the app installs at startup.
///
/// Shared with [`crate::vnc_bridge`] so both websocket paths inherit the same
/// TLS posture from one place.
pub(crate) fn tls_connector(fingerprint: Option<[u8; 32]>) -> ProxmoxResult<Connector> {
    let builder = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .map_err(|_| ProxmoxError::connection("Failed to initialize Proxmox TLS configuration"))?;
    let config = match fingerprint {
        Some(expected) => builder
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(PinnedCertificateVerifier::new(expected)?))
            .with_no_client_auth(),
        None => {
            let mut roots = rustls::RootCertStore::empty();
            for certificate in rustls_native_certs::load_native_certs().certs {
                let _ = roots.add(certificate);
            }
            builder.with_root_certificates(roots).with_no_client_auth()
        }
    };
    Ok(Connector::Rustls(Arc::new(config)))
}

impl ConsoleConnection {
    fn build(
        client: &PveClient,
        config: &ProxmoxConfig,
        target: &ConsoleTarget,
        ticket: &TermProxyTicket,
    ) -> ProxmoxResult<Self> {
        Ok(Self {
            url: build_vncwebsocket_url(client.base_url(), target, &ticket.port, &ticket.ticket),
            auth_header: auth_header_for(config, client)?,
            fingerprint: normalize_sha256_fingerprint(config.fingerprint.as_deref())?,
            handshake: format!("{}:{}\n", ticket.user, ticket.ticket),
        })
    }
}

// ── Opening a session ────────────────────────────────────────────────

/// Acquire a termproxy ticket, open the relay and register the session.
pub(crate) async fn open_console(
    registry: &ConsoleRegistry,
    client: &PveClient,
    config: &ProxmoxConfig,
    target: ConsoleTarget,
) -> ProxmoxResult<ProxmoxConsoleSession> {
    if registry.len() >= registry.max_sessions {
        return Err(ProxmoxError::console(format!(
            "Too many open Proxmox consoles (limit {}); close one first",
            registry.max_sessions
        )));
    }

    let ticket = ConsoleManager::new(client).termproxy(&target).await?;
    let connection = ConsoleConnection::build(client, config, &target, &ticket)?;

    let session_id = uuid::Uuid::new_v4().to_string();
    let info = ProxmoxConsoleSession {
        session_id: session_id.clone(),
        node: target.node().to_string(),
        vmid: target.vmid(),
        vm_type: target.kind().to_string(),
        user: ticket.user.clone(),
        port: ticket.port.clone(),
    };

    let stream = connect_console(&connection).await?;

    let (queue, receiver, budget) = OutboundQueue::new(registry.buffer_limit, OUTBOUND_QUEUE_SLOTS);
    let task = tokio::spawn(relay_loop(
        registry.clone(),
        session_id.clone(),
        stream,
        receiver,
        budget,
    ));

    // Re-check under the lock: a concurrent open may have taken the last slot.
    {
        let mut sessions = registry.guard();
        if sessions.len() >= registry.max_sessions {
            task.abort();
            return Err(ProxmoxError::console(format!(
                "Too many open Proxmox consoles (limit {}); close one first",
                registry.max_sessions
            )));
        }
        sessions.insert(
            session_id,
            SessionEntry {
                info: info.clone(),
                queue,
                task,
            },
        );
    }

    Ok(info)
}

type ConsoleStream =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// Upgrade, then perform the `"<user>:<ticket>\n"` → `OK` exchange.
async fn connect_console(connection: &ConsoleConnection) -> ProxmoxResult<ConsoleStream> {
    let mut request = connection
        .url
        .as_str()
        .into_client_request()
        .map_err(|_| ProxmoxError::console("Invalid Proxmox console websocket URL"))?;
    let value =
        connection.auth_header.1.parse().map_err(|_| {
            ProxmoxError::auth("Proxmox console credential is not a valid HTTP header")
        })?;
    request
        .headers_mut()
        .insert(connection.auth_header.0, value);

    let websocket_config = WebSocketConfig::default()
        .max_message_size(Some(BUFFER_LIMIT_BYTES))
        .max_frame_size(Some(BUFFER_LIMIT_BYTES));

    let connector = tls_connector(connection.fingerprint)?;
    let exchange = async {
        let (mut stream, _response) = tokio_tungstenite::connect_async_tls_with_config(
            request,
            Some(websocket_config),
            false,
            Some(connector),
        )
        .await
        .map_err(map_handshake_error)?;

        stream
            .send(Message::Text(connection.handshake.clone().into()))
            .await
            .map_err(|_| ProxmoxError::console("Proxmox console handshake could not be sent"))?;

        loop {
            match stream.next().await {
                Some(Ok(Message::Text(text))) => {
                    return if text.trim() == HANDSHAKE_ACK {
                        Ok(stream)
                    } else {
                        Err(ProxmoxError::auth(
                            "Proxmox rejected the console ticket (it may have expired)",
                        ))
                    };
                }
                Some(Ok(Message::Binary(bytes))) => {
                    return if String::from_utf8_lossy(&bytes).trim() == HANDSHAKE_ACK {
                        Ok(stream)
                    } else {
                        Err(ProxmoxError::auth(
                            "Proxmox rejected the console ticket (it may have expired)",
                        ))
                    };
                }
                // Control frames may precede the acknowledgement.
                Some(Ok(Message::Ping(_) | Message::Pong(_) | Message::Frame(_))) => continue,
                Some(Ok(Message::Close(_))) | None => {
                    return Err(ProxmoxError::auth(
                        "Proxmox closed the console before acknowledging the ticket",
                    ))
                }
                Some(Err(_)) => {
                    return Err(ProxmoxError::console(
                        "Proxmox console connection failed during the handshake",
                    ))
                }
            }
        }
    };

    tokio::time::timeout(HANDSHAKE_TIMEOUT, exchange)
        .await
        .map_err(|_| ProxmoxError::timeout("Proxmox console handshake timed out"))?
}

fn map_handshake_error(error: tokio_tungstenite::tungstenite::Error) -> ProxmoxError {
    use tokio_tungstenite::tungstenite::Error as WsError;
    match error {
        WsError::Http(response) if response.status().as_u16() == 401 => {
            ProxmoxError::auth("Proxmox rejected the console ticket (it may have expired)")
        }
        WsError::Http(response) if response.status().as_u16() == 403 => {
            ProxmoxError::access_denied("Proxmox denied access to this console")
        }
        WsError::Http(response) => ProxmoxError::api(
            response.status().as_u16(),
            format!("Proxmox console upgrade failed ({})", response.status()),
        ),
        WsError::Tls(_) => ProxmoxError::connection(
            "Proxmox console TLS handshake failed (certificate fingerprint mismatch?)",
        ),
        _ => ProxmoxError::connection("Proxmox console websocket could not be opened"),
    }
}

// ── Relay ────────────────────────────────────────────────────────────

/// PVE termproxy input frame: `0:<len>:<data>`.
fn input_frame(data: &[u8]) -> Vec<u8> {
    let mut frame = format!("0:{}:", data.len()).into_bytes();
    frame.extend_from_slice(data);
    frame
}

/// PVE termproxy resize frame: `1:<cols>:<rows>:`.
fn resize_frame(cols: u16, rows: u16) -> String {
    format!("1:{cols}:{rows}:")
}

/// PVE termproxy keepalive frame.
const PING_FRAME: &str = "2";

async fn relay_loop(
    registry: ConsoleRegistry,
    session_id: String,
    stream: ConsoleStream,
    mut commands: mpsc::Receiver<ConsoleCommand>,
    outbound: Arc<ByteBudget>,
) {
    let (mut sink, mut source) = stream.split();
    let inbound = ByteBudget::new(registry.buffer_limit);
    let mut ping = tokio::time::interval(registry.ping_interval);
    ping.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    // `interval` fires immediately; the first tick is the session start.
    ping.tick().await;

    let reason = loop {
        tokio::select! {
            biased;

            command = commands.recv() => {
                let Some(command) = command else {
                    break "Console closed".to_string();
                };
                let cost = command.cost();
                let outcome = match &command {
                    ConsoleCommand::Input(data) => {
                        sink.send(Message::Binary(input_frame(data).into())).await
                    }
                    ConsoleCommand::Resize { cols, rows } => {
                        sink.send(Message::Text(resize_frame(*cols, *rows).into())).await
                    }
                    ConsoleCommand::Close => {
                        let _ = sink.send(Message::Close(None)).await;
                        break "Closed by the client".to_string();
                    }
                };
                // Released whether the write succeeded or not: the bytes are gone.
                if cost > 0 {
                    outbound.release(cost);
                }
                if outcome.is_err() {
                    break "Console connection lost".to_string();
                }
            }

            message = source.next() => {
                match message {
                    Some(Ok(Message::Binary(bytes))) => {
                        emit_output(&registry, &session_id, &inbound, &bytes);
                    }
                    Some(Ok(Message::Text(text))) => {
                        emit_output(&registry, &session_id, &inbound, text.as_bytes());
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        if sink.send(Message::Pong(payload)).await.is_err() {
                            break "Console connection lost".to_string();
                        }
                    }
                    Some(Ok(Message::Pong(_) | Message::Frame(_))) => {}
                    Some(Ok(Message::Close(frame))) => {
                        break frame
                            .map(|frame| {
                                let reason = frame.reason.trim();
                                if reason.is_empty() {
                                    "Console closed by Proxmox VE".to_string()
                                } else {
                                    reason.to_string()
                                }
                            })
                            .unwrap_or_else(|| "Console closed by Proxmox VE".to_string());
                    }
                    Some(Err(error)) => {
                        registry.emit_error(&session_id, describe_stream_error(&error));
                        break "Console connection lost".to_string();
                    }
                    None => break "Console closed by Proxmox VE".to_string(),
                }
            }

            _ = ping.tick() => {
                if sink.send(Message::Text(PING_FRAME.into())).await.is_err() {
                    break "Console connection lost".to_string();
                }
            }
        }
    };

    let _ = sink.close().await;
    registry.remove(&session_id);
    registry.emit(
        EVENT_CONSOLE_CLOSED,
        serde_json::json!({ "sessionId": session_id, "reason": reason }),
    );
}

fn describe_stream_error(error: &tokio_tungstenite::tungstenite::Error) -> String {
    use tokio_tungstenite::tungstenite::Error as WsError;
    match error {
        WsError::Capacity(_) => format!(
            "Proxmox console output exceeded the {BUFFER_LIMIT_BYTES} byte frame limit; the session was closed"
        ),
        WsError::ConnectionClosed | WsError::AlreadyClosed => {
            "Proxmox closed the console connection".to_string()
        }
        _ => "Proxmox console connection failed".to_string(),
    }
}

/// Emit server output as base64 chunks, honouring the inbound budget.
fn emit_output(registry: &ConsoleRegistry, session_id: &str, inbound: &ByteBudget, bytes: &[u8]) {
    if bytes.is_empty() {
        return;
    }
    if !inbound.reserve(bytes.len()) {
        registry.emit_error(
            session_id,
            format!(
                "Proxmox console output buffer is full ({} bytes); dropped {} bytes",
                inbound.limit(),
                bytes.len()
            ),
        );
        return;
    }
    for chunk in bytes.chunks(OUTPUT_CHUNK_BYTES) {
        registry.emit(
            EVENT_CONSOLE_OUTPUT,
            serde_json::json!({ "sessionId": session_id, "data": base64_encode(chunk) }),
        );
    }
    inbound.release(bytes.len());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn byte_budget_refuses_reservations_past_the_limit() {
        let budget = ByteBudget::new(10);
        assert!(budget.reserve(6));
        assert!(!budget.reserve(5));
        assert_eq!(budget.used(), 6);
        assert!(budget.reserve(4));
        assert_eq!(budget.used(), 10);
        budget.release(10);
        assert_eq!(budget.used(), 0);
        assert!(budget.reserve(10));
    }

    #[test]
    fn byte_budget_survives_an_overflowing_reservation() {
        let budget = ByteBudget::new(usize::MAX);
        assert!(budget.reserve(usize::MAX - 1));
        assert!(!budget.reserve(8));
        assert_eq!(budget.used(), usize::MAX - 1);
    }

    #[tokio::test]
    async fn outbound_queue_drops_newest_when_the_byte_budget_is_exhausted() {
        // The receiver is never polled, so nothing drains: deterministic overflow.
        let (queue, _receiver, budget) = OutboundQueue::new(8, 64);
        assert_eq!(queue.push(ConsoleCommand::Input(b"12345".to_vec())), Ok(()));
        assert_eq!(
            queue.push(ConsoleCommand::Input(b"6789".to_vec())),
            Err(4),
            "the newest frame must be dropped, not queued"
        );
        assert_eq!(budget.used(), 5);
        // Zero-cost control frames still get through.
        assert_eq!(
            queue.push(ConsoleCommand::Resize { cols: 80, rows: 24 }),
            Ok(())
        );
    }

    #[tokio::test]
    async fn outbound_queue_drops_newest_when_the_slots_are_exhausted() {
        let (queue, _receiver, budget) = OutboundQueue::new(BUFFER_LIMIT_BYTES, 2);
        assert_eq!(queue.push(ConsoleCommand::Input(b"a".to_vec())), Ok(()));
        assert_eq!(queue.push(ConsoleCommand::Input(b"b".to_vec())), Ok(()));
        assert_eq!(queue.push(ConsoleCommand::Input(b"c".to_vec())), Err(1));
        // The rejected frame released its reservation again.
        assert_eq!(budget.used(), 2);
    }

    #[test]
    fn termproxy_frames_match_the_pve_wire_format() {
        assert_eq!(input_frame(b"ls -l\r"), b"0:6:ls -l\r".to_vec());
        assert_eq!(input_frame(b""), b"0:0:".to_vec());
        assert_eq!(resize_frame(120, 40), "1:120:40:");
        assert_eq!(PING_FRAME, "2");
    }

    #[test]
    fn input_frame_length_counts_bytes_not_characters() {
        // 'é' is two bytes: PVE's reader consumes `len` bytes.
        assert_eq!(input_frame("é".as_bytes()), b"0:2:\xc3\xa9".to_vec());
    }

    #[test]
    fn auth_header_prefers_the_api_token_when_one_is_configured() {
        let config = ProxmoxConfig {
            host: "127.0.0.1".into(),
            port: 8006,
            auth: ProxmoxAuthMethod::ApiToken {
                token_id: "root@pam!ci".into(),
                secret: "s3cr3t".into(),
            },
            insecure: false,
            timeout_secs: 30,
            fingerprint: None,
        };
        let client = PveClient::new(&config).expect("client");
        let (name, value) = auth_header_for(&config, &client).expect("header");
        assert_eq!(name, "Authorization");
        assert_eq!(value, "PVEAPIToken=root@pam!ci=s3cr3t");
    }

    #[test]
    fn auth_header_fails_closed_without_a_ticket() {
        let config = ProxmoxConfig {
            host: "127.0.0.1".into(),
            port: 8006,
            auth: ProxmoxAuthMethod::Password {
                username: "root".into(),
                password: "pve".into(),
                realm: "pam".into(),
                otp: None,
                totp_secret: None,
            },
            insecure: false,
            timeout_secs: 30,
            fingerprint: None,
        };
        let client = PveClient::new(&config).expect("client");
        assert!(auth_header_for(&config, &client).is_err());
    }

    #[test]
    fn registry_rejects_unknown_sessions() {
        let registry = ConsoleRegistry::new(None);
        assert!(registry.is_empty());
        assert!(registry.send("nope", "x").is_err());
        assert!(registry.resize("nope", 80, 24).is_err());
        assert!(registry.close("nope").is_err());
    }

    #[test]
    fn registry_validates_input_and_size_arguments() {
        let registry = ConsoleRegistry::new(None);
        // Empty input is a no-op even for an unknown session.
        assert!(registry.send("nope", "").is_ok());
        let oversized = "x".repeat(MAX_INPUT_BYTES + 1);
        assert!(registry.send("nope", &oversized).is_err());
        assert!(registry.resize("nope", 0, 24).is_err());
        assert!(registry.resize("nope", 80, 0).is_err());
    }
}
