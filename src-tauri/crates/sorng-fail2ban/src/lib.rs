//! Fail2ban management crate for SortOfRemote NG.
//!
//! Provides jail management, ban/unban operations, filter rules,
//! log monitoring, whitelist/blacklist handling, status monitoring,
//! statistics, and Tauri command integration.

pub mod actions;
pub mod bans;
pub mod client;
pub mod error;
pub mod filters;
pub mod jails;
pub mod logs;
pub mod service;
pub mod stats;
pub mod types;
pub mod whitelist;
