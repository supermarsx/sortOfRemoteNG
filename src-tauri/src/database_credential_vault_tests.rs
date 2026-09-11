//! Synthetic storage-only fixtures: no application profile or OS vault.
use super::*;
use serde_json::json;
use sorng_encryption::artifact_policy::{self, PolicyDocument, ProtectionMode};

fn vault_data() -> serde_json::Value {
    json!({"connections":[],"credentialVault":{"version":1,"revision":1,"entries":[{"id":"fixture","facets":{"password":"SYNTHETIC_PRIVATE"}}]}})
}

async fn plaintext_override(root: &Path, state: &EncryptionState) {
    let policy = PolicyDocument::default()
        .with_mode(ArtifactKind::Connections, ProtectionMode::Plaintext)
        .unwrap();
    std::fs::write(
        root.join(artifact_policy::POLICY_FILENAME),
        artifact_policy::encode(state, &policy).await.unwrap(),
    )
    .unwrap();
    artifact_policy::refresh(state).await;
}

#[test]
fn credential_vault_plaintext_guard_accepts_only_absence_or_exact_empty_v1() {
    assert!(reject_plaintext_credential_vault(&json!({"connections":[]})).is_ok());
    assert!(reject_plaintext_credential_vault(
        &json!({"credentialVault":{"version":1,"revision":0,"entries":[]}})
    )
    .is_ok());
    for vault in [
        serde_json::Value::Null,
        json!({}),
        json!({"version":2,"revision":0,"entries":[]}),
        json!({"version":1,"revision":-1,"entries":[]}),
        json!({"version":1,"revision":0,"entries":null}),
        json!({"version":1,"revision":0,"entries":[],"unexpected":"SYNTHETIC_PRIVATE"}),
        vault_data()["credentialVault"].clone(),
    ] {
        let error =
            reject_plaintext_credential_vault(&json!({"credentialVault":vault})).unwrap_err();
        assert!(error.contains("credential vault"));
        assert!(!error.contains("SYNTHETIC_PRIVATE"));
        assert!(!error.contains("fixture"));
    }
}

#[tokio::test]
async fn credential_vault_raw_writer_checks_proposed_and_existing_without_global_key() {
    let _guard = sorng_encryption::settings_coordinator::lock().await;
    let root = tempfile::tempdir().unwrap();
    let state = EncryptionState::new();
    artifact_policy::initialize(&state, root.path()).await;
    let path = root.path().join("db.json");
    let data = vault_data();
    assert!(
        save_payload(&state, ArtifactKind::Connections, &path, &data, false)
            .await
            .unwrap_err()
            .contains("credential vault")
    );
    assert!(!path.exists());

    // An existing legacy/plaintext vault cannot be silently stripped, even by
    // replacing the complete JSON with an opaque legacy ciphertext string.
    safe_write(&path, &serde_json::to_vec(&data).unwrap()).unwrap();
    let before = std::fs::read(&path).unwrap();
    for proposed in [json!({"connections":[]}), json!("legacy-envelope")] {
        assert!(
            save_payload(&state, ArtifactKind::Connections, &path, &proposed, false)
                .await
                .unwrap_err()
                .contains("credential vault")
        );
        assert_eq!(std::fs::read(&path).unwrap(), before);
        assert!(
            require_credential_vault_protection(&state, Some(&data), &proposed)
                .await
                .is_err()
        );
    }
    assert!(!sibling(&path, "bak").exists());
}

#[tokio::test]
async fn credential_vault_raw_writer_requires_effective_encryption_not_only_unlocked_key() {
    let _guard = sorng_encryption::settings_coordinator::lock().await;
    let root = tempfile::tempdir().unwrap();
    let state = EncryptionState::new();
    state.install(sorng_encryption::MasterDek::generate()).await;
    artifact_policy::initialize(&state, root.path()).await;
    let path = root.path().join("db.json");
    let data = vault_data();
    save_payload(&state, ArtifactKind::Connections, &path, &data, true)
        .await
        .unwrap();
    let before = std::fs::read(&path).unwrap();
    assert!(is_envelope_blob(parse_and_verify(&before).unwrap()));
    assert_eq!(
        encrypted_load(&state, ArtifactKind::Connections, &path)
            .await
            .unwrap()
            .unwrap()
            .value,
        data
    );

    plaintext_override(root.path(), &state).await;
    assert!(state.is_unlocked().await);
    for proposed in [data.clone(), json!({"connections":[]})] {
        let error = save_payload(&state, ArtifactKind::Connections, &path, &proposed, true)
            .await
            .unwrap_err();
        assert!(error.contains("credential vault"));
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }
    state.lock().await;
    assert!(
        save_payload(&state, ArtifactKind::Connections, &path, &data, true)
            .await
            .is_err()
    );
    assert_eq!(std::fs::read(&path).unwrap(), before);
}

#[tokio::test]
async fn credential_vault_global_status_requires_actual_authenticated_current_payload() {
    let _guard = sorng_encryption::settings_coordinator::lock().await;
    let root = tempfile::tempdir().unwrap();
    let state = EncryptionState::new();
    state.install(sorng_encryption::MasterDek::generate()).await;
    artifact_policy::initialize(&state, root.path()).await;
    std::fs::create_dir(root.path().join("databases")).unwrap();
    let path = root.path().join("databases/db.json");
    safe_write(&path, br#"{"connections":[]}"#).unwrap();
    assert!(!globally_protected_database(root.path(), &state, "db")
        .await
        .unwrap());
    save_payload(
        &state,
        ArtifactKind::Connections,
        &path,
        &vault_data(),
        true,
    )
    .await
    .unwrap();
    assert!(globally_protected_database(root.path(), &state, "db")
        .await
        .unwrap());
    let encrypted = safe_read_raw(&path).unwrap().unwrap().0;
    let mut corrupt = encrypted.clone();
    *corrupt.last_mut().unwrap() ^= 1;
    safe_write(&path, &corrupt).unwrap();
    assert!(globally_protected_database(root.path(), &state, "db")
        .await
        .is_err());
    safe_write(&path, &encrypted).unwrap();
    plaintext_override(root.path(), &state).await;
    assert!(!globally_protected_database(root.path(), &state, "db")
        .await
        .unwrap());
}
