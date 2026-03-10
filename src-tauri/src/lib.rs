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

mod app_auth_commands;
mod app_shell_commands;
mod domains;
mod invoke_handler;
mod mongodb_commands;
mod mssql_commands;
mod mysql_commands;
mod postgres_commands;
mod redis_commands;
#[cfg(not(feature = "rdp"))]
mod rdp;
mod sqlite_commands;
mod state_registry;
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
///
/// This function sets up all service instances, configures the Tauri application
/// with the necessary plugins and command handlers, and starts the application event loop.
///
/// ## Services Initialized
///
/// The following services are initialized and managed:
/// - Authentication service for user management
/// - Secure storage for encrypted data persistence
/// - SSH, RDP, VNC services for remote desktop connections
/// - Database service for SQL connectivity
/// - FTP service for file transfers
/// - Network service for utilities like ping and scanning
/// - Security service for TOTP and encryption
/// - Wake-on-LAN service
/// - Script execution service
/// - VPN services (OpenVPN, WireGuard, ZeroTier, Tailscale)
/// - Proxy and chaining services for connection routing
///
/// ## Panics
///
/// Panics if the Tauri application fails to initialize or run.
pub fn run() {
    use tauri_plugin_autostart::MacosLauncher;

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| Ok(state_registry::register(app)?))
        .invoke_handler(invoke_handler::build())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
