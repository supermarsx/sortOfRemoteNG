//! # sorng-wireguard
//!
//! Comprehensive WireGuard tunnel management crate. Provides config generation,
//! key management, interface lifecycle, peer management, DNS leak prevention,
//! route management, NAT keepalive, and diagnostics.

pub mod config;
pub mod diagnostics;
pub mod dns;
pub mod interface;
pub mod key;
pub mod nat;
pub mod peer;
pub mod routing;
pub mod service;
pub mod types;

pub use service::{WireGuardService, WireGuardServiceState};
pub use types::*;
