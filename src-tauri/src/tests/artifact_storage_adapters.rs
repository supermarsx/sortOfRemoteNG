//! Native artifact adapter safety fixtures. No application profile or vault.
use super::*;
use sorng_encryption::{artifact_policy, MasterDek};

async fn fixture() -> (tempfile::TempDir, ArtifactRoots, EncryptionState) {
    let dir = tempfile::tempdir().unwrap();
    let roots = ArtifactRoots {
        app_data: dir.path().join("profile"),
        legacy_storage: dir.path().join("profile/storage.json"),
        recordings: dir.path().join("recording"),
        backups: vec![dir.path().join("backups")],
        backup_restrictions: vec![],
        logs: dir.path().join("profile/logs"),
    };
    for path in [
        &roots.app_data,
        &roots.recordings,
        &roots.logs,
        &roots.backups[0],
    ] {
        fs::create_dir_all(path).unwrap();
    }
    let state = EncryptionState::new();
    state.install(MasterDek::generate()).await;
    artifact_policy::initialize(&state, &roots.app_data).await;
    (dir, roots, state)
}

#[tokio::test]
async fn credential_vault_blocks_connections_decryption_including_recovery_generations() {
    let _guard = sorng_encryption::settings_coordinator::lock().await;
    for suffix in ["", ".bak", ".v0.bak"] {
        for vault in [
            serde_json::json!({"version":1,"revision":1,"entries":[{"facets":{"password":"SYNTHETIC_PRIVATE"}}]}),
            serde_json::Value::Null,
        ] {
            let (_dir, roots, state) = fixture().await;
            let path = roots.app_data.join(format!("databases/db.json{suffix}"));
            let plain =
                serde_json::to_vec(&serde_json::json!({"connections":[],"credentialVault":vault}))
                    .unwrap();
            let encrypted = encoded_bytes(&state, ArtifactKind::Connections, &plain, true)
                .await
                .unwrap();
            let original = sdbf_bytes(&encrypted);
            put(&path, &original);
            let inventory = scan(&roots, &state).await.unwrap();
            let mut tx = ArtifactTransaction::begin(&roots.app_data, &inventory.roots, &state)
                .await
                .unwrap();
            let error = prepare_artifact(
                &inventory,
                ArtifactKind::Connections,
                ProtectionMode::Plaintext,
                &state,
                &mut tx,
                &|_, _| Ok(()),
            )
            .await
            .unwrap_err();
            assert!(error.contains("credential vault"), "{error}");
            assert!(!error.contains("SYNTHETIC_PRIVATE"));
            tx.recover().unwrap();
            assert_eq!(fs::read(&path).unwrap(), original);
            assert!(!artifact_transaction::has_pending(&roots.app_data).unwrap());
            assert!(!roots
                .app_data
                .join(artifact_policy::POLICY_FILENAME)
                .exists());
        }
    }
}

#[tokio::test]
async fn credential_vault_empty_or_inner_ciphertext_keeps_supported_outer_policy_transition() {
    let _guard = sorng_encryption::settings_coordinator::lock().await;
    for data in [
        serde_json::json!({"connections":[],"credentialVault":{"version":1,"revision":0,"entries":[]}}),
        serde_json::json!("opaque-password-envelope.salt.iv.ciphertext"),
    ] {
        let (_dir, roots, state) = fixture().await;
        let path = roots.app_data.join("databases/db.json");
        let plain = serde_json::to_vec(&data).unwrap();
        put(
            &path,
            &sdbf_bytes(
                &encoded_bytes(&state, ArtifactKind::Connections, &plain, true)
                    .await
                    .unwrap(),
            ),
        );
        convert(
            &roots,
            &state,
            ArtifactKind::Connections,
            ProtectionMode::Plaintext,
        )
        .await;
        assert_eq!(
            sdbf::parse_and_verify(&fs::read(&path).unwrap()).unwrap(),
            plain
        );
    }
}

fn put(path: &Path, bytes: &[u8]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, bytes).unwrap();
}

#[tokio::test]
async fn opaque_macro_libraries_are_inventoried_and_convert_without_json_canonicalization() {
    let (_dir, roots, state) = fixture().await;
    let raw = " { \"z\": [\"script body\\nkept verbatim\"], \"a\": 1 }\n";
    for key in [
        sorng_recording::macro_library::TERMINAL_KEY,
        sorng_recording::macro_library::WEB_KEY,
    ] {
        assert!(sorng_recording::macro_library::compare_and_swap(
            &roots.recordings,
            key,
            None,
            raw,
            Some(&state),
            false
        )
        .await
        .unwrap());
    }
    let inventory = scan(&roots, &state).await.unwrap();
    assert_eq!(status(&inventory, ArtifactKind::Macros).plaintext_files, 2);
    assert_eq!(status(&inventory, ArtifactKind::Macros).encrypted_files, 0);
    for target in [ProtectionMode::Encrypted, ProtectionMode::Plaintext] {
        convert(&roots, &state, ArtifactKind::Macros, target).await;
        let inventory = scan(&roots, &state).await.unwrap();
        let row = status(&inventory, ArtifactKind::Macros);
        assert_eq!(row.unverified_files, 0);
        if target == ProtectionMode::Encrypted {
            assert_eq!((row.encrypted_files, row.plaintext_files), (2, 0));
        } else {
            assert_eq!((row.encrypted_files, row.plaintext_files), (0, 2));
        }
        for key in [
            sorng_recording::macro_library::TERMINAL_KEY,
            sorng_recording::macro_library::WEB_KEY,
        ] {
            assert_eq!(
                sorng_recording::macro_library::read(&roots.recordings, key, Some(&state))
                    .await
                    .unwrap()
                    .as_deref(),
                Some(raw)
            );
        }
        assert!(
            sorng_recording::storage::load_all_macros_dispatched(&roots.recordings, &state)
                .await
                .unwrap()
                .is_empty()
        );
    }
}

fn sdbf_bytes(payload: &[u8]) -> Vec<u8> {
    let mut bytes = sdbf::encode_preamble(payload).to_vec();
    bytes.extend_from_slice(payload);
    bytes
}

fn status(scan: &ArtifactScan, kind: ArtifactKind) -> &ArtifactStatus {
    scan.rows.iter().find(|row| row.id == kind).unwrap()
}

async fn convert(
    roots: &ArtifactRoots,
    state: &EncryptionState,
    kind: ArtifactKind,
    target: ProtectionMode,
) {
    let inventory = scan(roots, state).await.unwrap();
    assert!(
        status(&inventory, kind).mutable,
        "{:?}: {:?}",
        kind,
        status(&inventory, kind).reason
    );
    let mut tx = ArtifactTransaction::begin(&roots.app_data, &inventory.roots, state)
        .await
        .unwrap();
    prepare_artifact(&inventory, kind, target, state, &mut tx, &|_, _| Ok(()))
        .await
        .unwrap();
    tx.commit().unwrap();
    assert!(!artifact_transaction::has_pending(&roots.app_data).unwrap());
    // The production orchestrator reloads the policy after the durable journal
    // is removed. Mirror that lifecycle before starting another conversion.
    artifact_policy::refresh(state).await;
}

fn backup(roots: &ArtifactRoots, suffix: &str) -> (PathBuf, PathBuf, Vec<u8>) {
    let archive = roots.backups[0].join(format!("backup_full_fixture.json.gz{suffix}"));
    let metadata = roots.backups[0].join(format!("backup_full_fixture.json.gz.meta.json{suffix}"));
    let bytes = b"opaque backup archive fixture".to_vec();
    put(&archive, &bytes);
    put(&metadata, &serde_json::to_vec(&serde_json::json!({
        "checksumScope": "archive-sha256-v1", "checksum": format!("{:x}", Sha256::digest(&bytes)),
        "encrypted": false, "sizeBytes": bytes.len(), "name": "fixture only",
        "id": "fixture", "createdAt": 0, "backupType": "full", "version": "1",
        "compressed": false, "connectionsCount": 0, "parentBackupId": null
    })).unwrap());
    (archive, metadata, bytes)
}

#[tokio::test]
async fn all_nine_managed_families_roundtrip_and_keep_database_inner_value_and_sdbf() {
    let (_dir, roots, state) = fixture().await;
    // The outer migration must not interpret or alter this separately protected
    // database value. Its inner cryptography belongs to the database manager.
    let inner = br#""opaque-password-envelope.salt.iv.ciphertext""#;
    let originals = vec![
        (
            roots.legacy_storage.clone(),
            br#"{"connections":[]}"#.to_vec(),
        ),
        (
            roots.app_data.join("settings.json"),
            br#"{"theme":"fixture"}"#.to_vec(),
        ),
        (
            roots.app_data.join("databases/index.json"),
            sdbf_bytes(br#"{"databases":[]}"#),
        ),
        (
            roots.app_data.join("databases/fixture.json"),
            sdbf_bytes(inner),
        ),
        (
            roots.app_data.join("databases/fixture.trust.json"),
            sdbf_bytes(br#"{"records":[]}"#),
        ),
        (
            roots.recordings.join("config.json"),
            br#"{"encrypt_at_rest":true}"#.to_vec(),
        ),
        (
            roots.recordings.join("recordings/capture.json"),
            br#"{"id":"capture"}"#.to_vec(),
        ),
        (
            roots.recordings.join("inflight/capture.snapshot"),
            br#"{"entries":[]}"#.to_vec(),
        ),
        (
            roots.recordings.join("recordings/capture.media"),
            b"binary-media-fixture".to_vec(),
        ),
        (
            roots.recordings.join("macros/macro.json"),
            br#"{"steps":[]}"#.to_vec(),
        ),
        (
            roots.logs.join("runtime.log"),
            b"fixture log line\n".to_vec(),
        ),
    ];
    for (path, bytes) in &originals {
        put(path, bytes);
    }
    let (archive, metadata, backup_bytes) = backup(&roots, "");
    let audit = roots.logs.join("encryption-audit.log");
    put(&audit, b"intentionally plaintext audit");
    for kind in DATA_ARTIFACTS {
        convert(&roots, &state, *kind, ProtectionMode::Encrypted).await;
    }
    let encrypted = scan(&roots, &state).await.unwrap();
    assert_eq!(encrypted.rows.len(), DATA_ARTIFACTS.len() + 2);
    for kind in DATA_ARTIFACTS {
        let row = status(&encrypted, *kind);
        assert_eq!(
            row.disk_state,
            DiskState::Encrypted,
            "{:?}: {:?}",
            kind,
            row.reason
        );
        assert!(row.encrypted_files > 0);
        assert_eq!(row.plaintext_files, 0);
        assert_eq!(row.unverified_files, 0);
    }
    let stored = fs::read(roots.app_data.join("databases/fixture.json")).unwrap();
    let outer = sdbf::parse_and_verify(&stored).unwrap();
    assert!(outer.starts_with(envelope::MAGIC));
    assert_eq!(
        decode_bytes(&state, ArtifactKind::Connections, outer)
            .await
            .unwrap(),
        inner
    );
    assert_eq!(fs::read(&audit).unwrap(), b"intentionally plaintext audit");
    for kind in DATA_ARTIFACTS {
        convert(&roots, &state, *kind, ProtectionMode::Plaintext).await;
    }
    let plaintext = scan(&roots, &state).await.unwrap();
    for kind in DATA_ARTIFACTS {
        assert_eq!(
            status(&plaintext, *kind).disk_state,
            DiskState::Plaintext,
            "{:?}",
            kind
        );
    }
    for (path, bytes) in originals {
        assert_eq!(fs::read(&path).unwrap(), bytes, "{}", path.display());
    }
    assert_eq!(fs::read(archive).unwrap(), backup_bytes);
    let backup_meta: serde_json::Value =
        serde_json::from_slice(&fs::read(metadata).unwrap()).unwrap();
    assert_eq!(backup_meta["encrypted"], false);
    assert_eq!(backup_meta["name"], "fixture only");
}

#[tokio::test]
async fn backup_integrity_sidecar_tracks_changed_archive_bytes_including_v0_generation() {
    let (_dir, roots, state) = fixture().await;
    let (archive, metadata, original) = backup(&roots, ".v0.bak");
    convert(
        &roots,
        &state,
        ArtifactKind::Backups,
        ProtectionMode::Encrypted,
    )
    .await;
    let bytes = fs::read(&archive).unwrap();
    assert!(bytes.starts_with(envelope::MAGIC));
    let sidecar = decode_bytes(&state, ArtifactKind::Backups, &fs::read(&metadata).unwrap())
        .await
        .unwrap();
    let value: serde_json::Value = serde_json::from_slice(&sidecar).unwrap();
    assert_eq!(value["checksum"], format!("{:x}", Sha256::digest(&bytes)));
    assert_eq!(value["sizeBytes"], bytes.len() as u64);
    assert_eq!(value["encrypted"], true);
    convert(
        &roots,
        &state,
        ArtifactKind::Backups,
        ProtectionMode::Plaintext,
    )
    .await;
    assert_eq!(fs::read(&archive).unwrap(), original);
    assert_eq!(
        recovery_base("backup_full_fixture.json.gz.v0.bak"),
        ("backup_full_fixture.json.gz", ".v0.bak")
    );
}

#[tokio::test]
async fn settings_and_macro_recovery_generations_keep_exact_family_and_suffix() {
    let (_dir, roots, state) = fixture().await;
    put(
        &roots.app_data.join("settings.json.v0.bak"),
        br#"{"version":"legacy"}"#,
    );
    put(
        &roots.recordings.join("macros/macro.json.v0.bak"),
        br#"{"steps":[]}"#,
    );
    convert(
        &roots,
        &state,
        ArtifactKind::Settings,
        ProtectionMode::Encrypted,
    )
    .await;
    convert(
        &roots,
        &state,
        ArtifactKind::Macros,
        ProtectionMode::Encrypted,
    )
    .await;
    assert!(roots.app_data.join("settings.enc.v0.bak").exists());
    assert!(!roots.app_data.join("settings.json.v0.bak").exists());
    assert!(roots
        .recordings
        .join("macros/macro.json.enc.v0.bak")
        .exists());
    let inventory = scan(&roots, &state).await.unwrap();
    assert_eq!(status(&inventory, ArtifactKind::Macros).encrypted_files, 1);
    assert_eq!(
        status(&inventory, ArtifactKind::Settings).encrypted_files,
        1
    );
}

#[tokio::test]
async fn equivalent_peers_coalesce_but_conflicting_peers_are_unverified() {
    for equal in [true, false] {
        let (_dir, roots, state) = fixture().await;
        put(&roots.app_data.join("settings.json"), br#"{"value":1}"#);
        let payload = if equal {
            br#"{"value":1}"#.as_slice()
        } else {
            br#"{"value":2}"#.as_slice()
        };
        let encrypted = encoded_bytes(&state, ArtifactKind::Settings, payload, true)
            .await
            .unwrap();
        put(&roots.app_data.join("settings.enc"), &encrypted);
        let inventory = scan(&roots, &state).await.unwrap();
        if equal {
            assert_eq!(
                status(&inventory, ArtifactKind::Settings).disk_state,
                DiskState::Mixed
            );
            convert(
                &roots,
                &state,
                ArtifactKind::Settings,
                ProtectionMode::Encrypted,
            )
            .await;
            assert!(!roots.app_data.join("settings.json").exists());
        } else {
            let row = status(&inventory, ArtifactKind::Settings);
            assert_eq!(row.disk_state, DiskState::Unverified);
            assert!(!row.mutable);
            assert!(row.reason.as_deref().unwrap().contains("Conflicting"));
            assert_eq!(
                fs::read(roots.app_data.join("settings.enc")).unwrap(),
                encrypted
            );
        }
    }
}

#[tokio::test]
async fn unreadable_shared_database_root_blocks_payload_index_and_trust() {
    let (_dir, roots, state) = fixture().await;
    // A file where the directory must be is deterministic on Windows and Unix,
    // unlike chmod fixtures running with administrator/root privileges.
    put(&roots.app_data.join("databases"), b"not a directory");
    let inventory = scan(&roots, &state).await.unwrap();
    for kind in [
        ArtifactKind::Connections,
        ArtifactKind::DatabasesIndex,
        ArtifactKind::TrustStore,
    ] {
        let row = status(&inventory, kind);
        assert!(!row.mutable);
        assert!(row.unverified_files > 0);
    }
}

#[tokio::test]
async fn excluded_backup_roots_and_legacy_trust_are_visible_not_silently_claimed_protected() {
    let (_dir, mut roots, state) = fixture().await;
    roots
        .backup_restrictions
        .push("Offline destination is not inspected".into());
    put(
        &roots.app_data.join("trust_store.json.v0.bak"),
        br#"{"legacy":true}"#,
    );
    let inventory = scan(&roots, &state).await.unwrap();
    for kind in [ArtifactKind::Backups, ArtifactKind::TrustStore] {
        let row = status(&inventory, kind);
        assert!(!row.mutable);
        assert_eq!(row.disk_state, DiskState::Unverified);
    }
    assert!(status(&inventory, ArtifactKind::TrustStore)
        .reason
        .as_deref()
        .unwrap()
        .contains("Trust Center"));
    assert!(roots.app_data.join("trust_store.json.v0.bak").exists());
}

#[tokio::test]
async fn unknown_recording_files_and_malformed_media_are_not_mutable_or_deleted() {
    let (_dir, roots, state) = fixture().await;
    let unknown = roots.recordings.join("recordings/unknown.private");
    put(&unknown, b"unmanaged");
    let broken = roots.recordings.join("recordings/capture.media.enc");
    put(&broken, envelope::MAGIC);
    let inventory = scan(&roots, &state).await.unwrap();
    assert!(!status(&inventory, ArtifactKind::RecordingsMeta).mutable);
    assert!(!status(&inventory, ArtifactKind::RecordingsMedia).mutable);
    assert_eq!(fs::read(unknown).unwrap(), b"unmanaged");
    assert_eq!(fs::read(broken).unwrap(), envelope::MAGIC);
}

#[tokio::test]
async fn locked_encrypted_content_is_unverified_and_pending_transition_blocks_changes() {
    let (_dir, roots, state) = fixture().await;
    put(&roots.app_data.join("settings.json"), br#"{"value":1}"#);
    convert(
        &roots,
        &state,
        ArtifactKind::Settings,
        ProtectionMode::Encrypted,
    )
    .await;
    state.set_artifact_recovery_required(true);
    assert!(!status(&scan(&roots, &state).await.unwrap(), ArtifactKind::Settings).mutable);
    state.set_artifact_recovery_required(false);
    state.lock().await;
    let inventory = scan(&roots, &state).await.unwrap();
    assert_eq!(
        status(&inventory, ArtifactKind::Settings).disk_state,
        DiskState::Unverified
    );
    assert!(!status(&inventory, ArtifactKind::Settings).mutable);
    assert!(roots.app_data.join("settings.enc").exists());
}

#[tokio::test]
async fn staging_cancellation_and_source_drift_leave_originals_unchanged() {
    for cancel in [true, false] {
        let (_dir, roots, state) = fixture().await;
        let source = roots.app_data.join("settings.json");
        put(&source, br#"{"value":1}"#);
        let inventory = scan(&roots, &state).await.unwrap();
        let mut tx = ArtifactTransaction::begin(&roots.app_data, &inventory.roots, &state)
            .await
            .unwrap();
        if !cancel {
            put(&source, br#"{"value":2}"#);
        }
        let expected = fs::read(&source).unwrap();
        let callback = |_: usize, _: usize| {
            if cancel {
                Err("fixture cancellation".into())
            } else {
                Ok(())
            }
        };
        assert!(prepare_artifact(
            &inventory,
            ArtifactKind::Settings,
            ProtectionMode::Encrypted,
            &state,
            &mut tx,
            &callback
        )
        .await
        .is_err());
        tx.recover().unwrap();
        assert_eq!(fs::read(&source).unwrap(), expected);
        assert!(!roots.app_data.join("settings.enc").exists());
        assert!(!artifact_transaction::has_pending(&roots.app_data).unwrap());
    }
}

#[tokio::test]
async fn tampered_backup_checksum_cannot_commit_or_delete_archive() {
    let (_dir, roots, state) = fixture().await;
    let (archive, metadata, original) = backup(&roots, "");
    let mut value: serde_json::Value =
        serde_json::from_slice(&fs::read(&metadata).unwrap()).unwrap();
    value["checksum"] = "incorrect".into();
    put(&metadata, &serde_json::to_vec(&value).unwrap());
    let inventory = scan(&roots, &state).await.unwrap();
    let mut tx = ArtifactTransaction::begin(&roots.app_data, &inventory.roots, &state)
        .await
        .unwrap();
    assert!(prepare_artifact(
        &inventory,
        ArtifactKind::Backups,
        ProtectionMode::Encrypted,
        &state,
        &mut tx,
        &|_, _| Ok(())
    )
    .await
    .is_err());
    tx.recover().unwrap();
    assert_eq!(fs::read(archive).unwrap(), original);
}

#[tokio::test]
async fn cancelling_after_plaintext_stage_removes_registered_stage_and_retains_ciphertext() {
    let (_dir, roots, state) = fixture().await;
    let original = encoded_bytes(
        &state,
        ArtifactKind::Settings,
        br#"{"fixture":"secret"}"#,
        true,
    )
    .await
    .unwrap();
    let source = roots.app_data.join("settings.enc");
    put(&source, &original);
    let inventory = scan(&roots, &state).await.unwrap();
    let mut tx = ArtifactTransaction::begin(&roots.app_data, &inventory.roots, &state)
        .await
        .unwrap();
    let callback = |completed, total| {
        if completed == total {
            Err("cancel after staging".into())
        } else {
            Ok(())
        }
    };
    assert!(prepare_artifact(
        &inventory,
        ArtifactKind::Settings,
        ProtectionMode::Plaintext,
        &state,
        &mut tx,
        &callback
    )
    .await
    .is_err());
    assert!(!roots.app_data.join("settings.json").exists());
    assert!(fs::read_dir(&roots.app_data).unwrap().any(|entry| entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .ends_with(".stage")));
    tx.recover().unwrap();
    assert_eq!(fs::read(source).unwrap(), original);
    assert!(!fs::read_dir(&roots.app_data).unwrap().any(|entry| entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(".sorng-artifact-")));
}

#[tokio::test]
async fn concatenated_authenticated_logs_roundtrip_while_plaintext_audit_is_excluded() {
    let (_dir, roots, state) = fixture().await;
    let mut bytes = encoded_bytes(&state, ArtifactKind::Logs, b"one\n", true)
        .await
        .unwrap();
    bytes.extend(
        encoded_bytes(&state, ArtifactKind::Logs, b"two\n", true)
            .await
            .unwrap(),
    );
    put(&roots.logs.join("runtime.log.enc"), &bytes);
    put(&roots.logs.join("encryption-audit.log"), b"audit-only");
    convert(
        &roots,
        &state,
        ArtifactKind::Logs,
        ProtectionMode::Plaintext,
    )
    .await;
    assert_eq!(
        fs::read(roots.logs.join("runtime.log")).unwrap(),
        b"one\ntwo\n"
    );
    assert_eq!(
        fs::read(roots.logs.join("encryption-audit.log")).unwrap(),
        b"audit-only"
    );
}

#[tokio::test]
async fn policy_only_empty_family_and_protected_infrastructure_are_distinct() {
    let (_dir, roots, state) = fixture().await;
    let inventory = scan(&roots, &state).await.unwrap();
    assert_eq!(
        status(&inventory, ArtifactKind::Settings).disk_state,
        DiskState::Absent
    );
    for kind in [ArtifactKind::KeyRing, ArtifactKind::ArtifactPolicy] {
        assert!(!status(&inventory, kind).mutable);
    }
    let mut tx = ArtifactTransaction::begin(&roots.app_data, &inventory.roots, &state)
        .await
        .unwrap();
    assert_eq!(
        prepare_artifact(
            &inventory,
            ArtifactKind::Settings,
            ProtectionMode::Encrypted,
            &state,
            &mut tx,
            &|_, _| Ok(())
        )
        .await
        .unwrap(),
        0
    );
    assert!(prepare_artifact(
        &inventory,
        ArtifactKind::KeyRing,
        ProtectionMode::Plaintext,
        &state,
        &mut tx,
        &|_, _| Ok(())
    )
    .await
    .is_err());
    tx.recover().unwrap();
}
