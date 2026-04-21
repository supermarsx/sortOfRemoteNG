//! Unified-chain Tauri command shims.
//!
//! Threading model (per global rule in `.orchestration/plans/t1.md`):
//! - Every command is `async` and returns quickly to the Tauri command thread.
//! - `connect_chain` walks enabled layers sequentially but each layer's actual
//!   tunnel (proxy / SSH / VPN) spawns its own `tokio::spawn` relay loop; the
//!   chain connect just threads allocated local ports together and returns.
//! - State is guarded by the service-level `tokio::sync::Mutex`.

use super::unified_chain::*;
use super::unified_chain_service::UnifiedChainServiceState;

#[tauri::command]
pub async fn unified_chain_create(
    name: String,
    description: Option<String>,
    layers: Vec<UnifiedChainLayer>,
    tags: Option<Vec<String>>,
    state: tauri::State<'_, UnifiedChainServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.create_chain(name, description, layers, tags).await
}

#[tauri::command]
pub async fn unified_chain_connect(
    chain_id: String,
    target_host: Option<String>,
    target_port: Option<u16>,
    state: tauri::State<'_, UnifiedChainServiceState>,
) -> Result<Option<u16>, String> {
    let mut service = state.lock().await;
    service
        .connect_chain(&chain_id, target_host, target_port)
        .await
}

#[tauri::command]
pub async fn unified_chain_disconnect(
    chain_id: String,
    state: tauri::State<'_, UnifiedChainServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.disconnect_chain(&chain_id).await
}

#[tauri::command]
pub async fn unified_chain_get(
    chain_id: String,
    state: tauri::State<'_, UnifiedChainServiceState>,
) -> Result<UnifiedChain, String> {
    let service = state.lock().await;
    service.get_chain(&chain_id).await
}

#[tauri::command]
pub async fn unified_chain_list(
    state: tauri::State<'_, UnifiedChainServiceState>,
) -> Result<Vec<UnifiedChain>, String> {
    let service = state.lock().await;
    Ok(service.list_chains().await)
}

#[tauri::command]
pub async fn unified_chain_update(
    chain_id: String,
    name: Option<String>,
    description: Option<Option<String>>,
    layers: Option<Vec<UnifiedChainLayer>>,
    tags: Option<Vec<String>>,
    state: tauri::State<'_, UnifiedChainServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service
        .update_chain(&chain_id, name, description, layers, tags)
        .await
}

#[tauri::command]
pub async fn unified_chain_delete(
    chain_id: String,
    state: tauri::State<'_, UnifiedChainServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.delete_chain(&chain_id).await
}

#[tauri::command]
pub async fn unified_chain_duplicate(
    chain_id: String,
    state: tauri::State<'_, UnifiedChainServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.duplicate_chain(&chain_id).await
}

#[tauri::command]
pub async fn unified_chain_health(
    chain_id: String,
    state: tauri::State<'_, UnifiedChainServiceState>,
) -> Result<ChainHealth, String> {
    let service = state.lock().await;
    service.get_chain_health(&chain_id).await
}

#[tauri::command]
pub async fn unified_chain_layer_toggle(
    chain_id: String,
    layer_id: String,
    enabled: bool,
    state: tauri::State<'_, UnifiedChainServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.toggle_layer(&chain_id, &layer_id, enabled).await
}

#[tauri::command]
pub async fn unified_chain_save_profile(
    profile: SavedLayerProfile,
    state: tauri::State<'_, UnifiedChainServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.save_profile(profile).await
}

#[tauri::command]
pub async fn unified_chain_list_profiles(
    state: tauri::State<'_, UnifiedChainServiceState>,
) -> Result<Vec<SavedLayerProfile>, String> {
    let service = state.lock().await;
    Ok(service.list_profiles().await)
}

#[tauri::command]
pub async fn unified_chain_delete_profile(
    profile_id: String,
    state: tauri::State<'_, UnifiedChainServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.delete_profile(&profile_id).await
}
