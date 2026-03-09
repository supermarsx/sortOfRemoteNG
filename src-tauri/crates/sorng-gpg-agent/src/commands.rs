//! # Tauri Commands for GPG Agent
//!
//! Each function is a `#[tauri::command]` that locks the shared state
//! (`GpgServiceState = Arc<tokio::sync::Mutex<GpgAgentService>>`) and
//! delegates to `GpgAgentService`.

use crate::types::*;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use tauri::State;

/// Decode a base64-encoded string to bytes.
fn b64_decode(s: &str) -> Result<Vec<u8>, String> {
    B64.decode(s)
        .map_err(|e| format!("base64 decode error: {}", e))
}

/// Convenience alias for command return types.
type CmdResult<T> = Result<T, String>;

// ── Lifecycle commands ──────────────────────────────────────────────

/// Detect the GPG environment (binary, home, sockets, config).
#[tauri::command]
pub async fn gpg_detect_environment(
    state: State<'_, GpgServiceState>,
) -> CmdResult<GpgAgentConfig> {
    let mut service = state.lock().await;
    service.detect_environment().await
}

/// Start the gpg-agent daemon.
#[tauri::command]
pub async fn gpg_start_agent(state: State<'_, GpgServiceState>) -> CmdResult<()> {
    let mut service = state.lock().await;
    service.start_agent().await
}

/// Stop the gpg-agent daemon.
#[tauri::command]
pub async fn gpg_stop_agent(state: State<'_, GpgServiceState>) -> CmdResult<()> {
    let mut service = state.lock().await;
    service.stop_agent().await
}

/// Get the current gpg-agent status.
#[tauri::command]
pub async fn gpg_get_status(state: State<'_, GpgServiceState>) -> CmdResult<GpgAgentStatus> {
    let mut service = state.lock().await;
    Ok(service.get_status().await)
}

// ── Config commands ─────────────────────────────────────────────────

/// Read the gpg-agent configuration.
#[tauri::command]
pub async fn gpg_get_config(state: State<'_, GpgServiceState>) -> CmdResult<GpgAgentConfig> {
    let mut service = state.lock().await;
    service.get_config().await
}

/// Update gpg-agent configuration and reload.
#[tauri::command]
pub async fn gpg_update_config(
    state: State<'_, GpgServiceState>,
    config: GpgAgentConfig,
) -> CmdResult<()> {
    let mut service = state.lock().await;
    service.update_config(config).await
}

/// Reload the gpg-agent to pick up config changes.
#[tauri::command]
pub async fn gpg_reload_agent(state: State<'_, GpgServiceState>) -> CmdResult<()> {
    let mut service = state.lock().await;
    service.restart_agent().await
}

// ── Keyring commands ────────────────────────────────────────────────

/// List all GPG keys.
#[tauri::command]
pub async fn gpg_list_keys(
    state: State<'_, GpgServiceState>,
    secret_only: bool,
) -> CmdResult<Vec<GpgKey>> {
    let service = state.lock().await;
    service.list_keys(secret_only).await
}

/// Get a single GPG key by ID or fingerprint.
#[tauri::command]
pub async fn gpg_get_key(
    state: State<'_, GpgServiceState>,
    key_id: String,
) -> CmdResult<Option<GpgKey>> {
    let service = state.lock().await;
    service.get_key(&key_id).await
}

/// Generate a new GPG key pair.
#[tauri::command]
pub async fn gpg_generate_key(
    state: State<'_, GpgServiceState>,
    params: KeyGenParams,
) -> CmdResult<GpgKey> {
    let mut service = state.lock().await;
    service.generate_key(&params).await
}

/// Import GPG key data (base64-encoded).
#[tauri::command]
pub async fn gpg_import_key(
    state: State<'_, GpgServiceState>,
    data_b64: String,
    armor: bool,
) -> CmdResult<KeyImportResult> {
    let data = b64_decode(&data_b64)?;
    let mut service = state.lock().await;
    service.import_key(&data, armor).await
}

/// Import a GPG key from a file path.
#[tauri::command]
pub async fn gpg_import_key_file(
    state: State<'_, GpgServiceState>,
    path: String,
) -> CmdResult<KeyImportResult> {
    let mut service = state.lock().await;
    service.import_key_file(&path).await
}

/// Export a public key (armored or binary).
#[tauri::command]
pub async fn gpg_export_key(
    state: State<'_, GpgServiceState>,
    key_id: String,
    options: KeyExportOptions,
) -> CmdResult<Vec<u8>> {
    let service = state.lock().await;
    service.export_key(&key_id, &options).await
}

/// Export a secret key.
#[tauri::command]
pub async fn gpg_export_secret_key(
    state: State<'_, GpgServiceState>,
    key_id: String,
) -> CmdResult<Vec<u8>> {
    let service = state.lock().await;
    service.export_secret_key(&key_id).await
}

/// Delete a key (optionally including the secret part).
#[tauri::command]
pub async fn gpg_delete_key(
    state: State<'_, GpgServiceState>,
    key_id: String,
    secret_too: bool,
) -> CmdResult<bool> {
    let mut service = state.lock().await;
    service.delete_key(&key_id, secret_too).await
}

// ── Key management commands ─────────────────────────────────────────

/// Add a UID to an existing key.
#[tauri::command]
pub async fn gpg_add_uid(
    state: State<'_, GpgServiceState>,
    key_id: String,
    name: String,
    email: String,
    comment: String,
) -> CmdResult<bool> {
    let service = state.lock().await;
    service.add_uid(&key_id, &name, &email, &comment).await
}

/// Revoke a UID from a key.
#[tauri::command]
pub async fn gpg_revoke_uid(
    state: State<'_, GpgServiceState>,
    key_id: String,
    uid_index: usize,
    reason: u8,
    description: String,
) -> CmdResult<bool> {
    let service = state.lock().await;
    service
        .revoke_uid(&key_id, uid_index, reason, &description)
        .await
}

/// Add a subkey.
#[tauri::command]
pub async fn gpg_add_subkey(
    state: State<'_, GpgServiceState>,
    key_id: String,
    algorithm: GpgKeyAlgorithm,
    capabilities: Vec<KeyCapability>,
    expiration: Option<String>,
) -> CmdResult<bool> {
    let service = state.lock().await;
    service
        .add_subkey(&key_id, &algorithm, &capabilities, expiration.as_deref())
        .await
}

/// Revoke a subkey.
#[tauri::command]
pub async fn gpg_revoke_subkey(
    state: State<'_, GpgServiceState>,
    key_id: String,
    subkey_index: usize,
    reason: u8,
    description: String,
) -> CmdResult<bool> {
    let service = state.lock().await;
    service
        .revoke_subkey(&key_id, subkey_index, reason, &description)
        .await
}

/// Set key expiration.
#[tauri::command]
pub async fn gpg_set_expiration(
    state: State<'_, GpgServiceState>,
    key_id: String,
    expiration: Option<String>,
) -> CmdResult<bool> {
    let service = state.lock().await;
    service.set_expiration(&key_id, expiration.as_deref()).await
}

/// Generate a revocation certificate.
#[tauri::command]
pub async fn gpg_generate_revocation(
    state: State<'_, GpgServiceState>,
    key_id: String,
    reason: u8,
    description: String,
) -> CmdResult<String> {
    let service = state.lock().await;
    service
        .generate_revocation_cert(&key_id, reason, &description)
        .await
}

// ── Signing / verification commands ─────────────────────────────────

/// Sign data and return the signature.
#[tauri::command]
pub async fn gpg_sign_data(
    state: State<'_, GpgServiceState>,
    key_id: String,
    data_b64: String,
    detached: bool,
    armor: bool,
    hash_algo: Option<String>,
) -> CmdResult<SignatureResult> {
    let data = b64_decode(&data_b64)?;
    let mut service = state.lock().await;
    service
        .sign_data(&key_id, &data, detached, armor, hash_algo.as_deref())
        .await
}

/// Verify a signature against data.
#[tauri::command]
pub async fn gpg_verify_signature(
    state: State<'_, GpgServiceState>,
    data_b64: String,
    signature_b64: Option<String>,
) -> CmdResult<VerificationResult> {
    let data = b64_decode(&data_b64)?;
    let sig = match &signature_b64 {
        Some(s) => Some(b64_decode(s)?),
        None => None,
    };
    let mut service = state.lock().await;
    service.verify_signature(&data, sig.as_deref()).await
}

/// Sign another user's key.
#[tauri::command]
pub async fn gpg_sign_key(
    state: State<'_, GpgServiceState>,
    signer_id: String,
    target_id: String,
    uid_names: Vec<String>,
    local_only: bool,
    trust_level: u8,
    exportable: bool,
) -> CmdResult<bool> {
    let mut service = state.lock().await;
    service
        .sign_key(
            &signer_id,
            &target_id,
            &uid_names,
            local_only,
            trust_level,
            exportable,
        )
        .await
}

// ── Encryption / decryption commands ────────────────────────────────

/// Encrypt data for one or more recipients.
#[tauri::command]
pub async fn gpg_encrypt_data(
    state: State<'_, GpgServiceState>,
    recipients: Vec<String>,
    data_b64: String,
    armor: bool,
    sign: bool,
    signer: Option<String>,
) -> CmdResult<EncryptionResult> {
    let data = b64_decode(&data_b64)?;
    let mut service = state.lock().await;
    service
        .encrypt_data(&recipients, &data, armor, sign, signer.as_deref())
        .await
}

/// Decrypt data.
#[tauri::command]
pub async fn gpg_decrypt_data(
    state: State<'_, GpgServiceState>,
    data_b64: String,
) -> CmdResult<DecryptionResult> {
    let data = b64_decode(&data_b64)?;
    let mut service = state.lock().await;
    service.decrypt_data(&data).await
}

// ── Trust commands ──────────────────────────────────────────────────

/// Set the owner-trust level for a key.
#[tauri::command]
pub async fn gpg_set_owner_trust(
    state: State<'_, GpgServiceState>,
    key_id: String,
    trust: KeyOwnerTrust,
) -> CmdResult<bool> {
    let mut service = state.lock().await;
    service.set_owner_trust(&key_id, trust).await
}

/// Get trust database statistics.
#[tauri::command]
pub async fn gpg_trust_db_stats(state: State<'_, GpgServiceState>) -> CmdResult<TrustDbStats> {
    let service = state.lock().await;
    service.get_trust_db_stats().await
}

/// Update (recalculate) the trust database.
#[tauri::command]
pub async fn gpg_update_trust_db(state: State<'_, GpgServiceState>) -> CmdResult<bool> {
    let service = state.lock().await;
    service.update_trust_db().await
}

// ── Keyserver commands ──────────────────────────────────────────────

/// Search for keys on a keyserver.
#[tauri::command]
pub async fn gpg_search_keyserver(
    state: State<'_, GpgServiceState>,
    query: String,
) -> CmdResult<Vec<KeyServerResult>> {
    let service = state.lock().await;
    service.search_keyserver(&query).await
}

/// Fetch a key from a keyserver by ID.
#[tauri::command]
pub async fn gpg_fetch_from_keyserver(
    state: State<'_, GpgServiceState>,
    key_id: String,
) -> CmdResult<KeyImportResult> {
    let mut service = state.lock().await;
    service.fetch_from_keyserver(&key_id).await
}

/// Send a key to a keyserver.
#[tauri::command]
pub async fn gpg_send_to_keyserver(
    state: State<'_, GpgServiceState>,
    key_id: String,
) -> CmdResult<bool> {
    let mut service = state.lock().await;
    service.send_to_keyserver(&key_id).await
}

/// Refresh all keys from the keyserver.
#[tauri::command]
pub async fn gpg_refresh_keys(state: State<'_, GpgServiceState>) -> CmdResult<KeyImportResult> {
    let service = state.lock().await;
    service.refresh_keys().await
}

// ── Smart-card commands ─────────────────────────────────────────────

/// Get the status of the currently-inserted smart card.
#[tauri::command]
pub async fn gpg_card_status(
    state: State<'_, GpgServiceState>,
) -> CmdResult<Option<SmartCardInfo>> {
    let service = state.lock().await;
    service.get_card_status().await
}

/// List all known smart cards.
#[tauri::command]
pub async fn gpg_list_cards(state: State<'_, GpgServiceState>) -> CmdResult<Vec<SmartCardInfo>> {
    let service = state.lock().await;
    service.list_cards().await
}

/// Change a smart-card PIN.
#[tauri::command]
pub async fn gpg_card_change_pin(
    state: State<'_, GpgServiceState>,
    pin_type: String,
) -> CmdResult<bool> {
    let mut service = state.lock().await;
    service.card_change_pin(&pin_type).await
}

/// Factory-reset the smart card.
#[tauri::command]
pub async fn gpg_card_factory_reset(state: State<'_, GpgServiceState>) -> CmdResult<bool> {
    let mut service = state.lock().await;
    service.card_factory_reset().await
}

/// Set a card attribute (name, url, login, lang, sex).
#[tauri::command]
pub async fn gpg_card_set_attribute(
    state: State<'_, GpgServiceState>,
    attribute: String,
    value: String,
) -> CmdResult<bool> {
    let service = state.lock().await;
    service.card_set_attr(&attribute, &value).await
}

/// Generate a key directly on the smart card.
#[tauri::command]
pub async fn gpg_card_generate_key(
    state: State<'_, GpgServiceState>,
    slot: CardSlot,
    algorithm: GpgKeyAlgorithm,
) -> CmdResult<bool> {
    let mut service = state.lock().await;
    service.card_gen_key(slot, &algorithm).await
}

/// Move an existing subkey to the smart card.
#[tauri::command]
pub async fn gpg_card_move_key(
    state: State<'_, GpgServiceState>,
    key_id: String,
    subkey_index: usize,
    slot: CardSlot,
) -> CmdResult<bool> {
    let service = state.lock().await;
    service.card_move_key(&key_id, subkey_index, slot).await
}

/// Fetch the public key stored on the card and import it.
#[tauri::command]
pub async fn gpg_card_fetch_key(state: State<'_, GpgServiceState>) -> CmdResult<KeyImportResult> {
    let service = state.lock().await;
    service.card_fetch_key().await
}

// ── Audit commands ──────────────────────────────────────────────────

/// Retrieve recent audit log entries.
#[tauri::command]
pub async fn gpg_audit_log(
    state: State<'_, GpgServiceState>,
    limit: usize,
) -> CmdResult<Vec<GpgAuditEntry>> {
    let service = state.lock().await;
    Ok(service.audit_log(limit))
}

/// Export the audit log as JSON.
#[tauri::command]
pub async fn gpg_audit_export(state: State<'_, GpgServiceState>) -> CmdResult<String> {
    let service = state.lock().await;
    service.audit_export()
}

/// Clear the audit log.
#[tauri::command]
pub async fn gpg_audit_clear(state: State<'_, GpgServiceState>) -> CmdResult<()> {
    let mut service = state.lock().await;
    service.audit_clear();
    Ok(())
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    // Commands require tauri State which cannot be constructed in unit tests.
    // Integration testing with tauri::test is done at the app level.

    #[test]
    fn test_cmd_result_type() {
        let ok: super::CmdResult<u32> = Ok(42);
        assert_eq!(ok.unwrap(), 42);
        let err: super::CmdResult<u32> = Err("poison".to_string());
        assert!(err.is_err());
    }
}
