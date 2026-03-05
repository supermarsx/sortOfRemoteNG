//! # SortOfRemote NG – Synology NAS Management
//!
//! Comprehensive Synology DiskStation Manager (DSM) management via the
//! SYNO.API REST interface.  Supports **DSM 6.x** and **DSM 7.x**.
//!
//! ## API Architecture
//!
//! All Synology APIs follow a unified CGI gateway pattern:
//!
//! ```text
//! GET/POST https://{host}:{port}/webapi/{cgi_path}?api={API}&version={N}&method={M}&_sid={SID}
//! ```
//!
//! The client auto-discovers available APIs, their CGI paths, and version
//! ranges via `SYNO.API.Info` at connect time, ensuring forward and
//! backward compatibility.
//!
//! ## Modules
//!
//! - **types**            — Synology-specific data structures
//! - **error**            — Error types with DSM error code mapping
//! - **client**           — HTTP client, session management, API discovery
//! - **auth**             — Login (password / 2FA / device token / PAT)
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

pub mod types;
pub mod error;
pub mod client;
pub mod auth;
pub mod system;
pub mod storage;
pub mod file_station;
pub mod shares;
pub mod network;
pub mod users;
pub mod packages;
pub mod services;
pub mod docker;
pub mod virtualization;
pub mod download_station;
pub mod surveillance;
pub mod backup;
pub mod security;
pub mod hardware;
pub mod logs;
pub mod notifications;
pub mod service;
pub mod commands;
