// ── sorng-mysql-admin – backup & restore ─────────────────────────────────────
//! MySQL/MariaDB backup (mysqldump) and restore operations via SSH.

use crate::client::{shell_escape, MysqlClient};
use crate::error::MysqlResult;
use crate::types::*;

pub struct BackupManager;

impl BackupManager {
    /// Create a mysqldump backup.
    pub async fn create_backup(
        client: &MysqlClient,
        config: &BackupConfig,
    ) -> MysqlResult<BackupResult> {
        let db_refs: Vec<&str> = config.databases.iter().map(|s| s.as_str()).collect();

        let mut extra_flags = String::new();
        if config.single_transaction {
            extra_flags.push_str(" --single-transaction");
        }
        if config.routines {
            extra_flags.push_str(" --routines");
        }
        if config.triggers {
            extra_flags.push_str(" --triggers");
        }
        if config.events {
            extra_flags.push_str(" --events");
        }

        let dump_cmd = client.mysqldump_cmd(&db_refs, extra_flags.trim());

        let cmd = if config.compress {
            format!(
                "{} | gzip > {}",
                dump_cmd,
                shell_escape(&config.output_path)
            )
        } else {
            format!("{} > {}", dump_cmd, shell_escape(&config.output_path))
        };

        // Time the backup
        let full_cmd = format!(
            "START_T=$(date +%s); {} ; END_T=$(date +%s); echo \"DURATION:$((END_T - START_T))\"",
            cmd
        );

        let out = client.exec_ssh(&full_cmd).await?;

        let mut duration_secs = 0.0;
        for line in out.stdout.lines() {
            if let Some(rest) = line.strip_prefix("DURATION:") {
                duration_secs = rest.trim().parse().unwrap_or(0.0);
            }
        }

        // Get the backup file size
        let size_out = client
            .exec_ssh(&format!(
                "stat -c%s {} 2>/dev/null || echo 0",
                shell_escape(&config.output_path)
            ))
            .await?;
        let size_bytes: u64 = size_out.stdout.trim().parse().unwrap_or(0);

        Ok(BackupResult {
            path: config.output_path.clone(),
            size_bytes,
            duration_secs,
            databases: config.databases.clone(),
        })
    }

    /// Restore a SQL dump into a database.
    pub async fn restore(client: &MysqlClient, db: &str, path: &str) -> MysqlResult<()> {
        let base = client.mysql_cmd_db(db, "");
        // Remove the trailing -e '' and pipe the file instead
        let mysql_base = base.replace(" -e ''", "");
        let is_gzipped = path.ends_with(".gz");

        let cmd = if is_gzipped {
            format!("gunzip -c {} | {}", shell_escape(path), mysql_base)
        } else {
            format!("{} < {}", mysql_base, shell_escape(path))
        };

        client.exec_ssh(&cmd).await?;
        Ok(())
    }

    /// List backup files in a directory.
    pub async fn list_backup_files(
        client: &MysqlClient,
        dir: &str,
    ) -> MysqlResult<Vec<BackupResult>> {
        let cmd = format!(
            "find {} -maxdepth 1 -type f \\( -name '*.sql' -o -name '*.sql.gz' \\) \
             -printf '%f\\t%s\\n' 2>/dev/null | sort -r",
            shell_escape(dir)
        );
        let out = client.exec_ssh(&cmd).await?;

        let mut backups = Vec::new();
        for line in out.stdout.lines() {
            let cols: Vec<&str> = line.split('\t').collect();
            if cols.len() >= 2 {
                backups.push(BackupResult {
                    path: format!("{}/{}", dir, cols[0]),
                    size_bytes: cols[1].parse().unwrap_or(0),
                    duration_secs: 0.0,
                    databases: Vec::new(),
                });
            }
        }
        Ok(backups)
    }

    /// Get the size of a backup file in bytes.
    pub async fn get_backup_size(client: &MysqlClient, path: &str) -> MysqlResult<u64> {
        let cmd = format!("stat -c%s {} 2>/dev/null || echo 0", shell_escape(path));
        let out = client.exec_ssh(&cmd).await?;
        Ok(out.stdout.trim().parse().unwrap_or(0))
    }

    /// Verify a backup file by checking if it's readable and non-empty.
    pub async fn verify_backup(client: &MysqlClient, path: &str) -> MysqlResult<bool> {
        let cmd = format!("test -s {} && echo yes || echo no", shell_escape(path));
        let out = client.exec_ssh(&cmd).await?;
        Ok(out.stdout.trim() == "yes")
    }

    /// Export a single table to a file.
    pub async fn export_table(
        client: &MysqlClient,
        db: &str,
        table: &str,
        path: &str,
    ) -> MysqlResult<()> {
        let user = client.config.mysql_user.as_deref().unwrap_or("root");
        let host = client.config.mysql_host.as_deref().unwrap_or("127.0.0.1");
        let port = client.config.mysql_port.unwrap_or(3306);

        let mut cmd = format!(
            "mysqldump -u {} -h {} -P {} --single-transaction {} {}",
            user, host, port, db, table
        );

        if let Some(ref pw) = client.config.mysql_password {
            cmd = format!(
                "mysqldump -u {} -p'{}' -h {} -P {} --single-transaction {} {}",
                user,
                pw.replace('\'', "'\\''"),
                host,
                port,
                db,
                table
            );
        }

        cmd.push_str(&format!(" > {}", shell_escape(path)));
        client.exec_ssh(&cmd).await?;
        Ok(())
    }

    /// Import a SQL file into a database.
    pub async fn import_sql(client: &MysqlClient, db: &str, path: &str) -> MysqlResult<()> {
        Self::restore(client, db, path).await
    }
}
