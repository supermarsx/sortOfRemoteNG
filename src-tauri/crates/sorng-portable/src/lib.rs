//! # sorng-portable
//!
//! Portable mode support for SortOfRemote NG.
//!
//! Provides relative data storage, USB-friendly deployment, data directory
//! management, migration between portable and installed modes, and
//! environment detection.
//!
//! | Module      | Purpose                                          |
//! |-------------|--------------------------------------------------|
//! | `types`     | Data types: PortableMode, PortableConfig, etc.   |
//! | `error`     | Error types for portable operations               |
//! | `detector`  | Mode detection and drive information               |
//! | `paths`     | Path resolution and directory management           |
//! | `migration` | Migration between portable and installed modes     |
//! | `service`   | Service façade (`PortableServiceState`)            |
//! | `commands`  | Tauri `#[command]` handlers                       |

pub mod commands;
pub mod detector;
pub mod error;
pub mod migration;
pub mod paths;
pub mod service;
pub mod types;
