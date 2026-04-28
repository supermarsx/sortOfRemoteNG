pub mod clipboard;
pub mod cert_trust;
pub mod errors;
pub mod rdpdr;
pub mod frame_channel;
mod frame_delivery;
pub mod frame_store;
pub mod input;
#[cfg(feature = "rdp-multimon")]
pub mod multimon;
mod network;
pub mod session_poller;
pub mod session_runner;
pub mod settings;
pub mod stats;
pub mod types;
pub mod audin;
pub mod commands;
pub mod diagnostics;
pub mod wake_channel;

use std::sync::Arc;
use tokio::sync::Mutex;

// ---- Public type aliases ----
pub type RdpServiceState = Arc<Mutex<types::RdpService>>;
pub type RdpTlsConfig = Arc<rustls::ClientConfig>;
pub type RdpTlsStream = rustls::StreamOwned<rustls::ClientConnection, std::net::TcpStream>;

// ---- Re-exports: types visible to consumers ----
pub use errors::RdpError;
pub use frame_store::{SharedFrameStore, SharedFrameStoreState};
pub use settings::RdpSettingsPayload;
pub use stats::ConnectionPhase;
pub use types::{
    ClipboardFileEntry, RdpActiveConnection, RdpCommand, RdpInputAction, RdpLogEntry,
    RdpPointerEvent, RdpService, RdpSession, RdpStatsEvent, RdpStatusEvent,
};

// Re-export shared diagnostics types so the frontend API stays unchanged.
pub use sorng_core::diagnostics::{DiagnosticReport, DiagnosticStep};
