// ── sorng-ups – UPS management via NUT ───────────────────────────────────────
//! SSH-based UPS management crate using Network UPS Tools (NUT).
//! Covers device discovery, status monitoring, battery health, outlet control,
//! scheduling, thresholds, testing, NUT configuration, and notifications.

pub mod types;
pub mod error;
pub mod client;
pub mod devices;
pub mod status;
pub mod battery;
pub mod events;
pub mod outlets;
pub mod scheduling;
pub mod thresholds;
pub mod testing;
pub mod configuration;
pub mod notifications;
pub mod service;
pub mod commands;
