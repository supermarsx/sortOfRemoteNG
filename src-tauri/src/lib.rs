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
        vnc::connect_vnc,
        vnc::disconnect_vnc,
        vnc::get_vnc_session_info,
        db::connect_mysql,
        db::execute_query,
        db::disconnect_db,
        ftp::connect_ftp,
        ftp::list_files,
        ftp::ftp_upload_file,
        ftp::ftp_download_file,
        ftp::disconnect_ftp,
        network::ping_host,
        network::scan_network,
        security::generate_totp_secret,
        security::verify_totp,
        wol::wake_on_lan,
        script::execute_user_script
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
