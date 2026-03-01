use tauri::State;

use crate::dashlane::service::DashlaneServiceState;
use crate::dashlane::types::*;

// --- Configuration & Auth ---

#[tauri::command]
pub async fn dl_configure(
    state: State<'_, DashlaneServiceState>,
    config: DashlaneConfig,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.configure(config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn dl_login(
    state: State<'_, DashlaneServiceState>,
    master_password: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.login(&master_password).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn dl_login_with_token(
    state: State<'_, DashlaneServiceState>,
    master_password: String,
    token: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.login_with_token(&master_password, &token)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn dl_logout(state: State<'_, DashlaneServiceState>) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.logout().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn dl_is_authenticated(state: State<'_, DashlaneServiceState>) -> Result<bool, String> {
    let svc = state.lock().await;
    Ok(svc.is_authenticated())
}

// --- Credentials ---

#[tauri::command]
pub async fn dl_list_credentials(
    state: State<'_, DashlaneServiceState>,
    filter: Option<CredentialFilter>,
) -> Result<Vec<DashlaneCredential>, String> {
    let mut svc = state.lock().await;
    svc.list_credentials(filter).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn dl_get_credential(
    state: State<'_, DashlaneServiceState>,
    id: String,
) -> Result<DashlaneCredential, String> {
    let mut svc = state.lock().await;
    svc.get_credential(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn dl_search_credentials(
    state: State<'_, DashlaneServiceState>,
    query: String,
) -> Result<Vec<DashlaneCredential>, String> {
    let mut svc = state.lock().await;
    svc.search_credentials(&query).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn dl_search_by_url(
    state: State<'_, DashlaneServiceState>,
    url: String,
) -> Result<Vec<DashlaneCredential>, String> {
    let mut svc = state.lock().await;
    svc.search_by_url(&url).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn dl_create_credential(
    state: State<'_, DashlaneServiceState>,
    req: CreateCredentialRequest,
) -> Result<DashlaneCredential, String> {
    let mut svc = state.lock().await;
    svc.create_credential(req).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn dl_update_credential(
    state: State<'_, DashlaneServiceState>,
    id: String,
    req: UpdateCredentialRequest,
) -> Result<DashlaneCredential, String> {
    let mut svc = state.lock().await;
    svc.update_credential(&id, req).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn dl_delete_credential(
    state: State<'_, DashlaneServiceState>,
    id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.delete_credential(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn dl_find_duplicate_passwords(
    state: State<'_, DashlaneServiceState>,
) -> Result<Vec<Vec<DashlaneCredential>>, String> {
    let mut svc = state.lock().await;
    svc.find_duplicate_passwords().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn dl_get_categories(
    state: State<'_, DashlaneServiceState>,
) -> Result<Vec<String>, String> {
    let mut svc = state.lock().await;
    svc.get_categories().await.map_err(|e| e.to_string())
}

// --- Secure Notes ---

#[tauri::command]
pub async fn dl_list_notes(
    state: State<'_, DashlaneServiceState>,
) -> Result<Vec<SecureNote>, String> {
    let mut svc = state.lock().await;
    svc.list_notes().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn dl_get_note(
    state: State<'_, DashlaneServiceState>,
    id: String,
) -> Result<SecureNote, String> {
    let svc = state.lock().await;
    svc.get_note(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn dl_search_notes(
    state: State<'_, DashlaneServiceState>,
    query: String,
) -> Result<Vec<SecureNote>, String> {
    let svc = state.lock().await;
    svc.search_notes(&query).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn dl_create_note(
    state: State<'_, DashlaneServiceState>,
    title: String,
    content: String,
    category: Option<String>,
    secured: bool,
) -> Result<SecureNote, String> {
    let mut svc = state.lock().await;
    svc.create_note(title, content, category, secured)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn dl_delete_note(
    state: State<'_, DashlaneServiceState>,
    id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.delete_note(&id).await.map_err(|e| e.to_string())
}

// --- Identities ---

#[tauri::command]
pub async fn dl_list_identities(
    state: State<'_, DashlaneServiceState>,
) -> Result<Vec<DashlaneIdentity>, String> {
    let svc = state.lock().await;
    svc.list_identities().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn dl_create_identity(
    state: State<'_, DashlaneServiceState>,
    first_name: String,
    last_name: String,
    email: Option<String>,
    phone: Option<String>,
) -> Result<DashlaneIdentity, String> {
    let mut svc = state.lock().await;
    svc.create_identity(first_name, last_name, email, phone)
        .await
        .map_err(|e| e.to_string())
}

// --- Secrets ---

#[tauri::command]
pub async fn dl_list_secrets(
    state: State<'_, DashlaneServiceState>,
) -> Result<Vec<DashlaneSecret>, String> {
    let svc = state.lock().await;
    svc.list_secrets().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn dl_create_secret(
    state: State<'_, DashlaneServiceState>,
    title: String,
    content: String,
    category: Option<String>,
) -> Result<DashlaneSecret, String> {
    let mut svc = state.lock().await;
    svc.create_secret(title, content, category)
        .await
        .map_err(|e| e.to_string())
}

// --- Devices ---

#[tauri::command]
pub async fn dl_list_devices(
    state: State<'_, DashlaneServiceState>,
) -> Result<Vec<RegisteredDevice>, String> {
    let mut svc = state.lock().await;
    svc.list_devices().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn dl_deregister_device(
    state: State<'_, DashlaneServiceState>,
    device_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.deregister_device(&device_id).await.map_err(|e| e.to_string())
}

// --- Sharing ---

#[tauri::command]
pub async fn dl_list_sharing_groups(
    state: State<'_, DashlaneServiceState>,
) -> Result<Vec<SharingGroup>, String> {
    let svc = state.lock().await;
    svc.list_sharing_groups().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn dl_create_sharing_group(
    state: State<'_, DashlaneServiceState>,
    name: String,
    owner_id: String,
    owner_name: String,
) -> Result<SharingGroup, String> {
    let mut svc = state.lock().await;
    svc.create_sharing_group(name, owner_id, owner_name)
        .await
        .map_err(|e| e.to_string())
}

// --- Dark Web ---

#[tauri::command]
pub async fn dl_get_dark_web_alerts(
    state: State<'_, DashlaneServiceState>,
) -> Result<Vec<DarkWebAlert>, String> {
    let svc = state.lock().await;
    svc.get_dark_web_alerts().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn dl_get_active_dark_web_alerts(
    state: State<'_, DashlaneServiceState>,
) -> Result<Vec<DarkWebAlert>, String> {
    let svc = state.lock().await;
    svc.get_active_dark_web_alerts().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn dl_dismiss_dark_web_alert(
    state: State<'_, DashlaneServiceState>,
    id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.dismiss_dark_web_alert(&id).await.map_err(|e| e.to_string())
}

// --- Password Health ---

#[tauri::command]
pub async fn dl_get_password_health(
    state: State<'_, DashlaneServiceState>,
) -> Result<PasswordHealthScore, String> {
    let mut svc = state.lock().await;
    svc.get_password_health().await.map_err(|e| e.to_string())
}

// --- Password Generation ---

#[tauri::command]
pub async fn dl_generate_password(
    state: State<'_, DashlaneServiceState>,
    config: PasswordGenConfig,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.generate_password(config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn dl_generate_passphrase(
    state: State<'_, DashlaneServiceState>,
    word_count: usize,
    separator: String,
    capitalize: bool,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.generate_passphrase(word_count, &separator, capitalize)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn dl_check_password_strength(
    state: State<'_, DashlaneServiceState>,
    password: String,
) -> Result<(u32, String), String> {
    let svc = state.lock().await;
    Ok(svc.check_password_strength(&password))
}

// --- Import/Export ---

#[tauri::command]
pub async fn dl_export_csv(
    state: State<'_, DashlaneServiceState>,
) -> Result<ExportResult, String> {
    let mut svc = state.lock().await;
    svc.export_csv().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn dl_export_json(
    state: State<'_, DashlaneServiceState>,
) -> Result<ExportResult, String> {
    let mut svc = state.lock().await;
    svc.export_json().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn dl_import_csv(
    state: State<'_, DashlaneServiceState>,
    csv_content: String,
    source: ImportSource,
) -> Result<ImportResult, String> {
    let mut svc = state.lock().await;
    svc.import_csv(&csv_content, source).map_err(|e| e.to_string())
}

// --- Stats ---

#[tauri::command]
pub async fn dl_get_stats(
    state: State<'_, DashlaneServiceState>,
) -> Result<VaultStats, String> {
    let mut svc = state.lock().await;
    svc.get_stats().await.map_err(|e| e.to_string())
}
