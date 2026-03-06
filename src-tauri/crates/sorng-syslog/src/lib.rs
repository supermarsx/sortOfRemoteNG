//! Syslog management crate for SortOfRemote NG.
//!
//! Provides rsyslog, syslog-ng, and journald configuration management,
//! logrotate configuration, facility/severity utilities, centralized
//! remote log forwarding, log file listing, and Tauri integration.

pub mod types;
pub mod error;
pub mod client;
pub mod service;
pub mod rsyslog;
pub mod syslog_ng;
pub mod journald_conf;
pub mod logrotate;
pub mod facilities;
pub mod remote_logging;
pub mod log_files;
