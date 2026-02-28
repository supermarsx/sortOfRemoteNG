//! Core type definitions for the ARD protocol crate.

use std::collections::HashMap;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

/// Capabilities reported after connecting to an ARD server.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArdCapabilities {
    pub rfb_version: String,
    pub security_type: u8,
    pub supports_clipboard: bool,
    pub supports_file_transfer: bool,
    pub supports_curtain_mode: bool,
    pub supports_retina: bool,
    pub pixel_format: String,
    pub framebuffer_width: u16,
    pub framebuffer_height: u16,
    pub accepted_encodings: Vec<String>,
}

/// An active ARD session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArdSession {
    pub id: String,
    pub connection_id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub connected: bool,
    pub desktop_width: u16,
    pub desktop_height: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub desktop_name: Option<String>,
    pub viewer_attached: bool,
    pub reconnect_attempts: u32,
    pub max_reconnect_attempts: u32,
    pub capabilities: ArdCapabilities,
    pub curtain_active: bool,
}

/// Status event emitted by the session runner.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArdStatusEvent {
    pub session_id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub timestamp: String,
}

/// Statistics event for the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArdStatsEvent {
    pub session_id: String,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub frames_decoded: u64,
}

/// User input actions from the frontend viewer.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum ArdInputAction {
    MouseMove {
        x: u16,
        y: u16,
    },
    MouseButton {
        button: u8,
        pressed: bool,
        x: u16,
        y: u16,
    },
    KeyboardKey {
        keysym: u32,
        pressed: bool,
    },
    Scroll {
        dx: i16,
        dy: i16,
        x: u16,
        y: u16,
    },
}

/// Commands sent from the frontend to a session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum ArdCommand {
    Input(ArdInputAction),
    AttachViewer,
    DetachViewer,
    SetClipboard {
        text: String,
    },
    GetClipboard,
    SetCurtainMode {
        enabled: bool,
    },
    UploadFile {
        local_path: String,
        remote_path: String,
    },
    DownloadFile {
        remote_path: String,
        local_path: String,
    },
    ListRemoteDir {
        path: String,
    },
    Shutdown,
    Reconnect,
}

/// An active connection entry in the global service state.
///
/// NOTE: This type is NOT serialisable — it contains channel handles.
pub struct ArdActiveConnection {
    pub session_id: String,
    pub connection_id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub connected_at: String,
    pub command_tx: mpsc::Sender<ArdCommand>,
    pub stats: Arc<ArdSessionStats>,
}

impl std::fmt::Debug for ArdActiveConnection {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ArdActiveConnection")
            .field("session_id", &self.session_id)
            .field("connection_id", &self.connection_id)
            .field("host", &self.host)
            .field("port", &self.port)
            .finish()
    }
}

/// Atomic session statistics (safe to read from any thread).
#[derive(Debug)]
pub struct ArdSessionStats {
    pub bytes_sent: AtomicU64,
    pub bytes_received: AtomicU64,
    pub frames_decoded: AtomicU64,
    pub key_events_sent: AtomicU64,
    pub pointer_events_sent: AtomicU64,
}

/// A log entry in the service log buffer.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArdLogEntry {
    pub level: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub timestamp: String,
}

/// The global ARD service holding all active sessions.
#[derive(Debug)]
pub struct ArdService {
    pub connections: HashMap<String, ArdActiveConnection>,
    pub log_buffer: Vec<ArdLogEntry>,
}

impl Default for ArdService {
    fn default() -> Self {
        Self {
            connections: HashMap::new(),
            log_buffer: Vec::new(),
        }
    }
}

impl ArdService {
    pub fn new() -> Self {
        Self::default()
    }

    /// Push a log entry (capped at 500 entries).
    pub fn push_log(&mut self, level: &str, message: String, session_id: Option<String>) {
        if self.log_buffer.len() >= 500 {
            self.log_buffer.remove(0);
        }
        self.log_buffer.push(ArdLogEntry {
            level: level.into(),
            message,
            session_id,
            timestamp: Utc::now().to_rfc3339(),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ard_service_default() {
        let svc = ArdService::new();
        assert!(svc.connections.is_empty());
        assert!(svc.log_buffer.is_empty());
    }

    #[test]
    fn push_log_caps_buffer() {
        let mut svc = ArdService::new();
        for i in 0..510 {
            svc.push_log("info", format!("msg {i}"), None);
        }
        assert_eq!(svc.log_buffer.len(), 500);
    }

    #[test]
    fn ard_input_action_serialization() {
        let action = ArdInputAction::MouseMove { x: 100, y: 200 };
        let json = serde_json::to_string(&action).unwrap();
        assert!(json.contains("mouseMove") || json.contains("MouseMove"));
    }

    #[test]
    fn ard_command_serialization() {
        let cmd = ArdCommand::SetClipboard {
            text: "hello".into(),
        };
        let json = serde_json::to_string(&cmd).unwrap();
        assert!(json.contains("hello"));
    }
}
