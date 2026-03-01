//! # sorng-meshcentral — Comprehensive MeshCentral Integration
//!
//! Full client for the MeshCentral open-source remote device management platform.
//!
//! ## Capabilities
//!
//! - **Authentication** — username/password, login tokens, login keys, 2FA
//! - **Devices** — list, add (local/AMT), edit, remove, info, filter, move
//! - **Device Groups (Meshes)** — create, edit, remove, list, user permissions
//! - **Users** — add, edit, remove, list, sessions, info
//! - **User Groups** — create, remove, add/remove members
//! - **Remote Control** — shell commands, terminal access, desktop sharing
//! - **Power Management** — wake, sleep, reset, power off, Intel AMT
//! - **File Transfer** — upload, download with progress tracking
//! - **Events** — list events, real-time event streaming
//! - **Sharing** — create/remove/list device sharing links
//! - **Messaging** — toast, message box, open URL, broadcast
//! - **Agent Management** — download agents, send invite emails, generate invite links
//! - **Server** — server info, config, reporting
//!
//! ## Architecture
//!
//! - `types` — all data structures, enums, configuration
//! - `error` — MeshCentral-specific error type
//! - `api_client` — HTTP + WebSocket API transport
//! - `auth` — authentication handling
//! - `devices` — device CRUD and queries
//! - `device_groups` — device group (mesh) management
//! - `users` — user account management
//! - `user_groups` — user group management
//! - `remote` — remote shell/command execution
//! - `power` — power state management
//! - `files` — file upload/download
//! - `events` — event listing and streaming
//! - `sharing` — device share link management
//! - `messaging` — toast, message, broadcast, URL
//! - `agents` — agent download, invite management
//! - `server` — server info, config, reports
//! - `service` — high-level orchestrator (owns sessions)
//! - `commands` — thin `#[tauri::command]` wrappers

pub mod types;
pub mod error;
pub mod api_client;
pub mod auth;
pub mod devices;
pub mod device_groups;
pub mod users;
pub mod user_groups;
pub mod remote;
pub mod power;
pub mod files;
pub mod events;
pub mod sharing;
pub mod messaging;
pub mod agents;
pub mod server;
pub mod service;
pub mod commands;

// Re-exports
pub use types::*;
pub use error::{MeshCentralError, MeshCentralResult};
pub use service::{MeshCentralService, MeshCentralServiceState};
pub use commands::*;
