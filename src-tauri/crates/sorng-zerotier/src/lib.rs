//! # sorng-zerotier
//!
//! Comprehensive ZeroTier network management crate. Provides daemon lifecycle,
//! network join/leave/config, peer management, flow rules, self-hosted
//! controller API, DNS, and diagnostics.

pub mod types;
pub mod service;
pub mod daemon;
pub mod network;
pub mod peer;
pub mod rules;
pub mod controller;
pub mod dns;
pub mod diagnostics;

pub use types::*;
pub use service::{ZeroTierService, ZeroTierServiceState};
