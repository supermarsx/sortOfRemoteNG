use super::heroku::*;

#[tauri::command]
pub async fn connect_heroku(
    config: HerokuConnectionConfig,
    state: tauri::State<'_, HerokuServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.connect_heroku(config).await
}

#[tauri::command]
pub async fn disconnect_heroku(
    session_id: String,
    state: tauri::State<'_, HerokuServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.disconnect_heroku(&session_id).await
}

#[tauri::command]
pub async fn list_heroku_dynos(
    session_id: String,
    state: tauri::State<'_, HerokuServiceState>,
) -> Result<Vec<HerokuDyno>, String> {
    let mut service = state.lock().await;
    service.list_dynos(&session_id).await
}

#[tauri::command]
pub async fn get_heroku_session(
    session_id: String,
    state: tauri::State<'_, HerokuServiceState>,
) -> Result<HerokuSession, String> {
    let service = state.lock().await;
    service
        .get_session(&session_id)
        .await
        .cloned()
        .ok_or("Heroku session not found".to_string())
}

#[tauri::command]
pub async fn list_heroku_sessions(
    state: tauri::State<'_, HerokuServiceState>,
) -> Result<Vec<HerokuSession>, String> {
    let service = state.lock().await;
    Ok(service.get_sessions().into_iter().cloned().collect())
}

