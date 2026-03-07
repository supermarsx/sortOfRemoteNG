// ── sorng-php – PHP server management ────────────────────────────────────────
//! Comprehensive PHP management crate for remote Linux servers.
//! Covers PHP-FPM, php.ini, modules/extensions, OPcache, sessions,
//! Composer, error logging, version management, and process control.

pub mod types;
pub mod error;
pub mod client;
pub mod versions;
pub mod fpm;
pub mod ini;
pub mod modules;
pub mod opcache;
pub mod sessions;
pub mod composer;
pub mod logs;
pub mod process;
pub mod service;
pub mod commands;
