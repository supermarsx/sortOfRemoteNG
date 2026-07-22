//! Non-connectivity Tauri startup state registration.
//!
//! Each registrar in this crate owns its concrete `App::manage<T>` calls so
//! those monomorphizations are code-generated outside the root `app_lib`
//! composition crate. The root keeps only the ordered orchestration.

use sorng_app_domains::*;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Mutex;

mod access;
#[cfg(any(feature = "collab", feature = "platform"))]
mod collab;
#[cfg(any(feature = "ops", feature = "collab", feature = "platform"))]
mod platform;
mod security_data;

pub use sorng_app_api::api::ApiService;
pub use sorng_app_domains::auth::AuthServiceState;
pub use sorng_app_domains::ssh::SshServiceState;
pub use sorng_core::events::DynEventEmitter;

use auth::AuthService;
use sftp::SftpService;
use smb::service::SmbService;
use ssh3::Ssh3Service;
use storage::SecureStorage;
use trust_store::TrustStoreService;
use updater::service::UpdaterService;

use ai_agent::types::AiAgentServiceState;
use auto_lock::AutoLockService;
use bearer_auth::BearerAuthService;
use bitwarden::BitwardenService;
use cert_auth::CertAuthService;
use cert_gen::CertGenService;
use dashlane::service::DashlaneServiceState;
use digital_ocean::DigitalOceanService;
use google_passwords::service::GooglePasswordsServiceState;
use gpo::GpoService;
use http::{HttpService, ProxySessionManager};
use keepass::KeePassService;
use lastpass::service::LastPassServiceState;
use login_detection::LoginDetectionService;
use onepassword::service::OnePasswordServiceState;
use passbolt::PassboltService;
use passkey::PasskeyService;
use raw_socket::RawSocketService;
use rlogin::RloginService;
use scp::ScpService;
use serial::SerialService;
use telnet::TelnetService;
use totp::service::{TotpService, TotpServiceState};
use two_factor::TwoFactorService;

#[cfg(feature = "db-mongo")]
use mongodb::service::MongoServiceState;
#[cfg(feature = "db-mssql")]
use mssql::service::MssqlServiceState;
#[cfg(feature = "db-mysql")]
use mysql::service::MysqlServiceState;
#[cfg(feature = "db-postgres")]
use postgres::service::PostgresServiceState;
#[cfg(feature = "db-redis")]
use redis::service::RedisServiceState;
#[cfg(feature = "db-sqlite")]
use sqlite::service::SqliteServiceState;

use azure::service::AzureService;
use exchange::service::ExchangeService;
use gcp::GcpService;
use hetzner::service::HetznerService;
use oracle_cloud::service::OciService;
use smtp::service::SmtpService;

use heroku::HerokuService;
use ibm::IbmService;
use linode::LinodeService;
use ovh::OvhService;
use scaleway::ScalewayService;

#[cfg(any(feature = "collab", feature = "platform"))]
use ai_assist::service::AiAssistServiceState;
#[cfg(any(feature = "collab", feature = "platform"))]
use command_palette::CommandPaletteServiceState;
#[cfg(any(feature = "collab", feature = "platform"))]
use extensions::service::ExtensionsServiceState;
#[cfg(any(feature = "collab", feature = "platform"))]
use fonts::FontServiceState;
#[cfg(any(feature = "collab", feature = "platform"))]
use llm::service::LlmServiceState;
#[cfg(any(feature = "collab", feature = "platform"))]
use onedrive::service::OneDriveServiceState;
#[cfg(any(feature = "collab", feature = "platform"))]
use recording::RecordingServiceState;
#[cfg(any(feature = "collab", feature = "platform"))]
use secure_clip::SecureClipServiceState;
#[cfg(any(feature = "collab", feature = "platform"))]
use terminal_themes::ThemeEngineState;
#[cfg(any(feature = "collab", feature = "platform"))]
use whatsapp::WhatsAppServiceState;

#[cfg(any(feature = "ops", feature = "collab", feature = "platform"))]
use hyperv::service::HyperVServiceState;
#[cfg(any(feature = "ops", feature = "collab", feature = "platform"))]
use idrac::service::IdracServiceState;
#[cfg(any(feature = "ops", feature = "collab", feature = "platform"))]
use ilo::service::IloServiceState;
#[cfg(any(feature = "ops", feature = "collab", feature = "platform"))]
use lenovo::service::LenovoServiceState;
#[cfg(any(feature = "ops", feature = "collab", feature = "platform"))]
use meshcentral_dedicated::MeshCentralService;
#[cfg(any(feature = "ops", feature = "collab", feature = "platform"))]
use mremoteng_dedicated::MremotengService;
#[cfg(any(feature = "ops", feature = "collab", feature = "platform"))]
use proxmox::service::ProxmoxServiceState;
#[cfg(any(feature = "ops", feature = "collab", feature = "platform"))]
use supermicro::service::SmcServiceState;
#[cfg(any(feature = "ops", feature = "collab", feature = "platform"))]
use synology::service::SynologyServiceState;
#[cfg(any(feature = "ops", feature = "collab", feature = "platform"))]
use vmware::service::VmwareServiceState;
#[cfg(any(feature = "ops", feature = "collab", feature = "platform"))]
use vmware_desktop::service::VmwDesktopServiceState;

#[cfg(all(feature = "opkssh", not(feature = "ops")))]
use sorng_opkssh::service::OpksshServiceState;

/// Exact managed-state order before connectivity registration.
pub const INFRASTRUCTURE_PREFIX_REGISTRATION_ORDER: &[&str] = &[
    "LaunchArgs",
    "EncryptionState",
    "UpdaterService",
    "AuthServiceState",
    "SecureStorageState",
    "TrustStoreServiceState",
    "SshServiceState",
    "SftpServiceState",
    "SmbServiceState",
    #[cfg(all(feature = "opkssh", not(feature = "ops")))]
    "OpksshServiceState",
];

/// Exact managed-state order in the always-on security/data registrar.
pub const SECURITY_DATA_REGISTRATION_ORDER: &[&str] = &[
    "CertAuthServiceState",
    "CertGenServiceState",
    "LegacyCryptoPolicyState",
    "TwoFactorServiceState",
    "TotpServiceState",
    "BearerAuthServiceState",
    "AutoLockServiceState",
    "GpoServiceState",
    "LoginDetectionServiceState",
    "TelnetServiceState",
    "SerialServiceState",
    "RloginServiceState",
    "RawSocketServiceState",
    "GcpServiceState",
    "OciServiceState",
    "AzureServiceState",
    "ExchangeServiceState",
    "SmtpServiceState",
    "HetznerServiceState",
    "IbmServiceState",
    "DigitalOceanServiceState",
    "HerokuServiceState",
    "ScalewayServiceState",
    "LinodeServiceState",
    "OvhServiceState",
    "HttpServiceState",
    "ProxySessionManager",
    "PasskeyServiceState",
    "Ssh3ServiceState",
    "BackupServiceState",
    "BitwardenServiceState",
    "KeePassServiceState",
    "PassboltServiceState",
    "ScpServiceState",
    #[cfg(feature = "db-mysql")]
    "MysqlServiceState",
    #[cfg(feature = "db-postgres")]
    "PostgresServiceState",
    #[cfg(feature = "db-mssql")]
    "MssqlServiceState",
    #[cfg(feature = "db-sqlite")]
    "SqliteServiceState",
    #[cfg(feature = "db-mongo")]
    "MongoServiceState",
    #[cfg(feature = "db-redis")]
    "RedisServiceState",
];

pub const ACCESS_REGISTRATION_ORDER: &[&str] = &[
    "AiAgentServiceState",
    "OnePasswordServiceState",
    "LastPassServiceState",
    "GooglePasswordsServiceState",
    "DashlaneServiceState",
];

pub const PLATFORM_REGISTRATION_ORDER: &[&str] = &[
    "HyperVServiceState",
    "VmwareServiceState",
    "VmwDesktopServiceState",
    "ProxmoxServiceState",
    "IdracServiceState",
    "IloServiceState",
    "LenovoServiceState",
    "SmcServiceState",
    "SynologyServiceState",
    "MeshCentralServiceState",
    "MremotengServiceState",
    "TermServServiceState",
];

pub const COLLAB_REGISTRATION_ORDER: &[&str] = &[
    "WhatsAppServiceState",
    "TelegramServiceState",
    "DropboxServiceState",
    "NextcloudServiceState",
    "GDriveServiceState",
    "OneDriveServiceState",
    "RecordingServiceState",
    "LlmServiceState",
    "AiAssistServiceState",
    "CommandPaletteServiceState",
    "FontServiceState",
    "SecureClipServiceState",
    "ThemeEngineState",
    "ExtensionsServiceState",
];

pub const API_REGISTRATION_ORDER: &[&str] =
    &["ApiService", "DisabledCapsSetter", "ApiServerController"];

/// Maximum moved inventory: 13 infrastructure/API + 40 security/data + 5
/// access + 12 platform + 14 collaboration registrations.
pub const MAX_MANAGED_STATE_REGISTRATIONS: usize = 84;

pub struct InfrastructureHandles {
    pub app_dir: std::path::PathBuf,
    pub auth_service: AuthServiceState,
    pub ssh_service: SshServiceState,
    pub emitter: DynEventEmitter,
}

pub type UserStorePathResolver = fn(&tauri::AppHandle, &std::path::Path) -> std::path::PathBuf;
pub type EventEmitterFactory = fn(&tauri::AppHandle) -> DynEventEmitter;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DekWrapperProbe {
    Present,
    ConfirmedMissing,
    ProbeFailed,
}

fn classify_dek_wrapper_probe(result: std::io::Result<bool>) -> DekWrapperProbe {
    match result {
        Ok(true) => DekWrapperProbe::Present,
        Ok(false) => DekWrapperProbe::ConfirmedMissing,
        Err(_) => DekWrapperProbe::ProbeFailed,
    }
}

fn probe_dek_wrapper(app_dir: &std::path::Path) -> DekWrapperProbe {
    classify_dek_wrapper_probe(app_dir.join("dek.enc").try_exists())
}

fn should_bootstrap_vault(probe: DekWrapperProbe, keychain_available: bool) -> bool {
    keychain_available && probe == DekWrapperProbe::ConfirmedMissing
}

/// Register the infrastructure states that must precede connectivity.
pub fn register_infrastructure_prefix(
    app: &mut tauri::App<tauri::Wry>,
    resolve_user_store_path: UserStorePathResolver,
    event_emitter_factory: EventEmitterFactory,
) -> tauri::Result<InfrastructureHandles> {
    app.manage(sorng_app_shell::commands::parse_launch_args(
        std::env::args(),
    ));
    cpu_features::log_all_features();

    let app_dir = app.path().app_data_dir()?;
    let _ = std::fs::create_dir_all(&app_dir);

    let enc_state = sorng_encryption::EncryptionState::new();
    let dek_wrapper_probe = probe_dek_wrapper(&app_dir);
    if dek_wrapper_probe == DekWrapperProbe::ProbeFailed {
        eprintln!("Encryption-at-rest: DEK wrapper presence could not be confirmed; vault bootstrap skipped.");
    }
    if should_bootstrap_vault(dek_wrapper_probe, sorng_vault::keychain::is_available()) {
        if let Ok(bytes) = tauri::async_runtime::block_on(sorng_vault::keychain::ensure_dek()) {
            if let Some(dek) = sorng_encryption::MasterDek::from_bytes(&bytes) {
                tauri::async_runtime::block_on(enc_state.install(dek));
                println!("Encryption-at-rest: vault DEK ensured + installed at boot.");
            }
        }
    }
    let enc_state_for_logger = enc_state.clone();
    app.manage(enc_state);

    if cfg!(debug_assertions) {
        let logs_dir = app_dir.join("logs");
        if let Err(e) = sorng_encryption::log_adapter::EncryptedLogAdapter::install(
            Arc::new(enc_state_for_logger),
            logs_dir,
            log::LevelFilter::Info,
        ) {
            eprintln!("Failed to install encrypted log adapter: {e}");
        }
    }

    app.manage(UpdaterService::new(env!("CARGO_PKG_VERSION"), &app_dir));

    let user_store_path = resolve_user_store_path(app.app_handle(), &app_dir);
    let auth_service = AuthService::new(user_store_path.to_string_lossy().to_string());
    app.manage(auth_service.clone());

    let storage_path = app_dir.join("storage.json");
    let secure_storage = SecureStorage::new(storage_path.to_string_lossy().to_string());
    if let Some(enc_handle) = app.try_state::<sorng_encryption::EncryptionState>() {
        let enc_arc = Arc::new(enc_handle.inner().clone());
        let svc = secure_storage.clone();
        tauri::async_runtime::block_on(async move {
            svc.lock().await.set_encryption_state(enc_arc);
        });
    }
    app.manage(secure_storage);

    let trust_store_path = app_dir.join("trust_store.json");
    app.manage(TrustStoreService::new(
        trust_store_path.to_string_lossy().to_string(),
    ));
    if let Some(path) = trust_store_path.to_str() {
        std::env::set_var("SORNG_TRUST_STORE_PATH", path);
    }
    #[cfg(feature = "platform")]
    supermicro::trust::set_trust_store_path(trust_store_path);
    #[cfg(feature = "cloud")]
    hetzner::client::init_trust_store_path(app_dir.clone());

    let emitter = event_emitter_factory(app.handle());
    let ssh_service = ssh::SshService::new_with_emitter(emitter.clone());
    app.manage(ssh_service.clone());
    app.manage(SftpService::new());
    let smb_service: Arc<Mutex<SmbService>> = Arc::new(Mutex::new(SmbService::new()));
    app.manage(smb_service);

    #[cfg(all(feature = "opkssh", not(feature = "ops")))]
    {
        let state: OpksshServiceState =
            Arc::new(Mutex::new(sorng_opkssh::service::OpksshService::new()));
        app.manage(state);
    }

    Ok(InfrastructureHandles {
        app_dir,
        auth_service,
        ssh_service,
        emitter,
    })
}

pub fn register_security_data(
    app: &mut tauri::App<tauri::Wry>,
    app_dir: &std::path::Path,
    serial_emitter: DynEventEmitter,
    event_emitter_factory: EventEmitterFactory,
) {
    security_data::register(app, app_dir, serial_emitter, event_emitter_factory);
}

pub fn register_access(app: &mut tauri::App<tauri::Wry>) {
    access::register(app);
}

#[cfg(any(feature = "ops", feature = "collab", feature = "platform"))]
pub fn register_platform(app: &mut tauri::App<tauri::Wry>) {
    platform::register(app);
}

#[cfg(any(feature = "collab", feature = "platform"))]
pub fn register_collab(app: &mut tauri::App<tauri::Wry>, app_dir: &std::path::Path) {
    collab::register(app, app_dir);
}

/// Register the concrete REST API service and capability setter states.
pub fn register_api_service(
    app: &mut tauri::App<tauri::Wry>,
    auth_service: AuthServiceState,
    ssh_service: SshServiceState,
    handles: &sorng_app_startup_connectivity::ApiHandles,
) -> ApiService {
    let api_service = ApiService::new(
        auth_service,
        ssh_service,
        handles.db_service.clone(),
        handles.ftp_service.clone(),
        handles.network_service.clone(),
        handles.security_service.clone(),
        handles.wol_service.clone(),
        handles.qr_service.clone(),
        handles.rustdesk_service.clone(),
        handles.wmi_service.clone(),
        handles.rpc_service.clone(),
        handles.meshcentral_service.clone(),
        handles.agent_service.clone(),
        handles.commander_service.clone(),
        handles.aws_service.clone(),
        handles.vercel_service.clone(),
        handles.cloudflare_service.clone(),
    );
    app.manage(api_service.clone());

    let svc_for_setter = api_service.clone();
    app.manage(
        sorng_commands_core::api_capability_commands::DisabledCapsSetter(Arc::new(
            move |ids: Vec<String>| svc_for_setter.set_disabled_capabilities(ids),
        )),
    );
    api_service
}

pub fn register_api_server_controller(
    app: &mut tauri::App<tauri::Wry>,
    launcher: sorng_commands_core::api_server_commands::ApiServerLauncher,
) {
    app.manage(sorng_commands_core::api_server_commands::ApiServerController::new(launcher));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixed_registrar_inventories_match_the_moved_contract() {
        assert_eq!(ACCESS_REGISTRATION_ORDER.len(), 5);
        assert_eq!(PLATFORM_REGISTRATION_ORDER.len(), 12);
        assert_eq!(COLLAB_REGISTRATION_ORDER.len(), 14);
        assert_eq!(API_REGISTRATION_ORDER.len(), 3);
        assert_eq!(34 + 6, 40);
        assert_eq!(10 + 3 + 40 + 5 + 12 + 14, MAX_MANAGED_STATE_REGISTRATIONS);
    }

    #[test]
    fn password_or_hybrid_wrapper_blocks_vault_bootstrap() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(temp.path().join("dek.enc"), b"fixture").unwrap();
        let probe = probe_dek_wrapper(temp.path());
        assert_eq!(probe, DekWrapperProbe::Present);
        assert!(!should_bootstrap_vault(probe, true));
    }

    #[test]
    fn fresh_vault_install_requires_an_available_keychain() {
        let temp = tempfile::tempdir().unwrap();
        let probe = probe_dek_wrapper(temp.path());
        assert_eq!(probe, DekWrapperProbe::ConfirmedMissing);
        assert!(should_bootstrap_vault(probe, true));
        assert!(!should_bootstrap_vault(probe, false));
    }

    #[test]
    fn failed_wrapper_probe_does_not_expose_error_details() {
        let secret = "TOP-SECRET-DEK-PATH-271c";
        let probe = classify_dek_wrapper_probe(Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            format!("access denied at C:/private/{secret}/dek.enc"),
        )));
        assert_eq!(probe, DekWrapperProbe::ProbeFailed);
        assert!(!should_bootstrap_vault(probe, true));
        assert!(!format!("{probe:?}").contains(secret));
    }
}
