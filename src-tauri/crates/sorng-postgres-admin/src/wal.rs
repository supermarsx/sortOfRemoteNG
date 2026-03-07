// ── sorng-postgres-admin/src/wal.rs ───────────────────────────────────────────
//! PostgreSQL WAL (Write-Ahead Log) monitoring and management.

use crate::client::{shell_escape, PgClient};
use crate::error::PgResult;
use crate::types::PgWalInfo;

pub struct WalManager;

impl WalManager {
    /// Get comprehensive WAL configuration and current state.
    pub async fn get_info(client: &PgClient) -> PgResult<PgWalInfo> {
        let sql = r#"
            SELECT pg_current_wal_lsn()::text,
                   (SELECT timeline_id FROM pg_control_checkpoint())::text,
                   current_setting('wal_level'),
                   current_setting('archive_mode'),
                   current_setting('archive_command'),
                   current_setting('wal_segment_size'),
                   current_setting('min_wal_size'),
                   current_setting('max_wal_size'),
                   COALESCE(current_setting('wal_keep_size'), '')
        "#;
        let out = client.exec_sql(sql).await?;
        let cols: Vec<&str> = out.trim().splitn(9, '|').collect();
        if cols.len() >= 9 {
            Ok(PgWalInfo {
                current_lsn: cols[0].to_string(),
                current_timeline: cols[1].to_string(),
                wal_level: cols[2].to_string(),
                archive_mode: cols[3].to_string(),
                archive_command: if cols[4].is_empty() { None } else { Some(cols[4].to_string()) },
                wal_segment_size: cols[5].to_string(),
                min_wal_size: cols[6].to_string(),
                max_wal_size: cols[7].to_string(),
                wal_keep_size: if cols[8].is_empty() { None } else { Some(cols[8].to_string()) },
            })
        } else {
            Err(crate::error::PgError::parse("Failed to parse WAL info"))
        }
    }

    /// Get current WAL LSN position.
    pub async fn get_current_lsn(client: &PgClient) -> PgResult<String> {
        let out = client.exec_sql("SELECT pg_current_wal_lsn()::text").await?;
        Ok(out.trim().to_string())
    }

    /// Force a WAL segment switch (pg_switch_wal).
    pub async fn switch_xlog(client: &PgClient) -> PgResult<()> {
        client.exec_sql("SELECT pg_switch_wal()").await?;
        Ok(())
    }

    /// Get WAL archiver status.
    pub async fn get_archive_status(client: &PgClient) -> PgResult<String> {
        let sql = r#"
            SELECT archived_count, last_archived_wal,
                   COALESCE(last_archived_time::text, ''),
                   failed_count,
                   COALESCE(last_failed_wal, ''),
                   COALESCE(last_failed_time::text, '')
            FROM pg_stat_archiver
        "#;
        client.exec_sql(sql).await
    }

    /// List WAL files in pg_wal directory.
    pub async fn list_wal_files(client: &PgClient) -> PgResult<Vec<String>> {
        let data_dir = client.config.data_dir.as_deref().unwrap_or("/var/lib/postgresql");
        let cmd = format!("ls -1 {}/pg_wal/ 2>/dev/null | grep -E '^[0-9A-F]{{24}}$' || true",
            shell_escape(data_dir));
        let out = client.exec_ssh(&cmd).await?;
        Ok(out.stdout.lines().filter(|l| !l.is_empty()).map(|l| l.to_string()).collect())
    }

    /// Get total WAL directory size in bytes.
    pub async fn get_wal_size(client: &PgClient) -> PgResult<u64> {
        let data_dir = client.config.data_dir.as_deref().unwrap_or("/var/lib/postgresql");
        let cmd = format!("du -sb {}/pg_wal/ 2>/dev/null | cut -f1", shell_escape(data_dir));
        let out = client.exec_ssh(&cmd).await?;
        Ok(out.stdout.trim().parse().unwrap_or(0))
    }

    /// Issue a manual CHECKPOINT.
    pub async fn checkpoint(client: &PgClient) -> PgResult<()> {
        client.exec_sql("CHECKPOINT").await?;
        Ok(())
    }
}
