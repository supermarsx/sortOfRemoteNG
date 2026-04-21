//! ARD protocol module hub.
//!
//! Organises the sub-modules that together form the Apple Remote Desktop
//! protocol implementation.

mod auth;
mod clipboard;
mod encoding;
mod errors;
mod file_transfer;
mod input;
mod pixel_format;
mod rfb;
pub mod service {
    //! Re-export alias — commands.rs wrapper expects `service::ArdServiceState`.
    pub use super::ArdServiceState;
}
pub mod session_runner;
pub mod types;

use std::sync::Arc;
use tokio::sync::Mutex;
pub use types::{
    ArdActiveConnection, ArdCapabilities, ArdCommand, ArdInputAction, ArdLogEntry, ArdService,
    ArdSession, ArdSessionStats, ArdStatsEvent, ArdStatusEvent,
};

/// Global ARD service state, managed by Tauri.
pub type ArdServiceState = Arc<Mutex<ArdService>>;
