//! # SortOfRemote NG – Lenovo XClarity Controller Management
//!
//! Comprehensive Lenovo BMC management supporting multiple generations:
//!
//! - **XCC2** (XClarity Controller 2) — ThinkSystem V3, Redfish-native
//! - **XCC** (XClarity Controller) — ThinkSystem V1/V2, Redfish + legacy REST
//! - **IMM2** (Integrated Management Module II) — System x M5/M6, legacy REST + IPMI
//! - **IMM** (Integrated Management Module) — System x M4, basic IPMI
//!
//! ## Protocols
//!
//! - **Redfish** — DMTF standard + `Oem.Lenovo` extensions (XCC/XCC2)
//! - **Legacy REST** — Proprietary JSON API on IMM2 `/api/…`
//! - **IPMI** — IPMI-over-LAN for basic power/sensor operations (all generations)
//!
//! ## Modules
//!
//! - **types** — Shared data structures (system, power, thermal, storage, etc.)
//! - **error** — Crate-specific error types
//! - **redfish** — Lenovo Redfish client with OEM extension support
//! - **legacy_rest** — IMM2 proprietary REST API client
//! - **client** — Protocol-aware orchestrator with auto-detection
//! - **system** — System info (model, serial, BIOS, boot order)
//! - **power** — Power actions, PSU info, power consumption
//! - **thermal** — Temperatures, fans, cooling profiles
//! - **hardware** — CPUs, memory DIMMs, PCIe devices, GPUs
//! - **storage** — RAID controllers, virtual disks, physical disks
//! - **network** — NIC adapters, XCC network config
//! - **firmware** — Firmware inventory, update management
//! - **virtual_media** — ISO mount/unmount, virtual CD/USB
//! - **virtual_console** — HTML5 remote console access
//! - **event_log** — System Event Log, audit log
//! - **users** — Local user management, LDAP/AD config
//! - **bios** — BIOS/UEFI settings management
//! - **certificates** — SSL/TLS certificate management
//! - **health** — Overall health rollup, component status
//! - **onecli** — Lenovo OneCLI command passthrough (XCC)
//! - **service** — Aggregate facade + Tauri state alias
//! - **commands** — `#[tauri::command]` handlers

pub mod types;
pub mod error;
pub mod redfish;
pub mod legacy_rest;
pub mod client;
pub mod system;
pub mod power;
pub mod thermal;
pub mod hardware;
pub mod storage;
pub mod network;
pub mod firmware;
pub mod virtual_media;
pub mod virtual_console;
pub mod event_log;
pub mod users;
pub mod bios;
pub mod certificates;
pub mod health;
pub mod onecli;
pub mod service;
pub mod commands;
