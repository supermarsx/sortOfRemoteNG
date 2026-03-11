//! # SortOfRemote NG – Nextcloud Integration
//!
//! Comprehensive Nextcloud API integration providing:
//!
//! - **Login Flow v2** — Device authorization with app-password generation
//! - **OAuth 2.0** — PKCE-based authorization flow with token refresh
//! - **Files** — Upload, download, move, copy, delete, versions, trash, previews (WebDAV)
//! - **Folders** — Create, list, recursive listing, filtering, sorting (WebDAV)
//! - **Sharing** — OCS Share API v1: public links, user/group/federated shares
//! - **Users** — Provisioning API: user info, quota, capabilities, notifications
//! - **Activity** — OCS Activity API: feed listing, file changes, filtering
//! - **Sync** — Local ↔ Nextcloud two-way folder synchronization
//! - **Backup** — Scheduled connection-config backups to Nextcloud
//! - **Watcher** — ETag-based file-change polling for Nextcloud folders

pub mod activity;
pub mod auth;
pub mod backup;
pub mod client;
pub mod files;
pub mod folders;
pub mod service;
pub mod sharing;
pub mod sync;
pub mod types;
pub mod users;
pub mod watcher;

pub use service::NextcloudServiceState;
