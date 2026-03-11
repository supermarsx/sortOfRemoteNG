//! OpenVPN module root – re-exports public API surface.

pub mod auth;
pub mod config;
pub mod dns;
pub mod logging;
pub mod management;
pub mod process;
pub mod routing;
pub mod service;
pub mod tunnel;
pub mod types;

pub use service::{OpenVpnService, OpenVpnServiceState};
pub use types::*;
