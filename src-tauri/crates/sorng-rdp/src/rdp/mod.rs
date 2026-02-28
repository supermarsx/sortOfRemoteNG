mod frame_store;
mod settings;
mod stats;
mod types;
mod network;
mod input;
mod session_runner;
mod frame_delivery;
// These must be pub(crate) because #[tauri::command] generates hidden
// __cmd__<name> symbols that the invoke handler needs to resolve.
pub(crate) mod commands;
pub(crate) mod diagnostics;

use std::sync::Arc;
use tokio::sync::Mutex;

// ---- Public type aliases ----
pub type RdpServiceState = Arc<Mutex<types::RdpService>>;

// ---- Re-exports: types visible to the rest of the crate ----
pub use frame_store::{SharedFrameStore, SharedFrameStoreState};
pub use types::{
    RdpService, RdpSession, RdpStatusEvent, RdpPointerEvent, RdpStatsEvent,
    RdpInputAction, RdpLogEntry,
};
pub use settings::RdpSettingsPayload;

// Re-export shared diagnostics types so the frontend API stays unchanged.
pub use sorng_core::diagnostics::{DiagnosticStep, DiagnosticReport};

// ---- Re-exports: all Tauri commands + hidden __cmd__ symbols ----
// Wildcard re-export is needed because #[tauri::command] generates
// companion __cmd__<name> items that the invoke handler resolves
// at the same module path as the function itself.
pub use commands::*;
pub use diagnostics::*;
