//! # SortOfRemote NG – Let's Encrypt / ACME
//!
//! Full ACME v2 client implementation for automated TLS certificate management.
//! Designed for use with the `sorng-gateway` headless server and any other
//! component that needs publicly-trusted certificates from Let's Encrypt
//! (or any RFC 8555-compliant CA).
//!
//! ## Key Capabilities
//!
//! - **ACME v2 Protocol** — Full RFC 8555 implementation with directory discovery,
//!   account management, order lifecycle, and certificate download
//! - **HTTP-01 Challenge** — Built-in HTTP challenge responder on port 80 with
//!   standalone and proxy integration modes
//! - **DNS-01 Challenge** — Pluggable DNS provider interface for wildcard certificates
//!   with built-in support for Cloudflare, Route 53, and manual TXT record workflows
//! - **TLS-ALPN-01 Challenge** — Protocol-level TLS challenge for port-443-only deployments
//! - **Automatic Renewal** — Background scheduler that renews certificates before expiry
//!   with configurable lead time, jitter, and retry back-off
//! - **Certificate Storage** — Encrypted on-disk storage of account keys, certificates,
//!   and private keys with atomic writes and backup rotation
//! - **Multi-Domain / SAN** — Single certificate for multiple domains and wildcards
//! - **Staging & Production** — Easy toggle between Let's Encrypt staging (for testing)
//!   and production environments
//! - **Rate Limit Awareness** — Tracks and respects Let's Encrypt rate limits with
//!   Retry-After header support
//! - **Certificate Monitoring** — Expiry tracking, health checks, and event notifications
//! - **OCSP Stapling** — OCSP response fetching and caching for stapled TLS
//! - **Revocation** — Certificate revocation via ACME when keys are compromised
//!
//! ## Architecture
//!
//! ```text
//! ┌────────────────────────────────────────────────────────────┐
//! │                    sorng-letsencrypt                        │
//! │                                                            │
//! │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐ │
//! │  │  ACME    │  │ Challenge│  │ Cert     │  │  Renewal  │ │
//! │  │  Client  │  │ Solvers  │  │ Store    │  │  Scheduler│ │
//! │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └─────┬─────┘ │
//! │       │              │              │               │       │
//! │  ┌────┴──────────────┴──────────────┴───────────────┴───┐  │
//! │  │                  LetsEncryptService                    │  │
//! │  └───────────────────────┬───────────────────────────────┘  │
//! │                          │                                  │
//! └──────────────────────────┼──────────────────────────────────┘
//!                            │
//!                   ┌────────┴────────┐
//!                   │  sorng-gateway  │
//!                   │  (TLS listener) │
//!                   └─────────────────┘
//! ```

pub mod types;
pub mod acme;
pub mod challenges;
pub mod dns_providers;
pub mod store;
pub mod renewal;
pub mod ocsp;
pub mod monitor;
pub mod service;
pub mod commands;
