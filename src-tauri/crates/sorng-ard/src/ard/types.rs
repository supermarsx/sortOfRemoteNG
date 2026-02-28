//! Core types for the Apple Remote Desktop protocol crate.
//!
//! Follows the same conventions as `sorng-rdp`: service state wrapper,
//! session struct, event payloads, internal command enum, and log buffer.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

// ── Service state alias (used by Tauri's `manage()`) ─────────────────────

/// Thread-safe handle to the [`ArdService`].
pub type ArdServiceState = Arc<tokio::sync::Mutex<ArdService>>;

// ── Capabilities reported by the server after handshake ──────────────────

/// Server-advertised ARD capabilities discovered during connection.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArdCapabilities {
    /// RFB protocol version string (e.g. "003.008").
    pub rfb_version: String,
    /// Security type that was negotiated (30 = ARD, 2 = VNC-auth, etc.).
    pub security_type: u8,
    /// Whether the server supports the Apple-specific clipboard extension.
    pub clipboard: bool,
    /// Whether the server supports Apple file-transfer pseudo-encoding.
    pub file_transfer: bool,
    /// Whether the curtain-mode pseudo-encoding is available.
    pub curtain_mode: bool,
    /// Whether the server advertised Retina (HiDPI) scaling support.
    pub retina: bool,
    /// Pixel format advertised by the server (e.g. "ARGB8888").
    pub pixel_format: String,
    /// Desktop name reported by the server.
    pub desktop_name: String,
    /// Server's initial framebuffer dimensions.
    pub framebuffer_width: u16,
    pub framebuffer_height: u16,
    /// Encodings the server accepted.
    pub accepted_encodings: Vec<i32>,
}

// ── Session ──────────────────────────────────────────────────────────────

/// Public-facing session state exposed to the front-end.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArdSession {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<String>,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub connected: bool,
    pub desktop_width: u16,
    pub desktop_height: u16,
    pub viewer_attached: bool,
    #[serde(default)]
    pub reconnect_count: u32,
    #[serde(default)]
    pub reconnecting: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<ArdCapabilities>,
    /// Whether curtain mode is currently active.
    #[serde(default)]
    pub curtain_active: bool,
}

// ── Events emitted to the front-end ──────────────────────────────────────

/// Status event sent over the Tauri event bus.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArdStatusEvent {
    pub session_id: String,
    pub status: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub desktop_width: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub desktop_height: Option<u16>,
}

/// Performance statistics event.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArdStatsEvent {
    pub session_id: String,
    pub uptime_secs: u64,
    pub bytes_received: u64,
    pub bytes_sent: u64,
    pub frame_count: u64,
    pub fps: f64,
    pub input_events: u64,
    pub errors_recovered: u64,
    pub phase: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

// ── Input actions from the front-end ─────────────────────────────────────

/// Front-end → back-end input action.
#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum ArdInputAction {
    MouseMove { x: u16, y: u16 },
    MouseButton { x: u16, y: u16, button: u8, pressed: bool },
    KeyboardKey { keycode: u32, pressed: bool },
    Scroll { x: u16, y: u16, delta_x: i16, delta_y: i16 },
}

// ── Internal command channel ─────────────────────────────────────────────

/// Commands sent from the Tauri command handlers to the session task over
/// an `mpsc::UnboundedSender`.
pub(crate) enum ArdCommand {
    /// Inject input events.
    Input(Vec<ArdInputAction>),
    /// Attach a frame viewer channel.
    AttachViewer(tauri::ipc::Channel<tauri::ipc::InvokeResponseBody>),
    /// Detach the frame viewer.
    DetachViewer,
    /// Send clipboard text to the server.
    SetClipboard(String),
    /// Request the server's clipboard contents.
    GetClipboard,
    /// Enable / disable curtain mode on the remote Mac.
    SetCurtainMode(bool),
    /// Initiate a file upload (local path → remote path).
    UploadFile { local_path: String, remote_path: String },
    /// Initiate a file download (remote path → local path).
    DownloadFile { remote_path: String, local_path: String },
    /// Request a list of files at a remote directory.
    ListRemoteDir { path: String },
    /// Graceful shutdown of this session.
    Shutdown,
    /// Force reconnect.
    Reconnect,
}

// ── Active connection (internal bookkeeping) ─────────────────────────────

/// Internal state for a live ARD connection.
pub(crate) struct ArdActiveConnection {
    pub(crate) session: ArdSession,
    pub(crate) cmd_tx: mpsc::UnboundedSender<ArdCommand>,
    pub(crate) stats: Arc<ArdSessionStats>,
    pub(crate) _handle: tokio::task::JoinHandle<()>,
    pub(crate) cached_password: String,
}

// ── Per-session statistics (lock-free atomics) ───────────────────────────

use std::sync::atomic::{AtomicU64, Ordering};

/// Atomic counters for a single session – updated from the session task,
/// read from the stats command without holding the service lock.
pub(crate) struct ArdSessionStats {
    pub bytes_received: AtomicU64,
    pub bytes_sent: AtomicU64,
    pub frame_count: AtomicU64,
    pub input_events: AtomicU64,
    pub errors_recovered: AtomicU64,
    pub start_time: std::time::Instant,
}

impl ArdSessionStats {
    pub fn new() -> Self {
        Self {
            bytes_received: AtomicU64::new(0),
            bytes_sent: AtomicU64::new(0),
            frame_count: AtomicU64::new(0),
            input_events: AtomicU64::new(0),
            errors_recovered: AtomicU64::new(0),
            start_time: std::time::Instant::now(),
        }
    }

    pub fn snapshot(&self, session_id: &str, phase: &str) -> ArdStatsEvent {
        let uptime = self.start_time.elapsed();
        let frames = self.frame_count.load(Ordering::Relaxed);
        let fps = if uptime.as_secs() > 0 {
            frames as f64 / uptime.as_secs_f64()
        } else {
            0.0
        };
        ArdStatsEvent {
            session_id: session_id.to_string(),
            uptime_secs: uptime.as_secs(),
            bytes_received: self.bytes_received.load(Ordering::Relaxed),
            bytes_sent: self.bytes_sent.load(Ordering::Relaxed),
            frame_count: frames,
            fps,
            input_events: self.input_events.load(Ordering::Relaxed),
            errors_recovered: self.errors_recovered.load(Ordering::Relaxed),
            phase: phase.to_string(),
            last_error: None,
        }
    }
}

// ── Log entry ────────────────────────────────────────────────────────────

/// A single protocol-level log entry.
#[derive(Clone, Serialize)]
pub struct ArdLogEntry {
    pub timestamp: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub level: String,
    pub message: String,
}

// ── The service (manages all active connections) ─────────────────────────

pub struct ArdService {
    pub(crate) connections: HashMap<String, ArdActiveConnection>,
    pub(crate) log_buffer: Vec<ArdLogEntry>,
}

impl ArdService {
    /// Create a new `ArdServiceState` wrapped in `Arc<Mutex<..>>`.
    pub fn new() -> super::ArdServiceState {
        Arc::new(tokio::sync::Mutex::new(ArdService {
            connections: HashMap::new(),
            log_buffer: Vec::with_capacity(1024),
        }))
    }

    /// Append a log entry, capping the buffer at 1 000 entries.
    pub fn push_log(&mut self, level: &str, message: String, session_id: Option<String>) {
        let entry = ArdLogEntry {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_stats_snapshot() {
        let stats = ArdSessionStats::new();
        stats.bytes_received.store(1024, Ordering::Relaxed);
        stats.frame_count.store(60, Ordering::Relaxed);
        let snap = stats.snapshot("test-id", "connected");
        assert_eq!(snap.session_id, "test-id");
        assert_eq!(snap.bytes_received, 1024);
        assert_eq!(snap.frame_count, 60);
        assert_eq!(snap.phase, "connected");
    }

    #[test]
    fn log_buffer_caps_at_1000() {
        let state = ArdService::new();
        let mut svc = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(async { state.lock().await });
        for i in 0..1100 {
            svc.push_log("info", format!("msg {i}"), None);
        }
        assert!(svc.log_buffer.len() <= 1000);
    }
}
