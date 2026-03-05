//! # sorng-updater
//!
//! Application auto-updater engine for SortOfRemote NG.
//!
//! Provides GitHub releases integration, semantic version comparison,
//! update channels (stable / beta / nightly), download with progress
//! tracking, signature verification, rollback support, release notes
//! display, and update scheduling.
//!
//! | Module       | Purpose                                           |
//! |--------------|---------------------------------------------------|
//! | `types`      | Data types, enums, and configuration structs       |
//! | `error`      | Error types for the updater                        |
//! | `version`    | Semantic version parsing, comparison, ordering     |
//! | `channels`   | Channel management and GitHub release filtering    |
//! | `checker`    | Update checking via the GitHub Releases API        |
//! | `downloader` | Download management with progress & cancellation   |
//! | `installer`  | Installation, backup creation, restart scheduling  |
//! | `rollback`   | Rollback and backup lifecycle management           |
//! | `service`    | Service façade (`UpdaterServiceState`)             |
//! | `commands`   | Tauri `#[command]` handlers                        |

pub mod channels;
pub mod checker;
pub mod commands;
pub mod downloader;
pub mod error;
pub mod installer;
pub mod rollback;
pub mod service;
pub mod types;
pub mod version;
