//! # SortOfRemote NG – Google Drive Integration
//!
//! Comprehensive Google Drive API v3 integration for cloud file management,
//! collaboration, and remote resource sharing.
//!
//! ## Features
//!
//! - **OAuth2 Authentication** – token management, refresh flow, scope selection
//! - **File Management** – list, get, create, copy, update, delete, trash, untrash
//! - **Uploads** – simple, multipart, and resumable uploads with progress
//! - **Downloads** – binary downloads and Google Workspace exports
//! - **Folder Management** – create, list children, move, nested folder trees
//! - **Sharing & Permissions** – create, list, get, update, delete permissions
//! - **Revisions** – list, get, update, delete file revisions
//! - **Comments & Replies** – full comment/reply CRUD
//! - **Shared Drives** – create, list, get, update, delete, hide/unhide
//! - **Change Tracking** – monitor file changes with page tokens
//! - **Search** – build queries with Drive query syntax

pub mod types;
pub mod client;
pub mod auth;
pub mod files;
pub mod folders;
pub mod uploads;
pub mod downloads;
pub mod sharing;
pub mod revisions;
pub mod comments;
pub mod drives;
pub mod changes;
pub mod search;
pub mod service;
pub mod commands;
