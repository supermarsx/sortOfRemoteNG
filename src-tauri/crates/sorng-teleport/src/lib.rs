//! # sorng-teleport — Extensive Teleport Integration
//!
//! Dedicated crate for deep Gravitational Teleport integration with the
//! SortOfRemoteNG connection manager. Teleport is a unified access plane
//! that provides secure, audited access to SSH servers, Kubernetes clusters,
//! databases, internal web applications, and Windows desktops.
//!
//! ## Architecture
//!
//! This crate wraps both the **`tsh` CLI** for local operations and the
//! **Teleport API** (gRPC-based) for cluster management and resource
//! enumeration.
//!
//! ## Modules
//!
//! - **types** — All Teleport data types (nodes, clusters, roles, sessions, etc.)
//! - **service** — Central `TeleportService` orchestrator
//! - **auth** — Authentication (login, SSO, MFA, hardware keys, certificates)
//! - **node** — SSH node management (list, labels, connect)
//! - **kube** — Kubernetes cluster access
//! - **database** — Database access (MySQL, Postgres, MongoDB, etc.)
//! - **app** — Application access (HTTP/TCP)
//! - **desktop** — Windows desktop access (RDP-based)
//! - **session** — Active and recorded sessions
//! - **recording** — Session recording playback and management
//! - **rbac** — Role-based access control (roles, traits, rules)
//! - **audit** — Audit event log
//! - **cluster** — Trusted cluster management (leaf/root)
//! - **cert** — Certificate authority and user/host certificate management
//! - **mfa** — Multi-factor authentication (TOTP, WebAuthn, hardware keys)
//! - **daemon** — tsh/teleport daemon lifecycle
//! - **diagnostics** — Health checks, connectivity tests, version info

pub mod types;
pub mod service;
pub mod auth;
pub mod node;
pub mod kube;
pub mod database;
pub mod app;
pub mod desktop;
pub mod session;
pub mod recording;
pub mod rbac;
pub mod audit;
pub mod cluster;
pub mod cert;
pub mod mfa;
pub mod daemon;
pub mod diagnostics;

pub use types::*;
pub use service::{TeleportService, TeleportServiceState};
