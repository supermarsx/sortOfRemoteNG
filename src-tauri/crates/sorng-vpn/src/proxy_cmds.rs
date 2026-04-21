// Proxy/tunneling Tauri command shims.
//
// Threading model (per global rule in `.orchestration/plans/t1.md`):
// - Every command is `async` and returns quickly to the Tauri command thread.
// - Each protocol's `connect_*_static` helper spawns its own
//   `tokio::spawn`ed relay loop (SSH, QUIC, WebSocket, SOCKS, HTTP, DNS
//   tunnel, ICMP tunnel, etc.); the command merely sets up the tunnel and
//   returns the allocated local port.
// - Packet forwarding uses `tokio::io::copy` / `tokio::join!` in detached
//   tasks — no shared `Mutex` on the hot path.
//
// NOTE: kept as regular `//` — file is `include!()`ed into
// `src-tauri/src/proxy_commands.rs`; inner doc (`//!`) not allowed.

use super::proxy::*;

#[tauri::command]
pub async fn create_proxy_connection(
    target_host: String,
    target_port: u16,
    proxy_config: ProxyConfig,
    state: tauri::State<'_, ProxyServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service
        .create_proxy_connection(target_host, target_port, proxy_config)
        .await
}

#[tauri::command]
pub async fn connect_via_proxy(
    connection_id: String,
    state: tauri::State<'_, ProxyServiceState>,
) -> Result<u16, String> {
    let mut service = state.lock().await;
    service.connect_via_proxy(&connection_id).await
}

#[tauri::command]
pub async fn disconnect_proxy(
    connection_id: String,
    state: tauri::State<'_, ProxyServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.disconnect_proxy(&connection_id).await
}

#[tauri::command]
pub async fn get_proxy_connection(
    connection_id: String,
    state: tauri::State<'_, ProxyServiceState>,
) -> Result<ProxyConnection, String> {
    let service = state.lock().await;
    service.get_proxy_connection(&connection_id).await
}

#[tauri::command]
pub async fn list_proxy_connections(
    state: tauri::State<'_, ProxyServiceState>,
) -> Result<Vec<ProxyConnection>, String> {
    let service = state.lock().await;
    Ok(service.list_proxy_connections().await)
}

#[tauri::command]
pub async fn delete_proxy_connection(
    connection_id: String,
    state: tauri::State<'_, ProxyServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.delete_proxy_connection(&connection_id).await
}

#[tauri::command]
pub async fn create_proxy_chain(
    name: String,
    layers: Vec<ProxyConfig>,
    description: Option<String>,
    state: tauri::State<'_, ProxyServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.create_proxy_chain(name, layers, description).await
}

#[tauri::command]
pub async fn connect_proxy_chain(
    chain_id: String,
    target_host: String,
    target_port: u16,
    state: tauri::State<'_, ProxyServiceState>,
) -> Result<u16, String> {
    let mut service = state.lock().await;
    service
        .connect_proxy_chain(&chain_id, target_host, target_port)
        .await
}

#[tauri::command]
pub async fn disconnect_proxy_chain(
    chain_id: String,
    state: tauri::State<'_, ProxyServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.disconnect_proxy_chain(&chain_id).await
}

#[tauri::command]
pub async fn get_proxy_chain(
    chain_id: String,
    state: tauri::State<'_, ProxyServiceState>,
) -> Result<ProxyChain, String> {
    let service = state.lock().await;
    service.get_proxy_chain(&chain_id).await
}

#[tauri::command]
pub async fn list_proxy_chains(
    state: tauri::State<'_, ProxyServiceState>,
) -> Result<Vec<ProxyChain>, String> {
    let service = state.lock().await;
    Ok(service.list_proxy_chains().await)
}

#[tauri::command]
pub async fn delete_proxy_chain(
    chain_id: String,
    state: tauri::State<'_, ProxyServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.delete_proxy_chain(&chain_id).await
}

#[tauri::command]
pub async fn get_proxy_chain_health(
    chain_id: String,
    state: tauri::State<'_, ProxyServiceState>,
) -> Result<serde_json::Value, String> {
    let service = state.lock().await;
    service.get_proxy_chain_health(&chain_id).await
}

