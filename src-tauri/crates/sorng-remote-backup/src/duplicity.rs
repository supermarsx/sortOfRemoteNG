//! Duplicity wrapper — encrypted incremental backups, restore, status, cleanup.

use crate::error::BackupError;
use crate::process::BoundedCommandExt;
use crate::types::{
    BackupExecutionRecord, BackupJobStatus, BackupPhase, BackupProgress, BackupTool,
    DuplicityBackupType, DuplicityConfig,
};
use chrono::Utc;
use log::{error, info};
use std::collections::HashMap;
use tokio::process::Command;
use uuid::Uuid;

/// Build environment variables for duplicity.
pub fn build_env(cfg: &DuplicityConfig) -> HashMap<String, String> {
    let mut env = HashMap::new();
    if let Some(pass) = &cfg.passphrase {
        env.insert("PASSPHRASE".into(), pass.clone());
    }
    if let Some(_key) = &cfg.sign_key {
        env.insert(
            "SIGN_PASSPHRASE".into(),
            cfg.passphrase.clone().unwrap_or_default(),
        );
    }
    // SSH password for scp/sftp backends
    if let Some(ssh) = &cfg.ssh {
        if let Some(pass) = &ssh.password {
            env.insert("FTP_PASSWORD".into(), pass.clone());
        }
    }
    env
}

/// Build duplicity argument vector for a backup operation.
pub fn build_backup_args(cfg: &DuplicityConfig) -> Result<Vec<String>, BackupError> {
    validate_config(cfg)?;
    let mut args: Vec<String> = Vec::new();

    // Backup type
    match &cfg.backup_type {
        Some(DuplicityBackupType::Full) => args.push("full".into()),
        Some(DuplicityBackupType::Incremental) => args.push("incr".into()),
        _ => {} // auto — duplicity decides
    }

    // Encryption
    if cfg.no_encryption {
        args.push("--no-encryption".into());
    } else {
        if let Some(key) = &cfg.encrypt_key {
            args.push("--encrypt-key".into());
            args.push(key.clone());
        }
        if let Some(key) = &cfg.sign_key {
            args.push("--sign-key".into());
            args.push(key.clone());
        }
    }

    // Full-if-older-than
    if let Some(age) = &cfg.full_if_older_than {
        args.push("--full-if-older-than".into());
        args.push(age.clone());
    }

    // Volume size
    if let Some(vs) = cfg.volsize {
        args.push("--volsize".into());
        args.push(vs.to_string());
    }

    // Retries
    if let Some(nr) = cfg.num_retries {
        args.push("--num-retries".into());
        args.push(nr.to_string());
    }

    // Temp/archive dirs
    if let Some(td) = &cfg.temp_dir {
        args.push("--tempdir".into());
        args.push(td.clone());
    }
    if let Some(ad) = &cfg.archive_dir {
        args.push("--archive-dir".into());
        args.push(ad.clone());
    }

    // Exclude / include
    for ex in &cfg.exclude {
        args.push("--exclude".into());
        args.push(ex.clone());
    }
    for inc in &cfg.include {
        args.push("--include".into());
        args.push(inc.clone());
    }

    // SSH options
    if let Some(ssh) = &cfg.ssh {
        let ssh_cmd = ssh.to_ssh_command()?;
        args.push("--ssh-options".into());
        args.push(ssh_cmd);
    }

    if cfg.dry_run {
        args.push("--dry-run".into());
    }

    // Extra args
    for a in &cfg.extra_args {
        args.push(a.clone());
    }

    // Source and target
    args.push(cfg.source.clone());
    args.push(cfg.target_url.clone());

    Ok(args)
}

/// Execute a duplicity backup.
pub async fn backup(
    cfg: &DuplicityConfig,
    job_id: &str,
    mut on_progress: impl FnMut(BackupProgress),
) -> Result<BackupExecutionRecord, BackupError> {
    let binary = cfg.duplicity_binary.as_deref().unwrap_or("duplicity");
    let args = build_backup_args(cfg)?;
    let env = build_env(cfg);
    let cmd_str = "duplicity <arguments redacted>".to_string();
    info!("Executing duplicity backup");
    let started_at = Utc::now();

    let output = Command::new(binary)
        .args(&args)
        .envs(&env)
        .output_bounded()
        .await
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                BackupError::ToolNotFound(format!("duplicity binary not found at: {binary}"))
            } else {
                BackupError::ProcessError(format!("failed to run duplicity safely: {e}"))
            }
        })?;
    let stdout_buf = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr_buf = String::from_utf8_lossy(&output.stderr).to_string();
    for line in stderr_buf.lines() {
        // Basic progress: duplicity outputs volume numbers
        if line.contains("Copying") || line.contains("Writing") {
            on_progress(BackupProgress {
                job_id: job_id.to_string(),
                bytes_transferred: 0,
                bytes_total: None,
                files_transferred: 0,
                files_total: None,
                current_file: Some(line.trim().to_string()),
                speed_bps: 0.0,
                eta_seconds: None,
                percent_complete: None,
                phase: BackupPhase::Transferring,
            });
        }
    }
    let exit_code = output.status.code().unwrap_or(-1);
    let finished_at = Utc::now();
    let duration = (finished_at - started_at).num_milliseconds() as f64 / 1000.0;

    let status = if exit_code == 0 {
        BackupJobStatus::Completed
    } else {
        error!("duplicity failed with exit code {exit_code}");
        BackupJobStatus::Failed
    };

    let record = BackupExecutionRecord {
        id: Uuid::new_v4().to_string(),
        job_id: job_id.to_string(),
        job_name: String::new(),
        tool: BackupTool::Duplicity,
        status,
        started_at,
        finished_at: Some(finished_at),
        duration_secs: Some(duration),
        bytes_transferred: 0,
        files_transferred: 0,
        files_deleted: 0,
        files_skipped: 0,
        files_failed: 0,
        speed_bps: None,
        file_records: Vec::new(),
        command: Some(cmd_str),
        stdout: Some(crate::rsync::truncate_output(&stdout_buf, 10_000)),
        stderr: if stderr_buf.is_empty() {
            None
        } else {
            Some(crate::rsync::truncate_output(&stderr_buf, 5_000))
        },
        exit_code: Some(exit_code),
        error: if exit_code != 0 {
            Some(format!("duplicity exited with code {exit_code}"))
        } else {
            None
        },
        retry_attempt: 0,
        snapshot_id: None,
        payload_hash: None,
        skipped_due_to_delta: false,
        per_target_results: Vec::new(),
    };

    if exit_code != 0 {
        return Err(BackupError::ToolFailed {
            tool: "duplicity".into(),
            exit_code,
            stderr: stderr_buf,
        });
    }

    Ok(record)
}

/// Restore from a duplicity backup.
pub async fn restore(
    cfg: &DuplicityConfig,
    target_path: &str,
    restore_time: Option<&str>,
    file_to_restore: Option<&str>,
) -> Result<String, BackupError> {
    validate_config(cfg)?;
    crate::types::validate_existing_restore_directory(
        "duplicity restore destination",
        target_path,
    )?;
    if let Some(time) = restore_time {
        crate::types::validate_cli_text("duplicity restore time", time, 256)?;
    }
    if let Some(file) = file_to_restore {
        crate::types::validate_cli_text("duplicity restore file", file, 4096)?;
    }
    let binary = cfg.duplicity_binary.as_deref().unwrap_or("duplicity");
    let env = build_env(cfg);
    let mut args = vec!["restore".to_string()];

    if cfg.no_encryption {
        args.push("--no-encryption".into());
    } else if let Some(key) = &cfg.encrypt_key {
        args.push("--encrypt-key".into());
        args.push(key.clone());
    }

    if let Some(time) = restore_time {
        args.push("--time".into());
        args.push(time.to_string());
    }
    if let Some(file) = file_to_restore {
        args.push("--file-to-restore".into());
        args.push(file.to_string());
    }

    args.push(cfg.target_url.clone());
    args.push(target_path.to_string());

    info!("Restoring duplicity backup to {target_path}");
    let output = Command::new(binary)
        .args(&args)
        .envs(&env)
        .output_bounded()
        .await
        .map_err(|e| BackupError::ProcessError(format!("failed to run duplicity restore: {e}")))?;

    if !output.status.success() {
        return Err(BackupError::ToolFailed {
            tool: "duplicity".into(),
            exit_code: output.status.code().unwrap_or(-1),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Get collection status (list backup chains/sets).
pub async fn collection_status(cfg: &DuplicityConfig) -> Result<String, BackupError> {
    validate_config(cfg)?;
    let binary = cfg.duplicity_binary.as_deref().unwrap_or("duplicity");
    let env = build_env(cfg);
    let mut args = vec!["collection-status".to_string()];

    if cfg.no_encryption {
        args.push("--no-encryption".into());
    }
    args.push(cfg.target_url.clone());

    let output = Command::new(binary)
        .args(&args)
        .envs(&env)
        .output_bounded()
        .await
        .map_err(|e| {
            BackupError::ProcessError(format!("failed to run duplicity collection-status: {e}"))
        })?;

    if !output.status.success() {
        return Err(BackupError::ToolFailed {
            tool: "duplicity".into(),
            exit_code: output.status.code().unwrap_or(-1),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Clean up old backup sets.
pub async fn cleanup(cfg: &DuplicityConfig) -> Result<String, BackupError> {
    validate_config(cfg)?;
    if !cfg.dry_run {
        return Err(BackupError::ConfigError(
            "duplicity cleanup requires dry-run mode until an explicit destructive-operation confirmation is wired".into(),
        ));
    }
    let binary = cfg.duplicity_binary.as_deref().unwrap_or("duplicity");
    let env = build_env(cfg);

    // Remove old backup sets
    let mut results = Vec::new();

    if let Some(older) = &cfg.remove_older_than {
        let args = vec![
            "remove-older-than".to_string(),
            older.clone(),
            "--dry-run".to_string(),
            "--force".to_string(),
            cfg.target_url.clone(),
        ];
        results.push(run_cleanup_step(binary, &env, &args, "remove-older-than").await?);
    }

    if let Some(n) = cfg.remove_all_but_n_full {
        let args = vec![
            "remove-all-but-n-full".to_string(),
            n.to_string(),
            "--dry-run".to_string(),
            "--force".to_string(),
            cfg.target_url.clone(),
        ];
        results.push(run_cleanup_step(binary, &env, &args, "remove-all-but-n-full").await?);
    }

    // Always run cleanup to remove orphan files
    let args = vec![
        "cleanup".to_string(),
        "--dry-run".to_string(),
        "--force".to_string(),
        cfg.target_url.clone(),
    ];
    results.push(run_cleanup_step(binary, &env, &args, "cleanup").await?);

    Ok(results.join("\n---\n"))
}

/// Verify a duplicity backup.
pub async fn verify(cfg: &DuplicityConfig) -> Result<String, BackupError> {
    validate_config(cfg)?;
    let binary = cfg.duplicity_binary.as_deref().unwrap_or("duplicity");
    let env = build_env(cfg);
    let mut args = vec!["verify".to_string()];

    if cfg.no_encryption {
        args.push("--no-encryption".into());
    }
    args.push(cfg.target_url.clone());
    args.push(cfg.source.clone());

    let output = Command::new(binary)
        .args(&args)
        .envs(&env)
        .output_bounded()
        .await
        .map_err(|e| BackupError::ProcessError(format!("failed to run duplicity verify: {e}")))?;

    if !output.status.success() {
        return Err(BackupError::IntegrityError(format!(
            "duplicity verify failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Get version of installed duplicity.
pub async fn version(duplicity_binary: Option<&str>) -> Result<String, BackupError> {
    let binary = duplicity_binary.unwrap_or("duplicity");
    let output = Command::new(binary)
        .args(["--version"])
        .output_bounded()
        .await
        .map_err(|e| {
            BackupError::ProcessError(format!("failed to run duplicity --version: {e}"))
        })?;

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn validate_config(cfg: &DuplicityConfig) -> Result<(), BackupError> {
    crate::types::validate_cli_text("duplicity source", &cfg.source, 4096)?;
    crate::types::validate_cli_text("duplicity target URL", &cfg.target_url, 4096)?;
    let target = cfg.target_url.to_ascii_lowercase();
    if target.starts_with("ftp://")
        || target.starts_with("http://")
        || target.starts_with("webdav://")
    {
        return Err(BackupError::ConfigError(
            "duplicity remote targets must use an authenticated encrypted transport".into(),
        ));
    }
    if cfg.no_encryption && !target.starts_with("file://") {
        return Err(BackupError::ConfigError(
            "unencrypted duplicity backups are only allowed for local file targets".into(),
        ));
    }
    crate::types::reject_embedded_url_credentials("duplicity target URL", &cfg.target_url)?;
    if cfg.num_retries.unwrap_or(0) > 10
        || cfg.volsize.unwrap_or(0) > 10_240
        || cfg.extra_args.len() > 64
    {
        return Err(BackupError::ConfigError(
            "duplicity retry, volume-size, or additional-argument limits were exceeded".into(),
        ));
    }
    if let Some(ssh) = &cfg.ssh {
        ssh.validate()?;
    }
    Ok(())
}

async fn run_cleanup_step(
    binary: &str,
    env: &HashMap<String, String>,
    args: &[String],
    operation: &str,
) -> Result<String, BackupError> {
    let output = Command::new(binary)
        .args(args)
        .envs(env)
        .output_bounded()
        .await
        .map_err(|error| {
            BackupError::ProcessError(format!("duplicity {operation} failed to run: {error}"))
        })?;
    if !output.status.success() {
        return Err(BackupError::ToolFailed {
            tool: "duplicity".into(),
            exit_code: output.status.code().unwrap_or(-1),
            stderr: crate::rsync::truncate_output(&String::from_utf8_lossy(&output.stderr), 5_000),
        });
    }
    Ok(crate::rsync::truncate_output(
        &String::from_utf8_lossy(&output.stdout),
        10_000,
    ))
}
