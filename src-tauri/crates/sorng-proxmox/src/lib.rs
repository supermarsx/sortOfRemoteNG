//! # SortOfRemote NG – Proxmox VE Management
//!
//! Comprehensive Proxmox VE management via the PVE REST API (v2).
//! Supports QEMU VMs, LXC containers, storage, networking, cluster
//! operations, backups, Ceph, firewall, HA, SDN, and noVNC/SPICE console.
//!
//! ## Modules
//!
//! - **types** — Shared data structures (nodes, VMs, containers, storage, etc.)
//! - **error** — Crate-specific error types
//! - **client** — Proxmox PVE REST API HTTP client with ticket + API-token auth
//! - **nodes** — Node management (status, services, syslog, DNS, time, APT)
//! - **qemu** — QEMU VM lifecycle (create, power, config, clone, migrate, resize)
//! - **lxc** — LXC container lifecycle (create, power, clone, migrate, resize)
//! - **storage** — Storage management (list, content, upload, templates)
//! - **network** — Network interface management per node
//! - **cluster** — Cluster status, resources, join/remove, options
//! - **tasks** — Task monitoring, log retrieval
//! - **backup** — Vzdump backup/restore, backup jobs/schedules
//! - **firewall** — Cluster/node/VM/CT firewall rules, aliases, IP sets
//! - **pools** — Resource pool management
//! - **ha** — High Availability groups, resources, fencing
//! - **ceph** — Ceph monitors, OSDs, pools, status
//! - **sdn** — Software Defined Networking (zones, vnets, subnets)
//! - **console** — VNC and SPICE console ticket acquisition
//! - **metrics** — RRD data for nodes, VMs, containers
//! - **snapshot** — Snapshot CRUD for QEMU & LXC
//! - **template** — Appliance template downloads
//! - **service** — Aggregate facade + Tauri state alias
//! - **commands** — `#[tauri::command]` handlers

pub mod types;
pub mod error;
pub mod client;
pub mod nodes;
pub mod qemu;
pub mod lxc;
pub mod storage;
pub mod network;
pub mod cluster;
pub mod tasks;
pub mod backup;
pub mod firewall;
pub mod pools;
pub mod ha;
pub mod ceph;
pub mod sdn;
pub mod console;
pub mod metrics;
pub mod snapshot;
pub mod template;
pub mod service;
pub mod commands;
