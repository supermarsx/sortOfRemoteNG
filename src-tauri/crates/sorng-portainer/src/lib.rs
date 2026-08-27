// ── sorng-portainer – Portainer (CE/BE, API v2.x) integration ───────────────
//! Client, service façade and typed wire shapes for Portainer.
//!
//! `commands.rs` is intentionally **not** a module here: it is an include-shim
//! consumed by the commands crate (`#[path = ...] mod portainer_commands;`)
//! so this crate carries no `tauri` dependency.

pub mod client;
pub mod containers;
pub mod endpoints;
pub mod error;
pub mod service;
pub mod stacks;
pub mod types;

pub use client::PortainerClient;
pub use error::{PortainerError, PortainerErrorKind, PortainerResult};
pub use service::{PortainerService, PortainerServiceState};
