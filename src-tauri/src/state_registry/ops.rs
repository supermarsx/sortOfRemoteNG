use super::*;
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;

use about::service::AboutServiceState;
use amavis::service::AmavisServiceState;
use ansible::service::AnsibleServiceState;
use apache::service::ApacheServiceState;
use backup_verify::service::{BackupVerifyService, BackupVerifyServiceState};
use bootloader::service::BootloaderServiceState;
use budibase::service::BudibaseServiceState;
use caddy::service::CaddyServiceState;
use cicd::service::CicdServiceState;
use clamav::service::ClamavServiceState;
use consul::service::{ConsulServiceHolder, ConsulServiceState};
use cpanel::service::CpanelServiceState;
use credentials::service::CredentialService;
use cron::service::CronServiceState;
use cups::service::CupsServiceState;
use cyrus_sasl::service::CyrusSaslServiceState;
use docker::service::DockerServiceState;
use docker_compose::service::ComposeServiceState;
use dovecot::service::DovecotServiceState;
use draytek::service::DraytekServiceState;
use etcd::service::{EtcdService, EtcdServiceState};
use fail2ban::service::Fail2banServiceState;
use freeipa::service::FreeIpaServiceState;
use grafana::service::GrafanaServiceState;
use haproxy::service::HaproxyServiceState;
use hashicorp_vault::service::VaultServiceState;
use i18n::I18nServiceState;
use jira::service::JiraServiceState;
use k8s::service::K8sServiceState;
use kernel_mgmt::service::KernelServiceState;
use lxd::service::LxdService;
use mailcow::service::MailcowServiceState;
use mcp_server::McpServiceState as McpServerServiceState;
use mysql_admin::service::MysqlServiceState as MysqlAdminServiceState;
use netbox::service::NetboxServiceState;
use nginx::service::NginxServiceState;
use nginx_proxy_mgr::service::NpmServiceState;
use opendkim::service::OpendkimServiceState;
use opkssh::service::OpksshServiceState;
use os_detect::service::OsDetectServiceState;
use osticket::service::OsticketServiceState;
use pam::service::PamServiceState;
use pfsense::service::PfsenseServiceState;
use pg_admin::service::PgServiceState;
use php_mgmt::service::PhpServiceState;
use port_knock::service::PortKnockServiceState;
use portainer::service::PortainerServiceState;
use postfix::service::PostfixServiceState;
use powershell::runspace_session::{PowerShellSessionService, PowerShellSessionServiceState};
use powershell::service::{PsRemotingService, PsRemotingServiceState};
use proc_mgmt::service::ProcServiceState;
use procmail::service::ProcmailServiceState;
use prometheus::service::PrometheusServiceState;
use remote_backup::service::{RemoteBackupService, RemoteBackupServiceState};
use roundcube::service::RoundcubeServiceState;
use rspamd::service::RspamdServiceState;
use snmp::service::SnmpServiceState;
use spamassassin::service::SpamAssassinServiceState;
use ssh_agent::types::SshAgentServiceState;
use ssh_scripts::engine::SshScriptEngineState;
use terraform::service::TerraformServiceState;
use time_ntp::service::TimeNtpServiceState;
use traefik::service::TraefikServiceState;
use ups_mgmt::service::UpsServiceState;
use warpgate::service::WarpgateServiceState;
use winmgmt::service::WinMgmtServiceState;
use zabbix::service::ZabbixServiceState;

#[cfg(feature = "kafka")]
use kafka::service::KafkaServiceState;

/// Number of concrete Tauri state registrations owned by this codegen unit.
/// Kept as an explicit parity contract so state additions cannot accidentally
/// migrate back into the root `app_lib` composition unit unnoticed.
pub const MANAGED_STATE_REGISTRATIONS: usize = 75;

const LOCALES_DIRECTORY_NAME: &str = "locales";
const PORTABLE_RESOURCES_DIRECTORY_NAME: &str = "resources";
const DEFAULT_LOCALE_CATALOG_NAME: &str = "en-US.json";

/// Return locale locations in runtime-preference order.
///
/// Standard Tauri bundles place resources directly below `resource_dir()`.
/// The custom Flatpak and Windows portable layouts keep their payload beside
/// the executable under `resources/`, so retain that deterministic fallback
/// without weakening the standard bundle contract.
fn packaged_locales_candidates(
    resource_dir: &Path,
    executable_path: Option<&Path>,
) -> Vec<PathBuf> {
    let mut candidates = vec![resource_dir.join(LOCALES_DIRECTORY_NAME)];

    if let Some(executable_dir) = executable_path.and_then(Path::parent) {
        let adjacent_resources = executable_dir
            .join(PORTABLE_RESOURCES_DIRECTORY_NAME)
            .join(LOCALES_DIRECTORY_NAME);
        if !candidates.contains(&adjacent_resources) {
            candidates.push(adjacent_resources);
        }
    }

    candidates
}

pub fn register(
    app: &mut tauri::App<tauri::Wry>,
    app_dir: &std::path::Path,
) -> Result<(), credentials::error::CredentialError> {
    // Hydrate before registering any operations-domain state. A corrupt or
    // unsafe tracker snapshot aborts startup instead of silently resetting.
    let credential_state = CredentialService::persistent_state(app_dir)?;
    app.manage(credential_state);

    let k8s_state: K8sServiceState = Arc::new(Mutex::new(k8s::service::K8sService::new()));
    app.manage(k8s_state);

    let docker_state: DockerServiceState =
        Arc::new(Mutex::new(docker::service::DockerService::new()));
    app.manage(docker_state);

    // Docker Compose aggregate service (t3-e50): wraps the CLI detector,
    // parser, dependency graph, profile manager, and template library.
    let compose_state: ComposeServiceState =
        Arc::new(Mutex::new(docker_compose::service::ComposeService::new()));
    app.manage(compose_state);

    let lxd_service = LxdService::new();
    app.manage(lxd_service);

    let ansible_state: AnsibleServiceState =
        Arc::new(Mutex::new(ansible::service::AnsibleService::new()));
    app.manage(ansible_state);

    // Consul and etcd KV / service-discovery stores (t3-e49).
    let consul_state: ConsulServiceState = Arc::new(Mutex::new(ConsulServiceHolder::new()));
    app.manage(consul_state);

    let etcd_state: EtcdServiceState = Arc::new(Mutex::new(EtcdService::new()));
    app.manage(etcd_state);

    // t5-e7: Remote Backup service state (jobs, history, progress).
    let remote_backup_state: RemoteBackupServiceState = RemoteBackupService::new();
    app.manage(remote_backup_state);

    let terraform_state: TerraformServiceState =
        Arc::new(Mutex::new(terraform::service::TerraformService::new()));
    app.manage(terraform_state);

    let budibase_state: BudibaseServiceState =
        Arc::new(Mutex::new(budibase::service::BudibaseService::new()));
    app.manage(budibase_state);

    // t64: Portainer. The service holds the Trust Center handle so HTTPS
    // endpoints (the default `:9443` is self-signed) go through the same TOFU
    // verifier as every other management client rather than a bare reqwest
    // builder. `SyncTrustStore::shared()` resolves the active database's trust
    // file on every call, so it is safe to construct before a database is open.
    let portainer_state: PortainerServiceState =
        Arc::new(Mutex::new(portainer::service::PortainerService::new(Some(
            Arc::new(sorng_storage::trust_store::SyncTrustStore::shared()),
        ))));
    app.manage(portainer_state);

    let osticket_state: OsticketServiceState =
        Arc::new(Mutex::new(osticket::service::OsticketService::new()));
    app.manage(osticket_state);

    let jira_state: JiraServiceState = Arc::new(Mutex::new(jira::service::JiraService::new()));
    app.manage(jira_state);

    let warpgate_state: WarpgateServiceState =
        Arc::new(Mutex::new(warpgate::service::WarpgateService::new()));
    app.manage(warpgate_state);

    let le_storage = app_dir.join(".letsencrypt").to_string_lossy().to_string();
    let le_state = letsencrypt::service::LetsEncryptService::new_default(&le_storage);
    app.manage(le_state);

    let opkssh_state: OpksshServiceState =
        Arc::new(Mutex::new(opkssh::service::OpksshService::new()));
    app.manage(opkssh_state);

    let ssh_scripts_state: SshScriptEngineState = ssh_scripts::engine::SshScriptEngine::new_state();
    app.manage(ssh_scripts_state);

    let mcp_state: McpServerServiceState = mcp_server::service::create_service_state();
    app.manage(mcp_state);

    let ssh_agent_state: SshAgentServiceState =
        Arc::new(Mutex::new(ssh_agent::service::SshAgentService::new()));
    app.manage(ssh_agent_state);

    // PowerShell Remoting service (WinRM + PS7 SSH transport).
    // Hardened CredSSP + Kerberos support added in t1-e07 (commit 1e47b52d).
    let ps_remoting_state: PsRemotingServiceState = Arc::new(Mutex::new(PsRemotingService::new()));
    app.manage(ps_remoting_state);

    // Shipping PSRP runspace service. Each session owns its own actor and SSH
    // transport; this state intentionally has no global I/O mutex.
    let powershell_session_state: PowerShellSessionServiceState = PowerShellSessionService::new();
    app.manage(powershell_session_state);

    let gpg_agent_state: gpg_agent::types::GpgServiceState =
        Arc::new(Mutex::new(gpg_agent::service::GpgAgentService::new()));
    app.manage(gpg_agent_state);

    let yubikey_state: yubikey::types::YubiKeyServiceState =
        Arc::new(Mutex::new(yubikey::service::YubiKeyService::new()));
    app.manage(yubikey_state);

    let winmgmt_state: WinMgmtServiceState =
        Arc::new(Mutex::new(winmgmt::service::WinMgmtService::new()));
    app.manage(winmgmt_state);

    let ddns_state: ddns::types::DdnsServiceState =
        Arc::new(Mutex::new(ddns::service::DdnsService::new()));
    app.manage(ddns_state);

    let snmp_state: SnmpServiceState = Arc::new(Mutex::new(snmp::service::SnmpService::new()));
    app.manage(snmp_state);

    let nginx_state: NginxServiceState = Arc::new(Mutex::new(nginx::service::NginxService::new()));
    app.manage(nginx_state);

    let traefik_state: TraefikServiceState =
        Arc::new(Mutex::new(traefik::service::TraefikService::new()));
    app.manage(traefik_state);

    let haproxy_state: HaproxyServiceState =
        Arc::new(Mutex::new(haproxy::service::HaproxyService::new()));
    app.manage(haproxy_state);

    let vault_state: VaultServiceState =
        Arc::new(Mutex::new(hashicorp_vault::service::VaultService::new()));
    app.manage(vault_state);

    let apache_state: ApacheServiceState =
        Arc::new(Mutex::new(apache::service::ApacheService::new()));
    app.manage(apache_state);

    let caddy_state: CaddyServiceState = Arc::new(Mutex::new(caddy::service::CaddyService::new()));
    app.manage(caddy_state);

    let npm_state: NpmServiceState =
        Arc::new(Mutex::new(nginx_proxy_mgr::service::NpmService::new()));
    app.manage(npm_state);

    let postfix_state: PostfixServiceState =
        Arc::new(Mutex::new(postfix::service::PostfixService::new()));
    app.manage(postfix_state);

    let dovecot_state: DovecotServiceState =
        Arc::new(Mutex::new(dovecot::service::DovecotServiceFacade::new()));
    app.manage(dovecot_state);

    let opendkim_state: OpendkimServiceState =
        Arc::new(Mutex::new(opendkim::service::OpendkimService::new()));
    app.manage(opendkim_state);

    let cyrus_sasl_state: CyrusSaslServiceState =
        Arc::new(Mutex::new(cyrus_sasl::service::CyrusSaslService::new()));
    app.manage(cyrus_sasl_state);

    let procmail_state: ProcmailServiceState =
        Arc::new(Mutex::new(procmail::service::ProcmailService::new()));
    app.manage(procmail_state);

    let spamassassin_state: SpamAssassinServiceState =
        Arc::new(Mutex::new(spamassassin::service::SpamAssassinService::new()));
    app.manage(spamassassin_state);

    let rspamd_state: RspamdServiceState =
        Arc::new(Mutex::new(rspamd::service::RspamdService::new()));
    app.manage(rspamd_state);

    let clamav_state: ClamavServiceState =
        Arc::new(Mutex::new(clamav::service::ClamavService::new()));
    app.manage(clamav_state);

    let roundcube_state: RoundcubeServiceState =
        Arc::new(Mutex::new(roundcube::service::RoundcubeService::new()));
    app.manage(roundcube_state);

    let mailcow_state: MailcowServiceState =
        Arc::new(Mutex::new(mailcow::service::MailcowService::new()));
    app.manage(mailcow_state);

    let amavis_state: AmavisServiceState =
        Arc::new(Mutex::new(amavis::service::AmavisService::new()));
    app.manage(amavis_state);

    let os_detect_state: OsDetectServiceState = os_detect::service::OsDetectService::new();
    app.manage(os_detect_state);

    let cron_state: CronServiceState = cron::service::CronService::new();
    app.manage(cron_state);

    let pam_state: PamServiceState = pam::service::PamService_::new();
    app.manage(pam_state);

    let bootloader_state: BootloaderServiceState = bootloader::service::BootloaderService::new();
    app.manage(bootloader_state);

    let proc_state: ProcServiceState = proc_mgmt::service::ProcService::new();
    app.manage(proc_state);

    let time_ntp_state: TimeNtpServiceState = time_ntp::service::TimeNtpService::new();
    app.manage(time_ntp_state);

    let kernel_state: KernelServiceState = kernel_mgmt::service::KernelService::new();
    app.manage(kernel_state);

    let cpanel_state: CpanelServiceState =
        Arc::new(Mutex::new(cpanel::service::CpanelService::new()));
    app.manage(cpanel_state);

    let php_state: PhpServiceState = Arc::new(Mutex::new(php_mgmt::service::PhpService::new()));
    app.manage(php_state);

    let pfsense_state: PfsenseServiceState =
        Arc::new(Mutex::new(pfsense::service::PfsenseServiceWrapper::new()));
    app.manage(pfsense_state);

    let draytek_state: DraytekServiceState =
        Arc::new(Mutex::new(draytek::service::DraytekServiceWrapper::new()));
    app.manage(draytek_state);

    let mysql_admin_state: MysqlAdminServiceState =
        Arc::new(Mutex::new(mysql_admin::service::MysqlService::new()));
    app.manage(mysql_admin_state);

    let pg_admin_state: PgServiceState = Arc::new(Mutex::new(pg_admin::service::PgService::new()));
    app.manage(pg_admin_state);

    let prometheus_state: PrometheusServiceState =
        Arc::new(Mutex::new(prometheus::service::PrometheusService::new()));
    app.manage(prometheus_state);

    let grafana_state: GrafanaServiceState =
        Arc::new(Mutex::new(grafana::service::GrafanaService::new()));
    app.manage(grafana_state);

    let ups_state: UpsServiceState = Arc::new(Mutex::new(ups_mgmt::service::UpsService::new()));
    app.manage(ups_state);

    let netbox_state: NetboxServiceState =
        Arc::new(Mutex::new(netbox::service::NetboxService::new()));
    app.manage(netbox_state);

    let port_knock_state: PortKnockServiceState = port_knock::service::PortKnockService::new();
    app.manage(port_knock_state);

    let about_state: AboutServiceState = about::service::AboutService::new();
    app.manage(about_state);

    // ── t3-e55: Linux MAC (SELinux/AppArmor/TOMOYO/SMACK) ─────────
    let mac_mgmt_state: mac_mgmt::service::MacServiceState =
        Arc::new(Mutex::new(mac_mgmt::service::MacService::new()));
    app.manage(mac_mgmt_state);

    // Backup Verify — orchestrates backup policies, verification,
    // DR drills, compliance, replication, retention, notifications.
    let backup_verify_state: BackupVerifyServiceState =
        Arc::new(Mutex::new(BackupVerifyService::new()));
    app.manage(backup_verify_state);

    let ipmi_state: ipmi::service::IpmiServiceState = ipmi::service::new_state();
    app.manage(ipmi_state);

    let cups_state: CupsServiceState = cups::service::new_state();
    app.manage(cups_state);

    let freeipa_state: FreeIpaServiceState =
        Arc::new(Mutex::new(freeipa::service::FreeIpaServiceHolder::new()));
    app.manage(freeipa_state);

    let fail2ban_state: Fail2banServiceState = fail2ban::service::Fail2banService::new();
    app.manage(fail2ban_state);

    // ── t3-e56: Zabbix + CI/CD ─────────────────────────────────────
    let zabbix_state: ZabbixServiceState =
        Arc::new(Mutex::new(zabbix::service::ZabbixService::new()));
    app.manage(zabbix_state);

    let cicd_state: CicdServiceState = Arc::new(Mutex::new(cicd::service::CicdService::new()));
    app.manage(cicd_state);

    // t5-e5: Kafka service state — registers only when the `kafka`
    // (dynamic or static) feature is on. `KafkaService::new()` is a pure
    // HashMap constructor and does not touch librdkafka, so registration
    // is safe even when the native library is absent; the runtime probe
    // fires on `kafka_connect` via `RealProbe::probe()`.
    #[cfg(feature = "kafka")]
    {
        let kafka_state: KafkaServiceState = kafka::service::new_state();
        app.manage(kafka_state);
    }

    let resource_dir = app
        .path()
        .resource_dir()
        .unwrap_or_else(|_| app_dir.to_path_buf());
    let executable_path = std::env::current_exe().ok();
    let locales_dir = packaged_locales_candidates(&resource_dir, executable_path.as_deref())
        .into_iter()
        .find(|candidate| candidate.join(DEFAULT_LOCALE_CATALOG_NAME).is_file())
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../..")
                .join("src")
                .join("i18n")
                .join("locales")
        });
    let i18n_engine = match i18n::I18nEngine::new(&locales_dir, "en-US") {
        Ok(engine) => Arc::new(engine),
        Err(err) => {
            log::warn!("i18n: failed to initialise engine: {err}");
            Arc::new(i18n::I18nEngine::new_empty("en-US"))
        }
    };
    let app_handle = app.handle().clone();
    let i18n_watcher = i18n::watcher::I18nWatcher::start(
        i18n_engine.clone(),
        i18n::watcher::WatcherConfig::default(),
        Some(Arc::new(move || {
            let _ = app_handle.emit("i18n-reload", ());
        })),
    )
    .ok();
    app.manage(I18nServiceState {
        engine: i18n_engine,
        _watcher: i18n_watcher,
    });
    Ok(())
}

/// Register and start the operations scheduler after the other ops-domain
/// state has been installed. Keeping this ownership in the ops registrar
/// prevents root composition from acquiring another `App::manage` monomorph.
pub fn register_scheduler(
    app: &mut tauri::App<tauri::Wry>,
    app_dir: &std::path::Path,
) -> tauri::Result<()> {
    // This plaintext store is intentionally dedicated to the scheduler's
    // non-secret Wake-on-LAN task family. SchedulerService rejects every
    // legacy action that could carry credentials before it reaches disk.
    let storage_path = app_dir.join("scheduler-wol-state-v1.json");
    let state = crate::scheduler::service::SchedulerService::with_storage_path(storage_path)
        .map_err(|error| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("scheduler state could not be loaded from app data: {error}"),
            )
        })?;

    if !app.manage(state.clone()) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "scheduler state was registered more than once",
        )
        .into());
    }

    // Setup runs before IPC is exposed. Starting through Tauri's Tokio
    // runtime here makes lifecycle ownership explicit; the service method is
    // idempotent, so its constructor's runtime-aware safeguard cannot create
    // a second background loop.
    tauri::async_runtime::block_on(
        crate::scheduler::service::SchedulerService::ensure_background_started(state),
    )
    .map_err(|error| {
        std::io::Error::other(format!(
            "scheduler background loop could not start: {error}"
        ))
    })?;

    Ok(())
}

/// Stop the scheduler during application shutdown without exposing its state
/// ownership back to the root composition crate.
pub fn stop_scheduler(app_handle: &tauri::AppHandle) {
    if let Some(state) = app_handle.try_state::<crate::scheduler::service::SchedulerServiceState>()
    {
        let state = state.inner().clone();
        tauri::async_runtime::block_on(
            crate::scheduler::service::SchedulerService::stop_background(&state),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::{packaged_locales_candidates, MANAGED_STATE_REGISTRATIONS};
    use std::path::{Path, PathBuf};

    #[test]
    fn managed_state_count_matches_the_startup_registration_source() {
        let source = include_str!("ops.rs");
        let manage_call = ["app.", "manage("].concat();
        assert_eq!(
            source.matches(&manage_call).count(),
            MANAGED_STATE_REGISTRATIONS,
            "update the parity contract when operations state wiring changes"
        );
    }

    #[test]
    fn packaged_locale_candidates_cover_standard_and_custom_release_layouts() {
        assert_eq!(
            packaged_locales_candidates(
                Path::new("/usr/lib/sortOfRemoteNG"),
                Some(Path::new("/app/bin/sortOfRemoteNG")),
            ),
            vec![
                PathBuf::from("/usr/lib/sortOfRemoteNG/locales"),
                PathBuf::from("/app/bin/resources/locales"),
            ],
        );

        assert_eq!(
            packaged_locales_candidates(
                Path::new("/portable"),
                Some(Path::new("/portable/sortOfRemoteNG.exe")),
            ),
            vec![
                PathBuf::from("/portable/locales"),
                PathBuf::from("/portable/resources/locales"),
            ],
        );
    }
}
