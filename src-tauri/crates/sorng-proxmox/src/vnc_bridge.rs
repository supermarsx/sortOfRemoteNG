//! Loopback TCP → PVE `vncproxy` WebSocket bridge backing the noVNC consoles.
//!
//! The app ships a native VNC client that speaks RFB over a plain TCP socket,
//! while Proxmox exposes the guest framebuffer as RFB *inside* a WebSocket.
//! A bridge closes that gap:
//!
//! 1. `POST …/vncproxy?websocket=1` yields `{ ticket, port, user }`; the ticket
//!    doubles as the VNC password for the RFB handshake inside the tunnel.
//! 2. A listener is bound on `127.0.0.1:0` and its port handed to the frontend.
//! 3. The **first** client to connect (within [`ACCEPT_TIMEOUT`]) takes the
//!    bridge; the listener is dropped immediately afterwards, so every further
//!    connection attempt is refused rather than silently queued.
//! 4. Only then is the WebSocket opened — reusing the HTTP client's TLS
//!    posture, certificate pin included — and bytes are pumped both ways until
//!    either side closes, [`IDLE_TIMEOUT`] elapses without traffic, or
//!    `proxmox_vnc_bridge_close` asks for a teardown.
//!
//! Because the socket never leaves the loopback interface and TLS terminates
//! at the WebSocket, the frontend opens the VNC client with
//! `allowUnencryptedTransport` against `127.0.0.1:<localPort>`.
//!
//! Every bridge ends with exactly one [`EVENT_VNC_BRIDGE_CLOSED`] event, and
//! the bridge is already deregistered when it fires.

use crate::client::{normalize_sha256_fingerprint, PveClient};
use crate::console::{build_vncwebsocket_url, ConsoleTarget};
use crate::console_ws::{auth_header_for, tls_connector};
use crate::error::{ProxmoxError, ProxmoxResult};
use crate::types::{ProxmoxConfig, VncTicket};

use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use sorng_core::events::DynEventEmitter;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::Message;

/// `{ bridgeId, reason }` — emitted exactly once per bridge, last.
pub const EVENT_VNC_BRIDGE_CLOSED: &str = "proxmox-vnc-bridge-closed";

/// Concurrent bridges allowed per `ProxmoxService`.
pub const MAX_VNC_BRIDGES: usize = 8;
/// How long a bridge waits for its one and only client.
pub const ACCEPT_TIMEOUT: Duration = Duration::from_secs(10);
/// How long an attached bridge tolerates silence in both directions.
pub const IDLE_TIMEOUT: Duration = Duration::from_secs(600);

/// Ceiling for the WebSocket upgrade once a client has attached.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
/// Bytes read from the local socket per pump iteration.
const TCP_CHUNK_BYTES: usize = 32 * 1024;
/// Largest WebSocket message accepted from PVE. Deliberately larger than the
/// terminal relay's ceiling: a single framebuffer update dwarfs a shell write.
const MAX_MESSAGE_BYTES: usize = 8 * 1024 * 1024;

const REASON_CLIENT_CLOSED: &str = "The VNC client disconnected";
const REASON_SERVER_CLOSED: &str = "Proxmox VE closed the VNC connection";
const REASON_LOST: &str = "The VNC bridge connection was lost";
const REASON_DISCONNECTED: &str = "Disconnected from Proxmox VE";
const REASON_CLOSED: &str = "Closed by the client";

// ── Bridge description ───────────────────────────────────────────────

/// Handle returned by `proxmox_vnc_bridge_open`.
///
/// `local_port` and `ticket` are what the VNC client needs: connect to
/// `127.0.0.1:<local_port>` and answer the RFB password challenge with
/// `ticket`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxmoxVncBridge {
    /// Opaque id accepted by `proxmox_vnc_bridge_close` and echoed by events.
    pub bridge_id: String,
    /// Loopback port the VNC client connects to.
    pub local_port: u16,
    /// PVE's VNC ticket — the RFB password inside the tunnel.
    pub ticket: String,
    /// The user the ticket was issued to (`root@pam`).
    pub user: String,
    pub node: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vmid: Option<u64>,
    /// `"qemu"`, `"lxc"` or `"node"`.
    pub vm_type: String,
}

// ── Registry ─────────────────────────────────────────────────────────

struct BridgeEntry {
    info: ProxmoxVncBridge,
    /// Dropping or firing this asks the bridge task to tear down gracefully.
    shutdown: oneshot::Sender<String>,
}

/// Per-service map of live bridges.
///
/// The relay tasks hold their own clone so they can deregister themselves
/// without taking the service lock.
#[derive(Clone)]
pub struct VncBridgeRegistry {
    bridges: Arc<Mutex<HashMap<String, BridgeEntry>>>,
    emitter: Option<DynEventEmitter>,
    max_bridges: usize,
    accept_timeout: Duration,
    idle_timeout: Duration,
}

impl std::fmt::Debug for VncBridgeRegistry {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("VncBridgeRegistry")
            .field("bridges", &self.len())
            .field("has_emitter", &self.emitter.is_some())
            .field("max_bridges", &self.max_bridges)
            .field("accept_timeout", &self.accept_timeout)
            .field("idle_timeout", &self.idle_timeout)
            .finish()
    }
}

impl Default for VncBridgeRegistry {
    fn default() -> Self {
        Self::new(None)
    }
}

impl VncBridgeRegistry {
    pub fn new(emitter: Option<DynEventEmitter>) -> Self {
        Self::with_limit(emitter, MAX_VNC_BRIDGES)
    }

    /// Same as [`Self::new`] with an explicit ceiling (tests drive the limit).
    pub fn with_limit(emitter: Option<DynEventEmitter>, max_bridges: usize) -> Self {
        Self {
            bridges: Arc::new(Mutex::new(HashMap::new())),
            emitter,
            max_bridges,
            accept_timeout: ACCEPT_TIMEOUT,
            idle_timeout: IDLE_TIMEOUT,
        }
    }

    /// Override the accept and idle deadlines (tests use milliseconds).
    pub fn with_timeouts(mut self, accept: Duration, idle: Duration) -> Self {
        self.accept_timeout = accept;
        self.idle_timeout = idle;
        self
    }

    fn guard(&self) -> std::sync::MutexGuard<'_, HashMap<String, BridgeEntry>> {
        self.bridges
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    pub fn len(&self) -> usize {
        self.guard().len()
    }

    pub fn is_empty(&self) -> bool {
        self.guard().is_empty()
    }

    pub fn max_bridges(&self) -> usize {
        self.max_bridges
    }

    /// Live bridges, ordered by id so the listing is stable.
    pub fn bridges(&self) -> Vec<ProxmoxVncBridge> {
        let mut bridges: Vec<ProxmoxVncBridge> = self
            .guard()
            .values()
            .map(|entry| entry.info.clone())
            .collect();
        bridges.sort_by(|left, right| left.bridge_id.cmp(&right.bridge_id));
        bridges
    }

    fn emit_closed(&self, bridge_id: &str, reason: &str) {
        if let Some(emitter) = self.emitter.as_ref() {
            let payload = serde_json::json!({ "bridgeId": bridge_id, "reason": reason });
            if let Err(error) = emitter.emit_event(EVENT_VNC_BRIDGE_CLOSED, payload) {
                log::warn!("Proxmox VNC bridge event could not be emitted: {error}");
            }
        }
    }

    /// Ask one bridge to tear down. The task emits [`EVENT_VNC_BRIDGE_CLOSED`].
    pub fn close(&self, bridge_id: &str) -> ProxmoxResult<()> {
        let entry = self
            .guard()
            .remove(bridge_id)
            .ok_or_else(|| ProxmoxError::console("Unknown Proxmox VNC bridge"))?;
        // The receiver is only gone if the task already finished; either way the
        // bridge is no longer registered.
        let _ = entry.shutdown.send(REASON_CLOSED.to_string());
        Ok(())
    }

    /// Tear down every bridge (disconnect / shutdown).
    pub fn close_all(&self) {
        let entries: Vec<BridgeEntry> = self.guard().drain().map(|(_, entry)| entry).collect();
        for entry in entries {
            let _ = entry.shutdown.send(REASON_DISCONNECTED.to_string());
        }
    }

    fn remove(&self, bridge_id: &str) {
        self.guard().remove(bridge_id);
    }
}

// ── Connection parameters ────────────────────────────────────────────

/// Everything the bridge task needs, captured while the service lock is held
/// so the task itself never touches the client again.
#[derive(Debug, Clone)]
struct BridgeConnection {
    url: String,
    /// `("Cookie", "PVEAuthCookie=…")` or `("Authorization", "PVEAPIToken=…")`.
    auth_header: (&'static str, String),
    fingerprint: Option<[u8; 32]>,
}

impl BridgeConnection {
    fn build(
        client: &PveClient,
        config: &ProxmoxConfig,
        target: &ConsoleTarget,
        ticket: &VncTicket,
    ) -> ProxmoxResult<Self> {
        Ok(Self {
            url: build_vncwebsocket_url(client.base_url(), target, &ticket.port, &ticket.ticket),
            auth_header: auth_header_for(config, client)?,
            fingerprint: normalize_sha256_fingerprint(config.fingerprint.as_deref())?,
        })
    }
}

// ── Opening a bridge ─────────────────────────────────────────────────

/// Acquire a VNC ticket, bind the loopback listener and register the bridge.
///
/// Returns as soon as the port is listening: the WebSocket is only opened once
/// a client attaches, so a bridge nobody uses costs PVE nothing beyond the
/// ticket.
pub(crate) async fn open_bridge(
    registry: &VncBridgeRegistry,
    client: &PveClient,
    config: &ProxmoxConfig,
    target: ConsoleTarget,
) -> ProxmoxResult<ProxmoxVncBridge> {
    if registry.len() >= registry.max_bridges {
        return Err(too_many_bridges(registry.max_bridges));
    }

    let ticket: VncTicket = client
        .post_form(
            &format!("{}/vncproxy", target.api_base()),
            &[("websocket", "1")],
        )
        .await?;
    let connection = BridgeConnection::build(client, config, &target, &ticket)?;

    let listener = TcpListener::bind(("127.0.0.1", 0)).await.map_err(|error| {
        ProxmoxError::console(format!("Could not open a local VNC bridge port: {error}"))
    })?;
    let local_port = listener
        .local_addr()
        .map_err(|error| {
            ProxmoxError::console(format!("Could not read the local VNC bridge port: {error}"))
        })?
        .port();

    let bridge_id = uuid::Uuid::new_v4().to_string();
    let info = ProxmoxVncBridge {
        bridge_id: bridge_id.clone(),
        local_port,
        ticket: ticket.ticket.clone(),
        user: ticket.user.clone(),
        node: target.node().to_string(),
        vmid: target.vmid(),
        vm_type: target.kind().to_string(),
    };

    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    // Register before spawning: the task deregisters itself when it ends, and a
    // short accept timeout could otherwise finish it before the insert lands.
    {
        let mut bridges = registry.guard();
        // Re-check under the lock: a concurrent open may have taken the last slot.
        if bridges.len() >= registry.max_bridges {
            return Err(too_many_bridges(registry.max_bridges));
        }
        bridges.insert(
            bridge_id.clone(),
            BridgeEntry {
                info: info.clone(),
                shutdown: shutdown_tx,
            },
        );
    }

    tokio::spawn(bridge_task(
        registry.clone(),
        bridge_id,
        listener,
        connection,
        shutdown_rx,
    ));

    Ok(info)
}

fn too_many_bridges(limit: usize) -> ProxmoxError {
    ProxmoxError::console(format!(
        "Too many open Proxmox VNC bridges (limit {limit}); close one first"
    ))
}

// ── Bridge task ──────────────────────────────────────────────────────

async fn bridge_task(
    registry: VncBridgeRegistry,
    bridge_id: String,
    listener: TcpListener,
    connection: BridgeConnection,
    shutdown: oneshot::Receiver<String>,
) {
    let reason = run_bridge(&registry, listener, connection, shutdown).await;
    registry.remove(&bridge_id);
    registry.emit_closed(&bridge_id, &reason);
}

async fn run_bridge(
    registry: &VncBridgeRegistry,
    listener: TcpListener,
    connection: BridgeConnection,
    mut shutdown: oneshot::Receiver<String>,
) -> String {
    let mut client = match accept_client(registry, &listener, &mut shutdown).await {
        Ok(client) => client,
        Err(reason) => return reason,
    };
    // Single client per bridge: dropping the listener turns every further
    // connection attempt into a refusal instead of a silent queue.
    drop(listener);

    let websocket = tokio::select! {
        biased;

        reason = &mut shutdown => {
            let _ = client.shutdown().await;
            return shutdown_reason(reason);
        }
        connected = tokio::time::timeout(CONNECT_TIMEOUT, connect_websocket(&connection)) => {
            match connected {
                Ok(Ok(websocket)) => websocket,
                Ok(Err(error)) => {
                    let _ = client.shutdown().await;
                    return error.to_string();
                }
                Err(_) => {
                    let _ = client.shutdown().await;
                    return "The Proxmox VNC websocket did not open in time".to_string();
                }
            }
        }
    };

    pump(client, websocket, registry.idle_timeout, &mut shutdown).await
}

/// Wait for the one client this bridge serves.
async fn accept_client(
    registry: &VncBridgeRegistry,
    listener: &TcpListener,
    shutdown: &mut oneshot::Receiver<String>,
) -> Result<TcpStream, String> {
    let accept = async {
        loop {
            match listener.accept().await {
                Ok((stream, peer)) if peer.ip().is_loopback() => return Some(stream),
                // Defence in depth: the listener is bound to 127.0.0.1, so a
                // non-loopback peer should not be reachable in the first place.
                Ok((stream, peer)) => {
                    log::warn!("Refused a non-loopback Proxmox VNC bridge client from {peer}");
                    drop(stream);
                }
                Err(_) => return None,
            }
        }
    };

    tokio::select! {
        biased;

        reason = &mut *shutdown => Err(shutdown_reason(reason)),
        accepted = accept => accepted.ok_or_else(|| "The local VNC bridge port failed".to_string()),
        _ = tokio::time::sleep(registry.accept_timeout) => Err(format!(
            "No VNC client connected within {} seconds",
            registry.accept_timeout.as_secs().max(1)
        )),
    }
}

type BridgeStream =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// Upgrade to the PVE `vncwebsocket` endpoint. Unlike the terminal relay there
/// is no `user:ticket` line: what follows the upgrade is raw RFB.
async fn connect_websocket(connection: &BridgeConnection) -> ProxmoxResult<BridgeStream> {
    let mut request = connection
        .url
        .as_str()
        .into_client_request()
        .map_err(|_| ProxmoxError::console("Invalid Proxmox VNC websocket URL"))?;
    let value = connection
        .auth_header
        .1
        .parse()
        .map_err(|_| ProxmoxError::auth("Proxmox VNC credential is not a valid HTTP header"))?;
    request
        .headers_mut()
        .insert(connection.auth_header.0, value);

    let websocket_config = WebSocketConfig::default()
        .max_message_size(Some(MAX_MESSAGE_BYTES))
        .max_frame_size(Some(MAX_MESSAGE_BYTES));

    let connector = tls_connector(connection.fingerprint)?;
    let (stream, _response) = tokio_tungstenite::connect_async_tls_with_config(
        request,
        Some(websocket_config),
        false,
        Some(connector),
    )
    .await
    .map_err(map_upgrade_error)?;
    Ok(stream)
}

fn map_upgrade_error(error: tokio_tungstenite::tungstenite::Error) -> ProxmoxError {
    use tokio_tungstenite::tungstenite::Error as WsError;
    match error {
        WsError::Http(response) if response.status().as_u16() == 401 => {
            ProxmoxError::auth("Proxmox rejected the VNC ticket (it may have expired)")
        }
        WsError::Http(response) if response.status().as_u16() == 403 => {
            ProxmoxError::access_denied("Proxmox denied access to this VNC console")
        }
        WsError::Http(response) => ProxmoxError::api(
            response.status().as_u16(),
            format!("Proxmox VNC upgrade failed ({})", response.status()),
        ),
        WsError::Tls(_) => ProxmoxError::connection(
            "Proxmox VNC TLS handshake failed (certificate fingerprint mismatch?)",
        ),
        _ => ProxmoxError::connection("Proxmox VNC websocket could not be opened"),
    }
}

/// Copy bytes in both directions until either end stops or the bridge is told to.
async fn pump(
    client: TcpStream,
    websocket: BridgeStream,
    idle_timeout: Duration,
    shutdown: &mut oneshot::Receiver<String>,
) -> String {
    let (mut reader, mut writer) = client.into_split();
    let (mut sink, mut source) = websocket.split();
    let mut buffer = vec![0_u8; TCP_CHUNK_BYTES];

    let reason = loop {
        // Recreated every iteration, so any traffic resets the idle deadline.
        let idle = tokio::time::sleep(idle_timeout);
        tokio::pin!(idle);

        tokio::select! {
            biased;

            reason = &mut *shutdown => break shutdown_reason(reason),

            read = reader.read(&mut buffer) => match read {
                Ok(0) | Err(_) => break REASON_CLIENT_CLOSED.to_string(),
                Ok(count) => {
                    let frame = Message::Binary(buffer[..count].to_vec().into());
                    if sink.send(frame).await.is_err() {
                        break REASON_LOST.to_string();
                    }
                }
            },

            message = source.next() => match message {
                Some(Ok(Message::Binary(bytes))) => {
                    if writer.write_all(&bytes).await.is_err() {
                        break REASON_CLIENT_CLOSED.to_string();
                    }
                }
                // PVE sends the framebuffer as binary; a text frame is still
                // RFB payload as far as the client is concerned.
                Some(Ok(Message::Text(text))) => {
                    if writer.write_all(text.as_bytes()).await.is_err() {
                        break REASON_CLIENT_CLOSED.to_string();
                    }
                }
                Some(Ok(Message::Ping(payload))) => {
                    if sink.send(Message::Pong(payload)).await.is_err() {
                        break REASON_LOST.to_string();
                    }
                }
                Some(Ok(Message::Pong(_) | Message::Frame(_))) => {}
                Some(Ok(Message::Close(frame))) => break close_reason(frame),
                Some(Err(_)) => break REASON_LOST.to_string(),
                None => break REASON_SERVER_CLOSED.to_string(),
            },

            _ = &mut idle => break format!(
                "The VNC bridge closed after {} seconds without traffic",
                idle_timeout.as_secs().max(1)
            ),
        }
    };

    // Clean shutdown in both directions: a close frame towards PVE, a FIN
    // towards the VNC client so it reports a disconnect instead of hanging.
    let _ = sink.send(Message::Close(None)).await;
    let _ = sink.close().await;
    let _ = writer.shutdown().await;
    reason
}

fn close_reason(frame: Option<tokio_tungstenite::tungstenite::protocol::CloseFrame>) -> String {
    frame
        .map(|frame| {
            let reason = frame.reason.trim();
            if reason.is_empty() {
                REASON_SERVER_CLOSED.to_string()
            } else {
                reason.to_string()
            }
        })
        .unwrap_or_else(|| REASON_SERVER_CLOSED.to_string())
}

/// A dropped sender means the registry let go of the bridge without a reason.
fn shutdown_reason(reason: Result<String, oneshot::error::RecvError>) -> String {
    reason.unwrap_or_else(|_| REASON_CLOSED.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::ProxmoxAuthMethod;

    fn config() -> ProxmoxConfig {
        ProxmoxConfig {
            host: "127.0.0.1".into(),
            port: 8006,
            auth: ProxmoxAuthMethod::ApiToken {
                token_id: "root@pam!ci".into(),
                secret: "s3cr3t".into(),
            },
            insecure: false,
            timeout_secs: 30,
            fingerprint: None,
        }
    }

    #[test]
    fn registry_defaults_match_the_documented_ceilings() {
        let registry = VncBridgeRegistry::new(None);
        assert!(registry.is_empty());
        assert_eq!(registry.max_bridges(), MAX_VNC_BRIDGES);
        assert_eq!(registry.max_bridges(), 8);
        assert_eq!(registry.accept_timeout, ACCEPT_TIMEOUT);
        assert_eq!(registry.accept_timeout, Duration::from_secs(10));
        assert_eq!(registry.idle_timeout, IDLE_TIMEOUT);
        assert_eq!(registry.idle_timeout, Duration::from_secs(600));
    }

    #[test]
    fn registry_rejects_unknown_bridges() {
        let registry = VncBridgeRegistry::new(None);
        assert!(registry.close("nope").is_err());
        assert!(registry.bridges().is_empty());
        // `close_all` on an empty registry is a no-op, not a panic.
        registry.close_all();
    }

    #[test]
    fn bridge_connection_targets_the_vncwebsocket_endpoint() {
        let config = config();
        let client = PveClient::new(&config).expect("client");
        let target = ConsoleTarget::parse("pve1", Some(100), Some("qemu")).expect("target");
        let ticket = VncTicket {
            ticket: "PVEVNC:a/b+c".into(),
            port: "5900".into(),
            user: "root@pam".into(),
            upid: None,
            cert: None,
        };
        let connection =
            BridgeConnection::build(&client, &config, &target, &ticket).expect("connection");
        assert_eq!(
            connection.url,
            "wss://127.0.0.1:8006/api2/json/nodes/pve1/qemu/100/vncwebsocket?port=5900&vncticket=PVEVNC%3Aa%2Fb%2Bc"
        );
        assert_eq!(connection.auth_header.0, "Authorization");
        assert_eq!(connection.auth_header.1, "PVEAPIToken=root@pam!ci=s3cr3t");
        assert_eq!(connection.fingerprint, None);
    }

    #[test]
    fn bridge_handle_serializes_as_camel_case() {
        let bridge = ProxmoxVncBridge {
            bridge_id: "b-1".into(),
            local_port: 54321,
            ticket: "PVEVNC:x".into(),
            user: "root@pam".into(),
            node: "pve1".into(),
            vmid: Some(100),
            vm_type: "qemu".into(),
        };
        let value = serde_json::to_value(&bridge).expect("serialize");
        assert_eq!(value["bridgeId"], "b-1");
        assert_eq!(value["localPort"], 54321);
        assert_eq!(value["ticket"], "PVEVNC:x");
        assert_eq!(value["user"], "root@pam");
        assert_eq!(value["vmType"], "qemu");
        assert_eq!(value["vmid"], 100);

        // A node shell carries no vmid at all.
        let shell = ProxmoxVncBridge {
            vmid: None,
            vm_type: "node".into(),
            ..bridge
        };
        let value = serde_json::to_value(&shell).expect("serialize");
        assert!(value.get("vmid").is_none());
    }

    #[test]
    fn too_many_bridges_names_the_limit() {
        assert_eq!(
            too_many_bridges(8).to_string(),
            "[ConsoleError] Too many open Proxmox VNC bridges (limit 8); close one first"
        );
    }

    #[tokio::test]
    async fn a_dropped_shutdown_sender_still_yields_a_reason() {
        let (sender, receiver) = oneshot::channel::<String>();
        drop(sender);
        assert_eq!(shutdown_reason(receiver.await), REASON_CLOSED);
        // A sent reason wins over the fallback.
        let (sender, receiver) = oneshot::channel::<String>();
        sender.send(REASON_DISCONNECTED.to_string()).expect("send");
        assert_eq!(shutdown_reason(receiver.await), REASON_DISCONNECTED);
    }

    #[test]
    fn a_close_frame_without_a_reason_falls_back_to_the_default() {
        use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
        use tokio_tungstenite::tungstenite::protocol::CloseFrame;

        assert_eq!(close_reason(None), REASON_SERVER_CLOSED);
        assert_eq!(
            close_reason(Some(CloseFrame {
                code: CloseCode::Normal,
                reason: "   ".into(),
            })),
            REASON_SERVER_CLOSED
        );
        assert_eq!(
            close_reason(Some(CloseFrame {
                code: CloseCode::Normal,
                reason: "vm stopped".into(),
            })),
            "vm stopped"
        );
    }
}
