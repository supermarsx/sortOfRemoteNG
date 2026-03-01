//! # SortOfRemote NG – Terminal Services Management
//!
//! Comprehensive management of Windows Terminal Services / Remote Desktop
//! Services (RDS) via the native WTS API (`wtsapi32.dll`). Provides:
//!
//! - **Session Management** – enumerate, disconnect, logoff, connect, query
//!   detailed session information (user, client, timing, bandwidth)
//! - **Process Management** – list processes per session, terminate, launch
//! - **Server Management** – open/close remote RD Session Host servers,
//!   enumerate servers in a domain, shutdown/reboot
//! - **Shadow / Remote Control** – start/stop remote control of sessions
//! - **Messaging** – send interactive messages to session desktops
//! - **Listeners** – enumerate and query RDS listener configuration
//! - **User Configuration** – query/set per-user Terminal Services settings

pub mod types;

#[cfg(windows)]
pub mod wts_ffi;

#[cfg(windows)]
pub mod sessions;

#[cfg(windows)]
pub mod processes;

#[cfg(windows)]
pub mod server;

#[cfg(windows)]
pub mod shadow;

#[cfg(windows)]
pub mod messaging;

#[cfg(windows)]
pub mod listeners;

pub mod service;
pub mod commands;
