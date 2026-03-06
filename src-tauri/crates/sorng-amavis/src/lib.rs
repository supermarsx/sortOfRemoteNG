// ── sorng-amavis – Amavis (amavisd-new) content filter management ────────────

pub mod types;
pub mod error;
pub mod client;
pub mod config;
pub mod policy_banks;
pub mod banned;
pub mod lists;
pub mod quarantine;
pub mod stats;
pub mod process;
pub mod service;
pub mod commands;
