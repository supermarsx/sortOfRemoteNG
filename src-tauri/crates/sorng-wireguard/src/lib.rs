//! # sorng-wireguard
//!
//! Comprehensive WireGuard tunnel management crate. Provides config generation,
//! key management, interface lifecycle, peer management, DNS leak prevention,
//! route management, NAT keepalive, and diagnostics.

pub mod types;
pub mod service;
pub mod config;
pub mod interface;
pub mod peer;
pub mod key;
pub mod dns;
pub mod routing;
pub mod diagnostics;
pub mod nat;

pub use types::*;
pub use service::{WireGuardService, WireGuardServiceState};
