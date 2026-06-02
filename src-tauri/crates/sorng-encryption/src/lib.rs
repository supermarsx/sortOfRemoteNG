//! # sorng-encryption — application-wide encryption-at-rest
//!
//! The cross-cutting layer that sits *between* the low-level primitives in
//! `sorng-vault` (Argon2id + AES-256-GCM envelope, OS keychain backends)
//! and the *per-artifact* writers (`settings.json`, `recording/**`,
//! `backup/**`, logs, macros). It owns:
//!
//! - the **master DEK** in memory (`MasterDek`, [`Zeroizing`]-wrapped 32 bytes),
//! - the **HKDF-SHA256 sub-key derivation** for each artifact, with a stable
//!   `"sorng-v1::<artifact>"` label,
//! - the **file envelope codec** — a 64-byte unencrypted preamble followed by
//!   an AES-256-GCM ciphertext + tag. The preamble carries the magic /
//!   version / master-key-storage mode / Argon2id parameters / DEK-envelope
//!   nonce so the unlock screen knows *how* to ask for credentials without
//!   decrypting anything first,
//! - the **`EncryptionState`** shared across all Tauri windows (master DEK
//!   plus the user's mode policy),
//! - the **Tauri command surface** (`encryption_setup`, `encryption_unlock`,
//!   `encryption_lock`, `encryption_status`).
//!
//! This crate intentionally does **not** know about specific files or
//! artifacts. Phase 1 (settings) plugs in by depending on this crate and
//! reading/writing through [`envelope::read_envelope`] /
//! [`envelope::write_envelope`] using
//! `state.subkey(ArtifactKind::Settings)`.
//!
//! ## Key hierarchy at a glance
//!
//! ```text
//!  OS vault entry              ┌─ MasterDek (32 random bytes, Zeroizing)
//!   master-dek (vault mode)   ─┤
//!   wrapped-dek (pw / hybrid) ─┘   │
//!                                  │ HKDF-SHA256(ikm=master, info="sorng-v1::<artifact>")
//!                                  ▼
//!                              SubKey (32 bytes) — used to AES-256-GCM
//!                                                  each artifact's file.
//! ```
//!
//! See [`ArtifactKind`] for the closed set of labels — adding a new
//! artifact means extending the enum and bumping nothing else.

pub mod artifacts;
pub mod audit;
pub mod commands;
pub mod dek;
pub mod envelope;
pub mod lockout;
pub mod log_adapter;
pub mod log_sink;
pub mod password_wrap;
pub mod state;

pub use dek::{ArtifactKind, MasterDek, SubKey};
pub use envelope::{EnvelopeError, EnvelopeHeader, MasterKeyStorage};
pub use lockout::{LockoutState, LOCKOUT_FILENAME};
pub use password_wrap::{Argon2Params, WrapError};
pub use state::EncryptionState;

/// Tauri command names this crate exposes. Used by the invoke handler in
/// `sorng-commands-core` to route incoming IPC.
pub const COMMAND_NAMES: &[&str] = &[
    "encryption_status",
    "encryption_setup",
    "encryption_unlock",
    "encryption_lock",
    "encryption_change_password",
    "encryption_migrate_settings",
    "encryption_lockout_state",
    "encryption_disable_settings",
    "encryption_rotate_master_key",
    "encryption_export_portable_dek",
    "encryption_import_portable_dek",
    "encryption_audit_read",
    "encryption_audit_clear",
];

/// Returns `true` if the given Tauri command name belongs to this crate.
/// Mirror of the `is_command` pattern used by the existing
/// `sorng-commands-*` crates.
pub fn is_command(name: &str) -> bool {
    COMMAND_NAMES.contains(&name)
}
