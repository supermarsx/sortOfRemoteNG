//! # SortOfRemote NG
//!
//! A comprehensive remote connectivity and management application built with Tauri and Rust.
//! This application provides a unified interface for managing various types of remote connections
//! including SSH, RDP, VNC, databases, FTP, and network services.
//!
//! ## Architecture
//!
//! The application is structured around service-based architecture where each connectivity
//! protocol is handled by a dedicated service. Services are managed through Tauri's state
//! management system and exposed to the frontend via Tauri commands.
//!
//! ## Services
//!
//! - **AuthService**: User authentication and authorization
//! - **SecureStorage**: Encrypted data persistence
//! - **SshService**: SSH connection management
//! - **RdpService**: RDP connection management
//! - **VncService**: VNC connection management
//! - **DbService**: Database connectivity (MySQL, PostgreSQL, etc.)
//! - **FtpService**: FTP/SFTP file transfer
//! - **NetworkService**: Network utilities (ping, scanning)
//! - **SecurityService**: Security utilities (TOTP, encryption)
//! - **WolService**: Wake-on-LAN functionality
//! - **ScriptService**: User script execution
//! - **OpenVPNService**: OpenVPN connection management
//! - **ProxyService**: Proxy server management and chaining
//! - **WireGuardService**: WireGuard VPN management
//! - **ZeroTierService**: ZeroTier network management
//! - **TailscaleService**: Tailscale VPN management
//! - **ChainingService**: Connection chaining and routing
//!
//! ## Features
//!
//! - Multi-protocol remote connectivity
//! - Secure credential storage with encryption
//! - Connection chaining and proxy routing
//! - User authentication and access control
//! - Network discovery and scanning
//! - File transfer capabilities
//! - Script execution and automation

pub mod auth;
pub mod storage;
pub mod ssh;
pub mod rdp;
pub mod vnc;
pub mod db;
pub mod ftp;
pub mod network;
pub mod security;
pub mod wol;
pub mod script;
pub mod openvpn;
pub mod proxy;
pub mod wireguard;
pub mod zerotier;
pub mod tailscale;
pub mod chaining;
pub mod qr;
pub mod anydesk;
pub mod api;
pub mod rustdesk;
pub mod wmi;
pub mod rpc;
pub mod meshcentral;
pub mod agent;
pub mod commander;
pub mod aws;
pub mod vercel;
pub mod cloudflare;
pub mod cert_auth;
pub mod two_factor;
pub mod bearer_auth;
pub mod auto_lock;
pub mod gpo;
pub mod login_detection;
pub mod telnet;
pub mod serial;
pub mod rlogin;
pub mod raw_socket;
pub mod gcp;
pub mod azure;
pub mod ibm;
pub mod digital_ocean;
pub mod heroku;
pub mod scaleway;
pub mod linode;
pub mod ovh;
pub mod http;
pub mod passkey;

#[cfg(test)]
mod tests {
    mod security_tests;
    mod network_tests;
    mod script_tests;
}

use auth::{AuthService, AuthServiceState};
use storage::SecureStorage;
use ssh::SshService;
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
use passkey::PasskeyService;

use std::sync::Arc;
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

      // Initialize RDP service
      let rdp_service = RdpService::new();
      app.manage(rdp_service);

      // Initialize VNC service
      let vnc_service = VncService::new();
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

      // Initialize Passkey service
      let passkey_service = PasskeyService::new();
      app.manage(passkey_service.clone());

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
        rdp::get_rdp_session_info,
        rdp::list_rdp_sessions,
        vnc::connect_vnc,
        vnc::disconnect_vnc,
        vnc::get_vnc_session_info,
        vnc::list_vnc_sessions,
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
        ftp::connect_ftp,
        ftp::list_files,
        ftp::ftp_upload_file,
        ftp::ftp_download_file,
        ftp::disconnect_ftp,
        ftp::get_ftp_session_info,
        ftp::list_ftp_sessions,
        ftp::connect_sftp,
        ftp::list_sftp_files,
        ftp::disconnect_sftp,
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
        aws::list_rds_instances,
        aws::list_lambda_functions,
        aws::get_cloudwatch_metrics,
        aws::execute_ec2_action,
        aws::create_s3_bucket,
        aws::invoke_lambda_function,
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
        // NOTE: pause_shell and resume_shell removed - buffer always captures full session
        http::http_fetch,
        http::http_get,
        http::http_post,
        http::start_basic_auth_proxy,
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
        // telnet::connect_telnet,
        // telnet::disconnect_telnet,
        // telnet::send_telnet_command,
        // telnet::get_telnet_session_info,
        // telnet::list_telnet_sessions,
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
