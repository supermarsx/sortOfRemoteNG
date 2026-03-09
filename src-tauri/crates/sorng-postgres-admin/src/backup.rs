// ── sorng-postgres-admin/src/backup.rs ────────────────────────────────────────
//! PostgreSQL backup and restore via pg_dump, pg_dumpall, pg_basebackup, pg_restore.

use crate::client::{shell_escape, PgClient};
use crate::error::PgResult;
use crate::types::{PgBackupConfig, PgBackupResult};

pub struct BackupManager;

impl BackupManager {
    /// Run pg_dump for a single database.
    pub async fn pg_dump(client: &PgClient, config: &PgBackupConfig) -> PgResult<PgBackupResult> {
        let db = config
            .databases
            .first()
            .map(|s| s.as_str())
            .unwrap_or(client.config.pg_database.as_deref().unwrap_or("postgres"));

        let mut cmd = format!("{}{}", client.pgpassword_prefix(), client.pg_dump_bin());
        cmd.push_str(&format!(" {}", client.pg_dump_conn_args(db)));

        match config.format.as_str() {
            "custom" => cmd.push_str(" -Fc"),
            "directory" => cmd.push_str(" -Fd"),
            "tar" => cmd.push_str(" -Ft"),
            _ => cmd.push_str(" -Fp"),
        }

        if let Some(level) = config.compress_level {
            cmd.push_str(&format!(" -Z {}", level));
        }
        if let Some(jobs) = config.jobs {
            cmd.push_str(&format!(" -j {}", jobs));
        }
        if config.verbose {
            cmd.push_str(" -v");
        }
        cmd.push_str(&format!(" -f {}", shell_escape(&config.output_path)));

        let start = std::time::Instant::now();
        client.exec_ssh(&cmd).await?;
        let duration = start.elapsed().as_secs_f64();

        let size = Self::get_backup_size(client, &config.output_path)
            .await
            .unwrap_or(0);

        Ok(PgBackupResult {
            path: config.output_path.clone(),
            size_bytes: size,
            duration_secs: duration,
            databases: vec![db.to_string()],
            format: config.format.clone(),
        })
    }

    /// Restore a database from a backup file.
    pub async fn pg_restore(
        client: &PgClient,
        db: &str,
        path: &str,
        format: Option<&str>,
    ) -> PgResult<()> {
        let mut cmd = format!("{}{}", client.pgpassword_prefix(), client.pg_restore_bin());
        cmd.push_str(&format!(
            " -U {}",
            shell_escape(client.config.pg_user.as_deref().unwrap_or("postgres"))
        ));
        cmd.push_str(&format!(
            " -h {}",
            shell_escape(client.config.pg_host.as_deref().unwrap_or("127.0.0.1"))
        ));
        cmd.push_str(&format!(" -p {}", client.config.pg_port.unwrap_or(5432)));
        cmd.push_str(&format!(" -d {}", shell_escape(db)));

        if let Some(f) = format {
            match f {
                "custom" => cmd.push_str(" -Fc"),
                "directory" => cmd.push_str(" -Fd"),
                "tar" => cmd.push_str(" -Ft"),
                _ => {}
            }
        }

        cmd.push_str(&format!(" {}", shell_escape(path)));
        client.exec_ssh(&cmd).await?;
        Ok(())
    }

    /// Dump all databases and globals using pg_dumpall.
    pub async fn pg_dumpall(client: &PgClient, path: &str) -> PgResult<PgBackupResult> {
        let mut cmd = format!("{}pg_dumpall", client.pgpassword_prefix());
        cmd.push_str(&format!(
            " -U {}",
            shell_escape(client.config.pg_user.as_deref().unwrap_or("postgres"))
        ));
        cmd.push_str(&format!(
            " -h {}",
            shell_escape(client.config.pg_host.as_deref().unwrap_or("127.0.0.1"))
        ));
        cmd.push_str(&format!(" -p {}", client.config.pg_port.unwrap_or(5432)));
        cmd.push_str(&format!(" -f {}", shell_escape(path)));

        let start = std::time::Instant::now();
        client.exec_ssh(&cmd).await?;
        let duration = start.elapsed().as_secs_f64();
        let size = Self::get_backup_size(client, path).await.unwrap_or(0);

        Ok(PgBackupResult {
            path: path.to_string(),
            size_bytes: size,
            duration_secs: duration,
            databases: vec!["__all__".to_string()],
            format: "plain".to_string(),
        })
    }

    /// Run pg_basebackup for a physical backup.
    pub async fn pg_basebackup(
        client: &PgClient,
        path: &str,
        format: Option<&str>,
        checkpoint: Option<&str>,
    ) -> PgResult<PgBackupResult> {
        let mut cmd = format!(
            "{}{}",
            client.pgpassword_prefix(),
            client.pg_basebackup_bin()
        );
        cmd.push_str(&format!(
            " -U {}",
            shell_escape(client.config.pg_user.as_deref().unwrap_or("postgres"))
        ));
        cmd.push_str(&format!(
            " -h {}",
            shell_escape(client.config.pg_host.as_deref().unwrap_or("127.0.0.1"))
        ));
        cmd.push_str(&format!(" -p {}", client.config.pg_port.unwrap_or(5432)));
        cmd.push_str(&format!(" -D {}", shell_escape(path)));

        match format {
            Some("tar") => cmd.push_str(" -Ft"),
            _ => cmd.push_str(" -Fp"),
        }

        match checkpoint {
            Some("fast") => cmd.push_str(" --checkpoint=fast"),
            _ => cmd.push_str(" --checkpoint=spread"),
        }

        cmd.push_str(" -Xs"); // stream WAL during backup

        let start = std::time::Instant::now();
        client.exec_ssh(&cmd).await?;
        let duration = start.elapsed().as_secs_f64();
        let size = Self::get_backup_size(client, path).await.unwrap_or(0);

        Ok(PgBackupResult {
            path: path.to_string(),
            size_bytes: size,
            duration_secs: duration,
            databases: vec!["__basebackup__".to_string()],
            format: format.unwrap_or("plain").to_string(),
        })
    }

    /// List backup files in a directory.
    pub async fn list_backup_files(client: &PgClient, dir: &str) -> PgResult<Vec<String>> {
        let cmd = format!("ls -1 {} 2>/dev/null || true", shell_escape(dir));
        let out = client.exec_ssh(&cmd).await?;
        Ok(out
            .stdout
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| l.to_string())
            .collect())
    }

    /// Verify a backup file exists and is non-empty.
    pub async fn verify_backup(client: &PgClient, path: &str) -> PgResult<bool> {
        let cmd = format!("test -s {} && echo yes || echo no", shell_escape(path));
        let out = client.exec_ssh(&cmd).await?;
        Ok(out.stdout.trim() == "yes")
    }

    /// Get backup file or directory size in bytes.
    pub async fn get_backup_size(client: &PgClient, path: &str) -> PgResult<u64> {
        let cmd = format!("du -sb {} 2>/dev/null | cut -f1", shell_escape(path));
        let out = client.exec_ssh(&cmd).await?;
        Ok(out.stdout.trim().parse().unwrap_or(0))
    }
}
