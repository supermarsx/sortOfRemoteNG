//! PAM (Pluggable Authentication Modules) management crate for SortOfRemote NG.
//!
//! Provides comprehensive PAM management including:
//! - PAM service configuration (`/etc/pam.d/`)
//! - PAM module discovery and inspection
//! - Security limits (`/etc/security/limits.conf`)
//! - Access control rules (`/etc/security/access.conf`)
//! - Time-based access control (`/etc/security/time.conf`)
//! - Password quality configuration (`/etc/security/pwquality.conf`)
//! - Namespace/polyinstantiation (`/etc/security/namespace.conf`)
//! - Login defaults (`/etc/login.defs`)

pub mod access;
pub mod client;
pub mod error;
pub mod limits;
pub mod login_defs;
pub mod modules;
pub mod namespace;
pub mod pwquality;
pub mod service;
pub mod services;
pub mod time_conf;
pub mod types;
