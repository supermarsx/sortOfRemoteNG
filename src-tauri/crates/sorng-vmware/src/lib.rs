//! # SortOfRemote NG – VMware / vSphere Management
//!
//! Comprehensive VMware vCenter / ESXi management via the vSphere REST API,
//! plus VMRC (VMware Remote Console) and Horizon View client launching.
//!
//! ## Modules
//!
//! - **types** — Shared data structures (VMs, hosts, datastores, networks, etc.)
//! - **error** — Crate-specific error types
//! - **vsphere** — vSphere REST API HTTP client with session-based auth
//! - **vmrc** — VMRC / Horizon View external process launcher
//! - **vm** — VM lifecycle (create, power, configure, export, clone, migrate)
//! - **snapshot** — Snapshot CRUD, revert, tree management
//! - **network** — Port groups, vSwitches, distributed switches
//! - **storage** — Datastores, VMDK / disk management
//! - **metrics** — Performance counters, resource utilisation
//! - **host** — ESXi host management (maintenance, services, hardware)
//! - **service** — Aggregate facade + Tauri state alias
//! - **commands** — `#[tauri::command]` handlers

pub mod types;
pub mod error;
pub mod vsphere;
pub mod vmrc;
pub mod vm;
pub mod snapshot;
pub mod network;
pub mod storage;
pub mod metrics;
pub mod host;
pub mod service;
pub mod commands;
