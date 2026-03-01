use crate::lastpass::service::LastPassServiceState;
use crate::lastpass::types::*;

#[tauri::command]
pub async fn lp_configure(
    state: tauri::State<'_, LastPassServiceState>,
    config: LastPassConfig,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.configure(config).map_err(|e| e.message)
}

#[tauri::command]
pub async fn lp_login(
    state: tauri::State<'_, LastPassServiceState>,
    master_password: String,
    otp: Option<String>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.login(&master_password, otp.as_deref())
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn lp_logout(state: tauri::State<'_, LastPassServiceState>) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.logout().await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn lp_is_logged_in(state: tauri::State<'_, LastPassServiceState>) -> Result<bool, String> {
    let svc = state.lock().await;
    Ok(svc.is_logged_in())
}

#[tauri::command]
pub async fn lp_is_configured(state: tauri::State<'_, LastPassServiceState>) -> Result<bool, String> {
    let svc = state.lock().await;
    Ok(svc.is_configured())
}

#[tauri::command]
pub async fn lp_list_accounts(
    state: tauri::State<'_, LastPassServiceState>,
    params: Option<AccountListParams>,
) -> Result<Vec<Account>, String> {
    let mut svc = state.lock().await;
    svc.list_accounts(params).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn lp_get_account(
    state: tauri::State<'_, LastPassServiceState>,
    id: String,
) -> Result<Account, String> {
    let mut svc = state.lock().await;
    svc.get_account(&id).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn lp_search_accounts(
    state: tauri::State<'_, LastPassServiceState>,
    query: String,
) -> Result<Vec<Account>, String> {
    let mut svc = state.lock().await;
    svc.search_accounts(&query).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn lp_search_by_url(
    state: tauri::State<'_, LastPassServiceState>,
    url: String,
) -> Result<Vec<Account>, String> {
    let mut svc = state.lock().await;
    svc.search_by_url(&url).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn lp_create_account(
    state: tauri::State<'_, LastPassServiceState>,
    request: CreateAccountRequest,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.create_account(request).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn lp_update_account(
    state: tauri::State<'_, LastPassServiceState>,
    request: UpdateAccountRequest,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.update_account(request).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn lp_delete_account(
    state: tauri::State<'_, LastPassServiceState>,
    id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.delete_account(&id).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn lp_toggle_favorite(
    state: tauri::State<'_, LastPassServiceState>,
    id: String,
    favorite: bool,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.toggle_favorite(&id, favorite)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn lp_move_account(
    state: tauri::State<'_, LastPassServiceState>,
    id: String,
    new_group: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.move_account(&id, &new_group)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn lp_get_favorites(
    state: tauri::State<'_, LastPassServiceState>,
) -> Result<Vec<Account>, String> {
    let mut svc = state.lock().await;
    svc.get_favorites().await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn lp_get_duplicates(
    state: tauri::State<'_, LastPassServiceState>,
) -> Result<Vec<Vec<Account>>, String> {
    let mut svc = state.lock().await;
    svc.get_duplicates().await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn lp_list_folders(
    state: tauri::State<'_, LastPassServiceState>,
) -> Result<Vec<Folder>, String> {
    let mut svc = state.lock().await;
    svc.list_folders().await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn lp_create_folder(
    state: tauri::State<'_, LastPassServiceState>,
    name: String,
    shared: Option<bool>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.create_folder(&name, shared.unwrap_or(false))
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn lp_security_challenge(
    state: tauri::State<'_, LastPassServiceState>,
) -> Result<SecurityScore, String> {
    let mut svc = state.lock().await;
    svc.run_security_challenge().await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn lp_export_csv(
    state: tauri::State<'_, LastPassServiceState>,
) -> Result<ExportResult, String> {
    let mut svc = state.lock().await;
    svc.export_csv().await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn lp_export_json(
    state: tauri::State<'_, LastPassServiceState>,
) -> Result<ExportResult, String> {
    let mut svc = state.lock().await;
    svc.export_json().await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn lp_import_csv(
    state: tauri::State<'_, LastPassServiceState>,
    csv_data: String,
    format: ImportFormat,
) -> Result<ImportResult, String> {
    let svc = state.lock().await;
    let (_, result) = svc.import_csv(&csv_data, format).map_err(|e| e.message)?;
    Ok(result)
}

#[tauri::command]
pub async fn lp_generate_password(
    state: tauri::State<'_, LastPassServiceState>,
    config: Option<PasswordGenConfig>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.generate_password(config).map_err(|e| e.message)
}

#[tauri::command]
pub async fn lp_generate_passphrase(
    state: tauri::State<'_, LastPassServiceState>,
    word_count: Option<u32>,
    separator: Option<String>,
) -> Result<String, String> {
    let svc = state.lock().await;
    Ok(svc.generate_passphrase(word_count, separator.as_deref()))
}

#[tauri::command]
pub async fn lp_check_password_strength(
    state: tauri::State<'_, LastPassServiceState>,
    password: String,
) -> Result<(f64, String), String> {
    let svc = state.lock().await;
    let (entropy, rating) = svc.check_password_strength(&password);
    Ok((entropy, rating.to_string()))
}

#[tauri::command]
pub async fn lp_get_stats(
    state: tauri::State<'_, LastPassServiceState>,
) -> Result<crate::lastpass::service::VaultStats, String> {
    let mut svc = state.lock().await;
    svc.get_stats().await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn lp_invalidate_cache(
    state: tauri::State<'_, LastPassServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.invalidate_cache();
    Ok(())
}
