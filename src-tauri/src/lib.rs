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

mod about_commands;
mod ai_assist_commands;
mod app_auth_commands;
mod app_shell_commands;
mod aws_commands;
mod biometrics_commands;
mod bitwarden_commands;
mod command_palette_commands;
mod dashboard_commands;
mod dashlane_commands;
mod domains;
pub(crate) mod event_bridge;
mod extensions_commands;
mod fonts_commands;
mod ftp_commands;
mod google_passwords_commands;
mod hooks_commands;
mod i18n_commands;
mod invoke_handler;
mod keepass_commands;
mod lastpass_commands;
mod mongodb_commands;
mod mssql_commands;
mod mysql_commands;
mod notifications_commands;
mod onepassword_commands;
mod passbolt_commands;
mod postgres_commands;
#[cfg(not(feature = "rdp"))]
#[path = "rdp.rs"]
mod rdp_commands;
#[cfg(feature = "rdp")]
mod rdp_commands;
mod recording_commands;
mod redis_commands;
mod secure_clip_commands;
mod serial_commands;
mod smtp_commands;
mod sqlite_commands;
mod ssh_commands;
mod state_registry;
mod telnet_commands;
mod terminal_themes_commands;
mod updater_commands;
mod vault_commands;
#[cfg(feature = "kafka")]
mod kafka_commands;
mod ai_agent_commands;
mod amavis_commands;
mod ansible_commands;
mod apache_commands;
mod azure_commands;
mod bootloader_commands;
mod budibase_commands;
mod caddy_commands;
mod ceph_commands;
mod cicd_commands;
mod clamav_commands;
mod consul_commands;
mod cpanel_commands;
mod credentials_commands;
mod cron_commands;
mod cups_commands;
mod cyrus_sasl_commands;
mod ddns_commands;
mod docker_commands;
mod docker_compose_commands;
mod dovecot_commands;
mod dropbox_commands;
mod etcd_commands;
mod exchange_commands;
mod fail2ban_commands;
mod filters_commands;
mod freeipa_commands;
mod gcp_commands;
mod gdrive_commands;
mod gpg_agent_commands;
mod grafana_commands;
mod haproxy_commands;
mod hashicorp_vault_commands;
mod hetzner_commands;
mod hyperv_commands;
mod idrac_commands;
mod ilo_commands;
mod ipmi_commands;
mod jira_commands;
mod k8s_commands;
mod kernel_mgmt_commands;
mod lenovo_commands;
mod letsencrypt_commands;
mod llm_commands;
mod lxd_commands;
mod mac_mgmt_commands;
mod mailcow_commands;
mod marketplace_commands;
mod mcp_server_commands;
mod meshcentral_dedicated_commands;
mod mremoteng_dedicated_commands;
mod mysql_admin_commands;
mod netbox_commands;
mod nextcloud_commands;
mod nginx_commands;
mod nginx_proxy_mgr_commands;
mod nx_commands;
mod onedrive_commands;
mod opendkim_commands;
mod opkssh_commands;
mod oracle_cloud_commands;
mod os_detect_commands;
mod osticket_commands;
mod pam_commands;
mod pfsense_commands;
mod pg_admin_commands;
mod php_mgmt_commands;
mod port_knock_commands;
mod portable_commands;
mod postfix_commands;
mod powershell_commands;
mod proc_mgmt_commands;
mod procmail_commands;
mod prometheus_commands;
mod proxmox_commands;
mod rabbitmq_commands;
mod rdpfile_commands;
mod remote_backup_commands;
mod replay_commands;
mod roundcube_commands;
mod rspamd_commands;
mod rustdesk_commands;
mod scheduler_commands;
mod scp_commands;
mod sftp_commands;
mod snmp_commands;
mod spamassassin_commands;
mod spice_commands;
mod ssh_agent_commands;
mod ssh_scripts_commands;
mod supermicro_commands;
mod synology_commands;
mod telegram_commands;
mod termserv_commands;
mod terraform_commands;
mod time_ntp_commands;
mod topology_commands;
mod totp_commands;
mod traefik_commands;
mod ups_mgmt_commands;
mod vmware_commands;
mod vmware_desktop_commands;
mod vnc_commands;
mod warpgate_commands;
mod whatsapp_commands;
mod winmgmt_commands;
mod x2go_commands;
mod xdmcp_commands;
mod yubikey_commands;
mod zabbix_commands;
mod agent_commands;
mod anydesk_commands;
mod backup_commands;
mod cert_auth_commands;
mod cert_gen_commands;
mod chaining_commands;
mod cloudflare_commands;
mod commander_commands;
mod db_commands;
mod digital_ocean_commands;
mod heroku_commands;
mod http_commands;
mod ibm_commands;
mod legacy_crypto_commands;
mod linode_commands;
mod meshcentral_commands;
mod network_commands;
mod openvpn_commands;
mod ovh_commands;
mod passkey_commands;
mod proxy_commands;
mod qr_commands;
mod raw_socket_commands;
mod rlogin_commands;
mod rpc_commands;
mod scaleway_commands;
mod security_commands;
mod storage_commands;
mod tailscale_commands;
mod trust_store_commands;
mod vercel_commands;
mod wireguard_commands;
mod wmi_commands;
mod wol_commands;
mod zerotier_commands;
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
        .setup(|app| Ok(state_registry::register(app)?))
        .invoke_handler(invoke_handler::build())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
