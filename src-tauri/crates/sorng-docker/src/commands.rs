// ── sorng-docker/src/commands.rs ──────────────────────────────────────────────
// Tauri command handlers for Docker daemon management.

use tauri::State;

use super::service::DockerServiceState;
use super::types::*;

// ── Connection lifecycle ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn docker_connect(
    state: State<'_, DockerServiceState>,
    id: String,
    config: DockerConnectionConfig,
) -> Result<DockerSystemInfo, String> {
    let mut svc = state.lock().await;
    svc.connect(id, config).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_disconnect(
    state: State<'_, DockerServiceState>,
    id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_list_connections(
    state: State<'_, DockerServiceState>,
) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    Ok(svc.list_connections())
}

// ── System ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn docker_system_info(
    state: State<'_, DockerServiceState>,
    id: String,
) -> Result<DockerSystemInfo, String> {
    let svc = state.lock().await;
    svc.system_info(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_system_version(
    state: State<'_, DockerServiceState>,
    id: String,
) -> Result<DockerVersionInfo, String> {
    let svc = state.lock().await;
    svc.system_version(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_ping(state: State<'_, DockerServiceState>, id: String) -> Result<bool, String> {
    let svc = state.lock().await;
    svc.ping(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_disk_usage(
    state: State<'_, DockerServiceState>,
    id: String,
) -> Result<DockerDiskUsage, String> {
    let svc = state.lock().await;
    svc.disk_usage(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_system_events(
    state: State<'_, DockerServiceState>,
    id: String,
    filter: Option<DockerEventFilter>,
) -> Result<Vec<DockerEvent>, String> {
    let svc = state.lock().await;
    svc.system_events(&id, &filter.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_system_prune(
    state: State<'_, DockerServiceState>,
    id: String,
    all: Option<bool>,
    volumes: Option<bool>,
) -> Result<PruneResult, String> {
    let svc = state.lock().await;
    svc.system_prune(&id, all.unwrap_or(false), volumes.unwrap_or(false))
        .await
        .map_err(|e| e.to_string())
}

// ── Containers ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn docker_list_containers(
    state: State<'_, DockerServiceState>,
    id: String,
    opts: Option<ListContainersOptions>,
) -> Result<Vec<ContainerSummary>, String> {
    let svc = state.lock().await;
    svc.list_containers(&id, &opts.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_inspect_container(
    state: State<'_, DockerServiceState>,
    id: String,
    container_id: String,
) -> Result<ContainerInspect, String> {
    let svc = state.lock().await;
    svc.inspect_container(&id, &container_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_create_container(
    state: State<'_, DockerServiceState>,
    id: String,
    config: CreateContainerConfig,
) -> Result<CreateContainerResponse, String> {
    let svc = state.lock().await;
    svc.create_container(&id, &config)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_run_container(
    state: State<'_, DockerServiceState>,
    id: String,
    config: CreateContainerConfig,
) -> Result<CreateContainerResponse, String> {
    let svc = state.lock().await;
    svc.run_container(&id, &config)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_start_container(
    state: State<'_, DockerServiceState>,
    id: String,
    container_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.start_container(&id, &container_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_stop_container(
    state: State<'_, DockerServiceState>,
    id: String,
    container_id: String,
    timeout: Option<i32>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.stop_container(&id, &container_id, timeout)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_restart_container(
    state: State<'_, DockerServiceState>,
    id: String,
    container_id: String,
    timeout: Option<i32>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.restart_container(&id, &container_id, timeout)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_kill_container(
    state: State<'_, DockerServiceState>,
    id: String,
    container_id: String,
    signal: Option<String>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.kill_container(&id, &container_id, signal)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_pause_container(
    state: State<'_, DockerServiceState>,
    id: String,
    container_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.pause_container(&id, &container_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_unpause_container(
    state: State<'_, DockerServiceState>,
    id: String,
    container_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.unpause_container(&id, &container_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_remove_container(
    state: State<'_, DockerServiceState>,
    id: String,
    container_id: String,
    force: Option<bool>,
    remove_volumes: Option<bool>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.remove_container(
        &id,
        &container_id,
        force.unwrap_or(false),
        remove_volumes.unwrap_or(false),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_rename_container(
    state: State<'_, DockerServiceState>,
    id: String,
    container_id: String,
    new_name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.rename_container(&id, &container_id, &new_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_container_logs(
    state: State<'_, DockerServiceState>,
    id: String,
    container_id: String,
    opts: Option<ContainerLogOptions>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.container_logs(&id, &container_id, &opts.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_container_stats(
    state: State<'_, DockerServiceState>,
    id: String,
    container_id: String,
) -> Result<ContainerStats, String> {
    let svc = state.lock().await;
    svc.container_stats(&id, &container_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_container_top(
    state: State<'_, DockerServiceState>,
    id: String,
    container_id: String,
    ps_args: Option<String>,
) -> Result<ContainerTop, String> {
    let svc = state.lock().await;
    svc.container_top(&id, &container_id, ps_args)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_container_changes(
    state: State<'_, DockerServiceState>,
    id: String,
    container_id: String,
) -> Result<Vec<ContainerChange>, String> {
    let svc = state.lock().await;
    svc.container_changes(&id, &container_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_container_wait(
    state: State<'_, DockerServiceState>,
    id: String,
    container_id: String,
) -> Result<ContainerWaitResult, String> {
    let svc = state.lock().await;
    svc.container_wait(&id, &container_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_container_exec(
    state: State<'_, DockerServiceState>,
    id: String,
    container_id: String,
    config: ExecConfig,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.container_exec(&id, &container_id, &config)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_container_update(
    state: State<'_, DockerServiceState>,
    id: String,
    container_id: String,
    update: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.container_update(&id, &container_id, &update)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_prune_containers(
    state: State<'_, DockerServiceState>,
    id: String,
) -> Result<PruneResult, String> {
    let svc = state.lock().await;
    svc.prune_containers(&id).await.map_err(|e| e.to_string())
}

// ── Images ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn docker_list_images(
    state: State<'_, DockerServiceState>,
    id: String,
    opts: Option<ListImagesOptions>,
) -> Result<Vec<ImageSummary>, String> {
    let svc = state.lock().await;
    svc.list_images(&id, &opts.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_inspect_image(
    state: State<'_, DockerServiceState>,
    id: String,
    name: String,
) -> Result<ImageInspect, String> {
    let svc = state.lock().await;
    svc.inspect_image(&id, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_image_history(
    state: State<'_, DockerServiceState>,
    id: String,
    name: String,
) -> Result<Vec<ImageHistoryEntry>, String> {
    let svc = state.lock().await;
    svc.image_history(&id, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_pull_image(
    state: State<'_, DockerServiceState>,
    id: String,
    image: String,
    tag: Option<String>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.pull_image(&id, &image, tag)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_tag_image(
    state: State<'_, DockerServiceState>,
    id: String,
    source: String,
    repo: String,
    tag: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.tag_image(&id, &source, &repo, &tag)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_push_image(
    state: State<'_, DockerServiceState>,
    id: String,
    name: String,
    tag: Option<String>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.push_image(&id, &name, tag)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_remove_image(
    state: State<'_, DockerServiceState>,
    id: String,
    name: String,
    force: Option<bool>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.remove_image(&id, &name, force.unwrap_or(false))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_search_images(
    state: State<'_, DockerServiceState>,
    id: String,
    term: String,
    limit: Option<i32>,
) -> Result<Vec<RegistrySearchResult>, String> {
    let svc = state.lock().await;
    svc.search_images(&id, &term, limit)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_prune_images(
    state: State<'_, DockerServiceState>,
    id: String,
    dangling_only: Option<bool>,
) -> Result<PruneResult, String> {
    let svc = state.lock().await;
    svc.prune_images(&id, dangling_only.unwrap_or(true))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_commit_container(
    state: State<'_, DockerServiceState>,
    id: String,
    container_id: String,
    repo: String,
    tag: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.commit_container(&id, &container_id, &repo, &tag)
        .await
        .map_err(|e| e.to_string())
}

// ── Volumes ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn docker_list_volumes(
    state: State<'_, DockerServiceState>,
    id: String,
    opts: Option<ListVolumesOptions>,
) -> Result<Vec<VolumeInfo>, String> {
    let svc = state.lock().await;
    svc.list_volumes(&id, &opts.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_inspect_volume(
    state: State<'_, DockerServiceState>,
    id: String,
    name: String,
) -> Result<VolumeInfo, String> {
    let svc = state.lock().await;
    svc.inspect_volume(&id, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_create_volume(
    state: State<'_, DockerServiceState>,
    id: String,
    config: CreateVolumeConfig,
) -> Result<VolumeInfo, String> {
    let svc = state.lock().await;
    svc.create_volume(&id, &config)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_remove_volume(
    state: State<'_, DockerServiceState>,
    id: String,
    name: String,
    force: Option<bool>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.remove_volume(&id, &name, force.unwrap_or(false))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_prune_volumes(
    state: State<'_, DockerServiceState>,
    id: String,
) -> Result<PruneResult, String> {
    let svc = state.lock().await;
    svc.prune_volumes(&id).await.map_err(|e| e.to_string())
}

// ── Networks ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn docker_list_networks(
    state: State<'_, DockerServiceState>,
    id: String,
    opts: Option<ListNetworksOptions>,
) -> Result<Vec<NetworkInfo>, String> {
    let svc = state.lock().await;
    svc.list_networks(&id, &opts.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_inspect_network(
    state: State<'_, DockerServiceState>,
    id: String,
    network_id: String,
) -> Result<NetworkInfo, String> {
    let svc = state.lock().await;
    svc.inspect_network(&id, &network_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_create_network(
    state: State<'_, DockerServiceState>,
    id: String,
    config: CreateNetworkConfig,
) -> Result<CreateNetworkResponse, String> {
    let svc = state.lock().await;
    svc.create_network(&id, &config)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_remove_network(
    state: State<'_, DockerServiceState>,
    id: String,
    network_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.remove_network(&id, &network_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_connect_network(
    state: State<'_, DockerServiceState>,
    id: String,
    network_id: String,
    config: ConnectNetworkConfig,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.connect_network(&id, &network_id, &config)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_disconnect_network(
    state: State<'_, DockerServiceState>,
    id: String,
    network_id: String,
    container_id: String,
    force: Option<bool>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.disconnect_network(&id, &network_id, &container_id, force.unwrap_or(false))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_prune_networks(
    state: State<'_, DockerServiceState>,
    id: String,
) -> Result<PruneResult, String> {
    let svc = state.lock().await;
    svc.prune_networks(&id).await.map_err(|e| e.to_string())
}

// ── Compose ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn docker_compose_is_available(
    state: State<'_, DockerServiceState>,
) -> Result<bool, String> {
    let svc = state.lock().await;
    Ok(svc.compose_is_available())
}

#[tauri::command]
pub async fn docker_compose_version(
    state: State<'_, DockerServiceState>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.compose_version().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_compose_list_projects(
    state: State<'_, DockerServiceState>,
) -> Result<Vec<ComposeProject>, String> {
    let svc = state.lock().await;
    svc.compose_list_projects().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_compose_up(
    state: State<'_, DockerServiceState>,
    config: ComposeUpConfig,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.compose_up(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_compose_down(
    state: State<'_, DockerServiceState>,
    config: ComposeDownConfig,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.compose_down(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_compose_ps(
    state: State<'_, DockerServiceState>,
    files: Vec<String>,
    project_name: Option<String>,
) -> Result<Vec<ComposePsItem>, String> {
    let svc = state.lock().await;
    svc.compose_ps(&files, project_name.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_compose_logs(
    state: State<'_, DockerServiceState>,
    config: ComposeLogsConfig,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.compose_logs(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_compose_build(
    state: State<'_, DockerServiceState>,
    config: ComposeBuildConfig,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.compose_build(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_compose_pull(
    state: State<'_, DockerServiceState>,
    config: ComposePullConfig,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.compose_pull(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_compose_restart(
    state: State<'_, DockerServiceState>,
    files: Vec<String>,
    project_name: Option<String>,
    services: Option<Vec<String>>,
    timeout: Option<i32>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.compose_restart(
        &files,
        project_name.as_deref(),
        services.as_deref(),
        timeout,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_compose_stop(
    state: State<'_, DockerServiceState>,
    files: Vec<String>,
    project_name: Option<String>,
    services: Option<Vec<String>>,
    timeout: Option<i32>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.compose_stop(
        &files,
        project_name.as_deref(),
        services.as_deref(),
        timeout,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_compose_start(
    state: State<'_, DockerServiceState>,
    files: Vec<String>,
    project_name: Option<String>,
    services: Option<Vec<String>>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.compose_start(&files, project_name.as_deref(), services.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_compose_config(
    state: State<'_, DockerServiceState>,
    files: Vec<String>,
    project_name: Option<String>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.compose_config(&files, project_name.as_deref())
        .map_err(|e| e.to_string())
}

// ── Registry ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn docker_registry_login(
    state: State<'_, DockerServiceState>,
    id: String,
    creds: RegistryCredentials,
) -> Result<RegistryAuthResult, String> {
    let svc = state.lock().await;
    svc.registry_login(&id, &creds)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_registry_search(
    state: State<'_, DockerServiceState>,
    id: String,
    term: String,
    limit: Option<i32>,
) -> Result<Vec<RegistrySearchResult>, String> {
    let svc = state.lock().await;
    svc.registry_search(&id, &term, limit)
        .await
        .map_err(|e| e.to_string())
}
