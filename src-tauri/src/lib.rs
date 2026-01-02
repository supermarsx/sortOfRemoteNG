mod auth;
mod storage;
mod ssh;
mod rdp;
mod vnc;
mod db;
mod ftp;
mod network;
mod security;
mod wol;
mod script;
mod openvpn;
mod proxy;
mod wireguard;
mod zerotier;
mod tailscale;
mod chaining;

use auth::{AuthService, AuthServiceState};
use storage::{SecureStorage, StorageData, SecureStorageState};
use ssh::{SshService, SshServiceState};
use rdp::{RdpService, RdpServiceState};
use vnc::{VncService, VncServiceState};
use db::{DbService, DbServiceState};
use ftp::{FtpService, FtpServiceState};
use network::{NetworkService, NetworkServiceState};
use security::{SecurityService, SecurityServiceState};
use wol::{WolService, WolServiceState};
use script::{ScriptService, ScriptServiceState};
use openvpn::{OpenVPNService, OpenVPNServiceState};
use proxy::{ProxyService, ProxyServiceState};
use wireguard::{WireGuardService, WireGuardServiceState};
use zerotier::{ZeroTierService, ZeroTierServiceState};
use tailscale::{TailscaleService, TailscaleServiceState};
use chaining::{ChainingService, ChainingServiceState};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
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
      app.manage(auth_service);

      // Initialize storage
      let storage_path = app_dir.join("storage.json");
      let secure_storage = SecureStorage::new(storage_path.to_string_lossy().to_string());
      app.manage(secure_storage);

      // Initialize SSH service
      let ssh_service = SshService::new();
      app.manage(ssh_service);

      // Initialize RDP service
      let rdp_service = RdpService::new();
      app.manage(rdp_service);

      // Initialize VNC service
      let vnc_service = VncService::new();
      app.manage(vnc_service);

      // Initialize DB service
      let db_service = DbService::new();
      app.manage(db_service);

      // Initialize FTP service
      let ftp_service = FtpService::new();
      app.manage(ftp_service);

      // Initialize Network service
      let network_service = NetworkService::new();
      app.manage(network_service);

      // Initialize Security service
      let security_service = SecurityService::new();
      app.manage(security_service);

      // Initialize WOL service
      let wol_service = WolService::new();
      app.manage(wol_service);

      // Initialize Script service
      let script_service = ScriptService::new();
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

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
        greet,
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
        ftp::connect_ftp,
        ftp::list_files,
        ftp::ftp_upload_file,
        ftp::ftp_download_file,
        ftp::disconnect_ftp,
        ftp::get_ftp_session_info,
        ftp::list_ftp_sessions,
        network::ping_host,
        network::scan_network,
        security::generate_totp_secret,
        security::verify_totp,
        wol::wake_on_lan,
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
        chaining::update_connection_chain_layers
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

#[tauri::command]
fn greet(name: &str) -> String {
  format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn add_user(
  username: String,
  password: String,
  auth_service: tauri::State<'_, AuthServiceState>,
) -> Result<(), String> {
  let mut service = auth_service.lock().await;
  service.add_user(username, password).await
}

#[tauri::command]
async fn verify_user(
  username: String,
  password: String,
  auth_service: tauri::State<'_, AuthServiceState>,
) -> Result<bool, String> {
  let service = auth_service.lock().await;
  service.verify_user(&username, &password).await
}

#[tauri::command]
async fn list_users(auth_service: tauri::State<'_, AuthServiceState>) -> Result<Vec<String>, String> {
  let service = auth_service.lock().await;
  Ok(service.list_users().await)
}

#[tauri::command]
async fn remove_user(
  username: String,
  auth_service: tauri::State<'_, AuthServiceState>,
) -> Result<bool, String> {
  let mut service = auth_service.lock().await;
  service.remove_user(username).await
}

#[tauri::command]
async fn update_password(
  username: String,
  new_password: String,
  auth_service: tauri::State<'_, AuthServiceState>,
) -> Result<bool, String> {
  let mut service = auth_service.lock().await;
  service.update_password(username, new_password).await
}
