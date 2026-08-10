use std::collections::{HashMap, VecDeque};
use std::sync::Arc;

use super::frame_channel::DynFrameChannel;
use super::session_state::SessionStateSnapshot;
use super::wake_channel::WakeSender;
use crate::ironrdp::pdu::input::fast_path::FastPathInputEvent;
use secrecy::SecretString;
use serde::{Deserialize, Serialize};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

use super::cert_trust::ServerCertValidationMode;
use super::network::{build_credssp_http_client, build_tls_config};
use super::session_runtime::{RdpWorkerGeneration, RdpWorkerRuntime};
use super::stats::RdpSessionStats;

// ---- Events emitted to the frontend ----
// Frame pixel data is pushed via FrameChannel (binary ArrayBuffer) --
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
    pub pointer_type: &'static str, // "default", "hidden", "position", "bitmap"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y: Option<u16>,
    /// Base64-encoded RGBA bitmap data (only for pointer_type="bitmap")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bitmap_rgba: Option<String>,
    /// Cursor bitmap width in pixels
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bitmap_width: Option<u16>,
    /// Cursor bitmap height in pixels
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bitmap_height: Option<u16>,
    /// Cursor hotspot X offset
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hotspot_x: Option<u16>,
    /// Cursor hotspot Y offset
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hotspot_y: Option<u16>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lifecycle: Option<SessionStateSnapshot>,
    /// RDPGFX Tier-B graphics-pipeline diagnostics (codec/cap/surfaces/frames/
    /// acks/errors). `None` when GFX is disabled. Serializes as a `gfx` object
    /// with camelCase keys for the panel's Graphics row.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gfx: Option<crate::gfx::processor::GfxDiagnostics>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RdpFrameTelemetryEvent {
    pub session_id: String,
    pub queued_frames: u16,
    pub dropped_frames: u64,
    pub coalesced_frames: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub average_render_ms: Option<f64>,
}

// ---- Input events from the frontend ----

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum RdpInputAction {
    MouseMove {
        x: u16,
        y: u16,
    },
    MouseButton {
        x: u16,
        y: u16,
        button: u8,
        pressed: bool,
    },
    KeyboardKey {
        scancode: u16,
        pressed: bool,
        extended: bool,
    },
    Wheel {
        x: u16,
        y: u16,
        delta: i16,
        horizontal: bool,
    },
    Unicode {
        code: u16,
        pressed: bool,
    },
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
    /// Number of automatic reconnections performed during this session's lifetime.
    #[serde(default)]
    pub reconnect_count: u32,
    /// Whether the session is currently attempting to reconnect.
    #[serde(default)]
    pub reconnecting: bool,
}

pub enum RdpCommand {
    Input(Vec<FastPathInputEvent>),
    Shutdown,
    /// Attach a new frame channel viewer (for session persistence).
    AttachViewer(DynFrameChannel),
    /// Detach the current viewer without killing the session.
    DetachViewer,
    /// Send a graceful sign-out / logoff to the remote session.
    SignOut,
    /// Force reboot the remote machine.
    ForceReboot,
    /// Trigger a manual reconnect — drops the current TCP connection and
    /// re-establishes TCP + TLS + CredSSP from scratch.
    Reconnect,
    /// Advertise local clipboard text to the remote server (CF_UNICODETEXT).
    ClipboardCopy(String),
    /// Request clipboard text from the remote server.
    ClipboardPaste,
    /// Stage local files for CLIPRDR file transfer and advertise FileGroupDescriptorW.
    ClipboardCopyFiles(Vec<ClipboardFileEntry>),
    /// Toggle a session feature on/off at runtime.
    ToggleFeature {
        feature: String,
        enabled: bool,
    },
    /// Request a dynamic desktop resize via the Display Control DVC.
    SetDesktopSize {
        width: u16,
        height: u16,
    },
}

/// File entry for clipboard file transfer.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ClipboardFileEntry {
    pub name: String,
    pub size: u64,
    pub path: String,
    #[serde(default)]
    pub is_directory: bool,
}

pub struct RdpActiveConnection {
    pub session: RdpSession,
    pub cmd_tx: WakeSender,
    pub stats: Arc<RdpSessionStats>,
    pub worker: RdpWorkerRuntime,
    /// Cached password for automatic reconnection (CredSSP re-auth).
    #[allow(dead_code)]
    pub cached_password: SecretString,
    /// Cached domain for automatic reconnection.
    #[allow(dead_code)]
    pub cached_domain: Option<String>,
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
    pub connections: HashMap<String, RdpActiveConnection>,
    /// Counts both active sessions and connect calls that have passed
    /// admission but have not yet been inserted into `connections`.
    pub session_slots: Arc<Semaphore>,
    next_worker_generation: RdpWorkerGeneration,
    /// Cached TLS connector -- built once, reused for every connection.
    /// Building a TLS connector loads the system root certificate store which
    /// is very expensive on Windows (200-500 ms).  Caching it avoids paying that
    /// cost on every connection.
    pub cached_tls_connector: Option<super::RdpTlsConfig>,
    /// Cached reqwest blocking client for CredSSP/Kerberos HTTP requests.
    /// Has a short connect + request timeout so it doesn't hang waiting for an
    /// unreachable KDC.
    pub cached_http_client: Option<Arc<reqwest::blocking::Client>>,
    /// Ring buffer of the last 1000 RDP log entries (VecDeque for O(1) pop_front).
    pub log_buffer: VecDeque<RdpLogEntry>,
}

/// A conservative process-wide ceiling for resource-heavy RDP session
/// workers. Each admitted worker owns one permit before it is spawned and
/// until its blocking closure has actually exited.
pub const MAX_RDP_ACTIVE_OR_PENDING_SESSIONS: usize = 16;

impl RdpService {
    pub fn new() -> super::RdpServiceState {
        // Pre-build the TLS connector and HTTP client eagerly so the first
        // connection doesn't pay the initialisation cost.
        let tls_connector = build_tls_config(true).ok();

        let http_client = build_credssp_http_client(ServerCertValidationMode::Validate)
            .ok()
            .map(Arc::new);

        Arc::new(tokio::sync::Mutex::new(RdpService {
            connections: HashMap::new(),
            session_slots: Arc::new(Semaphore::new(
                MAX_RDP_ACTIVE_OR_PENDING_SESSIONS,
            )),
            next_worker_generation: 1,
            cached_tls_connector: tls_connector,
            cached_http_client: http_client,
            log_buffer: VecDeque::with_capacity(1024),
        }))
    }

    /// Reserve one active-or-pending session slot without waiting. The owned
    /// permit automatically returns to the pool on every startup error.
    pub fn try_reserve_session_slot(&self) -> Result<OwnedSemaphorePermit, String> {
        Arc::clone(&self.session_slots)
            .try_acquire_owned()
            .map_err(|_| {
                format!(
                    "RDP session limit reached (maximum {} active or starting sessions)",
                    MAX_RDP_ACTIVE_OR_PENDING_SESSIONS
                )
            })
    }

    pub fn allocate_worker_generation(&mut self) -> RdpWorkerGeneration {
        let generation = self.next_worker_generation;
        self.next_worker_generation = self.next_worker_generation.wrapping_add(1);
        if self.next_worker_generation == 0 {
            self.next_worker_generation = 1;
        }
        generation
    }

    #[cfg(test)]
    pub(crate) fn new_test_state(capacity: usize) -> super::RdpServiceState {
        Arc::new(tokio::sync::Mutex::new(RdpService {
            connections: HashMap::new(),
            session_slots: Arc::new(Semaphore::new(capacity)),
            next_worker_generation: 1,
            cached_tls_connector: None,
            cached_http_client: None,
            log_buffer: VecDeque::with_capacity(16),
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
        self.log_buffer.push_back(entry);
        while self.log_buffer.len() > 1000 {
            self.log_buffer.pop_front();
        }
    }
}
