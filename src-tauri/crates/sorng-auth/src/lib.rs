//! # SortOfRemote NG – Authentication
//!
//! Authentication, security, credential management, and access control services.

pub mod auth;
pub mod auto_lock;
pub mod biometrics_macos;
pub mod bearer_auth;
#[cfg(feature = "cert-auth")]
pub mod cert_auth;
#[cfg(not(feature = "cert-auth"))]
#[path = "cert_auth_stub.rs"]
pub mod cert_auth;
pub mod cert_gen;
pub mod cryptojs_compat;
pub mod legacy_crypto;
pub mod login_detection;
pub mod passkey;
pub mod password;
pub mod security;
pub mod two_factor;
