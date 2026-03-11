//! # sorng-cron — Cron / At / Anacron Job Management
//!
//! Comprehensive crate for managing scheduled tasks on Linux systems,
//! equivalent to Webmin's "Scheduled Cron Jobs" module.
//!
//! ## Capabilities
//!
//! ### User Crontab Management (crontab)
//! - List users with crontabs
//! - Read, write, backup, and restore per-user crontabs
//! - Add, remove, update, enable, disable individual jobs
//! - Parse crontab entries including comments, blank lines, and environment variables
//!
//! ### System Cron Management (/etc/cron.d/, /etc/crontab)
//! - List, read, create, update, delete files in /etc/cron.d/
//! - Manage periodic scripts in /etc/cron.{hourly,daily,weekly,monthly}
//! - Read and parse /etc/crontab
//!
//! ### At / Batch Job Scheduling
//! - List pending at jobs (atq)
//! - Inspect job details (at -c)
//! - Schedule one-time jobs (at) and load-aware jobs (batch)
//! - Remove scheduled jobs (atrm)
//! - Read at.allow / at.deny access control
//!
//! ### Anacron Management
//! - Parse and edit /etc/anacrontab
//! - Add, update, remove anacron entries
//! - Force-run anacron
//! - Read anacron timestamp files from /var/spool/anacron/
//!
//! ### Cron Expression Utilities
//! - Validate cron expressions (5-field)
//! - Calculate next N run times for an expression
//! - Human-readable description of cron schedules
//! - Preset aliases: @hourly, @daily, @weekly, @monthly, @yearly, @reboot
//!
//! ### Cron Access Control
//! - Read/write /etc/cron.allow and /etc/cron.deny
//! - Check per-user access

pub mod access;
pub mod anacron;
pub mod at_jobs;
pub mod client;
pub mod crontab;
pub mod error;
pub mod expression;
pub mod service;
pub mod system_cron;
pub mod types;
