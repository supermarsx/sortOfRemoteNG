// ── sorng-mysql-admin – backup management ────────────────────────────────────

use crate::client::MysqlAdminClient;
use crate::error::{MysqlAdminError, MysqlAdminResult};
use crate::types::*;

pub struct BackupManager;

impl BackupManager {
    pub async fn create_backup(client: &MysqlAdminClient, req: &MysqlBackupRequest) -> MysqlAdminResult<BackupResult> {
        let mut args = Vec::new();
        if req.all_databases == Some(true) {
            args.push("--all-databases".to_string());
        } else if let Some(ref dbs) = req.databases {
            args.push("--databases".to_string());
            for db in dbs {
                args.push(db.clone());
            }
        }
        if req.single_transaction == Some(true) {
            args.push("--single-transaction".to_string());
        }
        if req.routines == Some(true) {
            args.push("--routines".to_string());
        }
        if req.triggers == Some(true) {
            args.push("--triggers".to_string());
        }
        if req.events == Some(true) {
            args.push("--events".to_string());
        }
        if req.add_drop_database == Some(true) {
            args.push("--add-drop-database".to_string());
        }
        if let Some(ref pkt) = req.max_allowed_packet {
            args.push(format!("--max-allowed-packet={}", pkt));
        }

        let output_path = req.output_path.clone();
        if req.compress == Some(true) {
            args.push(format!("| gzip > {}", output_path));
        } else {
            args.push(format!("> {}", output_path));
        }

        let start = std::time::Instant::now();
        let out = client.exec_mysqldump(&args.join(" ")).await?;
        let duration = start.elapsed().as_secs_f64();

        if out.exit_code != 0 {
            return Err(MysqlAdminError::backup(format!(
                "mysqldump failed (exit {}): {}", out.exit_code, out.stderr.trim()
            )));
        }

        let size_out = client.exec_ssh(&format!("stat -c %s {} 2>/dev/null || echo 0", output_path)).await?;
        let size = size_out.stdout.trim().parse::<u64>().unwrap_or(0);

        Ok(BackupResult {
            success: true,
            output_path,
            size_bytes: Some(size),
            duration_secs: Some(duration),
            tables_dumped: None,
        })
    }

    pub async fn restore_backup(client: &MysqlAdminClient, req: &MysqlRestoreRequest) -> MysqlAdminResult<()> {
        let is_compressed = req.input_path.ends_with(".gz");
        let mut cmd = if is_compressed {
            format!("gunzip -c {} | mysql -u {}", req.input_path, client.config.mysql_user.as_deref().unwrap_or("root"))
        } else {
            format!("mysql -u {}", client.config.mysql_user.as_deref().unwrap_or("root"))
        };
        if let Some(ref pw) = client.config.mysql_password {
            cmd.push_str(&format!(" -p'{}'", pw.replace('\'', "'\\''")));
        }
        if req.force == Some(true) {
            cmd.push_str(" --force");
        }
        if let Some(ref db) = req.database {
            cmd.push_str(&format!(" {}", db));
        }
        if !is_compressed {
            cmd.push_str(&format!(" < {}", req.input_path));
        }
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(MysqlAdminError::backup(format!(
                "Restore failed (exit {}): {}", out.exit_code, out.stderr.trim()
            )));
        }
        Ok(())
    }

    pub async fn list_backup_files(client: &MysqlAdminClient, directory: &str) -> MysqlAdminResult<Vec<BackupResult>> {
        let out = client.exec_ssh(&format!(
            "ls -1 {}/*.sql {}/*.sql.gz 2>/dev/null", directory, directory
        )).await?;
        let mut backups = Vec::new();
        for line in out.stdout.lines().filter(|l| !l.is_empty()) {
            let size_out = client.exec_ssh(&format!("stat -c %s {} 2>/dev/null || echo 0", line)).await?;
            let size = size_out.stdout.trim().parse::<u64>().unwrap_or(0);
            backups.push(BackupResult {
                success: true,
                output_path: line.to_string(),
                size_bytes: Some(size),
                duration_secs: None,
                tables_dumped: None,
            });
        }
        Ok(backups)
    }

    pub async fn get_backup_status(client: &MysqlAdminClient, path: &str) -> MysqlAdminResult<BackupResult> {
        let size_out = client.exec_ssh(&format!("stat -c %s {} 2>/dev/null || echo 0", path)).await?;
        let size = size_out.stdout.trim().parse::<u64>().unwrap_or(0);
        let exists = size > 0;
        Ok(BackupResult {
            success: exists,
            output_path: path.to_string(),
            size_bytes: Some(size),
            duration_secs: None,
            tables_dumped: None,
        })
    }

    pub async fn create_logical_backup(client: &MysqlAdminClient, req: &MysqlBackupRequest) -> MysqlAdminResult<BackupResult> {
        Self::create_backup(client, req).await
    }

    pub async fn create_physical_backup(client: &MysqlAdminClient, output_path: &str) -> MysqlAdminResult<BackupResult> {
        let datadir_out = client.exec_mysql("SELECT @@datadir").await?;
        let datadir = datadir_out.trim();
        let start = std::time::Instant::now();
        let out = client.exec_ssh(&format!(
            "tar -czf {} -C {} .", output_path, datadir
        )).await?;
        let duration = start.elapsed().as_secs_f64();
        if out.exit_code != 0 {
            return Err(MysqlAdminError::backup(format!(
                "Physical backup failed (exit {}): {}", out.exit_code, out.stderr.trim()
            )));
        }
        let size_out = client.exec_ssh(&format!("stat -c %s {} 2>/dev/null || echo 0", output_path)).await?;
        let size = size_out.stdout.trim().parse::<u64>().unwrap_or(0);
        Ok(BackupResult {
            success: true,
            output_path: output_path.to_string(),
            size_bytes: Some(size),
            duration_secs: Some(duration),
            tables_dumped: None,
        })
    }
}
