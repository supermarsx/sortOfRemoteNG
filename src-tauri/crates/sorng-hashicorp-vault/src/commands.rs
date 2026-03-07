// ── sorng-hashicorp-vault/src/commands.rs ─────────────────────────────────────
//! Tauri commands – thin wrappers around `VaultService`.

use tauri::State;
use crate::service::VaultServiceState;
use crate::types::*;
use serde_json::Value;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String { e.to_string() }

// ── Connection ────────────────────────────────────────────────────

#[tauri::command]
pub async fn vault_connect(
    state: State<'_, VaultServiceState>,
    id: String,
    config: VaultConnectionConfig,
) -> CmdResult<VaultConnectionSummary> {
    state.lock().await.connect(id, config).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_disconnect(
    state: State<'_, VaultServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.disconnect(&id).map_err(map_err)
}

#[tauri::command]
pub async fn vault_list_connections(
    state: State<'_, VaultServiceState>,
) -> CmdResult<Vec<String>> {
    Ok(state.lock().await.list_connections())
}

#[tauri::command]
pub async fn vault_get_dashboard(
    state: State<'_, VaultServiceState>,
    id: String,
) -> CmdResult<VaultDashboard> {
    state.lock().await.get_dashboard(&id).await.map_err(map_err)
}

// ── Sys ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn vault_seal_status(
    state: State<'_, VaultServiceState>,
    id: String,
) -> CmdResult<VaultSealStatus> {
    state.lock().await.seal_status(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_seal(
    state: State<'_, VaultServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.seal(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_unseal(
    state: State<'_, VaultServiceState>,
    id: String,
    key: String,
    reset: bool,
    migrate: bool,
) -> CmdResult<VaultSealStatus> {
    state.lock().await.unseal(&id, &key, reset, migrate).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_health(
    state: State<'_, VaultServiceState>,
    id: String,
) -> CmdResult<VaultHealthResponse> {
    state.lock().await.health(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_leader(
    state: State<'_, VaultServiceState>,
    id: String,
) -> CmdResult<VaultLeader> {
    state.lock().await.leader(&id).await.map_err(map_err)
}

// ── KV ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn vault_kv_read(
    state: State<'_, VaultServiceState>,
    id: String,
    mount: String,
    path: String,
) -> CmdResult<VaultKvEntry> {
    state.lock().await.kv_read(&id, &mount, &path).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_kv_write(
    state: State<'_, VaultServiceState>,
    id: String,
    mount: String,
    path: String,
    data: Value,
) -> CmdResult<Value> {
    state.lock().await.kv_write(&id, &mount, &path, data).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_kv_delete(
    state: State<'_, VaultServiceState>,
    id: String,
    mount: String,
    path: String,
) -> CmdResult<()> {
    state.lock().await.kv_delete(&id, &mount, &path).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_kv_list(
    state: State<'_, VaultServiceState>,
    id: String,
    mount: String,
    path: String,
) -> CmdResult<Vec<String>> {
    state.lock().await.kv_list(&id, &mount, &path).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_kv_undelete(
    state: State<'_, VaultServiceState>,
    id: String,
    mount: String,
    path: String,
    versions: Vec<u64>,
) -> CmdResult<()> {
    state.lock().await.kv_undelete(&id, &mount, &path, versions).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_kv_destroy(
    state: State<'_, VaultServiceState>,
    id: String,
    mount: String,
    path: String,
    versions: Vec<u64>,
) -> CmdResult<()> {
    state.lock().await.kv_destroy(&id, &mount, &path, versions).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_kv_metadata(
    state: State<'_, VaultServiceState>,
    id: String,
    mount: String,
    path: String,
) -> CmdResult<VaultKvMetadata> {
    state.lock().await.kv_metadata(&id, &mount, &path).await.map_err(map_err)
}

// ── Transit ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn vault_transit_create_key(
    state: State<'_, VaultServiceState>,
    id: String,
    name: String,
    key_type: Option<String>,
) -> CmdResult<()> {
    state.lock().await.transit_create_key(&id, &name, key_type.as_deref()).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_transit_list_keys(
    state: State<'_, VaultServiceState>,
    id: String,
) -> CmdResult<Vec<String>> {
    state.lock().await.transit_list_keys(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_transit_read_key(
    state: State<'_, VaultServiceState>,
    id: String,
    name: String,
) -> CmdResult<VaultTransitKey> {
    state.lock().await.transit_read_key(&id, &name).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_transit_encrypt(
    state: State<'_, VaultServiceState>,
    id: String,
    name: String,
    plaintext: String,
    context: Option<String>,
) -> CmdResult<VaultEncryptResponse> {
    state.lock().await.transit_encrypt(&id, &name, &plaintext, context.as_deref()).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_transit_decrypt(
    state: State<'_, VaultServiceState>,
    id: String,
    name: String,
    ciphertext: String,
    context: Option<String>,
) -> CmdResult<VaultDecryptResponse> {
    state.lock().await.transit_decrypt(&id, &name, &ciphertext, context.as_deref()).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_transit_rotate_key(
    state: State<'_, VaultServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state.lock().await.transit_rotate_key(&id, &name).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_transit_sign(
    state: State<'_, VaultServiceState>,
    id: String,
    name: String,
    input: String,
) -> CmdResult<Value> {
    state.lock().await.transit_sign(&id, &name, &input).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_transit_verify(
    state: State<'_, VaultServiceState>,
    id: String,
    name: String,
    input: String,
    signature: String,
) -> CmdResult<Value> {
    state.lock().await.transit_verify(&id, &name, &input, &signature).await.map_err(map_err)
}

// ── PKI ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn vault_pki_read_ca(
    state: State<'_, VaultServiceState>,
    id: String,
    mount: String,
) -> CmdResult<VaultCaInfo> {
    state.lock().await.pki_read_ca(&id, &mount).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_pki_issue_cert(
    state: State<'_, VaultServiceState>,
    id: String,
    mount: String,
    role: String,
    params: VaultPkiIssueCert,
) -> CmdResult<VaultCertificate> {
    state.lock().await.pki_issue_cert(&id, &mount, &role, &params).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_pki_list_certs(
    state: State<'_, VaultServiceState>,
    id: String,
    mount: String,
) -> CmdResult<Vec<String>> {
    state.lock().await.pki_list_certs(&id, &mount).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_pki_revoke_cert(
    state: State<'_, VaultServiceState>,
    id: String,
    mount: String,
    serial: String,
) -> CmdResult<Value> {
    state.lock().await.pki_revoke_cert(&id, &mount, &serial).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_pki_list_roles(
    state: State<'_, VaultServiceState>,
    id: String,
    mount: String,
) -> CmdResult<Vec<String>> {
    state.lock().await.pki_list_roles(&id, &mount).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_pki_create_role(
    state: State<'_, VaultServiceState>,
    id: String,
    mount: String,
    name: String,
    config: Value,
) -> CmdResult<Value> {
    state.lock().await.pki_create_role(&id, &mount, &name, &config).await.map_err(map_err)
}

// ── Auth Methods ──────────────────────────────────────────────────

#[tauri::command]
pub async fn vault_list_auth_methods(
    state: State<'_, VaultServiceState>,
    id: String,
) -> CmdResult<Vec<VaultAuthMount>> {
    state.lock().await.list_auth_methods(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_enable_auth(
    state: State<'_, VaultServiceState>,
    id: String,
    path: String,
    auth_type: String,
    config: Option<Value>,
) -> CmdResult<()> {
    state.lock().await.enable_auth(&id, &path, &auth_type, config.as_ref()).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_disable_auth(
    state: State<'_, VaultServiceState>,
    id: String,
    path: String,
) -> CmdResult<()> {
    state.lock().await.disable_auth(&id, &path).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_userpass_create(
    state: State<'_, VaultServiceState>,
    id: String,
    mount: String,
    username: String,
    password: String,
    policies: Vec<String>,
) -> CmdResult<()> {
    state.lock().await.userpass_create(&id, &mount, &username, &password, &policies).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_userpass_list(
    state: State<'_, VaultServiceState>,
    id: String,
    mount: String,
) -> CmdResult<Vec<String>> {
    state.lock().await.userpass_list(&id, &mount).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_userpass_delete(
    state: State<'_, VaultServiceState>,
    id: String,
    mount: String,
    username: String,
) -> CmdResult<()> {
    state.lock().await.userpass_delete(&id, &mount, &username).await.map_err(map_err)
}

// ── Policies ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn vault_list_policies(
    state: State<'_, VaultServiceState>,
    id: String,
) -> CmdResult<Vec<String>> {
    state.lock().await.list_policies(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_read_policy(
    state: State<'_, VaultServiceState>,
    id: String,
    name: String,
) -> CmdResult<VaultPolicy> {
    state.lock().await.read_policy(&id, &name).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_write_policy(
    state: State<'_, VaultServiceState>,
    id: String,
    name: String,
    policy_text: String,
) -> CmdResult<()> {
    state.lock().await.write_policy(&id, &name, &policy_text).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_delete_policy(
    state: State<'_, VaultServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state.lock().await.delete_policy(&id, &name).await.map_err(map_err)
}

// ── Audit ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn vault_list_audit_devices(
    state: State<'_, VaultServiceState>,
    id: String,
) -> CmdResult<Vec<VaultAuditDevice>> {
    state.lock().await.list_audit_devices(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_enable_audit(
    state: State<'_, VaultServiceState>,
    id: String,
    path: String,
    audit_type: String,
    options: Value,
) -> CmdResult<()> {
    state.lock().await.enable_audit(&id, &path, &audit_type, &options).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_disable_audit(
    state: State<'_, VaultServiceState>,
    id: String,
    path: String,
) -> CmdResult<()> {
    state.lock().await.disable_audit(&id, &path).await.map_err(map_err)
}

// ── Tokens ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn vault_create_token(
    state: State<'_, VaultServiceState>,
    id: String,
    request: VaultTokenCreateRequest,
) -> CmdResult<VaultTokenInfo> {
    state.lock().await.create_token(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_lookup_token(
    state: State<'_, VaultServiceState>,
    id: String,
    token: String,
) -> CmdResult<VaultTokenInfo> {
    state.lock().await.lookup_token(&id, &token).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_revoke_token(
    state: State<'_, VaultServiceState>,
    id: String,
    token: String,
) -> CmdResult<()> {
    state.lock().await.revoke_token(&id, &token).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_renew_token(
    state: State<'_, VaultServiceState>,
    id: String,
    token: String,
    increment: Option<String>,
) -> CmdResult<Value> {
    state.lock().await.renew_token(&id, &token, increment.as_deref()).await.map_err(map_err)
}

// ── Leases ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn vault_read_lease(
    state: State<'_, VaultServiceState>,
    id: String,
    lease_id: String,
) -> CmdResult<Value> {
    state.lock().await.read_lease(&id, &lease_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_list_leases(
    state: State<'_, VaultServiceState>,
    id: String,
    prefix: String,
) -> CmdResult<Vec<String>> {
    state.lock().await.list_leases(&id, &prefix).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_renew_lease(
    state: State<'_, VaultServiceState>,
    id: String,
    lease_id: String,
    increment: Option<String>,
) -> CmdResult<Value> {
    state.lock().await.renew_lease(&id, &lease_id, increment.as_deref()).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_revoke_lease(
    state: State<'_, VaultServiceState>,
    id: String,
    lease_id: String,
) -> CmdResult<()> {
    state.lock().await.revoke_lease(&id, &lease_id).await.map_err(map_err)
}

// ── Secret Engines ────────────────────────────────────────────────

#[tauri::command]
pub async fn vault_list_secret_engines(
    state: State<'_, VaultServiceState>,
    id: String,
) -> CmdResult<Vec<VaultSecretEngine>> {
    state.lock().await.list_secret_engines(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_mount_engine(
    state: State<'_, VaultServiceState>,
    id: String,
    path: String,
    engine_type: String,
    config: Option<Value>,
) -> CmdResult<()> {
    state.lock().await.mount_secret_engine(&id, &path, &engine_type, config.as_ref()).await.map_err(map_err)
}

#[tauri::command]
pub async fn vault_unmount_engine(
    state: State<'_, VaultServiceState>,
    id: String,
    path: String,
) -> CmdResult<()> {
    state.lock().await.unmount_secret_engine(&id, &path).await.map_err(map_err)
}
