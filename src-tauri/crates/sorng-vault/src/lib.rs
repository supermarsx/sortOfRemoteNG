//! # SortOfRemote NG — Vault
//!
//! Cross-platform native OS vault/keychain integration.
//!
//! | Platform | Backend |
//! |----------|---------|
//! | Windows  | Credential Manager (`CredWriteW` / `CredReadW` / `CredDeleteW`) + DPAPI |
//! | macOS    | Keychain Services via `security-framework` |
//! | Linux    | Secret Service D-Bus protocol (GNOME Keyring / KDE Wallet) via CLI |
//!
//! ## Design
//!
//! The vault stores **named secrets** (key-value pairs).  Secrets are
//! addressed by a *service* name and an *account* name — matching the
//! model shared by all three platforms.
//!
//! Optionally, vault access can be **biometric-gated**: the caller asks
//! for a biometric prompt before reading a secret, and the returned
//! secret is additionally envelope-encrypted with a biometric-derived key.
//!
//! ## Crate layout
//!
//! - [`types`]     — shared types, errors
//! - [`keychain`]  — cross-platform store/read/delete API
//! - [`envelope`]  — AES-256-GCM envelope encryption with Argon2id KDF
//! - [`migration`] — migrate legacy plain-JSON storage into the vault
//! - [`commands`]  — Tauri `#[tauri::command]` entry-points

pub mod commands;
pub mod envelope;
pub mod keychain;
pub mod migration;
pub mod types;

mod platform;
