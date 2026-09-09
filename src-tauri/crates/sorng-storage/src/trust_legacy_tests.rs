use super::*;

fn record(host: &str, fingerprint: &str) -> TrustRecord {
    let mut data = TrustStoreData::default();
    trust_identity_in_data(
        &mut data,
        host.into(),
        "ssh".into(),
        Identity::Ssh(SshHostKeyIdentity {
            fingerprint: fingerprint.into(),
            key_type: None,
            key_bits: None,
            first_seen: "2026-01-01".into(),
            last_seen: "2026-01-01".into(),
            public_key: None,
            algorithms_offered: vec![],
        }),
        true,
        IdentityChangeReason::Initial,
        None,
        None,
    );
    data.records.into_values().next().unwrap()
}
fn write_value(path: &Path, value: &Value) {
    sdbf::safe_write(path, &serde_json::to_vec(value).unwrap()).unwrap();
}
fn fixture() -> (tempfile::TempDir, TrustRuntime, Value) {
    let root = tempfile::tempdir().unwrap();
    let databases = root.path().join("databases");
    std::fs::create_dir(&databases).unwrap();
    let payload = json!({"connections":[{"id":"one"}],"settings":{}});
    write_value(
        &databases.join("index.json"),
        &json!([{"id":"db","isEncrypted":false,"securityRevision":"r0"}]),
    );
    write_value(&databases.join("db.json"), &payload);
    let mut legacy = TrustStoreData::default();
    for host in [
        "global:22",
        "revoked:22",
        "forgotten:22",
        "@sorng/connection/v1/one/scoped:22",
        "@sorng/connection/v1/other/scoped:22",
    ] {
        legacy
            .records
            .insert(format!("ssh:{host}"), record(host, "old"));
    }
    persist_trust_store_data(&root.path().join(LEGACY_TRUST_FILE), &legacy).unwrap();
    let rt = TrustRuntime {
        databases_dir: databases,
        app_dir: root.path().into(),
        enc_state: None,
        active: RwLock::new(None),
        io: std::sync::Mutex::new(()),
    };
    (root, rt, payload)
}
async fn migrate(
    rt: &TrustRuntime,
    payload: &Value,
) -> Result<TrustLegacyMigrationOutcome, String> {
    let coordinator = sorng_encryption::settings_coordinator::lock().await;
    rt.migrate_legacy_database_with_coordinator_guard(
        &rt.app_dir,
        "db",
        "r0",
        payload,
        &["one".into()],
        &coordinator,
        || Ok(()),
    )
}

#[tokio::test]
async fn migration_preserves_revocation_forget_scope_and_active_database() {
    let _fixture = crate::STORAGE_FIXTURE.lock().await;
    let (root, rt, payload) = fixture();
    rt.set_active(Some("another".into()), None).unwrap();
    let mut destination = TrustStoreData {
        policy: TrustPolicy::Strict,
        ..Default::default()
    };
    let mut revoked = record("revoked:22", "newer");
    revoked.revoked = true;
    revoked.trust_expires = Some("2027-01-01".into());
    destination
        .records
        .insert("ssh:revoked:22".into(), revoked.clone());
    destination
        .legacy_suppressed_keys
        .insert("ssh:forgotten:22".into());
    rt.write_file(&rt.trust_file_path("db").unwrap(), &destination)
        .unwrap();
    let source = std::fs::read(root.path().join(LEGACY_TRUST_FILE)).unwrap();
    assert!(!rt.legacy_status().unwrap().can_delete_legacy);
    assert!(rt.delete_legacy_stores().is_err());
    let result = migrate(&rt, &payload).await.unwrap();
    assert_eq!(result.migrated_records, 2);
    assert_eq!(result.preserved_records, 2);
    assert_eq!(rt.active_database_id().as_deref(), Some("another"));
    let data = rt.strict_trust("db").unwrap().unwrap();
    assert_eq!(data.policy, TrustPolicy::Strict);
    assert_eq!(
        serde_json::to_value(&data.records["ssh:revoked:22"]).unwrap(),
        serde_json::to_value(revoked).unwrap()
    );
    assert!(!data.records.contains_key("ssh:forgotten:22"));
    assert!(!data
        .records
        .contains_key("ssh:@sorng/connection/v1/other/scoped:22"));
    assert!(rt.legacy_status().unwrap().can_delete_legacy);
    assert_eq!(
        migrate(&rt, &payload).await.unwrap().status,
        "already-verified"
    );
    assert_eq!(
        std::fs::read(root.path().join(LEGACY_TRUST_FILE)).unwrap(),
        source
    );
    assert_eq!(rt.delete_legacy_stores().unwrap(), 1);
    assert!(rt.trust_file_path("db").unwrap().exists());
}

#[tokio::test]
async fn migration_receipt_ignores_verification_statistics_but_rejects_decision_or_payload_drift() {
    let _fixture = crate::STORAGE_FIXTURE.lock().await;
    let (_root, rt, payload) = fixture();
    migrate(&rt, &payload).await.unwrap();
    let path = rt.trust_file_path("db").unwrap();
    let mut data = rt.strict_trust("db").unwrap().unwrap();
    let r = data.records.get_mut("ssh:global:22").unwrap();
    r.stats.total_checks += 1;
    if let Identity::Ssh(identity) = &mut r.identity {
        identity.last_seen = "2030-01-01".into();
    }
    rt.write_file(&path, &data).unwrap();
    assert!(rt.legacy_status().unwrap().can_delete_legacy);
    data.records.get_mut("ssh:global:22").unwrap().revoked = true;
    rt.write_file(&path, &data).unwrap();
    assert!(!rt.legacy_status().unwrap().can_delete_legacy);
    assert!(rt.delete_legacy_stores().is_err());
    migrate(&rt, &payload).await.unwrap();
    let edited = json!({"connections":[{"id":"different"}],"settings":{}});
    write_value(&rt.databases_dir.join("db.json"), &edited);
    assert!(!rt.legacy_status().unwrap().can_delete_legacy);
    assert!(migrate(&rt, &payload).await.is_err());
    assert!(rt.delete_legacy_stores().is_err());
}

#[tokio::test]
async fn migration_unknown_corrupt_missing_generations_and_sources_block_cleanup() {
    let _fixture = crate::STORAGE_FIXTURE.lock().await;
    for name in [
        "trust_store.json",
        "databases/index.json",
        "databases/db.json",
        "databases/db.trust.json",
        "trust_store.json.tmp",
        "trust_store.json.previous",
        "databases/db.trust.json.tmp",
        "databases/orphan.json",
        "databases/index.json.bak",
    ] {
        let (root, rt, payload) = fixture();
        migrate(&rt, &payload).await.unwrap();
        std::fs::write(root.path().join(name), b"broken").unwrap();
        let status = rt.legacy_status().unwrap();
        assert!(!status.can_delete_legacy, "{name}");
        assert!(!status.blockers.is_empty(), "{name}");
        assert!(rt.delete_legacy_stores().is_err(), "{name}");
        assert!(root.path().join(LEGACY_TRUST_FILE).exists());
    }
    for name in [
        "databases/index.json",
        "databases/db.json",
        "databases/db.trust.json",
    ] {
        let (root, rt, payload) = fixture();
        migrate(&rt, &payload).await.unwrap();
        std::fs::remove_file(root.path().join(name)).unwrap();
        assert!(!rt.legacy_status().unwrap().can_delete_legacy, "{name}");
        assert!(rt.delete_legacy_stores().is_err());
    }
}

#[tokio::test]
async fn migration_includes_backup_only_source_and_rejects_source_drift() {
    let _fixture = crate::STORAGE_FIXTURE.lock().await;
    let (root, rt, payload) = fixture();
    let path = root.path().join(LEGACY_TRUST_FILE);
    let backup = PathBuf::from(format!("{}.v0.bak", path.display()));
    std::fs::rename(&path, &backup).unwrap();
    migrate(&rt, &payload).await.unwrap();
    assert!(rt.legacy_status().unwrap().can_delete_legacy);
    let mut data: TrustStoreData =
        serde_json::from_slice(&std::fs::read(&backup).unwrap()).unwrap();
    data.records
        .insert("ssh:new:22".into(), record("new:22", "xx"));
    std::fs::write(&backup, serde_json::to_vec(&data).unwrap()).unwrap();
    assert!(!rt.legacy_status().unwrap().can_delete_legacy);
    assert!(rt.delete_legacy_stores().is_err());
    migrate(&rt, &payload).await.unwrap();
    assert_eq!(rt.delete_legacy_stores().unwrap(), 1);
}

#[tokio::test]
async fn migration_global_lock_and_invalid_scope_leave_all_bytes_unchanged() {
    let _fixture = crate::STORAGE_FIXTURE.lock().await;
    let (root, mut rt, payload) = fixture();
    let state = Arc::new(EncryptionState::new());
    state.install(sorng_encryption::MasterDek::generate()).await;
    state.lock().await;
    rt.enc_state = Some(state);
    let before = std::fs::read(root.path().join(LEGACY_TRUST_FILE)).unwrap();
    assert!(migrate(&rt, &payload).await.is_err());
    assert!(rt.delete_legacy_stores().is_err());
    assert!(!rt.legacy_status().unwrap().can_delete_legacy);
    assert_eq!(
        std::fs::read(root.path().join(LEGACY_TRUST_FILE)).unwrap(),
        before
    );
    assert!(!rt.trust_file_path("db").unwrap().exists());
    rt.enc_state = None;
    let coordinator = sorng_encryption::settings_coordinator::lock().await;
    let other_profile = tempfile::tempdir().unwrap();
    assert!(rt
        .migrate_legacy_database_with_coordinator_guard(
            other_profile.path(),
            "db",
            "r0",
            &payload,
            &["one".into()],
            &coordinator,
            || Ok(()),
        )
        .is_err());
    for ids in [vec!["../bad".into()], vec!["one".into(), "one".into()]] {
        assert!(rt
            .migrate_legacy_database_with_coordinator_guard(
                root.path(),
                "db",
                "r0",
                &payload,
                &ids,
                &coordinator,
                || Ok(()),
            )
            .is_err());
    }
    assert!(rt
        .migrate_legacy_database_with_coordinator_guard(
            root.path(),
            "db",
            "changed",
            &payload,
            &[],
            &coordinator,
            || Ok(()),
        )
        .is_err());
    assert!(!rt.trust_file_path("db").unwrap().exists());
}

#[tokio::test]
async fn migration_cleanup_rechecks_source_after_coverage_before_any_deletion() {
    let _fixture = crate::STORAGE_FIXTURE.lock().await;
    let (root, rt, payload) = fixture();
    migrate(&rt, &payload).await.unwrap();
    let source = root.path().join(LEGACY_TRUST_FILE);
    assert!(rt
        .delete_legacy_stores_checked(|| {
            let mut data: TrustStoreData =
                serde_json::from_slice(&std::fs::read(&source).unwrap()).unwrap();
            data.records
                .insert("ssh:late:22".into(), record("late:22", "late"));
            std::fs::write(&source, serde_json::to_vec(&data).unwrap()).unwrap();
        })
        .is_err());
    assert!(source.is_file());
    assert!(!rt.legacy_status().unwrap().can_delete_legacy);
}

#[tokio::test]
async fn migration_preserves_missing_backup_records_and_streams_inventory_to_digests() {
    let _fixture = crate::STORAGE_FIXTURE.lock().await;
    let (root, rt, payload) = fixture();
    let mut backup = TrustStoreData::default();
    backup.records.insert(
        "ssh:backup-only:22".into(),
        record("backup-only:22", "kept"),
    );
    backup
        .legacy_suppressed_keys
        .insert("ssh:only-forgotten:22".into());
    std::fs::write(
        root.path().join("trust_store.json.bak"),
        serde_json::to_vec(&backup).unwrap(),
    )
    .unwrap();
    migrate(&rt, &payload).await.unwrap();
    assert!(rt
        .strict_trust("db")
        .unwrap()
        .unwrap()
        .records
        .contains_key("ssh:backup-only:22"));
    assert!(rt
        .strict_trust("db")
        .unwrap()
        .unwrap()
        .legacy_suppressed_keys
        .contains("ssh:only-forgotten:22"));
    let inventory = rt.database_inventory().unwrap();
    assert_eq!(inventory["db"].1.len(), 64);
    assert_eq!(rt.delete_legacy_stores().unwrap(), 2);
}

#[tokio::test]
async fn migration_preserves_authenticated_destination_protection() {
    let _fixture = crate::STORAGE_FIXTURE.lock().await;
    let (_root, mut rt, payload) = fixture();
    let state = Arc::new(EncryptionState::new());
    state.install(sorng_encryption::MasterDek::generate()).await;
    for (name, kind) in [
        ("index.json", ArtifactKind::DatabasesIndex),
        ("db.json", ArtifactKind::Connections),
    ] {
        let path = rt.databases_dir.join(name);
        let raw = sdbf::safe_read_raw(&path).unwrap().unwrap().0;
        let bytes = state
            .with_sub_key_sync(kind, |key| encrypt_with_subkey(key.unwrap(), &raw))
            .unwrap()
            .unwrap();
        // Avoid creating a deliberately mixed plaintext recovery generation in
        // this fixture: strict inventory correctly requires that be recovered.
        std::fs::write(
            &path,
            [sdbf::encode_preamble(&bytes).as_slice(), bytes.as_slice()].concat(),
        )
        .unwrap();
    }
    rt.enc_state = Some(state.clone());
    migrate(&rt, &payload).await.unwrap();
    let destination = rt.trust_file_path("db").unwrap();
    assert!(is_envelope_blob(
        &sdbf::safe_read_raw(&destination).unwrap().unwrap().0
    ));
    assert!(rt.legacy_status().unwrap().can_delete_legacy);
    state.lock().await;
    assert!(!rt.legacy_status().unwrap().can_delete_legacy);
    assert!(rt.delete_legacy_stores().is_err());
}

#[tokio::test]
async fn migration_rechecks_expired_access_before_write_and_already_verified_return() {
    let _fixture = crate::STORAGE_FIXTURE.lock().await;
    for existing in [false, true] {
        let (root, rt, payload) = fixture();
        if existing {
            migrate(&rt, &payload).await.unwrap();
        }
        let destination = rt.trust_file_path("db").unwrap();
        let before = std::fs::read(&destination).ok();
        let source = std::fs::read(root.path().join(LEGACY_TRUST_FILE)).unwrap();
        let coordinator = sorng_encryption::settings_coordinator::lock().await;
        let called = std::cell::Cell::new(false);
        let result = rt.migrate_legacy_database_with_coordinator_guard(
            root.path(),
            "db",
            "r0",
            &payload,
            &["one".into()],
            &coordinator,
            || {
                called.set(true);
                Err("native unlock session expired during scan".into())
            },
        );
        assert!(called.get());
        assert!(result.unwrap_err().contains("expired"));
        assert_eq!(std::fs::read(&destination).ok(), before);
        assert_eq!(
            std::fs::read(root.path().join(LEGACY_TRUST_FILE)).unwrap(),
            source
        );
    }
}
