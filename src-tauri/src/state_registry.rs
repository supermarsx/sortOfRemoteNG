pub(crate) use crate::*;
pub(crate) use std::sync::Arc;
pub(crate) use tauri::{Emitter, Manager};
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
pub(crate) use db::DbService;
pub(crate) use digital_ocean::DigitalOceanService;
pub(crate) use ftp::FtpService;
pub(crate) use google_passwords::service::GooglePasswordsServiceState;
pub(crate) use gpo::GpoService;
pub(crate) use http::HttpService;
pub(crate) use http::ProxySessionManager;
pub(crate) use ikev2::IKEv2Service;
pub(crate) use ipsec::IPsecService;
pub(crate) use keepass::KeePassService;
pub(crate) use l2tp::L2TPService;
pub(crate) use lastpass::service::LastPassServiceState;
pub(crate) use login_detection::LoginDetectionService;
#[cfg(any(feature = "ops", feature = "collab", feature = "platform"))]
pub(crate) use meshcentral_dedicated::MeshCentralService;
#[cfg(feature = "db-mongo")]
pub(crate) use mongodb::service::MongoServiceState;
#[cfg(any(feature = "ops", feature = "collab", feature = "platform"))]
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
pub(crate) use pptp::PPTPService;
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
#[cfg(feature = "vpn-softether")]
pub(crate) use softether::SoftEtherService;
#[cfg(feature = "db-sqlite")]
pub(crate) use sqlite::service::SqliteServiceState;
pub(crate) use ssh::SshService;
pub(crate) use ssh3::Ssh3Service;
pub(crate) use sstp::SSTPService;
pub(crate) use storage::SecureStorage;
pub(crate) use tailscale::TailscaleService;
pub(crate) use telnet::TelnetService;
pub(crate) use totp::service::{TotpService, TotpServiceState};
pub(crate) use trust_store::TrustStoreService;
pub(crate) use two_factor::TwoFactorService;
pub(crate) use updater::service::UpdaterService;
pub(crate) use vnc::VncService;
pub(crate) use wireguard::WireGuardService;
pub(crate) use wol::WolService;
pub(crate) use zerotier::ZeroTierService;

// ── Cloud types ─────────────────────────────────────────────────────
pub(crate) use azure::service::AzureService;
pub(crate) use exchange::service::ExchangeService;
pub(crate) use gcp::GcpService;
pub(crate) use hetzner::service::HetznerService;
pub(crate) use oracle_cloud::service::OciService;
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
pub(crate) use amavis::service::AmavisServiceState;
#[cfg(feature = "ops")]
pub(crate) use apache::service::ApacheServiceState;
#[cfg(feature = "ops")]
pub(crate) use backup_verify::service::{BackupVerifyService, BackupVerifyServiceState};
#[cfg(feature = "ops")]
pub(crate) use bootloader::service::BootloaderServiceState;
#[cfg(feature = "ops")]
pub(crate) use budibase::service::BudibaseServiceState;
#[cfg(feature = "ops")]
pub(crate) use caddy::service::CaddyServiceState;
#[cfg(feature = "ops")]
#[allow(unused_imports)]
pub(crate) use ceph::service::CephServiceState;
#[cfg(feature = "ops")]
pub(crate) use cicd::service::CicdServiceState;
#[cfg(feature = "ops")]
pub(crate) use clamav::service::ClamavServiceState;
#[cfg(feature = "ops")]
pub(crate) use consul::service::{ConsulServiceHolder, ConsulServiceState};
#[cfg(feature = "ops")]
pub(crate) use cpanel::service::CpanelServiceState;
#[cfg(feature = "ops")]
pub(crate) use cron::service::CronServiceState;
#[cfg(feature = "ops")]
pub(crate) use cups::service::CupsServiceState;
#[cfg(feature = "ops")]
pub(crate) use cyrus_sasl::service::CyrusSaslServiceState;
#[cfg(feature = "ops")]
pub(crate) use docker_compose::service::ComposeServiceState;
#[cfg(feature = "ops")]
pub(crate) use dovecot::service::DovecotServiceState;
#[cfg(feature = "ops")]
pub(crate) use etcd::service::{EtcdService, EtcdServiceState};
#[cfg(feature = "ops")]
pub(crate) use fail2ban::service::Fail2banServiceState;
#[cfg(feature = "ops")]
pub(crate) use freeipa::service::FreeIpaServiceState;
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
#[cfg(any(feature = "ops", feature = "opkssh"))]
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
pub(crate) use powershell::runspace_session::{
    PowerShellSessionService, PowerShellSessionServiceState,
};
#[cfg(feature = "ops")]
pub(crate) use proc_mgmt::service::ProcServiceState;
#[cfg(feature = "ops")]
pub(crate) use procmail::service::ProcmailServiceState;
#[cfg(feature = "ops")]
pub(crate) use prometheus::service::PrometheusServiceState;
#[cfg(feature = "ops")]
#[allow(unused_imports)]
pub(crate) use rabbitmq::service::RabbitServiceState;
#[cfg(feature = "ops")]
pub(crate) use remote_backup::service::{RemoteBackupService, RemoteBackupServiceState};
// t5-e5: Kafka managed state alias — gated behind the top-level `kafka`
// feature (which forwards through sorng-app-domains → sorng-app-domains-ops
// to expose the `kafka` module). Only compiled when Kafka is enabled.
#[cfg(all(
    feature = "ops",
    any(feature = "kafka", feature = "kafka-dynamic", feature = "kafka-static")
))]
pub(crate) use kafka::service::KafkaServiceState;
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

    // Commit H — replace `tauri_plugin_log`'s plaintext file writer
    // with the encrypted log adapter. The plugin dependency stays in
    // Cargo.toml so other crates that reference its types still build;
    // we just don't register it. The adapter install happens further
    // down once `EncryptionState` exists (it needs the shared handle
    // to buffer-until-unlock at boot).
    cpu_features::log_all_features();

    let app_dir = app.path().app_data_dir()?;

    // Belt-and-suspenders: make sure the app-data directory exists before
    // any subsystem resolves a child path under it. The durable recording
    // writer self-heals per-write (creates <root>/inflight/ on demand), but
    // several services below build file paths under `app_dir` (users.json,
    // storage.json, trust_store.json, logs/) and expect the parent to be
    // present. Ignore an AlreadyExists result; a real failure surfaces when
    // those services first write.
    let _ = std::fs::create_dir_all(&app_dir);

    // Encryption-at-rest subsystem (Phase 0): managed state holds the
    // in-memory master DEK. See crates/sorng-encryption/src/state.rs.
    //
    // Boot-time silent vault unlock — when the OS vault is available
    // we call `ensure_dek` rather than `read_dek` so a fresh install
    // auto-initialises a vault-mode master DEK on first boot. P4
    // requires every database write to go through an unlocked state
    // (eager-encrypt, explicit-downgrade-refusal policy); without
    // auto-init the database picker would be empty on fresh installs
    // until the user manually visited Settings → Security.
    //
    // Password / hybrid modes still require explicit user input via
    // the Settings → Security panel — `ensure_dek` only fires for the
    // vault path here, so the user-driven setup flow is unchanged.
    let enc_state = sorng_encryption::EncryptionState::new();
    if sorng_vault::keychain::is_available() {
        if let Ok(bytes) = tauri::async_runtime::block_on(sorng_vault::keychain::ensure_dek()) {
            if let Some(dek) = sorng_encryption::MasterDek::from_bytes(&bytes) {
                tauri::async_runtime::block_on(enc_state.install(dek));
                println!("Encryption-at-rest: vault DEK ensured + installed at boot.");
            }
        }
    }
    // Snapshot the (cheaply cloneable Arc-backed) handle BEFORE
    // `app.manage` consumes it — the logger drainer task owns its
    // own clone so it survives independent of Tauri state lookups.
    let enc_state_for_logger = enc_state.clone();
    app.manage(enc_state);

    // Install the encrypted log adapter once the encryption state
    // exists. Gated on `debug_assertions` to preserve the prior
    // tauri_plugin_log behaviour (no global logger in release until
    // the rollout flips the gate). The state may be locked here —
    // the sink buffers lines until unlock, so no records are lost.
    if cfg!(debug_assertions) {
        let logs_dir = app_dir.join("logs");
        if let Err(e) = sorng_encryption::log_adapter::EncryptedLogAdapter::install(
            std::sync::Arc::new(enc_state_for_logger),
            logs_dir,
            log::LevelFilter::Info,
        ) {
            eprintln!("Failed to install encrypted log adapter: {}", e);
        }
    }

    let updater_service = UpdaterService::new(env!("CARGO_PKG_VERSION"), &app_dir);
    app.manage(updater_service);

    // t41-e5: honor USER_STORE_PATH for the file-backed auth user store.
    // Precedence mirrors api_config's Decision D2: env USER_STORE_PATH →
    // persisted settings.restApi.userStorePath → default app_dir/users.json.
    // We reuse the config resolver (which reads the env var itself) rather than
    // re-implementing the precedence; a locked/absent settings store simply
    // falls through to the default, exactly as before.
    let user_store_path = {
        let settings =
            tauri::async_runtime::block_on(read_api_settings_snapshot(app.app_handle(), &app_dir))
                .unwrap_or_else(|| serde_json::json!({}));
        crate::api_config::ApiRuntimeConfig::resolve(&settings, &app_dir).user_store_path
    };
    let auth_service = AuthService::new(user_store_path.to_string_lossy().to_string());
    app.manage(auth_service.clone());

    let storage_path = app_dir.join("storage.json");
    let secure_storage = SecureStorage::new(storage_path.to_string_lossy().to_string());
    // Phase 8 — inject the master-key handle so subsequent saves use
    // the v2 connections envelope (`sorng-v1::connections`) when
    // unlocked. The encryption state is managed above before this
    // service is created, so production writes cannot silently miss
    // the handle and downgrade to plaintext.
    if let Some(enc_handle) = app.try_state::<sorng_encryption::EncryptionState>() {
        let enc_arc = std::sync::Arc::new(enc_handle.inner().clone());
        let svc = secure_storage.clone();
        tauri::async_runtime::block_on(async move {
            let mut g = svc.lock().await;
            g.set_encryption_state(enc_arc);
        });
    }
    app.manage(secure_storage);

    let trust_store_path = app_dir.join("trust_store.json");
    let trust_store_service =
        TrustStoreService::new(trust_store_path.to_string_lossy().to_string());
    app.manage(trust_store_service);

    // Trust Center TOFU wiring (t24): the management TLS clients that build
    // their reqwest client deep inside their own crate (no access to Tauri
    // app state) resolve the trust-store file path themselves. Give them the
    // EXACT registered path here so they use it explicitly instead of their
    // platform-dependent fallback. The file-backed sync verifier then shares
    // one coherent `trust_store.json` with the async `TrustStoreService` and
    // the Trust Center UI. These calls are additive and idempotent
    // (OnceLock / env var); they must mirror `trust_store_path` above.
    //
    // `SORNG_TRUST_STORE_PATH` is honoured by sorng-warpgate (and any future
    // env-aware client). Only set it when the path is valid UTF-8 so we never
    // export a lossy/garbled value.
    if let Some(trust_store_path_str) = trust_store_path.to_str() {
        std::env::set_var("SORNG_TRUST_STORE_PATH", trust_store_path_str);
    }
    // supermicro exposes a process-global setter (feature `platform`).
    // It takes the FULL path to `trust_store.json`.
    #[cfg(feature = "platform")]
    supermicro::trust::set_trust_store_path(trust_store_path.clone());
    // hetzner exposes a process-global setter (feature `cloud`).
    // NOTE: it takes the app-data DIRECTORY and joins `trust_store.json`
    // itself, so pass `app_dir` here — NOT the full `trust_store_path`.
    #[cfg(feature = "cloud")]
    hetzner::client::init_trust_store_path(app_dir.clone());

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

    #[cfg(all(feature = "opkssh", not(feature = "ops")))]
    {
        let opkssh_state: OpksshServiceState =
            Arc::new(Mutex::new(opkssh::service::OpksshService::new()));
        app.manage(opkssh_state);
    }

    let api_handles = connectivity::register(app, ssh_service.clone(), emitter.clone());
    security_data::register(app, &app_dir, emitter);

    access::register(app);

    // Encryption-at-rest subsystem (Phase 0): managed state holds the
    // in-memory master DEK. See crates/sorng-encryption/src/state.rs.
    //
    // Boot-time silent vault unlock — when the OS vault is available
    // and no password wrapper is configured, `ensure_dek` lets a fresh
    // vault-only install auto-initialise a master DEK on first boot.
    //
    // If `dek.enc` exists, password or hybrid mode is configured. In
    // those modes boot must remain locked until the user supplies their
    // password; calling `ensure_dek` here would create a different vault
    // DEK on password-only installs and incorrectly mark the process as
    // unlocked before `encryption_unlock` can unwrap the real DEK.
    let enc_state = sorng_encryption::EncryptionState::new();
    let password_wrap_present = app_dir.join("dek.enc").exists();
    if !password_wrap_present && sorng_vault::keychain::is_available() {
        if let Ok(bytes) = tauri::async_runtime::block_on(
            sorng_vault::keychain::ensure_dek(),
        ) {
            if let Some(dek) = sorng_encryption::MasterDek::from_bytes(&bytes) {
                tauri::async_runtime::block_on(enc_state.install(dek));
                println!(
                    "Encryption-at-rest: vault DEK ensured + installed at boot."
                );
            }
        }
    }
    // Snapshot the (cheaply cloneable Arc-backed) handle BEFORE
    // `app.manage` consumes it — the logger drainer task owns its
    // own clone so it survives independent of Tauri state lookups.
    let enc_state_for_logger = enc_state.clone();
    app.manage(enc_state);

    // Install the encrypted log adapter once the encryption state
    // exists. Gated on `debug_assertions` to preserve the prior
    // tauri_plugin_log behaviour (no global logger in release until
    // the rollout flips the gate). The state may be locked here —
    // the sink buffers lines until unlock, so no records are lost.
    if cfg!(debug_assertions) {
        let logs_dir = app_dir.join("logs");
        if let Err(e) = sorng_encryption::log_adapter::EncryptedLogAdapter::install(
            std::sync::Arc::new(enc_state_for_logger),
            logs_dir,
            log::LevelFilter::Info,
        ) {
            eprintln!("Failed to install encrypted log adapter: {}", e);
        }
    }

    #[cfg(any(feature = "ops", feature = "collab", feature = "platform"))]
    platform::register(app);
    #[cfg(any(feature = "collab", feature = "platform"))]
    collab::register(app, &app_dir);
    #[cfg(feature = "ops")]
    ops::register(app, &app_dir);

    // t40-f2: recover crash-orphaned in-flight terminal recordings. f2's
    // incremental-flush writer persists a crash snapshot under
    // `<root>/inflight/` on every append; a power-loss or hard-kill during
    // an active session leaves that snapshot un-finalised. Run recovery once
    // here (the recording state was just managed in `collab::register`, with
    // its encryption handle already injected) so orphaned snapshots are
    // decoded and saved into the library. Best-effort and self-healing: the
    // service SKIPS encrypted snapshots while the key is locked and they are
    // retried when the frontend re-invokes the `rec_recover_crashed` command
    // after unlock — the same fail-open pattern as the capability priming
    // below. Vault-mode installs are already unlocked at this point, so their
    // snapshots recover on this pass.
    #[cfg(any(feature = "collab", feature = "platform"))]
    if let Some(rec_state) = app.try_state::<recording::RecordingServiceState>() {
        let rec = rec_state.inner().clone();
        tauri::async_runtime::block_on(async move {
            let svc = rec.lock().await;
            match svc.recover_crashed_terminal_recordings().await {
                Ok(n) if n > 0 => log::info!(
                    "Recording crash-recovery: finalised {n} orphaned in-flight terminal recording(s)."
                ),
                Ok(_) => {}
                Err(e) => log::warn!("Recording crash-recovery failed at startup: {e}"),
            }
        });
    }

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

    // Bridge for the `set_api_disabled_capabilities` Tauri command —
    // see api_capability_commands.rs.
    {
        let svc_for_setter = api_service.clone();
        let setter = sorng_commands_core::api_capability_commands::DisabledCapsSetter(Arc::new(
            move |ids: Vec<String>| {
                svc_for_setter.set_disabled_capabilities(ids);
            },
        ));
        app.manage(setter);
    }

    // Read the persisted settings once: (1) prime the disabled-capability set
    // so the capability gate is enforced from the very first request, not just
    // after the user opens Settings → API, and (2) resolve the REST API runtime
    // config that governs boot-time startup and the launcher below. Uses the
    // v0/v2-dispatching reader — the silent vault unlock above means the
    // encrypted form is readable for vault-mode installs. Password / hybrid
    // installs surface "locked" and fall through to safe defaults (API stays
    // off); the capabilities load anyway as soon as the user unlocks.
    let settings_value =
        tauri::async_runtime::block_on(read_api_settings_snapshot(app.app_handle(), &app_dir))
            .unwrap_or_else(|| serde_json::json!({}));

    if let Some(list) = settings_value
        .get("restApi")
        .and_then(|r| r.get("disabledCapabilities"))
        .and_then(|d| d.as_array())
    {
        let ids: Vec<String> = list
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
        if !ids.is_empty() {
            api_service.set_disabled_capabilities(ids);
        }
    }

    // t41-e5: resolve the REST API runtime config (bind addr, auth, TLS, key,
    // store path — env overrides settings per Decision D2) for the boot-time
    // auto-start decision, then register the lifecycle controller + launcher so
    // Settings → API can start/stop/restart the server at runtime regardless of
    // whether it auto-starts now.
    let boot_config = crate::api_config::ApiRuntimeConfig::resolve(&settings_value, &app_dir);

    // The launcher bridge: the crate-agnostic `ApiServerController` (compiled
    // into sorng-commands-core, where `api::start_server` / `api_config` are
    // NOT nameable) receives this closure from the app crate. On each start it
    // re-resolves the CURRENT settings+env (so a Settings change followed by a
    // restart takes effect), fails closed if auth is required without a key,
    // persists any freshly-generated secrets, spawns the axum server, and hands
    // back a secret-free launch snapshot. Mirrors the DisabledCapsSetter bridge
    // used for live capability updates above.
    let services_for_launcher = Arc::new(api_service.clone());
    let app_handle_for_launcher = app.app_handle().clone();
    let launcher = sorng_commands_core::api_server_commands::ApiServerLauncher::new(
        move |shutdown_rx| {
            let services = services_for_launcher.clone();
            let app_handle = app_handle_for_launcher.clone();
            Box::pin(async move {
                let app_dir = app_handle
                    .path()
                    .app_data_dir()
                    .map_err(|e| format!("failed to resolve app data dir: {e}"))?;
                let settings = read_api_settings_snapshot(&app_handle, &app_dir)
                    .await
                    .unwrap_or_else(|| serde_json::json!({}));
                let config = crate::api_config::ApiRuntimeConfig::resolve(&settings, &app_dir);

                // Fail closed (§6): never expose the API when auth is required
                // but no key resolved. The resolver auto-generates a key when
                // none is supplied, so this is defense in depth.
                if config.auth_required && config.api_key.trim().is_empty() {
                    return Err(
                        "REST API refused to start: authentication is required but no API key is configured"
                            .to_string(),
                    );
                }

                // Persist auto-generated key/secret so they stay stable across
                // restarts and the API key is retrievable in Settings → API.
                // Best-effort: a write failure must not block startup.
                if config.api_key_generated || config.jwt_secret_generated {
                    if let Err(e) =
                        persist_generated_api_secrets(&app_handle, &app_dir, &config).await
                    {
                        log::warn!("Could not persist generated REST API secrets: {e}");
                    }
                }

                let bind_addr = config.bind_addr().to_string();
                let port = config.port;
                let auth_required = config.auth_required;

                let join = tokio::spawn(async move {
                    if let Err(err) = crate::api::start_server(config, services, shutdown_rx).await {
                        log::error!("REST API server exited with error: {err}");
                    }
                });

                Ok(sorng_commands_core::api_server_commands::ServerLaunch {
                    join,
                    bind_addr,
                    port,
                    auth_required,
                })
            }) as sorng_commands_core::api_server_commands::LaunchFuture
        },
    );

    // Register the controller under the CONCRETE sorng-commands-core type so
    // the `api_server_*` Tauri commands (which read
    // `State<'_, ApiServerController>` from that crate) resolve it — Tauri state
    // is keyed by TypeId, the same gotcha as DisabledCapsSetter above.
    app.manage(
        sorng_commands_core::api_server_commands::ApiServerController::new(launcher),
    );

    // Boot-time auto-start decision (Decision D1: default OFF). Auto-start only
    // when the opt-in master switch AND startOnLaunch are set;
    // `SORNG_ENABLE_REST_API` is the headless/automation escape hatch that
    // forces a start regardless of persisted settings. When neither applies the
    // server stays stopped but fully controllable from Settings → API.
    let env_force_enable = std::env::var("SORNG_ENABLE_REST_API")
        .map(|v| {
            let v = v.trim().to_ascii_lowercase();
            v == "1" || v == "true" || v == "yes" || v == "on"
        })
        .unwrap_or(false);
    let should_auto_start =
        env_force_enable || (boot_config.enabled && boot_config.start_on_launch);

    if !should_auto_start {
        log::info!(
            "REST API server not auto-starting (enabled={}, startOnLaunch={}, env_force={}). \
             Start it from Settings → API when needed.",
            boot_config.enabled,
            boot_config.start_on_launch,
            env_force_enable
        );
        return Ok(());
    }

    log::info!(
        "REST API server auto-starting on launch ({}).",
        if env_force_enable {
            "SORNG_ENABLE_REST_API env override"
        } else {
            "restApi.enabled + startOnLaunch"
        }
    );

    // Drive the initial start through the managed controller so its status
    // snapshot and shutdown handle track the auto-started server (a later
    // Settings → API stop/restart then works). Spawned because `register` is
    // sync and `start()` is async; a bind/config failure surfaces the same
    // non-fatal `startup-failure` alert the stopgap used.
    let app_handle_for_start = app.app_handle().clone();
    tauri::async_runtime::spawn(async move {
        let controller = app_handle_for_start
            .state::<sorng_commands_core::api_server_commands::ApiServerController>();
        match controller.start().await {
            Ok(status) => {
                log::info!(
                    "REST API server started on {} (auth_required={}).",
                    status.bind_addr,
                    status.auth_required
                );
            }
            Err(err) => {
                log::error!("Failed to auto-start REST API server: {err}");
                let _ = app_handle_for_start.emit(
                    "startup-failure",
                    serde_json::json!({
                        "component": "rest_api_server",
                        "message": format!("Failed to start REST API server: {err}"),
                    }),
                );
            }
        }
    });

    Ok(())
}

/// Read the persisted app settings as raw JSON, or `None` when the encryption
/// state is unavailable/locked or no settings exist yet. Shared by the REST API
/// startup path so config is resolved from the same store the UI writes to.
async fn read_api_settings_snapshot(
    app_handle: &tauri::AppHandle,
    app_dir: &std::path::Path,
) -> Option<serde_json::Value> {
    let enc_state = app_handle.try_state::<sorng_encryption::EncryptionState>()?;
    crate::app_settings_commands::read_app_settings_inner(app_dir, &enc_state)
        .await
        .ok()
        .flatten()
}

/// Persist freshly auto-generated REST API secrets back into `settings.restApi`
/// so they remain stable across restarts (and the API key is retrievable in
/// Settings → API). Read-modify-write preserves sibling `restApi` fields.
/// Never logs the secret material (§6 invariant).
async fn persist_generated_api_secrets(
    app_handle: &tauri::AppHandle,
    app_dir: &std::path::Path,
    config: &crate::api_config::ApiRuntimeConfig,
) -> Result<(), String> {
    let enc_state = app_handle
        .try_state::<sorng_encryption::EncryptionState>()
        .ok_or_else(|| "encryption state unavailable".to_string())?;
    let current = crate::app_settings_commands::read_app_settings_inner(app_dir, &enc_state)
        .await?
        .unwrap_or_else(|| serde_json::json!({}));
    let mut rest = current
        .get("restApi")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();
    if config.api_key_generated {
        rest.insert(
            "apiKey".to_string(),
            serde_json::Value::String(config.api_key.clone()),
        );
    }
    if config.jwt_secret_generated {
        rest.insert(
            "jwtSecret".to_string(),
            serde_json::Value::String(config.jwt_secret.clone()),
        );
    }
    let patch = serde_json::json!({ "restApi": serde_json::Value::Object(rest) });
    crate::app_settings_commands::write_app_settings_inner(app_dir, &enc_state, patch).await
}
