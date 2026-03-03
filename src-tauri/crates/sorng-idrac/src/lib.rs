//! # SortOfRemote NG – Dell iDRAC Management
//!
//! Comprehensive Dell iDRAC / BMC management with multi-protocol support:
//!
//! - **Redfish** (iDRAC 7/8/9, modern) — REST/JSON at `/redfish/v1/…`
//! - **WS-Management** (iDRAC 6/7, legacy) — SOAP/XML over HTTPS
//! - **IPMI** (very old BMCs) — IPMI-over-LAN for basic power/sensor ops
//!
//! ## Modules
//!
//! - **types** — Shared data structures (system, power, thermal, storage, etc.)
//! - **error** — Crate-specific error types
//! - **redfish** — Redfish REST client (iDRAC 7+)
//! - **wsman** — WS-Management SOAP client (legacy iDRAC 6/7)
//! - **ipmi** — IPMI-over-LAN client (very old BMCs)
//! - **client** — Protocol-aware orchestrator with auto-detection
//! - **system** — System info (model, serial, BIOS, boot order, OS)
//! - **power** — Power actions, PSU info, power consumption
//! - **thermal** — Temperatures, fans, cooling profiles
//! - **hardware** — CPUs, memory DIMMs, PCIe devices, GPUs
//! - **storage** — RAID controllers, virtual disks, physical disks, enclosures
//! - **network** — NIC adapters, ports, iDRAC network config, VLANs
//! - **firmware** — Firmware inventory, DUP update, repository
//! - **lifecycle** — Lifecycle Controller jobs, SCP export/import
//! - **virtual_media** — ISO mount/unmount, virtual CD/floppy/USB
//! - **virtual_console** — KVM / HTML5 console access
//! - **event_log** — System Event Log (SEL), Lifecycle log, alerts
//! - **users** — iDRAC local user management, LDAP/AD config
//! - **bios** — BIOS attributes, boot order, pending changes
//! - **certificates** — SSL/TLS certificate management
//! - **health** — Overall health rollup, component status
//! - **telemetry** — Server telemetry, power/thermal historical metrics
//! - **racadm** — RACADM command passthrough (iDRAC 7+)
//! - **service** — Aggregate facade + Tauri state alias
//! - **commands** — `#[tauri::command]` handlers

pub mod types;
pub mod error;
pub mod redfish;
pub mod wsman;
pub mod ipmi;
pub mod client;
pub mod system;
pub mod power;
pub mod thermal;
pub mod hardware;
pub mod storage;
pub mod network;
pub mod firmware;
pub mod lifecycle;
pub mod virtual_media;
pub mod virtual_console;
pub mod event_log;
pub mod users;
pub mod bios;
pub mod certificates;
pub mod health;
pub mod telemetry;
pub mod racadm;
pub mod service;
pub mod commands;
