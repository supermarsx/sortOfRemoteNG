//! # sorng-netbird — Extensive NetBird Integration
//!
//! Dedicated crate for deep NetBird integration with the SortOfRemoteNG
//! connection manager. NetBird is an open-source, WireGuard-based mesh VPN
//! that creates peer-to-peer encrypted tunnels between machines with
//! centralized management via the NetBird Management Server.
//!
//! ## Architecture
//!
//! This crate wraps both the **NetBird CLI/daemon** (`netbird`) for local
//! operations and the **NetBird Management API** for centralized fleet
//! management.
//!
//! ## Modules
//!
//! - **types** — All NetBird data types (peers, groups, routes, ACLs, etc.)
//! - **service** — Central `NetBirdService` orchestrator
//! - **daemon** — Daemon lifecycle (install, start/stop, version, status)
//! - **management** — Management API client (REST endpoints)
//! - **peer** — Peer management (list, approve, block, connectivity)
//! - **group** — Group management (create, assign peers, nest groups)
//! - **route** — Network route management (advertise, distribute)
//! - **acl** — Access-control policies (rules, posture checks)
//! - **dns** — DNS management (nameserver groups, domains)
//! - **setup_key** — Setup key lifecycle (create, revoke, rotate)
//! - **relay** — TURN/STUN relay infrastructure monitoring
//! - **posture** — Posture check definitions (OS version, geo, peer network)
//! - **user** — User/identity management from IdP integration
//! - **diagnostics** — Health checks, signal/relay connectivity, debug bundle

pub mod acl;
pub mod daemon;
pub mod diagnostics;
pub mod dns;
pub mod group;
pub mod management;
pub mod peer;
pub mod posture;
pub mod relay;
pub mod route;
pub mod service;
pub mod setup_key;
pub mod types;
pub mod user;

pub use service::{NetBirdService, NetBirdServiceState};
pub use types::*;
