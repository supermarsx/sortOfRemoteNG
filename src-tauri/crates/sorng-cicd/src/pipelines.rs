// ── sorng-cicd/src/pipelines.rs ──────────────────────────────────────────────
//! Unified pipeline / build normalization across CI/CD providers.

use crate::types::*;

// ═══════════════════════════════════════════════════════════════════════════════
// Drone → Unified
// ═══════════════════════════════════════════════════════════════════════════════

pub fn normalize_drone_build(b: &DroneBuild, owner: &str, name: &str) -> CicdBuild {
    CicdBuild {
        id: b.id.to_string(),
        pipeline_id: format!("{owner}/{name}"),
        number: b.number,
        status: map_drone_status(&b.status),
        branch: Some(b.target_branch.clone()),
        commit: Some(b.after.clone()),
        commit_message: Some(b.message.clone()),
        author: Some(b.author_login.clone()),
        started_at: if b.started > 0 { Some(format_epoch(b.started)) } else { None },
        finished_at: if b.finished > 0 { Some(format_epoch(b.finished)) } else { None },
        duration_secs: if b.finished > b.started { Some(b.finished - b.started) } else { None },
        trigger: map_drone_event(&b.event),
        stages: vec![],
        url: Some(b.link.clone()),
    }
}

pub fn normalize_drone_repo(repo: &DroneRepo) -> CicdPipeline {
    CicdPipeline {
        id: repo.id.to_string(),
        name: repo.slug.clone(),
        provider: CicdProvider::Drone,
        repo: Some(format!("{}/{}", repo.namespace, repo.name)),
        default_branch: Some(repo.default_branch.clone()),
        last_build: None,
        status: if repo.active { PipelineStatus::Active } else { PipelineStatus::Inactive },
        url: None,
        created_at: None,
        updated_at: None,
    }
}

pub fn map_drone_status(s: &str) -> BuildStatus {
    match s {
        "success" => BuildStatus::Success,
        "failure" | "error" => BuildStatus::Failure,
        "running" => BuildStatus::Running,
        "pending" => BuildStatus::Pending,
        "killed" => BuildStatus::Cancelled,
        "skipped" => BuildStatus::Skipped,
        _ => BuildStatus::Unknown,
    }
}

fn map_drone_event(event: &str) -> BuildTrigger {
    match event {
        "push" => BuildTrigger::Push,
        "pull_request" => BuildTrigger::PullRequest,
        "tag" => BuildTrigger::Tag,
        "cron" => BuildTrigger::Scheduled,
        "custom" => BuildTrigger::Manual,
        _ => BuildTrigger::Webhook,
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Jenkins → Unified
// ═══════════════════════════════════════════════════════════════════════════════

pub fn normalize_jenkins_build(b: &JenkinsBuildInfo, job_name: &str) -> CicdBuild {
    CicdBuild {
        id: b.number.to_string(),
        pipeline_id: job_name.to_string(),
        number: b.number,
        status: map_jenkins_result(b.result.as_deref(), b.building),
        branch: None,
        commit: b.change_sets.first()
            .and_then(|cs| cs.items.first())
            .map(|c| c.commit_id.clone()),
        commit_message: b.change_sets.first()
            .and_then(|cs| cs.items.first())
            .map(|c| c.msg.clone()),
        author: b.change_sets.first()
            .and_then(|cs| cs.items.first())
            .map(|c| c.author_email.clone()),
        started_at: Some(format_epoch_ms(b.timestamp)),
        finished_at: if !b.building && b.duration > 0 {
            Some(format_epoch_ms(b.timestamp + b.duration))
        } else {
            None
        },
        duration_secs: if b.duration > 0 { Some(b.duration / 1000) } else { None },
        trigger: BuildTrigger::Manual,
        stages: vec![],
        url: Some(b.url.clone()),
    }
}

pub fn normalize_jenkins_job(job: &JenkinsJob) -> CicdPipeline {
    let status = match job.color.as_str() {
        "blue" | "blue_anime" => PipelineStatus::Active,
        "red" | "red_anime" => PipelineStatus::Error,
        "disabled" | "disabled_anime" => PipelineStatus::Disabled,
        "notbuilt" | "notbuilt_anime" => PipelineStatus::Inactive,
        _ => PipelineStatus::Unknown,
    };
    CicdPipeline {
        id: job.name.clone(),
        name: job.name.clone(),
        provider: CicdProvider::Jenkins,
        repo: None,
        default_branch: None,
        last_build: None,
        status,
        url: Some(job.url.clone()),
        created_at: None,
        updated_at: None,
    }
}

pub fn map_jenkins_result(result: Option<&str>, building: bool) -> BuildStatus {
    if building {
        return BuildStatus::Running;
    }
    match result {
        Some("SUCCESS") => BuildStatus::Success,
        Some("FAILURE") => BuildStatus::Failure,
        Some("ABORTED") => BuildStatus::Cancelled,
        Some("UNSTABLE") => BuildStatus::Failure,
        Some("NOT_BUILT") => BuildStatus::Skipped,
        None => BuildStatus::Pending,
        _ => BuildStatus::Unknown,
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GitHub Actions → Unified
// ═══════════════════════════════════════════════════════════════════════════════

pub fn normalize_gha_run(run: &GhaWorkflowRun) -> CicdBuild {
    CicdBuild {
        id: run.id.to_string(),
        pipeline_id: run.workflow_id.to_string(),
        number: run.run_number,
        status: map_gha_conclusion(run.conclusion.as_deref(), &run.status),
        branch: Some(run.head_branch.clone()),
        commit: Some(run.head_sha.clone()),
        commit_message: None,
        author: Some(run.actor.login.clone()),
        started_at: Some(run.created_at.clone()),
        finished_at: if run.conclusion.is_some() { Some(run.updated_at.clone()) } else { None },
        duration_secs: None,
        trigger: map_gha_event(&run.event),
        stages: vec![],
        url: Some(run.html_url.clone()),
    }
}

pub fn normalize_gha_workflow(w: &GhaWorkflow) -> CicdPipeline {
    let status = match w.state.as_str() {
        "active" => PipelineStatus::Active,
        "disabled_manually" | "disabled_inactivity" => PipelineStatus::Disabled,
        _ => PipelineStatus::Unknown,
    };
    CicdPipeline {
        id: w.id.to_string(),
        name: w.name.clone(),
        provider: CicdProvider::GitHubActions,
        repo: None,
        default_branch: None,
        last_build: None,
        status,
        url: Some(w.url.clone()),
        created_at: Some(w.created_at.clone()),
        updated_at: Some(w.updated_at.clone()),
    }
}

pub fn map_gha_conclusion(conclusion: Option<&str>, status: &str) -> BuildStatus {
    match conclusion {
        Some("success") => BuildStatus::Success,
        Some("failure") => BuildStatus::Failure,
        Some("cancelled") => BuildStatus::Cancelled,
        Some("skipped") => BuildStatus::Skipped,
        Some("action_required") | Some("timed_out") | Some("stale") => BuildStatus::Error,
        None => match status {
            "queued" | "waiting" => BuildStatus::Pending,
            "in_progress" => BuildStatus::Running,
            _ => BuildStatus::Unknown,
        },
        _ => BuildStatus::Unknown,
    }
}

fn map_gha_event(event: &str) -> BuildTrigger {
    match event {
        "push" => BuildTrigger::Push,
        "pull_request" | "pull_request_target" => BuildTrigger::PullRequest,
        "schedule" => BuildTrigger::Scheduled,
        "workflow_dispatch" => BuildTrigger::Manual,
        "repository_dispatch" => BuildTrigger::Api,
        _ => BuildTrigger::Webhook,
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn format_epoch(secs: u64) -> String {
    chrono::DateTime::from_timestamp(secs as i64, 0)
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_default()
}

fn format_epoch_ms(ms: u64) -> String {
    format_epoch(ms / 1000)
}
