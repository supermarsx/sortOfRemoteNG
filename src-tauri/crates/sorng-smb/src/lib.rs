//! sorng-smb — SMB/CIFS client crate.
//!
//! # Design decision: pavao vs native
//!
//! The user decision at the top of `.orchestration/plans/t1.md` specified
//! the `pavao` Rust crate as the preferred SMB implementation, with a
//! fallback "to subprocess smbclient on Unix + UNC paths + std::fs on
//! Windows" if pavao fails to build on Windows.
//!
//! Evaluation outcome: **taking the fallback path**.
//!
//! `pavao` depends on `pavao-sys`, which binds to `libsmbclient` — Samba's
//! C library. libsmbclient is NOT available on Windows without bundling
//! Samba dev headers + libraries and wiring custom linker configuration.
//! That is an unreasonable dependency weight for a desktop Tauri app that
//! must build cleanly on Windows, Linux, and macOS out of the box.
//!
//! This crate therefore provides a unified `SmbService` API that splits
//! the implementation along platform lines:
//!
//! - **Windows** (`#[cfg(windows)]`): Uses native Windows SMB redirector via
//!   UNC paths (`\\server\share\path`) and `std::fs`. Share enumeration
//!   shells out to `net view \\server`.
//! - **Unix** (`#[cfg(unix)]`): Uses the `smbclient` CLI subprocess.
//!   Share enumeration uses `smbclient -L //server`; file ops use
//!   `smbclient //server/share -c "command"`.
//!
//! The public `smb::service::SmbService` API is identical on both platforms
//! so Tauri command wrappers (`commands.rs`) and the frontend hook
//! (`useSMBClient.ts`) are platform-agnostic.
//!
//! All blocking I/O (subprocess invocation, UNC file I/O) runs inside
//! `tokio::task::spawn_blocking` to avoid blocking the Tauri command
//! thread.

pub mod smb;
