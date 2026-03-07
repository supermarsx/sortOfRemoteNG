// ── sorng-postgres-admin – backup management ─────────────────────────────────
//! pg_dump, pg_restore, pg_basebackup, and PITR operations.

use crate::client::{shell_escape, PgAdminClient};
use crate::error::PgAdminResult;
use crate::types::*;

pub struct BackupManager;

impl BackupManager {
    /// Create a pg_dump backup.
    pub async fn create_dump(client: &PgAdminClient, req: &PgBackupRequest) -> PgAdminResult<BackupResult> {
        let fmt_flag = match req.format {
            PgDumpFormat::Custom => "-Fc",
            PgDumpFormat::Directory => "-Fd",
            PgDumpFormat::Tar => "-Ft",
            PgDumpFormat::Plain => "-Fp",
        };

        let mut cmd = format!(
            "pg_dump -U {} -d {} {} -f {}",
            client.pg_user(),
            shell_escape(&req.database),
            fmt_flag,
            shell_escape(&req.output_path)
        );

        if let Some(ref schema) = req.schema {
            cmd.push_str(&format!(" -n {}", shell_escape(schema)));
        }
        if let Some(ref tables) = req.tables {
            for t in tables {
                cmd.push_str(&format!(" -t {}", shell_escape(t)));
            }
        }
        if let Some(compress) = req.compress {
            cmd.push_str(&format!(" -Z {}", compress));
        }
        if let Some(jobs) = req.jobs {
            cmd.push_str(&format!(" -j {}", jobs));
        }
        if let Some(ref opts) = req.custom_options {
            for opt in opts {
                cmd.push_str(&format!(" {}", opt));
            }
        }

        let out = client.exec_ssh(&cmd).await?;
        let size = client.exec_ssh(&format!(
            "stat -c%s {} 2>/dev/null || echo 0",
            shell_escape(&req.output_path)
        )).await.ok().and_then(|o| o.stdout.trim().parse().ok());

        Ok(BackupResult {
            success: out.exit_code == 0,
            output_path: req.output_path.clone(),
            size_bytes: size,
            duration_secs: None,
            message: if out.exit_code == 0 {
                "Backup completed successfully".to_string()
            } else {
                format!("Backup failed: {}", out.stderr)
            },
        })
    }

    /// Restore from a pg_dump backup.
    pub async fn restore_dump(client: &PgAdminClient, req: &PgRestoreRequest) -> PgAdminResult<BackupResult> {
        let is_plain = matches!(req.format, PgDumpFormat::Plain);

        let cmd = if is_plain {
            format!(
                "psql -U {} -d {} -f {}",
                client.pg_user(),
                shell_escape(&req.database),
                shell_escape(&req.input_path),
            )
        } else {
            let mut c = format!(
                "pg_restore -U {} -d {}",
                client.pg_user(),
                shell_escape(&req.database),
            );
            if req.clean.unwrap_or(false) { c.push_str(" --clean"); }
            if req.create.unwrap_or(false) { c.push_str(" --create"); }
            if req.no_owner.unwrap_or(false) { c.push_str(" --no-owner"); }
            if req.no_privileges.unwrap_or(false) { c.push_str(" --no-privileges"); }
            if let Some(jobs) = req.jobs { c.push_str(&format!(" -j {}", jobs)); }
            c.push_str(&format!(" {}", shell_escape(&req.input_path)));
            c
        };

        let out = client.exec_ssh(&cmd).await?;
        Ok(BackupResult {
            success: out.exit_code == 0,
            output_path: req.input_path.clone(),
            size_bytes: None,
            duration_secs: None,
            message: if out.exit_code == 0 {
                "Restore completed successfully".to_string()
            } else {
                format!("Restore failed: {}", out.stderr)
            },
        })
    }

    /// Create a pg_basebackup.
    pub async fn create_basebackup(client: &PgAdminClient, req: &PgBasebackupRequest) -> PgAdminResult<BackupResult> {
        let mut cmd = format!(
            "pg_basebackup -U {} -D {}",
            client.pg_user(),
            shell_escape(&req.output_dir)
        );

        if let Some(ref fmt) = req.format { cmd.push_str(&format!(" -F{}", fmt)); }
        if let Some(ref cp) = req.checkpoint { cmd.push_str(&format!(" --checkpoint={}", cp)); }
        if let Some(ref wal) = req.wal_method { cmd.push_str(&format!(" --wal-method={}", wal)); }
        if let Some(ref comp) = req.compress { cmd.push_str(&format!(" -Z {}", comp)); }
        if let Some(ref label) = req.label { cmd.push_str(&format!(" -l {}", shell_escape(label))); }
        if req.progress.unwrap_or(false) { cmd.push_str(" -P"); }

        let out = client.exec_ssh(&cmd).await?;
        Ok(BackupResult {
            success: out.exit_code == 0,
            output_path: req.output_dir.clone(),
            size_bytes: None,
            duration_secs: None,
            message: if out.exit_code == 0 {
                "Base backup completed successfully".to_string()
            } else {
                format!("Base backup failed: {}", out.stderr)
            },
        })
    }

    /// List backup files in a directory.
    pub async fn list_backup_files(client: &PgAdminClient, dir: &str) -> PgAdminResult<Vec<String>> {
        let out = client.exec_ssh(&format!(
            "ls -1 {} 2>/dev/null || echo ''",
            shell_escape(dir)
        )).await?;
        Ok(out.stdout.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect())
    }

    /// Get PITR (Point-in-Time Recovery) information.
    pub async fn get_pitr_info(client: &PgAdminClient) -> PgAdminResult<PitrInfo> {
        let wal_level = client.exec_psql("SELECT setting FROM pg_settings WHERE name = 'wal_level';").await?;
        let archive_mode = client.exec_psql("SELECT setting FROM pg_settings WHERE name = 'archive_mode';").await?;
        let archive_cmd = client.exec_psql("SELECT setting FROM pg_settings WHERE name = 'archive_command';").await.ok();
        let restore_cmd = client.exec_psql("SELECT setting FROM pg_settings WHERE name = 'restore_command';").await.ok();

        Ok(PitrInfo {
            wal_level: wal_level.trim().to_string(),
            archive_mode: archive_mode.trim().to_string(),
            archive_command: archive_cmd.map(|s| s.trim().to_string()),
            restore_command: restore_cmd.map(|s| s.trim().to_string()),
            recovery_target_time: None,
            recovery_target_lsn: None,
            recovery_target_name: None,
            min_recovery_end_lsn: None,
        })
    }

    /// Get WAL archive status.
    pub async fn get_wal_archive_status(client: &PgAdminClient) -> PgAdminResult<String> {
        let raw = client.exec_psql(
            "SELECT archived_count, last_archived_wal, last_archived_time::text, \
             failed_count, last_failed_wal, last_failed_time::text, stats_reset::text \
             FROM pg_stat_archiver;"
        ).await?;
        Ok(raw.trim().to_string())
    }
}
