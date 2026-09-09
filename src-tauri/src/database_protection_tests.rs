use super::*;
use sorng_storage::sdbf;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};

#[derive(Default)]
struct FakeVault {
    entries: Mutex<HashMap<String, DatabaseKey>>,
    fail: AtomicBool,
}
impl VaultProvider for FakeVault {
    fn available(&self) -> bool {
        true
    }
    fn put<'a>(&'a self, account: &'a str, key: &'a DatabaseKey) -> VaultFuture<'a, ()> {
        Box::pin(async move {
            if self.fail.load(Ordering::Relaxed) {
                return Err("fixture vault unavailable".into());
            }
            let mut entries = self.entries.lock().unwrap();
            if entries.contains_key(account) {
                return Err("fixture collision".into());
            }
            entries.insert(account.into(), key.duplicate());
            Ok(())
        })
    }
    fn get<'a>(&'a self, account: &'a str) -> VaultFuture<'a, DatabaseKey> {
        Box::pin(async move {
            self.entries
                .lock()
                .unwrap()
                .get(account)
                .map(DatabaseKey::duplicate)
                .ok_or("fixture vault item missing".into())
        })
    }
}
async fn fixture() -> (tempfile::TempDir, EncryptionState, Value) {
    let dir = tempfile::tempdir().unwrap();
    let state = EncryptionState::new();
    sorng_encryption::artifact_policy::initialize(&state, dir.path()).await;
    std::fs::create_dir(dir.path().join("databases")).unwrap();
    let data = json!({"connections":[{"id":"one","name":"fixture"}],"settings":{"theme":"kept"}});
    sdbf::safe_write(
        &dir.path().join("databases/index.json"),
        &serde_json::to_vec(
            &json!([{"id":"db","name":"Fixture","isEncrypted":false,"securityRevision":"r0"}]),
        )
        .unwrap(),
    )
    .unwrap();
    sdbf::safe_write(
        &dir.path().join("databases/db.json"),
        &serde_json::to_vec(&data).unwrap(),
    )
    .unwrap();
    (dir, state, data)
}
fn password_target(cipher: &str) -> ProtectionTarget {
    serde_json::from_value(json!({"dataCipher":cipher,"keepSlotIds":[],"newSlots":[{"type":"password","label":"Recovery","password":"fixture-only","argon2":{"memoryKib":8192,"timeCost":1,"parallelism":1}}]})).unwrap()
}

#[test]
fn managed_database_lock_reports_revocation_even_when_notification_fails() {
    let state = EncryptionState::new();
    let scope = SessionScope {
        owner: state.database_session_owner(),
        profile: "lock-notification-fixture",
        database: "db",
        revision: "r0",
        window: "main",
        generation: state.key_generation(),
    };
    let other = SessionScope {
        window: "detached",
        ..scope
    };
    let main_id = database_sessions::global()
        .lock()
        .unwrap()
        .insert(&scope, DatabaseKey::generate())
        .unwrap();
    let other_id = database_sessions::global()
        .lock()
        .unwrap()
        .insert(&other, DatabaseKey::generate())
        .unwrap();
    let result = revoke_database_sessions(scope.owner, scope.profile, scope.database, || {
        // The event is emitted only after every window's lease is gone.
        let mut registry = database_sessions::global().lock().unwrap();
        assert!(registry.key(&main_id, &scope).is_err());
        assert!(registry.key(&other_id, &other).is_err());
        Err("fixture-only notification failure".into())
    })
    .unwrap();
    let wire = serde_json::to_value(result).unwrap();
    assert_eq!(wire["locked"], true);
    assert_eq!(wire["notificationPending"], true);
    assert_eq!(wire["warnings"].as_array().unwrap().len(), 1);
    assert!(!wire.to_string().contains("fixture-only"));
}

#[tokio::test]
async fn managed_database_empty_destination_initialization_never_persists_source_plaintext() {
    let _coordinator = sorng_encryption::settings_coordinator::lock().await;
    let (root, state, existing) = fixture().await;
    let vault = FakeVault::default();
    let source = json!({"connections":[{"id":"private-source","password":"never-plaintext-intermediary"}],"settings":{},"timestamp":1});
    let empty = json!({"connections":[],"settings":{},"timestamp":0});
    assert!(change_inner_with_initialization(
        root.path(),
        &state,
        "main",
        "db",
        "r0",
        existing.clone(),
        None,
        Some(source.clone()),
        Some(password_target("aes-256-gcm")),
        false,
        false,
        true,
        &vault
    )
    .await
    .is_err());
    assert_eq!(
        managed_snapshot(root.path(), &state, "db")
            .await
            .unwrap()
            .data,
        existing
    );
    for not_empty in [
        json!({"connections":[],"settings":{"secret":"existing"},"timestamp":0}),
        json!({"connections":[],"settings":{},"timestamp":0,"other":"existing"}),
    ] {
        sdbf::safe_write(
            &root.path().join("databases/db.json"),
            &serde_json::to_vec(&not_empty).unwrap(),
        )
        .unwrap();
        assert!(change_inner_with_initialization(
            root.path(),
            &state,
            "main",
            "db",
            "r0",
            not_empty.clone(),
            None,
            Some(source.clone()),
            Some(password_target("aes-256-gcm")),
            false,
            false,
            true,
            &vault
        )
        .await
        .is_err());
        assert_eq!(
            managed_snapshot(root.path(), &state, "db")
                .await
                .unwrap()
                .data,
            not_empty
        );
    }
    sdbf::safe_write(
        &root.path().join("databases/db.json"),
        &serde_json::to_vec(&empty).unwrap(),
    )
    .unwrap();
    for (revision, target) in [
        ("stale", Some(password_target("aes-256-gcm"))),
        ("r0", None),
    ] {
        assert!(change_inner_with_initialization(
            root.path(),
            &state,
            "main",
            "db",
            revision,
            empty.clone(),
            None,
            Some(source.clone()),
            target,
            false,
            false,
            true,
            &vault
        )
        .await
        .is_err());
        assert_eq!(
            managed_snapshot(root.path(), &state, "db")
                .await
                .unwrap()
                .data,
            empty
        );
    }
    let initialized = change_inner_with_initialization(
        root.path(),
        &state,
        "main",
        "db",
        "r0",
        empty,
        None,
        Some(source.clone()),
        Some(password_target("aes-256-gcm")),
        false,
        false,
        true,
        &vault,
    )
    .await
    .unwrap();
    assert!(initialized.committed);
    let current = managed_snapshot(root.path(), &state, "db").await.unwrap();
    let envelope = DatabaseEnvelope::parse(&current.data, "db").unwrap();
    let key = envelope
        .unlock_password(&envelope.slots[0].id, "fixture-only")
        .unwrap();
    assert_eq!(envelope.open(&key).unwrap(), source);
    for entry in std::fs::read_dir(root.path().join("databases")).unwrap() {
        let path = entry.unwrap().path();
        if path.is_file() {
            let bytes = std::fs::read(path).unwrap();
            assert!(!String::from_utf8_lossy(&bytes).contains("never-plaintext-intermediary"));
        }
    }
}

#[tokio::test]
async fn managed_database_removed_slots_rotate_the_data_key_and_cannot_open_new_ciphertext() {
    let _coordinator = sorng_encryption::settings_coordinator::lock().await;
    let (root, state, data) = fixture().await;
    let vault = FakeVault::default();
    let mut target = password_target("aes-256-gcm");
    target
        .new_slots
        .extend(password_target("aes-256-gcm").new_slots);
    let initial = change_inner(
        root.path(),
        &state,
        "main",
        "db",
        "r0",
        data.clone(),
        None,
        Some(data.clone()),
        Some(target),
        false,
        false,
        &vault,
    )
    .await
    .unwrap();
    let original = managed_snapshot(root.path(), &state, "db").await.unwrap();
    let old_envelope = DatabaseEnvelope::parse(&original.data, "db").unwrap();
    let old_key = old_envelope
        .unlock_password(&old_envelope.slots[0].id, "fixture-only")
        .unwrap();
    // Removing only one slot while retaining another would leave the removed
    // backed-up wrapping key able to open future ciphertext: reject it.
    let mut partial = password_target("aes-256-gcm");
    partial.keep_slot_ids.push(old_envelope.slots[0].id.clone());
    assert!(change_inner(
        root.path(),
        &state,
        "main",
        "db",
        &initial.security_revision,
        original.data.clone(),
        initial.session_id.clone(),
        None,
        Some(partial),
        false,
        false,
        &vault
    )
    .await
    .err()
    .unwrap()
    .contains("re-enrolling"));
    assert_eq!(
        managed_snapshot(root.path(), &state, "db")
            .await
            .unwrap()
            .data,
        original.data
    );

    let replacement: ProtectionTarget = serde_json::from_value(json!({
        "dataCipher":"chacha20-poly1305", "keepSlotIds":[], "newSlots":[{
            "type":"password", "label":"Replacement", "password":"new-fixture-password",
            "argon2":{"memoryKib":8192,"timeCost":1,"parallelism":1}
        }]
    }))
    .unwrap();
    let changed = change_inner(
        root.path(),
        &state,
        "main",
        "db",
        &initial.security_revision,
        original.data.clone(),
        initial.session_id,
        None,
        Some(replacement),
        false,
        false,
        &vault,
    )
    .await
    .unwrap();
    assert!(changed.committed);
    let current = managed_snapshot(root.path(), &state, "db").await.unwrap();
    let new_envelope = DatabaseEnvelope::parse(&current.data, "db").unwrap();
    assert_ne!(new_envelope.key_id, old_envelope.key_id);
    assert_eq!(old_envelope.open(&old_key).unwrap(), data); // Old archive remains recoverable.
    assert!(new_envelope.open(&old_key).is_err()); // But the old key grants no new access.
    assert!(new_envelope
        .unlock_password(&new_envelope.slots[0].id, "fixture-only")
        .is_err());
    let new_key = new_envelope
        .unlock_password(&new_envelope.slots[0].id, "new-fixture-password")
        .unwrap();
    assert_eq!(new_envelope.open(&new_key).unwrap(), data);
}
#[tokio::test]
async fn managed_database_password_cipher_change_cas_and_raw_endpoint_fences() {
    let _coordinator = sorng_encryption::settings_coordinator::lock().await;
    let (root, state, data) = fixture().await;
    let vault = FakeVault::default();
    let result = change_inner(
        root.path(),
        &state,
        "main",
        "db",
        "r0",
        data.clone(),
        None,
        Some(data.clone()),
        Some(password_target("aes-256-gcm")),
        false,
        false,
        &vault,
    )
    .await
    .unwrap();
    assert!(result.committed && !result.cleanup_pending);
    assert!(result.session_expires_at.is_some());
    let stored = managed_snapshot(root.path(), &state, "db").await.unwrap();
    let envelope = DatabaseEnvelope::parse(&stored.data, "db").unwrap();
    assert_eq!(stored.row["protectionFormat"], "sorng-db");
    assert_eq!(envelope.security_revision, result.security_revision);
    assert!(crate::database_files::reject_managed_raw_write(
        &stored.row,
        Some(&stored.data),
        &data
    )
    .is_err());
    assert!(
        crate::database_files::reject_managed_raw_write(&json!({}), None, &stored.data).is_err()
    );
    assert!(crate::database_files::reject_managed_raw_write(
        &json!({}),
        None,
        &Value::String("{\"format\":\"sorng-db\", broken".into())
    )
    .is_err());
    assert!(unlock_inner(
        root.path(),
        &state,
        "main",
        "db",
        &envelope.slots[0].id,
        Some(Zeroizing::new("wrong".into())),
        &vault
    )
    .await
    .is_err());
    let unlock = unlock_inner(
        root.path(),
        &state,
        "main",
        "db",
        &envelope.slots[0].id,
        Some(Zeroizing::new("fixture-only".into())),
        &vault,
    )
    .await
    .unwrap();
    assert_eq!(unlock.data, data);
    assert!(save_inner(
        root.path(),
        &state,
        "other-window",
        "db",
        &unlock.session_id,
        &unlock.security_revision,
        data.clone()
    )
    .await
    .is_err());
    assert!(save_inner(
        root.path(),
        &state,
        "main",
        "db",
        &unlock.session_id,
        "r0",
        data.clone()
    )
    .await
    .is_err());
    let target:ProtectionTarget=serde_json::from_value(json!({"dataCipher":"chacha20-poly1305","keepSlotIds":[envelope.slots[0].id],"newSlots":[]})).unwrap();
    let changed = change_inner(
        root.path(),
        &state,
        "main",
        "db",
        &unlock.security_revision,
        stored.data.clone(),
        Some(unlock.session_id.clone()),
        None,
        Some(target),
        false,
        false,
        &vault,
    )
    .await
    .unwrap();
    let next = managed_snapshot(root.path(), &state, "db").await.unwrap();
    assert_eq!(
        DatabaseEnvelope::parse(&next.data, "db")
            .unwrap()
            .data_cipher,
        DataCipher::Chacha20Poly1305
    );
    assert!(save_inner(
        root.path(),
        &state,
        "main",
        "db",
        &unlock.session_id,
        &changed.security_revision,
        data.clone()
    )
    .await
    .is_err());
    assert!(change_inner(
        root.path(),
        &state,
        "main",
        "db",
        &unlock.security_revision,
        stored.data,
        Some(unlock.session_id),
        None,
        None,
        true,
        false,
        &vault
    )
    .await
    .is_err());
    assert_eq!(
        managed_snapshot(root.path(), &state, "db")
            .await
            .unwrap()
            .data,
        next.data
    );
    let mut edited = data.clone();
    edited["connections"][0]["name"] = "saved".into();
    save_inner(
        root.path(),
        &state,
        "main",
        "db",
        changed.session_id.as_deref().unwrap(),
        &changed.security_revision,
        edited.clone(),
    )
    .await
    .unwrap();
    let saved = managed_snapshot(root.path(), &state, "db").await.unwrap();
    assert!(change_inner(
        root.path(),
        &state,
        "main",
        "db",
        &changed.security_revision,
        saved.data.clone(),
        changed.session_id.clone(),
        None,
        None,
        false,
        false,
        &vault
    )
    .await
    .is_err());
    let disabled = change_inner(
        root.path(),
        &state,
        "main",
        "db",
        &changed.security_revision,
        saved.data,
        changed.session_id,
        None,
        None,
        true,
        false,
        &vault,
    )
    .await
    .unwrap();
    assert!(disabled.session_id.is_none());
    assert_eq!(
        managed_snapshot(root.path(), &state, "db")
            .await
            .unwrap()
            .data,
        edited
    );
}

#[tokio::test]
async fn managed_database_vault_enrollment_failure_restart_and_device_binding() {
    let _coordinator = sorng_encryption::settings_coordinator::lock().await;
    let (root, state, data) = fixture().await;
    let vault = FakeVault::default();
    let target = || {
        serde_json::from_value(json!({"dataCipher":"chacha20-poly1305","keepSlotIds":[],"newSlots":[{"type":"os-vault","label":"This OS account"}]})).unwrap()
    };
    assert!(change_inner(
        root.path(),
        &state,
        "main",
        "db",
        "r0",
        data.clone(),
        None,
        Some(data.clone()),
        Some(target()),
        false,
        false,
        &vault
    )
    .await
    .is_err());
    vault.fail.store(true, Ordering::Relaxed);
    assert!(change_inner(
        root.path(),
        &state,
        "main",
        "db",
        "r0",
        data.clone(),
        None,
        Some(data.clone()),
        Some(target()),
        false,
        true,
        &vault
    )
    .await
    .is_err());
    assert_eq!(
        managed_snapshot(root.path(), &state, "db")
            .await
            .unwrap()
            .data,
        data
    );
    vault.fail.store(false, Ordering::Relaxed);
    let enrolled = change_inner(
        root.path(),
        &state,
        "main",
        "db",
        "r0",
        data.clone(),
        None,
        Some(data.clone()),
        Some(target()),
        false,
        true,
        &vault,
    )
    .await
    .unwrap();
    assert!(enrolled.committed);
    let restarted = EncryptionState::new();
    sorng_encryption::artifact_policy::initialize(&restarted, root.path()).await;
    let stored = managed_snapshot(root.path(), &restarted, "db")
        .await
        .unwrap();
    let envelope = DatabaseEnvelope::parse(&stored.data, "db").unwrap();
    let opened = unlock_inner(
        root.path(),
        &restarted,
        "second-window",
        "db",
        &envelope.slots[0].id,
        None,
        &vault,
    )
    .await
    .unwrap();
    assert_eq!(opened.data, data);
    // Copied ciphertext cannot use a machine slot under another profile.
    let (copy, copy_state, _) = fixture().await;
    sdbf::safe_write(
        &copy.path().join("databases/index.json"),
        &serde_json::to_vec(&stored.index).unwrap(),
    )
    .unwrap();
    sdbf::safe_write(
        &copy.path().join("databases/db.json"),
        &serde_json::to_vec(&stored.data).unwrap(),
    )
    .unwrap();
    assert!(unlock_inner(
        copy.path(),
        &copy_state,
        "main",
        "db",
        &envelope.slots[0].id,
        None,
        &vault
    )
    .await
    .is_err());
    restarted.lock().await; // Even with outer at-rest disabled, native inner sessions are revoked.
    assert!(save_inner(
        root.path(),
        &restarted,
        "second-window",
        "db",
        &opened.session_id,
        &opened.security_revision,
        data
    )
    .await
    .is_err());
}

#[test]
fn managed_database_capabilities_are_honest_and_contain_no_secret_material() {
    let value = database_protection_capabilities();
    assert_eq!(value["schemaVersion"], 1);
    assert_eq!(value["ciphers"][0]["id"], "aes-256-gcm");
    assert_eq!(value["ciphers"][1]["id"], "chacha20-poly1305");
    for kind in ["webauthn-prf", "biometric"] {
        let row = value["protectors"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["id"] == kind)
            .unwrap();
        assert_eq!(row["available"], false);
        assert!(row["reason"].as_str().unwrap().contains("not implemented"));
    }
    assert!(VAULT_SERVICE.starts_with("sortofremoteng.internal."));
}

#[tokio::test]
async fn managed_database_vault_cannot_bypass_configured_global_lock_with_plaintext_overrides() {
    let _coordinator = sorng_encryption::settings_coordinator::lock().await;
    let (root, state, data) = fixture().await;
    let vault = FakeVault::default();
    state.install(sorng_encryption::MasterDek::generate()).await;
    let policy = sorng_encryption::artifact_policy::PolicyDocument::default()
        .with_mode(
            sorng_encryption::ArtifactKind::Connections,
            sorng_encryption::artifact_policy::ProtectionMode::Plaintext,
        )
        .unwrap()
        .with_mode(
            sorng_encryption::ArtifactKind::DatabasesIndex,
            sorng_encryption::artifact_policy::ProtectionMode::Plaintext,
        )
        .unwrap();
    let receipt = sorng_encryption::artifact_policy::encode(&state, &policy)
        .await
        .unwrap();
    std::fs::write(
        root.path()
            .join(sorng_encryption::artifact_policy::POLICY_FILENAME),
        receipt,
    )
    .unwrap();
    sorng_encryption::artifact_policy::refresh(&state).await;
    let target=serde_json::from_value(json!({"dataCipher":"aes-256-gcm","keepSlotIds":[],"newSlots":[{"type":"os-vault","label":"Account"}]})).unwrap();
    change_inner(
        root.path(),
        &state,
        "main",
        "db",
        "r0",
        data.clone(),
        None,
        Some(data),
        Some(target),
        false,
        true,
        &vault,
    )
    .await
    .unwrap();
    let before = managed_snapshot(root.path(), &state, "db").await.unwrap();
    let slot = DatabaseEnvelope::parse(&before.data, "db").unwrap().slots[0]
        .id
        .clone();
    let payload = std::fs::read(root.path().join("databases/db.json")).unwrap();
    state.lock().await;
    let error = match unlock_inner(root.path(), &state, "main", "db", &slot, None, &vault).await {
        Err(error) => error,
        Ok(_) => panic!("global lock bypassed"),
    };
    assert!(error.contains("locked"));
    assert_eq!(
        std::fs::read(root.path().join("databases/db.json")).unwrap(),
        payload
    );
}
