use super::wmi::*;

#[tauri::command]
pub async fn connect_wmi(
    state: tauri::State<'_, WmiServiceState>,
    config: WmiConnectionConfig,
) -> Result<String, String> {
    let mut wmi = state.lock().await;
    wmi.connect_wmi(config).await
}

#[tauri::command]
pub async fn disconnect_wmi(
    state: tauri::State<'_, WmiServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut wmi = state.lock().await;
    wmi.disconnect_wmi(&session_id).await
}

#[tauri::command]
pub async fn execute_wmi_query(
    state: tauri::State<'_, WmiServiceState>,
    session_id: String,
    query: String,
) -> Result<WmiQueryResult, String> {
    let wmi = state.lock().await;
    wmi.execute_wmi_query(&session_id, query).await
}

#[tauri::command]
pub async fn get_wmi_session(
    state: tauri::State<'_, WmiServiceState>,
    session_id: String,
) -> Result<WmiSession, String> {
    let wmi = state.lock().await;
    wmi.get_wmi_session(&session_id)
        .await
        .ok_or_else(|| format!("WMI session {} not found", session_id))
}

#[tauri::command]
pub async fn list_wmi_sessions(
    state: tauri::State<'_, WmiServiceState>,
) -> Result<Vec<WmiSession>, String> {
    let wmi = state.lock().await;
    Ok(wmi.list_wmi_sessions().await)
}

#[tauri::command]
pub async fn get_wmi_classes(
    state: tauri::State<'_, WmiServiceState>,
    session_id: String,
    namespace: Option<String>,
) -> Result<Vec<String>, String> {
    let wmi = state.lock().await;
    wmi.get_wmi_classes(&session_id, namespace).await
}

#[tauri::command]
pub async fn get_wmi_namespaces(
    state: tauri::State<'_, WmiServiceState>,
    session_id: String,
) -> Result<Vec<String>, String> {
    let wmi = state.lock().await;
    wmi.get_wmi_namespaces(&session_id).await
}

