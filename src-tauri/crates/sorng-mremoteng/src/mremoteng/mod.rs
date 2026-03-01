//! # sorng-mremoteng — mRemoteNG Connection Import/Export
//!
//! Full implementation of mRemoteNG connection file formats:
//! - **XML confCons.xml** — hierarchical connection tree (read & write)
//! - **CSV** — flat export/import in mRemoteNG format
//! - **RDP files** — Microsoft .rdp file import
//! - **PuTTY sessions** — Windows registry import
//! - **Encryption** — AES-256-GCM with PBKDF2 key derivation
//!
//! Architecture:
//! - `types` — all data structures, enums, connection model
//! - `error` — mRemoteNG-specific error type
//! - `encryption` — AES-GCM encrypt/decrypt with PBKDF2
//! - `xml_parser` — XML confCons.xml reader (deserializer)
//! - `xml_writer` — XML confCons.xml writer (serializer)
//! - `csv_parser` — CSV import
//! - `csv_writer` — CSV export
//! - `rdp_parser` — .rdp file import
//! - `putty_parser` — PuTTY session import (registry-based)
//! - `converter` — mRemoteNG ↔ app Connection model mapping
//! - `service` — high-level orchestrator
//! - `commands` — thin `#[tauri::command]` wrappers

pub mod types;
pub mod error;
pub mod encryption;
pub mod xml_parser;
pub mod xml_writer;
pub mod csv_parser;
pub mod csv_writer;
pub mod rdp_parser;
pub mod putty_parser;
pub mod converter;
pub mod service;
pub mod commands;

// Re-exports
pub use types::*;
pub use error::{MremotengError, MremotengResult};
pub use service::MremotengService;
pub use commands::*;
