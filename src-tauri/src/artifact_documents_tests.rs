//! Final artifact conversion guard, compiled through the shared app facade too.
use super::*;
use serde_json::json;

#[tokio::test]
async fn artifact_plaintext_conversion_refuses_documents_even_with_global_key_unlocked() {
    let state = EncryptionState::new();
    state.install(sorng_encryption::MasterDek::generate()).await;
    for documents in [
        json!(null),
        json!({"version":1,"revision":1,"documents":[{"body":"SYNTHETIC_DOCUMENT_PRIVATE"}],"attachments":[],"people":[],"tickets":[]}),
    ] {
        let plain = serde_json::to_vec(&json!({"connections":[],"documents":documents})).unwrap();
        let error = encoded_bytes(&state, ArtifactKind::Connections, &plain, false)
            .await
            .unwrap_err();
        assert!(error.contains("protected documents"));
        assert!(!error.contains("SYNTHETIC_DOCUMENT_PRIVATE"));
        let encrypted = encoded_bytes(&state, ArtifactKind::Connections, &plain, true)
            .await
            .unwrap();
        let key = state.sub_key(ArtifactKind::Connections).await.unwrap();
        assert_eq!(
            envelope_io::decrypt_with_subkey(&key, &encrypted).unwrap(),
            plain
        );
        assert!(!String::from_utf8_lossy(&encrypted).contains("SYNTHETIC_DOCUMENT_PRIVATE"));
    }
}

#[tokio::test]
async fn artifact_outer_decryption_can_preserve_real_managed_document_ciphertext() {
    use sorng_encryption::database_protection::{
        self as codec, DataCipher, DatabaseEnvelope, DatabaseKey,
    };
    let state = EncryptionState::new();
    let key = DatabaseKey::generate();
    let kek = DatabaseKey::generate();
    let slot = codec::new_vault_slot(
        "db",
        "key",
        "slot".into(),
        "fixture-profile",
        "Synthetic OS vault",
        &kek,
        &key,
    )
    .unwrap();
    let data = json!({"connections":[],"documents":{"version":1,"revision":1,"documents":[],"attachments":[],"people":[{"private":"SYNTHETIC_DOCUMENT_PRIVATE"}],"tickets":[]}});
    let envelope = DatabaseEnvelope::create(
        "db",
        "key",
        "r1",
        DataCipher::Aes256Gcm,
        vec![slot],
        &data,
        &key,
    )
    .unwrap();
    let plain = serde_json::to_vec(&envelope.value().unwrap()).unwrap();
    let output = encoded_bytes(&state, ArtifactKind::Connections, &plain, false)
        .await
        .unwrap();
    assert_eq!(output, plain);
    assert!(!String::from_utf8_lossy(&output).contains("SYNTHETIC_DOCUMENT_PRIVATE"));
    let decoded = DatabaseEnvelope::parse(&serde_json::from_slice(&output).unwrap(), "db").unwrap();
    assert_eq!(decoded.open(&key).unwrap(), data);
}
