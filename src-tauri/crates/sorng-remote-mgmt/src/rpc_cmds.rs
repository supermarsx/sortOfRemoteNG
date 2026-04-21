use super::rpc::*;

#[tauri::command]
pub async fn connect_rpc(
    state: tauri::State<'_, RpcServiceState>,
    config: RpcConnectionConfig,
) -> Result<String, String> {
    let mut rpc = state.lock().await;
    rpc.connect_rpc(config).await
}

#[tauri::command]
pub async fn disconnect_rpc(
    state: tauri::State<'_, RpcServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut rpc = state.lock().await;
    rpc.disconnect_rpc(&session_id).await
}

#[tauri::command]
pub async fn call_rpc_method(
    state: tauri::State<'_, RpcServiceState>,
    session_id: String,
    request: RpcRequest,
) -> Result<RpcResponse, String> {
    let rpc = state.lock().await;
    rpc.call_rpc_method(&session_id, request).await
}

#[tauri::command]
pub async fn get_rpc_session(
    state: tauri::State<'_, RpcServiceState>,
    session_id: String,
) -> Result<RpcSession, String> {
    let rpc = state.lock().await;
    rpc.get_rpc_session(&session_id)
        .await
        .ok_or_else(|| format!("RPC session {} not found", session_id))
}

#[tauri::command]
pub async fn list_rpc_sessions(
    state: tauri::State<'_, RpcServiceState>,
) -> Result<Vec<RpcSession>, String> {
    let rpc = state.lock().await;
    Ok(rpc.list_rpc_sessions().await)
}

#[tauri::command]
pub async fn discover_rpc_methods(
    state: tauri::State<'_, RpcServiceState>,
    session_id: String,
) -> Result<Vec<String>, String> {
    let rpc = state.lock().await;
    rpc.discover_rpc_methods(&session_id).await
}

#[tauri::command]
pub async fn batch_rpc_calls(
    state: tauri::State<'_, RpcServiceState>,
    session_id: String,
    requests: Vec<RpcRequest>,
) -> Result<Vec<RpcResponse>, String> {
    let rpc = state.lock().await;
    rpc.batch_rpc_calls(&session_id, requests).await
}

