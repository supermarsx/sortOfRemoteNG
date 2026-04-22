use super::*;

pub(crate) fn register(app: &mut tauri::App<tauri::Wry>, app_dir: &std::path::Path) {
    let cert_auth_service = CertAuthService::new("certificates.db".to_string());
    app.manage(cert_auth_service.clone());

    let cert_gen_service = CertGenService::new("cert_gen_store.json".to_string());
    app.manage(cert_gen_service.clone());

    let legacy_crypto_policy_state = legacy_crypto::new_policy_state();
    app.manage(legacy_crypto_policy_state);

    let two_factor_service = TwoFactorService::new();
    app.manage(two_factor_service.clone());

    // TOTP authenticator service (sorng-totp, 36 tauri commands)
    let totp_service: TotpServiceState = TotpService::new();
    app.manage(totp_service);

    let bearer_auth_service = BearerAuthService::new();
    app.manage(bearer_auth_service.clone());

    let auto_lock_service = AutoLockService::new();
    app.manage(auto_lock_service.clone());

    let auto_lock_clone = auto_lock_service.clone();
    tauri::async_runtime::spawn(async move {
        auto_lock_clone.lock().await.start_monitoring().await;
    });

    let gpo_service = GpoService::new();
    app.manage(gpo_service.clone());

    let login_detection_service = LoginDetectionService::new();
    app.manage(login_detection_service.clone());

    let telnet_service = TelnetService::new();
    app.manage(telnet_service.clone());

    let serial_service = SerialService::new();
    app.manage(serial_service.clone());

    let rlogin_service = RloginService::new();
    app.manage(rlogin_service.clone());

    let raw_socket_service = RawSocketService::new();
    app.manage(raw_socket_service.clone());

    let gcp_service = GcpService::new();
    app.manage(gcp_service.clone());

    // Oracle Cloud Infrastructure — sorng-oracle-cloud (67 tauri commands).
    // OciService::new() returns Arc<Mutex<OciService>> (OciServiceState).
    let oci_service = OciService::new();
    app.manage(oci_service);

    let azure_service = AzureService::new();
    app.manage(azure_service.clone());

    let exchange_service = ExchangeService::new();
    app.manage(exchange_service.clone());

    let smtp_service = SmtpService::new();
    app.manage(smtp_service.clone());

    let ibm_service = IbmService::new();
    app.manage(ibm_service.clone());

    let digital_ocean_service = DigitalOceanService::new();
    app.manage(digital_ocean_service.clone());

    let heroku_service = HerokuService::new();
    app.manage(heroku_service.clone());

    let scaleway_service = ScalewayService::new();
    app.manage(scaleway_service.clone());

    let linode_service = LinodeService::new();
    app.manage(linode_service.clone());

    let ovh_service = OvhService::new();
    app.manage(ovh_service.clone());

    let http_service = HttpService::new();
    app.manage(http_service.clone());

    let proxy_session_mgr = ProxySessionManager::new();
    app.manage(proxy_session_mgr.clone());

    let passkey_service = PasskeyService::new();
    app.manage(passkey_service.clone());

    let ssh3_service: ssh3::Ssh3ServiceState = Arc::new(Mutex::new(Ssh3Service::new()));
    app.manage(ssh3_service.clone());

    let backup_path = app_dir.join("backups");
    let backup_service = backup::BackupService::new(backup_path.to_string_lossy().to_string());
    app.manage(backup_service.clone());

    let bw_service = BitwardenService::new_state();
    app.manage(bw_service);

    let keepass_service = KeePassService::new();
    app.manage(keepass_service.clone());

    let pb_service = PassboltService::new_state();
    app.manage(pb_service);

    let scp_service = ScpService::new();
    app.manage(scp_service.clone());

    #[cfg(feature = "db-mysql")]
    {
        let mysql_service: MysqlServiceState = mysql::service::new_state();
        app.manage(mysql_service);
    }

    #[cfg(feature = "db-postgres")]
    {
        let postgres_service: PostgresServiceState = postgres::service::new_state();
        app.manage(postgres_service);
    }

    #[cfg(feature = "db-mssql")]
    {
        let mssql_service: MssqlServiceState = mssql::service::new_state();
        app.manage(mssql_service);
    }

    #[cfg(feature = "db-sqlite")]
    {
        let sqlite_service: SqliteServiceState = sqlite::service::new_state();
        app.manage(sqlite_service);
    }

    #[cfg(feature = "db-mongo")]
    {
        let mongodb_service: MongoServiceState = mongodb::service::new_state();
        app.manage(mongodb_service);
    }

    #[cfg(feature = "db-redis")]
    {
        let redis_service: RedisServiceState = redis::service::new_state();
        app.manage(redis_service);
    }
}
