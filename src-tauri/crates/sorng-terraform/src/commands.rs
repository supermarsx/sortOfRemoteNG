// ── sorng-terraform/src/commands.rs ───────────────────────────────────────────
//! Tauri command handlers — every public function is a `#[tauri::command]`.

use std::collections::HashMap;

use tauri::State;

use crate::service::TerraformServiceState;
use crate::types::*;

// ── Connection lifecycle ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn terraform_connect(
    state: State<'_, TerraformServiceState>,
    id: String,
    config: TerraformConnectionConfig,
) -> Result<TerraformInfo, String> {
    let mut svc = state.lock().await;
    svc.connect(id, config).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terraform_disconnect(
    state: State<'_, TerraformServiceState>,
    id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terraform_list_connections(
    state: State<'_, TerraformServiceState>,
) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    Ok(svc.list_connections())
}

#[tauri::command]
pub async fn terraform_is_available(
    state: State<'_, TerraformServiceState>,
    id: String,
) -> Result<bool, String> {
    let svc = state.lock().await;
    svc.is_available(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terraform_get_info(
    state: State<'_, TerraformServiceState>,
    id: String,
) -> Result<TerraformInfo, String> {
    let svc = state.lock().await;
    svc.get_info(&id).await.map_err(|e| e.to_string())
}

// ── Init ─────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn terraform_init(
    state: State<'_, TerraformServiceState>,
    id: String,
    options: InitOptions,
) -> Result<InitResult, String> {
    let mut svc = state.lock().await;
    svc.init(&id, &options).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terraform_init_no_backend(
    state: State<'_, TerraformServiceState>,
    id: String,
) -> Result<InitResult, String> {
    let mut svc = state.lock().await;
    svc.init_no_backend(&id).await.map_err(|e| e.to_string())
}

// ── Plan ─────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn terraform_plan(
    state: State<'_, TerraformServiceState>,
    id: String,
    options: PlanOptions,
) -> Result<PlanResult, String> {
    let mut svc = state.lock().await;
    svc.plan(&id, &options).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terraform_show_plan_json(
    state: State<'_, TerraformServiceState>,
    id: String,
    plan_file: String,
) -> Result<PlanSummary, String> {
    let svc = state.lock().await;
    svc.show_plan_json(&id, &plan_file)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terraform_show_plan_text(
    state: State<'_, TerraformServiceState>,
    id: String,
    plan_file: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.show_plan_text(&id, &plan_file)
        .await
        .map_err(|e| e.to_string())
}

// ── Apply / Destroy / Refresh ────────────────────────────────────────────────

#[tauri::command]
pub async fn terraform_apply(
    state: State<'_, TerraformServiceState>,
    id: String,
    options: ApplyOptions,
) -> Result<ApplyResult, String> {
    let mut svc = state.lock().await;
    svc.apply(&id, &options).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terraform_destroy(
    state: State<'_, TerraformServiceState>,
    id: String,
    options: ApplyOptions,
) -> Result<ApplyResult, String> {
    let mut svc = state.lock().await;
    svc.destroy(&id, &options).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terraform_refresh(
    state: State<'_, TerraformServiceState>,
    id: String,
    options: ApplyOptions,
) -> Result<ApplyResult, String> {
    let mut svc = state.lock().await;
    svc.refresh(&id, &options).await.map_err(|e| e.to_string())
}

// ── State management ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn terraform_state_list(
    state: State<'_, TerraformServiceState>,
    id: String,
    filter: Option<String>,
) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    svc.state_list(&id, filter.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terraform_state_show(
    state: State<'_, TerraformServiceState>,
    id: String,
    address: String,
) -> Result<StateResource, String> {
    let svc = state.lock().await;
    svc.state_show(&id, &address)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terraform_state_show_json(
    state: State<'_, TerraformServiceState>,
    id: String,
) -> Result<StateSnapshot, String> {
    let svc = state.lock().await;
    svc.state_show_json(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terraform_state_pull(
    state: State<'_, TerraformServiceState>,
    id: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.state_pull(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terraform_state_push(
    state: State<'_, TerraformServiceState>,
    id: String,
    state_file: String,
    force: bool,
) -> Result<StateOperationResult, String> {
    let mut svc = state.lock().await;
    svc.state_push(&id, &state_file, force)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terraform_state_mv(
    state: State<'_, TerraformServiceState>,
    id: String,
    source: String,
    destination: String,
    dry_run: bool,
) -> Result<StateOperationResult, String> {
    let mut svc = state.lock().await;
    svc.state_mv(&id, &source, &destination, dry_run)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terraform_state_rm(
    state: State<'_, TerraformServiceState>,
    id: String,
    addresses: Vec<String>,
    dry_run: bool,
) -> Result<StateOperationResult, String> {
    let mut svc = state.lock().await;
    let refs: Vec<&str> = addresses.iter().map(|s| s.as_str()).collect();
    svc.state_rm(&id, &refs, dry_run)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terraform_state_import(
    state: State<'_, TerraformServiceState>,
    id: String,
    options: ImportOptions,
) -> Result<StateOperationResult, String> {
    let mut svc = state.lock().await;
    svc.state_import(&id, &options)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terraform_state_taint(
    state: State<'_, TerraformServiceState>,
    id: String,
    address: String,
) -> Result<StateOperationResult, String> {
    let mut svc = state.lock().await;
    svc.state_taint(&id, &address)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terraform_state_untaint(
    state: State<'_, TerraformServiceState>,
    id: String,
    address: String,
) -> Result<StateOperationResult, String> {
    let mut svc = state.lock().await;
    svc.state_untaint(&id, &address)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terraform_state_force_unlock(
    state: State<'_, TerraformServiceState>,
    id: String,
    lock_id: String,
) -> Result<StateOperationResult, String> {
    let mut svc = state.lock().await;
    svc.state_force_unlock(&id, &lock_id)
        .await
        .map_err(|e| e.to_string())
}

// ── Workspace management ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn terraform_workspace_list(
    state: State<'_, TerraformServiceState>,
    id: String,
) -> Result<Vec<WorkspaceInfo>, String> {
    let svc = state.lock().await;
    svc.workspace_list(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terraform_workspace_show(
    state: State<'_, TerraformServiceState>,
    id: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.workspace_show(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terraform_workspace_new(
    state: State<'_, TerraformServiceState>,
    id: String,
    name: String,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.workspace_new(&id, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terraform_workspace_select(
    state: State<'_, TerraformServiceState>,
    id: String,
    name: String,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.workspace_select(&id, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terraform_workspace_delete(
    state: State<'_, TerraformServiceState>,
    id: String,
    name: String,
    force: bool,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.workspace_delete(&id, &name, force)
        .await
        .map_err(|e| e.to_string())
}

// ── Validate / Format ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn terraform_validate(
    state: State<'_, TerraformServiceState>,
    id: String,
) -> Result<ValidationResult, String> {
    let svc = state.lock().await;
    svc.validate(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terraform_fmt(
    state: State<'_, TerraformServiceState>,
    id: String,
    recursive: bool,
    diff: bool,
) -> Result<FmtResult, String> {
    let mut svc = state.lock().await;
    svc.fmt(&id, recursive, diff)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terraform_fmt_check(
    state: State<'_, TerraformServiceState>,
    id: String,
) -> Result<FmtResult, String> {
    let svc = state.lock().await;
    svc.fmt_check(&id).await.map_err(|e| e.to_string())
}

// ── Outputs ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn terraform_output_list(
    state: State<'_, TerraformServiceState>,
    id: String,
) -> Result<HashMap<String, OutputValue>, String> {
    let svc = state.lock().await;
    svc.output_list(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terraform_output_get(
    state: State<'_, TerraformServiceState>,
    id: String,
    name: String,
) -> Result<OutputValue, String> {
    let svc = state.lock().await;
    svc.output_get(&id, &name).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terraform_output_get_raw(
    state: State<'_, TerraformServiceState>,
    id: String,
    name: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.output_get_raw(&id, &name)
        .await
        .map_err(|e| e.to_string())
}

// ── Providers ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn terraform_providers_list(
    state: State<'_, TerraformServiceState>,
    id: String,
) -> Result<Vec<ProviderInfo>, String> {
    let svc = state.lock().await;
    svc.providers_list(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terraform_providers_schemas(
    state: State<'_, TerraformServiceState>,
    id: String,
) -> Result<Vec<ProviderSchema>, String> {
    let svc = state.lock().await;
    svc.providers_schemas(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terraform_providers_lock(
    state: State<'_, TerraformServiceState>,
    id: String,
    platforms: Vec<String>,
) -> Result<StateOperationResult, String> {
    let mut svc = state.lock().await;
    svc.providers_lock(&id, &platforms)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terraform_providers_mirror(
    state: State<'_, TerraformServiceState>,
    id: String,
    target_dir: String,
    platforms: Vec<String>,
) -> Result<StateOperationResult, String> {
    let mut svc = state.lock().await;
    svc.providers_mirror(&id, &target_dir, &platforms)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terraform_providers_parse_lock_file(
    state: State<'_, TerraformServiceState>,
    id: String,
) -> Result<Vec<ProviderLockEntry>, String> {
    let svc = state.lock().await;
    svc.providers_parse_lock_file(&id)
        .await
        .map_err(|e| e.to_string())
}

// ── Modules ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn terraform_modules_get(
    state: State<'_, TerraformServiceState>,
    id: String,
    update: bool,
) -> Result<StateOperationResult, String> {
    let mut svc = state.lock().await;
    svc.modules_get(&id, update)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terraform_modules_list_installed(
    state: State<'_, TerraformServiceState>,
    id: String,
) -> Result<Vec<ModuleRef>, String> {
    let svc = state.lock().await;
    svc.modules_list_installed(&id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terraform_modules_search_registry(
    state: State<'_, TerraformServiceState>,
    id: String,
    options: RegistrySearchOptions,
) -> Result<Vec<RegistryModule>, String> {
    let svc = state.lock().await;
    svc.modules_search_registry(&id, &options)
        .await
        .map_err(|e| e.to_string())
}

// ── Graph ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn terraform_graph_generate(
    state: State<'_, TerraformServiceState>,
    id: String,
    graph_type: Option<String>,
) -> Result<GraphResult, String> {
    let svc = state.lock().await;
    svc.graph_generate(&id, graph_type.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terraform_graph_plan(
    state: State<'_, TerraformServiceState>,
    id: String,
    plan_file: String,
) -> Result<GraphResult, String> {
    let svc = state.lock().await;
    svc.graph_plan(&id, &plan_file)
        .await
        .map_err(|e| e.to_string())
}

// ── HCL Analysis ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn terraform_hcl_analyse(
    state: State<'_, TerraformServiceState>,
    id: String,
) -> Result<HclAnalysis, String> {
    let svc = state.lock().await;
    svc.hcl_analyse(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terraform_hcl_analyse_file(
    state: State<'_, TerraformServiceState>,
    content: String,
    filename: String,
) -> Result<HclAnalysis, String> {
    let svc = state.lock().await;
    Ok(svc.hcl_analyse_file(&content, &filename))
}

#[tauri::command]
pub async fn terraform_hcl_summarise(
    state: State<'_, TerraformServiceState>,
    analysis: HclAnalysis,
) -> Result<ConfigurationSummary, String> {
    let svc = state.lock().await;
    Ok(svc.hcl_summarise(&analysis))
}

// ── Drift detection ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn terraform_drift_detect(
    state: State<'_, TerraformServiceState>,
    id: String,
) -> Result<DriftResult, String> {
    let mut svc = state.lock().await;
    svc.drift_detect(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terraform_drift_has_drift(
    state: State<'_, TerraformServiceState>,
    id: String,
) -> Result<bool, String> {
    let svc = state.lock().await;
    svc.drift_has_drift(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terraform_drift_compare_snapshots(
    state: State<'_, TerraformServiceState>,
    before: StateSnapshot,
    after: StateSnapshot,
) -> Result<Vec<DriftedResource>, String> {
    let svc = state.lock().await;
    Ok(svc.drift_compare_snapshots(&before, &after))
}

// ── History ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn terraform_history_list(
    state: State<'_, TerraformServiceState>,
) -> Result<Vec<ExecutionHistoryEntry>, String> {
    let svc = state.lock().await;
    Ok(svc.history_list())
}

#[tauri::command]
pub async fn terraform_history_get(
    state: State<'_, TerraformServiceState>,
    exec_id: String,
) -> Result<Option<ExecutionHistoryEntry>, String> {
    let svc = state.lock().await;
    Ok(svc.history_get(&exec_id))
}

#[tauri::command]
pub async fn terraform_history_clear(
    state: State<'_, TerraformServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.history_clear();
    Ok(())
}
