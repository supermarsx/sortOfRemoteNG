//! # sorng-extensions
//!
//! Extensions engine crate for SortOfRemote NG.
//!
//! Provides a manifest-driven, sandboxed extension system with
//! permission enforcement, lifecycle management, hook dispatch,
//! per-extension storage, a JSON-based script runtime, and a
//! comprehensive API surface.
//!
//! | Module        | Purpose                                      |
//! |---------------|----------------------------------------------|
//! | `types`       | Data types, errors, and enumerations          |
//! | `manifest`    | Manifest parsing and validation               |
//! | `permissions` | Permission checking and enforcement           |
//! | `sandbox`     | Sandboxed execution with resource limits      |
//! | `runtime`     | Script interpreter / VM                       |
//! | `hooks`       | Event registration and dispatch               |
//! | `registry`    | Extension lifecycle (install/enable/…)        |
//! | `api`         | API surface exposed to extensions             |
//! | `storage`     | Per-extension key-value storage               |
//! | `service`     | Service façade (`ExtensionsServiceState`)     |
//! | `commands`    | Tauri `#[command]` handlers                   |

pub mod api;
pub mod hooks;
pub mod manifest;
pub mod permissions;
pub mod registry;
pub mod runtime;
pub mod sandbox;
pub mod service;
pub mod storage;
pub mod types;
