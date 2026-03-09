// ── sorng-ups – UPS management via NUT ───────────────────────────────────────
//! SSH-based UPS management crate using Network UPS Tools (NUT).
//! Covers device discovery, status monitoring, battery health, outlet control,
//! scheduling, thresholds, testing, NUT configuration, and notifications.

pub mod battery;
pub mod client;
pub mod commands;
pub mod configuration;
pub mod devices;
pub mod error;
pub mod events;
pub mod notifications;
pub mod outlets;
pub mod scheduling;
pub mod service;
pub mod status;
pub mod testing;
pub mod thresholds;
pub mod types;
