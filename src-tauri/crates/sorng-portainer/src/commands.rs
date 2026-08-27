// ── sorng-portainer/src/commands.rs ──────────────────────────────────────────
// Tauri commands – thin wrappers around `PortainerService`.
//
// NOT a module of this crate: included by the commands crate via
// `#[path = "../../sorng-commands-ops/src/portainer_commands.rs"]` shim, so
// `super::` resolves to that crate's re-export of `sorng_portainer`.

use super::service::PortainerServiceState;
use super::types::*;
use tauri::State;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ── Connection ────────────────────────────────────────────────────

#[tauri::command]
pub async fn portainer_connect(
    state: State<'_, PortainerServiceState>,
    id: String,
    config: PortainerConnectionConfig,
) -> CmdResult<PortainerConnectionSummary> {
    state
        .lock()
        .await
        .connect(id, config)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn portainer_disconnect(
    state: State<'_, PortainerServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.disconnect(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn portainer_list_connections(
    state: State<'_, PortainerServiceState>,
) -> CmdResult<Vec<String>> {
    Ok(state.lock().await.list_connections())
}

#[tauri::command]
pub async fn portainer_ping(
    state: State<'_, PortainerServiceState>,
    id: String,
) -> CmdResult<PortainerConnectionSummary> {
    state.lock().await.ping(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn portainer_web_ui_url(
    state: State<'_, PortainerServiceState>,
    id: String,
) -> CmdResult<String> {
    state.lock().await.web_ui_url(&id).map_err(map_err)
}

// ── Environments ──────────────────────────────────────────────────

#[tauri::command]
pub async fn portainer_list_endpoints(
    state: State<'_, PortainerServiceState>,
    id: String,
) -> CmdResult<Vec<PortainerEndpoint>> {
    state.lock().await.list_endpoints(&id).await.map_err(map_err)
}

// ── Containers ────────────────────────────────────────────────────

#[tauri::command]
pub async fn portainer_list_containers(
    state: State<'_, PortainerServiceState>,
    id: String,
    endpoint_id: u64,
    all: Option<bool>,
) -> CmdResult<Vec<PortainerContainer>> {
    state
        .lock()
        .await
        .list_containers(&id, endpoint_id, all.unwrap_or(true))
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn portainer_start_container(
    state: State<'_, PortainerServiceState>,
    id: String,
    endpoint_id: u64,
    container_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .start_container(&id, endpoint_id, &container_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn portainer_stop_container(
    state: State<'_, PortainerServiceState>,
    id: String,
    endpoint_id: u64,
    container_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .stop_container(&id, endpoint_id, &container_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn portainer_restart_container(
    state: State<'_, PortainerServiceState>,
    id: String,
    endpoint_id: u64,
    container_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .restart_container(&id, endpoint_id, &container_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn portainer_container_logs(
    state: State<'_, PortainerServiceState>,
    id: String,
    endpoint_id: u64,
    container_id: String,
    tail: Option<u32>,
) -> CmdResult<Vec<PortainerLogLine>> {
    state
        .lock()
        .await
        .container_logs(&id, endpoint_id, &container_id, tail.unwrap_or(200))
        .await
        .map_err(map_err)
}

// ── Stacks ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn portainer_list_stacks(
    state: State<'_, PortainerServiceState>,
    id: String,
) -> CmdResult<Vec<PortainerStack>> {
    state.lock().await.list_stacks(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn portainer_start_stack(
    state: State<'_, PortainerServiceState>,
    id: String,
    stack_id: u64,
    endpoint_id: u64,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .start_stack(&id, stack_id, endpoint_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn portainer_stop_stack(
    state: State<'_, PortainerServiceState>,
    id: String,
    stack_id: u64,
    endpoint_id: u64,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .stop_stack(&id, stack_id, endpoint_id)
        .await
        .map_err(map_err)
}
