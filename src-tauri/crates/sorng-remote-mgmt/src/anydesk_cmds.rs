use super::anydesk::*;

#[tauri::command]
pub async fn launch_anydesk(
    anydesk_id: String,
    password: Option<String>,
    anydesk_service: tauri::State<'_, AnyDeskServiceState>,
) -> Result<String, String> {
    let mut service = anydesk_service.lock().await;
    service.launch_anydesk(anydesk_id, password).await
}

#[tauri::command]
pub async fn disconnect_anydesk(
    session_id: String,
    anydesk_service: tauri::State<'_, AnyDeskServiceState>,
) -> Result<(), String> {
    let mut service = anydesk_service.lock().await;
    service.disconnect_anydesk(&session_id).await
}

#[tauri::command]
pub async fn get_anydesk_session(
    session_id: String,
    anydesk_service: tauri::State<'_, AnyDeskServiceState>,
) -> Result<Option<AnyDeskSession>, String> {
    let service = anydesk_service.lock().await;
    Ok(service.get_anydesk_session(&session_id))
}

#[tauri::command]
pub async fn list_anydesk_sessions(
    anydesk_service: tauri::State<'_, AnyDeskServiceState>,
) -> Result<Vec<AnyDeskSession>, String> {
    let service = anydesk_service.lock().await;
    Ok(service.get_anydesk_sessions().await)
}
