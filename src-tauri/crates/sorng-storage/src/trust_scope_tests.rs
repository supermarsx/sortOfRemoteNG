use super::*;
use serde_json::json;

fn identity(fp: &str) -> Identity {
    serde_json::from_value(
        json!({"kind":"tls","fingerprint":fp,"first_seen":"2026-01-01","last_seen":"2026-01-01"}),
    )
    .unwrap()
}
fn add(data: &mut TrustStoreData, host: &str, fp: &str) {
    trust_identity_in_data(
        data,
        host.into(),
        "https".into(),
        identity(fp),
        true,
        IdentityChangeReason::Initial,
        None,
        None,
    );
}
fn target(host: &str, fp: &str) -> ReviewedTrustScopeTarget {
    ReviewedTrustScopeTarget {
        host: host.into(),
        record_type: "https".into(),
        fingerprint: fp.into(),
        expected_decision: TrustScopeDecision {
            user_approved: true,
            revoked: false,
            trust_expires: None,
            host_policy: None,
            host_policy_config: None,
        },
    }
}
fn stored(path: &Path, value: &serde_json::Value) {
    sdbf::safe_write(path, &serde_json::to_vec(value).unwrap()).unwrap();
}

#[test]
fn effective_scope_never_bypasses_specific_mismatch_revocation_or_forget() {
    let mut data = TrustStoreData::default();
    add(&mut data, "server:443", "global");
    let scoped = "@sorng/connection/v1/one/server/443";
    assert!(matches!(
        verify_identity_in_data(&mut data, scoped, "https", identity("global")),
        TrustVerifyResult::Trusted
    ));
    add(&mut data, scoped, "specific");
    assert!(matches!(
        verify_identity_in_data(&mut data, scoped, "https", identity("global")),
        TrustVerifyResult::Mismatch { .. }
    ));
    data.records
        .get_mut(&format!("https:{scoped}"))
        .unwrap()
        .revoked = true;
    assert!(matches!(
        verify_identity_in_data(&mut data, scoped, "https", identity("specific")),
        TrustVerifyResult::Revoked { .. }
    ));
    mark_forgotten_keys(&mut data, [format!("https:{scoped}")]).unwrap();
    data.records.remove(&format!("https:{scoped}"));
    assert!(matches!(
        verify_identity_in_data(&mut data, scoped, "https", identity("global")),
        TrustVerifyResult::FirstUse {
            requires_approval: true,
            ..
        }
    ));
    assert!(!data
        .records
        .contains_key(&effective_key(&data, scoped, "https").unwrap()));
    assert!(matches!(
        verify_identity_in_data(
            &mut data,
            "@sorng/connection/v1/two/server/443",
            "https",
            identity("global")
        ),
        TrustVerifyResult::Trusted
    ));
}

#[test]
fn equivalent_endpoints_inherit_but_alias_conflicts_fail_closed() {
    for (stored, requested) in [
        ("SERVER.:443", "@sorng/connection/v1/one/server/443"),
        (
            "[2001:0DB8:0:0:0:0:0:1]:443",
            "@sorng/connection/v1/one/2001%3Adb8%3A%3A1/443",
        ),
    ] {
        let mut data = TrustStoreData::default();
        add(&mut data, stored, "same");
        assert!(matches!(
            verify_identity_in_data(&mut data, requested, "https", identity("same")),
            TrustVerifyResult::Trusted
        ));
        assert_eq!(
            effective_key(&data, requested, "https").unwrap(),
            format!("https:{stored}")
        );
    }
    let mut data = TrustStoreData::default();
    add(&mut data, "Server:443", "a");
    add(&mut data, "server:443", "b");
    assert!(effective_key(&data, "@sorng/connection/v1/one/server/443", "https").is_err());
    assert!(matches!(
        verify_identity_in_data(&mut data, "server:443", "https", identity("b")),
        TrustVerifyResult::PendingVerification { .. }
    ));
}

#[tokio::test]
async fn database_wide_forget_blocks_scoped_automatic_writers_and_explicit_alias_approval_clears_only_its_scope(
) {
    let _fixture = crate::STORAGE_FIXTURE.lock().await;
    let temp = tempfile::tempdir().unwrap();
    let guard = test_support::install_active_runtime_for_tests(temp.path().join("databases"), "db");
    let service = TrustStoreService::shared();
    let mut svc = service.lock().await;
    svc.reload_from_disk().unwrap();
    svc.trust_identity("SERVER.:443".into(), "https".into(), identity("same"), true)
        .await
        .unwrap();
    svc.remove_identity("SERVER.:443", "https").await.unwrap();
    let scoped = "@sorng/connection/v1/one/server/443";
    assert!(matches!(
        svc.verify_identity(scoped, "https", identity("same"))
            .await
            .unwrap(),
        TrustVerifyResult::FirstUse {
            requires_approval: true,
            ..
        }
    ));
    assert!(svc
        .trust_identity(scoped.into(), "https".into(), identity("same"), false)
        .await
        .is_err());
    assert!(SyncTrustStore::shared()
        .trust_identity_blocking(scoped.into(), "https".into(), identity("same"), false)
        .is_err());
    svc.trust_identity(scoped.into(), "https".into(), identity("same"), true)
        .await
        .unwrap();
    assert!(matches!(
        svc.verify_identity(scoped, "https", identity("same"))
            .await
            .unwrap(),
        TrustVerifyResult::Trusted
    ));
    assert!(fresh_approval_keys(&svc.data).contains("https:SERVER.:443"));
    assert!(matches!(
        svc.verify_identity(
            "@sorng/connection/v1/two/server/443",
            "https",
            identity("same")
        )
        .await
        .unwrap(),
        TrustVerifyResult::FirstUse {
            requires_approval: true,
            ..
        }
    ));
    svc.trust_identity("server:443".into(), "https".into(), identity("same"), true)
        .await
        .unwrap();
    assert!(!fresh_approval_keys(&svc.data).contains("https:SERVER.:443"));
    assert!(matches!(
        svc.verify_identity("SERVER:443", "https", identity("same"))
            .await
            .unwrap(),
        TrustVerifyResult::Trusted
    ));
    assert_eq!(guard.runtime.active_database_id().as_deref(), Some("db"));
}

#[tokio::test]
async fn reviewed_scope_move_preserves_decisions_suppresses_replay_and_never_switches_database() {
    let _fixture = crate::STORAGE_FIXTURE.lock().await;
    let temp = tempfile::tempdir().unwrap();
    let guard = test_support::install_active_runtime_for_tests(temp.path().join("databases"), "db");
    let rt = &guard.runtime;
    let source = json!({"connections":[{"id":"one"},{"id":"two"}]});
    stored(
        &rt.databases_dir.join("index.json"),
        &json!([{"id":"db","isEncrypted":false,"securityRevision":"r0"}]),
    );
    stored(&rt.databases_dir.join("db.json"), &source);
    let path = rt.trust_file_path("db").unwrap();
    let from = "@sorng/connection/v1/one/server/443";
    let mut data = TrustStoreData::default();
    add(&mut data, from, "pinned");
    let record = data.records.get_mut(&format!("https:{from}")).unwrap();
    record.revoked = true;
    record.tags = vec!["retained".into()];
    record.nickname = Some("friendly".into());
    record.description = Some("Scope changes preserve this operator note.".into());
    record.host_policy = Some(TrustPolicy::Strict);
    record.trust_expires = Some("2030-01-01T00:00:00Z".into());
    record
        .history
        .push(migrated_history_entry(&record.clone(), "retained history"));
    let before_record = record.clone();
    rt.write_file(&path, &data).unwrap();
    let coordinator = sorng_encryption::settings_coordinator::lock().await;
    let moved = rt
        .reassign_scope_with_coordinator_guard(
            temp.path(),
            "db",
            "r0",
            &source,
            &["one".into(), "two".into()],
            vec![ReviewedTrustScopeTarget {
                expected_decision: TrustScopeDecision::from(&before_record),
                ..target(from, "pinned")
            }],
            None,
            &coordinator,
            || Ok(()),
        )
        .unwrap();
    assert_eq!(moved.updated, 1);
    assert_eq!(rt.active_database_id().as_deref(), Some("db"));
    let after = rt.read_file(&path).unwrap();
    let mut expected = before_record;
    expected.host = "server:443".into();
    assert_eq!(
        serde_json::to_value(&after.records["https:server:443"]).unwrap(),
        serde_json::to_value(expected).unwrap()
    );
    assert!(after
        .legacy_suppressed_keys
        .contains(&format!("https:{from}")));
    assert!(!fresh_approval_keys(&after).contains(&format!("https:{from}")));
    drop(coordinator);
    let service = TrustStoreService::shared();
    let mut service = service.lock().await;
    service.reload_from_disk().unwrap();
    service
        .migrate_legacy_identity(
            from.into(),
            "https".into(),
            identity("stale"),
            true,
            vec![],
            None,
            None,
            None,
        )
        .await
        .unwrap();
    assert!(service.get_stored_identity(from, "https").await.is_none());
    assert!(
        service
            .get_effective_stored_identity(from, "https")
            .unwrap()
            .unwrap()
            .revoked
    );
}

#[tokio::test]
async fn scope_collision_stale_batch_unknown_connection_and_expired_access_write_nothing() {
    let _fixture = crate::STORAGE_FIXTURE.lock().await;
    let temp = tempfile::tempdir().unwrap();
    let guard = test_support::install_active_runtime_for_tests(temp.path().join("databases"), "db");
    let rt = &guard.runtime;
    let source = json!({"connections":[{"id":"one"}]});
    stored(
        &rt.databases_dir.join("index.json"),
        &json!([{"id":"db","isEncrypted":false,"securityRevision":"r0"}]),
    );
    stored(&rt.databases_dir.join("db.json"), &source);
    let path = rt.trust_file_path("db").unwrap();
    let mut data = TrustStoreData::default();
    add(&mut data, "server:443", "global");
    add(&mut data, "other:443", "other");
    add(&mut data, "@sorng/connection/v1/one/server/443", "specific");
    rt.write_file(&path, &data).unwrap();
    let bytes = std::fs::read(&path).unwrap();
    let coordinator = sorng_encryption::settings_coordinator::lock().await;
    for (targets, destination, revision, expected) in [
        (
            vec![target("server:443", "global")],
            Some("one"),
            "r0",
            source.clone(),
        ),
        (
            vec![target("other:443", "other"), target("server:443", "stale")],
            Some("one"),
            "r0",
            source.clone(),
        ),
        (
            vec![target("other:443", "other")],
            Some("unknown"),
            "r0",
            source.clone(),
        ),
        (
            vec![target("other:443", "other")],
            Some("one"),
            "stale",
            source.clone(),
        ),
        (
            vec![target("other:443", "other")],
            Some("one"),
            "r0",
            json!({"connections":[]}),
        ),
    ] {
        assert!(rt
            .reassign_scope_with_coordinator_guard(
                temp.path(),
                "db",
                revision,
                &expected,
                &["one".into()],
                targets,
                destination,
                &coordinator,
                || Ok(())
            )
            .is_err());
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
    }
    assert!(rt
        .reassign_scope_with_coordinator_guard(
            temp.path(),
            "db",
            "r0",
            &source,
            &["one".into()],
            vec![target("other:443", "other")],
            Some("one"),
            &coordinator,
            || Err("session expired".into())
        )
        .is_err());
    assert_eq!(std::fs::read(&path).unwrap(), bytes);
}

#[test]
fn scope_key_encoding_keeps_ipv6_plus_unicode_and_rejects_unknown_grammar() {
    let point = Endpoint {
        host: "2001:db8::1".into(),
        port: 443,
    };
    let encoded = host_for(&point, Some("one+ &é"));
    assert_eq!(
        encoded,
        "@sorng/connection/v1/one%2B%20%26%C3%A9/2001%3Adb8%3A%3A1/443"
    );
    assert_eq!(
        host_for(&endpoint(&encoded).unwrap(), None),
        "[2001:db8::1]:443"
    );
    for invalid in [
        "@sorng/connection/v1/one/host:443",
        "@sorng/connection/v1/%ZZ/host/443",
        "@sorng/connection/v1/one/%00/443",
        "host:0",
        "host:65536",
    ] {
        assert!(endpoint(invalid).is_err(), "{invalid}");
    }
}

#[tokio::test]
async fn same_fingerprint_decision_drift_rejects_entire_scope_batch_but_statistics_do_not() {
    let _fixture = crate::STORAGE_FIXTURE.lock().await;
    let temp = tempfile::tempdir().unwrap();
    let guard = test_support::install_active_runtime_for_tests(temp.path().join("databases"), "db");
    let rt = &guard.runtime;
    let source = json!({"connections":[{"id":"one"}]});
    stored(
        &rt.databases_dir.join("index.json"),
        &json!([{"id":"db","isEncrypted":false,"securityRevision":"r0"}]),
    );
    stored(&rt.databases_dir.join("db.json"), &source);
    let path = rt.trust_file_path("db").unwrap();
    let mut baseline = TrustStoreData::default();
    add(&mut baseline, "first:443", "first");
    add(&mut baseline, "second:443", "second");
    let targets = vec![target("first:443", "first"), target("second:443", "second")];
    let coordinator = sorng_encryption::settings_coordinator::lock().await;
    for mutation in 0..5 {
        let mut changed = baseline.clone();
        let record = changed.records.get_mut("https:second:443").unwrap();
        match mutation {
            0 => record.user_approved = false,
            1 => record.revoked = true,
            2 => record.trust_expires = Some("2030-01-01T00:00:00Z".into()),
            3 => record.host_policy = Some(TrustPolicy::Strict),
            _ => {
                record.host_policy_config = Some(TrustPolicyConfig {
                    threshold_count: Some(5),
                    ..Default::default()
                })
            }
        }
        rt.write_file(&path, &changed).unwrap();
        let before = std::fs::read(&path).unwrap();
        let error = rt
            .reassign_scope_with_coordinator_guard(
                temp.path(),
                "db",
                "r0",
                &source,
                &["one".into()],
                targets.clone(),
                Some("one"),
                &coordinator,
                || Ok(()),
            )
            .unwrap_err();
        assert!(error.contains("policy changed"), "{error}");
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }
    let record = baseline.records.get_mut("https:second:443").unwrap();
    record.stats.total_checks += 1;
    record.nickname = Some("New label".into());
    record.tags = vec!["new tag".into()];
    record
        .history
        .push(migrated_history_entry(&record.clone(), "stats only"));
    rt.write_file(&path, &baseline).unwrap();
    assert_eq!(
        rt.reassign_scope_with_coordinator_guard(
            temp.path(),
            "db",
            "r0",
            &source,
            &["one".into()],
            targets,
            Some("one"),
            &coordinator,
            || Ok(())
        )
        .unwrap()
        .updated,
        2
    );
}
