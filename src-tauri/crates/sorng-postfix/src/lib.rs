// ── sorng-postfix – Postfix MTA management ───────────────────────────────────

pub mod types;
pub mod error;
pub mod client;
pub mod config;
pub mod domains;
pub mod aliases;
pub mod transport;
pub mod queue;
pub mod tls;
pub mod restrictions;
pub mod milters;
pub mod process;
pub mod logs;
pub mod service;
pub mod commands;
