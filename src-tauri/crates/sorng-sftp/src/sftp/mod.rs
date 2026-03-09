// ── sorng-sftp / sftp module ──────────────────────────────────────────────────
//
// Comprehensive SFTP service providing:
//   • Standalone session management (password / key / agent auth)
//   • Full remote-filesystem operations (stat, chmod, chown, symlink, …)
//   • Directory listing with rich metadata
//   • Chunked & resumable uploads / downloads with progress events
//   • Transfer queue with concurrency management
//   • File watching / sync helpers
//   • Bookmark / favourite-path management
//   • Tauri command bindings for the frontend

pub mod bookmarks;
pub mod commands;
pub mod diagnostics;
pub mod dir_ops;
pub mod file_ops;
pub mod queue;
pub mod service;
pub mod transfer;
pub mod types;
pub mod watch;

pub use commands::*;
pub use dir_ops::*;
pub use service::SftpService;
pub use types::*;
pub use watch::*;

use lazy_static::lazy_static;
use std::collections::HashMap;
use std::sync::Mutex as StdMutex;

lazy_static! {
    /// Progress tracking for active transfers (transfer_id → TransferProgress)
    pub static ref TRANSFER_PROGRESS: StdMutex<HashMap<String, TransferProgress>> =
        StdMutex::new(HashMap::new());

    /// Active file-watch subscriptions (watch_id → WatchState)
    pub static ref ACTIVE_WATCHES: StdMutex<HashMap<String, WatchState>> =
        StdMutex::new(HashMap::new());
}
