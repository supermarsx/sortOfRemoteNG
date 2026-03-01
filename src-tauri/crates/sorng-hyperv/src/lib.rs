//! # SortOfRemote NG – Hyper-V Management
//!
//! Comprehensive local and remote Hyper-V virtual machine management via
//! PowerShell cmdlets. Provides services for:
//!
//! - **VM Lifecycle** – create, start, stop, restart, pause, resume, save, delete,
//!   configure CPU / memory / firmware / BIOS settings
//! - **Snapshots** – create, restore, remove, rename, export / import checkpoints
//! - **Networking** – virtual switches (External / Internal / Private), VM network
//!   adapters, VLAN tagging, bandwidth management, MAC address configuration
//! - **Storage** – VHD / VHDX / VHDS creation, resize, compact, convert, mount,
//!   dismount, merge, optimize; VM disk attachment / removal
//! - **Metrics** – VM resource metering, CPU / memory / disk / network utilisation,
//!   host capacity, integration services status
//! - **Replication** – Hyper-V Replica configuration, enable / disable / suspend /
//!   resume replication, planned & unplanned failover, reverse replication

pub mod types;
pub mod error;
pub mod powershell;
pub mod vm;
pub mod snapshot;
pub mod network;
pub mod storage;
pub mod metrics;
pub mod replication;
pub mod service;
pub mod commands;
