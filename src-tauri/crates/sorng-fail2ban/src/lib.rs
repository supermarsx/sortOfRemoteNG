//! Fail2ban management crate for SortOfRemote NG.
//!
//! Provides jail management, ban/unban operations, filter rules,
//! log monitoring, whitelist/blacklist handling, status monitoring,
//! statistics, and Tauri command integration.

pub mod types;
pub mod error;
pub mod client;
pub mod jails;
pub mod bans;
pub mod filters;
pub mod actions;
pub mod whitelist;
pub mod logs;
pub mod stats;
pub mod service;
pub mod commands;
