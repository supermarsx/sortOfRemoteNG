//! Shared types for CI/CD integration.

use serde::{Deserialize, Serialize};

// ═══════════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CicdConnectionConfig {
    pub provider: CicdProvider,
    pub base_url: String,
    pub api_token: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub tls_skip_verify: Option<bool>,
    pub timeout_secs: Option<u64>,
    pub org: Option<String>,
    pub repo: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CicdProvider {
    Drone,
    Jenkins,
    GitHubActions,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CicdConnectionSummary {
    pub provider: CicdProvider,
    pub base_url: String,
    pub version: Option<String>,
    pub user: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Pipelines / Builds
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CicdPipeline {
    pub id: String,
    pub name: String,
    pub provider: CicdProvider,
    pub repo: Option<String>,
    pub default_branch: Option<String>,
    pub last_build: Option<CicdBuild>,
    pub status: PipelineStatus,
    pub url: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PipelineStatus {
    Active,
    Inactive,
    Disabled,
    Error,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CicdBuild {
    pub id: String,
    pub pipeline_id: String,
    pub number: u64,
    pub status: BuildStatus,
    pub branch: Option<String>,
    pub commit: Option<String>,
    pub commit_message: Option<String>,
    pub author: Option<String>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub duration_secs: Option<u64>,
    pub trigger: BuildTrigger,
    pub stages: Vec<BuildStage>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum BuildStatus {
    Pending,
    Running,
    Success,
    Failure,
    Cancelled,
    Skipped,
    Error,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum BuildTrigger {
    Push,
    PullRequest,
    Manual,
    Scheduled,
    Api,
    Tag,
    Webhook,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildStage {
    pub name: String,
    pub status: BuildStatus,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub duration_secs: Option<u64>,
    pub steps: Vec<BuildStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildStep {
    pub name: String,
    pub status: BuildStatus,
    pub log: Option<String>,
    pub exit_code: Option<i32>,
    pub duration_secs: Option<u64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Artifacts
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CicdArtifact {
    pub id: String,
    pub build_id: String,
    pub name: String,
    pub size_bytes: Option<u64>,
    pub mime_type: Option<String>,
    pub download_url: Option<String>,
    pub expires_at: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Secrets / Environment
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CicdSecret {
    pub name: String,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CicdEnvVar {
    pub name: String,
    pub value: String,
    pub is_secret: bool,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Drone-specific
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DroneRepo {
    pub id: u64,
    pub namespace: String,
    pub name: String,
    pub slug: String,
    pub active: bool,
    pub visibility: String,
    pub default_branch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DroneBuild {
    pub id: u64,
    pub repo_id: u64,
    pub number: u64,
    pub status: String,
    pub event: String,
    pub action: String,
    pub link: String,
    pub message: String,
    pub before: String,
    pub after: String,
    #[serde(rename = "ref")]
    pub ref_field: String,
    pub source_repo: String,
    pub source_branch: String,
    pub target_branch: String,
    pub author_login: String,
    pub author_name: String,
    pub author_email: String,
    pub author_avatar: String,
    pub started: u64,
    pub finished: u64,
    pub created: u64,
    pub updated: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DroneBuildLog {
    pub name: String,
    pub step: u32,
    pub exit_code: i32,
    pub started: u64,
    pub stopped: u64,
    pub version: u32,
    pub out: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Jenkins-specific
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JenkinsJob {
    pub name: String,
    pub url: String,
    pub color: String,
    pub description: Option<String>,
    pub buildable: bool,
    pub in_queue: bool,
    pub last_build: Option<JenkinsBuildRef>,
    pub last_successful_build: Option<JenkinsBuildRef>,
    pub last_failed_build: Option<JenkinsBuildRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JenkinsBuildRef {
    pub number: u64,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JenkinsBuildInfo {
    pub number: u64,
    pub url: String,
    pub result: Option<String>,
    pub building: bool,
    pub duration: u64,
    pub estimated_duration: u64,
    pub timestamp: u64,
    pub display_name: String,
    pub description: Option<String>,
    pub artifacts: Vec<JenkinsArtifact>,
    pub change_sets: Vec<JenkinsChangeSet>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JenkinsArtifact {
    pub display_path: String,
    pub file_name: String,
    pub relative_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JenkinsChangeSet {
    pub kind: String,
    pub items: Vec<JenkinsChange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JenkinsChange {
    pub author_email: String,
    pub commit_id: String,
    pub msg: String,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JenkinsQueueItem {
    pub id: u64,
    pub task_name: String,
    pub why: Option<String>,
    pub in_queue_since: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JenkinsNode {
    pub display_name: String,
    pub description: Option<String>,
    pub offline: bool,
    pub num_executors: u32,
    pub idle: bool,
    pub jnlp_agent: bool,
    pub labels: Vec<String>,
    pub monitor_data: Option<serde_json::Value>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// GitHub Actions-specific
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GhaWorkflow {
    pub id: u64,
    pub node_id: String,
    pub name: String,
    pub path: String,
    pub state: String,
    pub url: String,
    pub badge_url: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GhaWorkflowRun {
    pub id: u64,
    pub name: String,
    pub workflow_id: u64,
    pub status: String,
    pub conclusion: Option<String>,
    pub head_branch: String,
    pub head_sha: String,
    pub event: String,
    pub run_number: u64,
    pub run_attempt: u64,
    pub html_url: String,
    pub created_at: String,
    pub updated_at: String,
    pub actor: GhaActor,
    pub triggering_actor: Option<GhaActor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GhaActor {
    pub login: String,
    pub id: u64,
    pub avatar_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GhaJob {
    pub id: u64,
    pub run_id: u64,
    pub name: String,
    pub status: String,
    pub conclusion: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub steps: Vec<GhaStep>,
    pub runner_name: Option<String>,
    pub runner_group_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GhaStep {
    pub name: String,
    pub status: String,
    pub conclusion: Option<String>,
    pub number: u32,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GhaArtifact {
    pub id: u64,
    pub name: String,
    pub size_in_bytes: u64,
    pub archive_download_url: String,
    pub expired: bool,
    pub created_at: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GhaSecret {
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GhaRunner {
    pub id: u64,
    pub name: String,
    pub os: String,
    pub status: String,
    pub busy: bool,
    pub labels: Vec<GhaLabel>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GhaLabel {
    pub id: u64,
    pub name: String,
    #[serde(rename = "type")]
    pub label_type: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Dashboard
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CicdDashboard {
    pub provider: CicdProvider,
    pub total_pipelines: u64,
    pub total_builds: u64,
    pub successful_builds: u64,
    pub failed_builds: u64,
    pub running_builds: u64,
    pub recent_builds: Vec<CicdBuild>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// API list wrappers (GitHub returns paginated envelopes)
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GhaWorkflowList {
    pub total_count: u64,
    pub workflows: Vec<GhaWorkflow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GhaRunList {
    pub total_count: u64,
    pub workflow_runs: Vec<GhaWorkflowRun>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GhaJobList {
    pub total_count: u64,
    pub jobs: Vec<GhaJob>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GhaArtifactList {
    pub total_count: u64,
    pub artifacts: Vec<GhaArtifact>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GhaSecretList {
    pub total_count: u64,
    pub secrets: Vec<GhaSecret>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GhaRunnerList {
    pub total_count: u64,
    pub runners: Vec<GhaRunner>,
}

// Jenkins list wrapper
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JenkinsJobList {
    pub jobs: Vec<JenkinsJob>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JenkinsQueueList {
    pub items: Vec<JenkinsQueueItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JenkinsNodeList {
    pub computer: Vec<JenkinsNode>,
}

// Drone cron
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DroneCron {
    pub id: u64,
    pub name: String,
    pub expr: String,
    pub branch: String,
    pub disabled: bool,
    pub created: u64,
    pub updated: u64,
    pub next: u64,
}

// Drone secret
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DroneSecret {
    pub name: String,
    pub data: Option<String>,
    pub pull_request: Option<bool>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Create / Update payloads
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSecretPayload {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDroneCronPayload {
    pub name: String,
    pub expr: String,
    pub branch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GhaDispatchPayload {
    #[serde(rename = "ref")]
    pub ref_field: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inputs: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GhaSecretPayload {
    pub encrypted_value: String,
    pub key_id: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_round_trip() {
        let p = CicdProvider::Drone;
        let json = serde_json::to_string(&p).unwrap();
        assert_eq!(json, "\"drone\"");
        let back: CicdProvider = serde_json::from_str(&json).unwrap();
        assert_eq!(back, CicdProvider::Drone);
    }

    #[test]
    fn pipeline_status_round_trip() {
        let s = PipelineStatus::Active;
        let json = serde_json::to_string(&s).unwrap();
        assert_eq!(json, "\"active\"");
    }

    #[test]
    fn build_status_round_trip() {
        let s = BuildStatus::Success;
        let json = serde_json::to_string(&s).unwrap();
        assert_eq!(json, "\"success\"");
    }

    #[test]
    fn build_trigger_round_trip() {
        let t = BuildTrigger::PullRequest;
        let json = serde_json::to_string(&t).unwrap();
        assert_eq!(json, "\"pull_request\"");
    }

    #[test]
    fn connection_config_camel_case() {
        let cfg = CicdConnectionConfig {
            provider: CicdProvider::Jenkins,
            base_url: "http://localhost:8080".into(),
            api_token: Some("tok".into()),
            username: None,
            password: None,
            tls_skip_verify: None,
            timeout_secs: Some(30),
            org: None,
            repo: None,
        };
        let json = serde_json::to_value(&cfg).unwrap();
        assert!(json.get("baseUrl").is_some());
        assert!(json.get("apiToken").is_some());
        assert!(json.get("timeoutSecs").is_some());
    }

    #[test]
    fn cicd_build_serialize() {
        let build = CicdBuild {
            id: "1".into(),
            pipeline_id: "p1".into(),
            number: 42,
            status: BuildStatus::Running,
            branch: Some("main".into()),
            commit: Some("abc123".into()),
            commit_message: Some("fix stuff".into()),
            author: Some("dev".into()),
            started_at: Some("2025-01-01T00:00:00Z".into()),
            finished_at: None,
            duration_secs: None,
            trigger: BuildTrigger::Push,
            stages: vec![],
            url: None,
        };
        let json = serde_json::to_value(&build).unwrap();
        assert_eq!(json["pipelineId"], "p1");
        assert_eq!(json["number"], 42);
    }

    #[test]
    fn dashboard_serialize() {
        let dash = CicdDashboard {
            provider: CicdProvider::GitHubActions,
            total_pipelines: 5,
            total_builds: 100,
            successful_builds: 80,
            failed_builds: 15,
            running_builds: 5,
            recent_builds: vec![],
        };
        let json = serde_json::to_value(&dash).unwrap();
        assert_eq!(json["totalPipelines"], 5);
        assert_eq!(json["successfulBuilds"], 80);
    }

    #[test]
    fn gha_workflow_camel_case() {
        let w = GhaWorkflow {
            id: 1,
            node_id: "n1".into(),
            name: "CI".into(),
            path: ".github/workflows/ci.yml".into(),
            state: "active".into(),
            url: "https://api.github.com/repos/o/r/actions/workflows/1".into(),
            badge_url: "https://github.com/o/r/workflows/CI/badge.svg".into(),
            created_at: "2025-01-01T00:00:00Z".into(),
            updated_at: "2025-01-01T00:00:00Z".into(),
        };
        let json = serde_json::to_value(&w).unwrap();
        assert!(json.get("nodeId").is_some());
        assert!(json.get("badgeUrl").is_some());
    }
}
