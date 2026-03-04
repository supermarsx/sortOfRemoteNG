//! # SortOfRemote NG – HP/HPE iLO Management
//!
//! Comprehensive HP Integrated Lights-Out management for **all generations**:
//!
//! | Generation | Server Family    | Protocols                          | Console        |
//! |------------|------------------|------------------------------------|----------------|
//! | **iLO 1**  | ProLiant G3/G4   | RIBCL XML (port 443), IPMI         | Java applet    |
//! | **iLO 2**  | ProLiant G5/G6   | RIBCL XML (port 443), IPMI, SSH    | Java IRC       |
//! | **iLO 3**  | ProLiant G7      | RIBCL XML (port 443), IPMI, SSH    | Java IRC       |
//! | **iLO 4**  | ProLiant Gen8/9  | RIBCL, Redfish (FW 2.30+), IPMI   | HTML5 + Java   |
//! | **iLO 5**  | ProLiant Gen10   | Redfish (primary), RIBCL, IPMI     | HTML5          |
//! | **iLO 6**  | ProLiant Gen11   | Redfish (primary), IPMI            | HTML5          |
//! | **iLO 7**  | ProLiant Gen12   | Redfish (primary), IPMI            | HTML5          |
//!
//! ## Modules
//!
//! - **types**           — iLO-specific data structures + re-exports from bmc-common
//! - **error**           — Crate-specific error types wrapping `BmcError`
//! - **ribcl**           — RIBCL XML-over-HTTPS client (iLO 1/2/3/4)
//! - **redfish**         — iLO Redfish extensions (iLO 4+/5/6/7)
//! - **client**          — Protocol-aware orchestrator with auto-detection
//! - **system**          — System info (model, serial, BIOS, boot order, OS)
//! - **power**           — Power actions, PSU info, power consumption
//! - **thermal**         — Temperatures, fans, cooling profiles
//! - **hardware**        — CPUs, memory DIMMs, PCIe devices, GPUs
//! - **storage**         — Smart Array / MR controllers, logical/physical drives
//! - **network**         — NIC adapters, ports, iLO network config, VLANs
//! - **firmware**        — Firmware inventory, online/offline update, FWPKG
//! - **virtual_media**   — ISO mount/unmount, virtual CD/USB
//! - **virtual_console** — HTML5 console info (iLO 4+), Java IRC (iLO 2/3)
//! - **event_log**       — IML (Integrated Management Log), iLO Event Log
//! - **users**           — Local user management, LDAP/AD directory config
//! - **bios**            — BIOS/UEFI settings, boot order, pending changes
//! - **certificates**    — SSL/TLS certificate management + CSR generation
//! - **health**          — Overall health rollup, component status
//! - **license**         — iLO license key management (Standard/Advanced/Premium)
//! - **security**        — Security dashboard, encryption, login banner, FIPS
//! - **federation**      — iLO Federation groups, peer discovery
//! - **service**         — Aggregate facade + Tauri state alias
//! - **commands**        — `#[tauri::command]` handlers

pub mod types;
pub mod error;
pub mod ribcl;
pub mod redfish;
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
pub mod license;
pub mod security;
pub mod federation;
pub mod service;
pub mod commands;
