//! Passbolt integration crate: sub-modules.
//!
//! Provides a comprehensive Passbolt password manager integration with:
//! - REST API client for Passbolt server (v5.x compatible)
//! - GPGAuth and JWT-based authentication flows
//! - OpenPGP encryption, decryption, signing operations
//! - Resource (password) CRUD with encrypted metadata (v4/v5)
//! - Secret retrieval and client-side decryption
//! - Folder management with hierarchical tree support
//! - User and Group administration
//! - Sharing and permission management (ACL)
//! - Comment threads on resources
//! - Tag management (personal and shared)
//! - Metadata keys, private keys, session keys, rotation, and upgrades
//! - Multi-Factor Authentication (TOTP/Yubikey)
//! - Healthcheck and server settings

pub mod api_client;
pub mod auth;
pub mod commands;
pub mod comments;
pub mod crypto;
pub mod folders;
pub mod healthcheck;
pub mod metadata;
pub mod resources;
pub mod secrets;
pub mod service;
pub mod sharing;
pub mod tags;
pub mod types;
pub mod users_groups;

// Re-export top-level items for convenience.
pub use commands::*;
pub use service::{PassboltService, PassboltServiceState};
pub use types::*;
