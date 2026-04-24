use std::collections::HashMap;
use std::sync::Mutex as StdMutex;
use tokio::sync::oneshot;

pub mod automation;
pub mod diagnostics;
pub mod fido2;
pub mod highlighting;
pub mod proxy_command;
pub mod recording;
pub mod service;
pub mod sk_keys;
pub mod tunnels;
pub mod types;
pub mod x11;

// Maximum buffer size in bytes (1MB)
pub const MAX_BUFFER_SIZE: usize = 1024 * 1024;

// Global terminal buffer storage
lazy_static::lazy_static! {
    pub static ref TERMINAL_BUFFERS: StdMutex<HashMap<String, String>> = StdMutex::new(HashMap::new());
}

// Global storage for active recordings
lazy_static::lazy_static! {
    pub static ref ACTIVE_RECORDINGS: StdMutex<HashMap<String, types::RecordingState>> = StdMutex::new(HashMap::new());
}

// Global storage for active automations
lazy_static::lazy_static! {
    pub static ref ACTIVE_AUTOMATIONS: StdMutex<HashMap<String, types::AutomationState>> = StdMutex::new(HashMap::new());
}

// Global storage for active highlight rule-sets (per session)
lazy_static::lazy_static! {
    pub static ref ACTIVE_HIGHLIGHTS: StdMutex<HashMap<String, types::HighlightState>> = StdMutex::new(HashMap::new());
}

// Global storage for pending host-key trust prompts keyed by provisional session id.
lazy_static::lazy_static! {
    pub static ref PENDING_HOST_KEY_PROMPTS: StdMutex<HashMap<String, oneshot::Sender<types::SshHostKeyPromptDecision>>> =
        StdMutex::new(HashMap::new());
}

// Global storage for active FTP tunnels
lazy_static::lazy_static! {
    pub static ref FTP_TUNNELS: StdMutex<HashMap<String, types::FtpTunnelStatus>> = StdMutex::new(HashMap::new());
}

// Global storage for active RDP tunnels
lazy_static::lazy_static! {
    pub static ref RDP_TUNNELS: StdMutex<HashMap<String, types::RdpTunnelStatus>> = StdMutex::new(HashMap::new());
}

// Global storage for active VNC tunnels
lazy_static::lazy_static! {
    pub static ref VNC_TUNNELS: StdMutex<HashMap<String, types::VncTunnelStatus>> = StdMutex::new(HashMap::new());
}

// Re-export everything so that `use crate::ssh::*` still works.

// All types
pub use types::*;

// Tunnel utility functions (status queries, listing, RDP file generation)
pub use tunnels::*;

// Service struct and helpers
#[allow(unused_imports)]
pub use service::generate_totp_code;
pub use service::SshService;
