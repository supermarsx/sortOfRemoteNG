// ── sorng-php – PHP server management ────────────────────────────────────────
//! Comprehensive PHP management crate for remote Linux servers.
//! Covers PHP-FPM, php.ini, modules/extensions, OPcache, sessions,
//! Composer, error logging, version management, and process control.

pub mod client;
pub mod composer;
pub mod error;
pub mod fpm;
pub mod ini;
pub mod logs;
pub mod modules;
pub mod opcache;
pub mod process;
pub mod service;
pub mod sessions;
pub mod types;
pub mod versions;
