//! Tauri commands for X2Go remote desktop sessions.

use tauri;

use crate::x2go::service::X2goServiceState;
use crate::x2go::types::*;

#[tauri::command]
pub async fn connect_x2go(
    state: tauri::State<'_, X2goServiceState>,
    session_id: String,
    config: X2goConfig,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.connect(session_id, config)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn suspend_x2go(
    state: tauri::State<'_, X2goServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.suspend(&session_id).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn terminate_x2go(
    state: tauri::State<'_, X2goServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.terminate(&session_id).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn disconnect_x2go(
    state: tauri::State<'_, X2goServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect(&session_id).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn disconnect_all_x2go(
    state: tauri::State<'_, X2goServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect_all().await;
    Ok(())
}

#[tauri::command]
pub async fn is_x2go_connected(
    state: tauri::State<'_, X2goServiceState>,
    session_id: String,
) -> Result<bool, String> {
    let svc = state.lock().await;
    Ok(svc.is_connected(&session_id).await)
}

#[tauri::command]
pub async fn get_x2go_session_info(
    state: tauri::State<'_, X2goServiceState>,
    session_id: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.get_session_info(&session_id)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn list_x2go_sessions(
    state: tauri::State<'_, X2goServiceState>,
) -> Result<Vec<serde_json::Value>, String> {
    let svc = state.lock().await;
    Ok(svc.list_sessions().await)
}

#[tauri::command]
pub async fn get_x2go_session_stats(
    state: tauri::State<'_, X2goServiceState>,
    session_id: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.get_session_stats(&session_id)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn send_x2go_clipboard(
    state: tauri::State<'_, X2goServiceState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.send_clipboard(&session_id, data)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn resize_x2go_display(
    state: tauri::State<'_, X2goServiceState>,
    session_id: String,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.resize(&session_id, width, height)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn mount_x2go_folder(
    state: tauri::State<'_, X2goServiceState>,
    session_id: String,
    local_path: String,
    remote_name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.mount_folder(&session_id, local_path, remote_name)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn unmount_x2go_folder(
    state: tauri::State<'_, X2goServiceState>,
    session_id: String,
    remote_name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.unmount_folder(&session_id, remote_name)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn prune_x2go_sessions(
    state: tauri::State<'_, X2goServiceState>,
) -> Result<Vec<String>, String> {
    let mut svc = state.lock().await;
    Ok(svc.prune_ended().await)
}

#[tauri::command]
pub async fn get_x2go_session_count(
    state: tauri::State<'_, X2goServiceState>,
) -> Result<usize, String> {
    let svc = state.lock().await;
    Ok(svc.session_count())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_x2go_config() {
        let cfg = X2goConfig {
            host: "server".into(),
            username: "admin".into(),
            ..Default::default()
        };
        assert_eq!(cfg.ssh.port, 22);
        assert_eq!(cfg.session_type, X2goSessionType::Kde);
    }

    #[test]
    fn command_functions_exist() {
        // Verify all command functions are defined (async fns can't be cast)
        let _f1 = connect_x2go;
        let _f2 = disconnect_x2go;
        let _f3 = suspend_x2go;
        let _f4 = terminate_x2go;
    }
}
