//! # SortOfRemote NG – Gateway
//!
//! Headless gateway server and connection proxy for enterprise deployments.
//!
//! The gateway acts as a centralized jump server / connection proxy that routes
//! SSH, RDP, VNC, and database connections through a single controlled entry point.
//! It can run as a standalone headless binary (no GUI required) on Linux/Windows servers
//! or be embedded within the Tauri desktop application for local gateway scenarios.
//!
//! ## Key Capabilities
//!
//! - **Headless Mode** — Run as a pure server binary with TOML/JSON configuration
//! - **Connection Proxying** — TCP/UDP relay for SSH, RDP, VNC, and database traffic
//! - **SSH Tunnel Management** — Dynamic SSH tunnel creation and lifecycle management
//! - **Access Policies** — Per-user, per-host access control with time-based restrictions
//! - **Session Management** — Track, limit, and audit all gateway sessions
//! - **Health Monitoring** — Self-diagnostics, uptime tracking, and health check endpoints
//! - **Metrics** — Connection stats, bandwidth tracking, latency measurement
//! - **Gateway Authentication** — API keys, JWT tokens, and mutual TLS support
//! - **TLS Termination** — Certificate management for encrypted gateway connections
//! - **Recording Bridge** — Integration with sorng-recording for gateway-level capture
//! - **CLI Interface** — Full command-line argument parsing for headless operation
//!
//! ## Architecture
//!
//! ```text
//! ┌──────────────┐     ┌─────────────────┐     ┌──────────────┐
//! │  sorng client │────▶│  sorng-gateway   │────▶│ target hosts │
//! │  (desktop)    │     │  (headless/lib)  │     │ SSH/RDP/VNC  │
//! └──────────────┘     └─────────────────┘     └──────────────┘
//!                             │
//!                      ┌──────┴───────┐
//!                      │ Policy Engine │
//!                      │ Session Mgmt  │
//!                      │ Audit + Metrics│
//!                      └──────────────┘
//! ```

pub mod types;
pub mod service;
pub mod server;
pub mod config;
pub mod proxy;
pub mod tunnel;
pub mod session;
pub mod policy;
pub mod health;
pub mod metrics;
pub mod auth;
pub mod tls;
pub mod recording_bridge;
pub mod cli;
