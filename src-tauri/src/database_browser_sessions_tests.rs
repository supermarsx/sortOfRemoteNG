use super::*;
use sorng_storage::sdbf;

fn policy() -> RetentionPolicy {
    RetentionPolicy {
        mode: RetentionMode::EncryptedDatabase,
        ..Default::default()
    }
}
fn public_data() -> Value {
    json!({"connections":[{"id":"one","hostname":"https://same.example","protocol":"https",
        "httpProxyPolicy":{"version":1,"externalResourceOrigins":[],"allowExternalFonts":false},
        "browserSession":{"version":1,"sessionRetention":policy()}}],"settings":{"theme":"fixture"}})
}
fn cookie(value: &str) -> SignInCookie {
    SignInCookie {
        origin: "https://same.example".into(),
        name: "session".into(),
        value: value.into(),
        domain: "same.example".into(),
        path: "/".into(),
        secure: true,
        http_only: true,
        creation: 1,
        expires: None,
        same_site: 2,
        priority: 1,
    }
}
fn record(data: &Value, value: &str) -> NativeCookieRecord {
    let mut record = NativeCookieRecord {
        connection_id: "one".into(),
        revision: String::new(),
        salt: codec::random_id(),
        connection_digest: retention_connection_digest(&data["connections"][0]).unwrap(),
        dependencies: vec![],
        portable_connection_digest: portable_digest(&data["connections"][0], false, "db").unwrap(),
        portable_dependencies: vec![],
        source_origin: "https://same.example".into(),
        origins: vec!["https://same.example".into()],
        policy: policy(),
        created: stamp(),
        saved: stamp(),
        last_used: stamp(),
        cookies: vec![cookie(value)],
    };
    record.refresh_revision().unwrap();
    record.validate().unwrap();
    record
}
fn with_record() -> Value {
    let mut data = public_data();
    let saved = record(&data, "SYNTHETIC_NATIVE_COOKIE");
    put_private(
        &mut data,
        PrivateSessions {
            version: 1,
            records: vec![saved],
        },
    )
    .unwrap();
    data
}
fn empty() -> BrowserSessionsDescriptor {
    BrowserSessionsDescriptor {
        version: 1,
        records: vec![],
    }
}

struct Fixture {
    root: tempfile::TempDir,
    state: EncryptionState,
    token: String,
    key: DatabaseKey,
}
async fn fixture(data: &Value) -> Fixture {
    let root = tempfile::tempdir().unwrap();
    let state = EncryptionState::new();
    sorng_encryption::artifact_policy::initialize(&state, root.path()).await;
    std::fs::create_dir(root.path().join("databases")).unwrap();
    let key = DatabaseKey::generate();
    let key_id = codec::random_id();
    let params = sorng_encryption::password_wrap::Argon2Params {
        memory_kib: 8192,
        time_cost: 1,
        parallelism: 1,
    };
    let slot = codec::new_password_slot(
        "db",
        &key_id,
        "Fixture",
        "fixture-password",
        Some(params),
        &key,
    )
    .unwrap();
    let envelope = DatabaseEnvelope::create(
        "db",
        &key_id,
        "r1",
        DataCipher::Aes256Gcm,
        vec![slot],
        data,
        &key,
    )
    .unwrap();
    sdbf::safe_write(
        &root.path().join("databases/db.json"),
        &serde_json::to_vec(&envelope.value().unwrap()).unwrap(),
    )
    .unwrap();
    sdbf::safe_write(&root.path().join("databases/index.json"),&serde_json::to_vec(&json!([{"id":"db","name":"Fixture","isEncrypted":true,"protectionFormat":"sorng-db","securityRevision":"r1"}])).unwrap()).unwrap();
    let profile = profile_binding(root.path()).unwrap();
    let token = database_sessions::global()
        .lock()
        .unwrap()
        .insert(
            &scope(&profile, "db", "r1", "main", &state),
            key.duplicate(),
        )
        .unwrap();
    Fixture {
        root,
        state,
        token,
        key,
    }
}

#[test]
fn projection_never_releases_private_cookie_fields() {
    let data = with_record();
    let projected = project(data).unwrap();
    let serialized = serde_json::to_string(&projected).unwrap();
    assert!(!serialized.contains("SYNTHETIC_NATIVE_COOKIE"));
    assert!(!serialized.contains(PRIVATE));
    assert_eq!(projected[PUBLIC]["records"].as_array().unwrap().len(), 1);
}

#[test]
fn same_url_connections_remain_distinct_and_forged_owner_binding_is_rejected() {
    let mut data = with_record();
    let mut second = data["connections"][0].clone();
    second["id"] = "two".into();
    data["connections"].as_array_mut().unwrap().push(second);
    let mut saved = private(&data).unwrap().records.remove(0);
    saved.connection_id = "two".into();
    saved.refresh_revision().unwrap();
    assert!(!record_matches(&data, &saved).unwrap());
    assert_eq!(private(&data).unwrap().records[0].connection_id, "one");
}

#[test]
fn portable_binding_accepts_only_reviewed_device_runtime_and_database_owner_changes() {
    let mut source = public_data();
    source["connections"][0]["backendSessionId"] = "local-only".into();
    source["connections"][0]["machineAssignment"] =
        json!({"kind":"connection","ownerDatabaseId":"source-db","connectionId":"relay"});
    source["credentialVault"] = json!({"version":1,"revision":1,"entries":[{"id":"vault","facets":{"password":"same-private-password","deviceTrust":{"token":"local-token"}}}]});
    let mut saved = record(&source, "synthetic");
    saved.dependencies = vec![(
        true,
        "vault".into(),
        native_browser_owner::digest(&source["credentialVault"]["entries"][0]).unwrap(),
    )];
    saved.portable_connection_digest =
        portable_digest(&source["connections"][0], false, "source-db").unwrap();
    saved.portable_dependencies = vec![(
        true,
        "vault".into(),
        portable_digest(&source["credentialVault"]["entries"][0], true, "source-db").unwrap(),
    )];
    saved.refresh_revision().unwrap();
    let portable_revision = saved.revision.clone();
    let mut destination = source.clone();
    destination["connections"][0]
        .as_object_mut()
        .unwrap()
        .remove("backendSessionId");
    destination["connections"][0]["machineAssignment"]["ownerDatabaseId"] = "destination-db".into();
    destination["credentialVault"]["entries"][0]["facets"]
        .as_object_mut()
        .unwrap()
        .remove("deviceTrust");
    rebind_portable(&destination, "destination-db", &mut saved).unwrap();
    assert_eq!(saved.revision, portable_revision);
    assert!(record_matches(&destination, &saved).unwrap());
    destination["credentialVault"]["entries"][0]["facets"]["password"] =
        "different-identity".into();
    assert!(rebind_portable(&destination, "destination-db", &mut saved).is_err());
}

#[test]
fn destination_restore_requires_exact_source_policy_and_existing_origin_grants() {
    let data = public_data();
    let mut saved = record(&data, "synthetic");
    validate_destination_scope(&data, &Value::Null, &mut saved).unwrap();
    saved.source_origin = "https://different.example".into();
    assert!(validate_destination_scope(&data, &Value::Null, &mut saved).is_err());
    saved.source_origin = "https://same.example".into();
    saved.cookies[0].origin = "https://login.example".into();
    saved.cookies[0].domain = "login.example".into();
    assert!(validate_destination_scope(&data, &Value::Null, &mut saved).is_err());
    let grants = json!({"webBrowser":{"domainPermissions":{"version":1,"websites":[{
        "origin":"https://same.example","destinations":[{"origin":"https://login.example",
        "requestClasses":{"navigation":"allow","frame":"allow"}}]}]}}});
    validate_destination_scope(&data, &grants, &mut saved).unwrap();
    assert!(saved.origins.contains(&"https://login.example".to_owned()));
    saved.policy.max_age_hours += 1;
    assert!(validate_destination_scope(&data, &grants, &mut saved).is_err());
}

#[tokio::test]
async fn default_ephemeral_device_preserves_imported_record_without_restoring_or_deleting_it() {
    let mut body = public_data();
    body["connections"][0]
        .as_object_mut()
        .unwrap()
        .remove("browserSession");
    let saved = record(&body, "synthetic");
    let selected = BrowserSessionsDescriptor {
        version: 1,
        records: vec![saved.descriptor()],
    };
    import_records(
        &mut body,
        &empty(),
        &selected,
        &[],
        PrivateSessions {
            version: 1,
            records: vec![saved],
        },
        "db",
    )
    .unwrap();
    let fixture = fixture(&body).await;
    let lease = native_browser_owner::test_cookie_lease(
        fixture.root.path(),
        &fixture.state,
        &fixture.token,
        &body["connections"][0],
    );
    let path = fixture.root.path().join("databases/db.json");
    let bytes = std::fs::read(&path).unwrap();
    let loaded = lease.load_cookie_record(|| true).await.unwrap();
    assert!(loaded.dormant && loaded.record.is_none() && !loaded.changed);
    assert!(lease
        .save_cookie_record(
            None,
            vec![],
            "https://same.example".into(),
            vec!["https://same.example".into()],
            policy(),
            || true
        )
        .await
        .is_err());
    assert_eq!(bytes, std::fs::read(&path).unwrap());
    let mut saved = private(&body).unwrap().records.remove(0);
    let consent = json!({"webBrowser":{"sessionRetention":policy()}});
    validate_destination_scope(&body, &consent, &mut saved).unwrap();
    assert!(descriptor(&body).unwrap() == selected);
}

#[tokio::test]
async fn archive_without_source_device_redirect_consent_is_preserved_but_not_restored() {
    let mut source = public_data();
    source["connections"][0]["httpTrustedRedirectDestinations"] =
        json!({"version":1,"origins":["https://login.example"]});
    let mut saved = record(&source, "synthetic");
    saved.origins.push("https://login.example".into());
    saved.cookies[0].origin = "https://login.example".into();
    saved.cookies[0].domain = "login.example".into();
    saved.refresh_revision().unwrap();
    saved.validate().unwrap();
    let selected = BrowserSessionsDescriptor {
        version: 1,
        records: vec![saved.descriptor()],
    };
    let mut target = public_data();
    import_records(
        &mut target,
        &empty(),
        &selected,
        &[],
        PrivateSessions {
            version: 1,
            records: vec![saved],
        },
        "db",
    )
    .unwrap();
    assert!(target["connections"][0]
        .get("httpTrustedRedirectDestinations")
        .is_none());
    let fixture = fixture(&target).await;
    let lease = native_browser_owner::test_cookie_lease(
        fixture.root.path(),
        &fixture.state,
        &fixture.token,
        &target["connections"][0],
    );
    let path = fixture.root.path().join("databases/db.json");
    let bytes = std::fs::read(&path).unwrap();
    let loaded = lease.load_cookie_record(|| true).await.unwrap();
    assert!(loaded.dormant && loaded.record.is_none() && !loaded.changed);
    assert!(lease
        .save_cookie_record(
            None,
            vec![],
            "https://same.example".into(),
            vec!["https://same.example".into()],
            policy(),
            || true
        )
        .await
        .is_err());
    assert_eq!(bytes, std::fs::read(&path).unwrap());
    assert!(descriptor(&target).unwrap() == selected);
}

#[test]
fn explicit_saved_optout_removes_private_record() {
    let data = with_record();
    let expected = project(data.clone()).unwrap();
    let mut proposed = expected.clone();
    proposed["connections"][0]["browserSession"]["sessionRetention"]["mode"] = "ephemeral".into();
    assert!(
        private(&merge_renderer(&data, proposed, Some(expected)).unwrap())
            .unwrap()
            .records
            .is_empty()
    );
}

#[tokio::test]
async fn disabling_cookies_preserves_capsule_and_blocks_empty_checkpoint_until_reenabled() {
    let original = with_record();
    let fixture = fixture(&original).await;
    let original_descriptor = descriptor(&original).unwrap();
    let mut baseline = project(original.clone()).unwrap();
    for enabled in [false, true] {
        let mut proposed = baseline.clone();
        proposed["connections"][0]["browserSession"]["cookiesEnabled"] = enabled.into();
        let strict_before =
            native_browser_owner::connection_digest(&baseline["connections"][0]).unwrap();
        let strict_after =
            native_browser_owner::connection_digest(&proposed["connections"][0]).unwrap();
        assert_ne!(strict_before, strict_after);
        {
            let _guard = lock_database_operation(&fixture.root.path().join("databases"))
                .await
                .unwrap();
            let result = super::super::save_inner(
                fixture.root.path(),
                &fixture.state,
                "main",
                "db",
                &fixture.token,
                "r1",
                proposed.clone(),
                Some(baseline),
            )
            .await
            .unwrap();
            assert!(result.committed && !result.browser_sessions_changed);
        }
        let lease = native_browser_owner::test_cookie_lease(
            fixture.root.path(),
            &fixture.state,
            &fixture.token,
            &proposed["connections"][0],
        );
        let path = fixture.root.path().join("databases/db.json");
        let before = std::fs::read(&path).unwrap();
        let loaded = lease.load_cookie_record(|| true).await.unwrap();
        if enabled {
            assert!(!loaded.dormant);
            assert_eq!(
                loaded.record.unwrap().cookies[0].value,
                "SYNTHETIC_NATIVE_COOKIE"
            );
        } else {
            assert!(loaded.dormant && loaded.record.is_none());
            assert!(lease
                .save_cookie_record(
                    Some(original_descriptor.records[0].revision.clone()),
                    vec![],
                    "https://same.example".into(),
                    vec!["https://same.example".into()],
                    policy(),
                    || true
                )
                .await
                .is_err());
        }
        assert_eq!(before, std::fs::read(&path).unwrap());
        let snapshot = managed_snapshot(fixture.root.path(), &fixture.state, "db")
            .await
            .unwrap();
        let data = DatabaseEnvelope::parse(&snapshot.data, "db")
            .unwrap()
            .open(&fixture.key)
            .unwrap();
        assert!(descriptor(&data).unwrap() == original_descriptor);
        baseline = project(data).unwrap();
    }
}

#[test]
fn global_cookie_switch_is_a_restore_gate_not_a_portable_identity_change() {
    let mut source = public_data();
    let mut saved = record(&source, "synthetic");
    let globals = json!({"webBrowser":{"cookiesEnabled":false}});
    assert!(validate_destination_scope(&source, &globals, &mut saved).is_err());
    let before = portable_digest(&source["connections"][0], false, "db").unwrap();
    source["connections"][0]["browserSession"]["cookiesEnabled"] = true.into();
    validate_destination_scope(&source, &globals, &mut saved).unwrap();
    assert_eq!(
        portable_digest(&source["connections"][0], false, "db").unwrap(),
        before
    );
    assert!(record_matches(&source, &saved).unwrap());
}

#[test]
fn record_corruption_cookie_and_owner_limits_fail_closed() {
    let data = with_record();
    let mut damaged = data.clone();
    damaged[PRIVATE]["records"][0]["cookies"][0]["value"] = "tampered".into();
    assert!(private(&damaged).is_err());
    let mut saved = record(&data, "synthetic");
    saved.cookies = (0..257).map(|_| cookie("fixture")).collect();
    saved.refresh_revision().unwrap();
    assert!(saved.validate().is_err());
    saved.cookies = (0..20).map(|_| cookie(&"x".repeat(16384))).collect();
    saved.refresh_revision().unwrap();
    assert!(saved.validate().is_err());
    damaged = data.clone();
    let same = damaged[PRIVATE]["records"][0].clone();
    damaged[PRIVATE]["records"] = json!(vec![same; 1025]);
    assert!(private(&damaged).is_err());
}

#[test]
fn expiry_uses_idle_activity_without_extending_absolute_lifetime() {
    let data = public_data();
    let mut saved = record(&data, "synthetic");
    let now = stamp();
    saved.created = now - 3600;
    saved.saved = now - 3600;
    saved.last_used = now - 10;
    assert!(!saved.expired(now));
    saved.last_used = now - 1800;
    assert!(saved.expired(now));
    saved.last_used = now;
    saved.created = now - 24 * 3600;
    assert!(saved.expired(now));
}

#[test]
fn expired_capsule_keeps_public_archive_import_possible_without_resurrection() {
    let mut body = public_data();
    let mut saved = record(&body, "synthetic");
    saved.created -= 2000;
    saved.saved -= 2000;
    saved.last_used -= 2000;
    saved.refresh_revision().unwrap();
    let selected = BrowserSessionsDescriptor {
        version: 1,
        records: vec![saved.descriptor()],
    };
    import_records(
        &mut body,
        &empty(),
        &selected,
        &[],
        PrivateSessions {
            version: 1,
            records: vec![saved],
        },
        "db",
    )
    .unwrap();
    assert!(private(&body).unwrap().records.is_empty());
    assert_eq!(body["connections"][0]["id"], "one");
}

#[test]
fn authenticated_reimport_does_not_undo_newer_native_activity_or_change_revision() {
    let mut current = with_record();
    let mut incoming = private(&current).unwrap();
    incoming.records[0].last_used -= 10;
    let selected = descriptor(&current).unwrap();
    // Use an older authenticated activity checkpoint. The logical CAS remains
    // valid, but it must not move native activity backwards or cause a rewrite.
    let expected_current = current.clone();
    import_records(&mut current, &selected, &selected, &[], incoming, "db").unwrap();
    assert!(current == expected_current);
    assert!(descriptor(&current).unwrap() == selected);
}

#[tokio::test]
async fn ordinary_close_activity_survives_reopen_without_logical_revision_change() {
    let mut data = with_record();
    let mut records = private(&data).unwrap();
    records.records[0].created -= 60;
    records.records[0].saved -= 60;
    records.records[0].last_used -= 60;
    records.records[0].refresh_revision().unwrap();
    let revision = records.records[0].revision.clone();
    let saved = records.records[0].saved;
    put_private(&mut data, records).unwrap();
    let fixture = fixture(&data).await;
    let lease = native_browser_owner::test_cookie_lease(
        fixture.root.path(),
        &fixture.state,
        &fixture.token,
        &data["connections"][0],
    );
    let (cookie_owner, _) = lease.fork_for_cookie_retention().unwrap();
    lease.revoke();
    cookie_owner
        .touch_cookie_record(Some(revision.clone()), || true)
        .await
        .unwrap();
    let reopened = cookie_owner
        .load_cookie_record(|| true)
        .await
        .unwrap()
        .record
        .unwrap();
    assert_eq!(reopened.revision, revision);
    assert_eq!(reopened.saved, saved);
    assert!(reopened.last_used > saved);
    assert!(!reopened.expired(stamp()));
    // Housekeeping cannot delete renewed activity using an old same-revision
    // snapshot: activity intentionally does not advance the logical revision.
    assert!(!cookie_owner
        .expire_cookie_record(Some(revision), || true)
        .await
        .unwrap());
}

#[test]
fn capsule_ciphertext_tampering_is_rejected_and_random_wrapping_keeps_logical_inputs_stable() {
    let source = with_record();
    let selected = descriptor(&source).unwrap();
    let first = seal_transfer(
        "db",
        selected.clone(),
        private(&source).unwrap(),
        vec![],
        "portable-fixture-password",
    )
    .unwrap();
    let second = seal_transfer(
        "db",
        selected.clone(),
        private(&source).unwrap(),
        vec![],
        "portable-fixture-password",
    )
    .unwrap();
    assert_ne!(first.ciphertext, second.ciphertext);
    let incoming = open_transfer(second, &selected, &[], "portable-fixture-password").unwrap();
    assert!(incoming.records[0].descriptor() == selected.records[0]);
    let mut corrupted = first.ciphertext;
    let offset = corrupted.len() / 2;
    let replacement = if corrupted.as_bytes()[offset] == b'A' {
        "B"
    } else {
        "A"
    };
    corrupted.replace_range(offset..offset + 1, replacement);
    assert!(open_transfer(
        BrowserSessionsTransfer {
            version: 1,
            ciphertext: corrupted
        },
        &selected,
        &[],
        "portable-fixture-password"
    )
    .is_err());
}

#[tokio::test]
async fn restarted_native_unlock_preserves_cookies_while_old_owner_stays_revoked() {
    let data = with_record();
    let fixture = fixture(&data).await;
    let old = native_browser_owner::test_cookie_lease(
        fixture.root.path(),
        &fixture.state,
        &fixture.token,
        &data["connections"][0],
    );
    let profile = profile_binding(fixture.root.path()).unwrap();
    database_sessions::global().lock().unwrap().revoke_database(
        fixture.state.database_session_owner(),
        &profile,
        "db",
    );
    assert!(!old.is_current());
    let restarted = EncryptionState::new();
    sorng_encryption::artifact_policy::initialize(&restarted, fixture.root.path()).await;
    let unlocked = {
        let _guard = lock_database_operation(&fixture.root.path().join("databases"))
            .await
            .unwrap();
        let snapshot = managed_snapshot(fixture.root.path(), &restarted, "db")
            .await
            .unwrap();
        let envelope = DatabaseEnvelope::parse(&snapshot.data, "db").unwrap();
        super::super::unlock_inner(
            fixture.root.path(),
            &restarted,
            "main",
            "db",
            &envelope.slots[0].id,
            Some(Zeroizing::new("fixture-password".into())),
            &NoVault,
        )
        .await
        .unwrap()
    };
    assert!(unlocked.data.get(PRIVATE).is_none());
    let fresh = native_browser_owner::test_cookie_lease(
        fixture.root.path(),
        &restarted,
        &unlocked.session_id,
        &data["connections"][0],
    );
    assert_eq!(
        fresh
            .load_cookie_record(|| true)
            .await
            .unwrap()
            .record
            .unwrap()
            .cookies[0]
            .value,
        "SYNTHETIC_NATIVE_COOKIE"
    );
    assert!(old.load_cookie_record(|| true).await.is_err());
}

#[tokio::test]
async fn same_url_two_native_connection_leases_never_share_cookies() {
    let mut data = public_data();
    let mut second = data["connections"][0].clone();
    second["id"] = "two".into();
    data["connections"].as_array_mut().unwrap().push(second);
    let fixture = fixture(&data).await;
    let first = native_browser_owner::test_cookie_lease(
        fixture.root.path(),
        &fixture.state,
        &fixture.token,
        &data["connections"][0],
    );
    let second = native_browser_owner::test_cookie_lease(
        fixture.root.path(),
        &fixture.state,
        &fixture.token,
        &data["connections"][1],
    );
    first
        .save_cookie_record(
            None,
            vec![cookie("first")],
            "https://same.example".into(),
            vec!["https://same.example".into()],
            policy(),
            || true,
        )
        .await
        .unwrap();
    let loaded = second.load_cookie_record(|| true).await.unwrap();
    assert!(!loaded.dormant && loaded.record.is_none());
    second
        .save_cookie_record(
            None,
            vec![cookie("second")],
            "https://same.example".into(),
            vec!["https://same.example".into()],
            policy(),
            || true,
        )
        .await
        .unwrap();
    assert_eq!(
        first
            .load_cookie_record(|| true)
            .await
            .unwrap()
            .record
            .unwrap()
            .cookies[0]
            .value,
        "first"
    );
    assert_eq!(
        second
            .load_cookie_record(|| true)
            .await
            .unwrap()
            .record
            .unwrap()
            .cookies[0]
            .value,
        "second"
    );
}

#[tokio::test]
async fn native_trust_scope_derivation_never_changes_private_database_payload() {
    let data = with_record();
    let fixture = fixture(&data).await;
    let snapshot = managed_snapshot(fixture.root.path(), &fixture.state, "db")
        .await
        .unwrap();
    let ids = super::super::verified_trust_scope_ids(
        fixture.root.path(),
        &fixture.state,
        "main",
        "db",
        "r1",
        &snapshot,
        Some(&fixture.token),
        None,
        None,
    )
    .unwrap();
    assert_eq!(ids, vec!["one"]);
    let after = managed_snapshot(fixture.root.path(), &fixture.state, "db")
        .await
        .unwrap();
    assert!(after.data == snapshot.data);
    assert!(
        descriptor(
            &DatabaseEnvelope::parse(&after.data, "db")
                .unwrap()
                .open(&fixture.key)
                .unwrap()
        )
        .unwrap()
            == descriptor(&data).unwrap()
    );
}

#[test]
fn last_used_activity_is_not_part_of_logical_revision() {
    let data = public_data();
    let mut saved = record(&data, "synthetic");
    let revision = saved.revision.clone();
    saved.last_used += 60;
    saved.refresh_revision().unwrap();
    assert_eq!(revision, saved.revision);
    saved.cookies[0].value = "actual-change".into();
    saved.refresh_revision().unwrap();
    assert_ne!(revision, saved.revision);
}

#[tokio::test]
async fn unchanged_active_cookie_has_bounded_activity_checkpoint_without_revision_churn() {
    let mut data = with_record();
    let mut records = private(&data).unwrap();
    records.records[0].created -= 600;
    records.records[0].saved -= 600;
    records.records[0].last_used -= 600;
    records.records[0].refresh_revision().unwrap();
    let before_revision = records.records[0].revision.clone();
    let before_saved = records.records[0].saved;
    put_private(&mut data, records).unwrap();
    let fixture = fixture(&data).await;
    let lease = native_browser_owner::test_cookie_lease(
        fixture.root.path(),
        &fixture.state,
        &fixture.token,
        &data["connections"][0],
    );
    let updated = lease
        .save_cookie_record(
            Some(before_revision.clone()),
            vec![cookie("SYNTHETIC_NATIVE_COOKIE")],
            "https://same.example".into(),
            vec!["https://same.example".into()],
            policy(),
            || true,
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(updated.revision, before_revision);
    assert_eq!(updated.saved, before_saved);
    assert!(updated.last_used > before_saved);
    let before = std::fs::read(fixture.root.path().join("databases/db.json")).unwrap();
    lease
        .save_cookie_record(
            Some(before_revision),
            vec![cookie("SYNTHETIC_NATIVE_COOKIE")],
            "https://same.example".into(),
            vec!["https://same.example".into()],
            policy(),
            || true,
        )
        .await
        .unwrap();
    assert_eq!(
        before,
        std::fs::read(fixture.root.path().join("databases/db.json")).unwrap()
    );
}

struct NoVault;
impl VaultProvider for NoVault {
    fn available(&self) -> bool {
        false
    }
    fn put<'a>(&'a self, _: &'a str, _: &'a DatabaseKey) -> VaultFuture<'a, ()> {
        Box::pin(async { Err("unused fixture vault".into()) })
    }
    fn get<'a>(&'a self, _: &'a str) -> VaultFuture<'a, DatabaseKey> {
        Box::pin(async { Err("unused fixture vault".into()) })
    }
}

#[tokio::test]
async fn protection_rotation_carries_sessions_and_unlock_response_redacts_them() {
    let data = with_record();
    let fixture = fixture(&data).await;
    let _guard = sorng_encryption::settings_coordinator::lock().await;
    let snapshot = managed_snapshot(fixture.root.path(), &fixture.state, "db")
        .await
        .unwrap();
    let target=serde_json::from_value(json!({"dataCipher":"aes-256-gcm","keepSlotIds":[],"newSlots":[{"type":"password","label":"New fixture password","password":"new-fixture-password","argon2":{"memoryKib":8192,"timeCost":1,"parallelism":1}}]})).unwrap();
    let changed = super::super::change_inner(
        fixture.root.path(),
        &fixture.state,
        "main",
        "db",
        "r1",
        snapshot.data,
        Some(fixture.token.clone()),
        None,
        Some(target),
        false,
        false,
        &NoVault,
    )
    .await
    .unwrap();
    let stored = managed_snapshot(fixture.root.path(), &fixture.state, "db")
        .await
        .unwrap();
    let envelope = DatabaseEnvelope::parse(&stored.data, "db").unwrap();
    assert!(envelope.open(&fixture.key).is_err());
    let profile = profile_binding(fixture.root.path()).unwrap();
    let key = session_key(
        changed.session_id.as_ref().unwrap(),
        &scope(
            &profile,
            "db",
            &changed.security_revision,
            "main",
            &fixture.state,
        ),
    )
    .unwrap();
    assert!(descriptor(&envelope.open(&key).unwrap()).unwrap() == descriptor(&data).unwrap());
    let unlocked = super::super::unlock_inner(
        fixture.root.path(),
        &fixture.state,
        "main",
        "db",
        &envelope.slots[0].id,
        Some(Zeroizing::new("new-fixture-password".into())),
        &NoVault,
    )
    .await
    .unwrap();
    assert!(!serde_json::to_string(&unlocked.data)
        .unwrap()
        .contains("SYNTHETIC_NATIVE_COOKIE"));
    assert!(unlocked.data.get(PRIVATE).is_none());
}

#[test]
fn stale_public_save_preserves_latest_sessions_but_rejects_stale_public_body() {
    let mut current = with_record();
    let baseline = project(current.clone()).unwrap();
    let updated = record(&current, "NEW_SYNTHETIC_COOKIE");
    let revision = updated.revision.clone();
    put_private(
        &mut current,
        PrivateSessions {
            version: 1,
            records: vec![updated],
        },
    )
    .unwrap();
    let mut proposed = baseline.clone();
    proposed["settings"]["theme"] = "new".into();
    let merged = merge_renderer(&current, proposed.clone(), Some(baseline.clone())).unwrap();
    assert_eq!(private(&merged).unwrap().records[0].revision, revision);
    current["settings"]["other"] = "concurrent".into();
    assert!(merge_renderer(&current, proposed, Some(baseline)).is_err());
}

#[test]
fn generic_writes_reject_private_injection_and_prune_deleted_or_changed_owners() {
    let current = with_record();
    let baseline = project(current.clone()).unwrap();
    let mut forged = baseline.clone();
    forged[PRIVATE] = current[PRIVATE].clone();
    assert!(merge_renderer(&current, forged, Some(baseline.clone())).is_err());
    for remove in [true, false] {
        let mut proposed = baseline.clone();
        if remove {
            proposed["connections"] = json!([]);
        } else {
            proposed["connections"][0]["hostname"] = "https://other.example".into();
        }
        assert!(
            private(&merge_renderer(&current, proposed, Some(baseline.clone())).unwrap())
                .unwrap()
                .records
                .is_empty()
        );
    }
}

#[test]
fn password_transfer_is_source_dek_independent_and_authenticates_exact_selection() {
    let source = with_record();
    let selected = descriptor(&source).unwrap();
    let capsule = seal_transfer(
        "source-db",
        selected.clone(),
        private(&source).unwrap(),
        vec![],
        "portable-fixture-password",
    )
    .unwrap();
    let copy = || BrowserSessionsTransfer {
        version: 1,
        ciphertext: capsule.ciphertext.clone(),
    };
    assert!(!capsule.ciphertext.contains("SYNTHETIC_NATIVE_COOKIE"));
    assert!(open_transfer(copy(), &selected, &[], "wrong-fixture-password").is_err());
    assert!(open_transfer(copy(), &empty(), &[], "portable-fixture-password").is_err());
    assert!(open_transfer(
        copy(),
        &selected,
        &["deleted".into()],
        "portable-fixture-password"
    )
    .is_err());
    let incoming = open_transfer(copy(), &selected, &[], "portable-fixture-password").unwrap();
    let mut target = public_data();
    assert!(import_records(&mut target, &empty(), &selected, &[], incoming, "db").unwrap());
    assert_eq!(
        private(&target).unwrap().records[0].cookies[0].value,
        "SYNTHETIC_NATIVE_COOKIE"
    );
    assert!(descriptor(&target).unwrap() == selected);
}

#[test]
fn selected_deletion_requires_exact_destination_revision_and_preserves_other_records() {
    let current = with_record();
    let expected = descriptor(&current).unwrap();
    let mut data = current.clone();
    assert!(import_records(
        &mut data,
        &empty(),
        &empty(),
        &["one".into()],
        PrivateSessions {
            version: 1,
            records: vec![]
        },
        "db"
    )
    .is_err());
    assert!(data == current);
    assert!(import_records(
        &mut data,
        &expected,
        &empty(),
        &["one".into()],
        PrivateSessions {
            version: 1,
            records: vec![]
        },
        "db"
    )
    .unwrap());
    assert!(private(&data).unwrap().records.is_empty());
    let capsule = seal_transfer(
        "source",
        empty(),
        PrivateSessions {
            version: 1,
            records: vec![],
        },
        vec!["one".into()],
        "portable-fixture-password",
    )
    .unwrap();
    assert!(open_transfer(
        capsule,
        &empty(),
        &["different".into()],
        "portable-fixture-password"
    )
    .is_err());
}

#[test]
fn public_body_cas_and_session_conflict_are_checked_before_mutating_stored_database() {
    let current = with_record();
    let baseline = project(current.clone()).unwrap();
    let mut proposed = baseline.clone();
    proposed["settings"]["theme"] = "reviewed-import".into();
    let mut staged = import_public(&current, proposed, baseline).unwrap();
    assert!(import_records(
        &mut staged,
        &empty(),
        &empty(),
        &["one".into()],
        PrivateSessions {
            version: 1,
            records: vec![]
        },
        "db"
    )
    .is_err());
    assert_eq!(current["settings"]["theme"], "fixture");
    assert!(private(&current).unwrap().records.len() == 1);
}

#[tokio::test]
async fn real_database_periodic_noop_does_not_write_or_change_revision() {
    let data = public_data();
    let fixture = fixture(&data).await;
    let lease = native_browser_owner::test_cookie_lease(
        fixture.root.path(),
        &fixture.state,
        &fixture.token,
        &data["connections"][0],
    );
    let first = lease
        .save_cookie_record(
            None,
            vec![cookie("synthetic")],
            "https://same.example".into(),
            vec!["https://same.example".into()],
            policy(),
            || true,
        )
        .await
        .unwrap()
        .unwrap();
    let path = fixture.root.path().join("databases/db.json");
    let before = std::fs::read(&path).unwrap();
    let mut same = cookie("synthetic");
    same.creation = 999;
    let second = lease
        .save_cookie_record(
            Some(first.revision.clone()),
            vec![same],
            "https://same.example".into(),
            vec!["https://same.example".into()],
            policy(),
            || true,
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(first.revision, second.revision);
    assert_eq!(first.saved, second.saved);
    assert_eq!(before, std::fs::read(&path).unwrap());
    assert!(lease
        .save_cookie_record(
            None,
            vec![cookie("stale")],
            "https://same.example".into(),
            vec!["https://same.example".into()],
            policy(),
            || true
        )
        .await
        .is_err());
    assert_eq!(before, std::fs::read(&path).unwrap());
    let stored = lease
        .load_cookie_record(|| true)
        .await
        .unwrap()
        .record
        .unwrap();
    assert_eq!(stored.cookies[0].value, "synthetic");
    lease.revoke();
    assert!(lease.load_cookie_record(|| true).await.is_err());
}

#[tokio::test]
async fn real_database_generic_config_and_credential_save_preserves_private_section() {
    let current = with_record();
    let fixture = fixture(&current).await;
    let baseline = project(current.clone()).unwrap();
    let mut proposed = baseline.clone();
    proposed["settings"]["theme"] = "changed".into();
    proposed["credentialVault"] = json!({"version":1,"revision":0,"entries":[]});
    let _guard = lock_database_operation(&fixture.root.path().join("databases"))
        .await
        .unwrap();
    super::super::save_inner(
        fixture.root.path(),
        &fixture.state,
        "main",
        "db",
        &fixture.token,
        "r1",
        proposed,
        Some(baseline),
    )
    .await
    .unwrap();
    let snapshot = managed_snapshot(fixture.root.path(), &fixture.state, "db")
        .await
        .unwrap();
    let restored = DatabaseEnvelope::parse(&snapshot.data, "db")
        .unwrap()
        .open(&fixture.key)
        .unwrap();
    assert!(descriptor(&restored).unwrap() == descriptor(&current).unwrap());
    assert!(!serde_json::to_string(&snapshot.data)
        .unwrap()
        .contains("SYNTHETIC_NATIVE_COOKIE"));
}

#[tokio::test]
async fn retired_clear_on_lock_removes_private_record_before_revocation() {
    let mut current = with_record();
    let mut records = private(&current).unwrap();
    records.records[0].policy.clear_on_database_lock = true;
    records.records[0].refresh_revision().unwrap();
    put_private(&mut current, records).unwrap();
    let fixture = fixture(&current).await;
    remember_unlock(
        fixture.root.path(),
        &fixture.state,
        "main",
        "db",
        "r1",
        &fixture.token,
    )
    .unwrap();
    let _guard = lock_database_operation(&fixture.root.path().join("databases"))
        .await
        .unwrap();
    before_lock(fixture.root.path(), &fixture.state, "db")
        .await
        .unwrap();
    let snapshot = managed_snapshot(fixture.root.path(), &fixture.state, "db")
        .await
        .unwrap();
    let restored = DatabaseEnvelope::parse(&snapshot.data, "db")
        .unwrap()
        .open(&fixture.key)
        .unwrap();
    assert!(private(&restored).unwrap().records.is_empty());
}

#[tokio::test]
async fn new_destination_dek_reencrypts_portable_sessions_and_final_fence_blocks_revoked_owner() {
    let source = with_record();
    let selected = descriptor(&source).unwrap();
    let capsule = seal_transfer(
        "different-source-db",
        selected.clone(),
        private(&source).unwrap(),
        vec![],
        "portable-fixture-password",
    )
    .unwrap();
    let incoming = open_transfer(capsule, &selected, &[], "portable-fixture-password").unwrap();
    let mut body = public_data();
    body["settings"]["theme"] = "atomic-public-and-private-import".into();
    import_records(&mut body, &empty(), &selected, &[], incoming, "db").unwrap();
    let fixture = fixture(&public_data()).await;
    let _guard = lock_database_operation(&fixture.root.path().join("databases"))
        .await
        .unwrap();
    let snapshot = managed_snapshot(fixture.root.path(), &fixture.state, "db")
        .await
        .unwrap();
    commit_session_data(
        fixture.root.path(),
        &fixture.state,
        "main",
        "db",
        &fixture.token,
        "r1",
        &snapshot,
        &body,
    )
    .await
    .unwrap();
    let stored = managed_snapshot(fixture.root.path(), &fixture.state, "db")
        .await
        .unwrap();
    let envelope = DatabaseEnvelope::parse(&stored.data, "db").unwrap();
    assert_eq!(
        envelope.open(&fixture.key).unwrap()["settings"]["theme"],
        "atomic-public-and-private-import"
    );
    assert!(
        private(&envelope.open(&fixture.key).unwrap())
            .unwrap()
            .records
            .len()
            == 1
    );
    assert!(envelope.open(&DatabaseKey::generate()).is_err());
    database_sessions::global()
        .lock()
        .unwrap()
        .revoke_window(fixture.state.database_session_owner(), "main");
    assert!(commit_session_data(
        fixture.root.path(),
        &fixture.state,
        "main",
        "db",
        &fixture.token,
        "r1",
        &stored,
        &public_data()
    )
    .await
    .is_err());
    assert!(
        managed_snapshot(fixture.root.path(), &fixture.state, "db")
            .await
            .unwrap()
            .data
            == stored.data
    );
}
