//! Tauri commands for the Bitwarden integration.
//!
//! Each function is a `#[tauri::command]` that can be invoked
//! from the frontend via `invoke("bw_command_name", { ... })`.

use crate::bitwarden::service::BitwardenServiceState;
use crate::bitwarden::sync::SyncResult;
use crate::bitwarden::types::*;

// ── Status & CLI ────────────────────────────────────────────────────

/// Check if the Bitwarden CLI is available and return its version.
#[tauri::command]
pub async fn bw_check_cli(
    state: tauri::State<'_, BitwardenServiceState>,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.check_cli().await.map_err(|e| e.message)
}

/// Get the vault status.
#[tauri::command]
pub async fn bw_status(
    state: tauri::State<'_, BitwardenServiceState>,
) -> Result<StatusInfo, String> {
    let mut svc = state.lock().await;
    svc.status().await.map_err(|e| e.message)
}

/// Get the vault lock status.
#[tauri::command]
pub async fn bw_vault_status(
    state: tauri::State<'_, BitwardenServiceState>,
) -> Result<String, String> {
    let svc = state.lock().await;
    Ok(svc.vault_status().to_string())
}

/// Get the current session info.
#[tauri::command]
pub async fn bw_session_info(
    state: tauri::State<'_, BitwardenServiceState>,
) -> Result<SessionState, String> {
    let svc = state.lock().await;
    Ok(svc.session().clone())
}

// ── Configuration ───────────────────────────────────────────────────

/// Get the current Bitwarden config.
#[tauri::command]
pub async fn bw_get_config(
    state: tauri::State<'_, BitwardenServiceState>,
) -> Result<BitwardenConfig, String> {
    let svc = state.lock().await;
    Ok(svc.config().clone())
}

/// Update the Bitwarden config.
#[tauri::command]
pub async fn bw_set_config(
    state: tauri::State<'_, BitwardenServiceState>,
    config: BitwardenConfig,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.set_config(config);
    Ok(())
}

/// Configure the server URL.
#[tauri::command]
pub async fn bw_config_server(
    state: tauri::State<'_, BitwardenServiceState>,
    url: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.config_server(&url).await.map_err(|e| e.message)
}

// ── Authentication ──────────────────────────────────────────────────

/// Login with email and password.
#[tauri::command]
pub async fn bw_login(
    state: tauri::State<'_, BitwardenServiceState>,
    email: String,
    password: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.login(&email, &password).await.map_err(|e| e.message)
}

/// Login with email, password, and 2FA code.
#[tauri::command]
pub async fn bw_login_2fa(
    state: tauri::State<'_, BitwardenServiceState>,
    email: String,
    password: String,
    code: String,
    method: u8,
) -> Result<(), String> {
    let two_factor = TwoFactorMethod::from_u8(method)
        .ok_or_else(|| format!("Invalid 2FA method: {}", method))?;
    let mut svc = state.lock().await;
    svc.login_2fa(&email, &password, &code, two_factor)
        .await
        .map_err(|e| e.message)
}

/// Login with API key.
#[tauri::command]
pub async fn bw_login_api_key(
    state: tauri::State<'_, BitwardenServiceState>,
    client_id: String,
    client_secret: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.login_api_key(&client_id, &client_secret)
        .await
        .map_err(|e| e.message)
}

/// Unlock the vault.
#[tauri::command]
pub async fn bw_unlock(
    state: tauri::State<'_, BitwardenServiceState>,
    password: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.unlock(&password).await.map_err(|e| e.message)
}

/// Lock the vault.
#[tauri::command]
pub async fn bw_lock(
    state: tauri::State<'_, BitwardenServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.lock().await.map_err(|e| e.message)
}

/// Logout.
#[tauri::command]
pub async fn bw_logout(
    state: tauri::State<'_, BitwardenServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.logout().await.map_err(|e| e.message)
}

// ── Sync ────────────────────────────────────────────────────────────

/// Sync the vault.
#[tauri::command]
pub async fn bw_sync(
    state: tauri::State<'_, BitwardenServiceState>,
) -> Result<SyncResult, String> {
    let mut svc = state.lock().await;
    svc.sync().await.map_err(|e| e.message)
}

/// Force sync the vault.
#[tauri::command]
pub async fn bw_force_sync(
    state: tauri::State<'_, BitwardenServiceState>,
) -> Result<SyncResult, String> {
    let mut svc = state.lock().await;
    svc.force_sync().await.map_err(|e| e.message)
}

// ── Items ───────────────────────────────────────────────────────────

/// List all vault items.
#[tauri::command]
pub async fn bw_list_items(
    state: tauri::State<'_, BitwardenServiceState>,
) -> Result<Vec<VaultItem>, String> {
    let mut svc = state.lock().await;
    svc.list_items().await.map_err(|e| e.message)
}

/// Search vault items.
#[tauri::command]
pub async fn bw_search_items(
    state: tauri::State<'_, BitwardenServiceState>,
    query: String,
) -> Result<Vec<VaultItem>, String> {
    let svc = state.lock().await;
    Ok(svc.search_items(&query).await)
}

/// Get a vault item by ID.
#[tauri::command]
pub async fn bw_get_item(
    state: tauri::State<'_, BitwardenServiceState>,
    id: String,
) -> Result<VaultItem, String> {
    let svc = state.lock().await;
    svc.get_item(&id).await.map_err(|e| e.message)
}

/// Create a new vault item.
#[tauri::command]
pub async fn bw_create_item(
    state: tauri::State<'_, BitwardenServiceState>,
    item: VaultItem,
) -> Result<VaultItem, String> {
    let mut svc = state.lock().await;
    svc.create_item(&item).await.map_err(|e| e.message)
}

/// Edit a vault item.
#[tauri::command]
pub async fn bw_edit_item(
    state: tauri::State<'_, BitwardenServiceState>,
    id: String,
    item: VaultItem,
) -> Result<VaultItem, String> {
    let mut svc = state.lock().await;
    svc.edit_item(&id, &item).await.map_err(|e| e.message)
}

/// Delete a vault item (move to trash).
#[tauri::command]
pub async fn bw_delete_item(
    state: tauri::State<'_, BitwardenServiceState>,
    id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.delete_item(&id).await.map_err(|e| e.message)
}

/// Permanently delete a trashed item.
#[tauri::command]
pub async fn bw_delete_item_permanent(
    state: tauri::State<'_, BitwardenServiceState>,
    id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.delete_item_permanent(&id).await.map_err(|e| e.message)
}

/// Restore a deleted item.
#[tauri::command]
pub async fn bw_restore_item(
    state: tauri::State<'_, BitwardenServiceState>,
    id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.restore_item(&id).await.map_err(|e| e.message)
}

// ── Quick access ────────────────────────────────────────────────────

/// Get a username from an item.
#[tauri::command]
pub async fn bw_get_username(
    state: tauri::State<'_, BitwardenServiceState>,
    id: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.get_username(&id).await.map_err(|e| e.message)
}

/// Get a password from an item.
#[tauri::command]
pub async fn bw_get_password(
    state: tauri::State<'_, BitwardenServiceState>,
    id: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.get_password(&id).await.map_err(|e| e.message)
}

/// Get a TOTP code from an item.
#[tauri::command]
pub async fn bw_get_totp(
    state: tauri::State<'_, BitwardenServiceState>,
    id: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.get_totp(&id).await.map_err(|e| e.message)
}

/// Find credentials for a URI (for autofill).
#[tauri::command]
pub async fn bw_find_credentials(
    state: tauri::State<'_, BitwardenServiceState>,
    uri: String,
) -> Result<Vec<CredentialMatch>, String> {
    let svc = state.lock().await;
    Ok(svc.find_credentials(&uri).await)
}

// ── Folders ─────────────────────────────────────────────────────────

/// List all folders.
#[tauri::command]
pub async fn bw_list_folders(
    state: tauri::State<'_, BitwardenServiceState>,
) -> Result<Vec<Folder>, String> {
    let svc = state.lock().await;
    svc.list_folders().await.map_err(|e| e.message)
}

/// Create a folder.
#[tauri::command]
pub async fn bw_create_folder(
    state: tauri::State<'_, BitwardenServiceState>,
    name: String,
) -> Result<Folder, String> {
    let svc = state.lock().await;
    let folder = Folder::new(&name);
    svc.create_folder(&folder).await.map_err(|e| e.message)
}

/// Edit a folder.
#[tauri::command]
pub async fn bw_edit_folder(
    state: tauri::State<'_, BitwardenServiceState>,
    id: String,
    name: String,
) -> Result<Folder, String> {
    let svc = state.lock().await;
    let folder = Folder { object: Some("folder".into()), id: Some(id.clone()), name };
    svc.edit_folder(&id, &folder).await.map_err(|e| e.message)
}

/// Delete a folder.
#[tauri::command]
pub async fn bw_delete_folder(
    state: tauri::State<'_, BitwardenServiceState>,
    id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_folder(&id).await.map_err(|e| e.message)
}

// ── Collections & Organizations ─────────────────────────────────────

/// List collections.
#[tauri::command]
pub async fn bw_list_collections(
    state: tauri::State<'_, BitwardenServiceState>,
) -> Result<Vec<Collection>, String> {
    let svc = state.lock().await;
    svc.list_collections().await.map_err(|e| e.message)
}

/// List organizations.
#[tauri::command]
pub async fn bw_list_organizations(
    state: tauri::State<'_, BitwardenServiceState>,
) -> Result<Vec<Organization>, String> {
    let svc = state.lock().await;
    svc.list_organizations().await.map_err(|e| e.message)
}

// ── Sends ───────────────────────────────────────────────────────────

/// List all sends.
#[tauri::command]
pub async fn bw_list_sends(
    state: tauri::State<'_, BitwardenServiceState>,
) -> Result<Vec<Send>, String> {
    let svc = state.lock().await;
    svc.list_sends().await.map_err(|e| e.message)
}

/// Create a text send.
#[tauri::command]
pub async fn bw_create_text_send(
    state: tauri::State<'_, BitwardenServiceState>,
    name: String,
    text: String,
    max_access: Option<u32>,
    password: Option<String>,
    hidden: bool,
) -> Result<Send, String> {
    let svc = state.lock().await;
    svc.create_text_send(&name, &text, max_access, password.as_deref(), hidden)
        .await
        .map_err(|e| e.message)
}

/// Delete a send.
#[tauri::command]
pub async fn bw_delete_send(
    state: tauri::State<'_, BitwardenServiceState>,
    id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_send(&id).await.map_err(|e| e.message)
}

// ── Attachments ─────────────────────────────────────────────────────

/// Create an attachment on an item.
#[tauri::command]
pub async fn bw_create_attachment(
    state: tauri::State<'_, BitwardenServiceState>,
    item_id: String,
    file_path: String,
) -> Result<VaultItem, String> {
    let svc = state.lock().await;
    svc.create_attachment(&item_id, &file_path)
        .await
        .map_err(|e| e.message)
}

/// Delete an attachment.
#[tauri::command]
pub async fn bw_delete_attachment(
    state: tauri::State<'_, BitwardenServiceState>,
    attachment_id: String,
    item_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_attachment(&attachment_id, &item_id)
        .await
        .map_err(|e| e.message)
}

/// Download an attachment.
#[tauri::command]
pub async fn bw_download_attachment(
    state: tauri::State<'_, BitwardenServiceState>,
    attachment_id: String,
    item_id: String,
    output_path: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.download_attachment(&attachment_id, &item_id, &output_path)
        .await
        .map_err(|e| e.message)
}

// ── Generate ────────────────────────────────────────────────────────

/// Generate a password.
#[tauri::command]
pub async fn bw_generate_password(
    state: tauri::State<'_, BitwardenServiceState>,
    opts: PasswordGenerateOptions,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.generate_password(&opts).await.map_err(|e| e.message)
}

/// Generate a password locally (no CLI needed).
#[tauri::command]
pub async fn bw_generate_password_local(
    state: tauri::State<'_, BitwardenServiceState>,
    opts: PasswordGenerateOptions,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.generate_password_local(&opts).map_err(|e| e.message)
}

// ── Export / Import ─────────────────────────────────────────────────

/// Export the vault.
#[tauri::command]
pub async fn bw_export(
    state: tauri::State<'_, BitwardenServiceState>,
    format: String,
    output_path: String,
    password: Option<String>,
) -> Result<(), String> {
    let export_format = match format.as_str() {
        "csv" => ExportFormat::Csv,
        "json" => ExportFormat::Json,
        "encrypted_json" => ExportFormat::EncryptedJson,
        _ => return Err(format!("Unknown export format: {}", format)),
    };
    let svc = state.lock().await;
    svc.export(export_format, &output_path, password.as_deref())
        .await
        .map_err(|e| e.message)
}

/// Import vault data.
#[tauri::command]
pub async fn bw_import(
    state: tauri::State<'_, BitwardenServiceState>,
    format: String,
    file_path: String,
) -> Result<(), String> {
    let import_format = match format.as_str() {
        "bitwardencsv" => ImportFormat::BitwardenCsv,
        "bitwardenjson" => ImportFormat::BitwardenJson,
        "lastpasscsv" => ImportFormat::LastPassCsv,
        "keepassxcsv" => ImportFormat::KeePassXCsv,
        "keepassxml" => ImportFormat::KeePassXml,
        "chromecsv" => ImportFormat::ChromeCsv,
        "firefoxcsv" => ImportFormat::FirefoxCsv,
        "1passwordcsv" => ImportFormat::OnePasswordCsv,
        "1password1pux" => ImportFormat::OnePassword1Pux,
        "dashlanecsv" => ImportFormat::DashlaneCsv,
        "enpasscsv" => ImportFormat::EnpassCsv,
        "safeincloudxml" => ImportFormat::SafeInCloudXml,
        "passwordsafecsv" => ImportFormat::PasswordSafeCsv,
        _ => return Err(format!("Unknown import format: {}", format)),
    };
    let svc = state.lock().await;
    svc.import(import_format, &file_path)
        .await
        .map_err(|e| e.message)
}

// ── Vault health ────────────────────────────────────────────────────

/// Get vault statistics.
#[tauri::command]
pub async fn bw_vault_stats(
    state: tauri::State<'_, BitwardenServiceState>,
) -> Result<VaultStats, String> {
    let svc = state.lock().await;
    Ok(svc.vault_stats().await)
}

/// Analyze password health.
#[tauri::command]
pub async fn bw_password_health(
    state: tauri::State<'_, BitwardenServiceState>,
) -> Result<Vec<PasswordHealthReport>, String> {
    let svc = state.lock().await;
    Ok(svc.password_health().await)
}

/// Find duplicate items.
#[tauri::command]
pub async fn bw_find_duplicates(
    state: tauri::State<'_, BitwardenServiceState>,
) -> Result<Vec<(String, String)>, String> {
    let svc = state.lock().await;
    Ok(svc.find_duplicates().await)
}

// ── bw serve ────────────────────────────────────────────────────────

/// Start the `bw serve` local API server.
#[tauri::command]
pub async fn bw_start_serve(
    state: tauri::State<'_, BitwardenServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.start_serve().await.map_err(|e| e.message)
}

/// Stop the `bw serve` local API server.
#[tauri::command]
pub async fn bw_stop_serve(
    state: tauri::State<'_, BitwardenServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.stop_serve().await;
    Ok(())
}

/// Check if `bw serve` is running.
#[tauri::command]
pub async fn bw_is_serve_running(
    state: tauri::State<'_, BitwardenServiceState>,
) -> Result<bool, String> {
    let svc = state.lock().await;
    Ok(svc.is_serve_running().await)
}
