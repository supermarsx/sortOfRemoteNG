//! Temporary-fixture coverage for real future-write policy dispatch.
use sorng_encryption::{
    artifact_policy::{self, ProtectionMode},
    ArtifactKind, EncryptionState, MasterDek,
};
use sorng_storage::{
    backup::{BackupConfig, BackupService},
    storage::{SecureStorage, StorageData},
    trust_store,
};
use std::{collections::HashMap, path::Path, sync::Arc};

async fn mode(state: &EncryptionState, root: &Path, kind: ArtifactKind, mode: ProtectionMode) {
    let _guard = sorng_encryption::settings_coordinator::lock().await;
    let doc = state
        .artifact_policy_document()
        .unwrap()
        .with_mode(kind, mode)
        .unwrap();
    std::fs::write(
        root.join(artifact_policy::POLICY_FILENAME),
        artifact_policy::encode(state, &doc).await.unwrap(),
    )
    .unwrap();
    artifact_policy::refresh(state).await;
}

#[tokio::test]
async fn connections_backup_sidecars_and_trust_follow_persisted_mode_and_locked_gate() {
    let tmp = tempfile::tempdir().unwrap();
    let state = Arc::new(EncryptionState::new());
    state.install(MasterDek::generate()).await;
    artifact_policy::initialize(&state, tmp.path()).await;
    let storage_path = tmp.path().join("storage.json");
    let storage = SecureStorage::new(storage_path.to_string_lossy().into_owned());
    storage.lock().await.set_encryption_state(state.clone());
    let data = StorageData {
        connections: vec![serde_json::json!({"id":"fixture"})],
        settings: HashMap::new(),
        timestamp: 1,
        app_data: HashMap::new(),
    };
    for protection in [
        ProtectionMode::Plaintext,
        ProtectionMode::Encrypted,
        ProtectionMode::Plaintext,
    ] {
        mode(&state, tmp.path(), ArtifactKind::Connections, protection).await;
        storage
            .lock()
            .await
            .save_data(data.clone(), false)
            .await
            .unwrap();
        assert_eq!(
            std::fs::read(&storage_path)
                .unwrap()
                .starts_with(b"SORNG\0"),
            protection == ProtectionMode::Encrypted
        );
        assert_eq!(
            storage
                .lock()
                .await
                .load_data()
                .await
                .unwrap()
                .unwrap()
                .connections,
            data.connections
        );
    }
    let backup_dir = tmp.path().join("backups");
    std::fs::create_dir(&backup_dir).unwrap();
    let backup = BackupService::new(tmp.path().to_string_lossy().into_owned());
    {
        let mut service = backup.lock().await;
        service.set_encryption_state(state.clone());
        service
            .update_config(BackupConfig {
                destination_path: backup_dir.to_string_lossy().into_owned(),
                compress_backups: false,
                delta_skip_enabled: false,
                ..BackupConfig::default()
            })
            .unwrap();
    }
    for protection in [ProtectionMode::Encrypted, ProtectionMode::Plaintext] {
        mode(&state, tmp.path(), ArtifactKind::Backups, protection).await;
        let payload = serde_json::json!({"connections":[{"id":format!("{protection:?}")} ]});
        let mut service = backup.lock().await;
        let metadata = service.run_backup("full", &payload).await.unwrap();
        assert_eq!(metadata.encrypted, protection == ProtectionMode::Encrypted);
        let sidecar = std::fs::read_dir(&backup_dir)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .find(|path| {
                let name = path.file_name().unwrap().to_string_lossy();
                name.contains(&metadata.id) && name.ends_with(".meta.json")
            })
            .unwrap();
        assert_eq!(
            std::fs::read(sidecar).unwrap().starts_with(b"SORNG\0"),
            metadata.encrypted
        );
        assert_eq!(
            service
                .restore_backup_from_target(&metadata.id, "legacy-default")
                .await
                .unwrap(),
            payload
        );
        assert!(service
            .list_backups()
            .await
            .unwrap()
            .iter()
            .any(|row| row.id == metadata.id));
    }
    let databases = tmp.path().join("databases");
    std::fs::create_dir(&databases).unwrap();
    let trust = trust_store::install_runtime(databases.clone(), Some(state.clone()));
    mode(
        &state,
        tmp.path(),
        ArtifactKind::TrustStore,
        ProtectionMode::Plaintext,
    )
    .await;
    let active = trust
        .activate_database(Some("fixture".into()), &[])
        .await
        .unwrap();
    assert!(!active.encrypted);
    let document = trust.export(None).unwrap();
    trust
        .import(None, document, trust_store::TrustImportMode::Replace)
        .unwrap();
    let trust_bytes = std::fs::read(databases.join("fixture.trust.json")).unwrap();
    assert!(!sorng_storage::sdbf::parse_and_verify(&trust_bytes)
        .unwrap()
        .starts_with(b"SORNG\0"));
    let before = std::fs::read(&storage_path).unwrap();
    // Native mutation entry points cannot delete a staged source or discard
    // configured recovery roots while a transition is running/pending.
    let original_config = backup.lock().await.get_config();
    {
        let coordinator = sorng_encryption::settings_coordinator::lock().await;
        assert!(storage.lock().await.clear_storage().await.is_err());
        assert!(backup
            .lock()
            .await
            .update_config(BackupConfig::default())
            .is_err());
        assert!(trust.delete_store("fixture").is_err());
        drop(coordinator);
    }
    state.set_artifact_recovery_required(true);
    assert!(storage.lock().await.clear_storage().await.is_err());
    assert!(backup
        .lock()
        .await
        .update_config(BackupConfig::default())
        .is_err());
    assert!(trust.delete_store("fixture").is_err());
    assert_eq!(
        backup.lock().await.get_config().destination_path,
        original_config.destination_path
    );
    assert_eq!(std::fs::read(&storage_path).unwrap(), before);
    assert_eq!(
        std::fs::read(databases.join("fixture.trust.json")).unwrap(),
        trust_bytes
    );
    state.set_artifact_recovery_required(false);
    state.lock().await;
    assert!(storage.lock().await.save_data(data, false).await.is_err());
    assert!(storage.lock().await.load_data().await.is_err());
    assert!(backup
        .lock()
        .await
        .run_backup("full", &serde_json::json!({}))
        .await
        .is_err());
    assert!(trust
        .activate_database(Some("blocked".into()), &[])
        .await
        .is_err());
    assert_eq!(std::fs::read(storage_path).unwrap(), before);
    assert!(!databases.join("blocked.trust.json").exists());
}
