//! # sorng-ftp — Comprehensive FTP/FTPS Client
//!
//! Full implementation of the FTP protocol (RFC 959) with extensions:
//! - **RFC 2228 / 4217** — AUTH TLS / FTPS (Explicit & Implicit)
//! - **RFC 3659** — Extensions: MLSD/MLST, SIZE, MDTM, REST STREAM
//! - **RFC 2389** — FEAT negotiation
//! - **RFC 2428** — EPSV / EPRT (IPv6-ready)
//!
//! Architecture:
//! - `types` — all data structures, enums, config
//! - `error` — FTP-specific error type
//! - `protocol` — low-level command/response codec
//! - `connection` — TCP + TLS transport
//! - `client` — stateful FTP client (login, CWD, TYPE, etc.)
//! - `parser` — Unix/Windows/MLSD LIST response parsing
//! - `transfer` — data channel management (PASV/EPSV/PORT/EPRT)
//! - `tls` — TLS upgrade and FTPS configuration
//! - `directory` — directory listing, mkdir, rmdir, rename
//! - `file_ops` — upload, download, append, delete, resume
//! - `pool` — connection pool with idle reaping
//! - `queue` — transfer queue with concurrency + retry + progress
//! - `service` — high-level orchestrator (owns sessions, pool, queue)
//! - `commands` — thin `#[tauri::command]` wrappers

pub mod types;
pub mod error;
pub mod protocol;
pub mod connection;
pub mod client;
pub mod parser;
pub mod transfer;
pub mod tls;
pub mod directory;
pub mod file_ops;
pub mod pool;
pub mod queue;
pub mod service;
pub mod commands;

// Re-exports for lib.rs consumers
pub use types::*;
pub use error::{FtpError, FtpResult};
pub use service::{FtpService, FtpServiceState};
pub use commands::*;

use lazy_static::lazy_static;
use std::collections::HashMap;
use std::sync::Mutex as StdMutex;

lazy_static! {
    /// Global transfer progress map, keyed by transfer_id.
    pub static ref TRANSFER_PROGRESS: StdMutex<HashMap<String, TransferProgress>> =
        StdMutex::new(HashMap::new());
}
