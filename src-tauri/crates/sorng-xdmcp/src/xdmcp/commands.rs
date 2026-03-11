// Tauri commands for XDMCP remote display sessions.

use tauri;

use super::service::XdmcpServiceState;
use super::types::*;

#[tauri::command]
pub async fn connect_xdmcp(
    state: tauri::State<'_, XdmcpServiceState>,
    session_id: String,
    config: XdmcpConfig,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.connect(session_id, config).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn disconnect_xdmcp(
    state: tauri::State<'_, XdmcpServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect(&session_id).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn disconnect_all_xdmcp(
    state: tauri::State<'_, XdmcpServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect_all().await;
    Ok(())
}

#[tauri::command]
pub async fn discover_xdmcp(
    state: tauri::State<'_, XdmcpServiceState>,
    broadcast_address: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<Vec<serde_json::Value>, String> {
    let svc = state.lock().await;
    let addr = broadcast_address.unwrap_or_else(|| "255.255.255.255".to_string());
    let timeout = timeout_ms.unwrap_or(3000);
    svc.discover(&addr, timeout).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn is_xdmcp_connected(
    state: tauri::State<'_, XdmcpServiceState>,
    session_id: String,
) -> Result<bool, String> {
    let svc = state.lock().await;
    Ok(svc.is_connected(&session_id).await)
}

#[tauri::command]
pub async fn get_xdmcp_session_info(
    state: tauri::State<'_, XdmcpServiceState>,
    session_id: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.get_session_info(&session_id)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn list_xdmcp_sessions(
    state: tauri::State<'_, XdmcpServiceState>,
) -> Result<Vec<serde_json::Value>, String> {
    let svc = state.lock().await;
    Ok(svc.list_sessions().await)
}

#[tauri::command]
pub async fn get_xdmcp_session_stats(
    state: tauri::State<'_, XdmcpServiceState>,
    session_id: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.get_session_stats(&session_id)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn prune_xdmcp_sessions(
    state: tauri::State<'_, XdmcpServiceState>,
) -> Result<Vec<String>, String> {
    let mut svc = state.lock().await;
    Ok(svc.prune_ended().await)
}

#[tauri::command]
pub async fn get_xdmcp_session_count(
    state: tauri::State<'_, XdmcpServiceState>,
) -> Result<usize, String> {
    let svc = state.lock().await;
    Ok(svc.session_count())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_xdmcp_config() {
        let cfg = XdmcpConfig {
            host: "192.168.1.100".into(),
            ..Default::default()
        };
        assert_eq!(cfg.port, 177);
    }

    #[test]
    fn command_functions_exist() {
        // Verify all command functions are defined (async fns can't be cast)
        // Just reference them to ensure compilation
        let _f1 = connect_xdmcp;
        let _f2 = disconnect_xdmcp;
        let _f3 = disconnect_all_xdmcp;
    }
}
