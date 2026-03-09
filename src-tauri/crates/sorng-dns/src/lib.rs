//! # sorng-dns — Unified DNS Resolution & Encrypted DNS
//!
//! Comprehensive DNS crate providing:
//!
//! - **System DNS** — standard OS resolver (A/AAAA/PTR)
//! - **DNS-over-HTTPS (DoH)** — RFC 8484 wire-format & JSON API
//! - **DNS-over-TLS (DoT)** — RFC 7858 encrypted transport
//! - **Oblivious DoH (ODoH)** — RFC 9230 proxy-based privacy
//! - **DNSSEC validation** — signature & chain-of-trust verification
//! - **Record types** — A, AAAA, CNAME, MX, TXT, SRV, PTR, NS, SOA, CAA, NAPTR, SSHFP, TLSA, HTTPS, SVCB
//! - **mDNS / DNS-SD** — multicast service discovery for LAN peers
//! - **Caching** — LRU + TTL-aware response cache
//! - **Provider presets** — Cloudflare, Google, Quad9, NextDNS, Mullvad, AdGuard, etc.
//! - **Diagnostics** — resolution probes, latency benchmarks, leak detection
//!
//! All other crates (sorng-network, sorng-ssh, sorng-rdp, sorng-smtp, sorng-openvpn,
//! sorng-wireguard, sorng-tailscale, sorng-zerotier, sorng-p2p, sorng-core) should
//! use this crate for DNS instead of rolling their own resolution.

pub mod cache;
pub mod config;
pub mod diagnostics;
pub mod dnssec;
pub mod doh;
pub mod dot;
pub mod leak_detection;
pub mod mdns;
pub mod odoh;
pub mod providers;
pub mod records;
pub mod resolver;
pub mod service;
pub mod system;
pub mod types;
pub mod wire;

pub use resolver::{DnsResolver, DnsResolverState};
pub use service::DnsService;
pub use types::*;
