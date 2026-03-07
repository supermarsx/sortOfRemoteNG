//! # Cron Tauri Commands
//!
//! All `#[tauri::command]` functions exposed to the frontend via IPC.

use crate::access;
use crate::anacron;
use crate::at_jobs;
use crate::crontab;
use crate::expression;
use crate::service::CronServiceState;
use crate::system_cron;
use crate::types::*;
use std::collections::HashMap;
use tauri::State;

// ─── Host CRUD ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn cron_add_host(
    state: State<'_, CronServiceState>,
    host_id: String,
    name: String,
    ssh: Option<SshConfig>,
    use_sudo: Option<bool>,
) -> Result<CronHost, String> {
    let host = CronHost {
        id: host_id,
        name,
        ssh,
        use_sudo: use_sudo.unwrap_or(true),
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
    };
    let mut svc = state.lock().await;
    svc.add_host(host.clone()).map_err(|e| e.to_string())?;
    Ok(host)
}

#[tauri::command]
pub async fn cron_remove_host(
    state: State<'_, CronServiceState>,
    host_id: String,
) -> Result<CronHost, String> {
    let mut svc = state.lock().await;
    svc.remove_host(&host_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cron_update_host(
    state: State<'_, CronServiceState>,
    host_id: String,
    name: Option<String>,
    ssh: Option<Option<SshConfig>>,
    use_sudo: Option<bool>,
) -> Result<CronHost, String> {
    let mut svc = state.lock().await;
    let existing = svc.get_host(&host_id).map_err(|e| e.to_string())?.clone();
    let updated = CronHost {
        id: host_id,
        name: name.unwrap_or(existing.name),
        ssh: ssh.unwrap_or(existing.ssh),
        use_sudo: use_sudo.unwrap_or(existing.use_sudo),
        created_at: existing.created_at,
        updated_at: chrono::Utc::now(),
    };
    svc.update_host(updated.clone()).map_err(|e| e.to_string())?;
    Ok(updated)
}

#[tauri::command]
pub async fn cron_get_host(
    state: State<'_, CronServiceState>,
    host_id: String,
) -> Result<CronHost, String> {
    let svc = state.lock().await;
    svc.get_host(&host_id).cloned().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cron_list_hosts(
    state: State<'_, CronServiceState>,
) -> Result<Vec<CronHost>, String> {
    let svc = state.lock().await;
    Ok(svc.list_hosts().into_iter().cloned().collect())
}

// ─── Crontab (user crontab management) ─────────────────────────────

#[tauri::command]
pub async fn cron_list_user_crontabs(
    state: State<'_, CronServiceState>,
    host_id: String,
) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(|e| e.to_string())?.clone();
    drop(svc);
    crontab::list_user_crontabs(&host).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cron_get_crontab(
    state: State<'_, CronServiceState>,
    host_id: String,
    user: String,
) -> Result<Vec<CrontabEntry>, String> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(|e| e.to_string())?.clone();
    drop(svc);
    crontab::get_crontab(&host, &user).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cron_add_job(
    state: State<'_, CronServiceState>,
    host_id: String,
    user: String,
    schedule: String,
    command: String,
    comment: Option<String>,
    enabled: Option<bool>,
) -> Result<(), String> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(|e| e.to_string())?.clone();
    drop(svc);

    let parsed_schedule = expression::validate_expression(&schedule)
        .map_err(|e| e.to_string())?;

    let job = CronJob {
        id: uuid::Uuid::new_v4().to_string(),
        schedule: parsed_schedule,
        command,
        user: user.clone(),
        comment: comment.unwrap_or_default(),
        enabled: enabled.unwrap_or(true),
        environment: HashMap::new(),
        source: CronJobSource::UserCrontab,
    };

    crontab::add_job(&host, &user, &job).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cron_remove_job(
    state: State<'_, CronServiceState>,
    host_id: String,
    user: String,
    job_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(|e| e.to_string())?.clone();
    drop(svc);
    crontab::remove_job(&host, &user, &job_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cron_update_job(
    state: State<'_, CronServiceState>,
    host_id: String,
    user: String,
    job_id: String,
    schedule: Option<String>,
    command: Option<String>,
    comment: Option<String>,
    enabled: Option<bool>,
) -> Result<(), String> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(|e| e.to_string())?.clone();
    drop(svc);

    // Fetch current entries and find the job to update
    let entries = crontab::get_crontab(&host, &user).await.map_err(|e| e.to_string())?;
    let existing = entries
        .iter()
        .find_map(|e| {
            if let CrontabEntry::Job(j) = e {
                if j.id == job_id { Some(j.clone()) } else { None }
            } else {
                None
            }
        })
        .ok_or_else(|| format!("Job not found: {job_id}"))?;

    let new_schedule = if let Some(expr) = schedule {
        expression::validate_expression(&expr).map_err(|e| e.to_string())?
    } else {
        existing.schedule
    };

    let updated = CronJob {
        id: job_id.clone(),
        schedule: new_schedule,
        command: command.unwrap_or(existing.command),
        user: existing.user,
        comment: comment.unwrap_or(existing.comment),
        enabled: enabled.unwrap_or(existing.enabled),
        environment: existing.environment,
        source: existing.source,
    };

    crontab::update_job(&host, &user, &job_id, &updated)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cron_enable_job(
    state: State<'_, CronServiceState>,
    host_id: String,
    user: String,
    job_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(|e| e.to_string())?.clone();
    drop(svc);
    crontab::enable_job(&host, &user, &job_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cron_disable_job(
    state: State<'_, CronServiceState>,
    host_id: String,
    user: String,
    job_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(|e| e.to_string())?.clone();
    drop(svc);
    crontab::disable_job(&host, &user, &job_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cron_remove_crontab(
    state: State<'_, CronServiceState>,
    host_id: String,
    user: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(|e| e.to_string())?.clone();
    drop(svc);
    crontab::remove_crontab(&host, &user).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cron_backup_crontab(
    state: State<'_, CronServiceState>,
    host_id: String,
    user: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(|e| e.to_string())?.clone();
    drop(svc);
    crontab::backup_crontab(&host, &user).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cron_restore_crontab(
    state: State<'_, CronServiceState>,
    host_id: String,
    user: String,
    content: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(|e| e.to_string())?.clone();
    drop(svc);
    crontab::restore_crontab(&host, &user, &content).await.map_err(|e| e.to_string())
}

// ─── System cron (/etc/cron.d/, /etc/crontab, periodic) ────────────

#[tauri::command]
pub async fn cron_list_system_files(
    state: State<'_, CronServiceState>,
    host_id: String,
) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(|e| e.to_string())?.clone();
    drop(svc);
    system_cron::list_system_cron_files(&host).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cron_get_system_file(
    state: State<'_, CronServiceState>,
    host_id: String,
    name: String,
) -> Result<Vec<CrontabEntry>, String> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(|e| e.to_string())?.clone();
    drop(svc);
    system_cron::get_system_cron_file(&host, &name).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cron_create_system_file(
    state: State<'_, CronServiceState>,
    host_id: String,
    name: String,
    content: Vec<CrontabEntry>,
) -> Result<(), String> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(|e| e.to_string())?.clone();
    drop(svc);
    system_cron::create_system_cron_file(&host, &name, &content)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cron_delete_system_file(
    state: State<'_, CronServiceState>,
    host_id: String,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(|e| e.to_string())?.clone();
    drop(svc);
    system_cron::delete_system_cron_file(&host, &name).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cron_list_periodic(
    state: State<'_, CronServiceState>,
    host_id: String,
) -> Result<HashMap<String, Vec<String>>, String> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(|e| e.to_string())?.clone();
    drop(svc);
    system_cron::list_periodic_jobs(&host).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cron_get_etc_crontab(
    state: State<'_, CronServiceState>,
    host_id: String,
) -> Result<Vec<CrontabEntry>, String> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(|e| e.to_string())?.clone();
    drop(svc);
    system_cron::get_etc_crontab(&host).await.map_err(|e| e.to_string())
}

// ─── At / Batch Jobs ────────────────────────────────────────────────

#[tauri::command]
pub async fn cron_list_at_jobs(
    state: State<'_, CronServiceState>,
    host_id: String,
) -> Result<Vec<AtJob>, String> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(|e| e.to_string())?.clone();
    drop(svc);
    at_jobs::list_at_jobs(&host).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cron_get_at_job(
    state: State<'_, CronServiceState>,
    host_id: String,
    job_id: u64,
) -> Result<AtJob, String> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(|e| e.to_string())?.clone();
    drop(svc);
    at_jobs::get_at_job(&host, job_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cron_schedule_at_job(
    state: State<'_, CronServiceState>,
    host_id: String,
    time_spec: String,
    command: String,
) -> Result<AtJob, String> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(|e| e.to_string())?.clone();
    drop(svc);
    at_jobs::schedule_at_job(&host, &time_spec, &command)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cron_schedule_batch_job(
    state: State<'_, CronServiceState>,
    host_id: String,
    command: String,
) -> Result<AtJob, String> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(|e| e.to_string())?.clone();
    drop(svc);
    at_jobs::schedule_batch_job(&host, &command).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cron_remove_at_job(
    state: State<'_, CronServiceState>,
    host_id: String,
    job_id: u64,
) -> Result<(), String> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(|e| e.to_string())?.clone();
    drop(svc);
    at_jobs::remove_at_job(&host, job_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cron_get_at_access(
    state: State<'_, CronServiceState>,
    host_id: String,
) -> Result<CronAccessControl, String> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(|e| e.to_string())?.clone();
    drop(svc);
    at_jobs::get_at_access(&host).await.map_err(|e| e.to_string())
}

// ─── Anacron ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn cron_get_anacrontab(
    state: State<'_, CronServiceState>,
    host_id: String,
) -> Result<Vec<AnacronEntry>, String> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(|e| e.to_string())?.clone();
    drop(svc);
    anacron::get_anacrontab(&host).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cron_add_anacron_entry(
    state: State<'_, CronServiceState>,
    host_id: String,
    period_days: u32,
    delay_minutes: u32,
    job_id: String,
    command: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(|e| e.to_string())?.clone();
    drop(svc);

    let entry = AnacronEntry {
        period_days,
        delay_minutes,
        job_identifier: job_id,
        command,
    };

    anacron::add_anacron_entry(&host, &entry).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cron_remove_anacron_entry(
    state: State<'_, CronServiceState>,
    host_id: String,
    job_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(|e| e.to_string())?.clone();
    drop(svc);
    anacron::remove_anacron_entry(&host, &job_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cron_run_anacron(
    state: State<'_, CronServiceState>,
    host_id: String,
    force: bool,
) -> Result<String, String> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(|e| e.to_string())?.clone();
    drop(svc);
    anacron::run_anacron(&host, force).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cron_get_anacron_timestamps(
    state: State<'_, CronServiceState>,
    host_id: String,
) -> Result<HashMap<String, String>, String> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(|e| e.to_string())?.clone();
    drop(svc);
    let timestamps = anacron::get_anacron_timestamps(&host)
        .await
        .map_err(|e| e.to_string())?;
    // Convert DateTime<Utc> to RFC 3339 strings for JSON serialization
    Ok(timestamps
        .into_iter()
        .map(|(k, v)| (k, v.to_rfc3339()))
        .collect())
}

// ─── Cron Expression Utilities (no state needed) ────────────────────

#[tauri::command]
pub fn cron_validate_expression(
    expression: String,
) -> Result<CronSchedule, String> {
    expression::validate_expression(&expression).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cron_next_runs(
    expression: String,
    count: Option<usize>,
) -> Result<Vec<String>, String> {
    let n = count.unwrap_or(5);
    let result = expression::next_runs(&expression, n).map_err(|e| e.to_string())?;
    Ok(result.next_times.iter().map(|t| t.to_rfc3339()).collect())
}

#[tauri::command]
pub fn cron_describe_expression(
    expression: String,
) -> Result<String, String> {
    expression::describe_expression(&expression).map_err(|e| e.to_string())
}

// ─── Cron Access Control ────────────────────────────────────────────

#[tauri::command]
pub async fn cron_get_access(
    state: State<'_, CronServiceState>,
    host_id: String,
) -> Result<CronAccessControl, String> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(|e| e.to_string())?.clone();
    drop(svc);
    access::get_cron_access(&host).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cron_set_allow(
    state: State<'_, CronServiceState>,
    host_id: String,
    users: Vec<String>,
) -> Result<(), String> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(|e| e.to_string())?.clone();
    drop(svc);
    access::set_cron_allow(&host, &users).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cron_set_deny(
    state: State<'_, CronServiceState>,
    host_id: String,
    users: Vec<String>,
) -> Result<(), String> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(|e| e.to_string())?.clone();
    drop(svc);
    access::set_cron_deny(&host, &users).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cron_check_user_access(
    state: State<'_, CronServiceState>,
    host_id: String,
    user: String,
) -> Result<bool, String> {
    let svc = state.lock().await;
    let host = svc.get_host(&host_id).map_err(|e| e.to_string())?.clone();
    drop(svc);
    access::check_user_access(&host, &user).await.map_err(|e| e.to_string())
}
