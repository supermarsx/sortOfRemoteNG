//! Bitwarden integration crate: sub-modules.
//!
//! Provides a comprehensive Bitwarden password manager integration with:
//! - CLI bridge for `bw` executable operations (login, unlock, sync)
//! - REST API client for `bw serve` local vault management API
//! - Direct API client for Bitwarden server endpoints (organizations)
//! - Vault item CRUD (logins, secure notes, cards, identities)
//! - Password generation and strength analysis
//! - Credential import/export and cross-format conversion
//! - Sync engine for keeping local caches up to date
//! - TOTP code generation from stored vault items

pub mod types;
pub mod crypto;
pub mod cli;
pub mod api;
pub mod vault;
pub mod sync;
pub mod generate;
pub mod service;
pub mod commands;

// Re-export top-level items for convenience.
pub use types::*;
pub use service::{BitwardenService, BitwardenServiceState};
pub use commands::*;
