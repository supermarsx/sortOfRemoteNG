//! Apple Remote Desktop protocol – top-level module.
//!
//! Ties together VNC/RFB transport, Apple-specific authentication, screen
//! encoding, input events, clipboard, file transfer, and Tauri commands.

mod auth;
mod clipboard;
mod encoding;
mod errors;
mod file_transfer;
mod input;
mod pixel_format;
mod rfb;
mod session_runner;
mod types;

// Commands & diagnostics must be pub(crate) so the generated __cmd__ symbols
// from #[tauri::command] are reachable by the invoke handler.
pub(crate) mod commands;
pub(crate) mod diagnostics;

use std::sync::Arc;
use tokio::sync::Mutex;

// ── Public type aliases ──────────────────────────────────────────────────

pub type ArdServiceState = Arc<Mutex<types::ArdService>>;

// ── Re-exports ───────────────────────────────────────────────────────────

pub use types::{
    ArdService, ArdSession, ArdStatusEvent, ArdStatsEvent,
    ArdInputAction, ArdLogEntry, ArdCapabilities,
};

pub use sorng_core::diagnostics::{DiagnosticStep, DiagnosticReport};

pub use commands::*;
pub use diagnostics::*;
