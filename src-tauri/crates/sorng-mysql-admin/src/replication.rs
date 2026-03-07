// ── sorng-mysql-admin – replication management ───────────────────────────────
//! MySQL/MariaDB replication monitoring and control via SSH.

use crate::client::MysqlClient;
use crate::error::{MysqlError, MysqlResult};
use crate::types::*;

pub struct ReplicationManager;

impl ReplicationManager {
    /// Get master/primary status.
    pub async fn get_master_status(client: &MysqlClient) -> MysqlResult<ReplicationStatus> {
        let out = client.exec_sql("SHOW MASTER STATUS").await?;
        let line = out.lines().next()
            .ok_or_else(|| MysqlError::replication("no master status output — binary logging may be disabled"))?;
        let cols: Vec<&str> = line.split('\t').collect();

        Ok(ReplicationStatus {
            role: "master".to_string(),
            master_host: None,
            master_port: None,
            slave_io_running: None,
            slave_sql_running: None,
            seconds_behind_master: None,
            last_error: None,
            gtid_executed: cols.get(4).map(|s| s.to_string()),
            read_master_log_pos: cols.get(1).and_then(|s| s.parse().ok()),
            exec_master_log_pos: None,
            relay_log_file: None,
        })
    }

    /// Get slave/replica status.
    pub async fn get_slave_status(client: &MysqlClient) -> MysqlResult<ReplicationStatus> {
        // Use vertical format for easier parsing
        let out = client.exec_sql("SHOW SLAVE STATUS\\G").await?;
        let text = &out;

        Ok(ReplicationStatus {
            role: "slave".to_string(),
            master_host: extract_field(text, "Master_Host"),
            master_port: extract_field(text, "Master_Port").and_then(|s| s.parse().ok()),
            slave_io_running: extract_field(text, "Slave_IO_Running"),
            slave_sql_running: extract_field(text, "Slave_SQL_Running"),
            seconds_behind_master: extract_field(text, "Seconds_Behind_Master")
                .and_then(|s| s.parse().ok()),
            last_error: extract_field(text, "Last_Error"),
            gtid_executed: extract_field(text, "Executed_Gtid_Set"),
            read_master_log_pos: extract_field(text, "Read_Master_Log_Pos")
                .and_then(|s| s.parse().ok()),
            exec_master_log_pos: extract_field(text, "Exec_Master_Log_Pos")
                .and_then(|s| s.parse().ok()),
            relay_log_file: extract_field(text, "Relay_Log_File"),
        })
    }

    /// Configure master/primary settings (server-id, log-bin, etc.).
    pub async fn configure_master(
        client: &MysqlClient,
        config: &ReplicationConfig,
    ) -> MysqlResult<()> {
        client.exec_sql(&format!("SET GLOBAL server_id = {}", config.server_id)).await?;
        if !config.binlog_format.is_empty() {
            client.exec_sql(&format!(
                "SET GLOBAL binlog_format = '{}'", config.binlog_format
            )).await?;
        }
        if let Some(ref gtid) = config.gtid_mode {
            client.exec_sql(&format!("SET GLOBAL gtid_mode = '{}'", gtid)).await?;
        }
        if let Some(ref enforce) = config.enforce_gtid_consistency {
            client.exec_sql(&format!("SET GLOBAL enforce_gtid_consistency = '{}'", enforce)).await?;
        }
        Ok(())
    }

    /// Start the replication slave/replica.
    pub async fn start_slave(client: &MysqlClient) -> MysqlResult<()> {
        client.exec_sql("START SLAVE").await?;
        Ok(())
    }

    /// Stop the replication slave/replica.
    pub async fn stop_slave(client: &MysqlClient) -> MysqlResult<()> {
        client.exec_sql("STOP SLAVE").await?;
        Ok(())
    }

    /// Reset the replication slave/replica.
    pub async fn reset_slave(client: &MysqlClient) -> MysqlResult<()> {
        client.exec_sql("RESET SLAVE ALL").await?;
        Ok(())
    }

    /// Point the slave at a different master.
    pub async fn change_master(
        client: &MysqlClient,
        master_host: &str,
        master_port: u16,
        master_user: &str,
        master_password: &str,
        master_log_file: Option<&str>,
        master_log_pos: Option<u64>,
    ) -> MysqlResult<()> {
        let mut sql = format!(
            "CHANGE MASTER TO MASTER_HOST='{}', MASTER_PORT={}, \
             MASTER_USER='{}', MASTER_PASSWORD='{}'",
            master_host, master_port, master_user, master_password
        );
        if let Some(file) = master_log_file {
            sql.push_str(&format!(", MASTER_LOG_FILE='{}'", file));
        }
        if let Some(pos) = master_log_pos {
            sql.push_str(&format!(", MASTER_LOG_POS={}", pos));
        }
        client.exec_sql(&sql).await?;
        Ok(())
    }

    /// Skip N events on the slave.
    pub async fn skip_counter(client: &MysqlClient, count: u64) -> MysqlResult<()> {
        client.exec_sql(&format!("SET GLOBAL sql_slave_skip_counter = {}", count)).await?;
        Ok(())
    }

    /// Get the GTID executed set.
    pub async fn get_gtid_executed(client: &MysqlClient) -> MysqlResult<String> {
        let out = client.exec_sql("SELECT @@global.gtid_executed").await?;
        Ok(out.trim().to_string())
    }

    /// Get the GTID purged set.
    pub async fn get_gtid_purged(client: &MysqlClient) -> MysqlResult<String> {
        let out = client.exec_sql("SELECT @@global.gtid_purged").await?;
        Ok(out.trim().to_string())
    }

    /// Set or unset read-only mode.
    pub async fn set_read_only(client: &MysqlClient, enabled: bool) -> MysqlResult<()> {
        let val = if enabled { "ON" } else { "OFF" };
        client.exec_sql(&format!("SET GLOBAL read_only = {}", val)).await?;
        Ok(())
    }
}

/// Extract a named field value from SHOW … \G output.
fn extract_field(text: &str, field: &str) -> Option<String> {
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix(&format!("{}:", field)) {
            let val = rest.trim();
            if val.is_empty() || val == "NULL" {
                return None;
            }
            return Some(val.to_string());
        }
    }
    None
}
