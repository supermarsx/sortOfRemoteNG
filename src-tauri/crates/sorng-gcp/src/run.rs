//! Google Cloud Run client.
//!
//! Covers Cloud Run services, revisions, and jobs (v2 API).
//!
//! API base: `https://run.googleapis.com/v2`

use crate::client::GcpClient;
use crate::error::GcpResult;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const SERVICE: &str = "run";
const V2: &str = "/v2";

// ── Types ───────────────────────────────────────────────────────────────

/// Cloud Run service.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunService {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub uid: String,
    #[serde(default)]
    pub generation: Option<String>,
    #[serde(default)]
    pub labels: HashMap<String, String>,
    #[serde(default)]
    pub annotations: HashMap<String, String>,
    #[serde(default, rename = "createTime")]
    pub create_time: Option<String>,
    #[serde(default, rename = "updateTime")]
    pub update_time: Option<String>,
    #[serde(default)]
    pub uri: Option<String>,
    #[serde(default)]
    pub creator: Option<String>,
    #[serde(default, rename = "lastModifier")]
    pub last_modifier: Option<String>,
    #[serde(default)]
    pub ingress: Option<String>,
    #[serde(default, rename = "launchStage")]
    pub launch_stage: Option<String>,
    #[serde(default)]
    pub template: Option<RevisionTemplate>,
    #[serde(default)]
    pub traffic: Vec<TrafficTarget>,
    #[serde(default)]
    pub conditions: Vec<Condition>,
    #[serde(default, rename = "latestReadyRevision")]
    pub latest_ready_revision: Option<String>,
    #[serde(default, rename = "latestCreatedRevision")]
    pub latest_created_revision: Option<String>,
}

/// A revision template configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RevisionTemplate {
    #[serde(default)]
    pub revision: Option<String>,
    #[serde(default)]
    pub labels: HashMap<String, String>,
    #[serde(default)]
    pub annotations: HashMap<String, String>,
    #[serde(default)]
    pub scaling: Option<Scaling>,
    #[serde(default)]
    pub containers: Vec<Container>,
    #[serde(default, rename = "serviceAccount")]
    pub service_account: Option<String>,
    #[serde(default, rename = "maxInstanceRequestConcurrency")]
    pub max_instance_request_concurrency: Option<u32>,
    #[serde(default)]
    pub timeout: Option<String>,
    #[serde(default, rename = "executionEnvironment")]
    pub execution_environment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Scaling {
    #[serde(default, rename = "minInstanceCount")]
    pub min_instance_count: Option<u32>,
    #[serde(default, rename = "maxInstanceCount")]
    pub max_instance_count: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Container {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub image: String,
    #[serde(default)]
    pub command: Vec<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: Vec<EnvVar>,
    #[serde(default)]
    pub ports: Vec<ContainerPort>,
    #[serde(default)]
    pub resources: Option<ResourceRequirements>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvVar {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default, rename = "valueSource")]
    pub value_source: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContainerPort {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default, rename = "containerPort")]
    pub container_port: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceRequirements {
    #[serde(default)]
    pub limits: HashMap<String, String>,
    #[serde(default, rename = "cpuIdle")]
    pub cpu_idle: Option<bool>,
    #[serde(default, rename = "startupCpuBoost")]
    pub startup_cpu_boost: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrafficTarget {
    #[serde(default, rename = "type")]
    pub traffic_type: Option<String>,
    #[serde(default)]
    pub revision: Option<String>,
    #[serde(default)]
    pub percent: Option<u32>,
    #[serde(default)]
    pub tag: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Condition {
    #[serde(default, rename = "type")]
    pub condition_type: String,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default, rename = "lastTransitionTime")]
    pub last_transition_time: Option<String>,
    #[serde(default)]
    pub severity: Option<String>,
}

/// Cloud Run revision.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Revision {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub uid: String,
    #[serde(default)]
    pub labels: HashMap<String, String>,
    #[serde(default, rename = "createTime")]
    pub create_time: Option<String>,
    #[serde(default, rename = "updateTime")]
    pub update_time: Option<String>,
    #[serde(default)]
    pub containers: Vec<Container>,
    #[serde(default)]
    pub scaling: Option<Scaling>,
    #[serde(default)]
    pub conditions: Vec<Condition>,
    #[serde(default, rename = "serviceAccount")]
    pub service_account: Option<String>,
}

/// Cloud Run job.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub uid: String,
    #[serde(default)]
    pub labels: HashMap<String, String>,
    #[serde(default, rename = "createTime")]
    pub create_time: Option<String>,
    #[serde(default, rename = "updateTime")]
    pub update_time: Option<String>,
    #[serde(default)]
    pub creator: Option<String>,
    #[serde(default, rename = "lastModifier")]
    pub last_modifier: Option<String>,
    #[serde(default, rename = "launchStage")]
    pub launch_stage: Option<String>,
    #[serde(default)]
    pub template: Option<ExecutionTemplate>,
    #[serde(default)]
    pub conditions: Vec<Condition>,
    #[serde(default, rename = "latestCreatedExecution")]
    pub latest_created_execution: Option<ExecutionReference>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionTemplate {
    #[serde(default)]
    pub labels: HashMap<String, String>,
    #[serde(default)]
    pub annotations: HashMap<String, String>,
    #[serde(default, rename = "taskCount")]
    pub task_count: Option<u32>,
    #[serde(default)]
    pub parallelism: Option<u32>,
    #[serde(default)]
    pub template: Option<TaskTemplate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskTemplate {
    #[serde(default)]
    pub containers: Vec<Container>,
    #[serde(default)]
    pub timeout: Option<String>,
    #[serde(default, rename = "serviceAccount")]
    pub service_account: Option<String>,
    #[serde(default, rename = "maxRetries")]
    pub max_retries: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionReference {
    #[serde(default)]
    pub name: String,
    #[serde(default, rename = "createTime")]
    pub create_time: Option<String>,
    #[serde(default, rename = "completionTime")]
    pub completion_time: Option<String>,
}

/// Cloud Run execution (job run).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Execution {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub uid: String,
    #[serde(default)]
    pub labels: HashMap<String, String>,
    #[serde(default, rename = "createTime")]
    pub create_time: Option<String>,
    #[serde(default, rename = "startTime")]
    pub start_time: Option<String>,
    #[serde(default, rename = "completionTime")]
    pub completion_time: Option<String>,
    #[serde(default, rename = "taskCount")]
    pub task_count: Option<u32>,
    #[serde(default, rename = "runningCount")]
    pub running_count: Option<u32>,
    #[serde(default, rename = "succeededCount")]
    pub succeeded_count: Option<u32>,
    #[serde(default, rename = "failedCount")]
    pub failed_count: Option<u32>,
    #[serde(default)]
    pub conditions: Vec<Condition>,
    #[serde(default)]
    pub job: Option<String>,
}

/// Cloud Run long-running operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunOperation {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub done: bool,
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
    #[serde(default)]
    pub response: Option<serde_json::Value>,
    #[serde(default)]
    pub error: Option<serde_json::Value>,
}

// ── List wrappers ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct ServiceList {
    #[serde(default)]
    services: Vec<RunService>,
}

#[derive(Debug, Deserialize)]
struct RevisionList {
    #[serde(default)]
    revisions: Vec<Revision>,
}

#[derive(Debug, Deserialize)]
struct JobList {
    #[serde(default)]
    jobs: Vec<Job>,
}

#[derive(Debug, Deserialize)]
struct ExecutionList {
    #[serde(default)]
    executions: Vec<Execution>,
}

// ── Cloud Run Client ────────────────────────────────────────────────────

pub struct CloudRunClient;

impl CloudRunClient {
    // ── Services ────────────────────────────────────────────────────

    /// List Cloud Run services.
    pub async fn list_services(
        client: &mut GcpClient,
        project: &str,
        region: &str,
    ) -> GcpResult<Vec<RunService>> {
        let parent = format!("projects/{}/locations/{}", project, region);
        let path = format!("{}/{}/services", V2, parent);
        let resp: ServiceList = client.get(SERVICE, &path, &[]).await?;
        Ok(resp.services)
    }

    /// Get a service.
    pub async fn get_service(
        client: &mut GcpClient,
        project: &str,
        region: &str,
        service_name: &str,
    ) -> GcpResult<RunService> {
        let path = format!(
            "{}/projects/{}/locations/{}/services/{}",
            V2, project, region, service_name
        );
        client.get(SERVICE, &path, &[]).await
    }

    /// Delete a service.
    pub async fn delete_service(
        client: &mut GcpClient,
        project: &str,
        region: &str,
        service_name: &str,
    ) -> GcpResult<RunOperation> {
        let path = format!(
            "{}/projects/{}/locations/{}/services/{}",
            V2, project, region, service_name
        );
        let resp_text = client.delete(SERVICE, &path).await?;
        let op: RunOperation = serde_json::from_str(&resp_text)
            .unwrap_or(RunOperation {
                name: String::new(),
                done: true,
                metadata: None,
                response: None,
                error: None,
            });
        Ok(op)
    }

    // ── Revisions ───────────────────────────────────────────────────

    /// List revisions for a service.
    pub async fn list_revisions(
        client: &mut GcpClient,
        project: &str,
        region: &str,
        service_name: &str,
    ) -> GcpResult<Vec<Revision>> {
        let parent = format!(
            "projects/{}/locations/{}/services/{}",
            project, region, service_name
        );
        let path = format!("{}/{}/revisions", V2, parent);
        let resp: RevisionList = client.get(SERVICE, &path, &[]).await?;
        Ok(resp.revisions)
    }

    /// Get a specific revision.
    pub async fn get_revision(
        client: &mut GcpClient,
        project: &str,
        region: &str,
        service_name: &str,
        revision_name: &str,
    ) -> GcpResult<Revision> {
        let path = format!(
            "{}/projects/{}/locations/{}/services/{}/revisions/{}",
            V2, project, region, service_name, revision_name
        );
        client.get(SERVICE, &path, &[]).await
    }

    /// Delete a revision.
    pub async fn delete_revision(
        client: &mut GcpClient,
        project: &str,
        region: &str,
        service_name: &str,
        revision_name: &str,
    ) -> GcpResult<RunOperation> {
        let path = format!(
            "{}/projects/{}/locations/{}/services/{}/revisions/{}",
            V2, project, region, service_name, revision_name
        );
        let resp_text = client.delete(SERVICE, &path).await?;
        let op: RunOperation = serde_json::from_str(&resp_text)
            .unwrap_or(RunOperation {
                name: String::new(),
                done: true,
                metadata: None,
                response: None,
                error: None,
            });
        Ok(op)
    }

    // ── Jobs ────────────────────────────────────────────────────────

    /// List Cloud Run jobs.
    pub async fn list_jobs(
        client: &mut GcpClient,
        project: &str,
        region: &str,
    ) -> GcpResult<Vec<Job>> {
        let parent = format!("projects/{}/locations/{}", project, region);
        let path = format!("{}/{}/jobs", V2, parent);
        let resp: JobList = client.get(SERVICE, &path, &[]).await?;
        Ok(resp.jobs)
    }

    /// Get a job.
    pub async fn get_job(
        client: &mut GcpClient,
        project: &str,
        region: &str,
        job_name: &str,
    ) -> GcpResult<Job> {
        let path = format!(
            "{}/projects/{}/locations/{}/jobs/{}",
            V2, project, region, job_name
        );
        client.get(SERVICE, &path, &[]).await
    }

    /// Delete a job.
    pub async fn delete_job(
        client: &mut GcpClient,
        project: &str,
        region: &str,
        job_name: &str,
    ) -> GcpResult<RunOperation> {
        let path = format!(
            "{}/projects/{}/locations/{}/jobs/{}",
            V2, project, region, job_name
        );
        let resp_text = client.delete(SERVICE, &path).await?;
        let op: RunOperation = serde_json::from_str(&resp_text)
            .unwrap_or(RunOperation {
                name: String::new(),
                done: true,
                metadata: None,
                response: None,
                error: None,
            });
        Ok(op)
    }

    /// Run a job (create an execution).
    pub async fn run_job(
        client: &mut GcpClient,
        project: &str,
        region: &str,
        job_name: &str,
    ) -> GcpResult<RunOperation> {
        let path = format!(
            "{}/projects/{}/locations/{}/jobs/{}:run",
            V2, project, region, job_name
        );
        let body = serde_json::json!({});
        client.post(SERVICE, &path, &body).await
    }

    // ── Executions ──────────────────────────────────────────────────

    /// List executions for a job.
    pub async fn list_executions(
        client: &mut GcpClient,
        project: &str,
        region: &str,
        job_name: &str,
    ) -> GcpResult<Vec<Execution>> {
        let parent = format!(
            "projects/{}/locations/{}/jobs/{}",
            project, region, job_name
        );
        let path = format!("{}/{}/executions", V2, parent);
        let resp: ExecutionList = client.get(SERVICE, &path, &[]).await?;
        Ok(resp.executions)
    }

    /// Delete an execution.
    pub async fn delete_execution(
        client: &mut GcpClient,
        project: &str,
        region: &str,
        job_name: &str,
        execution_name: &str,
    ) -> GcpResult<RunOperation> {
        let path = format!(
            "{}/projects/{}/locations/{}/jobs/{}/executions/{}",
            V2, project, region, job_name, execution_name
        );
        let resp_text = client.delete(SERVICE, &path).await?;
        let op: RunOperation = serde_json::from_str(&resp_text)
            .unwrap_or(RunOperation {
                name: String::new(),
                done: true,
                metadata: None,
                response: None,
                error: None,
            });
        Ok(op)
    }
}
