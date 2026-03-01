//! # SortOfRemote NG – Dropbox Integration
//!
//! Comprehensive Dropbox API v2 integration providing:
//!
//! - **OAuth 2.0** — PKCE-based authorization flow with token refresh
//! - **Files** — Upload, download, move, copy, delete, search, versioning
//! - **Folders** — Create, list, recursive listing, batch operations
//! - **Sharing** — Shared links, folder sharing, member management
//! - **Account** — User info, space usage, feature checks
//! - **Team** — Team info, member management (Business accounts)
//! - **Paper** — Document CRUD, export, folder management
//! - **Sync** — Local ↔ Dropbox two-way folder synchronization
//! - **Backup** — Scheduled connection-config backups to Dropbox
//! - **Watcher** — File-change polling for Dropbox folders

pub mod types;
pub mod client;
pub mod auth;
pub mod files;
pub mod folders;
pub mod sharing;
pub mod account;
pub mod team;
pub mod paper;
pub mod sync;
pub mod backup;
pub mod watcher;
pub mod service;
pub mod commands;

pub use service::DropboxServiceState;
