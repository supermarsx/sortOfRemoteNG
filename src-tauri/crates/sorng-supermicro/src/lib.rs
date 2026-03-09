//! # SortOfRemote NG – Supermicro BMC Management
//!
//! Comprehensive Supermicro BMC management supporting multiple platform generations:
//!
//! - **X13/H13** (latest) — Full Redfish, HTML5 iKVM, latest BMC firmware
//! - **X12/H12** — Redfish + legacy CGI, HTML5 iKVM
//! - **X11** — Redfish (basic) + CGI web API, HTML5 iKVM introduced
//! - **X10** — CGI/ATEN web API + IPMI, Java-based iKVM
//! - **X9** — Basic IPMI-only, Java remote console
//!
//! ## Protocols
//!
//! - **Redfish** — DMTF standard + `Oem.Supermicro` extensions (X11+)
//! - **Legacy Web/CGI** — ATEN-based CGI API over HTTPS (X9–X12)
//! - **IPMI** — IPMI-over-LAN for basic power/sensor operations (all generations)
//!
//! ## Modules
//!
//! - **types** — Shared data structures (system, power, thermal, storage, etc.)
//! - **error** — Crate-specific error types
//! - **redfish** — Supermicro Redfish client with OEM extension support
//! - **legacy_web** — ATEN-based CGI web API client
//! - **client** — Protocol-aware orchestrator with auto-detection
//! - **system** — System info (model, serial, BIOS, boot order)
//! - **power** — Power actions, PSU info, power consumption
//! - **thermal** — Temperatures, fans, cooling profiles
//! - **hardware** — CPUs, memory DIMMs, PCIe devices, GPUs
//! - **storage** — RAID controllers, virtual disks, physical disks
//! - **network** — NIC adapters, BMC network config
//! - **firmware** — Firmware inventory, BIOS/BMC update
//! - **virtual_media** — ISO mount/unmount, virtual CD/floppy/USB
//! - **virtual_console** — HTML5 iKVM / Java KVM console access
//! - **event_log** — System Event Log (SEL), audit log
//! - **users** — Local user management, LDAP/AD config
//! - **bios** — BIOS/UEFI settings management
//! - **certificates** — SSL/TLS certificate management
//! - **health** — Overall health rollup, component status
//! - **node_manager** — Intel Node Manager power capping (Supermicro-specific)
//! - **service** — Aggregate facade + Tauri state alias
//! - **commands** — `#[tauri::command]` handlers

pub mod bios;
pub mod certificates;
pub mod client;
pub mod commands;
pub mod error;
pub mod event_log;
pub mod firmware;
pub mod hardware;
pub mod health;
pub mod legacy_web;
pub mod network;
pub mod node_manager;
pub mod power;
pub mod redfish;
pub mod service;
pub mod storage;
pub mod system;
pub mod thermal;
pub mod types;
pub mod users;
pub mod virtual_console;
pub mod virtual_media;
