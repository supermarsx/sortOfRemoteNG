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
        AutoLockService::start_monitoring(&auto_lock_service).await;
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
    register_recording(app, app_dir);
    register_llm(app);
    register_telegram(app);
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
    #[cfg(any(feature = "db-sqlite", feature = "db-sqlite-dynamic"))]
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

/// LLM settings and core IPC are available in lean builds too. Optional AI and
/// palette consumers retrieve this exact state instead of creating another router.
pub(super) fn register_llm<R: tauri::Runtime>(app: &impl tauri::Manager<R>) -> LlmServiceState {
    if let Some(existing) = app.try_state::<LlmServiceState>() {
        return existing.inner().clone();
    }
    let state = sorng_llm::service::create_llm_state();
    app.manage(state.clone());
    state
}

/// Register the local bot registry without configuring clients or starting any
/// polling, webhook, notification or other network work.
pub(super) fn register_telegram<R: tauri::Runtime>(
    app: &impl tauri::Manager<R>,
) -> sorng_telegram::TelegramServiceState {
    if let Some(existing) = app.try_state::<sorng_telegram::TelegramServiceState>() {
        return existing.inner().clone();
    }
    let state = sorng_telegram::service::TelegramService::new();
    app.manage(state.clone());
    state
}

/// Full master-key rotation includes recordings in every build, even when the
/// optional recording UI/commands are absent. Manage its real service once and
/// bind it to the same live encryption state used by the other storage services.
pub(super) fn register_recording<R: tauri::Runtime>(
    app: &impl tauri::Manager<R>,
    app_dir: &std::path::Path,
) {
    let encryption = Arc::new(
        app.state::<sorng_encryption::EncryptionState>()
            .inner()
            .clone(),
    );
    let rec_state: RecordingServiceState =
        sorng_recording::service::new_service_state(&app_dir.to_string_lossy());
    tauri::async_runtime::block_on(async {
        rec_state
            .lock()
            .await
            .set_encryption_state(encryption)
            .await;
    });
    app.manage(rec_state);
}

#[cfg(test)]
mod tests {
    use super::*;
    use sorng_encryption::{EncryptionState, MasterDek};
    use sorng_recording::types::SavedRecordingEnvelope;
    use tauri::test::{mock_builder, mock_context, noop_assets};

    // Exercise exactly the four typed State arguments of the real full-rotation
    // command, but never invoke that command, its keychain probe or rotation.
    #[tauri::command]
    fn rotation_state_probe(
        enc_state: tauri::State<'_, EncryptionState>,
        storage_state: tauri::State<'_, storage::SecureStorageState>,
        backup_state: tauri::State<'_, backup::BackupServiceState>,
        recording_state: tauri::State<'_, sorng_recording::service::RecordingServiceState>,
    ) -> bool {
        let _ = (
            enc_state.inner(),
            storage_state.inner(),
            backup_state.inner(),
            recording_state.inner(),
        );
        true
    }

    #[test]
    fn full_rotation_recording_state_is_managed_without_optional_features() {
        let root = tempfile::tempdir().unwrap();
        let fixture = mock_builder()
            .invoke_handler(tauri::generate_handler![rotation_state_probe])
            .build(mock_context(noop_assets()))
            .unwrap();
        fixture.manage(EncryptionState::new());
        fixture.manage(SecureStorage::new(
            root.path()
                .join("storage.json")
                .to_string_lossy()
                .into_owned(),
        ));
        fixture.manage(backup::BackupService::new(
            root.path().join("backups").to_string_lossy().into_owned(),
        ));
        register_recording(&fixture, root.path());
        assert!(fixture
            .try_state::<sorng_recording::service::RecordingServiceState>()
            .is_some());
        let view = tauri::WebviewWindowBuilder::new(&fixture, "state-probe", Default::default())
            .build()
            .unwrap();
        tauri::test::assert_ipc_response(
            &view,
            tauri::webview::InvokeRequest {
                cmd: "rotation_state_probe".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: view.url().expect("fixture webview URL"),
                body: tauri::ipc::InvokeBody::default(),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
            Ok(true),
        );
        assert_eq!(
            SECURITY_DATA_REGISTRATION_ORDER
                .iter()
                .filter(|name| **name == "RecordingServiceState")
                .count(),
            1
        );
        assert!(!COLLAB_REGISTRATION_ORDER.contains(&"RecordingServiceState"));
    }

    #[test]
    fn recording_registrar_injects_the_shared_live_encryption_state() {
        let root = tempfile::tempdir().unwrap();
        let fixture = mock_builder().build(mock_context(noop_assets())).unwrap();
        let encryption = EncryptionState::new();
        fixture.manage(encryption.clone());
        register_recording(&fixture, root.path());
        let recording = fixture.state::<RecordingServiceState>().inner().clone();
        tauri::async_runtime::block_on(async {
            let service = recording.lock().await;
            assert!(service
                .storage_root_snapshot()
                .await
                .starts_with(root.path()));
            let envelope: SavedRecordingEnvelope = serde_json::from_value(serde_json::json!({
                "id": "startup-fixture", "name": "Startup fixture", "protocol": "ssh",
                "saved_at": "2026-01-01T00:00:00Z", "duration_ms": 0, "size_bytes": 2,
                "compression": "none", "format": "json", "tags": [], "data": "{}"
            }))
            .unwrap();
            assert!(service.save_to_library(envelope.clone()).await.is_err());
            encryption
                .install(MasterDek::from_bytes(&[41u8; 32]).unwrap())
                .await;
            service.save_to_library(envelope.clone()).await.unwrap();
            let storage_root = service.storage_root_snapshot().await;
            assert!(storage_root
                .join("recordings/startup-fixture.json.enc")
                .is_file());
            assert!(!storage_root
                .join("recordings/startup-fixture.json")
                .exists());
            encryption.lock().await;
            assert!(service.save_to_library(envelope).await.is_err());
        });
    }
}
