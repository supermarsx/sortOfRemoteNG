pub use sorng_core::cpu_features;
pub use sorng_core::diagnostics;
pub use sorng_core::native_renderer;

pub use sorng_auth::auth;
pub use sorng_auth::auto_lock;
pub use sorng_auth::bearer_auth;
pub use sorng_auth::cert_auth;
pub use sorng_auth::cert_gen;
pub use sorng_auth::legacy_crypto;
pub use sorng_auth::login_detection;
pub use sorng_auth::passkey;
pub use sorng_auth::security;
pub use sorng_auth::two_factor;

pub use sorng_storage::backup;
pub use sorng_storage::storage;
pub use sorng_storage::trust_store;

pub use sorng_biometrics as biometrics;
pub use sorng_vault as vault;
pub use sorng_gpo::gpo;

pub use sorng_network::network;
pub use sorng_network::qr;
pub use sorng_network::wol;

pub use sorng_ssh::script;
pub use sorng_ssh::ssh;
pub use sorng_ssh::ssh3;
pub use sorng_sftp::sftp;

#[cfg(feature = "rdp")]
pub use sorng_rdp::gfx;
#[cfg(feature = "rdp")]
pub use sorng_rdp::h264;
#[cfg(feature = "rdp")]
pub use sorng_rdp::rdp;

#[cfg(not(feature = "rdp"))]
pub mod rdp {
    #[tauri::command]
    pub async fn connect_rdp() -> Result<(), String> { Err("RDP feature is not enabled. Rebuild with --features rdp".into()) }
    #[tauri::command]
    pub async fn disconnect_rdp() -> Result<(), String> { Err("RDP feature is not enabled".into()) }
    #[tauri::command]
    pub async fn attach_rdp_session() -> Result<(), String> { Err("RDP feature is not enabled".into()) }
    #[tauri::command]
    pub async fn detach_rdp_session() -> Result<(), String> { Err("RDP feature is not enabled".into()) }
    #[tauri::command]
    pub async fn rdp_send_input() -> Result<(), String> { Err("RDP feature is not enabled".into()) }
    #[tauri::command]
    pub async fn rdp_get_frame_data() -> Result<(), String> { Err("RDP feature is not enabled".into()) }
    #[tauri::command]
    pub async fn get_rdp_session_info() -> Result<(), String> { Err("RDP feature is not enabled".into()) }
    #[tauri::command]
    pub async fn list_rdp_sessions() -> Result<(), String> { Err("RDP feature is not enabled".into()) }
    #[tauri::command]
    pub async fn get_rdp_stats() -> Result<(), String> { Err("RDP feature is not enabled".into()) }
    #[tauri::command]
    pub async fn detect_keyboard_layout() -> Result<(), String> { Err("RDP feature is not enabled".into()) }
    #[tauri::command]
    pub async fn diagnose_rdp_connection() -> Result<(), String> { Err("RDP feature is not enabled".into()) }
    #[tauri::command]
    pub async fn rdp_sign_out() -> Result<(), String> { Err("RDP feature is not enabled".into()) }
    #[tauri::command]
    pub async fn rdp_force_reboot() -> Result<(), String> { Err("RDP feature is not enabled".into()) }
    #[tauri::command]
    pub async fn reconnect_rdp_session() -> Result<(), String> { Err("RDP feature is not enabled".into()) }
    #[tauri::command]
    pub async fn rdp_get_thumbnail() -> Result<(), String> { Err("RDP feature is not enabled".into()) }
    #[tauri::command]
    pub async fn rdp_save_screenshot() -> Result<(), String> { Err("RDP feature is not enabled".into()) }
    #[tauri::command]
    pub async fn get_rdp_logs() -> Result<(), String> { Err("RDP feature is not enabled".into()) }
}

pub use sorng_ftp::ftp;
pub use sorng_protocols::db;
pub use sorng_protocols::http;
pub use sorng_protocols::raw_socket;
pub use sorng_protocols::rlogin;
pub use sorng_serial::serial;
pub use sorng_telnet::telnet;
pub use sorng_vnc::vnc;

pub use sorng_vpn::chaining;
pub use sorng_vpn::openvpn;
pub use sorng_vpn::proxy;
pub use sorng_vpn::tailscale;
pub use sorng_vpn::wireguard;
pub use sorng_vpn::zerotier;

pub use sorng_remote_mgmt::agent;
pub use sorng_remote_mgmt::anydesk;
pub use sorng_remote_mgmt::commander;
pub use sorng_remote_mgmt::meshcentral;
pub use sorng_remote_mgmt::rpc;
pub use sorng_remote_mgmt::wmi;

pub use sorng_rustdesk::rustdesk;
pub use sorng_bitwarden::bitwarden;
pub use sorng_keepass::keepass;
pub use sorng_passbolt::passbolt;
pub use sorng_scp::scp;

pub use sorng_mongodb::mongodb;
pub use sorng_mssql::mssql;
pub use sorng_mysql::mysql;
pub use sorng_postgres::postgres;
pub use sorng_redis::redis_impl as redis;
pub use sorng_sqlite::sqlite;

pub use sorng_ai_agent::ai_agent;
pub use sorng_1password::onepassword;
pub use sorng_lastpass::lastpass;
pub use sorng_google_passwords::google_passwords;
pub use sorng_dashlane::dashlane;
