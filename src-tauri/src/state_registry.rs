pub(crate) use crate::*;
pub(crate) use std::sync::Arc;
pub(crate) use tauri::Manager;
pub(crate) use tokio::sync::Mutex;

// ── Always-available types (core, sessions, access) ─────────────────
pub(crate) use ai_agent::types::AiAgentServiceState;
pub(crate) use anydesk::AnyDeskService;
pub(crate) use api::ApiService;
pub(crate) use auth::AuthService;
pub(crate) use auto_lock::AutoLockService;
pub(crate) use bearer_auth::BearerAuthService;
pub(crate) use bitwarden::BitwardenService;
pub(crate) use cert_auth::CertAuthService;
pub(crate) use cert_gen::CertGenService;
pub(crate) use chaining::ChainingService;
pub(crate) use dashlane::service::DashlaneServiceState;
pub(crate) use ikev2::IKEv2Service;
pub(crate) use ipsec::IPsecService;
pub(crate) use l2tp::L2TPService;
pub(crate) use pptp::PPTPService;
#[cfg(feature = "vpn-softether")]
pub(crate) use softether::SoftEtherService;
pub(crate) use sstp::SSTPService;
pub(crate) use db::DbService;
pub(crate) use digital_ocean::DigitalOceanService;
pub(crate) use ftp::FtpService;
pub(crate) use google_passwords::service::GooglePasswordsServiceState;
pub(crate) use gpo::GpoService;
pub(crate) use http::HttpService;
pub(crate) use http::ProxySessionManager;
pub(crate) use keepass::KeePassService;
pub(crate) use lastpass::service::LastPassServiceState;
pub(crate) use login_detection::LoginDetectionService;
pub(crate) use meshcentral_dedicated::MeshCentralService;
#[cfg(feature = "db-mongo")]
pub(crate) use mongodb::service::MongoServiceState;
pub(crate) use mremoteng_dedicated::MremotengService;
#[cfg(feature = "db-mssql")]
pub(crate) use mssql::service::MssqlServiceState;
#[cfg(feature = "db-mysql")]
pub(crate) use mysql::service::MysqlServiceState;
pub(crate) use network::NetworkService;
pub(crate) use onepassword::service::OnePasswordServiceState;
pub(crate) use openvpn::OpenVPNService;
pub(crate) use openvpn_dedicated::openvpn::service::{
    OpenVpnService as OpenVpnDedicatedService, OpenVpnServiceState as OpenVpnDedicatedState,
};
pub(crate) use passbolt::PassboltService;
pub(crate) use passkey::PasskeyService;
#[cfg(feature = "db-postgres")]
pub(crate) use postgres::service::PostgresServiceState;
pub(crate) use proxy::ProxyService;
pub(crate) use qr::QrService;
pub(crate) use raw_socket::RawSocketService;
#[cfg(feature = "rdp")]
pub(crate) use rdp::RdpService;
#[cfg(feature = "db-redis")]
pub(crate) use redis::service::RedisServiceState;
pub(crate) use rlogin::RloginService;
pub(crate) use rustdesk::RustDeskService;
pub(crate) use scp::ScpService;
pub(crate) use script::ScriptService;
pub(crate) use security::SecurityService;
pub(crate) use serial::SerialService;
pub(crate) use sftp::SftpService;
pub(crate) use smb::service::SmbService;
#[cfg(feature = "db-sqlite")]
pub(crate) use sqlite::service::SqliteServiceState;
pub(crate) use ssh::SshService;
pub(crate) use ssh3::Ssh3Service;
pub(crate) use storage::SecureStorage;
pub(crate) use tailscale::TailscaleService;
pub(crate) use telnet::TelnetService;
pub(crate) use trust_store::TrustStoreService;
pub(crate) use totp::service::{TotpService, TotpServiceState};
pub(crate) use two_factor::TwoFactorService;
pub(crate) use vnc::VncService;
pub(crate) use wireguard::WireGuardService;
pub(crate) use wol::WolService;
pub(crate) use zerotier::ZeroTierService;

// ── Cloud types ─────────────────────────────────────────────────────
#[cfg(feature = "cloud")]
pub(crate) use azure::service::AzureService;
#[cfg(feature = "cloud")]
pub(crate) use exchange::service::ExchangeService;
#[cfg(feature = "cloud")]
pub(crate) use gcp::GcpService;
#[cfg(feature = "cloud")]
pub(crate) use oracle_cloud::service::OciService;
#[cfg(feature = "cloud")]
pub(crate) use smtp::service::SmtpService;

// ── Platform types ──────────────────────────────────────────────────
#[cfg(feature = "platform")]
pub(crate) use ai_assist::service::AiAssistServiceState;
#[cfg(feature = "platform")]
pub(crate) use ansible::service::AnsibleServiceState;
#[cfg(feature = "platform")]
pub(crate) use command_palette::CommandPaletteServiceState;
#[cfg(feature = "platform")]
pub(crate) use docker::service::DockerServiceState;
#[cfg(feature = "platform")]
pub(crate) use extensions::service::ExtensionsServiceState;
#[cfg(feature = "platform")]
pub(crate) use fonts::FontServiceState;
#[cfg(feature = "platform")]
pub(crate) use k8s::service::K8sServiceState;
#[cfg(feature = "platform")]
pub(crate) use llm::service::LlmServiceState;
#[cfg(feature = "platform")]
pub(crate) use recording::RecordingServiceState;
#[cfg(feature = "platform")]
pub(crate) use secure_clip::SecureClipServiceState;
#[cfg(feature = "platform")]
pub(crate) use terminal_themes::ThemeEngineState;
#[cfg(feature = "platform")]
pub(crate) use terraform::service::TerraformServiceState;

// ── Collab types ────────────────────────────────────────────────────
#[cfg(any(feature = "collab", feature = "platform"))]
pub(crate) use onedrive::service::OneDriveServiceState;
#[cfg(any(feature = "collab", feature = "platform"))]
pub(crate) use whatsapp::WhatsAppServiceState;

// ── Ops types ───────────────────────────────────────────────────────
#[cfg(feature = "ops")]
pub(crate) use about::service::AboutServiceState;
#[cfg(feature = "ops")]
pub(crate) use backup_verify::service::{BackupVerifyService, BackupVerifyServiceState};
#[cfg(feature = "ops")]
pub(crate) use amavis::service::AmavisServiceState;
#[cfg(feature = "ops")]
pub(crate) use apache::service::ApacheServiceState;
#[cfg(feature = "ops")]
pub(crate) use bootloader::service::BootloaderServiceState;
#[cfg(feature = "ops")]
pub(crate) use budibase::service::BudibaseServiceState;
#[cfg(feature = "ops")]
pub(crate) use caddy::service::CaddyServiceState;
#[cfg(feature = "ops")]
pub(crate) use ceph::service::CephServiceState;
#[cfg(feature = "ops")]
pub(crate) use cicd::service::CicdServiceState;
#[cfg(feature = "ops")]
pub(crate) use clamav::service::ClamavServiceState;
#[cfg(feature = "ops")]
pub(crate) use consul::service::{ConsulServiceHolder, ConsulServiceState};
#[cfg(feature = "ops")]
pub(crate) use etcd::service::{EtcdService, EtcdServiceState};
#[cfg(feature = "ops")]
pub(crate) use cpanel::service::CpanelServiceState;
#[cfg(feature = "ops")]
pub(crate) use cups::service::CupsServiceState;
#[cfg(feature = "ops")]
pub(crate) use fail2ban::service::Fail2banServiceState;
#[cfg(feature = "ops")]
pub(crate) use freeipa::service::FreeIpaServiceState;
#[cfg(feature = "ops")]
pub(crate) use cron::service::CronServiceState;
#[cfg(feature = "ops")]
pub(crate) use cyrus_sasl::service::CyrusSaslServiceState;
#[cfg(feature = "ops")]
pub(crate) use docker_compose::service::ComposeServiceState;
#[cfg(feature = "ops")]
pub(crate) use dovecot::service::DovecotServiceState;
#[cfg(feature = "ops")]
pub(crate) use grafana::service::GrafanaServiceState;
#[cfg(feature = "ops")]
pub(crate) use haproxy::service::HaproxyServiceState;
#[cfg(feature = "ops")]
pub(crate) use hashicorp_vault::service::VaultServiceState;
#[cfg(feature = "ops")]
pub(crate) use hyperv::service::HyperVServiceState;
#[cfg(feature = "ops")]
pub(crate) use i18n::I18nServiceState;
#[cfg(feature = "ops")]
pub(crate) use idrac::service::IdracServiceState;
#[cfg(feature = "ops")]
pub(crate) use ilo::service::IloServiceState;
#[cfg(feature = "ops")]
pub(crate) use jira::service::JiraServiceState;
#[cfg(feature = "ops")]
pub(crate) use kernel_mgmt::service::KernelServiceState;
#[cfg(feature = "ops")]
pub(crate) use lenovo::service::LenovoServiceState;
#[cfg(feature = "ops")]
pub(crate) use lxd::service::LxdService;
#[cfg(feature = "ops")]
pub(crate) use mailcow::service::MailcowServiceState;
#[cfg(feature = "ops")]
pub(crate) use mcp_server::McpServiceState as McpServerServiceState;
#[cfg(feature = "ops")]
pub(crate) use mysql_admin::service::MysqlServiceState as MysqlAdminServiceState;
#[cfg(feature = "ops")]
pub(crate) use netbox::service::NetboxServiceState;
#[cfg(feature = "ops")]
pub(crate) use nginx::service::NginxServiceState;
#[cfg(feature = "ops")]
pub(crate) use nginx_proxy_mgr::service::NpmServiceState;
#[cfg(feature = "ops")]
pub(crate) use opendkim::service::OpendkimServiceState;
#[cfg(feature = "ops")]
pub(crate) use opkssh::service::OpksshServiceState;
#[cfg(feature = "ops")]
pub(crate) use os_detect::service::OsDetectServiceState;
#[cfg(feature = "ops")]
pub(crate) use osticket::service::OsticketServiceState;
#[cfg(feature = "ops")]
pub(crate) use pam::service::PamServiceState;
#[cfg(feature = "ops")]
pub(crate) use pfsense::service::PfsenseServiceState;
#[cfg(feature = "ops")]
pub(crate) use pg_admin::service::PgServiceState;
#[cfg(feature = "ops")]
pub(crate) use php_mgmt::service::PhpServiceState;
#[cfg(feature = "ops")]
pub(crate) use port_knock::service::PortKnockServiceState;
#[cfg(feature = "ops")]
pub(crate) use postfix::service::PostfixServiceState;
#[cfg(feature = "ops")]
pub(crate) use powershell::service::{PsRemotingService, PsRemotingServiceState};
#[cfg(feature = "ops")]
pub(crate) use proc_mgmt::service::ProcServiceState;
#[cfg(feature = "ops")]
pub(crate) use procmail::service::ProcmailServiceState;
#[cfg(feature = "ops")]
pub(crate) use prometheus::service::PrometheusServiceState;
#[cfg(feature = "ops")]
pub(crate) use rabbitmq::service::RabbitServiceState;
#[cfg(feature = "ops")]
pub(crate) use proxmox::service::ProxmoxServiceState;
#[cfg(feature = "ops")]
pub(crate) use roundcube::service::RoundcubeServiceState;
#[cfg(feature = "ops")]
pub(crate) use rspamd::service::RspamdServiceState;
#[cfg(feature = "ops")]
pub(crate) use snmp::service::SnmpServiceState;
#[cfg(feature = "ops")]
pub(crate) use spamassassin::service::SpamAssassinServiceState;
#[cfg(feature = "ops")]
pub(crate) use ssh_agent::types::SshAgentServiceState;
#[cfg(feature = "ops")]
pub(crate) use ssh_scripts::engine::SshScriptEngineState;
#[cfg(feature = "ops")]
pub(crate) use supermicro::service::SmcServiceState;
#[cfg(feature = "ops")]
pub(crate) use synology::service::SynologyServiceState;
#[cfg(feature = "ops")]
pub(crate) use time_ntp::service::TimeNtpServiceState;
#[cfg(feature = "ops")]
pub(crate) use traefik::service::TraefikServiceState;
#[cfg(feature = "ops")]
pub(crate) use ups_mgmt::service::UpsServiceState;
#[cfg(feature = "ops")]
pub(crate) use vmware::service::VmwareServiceState;
#[cfg(feature = "ops")]
pub(crate) use vmware_desktop::service::VmwDesktopServiceState;
#[cfg(feature = "ops")]
pub(crate) use warpgate::service::WarpgateServiceState;

#[cfg(feature = "ops")]
pub(crate) use winmgmt::service::WinMgmtServiceState;
#[cfg(feature = "ops")]
pub(crate) use zabbix::service::ZabbixServiceState;

// State registered but no command handler wired yet — keep available
// so state_registry::security_data still compiles.
pub(crate) use heroku::HerokuService;
pub(crate) use ibm::IbmService;
pub(crate) use linode::LinodeService;
pub(crate) use ovh::OvhService;
pub(crate) use scaleway::ScalewayService;

mod access;
#[cfg(any(feature = "collab", feature = "platform"))]
mod collab;
mod connectivity;
#[cfg(feature = "ops")]
mod ops;
#[cfg(any(feature = "ops", feature = "collab", feature = "platform"))]
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

    let app_dir = app.path().app_data_dir()?;

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

    let emitter = crate::event_bridge::from_app_handle(app.handle());
    let ssh_service = SshService::new_with_emitter(emitter.clone());
    app.manage(ssh_service.clone());

    let sftp_service = SftpService::new();
    app.manage(sftp_service.clone());

    // SMB service — Windows uses UNC + std::fs; Unix uses smbclient subprocess
    // (see sorng-smb crate docstring). Blocking I/O is always wrapped in
    // spawn_blocking so the Tauri command thread is not blocked.
    let smb_service: Arc<Mutex<SmbService>> = Arc::new(Mutex::new(SmbService::new()));
    app.manage(smb_service);

    let api_handles = connectivity::register(app, ssh_service.clone(), emitter);
    security_data::register(app, &app_dir);

    access::register(app);
    #[cfg(any(feature = "ops", feature = "collab", feature = "platform"))]
    platform::register(app);
    #[cfg(any(feature = "collab", feature = "platform"))]
    collab::register(app, &app_dir);
    #[cfg(feature = "ops")]
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
