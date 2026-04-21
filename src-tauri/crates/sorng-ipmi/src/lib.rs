//! # SortOfRemote NG – Comprehensive IPMI 1.5/2.0 Integration
//!
//! This crate provides a **full-featured IPMI (Intelligent Platform Management Interface)**
//! client implementation supporting both IPMI 1.5 and IPMI 2.0 (RMCP+) protocols.
//! It goes well beyond the basic session-less IPMI client in `sorng-bmc-common` by
//! providing authenticated sessions, multi-session management, and the complete set
//! of IPMI subsystem operations.
//!
//! ## Architecture
//!
//! The crate is layered as follows:
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────┐
//! │  commands.rs   — Tauri #[command] handlers (UI boundary)    │
//! ├─────────────────────────────────────────────────────────────┤
//! │  service.rs    — IpmiService facade (orchestrates modules)  │
//! ├─────────────┬──────────┬──────────┬────────────┬───────────┤
//! │  chassis.rs  │ sensors  │  sel.rs  │  fru.rs    │  sol.rs   │
//! │  watchdog.rs │ lan.rs   │ users.rs │  pef.rs    │  raw.rs   │
//! │  channel.rs  │          │          │            │           │
//! ├─────────────┴──────────┴──────────┴────────────┴───────────┤
//! │  session.rs  — IPMI session management (1.5 & 2.0/RMCP+)   │
//! ├─────────────────────────────────────────────────────────────┤
//! │  protocol.rs — RMCP / IPMI wire-format encoding/decoding    │
//! ├─────────────────────────────────────────────────────────────┤
//! │  types.rs    — Shared data structures (Serialize/Deserize)  │
//! │  error.rs    — IpmiError / IpmiResult                       │
//! └─────────────────────────────────────────────────────────────┘
//! ```
//!
//! ## Supported Features
//!
//! - **Authenticated sessions** — IPMI 1.5 (MD2/MD5/password) and IPMI 2.0/RMCP+
//!   (RAKP handshake with HMAC-SHA1/SHA256, AES-CBC-128 confidentiality)
//! - **Chassis control** — power on/off/cycle/reset, soft shutdown, identify,
//!   boot device selection, power restore policy, power-on hours
//! - **Sensor Data Records (SDR)** — full SDR repository parsing including
//!   Type 01 (Full), Type 02 (Compact), Type 11 (FRU Locator), Type 12 (MC Locator);
//!   sensor linearization with all 12 formula types
//! - **System Event Log (SEL)** — read, clear, reserve, individual entry access,
//!   full event record parsing (system events, OEM timestamped/non-timestamped)
//! - **Field Replaceable Unit (FRU)** — inventory read/write, area parsing
//!   (Internal, Chassis, Board, Product, MultiRecord), 6-bit packed & BCD decoding
//! - **Serial over LAN (SOL)** — payload activation/deactivation, bidirectional
//!   serial data, break signal, flow control status, keepalive
//! - **Watchdog Timer** — get/set/reset, all timer-use and action types,
//!   pre-timeout interrupt configuration
//! - **LAN Configuration** — IP source, addresses, gateway, VLAN, cipher suites,
//!   community string, batch retrieval
//! - **User Management** — create/delete/enable/disable users, password management,
//!   per-channel privilege access control
//! - **Platform Event Filtering (PEF)** — capabilities, filter/alert policy management
//! - **Channel Management** — info, access control, cipher suite enumeration
//! - **Raw Commands** — arbitrary NetFn/Cmd passthrough with hex helpers

pub mod channel;
pub mod chassis;
pub mod error;
pub mod fru;
pub mod lan;
pub mod pef;
pub mod protocol;
pub mod raw;
pub mod sel;
pub mod sensors;
pub mod service;
pub mod session;
pub mod sol;
pub mod types;
pub mod users;
pub mod watchdog;

pub use error::{IpmiError, IpmiResult};
pub use service::{IpmiService, IpmiServiceState};
pub use types::*;
