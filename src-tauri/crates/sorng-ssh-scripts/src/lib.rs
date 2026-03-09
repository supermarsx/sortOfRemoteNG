//! # sorng-ssh-scripts
//!
//! Action-based and event-based SSH script execution engine.
//!
//! Provides a comprehensive framework for running scripts triggered by SSH
//! lifecycle events (login, logout, reconnect, idle, errors), scheduled timers,
//! cron expressions, output pattern matching, file-change watchers, and
//! manual invocation.

pub mod commands;
pub mod conditions;
pub mod engine;
pub mod error;
pub mod history;
pub mod hooks;
pub mod scheduler;
pub mod store;
pub mod types;
pub mod variables;
