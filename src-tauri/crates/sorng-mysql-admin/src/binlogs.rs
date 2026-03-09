// ── sorng-mysql-admin – binary log management ────────────────────────────────
//! MySQL/MariaDB binary log listing, purging, and event inspection via SSH.

use crate::client::MysqlClient;
use crate::error::MysqlResult;
use crate::types::*;

pub struct BinlogManager;

impl BinlogManager {
    /// List all binary log files.
    pub async fn list(client: &MysqlClient) -> MysqlResult<Vec<BinlogFile>> {
        let out = client.exec_sql("SHOW BINARY LOGS").await?;
        let mut logs = Vec::new();
        for line in out.lines() {
            let cols: Vec<&str> = line.split('\t').collect();
            if cols.len() >= 2 {
                logs.push(BinlogFile {
                    name: cols[0].to_string(),
                    size: cols[1].parse().unwrap_or(0),
                    encrypted: cols.get(2).map(|v| *v == "Yes").unwrap_or(false),
                });
            }
        }
        Ok(logs)
    }

    /// Get the current binary log file (from SHOW MASTER STATUS).
    pub async fn get_current(client: &MysqlClient) -> MysqlResult<BinlogFile> {
        let out = client.exec_sql("SHOW MASTER STATUS").await?;
        let line = out.lines().next().unwrap_or("");
        let cols: Vec<&str> = line.split('\t').collect();
        Ok(BinlogFile {
            name: cols.first().unwrap_or(&"").to_string(),
            size: cols.get(1).and_then(|s| s.parse().ok()).unwrap_or(0),
            encrypted: false,
        })
    }

    /// List events within a specific binary log.
    pub async fn list_events(
        client: &MysqlClient,
        log_name: &str,
        limit: u64,
    ) -> MysqlResult<Vec<BinlogEvent>> {
        let sql = format!(
            "SHOW BINLOG EVENTS IN '{}' LIMIT {}",
            sql_escape(log_name),
            limit
        );
        let out = client.exec_sql(&sql).await?;
        let mut events = Vec::new();
        for line in out.lines() {
            let cols: Vec<&str> = line.split('\t').collect();
            if cols.len() >= 6 {
                events.push(BinlogEvent {
                    log_name: cols[0].to_string(),
                    pos: cols[1].parse().unwrap_or(0),
                    event_type: cols[2].to_string(),
                    server_id: cols[3].parse().unwrap_or(0),
                    end_log_pos: cols[4].parse().unwrap_or(0),
                    info: cols[5].to_string(),
                });
            }
        }
        Ok(events)
    }

    /// Purge binary logs up to a specified log file.
    pub async fn purge_to(client: &MysqlClient, log_name: &str) -> MysqlResult<()> {
        let sql = format!("PURGE BINARY LOGS TO '{}'", sql_escape(log_name));
        client.exec_sql(&sql).await?;
        Ok(())
    }

    /// Purge binary logs before a given datetime.
    pub async fn purge_before(client: &MysqlClient, datetime: &str) -> MysqlResult<()> {
        let sql = format!("PURGE BINARY LOGS BEFORE '{}'", sql_escape(datetime));
        client.exec_sql(&sql).await?;
        Ok(())
    }

    /// Get the current binary log format.
    pub async fn get_binlog_format(client: &MysqlClient) -> MysqlResult<String> {
        let out = client.exec_sql("SELECT @@global.binlog_format").await?;
        Ok(out.trim().to_string())
    }

    /// Set the binary log format (ROW, STATEMENT, MIXED).
    pub async fn set_binlog_format(client: &MysqlClient, format: &str) -> MysqlResult<()> {
        let sql = format!("SET GLOBAL binlog_format = '{}'", format);
        client.exec_sql(&sql).await?;
        Ok(())
    }

    /// Get the expire_logs_days value.
    pub async fn get_expire_days(client: &MysqlClient) -> MysqlResult<u64> {
        let out = client.exec_sql("SELECT @@global.expire_logs_days").await?;
        Ok(out.trim().parse().unwrap_or(0))
    }

    /// Set the expire_logs_days value.
    pub async fn set_expire_days(client: &MysqlClient, days: u64) -> MysqlResult<()> {
        let sql = format!("SET GLOBAL expire_logs_days = {}", days);
        client.exec_sql(&sql).await?;
        Ok(())
    }

    /// Flush binary logs (rotates to a new log file).
    pub async fn flush(client: &MysqlClient) -> MysqlResult<()> {
        client.exec_sql("FLUSH BINARY LOGS").await?;
        Ok(())
    }
}

fn sql_escape(s: &str) -> String {
    s.replace('\'', "\\'")
}
