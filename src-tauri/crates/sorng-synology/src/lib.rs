//! # SortOfRemote NG – Synology NAS Management
//!
//! Comprehensive Synology DiskStation Manager (DSM) management via the
//! SYNO.API REST interface. API discovery determines available DSM capabilities;
//! optional administrator APIs still depend on NAS firmware and permissions.
//!
//! ## API Architecture
//!
//! All Synology APIs follow a unified CGI gateway pattern:
//!
//! ```text
//! POST https://{host}:{port}/webapi/{cgi_path}?api={API}&version={N}&method={M}
//! ```
//!
//! Credentials and session tokens are POST fields, never URL query parameters.
//! The client discovers available APIs, paths, and versions via `SYNO.API.Info`.
//! Named instances require an exact receipt and never fall back to another NAS.
//!
//! ## Modules
//!
//! - **types**            — Synology-specific data structures
//! - **error**            — Error types with DSM error code mapping
//! - **client**           — HTTP client, session management, API discovery
//! - **auth**             — Login (password / one-time code / legacy SID reuse)
//! - **system**           — System info, DSM info, utilization, processes
//! - **storage**          — Volumes, pools, disks, SMART, iSCSI, SSD cache
//! - **file_station**     — File management, upload, download, sharing
//! - **shares**           — Shared folders, permissions, encryption
//! - **network**          — Interfaces, bonds, DNS, DHCP, firewall, VPN
//! - **users**            — Users, groups, quotas
//! - **packages**         — Package management (list, install, start/stop)
//! - **services**         — SMB, NFS, FTP, SSH, rsync, WebDAV
//! - **docker**           — Container Manager / Docker (containers, images, Compose)
//! - **virtualization**   — Virtual Machine Manager (VMs, snapshots)
//! - **download_station** — Download tasks (HTTP/FTP/BT)
//! - **surveillance**     — Surveillance Station (cameras, recordings, PTZ)
//! - **backup**           — Hyper Backup + Active Backup
//! - **security**         — Firewall, auto-block, certificates, Let's Encrypt
//! - **hardware**         — Fans, UPS, LEDs, power schedule
//! - **logs**             — System logs, connections, transfers
//! - **notifications**    — Email, SMS, push notification config
//! - **service**          — Aggregate facade + Tauri state alias
//! - **commands**         — `#[tauri::command]` handlers

pub mod auth;
pub mod backup;
pub mod client;
pub mod docker;
pub mod download_station;
pub mod error;
pub mod file_station;
pub mod file_transfer;
pub mod file_viewers;
pub mod hardware;
pub mod http_route;
pub mod instances;
pub mod logs;
pub mod network;
pub mod notifications;
pub mod packages;
mod quickconnect;
mod response_diagnostics;
pub mod scoped_files;
pub mod section_access;
pub mod security;
pub mod service;
pub mod services;
pub mod shares;
pub mod storage;
pub mod surveillance;
pub mod system;
pub mod types;
pub mod users;
pub mod viewer_host;
pub mod virtualization;

#[cfg(test)]
mod scoped_files_tests;

#[cfg(test)]
mod file_transfer_tests;

#[cfg(test)]
mod response_diagnostics_tests;

#[cfg(test)]
mod quickconnect_tests;
