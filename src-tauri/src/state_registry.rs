pub(crate) use crate::*;
pub(crate) use std::sync::Arc;
pub(crate) use tauri::Manager;
pub(crate) use tokio::sync::Mutex;

pub(crate) use about::service::AboutServiceState;
pub(crate) use ai_agent::types::AiAgentServiceState;
pub(crate) use ai_assist::service::AiAssistServiceState;
pub(crate) use amavis::service::AmavisServiceState;
pub(crate) use ansible::service::AnsibleServiceState;
pub(crate) use anydesk::AnyDeskService;
pub(crate) use apache::service::ApacheServiceState;
pub(crate) use api::ApiService;
pub(crate) use auth::AuthService;
pub(crate) use auto_lock::AutoLockService;
pub(crate) use azure::service::AzureService;
pub(crate) use bearer_auth::BearerAuthService;
pub(crate) use bitwarden::BitwardenService;
pub(crate) use bootloader::service::BootloaderServiceState;
pub(crate) use budibase::service::BudibaseServiceState;
pub(crate) use caddy::service::CaddyServiceState;
pub(crate) use cert_auth::CertAuthService;
pub(crate) use cert_gen::CertGenService;
pub(crate) use chaining::ChainingService;
pub(crate) use clamav::service::ClamavServiceState;
pub(crate) use command_palette::CommandPaletteServiceState;
pub(crate) use cpanel::service::CpanelServiceState;
pub(crate) use cron::service::CronServiceState;
pub(crate) use cyrus_sasl::service::CyrusSaslServiceState;
pub(crate) use dashlane::service::DashlaneServiceState;
pub(crate) use db::DbService;
pub(crate) use digital_ocean::DigitalOceanService;
pub(crate) use docker::service::DockerServiceState;
pub(crate) use dovecot::service::DovecotServiceState;
pub(crate) use exchange::service::ExchangeService;
pub(crate) use extensions::service::ExtensionsServiceState;
pub(crate) use fonts::FontServiceState;
pub(crate) use ftp::FtpService;
pub(crate) use gcp::GcpService;
pub(crate) use google_passwords::service::GooglePasswordsServiceState;
pub(crate) use gpo::GpoService;
pub(crate) use grafana::service::GrafanaServiceState;
pub(crate) use haproxy::service::HaproxyServiceState;
pub(crate) use heroku::HerokuService;
pub(crate) use http::HttpService;
pub(crate) use http::ProxySessionManager;
pub(crate) use hyperv::service::HyperVServiceState;
pub(crate) use i18n::I18nServiceState;
pub(crate) use ibm::IbmService;
pub(crate) use idrac::service::IdracServiceState;
pub(crate) use ilo::service::IloServiceState;
pub(crate) use jira::service::JiraServiceState;
pub(crate) use k8s::service::K8sServiceState;
pub(crate) use keepass::KeePassService;
pub(crate) use kernel_mgmt::service::KernelServiceState;
pub(crate) use lastpass::service::LastPassServiceState;
pub(crate) use lenovo::service::LenovoServiceState;
pub(crate) use linode::LinodeService;
pub(crate) use llm::service::LlmServiceState;
pub(crate) use login_detection::LoginDetectionService;
pub(crate) use lxd::service::LxdService;
pub(crate) use mailcow::service::MailcowServiceState;
pub(crate) use mcp_server::McpServiceState as McpServerServiceState;
pub(crate) use meshcentral_dedicated::MeshCentralService;
pub(crate) use mongodb::service::MongoServiceState;
pub(crate) use mremoteng_dedicated::MremotengService;
pub(crate) use mssql::service::MssqlServiceState;
pub(crate) use mysql::service::MysqlServiceState;
pub(crate) use mysql_admin::service::MysqlServiceState as MysqlAdminServiceState;
pub(crate) use netbox::service::NetboxServiceState;
pub(crate) use network::NetworkService;
pub(crate) use nginx::service::NginxServiceState;
pub(crate) use nginx_proxy_mgr::service::NpmServiceState;
pub(crate) use onepassword::service::OnePasswordServiceState;
pub(crate) use opendkim::service::OpendkimServiceState;
pub(crate) use openvpn::OpenVPNService;
pub(crate) use opkssh::service::OpksshServiceState;
pub(crate) use os_detect::service::OsDetectServiceState;
pub(crate) use osticket::service::OsticketServiceState;
pub(crate) use ovh::OvhService;
pub(crate) use pam::service::PamServiceState;
pub(crate) use passbolt::PassboltService;
pub(crate) use passkey::PasskeyService;
pub(crate) use pfsense::service::PfsenseServiceState;
pub(crate) use pg_admin::service::PgServiceState;
pub(crate) use php_mgmt::service::PhpServiceState;
pub(crate) use port_knock::service::PortKnockServiceState;
pub(crate) use postfix::service::PostfixServiceState;
pub(crate) use postgres::service::PostgresServiceState;
pub(crate) use proc_mgmt::service::ProcServiceState;
pub(crate) use procmail::service::ProcmailServiceState;
pub(crate) use prometheus::service::PrometheusServiceState;
pub(crate) use proxmox::service::ProxmoxServiceState;
pub(crate) use proxy::ProxyService;
pub(crate) use qr::QrService;
pub(crate) use raw_socket::RawSocketService;
#[cfg(feature = "rdp")]
pub(crate) use rdp::RdpService;
pub(crate) use recording::RecordingServiceState;
pub(crate) use redis::service::RedisServiceState;
pub(crate) use rlogin::RloginService;
pub(crate) use roundcube::service::RoundcubeServiceState;
pub(crate) use rspamd::service::RspamdServiceState;
pub(crate) use rustdesk::RustDeskService;
pub(crate) use scaleway::ScalewayService;
pub(crate) use scp::ScpService;
pub(crate) use script::ScriptService;
pub(crate) use secure_clip::SecureClipServiceState;
pub(crate) use security::SecurityService;
pub(crate) use serial::SerialService;
pub(crate) use sftp::SftpService;
pub(crate) use smtp::service::SmtpService;
pub(crate) use snmp::service::SnmpServiceState;
pub(crate) use spamassassin::service::SpamAssassinServiceState;
pub(crate) use sqlite::service::SqliteServiceState;
pub(crate) use ssh::SshService;
pub(crate) use ssh3::Ssh3Service;
pub(crate) use ssh_agent::types::SshAgentServiceState;
pub(crate) use ssh_scripts::engine::SshScriptEngineState;
pub(crate) use storage::SecureStorage;
pub(crate) use supermicro::service::SmcServiceState;
pub(crate) use synology::service::SynologyServiceState;
pub(crate) use tailscale::TailscaleService;
pub(crate) use telnet::TelnetService;
pub(crate) use terminal_themes::ThemeEngineState;
pub(crate) use terraform::service::TerraformServiceState;
pub(crate) use time_ntp::service::TimeNtpServiceState;
pub(crate) use traefik::service::TraefikServiceState;
pub(crate) use trust_store::TrustStoreService;
pub(crate) use two_factor::TwoFactorService;
pub(crate) use ups_mgmt::service::UpsServiceState;
pub(crate) use vmware::service::VmwareServiceState;
pub(crate) use vmware_desktop::service::VmwDesktopServiceState;
pub(crate) use vnc::VncService;
pub(crate) use warpgate::service::WarpgateServiceState;
pub(crate) use whatsapp::WhatsAppServiceState;
pub(crate) use wireguard::WireGuardService;
pub(crate) use wol::WolService;
pub(crate) use zerotier::ZeroTierService;

mod access;
mod collab;
mod connectivity;
mod ops;
mod platform;
mod security_data;

pub(crate) fn register(app: &mut tauri::App<tauri::Wry>) -> tauri::Result<()> {
    let launch_args = sorng_app_shell::commands::parse_launch_args(std::env::args());
    app.manage(launch_args);

    if cfg!(debug_assertions) {
        app.handle().plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )?;
    }

    cpu_features::log_all_features();

    let app_dir = app.path().app_data_dir().unwrap();

    let user_store_path = app_dir.join("users.json");
    let auth_service = AuthService::new(user_store_path.to_string_lossy().to_string());
    app.manage(auth_service.clone());

    let storage_path = app_dir.join("storage.json");
    let secure_storage = SecureStorage::new(storage_path.to_string_lossy().to_string());
    app.manage(secure_storage);

    let trust_store_path = app_dir.join("trust_store.json");
    let trust_store_service =
        TrustStoreService::new(trust_store_path.to_string_lossy().to_string());
    app.manage(trust_store_service);

    let ssh_service = SshService::new();
    app.manage(ssh_service.clone());

    let sftp_service = SftpService::new();
    app.manage(sftp_service.clone());

    let api_handles = connectivity::register(app, ssh_service.clone());
    security_data::register(app, &app_dir);

    access::register(app);
    platform::register(app);
    collab::register(app, &app_dir);
    ops::register(app, &app_dir);

    let api_service = ApiService::new(
        auth_service.clone(),
        ssh_service.clone(),
        api_handles.db_service.clone(),
        api_handles.ftp_service.clone(),
        api_handles.network_service.clone(),
        api_handles.security_service.clone(),
        api_handles.wol_service.clone(),
        api_handles.qr_service.clone(),
        api_handles.rustdesk_service.clone(),
        api_handles.wmi_service.clone(),
        api_handles.rpc_service.clone(),
        api_handles.meshcentral_service.clone(),
        api_handles.agent_service.clone(),
        api_handles.commander_service.clone(),
        api_handles.aws_service.clone(),
        api_handles.vercel_service.clone(),
        api_handles.cloudflare_service.clone(),
    );
    app.manage(api_service.clone());

    let api_service_clone = api_service.clone();
    println!("About to start REST API server...");
    tauri::async_runtime::spawn(async move {
        println!("Starting API server task...");
        if let Err(err) = Arc::new(api_service_clone).start_server(3001).await {
            eprintln!("Failed to start REST API server: {}", err);
        }
    });
    println!("API server task spawned");

    Ok(())
}
