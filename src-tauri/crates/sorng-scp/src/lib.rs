//! # SortOfRemote NG – SCP
//!
//! Secure Copy Protocol (SCP) file transfer service providing:
//!   • Session management with password / key / agent authentication
//!   • Single-file SCP upload & download with chunked I/O
//!   • Progress tracking with speed & ETA calculation
//!   • Recursive directory upload / download
//!   • Batch transfer operations
//!   • Transfer queue with priority and concurrency control
//!   • SHA-256 checksum verification
//!   • Transfer history with persistence
//!   • Connection diagnostics and bandwidth estimation
//!   • Tauri command bindings for the frontend

pub mod scp;
