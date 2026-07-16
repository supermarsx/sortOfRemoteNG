//! Core type definitions for the ARD protocol crate.

use std::collections::HashMap;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

/// Authentication path selected by the user for an ARD connection.
///
/// `MacOsAccount` is the remote Mac's local/network account carried by the
/// Apple RFB security-type-30 exchange. It is not an Apple Account. Apple
/// Account connections are delegated to the native Screen Sharing app and are
/// never passed through the embedded RFB engine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum ArdAuthenticationMode {
    #[default]
    MacOsAccount,
    VncPassword,
    AppleAccountNative,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArdEmbeddedRuntimeCapabilities {
    pub available: bool,
    pub authentication_modes: Vec<ArdAuthenticationMode>,
    pub accepts_apple_account_credentials: bool,
    pub supports_network_path: bool,
    pub network_path_reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArdAppleAccountNativeCapabilities {
    pub available: bool,
    pub requires_mac_os: bool,
    pub accepts_password: bool,
    pub target_prefill_supported: bool,
    pub reason: String,
}

/// Static capabilities of this build's two distinct ARD/Screen Sharing paths.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArdRuntimeCapabilities {
    pub embedded_rfb: ArdEmbeddedRuntimeCapabilities,
    pub apple_account_native: ArdAppleAccountNativeCapabilities,
}

/// Truthful result of handing an Apple Account connection to Screen Sharing.
///
/// Opening the external application is not evidence that the user completed
/// Apple Account authentication, two-factor approval, or a remote connection.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArdNativeHandoffResult {
    pub application_opened: bool,
    pub application: String,
    pub platform: String,
    pub connection_established: bool,
    pub accepts_password: bool,
    pub target_prefilled: bool,
}

impl ArdNativeHandoffResult {
    pub fn screen_sharing_opened() -> Self {
        Self {
            application_opened: true,
            application: "Screen Sharing".into(),
            platform: "macos".into(),
            connection_established: false,
            accepts_password: false,
            target_prefilled: false,
        }
    }
}

impl ArdRuntimeCapabilities {
    pub fn current() -> Self {
        let native_available = cfg!(target_os = "macos");
        Self {
            embedded_rfb: ArdEmbeddedRuntimeCapabilities {
                available: true,
                authentication_modes: vec![
                    ArdAuthenticationMode::MacOsAccount,
                    ArdAuthenticationMode::VncPassword,
                ],
                accepts_apple_account_credentials: false,
                supports_network_path: false,
                network_path_reason: "The embedded ARD engine currently opens a direct TCP connection and cannot consume proxy-chain or SSH-tunnel routes.".into(),
            },
            apple_account_native: ArdAppleAccountNativeCapabilities {
                available: native_available,
                requires_mac_os: true,
                accepts_password: false,
                target_prefill_supported: false,
                reason: if native_available {
                    "Apple Account connections open Apple's Screen Sharing app; authentication and approval remain in macOS. No documented target-prefill interface is used.".into()
                } else {
                    "Apple Account Screen Sharing requires Apple's Screen Sharing app on macOS.".into()
                },
            },
        }
    }
}

/// Capabilities reported after connecting to an ARD server.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArdCapabilities {
    pub authentication_mode: ArdAuthenticationMode,
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
    pub authentication_mode: ArdAuthenticationMode,
    pub connected_at: String,
    pub command_tx: mpsc::Sender<ArdCommand>,
    pub stats: Arc<ArdSessionStats>,
}

/// Metadata paired with one raw RGBA rectangle sent over a Tauri IPC channel.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum ArdFrameKind {
    Framebuffer,
    CopyRect { source_x: u16, source_y: u16 },
    Cursor,
    DesktopSize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArdFrameMetadata {
    pub session_id: String,
    pub sequence: u64,
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
    pub byte_length: usize,
    pub kind: ArdFrameKind,
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
#[derive(Debug, Default)]
pub struct ArdService {
    pub connections: HashMap<String, ArdActiveConnection>,
    pub log_buffer: Vec<ArdLogEntry>,
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

    #[test]
    fn runtime_capabilities_keep_apple_account_out_of_rfb() {
        let capabilities = ArdRuntimeCapabilities::current();
        assert!(capabilities.embedded_rfb.available);
        assert!(!capabilities.embedded_rfb.accepts_apple_account_credentials);
        assert!(!capabilities.embedded_rfb.supports_network_path);
        assert_eq!(
            capabilities.embedded_rfb.authentication_modes,
            vec![
                ArdAuthenticationMode::MacOsAccount,
                ArdAuthenticationMode::VncPassword,
            ]
        );
        assert!(!capabilities.apple_account_native.accepts_password);
        assert!(!capabilities.apple_account_native.target_prefill_supported);
        assert_eq!(
            capabilities.apple_account_native.available,
            cfg!(target_os = "macos")
        );
    }

    #[test]
    fn authentication_modes_have_unambiguous_wire_names() {
        assert_eq!(
            serde_json::to_string(&ArdAuthenticationMode::MacOsAccount).unwrap(),
            "\"macOsAccount\""
        );
        assert_eq!(
            serde_json::to_string(&ArdAuthenticationMode::AppleAccountNative).unwrap(),
            "\"appleAccountNative\""
        );
    }

    #[test]
    fn native_handoff_result_never_claims_authentication_or_connection() {
        let result = ArdNativeHandoffResult::screen_sharing_opened();
        assert!(result.application_opened);
        assert_eq!(result.application, "Screen Sharing");
        assert_eq!(result.platform, "macos");
        assert!(!result.connection_established);
        assert!(!result.accepts_password);
        assert!(!result.target_prefilled);

        let json = serde_json::to_value(result).unwrap();
        assert_eq!(json["applicationOpened"], true);
        assert_eq!(json["connectionEstablished"], false);
        assert_eq!(json["acceptsPassword"], false);
        assert_eq!(json["targetPrefilled"], false);
    }
}
