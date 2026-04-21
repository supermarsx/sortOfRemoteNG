//! # sorng-topology — Connection Topology & Network Map Engine
//!
//! Comprehensive topology/map visualizer engine for SortOfRemote NG providing:
//!
//! - **Graph model** — nodes (connections, jump hosts, proxies, VPN gateways, etc.) and
//!   typed edges (SSH tunnels, proxy chains, VPN links, dependencies)
//! - **Auto-layout** — force-directed (Fruchterman–Reingold), hierarchical (Sugiyama),
//!   circular, grid, and geographic (Mercator projection) placement
//! - **Topology analysis** — blast-radius calculation, bottleneck/articulation-point
//!   detection, bridge detection, dependency depth, redundancy analysis
//! - **Builder** — construct a topology graph from connection data including proxy
//!   chains, tunnel chains, and jump-host hops
//! - **Diff / snapshots** — compute structural diffs between graph versions and
//!   restore prior snapshots
//! - **Tauri commands** — full set of `topo_*` IPC commands for the frontend

pub mod analysis;
pub mod builder;
pub mod diff;
pub mod error;
pub mod graph;
pub mod layout;
pub mod service;
pub mod types;

pub use error::TopologyError;
pub use service::{TopologyService, TopologyServiceState};
pub use types::*;
