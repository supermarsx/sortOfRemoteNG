// ── sorng-mysql-admin – replication management ───────────────────────────────

use crate::client::MysqlAdminClient;
use crate::error::{MysqlAdminError, MysqlAdminResult};
use crate::types::*;

pub struct ReplicationManager;

impl ReplicationManager {
    pub async fn get_replica_status(client: &MysqlAdminClient) -> MysqlAdminResult<ReplicaStatus> {
        let out = client.exec_mysql("SHOW SLAVE STATUS").await?;
        let line = out.lines().find(|l| !l.is_empty())
            .ok_or_else(|| MysqlAdminError::replication("No replica status available"))?;
        let c: Vec<&str> = line.split('\t').collect();
        Ok(ReplicaStatus {
            slave_io_running: c.get(10).map(|s| s.to_string()).unwrap_or_default(),
            slave_sql_running: c.get(11).map(|s| s.to_string()).unwrap_or_default(),
            master_host: c.get(1).map(|s| s.to_string()),
            master_port: c.get(3).and_then(|s| s.parse().ok()),
            master_user: c.get(2).map(|s| s.to_string()),
            master_log_file: c.get(5).map(|s| s.to_string()),
            read_master_log_pos: c.get(6).and_then(|s| s.parse().ok()),
            relay_log_file: c.get(7).map(|s| s.to_string()),
            relay_log_pos: c.get(8).and_then(|s| s.parse().ok()),
            exec_master_log_pos: c.get(21).and_then(|s| s.parse().ok()),
            seconds_behind_master: c.get(32).and_then(|s| s.parse().ok()),
            last_error: c.get(19).filter(|s| !s.is_empty()).map(|s| s.to_string()),
            last_io_error: c.get(35).filter(|s| !s.is_empty()).map(|s| s.to_string()),
            last_sql_error: c.get(37).filter(|s| !s.is_empty()).map(|s| s.to_string()),
            gtid_slave_pos: c.get(51).filter(|s| !s.is_empty()).map(|s| s.to_string()),
            auto_position: c.get(55).map(|s| s == "1"),
            channel_name: c.get(56).filter(|s| !s.is_empty()).map(|s| s.to_string()),
        })
    }

    pub async fn get_primary_status(client: &MysqlAdminClient) -> MysqlAdminResult<PrimaryStatus> {
        let out = client.exec_mysql("SHOW MASTER STATUS").await?;
        let line = out.lines().find(|l| !l.is_empty())
            .ok_or_else(|| MysqlAdminError::replication("No primary status available"))?;
        let c: Vec<&str> = line.split('\t').collect();
        Ok(PrimaryStatus {
            file: c.first().map(|s| s.to_string()).unwrap_or_default(),
            position: c.get(1).and_then(|s| s.parse().ok()).unwrap_or(0),
            binlog_do_db: c.get(2).filter(|s| !s.is_empty()).map(|s| s.to_string()),
            binlog_ignore_db: c.get(3).filter(|s| !s.is_empty()).map(|s| s.to_string()),
            executed_gtid_set: c.get(4).filter(|s| !s.is_empty()).map(|s| s.to_string()),
        })
    }

    pub async fn setup_replica(client: &MysqlAdminClient, req: &SetupReplicaRequest) -> MysqlAdminResult<()> {
        let mut sql = format!(
            "CHANGE MASTER TO MASTER_HOST='{}', MASTER_PORT={}, MASTER_USER='{}', MASTER_PASSWORD='{}'",
            req.master_host, req.master_port, req.master_user, req.master_password
        );
        if let Some(ref file) = req.master_log_file {
            sql.push_str(&format!(", MASTER_LOG_FILE='{}'", file));
        }
        if let Some(pos) = req.master_log_pos {
            sql.push_str(&format!(", MASTER_LOG_POS={}", pos));
        }
        if req.auto_position == Some(true) {
            sql.push_str(", MASTER_AUTO_POSITION=1");
        }
        if let Some(ref ch) = req.channel_name {
            sql.push_str(&format!(" FOR CHANNEL '{}'", ch));
        }
        client.exec_mysql(&sql).await?;
        Ok(())
    }

    pub async fn start_replica(client: &MysqlAdminClient) -> MysqlAdminResult<()> {
        client.exec_mysql("START SLAVE").await?;
        Ok(())
    }

    pub async fn stop_replica(client: &MysqlAdminClient) -> MysqlAdminResult<()> {
        client.exec_mysql("STOP SLAVE").await?;
        Ok(())
    }

    pub async fn reset_replica(client: &MysqlAdminClient, all: bool) -> MysqlAdminResult<()> {
        let cmd = if all { "RESET SLAVE ALL" } else { "RESET SLAVE" };
        client.exec_mysql(cmd).await?;
        Ok(())
    }

    pub async fn skip_error(client: &MysqlAdminClient, count: u32) -> MysqlAdminResult<()> {
        client.exec_mysql(&format!("SET GLOBAL sql_slave_skip_counter = {}", count)).await?;
        client.exec_mysql("START SLAVE").await?;
        Ok(())
    }

    pub async fn get_binlog_events(client: &MysqlAdminClient, log_name: Option<&str>, limit: Option<u32>) -> MysqlAdminResult<Vec<BinlogEvent>> {
        let mut sql = "SHOW BINLOG EVENTS".to_string();
        if let Some(name) = log_name {
            sql.push_str(&format!(" IN '{}'", name));
        }
        if let Some(lim) = limit {
            sql.push_str(&format!(" LIMIT {}", lim));
        }
        let out = client.exec_mysql(&sql).await?;
        let events = out.lines()
            .filter(|l| !l.is_empty())
            .map(|l| {
                let c: Vec<&str> = l.split('\t').collect();
                BinlogEvent {
                    log_name: c.first().map(|s| s.to_string()).unwrap_or_default(),
                    pos: c.get(1).and_then(|s| s.parse().ok()).unwrap_or(0),
                    event_type: c.get(2).map(|s| s.to_string()).unwrap_or_default(),
                    server_id: c.get(3).and_then(|s| s.parse().ok()).unwrap_or(0),
                    end_log_pos: c.get(4).and_then(|s| s.parse().ok()).unwrap_or(0),
                    info: c.get(5).filter(|s| !s.is_empty()).map(|s| s.to_string()),
                }
            })
            .collect();
        Ok(events)
    }

    pub async fn list_binary_logs(client: &MysqlAdminClient) -> MysqlAdminResult<Vec<BinaryLog>> {
        let out = client.exec_mysql("SHOW BINARY LOGS").await?;
        let logs = out.lines()
            .filter(|l| !l.is_empty())
            .map(|l| {
                let c: Vec<&str> = l.split('\t').collect();
                BinaryLog {
                    log_name: c.first().map(|s| s.to_string()).unwrap_or_default(),
                    file_size: c.get(1).and_then(|s| s.parse().ok()).unwrap_or(0),
                    encrypted: c.get(2).filter(|s| !s.is_empty()).map(|s| s.to_string()),
                }
            })
            .collect();
        Ok(logs)
    }

    pub async fn purge_binary_logs(client: &MysqlAdminClient, to_log: &str) -> MysqlAdminResult<()> {
        client.exec_mysql(&format!("PURGE BINARY LOGS TO '{}'", to_log)).await?;
        Ok(())
    }

    pub async fn get_gtid_status(client: &MysqlAdminClient) -> MysqlAdminResult<GtidStatus> {
        let mode = client.exec_mysql("SELECT @@gtid_mode").await.unwrap_or_default();
        let executed = client.exec_mysql("SELECT @@global.gtid_executed").await.ok();
        let purged = client.exec_mysql("SELECT @@global.gtid_purged").await.ok();
        Ok(GtidStatus {
            gtid_mode: mode.trim().to_string(),
            gtid_executed: executed.map(|s| s.trim().to_string()),
            gtid_purged: purged.map(|s| s.trim().to_string()),
        })
    }

    pub async fn change_primary(client: &MysqlAdminClient, req: &SetupReplicaRequest) -> MysqlAdminResult<()> {
        client.exec_mysql("STOP SLAVE").await?;
        Self::setup_replica(client, req).await?;
        client.exec_mysql("START SLAVE").await?;
        Ok(())
    }

    pub async fn promote_to_primary(client: &MysqlAdminClient) -> MysqlAdminResult<()> {
        client.exec_mysql("STOP SLAVE").await?;
        client.exec_mysql("RESET SLAVE ALL").await?;
        client.exec_mysql("SET GLOBAL read_only = OFF").await?;
        Ok(())
    }
}
