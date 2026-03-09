//! # sorng-zerotier
//!
//! Comprehensive ZeroTier network management crate. Provides daemon lifecycle,
//! network join/leave/config, peer management, flow rules, self-hosted
//! controller API, DNS, and diagnostics.

pub mod controller;
pub mod daemon;
pub mod diagnostics;
pub mod dns;
pub mod network;
pub mod peer;
pub mod rules;
pub mod service;
pub mod types;

pub use service::{ZeroTierService, ZeroTierServiceState};
pub use types::*;
