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
mod session_runner;
mod types;

pub(crate) mod commands;
pub(crate) mod diagnostics;

use std::sync::Arc;
use tokio::sync::Mutex;

pub use commands::*;
pub use diagnostics::*;
pub use types::{
    ArdActiveConnection, ArdCapabilities, ArdCommand, ArdInputAction, ArdLogEntry, ArdService,
    ArdSession, ArdSessionStats, ArdStatusEvent, ArdStatsEvent,
};

/// Global ARD service state, managed by Tauri.
pub type ArdServiceState = Arc<Mutex<ArdService>>;
