//! # SortOfRemote NG – Authentication
//!
//! Authentication, security, credential management, and access control services.

pub mod auth;
pub mod auto_lock;
pub mod bearer_auth;
#[cfg(feature = "cert-auth")]
pub mod cert_auth;
#[cfg(not(feature = "cert-auth"))]
#[path = "cert_auth_stub.rs"]
pub mod cert_auth;
pub mod cert_gen;
pub mod legacy_crypto;
pub mod login_detection;
pub mod passkey;
pub mod security;
pub mod two_factor;
