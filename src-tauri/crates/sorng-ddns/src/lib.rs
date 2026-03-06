//! # SortOfRemote NG – Dynamic DNS Management
//!
//! Comprehensive DDNS provider integration supporting automatic IP detection,
//! scheduled updates, multi-domain management, and provider-specific features.
//!
//! ## Supported Providers
//!
//! - **Cloudflare** — Full DNS record management via API token / global key,
//!   zone listing, A/AAAA/CNAME record CRUD, proxied mode, TTL control
//! - **No-IP** — Classic DDNS updates via HTTP API, hostname groups,
//!   confirmation-free updates, plus/enhanced support
//! - **DuckDNS** — Token-based subdomain updates, TXT records for ACME
//! - **Afraid DNS (FreeDNS)** — Direct URL update, hash-based auth,
//!   multi-domain, v1/v2 API support
//! - **Dynu** — REST API v2, IPv4/IPv6, group management, hostname CRUD
//! - **Namecheap** — HTTP API, multi-host per domain, IP whitelisting
//! - **GoDaddy** — REST API v1, per-domain record management
//! - **Google Domains** — Synthetic records update API (nic.google.com)
//! - **Hurricane Electric (HE)** — TunnelBroker DDNS, HTTPS update API
//! - **ChangeIP** — Standard DDNS HTTP update
//! - **YDNS** — HTTP basic auth update API
//! - **DNSPod** — Tencent Cloud DNS API v3, per-record management
//! - **OVH** — DynHost update, REST API with consumer key auth
//! - **Porkbun** — REST API v3 with API key + secret, A/AAAA records
//! - **Gandi** — LiveDNS REST API with personal access token
//!
//! ## Key Capabilities
//!
//! - **Public IP Detection** — Multiple upstream services (ipify, icanhazip,
//!   ifconfig.me, ipinfo.io, etc.) with fallback and caching
//! - **Scheduled Updates** — Configurable per-profile update intervals with
//!   jitter, retry back-off, and failure notification
//! - **Multi-Profile Management** — Create, edit, delete, enable/disable
//!   DDNS profiles, each targeting a different provider + domain
//! - **IPv4 + IPv6 Dual-Stack** — Detect and update both A and AAAA records
//! - **Health Monitoring** — Track update history, success/failure counts,
//!   last known IPs, and provider-level health status
//! - **Audit Logging** — Full ring-buffer audit trail of every update
//! - **Import / Export** — Bulk profile management in JSON format
//!
//! ## Architecture
//!
//! ```text
//! ┌───────────────────────────────────────────────────────────────┐
//! │                     sorng-ddns                                │
//! │                                                               │
//! │  ┌───────────┐  ┌───────────┐  ┌───────────┐ ┌───────────┐  │
//! │  │ IP Detect │  │ Providers │  │ Scheduler │ │   Audit   │  │
//! │  │  Module   │  │  Module   │  │  Module   │ │  Module   │  │
//! │  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘ └─────┬─────┘  │
//! │        │               │               │              │       │
//! │  ┌─────┴───────────────┴───────────────┴──────────────┴────┐  │
//! │  │                 DdnsService (orchestrator)               │  │
//! │  └─────────────────────────┬───────────────────────────────┘  │
//! │                            │                                  │
//! │  ┌─────────────────────────┴───────────────────────────────┐  │
//! │  │              commands.rs (Tauri IPC)                     │  │
//! │  └─────────────────────────────────────────────────────────┘  │
//! └───────────────────────────────────────────────────────────────┘
//! ```

pub mod audit;
pub mod commands;
pub mod ip_detect;
pub mod providers;
pub mod scheduler;
pub mod service;
pub mod types;
