//! Syslog management crate for SortOfRemote NG.
//!
//! Provides rsyslog, syslog-ng, and journald configuration management,
//! logrotate configuration, facility/severity utilities, centralized
//! remote log forwarding, log file listing, and Tauri integration.

pub mod client;
pub mod error;
pub mod facilities;
pub mod journald_conf;
pub mod log_files;
pub mod logrotate;
pub mod remote_logging;
pub mod rsyslog;
pub mod service;
pub mod syslog_ng;
pub mod types;
