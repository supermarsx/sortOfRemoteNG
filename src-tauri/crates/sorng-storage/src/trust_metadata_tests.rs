use super::super::*;
use super::*;
use serde_json::json;

fn record(kind: &str) -> TrustRecord {
    serde_json::from_value(json!({
        "host":if kind == "ssh" { "host.test:22" } else { "host.test:443" },
        "record_type":kind,"identity":{"kind":if kind == "ssh" { "ssh" } else { "tls" },"fingerprint":"fixture-fingerprint","first_seen":"2026-01-01","last_seen":"2026-01-01"},
        "user_approved":true,"nickname":"Preserved label","history":[],"tags":["old"],"revoked":true,"host_policy":"strict"
    })).unwrap()
}
fn target(record: &TrustRecord) -> ReviewedTrustTarget {
    ReviewedTrustTarget {
        host: record.host.clone(),
        record_type: record.record_type.clone(),
        fingerprint: TrustStoreService::identity_fingerprint(&record.identity).into(),
    }
}
fn edit(record: &TrustRecord) -> ReviewedTrustMetadata {
    ReviewedTrustMetadata {
        expected_tags: record.tags.clone(),
        expected_description: record.description.clone(),
        expected_decision: TrustScopeDecision::from(record),
        tags: vec!["office".into(), "reviewed".into()],
        description: Some("Private operator note\nTLS or SSH identity; not a trust grant.".into()),
    }
}
fn save_record(runtime: &TrustRuntime, record: TrustRecord) {
    let data = TrustStoreData {
        records: HashMap::from([(
            TrustStoreService::record_key(&record.record_type, &record.host),
            record,
        )]),
        ..Default::default()
    };
    runtime
        .write_file(&runtime.trust_file_path("db").unwrap(), &data)
        .unwrap();
}
fn apply(
    runtime: &TrustRuntime,
    record: &TrustRecord,
    metadata: ReviewedTrustMetadata,
) -> Result<ReviewedTrustOutcome, String> {
    runtime.apply_reviewed_batch_with_metadata(
        "db",
        ReviewedTrustAction::Metadata,
        vec![target(record)],
        None,
        None,
        Some(metadata),
    )
}

#[test]
fn description_is_backward_compatible_bounded_plain_text() {
    let old = record("https");
    assert!(old.description.is_none());
    for value in [
        None,
        Some(""),
        Some("Plain text with <markup> & Unicode é\nsecond line"),
    ] {
        assert!(validate_description(value).is_ok());
    }
    assert!(validate_description(Some(&"é".repeat(2048))).is_ok());
    assert!(validate_description(Some(&"é".repeat(2049))).is_err());
    assert!(validate_description(Some("before\0after")).is_err());
    let mut metadata = edit(&old);
    metadata.tags = vec!["x".repeat(256); 100];
    metadata.validate().unwrap();
    metadata.tags.push("too many".into());
    assert!(metadata.validate().is_err());
}

#[tokio::test]
async fn metadata_edit_is_one_atomic_write_for_tls_and_ssh_without_changing_trust() {
    let _fixture = crate::STORAGE_FIXTURE.lock().await;
    let root = tempfile::tempdir().unwrap();
    let guard = test_support::install_active_runtime_for_tests(root.path().join("databases"), "db");
    let runtime = &guard.runtime;
    let path = runtime.trust_file_path("db").unwrap();
    for kind in ["https", "ssh"] {
        let before = record(kind);
        save_record(runtime, before.clone());
        let disk_before = std::fs::read(&path).unwrap();
        let metadata = edit(&before);
        assert_eq!(
            apply(runtime, &before, metadata.clone()).unwrap().updated,
            1
        );
        let after = runtime.export(Some("db")).unwrap().records.remove(0);
        let mut expected = before.clone();
        expected.tags = metadata.tags;
        expected.description = metadata.description;
        assert_eq!(
            serde_json::to_value(&after).unwrap(),
            serde_json::to_value(&expected).unwrap()
        );
        assert_eq!(
            std::fs::read(sdbf::sibling(&path, "bak")).unwrap(),
            disk_before,
            "one metadata transaction preserves the original as its sole previous generation"
        );
        let mut clear = edit(&after);
        clear.tags.clear();
        clear.description = None;
        apply(runtime, &after, clear).unwrap();
        let cleared = runtime.export(Some("db")).unwrap().records.remove(0);
        assert!(cleared.description.is_none() && cleared.tags.is_empty());
        assert!(cleared.revoked && cleared.user_approved);
        assert_eq!(cleared.host_policy, Some(TrustPolicy::Strict));
    }
}

#[tokio::test]
async fn metadata_cas_rejects_changed_tags_description_decision_fingerprint_or_database() {
    let _fixture = crate::STORAGE_FIXTURE.lock().await;
    let root = tempfile::tempdir().unwrap();
    let guard = test_support::install_active_runtime_for_tests(root.path().join("databases"), "db");
    let runtime = &guard.runtime;
    let path = runtime.trust_file_path("db").unwrap();
    for mutation in [
        "tags",
        "description",
        "revoked",
        "policy",
        "fingerprint",
        "database",
    ] {
        runtime.set_active(Some("db".into()), None).unwrap();
        let before = record("https");
        let metadata = edit(&before);
        let mut changed = before.clone();
        match mutation {
            "tags" => changed.tags.push("concurrent".into()),
            "description" => changed.description = Some("Concurrent note".into()),
            "revoked" => changed.revoked = false,
            "policy" => changed.host_policy = Some(TrustPolicy::AlwaysAsk),
            "fingerprint" => {
                if let Identity::Tls(identity) = &mut changed.identity {
                    identity.fingerprint = "replacement".into()
                }
            }
            "database" => {}
            _ => unreachable!(),
        }
        save_record(runtime, changed);
        if mutation == "database" {
            runtime.set_active(Some("other".into()), None).unwrap();
        }
        let disk = std::fs::read(&path).unwrap();
        assert!(apply(runtime, &before, metadata).is_err(), "{mutation}");
        assert_eq!(std::fs::read(&path).unwrap(), disk);
    }
}

#[tokio::test]
async fn metadata_invalid_shape_limits_and_unexpected_payloads_write_nothing() {
    let _fixture = crate::STORAGE_FIXTURE.lock().await;
    let root = tempfile::tempdir().unwrap();
    let guard = test_support::install_active_runtime_for_tests(root.path().join("databases"), "db");
    let runtime = &guard.runtime;
    let before = record("https");
    save_record(runtime, before.clone());
    let path = runtime.trust_file_path("db").unwrap();
    let disk = std::fs::read(&path).unwrap();
    for invalid in [
        "long-description",
        "nul-description",
        "long-tag",
        "tag-count",
        "bad-expected",
    ] {
        let mut metadata = edit(&before);
        match invalid {
            "long-description" => metadata.description = Some("é".repeat(2049)),
            "nul-description" => metadata.description = Some("PRIVATE\0NOTE".into()),
            "long-tag" => metadata.tags = vec!["x".repeat(257)],
            "tag-count" => metadata.tags = vec!["x".into(); 101],
            "bad-expected" => metadata.expected_description = Some("x".repeat(4097)),
            _ => unreachable!(),
        }
        assert!(apply(runtime, &before, metadata).is_err());
    }
    assert!(runtime
        .apply_reviewed_batch(
            "db",
            ReviewedTrustAction::Metadata,
            vec![target(&before)],
            None,
            None
        )
        .is_err());
    assert!(runtime
        .apply_reviewed_batch_with_metadata(
            "db",
            ReviewedTrustAction::Tags,
            vec![target(&before)],
            None,
            Some(vec![]),
            Some(edit(&before))
        )
        .is_err());
    assert!(runtime
        .apply_reviewed_batch_with_metadata(
            "db",
            ReviewedTrustAction::Metadata,
            vec![target(&before), target(&before)],
            None,
            None,
            Some(edit(&before))
        )
        .is_err());
    assert!(runtime
        .apply_reviewed_batch_with_metadata(
            "db",
            ReviewedTrustAction::Metadata,
            vec![target(&before)],
            Some(TrustPolicy::AlwaysTrust),
            None,
            Some(edit(&before))
        )
        .is_err());
    assert_eq!(std::fs::read(&path).unwrap(), disk);
}

#[tokio::test]
async fn metadata_round_trips_export_import_and_invalid_import_never_overwrites() {
    let _fixture = crate::STORAGE_FIXTURE.lock().await;
    let root = tempfile::tempdir().unwrap();
    let guard = test_support::install_active_runtime_for_tests(root.path().join("databases"), "db");
    let runtime = &guard.runtime;
    let before = record("ssh");
    save_record(runtime, before.clone());
    apply(runtime, &before, edit(&before)).unwrap();
    let export = runtime.export(Some("db")).unwrap();
    let roundtrip: TrustExportDocument =
        serde_json::from_slice(&serde_json::to_vec(&export).unwrap()).unwrap();
    runtime.set_active(Some("imported".into()), None).unwrap();
    runtime
        .import(Some("imported"), roundtrip, TrustImportMode::Merge)
        .unwrap();
    let imported = runtime.export(Some("imported")).unwrap();
    assert_eq!(
        imported.records[0].description,
        export.records[0].description
    );
    assert_eq!(imported.records[0].tags, export.records[0].tags);
    let path = runtime.trust_file_path("imported").unwrap();
    let disk = std::fs::read(&path).unwrap();
    let mut invalid = export;
    invalid.records[0].description = Some("x".repeat(4097));
    assert!(runtime
        .import(Some("imported"), invalid, TrustImportMode::Merge)
        .is_err());
    assert_eq!(std::fs::read(&path).unwrap(), disk);
}

#[tokio::test]
async fn metadata_edit_cannot_write_encrypted_trust_store_after_global_lock() {
    let _fixture = crate::STORAGE_FIXTURE.lock().await;
    let root = tempfile::tempdir().unwrap();
    let state = Arc::new(EncryptionState::new());
    state.install(sorng_encryption::MasterDek::generate()).await;
    sorng_encryption::artifact_policy::initialize(&state, root.path()).await;
    let guard =
        test_support::install_runtime_for_tests(root.path().join("databases"), Some(state.clone()));
    let runtime = &guard.runtime;
    runtime
        .activate_database(Some("db".into()), &[])
        .await
        .unwrap();
    let before = record("https");
    save_record(runtime, before.clone());
    let path = runtime.trust_file_path("db").unwrap();
    let disk = std::fs::read(&path).unwrap();
    assert!(!String::from_utf8_lossy(&disk).contains("Preserved label"));
    state.lock().await;
    assert!(apply(runtime, &before, edit(&before)).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), disk);
}
