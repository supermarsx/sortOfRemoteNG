//! # SortOfRemote NG
//!
//! A comprehensive remote connectivity and management application built with Tauri and Rust.
//! This application provides a unified interface for managing various types of remote connections
//! including SSH, RDP, VNC, databases, FTP, and network services.
//!
//! ## Architecture
//!
//! The application is structured as a Cargo workspace of focused crates:
//!
//! - **sorng-core** — Shared types and diagnostics infrastructure
//! - **sorng-auth** — Authentication, security, and credential management
//! - **sorng-storage** — Encrypted data persistence and backups
//! - **sorng-gpo** — Windows Group Policy Object management
//! - **sorng-network** — Network utilities, Wake-on-LAN, and QR codes
//! - **sorng-ssh** — SSH, SSH3, and script execution
//! - **sorng-sftp** — Comprehensive SFTP file-transfer and remote filesystem management
//! - **sorng-rdp** — RDP connectivity and graphics pipeline
//! - **sorng-protocols** — VNC, Telnet, Serial, FTP, DB, HTTP, and more
//! - **sorng-vpn** — VPN services, proxy, and connection chaining
//! - **sorng-p2p** — P2P connectivity: STUN/TURN/ICE, NAT traversal, signaling, peer discovery
//! - **sorng-tailscale** — Tailscale mesh networking: daemon, ACLs, MagicDNS, Funnel, Serve, SSH
//! - **sorng-zerotier** — ZeroTier networking: daemon, flow rules, self-hosted controller
//! - **sorng-wireguard** — WireGuard tunnels: config management, key generation, routing, NAT keepalive
//! - **sorng-cloud** — Cloud provider integrations
//! - **sorng-remote-mgmt** — Remote management tools (WMI, RPC, AnyDesk, etc.)
//!
//! This crate (the app) is the thin Tauri integration layer that wires
//! everything together through re-exports and the command handler.
//!
//! ## Feature-gated compilation
//!
//! Command modules are gated behind cargo features to allow lean dev builds.
//! Use `cargo build --no-default-features` for a minimal core build, or
//! `cargo build --features full` for everything.

// ═══════════════════════════════════════════════════════════════════════
//  Always-compiled: core infrastructure, connectivity, sessions, access
// ═══════════════════════════════════════════════════════════════════════

mod domains;
mod invoke_handler;
mod splash;
mod state_registry;

// ═══════════════════════════════════════════════════════════════════════
//  ALL command modules are compiled in separate crates to split the
//  coherence domain and drastically reduce type-check time:
//
//  Always-on:     sorng-commands-{core,sessions,access}
//  Feature-gated: sorng-commands-{cloud,collab,platform,ops}
//
//  See invoke_handler.rs for the delegation.
// ═══════════════════════════════════════════════════════════════════════

pub use domains::*;

// App-level module: REST API gateway (stays in the main crate)
pub mod api;

#[cfg(test)]
#[path = "tests/network_tests.rs"]
mod network_tests;
#[cfg(test)]
#[path = "tests/script_tests.rs"]
mod script_tests;
#[cfg(test)]
#[path = "tests/security_tests.rs"]
mod security_tests;
#[cfg(test)]
#[path = "tests/ssh_tunnel_tests.rs"]
mod ssh_tunnel_tests;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// Initializes and runs the SortOfRemote NG Tauri application.
pub fn run() {
    // Install the ring CryptoProvider for rustls 0.23+.
    // Must happen before any TLS operation (reqwest, tokio-rustls, etc.).
    rustls::crypto::ring::default_provider()
        .install_default()
        .expect("Failed to install rustls CryptoProvider");

    use tauri_plugin_autostart::MacosLauncher;

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            state_registry::register(app)?;
            splash::show(app)?;
            Ok(())
        })
        .invoke_handler(invoke_handler::build())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
