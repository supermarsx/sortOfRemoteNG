// ── sorng-clamav – ClamAV antivirus management ──────────────────────────────

pub mod types;
pub mod error;
pub mod client;
pub mod scanning;
pub mod database;
pub mod quarantine;
pub mod clamd_config;
pub mod freshclam_config;
pub mod on_access;
pub mod milter;
pub mod scheduled;
pub mod process;
pub mod service;
pub mod commands;
