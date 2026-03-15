use super::*;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;

pub(crate) fn register(app: &mut tauri::App<tauri::Wry>, app_dir: &std::path::Path) {
    let k8s_state: K8sServiceState = Arc::new(Mutex::new(k8s::service::K8sService::new()));
    app.manage(k8s_state);

    let docker_state: DockerServiceState =
        Arc::new(Mutex::new(docker::service::DockerService::new()));
    app.manage(docker_state);

    let lxd_service = LxdService::new();
    app.manage(lxd_service);

    let ansible_state: AnsibleServiceState =
        Arc::new(Mutex::new(ansible::service::AnsibleService::new()));
    app.manage(ansible_state);

    let terraform_state: TerraformServiceState =
        Arc::new(Mutex::new(terraform::service::TerraformService::new()));
    app.manage(terraform_state);

    let budibase_state: BudibaseServiceState =
        Arc::new(Mutex::new(budibase::service::BudibaseService::new()));
    app.manage(budibase_state);

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

    let locales_dir = app
        .path()
        .resource_dir()
        .unwrap_or_else(|_| app_dir.to_path_buf())
        .join("locales");
    let locales_dir = if locales_dir.exists() {
        locales_dir
    } else {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("src")
            .join("i18n")
            .join("locales")
    };
    let i18n_engine = match i18n::I18nEngine::new(&locales_dir, "en") {
        Ok(engine) => Arc::new(engine),
        Err(err) => {
            log::warn!("i18n: failed to initialise engine: {err}");
            Arc::new(i18n::I18nEngine::new_empty("en"))
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
}
