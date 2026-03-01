//! OpenVPN module root – re-exports public API surface.

pub mod types;
pub mod config;
pub mod process;
pub mod management;
pub mod tunnel;
pub mod auth;
pub mod routing;
pub mod dns;
pub mod logging;
pub mod service;
pub mod commands;

pub use types::*;
pub use service::{OpenVpnService, OpenVpnServiceState};
pub use commands::*;
