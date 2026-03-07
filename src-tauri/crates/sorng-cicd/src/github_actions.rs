// ── sorng-cicd/src/github_actions.rs ─────────────────────────────────────────
//! GitHub Actions REST API v3 integration.

use crate::client::CicdClient;
use crate::error::{CicdError, CicdResult};
use crate::types::*;

pub struct GhaManager;

impl GhaManager {
    /// Resolve {owner}/{repo} from client config.
    fn owner_repo(client: &CicdClient) -> CicdResult<(String, String)> {
        let org = client.config.org.clone()
            .ok_or_else(|| CicdError::provider("org required for GitHub Actions"))?;
        let repo = client.config.repo.clone()
            .ok_or_else(|| CicdError::provider("repo required for GitHub Actions"))?;
        Ok((org, repo))
    }

    fn repo_path(client: &CicdClient) -> CicdResult<String> {
        let (o, r) = Self::owner_repo(client)?;
        Ok(format!("/repos/{o}/{r}"))
    }

    // ── Workflows ────────────────────────────────────────────────────

    pub async fn list_workflows(client: &CicdClient) -> CicdResult<Vec<GhaWorkflow>> {
        let base = Self::repo_path(client)?;
        let list: GhaWorkflowList = client.get(&format!("{base}/actions/workflows")).await?;
        Ok(list.workflows)
    }

    pub async fn get_workflow(client: &CicdClient, workflow_id: u64) -> CicdResult<GhaWorkflow> {
        let base = Self::repo_path(client)?;
        client.get(&format!("{base}/actions/workflows/{workflow_id}")).await
    }

    pub async fn dispatch_workflow(client: &CicdClient, workflow_id: u64, payload: &GhaDispatchPayload) -> CicdResult<()> {
        let base = Self::repo_path(client)?;
        client.post_empty_with_body(&format!("{base}/actions/workflows/{workflow_id}/dispatches"), payload).await
    }

    pub async fn enable_workflow(client: &CicdClient, workflow_id: u64) -> CicdResult<()> {
        let base = Self::repo_path(client)?;
        client.put(&format!("{base}/actions/workflows/{workflow_id}/enable"), &serde_json::json!({})).await
    }

    pub async fn disable_workflow(client: &CicdClient, workflow_id: u64) -> CicdResult<()> {
        let base = Self::repo_path(client)?;
        client.put(&format!("{base}/actions/workflows/{workflow_id}/disable"), &serde_json::json!({})).await
    }

    // ── Workflow Runs ────────────────────────────────────────────────

    pub async fn list_workflow_runs(client: &CicdClient, workflow_id: Option<u64>) -> CicdResult<Vec<GhaWorkflowRun>> {
        let base = Self::repo_path(client)?;
        let path = match workflow_id {
            Some(id) => format!("{base}/actions/workflows/{id}/runs"),
            None => format!("{base}/actions/runs"),
        };
        let list: GhaRunList = client.get(&path).await?;
        Ok(list.workflow_runs)
    }

    pub async fn get_workflow_run(client: &CicdClient, run_id: u64) -> CicdResult<GhaWorkflowRun> {
        let base = Self::repo_path(client)?;
        client.get(&format!("{base}/actions/runs/{run_id}")).await
    }

    pub async fn cancel_run(client: &CicdClient, run_id: u64) -> CicdResult<()> {
        let base = Self::repo_path(client)?;
        client.post_empty(&format!("{base}/actions/runs/{run_id}/cancel")).await
    }

    pub async fn rerun_run(client: &CicdClient, run_id: u64) -> CicdResult<()> {
        let base = Self::repo_path(client)?;
        client.post_empty(&format!("{base}/actions/runs/{run_id}/rerun")).await
    }

    pub async fn rerun_failed_jobs(client: &CicdClient, run_id: u64) -> CicdResult<()> {
        let base = Self::repo_path(client)?;
        client.post_empty(&format!("{base}/actions/runs/{run_id}/rerun-failed-jobs")).await
    }

    // ── Jobs ─────────────────────────────────────────────────────────

    pub async fn list_jobs(client: &CicdClient, run_id: u64) -> CicdResult<Vec<GhaJob>> {
        let base = Self::repo_path(client)?;
        let list: GhaJobList = client.get(&format!("{base}/actions/runs/{run_id}/jobs")).await?;
        Ok(list.jobs)
    }

    pub async fn get_job(client: &CicdClient, job_id: u64) -> CicdResult<GhaJob> {
        let base = Self::repo_path(client)?;
        client.get(&format!("{base}/actions/jobs/{job_id}")).await
    }

    pub async fn get_job_logs(client: &CicdClient, job_id: u64) -> CicdResult<String> {
        let base = Self::repo_path(client)?;
        client.get_raw(&format!("{base}/actions/jobs/{job_id}/logs")).await
    }

    // ── Artifacts ────────────────────────────────────────────────────

    pub async fn list_artifacts(client: &CicdClient, run_id: Option<u64>) -> CicdResult<Vec<GhaArtifact>> {
        let base = Self::repo_path(client)?;
        let path = match run_id {
            Some(id) => format!("{base}/actions/runs/{id}/artifacts"),
            None => format!("{base}/actions/artifacts"),
        };
        let list: GhaArtifactList = client.get(&path).await?;
        Ok(list.artifacts)
    }

    pub async fn get_artifact(client: &CicdClient, artifact_id: u64) -> CicdResult<GhaArtifact> {
        let base = Self::repo_path(client)?;
        client.get(&format!("{base}/actions/artifacts/{artifact_id}")).await
    }

    pub async fn delete_artifact(client: &CicdClient, artifact_id: u64) -> CicdResult<()> {
        let base = Self::repo_path(client)?;
        client.delete(&format!("{base}/actions/artifacts/{artifact_id}")).await
    }

    pub async fn download_artifact(client: &CicdClient, artifact_id: u64) -> CicdResult<String> {
        let base = Self::repo_path(client)?;
        client.get_raw(&format!("{base}/actions/artifacts/{artifact_id}/zip")).await
    }

    // ── Secrets ──────────────────────────────────────────────────────

    pub async fn list_secrets(client: &CicdClient) -> CicdResult<Vec<GhaSecret>> {
        let base = Self::repo_path(client)?;
        let list: GhaSecretList = client.get(&format!("{base}/actions/secrets")).await?;
        Ok(list.secrets)
    }

    pub async fn create_or_update_secret(client: &CicdClient, secret_name: &str, payload: &GhaSecretPayload) -> CicdResult<()> {
        let base = Self::repo_path(client)?;
        client.put(&format!("{base}/actions/secrets/{secret_name}"), payload).await
    }

    pub async fn delete_secret(client: &CicdClient, secret_name: &str) -> CicdResult<()> {
        let base = Self::repo_path(client)?;
        client.delete(&format!("{base}/actions/secrets/{secret_name}")).await
    }

    // ── Runners ──────────────────────────────────────────────────────

    pub async fn list_runners(client: &CicdClient) -> CicdResult<Vec<GhaRunner>> {
        let base = Self::repo_path(client)?;
        let list: GhaRunnerList = client.get(&format!("{base}/actions/runners")).await?;
        Ok(list.runners)
    }

    pub async fn get_runner(client: &CicdClient, runner_id: u64) -> CicdResult<GhaRunner> {
        let base = Self::repo_path(client)?;
        client.get(&format!("{base}/actions/runners/{runner_id}")).await
    }

    pub async fn delete_runner(client: &CicdClient, runner_id: u64) -> CicdResult<()> {
        let base = Self::repo_path(client)?;
        client.delete(&format!("{base}/actions/runners/{runner_id}")).await
    }

    // ── Environments ─────────────────────────────────────────────────

    pub async fn list_environments(client: &CicdClient) -> CicdResult<serde_json::Value> {
        let base = Self::repo_path(client)?;
        client.get(&format!("{base}/environments")).await
    }
}
