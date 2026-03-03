//! # sorng-ssh-scripts
//!
//! Action-based and event-based SSH script execution engine.
//!
//! Provides a comprehensive framework for running scripts triggered by SSH
//! lifecycle events (login, logout, reconnect, idle, errors), scheduled timers,
//! cron expressions, output pattern matching, file-change watchers, and
//! manual invocation.

pub mod types;
pub mod error;
pub mod store;
pub mod engine;
pub mod scheduler;
pub mod conditions;
pub mod variables;
pub mod hooks;
pub mod history;
pub mod commands;
