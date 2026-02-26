use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use ironrdp::pdu::input::fast_path::FastPathInputEvent;
use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tokio::sync::mpsc;

use super::stats::RdpSessionStats;

// ---- Events emitted to the frontend ----
// Frame pixel data is now pushed via Tauri Channel (binary ArrayBuffer) --
// no JSON event for frames.  Status/pointer/stats still use emit().

#[derive(Clone, Serialize)]
pub struct RdpStatusEvent {
    pub session_id: String,
    pub status: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub desktop_width: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub desktop_height: Option<u16>,
}

#[derive(Clone, Serialize)]
pub struct RdpPointerEvent {
    pub session_id: String,
    pub pointer_type: String, // "default", "hidden", "position", "bitmap"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y: Option<u16>,
}

#[derive(Clone, Serialize)]
pub struct RdpStatsEvent {
    pub session_id: String,
    pub uptime_secs: u64,
    pub bytes_received: u64,
    pub bytes_sent: u64,
    pub pdus_received: u64,
    pub pdus_sent: u64,
    pub frame_count: u64,
    pub fps: f64,
    pub input_events: u64,
    pub errors_recovered: u64,
    pub reactivations: u64,
    pub phase: String,
    pub last_error: Option<String>,
}

// ---- Input events from the frontend ----

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum RdpInputAction {
    MouseMove { x: u16, y: u16 },
    MouseButton { x: u16, y: u16, button: u8, pressed: bool },
    KeyboardKey { scancode: u16, pressed: bool, extended: bool },
    Wheel { x: u16, y: u16, delta: i16, horizontal: bool },
    Unicode { code: u16, pressed: bool },
}

// ---- Session and service types ----

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RdpSession {
    pub id: String,
    /// Stable frontend connection ID used for lifecycle management.
    /// Multiple `connect_rdp` invocations with the same `connection_id`
    /// automatically evict any previous session for that slot.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<String>,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub connected: bool,
    pub desktop_width: u16,
    pub desktop_height: u16,
    /// SHA-256 fingerprint of the server's TLS certificate (hex)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_cert_fingerprint: Option<String>,
    /// Whether a frontend viewer is currently attached (receiving frames).
    pub viewer_attached: bool,
}

pub(crate) enum RdpCommand {
    Input(Vec<FastPathInputEvent>),
    Shutdown,
    /// Attach a new frame channel viewer (for session persistence).
    AttachViewer(Channel<InvokeResponseBody>),
    /// Detach the current viewer without killing the session.
    DetachViewer,
    /// Send a graceful sign-out / logoff to the remote session.
    SignOut,
    /// Force reboot the remote machine.
    ForceReboot,
}

pub(crate) struct RdpActiveConnection {
    pub(crate) session: RdpSession,
    pub(crate) cmd_tx: mpsc::UnboundedSender<RdpCommand>,
    pub(crate) stats: Arc<RdpSessionStats>,
    pub(crate) _handle: tokio::task::JoinHandle<()>,
}

/// A single RDP log entry stored in the ring buffer.
#[derive(Clone, Serialize)]
pub struct RdpLogEntry {
    pub timestamp: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub level: String,
    pub message: String,
}

pub struct RdpService {
    pub(crate) connections: HashMap<String, RdpActiveConnection>,
    /// Cached TLS connector -- built once, reused for every connection.
    /// Building a TLS connector loads the system root certificate store which
    /// is very expensive on Windows (200-500 ms).  Caching it avoids paying that
    /// cost on every connection.
    pub(crate) cached_tls_connector: Option<Arc<native_tls::TlsConnector>>,
    /// Cached reqwest blocking client for CredSSP/Kerberos HTTP requests.
    /// Has a short connect + request timeout so it doesn't hang waiting for an
    /// unreachable KDC.
    pub(crate) cached_http_client: Option<Arc<reqwest::blocking::Client>>,
    /// Ring buffer of the last 1000 RDP log entries.
    pub(crate) log_buffer: Vec<RdpLogEntry>,
}

impl RdpService {
    pub fn new() -> super::RdpServiceState {
        // Pre-build the TLS connector and HTTP client eagerly so the first
        // connection doesn't pay the initialisation cost.
        let tls_connector = native_tls::TlsConnector::builder()
            .danger_accept_invalid_certs(true)
            .use_sni(false)
            .build()
            .ok()
            .map(Arc::new);

        let http_client = reqwest::blocking::Client::builder()
            .danger_accept_invalid_certs(true)
            .connect_timeout(Duration::from_secs(3))
            .timeout(Duration::from_secs(5))
            .pool_max_idle_per_host(2)
            .build()
            .ok()
            .map(Arc::new);

        Arc::new(tokio::sync::Mutex::new(RdpService {
            connections: HashMap::new(),
            cached_tls_connector: tls_connector,
            cached_http_client: http_client,
            log_buffer: Vec::with_capacity(1024),
        }))
    }

    /// Push a log entry into the ring buffer (capped at 1000).
    pub fn push_log(&mut self, level: &str, message: String, session_id: Option<String>) {
        let entry = RdpLogEntry {
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            session_id,
            level: level.to_string(),
            message,
        };
        self.log_buffer.push(entry);
        if self.log_buffer.len() > 1000 {
            self.log_buffer.drain(..self.log_buffer.len() - 1000);
        }
    }
}
