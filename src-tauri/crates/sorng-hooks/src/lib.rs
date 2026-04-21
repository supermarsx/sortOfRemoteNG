//! # sorng-hooks
//!
//! Hook and event engine crate for SortOfRemote NG.
//!
//! Provides lifecycle event dispatch, subscriber management,
//! async hook pipelines, event filtering, priority ordering,
//! and a cross-crate event bus.
//!
//! | Module        | Purpose                                        |
//! |---------------|------------------------------------------------|
//! | `types`       | Data types, enums, and configuration structs   |
//! | `error`       | Error types for the hook engine                |
//! | `engine`      | Core event dispatch engine                     |
//! | `pipeline`    | Multi-step pipeline execution                  |
//! | `subscribers` | Subscriber registry and builder                |
//! | `filters`     | Event filtering logic and builder              |
//! | `service`     | Service façade (`HookServiceState`)            |
//! | `commands`    | Tauri `#[command]` handlers                    |

pub mod engine;
pub mod error;
pub mod filters;
pub mod pipeline;
pub mod service;
pub mod subscribers;
pub mod types;
