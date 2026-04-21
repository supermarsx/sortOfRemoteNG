//! # sorng-onedrive — Microsoft OneDrive / SharePoint Integration
//!
//! Comprehensive OneDrive and SharePoint client for SortOfRemote NG.
//! Built against the **Microsoft Graph API v1.0** specification.
//!
//! ## Capabilities
//!
//! - **OAuth2 Authentication** – authorization-code + PKCE, device-code,
//!   client-credentials, and silent token refresh flows via Microsoft
//!   identity platform v2.0.
//! - **Files & Folders** – create, read, update, rename, move, copy, delete,
//!   restore from recycle bin, list children, download, and preview.
//! - **Uploads** – simple PUT for files ≤ 4 MiB and resumable  upload
//!   sessions for arbitrarily large files with progress callbacks.
//! - **Sharing** – create anonymous / organization links, send invitations,
//!   resolve share tokens, list shared-with-me items.
//! - **Permissions** – list, get, update roles, and remove permissions on
//!   individual drive items.
//! - **Search** – full-text and metadata search, recent items, folder-scoped
//!   search, cross-drive search.
//! - **Delta Sync** – incremental change tracking via the delta query for
//!   efficient local cache synchronisation.
//! - **Drives** – enumerate personal, shared, site, and group drives.
//! - **Special Folders** – Documents, Photos, Camera Roll, App Root, Music.
//! - **Thumbnails** – list, download, and custom-crop / scale thumbnails.
//! - **Webhooks** – create, renew, delete Graph subscriptions for real-time
//!   change notifications.
//! - **Versions** – list file versions, download specific versions, restore
//!   previous versions.

pub mod api_client;
pub mod auth;
pub mod drives;
pub mod error;
pub mod files;
pub mod permissions;
pub mod search;
pub mod service;
pub mod sharing;
pub mod special_folders;
pub mod sync_engine;
pub mod thumbnails;
pub mod types;
pub mod webhooks;

// Re-exports
pub use error::{OneDriveError, OneDriveResult};
pub use service::{OneDriveService, OneDriveServiceState};
pub use types::*;
