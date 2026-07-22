use super::*;

pub(super) fn register(
    app: &mut tauri::App<tauri::Wry>,
    app_dir: &std::path::Path,
    serial_emitter: DynEventEmitter,
    event_emitter_factory: EventEmitterFactory,
) {
    app.manage(CertAuthService::new("certificates.db".to_string()));
    app.manage(CertGenService::new("cert_gen_store.json".to_string()));
    app.manage(legacy_crypto::new_policy_state());
    app.manage(TwoFactorService::new());
    let totp_service: TotpServiceState = TotpService::new();
    app.manage(totp_service);
    app.manage(BearerAuthService::new());

    let auto_lock_service = AutoLockService::new();
    app.manage(auto_lock_service.clone());
    tauri::async_runtime::spawn(async move {
        auto_lock_service.lock().await.start_monitoring().await;
    });

    app.manage(GpoService::new());
    app.manage(LoginDetectionService::new());
    app.manage(TelnetService::new());
    app.manage(SerialService::new_with_emitter(serial_emitter));
    app.manage(RloginService::new());
    app.manage(RawSocketService::new());
    app.manage(GcpService::new());
    app.manage(OciService::new());
    app.manage(AzureService::new());
    app.manage(ExchangeService::new());
    app.manage(SmtpService::new());
    app.manage(HetznerService::new());
    app.manage(IbmService::new());
    app.manage(DigitalOceanService::new());
    app.manage(HerokuService::new());
    app.manage(ScalewayService::new());
    app.manage(LinodeService::new());
    app.manage(OvhService::new());
    app.manage(HttpService::new());
    app.manage(ProxySessionManager::new());
    app.manage(PasskeyService::new());
    let ssh3_emitter = event_emitter_factory(app.handle());
    app.manage(Ssh3Service::new_with_emitter(ssh3_emitter));

    let backup_service =
        backup::BackupService::new(app_dir.join("backups").to_string_lossy().to_string());
    if let Some(enc_handle) = app.try_state::<sorng_encryption::EncryptionState>() {
        let enc_arc = Arc::new(enc_handle.inner().clone());
        let svc = backup_service.clone();
        tauri::async_runtime::block_on(async move {
            svc.lock().await.set_encryption_state(enc_arc);
        });
    }
    app.manage(backup_service);
    app.manage(BitwardenService::new_state());
    app.manage(KeePassService::new());
    app.manage(PassboltService::new_state());
    app.manage(ScpService::new());

    #[cfg(feature = "db-mysql")]
    {
        let state: MysqlServiceState = mysql::service::new_state();
        app.manage(state);
    }
    #[cfg(feature = "db-postgres")]
    {
        let state: PostgresServiceState = postgres::service::new_state();
        app.manage(state);
    }
    #[cfg(feature = "db-mssql")]
    {
        let state: MssqlServiceState = mssql::service::new_state();
        app.manage(state);
    }
    #[cfg(feature = "db-sqlite")]
    {
        let state: SqliteServiceState = sqlite::service::new_state();
        app.manage(state);
    }
    #[cfg(feature = "db-mongo")]
    {
        let state: MongoServiceState = mongodb::service::new_state();
        app.manage(state);
    }
    #[cfg(feature = "db-redis")]
    {
        let state: RedisServiceState = redis::service::new_state();
        app.manage(state);
    }
}
