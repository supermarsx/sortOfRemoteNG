//! # SortOfRemote NG — Biometrics
//!
//! Cross-platform biometric authentication using **native OS APIs**:
//!
//! | Platform | Mechanism |
//! |----------|-----------|
//! | Windows  | Windows Hello / `UserConsentVerifier` via WinRT |
//! | macOS    | Touch ID / `LocalAuthentication` via `security-framework` |
//! | Linux    | `polkit` agent + `fprintd` D-Bus fingerprint service |
//!
//! ## Crate layout
//!
//! - [`availability`] — detect whether biometric hardware is present
//! - [`authenticate`] — prompt the user for biometric verification
//! - [`types`]        — shared types, errors, results
//! - [`platform`]     — per-OS implementation details (private)
//! - [`commands`]     — Tauri `#[tauri::command]` entry-points

pub mod types;
pub mod availability;
pub mod authenticate;
pub mod platform;
pub mod commands;
