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
pub use sorng_auth::two_factor;
pub use sorng_auth::bearer_auth;
pub use sorng_auth::passkey;
pub use sorng_auth::login_detection;
pub use sorng_auth::auto_lock;

// Storage
pub use sorng_storage::storage;
pub use sorng_storage::backup;

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
pub use sorng_protocols::serial;
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
pub use sorng_cloud::gcp;
pub use sorng_cloud::azure;
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

// MeshCentral (dedicated crate)
pub use sorng_meshcentral::meshcentral as meshcentral_dedicated;

// mRemoteNG import/export (dedicated crate)
pub use sorng_mremoteng::mremoteng as mremoteng_dedicated;

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
use two_factor::TwoFactorService;
use bearer_auth::BearerAuthService;
use auto_lock::AutoLockService;
use gpo::GpoService;
use login_detection::LoginDetectionService;
use telnet::TelnetService;
use serial::SerialService;
use rlogin::RloginService;
use raw_socket::RawSocketService;
use gcp::GcpService;
use azure::AzureService;
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
use meshcentral_dedicated::MeshCentralService;
use mremoteng_dedicated::MremotengService;

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
      // Initialize auth service
      let app_dir = app.path().app_data_dir().unwrap();
      let user_store_path = app_dir.join("users.json");
      let auth_service = AuthService::new(user_store_path.to_string_lossy().to_string());
      app.manage(auth_service.clone());

      // Initialize storage
      let storage_path = app_dir.join("storage.json");
      let secure_storage = SecureStorage::new(storage_path.to_string_lossy().to_string());
      app.manage(secure_storage);

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
      let ai_agent_service: AiAgentServiceState = ai_agent::service::AiAgentService::new();
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

      // Initialize MeshCentral service
      let meshcentral_service = MeshCentralService::new();
      app.manage(meshcentral_service);

      // Initialize mRemoteNG import/export service
      let mremoteng_service = MremotengService::new();
      app.manage(mremoteng_service);

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
        ssh::get_terminal_buffer,
        ssh::clear_terminal_buffer,
        ssh::is_session_alive,
        ssh::get_shell_info,
        ssh::reattach_session,
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
        // Authentication services - commented out until Tauri integration is complete
        // cert_auth::parse_certificate,
        // cert_auth::validate_certificate,
        // cert_auth::authenticate_with_cert,
        // cert_auth::register_certificate,
        // cert_auth::list_certificates,
        // cert_auth::revoke_certificate,
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
        // serial::connect_serial,
        // serial::disconnect_serial,
        // serial::send_serial_data,
        // serial::get_serial_session_info,
        // serial::list_serial_sessions,
        // serial::list_available_serial_ports,
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
        gcp::list_gcp_instances,
        gcp::get_gcp_session,
        gcp::list_gcp_sessions,
        azure::connect_azure,
        azure::disconnect_azure,
        azure::list_azure_virtual_machines,
        azure::get_azure_session,
        azure::list_azure_sessions,
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
        ai_agent::commands::ai_register_provider,
        ai_agent::commands::ai_remove_provider,
        ai_agent::commands::ai_list_providers,
        ai_agent::commands::ai_list_models,
        ai_agent::commands::ai_health_check,
        ai_agent::commands::ai_chat,
        ai_agent::commands::ai_chat_stream_start,
        ai_agent::commands::ai_chat_stream_poll,
        ai_agent::commands::ai_chat_stream_cancel,
        ai_agent::commands::ai_create_conversation,
        ai_agent::commands::ai_get_conversation,
        ai_agent::commands::ai_list_conversations,
        ai_agent::commands::ai_delete_conversation,
        ai_agent::commands::ai_rename_conversation,
        ai_agent::commands::ai_fork_conversation,
        ai_agent::commands::ai_send_message,
        ai_agent::commands::ai_add_user_message,
        ai_agent::commands::ai_remove_message,
        ai_agent::commands::ai_edit_message,
        ai_agent::commands::ai_search_conversations,
        ai_agent::commands::ai_toggle_pin_conversation,
        ai_agent::commands::ai_toggle_archive_conversation,
        ai_agent::commands::ai_export_conversation,
        ai_agent::commands::ai_run_agent,
        ai_agent::commands::ai_list_tools,
        ai_agent::commands::ai_execute_tool,
        ai_agent::commands::ai_list_templates,
        ai_agent::commands::ai_get_template,
        ai_agent::commands::ai_create_template,
        ai_agent::commands::ai_delete_template,
        ai_agent::commands::ai_render_template,
        ai_agent::commands::ai_count_tokens,
        ai_agent::commands::ai_count_message_tokens,
        ai_agent::commands::ai_set_budget,
        ai_agent::commands::ai_get_budget_status,
        ai_agent::commands::ai_get_global_usage,
        ai_agent::commands::ai_reset_global_usage,
        ai_agent::commands::ai_generate_embeddings,
        ai_agent::commands::ai_vector_upsert,
        ai_agent::commands::ai_vector_search,
        ai_agent::commands::ai_vector_list_collections,
        ai_agent::commands::ai_vector_drop_collection,
        ai_agent::commands::ai_rag_create_pipeline,
        ai_agent::commands::ai_rag_ingest_document,
        ai_agent::commands::ai_rag_list_documents,
        ai_agent::commands::ai_code_assist,
        ai_agent::commands::ai_code_generate,
        ai_agent::commands::ai_code_review,
        ai_agent::commands::ai_code_explain,
        ai_agent::commands::ai_create_workflow,
        ai_agent::commands::ai_list_workflows,
        ai_agent::commands::ai_get_workflow,
        ai_agent::commands::ai_delete_workflow,
        ai_agent::commands::ai_run_workflow,
        ai_agent::commands::ai_get_workflow_progress,
        ai_agent::commands::ai_memory_list_keys,
        ai_agent::commands::ai_memory_clear,
        ai_agent::commands::ai_memory_clear_all,
        ai_agent::commands::ai_get_settings,
        ai_agent::commands::ai_update_settings,
        ai_agent::commands::ai_diagnostics,
        ai_agent::commands::ai_estimate_cost,

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
  let service = auth_service.lock().await;
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
