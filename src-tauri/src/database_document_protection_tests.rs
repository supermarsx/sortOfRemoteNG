//! Synthetic document storage policy fixtures; no real profile or OS vault.
use super::*;
use serde_json::json;
use sorng_encryption::artifact_policy::{self, PolicyDocument, ProtectionMode};

fn document_data() -> serde_json::Value {
    json!({"connections":[],"documents":{"version":1,"revision":1,"documents":[{"id":"fixture","body":"SYNTHETIC_DOCUMENT_PRIVATE"}],"attachments":[],"people":[],"tickets":[]}})
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
fn document_plaintext_guard_requires_absence_or_exact_empty_supported_library() {
    assert!(reject_unprotected_documents(&json!({"connections":[]})).is_ok());
    let empty =
        json!({"version":1,"revision":0,"documents":[],"attachments":[],"people":[],"tickets":[]});
    assert!(reject_unprotected_documents(&json!({"documents":empty})).is_ok());
    for field in ["documents", "attachments", "people", "tickets"] {
        let mut private = empty.clone();
        private[field] = json!([{"privateFixture":"SYNTHETIC_DOCUMENT_PRIVATE"}]);
        assert!(reject_unprotected_documents(&json!({"documents":private})).is_err());
    }
    for malformed in [
        serde_json::Value::Null,
        json!({}),
        json!({"version":2,"revision":0,"documents":[],"attachments":[],"people":[],"tickets":[]}),
        json!({"version":1,"revision":0,"documents":[],"attachments":[],"people":[],"tickets":[],"extra":"SYNTHETIC_DOCUMENT_PRIVATE"}),
    ] {
        let error = reject_unprotected_documents(&json!({"documents":malformed})).unwrap_err();
        assert!(error.contains("protected documents"));
        assert!(!error.contains("SYNTHETIC_DOCUMENT_PRIVATE"));
    }
}

#[tokio::test]
async fn global_only_document_write_encrypts_actual_connections_and_status_authenticates_it() {
    let _guard = sorng_encryption::settings_coordinator::lock().await;
    let root = tempfile::tempdir().unwrap();
    let state = EncryptionState::new();
    state.install(sorng_encryption::MasterDek::generate()).await;
    artifact_policy::initialize(&state, root.path()).await;
    std::fs::create_dir(root.path().join("databases")).unwrap();
    let path = root.path().join("databases/db.json");
    safe_write(&path, br#"{"connections":[]}"#).unwrap();
    assert!(
        !globally_protected_database(root.path(), &state, "db")
            .await
            .unwrap(),
        "enabled setting alone cannot prove the existing file encrypted"
    );
    let data = document_data();
    require_document_protection(&state, None, &data)
        .await
        .unwrap();
    save_payload(&state, ArtifactKind::Connections, &path, &data, true)
        .await
        .unwrap();
    let bytes = std::fs::read(&path).unwrap();
    assert!(is_envelope_blob(parse_and_verify(&bytes).unwrap()));
    assert!(!String::from_utf8_lossy(&bytes).contains("SYNTHETIC_DOCUMENT_PRIVATE"));
    assert!(globally_protected_database(root.path(), &state, "db")
        .await
        .unwrap());
    assert_eq!(
        encrypted_load(&state, ArtifactKind::Connections, &path)
            .await
            .unwrap()
            .unwrap()
            .value,
        data
    );
    let mut corrupt = safe_read_raw(&path).unwrap().unwrap().0;
    *corrupt.last_mut().unwrap() ^= 1;
    safe_write(&path, &corrupt).unwrap();
    assert!(globally_protected_database(root.path(), &state, "db")
        .await
        .is_err());
}

#[tokio::test]
async fn neither_layer_rejects_new_documents_and_existing_document_omission_without_writing() {
    let _guard = sorng_encryption::settings_coordinator::lock().await;
    let root = tempfile::tempdir().unwrap();
    let state = EncryptionState::new();
    artifact_policy::initialize(&state, root.path()).await;
    let path = root.path().join("db.json");
    let data = document_data();
    assert!(require_document_protection(&state, None, &data)
        .await
        .is_err());
    assert!(
        save_payload(&state, ArtifactKind::Connections, &path, &data, false)
            .await
            .unwrap_err()
            .contains("protected documents")
    );
    assert!(!path.exists());
    safe_write(&path, &serde_json::to_vec(&data).unwrap()).unwrap();
    let before = std::fs::read(&path).unwrap();
    for proposed in [json!({"connections":[]}), json!("unverified-legacy-string")] {
        assert!(require_document_protection(&state, Some(&data), &proposed)
            .await
            .is_err());
        assert!(
            save_payload(&state, ArtifactKind::Connections, &path, &proposed, false)
                .await
                .unwrap_err()
                .contains("protected documents")
        );
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }
    assert!(!sibling(&path, "bak").exists());
}

#[tokio::test]
async fn unlocked_but_plaintext_connections_and_locked_global_key_never_downgrade_documents() {
    let _guard = sorng_encryption::settings_coordinator::lock().await;
    let root = tempfile::tempdir().unwrap();
    let state = EncryptionState::new();
    state.install(sorng_encryption::MasterDek::generate()).await;
    artifact_policy::initialize(&state, root.path()).await;
    let path = root.path().join("db.json");
    let data = document_data();
    save_payload(&state, ArtifactKind::Connections, &path, &data, true)
        .await
        .unwrap();
    let before = std::fs::read(&path).unwrap();
    plaintext_override(root.path(), &state).await;
    assert!(state.is_unlocked().await);
    for proposed in [
        data.clone(),
        json!({"connections":[]}),
        json!({"documents":null}),
    ] {
        assert!(require_document_protection(&state, Some(&data), &proposed)
            .await
            .is_err());
        assert!(
            save_payload(&state, ArtifactKind::Connections, &path, &proposed, true)
                .await
                .unwrap_err()
                .contains("protected documents")
        );
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }
    state.lock().await;
    assert!(require_document_protection(&state, Some(&data), &data)
        .await
        .is_err());
    assert!(
        save_payload(&state, ArtifactKind::Connections, &path, &data, true)
            .await
            .is_err()
    );
    assert_eq!(std::fs::read(&path).unwrap(), before);
}
