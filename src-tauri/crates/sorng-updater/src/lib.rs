//! Backend-owned facade over `tauri-plugin-updater`.
//!
//! The Tauri updater plugin is the only production-authoritative path for
//! checking, downloading, signature verification, and installation. This crate
//! owns settings/status state and exposes app-specific commands so frontend code
//! does not call the plugin directly.

pub mod commands;
pub mod error;
pub mod service;
pub mod types;
