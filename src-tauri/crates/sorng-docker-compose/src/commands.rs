// ── sorng-docker-compose/src/commands.rs ───────────────────────────────────────
// Tauri `#[tauri::command]` handlers for Docker Compose management.

use std::collections::HashMap;
use tauri::State;

use super::service::{ComposeService, ComposeServiceState};
use super::types::*;

const COMPOSE_BLOCKING_TASK_FAILED: &str = "Docker Compose operation could not complete";

async fn run_compose_blocking<T, F>(state: &ComposeServiceState, operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(ComposeService) -> Result<T, String> + Send + 'static,
{
    let service = { state.lock().await.clone() };
    tauri::async_runtime::spawn_blocking(move || operation(service))
        .await
        .map_err(|_| COMPOSE_BLOCKING_TASK_FAILED.to_string())?
}

// ── Init / Detection ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn compose_init(
    state: State<'_, ComposeServiceState>,
) -> Result<ComposeVersionInfo, String> {
    let (service, version) = tauri::async_runtime::spawn_blocking(|| {
        let mut service = ComposeService::new();
        let version = service.init().map_err(|error| error.to_string())?;
        Ok::<_, String>((service, version))
    })
    .await
    .map_err(|_| COMPOSE_BLOCKING_TASK_FAILED.to_string())??;

    *state.lock().await = service;
    Ok(version)
}

#[tauri::command]
pub async fn compose_is_available(state: State<'_, ComposeServiceState>) -> Result<bool, String> {
    run_compose_blocking(state.inner(), |service| Ok(service.is_available())).await
}

#[tauri::command]
pub async fn compose_version(
    state: State<'_, ComposeServiceState>,
) -> Result<ComposeVersionInfo, String> {
    run_compose_blocking(state.inner(), |service| {
        service.version().map_err(|error| error.to_string())
    })
    .await
}

// ── Project lifecycle ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn compose_list_projects(
    state: State<'_, ComposeServiceState>,
    all: Option<bool>,
    filter: Option<String>,
) -> Result<Vec<ComposeProject>, String> {
    run_compose_blocking(state.inner(), move |service| {
        service
            .list_projects(all.unwrap_or(false), filter.as_deref())
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn compose_up(
    state: State<'_, ComposeServiceState>,
    config: ComposeUpConfig,
) -> Result<String, String> {
    run_compose_blocking(state.inner(), move |service| {
        service.up(&config).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn compose_down(
    state: State<'_, ComposeServiceState>,
    config: ComposeDownConfig,
) -> Result<String, String> {
    run_compose_blocking(state.inner(), move |service| {
        service.down(&config).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn compose_ps(
    state: State<'_, ComposeServiceState>,
    config: ComposePsConfig,
) -> Result<Vec<ComposePsItem>, String> {
    run_compose_blocking(state.inner(), move |service| {
        service.ps(&config).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn compose_logs(
    state: State<'_, ComposeServiceState>,
    config: ComposeLogsConfig,
) -> Result<String, String> {
    run_compose_blocking(state.inner(), move |service| {
        service.logs(&config).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn compose_build(
    state: State<'_, ComposeServiceState>,
    config: ComposeBuildConfig,
) -> Result<String, String> {
    run_compose_blocking(state.inner(), move |service| {
        service.build(&config).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn compose_pull(
    state: State<'_, ComposeServiceState>,
    config: ComposePullConfig,
) -> Result<String, String> {
    run_compose_blocking(state.inner(), move |service| {
        service.pull(&config).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn compose_push(
    state: State<'_, ComposeServiceState>,
    config: ComposePushConfig,
) -> Result<String, String> {
    run_compose_blocking(state.inner(), move |service| {
        service.push(&config).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn compose_run(
    state: State<'_, ComposeServiceState>,
    config: ComposeRunConfig,
) -> Result<String, String> {
    run_compose_blocking(state.inner(), move |service| {
        service
            .compose_run(&config)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn compose_exec(
    state: State<'_, ComposeServiceState>,
    config: ComposeExecConfig,
) -> Result<String, String> {
    run_compose_blocking(state.inner(), move |service| {
        service.exec(&config).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn compose_create(
    state: State<'_, ComposeServiceState>,
    config: ComposeCreateConfig,
) -> Result<String, String> {
    run_compose_blocking(state.inner(), move |service| {
        service.create(&config).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn compose_start(
    state: State<'_, ComposeServiceState>,
    config: ComposeServiceActionConfig,
) -> Result<String, String> {
    run_compose_blocking(state.inner(), move |service| {
        service.start(&config).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn compose_stop(
    state: State<'_, ComposeServiceState>,
    config: ComposeServiceActionConfig,
) -> Result<String, String> {
    run_compose_blocking(state.inner(), move |service| {
        service.stop(&config).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn compose_restart(
    state: State<'_, ComposeServiceState>,
    config: ComposeServiceActionConfig,
) -> Result<String, String> {
    run_compose_blocking(state.inner(), move |service| {
        service.restart(&config).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn compose_pause(
    state: State<'_, ComposeServiceState>,
    config: ComposeServiceActionConfig,
) -> Result<String, String> {
    run_compose_blocking(state.inner(), move |service| {
        service.pause(&config).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn compose_unpause(
    state: State<'_, ComposeServiceState>,
    config: ComposeServiceActionConfig,
) -> Result<String, String> {
    run_compose_blocking(state.inner(), move |service| {
        service.unpause(&config).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn compose_kill(
    state: State<'_, ComposeServiceState>,
    config: ComposeServiceActionConfig,
) -> Result<String, String> {
    run_compose_blocking(state.inner(), move |service| {
        service.kill(&config).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn compose_rm(
    state: State<'_, ComposeServiceState>,
    config: ComposeRmConfig,
) -> Result<String, String> {
    run_compose_blocking(state.inner(), move |service| {
        service.rm(&config).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn compose_cp(
    state: State<'_, ComposeServiceState>,
    config: ComposeCpConfig,
) -> Result<String, String> {
    run_compose_blocking(state.inner(), move |service| {
        service.cp(&config).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn compose_top(
    state: State<'_, ComposeServiceState>,
    config: ComposeTopConfig,
) -> Result<String, String> {
    run_compose_blocking(state.inner(), move |service| {
        service.top(&config).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn compose_port(
    state: State<'_, ComposeServiceState>,
    config: ComposePortConfig,
) -> Result<String, String> {
    run_compose_blocking(state.inner(), move |service| {
        service.port(&config).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn compose_images(
    state: State<'_, ComposeServiceState>,
    config: ComposeImagesConfig,
) -> Result<String, String> {
    run_compose_blocking(state.inner(), move |service| {
        service.images(&config).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn compose_events(
    state: State<'_, ComposeServiceState>,
    config: ComposeEventsConfig,
) -> Result<String, String> {
    run_compose_blocking(state.inner(), move |service| {
        service
            .events_snapshot(&config)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn compose_config(
    state: State<'_, ComposeServiceState>,
    config: ComposeConvertConfig,
) -> Result<String, String> {
    run_compose_blocking(state.inner(), move |service| {
        service.config(&config).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn compose_watch(
    state: State<'_, ComposeServiceState>,
    config: ComposeWatchConfig,
) -> Result<String, String> {
    run_compose_blocking(state.inner(), move |service| {
        service.watch(&config).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn compose_scale(
    state: State<'_, ComposeServiceState>,
    config: ComposeScaleConfig,
) -> Result<String, String> {
    run_compose_blocking(state.inner(), move |service| {
        service.scale(&config).map_err(|error| error.to_string())
    })
    .await
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
