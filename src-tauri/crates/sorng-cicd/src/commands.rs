// ── sorng-cicd/src/commands.rs ───────────────────────────────────────────────
// Tauri commands – thin wrappers around `CicdService`.

use super::service::CicdServiceState;
use super::types::*;
use tauri::State;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ── Connection ────────────────────────────────────────────────────

#[tauri::command]
pub async fn cicd_connect(
    state: State<'_, CicdServiceState>,
    id: String,
    config: CicdConnectionConfig,
) -> CmdResult<CicdConnectionSummary> {
    state
        .lock()
        .await
        .connect(id, config)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_disconnect(state: State<'_, CicdServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.disconnect(&id).map_err(map_err)
}

#[tauri::command]
pub async fn cicd_list_connections(state: State<'_, CicdServiceState>) -> CmdResult<Vec<String>> {
    Ok(state.lock().await.list_connections())
}

#[tauri::command]
pub async fn cicd_ping(
    state: State<'_, CicdServiceState>,
    id: String,
) -> CmdResult<CicdConnectionSummary> {
    state.lock().await.ping(&id).await.map_err(map_err)
}

// ── Dashboard ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn cicd_get_dashboard(
    state: State<'_, CicdServiceState>,
    id: String,
) -> CmdResult<CicdDashboard> {
    state.lock().await.get_dashboard(&id).await.map_err(map_err)
}

// ── Unified pipelines ─────────────────────────────────────────────

#[tauri::command]
pub async fn cicd_list_pipelines(
    state: State<'_, CicdServiceState>,
    id: String,
) -> CmdResult<Vec<CicdPipeline>> {
    state
        .lock()
        .await
        .list_pipelines(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_get_pipeline(
    state: State<'_, CicdServiceState>,
    id: String,
    pipeline_id: String,
) -> CmdResult<CicdPipeline> {
    state
        .lock()
        .await
        .get_pipeline(&id, &pipeline_id)
        .await
        .map_err(map_err)
}

// ── Unified builds ────────────────────────────────────────────────

#[tauri::command]
pub async fn cicd_list_builds(
    state: State<'_, CicdServiceState>,
    id: String,
) -> CmdResult<Vec<CicdBuild>> {
    state.lock().await.list_builds(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn cicd_get_build(
    state: State<'_, CicdServiceState>,
    id: String,
    build_id: String,
) -> CmdResult<CicdBuild> {
    state
        .lock()
        .await
        .get_build(&id, &build_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_trigger_build(
    state: State<'_, CicdServiceState>,
    id: String,
    pipeline_id: String,
    branch: Option<String>,
) -> CmdResult<CicdBuild> {
    state
        .lock()
        .await
        .trigger_build(&id, &pipeline_id, branch)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_cancel_build(
    state: State<'_, CicdServiceState>,
    id: String,
    build_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .cancel_build(&id, &build_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_restart_build(
    state: State<'_, CicdServiceState>,
    id: String,
    build_id: String,
) -> CmdResult<CicdBuild> {
    state
        .lock()
        .await
        .restart_build(&id, &build_id)
        .await
        .map_err(map_err)
}

// ── Build logs ────────────────────────────────────────────────────

#[tauri::command]
pub async fn cicd_get_build_logs(
    state: State<'_, CicdServiceState>,
    id: String,
    build_id: String,
    stage: Option<u32>,
    step: Option<u32>,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .get_build_logs(&id, &build_id, stage, step)
        .await
        .map_err(map_err)
}

// ── Unified artifacts ─────────────────────────────────────────────

#[tauri::command]
pub async fn cicd_list_artifacts(
    state: State<'_, CicdServiceState>,
    id: String,
    build_id: String,
) -> CmdResult<Vec<CicdArtifact>> {
    state
        .lock()
        .await
        .list_artifacts(&id, &build_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_get_artifact(
    state: State<'_, CicdServiceState>,
    id: String,
    artifact_id: String,
) -> CmdResult<CicdArtifact> {
    state
        .lock()
        .await
        .get_artifact(&id, &artifact_id)
        .await
        .map_err(map_err)
}

// ── Unified secrets ───────────────────────────────────────────────

#[tauri::command]
pub async fn cicd_list_secrets(
    state: State<'_, CicdServiceState>,
    id: String,
) -> CmdResult<Vec<CicdSecret>> {
    state.lock().await.list_secrets(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn cicd_create_secret(
    state: State<'_, CicdServiceState>,
    id: String,
    payload: CreateSecretPayload,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .create_secret(&id, payload)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_delete_secret(
    state: State<'_, CicdServiceState>,
    id: String,
    secret_name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_secret(&id, &secret_name)
        .await
        .map_err(map_err)
}

// ── Drone-specific ────────────────────────────────────────────────

#[tauri::command]
pub async fn cicd_drone_list_repos(
    state: State<'_, CicdServiceState>,
    id: String,
) -> CmdResult<Vec<DroneRepo>> {
    state
        .lock()
        .await
        .drone_list_repos(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_drone_get_repo(
    state: State<'_, CicdServiceState>,
    id: String,
    owner: String,
    name: String,
) -> CmdResult<DroneRepo> {
    state
        .lock()
        .await
        .drone_get_repo(&id, &owner, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_drone_activate_repo(
    state: State<'_, CicdServiceState>,
    id: String,
    owner: String,
    name: String,
) -> CmdResult<DroneRepo> {
    state
        .lock()
        .await
        .drone_activate_repo(&id, &owner, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_drone_deactivate_repo(
    state: State<'_, CicdServiceState>,
    id: String,
    owner: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .drone_deactivate_repo(&id, &owner, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_drone_list_cron_jobs(
    state: State<'_, CicdServiceState>,
    id: String,
    owner: String,
    name: String,
) -> CmdResult<Vec<DroneCron>> {
    state
        .lock()
        .await
        .drone_list_cron_jobs(&id, &owner, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_drone_create_cron_job(
    state: State<'_, CicdServiceState>,
    id: String,
    owner: String,
    name: String,
    cron: CreateDroneCronPayload,
) -> CmdResult<DroneCron> {
    state
        .lock()
        .await
        .drone_create_cron_job(&id, &owner, &name, cron)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_drone_delete_cron_job(
    state: State<'_, CicdServiceState>,
    id: String,
    owner: String,
    name: String,
    cron_name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .drone_delete_cron_job(&id, &owner, &name, &cron_name)
        .await
        .map_err(map_err)
}

// ── Jenkins-specific ──────────────────────────────────────────────

#[tauri::command]
pub async fn cicd_jenkins_list_jobs(
    state: State<'_, CicdServiceState>,
    id: String,
) -> CmdResult<Vec<JenkinsJob>> {
    state
        .lock()
        .await
        .jenkins_list_jobs(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_jenkins_get_job(
    state: State<'_, CicdServiceState>,
    id: String,
    name: String,
) -> CmdResult<JenkinsJob> {
    state
        .lock()
        .await
        .jenkins_get_job(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_jenkins_create_job(
    state: State<'_, CicdServiceState>,
    id: String,
    name: String,
    config_xml: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .jenkins_create_job(&id, &name, &config_xml)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_jenkins_delete_job(
    state: State<'_, CicdServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .jenkins_delete_job(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_jenkins_get_console_output(
    state: State<'_, CicdServiceState>,
    id: String,
    job_name: String,
    number: u64,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .jenkins_get_console_output(&id, &job_name, number)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_jenkins_list_queue(
    state: State<'_, CicdServiceState>,
    id: String,
) -> CmdResult<Vec<JenkinsQueueItem>> {
    state
        .lock()
        .await
        .jenkins_list_queue(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_jenkins_cancel_queue(
    state: State<'_, CicdServiceState>,
    id: String,
    queue_id: u64,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .jenkins_cancel_queue(&id, queue_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_jenkins_list_nodes(
    state: State<'_, CicdServiceState>,
    id: String,
) -> CmdResult<Vec<JenkinsNode>> {
    state
        .lock()
        .await
        .jenkins_list_nodes(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_jenkins_get_node(
    state: State<'_, CicdServiceState>,
    id: String,
    name: String,
) -> CmdResult<JenkinsNode> {
    state
        .lock()
        .await
        .jenkins_get_node(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_jenkins_get_system_info(
    state: State<'_, CicdServiceState>,
    id: String,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .jenkins_get_system_info(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_jenkins_list_plugins(
    state: State<'_, CicdServiceState>,
    id: String,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .jenkins_list_plugins(&id)
        .await
        .map_err(map_err)
}

// ── GitHub Actions-specific ───────────────────────────────────────

#[tauri::command]
pub async fn cicd_gha_list_workflows(
    state: State<'_, CicdServiceState>,
    id: String,
) -> CmdResult<Vec<GhaWorkflow>> {
    state
        .lock()
        .await
        .gha_list_workflows(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_gha_get_workflow(
    state: State<'_, CicdServiceState>,
    id: String,
    workflow_id: u64,
) -> CmdResult<GhaWorkflow> {
    state
        .lock()
        .await
        .gha_get_workflow(&id, workflow_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_gha_dispatch_workflow(
    state: State<'_, CicdServiceState>,
    id: String,
    workflow_id: u64,
    payload: GhaDispatchPayload,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .gha_dispatch_workflow(&id, workflow_id, payload)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_gha_enable_workflow(
    state: State<'_, CicdServiceState>,
    id: String,
    workflow_id: u64,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .gha_enable_workflow(&id, workflow_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_gha_disable_workflow(
    state: State<'_, CicdServiceState>,
    id: String,
    workflow_id: u64,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .gha_disable_workflow(&id, workflow_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_gha_list_workflow_runs(
    state: State<'_, CicdServiceState>,
    id: String,
    workflow_id: Option<u64>,
) -> CmdResult<Vec<GhaWorkflowRun>> {
    state
        .lock()
        .await
        .gha_list_workflow_runs(&id, workflow_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_gha_get_workflow_run(
    state: State<'_, CicdServiceState>,
    id: String,
    run_id: u64,
) -> CmdResult<GhaWorkflowRun> {
    state
        .lock()
        .await
        .gha_get_workflow_run(&id, run_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_gha_cancel_run(
    state: State<'_, CicdServiceState>,
    id: String,
    run_id: u64,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .gha_cancel_run(&id, run_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_gha_rerun_run(
    state: State<'_, CicdServiceState>,
    id: String,
    run_id: u64,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .gha_rerun_run(&id, run_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_gha_rerun_failed_jobs(
    state: State<'_, CicdServiceState>,
    id: String,
    run_id: u64,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .gha_rerun_failed_jobs(&id, run_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_gha_list_jobs(
    state: State<'_, CicdServiceState>,
    id: String,
    run_id: u64,
) -> CmdResult<Vec<GhaJob>> {
    state
        .lock()
        .await
        .gha_list_jobs(&id, run_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_gha_get_job(
    state: State<'_, CicdServiceState>,
    id: String,
    job_id: u64,
) -> CmdResult<GhaJob> {
    state
        .lock()
        .await
        .gha_get_job(&id, job_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_gha_get_job_logs(
    state: State<'_, CicdServiceState>,
    id: String,
    job_id: u64,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .gha_get_job_logs(&id, job_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_gha_list_artifacts(
    state: State<'_, CicdServiceState>,
    id: String,
    run_id: Option<u64>,
) -> CmdResult<Vec<GhaArtifact>> {
    state
        .lock()
        .await
        .gha_list_artifacts(&id, run_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_gha_delete_artifact(
    state: State<'_, CicdServiceState>,
    id: String,
    artifact_id: u64,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .gha_delete_artifact(&id, artifact_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_gha_list_secrets(
    state: State<'_, CicdServiceState>,
    id: String,
) -> CmdResult<Vec<GhaSecret>> {
    state
        .lock()
        .await
        .gha_list_secrets(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_gha_create_or_update_secret(
    state: State<'_, CicdServiceState>,
    id: String,
    secret_name: String,
    payload: GhaSecretPayload,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .gha_create_or_update_secret(&id, &secret_name, payload)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_gha_delete_secret(
    state: State<'_, CicdServiceState>,
    id: String,
    secret_name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .gha_delete_secret(&id, &secret_name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_gha_list_runners(
    state: State<'_, CicdServiceState>,
    id: String,
) -> CmdResult<Vec<GhaRunner>> {
    state
        .lock()
        .await
        .gha_list_runners(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_gha_get_runner(
    state: State<'_, CicdServiceState>,
    id: String,
    runner_id: u64,
) -> CmdResult<GhaRunner> {
    state
        .lock()
        .await
        .gha_get_runner(&id, runner_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cicd_gha_delete_runner(
    state: State<'_, CicdServiceState>,
    id: String,
    runner_id: u64,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .gha_delete_runner(&id, runner_id)
        .await
        .map_err(map_err)
}
