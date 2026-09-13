//! Native managed inner-database control plane. The renderer receives plaintext
//! only for an unlocked database, never DEKs, KEKs, or vault secret material.
use crate::database_files::{managed_commit, managed_snapshot, ManagedSnapshot};
// Shared artifact adapters also compile in app_lib, which intentionally has no
// database_files module. Expose the same guard through the existing public
// protection facade; do not duplicate or weaken its plaintext-vault checks.
#[doc(hidden)]
pub use crate::database_files::reject_plaintext_credential_vault;
#[doc(hidden)]
pub use crate::database_files::reject_unprotected_documents;
use crate::trust_store_commands as trust_reads;
use codec::Zeroizing;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sorng_encryption::{
    database_protection::{
        self as codec, DataCipher, DatabaseEnvelope, DatabaseKey, NewSlotInput, ProtectionTarget,
        SlotInfo, SlotType,
    },
    database_sessions::{self, SessionScope},
    EncryptionState,
};
use std::{
    future::Future,
    path::{Path, PathBuf},
    pin::Pin,
};
use tauri::{Emitter, Manager, Runtime, State, WebviewWindow};

const VAULT_SERVICE: &str = "sortofremoteng.internal.database-protection.v1";

/// Generic runtime form of the same production commands, enabling real IPC
/// decoding/state extraction in temp-profile tests without a native WebView.
pub fn build<R: Runtime>() -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        database_protection_capabilities,
        database_protection_status,
        database_protection_unlock,
        database_protection_lock,
        database_protection_release_session,
        database_protection_save,
        database_protection_load,
        database_protection_change,
        trust_migrate_legacy_database,
        trust_reassign_reviewed_scope,
        trust_reads::trust_get_effective_identity,
        trust_reads::trust_verify_identity,
    ]
}
type VaultFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, String>> + Send + 'a>>;
trait VaultProvider {
    fn available(&self) -> bool;
    fn put<'a>(&'a self, account: &'a str, key: &'a DatabaseKey) -> VaultFuture<'a, ()>;
    fn get<'a>(&'a self, account: &'a str) -> VaultFuture<'a, DatabaseKey>;
}
struct NativeVault;
impl VaultProvider for NativeVault {
    fn available(&self) -> bool {
        sorng_vault::keychain::is_available()
    }
    fn put<'a>(&'a self, account: &'a str, key: &'a DatabaseKey) -> VaultFuture<'a, ()> {
        Box::pin(async move {
            match sorng_vault::keychain::read_bytes_zeroizing(VAULT_SERVICE, account).await {
                Err(error)
                    if matches!(error.kind, sorng_vault::types::VaultErrorKind::NotFound) => {}
                _ => return Err("new database vault slot is not confirmed empty".into()),
            }
            let bytes = key.with_bytes(|bytes| Zeroizing::new(*bytes));
            sorng_vault::keychain::store_bytes(VAULT_SERVICE, account, &bytes[..])
                .await
                .map_err(|_| "could not store database unlock secret")?;
            let verified = self.get(account).await?;
            if !verified.with_bytes(|other| other == &*bytes) {
                return Err("database vault enrollment verification failed".into());
            }
            Ok(())
        })
    }
    fn get<'a>(&'a self, account: &'a str) -> VaultFuture<'a, DatabaseKey> {
        Box::pin(async move {
            let bytes = sorng_vault::keychain::read_bytes_zeroizing(VAULT_SERVICE, account)
                .await
                .map_err(|_| {
                    "database vault unlock secret unavailable; use a portable password slot"
                })?;
            DatabaseKey::from_bytes(&bytes)
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtectionStatus {
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    data_cipher: Option<DataCipher>,
    security_revision: String,
    slots: Vec<SlotInfo>,
    unlocked: bool,
    global_encryption_protected: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_expires_at: Option<u64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlockResult {
    session_id: String,
    session_expires_at: u64,
    security_revision: String,
    data: Value,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeResult {
    committed: bool,
    cleanup_pending: bool,
    warnings: Vec<String>,
    security_revision: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_expires_at: Option<u64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    committed: bool,
    cleanup_pending: bool,
    warnings: Vec<String>,
    security_revision: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LockResult {
    locked: bool,
    notification_pending: bool,
    warnings: Vec<String>,
}
#[derive(Serialize)]
pub struct ReleaseSessionResult {
    released: bool,
}

fn revoke_database_sessions(
    owner: u64,
    profile: &str,
    database_id: &str,
    notify: impl FnOnce() -> Result<(), String>,
) -> Result<LockResult, String> {
    database_sessions::global()
        .lock()
        .map_err(|_| "database session registry unavailable")?
        .revoke_database(owner, profile, database_id);
    // Revocation is authoritative. A later event delivery error cannot turn it
    // into an apparent failed lock and leave the initiating window exposed.
    let notification_pending = notify().is_err();
    Ok(LockResult {
        locked: true,
        notification_pending,
        warnings: if notification_pending {
            vec!["Database locked, but other-window notification failed. Other windows can no longer use their native unlock sessions.".into()]
        } else {
            Vec::new()
        },
    })
}
fn revision(snapshot: &ManagedSnapshot) -> &str {
    snapshot
        .row
        .get("securityRevision")
        .and_then(Value::as_str)
        .unwrap_or("")
}
fn is_managed(snapshot: &ManagedSnapshot) -> bool {
    snapshot.row.get("protectionFormat").is_some() || codec::is_managed(&snapshot.data)
}
fn profile_binding(profile: &Path) -> Result<String, String> {
    let canonical = profile
        .canonicalize()
        .map_err(|_| "database profile directory unavailable")?;
    Ok(format!(
        "{:x}",
        Sha256::digest(canonical.to_string_lossy().as_bytes())
    ))
}
fn native_root<R: Runtime>(
    window: &WebviewWindow<R>,
    state: &EncryptionState,
) -> Result<PathBuf, String> {
    state.artifact_policy_root().map(Ok).unwrap_or_else(|| {
        window
            .app_handle()
            .path()
            .app_data_dir()
            .map_err(|_| "database profile directory unavailable".into())
    })
}
fn scope<'a>(
    profile: &'a str,
    database: &'a str,
    revision: &'a str,
    window: &'a str,
    state: &EncryptionState,
) -> SessionScope<'a> {
    SessionScope {
        owner: state.database_session_owner(),
        profile,
        database,
        revision,
        window,
        generation: state.key_generation(),
    }
}
fn insert_session(scope: &SessionScope<'_>, key: DatabaseKey) -> Result<String, String> {
    database_sessions::global()
        .lock()
        .map_err(|_| "database session registry unavailable")?
        .insert(scope, key)
}
fn session_key(id: &str, scope: &SessionScope<'_>) -> Result<DatabaseKey, String> {
    database_sessions::global()
        .lock()
        .map_err(|_| "database session registry unavailable")?
        .key(id, scope)
}

/// The source remains in its database; only verified connection IDs cross into
/// the trust migration runtime. A managed lease is never exposed to the UI.
#[tauri::command]
pub async fn trust_migrate_legacy_database<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, EncryptionState>,
    database_id: String,
    expected_security_revision: String,
    source_session_id: Option<String>,
    expected_data: Option<Value>,
    connection_ids: Option<Vec<String>>,
) -> Result<sorng_storage::trust_store::TrustLegacyMigrationOutcome, String> {
    let coordinator = sorng_encryption::settings_coordinator::lock().await;
    let root = native_root(&window, &state)?;
    let snapshot = managed_snapshot(&root, &state, &database_id).await?;
    if revision(&snapshot) != expected_security_revision {
        return Err("Database security changed; unlock and review migration again".into());
    }
    let ids = verified_trust_scope_ids(
        &root,
        &state,
        window.label(),
        &database_id,
        &expected_security_revision,
        &snapshot,
        source_session_id.as_deref(),
        expected_data.as_ref(),
        connection_ids.as_deref(),
    )?;
    let profile = profile_binding(&root)?;
    let access_scope = scope(
        &profile,
        &database_id,
        &expected_security_revision,
        window.label(),
        &state,
    );
    sorng_storage::trust_store::runtime()?.migrate_legacy_database_with_coordinator_guard(
        &root,
        &database_id,
        &expected_security_revision,
        &snapshot.data,
        &ids,
        &coordinator,
        || {
            if let Some(session) = source_session_id.as_deref() {
                session_key(session, &access_scope)?;
            }
            Ok(())
        },
    )
}

#[allow(clippy::too_many_arguments)]
fn verified_trust_scope_ids(
    root: &Path,
    state: &EncryptionState,
    window: &str,
    database_id: &str,
    expected_security_revision: &str,
    snapshot: &ManagedSnapshot,
    source_session_id: Option<&str>,
    expected_data: Option<&Value>,
    connection_ids: Option<&[String]>,
) -> Result<Vec<String>, String> {
    if is_managed(snapshot) {
        if expected_data.is_some() || connection_ids.is_some() {
            return Err(
                "Managed trust migration derives scope from its native unlock session".into(),
            );
        }
        let session = source_session_id.ok_or("Unlock this managed database before migration")?;
        let profile = profile_binding(root)?;
        let scope = scope(
            &profile,
            database_id,
            expected_security_revision,
            window,
            state,
        );
        let key = session_key(session, &scope)?;
        let data = DatabaseEnvelope::parse(&snapshot.data, database_id)?.open(&key)?;
        let ids = migration_connection_ids(&data)?;
        session_key(session, &scope)?;
        Ok(ids)
    } else if snapshot.data.is_string() {
        if source_session_id.is_some() || expected_data != Some(&snapshot.data) {
            return Err(
                "Legacy password migration requires its exact verified encrypted source snapshot"
                    .into(),
            );
        }
        Ok(connection_ids
            .ok_or("Unlock and verify the legacy database before migration")?
            .to_vec())
    } else {
        if source_session_id.is_some() || expected_data.is_some() || connection_ids.is_some() {
            return Err("Plain database migration derives its scope natively".into());
        }
        migration_connection_ids(&snapshot.data)
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn trust_reassign_reviewed_scope<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, EncryptionState>,
    database_id: String,
    targets: Vec<sorng_storage::trust_store::ReviewedTrustScopeTarget>,
    target_connection_id: Option<String>,
    expected_security_revision: String,
    source_session_id: Option<String>,
    expected_data: Option<Value>,
    connection_ids: Option<Vec<String>>,
) -> Result<sorng_storage::trust_store::ReviewedTrustOutcome, String> {
    let coordinator = sorng_encryption::settings_coordinator::lock().await;
    let root = native_root(&window, &state)?;
    let snapshot = managed_snapshot(&root, &state, &database_id).await?;
    if revision(&snapshot) != expected_security_revision {
        return Err("Database security changed; review trust scope again".into());
    }
    let ids = verified_trust_scope_ids(
        &root,
        &state,
        window.label(),
        &database_id,
        &expected_security_revision,
        &snapshot,
        source_session_id.as_deref(),
        expected_data.as_ref(),
        connection_ids.as_deref(),
    )?;
    let profile = profile_binding(&root)?;
    let access = scope(
        &profile,
        &database_id,
        &expected_security_revision,
        window.label(),
        &state,
    );
    sorng_storage::trust_store::runtime()?.reassign_scope_with_coordinator_guard(
        &root,
        &database_id,
        &expected_security_revision,
        &snapshot.data,
        &ids,
        targets,
        target_connection_id.as_deref(),
        &coordinator,
        || {
            if let Some(session) = source_session_id.as_deref() {
                session_key(session, &access)?;
            }
            Ok(())
        },
    )
}

fn migration_connection_ids(data: &Value) -> Result<Vec<String>, String> {
    let connections = data
        .get("connections")
        .and_then(Value::as_array)
        .ok_or("Verified database connections are malformed")?;
    if connections.len() > 10_000 {
        return Err("Too many database connections for bounded trust migration".into());
    }
    connections
        .iter()
        .map(|connection| {
            connection
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .ok_or_else(|| "A connection ID is missing from the verified database".into())
        })
        .collect()
}

#[tauri::command]
pub fn database_protection_capabilities() -> Value {
    json!({"schemaVersion":1,"ciphers":[
        {"id":"aes-256-gcm","available":true}, {"id":"chacha20-poly1305","available":true},
        {"id":"twofish-256-eax","available":true,"reason":"Advanced software-only alternative; not VeraCrypt compatible. AES/ChaCha are recommended. No independent audit, constant-time, or complete-zeroization guarantee."},
        {"id":"serpent-256-eax","available":true,"reason":"Advanced software-only alternative; not VeraCrypt compatible. AES/ChaCha are recommended. No independent audit, constant-time, or complete-zeroization guarantee."}
    ],"protectors":[
        {"id":"password","available":true,"deviceBound":false,"requiresUserPresence":false},
        {"id":"os-vault","available":NativeVault.available(),"deviceBound":true,"requiresUserPresence":false,"reason":"OS-account secret storage; not biometric or hardware-presence enforcement"},
        {"id":"webauthn-prf","available":false,"deviceBound":false,"requiresUserPresence":true,"reason":"A verified WebAuthn PRF/hmac-secret key provider is not implemented"},
        {"id":"biometric","available":false,"deviceBound":true,"requiresUserPresence":true,"reason":"A verified OS access-controlled key-release provider is not implemented; biometric hashes are not encryption secrets"}
    ]})
}

#[tauri::command]
pub async fn database_protection_status<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, EncryptionState>,
    database_id: String,
) -> Result<ProtectionStatus, String> {
    let _guard = sorng_encryption::settings_coordinator::lock().await;
    let root = native_root(&window, &state)?;
    status_inner(&root, &state, window.label(), &database_id).await
}
async fn status_inner(
    root: &Path,
    state: &EncryptionState,
    window: &str,
    id: &str,
) -> Result<ProtectionStatus, String> {
    let snapshot = managed_snapshot(root, state, id).await?;
    let profile = profile_binding(root)?;
    let revision = revision(&snapshot).to_owned();
    let global_encryption_protected =
        crate::database_files::globally_protected_database(root, state, id).await?;
    if is_managed(&snapshot) {
        let envelope = DatabaseEnvelope::parse(&snapshot.data, id)?;
        let session_expires_at = database_sessions::global()
            .lock()
            .map_err(|_| "database session registry unavailable")?
            .expires_at(&scope(&profile, id, &revision, window, state));
        Ok(ProtectionStatus {
            kind: "managed",
            version: Some(codec::VERSION),
            data_cipher: Some(envelope.data_cipher),
            security_revision: revision,
            slots: envelope.slots.iter().map(|s| s.info()).collect(),
            unlocked: session_expires_at.is_some(),
            global_encryption_protected,
            session_expires_at,
        })
    } else {
        Ok(ProtectionStatus {
            kind: if snapshot.data.is_string() {
                "legacy-password"
            } else {
                "none"
            },
            version: None,
            data_cipher: None,
            security_revision: revision,
            slots: vec![],
            unlocked: !snapshot.data.is_string(),
            global_encryption_protected,
            session_expires_at: None,
        })
    }
}

#[tauri::command]
pub async fn database_protection_unlock<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, EncryptionState>,
    database_id: String,
    slot_id: String,
    password: Option<String>,
) -> Result<UnlockResult, String> {
    let password = password.map(Zeroizing::new);
    let _guard = sorng_encryption::settings_coordinator::lock().await;
    let root = native_root(&window, &state)?;
    unlock_inner(
        &root,
        &state,
        window.label(),
        &database_id,
        &slot_id,
        password,
        &NativeVault,
    )
    .await
}
async fn unlock_inner(
    root: &Path,
    state: &EncryptionState,
    window: &str,
    id: &str,
    slot_id: &str,
    password: Option<Zeroizing<String>>,
    vault: &(impl VaultProvider + Sync),
) -> Result<UnlockResult, String> {
    let snapshot = managed_snapshot(root, state, id).await?;
    let security_revision = revision(&snapshot).to_owned();
    let profile = profile_binding(root)?;
    let envelope = DatabaseEnvelope::parse(&snapshot.data, id)?;
    let slot = envelope.slot(slot_id)?;
    let key = match slot.slot_type {
        SlotType::Password => {
            let password = password.ok_or("password required for selected slot")?;
            let owned = envelope.clone();
            let slot_id = slot_id.to_owned();
            tokio::task::spawn_blocking(move || owned.unlock_password(&slot_id, &password))
                .await
                .map_err(|_| "database unlock task failed")??
        }
        SlotType::OsVault => {
            if password.is_some() {
                return Err("password supplied for vault slot".into());
            }
            let account = codec::vault_account(&profile, id, &envelope.key_id, slot_id)?;
            let kek = vault.get(&account).await?;
            envelope.unlock_vault(slot_id, &profile, &kek)?
        }
    };
    let data = envelope.open(&key)?;
    // Check persisted identity again even though production holds the shared
    // barrier: this also fences direct callers and delayed authentication.
    let current = managed_snapshot(root, state, id).await?;
    if current.data != snapshot.data || revision(&current) != security_revision {
        return Err("database changed during unlock; retry".into());
    }
    let session_id = insert_session(&scope(&profile, id, &security_revision, window, state), key)?;
    let session_expires_at = database_sessions::global()
        .lock()
        .map_err(|_| "database session registry unavailable")?
        .expires_at(&scope(&profile, id, &security_revision, window, state))
        .ok_or("database session expired")?;
    Ok(UnlockResult {
        session_id,
        session_expires_at,
        security_revision,
        data,
    })
}

#[tauri::command]
pub async fn database_protection_lock<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, EncryptionState>,
    database_id: String,
) -> Result<LockResult, String> {
    let _guard = sorng_encryption::settings_coordinator::lock().await;
    sorng_storage::database_transaction::validate_database_id(&database_id)?;
    let profile = profile_binding(&native_root(&window, &state)?)?;
    revoke_database_sessions(
        state.database_session_owner(),
        &profile,
        &database_id,
        || {
            window
                .app_handle()
                .emit(
                    "database-protection:locked",
                    json!({"databaseId":database_id}),
                )
                .map_err(|_| "database locked, but other-window notification failed".into())
        },
    )
}

/// Cleanup for an abandoned unlock attempt, not a database-wide lock.
#[tauri::command]
pub async fn database_protection_release_session<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, EncryptionState>,
    database_id: String,
    session_id: String,
) -> Result<ReleaseSessionResult, String> {
    let _guard = sorng_encryption::settings_coordinator::lock().await;
    sorng_storage::database_transaction::validate_database_id(&database_id)?;
    if session_id.is_empty()
        || session_id.len() > 128
        || !session_id.is_ascii()
        || session_id.bytes().any(|byte| byte.is_ascii_control())
    {
        return Err("invalid database unlock session token".into());
    }
    let profile = profile_binding(&native_root(&window, &state)?)?;
    let released = database_sessions::global()
        .lock()
        .map_err(|_| "database session registry unavailable")?
        .release(
            &session_id,
            state.database_session_owner(),
            &profile,
            &database_id,
            window.label(),
        )?;
    Ok(ReleaseSessionResult { released })
}

#[tauri::command]
pub async fn database_protection_save<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, EncryptionState>,
    database_id: String,
    session_id: String,
    expected_security_revision: String,
    data: Value,
    expected_data: Option<Value>,
) -> Result<SaveResult, String> {
    let _guard = sorng_encryption::settings_coordinator::lock().await;
    let root = native_root(&window, &state)?;
    save_inner(
        &root,
        &state,
        window.label(),
        &database_id,
        &session_id,
        &expected_security_revision,
        data,
        expected_data,
    )
    .await
}

#[tauri::command]
pub async fn database_protection_load<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, EncryptionState>,
    database_id: String,
    session_id: String,
    expected_security_revision: String,
) -> Result<UnlockResult, String> {
    let _guard = sorng_encryption::settings_coordinator::lock().await;
    let root = native_root(&window, &state)?;
    let snapshot = managed_snapshot(&root, &state, &database_id).await?;
    if revision(&snapshot) != expected_security_revision {
        return Err("database security changed; unlock again".into());
    }
    let profile = profile_binding(&root)?;
    let current_scope = scope(
        &profile,
        &database_id,
        &expected_security_revision,
        window.label(),
        &state,
    );
    let key = session_key(&session_id, &current_scope)?;
    let data = DatabaseEnvelope::parse(&snapshot.data, &database_id)?.open(&key)?;
    // Do not release plaintext from an expired lease after a lengthy decrypt.
    session_key(&session_id, &current_scope)?;
    let session_expires_at = database_sessions::global()
        .lock()
        .map_err(|_| "database session registry unavailable")?
        .expires_at(&current_scope)
        .ok_or("database session expired")?;
    Ok(UnlockResult {
        session_id,
        security_revision: expected_security_revision,
        data,
        session_expires_at,
    })
}
#[allow(clippy::too_many_arguments)] // Window/session/security/content boundaries are independent.
async fn save_inner(
    root: &Path,
    state: &EncryptionState,
    window: &str,
    id: &str,
    session: &str,
    expected_revision: &str,
    data: Value,
    expected_data: Option<Value>,
) -> Result<SaveResult, String> {
    let snapshot = managed_snapshot(root, state, id).await?;
    if revision(&snapshot) != expected_revision {
        return Err("database security changed; unlock again".into());
    }
    let profile = profile_binding(root)?;
    let key = session_key(
        session,
        &scope(&profile, id, expected_revision, window, state),
    )?;
    let mut envelope = DatabaseEnvelope::parse(&snapshot.data, id)?;
    let current = envelope.open(&key)?;
    crate::database_files::assert_database_content_matches(Some(&current), expected_data.as_ref())?;
    envelope.replace_data(&data, &key)?;
    session_key(
        session,
        &scope(&profile, id, expected_revision, window, state),
    )?;
    let outcome = managed_commit(
        root,
        state,
        id,
        expected_revision,
        &snapshot.data,
        &envelope.value()?,
        expected_revision,
    )
    .await?;
    Ok(SaveResult {
        committed: outcome.committed,
        cleanup_pending: outcome.cleanup_pending,
        warnings: outcome.warnings,
        security_revision: expected_revision.into(),
    })
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn database_protection_change<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, EncryptionState>,
    database_id: String,
    expected_security_revision: String,
    expected_data: Value,
    source_session_id: Option<String>,
    legacy_verified_data: Option<Value>,
    target: Option<ProtectionTarget>,
    confirm_remove_protection: Option<bool>,
    confirm_device_bound_only: Option<bool>,
    initialize_empty_destination: Option<bool>,
) -> Result<ChangeResult, String> {
    let _guard = sorng_encryption::settings_coordinator::lock().await;
    let root = native_root(&window, &state)?;
    change_inner_with_initialization(
        &root,
        &state,
        window.label(),
        &database_id,
        &expected_security_revision,
        expected_data,
        source_session_id,
        legacy_verified_data,
        target,
        confirm_remove_protection == Some(true),
        confirm_device_bound_only == Some(true),
        initialize_empty_destination == Some(true),
        &NativeVault,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn change_inner_with_initialization(
    root: &Path,
    state: &EncryptionState,
    window: &str,
    id: &str,
    expected_revision: &str,
    expected_data: Value,
    source_session: Option<String>,
    legacy_verified_data: Option<Value>,
    target: Option<ProtectionTarget>,
    confirm_remove: bool,
    confirm_device_only: bool,
    initialize_empty_destination: bool,
    vault: &(impl VaultProvider + Sync),
) -> Result<ChangeResult, String> {
    let snapshot = managed_snapshot(root, state, id).await?;
    if let Some(target) = &target {
        if target
            .new_slots
            .iter()
            .any(|slot| matches!(slot, NewSlotInput::Password { .. }))
        {
            let policy = sorng_encryption::password_policy::read_locked(root, state).await?;
            for slot in &target.new_slots {
                if let NewSlotInput::Password { password, .. } = slot {
                    sorng_encryption::password_policy::validate(password, &policy, "database")?;
                }
            }
        }
    }
    if revision(&snapshot) != expected_revision || snapshot.data != expected_data {
        return Err(
            "database security or contents changed; reload before changing protection".into(),
        );
    }
    let profile = profile_binding(root)?;
    let old = if is_managed(&snapshot) {
        Some(DatabaseEnvelope::parse(&snapshot.data, id)?)
    } else {
        None
    };
    if initialize_empty_destination {
        // Match the actual empty DatabaseManager initialization shape exactly.
        // Other fields (including nonempty settings) may contain data and must
        // not be silently replaced by an import/clone initialization request.
        let empty = snapshot
            .data
            .get("timestamp")
            .and_then(Value::as_u64)
            .is_some()
            && snapshot.data
                == json!({"connections":[],"settings":{},"timestamp":snapshot.data["timestamp"]});
        if old.is_some() || target.is_none() || snapshot.row["isEncrypted"] != false || !empty {
            return Err("protected initialization requires an exact empty unprotected destination and a managed target".into());
        }
    }
    let (mut key, mut key_id, data) = if let Some(old) = &old {
        if legacy_verified_data.is_some() {
            return Err("managed data must be decrypted natively".into());
        }
        let key = session_key(
            source_session
                .as_deref()
                .ok_or("unlock managed database first")?,
            &scope(&profile, id, expected_revision, window, state),
        )?;
        let data = old.open(&key)?;
        (key, old.key_id.clone(), data)
    } else {
        if source_session.is_some() {
            return Err("legacy database cannot reuse a managed session".into());
        }
        let data = legacy_verified_data.ok_or("verified legacy database snapshot required")?;
        codec::validate_data(&data)?;
        if snapshot.data.is_object() && snapshot.data != data && !initialize_empty_destination {
            return Err("plaintext legacy snapshot differs from stored data".into());
        }
        (DatabaseKey::generate(), codec::random_id(), data)
    };
    let managed = target.is_some();
    if !managed {
        crate::database_files::require_document_protection(state, None, &data).await?;
        crate::database_files::require_credential_vault_protection(state, None, &data).await?;
    }
    let new_revision = codec::random_id();
    let output = if let Some(target) = target {
        if let Some(old) = &old {
            let retained: std::collections::BTreeSet<_> = target.keep_slot_ids.iter().collect();
            let removes_old = old.slots.iter().any(|slot| !retained.contains(&slot.id));
            if removes_old {
                if !target.keep_slot_ids.is_empty() {
                    return Err("Removing or replacing an unlock slot requires re-enrolling all desired protectors; old slots cannot be retained with the new database key".into());
                }
                key = DatabaseKey::generate();
                key_id = codec::random_id();
            }
        }
        if target.keep_slot_ids.len() + target.new_slots.len() > codec::MAX_SLOTS {
            return Err("at most eight database unlock slots are supported".into());
        }
        let mut slots = Vec::new();
        let mut seen = std::collections::BTreeSet::new();
        for id in target.keep_slot_ids {
            if !seen.insert(id.clone()) {
                return Err("duplicate retained slot".into());
            }
            slots.push(
                old.as_ref()
                    .ok_or("legacy database has no slots to retain")?
                    .slot(&id)?
                    .clone(),
            );
        }
        let password_present = slots.iter().any(|s| s.slot_type == SlotType::Password)
            || target
                .new_slots
                .iter()
                .any(|s| matches!(s, NewSlotInput::Password { .. }));
        if !password_present && !confirm_device_only {
            return Err("explicit confirmation required for device-bound-only database protection; no portable recovery password exists".into());
        }
        if slots.is_empty() && target.new_slots.is_empty() {
            return Err("at least one verified unlock slot is required".into());
        }
        for input in target.new_slots {
            match &input {
                NewSlotInput::Password {
                    label,
                    password,
                    argon2,
                } => {
                    // Argon2's memory/CPU work must not block async runtime workers.
                    let db = id.to_owned();
                    let key_id = key_id.clone();
                    let key = key.duplicate();
                    let label = label.clone();
                    let password = Zeroizing::new(password.clone());
                    let params = *argon2;
                    slots.push(
                        tokio::task::spawn_blocking(move || {
                            codec::new_password_slot(&db, &key_id, &label, &password, params, &key)
                        })
                        .await
                        .map_err(|_| "database slot creation task failed")??,
                    );
                }
                NewSlotInput::OsVault { label } => {
                    if !vault.available() {
                        return Err("OS vault unavailable; choose password protection".into());
                    }
                    let slot_id = codec::random_id();
                    let kek = DatabaseKey::generate();
                    let slot = codec::new_vault_slot(
                        id,
                        &key_id,
                        slot_id.clone(),
                        &profile,
                        label,
                        &kek,
                        &key,
                    )?;
                    let account = codec::vault_account(&profile, id, &key_id, &slot_id)?;
                    vault.put(&account, &kek).await?;
                    // Never delete a prior key on failed commit; a new orphan
                    // secret has no published ciphertext and is safer to retain.
                    slots.push(slot);
                }
            }
        }
        DatabaseEnvelope::create(
            id,
            &key_id,
            &new_revision,
            target.data_cipher,
            slots,
            &data,
            &key,
        )?
        .value()?
    } else {
        if !confirm_remove {
            return Err("explicit plaintext confirmation required".into());
        }
        data
    };
    if old.is_some() {
        session_key(
            source_session.as_deref().unwrap(),
            &scope(&profile, id, expected_revision, window, state),
        )?;
    }
    let outcome = managed_commit(
        root,
        state,
        id,
        expected_revision,
        &expected_data,
        &output,
        &new_revision,
    )
    .await?;
    let mut warnings = outcome.warnings;
    let (session_id, session_expires_at) = match database_sessions::global().lock() {
        Ok(mut registry) => {
            registry.revoke_database(state.database_session_owner(), &profile, id);
            let session_id = if managed {
                match registry.insert(&scope(&profile, id, &new_revision, window, state), key) {
                    Ok(id) => Some(id),
                    Err(_) => {
                        warnings.push(
                            "Protection committed; unlock again to obtain a fresh session".into(),
                        );
                        None
                    }
                }
            } else {
                None
            };
            let expires = registry.expires_at(&scope(&profile, id, &new_revision, window, state));
            (session_id, expires)
        }
        Err(_) => {
            warnings.push(
                "Protection committed; native session registry unavailable; restart and unlock"
                    .into(),
            );
            (None, None)
        }
    };
    Ok(ChangeResult {
        committed: outcome.committed,
        cleanup_pending: outcome.cleanup_pending,
        warnings,
        security_revision: new_revision,
        session_id,
        session_expires_at,
    })
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
async fn change_inner(
    root: &Path,
    state: &EncryptionState,
    window: &str,
    id: &str,
    expected_revision: &str,
    expected_data: Value,
    source_session: Option<String>,
    legacy_verified_data: Option<Value>,
    target: Option<ProtectionTarget>,
    confirm_remove: bool,
    confirm_device_only: bool,
    vault: &(impl VaultProvider + Sync),
) -> Result<ChangeResult, String> {
    change_inner_with_initialization(
        root,
        state,
        window,
        id,
        expected_revision,
        expected_data,
        source_session,
        legacy_verified_data,
        target,
        confirm_remove,
        confirm_device_only,
        false,
        vault,
    )
    .await
}

#[cfg(test)]
#[path = "database_protection_tests.rs"]
mod tests;
