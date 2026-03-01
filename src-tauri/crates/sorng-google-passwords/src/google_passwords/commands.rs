use crate::google_passwords::service::GooglePasswordsServiceState;
use crate::google_passwords::types::*;

#[tauri::command]
pub async fn gp_configure(
    state: tauri::State<'_, GooglePasswordsServiceState>,
    config: GooglePasswordsConfig,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.configure(config).map_err(|e| e.message)
}

#[tauri::command]
pub async fn gp_is_configured(
    state: tauri::State<'_, GooglePasswordsServiceState>,
) -> Result<bool, String> {
    let svc = state.lock().await;
    Ok(svc.is_configured())
}

#[tauri::command]
pub async fn gp_is_authenticated(
    state: tauri::State<'_, GooglePasswordsServiceState>,
) -> Result<bool, String> {
    let svc = state.lock().await;
    Ok(svc.is_authenticated())
}

#[tauri::command]
pub async fn gp_get_auth_url(
    state: tauri::State<'_, GooglePasswordsServiceState>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.get_auth_url().map_err(|e| e.message)
}

#[tauri::command]
pub async fn gp_authenticate(
    state: tauri::State<'_, GooglePasswordsServiceState>,
    code: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.authenticate(&code).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn gp_refresh_auth(
    state: tauri::State<'_, GooglePasswordsServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.refresh_auth().await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn gp_logout(
    state: tauri::State<'_, GooglePasswordsServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.logout().await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn gp_list_credentials(
    state: tauri::State<'_, GooglePasswordsServiceState>,
    filter: Option<CredentialFilter>,
) -> Result<Vec<Credential>, String> {
    let svc = state.lock().await;
    Ok(svc.list_credentials(filter))
}

#[tauri::command]
pub async fn gp_get_credential(
    state: tauri::State<'_, GooglePasswordsServiceState>,
    id: String,
) -> Result<Credential, String> {
    let svc = state.lock().await;
    svc.get_credential(&id).map_err(|e| e.message)
}

#[tauri::command]
pub async fn gp_search_credentials(
    state: tauri::State<'_, GooglePasswordsServiceState>,
    query: String,
) -> Result<Vec<Credential>, String> {
    let svc = state.lock().await;
    Ok(svc.search_credentials(&query))
}

#[tauri::command]
pub async fn gp_search_by_url(
    state: tauri::State<'_, GooglePasswordsServiceState>,
    url: String,
) -> Result<Vec<Credential>, String> {
    let svc = state.lock().await;
    Ok(svc.search_by_url(&url))
}

#[tauri::command]
pub async fn gp_create_credential(
    state: tauri::State<'_, GooglePasswordsServiceState>,
    request: CreateCredentialRequest,
) -> Result<Credential, String> {
    let mut svc = state.lock().await;
    svc.create_credential(request).map_err(|e| e.message)
}

#[tauri::command]
pub async fn gp_update_credential(
    state: tauri::State<'_, GooglePasswordsServiceState>,
    request: UpdateCredentialRequest,
) -> Result<Credential, String> {
    let mut svc = state.lock().await;
    svc.update_credential(request).map_err(|e| e.message)
}

#[tauri::command]
pub async fn gp_delete_credential(
    state: tauri::State<'_, GooglePasswordsServiceState>,
    id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.delete_credential(&id).map_err(|e| e.message)
}

#[tauri::command]
pub async fn gp_run_checkup(
    state: tauri::State<'_, GooglePasswordsServiceState>,
) -> Result<PasswordCheckupResult, String> {
    let mut svc = state.lock().await;
    Ok(svc.run_checkup())
}

#[tauri::command]
pub async fn gp_get_insecure_urls(
    state: tauri::State<'_, GooglePasswordsServiceState>,
) -> Result<Vec<Credential>, String> {
    let svc = state.lock().await;
    Ok(svc.get_insecure_urls())
}

#[tauri::command]
pub async fn gp_import_csv(
    state: tauri::State<'_, GooglePasswordsServiceState>,
    csv_data: String,
    source: ImportSource,
) -> Result<ImportResult, String> {
    let mut svc = state.lock().await;
    svc.import_csv(&csv_data, source).map_err(|e| e.message)
}

#[tauri::command]
pub async fn gp_export_csv(
    state: tauri::State<'_, GooglePasswordsServiceState>,
) -> Result<ExportResult, String> {
    let svc = state.lock().await;
    Ok(svc.export_csv())
}

#[tauri::command]
pub async fn gp_export_json(
    state: tauri::State<'_, GooglePasswordsServiceState>,
) -> Result<ExportResult, String> {
    let svc = state.lock().await;
    svc.export_json().map_err(|e| e.message)
}

#[tauri::command]
pub async fn gp_generate_password(
    state: tauri::State<'_, GooglePasswordsServiceState>,
    config: Option<PasswordGenConfig>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.generate_password(config).map_err(|e| e.message)
}

#[tauri::command]
pub async fn gp_check_password_strength(
    state: tauri::State<'_, GooglePasswordsServiceState>,
    password: String,
) -> Result<(f64, String), String> {
    let svc = state.lock().await;
    let (entropy, rating) = svc.check_password_strength(&password);
    Ok((entropy, rating.to_string()))
}

#[tauri::command]
pub async fn gp_get_stats(
    state: tauri::State<'_, GooglePasswordsServiceState>,
) -> Result<VaultStats, String> {
    let svc = state.lock().await;
    Ok(svc.get_stats())
}

#[tauri::command]
pub async fn gp_get_sync_info(
    state: tauri::State<'_, GooglePasswordsServiceState>,
) -> Result<SyncInfo, String> {
    let svc = state.lock().await;
    Ok(svc.get_sync_info())
}
