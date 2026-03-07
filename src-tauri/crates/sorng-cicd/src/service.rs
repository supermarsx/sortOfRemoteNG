// ── sorng-cicd/src/service.rs ────────────────────────────────────────────────
//! Aggregate CI/CD façade – single entry point that holds connections
//! and delegates to provider managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::CicdClient;
use crate::error::{CicdError, CicdResult};
use crate::types::*;

use crate::drone::DroneManager;
use crate::jenkins::JenkinsManager;
use crate::github_actions::GhaManager;
use crate::pipelines;
use crate::artifacts;

/// Shared Tauri state handle.
pub type CicdServiceState = Arc<Mutex<CicdService>>;

/// Main CI/CD service managing connections.
pub struct CicdService {
    connections: HashMap<String, CicdClient>,
}

impl CicdService {
    pub fn new() -> Self {
        Self { connections: HashMap::new() }
    }

    // ── Connection lifecycle ──────────────────────────────────────

    pub async fn connect(&mut self, id: String, config: CicdConnectionConfig) -> CicdResult<CicdConnectionSummary> {
        let client = CicdClient::new(config)?;
        let summary = client.ping().await?;
        self.connections.insert(id, client);
        Ok(summary)
    }

    pub fn disconnect(&mut self, id: &str) -> CicdResult<()> {
        self.connections.remove(id)
            .map(|_| ())
            .ok_or_else(|| CicdError::not_connected(format!("No connection '{id}'")))
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> CicdResult<&CicdClient> {
        self.connections.get(id)
            .ok_or_else(|| CicdError::not_connected(format!("No connection '{id}'")))
    }

    pub async fn ping(&self, id: &str) -> CicdResult<CicdConnectionSummary> {
        self.client(id)?.ping().await
    }

    // ── Dashboard ────────────────────────────────────────────────

    pub async fn get_dashboard(&self, id: &str) -> CicdResult<CicdDashboard> {
        let client = self.client(id)?;
        let builds = self.list_builds(id).await.unwrap_or_default();
        let successful = builds.iter().filter(|b| b.status == BuildStatus::Success).count() as u64;
        let failed = builds.iter().filter(|b| b.status == BuildStatus::Failure).count() as u64;
        let running = builds.iter().filter(|b| b.status == BuildStatus::Running).count() as u64;
        let pipelines = self.list_pipelines(id).await.unwrap_or_default();
        let recent: Vec<CicdBuild> = builds.into_iter().take(10).collect();
        Ok(CicdDashboard {
            provider: client.config.provider.clone(),
            total_pipelines: pipelines.len() as u64,
            total_builds: recent.len() as u64,
            successful_builds: successful,
            failed_builds: failed,
            running_builds: running,
            recent_builds: recent,
        })
    }

    // ── Unified pipelines ────────────────────────────────────────

    pub async fn list_pipelines(&self, id: &str) -> CicdResult<Vec<CicdPipeline>> {
        let client = self.client(id)?;
        match client.config.provider {
            CicdProvider::Drone => {
                let repos = DroneManager::list_repos(client).await?;
                Ok(repos.iter().map(|r| pipelines::normalize_drone_repo(r)).collect())
            }
            CicdProvider::Jenkins => {
                let jobs = JenkinsManager::list_jobs(client).await?;
                Ok(jobs.iter().map(|j| pipelines::normalize_jenkins_job(j)).collect())
            }
            CicdProvider::GitHubActions => {
                let workflows = GhaManager::list_workflows(client).await?;
                Ok(workflows.iter().map(|w| pipelines::normalize_gha_workflow(w)).collect())
            }
        }
    }

    pub async fn get_pipeline(&self, id: &str, pipeline_id: &str) -> CicdResult<CicdPipeline> {
        let client = self.client(id)?;
        match client.config.provider {
            CicdProvider::Drone => {
                let parts: Vec<&str> = pipeline_id.splitn(2, '/').collect();
                if parts.len() != 2 {
                    return Err(CicdError::new(crate::error::CicdErrorKind::PipelineNotFound, "Expected owner/name"));
                }
                let repo = DroneManager::get_repo(client, parts[0], parts[1]).await?;
                Ok(pipelines::normalize_drone_repo(&repo))
            }
            CicdProvider::Jenkins => {
                let job = JenkinsManager::get_job(client, pipeline_id).await?;
                Ok(pipelines::normalize_jenkins_job(&job))
            }
            CicdProvider::GitHubActions => {
                let wid: u64 = pipeline_id.parse()
                    .map_err(|_| CicdError::new(crate::error::CicdErrorKind::PipelineNotFound, "Invalid workflow ID"))?;
                let w = GhaManager::get_workflow(client, wid).await?;
                Ok(pipelines::normalize_gha_workflow(&w))
            }
        }
    }

    // ── Unified builds ───────────────────────────────────────────

    pub async fn list_builds(&self, id: &str) -> CicdResult<Vec<CicdBuild>> {
        let client = self.client(id)?;
        match client.config.provider {
            CicdProvider::Drone => {
                let (owner, name) = self.drone_owner_repo(id)?;
                let builds = DroneManager::list_builds(client, &owner, &name).await?;
                Ok(builds.iter().map(|b| pipelines::normalize_drone_build(b, &owner, &name)).collect())
            }
            CicdProvider::Jenkins => {
                // Jenkins doesn't have a global builds endpoint; return empty
                Ok(vec![])
            }
            CicdProvider::GitHubActions => {
                let runs = GhaManager::list_workflow_runs(client, None).await?;
                Ok(runs.iter().map(|r| pipelines::normalize_gha_run(r)).collect())
            }
        }
    }

    pub async fn get_build(&self, id: &str, build_id: &str) -> CicdResult<CicdBuild> {
        let client = self.client(id)?;
        match client.config.provider {
            CicdProvider::Drone => {
                let (owner, name) = self.drone_owner_repo(id)?;
                let number: u64 = build_id.parse()
                    .map_err(|_| CicdError::new(crate::error::CicdErrorKind::BuildNotFound, "Invalid build number"))?;
                let b = DroneManager::get_build(client, &owner, &name, number).await?;
                Ok(pipelines::normalize_drone_build(&b, &owner, &name))
            }
            CicdProvider::Jenkins => {
                // build_id = "job_name/number"
                let parts: Vec<&str> = build_id.rsplitn(2, '/').collect();
                if parts.len() != 2 {
                    return Err(CicdError::new(crate::error::CicdErrorKind::BuildNotFound, "Expected job_name/number"));
                }
                let number: u64 = parts[0].parse()
                    .map_err(|_| CicdError::new(crate::error::CicdErrorKind::BuildNotFound, "Invalid build number"))?;
                let b = JenkinsManager::get_build(client, parts[1], number).await?;
                Ok(pipelines::normalize_jenkins_build(&b, parts[1]))
            }
            CicdProvider::GitHubActions => {
                let run_id: u64 = build_id.parse()
                    .map_err(|_| CicdError::new(crate::error::CicdErrorKind::BuildNotFound, "Invalid run ID"))?;
                let r = GhaManager::get_workflow_run(client, run_id).await?;
                Ok(pipelines::normalize_gha_run(&r))
            }
        }
    }

    pub async fn trigger_build(&self, id: &str, pipeline_id: &str, branch: Option<String>) -> CicdResult<CicdBuild> {
        let client = self.client(id)?;
        match client.config.provider {
            CicdProvider::Drone => {
                let parts: Vec<&str> = pipeline_id.splitn(2, '/').collect();
                if parts.len() != 2 {
                    return Err(CicdError::provider("Expected owner/name"));
                }
                let b = DroneManager::trigger_build(client, parts[0], parts[1], &branch.unwrap_or_else(|| "main".into())).await?;
                Ok(pipelines::normalize_drone_build(&b, parts[0], parts[1]))
            }
            CicdProvider::Jenkins => {
                JenkinsManager::trigger_build(client, pipeline_id).await?;
                // Jenkins returns 201 with no body; return a placeholder
                Ok(CicdBuild {
                    id: "queued".into(),
                    pipeline_id: pipeline_id.into(),
                    number: 0,
                    status: BuildStatus::Pending,
                    branch,
                    commit: None,
                    commit_message: None,
                    author: None,
                    started_at: None,
                    finished_at: None,
                    duration_secs: None,
                    trigger: BuildTrigger::Manual,
                    stages: vec![],
                    url: None,
                })
            }
            CicdProvider::GitHubActions => {
                let wid: u64 = pipeline_id.parse()
                    .map_err(|_| CicdError::provider("Invalid workflow ID"))?;
                let payload = GhaDispatchPayload {
                    ref_field: branch.unwrap_or_else(|| "main".into()),
                    inputs: None,
                };
                GhaManager::dispatch_workflow(client, wid, &payload).await?;
                Ok(CicdBuild {
                    id: "dispatched".into(),
                    pipeline_id: pipeline_id.into(),
                    number: 0,
                    status: BuildStatus::Pending,
                    branch: Some(payload.ref_field),
                    commit: None,
                    commit_message: None,
                    author: None,
                    started_at: None,
                    finished_at: None,
                    duration_secs: None,
                    trigger: BuildTrigger::Manual,
                    stages: vec![],
                    url: None,
                })
            }
        }
    }

    pub async fn cancel_build(&self, id: &str, build_id: &str) -> CicdResult<()> {
        let client = self.client(id)?;
        match client.config.provider {
            CicdProvider::Drone => {
                let (owner, name) = self.drone_owner_repo(id)?;
                let number: u64 = build_id.parse().map_err(|_| CicdError::provider("Invalid build number"))?;
                DroneManager::cancel_build(client, &owner, &name, number).await
            }
            CicdProvider::Jenkins => {
                let parts: Vec<&str> = build_id.rsplitn(2, '/').collect();
                if parts.len() != 2 { return Err(CicdError::provider("Expected job_name/number")); }
                let number: u64 = parts[0].parse().map_err(|_| CicdError::provider("Invalid build number"))?;
                JenkinsManager::stop_build(client, parts[1], number).await
            }
            CicdProvider::GitHubActions => {
                let run_id: u64 = build_id.parse().map_err(|_| CicdError::provider("Invalid run ID"))?;
                GhaManager::cancel_run(client, run_id).await
            }
        }
    }

    pub async fn restart_build(&self, id: &str, build_id: &str) -> CicdResult<CicdBuild> {
        let client = self.client(id)?;
        match client.config.provider {
            CicdProvider::Drone => {
                let (owner, name) = self.drone_owner_repo(id)?;
                let number: u64 = build_id.parse().map_err(|_| CicdError::provider("Invalid build number"))?;
                let b = DroneManager::restart_build(client, &owner, &name, number).await?;
                Ok(pipelines::normalize_drone_build(&b, &owner, &name))
            }
            CicdProvider::Jenkins => {
                Err(CicdError::provider("Jenkins does not support restart; trigger a new build instead"))
            }
            CicdProvider::GitHubActions => {
                let run_id: u64 = build_id.parse().map_err(|_| CicdError::provider("Invalid run ID"))?;
                GhaManager::rerun_run(client, run_id).await?;
                let r = GhaManager::get_workflow_run(client, run_id).await?;
                Ok(pipelines::normalize_gha_run(&r))
            }
        }
    }

    // ── Build logs ───────────────────────────────────────────────

    pub async fn get_build_logs(&self, id: &str, build_id: &str, stage: Option<u32>, step: Option<u32>) -> CicdResult<String> {
        let client = self.client(id)?;
        match client.config.provider {
            CicdProvider::Drone => {
                let (owner, name) = self.drone_owner_repo(id)?;
                let number: u64 = build_id.parse().map_err(|_| CicdError::provider("Invalid build number"))?;
                let logs = DroneManager::get_build_logs(client, &owner, &name, number, stage.unwrap_or(1), step.unwrap_or(1)).await?;
                Ok(logs.iter().map(|l| l.out.clone()).collect::<Vec<_>>().join("\n"))
            }
            CicdProvider::Jenkins => {
                let parts: Vec<&str> = build_id.rsplitn(2, '/').collect();
                if parts.len() != 2 { return Err(CicdError::provider("Expected job_name/number")); }
                let number: u64 = parts[0].parse().map_err(|_| CicdError::provider("Invalid build number"))?;
                JenkinsManager::get_build_log(client, parts[1], number).await
            }
            CicdProvider::GitHubActions => {
                let job_id: u64 = build_id.parse().map_err(|_| CicdError::provider("Invalid job ID"))?;
                GhaManager::get_job_logs(client, job_id).await
            }
        }
    }

    // ── Unified artifacts ────────────────────────────────────────

    pub async fn list_artifacts(&self, id: &str, build_id: &str) -> CicdResult<Vec<CicdArtifact>> {
        let client = self.client(id)?;
        match client.config.provider {
            CicdProvider::Drone => Ok(vec![]),
            CicdProvider::Jenkins => {
                let parts: Vec<&str> = build_id.rsplitn(2, '/').collect();
                if parts.len() != 2 { return Err(CicdError::provider("Expected job_name/number")); }
                let number: u64 = parts[0].parse().map_err(|_| CicdError::provider("Invalid build number"))?;
                let build = JenkinsManager::get_build(client, parts[1], number).await?;
                Ok(build.artifacts.iter().map(|a| {
                    artifacts::normalize_jenkins_artifact(a, parts[1], number, &client.config.base_url)
                }).collect())
            }
            CicdProvider::GitHubActions => {
                let run_id: u64 = build_id.parse().map_err(|_| CicdError::provider("Invalid run ID"))?;
                let arts = GhaManager::list_artifacts(client, Some(run_id)).await?;
                Ok(arts.iter().map(|a| artifacts::normalize_gha_artifact(a, run_id)).collect())
            }
        }
    }

    pub async fn get_artifact(&self, id: &str, artifact_id: &str) -> CicdResult<CicdArtifact> {
        let client = self.client(id)?;
        match client.config.provider {
            CicdProvider::Drone => Err(CicdError::provider("Drone CE does not have a first-class artifact API")),
            CicdProvider::Jenkins => Err(CicdError::provider("Use list_artifacts to find Jenkins artifacts")),
            CicdProvider::GitHubActions => {
                let aid: u64 = artifact_id.parse().map_err(|_| CicdError::provider("Invalid artifact ID"))?;
                let a = GhaManager::get_artifact(client, aid).await?;
                Ok(artifacts::normalize_gha_artifact(&a, 0))
            }
        }
    }

    // ── Unified secrets ──────────────────────────────────────────

    pub async fn list_secrets(&self, id: &str) -> CicdResult<Vec<CicdSecret>> {
        let client = self.client(id)?;
        match client.config.provider {
            CicdProvider::Drone => {
                let (owner, name) = self.drone_owner_repo(id)?;
                let secrets = DroneManager::list_secrets(client, &owner, &name).await?;
                Ok(secrets.iter().map(|s| CicdSecret {
                    name: s.name.clone(),
                    created_at: None,
                    updated_at: None,
                }).collect())
            }
            CicdProvider::Jenkins => Ok(vec![]),
            CicdProvider::GitHubActions => {
                let secrets = GhaManager::list_secrets(client).await?;
                Ok(secrets.iter().map(|s| CicdSecret {
                    name: s.name.clone(),
                    created_at: Some(s.created_at.clone()),
                    updated_at: Some(s.updated_at.clone()),
                }).collect())
            }
        }
    }

    pub async fn create_secret(&self, id: &str, payload: CreateSecretPayload) -> CicdResult<()> {
        let client = self.client(id)?;
        match client.config.provider {
            CicdProvider::Drone => {
                let (owner, name) = self.drone_owner_repo(id)?;
                DroneManager::create_secret(client, &owner, &name, &payload).await?;
                Ok(())
            }
            CicdProvider::Jenkins => Err(CicdError::provider("Use Jenkins credentials API directly")),
            CicdProvider::GitHubActions => Err(CicdError::provider("Use gha_create_or_update_secret for GitHub Actions")),
        }
    }

    pub async fn delete_secret(&self, id: &str, secret_name: &str) -> CicdResult<()> {
        let client = self.client(id)?;
        match client.config.provider {
            CicdProvider::Drone => {
                let (owner, name) = self.drone_owner_repo(id)?;
                DroneManager::delete_secret(client, &owner, &name, secret_name).await
            }
            CicdProvider::Jenkins => Err(CicdError::provider("Use Jenkins credentials API directly")),
            CicdProvider::GitHubActions => {
                GhaManager::delete_secret(client, secret_name).await
            }
        }
    }

    // ── Drone-specific ───────────────────────────────────────────

    fn drone_owner_repo(&self, id: &str) -> CicdResult<(String, String)> {
        let client = self.client(id)?;
        let org = client.config.org.clone()
            .ok_or_else(|| CicdError::provider("org required for Drone"))?;
        let repo = client.config.repo.clone()
            .ok_or_else(|| CicdError::provider("repo required for Drone"))?;
        Ok((org, repo))
    }

    pub async fn drone_list_repos(&self, id: &str) -> CicdResult<Vec<DroneRepo>> {
        DroneManager::list_repos(self.client(id)?).await
    }

    pub async fn drone_get_repo(&self, id: &str, owner: &str, name: &str) -> CicdResult<DroneRepo> {
        DroneManager::get_repo(self.client(id)?, owner, name).await
    }

    pub async fn drone_activate_repo(&self, id: &str, owner: &str, name: &str) -> CicdResult<DroneRepo> {
        DroneManager::activate_repo(self.client(id)?, owner, name).await
    }

    pub async fn drone_deactivate_repo(&self, id: &str, owner: &str, name: &str) -> CicdResult<()> {
        DroneManager::deactivate_repo(self.client(id)?, owner, name).await
    }

    pub async fn drone_list_cron_jobs(&self, id: &str, owner: &str, name: &str) -> CicdResult<Vec<DroneCron>> {
        DroneManager::list_cron_jobs(self.client(id)?, owner, name).await
    }

    pub async fn drone_create_cron_job(&self, id: &str, owner: &str, name: &str, cron: CreateDroneCronPayload) -> CicdResult<DroneCron> {
        DroneManager::create_cron_job(self.client(id)?, owner, name, &cron).await
    }

    pub async fn drone_delete_cron_job(&self, id: &str, owner: &str, name: &str, cron_name: &str) -> CicdResult<()> {
        DroneManager::delete_cron_job(self.client(id)?, owner, name, cron_name).await
    }

    // ── Jenkins-specific ─────────────────────────────────────────

    pub async fn jenkins_list_jobs(&self, id: &str) -> CicdResult<Vec<JenkinsJob>> {
        JenkinsManager::list_jobs(self.client(id)?).await
    }

    pub async fn jenkins_get_job(&self, id: &str, name: &str) -> CicdResult<JenkinsJob> {
        JenkinsManager::get_job(self.client(id)?, name).await
    }

    pub async fn jenkins_create_job(&self, id: &str, name: &str, config_xml: &str) -> CicdResult<()> {
        JenkinsManager::create_job(self.client(id)?, name, config_xml).await
    }

    pub async fn jenkins_delete_job(&self, id: &str, name: &str) -> CicdResult<()> {
        JenkinsManager::delete_job(self.client(id)?, name).await
    }

    pub async fn jenkins_trigger_build(&self, id: &str, job_name: &str) -> CicdResult<()> {
        JenkinsManager::trigger_build(self.client(id)?, job_name).await
    }

    pub async fn jenkins_get_console_output(&self, id: &str, job_name: &str, number: u64) -> CicdResult<String> {
        JenkinsManager::get_console_output(self.client(id)?, job_name, number).await
    }

    pub async fn jenkins_list_queue(&self, id: &str) -> CicdResult<Vec<JenkinsQueueItem>> {
        JenkinsManager::list_queue(self.client(id)?).await
    }

    pub async fn jenkins_cancel_queue(&self, id: &str, queue_id: u64) -> CicdResult<()> {
        JenkinsManager::cancel_queue_item(self.client(id)?, queue_id).await
    }

    pub async fn jenkins_list_nodes(&self, id: &str) -> CicdResult<Vec<JenkinsNode>> {
        JenkinsManager::list_nodes(self.client(id)?).await
    }

    pub async fn jenkins_get_node(&self, id: &str, name: &str) -> CicdResult<JenkinsNode> {
        JenkinsManager::get_node(self.client(id)?, name).await
    }

    pub async fn jenkins_get_system_info(&self, id: &str) -> CicdResult<serde_json::Value> {
        JenkinsManager::get_system_info(self.client(id)?).await
    }

    pub async fn jenkins_list_plugins(&self, id: &str) -> CicdResult<serde_json::Value> {
        JenkinsManager::list_plugins(self.client(id)?).await
    }

    // ── GitHub Actions-specific ──────────────────────────────────

    pub async fn gha_list_workflows(&self, id: &str) -> CicdResult<Vec<GhaWorkflow>> {
        GhaManager::list_workflows(self.client(id)?).await
    }

    pub async fn gha_get_workflow(&self, id: &str, workflow_id: u64) -> CicdResult<GhaWorkflow> {
        GhaManager::get_workflow(self.client(id)?, workflow_id).await
    }

    pub async fn gha_dispatch_workflow(&self, id: &str, workflow_id: u64, payload: GhaDispatchPayload) -> CicdResult<()> {
        GhaManager::dispatch_workflow(self.client(id)?, workflow_id, &payload).await
    }

    pub async fn gha_enable_workflow(&self, id: &str, workflow_id: u64) -> CicdResult<()> {
        GhaManager::enable_workflow(self.client(id)?, workflow_id).await
    }

    pub async fn gha_disable_workflow(&self, id: &str, workflow_id: u64) -> CicdResult<()> {
        GhaManager::disable_workflow(self.client(id)?, workflow_id).await
    }

    pub async fn gha_list_workflow_runs(&self, id: &str, workflow_id: Option<u64>) -> CicdResult<Vec<GhaWorkflowRun>> {
        GhaManager::list_workflow_runs(self.client(id)?, workflow_id).await
    }

    pub async fn gha_get_workflow_run(&self, id: &str, run_id: u64) -> CicdResult<GhaWorkflowRun> {
        GhaManager::get_workflow_run(self.client(id)?, run_id).await
    }

    pub async fn gha_cancel_run(&self, id: &str, run_id: u64) -> CicdResult<()> {
        GhaManager::cancel_run(self.client(id)?, run_id).await
    }

    pub async fn gha_rerun_run(&self, id: &str, run_id: u64) -> CicdResult<()> {
        GhaManager::rerun_run(self.client(id)?, run_id).await
    }

    pub async fn gha_rerun_failed_jobs(&self, id: &str, run_id: u64) -> CicdResult<()> {
        GhaManager::rerun_failed_jobs(self.client(id)?, run_id).await
    }

    pub async fn gha_list_jobs(&self, id: &str, run_id: u64) -> CicdResult<Vec<GhaJob>> {
        GhaManager::list_jobs(self.client(id)?, run_id).await
    }

    pub async fn gha_get_job(&self, id: &str, job_id: u64) -> CicdResult<GhaJob> {
        GhaManager::get_job(self.client(id)?, job_id).await
    }

    pub async fn gha_get_job_logs(&self, id: &str, job_id: u64) -> CicdResult<String> {
        GhaManager::get_job_logs(self.client(id)?, job_id).await
    }

    pub async fn gha_list_artifacts(&self, id: &str, run_id: Option<u64>) -> CicdResult<Vec<GhaArtifact>> {
        GhaManager::list_artifacts(self.client(id)?, run_id).await
    }

    pub async fn gha_delete_artifact(&self, id: &str, artifact_id: u64) -> CicdResult<()> {
        GhaManager::delete_artifact(self.client(id)?, artifact_id).await
    }

    pub async fn gha_list_secrets(&self, id: &str) -> CicdResult<Vec<GhaSecret>> {
        GhaManager::list_secrets(self.client(id)?).await
    }

    pub async fn gha_create_or_update_secret(&self, id: &str, secret_name: &str, payload: GhaSecretPayload) -> CicdResult<()> {
        GhaManager::create_or_update_secret(self.client(id)?, secret_name, &payload).await
    }

    pub async fn gha_delete_secret(&self, id: &str, secret_name: &str) -> CicdResult<()> {
        GhaManager::delete_secret(self.client(id)?, secret_name).await
    }

    pub async fn gha_list_runners(&self, id: &str) -> CicdResult<Vec<GhaRunner>> {
        GhaManager::list_runners(self.client(id)?).await
    }

    pub async fn gha_get_runner(&self, id: &str, runner_id: u64) -> CicdResult<GhaRunner> {
        GhaManager::get_runner(self.client(id)?, runner_id).await
    }

    pub async fn gha_delete_runner(&self, id: &str, runner_id: u64) -> CicdResult<()> {
        GhaManager::delete_runner(self.client(id)?, runner_id).await
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn service_new_empty() {
        let svc = CicdService::new();
        assert!(svc.list_connections().is_empty());
    }

    #[test]
    fn disconnect_missing_returns_error() {
        let mut svc = CicdService::new();
        let result = svc.disconnect("nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn client_missing_returns_error() {
        let svc = CicdService::new();
        let result = svc.client("nonexistent");
        assert!(result.is_err());
    }
}
