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

// ── Re-export crate modules under their original names ──────────────
// This preserves path compatibility for tauri::generate_handler![]

// Core
pub use sorng_core::diagnostics;
pub use sorng_core::native_renderer;

// Auth
pub use sorng_auth::auth;
pub use sorng_auth::security;
pub use sorng_auth::cert_auth;
pub use sorng_auth::cert_gen;
pub use sorng_auth::two_factor;
pub use sorng_auth::bearer_auth;
pub use sorng_auth::passkey;
pub use sorng_auth::login_detection;
pub use sorng_auth::auto_lock;
pub use sorng_auth::legacy_crypto;

// Storage
pub use sorng_storage::storage;
pub use sorng_storage::backup;
pub use sorng_storage::trust_store;

// Biometrics (native OS biometric authentication)
pub use sorng_biometrics as biometrics;

// Vault (native OS vault / keychain integration)
pub use sorng_vault as vault;

// GPO
pub use sorng_gpo::gpo;

// Network
pub use sorng_network::network;
pub use sorng_network::wol;
pub use sorng_network::qr;

// SSH
pub use sorng_ssh::ssh;
pub use sorng_ssh::ssh3;
pub use sorng_ssh::script;

// SFTP (dedicated crate)
pub use sorng_sftp::sftp;

// RDP
pub use sorng_rdp::rdp;
pub use sorng_rdp::gfx;
pub use sorng_rdp::h264;

// Protocols
pub use sorng_vnc::vnc;
pub use sorng_telnet::telnet;
pub use sorng_serial::serial;
pub use sorng_protocols::rlogin;
pub use sorng_protocols::raw_socket;
pub use sorng_ftp::ftp;
pub use sorng_protocols::db;
pub use sorng_protocols::http;

// VPN
pub use sorng_vpn::openvpn;
pub use sorng_vpn::wireguard;
pub use sorng_vpn::zerotier;
pub use sorng_vpn::tailscale;
pub use sorng_vpn::proxy;
pub use sorng_vpn::chaining;

// Cloud
pub use sorng_aws as aws;
pub use sorng_gcp as gcp;
pub use sorng_azure as azure;
pub use sorng_exchange as exchange;
pub use sorng_smtp as smtp;
pub use sorng_cloud::ibm;
pub use sorng_cloud::digital_ocean;
pub use sorng_cloud::heroku;
pub use sorng_cloud::scaleway;
pub use sorng_cloud::linode;
pub use sorng_cloud::ovh;
pub use sorng_cloud::vercel;
pub use sorng_cloud::cloudflare;

// Remote Management
pub use sorng_remote_mgmt::wmi;
pub use sorng_remote_mgmt::rpc;
pub use sorng_remote_mgmt::meshcentral;
pub use sorng_remote_mgmt::agent;
pub use sorng_remote_mgmt::commander;
pub use sorng_remote_mgmt::anydesk;

// RustDesk (dedicated crate)
pub use sorng_rustdesk::rustdesk;

// Bitwarden (dedicated crate)
pub use sorng_bitwarden::bitwarden;

// KeePass (dedicated crate)
pub use sorng_keepass::keepass;

// Passbolt (dedicated crate)
pub use sorng_passbolt::passbolt;

// SCP (dedicated crate)
pub use sorng_scp::scp;

// Database client crates
pub use sorng_mysql::mysql;
pub use sorng_postgres::postgres;
pub use sorng_mssql::mssql;
pub use sorng_sqlite::sqlite;
pub use sorng_mongodb::mongodb;
pub use sorng_redis::redis;

// AI Agent (dedicated crate)
pub use sorng_ai_agent::ai_agent;

// 1Password (dedicated crate)
pub use sorng_1password::onepassword;

// LastPass (dedicated crate)
pub use sorng_lastpass::lastpass;

// Google Passwords (dedicated crate)
pub use sorng_google_passwords::google_passwords;

// Dashlane (dedicated crate)
pub use sorng_dashlane::dashlane;

// Hyper-V (dedicated crate)
pub use sorng_hyperv as hyperv;

// VMware / vSphere (dedicated crate)
pub use sorng_vmware as vmware;

// VMware Desktop — Player, Workstation, Fusion (dedicated crate)
pub use sorng_vmware_desktop as vmware_desktop;

// Proxmox VE (dedicated crate)
pub use sorng_proxmox as proxmox;

// Dell iDRAC management (dedicated crate)
pub use sorng_idrac as idrac;

// HP iLO management (dedicated crate)
pub use sorng_ilo as ilo;

// Lenovo XCC/IMM management (dedicated crate)
pub use sorng_lenovo as lenovo;

// Supermicro BMC management (dedicated crate)
pub use sorng_supermicro as supermicro;

// Synology NAS management (dedicated crate)
pub use sorng_synology as synology;

// MeshCentral (dedicated crate)
pub use sorng_meshcentral::meshcentral as meshcentral_dedicated;

// mRemoteNG import/export (dedicated crate)
pub use sorng_mremoteng::mremoteng as mremoteng_dedicated;

// Terminal Services management (dedicated crate)
pub use sorng_termserv as termserv;

// WhatsApp Cloud API & Web integration (dedicated crate)
pub use sorng_whatsapp as whatsapp;

// Telegram Bot API integration (dedicated crate)
pub use sorng_telegram as telegram;

// Dropbox API v2 integration (dedicated crate)
pub use sorng_dropbox as dropbox;

// Nextcloud WebDAV/OCS integration (dedicated crate)
pub use sorng_nextcloud as nextcloud;

// Google Drive API v3 integration (dedicated crate)
pub use sorng_gdrive as gdrive;

// Recording engine – session capture, encoding, compression, storage (dedicated crate)
pub use sorng_recording as recording;

// LLM backend management (dedicated crate)
pub use sorng_llm as llm;

// AI Assist for SSH autocomplete (dedicated crate)
pub use sorng_ai_assist as ai_assist;

// Command Palette — unified SSH command search, history, snippets, AI completions (dedicated crate)
pub use sorng_command_palette as command_palette;

// Font management — full SSH/app font customization with 50+ built-in fonts (dedicated crate)
pub use sorng_fonts as fonts;

// Secure clipboard — password copy/paste with auto-clear, one-time paste, paste-to-terminal
pub use sorng_secure_clip as secure_clip;

// Terminal theming engine (dedicated crate)
pub use sorng_terminal_themes as terminal_themes;

// Extensions engine (dedicated crate)
pub use sorng_extensions as extensions;

// Collaboration — multi-user workspace sharing, presence tracking, RBAC (dedicated crate)
pub use sorng_collaboration as collaboration;

// Gateway — headless connection proxy, tunnels, policies, metrics (dedicated crate)
pub use sorng_gateway as gateway;

// Let's Encrypt / ACME — automated TLS certificate management (dedicated crate)
pub use sorng_letsencrypt as letsencrypt;

// OpenSSH Agent — built-in agent, system agent bridge, key management, forwarding, constraints (dedicated crate)
pub use sorng_ssh_agent as ssh_agent;

// OpenPubkey SSH (opkssh) — OIDC-based SSH authentication (dedicated crate)
pub use sorng_opkssh as opkssh;

// P2P — STUN/TURN/ICE, NAT traversal, hole punching, signaling, peer discovery (dedicated crate)
pub use sorng_p2p as p2p;

// Tailscale — daemon management, ACLs, MagicDNS, Funnel, Serve, SSH, exit nodes (dedicated crate)
pub use sorng_tailscale as tailscale_dedicated;

// ZeroTier — daemon, networks, peers, flow rules, self-hosted controller (dedicated crate)
pub use sorng_zerotier as zerotier_dedicated;

// WireGuard — config management, key generation, routing, DNS leak prevention, NAT keepalive (dedicated crate)
pub use sorng_wireguard as wireguard_dedicated;

// DNS — unified DNS resolution: DoH, DoT, ODoH, DNSSEC, caching, mDNS, leak detection (dedicated crate)
pub use sorng_dns as dns;

// Kubernetes — cluster management, workloads, RBAC, Helm, metrics (dedicated crate)
pub use sorng_k8s as k8s;

// Docker — container lifecycle, images, volumes, networks, compose, registry (dedicated crate)
pub use sorng_docker as docker;

// LXD / Incus — instances, snapshots, backups, images, profiles, networks, storage, projects, cluster, certificates, operations, warnings, migration (dedicated crate)
pub use sorng_lxd as lxd;

// Ansible — playbooks, inventory, ad-hoc commands, vault, galaxy, facts (dedicated crate)
pub use sorng_ansible as ansible;

// Terraform — init, plan, apply, state, workspaces, providers, modules, HCL, drift (dedicated crate)
pub use sorng_terraform as terraform;

// I18n — backend localisation engine with hot-reload, SSR, and Tauri commands (dedicated crate)
pub use sorng_i18n as i18n;

// Budibase — low-code platform integration: apps, tables, rows, views, users, queries, automations, datasources (dedicated crate)
pub use sorng_budibase as budibase;

// osTicket — helpdesk ticketing: tickets, users, departments, topics, agents, teams, SLA, canned responses, custom fields (dedicated crate)
pub use sorng_osticket as osticket;

// Jira — project management: issues, projects, comments, attachments, worklogs, boards, sprints, users, fields, dashboards, filters (dedicated crate)
pub use sorng_jira as jira;

// Warpgate — SSH/HTTPS/MySQL/PostgreSQL bastion host admin API: targets, users, roles, sessions, recordings, tickets, credentials, SSH keys, known hosts, LDAP, logs, parameters (dedicated crate)
pub use sorng_warpgate as warpgate;

// SSH Scripts — action-based & event-based script execution: login/logout scripts, timed/cron/interval scripts, output-match scripts, idle scripts, file-watch scripts, script chains, conditions, variables, history (dedicated crate)
pub use sorng_ssh_scripts as ssh_scripts;

// MCP Server — native Model Context Protocol server for AI assistant integration (dedicated crate, disabled by default)
pub use sorng_mcp as mcp_server;

// SNMP — SNMPv1/v2c/v3 client, walk, table, trap receiver, MIB database, discovery, monitoring (dedicated crate)
pub use sorng_snmp as snmp;

// Dashboard — connection health dashboard with widgets, heatmaps, sparklines, alerts (dedicated crate)
pub use sorng_dashboard;

// Hooks — event hook engine with pipelines, filters, subscribers (dedicated crate)
pub use sorng_hooks;

// Notifications — notification rules engine with channels, templates, throttling, escalation (dedicated crate)
pub use sorng_notifications;

// Topology — connection map and network topology visualizer with graph analysis (dedicated crate)
pub use sorng_topology;

// Filters — smart groups, dynamic filters, presets, evaluation cache (dedicated crate)
pub use sorng_filters;

// Credentials — credential rotation tracking, expiry monitoring, policies, audit (dedicated crate)
pub use sorng_credentials;

// Replay — session replay viewer with timeline scrubbing, annotations, search (dedicated crate)
pub use sorng_replay;

// RDP File — .rdp file import/export, batch operations, full spec support (dedicated crate)
pub use sorng_rdpfile;

// Updater — app auto-updater with channels, rollback, scheduled installs (dedicated crate)
pub use sorng_updater;

// Marketplace — plugin marketplace with git repositories, ratings, dependency resolution (dedicated crate)
pub use sorng_marketplace;

// Portable — portable mode detection, path management, migration (dedicated crate)
pub use sorng_portable;

// Scheduler — cron-like task scheduler with execution engine, history (dedicated crate)
pub use sorng_scheduler;

// App-level module: REST API gateway (stays in the main crate)
pub mod api;

#[cfg(test)]
mod tests {
    mod security_tests;
    mod network_tests;
    mod script_tests;
    mod ssh_tunnel_tests;
}

use auth::{AuthService, AuthServiceState};
use storage::SecureStorage;
use trust_store::TrustStoreService;
use ssh::SshService;
use sftp::SftpService;
use rdp::RdpService;
use vnc::VncService;
use db::DbService;
use ftp::FtpService;
use network::NetworkService;
use security::SecurityService;
use wol::WolService;
use script::ScriptService;
use openvpn::OpenVPNService;
use proxy::ProxyService;
use wireguard::WireGuardService;
use zerotier::ZeroTierService;
use tailscale::TailscaleService;
use chaining::ChainingService;
use qr::QrService;
use rustdesk::RustDeskService;
use anydesk::AnyDeskService;
use bitwarden::BitwardenService;
use keepass::KeePassService;
use passbolt::PassboltService;
use api::ApiService;
use cert_auth::CertAuthService;
use cert_gen::CertGenService;
use two_factor::TwoFactorService;
use bearer_auth::BearerAuthService;
use auto_lock::AutoLockService;
use legacy_crypto::LegacyCryptoPolicyState;
use gpo::GpoService;
use login_detection::LoginDetectionService;
use telnet::TelnetService;
use serial::SerialService;
use rlogin::RloginService;
use raw_socket::RawSocketService;
use gcp::GcpService;
use azure::service::AzureService;
use exchange::service::ExchangeService;
use smtp::service::SmtpService;
use ibm::IbmService;
use digital_ocean::DigitalOceanService;
use heroku::HerokuService;
use scaleway::ScalewayService;
use linode::LinodeService;
use ovh::OvhService;
use http::HttpService;
use http::ProxySessionManager;
use passkey::PasskeyService;
use ssh3::Ssh3Service;
use scp::ScpService;

// Database client services
use mysql::service::MysqlServiceState;
use postgres::service::PostgresServiceState;
use mssql::service::MssqlServiceState;
use sqlite::service::SqliteServiceState;
use mongodb::service::MongoServiceState;
use redis::service::RedisServiceState;
use ai_agent::types::AiAgentServiceState;
use onepassword::service::OnePasswordServiceState;
use lastpass::service::LastPassServiceState;
use google_passwords::service::GooglePasswordsServiceState;
use dashlane::service::DashlaneServiceState;
use hyperv::service::HyperVServiceState;
use vmware::service::VmwareServiceState;
use vmware_desktop::service::VmwDesktopServiceState;
use proxmox::service::ProxmoxServiceState;
use idrac::service::IdracServiceState;
use ilo::service::IloServiceState;
use lenovo::service::LenovoServiceState;
use supermicro::service::SmcServiceState;
use synology::service::SynologyServiceState;
use meshcentral_dedicated::MeshCentralService;
use mremoteng_dedicated::MremotengService;
use termserv::service::TermServServiceState;
use whatsapp::WhatsAppServiceState;
use telegram::TelegramServiceState;
use dropbox::DropboxServiceState;
use recording::RecordingServiceState;
use llm::service::LlmServiceState;
use ai_assist::service::AiAssistServiceState;
use terminal_themes::ThemeEngineState;
use extensions::service::ExtensionsServiceState;
use k8s::service::K8sServiceState;
use docker::service::DockerServiceState;
use lxd::service::LxdService;
use ansible::service::AnsibleServiceState;
use terraform::service::TerraformServiceState;
use i18n::I18nServiceState;
use command_palette::CommandPaletteServiceState;
use fonts::FontServiceState;
use secure_clip::SecureClipServiceState;
use budibase::service::BudibaseServiceState;
use osticket::service::OsticketServiceState;
use jira::service::JiraServiceState;
use warpgate::service::WarpgateServiceState;
use letsencrypt::service::LetsEncryptServiceState;
use ssh_agent::types::SshAgentServiceState;
use opkssh::service::OpksshServiceState;
use ssh_scripts::engine::SshScriptEngineState;
use mcp_server::McpServiceState as McpServerServiceState;
use snmp::service::SnmpServiceState;

use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::Manager;
use std::env;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
struct LaunchArgs {
  collection_id: Option<String>,
  connection_id: Option<String>,
}

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
    .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--autostart"])))
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .setup(|app| {
      // Parse command line arguments
      let args: Vec<String> = env::args().collect();
      let mut _collection_id = None;
      let mut _connection_id = None;
      
      let mut i = 1;
      while i < args.len() {
        match args[i].as_str() {
          "--collection" | "-c" => {
            if i + 1 < args.len() {
              _collection_id = Some(args[i + 1].clone());
              i += 2;
            } else {
              i += 1;
            }
          }
          "--connection" | "-n" => {
            if i + 1 < args.len() {
              _connection_id = Some(args[i + 1].clone());
              i += 2;
            } else {
              i += 1;
            }
          }
          _ => {
            i += 1;
          }
        }
      }

      app.manage(LaunchArgs {
        collection_id: _collection_id.clone(),
        connection_id: _connection_id.clone(),
      });

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // ── CPU feature detection & performance logging ────────────────
      // Run once at startup to log all hardware capabilities.
      // This helps diagnose performance issues and confirms that
      // compile-time target features (from .cargo/config.toml) are
      // actually active.
      sorng_core::cpu_features::log_all_features();

      // Initialize auth service
      let app_dir = app.path().app_data_dir().unwrap();
      let user_store_path = app_dir.join("users.json");
      let auth_service = AuthService::new(user_store_path.to_string_lossy().to_string());
      app.manage(auth_service.clone());

      // Initialize storage
      let storage_path = app_dir.join("storage.json");
      let secure_storage = SecureStorage::new(storage_path.to_string_lossy().to_string());
      app.manage(secure_storage);

      // Initialize trust store
      let trust_store_path = app_dir.join("trust_store.json");
      let trust_store_service = TrustStoreService::new(trust_store_path.to_string_lossy().to_string());
      app.manage(trust_store_service);

      // Initialize SSH service
      let ssh_service = SshService::new();
      app.manage(ssh_service.clone());

      // Initialize SFTP service (dedicated crate)
      let sftp_service = SftpService::new();
      app.manage(sftp_service.clone());

      // Initialize RDP service
      let rdp_service = RdpService::new();
      app.manage(rdp_service);

      // Initialize shared RDP framebuffer store (raw binary frame delivery)
      let frame_store = rdp::SharedFrameStore::new();
      app.manage(frame_store);

      // Initialize VNC service
      let vnc_service = VncService::new_state();
      app.manage(vnc_service);

      // Initialize AnyDesk service
      let anydesk_service = AnyDeskService::new();
      app.manage(anydesk_service);

      // Initialize DB service
      let db_service = DbService::new();
      app.manage(db_service.clone());

      // Initialize FTP service
      let ftp_service = FtpService::new();
      app.manage(ftp_service.clone());

      // Initialize Network service
      let network_service = NetworkService::new();
      app.manage(network_service.clone());

      // Initialize Security service
      let security_service = SecurityService::new();
      app.manage(security_service.clone());

      // Initialize WOL service
      let wol_service = WolService::new();
      app.manage(wol_service.clone());

      // Initialize Script service
      let script_service = ScriptService::new(ssh_service.clone());
      app.manage(script_service);

      // Initialize OpenVPN service
      let openvpn_service = OpenVPNService::new();
      app.manage(openvpn_service.clone());

      // Initialize Proxy service
      let proxy_service = ProxyService::new();
      app.manage(proxy_service.clone());

      // Initialize WireGuard service
      let wireguard_service = WireGuardService::new();
      app.manage(wireguard_service.clone());

      // Initialize ZeroTier service
      let zerotier_service = ZeroTierService::new();
      app.manage(zerotier_service.clone());

      // Initialize Tailscale service
      let tailscale_service = TailscaleService::new();
      app.manage(tailscale_service.clone());

      // Initialize Chaining service
      let chaining_service = ChainingService::new(
        proxy_service.clone(),
        openvpn_service.clone(),
        wireguard_service.clone(),
        zerotier_service.clone(),
        tailscale_service.clone(),
      );
      app.manage(chaining_service);

      // Initialize QR service
      let qr_service = QrService::new();
      app.manage(qr_service.clone());

      // Initialize RustDesk service
      let rustdesk_service = RustDeskService::new();
      app.manage(rustdesk_service.clone());

      // Initialize WMI service
      let wmi_service = wmi::WmiService::new();
      app.manage(wmi_service.clone());

      // Initialize RPC service
      let rpc_service = rpc::RpcService::new();
      app.manage(rpc_service.clone());

      // Initialize MeshCentral service
      let meshcentral_service = meshcentral::MeshCentralService::new();
      app.manage(meshcentral_service.clone());

      // Initialize Agent service
      let agent_service = agent::AgentService::new();
      app.manage(agent_service.clone());

      // Initialize Commander service
      let commander_service = commander::CommanderService::new();
      app.manage(commander_service.clone());

      // Initialize AWS service
      let aws_service = aws::AwsService::new();
      app.manage(aws_service.clone());

      // Initialize Vercel service
      let vercel_service = vercel::VercelService::new();
      app.manage(vercel_service.clone());

      // Initialize Cloudflare service
      let cloudflare_service = cloudflare::CloudflareService::new();
      app.manage(cloudflare_service.clone());

      // Initialize Certificate Authentication service
      let cert_auth_service = CertAuthService::new("certificates.db".to_string());
      app.manage(cert_auth_service.clone());

      // Initialize Certificate Generation service
      let cert_gen_service = CertGenService::new("cert_gen_store.json".to_string());
      app.manage(cert_gen_service.clone());

      // Initialize Legacy Crypto Policy (all disabled by default)
      let legacy_crypto_policy_state = legacy_crypto::new_policy_state();
      app.manage(legacy_crypto_policy_state);

      // Initialize Two-Factor Authentication service
      let two_factor_service = TwoFactorService::new();
      app.manage(two_factor_service.clone());

      // Initialize Bearer Authentication service
      let bearer_auth_service = BearerAuthService::new();
      app.manage(bearer_auth_service.clone());

      // Initialize Auto-Lock service
      let auto_lock_service = AutoLockService::new();
      app.manage(auto_lock_service.clone());

      // Start auto-lock monitoring in background
      let auto_lock_clone = auto_lock_service.clone();
      tauri::async_runtime::spawn(async move {
        let mut service = auto_lock_clone.lock().await;
        service.start_monitoring().await;
      });

      // Initialize GPO service
      let gpo_service = GpoService::new();
      app.manage(gpo_service.clone());

      // Initialize Login Detection service
      let login_detection_service = LoginDetectionService::new();
      app.manage(login_detection_service.clone());

      // Initialize Telnet service
      let telnet_service = TelnetService::new();
      app.manage(telnet_service.clone());

      // Initialize Serial service
      let serial_service = SerialService::new();
      app.manage(serial_service.clone());

      // Initialize Rlogin service
      let rlogin_service = RloginService::new();
      app.manage(rlogin_service.clone());

      // Initialize Raw Socket service
      let raw_socket_service = RawSocketService::new();
      app.manage(raw_socket_service.clone());

      // Initialize GCP service
      let gcp_service = GcpService::new();
      app.manage(gcp_service.clone());

      // Initialize Azure service
      let azure_service = AzureService::new();
      app.manage(azure_service.clone());

      // Initialize Exchange service
      let exchange_service = ExchangeService::new();
      app.manage(exchange_service.clone());

      // Initialize SMTP service
      let smtp_service = SmtpService::new();
      app.manage(smtp_service.clone());

      // Initialize IBM Cloud service
      let ibm_service = IbmService::new();
      app.manage(ibm_service.clone());

      // Initialize Digital Ocean service
      let digital_ocean_service = DigitalOceanService::new();
      app.manage(digital_ocean_service.clone());

      // Initialize Heroku service
      let heroku_service = HerokuService::new();
      app.manage(heroku_service.clone());

      // Initialize Scaleway service
      let scaleway_service = ScalewayService::new();
      app.manage(scaleway_service.clone());

      // Initialize Linode service
      let linode_service = LinodeService::new();
      app.manage(linode_service.clone());

      // Initialize OVH service
      let ovh_service = OvhService::new();
      app.manage(ovh_service.clone());

      // Initialize HTTP service
      let http_service = HttpService::new();
      app.manage(http_service.clone());

      // Initialize proxy session manager
      let proxy_session_mgr = ProxySessionManager::new();
      app.manage(proxy_session_mgr.clone());

      // Initialize Passkey service
      let passkey_service = PasskeyService::new();
      app.manage(passkey_service.clone());

      // Initialize SSH3 service (SSH over HTTP/3 QUIC)
      let ssh3_service: ssh3::Ssh3ServiceState = std::sync::Arc::new(tokio::sync::Mutex::new(Ssh3Service::new()));
      app.manage(ssh3_service.clone());

      // Initialize Backup service
      let backup_path = app_dir.join("backups");
      let backup_service = backup::BackupService::new(backup_path.to_string_lossy().to_string());
      app.manage(backup_service.clone());

      // Initialize Bitwarden service
      let bw_service = BitwardenService::new_state();
      app.manage(bw_service);

      // Initialize KeePass service
      let keepass_service = KeePassService::new();
      app.manage(keepass_service.clone());

      // Initialize Passbolt service
      let pb_service = PassboltService::new_state();
      app.manage(pb_service);

      // Initialize SCP service
      let scp_service = ScpService::new();
      app.manage(scp_service.clone());

      // Initialize database client services
      let mysql_service: MysqlServiceState = mysql::service::new_state();
      app.manage(mysql_service);

      let postgres_service: PostgresServiceState = postgres::service::new_state();
      app.manage(postgres_service);

      let mssql_service: MssqlServiceState = mssql::service::new_state();
      app.manage(mssql_service);

      let sqlite_service: SqliteServiceState = sqlite::service::new_state();
      app.manage(sqlite_service);

      let mongodb_service: MongoServiceState = mongodb::service::new_state();
      app.manage(mongodb_service);

      let redis_service: RedisServiceState = redis::service::new_state();
      app.manage(redis_service);

      // Initialize AI Agent service
      let ai_agent_service: AiAgentServiceState = Arc::new(Mutex::new(ai_agent::service::AiAgentService::new()));
      app.manage(ai_agent_service);

      // Initialize 1Password service
      let onepassword_service: OnePasswordServiceState = Arc::new(Mutex::new(onepassword::service::OnePasswordService::new()));
      app.manage(onepassword_service);

      // Initialize LastPass service
      let lastpass_service: LastPassServiceState = Arc::new(Mutex::new(lastpass::service::LastPassService::new()));
      app.manage(lastpass_service);

      // Initialize Google Passwords service
      let google_passwords_service: GooglePasswordsServiceState = Arc::new(Mutex::new(google_passwords::service::GooglePasswordsService::new()));
      app.manage(google_passwords_service);

      // Initialize Dashlane service
      let dashlane_service: DashlaneServiceState = Arc::new(Mutex::new(dashlane::service::DashlaneService::new()));
      app.manage(dashlane_service);

      // Initialize Hyper-V service
      let hyperv_service: HyperVServiceState = Arc::new(Mutex::new(hyperv::service::HyperVService::new()));
      app.manage(hyperv_service);

      // Initialize VMware / vSphere service
      let vmware_service: VmwareServiceState = Arc::new(Mutex::new(vmware::service::VmwareService::new()));
      app.manage(vmware_service);

      // Initialize VMware Desktop (Player / Workstation / Fusion) service
      let vmware_desktop_service: VmwDesktopServiceState = Arc::new(Mutex::new(vmware_desktop::service::VmwDesktopService::new()));
      app.manage(vmware_desktop_service);

      // Initialize Proxmox VE service
      let proxmox_service: ProxmoxServiceState = Arc::new(Mutex::new(proxmox::service::ProxmoxService::new()));
      app.manage(proxmox_service);

      // Initialize Dell iDRAC service
      let idrac_service: IdracServiceState = Arc::new(Mutex::new(idrac::service::IdracService::new()));
      app.manage(idrac_service);

      // Initialize HP iLO service
      let ilo_service: IloServiceState = Arc::new(Mutex::new(ilo::service::IloService::new()));
      app.manage(ilo_service);

      // Initialize Lenovo XCC/IMM service
      let lenovo_service: LenovoServiceState = Arc::new(Mutex::new(lenovo::service::LenovoService::new()));
      app.manage(lenovo_service);

      // Initialize Supermicro BMC service
      let smc_service: SmcServiceState = Arc::new(Mutex::new(supermicro::service::SmcService::new()));
      app.manage(smc_service);

      // Initialize Synology NAS service
      let synology_service: SynologyServiceState = Arc::new(Mutex::new(synology::service::SynologyService::new()));
      app.manage(synology_service);

      // Initialize MeshCentral service
      let meshcentral_dedicated_service = MeshCentralService::new();
      app.manage(meshcentral_dedicated_service);

      // Initialize mRemoteNG import/export service
      let mremoteng_service = MremotengService::new();
      app.manage(mremoteng_service);

      // Initialize Terminal Services management service
      let termserv_state = termserv::service::TermServService::new_state();
      app.manage(termserv_state);

      // Initialize WhatsApp Cloud API & Web service
      let whatsapp_state: WhatsAppServiceState = std::sync::Arc::new(tokio::sync::Mutex::new(
          whatsapp::service::WhatsAppService::new(),
      ));
      app.manage(whatsapp_state);

      // Initialize Telegram Bot API service
      let telegram_state = telegram::service::TelegramService::new();
      app.manage(telegram_state);

      // Initialize Dropbox API v2 integration service
      let dropbox_state = dropbox::service::DropboxService::new();
      app.manage(dropbox_state);

      // Initialize Nextcloud WebDAV/OCS integration service
      let nextcloud_state = nextcloud::service::NextcloudService::new();
      app.manage(nextcloud_state);

      // Initialize Google Drive API v3 integration service
      let gdrive_state = gdrive::service::GDriveService::new();
      app.manage(gdrive_state);

      // Initialize Recording engine service
      let rec_app_dir = app_dir.to_string_lossy().to_string();
      let rec_state: RecordingServiceState = recording::service::new_service_state(&rec_app_dir);
      app.manage(rec_state);

      // Initialize LLM service
      let llm_state: LlmServiceState = llm::service::create_llm_state();
      app.manage(llm_state.clone());

      // Initialize AI Assist service
      let ai_assist_state: AiAssistServiceState = ai_assist::service::create_ai_assist_state(
          ai_assist::AiAssistConfig::default(),
          Some(llm_state.clone()),
      );
      app.manage(ai_assist_state.clone());

      // Initialize Command Palette service
      let palette_state: CommandPaletteServiceState = command_palette::create_palette_state(
          &app_dir,
          Some(llm_state.clone()),
      );
      app.manage(palette_state.clone());

      // Initialize Font service
      let font_state: FontServiceState = fonts::create_font_state(&app_dir);
      app.manage(font_state.clone());

      // Initialize Secure Clipboard service
      let secure_clip_state: SecureClipServiceState = secure_clip::create_secure_clip_state();
      app.manage(secure_clip_state.clone());

      // Initialize Terminal Themes engine
      let theme_engine_state: ThemeEngineState = terminal_themes::engine::create_theme_engine_state();
      app.manage(theme_engine_state.clone());

      // Initialize Extensions engine
      let extensions_state: ExtensionsServiceState = extensions::service::ExtensionsService::new();
      app.manage(extensions_state.clone());

      // Initialize Kubernetes service
      let k8s_state: K8sServiceState = Arc::new(Mutex::new(k8s::service::K8sService::new()));
      app.manage(k8s_state);

      // Initialize Docker service
      let docker_state: DockerServiceState = Arc::new(Mutex::new(docker::service::DockerService::new()));
      app.manage(docker_state);

      // Initialize LXD / Incus service
      let lxd_service = LxdService::new();
      app.manage(lxd_service);

      // Initialize Ansible service
      let ansible_state: AnsibleServiceState = Arc::new(Mutex::new(ansible::service::AnsibleService::new()));
      app.manage(ansible_state);

      // Initialize Terraform service
      let terraform_state: TerraformServiceState = Arc::new(Mutex::new(terraform::service::TerraformService::new()));
      app.manage(terraform_state);

      // Initialize Budibase service
      let budibase_state: BudibaseServiceState = Arc::new(Mutex::new(budibase::service::BudibaseService::new()));
      app.manage(budibase_state);

      // Initialize osTicket service
      let osticket_state: OsticketServiceState = Arc::new(Mutex::new(osticket::service::OsticketService::new()));
      app.manage(osticket_state);

      // Initialize Jira service
      let jira_state: JiraServiceState = Arc::new(Mutex::new(jira::service::JiraService::new()));
      app.manage(jira_state);

      // Initialize Warpgate service
      let warpgate_state: WarpgateServiceState = Arc::new(Mutex::new(warpgate::service::WarpgateService::new()));
      app.manage(warpgate_state);

      // Initialize Let's Encrypt / ACME service
      let le_storage = app_dir.join(".letsencrypt").to_string_lossy().to_string();
      let le_state = letsencrypt::service::LetsEncryptService::new_default(&le_storage);
      app.manage(le_state);

      // Initialize OpenPubkey SSH (opkssh) service
      let opkssh_state: OpksshServiceState = Arc::new(Mutex::new(opkssh::service::OpksshService::new()));
      app.manage(opkssh_state);

      // Initialize SSH event-scripts engine
      let ssh_scripts_state: SshScriptEngineState = ssh_scripts::engine::SshScriptEngine::new_state();
      app.manage(ssh_scripts_state);

      // Initialize MCP server (disabled by default)
      let mcp_state: McpServerServiceState = mcp_server::service::create_service_state();
      app.manage(mcp_state);

      // Initialize SSH Agent service
      let ssh_agent_state: SshAgentServiceState = Arc::new(Mutex::new(ssh_agent::service::SshAgentService::new()));
      app.manage(ssh_agent_state);

      // Initialize SNMP service
      let snmp_state: SnmpServiceState = Arc::new(Mutex::new(snmp::service::SnmpService::new()));
      app.manage(snmp_state);

      // Initialize i18n engine with hot-reload
      let locales_dir = app.path().resource_dir()
          .unwrap_or_else(|_| app_dir.clone())
          .join("locales");
      // Fallback: also try the source tree locales used during development
      let locales_dir = if locales_dir.exists() {
          locales_dir
      } else {
          std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
              .join("..")
              .join("src")
              .join("i18n")
              .join("locales")
      };
      let i18n_engine = match i18n::I18nEngine::new(&locales_dir, "en") {
          Ok(e) => std::sync::Arc::new(e),
          Err(err) => {
              log::warn!("i18n: failed to initialise engine: {err}");
              std::sync::Arc::new(i18n::I18nEngine::new_empty("en"))
          }
      };
      let i18n_watcher = i18n::watcher::I18nWatcher::start_with_tauri_events(
          i18n_engine.clone(),
          app.handle().clone(),
      ).ok();
      app.manage(I18nServiceState {
          engine: i18n_engine,
          _watcher: i18n_watcher,
      });

      // Initialize API service
      let api_service = ApiService::new(
        auth_service.clone(),
        ssh_service.clone(),
        db_service.clone(),
        ftp_service.clone(),
        network_service.clone(),
        security_service.clone(),
        wol_service.clone(),
        qr_service.clone(),
        rustdesk_service.clone(),
        wmi_service.clone(),
        rpc_service.clone(),
        meshcentral_service.clone(),
        agent_service.clone(),
        commander_service.clone(),
        aws_service.clone(),
        vercel_service.clone(),
        cloudflare_service.clone(),
      );
      app.manage(api_service.clone());

      // Start the REST API server in a background task
      let api_service_clone = api_service.clone();
      println!("About to start REST API server...");
      tauri::async_runtime::spawn(async move {
        println!("Starting API server task...");
        if let Err(e) = Arc::new(api_service_clone).start_server(3001).await {
          eprintln!("Failed to start REST API server: {}", e);
        }
      });
      println!("API server task spawned");

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
        greet,
        open_devtools,
        open_url_external,
        get_launch_args,
        add_user,
        verify_user,
        list_users,
        remove_user,
        update_password,
        storage::has_stored_data,
        storage::is_storage_encrypted,
        storage::save_data,
        storage::load_data,
        storage::clear_storage,
        storage::set_storage_password,
        // Trust store commands
        trust_store::trust_verify_identity,
        trust_store::trust_store_identity,
        trust_store::trust_store_identity_with_reason,
        trust_store::trust_remove_identity,
        trust_store::trust_get_identity,
        trust_store::trust_get_all_records,
        trust_store::trust_clear_all,
        trust_store::trust_update_nickname,
        trust_store::trust_get_policy,
        trust_store::trust_set_policy,
        trust_store::trust_get_policy_config,
        trust_store::trust_set_policy_config,
        trust_store::trust_set_host_policy,
        trust_store::trust_revoke_identity,
        trust_store::trust_reinstate_identity,
        trust_store::trust_set_record_tags,
        trust_store::trust_get_identity_history,
        trust_store::trust_get_verification_stats,
        trust_store::trust_get_summary,
        ssh::connect_ssh,
        ssh::execute_command,
        ssh::execute_command_interactive,
        ssh::start_shell,
        ssh::send_ssh_input,
        ssh::resize_ssh_shell,
        ssh::setup_port_forward,
        ssh::list_directory,
        ssh::upload_file,
        ssh::download_file,
        ssh::disconnect_ssh,
        ssh::get_session_info,
        ssh::list_sessions,
        ssh::validate_mixed_chain,
        ssh::jump_hosts_to_mixed_chain,
        ssh::proxy_chain_to_mixed_chain,
        ssh::test_mixed_chain_connection,
        rdp::connect_rdp,
        rdp::disconnect_rdp,
        rdp::attach_rdp_session,
        rdp::detach_rdp_session,
        rdp::rdp_send_input,
        rdp::rdp_get_frame_data,
        rdp::get_rdp_session_info,
        rdp::list_rdp_sessions,
        rdp::get_rdp_stats,
        rdp::detect_keyboard_layout,
        rdp::diagnose_rdp_connection,
        rdp::rdp_sign_out,
        rdp::rdp_force_reboot,
        rdp::reconnect_rdp_session,
        rdp::rdp_get_thumbnail,
        rdp::rdp_save_screenshot,
        rdp::get_rdp_logs,
        vnc::connect_vnc,
        vnc::disconnect_vnc,
        vnc::disconnect_all_vnc,
        vnc::is_vnc_connected,
        vnc::get_vnc_session_info,
        vnc::list_vnc_sessions,
        vnc::get_vnc_session_stats,
        vnc::send_vnc_key_event,
        vnc::send_vnc_pointer_event,
        vnc::send_vnc_clipboard,
        vnc::request_vnc_update,
        vnc::set_vnc_pixel_format,
        vnc::prune_vnc_sessions,
        vnc::get_vnc_session_count,
        anydesk::launch_anydesk,
        anydesk::disconnect_anydesk,
        anydesk::get_anydesk_session,
        anydesk::list_anydesk_sessions,
        db::connect_mysql,
        db::execute_query,
        db::disconnect_db,
        db::get_databases,
        db::get_tables,
        db::get_table_structure,
        db::create_database,
        db::drop_database,
        db::create_table,
        db::drop_table,
        db::get_table_data,
        db::insert_row,
        db::update_row,
        db::delete_row,
        db::export_table,
        db::export_table_chunked,
        db::export_database,
        db::export_database_chunked,
        db::import_sql,
        db::import_csv,
        ftp::ftp_connect,
        ftp::ftp_disconnect,
        ftp::ftp_disconnect_all,
        ftp::ftp_get_session_info,
        ftp::ftp_list_sessions,
        ftp::ftp_ping,
        ftp::ftp_list_directory,
        ftp::ftp_set_directory,
        ftp::ftp_get_current_directory,
        ftp::ftp_mkdir,
        ftp::ftp_mkdir_all,
        ftp::ftp_rmdir,
        ftp::ftp_rmdir_recursive,
        ftp::ftp_rename,
        ftp::ftp_delete_file,
        ftp::ftp_chmod,
        ftp::ftp_get_file_size,
        ftp::ftp_get_modified_time,
        ftp::ftp_stat_entry,
        ftp::ftp_upload_file,
        ftp::ftp_download_file,
        ftp::ftp_append_file,
        ftp::ftp_resume_upload,
        ftp::ftp_resume_download,
        ftp::ftp_enqueue_transfer,
        ftp::ftp_cancel_transfer,
        ftp::ftp_list_transfers,
        ftp::ftp_get_transfer_progress,
        ftp::ftp_get_all_progress,
        ftp::ftp_get_diagnostics,
        ftp::ftp_get_pool_stats,
        ftp::ftp_list_bookmarks,
        ftp::ftp_add_bookmark,
        ftp::ftp_remove_bookmark,
        ftp::ftp_update_bookmark,
        ftp::ftp_site_command,
        ftp::ftp_raw_command,
        network::ping_host,
        network::ping_host_detailed,
        network::ping_gateway,
        network::check_port,
        network::dns_lookup,
        network::classify_ip,
        network::traceroute,
        network::scan_network,
        network::scan_network_comprehensive,
        network::tcp_connection_timing,
        network::check_mtu,
        network::detect_icmp_blockade,
        network::check_tls,
        network::fingerprint_service,
        network::detect_asymmetric_routing,
        network::probe_udp_port,
        network::lookup_ip_geo,
        network::detect_proxy_leakage,
        security::generate_totp_secret,
        security::verify_totp,
        wol::wake_on_lan,
        wol::wake_multiple_hosts,
        wol::discover_wol_devices,
        wol::add_wol_schedule,
        wol::remove_wol_schedule,
        wol::list_wol_schedules,
        wol::update_wol_schedule,
        script::execute_user_script,
        openvpn::create_openvpn_connection,
        openvpn::connect_openvpn,
        openvpn::disconnect_openvpn,
        openvpn::get_openvpn_connection,
        openvpn::list_openvpn_connections,
        openvpn::delete_openvpn_connection,
        openvpn::get_openvpn_status,
        proxy::create_proxy_connection,
        proxy::connect_via_proxy,
        proxy::disconnect_proxy,
        proxy::get_proxy_connection,
        proxy::list_proxy_connections,
        proxy::delete_proxy_connection,
        proxy::create_proxy_chain,
        proxy::connect_proxy_chain,
        proxy::disconnect_proxy_chain,
        proxy::get_proxy_chain,
        proxy::list_proxy_chains,
        proxy::delete_proxy_chain,
        proxy::get_proxy_chain_health,
        wireguard::create_wireguard_connection,
        wireguard::connect_wireguard,
        wireguard::disconnect_wireguard,
        wireguard::get_wireguard_connection,
        wireguard::list_wireguard_connections,
        wireguard::delete_wireguard_connection,
        zerotier::create_zerotier_connection,
        zerotier::connect_zerotier,
        zerotier::disconnect_zerotier,
        zerotier::get_zerotier_connection,
        zerotier::list_zerotier_connections,
        zerotier::delete_zerotier_connection,
        tailscale::create_tailscale_connection,
        tailscale::connect_tailscale,
        tailscale::disconnect_tailscale,
        tailscale::get_tailscale_connection,
        tailscale::list_tailscale_connections,
        tailscale::delete_tailscale_connection,
        chaining::create_connection_chain,
        chaining::connect_connection_chain,
        chaining::disconnect_connection_chain,
        chaining::get_connection_chain,
        chaining::list_connection_chains,
        chaining::delete_connection_chain,
        chaining::update_connection_chain_layers,
        qr::generate_qr_code,
        qr::generate_qr_code_png,
        wmi::connect_wmi,
        wmi::disconnect_wmi,
        wmi::execute_wmi_query,
        wmi::get_wmi_session,
        wmi::list_wmi_sessions,
        wmi::get_wmi_classes,
        wmi::get_wmi_namespaces,
        rpc::connect_rpc,
        rpc::disconnect_rpc,
        rpc::call_rpc_method,
        rpc::get_rpc_session,
        rpc::list_rpc_sessions,
        rpc::discover_rpc_methods,
        rpc::batch_rpc_calls,
        meshcentral::connect_meshcentral,
        meshcentral::disconnect_meshcentral,
        meshcentral::get_meshcentral_devices,
        meshcentral::get_meshcentral_groups,
        meshcentral::execute_meshcentral_command,
        meshcentral::get_meshcentral_command_result,
        meshcentral::get_meshcentral_session,
        meshcentral::list_meshcentral_sessions,
        meshcentral::get_meshcentral_server_info,
        agent::connect_agent,
        agent::disconnect_agent,
        agent::get_agent_metrics,
        agent::get_agent_logs,
        agent::execute_agent_command,
        agent::get_agent_command_result,
        agent::get_agent_session,
        agent::list_agent_sessions,
        agent::update_agent_status,
        agent::get_agent_info,
        commander::connect_commander,
        commander::disconnect_commander,
        commander::execute_commander_command,
        commander::get_commander_command_result,
        commander::upload_commander_file,
        commander::download_commander_file,
        commander::get_commander_file_transfer,
        commander::list_commander_directory,
        commander::get_commander_session,
        commander::list_commander_sessions,
        commander::update_commander_status,
        commander::get_commander_system_info,
        aws::connect_aws,
        aws::disconnect_aws,
        aws::list_aws_sessions,
        aws::get_aws_session,
        aws::list_ec2_instances,
        aws::list_s3_buckets,
        aws::get_s3_objects,
        aws::list_rds_instances,
        aws::list_lambda_functions,
        aws::get_cloudwatch_metrics,
        aws::execute_ec2_action,
        aws::create_s3_bucket,
        aws::invoke_lambda_function,
        aws::list_iam_users,
        aws::list_iam_roles,
        aws::get_caller_identity,
        aws::get_ssm_parameter,
        aws::get_secret_value,
        aws::list_secrets,
        aws::list_ecs_clusters,
        aws::list_ecs_services,
        aws::list_hosted_zones,
        aws::list_sns_topics,
        aws::list_sqs_queues,
        aws::list_cloudformation_stacks,
        vercel::connect_vercel,
        vercel::disconnect_vercel,
        vercel::list_vercel_sessions,
        vercel::get_vercel_session,
        vercel::list_vercel_projects,
        vercel::list_vercel_deployments,
        vercel::list_vercel_domains,
        vercel::list_vercel_teams,
        vercel::create_vercel_deployment,
        vercel::redeploy_vercel_project,
        vercel::add_vercel_domain,
        vercel::set_vercel_env_var,
        cloudflare::connect_cloudflare,
        cloudflare::disconnect_cloudflare,
        cloudflare::list_cloudflare_sessions,
        cloudflare::get_cloudflare_session,
        cloudflare::list_cloudflare_zones,
        cloudflare::list_cloudflare_dns_records,
        cloudflare::create_cloudflare_dns_record,
        cloudflare::update_cloudflare_dns_record,
        cloudflare::delete_cloudflare_dns_record,
        cloudflare::list_cloudflare_workers,
        cloudflare::deploy_cloudflare_worker,
        cloudflare::list_cloudflare_page_rules,
        cloudflare::get_cloudflare_analytics,
        cloudflare::purge_cloudflare_cache,
        openvpn::create_openvpn_connection_from_ovpn,
        openvpn::update_openvpn_connection_auth,
        openvpn::set_openvpn_connection_key_files,
        openvpn::validate_ovpn_config,
        ssh::update_ssh_session_auth,
        ssh::validate_ssh_key_file,
        ssh::test_ssh_connection,
        ssh::generate_ssh_key,
        // FIDO2 / Security Key commands
        ssh::check_fido2_support,
        ssh::list_fido2_devices,
        ssh::generate_sk_ssh_key,
        ssh::list_fido2_resident_credentials,
        ssh::detect_sk_key_type,
        ssh::validate_ssh_key_file_extended,
        ssh::get_terminal_buffer,
        ssh::clear_terminal_buffer,
        ssh::is_session_alive,
        ssh::get_shell_info,
        ssh::reattach_session,
        // SSH compression commands
        ssh::get_ssh_compression_info,
        ssh::update_ssh_compression_config,
        ssh::reset_ssh_compression_stats,
        ssh::list_ssh_compression_algorithms,
        ssh::should_compress_sftp,
        // SSH session recording commands
        ssh::start_session_recording,
        ssh::stop_session_recording,
        ssh::is_session_recording,
        ssh::get_recording_status,
        ssh::export_recording_asciicast,
        ssh::export_recording_script,
        ssh::list_active_recordings,
        // SSH terminal automation commands
        ssh::start_automation,
        ssh::stop_automation,
        ssh::is_automation_active,
        ssh::get_automation_status,
        ssh::list_active_automations,
        ssh::expect_and_send,
        ssh::execute_command_sequence,
        // SSH terminal regex highlighting commands
        ssh::set_highlight_rules,
        ssh::get_highlight_rules,
        ssh::add_highlight_rule,
        ssh::remove_highlight_rule,
        ssh::update_highlight_rule,
        ssh::clear_highlight_rules,
        ssh::get_highlight_status,
        ssh::list_highlighted_sessions,
        ssh::test_highlight_rules,
        // FTP over SSH tunnel commands
        ssh::setup_ftp_tunnel,
        ssh::stop_ftp_tunnel,
        ssh::get_ftp_tunnel_status,
        ssh::list_ftp_tunnels,
        ssh::list_session_ftp_tunnels,
        // RDP over SSH tunnel commands
        ssh::setup_rdp_tunnel,
        ssh::stop_rdp_tunnel,
        ssh::get_rdp_tunnel_status,
        ssh::list_rdp_tunnels,
        ssh::list_session_rdp_tunnels,
        ssh::setup_bulk_rdp_tunnels,
        ssh::stop_session_rdp_tunnels,
        ssh::generate_rdp_file,
        // VNC over SSH tunnel commands
        ssh::setup_vnc_tunnel,
        ssh::stop_vnc_tunnel,
        ssh::get_vnc_tunnel_status,
        ssh::list_vnc_tunnels,
        ssh::list_session_vnc_tunnels,
        // SSH3 (SSH over HTTP/3 QUIC) commands
        ssh3::connect_ssh3,
        ssh3::disconnect_ssh3,
        ssh3::start_ssh3_shell,
        ssh3::send_ssh3_input,
        ssh3::resize_ssh3_shell,
        ssh3::execute_ssh3_command,
        ssh3::setup_ssh3_port_forward,
        ssh3::stop_ssh3_port_forward,
        ssh3::close_ssh3_channel,
        ssh3::get_ssh3_session_info,
        ssh3::list_ssh3_sessions,
        ssh3::test_ssh3_connection,
        // NOTE: pause_shell and resume_shell removed - buffer always captures full session
        ssh::get_ssh_host_key_info,
        ssh::diagnose_ssh_connection,
        // X11 forwarding
        ssh::enable_x11_forwarding,
        ssh::disable_x11_forwarding,
        ssh::get_x11_forward_status,
        ssh::list_x11_forwards,
        // ProxyCommand
        ssh::get_proxy_command_info,
        ssh::stop_proxy_command_cmd,
        ssh::test_proxy_command,
        ssh::expand_proxy_command,
        http::http_fetch,
        http::http_get,
        http::http_post,
        http::diagnose_http_connection,
        http::start_basic_auth_proxy,
        http::stop_basic_auth_proxy,
        http::list_proxy_sessions,
        http::get_proxy_session_details,
        http::get_proxy_request_log,
        http::clear_proxy_request_log,
        http::stop_all_proxy_sessions,
        http::check_proxy_health,
        http::restart_proxy_session,
        http::get_tls_certificate_info,
        // Web session recording commands
        http::start_web_recording,
        http::stop_web_recording,
        http::is_web_recording,
        http::get_web_recording_status,
        http::export_web_recording_har,
        passkey::passkey_is_available,
        passkey::passkey_authenticate,
        passkey::passkey_register,
        passkey::passkey_list_credentials,
        passkey::passkey_remove_credential,
        // Biometrics (native OS)
        biometrics::commands::biometric_check_availability,
        biometrics::commands::biometric_is_available,
        biometrics::commands::biometric_verify,
        biometrics::commands::biometric_verify_and_derive_key,
        // Vault (native OS keychain)
        vault::commands::vault_status,
        vault::commands::vault_is_available,
        vault::commands::vault_backend_name,
        vault::commands::vault_store_secret,
        vault::commands::vault_read_secret,
        vault::commands::vault_delete_secret,
        vault::commands::vault_ensure_dek,
        vault::commands::vault_envelope_encrypt,
        vault::commands::vault_envelope_decrypt,
        vault::commands::vault_biometric_store,
        vault::commands::vault_biometric_read,
        vault::commands::vault_needs_migration,
        vault::commands::vault_migrate,
        vault::commands::vault_load_storage,
        vault::commands::vault_save_storage,
        // Certificate generation commands
        cert_gen::cert_gen_self_signed,
        cert_gen::cert_gen_ca,
        cert_gen::cert_gen_csr,
        cert_gen::cert_sign_csr,
        cert_gen::cert_gen_issue,
        cert_gen::cert_gen_export_pem,
        cert_gen::cert_gen_export_der,
        cert_gen::cert_gen_export_chain,
        cert_gen::cert_gen_list,
        cert_gen::cert_gen_get,
        cert_gen::cert_gen_delete,
        cert_gen::cert_gen_list_csrs,
        cert_gen::cert_gen_delete_csr,
        cert_gen::cert_gen_update_label,
        cert_gen::cert_gen_get_chain,
        // Legacy crypto policy commands
        legacy_crypto::get_legacy_crypto_policy,
        legacy_crypto::set_legacy_crypto_policy,
        legacy_crypto::get_legacy_crypto_warnings,
        legacy_crypto::get_legacy_ssh_ciphers,
        legacy_crypto::get_legacy_ssh_kex,
        legacy_crypto::get_legacy_ssh_macs,
        legacy_crypto::get_legacy_ssh_host_key_algorithms,
        legacy_crypto::is_legacy_algorithm_allowed,
        // Certificate authentication commands
        cert_auth::parse_certificate,
        cert_auth::validate_certificate,
        cert_auth::authenticate_with_cert,
        cert_auth::register_certificate,
        cert_auth::list_certificates,
        cert_auth::revoke_certificate,
        // two_factor::enable_totp,
        // two_factor::verify_2fa,
        // two_factor::confirm_2fa_setup,
        // two_factor::regenerate_backup_codes,
        // two_factor::disable_2fa,
        // bearer_auth::authenticate_user,
        // bearer_auth::validate_token,
        // bearer_auth::refresh_token,
        // bearer_auth::initiate_oauth_flow,
        // bearer_auth::complete_oauth_flow,
        // bearer_auth::list_providers,
        // auto_lock::record_activity,
        // auto_lock::lock_application,
        // auto_lock::get_time_until_lock,
        // auto_lock::should_lock,
        // auto_lock::set_lock_timeout,
        // auto_lock::get_lock_timeout,
        // gpo::get_policy,
        // gpo::set_policy,
        // gpo::list_policies,
        // gpo::reset_policy,
        // gpo::export_policies,
        // gpo::import_policies,
        // login_detection::analyze_page,
        // login_detection::submit_login_form,
        telnet::connect_telnet,
        telnet::disconnect_telnet,
        telnet::send_telnet_command,
        telnet::send_telnet_raw,
        telnet::send_telnet_break,
        telnet::send_telnet_ayt,
        telnet::resize_telnet,
        telnet::get_telnet_session_info,
        telnet::list_telnet_sessions,
        telnet::disconnect_all_telnet,
        telnet::is_telnet_connected,
        // ── Serial (COM / RS-232) ────────────────────────────────
        serial::serial_scan_ports,
        serial::serial_connect,
        serial::serial_disconnect,
        serial::serial_disconnect_all,
        serial::serial_send_raw,
        serial::serial_send_line,
        serial::serial_send_char,
        serial::serial_send_hex,
        serial::serial_send_break,
        serial::serial_set_dtr,
        serial::serial_set_rts,
        serial::serial_read_control_lines,
        serial::serial_reconfigure,
        serial::serial_set_line_ending,
        serial::serial_set_local_echo,
        serial::serial_flush,
        serial::serial_get_session_info,
        serial::serial_list_sessions,
        serial::serial_get_stats,
        serial::serial_send_at_command,
        serial::serial_get_modem_info,
        serial::serial_get_signal_quality,
        serial::serial_modem_init,
        serial::serial_modem_dial,
        serial::serial_modem_hangup,
        serial::serial_get_modem_profiles,
        serial::serial_start_logging,
        serial::serial_stop_logging,
        serial::serial_get_baud_rates,
        serial::serial_hex_to_bytes,
        serial::serial_bytes_to_hex,
        // rlogin::connect_rlogin,
        // rlogin::disconnect_rlogin,
        // rlogin::send_rlogin_command,
        // rlogin::get_rlogin_session_info,
        // rlogin::list_rlogin_sessions,
        // raw_socket::connect_raw_socket,
        // raw_socket::disconnect_raw_socket,
        // raw_socket::send_raw_socket_data,
        // raw_socket::get_raw_socket_session_info,
        // raw_socket::list_raw_socket_sessions,
        gcp::connect_gcp,
        gcp::disconnect_gcp,
        gcp::list_gcp_sessions,
        gcp::get_gcp_session,
        // Compute Engine
        gcp::list_gcp_instances,
        gcp::get_gcp_instance,
        gcp::start_gcp_instance,
        gcp::stop_gcp_instance,
        gcp::reset_gcp_instance,
        gcp::delete_gcp_instance,
        gcp::list_gcp_disks,
        gcp::list_gcp_snapshots,
        gcp::list_gcp_firewalls,
        gcp::list_gcp_networks,
        gcp::list_gcp_machine_types,
        // Cloud Storage
        gcp::list_gcp_buckets,
        gcp::get_gcp_bucket,
        gcp::create_gcp_bucket,
        gcp::delete_gcp_bucket,
        gcp::list_gcp_objects,
        gcp::download_gcp_object,
        gcp::delete_gcp_object,
        // IAM
        gcp::list_gcp_service_accounts,
        gcp::get_gcp_iam_policy,
        gcp::list_gcp_roles,
        // Secret Manager
        gcp::list_gcp_secrets,
        gcp::get_gcp_secret,
        gcp::access_gcp_secret_version,
        gcp::create_gcp_secret,
        gcp::delete_gcp_secret,
        // Cloud SQL
        gcp::list_gcp_sql_instances,
        gcp::get_gcp_sql_instance,
        gcp::list_gcp_sql_databases,
        gcp::list_gcp_sql_users,
        // Cloud Functions
        gcp::list_gcp_functions,
        gcp::get_gcp_function,
        gcp::call_gcp_function,
        // GKE
        gcp::list_gcp_clusters,
        gcp::get_gcp_cluster,
        gcp::list_gcp_node_pools,
        // Cloud DNS
        gcp::list_gcp_managed_zones,
        gcp::list_gcp_dns_record_sets,
        // Pub/Sub
        gcp::list_gcp_topics,
        gcp::create_gcp_topic,
        gcp::delete_gcp_topic,
        gcp::publish_gcp_message,
        gcp::list_gcp_subscriptions,
        gcp::pull_gcp_messages,
        // Cloud Run
        gcp::list_gcp_run_services,
        gcp::list_gcp_run_jobs,
        // Cloud Logging
        gcp::list_gcp_log_entries,
        gcp::list_gcp_logs,
        gcp::list_gcp_log_sinks,
        // Cloud Monitoring
        gcp::list_gcp_metric_descriptors,
        gcp::list_gcp_time_series,
        gcp::list_gcp_alert_policies,
        // Azure (sorng-azure)
        azure::commands::azure_set_credentials,
        azure::commands::azure_authenticate,
        azure::commands::azure_disconnect,
        azure::commands::azure_is_authenticated,
        azure::commands::azure_connection_summary,
        azure::commands::azure_list_vms,
        azure::commands::azure_list_vms_in_rg,
        azure::commands::azure_get_vm,
        azure::commands::azure_get_vm_instance_view,
        azure::commands::azure_start_vm,
        azure::commands::azure_stop_vm,
        azure::commands::azure_restart_vm,
        azure::commands::azure_deallocate_vm,
        azure::commands::azure_delete_vm,
        azure::commands::azure_resize_vm,
        azure::commands::azure_list_vm_sizes,
        azure::commands::azure_list_vm_summaries,
        azure::commands::azure_list_resource_groups,
        azure::commands::azure_get_resource_group,
        azure::commands::azure_create_resource_group,
        azure::commands::azure_delete_resource_group,
        azure::commands::azure_list_resources_in_rg,
        azure::commands::azure_list_all_resources,
        azure::commands::azure_list_storage_accounts,
        azure::commands::azure_list_storage_accounts_in_rg,
        azure::commands::azure_get_storage_account,
        azure::commands::azure_create_storage_account,
        azure::commands::azure_delete_storage_account,
        azure::commands::azure_list_storage_keys,
        azure::commands::azure_list_containers,
        azure::commands::azure_list_vnets,
        azure::commands::azure_list_vnets_in_rg,
        azure::commands::azure_get_vnet,
        azure::commands::azure_list_nsgs,
        azure::commands::azure_list_nsgs_in_rg,
        azure::commands::azure_list_public_ips,
        azure::commands::azure_list_nics,
        azure::commands::azure_list_load_balancers,
        azure::commands::azure_list_web_apps,
        azure::commands::azure_list_web_apps_in_rg,
        azure::commands::azure_get_web_app,
        azure::commands::azure_start_web_app,
        azure::commands::azure_stop_web_app,
        azure::commands::azure_restart_web_app,
        azure::commands::azure_delete_web_app,
        azure::commands::azure_list_slots,
        azure::commands::azure_swap_slot,
        azure::commands::azure_list_sql_servers,
        azure::commands::azure_list_sql_servers_in_rg,
        azure::commands::azure_get_sql_server,
        azure::commands::azure_list_databases,
        azure::commands::azure_get_database,
        azure::commands::azure_create_database,
        azure::commands::azure_delete_database,
        azure::commands::azure_list_firewall_rules,
        azure::commands::azure_create_firewall_rule,
        azure::commands::azure_delete_firewall_rule,
        azure::commands::azure_list_vaults,
        azure::commands::azure_list_vaults_in_rg,
        azure::commands::azure_get_vault,
        azure::commands::azure_list_secrets,
        azure::commands::azure_get_secret,
        azure::commands::azure_set_secret,
        azure::commands::azure_delete_secret,
        azure::commands::azure_list_keys,
        azure::commands::azure_list_certificates,
        azure::commands::azure_list_container_groups,
        azure::commands::azure_list_container_groups_in_rg,
        azure::commands::azure_get_container_group,
        azure::commands::azure_create_container_group,
        azure::commands::azure_delete_container_group,
        azure::commands::azure_restart_container_group,
        azure::commands::azure_stop_container_group,
        azure::commands::azure_start_container_group,
        azure::commands::azure_get_container_logs,
        azure::commands::azure_list_metric_definitions,
        azure::commands::azure_query_metrics,
        azure::commands::azure_list_activity_log,
        azure::commands::azure_list_usage_details,
        azure::commands::azure_list_budgets,
        azure::commands::azure_get_budget,
        azure::commands::azure_search_resources,
        // Exchange commands (sorng-exchange)
        exchange::commands::exchange_set_config,
        exchange::commands::exchange_connect,
        exchange::commands::exchange_disconnect,
        exchange::commands::exchange_is_connected,
        exchange::commands::exchange_connection_summary,
        exchange::commands::exchange_list_mailboxes,
        exchange::commands::exchange_get_mailbox,
        exchange::commands::exchange_create_mailbox,
        exchange::commands::exchange_remove_mailbox,
        exchange::commands::exchange_enable_mailbox,
        exchange::commands::exchange_disable_mailbox,
        exchange::commands::exchange_update_mailbox,
        exchange::commands::exchange_get_mailbox_statistics,
        exchange::commands::exchange_get_mailbox_permissions,
        exchange::commands::exchange_add_mailbox_permission,
        exchange::commands::exchange_remove_mailbox_permission,
        exchange::commands::exchange_get_forwarding,
        exchange::commands::exchange_get_ooo,
        exchange::commands::exchange_set_ooo,
        exchange::commands::exchange_list_groups,
        exchange::commands::exchange_get_group,
        exchange::commands::exchange_create_group,
        exchange::commands::exchange_update_group,
        exchange::commands::exchange_remove_group,
        exchange::commands::exchange_list_group_members,
        exchange::commands::exchange_add_group_member,
        exchange::commands::exchange_remove_group_member,
        exchange::commands::exchange_list_dynamic_groups,
        exchange::commands::exchange_list_transport_rules,
        exchange::commands::exchange_get_transport_rule,
        exchange::commands::exchange_create_transport_rule,
        exchange::commands::exchange_update_transport_rule,
        exchange::commands::exchange_remove_transport_rule,
        exchange::commands::exchange_enable_transport_rule,
        exchange::commands::exchange_disable_transport_rule,
        exchange::commands::exchange_list_send_connectors,
        exchange::commands::exchange_get_send_connector,
        exchange::commands::exchange_list_receive_connectors,
        exchange::commands::exchange_get_receive_connector,
        exchange::commands::exchange_list_inbound_connectors,
        exchange::commands::exchange_list_outbound_connectors,
        exchange::commands::exchange_message_trace,
        exchange::commands::exchange_message_tracking_log,
        exchange::commands::exchange_list_queues,
        exchange::commands::exchange_get_queue,
        exchange::commands::exchange_retry_queue,
        exchange::commands::exchange_suspend_queue,
        exchange::commands::exchange_resume_queue,
        exchange::commands::exchange_queue_summary,
        exchange::commands::exchange_list_calendar_permissions,
        exchange::commands::exchange_set_calendar_permission,
        exchange::commands::exchange_remove_calendar_permission,
        exchange::commands::exchange_get_booking_config,
        exchange::commands::exchange_set_booking_config,
        exchange::commands::exchange_list_public_folders,
        exchange::commands::exchange_get_public_folder,
        exchange::commands::exchange_create_public_folder,
        exchange::commands::exchange_remove_public_folder,
        exchange::commands::exchange_mail_enable_public_folder,
        exchange::commands::exchange_mail_disable_public_folder,
        exchange::commands::exchange_get_public_folder_statistics,
        exchange::commands::exchange_list_address_policies,
        exchange::commands::exchange_get_address_policy,
        exchange::commands::exchange_apply_address_policy,
        exchange::commands::exchange_list_accepted_domains,
        exchange::commands::exchange_list_address_lists,
        exchange::commands::exchange_list_migration_batches,
        exchange::commands::exchange_get_migration_batch,
        exchange::commands::exchange_start_migration_batch,
        exchange::commands::exchange_stop_migration_batch,
        exchange::commands::exchange_complete_migration_batch,
        exchange::commands::exchange_remove_migration_batch,
        exchange::commands::exchange_list_migration_users,
        exchange::commands::exchange_list_move_requests,
        exchange::commands::exchange_get_move_request_statistics,
        exchange::commands::exchange_new_move_request,
        exchange::commands::exchange_remove_move_request,
        exchange::commands::exchange_list_retention_policies,
        exchange::commands::exchange_get_retention_policy,
        exchange::commands::exchange_list_retention_tags,
        exchange::commands::exchange_get_retention_tag,
        exchange::commands::exchange_get_mailbox_hold,
        exchange::commands::exchange_enable_litigation_hold,
        exchange::commands::exchange_disable_litigation_hold,
        exchange::commands::exchange_list_dlp_policies,
        exchange::commands::exchange_get_dlp_policy,
        exchange::commands::exchange_list_servers,
        exchange::commands::exchange_get_server,
        exchange::commands::exchange_list_databases,
        exchange::commands::exchange_get_database,
        exchange::commands::exchange_mount_database,
        exchange::commands::exchange_dismount_database,
        exchange::commands::exchange_list_dags,
        exchange::commands::exchange_get_dag,
        exchange::commands::exchange_get_dag_copy_status,
        exchange::commands::exchange_test_replication_health,
        exchange::commands::exchange_service_health,
        exchange::commands::exchange_service_issues,
        exchange::commands::exchange_test_mailflow,
        exchange::commands::exchange_test_service_health,
        exchange::commands::exchange_get_server_component_state,
        // Exchange – Mail Contacts & Mail Users
        exchange::commands::exchange_list_mail_contacts,
        exchange::commands::exchange_get_mail_contact,
        exchange::commands::exchange_create_mail_contact,
        exchange::commands::exchange_update_mail_contact,
        exchange::commands::exchange_remove_mail_contact,
        exchange::commands::exchange_list_mail_users,
        exchange::commands::exchange_get_mail_user,
        exchange::commands::exchange_create_mail_user,
        exchange::commands::exchange_remove_mail_user,
        // Exchange – Shared / Resource Mailboxes
        exchange::commands::exchange_convert_mailbox,
        exchange::commands::exchange_list_shared_mailboxes,
        exchange::commands::exchange_list_room_mailboxes,
        exchange::commands::exchange_list_equipment_mailboxes,
        exchange::commands::exchange_add_automapping,
        exchange::commands::exchange_remove_automapping,
        exchange::commands::exchange_add_send_as,
        exchange::commands::exchange_remove_send_as,
        exchange::commands::exchange_add_send_on_behalf,
        exchange::commands::exchange_remove_send_on_behalf,
        exchange::commands::exchange_list_room_lists,
        // Exchange – Archive Mailboxes
        exchange::commands::exchange_get_archive_info,
        exchange::commands::exchange_enable_archive,
        exchange::commands::exchange_disable_archive,
        exchange::commands::exchange_enable_auto_expanding_archive,
        exchange::commands::exchange_set_archive_quota,
        exchange::commands::exchange_get_archive_statistics,
        // Exchange – Mobile Devices
        exchange::commands::exchange_list_mobile_devices,
        exchange::commands::exchange_get_mobile_device_statistics,
        exchange::commands::exchange_wipe_mobile_device,
        exchange::commands::exchange_block_mobile_device,
        exchange::commands::exchange_allow_mobile_device,
        exchange::commands::exchange_remove_mobile_device,
        exchange::commands::exchange_list_all_mobile_devices,
        // Exchange – Inbox Rules
        exchange::commands::exchange_list_inbox_rules,
        exchange::commands::exchange_get_inbox_rule,
        exchange::commands::exchange_create_inbox_rule,
        exchange::commands::exchange_update_inbox_rule,
        exchange::commands::exchange_remove_inbox_rule,
        exchange::commands::exchange_enable_inbox_rule,
        exchange::commands::exchange_disable_inbox_rule,
        // Exchange – Policies
        exchange::commands::exchange_list_owa_policies,
        exchange::commands::exchange_get_owa_policy,
        exchange::commands::exchange_set_owa_policy,
        exchange::commands::exchange_list_mobile_device_policies,
        exchange::commands::exchange_get_mobile_device_policy,
        exchange::commands::exchange_set_mobile_device_policy,
        exchange::commands::exchange_list_throttling_policies,
        exchange::commands::exchange_get_throttling_policy,
        // Exchange – Journal Rules
        exchange::commands::exchange_list_journal_rules,
        exchange::commands::exchange_get_journal_rule,
        exchange::commands::exchange_create_journal_rule,
        exchange::commands::exchange_remove_journal_rule,
        exchange::commands::exchange_enable_journal_rule,
        exchange::commands::exchange_disable_journal_rule,
        // Exchange – RBAC & Audit
        exchange::commands::exchange_list_role_groups,
        exchange::commands::exchange_get_role_group,
        exchange::commands::exchange_add_role_group_member,
        exchange::commands::exchange_remove_role_group_member,
        exchange::commands::exchange_list_management_roles,
        exchange::commands::exchange_get_management_role,
        exchange::commands::exchange_list_role_assignments,
        exchange::commands::exchange_search_admin_audit_log,
        exchange::commands::exchange_get_admin_audit_log_config,
        exchange::commands::exchange_search_mailbox_audit_log,
        exchange::commands::exchange_enable_mailbox_audit,
        exchange::commands::exchange_disable_mailbox_audit,
        // Exchange – Remote Domains
        exchange::commands::exchange_list_remote_domains,
        exchange::commands::exchange_get_remote_domain,
        exchange::commands::exchange_create_remote_domain,
        exchange::commands::exchange_update_remote_domain,
        exchange::commands::exchange_remove_remote_domain,
        // Exchange – Certificates
        exchange::commands::exchange_list_certificates,
        exchange::commands::exchange_get_certificate,
        exchange::commands::exchange_enable_certificate,
        exchange::commands::exchange_import_certificate,
        exchange::commands::exchange_remove_certificate,
        exchange::commands::exchange_new_certificate_request,
        // Exchange – Virtual Directories & Org Config
        exchange::commands::exchange_list_owa_virtual_directories,
        exchange::commands::exchange_list_ecp_virtual_directories,
        exchange::commands::exchange_list_activesync_virtual_directories,
        exchange::commands::exchange_list_ews_virtual_directories,
        exchange::commands::exchange_list_mapi_virtual_directories,
        exchange::commands::exchange_list_autodiscover_virtual_directories,
        exchange::commands::exchange_list_powershell_virtual_directories,
        exchange::commands::exchange_list_oab_virtual_directories,
        exchange::commands::exchange_set_virtual_directory_urls,
        exchange::commands::exchange_list_outlook_anywhere,
        exchange::commands::exchange_get_organization_config,
        exchange::commands::exchange_set_organization_config,
        exchange::commands::exchange_get_transport_config,
        exchange::commands::exchange_set_transport_config,
        // Exchange – Anti-Spam & Hygiene
        exchange::commands::exchange_get_content_filter_config,
        exchange::commands::exchange_set_content_filter_config,
        exchange::commands::exchange_get_connection_filter_config,
        exchange::commands::exchange_set_connection_filter_config,
        exchange::commands::exchange_get_sender_filter_config,
        exchange::commands::exchange_set_sender_filter_config,
        exchange::commands::exchange_list_quarantine_messages,
        exchange::commands::exchange_get_quarantine_message,
        exchange::commands::exchange_release_quarantine_message,
        exchange::commands::exchange_delete_quarantine_message,
        // Exchange – Mailbox Import/Export (PST)
        exchange::commands::exchange_new_mailbox_import_request,
        exchange::commands::exchange_new_mailbox_export_request,
        exchange::commands::exchange_list_mailbox_import_requests,
        exchange::commands::exchange_list_mailbox_export_requests,
        exchange::commands::exchange_remove_mailbox_import_request,
        exchange::commands::exchange_remove_mailbox_export_request,
        // SMTP commands
        smtp::commands::smtp_add_profile,
        smtp::commands::smtp_update_profile,
        smtp::commands::smtp_delete_profile,
        smtp::commands::smtp_get_profile,
        smtp::commands::smtp_find_profile_by_name,
        smtp::commands::smtp_list_profiles,
        smtp::commands::smtp_set_default_profile,
        smtp::commands::smtp_get_default_profile,
        smtp::commands::smtp_add_template,
        smtp::commands::smtp_update_template,
        smtp::commands::smtp_delete_template,
        smtp::commands::smtp_get_template,
        smtp::commands::smtp_find_template_by_name,
        smtp::commands::smtp_list_templates,
        smtp::commands::smtp_render_template,
        smtp::commands::smtp_extract_template_variables,
        smtp::commands::smtp_validate_template,
        smtp::commands::smtp_add_contact,
        smtp::commands::smtp_update_contact,
        smtp::commands::smtp_delete_contact,
        smtp::commands::smtp_get_contact,
        smtp::commands::smtp_find_contact_by_email,
        smtp::commands::smtp_search_contacts,
        smtp::commands::smtp_list_contacts,
        smtp::commands::smtp_list_contacts_in_group,
        smtp::commands::smtp_list_contacts_by_tag,
        smtp::commands::smtp_add_contact_to_group,
        smtp::commands::smtp_remove_contact_from_group,
        smtp::commands::smtp_add_contact_tag,
        smtp::commands::smtp_remove_contact_tag,
        smtp::commands::smtp_all_contact_tags,
        smtp::commands::smtp_create_contact_group,
        smtp::commands::smtp_delete_contact_group,
        smtp::commands::smtp_rename_contact_group,
        smtp::commands::smtp_list_contact_groups,
        smtp::commands::smtp_get_contact_group,
        smtp::commands::smtp_export_contacts_csv,
        smtp::commands::smtp_import_contacts_csv,
        smtp::commands::smtp_export_contacts_json,
        smtp::commands::smtp_import_contacts_json,
        smtp::commands::smtp_send_email,
        smtp::commands::smtp_enqueue,
        smtp::commands::smtp_enqueue_scheduled,
        smtp::commands::smtp_process_queue,
        smtp::commands::smtp_bulk_enqueue,
        smtp::commands::smtp_queue_summary,
        smtp::commands::smtp_queue_list,
        smtp::commands::smtp_queue_get,
        smtp::commands::smtp_queue_cancel,
        smtp::commands::smtp_queue_retry_failed,
        smtp::commands::smtp_queue_purge_completed,
        smtp::commands::smtp_queue_clear,
        smtp::commands::smtp_set_queue_config,
        smtp::commands::smtp_get_queue_config,
        smtp::commands::smtp_run_diagnostics,
        smtp::commands::smtp_quick_deliverability_check,
        smtp::commands::smtp_lookup_mx,
        smtp::commands::smtp_check_port,
        smtp::commands::smtp_suggest_security,
        smtp::commands::smtp_get_dns_txt,
        smtp::commands::smtp_validate_dkim_config,
        smtp::commands::smtp_generate_dkim_dns_record,
        smtp::commands::smtp_connection_summary,
        smtp::commands::smtp_stats,
        smtp::commands::smtp_build_message,
        smtp::commands::smtp_validate_email_address,
        smtp::commands::smtp_parse_email_address,
        smtp::commands::smtp_reverse_dns,
        // ibm::connect_ibm,
        // ibm::disconnect_ibm,
        // ibm::list_ibm_virtual_servers,
        // ibm::get_ibm_session,
        // ibm::list_ibm_sessions,
        digital_ocean::connect_digital_ocean,
        digital_ocean::disconnect_digital_ocean,
        digital_ocean::list_digital_ocean_droplets,
        digital_ocean::get_digital_ocean_session,
        digital_ocean::list_digital_ocean_sessions,
        // heroku::connect_heroku,
        // heroku::disconnect_heroku,
        // heroku::list_heroku_dynos,
        // heroku::get_heroku_session,
        // heroku::list_heroku_sessions,
        // scaleway::connect_scaleway,
        // scaleway::disconnect_scaleway,
        // scaleway::list_scaleway_instances,
        // scaleway::get_scaleway_session,
        // scaleway::list_scaleway_sessions,
        // linode::connect_linode,
        // linode::disconnect_linode,
        // linode::list_linode_instances,
        // linode::get_linode_session,
        // linode::list_linode_sessions,
        // ovh::connect_ovh,
        // ovh::disconnect_ovh,
        // ovh::list_ovh_instances,
        // ovh::get_ovh_session,
        // ovh::list_ovh_sessions
        create_desktop_shortcut,
        scan_shortcuts,
        set_autostart,
        get_desktop_path,
        get_documents_path,
        get_appdata_path,
        check_file_exists,
        delete_file,
        open_folder,
        flash_window,
        // Backup commands
        backup::backup_update_config,
        backup::backup_get_config,
        backup::backup_get_status,
        backup::backup_run_now,
        backup::backup_list,
        backup::backup_restore,
        backup::backup_delete,
        // SFTP commands
        sftp::sftp_connect,
        sftp::sftp_disconnect,
        sftp::sftp_get_session_info,
        sftp::sftp_list_sessions,
        sftp::sftp_ping,
        sftp::sftp_set_directory,
        sftp::sftp_realpath,
        sftp::sftp_list_directory,
        sftp::sftp_mkdir,
        sftp::sftp_mkdir_p,
        sftp::sftp_rmdir,
        sftp::sftp_disk_usage,
        sftp::sftp_search,
        sftp::sftp_stat,
        sftp::sftp_lstat,
        sftp::sftp_rename,
        sftp::sftp_delete_file,
        sftp::sftp_delete_recursive,
        sftp::sftp_chmod,
        sftp::sftp_chown,
        sftp::sftp_create_symlink,
        sftp::sftp_read_link,
        sftp::sftp_touch,
        sftp::sftp_truncate,
        sftp::sftp_read_text_file,
        sftp::sftp_write_text_file,
        sftp::sftp_checksum,
        sftp::sftp_exists,
        sftp::sftp_upload,
        sftp::sftp_download,
        sftp::sftp_batch_transfer,
        sftp::sftp_get_transfer_progress,
        sftp::sftp_list_active_transfers,
        sftp::sftp_cancel_transfer,
        sftp::sftp_pause_transfer,
        sftp::sftp_clear_completed_transfers,
        sftp::sftp_queue_add,
        sftp::sftp_queue_remove,
        sftp::sftp_queue_list,
        sftp::sftp_queue_status,
        sftp::sftp_queue_start,
        sftp::sftp_queue_stop,
        sftp::sftp_queue_retry_failed,
        sftp::sftp_queue_clear_done,
        sftp::sftp_queue_set_priority,
        sftp::sftp_watch_start,
        sftp::sftp_watch_stop,
        sftp::sftp_watch_list,
        sftp::sftp_sync_pull,
        sftp::sftp_sync_push,
        sftp::sftp_bookmark_add,
        sftp::sftp_bookmark_remove,
        sftp::sftp_bookmark_update,
        sftp::sftp_bookmark_list,
        sftp::sftp_bookmark_touch,
        sftp::sftp_bookmark_import,
        sftp::sftp_bookmark_export,
        sftp::sftp_diagnose,
        // RustDesk commands — Binary / Client
        rustdesk::rustdesk_is_available,
        rustdesk::rustdesk_get_binary_info,
        rustdesk::rustdesk_detect_version,
        rustdesk::rustdesk_get_local_id,
        rustdesk::rustdesk_check_service_running,
        rustdesk::rustdesk_install_service,
        rustdesk::rustdesk_silent_install,
        rustdesk::rustdesk_set_permanent_password,
        // RustDesk commands — Server Configuration
        rustdesk::rustdesk_configure_server,
        rustdesk::rustdesk_get_server_config,
        rustdesk::rustdesk_set_client_config,
        rustdesk::rustdesk_get_client_config,
        // RustDesk commands — Connection Lifecycle
        rustdesk::rustdesk_connect,
        rustdesk::rustdesk_connect_direct_ip,
        rustdesk::rustdesk_disconnect,
        rustdesk::rustdesk_shutdown,
        // RustDesk commands — Sessions
        rustdesk::rustdesk_get_session,
        rustdesk::rustdesk_list_sessions,
        rustdesk::rustdesk_update_session_settings,
        rustdesk::rustdesk_send_input,
        rustdesk::rustdesk_active_session_count,
        // RustDesk commands — TCP Tunnels
        rustdesk::rustdesk_create_tunnel,
        rustdesk::rustdesk_close_tunnel,
        rustdesk::rustdesk_list_tunnels,
        rustdesk::rustdesk_get_tunnel,
        // RustDesk commands — File Transfers
        rustdesk::rustdesk_start_file_transfer,
        rustdesk::rustdesk_upload_file,
        rustdesk::rustdesk_download_file,
        rustdesk::rustdesk_list_file_transfers,
        rustdesk::rustdesk_get_file_transfer,
        rustdesk::rustdesk_active_file_transfers,
        rustdesk::rustdesk_transfer_progress,
        rustdesk::rustdesk_record_file_transfer,
        rustdesk::rustdesk_update_transfer_progress,
        rustdesk::rustdesk_cancel_file_transfer,
        rustdesk::rustdesk_list_remote_files,
        rustdesk::rustdesk_file_transfer_stats,
        // RustDesk commands — CLI Assignment
        rustdesk::rustdesk_assign_via_cli,
        // RustDesk commands — Server Admin: Devices
        rustdesk::rustdesk_api_list_devices,
        rustdesk::rustdesk_api_get_device,
        rustdesk::rustdesk_api_device_action,
        rustdesk::rustdesk_api_assign_device,
        // RustDesk commands — Server Admin: Users
        rustdesk::rustdesk_api_list_users,
        rustdesk::rustdesk_api_create_user,
        rustdesk::rustdesk_api_user_action,
        // RustDesk commands — Server Admin: User Groups
        rustdesk::rustdesk_api_list_user_groups,
        rustdesk::rustdesk_api_create_user_group,
        rustdesk::rustdesk_api_update_user_group,
        rustdesk::rustdesk_api_delete_user_group,
        rustdesk::rustdesk_api_add_users_to_group,
        // RustDesk commands — Server Admin: Device Groups
        rustdesk::rustdesk_api_list_device_groups,
        rustdesk::rustdesk_api_create_device_group,
        rustdesk::rustdesk_api_update_device_group,
        rustdesk::rustdesk_api_delete_device_group,
        rustdesk::rustdesk_api_add_devices_to_group,
        rustdesk::rustdesk_api_remove_devices_from_group,
        // RustDesk commands — Server Admin: Strategies
        rustdesk::rustdesk_api_list_strategies,
        rustdesk::rustdesk_api_get_strategy,
        rustdesk::rustdesk_api_enable_strategy,
        rustdesk::rustdesk_api_disable_strategy,
        rustdesk::rustdesk_api_assign_strategy,
        rustdesk::rustdesk_api_unassign_strategy,
        // RustDesk commands — Address Books
        rustdesk::rustdesk_api_list_address_books,
        rustdesk::rustdesk_api_get_personal_address_book,
        rustdesk::rustdesk_api_create_address_book,
        rustdesk::rustdesk_api_update_address_book,
        rustdesk::rustdesk_api_delete_address_book,
        rustdesk::rustdesk_api_list_ab_peers,
        rustdesk::rustdesk_api_add_ab_peer,
        rustdesk::rustdesk_api_update_ab_peer,
        rustdesk::rustdesk_api_remove_ab_peer,
        rustdesk::rustdesk_api_import_ab_peers,
        rustdesk::rustdesk_api_list_ab_tags,
        rustdesk::rustdesk_api_add_ab_tag,
        rustdesk::rustdesk_api_delete_ab_tag,
        rustdesk::rustdesk_api_list_ab_rules,
        rustdesk::rustdesk_api_add_ab_rule,
        rustdesk::rustdesk_api_delete_ab_rule,
        // RustDesk commands — Audit Logs
        rustdesk::rustdesk_api_connection_audits,
        rustdesk::rustdesk_api_file_audits,
        rustdesk::rustdesk_api_alarm_audits,
        rustdesk::rustdesk_api_console_audits,
        rustdesk::rustdesk_api_peer_audit_summary,
        rustdesk::rustdesk_api_operator_audit_summary,
        // RustDesk commands — Login
        rustdesk::rustdesk_api_login,
        // RustDesk commands — Diagnostics
        rustdesk::rustdesk_diagnostics_report,
        rustdesk::rustdesk_quick_health_check,
        rustdesk::rustdesk_server_health,
        rustdesk::rustdesk_server_latency,
        rustdesk::rustdesk_server_config_summary,
        rustdesk::rustdesk_client_config_summary,
        rustdesk::rustdesk_session_summary,
        // Bitwarden commands
        bitwarden::bw_check_cli,
        bitwarden::bw_status,
        bitwarden::bw_vault_status,
        bitwarden::bw_session_info,
        bitwarden::bw_get_config,
        bitwarden::bw_set_config,
        bitwarden::bw_config_server,
        bitwarden::bw_login,
        bitwarden::bw_login_2fa,
        bitwarden::bw_login_api_key,
        bitwarden::bw_unlock,
        bitwarden::bw_lock,
        bitwarden::bw_logout,
        bitwarden::bw_sync,
        bitwarden::bw_force_sync,
        bitwarden::bw_list_items,
        bitwarden::bw_search_items,
        bitwarden::bw_get_item,
        bitwarden::bw_create_item,
        bitwarden::bw_edit_item,
        bitwarden::bw_delete_item,
        bitwarden::bw_delete_item_permanent,
        bitwarden::bw_restore_item,
        bitwarden::bw_get_username,
        bitwarden::bw_get_password,
        bitwarden::bw_get_totp,
        bitwarden::bw_find_credentials,
        bitwarden::bw_list_folders,
        bitwarden::bw_create_folder,
        bitwarden::bw_edit_folder,
        bitwarden::bw_delete_folder,
        bitwarden::bw_list_collections,
        bitwarden::bw_list_organizations,
        bitwarden::bw_list_sends,
        bitwarden::bw_create_text_send,
        bitwarden::bw_delete_send,
        bitwarden::bw_create_attachment,
        bitwarden::bw_delete_attachment,
        bitwarden::bw_download_attachment,
        bitwarden::bw_generate_password,
        bitwarden::bw_generate_password_local,
        bitwarden::bw_export,
        bitwarden::bw_import,
        bitwarden::bw_vault_stats,
        bitwarden::bw_password_health,
        bitwarden::bw_find_duplicates,
        bitwarden::bw_start_serve,
        bitwarden::bw_stop_serve,
        bitwarden::bw_is_serve_running,
        // KeePass commands
        keepass::keepass_create_database,
        keepass::keepass_open_database,
        keepass::keepass_close_database,
        keepass::keepass_close_all_databases,
        keepass::keepass_save_database,
        keepass::keepass_lock_database,
        keepass::keepass_unlock_database,
        keepass::keepass_list_databases,
        keepass::keepass_backup_database,
        keepass::keepass_list_backups,
        keepass::keepass_change_master_key,
        keepass::keepass_get_database_file_info,
        keepass::keepass_get_database_statistics,
        keepass::keepass_merge_database,
        keepass::keepass_update_database_metadata,
        keepass::keepass_create_entry,
        keepass::keepass_get_entry,
        keepass::keepass_list_entries_in_group,
        keepass::keepass_list_all_entries,
        keepass::keepass_list_entries_recursive,
        keepass::keepass_update_entry,
        keepass::keepass_delete_entry,
        keepass::keepass_restore_entry,
        keepass::keepass_empty_recycle_bin,
        keepass::keepass_move_entry,
        keepass::keepass_copy_entry,
        keepass::keepass_get_entry_history,
        keepass::keepass_get_entry_history_item,
        keepass::keepass_restore_entry_from_history,
        keepass::keepass_delete_entry_history,
        keepass::keepass_diff_entry_with_history,
        keepass::keepass_get_entry_otp,
        keepass::keepass_password_health_report,
        keepass::keepass_create_group,
        keepass::keepass_get_group,
        keepass::keepass_list_groups,
        keepass::keepass_list_child_groups,
        keepass::keepass_get_group_tree,
        keepass::keepass_get_group_path,
        keepass::keepass_update_group,
        keepass::keepass_delete_group,
        keepass::keepass_move_group,
        keepass::keepass_sort_groups,
        keepass::keepass_group_entry_count,
        keepass::keepass_group_tags,
        keepass::keepass_add_custom_icon,
        keepass::keepass_get_custom_icon,
        keepass::keepass_list_custom_icons,
        keepass::keepass_delete_custom_icon,
        keepass::keepass_generate_password,
        keepass::keepass_generate_passwords,
        keepass::keepass_analyze_password,
        keepass::keepass_list_password_profiles,
        keepass::keepass_add_password_profile,
        keepass::keepass_remove_password_profile,
        keepass::keepass_create_key_file,
        keepass::keepass_verify_key_file,
        keepass::keepass_search_entries,
        keepass::keepass_quick_search,
        keepass::keepass_find_entries_for_url,
        keepass::keepass_find_duplicates,
        keepass::keepass_find_expiring_entries,
        keepass::keepass_find_weak_passwords,
        keepass::keepass_find_entries_without_password,
        keepass::keepass_get_all_tags,
        keepass::keepass_find_entries_by_tag,
        keepass::keepass_import_entries,
        keepass::keepass_export_entries,
        keepass::keepass_parse_autotype_sequence,
        keepass::keepass_resolve_autotype_sequence,
        keepass::keepass_find_autotype_matches,
        keepass::keepass_list_autotype_associations,
        keepass::keepass_validate_autotype_sequence,
        keepass::keepass_get_default_autotype_sequence,
        keepass::keepass_add_attachment,
        keepass::keepass_get_entry_attachments,
        keepass::keepass_get_attachment_data,
        keepass::keepass_remove_attachment,
        keepass::keepass_rename_attachment,
        keepass::keepass_save_attachment_to_file,
        keepass::keepass_import_attachment_from_file,
        keepass::keepass_get_attachment_pool_size,
        keepass::keepass_compact_attachment_pool,
        keepass::keepass_verify_attachment_integrity,
        keepass::keepass_list_recent_databases,
        keepass::keepass_add_recent_database,
        keepass::keepass_remove_recent_database,
        keepass::keepass_clear_recent_databases,
        keepass::keepass_get_change_log,
        keepass::keepass_get_settings,
        keepass::keepass_update_settings,
        keepass::keepass_shutdown,
        // Passbolt commands
        passbolt::pb_get_config,
        passbolt::pb_set_config,
        passbolt::pb_login_gpgauth,
        passbolt::pb_login_jwt,
        passbolt::pb_refresh_token,
        passbolt::pb_logout,
        passbolt::pb_check_session,
        passbolt::pb_is_authenticated,
        passbolt::pb_verify_mfa_totp,
        passbolt::pb_verify_mfa_yubikey,
        passbolt::pb_get_mfa_requirements,
        passbolt::pb_list_resources,
        passbolt::pb_get_resource,
        passbolt::pb_create_resource,
        passbolt::pb_update_resource,
        passbolt::pb_delete_resource,
        passbolt::pb_search_resources,
        passbolt::pb_list_favorite_resources,
        passbolt::pb_list_resources_in_folder,
        passbolt::pb_list_resource_types,
        passbolt::pb_get_secret,
        passbolt::pb_get_decrypted_secret,
        passbolt::pb_list_folders,
        passbolt::pb_get_folder,
        passbolt::pb_create_folder,
        passbolt::pb_update_folder,
        passbolt::pb_delete_folder,
        passbolt::pb_move_folder,
        passbolt::pb_move_resource,
        passbolt::pb_get_folder_tree,
        passbolt::pb_list_users,
        passbolt::pb_get_user,
        passbolt::pb_get_me,
        passbolt::pb_create_user,
        passbolt::pb_update_user,
        passbolt::pb_delete_user,
        passbolt::pb_delete_user_dry_run,
        passbolt::pb_search_users,
        passbolt::pb_list_groups,
        passbolt::pb_get_group,
        passbolt::pb_create_group,
        passbolt::pb_update_group,
        passbolt::pb_delete_group,
        passbolt::pb_update_group_dry_run,
        passbolt::pb_list_resource_permissions,
        passbolt::pb_share_resource,
        passbolt::pb_share_folder,
        passbolt::pb_simulate_share_resource,
        passbolt::pb_search_aros,
        passbolt::pb_add_favorite,
        passbolt::pb_remove_favorite,
        passbolt::pb_list_comments,
        passbolt::pb_add_comment,
        passbolt::pb_update_comment,
        passbolt::pb_delete_comment,
        passbolt::pb_list_tags,
        passbolt::pb_update_tag,
        passbolt::pb_delete_tag,
        passbolt::pb_add_tags_to_resource,
        passbolt::pb_list_gpg_keys,
        passbolt::pb_get_gpg_key,
        passbolt::pb_load_recipient_key,
        passbolt::pb_list_roles,
        passbolt::pb_list_metadata_keys,
        passbolt::pb_create_metadata_key,
        passbolt::pb_get_metadata_types_settings,
        passbolt::pb_list_metadata_session_keys,
        passbolt::pb_list_resources_needing_rotation,
        passbolt::pb_rotate_resource_metadata,
        passbolt::pb_list_resources_needing_upgrade,
        passbolt::pb_upgrade_resource_metadata,
        passbolt::pb_healthcheck,
        passbolt::pb_server_status,
        passbolt::pb_is_server_reachable,
        passbolt::pb_server_settings,
        passbolt::pb_directory_sync_dry_run,
        passbolt::pb_directory_sync,
        passbolt::pb_refresh_cache,
        passbolt::pb_invalidate_cache,
        passbolt::pb_get_cached_resources,
        passbolt::pb_get_cached_folders,
        // SCP commands
        scp::scp_connect,
        scp::scp_disconnect,
        scp::scp_disconnect_all,
        scp::scp_get_session_info,
        scp::scp_list_sessions,
        scp::scp_ping,
        scp::scp_remote_exists,
        scp::scp_remote_is_dir,
        scp::scp_remote_file_size,
        scp::scp_remote_mkdir_p,
        scp::scp_remote_rm,
        scp::scp_remote_rm_rf,
        scp::scp_remote_ls,
        scp::scp_remote_stat,
        scp::scp_remote_checksum,
        scp::scp_local_checksum,
        scp::scp_upload,
        scp::scp_download,
        scp::scp_batch_transfer,
        scp::scp_upload_directory,
        scp::scp_download_directory,
        scp::scp_get_transfer_progress,
        scp::scp_list_active_transfers,
        scp::scp_cancel_transfer,
        scp::scp_clear_completed_transfers,
        scp::scp_queue_add,
        scp::scp_queue_remove,
        scp::scp_queue_list,
        scp::scp_queue_status,
        scp::scp_queue_start,
        scp::scp_queue_stop,
        scp::scp_queue_retry_failed,
        scp::scp_queue_clear_done,
        scp::scp_queue_clear_all,
        scp::scp_queue_set_priority,
        scp::scp_queue_pause,
        scp::scp_queue_resume,
        scp::scp_get_history,
        scp::scp_clear_history,
        scp::scp_history_stats,
        scp::scp_diagnose,
        scp::scp_diagnose_connection,
        scp::scp_exec_remote,

        // ── MySQL ───────────────────────────────────────────────────
        mysql::commands::mysql_connect,
        mysql::commands::mysql_disconnect,
        mysql::commands::mysql_disconnect_all,
        mysql::commands::mysql_list_sessions,
        mysql::commands::mysql_get_session,
        mysql::commands::mysql_ping,
        mysql::commands::mysql_execute_query,
        mysql::commands::mysql_execute_statement,
        mysql::commands::mysql_explain_query,
        mysql::commands::mysql_list_databases,
        mysql::commands::mysql_list_tables,
        mysql::commands::mysql_describe_table,
        mysql::commands::mysql_list_indexes,
        mysql::commands::mysql_list_foreign_keys,
        mysql::commands::mysql_list_views,
        mysql::commands::mysql_list_routines,
        mysql::commands::mysql_list_triggers,
        mysql::commands::mysql_create_database,
        mysql::commands::mysql_drop_database,
        mysql::commands::mysql_drop_table,
        mysql::commands::mysql_truncate_table,
        mysql::commands::mysql_get_table_data,
        mysql::commands::mysql_insert_row,
        mysql::commands::mysql_update_rows,
        mysql::commands::mysql_delete_rows,
        mysql::commands::mysql_export_table,
        mysql::commands::mysql_export_database,
        mysql::commands::mysql_import_sql,
        mysql::commands::mysql_import_csv,
        mysql::commands::mysql_show_variables,
        mysql::commands::mysql_show_processlist,
        mysql::commands::mysql_kill_process,
        mysql::commands::mysql_list_users,
        mysql::commands::mysql_show_grants,
        mysql::commands::mysql_server_uptime,

        // ── PostgreSQL ──────────────────────────────────────────────
        postgres::commands::pg_connect,
        postgres::commands::pg_disconnect,
        postgres::commands::pg_disconnect_all,
        postgres::commands::pg_list_sessions,
        postgres::commands::pg_get_session,
        postgres::commands::pg_ping,
        postgres::commands::pg_execute_query,
        postgres::commands::pg_execute_statement,
        postgres::commands::pg_explain_query,
        postgres::commands::pg_list_databases,
        postgres::commands::pg_list_schemas,
        postgres::commands::pg_list_tables,
        postgres::commands::pg_describe_table,
        postgres::commands::pg_list_indexes,
        postgres::commands::pg_list_foreign_keys,
        postgres::commands::pg_list_views,
        postgres::commands::pg_list_routines,
        postgres::commands::pg_list_triggers,
        postgres::commands::pg_list_sequences,
        postgres::commands::pg_list_extensions,
        postgres::commands::pg_create_database,
        postgres::commands::pg_drop_database,
        postgres::commands::pg_create_schema,
        postgres::commands::pg_drop_schema,
        postgres::commands::pg_drop_table,
        postgres::commands::pg_truncate_table,
        postgres::commands::pg_get_table_data,
        postgres::commands::pg_insert_row,
        postgres::commands::pg_update_rows,
        postgres::commands::pg_delete_rows,
        postgres::commands::pg_export_table,
        postgres::commands::pg_export_schema,
        postgres::commands::pg_import_sql,
        postgres::commands::pg_import_csv,
        postgres::commands::pg_show_settings,
        postgres::commands::pg_show_activity,
        postgres::commands::pg_terminate_backend,
        postgres::commands::pg_cancel_backend,
        postgres::commands::pg_vacuum_table,
        postgres::commands::pg_list_roles,
        postgres::commands::pg_list_tablespaces,
        postgres::commands::pg_server_uptime,
        postgres::commands::pg_database_size,

        // ── MSSQL ───────────────────────────────────────────────────
        mssql::commands::mssql_connect,
        mssql::commands::mssql_disconnect,
        mssql::commands::mssql_disconnect_all,
        mssql::commands::mssql_list_sessions,
        mssql::commands::mssql_get_session,
        mssql::commands::mssql_execute_query,
        mssql::commands::mssql_execute_statement,
        mssql::commands::mssql_list_databases,
        mssql::commands::mssql_list_schemas,
        mssql::commands::mssql_list_tables,
        mssql::commands::mssql_describe_table,
        mssql::commands::mssql_list_indexes,
        mssql::commands::mssql_list_foreign_keys,
        mssql::commands::mssql_list_views,
        mssql::commands::mssql_list_stored_procs,
        mssql::commands::mssql_list_triggers,
        mssql::commands::mssql_create_database,
        mssql::commands::mssql_drop_database,
        mssql::commands::mssql_drop_table,
        mssql::commands::mssql_truncate_table,
        mssql::commands::mssql_get_table_data,
        mssql::commands::mssql_insert_row,
        mssql::commands::mssql_update_rows,
        mssql::commands::mssql_delete_rows,
        mssql::commands::mssql_export_table,
        mssql::commands::mssql_import_sql,
        mssql::commands::mssql_import_csv,
        mssql::commands::mssql_server_properties,
        mssql::commands::mssql_show_processes,
        mssql::commands::mssql_kill_process,
        mssql::commands::mssql_list_logins,

        // ── SQLite ──────────────────────────────────────────────────
        sqlite::commands::sqlite_connect,
        sqlite::commands::sqlite_disconnect,
        sqlite::commands::sqlite_disconnect_all,
        sqlite::commands::sqlite_list_sessions,
        sqlite::commands::sqlite_get_session,
        sqlite::commands::sqlite_ping,
        sqlite::commands::sqlite_execute_query,
        sqlite::commands::sqlite_execute_statement,
        sqlite::commands::sqlite_explain_query,
        sqlite::commands::sqlite_list_tables,
        sqlite::commands::sqlite_describe_table,
        sqlite::commands::sqlite_list_indexes,
        sqlite::commands::sqlite_list_foreign_keys,
        sqlite::commands::sqlite_list_triggers,
        sqlite::commands::sqlite_list_attached_databases,
        sqlite::commands::sqlite_get_pragma,
        sqlite::commands::sqlite_set_pragma,
        sqlite::commands::sqlite_drop_table,
        sqlite::commands::sqlite_vacuum,
        sqlite::commands::sqlite_integrity_check,
        sqlite::commands::sqlite_attach_database,
        sqlite::commands::sqlite_detach_database,
        sqlite::commands::sqlite_get_table_data,
        sqlite::commands::sqlite_insert_row,
        sqlite::commands::sqlite_update_rows,
        sqlite::commands::sqlite_delete_rows,
        sqlite::commands::sqlite_export_table,
        sqlite::commands::sqlite_export_database,
        sqlite::commands::sqlite_import_sql,
        sqlite::commands::sqlite_import_csv,
        sqlite::commands::sqlite_database_size,
        sqlite::commands::sqlite_table_count,

        // ── MongoDB ─────────────────────────────────────────────────
        mongodb::commands::mongo_connect,
        mongodb::commands::mongo_disconnect,
        mongodb::commands::mongo_disconnect_all,
        mongodb::commands::mongo_list_sessions,
        mongodb::commands::mongo_get_session,
        mongodb::commands::mongo_ping,
        mongodb::commands::mongo_list_databases,
        mongodb::commands::mongo_drop_database,
        mongodb::commands::mongo_list_collections,
        mongodb::commands::mongo_create_collection,
        mongodb::commands::mongo_drop_collection,
        mongodb::commands::mongo_collection_stats,
        mongodb::commands::mongo_find,
        mongodb::commands::mongo_count_documents,
        mongodb::commands::mongo_insert_one,
        mongodb::commands::mongo_insert_many,
        mongodb::commands::mongo_update_one,
        mongodb::commands::mongo_update_many,
        mongodb::commands::mongo_delete_one,
        mongodb::commands::mongo_delete_many,
        mongodb::commands::mongo_aggregate,
        mongodb::commands::mongo_run_command,
        mongodb::commands::mongo_list_indexes,
        mongodb::commands::mongo_create_index,
        mongodb::commands::mongo_drop_index,
        mongodb::commands::mongo_server_status,
        mongodb::commands::mongo_list_users,
        mongodb::commands::mongo_replica_set_status,
        mongodb::commands::mongo_current_op,
        mongodb::commands::mongo_kill_op,
        mongodb::commands::mongo_export_collection,

        // ── Redis ───────────────────────────────────────────────────
        redis::commands::redis_connect,
        redis::commands::redis_disconnect,
        redis::commands::redis_disconnect_all,
        redis::commands::redis_list_sessions,
        redis::commands::redis_get_session,
        redis::commands::redis_ping,
        redis::commands::redis_get,
        redis::commands::redis_set,
        redis::commands::redis_del,
        redis::commands::redis_exists,
        redis::commands::redis_expire,
        redis::commands::redis_persist,
        redis::commands::redis_ttl,
        redis::commands::redis_key_type,
        redis::commands::redis_rename,
        redis::commands::redis_scan,
        redis::commands::redis_key_info,
        redis::commands::redis_dbsize,
        redis::commands::redis_flushdb,
        redis::commands::redis_hgetall,
        redis::commands::redis_hget,
        redis::commands::redis_hset,
        redis::commands::redis_hdel,
        redis::commands::redis_lrange,
        redis::commands::redis_lpush,
        redis::commands::redis_rpush,
        redis::commands::redis_llen,
        redis::commands::redis_smembers,
        redis::commands::redis_sadd,
        redis::commands::redis_srem,
        redis::commands::redis_scard,
        redis::commands::redis_zrange_with_scores,
        redis::commands::redis_zadd,
        redis::commands::redis_zrem,
        redis::commands::redis_zcard,
        redis::commands::redis_server_info,
        redis::commands::redis_memory_info,
        redis::commands::redis_client_list,
        redis::commands::redis_client_kill,
        redis::commands::redis_slowlog_get,
        redis::commands::redis_config_get,
        redis::commands::redis_config_set,
        redis::commands::redis_raw_command,
        redis::commands::redis_select_db,

        // ── AI Agent ──────────────────────────────────────────────
        ai_agent::commands::ai_get_settings,
        ai_agent::commands::ai_update_settings,
        ai_agent::commands::ai_add_provider,
        ai_agent::commands::ai_remove_provider,
        ai_agent::commands::ai_list_providers,
        ai_agent::commands::ai_check_provider_health,
        ai_agent::commands::ai_create_conversation,
        ai_agent::commands::ai_get_conversation,
        ai_agent::commands::ai_delete_conversation,
        ai_agent::commands::ai_list_conversations,
        ai_agent::commands::ai_rename_conversation,
        ai_agent::commands::ai_pin_conversation,
        ai_agent::commands::ai_archive_conversation,
        ai_agent::commands::ai_set_conversation_tags,
        ai_agent::commands::ai_fork_conversation,
        ai_agent::commands::ai_search_conversations,
        ai_agent::commands::ai_export_conversation,
        ai_agent::commands::ai_import_conversation,
        ai_agent::commands::ai_send_message,
        ai_agent::commands::ai_get_messages,
        ai_agent::commands::ai_clear_messages,
        ai_agent::commands::ai_chat_completion,
        ai_agent::commands::ai_run_agent,
        ai_agent::commands::ai_code_assist,
        ai_agent::commands::ai_code_generate,
        ai_agent::commands::ai_code_review,
        ai_agent::commands::ai_code_refactor,
        ai_agent::commands::ai_code_explain,
        ai_agent::commands::ai_code_document,
        ai_agent::commands::ai_code_find_bugs,
        ai_agent::commands::ai_code_optimize,
        ai_agent::commands::ai_code_write_tests,
        ai_agent::commands::ai_code_convert,
        ai_agent::commands::ai_code_fix_error,
        ai_agent::commands::ai_list_templates,
        ai_agent::commands::ai_get_template,
        ai_agent::commands::ai_create_template,
        ai_agent::commands::ai_delete_template,
        ai_agent::commands::ai_render_template,
        ai_agent::commands::ai_add_memory,
        ai_agent::commands::ai_search_memory,
        ai_agent::commands::ai_list_memory,
        ai_agent::commands::ai_remove_memory,
        ai_agent::commands::ai_clear_memory,
        ai_agent::commands::ai_get_memory_config,
        ai_agent::commands::ai_update_memory_config,
        ai_agent::commands::ai_add_vector,
        ai_agent::commands::ai_search_vectors,
        ai_agent::commands::ai_ingest_document,
        ai_agent::commands::ai_remove_document,
        ai_agent::commands::ai_search_rag,
        ai_agent::commands::ai_list_rag_collections,
        ai_agent::commands::ai_create_workflow,
        ai_agent::commands::ai_get_workflow,
        ai_agent::commands::ai_delete_workflow,
        ai_agent::commands::ai_list_workflows,
        ai_agent::commands::ai_run_workflow,
        ai_agent::commands::ai_count_tokens,
        ai_agent::commands::ai_get_budget_status,
        ai_agent::commands::ai_update_budget,
        ai_agent::commands::ai_reset_budget,
        ai_agent::commands::ai_diagnostics,

        // ── 1Password ────────────────────────────────────────────────
        onepassword::op_get_config,
        onepassword::op_set_config,
        onepassword::op_connect,
        onepassword::op_disconnect,
        onepassword::op_is_authenticated,
        onepassword::op_list_vaults,
        onepassword::op_get_vault,
        onepassword::op_find_vault_by_name,
        onepassword::op_get_vault_stats,
        onepassword::op_list_items,
        onepassword::op_get_item,
        onepassword::op_find_items_by_title,
        onepassword::op_create_item,
        onepassword::op_update_item,
        onepassword::op_patch_item,
        onepassword::op_delete_item,
        onepassword::op_archive_item,
        onepassword::op_restore_item,
        onepassword::op_search_all_vaults,
        onepassword::op_get_password,
        onepassword::op_get_username,
        onepassword::op_add_field,
        onepassword::op_update_field_value,
        onepassword::op_remove_field,
        onepassword::op_list_files,
        onepassword::op_download_file,
        onepassword::op_get_totp_code,
        onepassword::op_add_totp,
        onepassword::op_watchtower_analyze_all,
        onepassword::op_watchtower_analyze_vault,
        onepassword::op_heartbeat,
        onepassword::op_health,
        onepassword::op_is_healthy,
        onepassword::op_get_activity,
        onepassword::op_list_favorites,
        onepassword::op_toggle_favorite,
        onepassword::op_export_vault_json,
        onepassword::op_export_vault_csv,
        onepassword::op_import_json,
        onepassword::op_import_csv,
        onepassword::op_generate_password,
        onepassword::op_generate_passphrase,
        onepassword::op_rate_password_strength,
        onepassword::op_list_categories,
        onepassword::op_invalidate_cache,

        // ── LastPass ─────────────────────────────────────────────────
        lastpass::lp_configure,
        lastpass::lp_login,
        lastpass::lp_logout,
        lastpass::lp_is_logged_in,
        lastpass::lp_is_configured,
        lastpass::lp_list_accounts,
        lastpass::lp_get_account,
        lastpass::lp_search_accounts,
        lastpass::lp_search_by_url,
        lastpass::lp_create_account,
        lastpass::lp_update_account,
        lastpass::lp_delete_account,
        lastpass::lp_toggle_favorite,
        lastpass::lp_move_account,
        lastpass::lp_get_favorites,
        lastpass::lp_get_duplicates,
        lastpass::lp_list_folders,
        lastpass::lp_create_folder,
        lastpass::lp_security_challenge,
        lastpass::lp_export_csv,
        lastpass::lp_export_json,
        lastpass::lp_import_csv,
        lastpass::lp_generate_password,
        lastpass::lp_generate_passphrase,
        lastpass::lp_check_password_strength,
        lastpass::lp_get_stats,
        lastpass::lp_invalidate_cache,

        // ── Google Passwords ─────────────────────────────────────────
        google_passwords::gp_configure,
        google_passwords::gp_is_configured,
        google_passwords::gp_is_authenticated,
        google_passwords::gp_get_auth_url,
        google_passwords::gp_authenticate,
        google_passwords::gp_refresh_auth,
        google_passwords::gp_logout,
        google_passwords::gp_list_credentials,
        google_passwords::gp_get_credential,
        google_passwords::gp_search_credentials,
        google_passwords::gp_search_by_url,
        google_passwords::gp_create_credential,
        google_passwords::gp_update_credential,
        google_passwords::gp_delete_credential,
        google_passwords::gp_run_checkup,
        google_passwords::gp_get_insecure_urls,
        google_passwords::gp_import_csv,
        google_passwords::gp_export_csv,
        google_passwords::gp_export_json,
        google_passwords::gp_generate_password,
        google_passwords::gp_check_password_strength,
        google_passwords::gp_get_stats,
        google_passwords::gp_get_sync_info,

        // ── Dashlane ─────────────────────────────────────────────────
        dashlane::dl_configure,
        dashlane::dl_login,
        dashlane::dl_login_with_token,
        dashlane::dl_logout,
        dashlane::dl_is_authenticated,
        dashlane::dl_list_credentials,
        dashlane::dl_get_credential,
        dashlane::dl_search_credentials,
        dashlane::dl_search_by_url,
        dashlane::dl_create_credential,
        dashlane::dl_update_credential,
        dashlane::dl_delete_credential,
        dashlane::dl_find_duplicate_passwords,
        dashlane::dl_get_categories,
        dashlane::dl_list_notes,
        dashlane::dl_get_note,
        dashlane::dl_search_notes,
        dashlane::dl_create_note,
        dashlane::dl_delete_note,
        dashlane::dl_list_identities,
        dashlane::dl_create_identity,
        dashlane::dl_list_secrets,
        dashlane::dl_create_secret,
        dashlane::dl_list_devices,
        dashlane::dl_deregister_device,
        dashlane::dl_list_sharing_groups,
        dashlane::dl_create_sharing_group,
        dashlane::dl_get_dark_web_alerts,
        dashlane::dl_get_active_dark_web_alerts,
        dashlane::dl_dismiss_dark_web_alert,
        dashlane::dl_get_password_health,
        dashlane::dl_generate_password,
        dashlane::dl_generate_passphrase,
        dashlane::dl_check_password_strength,
        dashlane::dl_export_csv,
        dashlane::dl_export_json,
        dashlane::dl_import_csv,
        dashlane::dl_get_stats,
        // Hyper-V commands — Config / Module
        hyperv::commands::hyperv_check_module,
        hyperv::commands::hyperv_get_config,
        hyperv::commands::hyperv_set_config,
        // Hyper-V commands — VM Lifecycle
        hyperv::commands::hyperv_list_vms,
        hyperv::commands::hyperv_list_vms_summary,
        hyperv::commands::hyperv_get_vm,
        hyperv::commands::hyperv_get_vm_by_id,
        hyperv::commands::hyperv_create_vm,
        hyperv::commands::hyperv_start_vm,
        hyperv::commands::hyperv_stop_vm,
        hyperv::commands::hyperv_restart_vm,
        hyperv::commands::hyperv_pause_vm,
        hyperv::commands::hyperv_resume_vm,
        hyperv::commands::hyperv_save_vm,
        hyperv::commands::hyperv_remove_vm,
        hyperv::commands::hyperv_update_vm,
        hyperv::commands::hyperv_rename_vm,
        hyperv::commands::hyperv_export_vm,
        hyperv::commands::hyperv_import_vm,
        hyperv::commands::hyperv_live_migrate,
        hyperv::commands::hyperv_get_integration_services,
        hyperv::commands::hyperv_set_integration_service,
        hyperv::commands::hyperv_add_dvd_drive,
        hyperv::commands::hyperv_set_dvd_drive,
        hyperv::commands::hyperv_remove_dvd_drive,
        hyperv::commands::hyperv_add_hard_drive,
        hyperv::commands::hyperv_remove_hard_drive,
        // Hyper-V commands — Snapshots / Checkpoints
        hyperv::commands::hyperv_list_checkpoints,
        hyperv::commands::hyperv_get_checkpoint,
        hyperv::commands::hyperv_create_checkpoint,
        hyperv::commands::hyperv_restore_checkpoint,
        hyperv::commands::hyperv_restore_checkpoint_by_id,
        hyperv::commands::hyperv_remove_checkpoint,
        hyperv::commands::hyperv_remove_checkpoint_tree,
        hyperv::commands::hyperv_remove_all_checkpoints,
        hyperv::commands::hyperv_rename_checkpoint,
        hyperv::commands::hyperv_export_checkpoint,
        // Hyper-V commands — Networking
        hyperv::commands::hyperv_list_switches,
        hyperv::commands::hyperv_get_switch,
        hyperv::commands::hyperv_create_switch,
        hyperv::commands::hyperv_remove_switch,
        hyperv::commands::hyperv_rename_switch,
        hyperv::commands::hyperv_list_physical_adapters,
        hyperv::commands::hyperv_list_vm_adapters,
        hyperv::commands::hyperv_add_vm_adapter,
        hyperv::commands::hyperv_remove_vm_adapter,
        hyperv::commands::hyperv_connect_adapter,
        hyperv::commands::hyperv_disconnect_adapter,
        hyperv::commands::hyperv_set_adapter_vlan,
        hyperv::commands::hyperv_set_adapter_vlan_trunk,
        hyperv::commands::hyperv_remove_adapter_vlan,
        // Hyper-V commands — Storage (VHD/VHDX)
        hyperv::commands::hyperv_get_vhd,
        hyperv::commands::hyperv_test_vhd,
        hyperv::commands::hyperv_create_vhd,
        hyperv::commands::hyperv_resize_vhd,
        hyperv::commands::hyperv_convert_vhd,
        hyperv::commands::hyperv_compact_vhd,
        hyperv::commands::hyperv_optimize_vhd,
        hyperv::commands::hyperv_merge_vhd,
        hyperv::commands::hyperv_mount_vhd,
        hyperv::commands::hyperv_dismount_vhd,
        hyperv::commands::hyperv_delete_vhd,
        hyperv::commands::hyperv_list_vm_hard_drives,
        // Hyper-V commands — Metrics / Monitoring
        hyperv::commands::hyperv_get_vm_metrics,
        hyperv::commands::hyperv_get_all_vm_metrics,
        hyperv::commands::hyperv_enable_metering,
        hyperv::commands::hyperv_disable_metering,
        hyperv::commands::hyperv_reset_metering,
        hyperv::commands::hyperv_get_metering_report,
        hyperv::commands::hyperv_get_host_info,
        hyperv::commands::hyperv_get_events,
        hyperv::commands::hyperv_set_host_paths,
        hyperv::commands::hyperv_set_live_migration,
        hyperv::commands::hyperv_set_numa_spanning,
        // Hyper-V commands — Replication
        hyperv::commands::hyperv_get_replication,
        hyperv::commands::hyperv_list_replicated_vms,
        hyperv::commands::hyperv_enable_replication,
        hyperv::commands::hyperv_disable_replication,
        hyperv::commands::hyperv_start_initial_replication,
        hyperv::commands::hyperv_suspend_replication,
        hyperv::commands::hyperv_resume_replication,
        hyperv::commands::hyperv_planned_failover,
        hyperv::commands::hyperv_unplanned_failover,
        hyperv::commands::hyperv_complete_failover,
        hyperv::commands::hyperv_cancel_failover,
        hyperv::commands::hyperv_reverse_replication,
        hyperv::commands::hyperv_start_test_failover,
        hyperv::commands::hyperv_stop_test_failover,
        // MeshCentral commands — Connection
        meshcentral_dedicated::mc_connect,
        meshcentral_dedicated::mc_disconnect,
        meshcentral_dedicated::mc_disconnect_all,
        meshcentral_dedicated::mc_get_session_info,
        meshcentral_dedicated::mc_list_sessions,
        meshcentral_dedicated::mc_ping,
        // MeshCentral commands — Server
        meshcentral_dedicated::mc_get_server_info,
        meshcentral_dedicated::mc_get_server_version,
        meshcentral_dedicated::mc_health_check,
        // MeshCentral commands — Devices
        meshcentral_dedicated::mc_list_devices,
        meshcentral_dedicated::mc_get_device_info,
        meshcentral_dedicated::mc_add_local_device,
        meshcentral_dedicated::mc_add_amt_device,
        meshcentral_dedicated::mc_edit_device,
        meshcentral_dedicated::mc_remove_devices,
        meshcentral_dedicated::mc_move_device_to_group,
        // MeshCentral commands — Device Groups
        meshcentral_dedicated::mc_list_device_groups,
        meshcentral_dedicated::mc_create_device_group,
        meshcentral_dedicated::mc_edit_device_group,
        meshcentral_dedicated::mc_remove_device_group,
        // MeshCentral commands — Users
        meshcentral_dedicated::mc_list_users,
        meshcentral_dedicated::mc_add_user,
        meshcentral_dedicated::mc_edit_user,
        meshcentral_dedicated::mc_remove_user,
        // MeshCentral commands — User Groups
        meshcentral_dedicated::mc_list_user_groups,
        meshcentral_dedicated::mc_create_user_group,
        meshcentral_dedicated::mc_remove_user_group,
        // MeshCentral commands — Power
        meshcentral_dedicated::mc_power_action,
        meshcentral_dedicated::mc_wake_devices,
        // MeshCentral commands — Remote Commands
        meshcentral_dedicated::mc_run_commands,
        meshcentral_dedicated::mc_run_command_on_device,
        // MeshCentral commands — File Transfer
        meshcentral_dedicated::mc_upload_file,
        meshcentral_dedicated::mc_download_file,
        meshcentral_dedicated::mc_get_transfer_progress,
        meshcentral_dedicated::mc_get_active_transfers,
        meshcentral_dedicated::mc_cancel_transfer,
        // MeshCentral commands — Events
        meshcentral_dedicated::mc_list_events,
        // MeshCentral commands — Sharing
        meshcentral_dedicated::mc_create_device_share,
        meshcentral_dedicated::mc_list_device_shares,
        meshcentral_dedicated::mc_remove_device_share,
        // MeshCentral commands — Messaging
        meshcentral_dedicated::mc_send_toast,
        meshcentral_dedicated::mc_send_message_box,
        meshcentral_dedicated::mc_send_open_url,
        meshcentral_dedicated::mc_broadcast_message,
        // MeshCentral commands — Agents
        meshcentral_dedicated::mc_download_agent_to_file,
        meshcentral_dedicated::mc_send_invite_email,
        meshcentral_dedicated::mc_generate_invite_link,
        // MeshCentral commands — Reports & Relay
        meshcentral_dedicated::mc_generate_report,
        meshcentral_dedicated::mc_create_web_relay,
        // VMware commands — Connection
        vmware::commands::vmware_connect,
        vmware::commands::vmware_disconnect,
        vmware::commands::vmware_check_session,
        vmware::commands::vmware_is_connected,
        vmware::commands::vmware_get_config,
        // VMware commands — VM Lifecycle
        vmware::commands::vmware_list_vms,
        vmware::commands::vmware_list_running_vms,
        vmware::commands::vmware_get_vm,
        vmware::commands::vmware_create_vm,
        vmware::commands::vmware_delete_vm,
        vmware::commands::vmware_power_on,
        vmware::commands::vmware_power_off,
        vmware::commands::vmware_suspend,
        vmware::commands::vmware_reset,
        vmware::commands::vmware_shutdown_guest,
        vmware::commands::vmware_reboot_guest,
        vmware::commands::vmware_get_guest_identity,
        vmware::commands::vmware_update_cpu,
        vmware::commands::vmware_update_memory,
        vmware::commands::vmware_clone_vm,
        vmware::commands::vmware_relocate_vm,
        vmware::commands::vmware_find_vm_by_name,
        vmware::commands::vmware_get_power_state,
        // VMware commands — Snapshots
        vmware::commands::vmware_list_snapshots,
        vmware::commands::vmware_create_snapshot,
        vmware::commands::vmware_revert_snapshot,
        vmware::commands::vmware_delete_snapshot,
        vmware::commands::vmware_delete_all_snapshots,
        // VMware commands — Network
        vmware::commands::vmware_list_networks,
        vmware::commands::vmware_get_network,
        // VMware commands — Storage
        vmware::commands::vmware_list_datastores,
        vmware::commands::vmware_get_datastore,
        // VMware commands — Hosts
        vmware::commands::vmware_list_hosts,
        vmware::commands::vmware_get_host,
        vmware::commands::vmware_disconnect_host,
        vmware::commands::vmware_reconnect_host,
        vmware::commands::vmware_list_clusters,
        vmware::commands::vmware_list_datacenters,
        vmware::commands::vmware_list_folders,
        vmware::commands::vmware_list_resource_pools,
        // VMware commands — Metrics
        vmware::commands::vmware_get_vm_stats,
        vmware::commands::vmware_get_all_vm_stats,
        vmware::commands::vmware_get_inventory_summary,
        // VMware commands — Console (cross-platform WebSocket)
        vmware::commands::vmware_acquire_console_ticket,
        vmware::commands::vmware_open_console,
        vmware::commands::vmware_close_console,
        vmware::commands::vmware_close_all_consoles,
        vmware::commands::vmware_list_console_sessions,
        vmware::commands::vmware_get_console_session,
        // VMware commands — VMRC / Horizon (binary fallback)
        vmware::commands::vmware_launch_vmrc,
        vmware::commands::vmware_list_vmrc_sessions,
        vmware::commands::vmware_close_vmrc_session,
        vmware::commands::vmware_close_all_vmrc_sessions,
        vmware::commands::vmware_is_vmrc_available,
        vmware::commands::vmware_is_horizon_available,
        // Proxmox VE commands — Connection
        proxmox::commands::proxmox_connect,
        proxmox::commands::proxmox_disconnect,
        proxmox::commands::proxmox_check_session,
        proxmox::commands::proxmox_is_connected,
        proxmox::commands::proxmox_get_config,
        proxmox::commands::proxmox_get_version,
        // Proxmox VE commands — Nodes
        proxmox::commands::proxmox_list_nodes,
        proxmox::commands::proxmox_get_node_status,
        proxmox::commands::proxmox_list_node_services,
        proxmox::commands::proxmox_start_node_service,
        proxmox::commands::proxmox_stop_node_service,
        proxmox::commands::proxmox_restart_node_service,
        proxmox::commands::proxmox_get_node_dns,
        proxmox::commands::proxmox_get_node_syslog,
        proxmox::commands::proxmox_list_apt_updates,
        proxmox::commands::proxmox_reboot_node,
        proxmox::commands::proxmox_shutdown_node,
        // Proxmox VE commands — QEMU VMs
        proxmox::commands::proxmox_list_qemu_vms,
        proxmox::commands::proxmox_get_qemu_status,
        proxmox::commands::proxmox_get_qemu_config,
        proxmox::commands::proxmox_create_qemu_vm,
        proxmox::commands::proxmox_delete_qemu_vm,
        proxmox::commands::proxmox_start_qemu_vm,
        proxmox::commands::proxmox_stop_qemu_vm,
        proxmox::commands::proxmox_shutdown_qemu_vm,
        proxmox::commands::proxmox_reboot_qemu_vm,
        proxmox::commands::proxmox_suspend_qemu_vm,
        proxmox::commands::proxmox_resume_qemu_vm,
        proxmox::commands::proxmox_reset_qemu_vm,
        proxmox::commands::proxmox_resize_qemu_disk,
        proxmox::commands::proxmox_clone_qemu_vm,
        proxmox::commands::proxmox_migrate_qemu_vm,
        proxmox::commands::proxmox_convert_qemu_to_template,
        proxmox::commands::proxmox_qemu_agent_exec,
        proxmox::commands::proxmox_qemu_agent_network,
        proxmox::commands::proxmox_qemu_agent_osinfo,
        proxmox::commands::proxmox_get_next_vmid,
        // Proxmox VE commands — LXC Containers
        proxmox::commands::proxmox_list_lxc_containers,
        proxmox::commands::proxmox_get_lxc_status,
        proxmox::commands::proxmox_get_lxc_config,
        proxmox::commands::proxmox_create_lxc_container,
        proxmox::commands::proxmox_delete_lxc_container,
        proxmox::commands::proxmox_start_lxc_container,
        proxmox::commands::proxmox_stop_lxc_container,
        proxmox::commands::proxmox_shutdown_lxc_container,
        proxmox::commands::proxmox_reboot_lxc_container,
        proxmox::commands::proxmox_clone_lxc_container,
        proxmox::commands::proxmox_migrate_lxc_container,
        // Proxmox VE commands — Storage
        proxmox::commands::proxmox_list_storage,
        proxmox::commands::proxmox_list_storage_content,
        proxmox::commands::proxmox_delete_storage_volume,
        proxmox::commands::proxmox_download_to_storage,
        // Proxmox VE commands — Network
        proxmox::commands::proxmox_list_network_interfaces,
        proxmox::commands::proxmox_get_network_interface,
        proxmox::commands::proxmox_create_network_interface,
        proxmox::commands::proxmox_delete_network_interface,
        proxmox::commands::proxmox_apply_network_changes,
        proxmox::commands::proxmox_revert_network_changes,
        // Proxmox VE commands — Cluster
        proxmox::commands::proxmox_get_cluster_status,
        proxmox::commands::proxmox_list_cluster_resources,
        proxmox::commands::proxmox_get_cluster_next_id,
        proxmox::commands::proxmox_list_users,
        proxmox::commands::proxmox_list_roles,
        proxmox::commands::proxmox_list_groups,
        // Proxmox VE commands — Tasks
        proxmox::commands::proxmox_list_tasks,
        proxmox::commands::proxmox_get_task_status,
        proxmox::commands::proxmox_get_task_log,
        proxmox::commands::proxmox_stop_task,
        // Proxmox VE commands — Backups
        proxmox::commands::proxmox_list_backup_jobs,
        proxmox::commands::proxmox_vzdump,
        proxmox::commands::proxmox_restore_backup,
        proxmox::commands::proxmox_list_backups,
        // Proxmox VE commands — Firewall
        proxmox::commands::proxmox_get_cluster_firewall_options,
        proxmox::commands::proxmox_list_cluster_firewall_rules,
        proxmox::commands::proxmox_list_security_groups,
        proxmox::commands::proxmox_list_firewall_aliases,
        proxmox::commands::proxmox_list_firewall_ipsets,
        proxmox::commands::proxmox_list_guest_firewall_rules,
        // Proxmox VE commands — Pools
        proxmox::commands::proxmox_list_pools,
        proxmox::commands::proxmox_get_pool,
        proxmox::commands::proxmox_create_pool,
        proxmox::commands::proxmox_delete_pool,
        // Proxmox VE commands — HA
        proxmox::commands::proxmox_list_ha_resources,
        proxmox::commands::proxmox_list_ha_groups,
        // Proxmox VE commands — Ceph
        proxmox::commands::proxmox_get_ceph_status,
        proxmox::commands::proxmox_list_ceph_pools,
        proxmox::commands::proxmox_list_ceph_monitors,
        proxmox::commands::proxmox_list_ceph_osds,
        // Proxmox VE commands — SDN
        proxmox::commands::proxmox_list_sdn_zones,
        proxmox::commands::proxmox_list_sdn_vnets,
        // Proxmox VE commands — Console
        proxmox::commands::proxmox_qemu_vnc_proxy,
        proxmox::commands::proxmox_qemu_spice_proxy,
        proxmox::commands::proxmox_qemu_termproxy,
        proxmox::commands::proxmox_lxc_vnc_proxy,
        proxmox::commands::proxmox_lxc_spice_proxy,
        proxmox::commands::proxmox_lxc_termproxy,
        proxmox::commands::proxmox_node_termproxy,
        // Proxmox VE commands — Snapshots
        proxmox::commands::proxmox_list_qemu_snapshots,
        proxmox::commands::proxmox_create_qemu_snapshot,
        proxmox::commands::proxmox_rollback_qemu_snapshot,
        proxmox::commands::proxmox_delete_qemu_snapshot,
        proxmox::commands::proxmox_list_lxc_snapshots,
        proxmox::commands::proxmox_create_lxc_snapshot,
        proxmox::commands::proxmox_rollback_lxc_snapshot,
        proxmox::commands::proxmox_delete_lxc_snapshot,
        // Proxmox VE commands — Metrics / RRD
        proxmox::commands::proxmox_node_rrd,
        proxmox::commands::proxmox_qemu_rrd,
        proxmox::commands::proxmox_lxc_rrd,
        // Proxmox VE commands — Templates
        proxmox::commands::proxmox_list_appliance_templates,
        proxmox::commands::proxmox_download_appliance,
        proxmox::commands::proxmox_list_isos,
        proxmox::commands::proxmox_list_container_templates,
        // Dell iDRAC commands — Connection
        idrac::commands::idrac_connect,
        idrac::commands::idrac_disconnect,
        idrac::commands::idrac_check_session,
        idrac::commands::idrac_is_connected,
        idrac::commands::idrac_get_config,
        // Dell iDRAC commands — System
        idrac::commands::idrac_get_system_info,
        idrac::commands::idrac_get_idrac_info,
        idrac::commands::idrac_set_asset_tag,
        idrac::commands::idrac_set_indicator_led,
        // Dell iDRAC commands — Power
        idrac::commands::idrac_power_action,
        idrac::commands::idrac_get_power_state,
        idrac::commands::idrac_get_power_metrics,
        idrac::commands::idrac_list_power_supplies,
        idrac::commands::idrac_set_power_cap,
        // Dell iDRAC commands — Thermal
        idrac::commands::idrac_get_thermal_data,
        idrac::commands::idrac_get_thermal_summary,
        idrac::commands::idrac_set_fan_offset,
        // Dell iDRAC commands — Hardware
        idrac::commands::idrac_list_processors,
        idrac::commands::idrac_list_memory,
        idrac::commands::idrac_list_pcie_devices,
        idrac::commands::idrac_get_total_memory,
        idrac::commands::idrac_get_processor_count,
        // Dell iDRAC commands — Storage
        idrac::commands::idrac_list_storage_controllers,
        idrac::commands::idrac_list_virtual_disks,
        idrac::commands::idrac_list_physical_disks,
        idrac::commands::idrac_list_enclosures,
        idrac::commands::idrac_create_virtual_disk,
        idrac::commands::idrac_delete_virtual_disk,
        idrac::commands::idrac_assign_hotspare,
        idrac::commands::idrac_initialize_virtual_disk,
        // Dell iDRAC commands — Network
        idrac::commands::idrac_list_network_adapters,
        idrac::commands::idrac_list_network_ports,
        idrac::commands::idrac_get_network_config,
        idrac::commands::idrac_update_network_config,
        // Dell iDRAC commands — Firmware
        idrac::commands::idrac_list_firmware,
        idrac::commands::idrac_update_firmware,
        idrac::commands::idrac_get_component_version,
        // Dell iDRAC commands — Lifecycle
        idrac::commands::idrac_list_jobs,
        idrac::commands::idrac_get_job,
        idrac::commands::idrac_delete_job,
        idrac::commands::idrac_purge_job_queue,
        idrac::commands::idrac_export_scp,
        idrac::commands::idrac_import_scp,
        idrac::commands::idrac_get_lc_status,
        idrac::commands::idrac_wait_for_job,
        // Dell iDRAC commands — Virtual Media
        idrac::commands::idrac_list_virtual_media,
        idrac::commands::idrac_mount_virtual_media,
        idrac::commands::idrac_unmount_virtual_media,
        idrac::commands::idrac_boot_from_virtual_cd,
        // Dell iDRAC commands — Virtual Console
        idrac::commands::idrac_get_console_info,
        idrac::commands::idrac_set_console_enabled,
        idrac::commands::idrac_set_console_type,
        idrac::commands::idrac_set_vnc_enabled,
        idrac::commands::idrac_set_vnc_password,
        // Dell iDRAC commands — Event Log
        idrac::commands::idrac_get_sel_entries,
        idrac::commands::idrac_get_lc_log_entries,
        idrac::commands::idrac_clear_sel,
        idrac::commands::idrac_clear_lc_log,
        // Dell iDRAC commands — Users
        idrac::commands::idrac_list_users,
        idrac::commands::idrac_create_or_update_user,
        idrac::commands::idrac_delete_user,
        idrac::commands::idrac_unlock_user,
        idrac::commands::idrac_change_user_password,
        idrac::commands::idrac_get_ldap_config,
        idrac::commands::idrac_get_ad_config,
        // Dell iDRAC commands — BIOS
        idrac::commands::idrac_get_bios_attributes,
        idrac::commands::idrac_get_bios_attribute,
        idrac::commands::idrac_set_bios_attributes,
        idrac::commands::idrac_get_boot_order,
        idrac::commands::idrac_set_boot_order,
        idrac::commands::idrac_set_boot_once,
        idrac::commands::idrac_set_boot_mode,
        // Dell iDRAC commands — Certificates
        idrac::commands::idrac_list_certificates,
        idrac::commands::idrac_generate_csr,
        idrac::commands::idrac_import_certificate,
        idrac::commands::idrac_delete_certificate,
        idrac::commands::idrac_replace_ssl_certificate,
        // Dell iDRAC commands — Health
        idrac::commands::idrac_get_health_rollup,
        idrac::commands::idrac_get_component_health,
        idrac::commands::idrac_is_healthy,
        // Dell iDRAC commands — Telemetry
        idrac::commands::idrac_get_power_telemetry,
        idrac::commands::idrac_get_thermal_telemetry,
        idrac::commands::idrac_list_telemetry_reports,
        idrac::commands::idrac_get_telemetry_report,
        // Dell iDRAC commands — RACADM
        idrac::commands::idrac_racadm_execute,
        idrac::commands::idrac_reset,
        idrac::commands::idrac_get_attribute,
        idrac::commands::idrac_set_attribute,
        // Dell iDRAC commands — Dashboard
        idrac::commands::idrac_get_dashboard,
        // HP iLO commands — Connection
        ilo::commands::ilo_connect,
        ilo::commands::ilo_disconnect,
        ilo::commands::ilo_check_session,
        ilo::commands::ilo_is_connected,
        ilo::commands::ilo_get_config,
        // HP iLO commands — System
        ilo::commands::ilo_get_system_info,
        ilo::commands::ilo_get_ilo_info,
        ilo::commands::ilo_set_asset_tag,
        ilo::commands::ilo_set_indicator_led,
        // HP iLO commands — Power
        ilo::commands::ilo_power_action,
        ilo::commands::ilo_get_power_state,
        ilo::commands::ilo_get_power_metrics,
        // HP iLO commands — Thermal
        ilo::commands::ilo_get_thermal_data,
        ilo::commands::ilo_get_thermal_summary,
        // HP iLO commands — Hardware
        ilo::commands::ilo_get_processors,
        ilo::commands::ilo_get_memory,
        // HP iLO commands — Storage
        ilo::commands::ilo_get_storage_controllers,
        ilo::commands::ilo_get_virtual_disks,
        ilo::commands::ilo_get_physical_disks,
        // HP iLO commands — Network
        ilo::commands::ilo_get_network_adapters,
        ilo::commands::ilo_get_ilo_network,
        // HP iLO commands — Firmware
        ilo::commands::ilo_get_firmware_inventory,
        // HP iLO commands — Virtual Media
        ilo::commands::ilo_get_virtual_media_status,
        ilo::commands::ilo_insert_virtual_media,
        ilo::commands::ilo_eject_virtual_media,
        ilo::commands::ilo_set_vm_boot_once,
        // HP iLO commands — Virtual Console
        ilo::commands::ilo_get_console_info,
        ilo::commands::ilo_get_html5_launch_url,
        // HP iLO commands — Event Log
        ilo::commands::ilo_get_iml,
        ilo::commands::ilo_get_ilo_event_log,
        ilo::commands::ilo_clear_iml,
        ilo::commands::ilo_clear_ilo_event_log,
        // HP iLO commands — Users
        ilo::commands::ilo_get_users,
        ilo::commands::ilo_create_user,
        ilo::commands::ilo_update_password,
        ilo::commands::ilo_delete_user,
        ilo::commands::ilo_set_user_enabled,
        // HP iLO commands — BIOS
        ilo::commands::ilo_get_bios_attributes,
        ilo::commands::ilo_set_bios_attributes,
        ilo::commands::ilo_get_boot_config,
        ilo::commands::ilo_set_boot_override,
        // HP iLO commands — Certificates
        ilo::commands::ilo_get_certificate,
        ilo::commands::ilo_generate_csr,
        ilo::commands::ilo_import_certificate,
        // HP iLO commands — Health
        ilo::commands::ilo_get_health_rollup,
        ilo::commands::ilo_get_dashboard,
        // HP iLO commands — License
        ilo::commands::ilo_get_license,
        ilo::commands::ilo_activate_license,
        ilo::commands::ilo_deactivate_license,
        // HP iLO commands — Security
        ilo::commands::ilo_get_security_status,
        ilo::commands::ilo_set_min_tls_version,
        ilo::commands::ilo_set_ipmi_over_lan,
        // HP iLO commands — Federation
        ilo::commands::ilo_get_federation_groups,
        ilo::commands::ilo_get_federation_peers,
        ilo::commands::ilo_add_federation_group,
        ilo::commands::ilo_remove_federation_group,
        // HP iLO commands — Reset
        ilo::commands::ilo_reset,
        // Lenovo XCC commands — Connection
        lenovo::commands::lenovo_connect,
        lenovo::commands::lenovo_disconnect,
        lenovo::commands::lenovo_check_session,
        lenovo::commands::lenovo_is_connected,
        lenovo::commands::lenovo_get_config,
        // Lenovo XCC commands — System
        lenovo::commands::lenovo_get_system_info,
        lenovo::commands::lenovo_get_xcc_info,
        lenovo::commands::lenovo_set_asset_tag,
        lenovo::commands::lenovo_set_indicator_led,
        // Lenovo XCC commands — Power
        lenovo::commands::lenovo_power_action,
        lenovo::commands::lenovo_get_power_state,
        lenovo::commands::lenovo_get_power_metrics,
        // Lenovo XCC commands — Thermal
        lenovo::commands::lenovo_get_thermal_data,
        lenovo::commands::lenovo_get_thermal_summary,
        // Lenovo XCC commands — Hardware
        lenovo::commands::lenovo_get_processors,
        lenovo::commands::lenovo_get_memory,
        // Lenovo XCC commands — Storage
        lenovo::commands::lenovo_get_storage_controllers,
        lenovo::commands::lenovo_get_virtual_disks,
        lenovo::commands::lenovo_get_physical_disks,
        // Lenovo XCC commands — Network
        lenovo::commands::lenovo_get_network_adapters,
        lenovo::commands::lenovo_get_xcc_network,
        // Lenovo XCC commands — Firmware
        lenovo::commands::lenovo_get_firmware_inventory,
        // Lenovo XCC commands — Virtual Media
        lenovo::commands::lenovo_get_virtual_media_status,
        lenovo::commands::lenovo_insert_virtual_media,
        lenovo::commands::lenovo_eject_virtual_media,
        // Lenovo XCC commands — Console
        lenovo::commands::lenovo_get_console_info,
        lenovo::commands::lenovo_get_html5_launch_url,
        // Lenovo XCC commands — Event Log
        lenovo::commands::lenovo_get_event_log,
        lenovo::commands::lenovo_get_audit_log,
        lenovo::commands::lenovo_clear_event_log,
        // Lenovo XCC commands — Users
        lenovo::commands::lenovo_get_users,
        lenovo::commands::lenovo_create_user,
        lenovo::commands::lenovo_update_password,
        lenovo::commands::lenovo_delete_user,
        // Lenovo XCC commands — BIOS
        lenovo::commands::lenovo_get_bios_attributes,
        lenovo::commands::lenovo_set_bios_attributes,
        lenovo::commands::lenovo_get_boot_config,
        lenovo::commands::lenovo_set_boot_override,
        // Lenovo XCC commands — Certificates
        lenovo::commands::lenovo_get_certificate,
        lenovo::commands::lenovo_generate_csr,
        lenovo::commands::lenovo_import_certificate,
        // Lenovo XCC commands — Health
        lenovo::commands::lenovo_get_health_rollup,
        lenovo::commands::lenovo_get_dashboard,
        // Lenovo XCC commands — License
        lenovo::commands::lenovo_get_license,
        // Lenovo XCC commands — OneCLI
        lenovo::commands::lenovo_onecli_execute,
        // Lenovo XCC commands — Reset
        lenovo::commands::lenovo_reset_controller,
        // Supermicro BMC commands — Connection
        supermicro::commands::smc_connect,
        supermicro::commands::smc_disconnect,
        supermicro::commands::smc_check_session,
        supermicro::commands::smc_is_connected,
        supermicro::commands::smc_get_config,
        // Supermicro BMC commands — System
        supermicro::commands::smc_get_system_info,
        supermicro::commands::smc_get_bmc_info,
        supermicro::commands::smc_set_asset_tag,
        supermicro::commands::smc_set_indicator_led,
        // Supermicro BMC commands — Power
        supermicro::commands::smc_power_action,
        supermicro::commands::smc_get_power_state,
        supermicro::commands::smc_get_power_metrics,
        // Supermicro BMC commands — Thermal
        supermicro::commands::smc_get_thermal_data,
        supermicro::commands::smc_get_thermal_summary,
        // Supermicro BMC commands — Hardware
        supermicro::commands::smc_get_processors,
        supermicro::commands::smc_get_memory,
        // Supermicro BMC commands — Storage
        supermicro::commands::smc_get_storage_controllers,
        supermicro::commands::smc_get_virtual_disks,
        supermicro::commands::smc_get_physical_disks,
        // Supermicro BMC commands — Network
        supermicro::commands::smc_get_network_adapters,
        supermicro::commands::smc_get_bmc_network,
        // Supermicro BMC commands — Firmware
        supermicro::commands::smc_get_firmware_inventory,
        // Supermicro BMC commands — Virtual Media
        supermicro::commands::smc_get_virtual_media_status,
        supermicro::commands::smc_insert_virtual_media,
        supermicro::commands::smc_eject_virtual_media,
        // Supermicro BMC commands — Console / iKVM
        supermicro::commands::smc_get_console_info,
        supermicro::commands::smc_get_html5_ikvm_url,
        // Supermicro BMC commands — Event Log
        supermicro::commands::smc_get_event_log,
        supermicro::commands::smc_get_audit_log,
        supermicro::commands::smc_clear_event_log,
        // Supermicro BMC commands — Users
        supermicro::commands::smc_get_users,
        supermicro::commands::smc_create_user,
        supermicro::commands::smc_update_password,
        supermicro::commands::smc_delete_user,
        // Supermicro BMC commands — BIOS
        supermicro::commands::smc_get_bios_attributes,
        supermicro::commands::smc_set_bios_attributes,
        supermicro::commands::smc_get_boot_config,
        supermicro::commands::smc_set_boot_override,
        // Supermicro BMC commands — Certificates
        supermicro::commands::smc_get_certificate,
        supermicro::commands::smc_generate_csr,
        supermicro::commands::smc_import_certificate,
        // Supermicro BMC commands — Health
        supermicro::commands::smc_get_health_rollup,
        supermicro::commands::smc_get_dashboard,
        // Supermicro BMC commands — Security
        supermicro::commands::smc_get_security_status,
        // Supermicro BMC commands — License
        supermicro::commands::smc_get_licenses,
        supermicro::commands::smc_activate_license,
        // Supermicro BMC commands — Node Manager
        supermicro::commands::smc_get_node_manager_policies,
        supermicro::commands::smc_get_node_manager_stats,
        // Supermicro BMC commands — Reset
        supermicro::commands::smc_reset_bmc,
        // Synology NAS commands — Connection
        synology::commands::syn_connect,
        synology::commands::syn_disconnect,
        synology::commands::syn_is_connected,
        synology::commands::syn_check_session,
        synology::commands::syn_get_config,
        // Synology NAS commands — System
        synology::commands::syn_get_system_info,
        synology::commands::syn_get_utilization,
        synology::commands::syn_list_processes,
        synology::commands::syn_reboot,
        synology::commands::syn_shutdown,
        synology::commands::syn_check_update,
        // Synology NAS commands — Storage
        synology::commands::syn_get_storage_overview,
        synology::commands::syn_list_disks,
        synology::commands::syn_list_volumes,
        synology::commands::syn_get_smart_info,
        synology::commands::syn_list_iscsi_luns,
        synology::commands::syn_list_iscsi_targets,
        // Synology NAS commands — File Station
        synology::commands::syn_get_file_station_info,
        synology::commands::syn_list_files,
        synology::commands::syn_list_file_shared_folders,
        synology::commands::syn_search_files,
        synology::commands::syn_upload_file,
        synology::commands::syn_download_file,
        synology::commands::syn_create_folder,
        synology::commands::syn_delete_files,
        synology::commands::syn_rename_file,
        synology::commands::syn_create_share_link,
        // Synology NAS commands — Shared Folders
        synology::commands::syn_list_shared_folders,
        synology::commands::syn_get_share_permissions,
        synology::commands::syn_create_shared_folder,
        synology::commands::syn_delete_shared_folder,
        synology::commands::syn_mount_encrypted_share,
        synology::commands::syn_unmount_encrypted_share,
        // Synology NAS commands — Network
        synology::commands::syn_get_network_overview,
        synology::commands::syn_list_network_interfaces,
        synology::commands::syn_list_firewall_rules,
        synology::commands::syn_list_dhcp_leases,
        // Synology NAS commands — Users & Groups
        synology::commands::syn_list_users,
        synology::commands::syn_create_user,
        synology::commands::syn_delete_user,
        synology::commands::syn_list_groups,
        // Synology NAS commands — Packages
        synology::commands::syn_list_packages,
        synology::commands::syn_start_package,
        synology::commands::syn_stop_package,
        synology::commands::syn_install_package,
        synology::commands::syn_uninstall_package,
        // Synology NAS commands — Services
        synology::commands::syn_list_services,
        synology::commands::syn_get_smb_config,
        synology::commands::syn_get_nfs_config,
        synology::commands::syn_get_ssh_config,
        synology::commands::syn_set_ssh_enabled,
        // Synology NAS commands — Docker
        synology::commands::syn_list_docker_containers,
        synology::commands::syn_start_docker_container,
        synology::commands::syn_stop_docker_container,
        synology::commands::syn_restart_docker_container,
        synology::commands::syn_delete_docker_container,
        synology::commands::syn_list_docker_images,
        synology::commands::syn_pull_docker_image,
        synology::commands::syn_list_docker_networks,
        synology::commands::syn_list_docker_projects,
        synology::commands::syn_start_docker_project,
        synology::commands::syn_stop_docker_project,
        // Synology NAS commands — VMs
        synology::commands::syn_list_vms,
        synology::commands::syn_vm_power_on,
        synology::commands::syn_vm_shutdown,
        synology::commands::syn_vm_force_shutdown,
        synology::commands::syn_list_vm_snapshots,
        synology::commands::syn_take_vm_snapshot,
        // Synology NAS commands — Download Station
        synology::commands::syn_get_download_station_info,
        synology::commands::syn_list_download_tasks,
        synology::commands::syn_create_download_task,
        synology::commands::syn_pause_download,
        synology::commands::syn_resume_download,
        synology::commands::syn_delete_download,
        synology::commands::syn_get_download_stats,
        // Synology NAS commands — Surveillance
        synology::commands::syn_get_surveillance_info,
        synology::commands::syn_list_cameras,
        synology::commands::syn_get_camera_snapshot,
        synology::commands::syn_list_recordings,
        // Synology NAS commands — Backup
        synology::commands::syn_list_backup_tasks,
        synology::commands::syn_start_backup_task,
        synology::commands::syn_cancel_backup_task,
        synology::commands::syn_list_backup_versions,
        synology::commands::syn_list_active_backup_devices,
        // Synology NAS commands — Security
        synology::commands::syn_get_security_overview,
        synology::commands::syn_list_blocked_ips,
        synology::commands::syn_unblock_ip,
        synology::commands::syn_list_certificates,
        synology::commands::syn_get_auto_block_config,
        // Synology NAS commands — Hardware
        synology::commands::syn_get_hardware_info,
        synology::commands::syn_get_ups_info,
        synology::commands::syn_get_power_schedule,
        // Synology NAS commands — Logs
        synology::commands::syn_get_system_logs,
        synology::commands::syn_get_connection_logs,
        synology::commands::syn_get_active_connections,
        // Synology NAS commands — Notifications
        synology::commands::syn_get_notification_config,
        synology::commands::syn_test_email_notification,
        // Synology NAS commands — Dashboard
        synology::commands::syn_get_dashboard,
        // mRemoteNG commands — Format Detection
        mremoteng_dedicated::mrng_detect_format,
        mremoteng_dedicated::mrng_get_import_formats,
        mremoteng_dedicated::mrng_get_export_formats,
        // mRemoteNG commands — Import
        mremoteng_dedicated::mrng_import_xml,
        mremoteng_dedicated::mrng_import_xml_as_connections,
        mremoteng_dedicated::mrng_import_csv,
        mremoteng_dedicated::mrng_import_csv_as_connections,
        mremoteng_dedicated::mrng_import_rdp_files,
        mremoteng_dedicated::mrng_import_rdp_as_connections,
        mremoteng_dedicated::mrng_import_putty_reg,
        mremoteng_dedicated::mrng_import_putty_registry,
        mremoteng_dedicated::mrng_import_putty_as_connections,
        mremoteng_dedicated::mrng_import_auto,
        mremoteng_dedicated::mrng_import_auto_as_connections,
        // mRemoteNG commands — Export
        mremoteng_dedicated::mrng_export_xml,
        mremoteng_dedicated::mrng_export_app_to_xml,
        mremoteng_dedicated::mrng_export_csv,
        mremoteng_dedicated::mrng_export_app_to_csv,
        mremoteng_dedicated::mrng_export_rdp_file,
        mremoteng_dedicated::mrng_export_app_to_rdp,
        // mRemoteNG commands — Validation / Info
        mremoteng_dedicated::mrng_validate_xml,
        mremoteng_dedicated::mrng_get_last_import,
        mremoteng_dedicated::mrng_get_last_export,
        // mRemoteNG commands — Configuration
        mremoteng_dedicated::mrng_set_password,
        mremoteng_dedicated::mrng_set_kdf_iterations,
        // Terminal Services commands — Config
        termserv::commands::ts_get_config,
        termserv::commands::ts_set_config,
        // Terminal Services commands — Server handles
        termserv::commands::ts_open_server,
        termserv::commands::ts_close_server,
        termserv::commands::ts_close_all_servers,
        termserv::commands::ts_list_open_servers,
        // Terminal Services commands — Sessions
        termserv::commands::ts_list_sessions,
        termserv::commands::ts_list_user_sessions,
        termserv::commands::ts_get_session_detail,
        termserv::commands::ts_get_all_session_details,
        termserv::commands::ts_disconnect_session,
        termserv::commands::ts_logoff_session,
        termserv::commands::ts_connect_session,
        termserv::commands::ts_logoff_disconnected,
        termserv::commands::ts_find_sessions_by_user,
        termserv::commands::ts_server_summary,
        termserv::commands::ts_get_console_session_id,
        termserv::commands::ts_get_current_session_id,
        termserv::commands::ts_is_remote_session,
        termserv::commands::ts_get_idle_seconds,
        // Terminal Services commands — Processes
        termserv::commands::ts_list_processes,
        termserv::commands::ts_list_session_processes,
        termserv::commands::ts_find_processes_by_name,
        termserv::commands::ts_terminate_process,
        termserv::commands::ts_terminate_processes_by_name,
        termserv::commands::ts_process_count_per_session,
        termserv::commands::ts_top_process_names,
        // Terminal Services commands — Messaging
        termserv::commands::ts_send_message,
        termserv::commands::ts_send_info,
        termserv::commands::ts_broadcast_message,
        // Terminal Services commands — Shadow / Remote Control
        termserv::commands::ts_start_shadow,
        termserv::commands::ts_stop_shadow,
        // Terminal Services commands — Server discovery & control
        termserv::commands::ts_enumerate_domain_servers,
        termserv::commands::ts_shutdown_server,
        termserv::commands::ts_list_listeners,
        // Terminal Services commands — User config, encryption, address
        termserv::commands::ts_query_user_config,
        termserv::commands::ts_set_user_config,
        termserv::commands::ts_get_encryption_level,
        termserv::commands::ts_get_session_address,
        // Terminal Services commands — Filtered sessions & batch ops
        termserv::commands::ts_list_sessions_filtered,
        termserv::commands::ts_batch_disconnect,
        termserv::commands::ts_batch_logoff,
        termserv::commands::ts_batch_send_message,
        // Terminal Services commands — Event monitoring
        termserv::commands::ts_wait_system_event,
        // WhatsApp commands — Configuration
        whatsapp::commands::wa_configure,
        whatsapp::commands::wa_configure_unofficial,
        whatsapp::commands::wa_is_configured,
        // WhatsApp commands — Messaging (Official Cloud API)
        whatsapp::commands::wa_send_text,
        whatsapp::commands::wa_send_image,
        whatsapp::commands::wa_send_document,
        whatsapp::commands::wa_send_video,
        whatsapp::commands::wa_send_audio,
        whatsapp::commands::wa_send_location,
        whatsapp::commands::wa_send_reaction,
        whatsapp::commands::wa_send_template,
        whatsapp::commands::wa_mark_as_read,
        // WhatsApp commands — Media
        whatsapp::commands::wa_upload_media,
        whatsapp::commands::wa_upload_media_file,
        whatsapp::commands::wa_get_media_url,
        whatsapp::commands::wa_download_media,
        whatsapp::commands::wa_delete_media,
        // WhatsApp commands — Templates
        whatsapp::commands::wa_create_template,
        whatsapp::commands::wa_list_templates,
        whatsapp::commands::wa_delete_template,
        // WhatsApp commands — Contacts
        whatsapp::commands::wa_check_contact,
        whatsapp::commands::wa_me_link,
        // WhatsApp commands — Groups
        whatsapp::commands::wa_create_group,
        whatsapp::commands::wa_get_group_info,
        // WhatsApp commands — Business Profile & Phone Numbers
        whatsapp::commands::wa_get_business_profile,
        whatsapp::commands::wa_list_phone_numbers,
        // WhatsApp commands — Webhooks
        whatsapp::commands::wa_webhook_verify,
        whatsapp::commands::wa_webhook_process,
        // WhatsApp commands — Sessions
        whatsapp::commands::wa_list_sessions,
        // WhatsApp commands — Unofficial (WA Web)
        whatsapp::commands::wa_unofficial_connect,
        whatsapp::commands::wa_unofficial_disconnect,
        whatsapp::commands::wa_unofficial_state,
        whatsapp::commands::wa_unofficial_send_text,
        // WhatsApp commands — Pairing
        whatsapp::commands::wa_pairing_start_qr,
        whatsapp::commands::wa_pairing_refresh_qr,
        whatsapp::commands::wa_pairing_start_phone,
        whatsapp::commands::wa_pairing_state,
        whatsapp::commands::wa_pairing_cancel,
        // WhatsApp commands — Chat History
        whatsapp::commands::wa_get_messages,
        whatsapp::commands::wa_send_auto,
        // Telegram Bot API commands — Bot management
        telegram::commands::telegram_add_bot,
        telegram::commands::telegram_remove_bot,
        telegram::commands::telegram_list_bots,
        telegram::commands::telegram_validate_bot,
        telegram::commands::telegram_set_bot_enabled,
        telegram::commands::telegram_update_bot_token,
        // Telegram commands — Messaging
        telegram::commands::telegram_send_message,
        telegram::commands::telegram_send_photo,
        telegram::commands::telegram_send_document,
        telegram::commands::telegram_send_video,
        telegram::commands::telegram_send_audio,
        telegram::commands::telegram_send_voice,
        telegram::commands::telegram_send_location,
        telegram::commands::telegram_send_contact,
        telegram::commands::telegram_send_poll,
        telegram::commands::telegram_send_dice,
        telegram::commands::telegram_send_sticker,
        telegram::commands::telegram_send_chat_action,
        // Telegram commands — Message management
        telegram::commands::telegram_edit_message_text,
        telegram::commands::telegram_edit_message_caption,
        telegram::commands::telegram_edit_message_reply_markup,
        telegram::commands::telegram_delete_message,
        telegram::commands::telegram_forward_message,
        telegram::commands::telegram_copy_message,
        telegram::commands::telegram_pin_message,
        telegram::commands::telegram_unpin_message,
        telegram::commands::telegram_unpin_all_messages,
        telegram::commands::telegram_answer_callback_query,
        // Telegram commands — Chat management
        telegram::commands::telegram_get_chat,
        telegram::commands::telegram_get_chat_member_count,
        telegram::commands::telegram_get_chat_member,
        telegram::commands::telegram_get_chat_administrators,
        telegram::commands::telegram_set_chat_title,
        telegram::commands::telegram_set_chat_description,
        telegram::commands::telegram_ban_chat_member,
        telegram::commands::telegram_unban_chat_member,
        telegram::commands::telegram_restrict_chat_member,
        telegram::commands::telegram_promote_chat_member,
        telegram::commands::telegram_leave_chat,
        telegram::commands::telegram_export_chat_invite_link,
        telegram::commands::telegram_create_invite_link,
        // Telegram commands — Files
        telegram::commands::telegram_get_file,
        telegram::commands::telegram_download_file,
        telegram::commands::telegram_upload_file,
        // Telegram commands — Webhooks & Updates
        telegram::commands::telegram_get_updates,
        telegram::commands::telegram_set_webhook,
        telegram::commands::telegram_delete_webhook,
        telegram::commands::telegram_get_webhook_info,
        // Telegram commands — Notification rules
        telegram::commands::telegram_add_notification_rule,
        telegram::commands::telegram_remove_notification_rule,
        telegram::commands::telegram_list_notification_rules,
        telegram::commands::telegram_set_notification_rule_enabled,
        telegram::commands::telegram_process_connection_event,
        // Telegram commands — Monitoring
        telegram::commands::telegram_add_monitoring_check,
        telegram::commands::telegram_remove_monitoring_check,
        telegram::commands::telegram_list_monitoring_checks,
        telegram::commands::telegram_set_monitoring_check_enabled,
        telegram::commands::telegram_monitoring_summary,
        telegram::commands::telegram_record_monitoring_result,
        // Telegram commands — Templates
        telegram::commands::telegram_add_template,
        telegram::commands::telegram_remove_template,
        telegram::commands::telegram_list_templates,
        telegram::commands::telegram_render_template,
        telegram::commands::telegram_validate_template_body,
        telegram::commands::telegram_send_template,
        // Telegram commands — Scheduled messages
        telegram::commands::telegram_schedule_message,
        telegram::commands::telegram_cancel_scheduled_message,
        telegram::commands::telegram_list_scheduled_messages,
        telegram::commands::telegram_process_scheduled_messages,
        // Telegram commands — Broadcast & Digests
        telegram::commands::telegram_broadcast,
        telegram::commands::telegram_add_digest,
        telegram::commands::telegram_remove_digest,
        telegram::commands::telegram_list_digests,
        // Telegram commands — Stats & Logs
        telegram::commands::telegram_stats,
        telegram::commands::telegram_message_log,
        telegram::commands::telegram_clear_message_log,
        telegram::commands::telegram_notification_history,
        telegram::commands::telegram_monitoring_history,
        // Dropbox commands — Configuration & Connection
        dropbox::commands::dropbox_configure,
        dropbox::commands::dropbox_set_token,
        dropbox::commands::dropbox_disconnect,
        dropbox::commands::dropbox_is_connected,
        dropbox::commands::dropbox_masked_token,
        // Dropbox commands — OAuth 2.0 PKCE
        dropbox::commands::dropbox_start_auth,
        dropbox::commands::dropbox_finish_auth,
        dropbox::commands::dropbox_refresh_token,
        dropbox::commands::dropbox_revoke_token,
        // Dropbox commands — File operations
        dropbox::commands::dropbox_upload,
        dropbox::commands::dropbox_download,
        dropbox::commands::dropbox_get_metadata,
        dropbox::commands::dropbox_move_file,
        dropbox::commands::dropbox_copy_file,
        dropbox::commands::dropbox_delete,
        dropbox::commands::dropbox_delete_batch,
        dropbox::commands::dropbox_move_batch,
        dropbox::commands::dropbox_copy_batch,
        dropbox::commands::dropbox_search,
        dropbox::commands::dropbox_search_continue,
        dropbox::commands::dropbox_list_revisions,
        dropbox::commands::dropbox_restore,
        dropbox::commands::dropbox_get_thumbnail,
        dropbox::commands::dropbox_content_hash,
        dropbox::commands::dropbox_guess_mime,
        dropbox::commands::dropbox_upload_session_start,
        dropbox::commands::dropbox_upload_session_append,
        dropbox::commands::dropbox_upload_session_finish,
        dropbox::commands::dropbox_check_job_status,
        // Dropbox commands — Folder operations
        dropbox::commands::dropbox_create_folder,
        dropbox::commands::dropbox_list_folder,
        dropbox::commands::dropbox_list_folder_continue,
        dropbox::commands::dropbox_get_latest_cursor,
        dropbox::commands::dropbox_create_folder_batch,
        dropbox::commands::dropbox_breadcrumbs,
        dropbox::commands::dropbox_parent_path,
        // Dropbox commands — Sharing
        dropbox::commands::dropbox_create_shared_link,
        dropbox::commands::dropbox_list_shared_links,
        dropbox::commands::dropbox_revoke_shared_link,
        dropbox::commands::dropbox_share_folder,
        dropbox::commands::dropbox_unshare_folder,
        dropbox::commands::dropbox_list_folder_members,
        dropbox::commands::dropbox_list_shared_folders,
        dropbox::commands::dropbox_mount_folder,
        dropbox::commands::dropbox_get_shared_link_metadata,
        dropbox::commands::dropbox_shared_link_to_direct,
        // Dropbox commands — Account
        dropbox::commands::dropbox_get_current_account,
        dropbox::commands::dropbox_get_space_usage,
        dropbox::commands::dropbox_format_space_usage,
        dropbox::commands::dropbox_is_space_critical,
        dropbox::commands::dropbox_get_account,
        dropbox::commands::dropbox_get_features,
        // Dropbox commands — Team
        dropbox::commands::dropbox_get_team_info,
        dropbox::commands::dropbox_team_members_list,
        dropbox::commands::dropbox_team_members_list_continue,
        dropbox::commands::dropbox_team_members_get_info,
        dropbox::commands::dropbox_team_member_suspend,
        dropbox::commands::dropbox_team_member_unsuspend,
        // Dropbox commands — Paper
        dropbox::commands::dropbox_paper_create,
        dropbox::commands::dropbox_paper_update,
        dropbox::commands::dropbox_paper_list,
        dropbox::commands::dropbox_paper_archive,
        // Dropbox commands — Sync manager
        dropbox::commands::dropbox_sync_create,
        dropbox::commands::dropbox_sync_remove,
        dropbox::commands::dropbox_sync_list,
        dropbox::commands::dropbox_sync_set_enabled,
        dropbox::commands::dropbox_sync_set_interval,
        dropbox::commands::dropbox_sync_set_exclude_patterns,
        // Dropbox commands — Backup manager
        dropbox::commands::dropbox_backup_create,
        dropbox::commands::dropbox_backup_remove,
        dropbox::commands::dropbox_backup_list,
        dropbox::commands::dropbox_backup_set_enabled,
        dropbox::commands::dropbox_backup_set_max_revisions,
        dropbox::commands::dropbox_backup_set_interval,
        dropbox::commands::dropbox_backup_get_history,
        dropbox::commands::dropbox_backup_total_size,
        // Dropbox commands — File watcher
        dropbox::commands::dropbox_watch_create,
        dropbox::commands::dropbox_watch_remove,
        dropbox::commands::dropbox_watch_list,
        dropbox::commands::dropbox_watch_set_enabled,

        dropbox::commands::dropbox_watch_get_changes,
        dropbox::commands::dropbox_watch_clear_changes,
        dropbox::commands::dropbox_watch_total_pending,
        // Dropbox commands — Activity & Stats
        dropbox::commands::dropbox_get_activity_log,
        dropbox::commands::dropbox_clear_activity_log,
        dropbox::commands::dropbox_get_stats,
        dropbox::commands::dropbox_reset_stats,
        // Dropbox commands — Longpoll
        dropbox::commands::dropbox_longpoll,
        // Nextcloud commands — Configuration & Connection
        nextcloud::commands::nextcloud_configure,
        nextcloud::commands::nextcloud_set_bearer_token,
        nextcloud::commands::nextcloud_configure_oauth2,
        nextcloud::commands::nextcloud_disconnect,
        nextcloud::commands::nextcloud_is_connected,
        nextcloud::commands::nextcloud_masked_credential,
        nextcloud::commands::nextcloud_get_server_url,
        nextcloud::commands::nextcloud_get_username,
        // Nextcloud commands — Login Flow v2
        nextcloud::commands::nextcloud_start_login_flow,
        nextcloud::commands::nextcloud_poll_login_flow,
        // Nextcloud commands — OAuth 2.0
        nextcloud::commands::nextcloud_start_oauth2,
        nextcloud::commands::nextcloud_exchange_oauth2_code,
        nextcloud::commands::nextcloud_refresh_oauth2_token,
        nextcloud::commands::nextcloud_validate_credentials,
        nextcloud::commands::nextcloud_revoke_app_password,
        // Nextcloud commands — File operations
        nextcloud::commands::nextcloud_upload,
        nextcloud::commands::nextcloud_download,
        nextcloud::commands::nextcloud_get_metadata,
        nextcloud::commands::nextcloud_move_file,
        nextcloud::commands::nextcloud_copy_file,
        nextcloud::commands::nextcloud_delete_file,
        nextcloud::commands::nextcloud_set_favorite,
        nextcloud::commands::nextcloud_set_tags,
        nextcloud::commands::nextcloud_list_versions,
        nextcloud::commands::nextcloud_restore_version,
        nextcloud::commands::nextcloud_list_trash,
        nextcloud::commands::nextcloud_restore_trash_item,
        nextcloud::commands::nextcloud_delete_trash_item,
        nextcloud::commands::nextcloud_empty_trash,
        nextcloud::commands::nextcloud_search,
        nextcloud::commands::nextcloud_content_hash,
        nextcloud::commands::nextcloud_guess_mime,
        nextcloud::commands::nextcloud_get_preview,
        // Nextcloud commands — Folder operations
        nextcloud::commands::nextcloud_create_folder,
        nextcloud::commands::nextcloud_create_folder_recursive,
        nextcloud::commands::nextcloud_list_folder,
        nextcloud::commands::nextcloud_list_files,
        nextcloud::commands::nextcloud_list_subfolders,
        nextcloud::commands::nextcloud_list_folder_recursive,
        nextcloud::commands::nextcloud_breadcrumbs,
        nextcloud::commands::nextcloud_parent_path,
        nextcloud::commands::nextcloud_join_path,
        nextcloud::commands::nextcloud_filename,
        // Nextcloud commands — Sharing (OCS)
        nextcloud::commands::nextcloud_create_share,
        nextcloud::commands::nextcloud_create_public_link,
        nextcloud::commands::nextcloud_list_shares,
        nextcloud::commands::nextcloud_list_shares_for_path,
        nextcloud::commands::nextcloud_list_shared_with_me,
        nextcloud::commands::nextcloud_list_pending_shares,
        nextcloud::commands::nextcloud_get_share,
        nextcloud::commands::nextcloud_update_share,
        nextcloud::commands::nextcloud_delete_share,
        nextcloud::commands::nextcloud_accept_remote_share,
        nextcloud::commands::nextcloud_decline_remote_share,
        nextcloud::commands::nextcloud_share_url,
        nextcloud::commands::nextcloud_share_download_url,
        // Nextcloud commands — Users & Capabilities
        nextcloud::commands::nextcloud_get_current_user,
        nextcloud::commands::nextcloud_get_quota,
        nextcloud::commands::nextcloud_get_user,
        nextcloud::commands::nextcloud_list_users,
        nextcloud::commands::nextcloud_list_groups,
        nextcloud::commands::nextcloud_get_capabilities,
        nextcloud::commands::nextcloud_get_server_status,
        nextcloud::commands::nextcloud_list_notifications,
        nextcloud::commands::nextcloud_delete_notification,
        nextcloud::commands::nextcloud_delete_all_notifications,
        nextcloud::commands::nextcloud_list_external_storages,
        nextcloud::commands::nextcloud_avatar_url,
        nextcloud::commands::nextcloud_get_avatar,
        nextcloud::commands::nextcloud_format_bytes,
        nextcloud::commands::nextcloud_format_quota,
        // Nextcloud commands — Activity Feed
        nextcloud::commands::nextcloud_list_activities,
        nextcloud::commands::nextcloud_activities_for_file,
        nextcloud::commands::nextcloud_recent_activities,
        nextcloud::commands::nextcloud_list_activity_filters,
        // Nextcloud commands — Sync manager
        nextcloud::commands::nextcloud_sync_add,
        nextcloud::commands::nextcloud_sync_remove,
        nextcloud::commands::nextcloud_sync_list,
        nextcloud::commands::nextcloud_sync_set_enabled,
        nextcloud::commands::nextcloud_sync_set_interval,
        nextcloud::commands::nextcloud_sync_set_exclude_patterns,
        // Nextcloud commands — Backup manager
        nextcloud::commands::nextcloud_backup_add,
        nextcloud::commands::nextcloud_backup_remove,
        nextcloud::commands::nextcloud_backup_list,
        nextcloud::commands::nextcloud_backup_set_enabled,
        nextcloud::commands::nextcloud_backup_set_max_versions,
        nextcloud::commands::nextcloud_backup_set_interval,
        nextcloud::commands::nextcloud_backup_get_history,
        nextcloud::commands::nextcloud_backup_total_size,
        // Nextcloud commands — File watcher
        nextcloud::commands::nextcloud_watch_add,
        nextcloud::commands::nextcloud_watch_remove,
        nextcloud::commands::nextcloud_watch_list,
        nextcloud::commands::nextcloud_watch_set_enabled,
        nextcloud::commands::nextcloud_watch_get_changes,
        nextcloud::commands::nextcloud_watch_clear_changes,
        nextcloud::commands::nextcloud_watch_total_pending,
        // Nextcloud commands — Activity Log & Stats
        nextcloud::commands::nextcloud_get_activity_log,
        nextcloud::commands::nextcloud_clear_activity_log,
        nextcloud::commands::nextcloud_get_stats,
        nextcloud::commands::nextcloud_reset_stats,
        // Google Drive commands — Auth & Configuration
        gdrive::commands::gdrive_set_credentials,
        gdrive::commands::gdrive_get_auth_url,
        gdrive::commands::gdrive_exchange_code,
        gdrive::commands::gdrive_refresh_token,
        gdrive::commands::gdrive_set_token,
        gdrive::commands::gdrive_get_token,
        gdrive::commands::gdrive_revoke,
        gdrive::commands::gdrive_is_authenticated,
        gdrive::commands::gdrive_connection_summary,
        gdrive::commands::gdrive_get_about,
        // Google Drive commands — Files
        gdrive::commands::gdrive_get_file,
        gdrive::commands::gdrive_list_files,
        gdrive::commands::gdrive_create_file,
        gdrive::commands::gdrive_update_file,
        gdrive::commands::gdrive_copy_file,
        gdrive::commands::gdrive_delete_file,
        gdrive::commands::gdrive_trash_file,
        gdrive::commands::gdrive_untrash_file,
        gdrive::commands::gdrive_empty_trash,
        gdrive::commands::gdrive_star_file,
        gdrive::commands::gdrive_rename_file,
        gdrive::commands::gdrive_move_file,
        gdrive::commands::gdrive_generate_ids,
        // Google Drive commands — Folders
        gdrive::commands::gdrive_create_folder,
        gdrive::commands::gdrive_list_children,
        gdrive::commands::gdrive_list_subfolders,
        gdrive::commands::gdrive_find_folder,
        // Google Drive commands — Upload & Download
        gdrive::commands::gdrive_upload_file,
        gdrive::commands::gdrive_download_file,
        gdrive::commands::gdrive_export_file,
        // Google Drive commands — Sharing
        gdrive::commands::gdrive_share_with_user,
        gdrive::commands::gdrive_share_with_anyone,
        gdrive::commands::gdrive_list_permissions,
        gdrive::commands::gdrive_delete_permission,
        gdrive::commands::gdrive_unshare_all,
        // Google Drive commands — Revisions
        gdrive::commands::gdrive_list_revisions,
        gdrive::commands::gdrive_pin_revision,
        // Google Drive commands — Comments
        gdrive::commands::gdrive_list_comments,
        gdrive::commands::gdrive_create_comment,
        gdrive::commands::gdrive_resolve_comment,
        gdrive::commands::gdrive_create_reply,
        // Google Drive commands — Shared Drives
        gdrive::commands::gdrive_list_drives,
        gdrive::commands::gdrive_create_drive,
        gdrive::commands::gdrive_delete_drive,
        // Google Drive commands — Changes
        gdrive::commands::gdrive_get_start_page_token,
        gdrive::commands::gdrive_poll_changes,
        // Google Drive commands — Search
        gdrive::commands::gdrive_search,
        // ── Recording engine commands ────────────────────────────────
        // Config
        recording::commands::rec_get_config,
        recording::commands::rec_update_config,
        // Terminal recording (SSH, Telnet, etc.)
        recording::commands::rec_start_terminal,
        recording::commands::rec_stop_terminal,
        recording::commands::rec_terminal_status,
        recording::commands::rec_is_terminal_recording,
        recording::commands::rec_append_terminal_output,
        recording::commands::rec_append_terminal_input,
        recording::commands::rec_append_terminal_resize,
        // Screen recording (RDP, VNC)
        recording::commands::rec_start_screen,
        recording::commands::rec_stop_screen,
        recording::commands::rec_screen_status,
        recording::commands::rec_is_screen_recording,
        recording::commands::rec_append_screen_frame,
        // HTTP / HAR recording
        recording::commands::rec_start_http,
        recording::commands::rec_stop_http,
        recording::commands::rec_http_status,
        recording::commands::rec_is_http_recording,
        recording::commands::rec_append_http_entry,
        // Telnet recording
        recording::commands::rec_start_telnet,
        recording::commands::rec_stop_telnet,
        recording::commands::rec_telnet_status,
        recording::commands::rec_is_telnet_recording,
        recording::commands::rec_append_telnet_entry,
        // Serial recording
        recording::commands::rec_start_serial,
        recording::commands::rec_stop_serial,
        recording::commands::rec_serial_status,
        recording::commands::rec_is_serial_recording,
        recording::commands::rec_append_serial_entry,
        // Database query recording
        recording::commands::rec_start_db,
        recording::commands::rec_stop_db,
        recording::commands::rec_db_status,
        recording::commands::rec_is_db_recording,
        recording::commands::rec_append_db_entry,
        // Macro recording & CRUD
        recording::commands::rec_start_macro,
        recording::commands::rec_macro_input,
        recording::commands::rec_stop_macro,
        recording::commands::rec_is_macro_recording,
        recording::commands::rec_list_macros,
        recording::commands::rec_get_macro,
        recording::commands::rec_update_macro,
        recording::commands::rec_delete_macro,
        recording::commands::rec_import_macro,
        // Encoding
        recording::commands::rec_encode_asciicast,
        recording::commands::rec_encode_script,
        recording::commands::rec_encode_har,
        recording::commands::rec_encode_db_csv,
        recording::commands::rec_encode_http_csv,
        recording::commands::rec_encode_telnet_asciicast,
        recording::commands::rec_encode_serial_raw,
        recording::commands::rec_encode_frame_manifest,
        // Compression
        recording::commands::rec_compress,
        recording::commands::rec_decompress,
        // Combined encode + compress + save
        recording::commands::rec_save_terminal,
        recording::commands::rec_save_http,
        recording::commands::rec_save_screen,
        // Library
        recording::commands::rec_library_list,
        recording::commands::rec_library_get,
        recording::commands::rec_library_by_protocol,
        recording::commands::rec_library_search,
        recording::commands::rec_library_rename,
        recording::commands::rec_library_update_tags,
        recording::commands::rec_library_delete,
        recording::commands::rec_library_clear,
        recording::commands::rec_library_summary,
        // Aggregate / status
        recording::commands::rec_list_active,
        recording::commands::rec_active_count,
        recording::commands::rec_stop_all,
        // Jobs
        recording::commands::rec_list_jobs,
        recording::commands::rec_get_job,
        recording::commands::rec_clear_jobs,
        // Cleanup & storage
        recording::commands::rec_run_cleanup,
        recording::commands::rec_storage_size,
        // LLM backend commands
        llm::commands::llm_add_provider,
        llm::commands::llm_remove_provider,
        llm::commands::llm_update_provider,
        llm::commands::llm_list_providers,
        llm::commands::llm_set_default_provider,
        llm::commands::llm_chat_completion,
        llm::commands::llm_create_embedding,
        llm::commands::llm_list_models,
        llm::commands::llm_models_for_provider,
        llm::commands::llm_model_info,
        llm::commands::llm_health_check,
        llm::commands::llm_health_check_all,
        llm::commands::llm_usage_summary,
        llm::commands::llm_cache_stats,
        llm::commands::llm_clear_cache,
        llm::commands::llm_status,
        llm::commands::llm_get_config,
        llm::commands::llm_update_config,
        llm::commands::llm_set_balancer_strategy,
        llm::commands::llm_estimate_tokens,
        // AI Assist commands
        ai_assist::commands::ai_assist_create_session,
        ai_assist::commands::ai_assist_remove_session,
        ai_assist::commands::ai_assist_list_sessions,
        ai_assist::commands::ai_assist_update_context,
        ai_assist::commands::ai_assist_record_command,
        ai_assist::commands::ai_assist_set_tools,
        ai_assist::commands::ai_assist_complete,
        ai_assist::commands::ai_assist_explain_error,
        ai_assist::commands::ai_assist_lookup_command,
        ai_assist::commands::ai_assist_search_commands,
        ai_assist::commands::ai_assist_translate,
        ai_assist::commands::ai_assist_assess_risk,
        ai_assist::commands::ai_assist_quick_risk,
        ai_assist::commands::ai_assist_list_snippets,
        ai_assist::commands::ai_assist_search_snippets,
        ai_assist::commands::ai_assist_get_snippet,
        ai_assist::commands::ai_assist_render_snippet,
        ai_assist::commands::ai_assist_add_snippet,
        ai_assist::commands::ai_assist_remove_snippet,
        ai_assist::commands::ai_assist_analyze_history,
        ai_assist::commands::ai_assist_get_config,
        ai_assist::commands::ai_assist_update_config,
        // Command Palette commands
        command_palette::commands::palette_search,
        command_palette::commands::palette_record_command,
        command_palette::commands::palette_search_history,
        command_palette::commands::palette_get_history,
        command_palette::commands::palette_pin_command,
        command_palette::commands::palette_tag_command,
        command_palette::commands::palette_remove_history,
        command_palette::commands::palette_clear_history,
        command_palette::commands::palette_add_snippet,
        command_palette::commands::palette_get_snippet,
        command_palette::commands::palette_update_snippet,
        command_palette::commands::palette_remove_snippet,
        command_palette::commands::palette_list_snippets,
        command_palette::commands::palette_search_snippets,
        command_palette::commands::palette_render_snippet,
        command_palette::commands::palette_import_snippets,
        command_palette::commands::palette_export_snippets,
        command_palette::commands::palette_add_alias,
        command_palette::commands::palette_remove_alias,
        command_palette::commands::palette_list_aliases,
        command_palette::commands::palette_get_config,
        command_palette::commands::palette_update_config,
        command_palette::commands::palette_get_stats,
        command_palette::commands::palette_save,
        command_palette::commands::palette_export,
        command_palette::commands::palette_import,
        // Extended palette import/export commands
        command_palette::commands::palette_export_advanced,
        command_palette::commands::palette_export_history,
        command_palette::commands::palette_export_snippets_filtered,
        command_palette::commands::palette_validate_import,
        command_palette::commands::palette_validate_import_file,
        command_palette::commands::palette_preview_import,
        command_palette::commands::palette_preview_import_file,
        command_palette::commands::palette_import_advanced,
        command_palette::commands::palette_import_file_advanced,
        command_palette::commands::palette_create_share_package,
        command_palette::commands::palette_import_share_package,
        command_palette::commands::palette_export_clipboard,
        command_palette::commands::palette_import_clipboard,
        command_palette::commands::palette_save_share_package,
        command_palette::commands::palette_import_share_package_file,
        command_palette::commands::palette_get_snapshot_stats,
        // OS classification commands
        command_palette::commands::palette_list_os_families,
        command_palette::commands::palette_list_os_distros,
        command_palette::commands::palette_snippets_by_os,
        command_palette::commands::palette_snippets_by_os_family,
        command_palette::commands::palette_snippets_universal,
        command_palette::commands::palette_set_snippet_os_target,
        command_palette::commands::palette_set_alias_os_target,
        // Font management commands
        fonts::commands::fonts_list_all,
        fonts::commands::fonts_by_category,
        fonts::commands::fonts_get,
        fonts::commands::fonts_search,
        fonts::commands::fonts_list_monospace,
        fonts::commands::fonts_list_with_ligatures,
        fonts::commands::fonts_list_with_nerd_font,
        fonts::commands::fonts_get_stats,
        fonts::commands::fonts_list_stacks,
        fonts::commands::fonts_get_stack,
        fonts::commands::fonts_create_stack,
        fonts::commands::fonts_delete_stack,
        fonts::commands::fonts_get_config,
        fonts::commands::fonts_update_ssh_terminal,
        fonts::commands::fonts_update_app_ui,
        fonts::commands::fonts_update_code_editor,
        fonts::commands::fonts_update_tab_bar,
        fonts::commands::fonts_update_log_viewer,
        fonts::commands::fonts_set_connection_override,
        fonts::commands::fonts_remove_connection_override,
        fonts::commands::fonts_resolve_connection,
        fonts::commands::fonts_add_favourite,
        fonts::commands::fonts_remove_favourite,
        fonts::commands::fonts_get_favourites,
        fonts::commands::fonts_get_recent,
        fonts::commands::fonts_record_recent,
        fonts::commands::fonts_list_presets,
        fonts::commands::fonts_apply_preset,
        fonts::commands::fonts_detect_system,
        fonts::commands::fonts_detect_system_monospace,
        fonts::commands::fonts_resolve_css,
        fonts::commands::fonts_resolve_settings_css,
        fonts::commands::fonts_save,
        fonts::commands::fonts_export,
        fonts::commands::fonts_import,
        // Secure Clipboard commands
        secure_clip::commands::secure_clip_copy,
        secure_clip::commands::secure_clip_copy_password,
        secure_clip::commands::secure_clip_copy_totp,
        secure_clip::commands::secure_clip_copy_username,
        secure_clip::commands::secure_clip_copy_passphrase,
        secure_clip::commands::secure_clip_copy_api_key,
        secure_clip::commands::secure_clip_paste,
        secure_clip::commands::secure_clip_paste_by_id,
        secure_clip::commands::secure_clip_paste_to_terminal,
        secure_clip::commands::secure_clip_record_terminal_paste,
        secure_clip::commands::secure_clip_clear,
        secure_clip::commands::secure_clip_on_app_lock,
        secure_clip::commands::secure_clip_on_app_exit,
        secure_clip::commands::secure_clip_get_current,
        secure_clip::commands::secure_clip_has_entry,
        secure_clip::commands::secure_clip_get_stats,
        secure_clip::commands::secure_clip_get_history,
        secure_clip::commands::secure_clip_get_history_for_connection,
        secure_clip::commands::secure_clip_clear_history,
        secure_clip::commands::secure_clip_get_config,
        secure_clip::commands::secure_clip_update_config,
        secure_clip::commands::secure_clip_read_os_clipboard,
        // Terminal Themes commands
        terminal_themes::commands::terminal_themes_list,
        terminal_themes::commands::terminal_themes_list_dark,
        terminal_themes::commands::terminal_themes_list_light,
        terminal_themes::commands::terminal_themes_list_by_category,
        terminal_themes::commands::terminal_themes_search,
        terminal_themes::commands::terminal_themes_get,
        terminal_themes::commands::terminal_themes_get_active,
        terminal_themes::commands::terminal_themes_get_active_id,
        terminal_themes::commands::terminal_themes_get_session_theme,
        terminal_themes::commands::terminal_themes_get_xterm,
        terminal_themes::commands::terminal_themes_get_css_vars,
        terminal_themes::commands::terminal_themes_recent,
        terminal_themes::commands::terminal_themes_count,
        terminal_themes::commands::terminal_themes_set_active,
        terminal_themes::commands::terminal_themes_set_session,
        terminal_themes::commands::terminal_themes_clear_session,
        terminal_themes::commands::terminal_themes_register,
        terminal_themes::commands::terminal_themes_update,
        terminal_themes::commands::terminal_themes_remove,
        terminal_themes::commands::terminal_themes_duplicate,
        terminal_themes::commands::terminal_themes_create_custom,
        terminal_themes::commands::terminal_themes_derive_hue,
        terminal_themes::commands::terminal_themes_generate_from_accent,
        terminal_themes::commands::terminal_themes_export_json,
        terminal_themes::commands::terminal_themes_export_iterm2,
        terminal_themes::commands::terminal_themes_export_windows_terminal,
        terminal_themes::commands::terminal_themes_export_alacritty,
        terminal_themes::commands::terminal_themes_export_xterm,
        terminal_themes::commands::terminal_themes_import,
        terminal_themes::commands::terminal_themes_check_contrast,
        terminal_themes::commands::terminal_themes_blend_colors,
        terminal_themes::commands::terminal_themes_validate,

        // Extensions engine commands
        extensions::commands::ext_install,
        extensions::commands::ext_install_with_manifest,
        extensions::commands::ext_enable,
        extensions::commands::ext_disable,
        extensions::commands::ext_uninstall,
        extensions::commands::ext_update,
        extensions::commands::ext_execute_handler,
        extensions::commands::ext_dispatch_event,
        extensions::commands::ext_storage_get,
        extensions::commands::ext_storage_set,
        extensions::commands::ext_storage_delete,
        extensions::commands::ext_storage_list_keys,
        extensions::commands::ext_storage_clear,
        extensions::commands::ext_storage_export,
        extensions::commands::ext_storage_import,
        extensions::commands::ext_storage_summary,
        extensions::commands::ext_get_setting,
        extensions::commands::ext_set_setting,
        extensions::commands::ext_get_extension,
        extensions::commands::ext_list_extensions,
        extensions::commands::ext_engine_stats,
        extensions::commands::ext_validate_manifest,
        extensions::commands::ext_create_manifest_template,
        extensions::commands::ext_api_documentation,
        extensions::commands::ext_permission_groups,
        extensions::commands::ext_get_config,
        extensions::commands::ext_update_config,
        extensions::commands::ext_audit_log,
        extensions::commands::ext_dispatch_log,
        // ── Kubernetes commands ──────────────────────────────────────────
        k8s::commands::k8s_connect,
        k8s::commands::k8s_connect_kubeconfig,
        k8s::commands::k8s_disconnect,
        k8s::commands::k8s_list_connections,
        k8s::commands::k8s_kubeconfig_default_path,
        k8s::commands::k8s_kubeconfig_load,
        k8s::commands::k8s_kubeconfig_parse,
        k8s::commands::k8s_kubeconfig_list_contexts,
        k8s::commands::k8s_kubeconfig_validate,
        k8s::commands::k8s_cluster_info,
        k8s::commands::k8s_health_check,
        k8s::commands::k8s_list_namespaces,
        k8s::commands::k8s_get_namespace,
        k8s::commands::k8s_create_namespace,
        k8s::commands::k8s_delete_namespace,
        k8s::commands::k8s_update_namespace_labels,
        k8s::commands::k8s_list_resource_quotas,
        k8s::commands::k8s_get_resource_quota,
        k8s::commands::k8s_create_resource_quota,
        k8s::commands::k8s_delete_resource_quota,
        k8s::commands::k8s_list_limit_ranges,
        k8s::commands::k8s_list_pods,
        k8s::commands::k8s_list_all_pods,
        k8s::commands::k8s_get_pod,
        k8s::commands::k8s_create_pod,
        k8s::commands::k8s_delete_pod,
        k8s::commands::k8s_pod_logs,
        k8s::commands::k8s_evict_pod,
        k8s::commands::k8s_update_pod_labels,
        k8s::commands::k8s_update_pod_annotations,
        k8s::commands::k8s_list_deployments,
        k8s::commands::k8s_list_all_deployments,
        k8s::commands::k8s_get_deployment,
        k8s::commands::k8s_create_deployment,
        k8s::commands::k8s_update_deployment,
        k8s::commands::k8s_patch_deployment,
        k8s::commands::k8s_delete_deployment,
        k8s::commands::k8s_scale_deployment,
        k8s::commands::k8s_restart_deployment,
        k8s::commands::k8s_pause_deployment,
        k8s::commands::k8s_resume_deployment,
        k8s::commands::k8s_set_deployment_image,
        k8s::commands::k8s_deployment_rollout_status,
        k8s::commands::k8s_rollback_deployment,
        k8s::commands::k8s_list_statefulsets,
        k8s::commands::k8s_list_daemonsets,
        k8s::commands::k8s_list_replicasets,
        k8s::commands::k8s_list_services,
        k8s::commands::k8s_list_all_services,
        k8s::commands::k8s_get_service,
        k8s::commands::k8s_create_service,
        k8s::commands::k8s_update_service,
        k8s::commands::k8s_patch_service,
        k8s::commands::k8s_delete_service,
        k8s::commands::k8s_get_endpoints,
        k8s::commands::k8s_list_configmaps,
        k8s::commands::k8s_get_configmap,
        k8s::commands::k8s_create_configmap,
        k8s::commands::k8s_update_configmap,
        k8s::commands::k8s_patch_configmap,
        k8s::commands::k8s_delete_configmap,
        k8s::commands::k8s_list_secrets,
        k8s::commands::k8s_get_secret,
        k8s::commands::k8s_create_secret,
        k8s::commands::k8s_update_secret,
        k8s::commands::k8s_patch_secret,
        k8s::commands::k8s_delete_secret,
        k8s::commands::k8s_list_ingresses,
        k8s::commands::k8s_get_ingress,
        k8s::commands::k8s_create_ingress,
        k8s::commands::k8s_update_ingress,
        k8s::commands::k8s_delete_ingress,
        k8s::commands::k8s_list_ingress_classes,
        k8s::commands::k8s_list_network_policies,
        k8s::commands::k8s_get_network_policy,
        k8s::commands::k8s_create_network_policy,
        k8s::commands::k8s_delete_network_policy,
        k8s::commands::k8s_list_jobs,
        k8s::commands::k8s_get_job,
        k8s::commands::k8s_create_job,
        k8s::commands::k8s_delete_job,
        k8s::commands::k8s_suspend_job,
        k8s::commands::k8s_resume_job,
        k8s::commands::k8s_list_cronjobs,
        k8s::commands::k8s_get_cronjob,
        k8s::commands::k8s_create_cronjob,
        k8s::commands::k8s_delete_cronjob,
        k8s::commands::k8s_suspend_cronjob,
        k8s::commands::k8s_resume_cronjob,
        k8s::commands::k8s_trigger_cronjob,
        k8s::commands::k8s_list_nodes,
        k8s::commands::k8s_get_node,
        k8s::commands::k8s_cordon_node,
        k8s::commands::k8s_uncordon_node,
        k8s::commands::k8s_drain_node,
        k8s::commands::k8s_add_node_taint,
        k8s::commands::k8s_remove_node_taint,
        k8s::commands::k8s_update_node_labels,
        k8s::commands::k8s_list_persistent_volumes,
        k8s::commands::k8s_list_pvcs,
        k8s::commands::k8s_list_storage_classes,
        k8s::commands::k8s_list_roles,
        k8s::commands::k8s_list_cluster_roles,
        k8s::commands::k8s_list_role_bindings,
        k8s::commands::k8s_list_cluster_role_bindings,
        k8s::commands::k8s_list_service_accounts,
        k8s::commands::k8s_create_service_account_token,
        k8s::commands::k8s_helm_is_available,
        k8s::commands::k8s_helm_version,
        k8s::commands::k8s_helm_list_releases,
        k8s::commands::k8s_helm_get_release,
        k8s::commands::k8s_helm_release_history,
        k8s::commands::k8s_helm_install,
        k8s::commands::k8s_helm_upgrade,
        k8s::commands::k8s_helm_rollback,
        k8s::commands::k8s_helm_uninstall,
        k8s::commands::k8s_helm_get_values,
        k8s::commands::k8s_helm_get_manifest,
        k8s::commands::k8s_helm_template,
        k8s::commands::k8s_helm_list_repos,
        k8s::commands::k8s_helm_add_repo,
        k8s::commands::k8s_helm_remove_repo,
        k8s::commands::k8s_helm_update_repos,
        k8s::commands::k8s_helm_search_charts,
        k8s::commands::k8s_list_events,
        k8s::commands::k8s_list_all_events,
        k8s::commands::k8s_list_events_for_resource,
        k8s::commands::k8s_filter_events,
        k8s::commands::k8s_list_warnings,
        k8s::commands::k8s_list_crds,
        k8s::commands::k8s_get_crd,
        k8s::commands::k8s_list_hpas,
        k8s::commands::k8s_get_hpa,
        k8s::commands::k8s_metrics_available,
        k8s::commands::k8s_node_metrics,
        k8s::commands::k8s_pod_metrics,
        k8s::commands::k8s_cluster_resource_summary,
        // ── Docker commands ──────────────────────────────────────────────
        docker::commands::docker_connect,
        docker::commands::docker_disconnect,
        docker::commands::docker_list_connections,
        docker::commands::docker_system_info,
        docker::commands::docker_system_version,
        docker::commands::docker_ping,
        docker::commands::docker_disk_usage,
        docker::commands::docker_system_events,
        docker::commands::docker_system_prune,
        docker::commands::docker_list_containers,
        docker::commands::docker_inspect_container,
        docker::commands::docker_create_container,
        docker::commands::docker_run_container,
        docker::commands::docker_start_container,
        docker::commands::docker_stop_container,
        docker::commands::docker_restart_container,
        docker::commands::docker_kill_container,
        docker::commands::docker_pause_container,
        docker::commands::docker_unpause_container,
        docker::commands::docker_remove_container,
        docker::commands::docker_rename_container,
        docker::commands::docker_container_logs,
        docker::commands::docker_container_stats,
        docker::commands::docker_container_top,
        docker::commands::docker_container_changes,
        docker::commands::docker_container_wait,
        docker::commands::docker_container_exec,
        docker::commands::docker_container_update,
        docker::commands::docker_prune_containers,
        docker::commands::docker_list_images,
        docker::commands::docker_inspect_image,
        docker::commands::docker_image_history,
        docker::commands::docker_pull_image,
        docker::commands::docker_tag_image,
        docker::commands::docker_push_image,
        docker::commands::docker_remove_image,
        docker::commands::docker_search_images,
        docker::commands::docker_prune_images,
        docker::commands::docker_commit_container,
        docker::commands::docker_list_volumes,
        docker::commands::docker_inspect_volume,
        docker::commands::docker_create_volume,
        docker::commands::docker_remove_volume,
        docker::commands::docker_prune_volumes,
        docker::commands::docker_list_networks,
        docker::commands::docker_inspect_network,
        docker::commands::docker_create_network,
        docker::commands::docker_remove_network,
        docker::commands::docker_connect_network,
        docker::commands::docker_disconnect_network,
        docker::commands::docker_prune_networks,
        docker::commands::docker_compose_is_available,
        docker::commands::docker_compose_version,
        docker::commands::docker_compose_list_projects,
        docker::commands::docker_compose_up,
        docker::commands::docker_compose_down,
        docker::commands::docker_compose_ps,
        docker::commands::docker_compose_logs,
        docker::commands::docker_compose_build,
        docker::commands::docker_compose_pull,
        docker::commands::docker_compose_restart,
        docker::commands::docker_compose_stop,
        docker::commands::docker_compose_start,
        docker::commands::docker_compose_config,
        docker::commands::docker_registry_login,
        docker::commands::docker_registry_search,
        // Ansible commands
        ansible::commands::ansible_connect,
        ansible::commands::ansible_disconnect,
        ansible::commands::ansible_list_connections,
        ansible::commands::ansible_is_available,
        ansible::commands::ansible_get_info,
        ansible::commands::ansible_inventory_parse,
        ansible::commands::ansible_inventory_graph,
        ansible::commands::ansible_inventory_list_hosts,
        ansible::commands::ansible_inventory_host_vars,
        ansible::commands::ansible_inventory_add_host,
        ansible::commands::ansible_inventory_remove_host,
        ansible::commands::ansible_inventory_add_group,
        ansible::commands::ansible_inventory_remove_group,
        ansible::commands::ansible_inventory_dynamic,
        ansible::commands::ansible_playbook_parse,
        ansible::commands::ansible_playbook_list,
        ansible::commands::ansible_playbook_syntax_check,
        ansible::commands::ansible_playbook_lint,
        ansible::commands::ansible_playbook_run,
        ansible::commands::ansible_playbook_check,
        ansible::commands::ansible_playbook_diff,
        ansible::commands::ansible_adhoc_run,
        ansible::commands::ansible_adhoc_ping,
        ansible::commands::ansible_adhoc_shell,
        ansible::commands::ansible_adhoc_copy,
        ansible::commands::ansible_adhoc_service,
        ansible::commands::ansible_adhoc_package,
        ansible::commands::ansible_roles_list,
        ansible::commands::ansible_role_inspect,
        ansible::commands::ansible_role_init,
        ansible::commands::ansible_role_dependencies,
        ansible::commands::ansible_role_install_deps,
        ansible::commands::ansible_vault_encrypt,
        ansible::commands::ansible_vault_decrypt,
        ansible::commands::ansible_vault_view,
        ansible::commands::ansible_vault_rekey,
        ansible::commands::ansible_vault_encrypt_string,
        ansible::commands::ansible_vault_is_encrypted,
        ansible::commands::ansible_galaxy_install_role,
        ansible::commands::ansible_galaxy_list_roles,
        ansible::commands::ansible_galaxy_remove_role,
        ansible::commands::ansible_galaxy_install_collection,
        ansible::commands::ansible_galaxy_list_collections,
        ansible::commands::ansible_galaxy_remove_collection,
        ansible::commands::ansible_galaxy_search,
        ansible::commands::ansible_galaxy_role_info,
        ansible::commands::ansible_galaxy_install_requirements,
        ansible::commands::ansible_facts_gather,
        ansible::commands::ansible_facts_gather_min,
        ansible::commands::ansible_config_dump,
        ansible::commands::ansible_config_get,
        ansible::commands::ansible_config_parse_file,
        ansible::commands::ansible_config_detect_path,
        ansible::commands::ansible_list_modules,
        ansible::commands::ansible_module_doc,
        ansible::commands::ansible_module_examples,
        ansible::commands::ansible_list_plugins,
        ansible::commands::ansible_history_list,
        ansible::commands::ansible_history_get,
        ansible::commands::ansible_history_clear,
        // Terraform commands
        terraform::commands::terraform_connect,
        terraform::commands::terraform_disconnect,
        terraform::commands::terraform_list_connections,
        terraform::commands::terraform_is_available,
        terraform::commands::terraform_get_info,
        terraform::commands::terraform_init,
        terraform::commands::terraform_init_no_backend,
        terraform::commands::terraform_plan,
        terraform::commands::terraform_show_plan_json,
        terraform::commands::terraform_show_plan_text,
        terraform::commands::terraform_apply,
        terraform::commands::terraform_destroy,
        terraform::commands::terraform_refresh,
        terraform::commands::terraform_state_list,
        terraform::commands::terraform_state_show,
        terraform::commands::terraform_state_show_json,
        terraform::commands::terraform_state_pull,
        terraform::commands::terraform_state_push,
        terraform::commands::terraform_state_mv,
        terraform::commands::terraform_state_rm,
        terraform::commands::terraform_state_import,
        terraform::commands::terraform_state_taint,
        terraform::commands::terraform_state_untaint,
        terraform::commands::terraform_state_force_unlock,
        terraform::commands::terraform_workspace_list,
        terraform::commands::terraform_workspace_show,
        terraform::commands::terraform_workspace_new,
        terraform::commands::terraform_workspace_select,
        terraform::commands::terraform_workspace_delete,
        terraform::commands::terraform_validate,
        terraform::commands::terraform_fmt,
        terraform::commands::terraform_fmt_check,
        terraform::commands::terraform_output_list,
        terraform::commands::terraform_output_get,
        terraform::commands::terraform_output_get_raw,
        terraform::commands::terraform_providers_list,
        terraform::commands::terraform_providers_schemas,
        terraform::commands::terraform_providers_lock,
        terraform::commands::terraform_providers_mirror,
        terraform::commands::terraform_providers_parse_lock_file,
        terraform::commands::terraform_modules_get,
        terraform::commands::terraform_modules_list_installed,
        terraform::commands::terraform_modules_search_registry,
        terraform::commands::terraform_graph_generate,
        terraform::commands::terraform_graph_plan,
        terraform::commands::terraform_hcl_analyse,
        terraform::commands::terraform_hcl_analyse_file,
        terraform::commands::terraform_hcl_summarise,
        terraform::commands::terraform_drift_detect,
        terraform::commands::terraform_drift_has_drift,
        terraform::commands::terraform_drift_compare_snapshots,
        terraform::commands::terraform_history_list,
        terraform::commands::terraform_history_get,
        terraform::commands::terraform_history_clear,
        // Budibase commands
        budibase::commands::budibase_connect,
        budibase::commands::budibase_disconnect,
        budibase::commands::budibase_list_connections,
        budibase::commands::budibase_ping,
        budibase::commands::budibase_set_app_context,
        budibase::commands::budibase_list_apps,
        budibase::commands::budibase_search_apps,
        budibase::commands::budibase_get_app,
        budibase::commands::budibase_create_app,
        budibase::commands::budibase_update_app,
        budibase::commands::budibase_delete_app,
        budibase::commands::budibase_publish_app,
        budibase::commands::budibase_unpublish_app,
        budibase::commands::budibase_list_tables,
        budibase::commands::budibase_get_table,
        budibase::commands::budibase_create_table,
        budibase::commands::budibase_update_table,
        budibase::commands::budibase_delete_table,
        budibase::commands::budibase_get_table_schema,
        budibase::commands::budibase_list_rows,
        budibase::commands::budibase_search_rows,
        budibase::commands::budibase_get_row,
        budibase::commands::budibase_create_row,
        budibase::commands::budibase_update_row,
        budibase::commands::budibase_delete_row,
        budibase::commands::budibase_bulk_create_rows,
        budibase::commands::budibase_bulk_delete_rows,
        budibase::commands::budibase_list_views,
        budibase::commands::budibase_get_view,
        budibase::commands::budibase_create_view,
        budibase::commands::budibase_update_view,
        budibase::commands::budibase_delete_view,
        budibase::commands::budibase_query_view,
        budibase::commands::budibase_list_users,
        budibase::commands::budibase_search_users,
        budibase::commands::budibase_get_user,
        budibase::commands::budibase_create_user,
        budibase::commands::budibase_update_user,
        budibase::commands::budibase_delete_user,
        budibase::commands::budibase_list_queries,
        budibase::commands::budibase_get_query,
        budibase::commands::budibase_execute_query,
        budibase::commands::budibase_create_query,
        budibase::commands::budibase_update_query,
        budibase::commands::budibase_delete_query,
        budibase::commands::budibase_list_automations,
        budibase::commands::budibase_get_automation,
        budibase::commands::budibase_create_automation,
        budibase::commands::budibase_update_automation,
        budibase::commands::budibase_delete_automation,
        budibase::commands::budibase_trigger_automation,
        budibase::commands::budibase_get_automation_logs,
        budibase::commands::budibase_list_datasources,
        budibase::commands::budibase_get_datasource,
        budibase::commands::budibase_create_datasource,
        budibase::commands::budibase_update_datasource,
        budibase::commands::budibase_delete_datasource,
        budibase::commands::budibase_test_datasource,
        // osTicket commands
        osticket::commands::osticket_connect,
        osticket::commands::osticket_disconnect,
        osticket::commands::osticket_list_connections,
        osticket::commands::osticket_ping,
        osticket::commands::osticket_list_tickets,
        osticket::commands::osticket_search_tickets,
        osticket::commands::osticket_get_ticket,
        osticket::commands::osticket_create_ticket,
        osticket::commands::osticket_update_ticket,
        osticket::commands::osticket_delete_ticket,
        osticket::commands::osticket_close_ticket,
        osticket::commands::osticket_reopen_ticket,
        osticket::commands::osticket_assign_ticket,
        osticket::commands::osticket_post_ticket_reply,
        osticket::commands::osticket_post_ticket_note,
        osticket::commands::osticket_get_ticket_threads,
        osticket::commands::osticket_add_ticket_collaborator,
        osticket::commands::osticket_get_ticket_collaborators,
        osticket::commands::osticket_remove_ticket_collaborator,
        osticket::commands::osticket_transfer_ticket,
        osticket::commands::osticket_merge_tickets,
        osticket::commands::osticket_list_users,
        osticket::commands::osticket_get_user,
        osticket::commands::osticket_search_users,
        osticket::commands::osticket_create_user,
        osticket::commands::osticket_update_user,
        osticket::commands::osticket_delete_user,
        osticket::commands::osticket_get_user_tickets,
        osticket::commands::osticket_list_departments,
        osticket::commands::osticket_get_department,
        osticket::commands::osticket_create_department,
        osticket::commands::osticket_update_department,
        osticket::commands::osticket_delete_department,
        osticket::commands::osticket_get_department_agents,
        osticket::commands::osticket_list_topics,
        osticket::commands::osticket_get_topic,
        osticket::commands::osticket_create_topic,
        osticket::commands::osticket_update_topic,
        osticket::commands::osticket_delete_topic,
        osticket::commands::osticket_list_agents,
        osticket::commands::osticket_get_agent,
        osticket::commands::osticket_create_agent,
        osticket::commands::osticket_update_agent,
        osticket::commands::osticket_delete_agent,
        osticket::commands::osticket_set_agent_vacation,
        osticket::commands::osticket_get_agent_teams,
        osticket::commands::osticket_list_teams,
        osticket::commands::osticket_get_team,
        osticket::commands::osticket_create_team,
        osticket::commands::osticket_update_team,
        osticket::commands::osticket_delete_team,
        osticket::commands::osticket_add_team_member,
        osticket::commands::osticket_remove_team_member,
        osticket::commands::osticket_get_team_members,
        osticket::commands::osticket_list_sla,
        osticket::commands::osticket_get_sla,
        osticket::commands::osticket_create_sla,
        osticket::commands::osticket_update_sla,
        osticket::commands::osticket_delete_sla,
        osticket::commands::osticket_list_canned_responses,
        osticket::commands::osticket_get_canned_response,
        osticket::commands::osticket_create_canned_response,
        osticket::commands::osticket_update_canned_response,
        osticket::commands::osticket_delete_canned_response,
        osticket::commands::osticket_search_canned_responses,
        osticket::commands::osticket_list_forms,
        osticket::commands::osticket_get_form,
        osticket::commands::osticket_list_custom_fields,
        osticket::commands::osticket_get_custom_field,
        osticket::commands::osticket_create_custom_field,
        osticket::commands::osticket_update_custom_field,
        osticket::commands::osticket_delete_custom_field,
        // Jira commands
        jira::commands::jira_connect,
        jira::commands::jira_disconnect,
        jira::commands::jira_list_connections,
        jira::commands::jira_ping,
        jira::commands::jira_get_issue,
        jira::commands::jira_create_issue,
        jira::commands::jira_bulk_create_issues,
        jira::commands::jira_update_issue,
        jira::commands::jira_delete_issue,
        jira::commands::jira_search_issues,
        jira::commands::jira_get_transitions,
        jira::commands::jira_transition_issue,
        jira::commands::jira_assign_issue,
        jira::commands::jira_get_issue_changelog,
        jira::commands::jira_link_issues,
        jira::commands::jira_get_watchers,
        jira::commands::jira_add_watcher,
        jira::commands::jira_list_projects,
        jira::commands::jira_get_project,
        jira::commands::jira_create_project,
        jira::commands::jira_delete_project,
        jira::commands::jira_get_project_statuses,
        jira::commands::jira_get_project_components,
        jira::commands::jira_get_project_versions,
        jira::commands::jira_list_comments,
        jira::commands::jira_get_comment,
        jira::commands::jira_add_comment,
        jira::commands::jira_update_comment,
        jira::commands::jira_delete_comment,
        jira::commands::jira_list_attachments,
        jira::commands::jira_get_attachment,
        jira::commands::jira_add_attachment,
        jira::commands::jira_delete_attachment,
        jira::commands::jira_list_worklogs,
        jira::commands::jira_get_worklog,
        jira::commands::jira_add_worklog,
        jira::commands::jira_update_worklog,
        jira::commands::jira_delete_worklog,
        jira::commands::jira_list_boards,
        jira::commands::jira_get_board,
        jira::commands::jira_get_board_issues,
        jira::commands::jira_get_board_backlog,
        jira::commands::jira_get_board_configuration,
        jira::commands::jira_list_sprints,
        jira::commands::jira_get_sprint,
        jira::commands::jira_create_sprint,
        jira::commands::jira_update_sprint,
        jira::commands::jira_delete_sprint,
        jira::commands::jira_get_sprint_issues,
        jira::commands::jira_move_issues_to_sprint,
        jira::commands::jira_start_sprint,
        jira::commands::jira_complete_sprint,
        jira::commands::jira_get_myself,
        jira::commands::jira_get_user,
        jira::commands::jira_search_users,
        jira::commands::jira_find_assignable_users,
        jira::commands::jira_list_fields,
        jira::commands::jira_get_all_issue_types,
        jira::commands::jira_get_priorities,
        jira::commands::jira_get_statuses,
        jira::commands::jira_get_resolutions,
        jira::commands::jira_list_dashboards,
        jira::commands::jira_get_dashboard,
        jira::commands::jira_get_filter,
        jira::commands::jira_get_favourite_filters,
        jira::commands::jira_get_my_filters,
        jira::commands::jira_create_filter,
        jira::commands::jira_update_filter,
        jira::commands::jira_delete_filter,
        // I18n commands
        i18n::commands::i18n_translate,
        i18n::commands::i18n_translate_plural,
        i18n::commands::i18n_translate_batch,
        i18n::commands::i18n_get_bundle,
        i18n::commands::i18n_get_namespace_bundle,
        i18n::commands::i18n_available_locales,
        i18n::commands::i18n_status,
        i18n::commands::i18n_detect_os_locale,
        i18n::commands::i18n_has_key,
        i18n::commands::i18n_missing_keys,
        i18n::commands::i18n_reload,
        i18n::commands::i18n_ssr_payload,
        i18n::commands::i18n_ssr_script,
        // Let's Encrypt / ACME certificate management
        letsencrypt::commands::le_get_status,
        letsencrypt::commands::le_start,
        letsencrypt::commands::le_stop,
        letsencrypt::commands::le_get_config,
        letsencrypt::commands::le_update_config,
        letsencrypt::commands::le_register_account,
        letsencrypt::commands::le_list_accounts,
        letsencrypt::commands::le_remove_account,
        letsencrypt::commands::le_request_certificate,
        letsencrypt::commands::le_renew_certificate,
        letsencrypt::commands::le_revoke_certificate,
        letsencrypt::commands::le_list_certificates,
        letsencrypt::commands::le_get_certificate,
        letsencrypt::commands::le_find_certificates_by_domain,
        letsencrypt::commands::le_remove_certificate,
        letsencrypt::commands::le_get_cert_paths,
        letsencrypt::commands::le_health_check,
        letsencrypt::commands::le_has_critical_issues,
        letsencrypt::commands::le_fetch_ocsp,
        letsencrypt::commands::le_get_ocsp_status,
        letsencrypt::commands::le_recent_events,
        letsencrypt::commands::le_drain_events,
        letsencrypt::commands::le_check_rate_limit,
        letsencrypt::commands::le_is_rate_limited,
        // SSH Agent management
        ssh_agent::commands::ssh_agent_get_status,
        ssh_agent::commands::ssh_agent_start,
        ssh_agent::commands::ssh_agent_stop,
        ssh_agent::commands::ssh_agent_restart,
        ssh_agent::commands::ssh_agent_get_config,
        ssh_agent::commands::ssh_agent_update_config,
        ssh_agent::commands::ssh_agent_list_keys,
        ssh_agent::commands::ssh_agent_add_key,
        ssh_agent::commands::ssh_agent_remove_key,
        ssh_agent::commands::ssh_agent_remove_all_keys,
        ssh_agent::commands::ssh_agent_lock,
        ssh_agent::commands::ssh_agent_unlock,
        ssh_agent::commands::ssh_agent_connect_system,
        ssh_agent::commands::ssh_agent_disconnect_system,
        ssh_agent::commands::ssh_agent_set_system_path,
        ssh_agent::commands::ssh_agent_discover_system,
        ssh_agent::commands::ssh_agent_start_forwarding,
        ssh_agent::commands::ssh_agent_stop_forwarding,
        ssh_agent::commands::ssh_agent_list_forwarding,
        ssh_agent::commands::ssh_agent_audit_log,
        ssh_agent::commands::ssh_agent_export_audit,
        ssh_agent::commands::ssh_agent_clear_audit,
        ssh_agent::commands::ssh_agent_run_maintenance,
        // Warpgate bastion host admin commands
        warpgate::commands::warpgate_connect,
        warpgate::commands::warpgate_disconnect,
        warpgate::commands::warpgate_list_connections,
        warpgate::commands::warpgate_ping,
        warpgate::commands::warpgate_list_targets,
        warpgate::commands::warpgate_create_target,
        warpgate::commands::warpgate_get_target,
        warpgate::commands::warpgate_update_target,
        warpgate::commands::warpgate_delete_target,
        warpgate::commands::warpgate_get_target_ssh_host_keys,
        warpgate::commands::warpgate_get_target_roles,
        warpgate::commands::warpgate_add_target_role,
        warpgate::commands::warpgate_remove_target_role,
        warpgate::commands::warpgate_list_target_groups,
        warpgate::commands::warpgate_create_target_group,
        warpgate::commands::warpgate_get_target_group,
        warpgate::commands::warpgate_update_target_group,
        warpgate::commands::warpgate_delete_target_group,
        warpgate::commands::warpgate_list_users,
        warpgate::commands::warpgate_create_user,
        warpgate::commands::warpgate_get_user,
        warpgate::commands::warpgate_update_user,
        warpgate::commands::warpgate_delete_user,
        warpgate::commands::warpgate_get_user_roles,
        warpgate::commands::warpgate_add_user_role,
        warpgate::commands::warpgate_remove_user_role,
        warpgate::commands::warpgate_unlink_user_ldap,
        warpgate::commands::warpgate_auto_link_user_ldap,
        warpgate::commands::warpgate_list_roles,
        warpgate::commands::warpgate_create_role,
        warpgate::commands::warpgate_get_role,
        warpgate::commands::warpgate_update_role,
        warpgate::commands::warpgate_delete_role,
        warpgate::commands::warpgate_get_role_targets,
        warpgate::commands::warpgate_get_role_users,
        warpgate::commands::warpgate_list_sessions,
        warpgate::commands::warpgate_get_session,
        warpgate::commands::warpgate_close_session,
        warpgate::commands::warpgate_close_all_sessions,
        warpgate::commands::warpgate_get_session_recordings,
        warpgate::commands::warpgate_get_recording,
        warpgate::commands::warpgate_get_recording_cast,
        warpgate::commands::warpgate_get_recording_tcpdump,
        warpgate::commands::warpgate_get_recording_kubernetes,
        warpgate::commands::warpgate_list_tickets,
        warpgate::commands::warpgate_create_ticket,
        warpgate::commands::warpgate_delete_ticket,
        warpgate::commands::warpgate_list_password_credentials,
        warpgate::commands::warpgate_create_password_credential,
        warpgate::commands::warpgate_delete_password_credential,
        warpgate::commands::warpgate_list_public_key_credentials,
        warpgate::commands::warpgate_create_public_key_credential,
        warpgate::commands::warpgate_update_public_key_credential,
        warpgate::commands::warpgate_delete_public_key_credential,
        warpgate::commands::warpgate_list_sso_credentials,
        warpgate::commands::warpgate_create_sso_credential,
        warpgate::commands::warpgate_update_sso_credential,
        warpgate::commands::warpgate_delete_sso_credential,
        warpgate::commands::warpgate_list_otp_credentials,
        warpgate::commands::warpgate_create_otp_credential,
        warpgate::commands::warpgate_delete_otp_credential,
        warpgate::commands::warpgate_list_certificate_credentials,
        warpgate::commands::warpgate_issue_certificate_credential,
        warpgate::commands::warpgate_update_certificate_credential,
        warpgate::commands::warpgate_revoke_certificate_credential,
        warpgate::commands::warpgate_get_ssh_own_keys,
        warpgate::commands::warpgate_list_known_hosts,
        warpgate::commands::warpgate_add_known_host,
        warpgate::commands::warpgate_delete_known_host,
        warpgate::commands::warpgate_check_ssh_host_key,
        warpgate::commands::warpgate_list_ldap_servers,
        warpgate::commands::warpgate_create_ldap_server,
        warpgate::commands::warpgate_get_ldap_server,
        warpgate::commands::warpgate_update_ldap_server,
        warpgate::commands::warpgate_delete_ldap_server,
        warpgate::commands::warpgate_test_ldap_connection,
        warpgate::commands::warpgate_get_ldap_users,
        warpgate::commands::warpgate_import_ldap_users,
        warpgate::commands::warpgate_query_logs,
        warpgate::commands::warpgate_get_parameters,
        warpgate::commands::warpgate_update_parameters,
        // OpenPubkey SSH (opkssh) commands
        opkssh::commands::opkssh_check_binary,
        opkssh::commands::opkssh_get_download_url,
        opkssh::commands::opkssh_login,
        opkssh::commands::opkssh_list_keys,
        opkssh::commands::opkssh_remove_key,
        opkssh::commands::opkssh_get_client_config,
        opkssh::commands::opkssh_update_client_config,
        opkssh::commands::opkssh_well_known_providers,
        opkssh::commands::opkssh_build_env_string,
        opkssh::commands::opkssh_server_read_config_script,
        opkssh::commands::opkssh_parse_server_config,
        opkssh::commands::opkssh_get_server_config,
        opkssh::commands::opkssh_build_add_identity_cmd,
        opkssh::commands::opkssh_build_remove_identity_cmd,
        opkssh::commands::opkssh_build_add_provider_cmd,
        opkssh::commands::opkssh_build_remove_provider_cmd,
        opkssh::commands::opkssh_build_install_cmd,
        opkssh::commands::opkssh_build_audit_cmd,
        opkssh::commands::opkssh_parse_audit_output,
        opkssh::commands::opkssh_get_audit_results,
        opkssh::commands::opkssh_get_status,
        // SSH event-scripts commands
        ssh_scripts::commands::ssh_scripts_create_script,
        ssh_scripts::commands::ssh_scripts_get_script,
        ssh_scripts::commands::ssh_scripts_list_scripts,
        ssh_scripts::commands::ssh_scripts_update_script,
        ssh_scripts::commands::ssh_scripts_delete_script,
        ssh_scripts::commands::ssh_scripts_duplicate_script,
        ssh_scripts::commands::ssh_scripts_toggle_script,
        ssh_scripts::commands::ssh_scripts_create_chain,
        ssh_scripts::commands::ssh_scripts_get_chain,
        ssh_scripts::commands::ssh_scripts_list_chains,
        ssh_scripts::commands::ssh_scripts_update_chain,
        ssh_scripts::commands::ssh_scripts_delete_chain,
        ssh_scripts::commands::ssh_scripts_toggle_chain,
        ssh_scripts::commands::ssh_scripts_run_script,
        ssh_scripts::commands::ssh_scripts_run_chain,
        ssh_scripts::commands::ssh_scripts_record_execution,
        ssh_scripts::commands::ssh_scripts_notify_event,
        ssh_scripts::commands::ssh_scripts_notify_output,
        ssh_scripts::commands::ssh_scripts_scheduler_tick,
        ssh_scripts::commands::ssh_scripts_register_session,
        ssh_scripts::commands::ssh_scripts_unregister_session,
        ssh_scripts::commands::ssh_scripts_query_history,
        ssh_scripts::commands::ssh_scripts_get_execution,
        ssh_scripts::commands::ssh_scripts_get_chain_execution,
        ssh_scripts::commands::ssh_scripts_get_script_stats,
        ssh_scripts::commands::ssh_scripts_get_all_stats,
        ssh_scripts::commands::ssh_scripts_clear_history,
        ssh_scripts::commands::ssh_scripts_clear_script_history,
        ssh_scripts::commands::ssh_scripts_list_timers,
        ssh_scripts::commands::ssh_scripts_list_session_timers,
        ssh_scripts::commands::ssh_scripts_pause_timer,
        ssh_scripts::commands::ssh_scripts_resume_timer,
        ssh_scripts::commands::ssh_scripts_list_by_tag,
        ssh_scripts::commands::ssh_scripts_list_by_category,
        ssh_scripts::commands::ssh_scripts_list_by_trigger,
        ssh_scripts::commands::ssh_scripts_get_tags,
        ssh_scripts::commands::ssh_scripts_get_categories,
        ssh_scripts::commands::ssh_scripts_export,
        ssh_scripts::commands::ssh_scripts_import,
        ssh_scripts::commands::ssh_scripts_bulk_enable,
        ssh_scripts::commands::ssh_scripts_bulk_delete,
        ssh_scripts::commands::ssh_scripts_get_summary,
        // MCP Server commands
        mcp_server::commands::mcp_get_status,
        mcp_server::commands::mcp_start_server,
        mcp_server::commands::mcp_stop_server,
        mcp_server::commands::mcp_get_config,
        mcp_server::commands::mcp_update_config,
        mcp_server::commands::mcp_generate_api_key,
        mcp_server::commands::mcp_list_sessions,
        mcp_server::commands::mcp_disconnect_session,
        mcp_server::commands::mcp_get_metrics,
        mcp_server::commands::mcp_get_tools,
        mcp_server::commands::mcp_get_resources,
        mcp_server::commands::mcp_get_prompts,
        mcp_server::commands::mcp_get_logs,
        mcp_server::commands::mcp_get_events,
        mcp_server::commands::mcp_get_tool_call_logs,
        mcp_server::commands::mcp_clear_logs,
        mcp_server::commands::mcp_reset_metrics,
        mcp_server::commands::mcp_handle_request,
        // SNMP commands
        snmp::commands::snmp_get,
        snmp::commands::snmp_get_next,
        snmp::commands::snmp_get_bulk,
        snmp::commands::snmp_set_value,
        snmp::commands::snmp_walk,
        snmp::commands::snmp_get_table,
        snmp::commands::snmp_get_if_table,
        snmp::commands::snmp_get_system_info,
        snmp::commands::snmp_get_interfaces,
        snmp::commands::snmp_discover,
        snmp::commands::snmp_start_trap_receiver,
        snmp::commands::snmp_stop_trap_receiver,
        snmp::commands::snmp_get_trap_receiver_status,
        snmp::commands::snmp_get_traps,
        snmp::commands::snmp_clear_traps,
        snmp::commands::snmp_mib_resolve_oid,
        snmp::commands::snmp_mib_resolve_name,
        snmp::commands::snmp_mib_search,
        snmp::commands::snmp_mib_load_text,
        snmp::commands::snmp_mib_get_subtree,
        snmp::commands::snmp_add_monitor,
        snmp::commands::snmp_remove_monitor,
        snmp::commands::snmp_start_monitor,
        snmp::commands::snmp_stop_monitor,
        snmp::commands::snmp_get_monitor_alerts,
        snmp::commands::snmp_acknowledge_alert,
        snmp::commands::snmp_clear_alerts,
        snmp::commands::snmp_add_target,
        snmp::commands::snmp_remove_target,
        snmp::commands::snmp_list_targets,
        snmp::commands::snmp_add_usm_user,
        snmp::commands::snmp_remove_usm_user,
        snmp::commands::snmp_list_usm_users,
        snmp::commands::snmp_add_device,
        snmp::commands::snmp_remove_device,
        snmp::commands::snmp_list_devices,
        snmp::commands::snmp_get_service_status,
        snmp::commands::snmp_bulk_get,
        snmp::commands::snmp_bulk_walk,
        // ── Dashboard ──────────────────────────────────────────────────
        sorng_dashboard::commands::dash_get_state,
        sorng_dashboard::commands::dash_get_health_summary,
        sorng_dashboard::commands::dash_get_quick_stats,
        sorng_dashboard::commands::dash_get_alerts,
        sorng_dashboard::commands::dash_acknowledge_alert,
        sorng_dashboard::commands::dash_get_connection_health,
        sorng_dashboard::commands::dash_get_all_health,
        sorng_dashboard::commands::dash_get_unhealthy,
        sorng_dashboard::commands::dash_get_sparkline,
        sorng_dashboard::commands::dash_get_widget_data,
        sorng_dashboard::commands::dash_start_monitoring,
        sorng_dashboard::commands::dash_stop_monitoring,
        sorng_dashboard::commands::dash_force_refresh,
        sorng_dashboard::commands::dash_get_config,
        sorng_dashboard::commands::dash_update_config,
        sorng_dashboard::commands::dash_get_layout,
        sorng_dashboard::commands::dash_update_layout,
        sorng_dashboard::commands::dash_get_heatmap,
        sorng_dashboard::commands::dash_get_recent,
        sorng_dashboard::commands::dash_get_top_latency,
        sorng_dashboard::commands::dash_check_connection,
        // ── Hooks ──────────────────────────────────────────────────────
        sorng_hooks::commands::hook_subscribe,
        sorng_hooks::commands::hook_unsubscribe,
        sorng_hooks::commands::hook_list_subscriptions,
        sorng_hooks::commands::hook_get_subscription,
        sorng_hooks::commands::hook_enable_subscription,
        sorng_hooks::commands::hook_disable_subscription,
        sorng_hooks::commands::hook_dispatch_event,
        sorng_hooks::commands::hook_get_recent_events,
        sorng_hooks::commands::hook_get_events_by_type,
        sorng_hooks::commands::hook_get_stats,
        sorng_hooks::commands::hook_clear_events,
        sorng_hooks::commands::hook_create_pipeline,
        sorng_hooks::commands::hook_delete_pipeline,
        sorng_hooks::commands::hook_list_pipelines,
        sorng_hooks::commands::hook_execute_pipeline,
        sorng_hooks::commands::hook_get_config,
        sorng_hooks::commands::hook_update_config,
        // ── Notifications ──────────────────────────────────────────────
        sorng_notifications::commands::notif_add_rule,
        sorng_notifications::commands::notif_remove_rule,
        sorng_notifications::commands::notif_list_rules,
        sorng_notifications::commands::notif_get_rule,
        sorng_notifications::commands::notif_enable_rule,
        sorng_notifications::commands::notif_disable_rule,
        sorng_notifications::commands::notif_update_rule,
        sorng_notifications::commands::notif_add_template,
        sorng_notifications::commands::notif_remove_template,
        sorng_notifications::commands::notif_list_templates,
        sorng_notifications::commands::notif_process_event,
        sorng_notifications::commands::notif_get_history,
        sorng_notifications::commands::notif_get_recent_history,
        sorng_notifications::commands::notif_clear_history,
        sorng_notifications::commands::notif_get_stats,
        sorng_notifications::commands::notif_get_config,
        sorng_notifications::commands::notif_update_config,
        sorng_notifications::commands::notif_test_channel,
        sorng_notifications::commands::notif_acknowledge_escalation,
        // ── Topology ───────────────────────────────────────────────────
        sorng_topology::commands::topo_build_from_connections,
        sorng_topology::commands::topo_get_graph,
        sorng_topology::commands::topo_add_node,
        sorng_topology::commands::topo_remove_node,
        sorng_topology::commands::topo_update_node,
        sorng_topology::commands::topo_add_edge,
        sorng_topology::commands::topo_remove_edge,
        sorng_topology::commands::topo_apply_layout,
        sorng_topology::commands::topo_get_blast_radius,
        sorng_topology::commands::topo_find_bottlenecks,
        sorng_topology::commands::topo_find_critical_edges,
        sorng_topology::commands::topo_get_path,
        sorng_topology::commands::topo_get_neighbors,
        sorng_topology::commands::topo_get_connected_components,
        sorng_topology::commands::topo_get_stats,
        sorng_topology::commands::topo_create_snapshot,
        sorng_topology::commands::topo_list_snapshots,
        sorng_topology::commands::topo_add_group,
        sorng_topology::commands::topo_remove_group,
        // ── Filters ────────────────────────────────────────────────────
        sorng_filters::commands::filter_create,
        sorng_filters::commands::filter_delete,
        sorng_filters::commands::filter_update,
        sorng_filters::commands::filter_get,
        sorng_filters::commands::filter_list,
        sorng_filters::commands::filter_evaluate,
        sorng_filters::commands::filter_get_presets,
        sorng_filters::commands::filter_create_smart_group,
        sorng_filters::commands::filter_delete_smart_group,
        sorng_filters::commands::filter_list_smart_groups,
        sorng_filters::commands::filter_update_smart_group,
        sorng_filters::commands::filter_evaluate_smart_group,
        sorng_filters::commands::filter_invalidate_cache,
        sorng_filters::commands::filter_get_stats,
        sorng_filters::commands::filter_get_config,
        sorng_filters::commands::filter_update_config,
        // ── Credentials ────────────────────────────────────────────────
        sorng_credentials::commands::cred_add,
        sorng_credentials::commands::cred_remove,
        sorng_credentials::commands::cred_update,
        sorng_credentials::commands::cred_get,
        sorng_credentials::commands::cred_list,
        sorng_credentials::commands::cred_record_rotation,
        sorng_credentials::commands::cred_check_expiry,
        sorng_credentials::commands::cred_check_all_expiries,
        sorng_credentials::commands::cred_get_stale,
        sorng_credentials::commands::cred_get_expiring_soon,
        sorng_credentials::commands::cred_get_expired,
        sorng_credentials::commands::cred_add_policy,
        sorng_credentials::commands::cred_remove_policy,
        sorng_credentials::commands::cred_list_policies,
        sorng_credentials::commands::cred_check_compliance,
        sorng_credentials::commands::cred_check_strength,
        sorng_credentials::commands::cred_detect_duplicates,
        sorng_credentials::commands::cred_create_group,
        sorng_credentials::commands::cred_delete_group,
        sorng_credentials::commands::cred_list_groups,
        sorng_credentials::commands::cred_add_to_group,
        sorng_credentials::commands::cred_remove_from_group,
        sorng_credentials::commands::cred_get_alerts,
        sorng_credentials::commands::cred_acknowledge_alert,
        sorng_credentials::commands::cred_generate_alerts,
        sorng_credentials::commands::cred_get_audit_log,
        sorng_credentials::commands::cred_get_stats,
        sorng_credentials::commands::cred_get_config,
        sorng_credentials::commands::cred_update_config,
        // ── Replay ─────────────────────────────────────────────────────
        sorng_replay::commands::replay_load_terminal,
        sorng_replay::commands::replay_load_video,
        sorng_replay::commands::replay_load_har,
        sorng_replay::commands::replay_play,
        sorng_replay::commands::replay_pause,
        sorng_replay::commands::replay_stop,
        sorng_replay::commands::replay_seek,
        sorng_replay::commands::replay_set_speed,
        sorng_replay::commands::replay_get_state,
        sorng_replay::commands::replay_get_position,
        sorng_replay::commands::replay_get_frame_at,
        sorng_replay::commands::replay_get_terminal_state_at,
        sorng_replay::commands::replay_advance_frame,
        sorng_replay::commands::replay_get_timeline,
        sorng_replay::commands::replay_get_markers,
        sorng_replay::commands::replay_get_heatmap,
        sorng_replay::commands::replay_search,
        sorng_replay::commands::replay_add_annotation,
        sorng_replay::commands::replay_remove_annotation,
        sorng_replay::commands::replay_list_annotations,
        sorng_replay::commands::replay_add_bookmark,
        sorng_replay::commands::replay_remove_bookmark,
        sorng_replay::commands::replay_list_bookmarks,
        sorng_replay::commands::replay_export,
        sorng_replay::commands::replay_get_stats,
        sorng_replay::commands::replay_get_config,
        sorng_replay::commands::replay_update_config,
        sorng_replay::commands::replay_get_har_waterfall,
        sorng_replay::commands::replay_get_har_stats,
        // ── RDP File ───────────────────────────────────────────────────
        sorng_rdpfile::commands::rdpfile_parse,
        sorng_rdpfile::commands::rdpfile_generate,
        sorng_rdpfile::commands::rdpfile_import,
        sorng_rdpfile::commands::rdpfile_export,
        sorng_rdpfile::commands::rdpfile_batch_export,
        sorng_rdpfile::commands::rdpfile_batch_import,
        sorng_rdpfile::commands::rdpfile_validate,
        // ── Updater ────────────────────────────────────────────────────
        sorng_updater::commands::updater_check,
        sorng_updater::commands::updater_download,
        sorng_updater::commands::updater_cancel_download,
        sorng_updater::commands::updater_install,
        sorng_updater::commands::updater_schedule_install,
        sorng_updater::commands::updater_get_status,
        sorng_updater::commands::updater_get_config,
        sorng_updater::commands::updater_update_config,
        sorng_updater::commands::updater_set_channel,
        sorng_updater::commands::updater_get_version_info,
        sorng_updater::commands::updater_get_history,
        sorng_updater::commands::updater_rollback,
        sorng_updater::commands::updater_get_rollbacks,
        sorng_updater::commands::updater_get_release_notes,
        // ── Marketplace ────────────────────────────────────────────────
        sorng_marketplace::commands::mkt_search,
        sorng_marketplace::commands::mkt_get_listing,
        sorng_marketplace::commands::mkt_get_categories,
        sorng_marketplace::commands::mkt_get_featured,
        sorng_marketplace::commands::mkt_get_popular,
        sorng_marketplace::commands::mkt_install,
        sorng_marketplace::commands::mkt_uninstall,
        sorng_marketplace::commands::mkt_update,
        sorng_marketplace::commands::mkt_get_installed,
        sorng_marketplace::commands::mkt_check_updates,
        sorng_marketplace::commands::mkt_refresh_repositories,
        sorng_marketplace::commands::mkt_add_repository,
        sorng_marketplace::commands::mkt_remove_repository,
        sorng_marketplace::commands::mkt_list_repositories,
        sorng_marketplace::commands::mkt_get_reviews,
        sorng_marketplace::commands::mkt_add_review,
        sorng_marketplace::commands::mkt_get_stats,
        sorng_marketplace::commands::mkt_get_config,
        sorng_marketplace::commands::mkt_update_config,
        sorng_marketplace::commands::mkt_validate_manifest,
        // ── Portable ───────────────────────────────────────────────────
        sorng_portable::commands::portable_detect_mode,
        sorng_portable::commands::portable_get_status,
        sorng_portable::commands::portable_get_paths,
        sorng_portable::commands::portable_get_config,
        sorng_portable::commands::portable_update_config,
        sorng_portable::commands::portable_migrate_to_portable,
        sorng_portable::commands::portable_migrate_to_installed,
        sorng_portable::commands::portable_create_marker,
        sorng_portable::commands::portable_remove_marker,
        sorng_portable::commands::portable_validate,
        sorng_portable::commands::portable_get_drive_info,
        // ── Scheduler ──────────────────────────────────────────────────
        sorng_scheduler::commands::sched_add_task,
        sorng_scheduler::commands::sched_remove_task,
        sorng_scheduler::commands::sched_update_task,
        sorng_scheduler::commands::sched_get_task,
        sorng_scheduler::commands::sched_list_tasks,
        sorng_scheduler::commands::sched_enable_task,
        sorng_scheduler::commands::sched_disable_task,
        sorng_scheduler::commands::sched_execute_now,
        sorng_scheduler::commands::sched_cancel_task,
        sorng_scheduler::commands::sched_get_history,
        sorng_scheduler::commands::sched_get_upcoming,
        sorng_scheduler::commands::sched_get_stats,
        sorng_scheduler::commands::sched_get_config,
        sorng_scheduler::commands::sched_update_config,
        sorng_scheduler::commands::sched_cleanup_history,
        sorng_scheduler::commands::sched_validate_cron,
        sorng_scheduler::commands::sched_get_next_occurrences,
        sorng_scheduler::commands::sched_pause_all,
        sorng_scheduler::commands::sched_resume_all,
        // ── LXD / Incus commands ─────────────────────────────────────
        lxd::commands::lxd_connect,
        lxd::commands::lxd_disconnect,
        lxd::commands::lxd_is_connected,
        // Server & Cluster
        lxd::commands::lxd_get_server,
        lxd::commands::lxd_get_server_resources,
        lxd::commands::lxd_update_server_config,
        lxd::commands::lxd_get_cluster,
        lxd::commands::lxd_list_cluster_members,
        lxd::commands::lxd_get_cluster_member,
        lxd::commands::lxd_evacuate_cluster_member,
        lxd::commands::lxd_restore_cluster_member,
        lxd::commands::lxd_remove_cluster_member,
        // Instances
        lxd::commands::lxd_list_instances,
        lxd::commands::lxd_list_containers,
        lxd::commands::lxd_list_virtual_machines,
        lxd::commands::lxd_get_instance,
        lxd::commands::lxd_get_instance_state,
        lxd::commands::lxd_create_instance,
        lxd::commands::lxd_update_instance,
        lxd::commands::lxd_patch_instance,
        lxd::commands::lxd_delete_instance,
        lxd::commands::lxd_rename_instance,
        lxd::commands::lxd_start_instance,
        lxd::commands::lxd_stop_instance,
        lxd::commands::lxd_restart_instance,
        lxd::commands::lxd_freeze_instance,
        lxd::commands::lxd_unfreeze_instance,
        lxd::commands::lxd_exec_instance,
        lxd::commands::lxd_console_instance,
        lxd::commands::lxd_clear_console_log,
        lxd::commands::lxd_list_instance_logs,
        lxd::commands::lxd_get_instance_log,
        lxd::commands::lxd_get_instance_file,
        lxd::commands::lxd_push_instance_file,
        lxd::commands::lxd_delete_instance_file,
        // Snapshots
        lxd::commands::lxd_list_snapshots,
        lxd::commands::lxd_get_snapshot,
        lxd::commands::lxd_create_snapshot,
        lxd::commands::lxd_delete_snapshot,
        lxd::commands::lxd_rename_snapshot,
        lxd::commands::lxd_restore_snapshot,
        // Backups
        lxd::commands::lxd_list_backups,
        lxd::commands::lxd_get_backup,
        lxd::commands::lxd_create_backup,
        lxd::commands::lxd_delete_backup,
        lxd::commands::lxd_rename_backup,
        // Images
        lxd::commands::lxd_list_images,
        lxd::commands::lxd_get_image,
        lxd::commands::lxd_get_image_alias,
        lxd::commands::lxd_create_image_alias,
        lxd::commands::lxd_delete_image_alias,
        lxd::commands::lxd_delete_image,
        lxd::commands::lxd_update_image,
        lxd::commands::lxd_copy_image_from_remote,
        lxd::commands::lxd_refresh_image,
        // Profiles
        lxd::commands::lxd_list_profiles,
        lxd::commands::lxd_get_profile,
        lxd::commands::lxd_create_profile,
        lxd::commands::lxd_update_profile,
        lxd::commands::lxd_patch_profile,
        lxd::commands::lxd_delete_profile,
        lxd::commands::lxd_rename_profile,
        // Networks
        lxd::commands::lxd_list_networks,
        lxd::commands::lxd_get_network,
        lxd::commands::lxd_create_network,
        lxd::commands::lxd_update_network,
        lxd::commands::lxd_patch_network,
        lxd::commands::lxd_delete_network,
        lxd::commands::lxd_rename_network,
        lxd::commands::lxd_get_network_state,
        lxd::commands::lxd_list_network_leases,
        lxd::commands::lxd_list_network_acls,
        lxd::commands::lxd_get_network_acl,
        lxd::commands::lxd_create_network_acl,
        lxd::commands::lxd_update_network_acl,
        lxd::commands::lxd_delete_network_acl,
        lxd::commands::lxd_list_network_forwards,
        lxd::commands::lxd_get_network_forward,
        lxd::commands::lxd_create_network_forward,
        lxd::commands::lxd_delete_network_forward,
        lxd::commands::lxd_list_network_zones,
        lxd::commands::lxd_get_network_zone,
        lxd::commands::lxd_delete_network_zone,
        lxd::commands::lxd_list_network_load_balancers,
        lxd::commands::lxd_get_network_load_balancer,
        lxd::commands::lxd_delete_network_load_balancer,
        lxd::commands::lxd_list_network_peers,
        // Storage
        lxd::commands::lxd_list_storage_pools,
        lxd::commands::lxd_get_storage_pool,
        lxd::commands::lxd_create_storage_pool,
        lxd::commands::lxd_update_storage_pool,
        lxd::commands::lxd_delete_storage_pool,
        lxd::commands::lxd_get_storage_pool_resources,
        lxd::commands::lxd_list_storage_volumes,
        lxd::commands::lxd_list_custom_volumes,
        lxd::commands::lxd_get_storage_volume,
        lxd::commands::lxd_create_storage_volume,
        lxd::commands::lxd_update_storage_volume,
        lxd::commands::lxd_delete_storage_volume,
        lxd::commands::lxd_rename_storage_volume,
        lxd::commands::lxd_list_volume_snapshots,
        lxd::commands::lxd_create_volume_snapshot,
        lxd::commands::lxd_delete_volume_snapshot,
        lxd::commands::lxd_list_storage_buckets,
        lxd::commands::lxd_get_storage_bucket,
        lxd::commands::lxd_create_storage_bucket,
        lxd::commands::lxd_delete_storage_bucket,
        lxd::commands::lxd_list_bucket_keys,
        // Projects
        lxd::commands::lxd_list_projects,
        lxd::commands::lxd_get_project,
        lxd::commands::lxd_create_project,
        lxd::commands::lxd_update_project,
        lxd::commands::lxd_patch_project,
        lxd::commands::lxd_delete_project,
        lxd::commands::lxd_rename_project,
        // Certificates
        lxd::commands::lxd_list_certificates,
        lxd::commands::lxd_get_certificate,
        lxd::commands::lxd_add_certificate,
        lxd::commands::lxd_delete_certificate,
        lxd::commands::lxd_update_certificate,
        // Operations
        lxd::commands::lxd_list_operations,
        lxd::commands::lxd_get_operation,
        lxd::commands::lxd_cancel_operation,
        lxd::commands::lxd_wait_operation,
        // Warnings
        lxd::commands::lxd_list_warnings,
        lxd::commands::lxd_get_warning,
        lxd::commands::lxd_acknowledge_warning,
        lxd::commands::lxd_delete_warning,
        // Migration / Copy / Publish
        lxd::commands::lxd_migrate_instance,
        lxd::commands::lxd_copy_instance,
        lxd::commands::lxd_publish_instance,
        // VMware Desktop (Player / Workstation / Fusion)
        vmware_desktop::commands::vmwd_connect,
        vmware_desktop::commands::vmwd_disconnect,
        vmware_desktop::commands::vmwd_is_connected,
        vmware_desktop::commands::vmwd_connection_summary,
        vmware_desktop::commands::vmwd_host_info,
        // VMs
        vmware_desktop::commands::vmwd_list_vms,
        vmware_desktop::commands::vmwd_get_vm,
        vmware_desktop::commands::vmwd_create_vm,
        vmware_desktop::commands::vmwd_update_vm,
        vmware_desktop::commands::vmwd_delete_vm,
        vmware_desktop::commands::vmwd_clone_vm,
        vmware_desktop::commands::vmwd_register_vm,
        vmware_desktop::commands::vmwd_unregister_vm,
        vmware_desktop::commands::vmwd_configure_nic,
        vmware_desktop::commands::vmwd_remove_nic,
        vmware_desktop::commands::vmwd_configure_cdrom,
        // Power
        vmware_desktop::commands::vmwd_start_vm,
        vmware_desktop::commands::vmwd_stop_vm,
        vmware_desktop::commands::vmwd_reset_vm,
        vmware_desktop::commands::vmwd_suspend_vm,
        vmware_desktop::commands::vmwd_pause_vm,
        vmware_desktop::commands::vmwd_unpause_vm,
        vmware_desktop::commands::vmwd_get_power_state,
        vmware_desktop::commands::vmwd_batch_power,
        // Snapshots
        vmware_desktop::commands::vmwd_list_snapshots,
        vmware_desktop::commands::vmwd_get_snapshot_tree,
        vmware_desktop::commands::vmwd_create_snapshot,
        vmware_desktop::commands::vmwd_delete_snapshot,
        vmware_desktop::commands::vmwd_revert_to_snapshot,
        vmware_desktop::commands::vmwd_get_snapshot,
        // Guest operations
        vmware_desktop::commands::vmwd_exec_in_guest,
        vmware_desktop::commands::vmwd_run_script_in_guest,
        vmware_desktop::commands::vmwd_copy_to_guest,
        vmware_desktop::commands::vmwd_copy_from_guest,
        vmware_desktop::commands::vmwd_create_directory_in_guest,
        vmware_desktop::commands::vmwd_delete_directory_in_guest,
        vmware_desktop::commands::vmwd_delete_file_in_guest,
        vmware_desktop::commands::vmwd_file_exists_in_guest,
        vmware_desktop::commands::vmwd_directory_exists_in_guest,
        vmware_desktop::commands::vmwd_rename_file_in_guest,
        vmware_desktop::commands::vmwd_list_directory_in_guest,
        vmware_desktop::commands::vmwd_list_processes_in_guest,
        vmware_desktop::commands::vmwd_kill_process_in_guest,
        vmware_desktop::commands::vmwd_read_variable,
        vmware_desktop::commands::vmwd_write_variable,
        vmware_desktop::commands::vmwd_list_env_vars,
        vmware_desktop::commands::vmwd_get_tools_status,
        vmware_desktop::commands::vmwd_install_tools,
        vmware_desktop::commands::vmwd_get_ip_address,
        // Shared folders
        vmware_desktop::commands::vmwd_enable_shared_folders,
        vmware_desktop::commands::vmwd_disable_shared_folders,
        vmware_desktop::commands::vmwd_list_shared_folders,
        vmware_desktop::commands::vmwd_add_shared_folder,
        vmware_desktop::commands::vmwd_remove_shared_folder,
        vmware_desktop::commands::vmwd_set_shared_folder_state,
        // Networking
        vmware_desktop::commands::vmwd_list_networks,
        vmware_desktop::commands::vmwd_get_network,
        vmware_desktop::commands::vmwd_create_network,
        vmware_desktop::commands::vmwd_update_network,
        vmware_desktop::commands::vmwd_delete_network,
        vmware_desktop::commands::vmwd_list_port_forwards,
        vmware_desktop::commands::vmwd_set_port_forward,
        vmware_desktop::commands::vmwd_delete_port_forward,
        vmware_desktop::commands::vmwd_get_dhcp_leases,
        vmware_desktop::commands::vmwd_read_networking_config,
        // VMDK
        vmware_desktop::commands::vmwd_create_vmdk,
        vmware_desktop::commands::vmwd_get_vmdk_info,
        vmware_desktop::commands::vmwd_defragment_vmdk,
        vmware_desktop::commands::vmwd_shrink_vmdk,
        vmware_desktop::commands::vmwd_expand_vmdk,
        vmware_desktop::commands::vmwd_convert_vmdk,
        vmware_desktop::commands::vmwd_rename_vmdk,
        vmware_desktop::commands::vmwd_add_disk_to_vm,
        vmware_desktop::commands::vmwd_remove_disk_from_vm,
        vmware_desktop::commands::vmwd_list_vm_disks,
        // OVF
        vmware_desktop::commands::vmwd_import_ovf,
        vmware_desktop::commands::vmwd_export_ovf,
        // VMX
        vmware_desktop::commands::vmwd_parse_vmx,
        vmware_desktop::commands::vmwd_update_vmx_keys,
        vmware_desktop::commands::vmwd_remove_vmx_keys,
        vmware_desktop::commands::vmwd_discover_vmx_files,
        // Preferences
        vmware_desktop::commands::vmwd_read_preferences,
        vmware_desktop::commands::vmwd_get_default_vm_dir,
        vmware_desktop::commands::vmwd_set_preference,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

#[tauri::command]
/// A simple greeting command for testing the Tauri connection.
///
/// This command takes a name parameter and returns a formatted greeting string.
/// It's primarily used for testing the frontend-backend communication.
///
/// # Arguments
///
/// * `name` - The name to include in the greeting
///
/// # Returns
///
/// A formatted greeting string
///
/// # Example
///
/// ```javascript
/// // Frontend JavaScript
/// const greeting = await invoke('greet', { name: 'World' });
/// console.log(greeting); // "Hello, World! You've been greeted from Rust!"
/// ```
fn greet(name: &str) -> String {
  format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn open_url_external(url: String) -> Result<(), String> {
  // Only allow http/https URLs for safety
  if !url.starts_with("http://") && !url.starts_with("https://") {
    return Err("Only http and https URLs are supported".into());
  }
  #[cfg(target_os = "windows")]
  {
    std::process::Command::new("cmd")
      .args(["/C", "start", "", &url])
      .spawn()
      .map_err(|e| e.to_string())?;
  }
  #[cfg(target_os = "macos")]
  {
    std::process::Command::new("open")
      .arg(&url)
      .spawn()
      .map_err(|e| e.to_string())?;
  }
  #[cfg(target_os = "linux")]
  {
    std::process::Command::new("xdg-open")
      .arg(&url)
      .spawn()
      .map_err(|e| e.to_string())?;
  }
  Ok(())
}

#[tauri::command]
fn open_devtools(app: tauri::AppHandle) {
  if let Some(window) = app.get_webview_window("main") {
    window.open_devtools();
  }
}

#[tauri::command]
fn get_launch_args(state: tauri::State<'_, LaunchArgs>) -> LaunchArgs {
  state.inner().clone()
}

#[tauri::command]
/// Adds a new user to the authentication system.
///
/// Creates a new user account with the specified username and password.
/// The password is securely hashed before storage.
///
/// # Arguments
///
/// * `username` - The desired username for the new account
/// * `password` - The password for the new account (will be hashed)
/// * `auth_service` - The authentication service state
///
/// # Returns
///
/// `Ok(())` if the user was successfully added, `Err(String)` if an error occurred
///
/// # Errors
///
/// Returns an error if:
/// - The username already exists
/// - The password is too weak or invalid
/// - File system operations fail
///
/// # Example
///
/// ```javascript
/// const result = await invoke('add_user', {
///   username: 'john_doe',
///   password: 'secure_password123'
/// });
/// ```
async fn add_user(
  username: String,
  password: String,
  auth_service: tauri::State<'_, AuthServiceState>,
) -> Result<(), String> {
  let mut service = auth_service.lock().await;
  service.add_user(username, password).await
}

#[tauri::command]
/// Verifies user credentials against the authentication system.
///
/// Checks if the provided username and password combination is valid.
///
/// # Arguments
///
/// * `username` - The username to verify
/// * `password` - The password to verify
/// * `auth_service` - The authentication service state
///
/// # Returns
///
/// `Ok(true)` if credentials are valid, `Ok(false)` if invalid, `Err(String)` on error
///
/// # Errors
///
/// Returns an error if there are issues accessing the user store or during verification.
///
/// # Example
///
/// ```javascript
/// const isValid = await invoke('verify_user', {
///   username: 'john_doe',
///   password: 'secure_password123'
/// });
/// if (isValid) {
///   // User authenticated successfully
/// }
/// ```
async fn verify_user(
  username: String,
  password: String,
  auth_service: tauri::State<'_, AuthServiceState>,
) -> Result<bool, String> {
  let mut service = auth_service.lock().await;
  service.verify_user(&username, &password).await
}

#[tauri::command]
/// Retrieves a list of all registered usernames.
///
/// Returns a vector containing all usernames currently registered in the system.
///
/// # Arguments
///
/// * `auth_service` - The authentication service state
///
/// # Returns
///
/// `Ok(Vec<String>)` containing all usernames, `Err(String)` on error
///
/// # Errors
///
/// Returns an error if there are issues accessing the user store.
///
/// # Example
///
/// ```javascript
/// const users = await invoke('list_users');
/// console.log('Registered users:', users);
/// ```
async fn list_users(auth_service: tauri::State<'_, AuthServiceState>) -> Result<Vec<String>, String> {
  let service = auth_service.lock().await;
  Ok(service.list_users().await)
}

#[tauri::command]
/// Removes a user from the authentication system.
///
/// Permanently deletes the user account with the specified username.
/// This action cannot be undone.
///
/// # Arguments
///
/// * `username` - The username of the account to remove
/// * `auth_service` - The authentication service state
///
/// # Returns
///
/// `Ok(true)` if the user was successfully removed, `Ok(false)` if user didn't exist, `Err(String)` on error
///
/// # Errors
///
/// Returns an error if there are issues accessing or modifying the user store.
///
/// # Example
///
/// ```javascript
/// const removed = await invoke('remove_user', {
///   username: 'old_user'
/// });
/// if (removed) {
///   console.log('User removed successfully');
/// }
/// ```
async fn remove_user(
  username: String,
  auth_service: tauri::State<'_, AuthServiceState>,
) -> Result<bool, String> {
  let mut service = auth_service.lock().await;
  service.remove_user(username).await
}

#[tauri::command]
/// Updates the password for an existing user.
///
/// Changes the password for the specified user account. The old password is not required
/// for this operation (admin functionality).
///
/// # Arguments
///
/// * `username` - The username whose password should be updated
/// * `new_password` - The new password for the account
/// * `auth_service` - The authentication service state
///
/// # Returns
///
/// `Ok(true)` if the password was successfully updated, `Ok(false)` if user doesn't exist, `Err(String)` on error
///
/// # Errors
///
/// Returns an error if:
/// - The user doesn't exist
/// - The new password is invalid
/// - File system operations fail
///
/// # Example
///
/// ```javascript
/// const updated = await invoke('update_password', {
///   username: 'john_doe',
///   new_password: 'new_secure_password123'
/// });
/// ```
async fn update_password(
  username: String,
  new_password: String,
  auth_service: tauri::State<'_, AuthServiceState>,
) -> Result<bool, String> {
  let mut service = auth_service.lock().await;
  service.update_password(username, new_password).await
}

#[tauri::command]
/// Creates a desktop shortcut to launch the application with specific collection/connection parameters.
///
/// This command creates a desktop shortcut (.lnk on Windows, .desktop on Linux, .app on macOS)
/// that will launch the application with command line arguments to open a specific collection
/// and/or connection.
///
/// # Arguments
///
/// * `name` - The name for the shortcut
/// * `collection_id` - Optional collection ID to open
/// * `connection_id` - Optional connection ID to connect to
/// * `description` - Optional description for the shortcut
///
/// # Returns
///
/// `Ok(String)` with the path to the created shortcut, `Err(String)` on error
///
/// # Errors
///
/// Returns an error if:
/// - The shortcut cannot be created
/// - File system permissions are insufficient
/// - The application path cannot be determined
///
/// # Example
///
/// ```javascript
/// const shortcutPath = await invoke('create_desktop_shortcut', {
///   name: 'My Server Connection',
///   collection_id: 'collection-123',
///   connection_id: 'connection-456',
///   description: 'Quick access to my server'
/// });
/// ```
async fn create_desktop_shortcut(
  name: String,
  collection_id: Option<String>,
  connection_id: Option<String>,
  description: Option<String>,
  folder_path: Option<String>,
) -> Result<String, String> {
  // Get the application executable path
  let app_path = std::env::current_exe()
    .map_err(|e| format!("Failed to get application path: {}", e))?;
  
  // Build command line arguments
  let mut args = Vec::new();
  if let Some(collection_id) = collection_id {
    args.push("--collection".to_string());
    args.push(collection_id);
  }
  if let Some(connection_id) = connection_id {
    args.push("--connection".to_string());
    args.push(connection_id);
  }
  
  let args_string = args.join(" ");
  
  #[cfg(target_os = "windows")]
  {
    use std::process::Command;
    
    // Get target path - use provided folder_path or default to desktop
    let target_dir = if let Some(ref path) = folder_path {
      std::path::PathBuf::from(path)
    } else {
      dirs::desktop_dir().ok_or("Failed to get desktop directory")?
    };
    
    // Ensure the directory exists
    if !target_dir.exists() {
      std::fs::create_dir_all(&target_dir)
        .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    
    let shortcut_path = target_dir.join(format!("{}.lnk", name));
    
    // Use PowerShell to create the shortcut
    let powershell_script = format!(
      r#"
      $WshShell = New-Object -comObject WScript.Shell
      $Shortcut = $WshShell.CreateShortcut("{}")
      $Shortcut.TargetPath = "{}"
      $Shortcut.Arguments = "{}"
      $Shortcut.WorkingDirectory = "{}"
      $Shortcut.Description = "{}"
      $Shortcut.Save()
      "#,
      shortcut_path.display(),
      app_path.display(),
      args_string,
      app_path.parent().unwrap_or(&app_path).display(),
      description.unwrap_or_else(|| format!("Launch {} with specific connection", name))
    );
    
    let output = Command::new("powershell")
      .arg("-Command")
      .arg(&powershell_script)
      .output()
      .map_err(|e| format!("Failed to create shortcut: {}", e))?;
    
    if !output.status.success() {
      return Err(format!("PowerShell command failed: {}", String::from_utf8_lossy(&output.stderr)));
    }
    
    Ok(shortcut_path.to_string_lossy().to_string())
  }
  
  #[cfg(target_os = "linux")]
  {
    use std::fs;

    // Get target path - use provided folder_path or default to desktop
    let target_dir = if let Some(ref path) = folder_path {
      std::path::PathBuf::from(path)
    } else {
      dirs::desktop_dir().ok_or("Failed to get desktop directory")?
    };
    
    // Ensure the directory exists
    if !target_dir.exists() {
      std::fs::create_dir_all(&target_dir)
        .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    
    let shortcut_path = target_dir.join(format!("{}.desktop", name));
    
    let desktop_file_content = format!(
      r#"[Desktop Entry]
Version=1.0
Type=Application
Name={}
Comment={}
Exec="{}" {}
Path={}
Terminal=false
StartupNotify=false
"#,
      name,
      description.unwrap_or_else(|| format!("Launch {} with specific connection", name)),
      app_path.display(),
      args_string,
      app_path.parent().unwrap_or(&app_path).display()
    );
    
    fs::write(&shortcut_path, desktop_file_content)
      .map_err(|e| format!("Failed to write desktop file: {}", e))?;
    
    // Make the file executable
    #[cfg(unix)]
    {
      use std::os::unix::fs::PermissionsExt;
      let mut perms = fs::metadata(&shortcut_path)
        .map_err(|e| format!("Failed to get file metadata: {}", e))?
        .permissions();
      perms.set_mode(0o755);
      fs::set_permissions(&shortcut_path, perms)
        .map_err(|e| format!("Failed to set file permissions: {}", e))?;
    }
    
    Ok(shortcut_path.to_string_lossy().to_string())
  }
  
  #[cfg(target_os = "macos")]
  {
    // For macOS, we'll create an alias using osascript
    use std::process::Command;
    
    // Get target path - use provided folder_path or default to desktop
    let target_dir = if let Some(ref path) = folder_path {
      std::path::PathBuf::from(path)
    } else {
      dirs::desktop_dir().ok_or("Failed to get desktop directory")?
    };
    
    // Ensure the directory exists
    if !target_dir.exists() {
      std::fs::create_dir_all(&target_dir)
        .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    
    let alias_name = format!("{} alias", name);
    let alias_path = target_dir.join(&alias_name);
    
    // Use AppleScript to create an alias
    let applescript = format!(
      r#"
      tell application "Finder"
        make new alias file at desktop to POSIX file "{}" with properties {{name:"{}"}}
      end tell
      "#,
      app_path.display(),
      alias_name
    );
    
    let output = Command::new("osascript")
      .arg("-e")
      .arg(&applescript)
      .output()
      .map_err(|e| format!("Failed to create alias: {}", e))?;
    
    if !output.status.success() {
      return Err(format!("AppleScript command failed: {}", String::from_utf8_lossy(&output.stderr)));
    }
    
    Ok(alias_path.to_string_lossy().to_string())
  }
  
  #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
  {
    Err("Desktop shortcuts are not supported on this platform".to_string())
  }
}

#[tauri::command]
/// Enable or disable autostart for the application.
///
/// Uses the tauri-plugin-autostart to manage system autostart entries.
///
/// # Arguments
///
/// * `enabled` - Whether to enable or disable autostart
/// * `app` - The Tauri application handle
///
/// # Returns
///
/// `Ok(())` if successful, `Err(String)` if an error occurred
async fn set_autostart(enabled: bool, app: tauri::AppHandle) -> Result<(), String> {
  use tauri_plugin_autostart::ManagerExt;
  
  let autostart_manager = app.autolaunch();
  
  if enabled {
    autostart_manager
      .enable()
      .map_err(|e| format!("Failed to enable autostart: {}", e))?;
  } else {
    autostart_manager
      .disable()
      .map_err(|e| format!("Failed to disable autostart: {}", e))?;
  }
  
  Ok(())
}

#[tauri::command]
/// Get the path to the user's Desktop directory.
fn get_desktop_path() -> Result<String, String> {
  dirs::desktop_dir()
    .map(|p| p.to_string_lossy().to_string())
    .ok_or_else(|| "Failed to get desktop directory".to_string())
}

#[tauri::command]
/// Get the path to the user's Documents directory.
fn get_documents_path() -> Result<String, String> {
  dirs::document_dir()
    .map(|p| p.to_string_lossy().to_string())
    .ok_or_else(|| "Failed to get documents directory".to_string())
}

#[tauri::command]
/// Get the path to the user's AppData (or equivalent) directory.
/// On Windows: %APPDATA%\Microsoft\Windows\Start Menu\Programs
/// On Linux: ~/.local/share/applications
/// On macOS: ~/Applications
fn get_appdata_path() -> Result<String, String> {
  #[cfg(target_os = "windows")]
  {
    dirs::data_dir()
      .map(|p| p.join("Microsoft").join("Windows").join("Start Menu").join("Programs"))
      .map(|p| p.to_string_lossy().to_string())
      .ok_or_else(|| "Failed to get appdata directory".to_string())
  }
  
  #[cfg(target_os = "linux")]
  {
    dirs::data_local_dir()
      .map(|p| p.join("applications"))
      .map(|p| p.to_string_lossy().to_string())
      .ok_or_else(|| "Failed to get applications directory".to_string())
  }
  
  #[cfg(target_os = "macos")]
  {
    dirs::home_dir()
      .map(|p| p.join("Applications"))
      .map(|p| p.to_string_lossy().to_string())
      .ok_or_else(|| "Failed to get applications directory".to_string())
  }
  
  #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
  {
    Err("AppData path not supported on this platform".to_string())
  }
}

#[tauri::command]
/// Check if a file exists at the given path.
fn check_file_exists(path: String) -> Result<bool, String> {
  Ok(std::path::Path::new(&path).exists())
}

#[tauri::command]
/// Delete a file at the given path.
fn delete_file(path: String) -> Result<(), String> {
  std::fs::remove_file(&path)
    .map_err(|e| format!("Failed to delete file: {}", e))
}

#[tauri::command]
/// Open a folder in the system's file explorer.
fn open_folder(path: String) -> Result<(), String> {
  #[cfg(target_os = "windows")]
  {
    std::process::Command::new("explorer")
      .arg(&path)
      .spawn()
      .map_err(|e| format!("Failed to open folder: {}", e))?;
  }
  
  #[cfg(target_os = "linux")]
  {
    std::process::Command::new("xdg-open")
      .arg(&path)
      .spawn()
      .map_err(|e| format!("Failed to open folder: {}", e))?;
  }
  
  #[cfg(target_os = "macos")]
  {
    std::process::Command::new("open")
      .arg(&path)
      .spawn()
      .map_err(|e| format!("Failed to open folder: {}", e))?;
  }
  
  Ok(())
}

#[tauri::command]
/// Request window attention by flashing the taskbar/dock icon.
/// Used for terminal bell notifications.
fn flash_window(app: tauri::AppHandle) -> Result<(), String> {
  if let Some(window) = app.get_webview_window("main") {
    window.request_user_attention(Some(tauri::UserAttentionType::Informational))
      .map_err(|e| format!("Failed to flash window: {}", e))?;
  }
  Ok(())
}

#[derive(serde::Serialize)]
struct ScannedShortcut {
  name: String,
  path: String,
  target: Option<String>,
  arguments: Option<String>,
  is_sortofremoteng: bool,
}

#[tauri::command]
/// Scan folders for shortcuts (non-recursive).
/// Returns a list of shortcuts found in the specified folders.
async fn scan_shortcuts(folders: Vec<String>) -> Result<Vec<ScannedShortcut>, String> {
  let mut shortcuts = Vec::new();
  
  for folder in folders {
    let folder_path = std::path::Path::new(&folder);
    if !folder_path.exists() || !folder_path.is_dir() {
      continue;
    }
    
    // Read directory entries (non-recursive)
    let entries = match std::fs::read_dir(folder_path) {
      Ok(entries) => entries,
      Err(_) => continue,
    };
    
    for entry in entries.flatten() {
      let path = entry.path();
      
      // Skip directories (non-recursive)
      if path.is_dir() {
        continue;
      }
      
      #[cfg(target_os = "windows")]
      {
        // Check for .lnk files on Windows
        if let Some(ext) = path.extension() {
          if ext.to_string_lossy().to_lowercase() == "lnk" {
            let name = path.file_stem()
              .map(|s| s.to_string_lossy().to_string())
              .unwrap_or_default();
            
            // Try to read shortcut target using PowerShell
            let (target, arguments, is_sortofremoteng) = get_shortcut_info(&path);
            
            shortcuts.push(ScannedShortcut {
              name,
              path: path.to_string_lossy().to_string(),
              target,
              arguments,
              is_sortofremoteng,
            });
          }
        }
      }
      
      #[cfg(target_os = "linux")]
      {
        // Check for .desktop files on Linux
        if let Some(ext) = path.extension() {
          if ext.to_string_lossy().to_lowercase() == "desktop" {
            let name = path.file_stem()
              .map(|s| s.to_string_lossy().to_string())
              .unwrap_or_default();
            
            // Read .desktop file to check if it's a sortOfRemoteNG shortcut
            let (target, arguments, is_sortofremoteng) = if let Ok(content) = std::fs::read_to_string(&path) {
              let exec_line = content.lines()
                .find(|line| line.starts_with("Exec="))
                .map(|line| line.trim_start_matches("Exec=").to_string());
              let is_ours = content.to_lowercase().contains("sortofremoteng");
              (exec_line.clone(), None, is_ours)
            } else {
              (None, None, false)
            };
            
            shortcuts.push(ScannedShortcut {
              name,
              path: path.to_string_lossy().to_string(),
              target,
              arguments,
              is_sortofremoteng,
            });
          }
        }
      }
      
      #[cfg(target_os = "macos")]
      {
        // Check for .app bundles or aliases on macOS
        if let Some(ext) = path.extension() {
          if ext.to_string_lossy().to_lowercase() == "app" {
            let name = path.file_stem()
              .map(|s| s.to_string_lossy().to_string())
              .unwrap_or_default();
            
            let is_sortofremoteng = name.to_lowercase().contains("sortofremoteng");
            
            shortcuts.push(ScannedShortcut {
              name,
              path: path.to_string_lossy().to_string(),
              target: None,
              arguments: None,
              is_sortofremoteng,
            });
          }
        }
      }
    }
  }
  
  Ok(shortcuts)
}

#[cfg(target_os = "windows")]
fn get_shortcut_info(path: &std::path::Path) -> (Option<String>, Option<String>, bool) {
  use std::process::Command;
  
  let powershell_script = format!(
    r#"
    $WshShell = New-Object -comObject WScript.Shell
    $Shortcut = $WshShell.CreateShortcut("{}")
    Write-Output $Shortcut.TargetPath
    Write-Output "---SEPARATOR---"
    Write-Output $Shortcut.Arguments
    "#,
    path.display()
  );
  
  match Command::new("powershell")
    .arg("-Command")
    .arg(&powershell_script)
    .output()
  {
    Ok(output) if output.status.success() => {
      let stdout = String::from_utf8_lossy(&output.stdout);
      let parts: Vec<&str> = stdout.split("---SEPARATOR---").collect();
      let target = parts.get(0).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
      let arguments = parts.get(1).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
      
      // Check if it's a sortOfRemoteNG shortcut
      let is_sortofremoteng = target.as_ref()
        .map(|t| t.to_lowercase().contains("sortofremoteng"))
        .unwrap_or(false)
        || arguments.as_ref()
          .map(|a| a.contains("--collection") || a.contains("--connection"))
          .unwrap_or(false);
      
      (target, arguments, is_sortofremoteng)
    }
    _ => (None, None, false),
  }
}
