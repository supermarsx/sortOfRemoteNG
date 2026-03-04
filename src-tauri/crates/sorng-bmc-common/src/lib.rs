//! # SortOfRemote NG – Shared BMC / Out-of-Band Management Primitives
//!
//! Vendor-neutral building blocks consumed by `sorng-idrac`, `sorng-ilo`,
//! and future BMC crates (Supermicro, Lenovo XClarity, etc.).
//!
//! ## Modules
//!
//! - **types**    — Common data structures (system info, power, thermal, health, etc.)
//! - **error**    — Unified `BmcError` / `BmcResult`
//! - **redfish**  — DMTF Redfish REST/JSON client (vendor-neutral)
//! - **ipmi**     — IPMI 1.5/2.0 over LAN client (pure Rust, UDP port 623)
//! - **power**    — Standardised power-action enum (On, Off, Restart …)
//! - **health**   — Component health / status rollup types

pub mod types;
pub mod error;
pub mod redfish;
pub mod ipmi;
pub mod power;
pub mod health;
