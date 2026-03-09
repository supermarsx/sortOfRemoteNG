// ── sorng-docker-compose/src/commands.rs ───────────────────────────────────────
//! Tauri `#[tauri::command]` handlers for Docker Compose management.

use std::collections::HashMap;
use tauri::State;

use crate::service::ComposeServiceState;
use crate::types::*;

// ── Init / Detection ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn compose_init(
    state: State<'_, ComposeServiceState>,
) -> Result<ComposeVersionInfo, String> {
    let mut svc = state.lock().await;
    svc.init().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn compose_is_available(state: State<'_, ComposeServiceState>) -> Result<bool, String> {
    let svc = state.lock().await;
    Ok(svc.is_available())
}

#[tauri::command]
pub async fn compose_version(
    state: State<'_, ComposeServiceState>,
) -> Result<ComposeVersionInfo, String> {
    let svc = state.lock().await;
    svc.version().map_err(|e| e.to_string())
}

// ── Project lifecycle ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn compose_list_projects(
    state: State<'_, ComposeServiceState>,
    all: Option<bool>,
    filter: Option<String>,
) -> Result<Vec<ComposeProject>, String> {
    let svc = state.lock().await;
    svc.list_projects(all.unwrap_or(false), filter.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn compose_up(
    state: State<'_, ComposeServiceState>,
    config: ComposeUpConfig,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.up(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn compose_down(
    state: State<'_, ComposeServiceState>,
    config: ComposeDownConfig,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.down(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn compose_ps(
    state: State<'_, ComposeServiceState>,
    config: ComposePsConfig,
) -> Result<Vec<ComposePsItem>, String> {
    let svc = state.lock().await;
    svc.ps(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn compose_logs(
    state: State<'_, ComposeServiceState>,
    config: ComposeLogsConfig,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.logs(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn compose_build(
    state: State<'_, ComposeServiceState>,
    config: ComposeBuildConfig,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.build(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn compose_pull(
    state: State<'_, ComposeServiceState>,
    config: ComposePullConfig,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.pull(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn compose_push(
    state: State<'_, ComposeServiceState>,
    config: ComposePushConfig,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.push(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn compose_run(
    state: State<'_, ComposeServiceState>,
    config: ComposeRunConfig,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.compose_run(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn compose_exec(
    state: State<'_, ComposeServiceState>,
    config: ComposeExecConfig,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.exec(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn compose_create(
    state: State<'_, ComposeServiceState>,
    config: ComposeCreateConfig,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.create(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn compose_start(
    state: State<'_, ComposeServiceState>,
    config: ComposeServiceActionConfig,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.start(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn compose_stop(
    state: State<'_, ComposeServiceState>,
    config: ComposeServiceActionConfig,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.stop(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn compose_restart(
    state: State<'_, ComposeServiceState>,
    config: ComposeServiceActionConfig,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.restart(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn compose_pause(
    state: State<'_, ComposeServiceState>,
    config: ComposeServiceActionConfig,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.pause(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn compose_unpause(
    state: State<'_, ComposeServiceState>,
    config: ComposeServiceActionConfig,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.unpause(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn compose_kill(
    state: State<'_, ComposeServiceState>,
    config: ComposeServiceActionConfig,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.kill(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn compose_rm(
    state: State<'_, ComposeServiceState>,
    config: ComposeRmConfig,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.rm(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn compose_cp(
    state: State<'_, ComposeServiceState>,
    config: ComposeCpConfig,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.cp(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn compose_top(
    state: State<'_, ComposeServiceState>,
    config: ComposeTopConfig,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.top(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn compose_port(
    state: State<'_, ComposeServiceState>,
    config: ComposePortConfig,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.port(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn compose_images(
    state: State<'_, ComposeServiceState>,
    config: ComposeImagesConfig,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.images(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn compose_events(
    state: State<'_, ComposeServiceState>,
    config: ComposeEventsConfig,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.events_snapshot(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn compose_config(
    state: State<'_, ComposeServiceState>,
    config: ComposeConvertConfig,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.config(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn compose_watch(
    state: State<'_, ComposeServiceState>,
    config: ComposeWatchConfig,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.watch(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn compose_scale(
    state: State<'_, ComposeServiceState>,
    config: ComposeScaleConfig,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.scale(&config).map_err(|e| e.to_string())
}

// ── Parser / File operations ──────────────────────────────────────────────────

#[tauri::command]
pub async fn compose_parse_file(
    state: State<'_, ComposeServiceState>,
    path: String,
) -> Result<ComposeFile, String> {
    let svc = state.lock().await;
    svc.parse_file(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn compose_parse_yaml(
    state: State<'_, ComposeServiceState>,
    content: String,
) -> Result<ComposeFile, String> {
    let svc = state.lock().await;
    svc.parse_yaml(&content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn compose_discover_files(
    state: State<'_, ComposeServiceState>,
    dir: String,
) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    Ok(svc.discover_files(&dir))
}

#[tauri::command]
pub async fn compose_merge_files(
    state: State<'_, ComposeServiceState>,
    paths: Vec<String>,
) -> Result<ComposeFile, String> {
    let svc = state.lock().await;
    svc.merge_files(&paths).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn compose_validate(
    state: State<'_, ComposeServiceState>,
    compose: ComposeFile,
) -> Result<ComposeValidation, String> {
    let svc = state.lock().await;
    Ok(svc.validate(&compose))
}

#[tauri::command]
pub async fn compose_interpolate(
    state: State<'_, ComposeServiceState>,
    content: String,
    vars: HashMap<String, String>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.interpolate(&content, &vars).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn compose_parse_env_file(
    state: State<'_, ComposeServiceState>,
    path: String,
) -> Result<EnvFile, String> {
    let svc = state.lock().await;
    svc.parse_env_file(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn compose_to_yaml(
    state: State<'_, ComposeServiceState>,
    compose: ComposeFile,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.to_yaml(&compose).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn compose_to_json(
    state: State<'_, ComposeServiceState>,
    compose: ComposeFile,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.to_json(&compose).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn compose_write_file(
    state: State<'_, ComposeServiceState>,
    compose: ComposeFile,
    path: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.write_file(&compose, &path).map_err(|e| e.to_string())
}

// ── Dependency graph ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn compose_dependency_graph(
    state: State<'_, ComposeServiceState>,
    compose: ComposeFile,
) -> Result<DependencyGraph, String> {
    let svc = state.lock().await;
    svc.dependency_graph(&compose).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn compose_startup_order(
    state: State<'_, ComposeServiceState>,
    compose: ComposeFile,
    services: Vec<String>,
) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    svc.startup_order(&compose, &services)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn compose_shutdown_order(
    state: State<'_, ComposeServiceState>,
    compose: ComposeFile,
) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    svc.shutdown_order(&compose).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn compose_dependents(
    state: State<'_, ComposeServiceState>,
    compose: ComposeFile,
    service: String,
) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    Ok(svc.dependents(&compose, &service))
}

// ── Profiles ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn compose_list_profiles(
    state: State<'_, ComposeServiceState>,
    compose: ComposeFile,
) -> Result<Vec<ComposeProfile>, String> {
    let svc = state.lock().await;
    Ok(svc.list_profiles(&compose))
}

#[tauri::command]
pub async fn compose_profile_names(
    state: State<'_, ComposeServiceState>,
    compose: ComposeFile,
) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    Ok(svc.profile_names(&compose))
}

#[tauri::command]
pub async fn compose_active_services(
    state: State<'_, ComposeServiceState>,
    compose: ComposeFile,
    profiles: Vec<String>,
) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    Ok(svc.active_services(&compose, &profiles))
}

#[tauri::command]
pub async fn compose_validate_profile_deps(
    state: State<'_, ComposeServiceState>,
    compose: ComposeFile,
    profiles: Vec<String>,
) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    Ok(svc.validate_profile_deps(&compose, &profiles))
}

// ── Templates ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn compose_list_templates(
    state: State<'_, ComposeServiceState>,
) -> Result<Vec<ComposeTemplate>, String> {
    let svc = state.lock().await;
    Ok(svc.list_templates())
}

#[tauri::command]
pub async fn compose_get_template(
    state: State<'_, ComposeServiceState>,
    name: String,
) -> Result<ComposeTemplate, String> {
    let svc = state.lock().await;
    svc.get_template(&name).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn compose_template_categories(
    state: State<'_, ComposeServiceState>,
) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    Ok(svc.template_categories())
}

#[tauri::command]
pub async fn compose_templates_by_category(
    state: State<'_, ComposeServiceState>,
    category: String,
) -> Result<Vec<ComposeTemplate>, String> {
    let svc = state.lock().await;
    Ok(svc.templates_by_category(&category))
}

#[tauri::command]
pub async fn compose_scaffold(
    state: State<'_, ComposeServiceState>,
    template_name: String,
    dir: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.scaffold_from_template(&template_name, &dir)
        .map_err(|e| e.to_string())
}
