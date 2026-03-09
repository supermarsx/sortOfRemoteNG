//! # sorng-tailscale — Extensive Tailscale Integration
//!
//! Dedicated crate for deep Tailscale integration, going far beyond simple CLI
//! wrapping. Provides daemon lifecycle management, MagicDNS, Funnel, Serve,
//! Tailscale SSH, exit node management, Taildrop file sharing, ACL policies,
//! peer path quality monitoring, DERP relay statistics, and network diagnostics.
//!
//! ## Modules
//!
//! - **types** — All Tailscale data types (peer info, DERP regions, ACLs, etc.)
//! - **service** — Central TailscaleService orchestrator
//! - **daemon** — Daemon lifecycle (start/stop/status, install, version)
//! - **network** — Network operations (netcheck, DERP stats, peer paths)
//! - **acl** — ACL & policy management (tags, grants, autoApprovers)
//! - **dns** — MagicDNS, split DNS, search domains
//! - **funnel** — Tailscale Funnel (public HTTPS ingress)
//! - **serve** — Tailscale Serve (local dev services exposed to tailnet)
//! - **ssh** — Tailscale SSH integration
//! - **exit_node** — Exit node management (advertise, use, allow LAN)
//! - **taildrop** — Taildrop file sharing
//! - **peer** — Peer management (direct vs relay, latency, OS, version)
//! - **diagnostics** — Health checks, netcheck, bugreport, connectivity tests

pub mod acl;
pub mod daemon;
pub mod diagnostics;
pub mod dns;
pub mod exit_node;
pub mod funnel;
pub mod network;
pub mod peer;
pub mod serve;
pub mod service;
pub mod ssh;
pub mod taildrop;
pub mod types;

pub use service::{TailscaleService, TailscaleServiceState};
pub use types::*;
