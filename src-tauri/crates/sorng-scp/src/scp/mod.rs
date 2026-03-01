// ── sorng-scp / scp module ────────────────────────────────────────────────────
//
// Comprehensive SCP (Secure Copy Protocol) service providing:
//   • Standalone session management (password / key / agent auth)
//   • Single-file SCP upload & download with chunked I/O and progress events
//   • Recursive directory upload / download (using exec + tar fallback)
//   • Batch transfer with concurrency control
//   • Transfer queue with priority ordering
//   • SHA-256 integrity verification
//   • Transfer history with optional persistence
//   • Connection diagnostics & bandwidth estimation
//   • Tauri command bindings for the frontend

pub mod types;
pub mod service;
pub mod commands;
pub mod transfer;
pub mod batch;
pub mod queue;
pub mod history;
pub mod diagnostics;

pub use types::*;
pub use service::ScpService;
pub use commands::*;

use lazy_static::lazy_static;
use std::collections::HashMap;
use std::sync::Mutex as StdMutex;

lazy_static! {
    /// Progress tracking for active transfers (transfer_id → ScpTransferProgress)
    pub static ref SCP_TRANSFER_PROGRESS: StdMutex<HashMap<String, ScpTransferProgress>> =
        StdMutex::new(HashMap::new());

    /// Transfer history (transfer_id → ScpTransferRecord)
    pub static ref SCP_TRANSFER_HISTORY: StdMutex<Vec<ScpTransferRecord>> =
        StdMutex::new(Vec::new());
}
