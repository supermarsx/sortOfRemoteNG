// ── sorng-mysql-admin – query & slow-query management ────────────────────────
//! Slow query log analysis, EXPLAIN, and query control via SSH.

use crate::client::MysqlClient;
use crate::error::MysqlResult;
use crate::types::*;

pub struct QueryManager;

impl QueryManager {
    /// Check if the slow query log is enabled.
    pub async fn is_slow_log_enabled(client: &MysqlClient) -> MysqlResult<bool> {
        let out = client.exec_sql("SELECT @@global.slow_query_log").await?;
        Ok(out.trim() == "1")
    }

    /// Enable the slow query log.
    pub async fn enable_slow_log(client: &MysqlClient) -> MysqlResult<()> {
        client.exec_sql("SET GLOBAL slow_query_log = 1").await?;
        Ok(())
    }

    /// Disable the slow query log.
    pub async fn disable_slow_log(client: &MysqlClient) -> MysqlResult<()> {
        client.exec_sql("SET GLOBAL slow_query_log = 0").await?;
        Ok(())
    }

    /// Get the slow query log file path.
    pub async fn get_slow_log_file(client: &MysqlClient) -> MysqlResult<String> {
        let out = client.exec_sql("SELECT @@global.slow_query_log_file").await?;
        Ok(out.trim().to_string())
    }

    /// Get the long_query_time threshold in seconds.
    pub async fn get_long_query_time(client: &MysqlClient) -> MysqlResult<f64> {
        let out = client.exec_sql("SELECT @@global.long_query_time").await?;
        Ok(out.trim().parse().unwrap_or(10.0))
    }

    /// Set the long_query_time threshold.
    pub async fn set_long_query_time(client: &MysqlClient, seconds: f64) -> MysqlResult<()> {
        client.exec_sql(&format!("SET GLOBAL long_query_time = {}", seconds)).await?;
        Ok(())
    }

    /// Parse slow query log entries (last N) from the log file.
    pub async fn list_slow_queries(
        client: &MysqlClient,
        limit: u64,
    ) -> MysqlResult<Vec<SlowQueryEntry>> {
        // Read the slow log from the mysql.slow_log table if available
        let sql = format!(
            "SELECT query_time, lock_time, rows_sent, rows_examined, \
             start_time, user_host, db, sql_text \
             FROM mysql.slow_log \
             ORDER BY start_time DESC LIMIT {}",
            limit
        );
        let out = client.exec_sql(&sql).await?;
        let mut entries = Vec::new();
        for line in out.lines() {
            let cols: Vec<&str> = line.split('\t').collect();
            if cols.len() >= 8 {
                // Parse time strings like "00:00:01.234567" into seconds
                let query_time = parse_time_to_secs(cols[0]);
                let lock_time = parse_time_to_secs(cols[1]);
                // user_host is like "user[user] @ host []"
                let (user, host) = parse_user_host(cols[5]);
                entries.push(SlowQueryEntry {
                    query_time,
                    lock_time,
                    rows_sent: cols[2].parse().unwrap_or(0),
                    rows_examined: cols[3].parse().unwrap_or(0),
                    timestamp: cols[4].to_string(),
                    user,
                    host,
                    db: cols[6].to_string(),
                    sql_text: cols[7].to_string(),
                });
            }
        }
        Ok(entries)
    }

    /// Run EXPLAIN on a query.
    pub async fn explain_query(
        client: &MysqlClient,
        db: &str,
        sql: &str,
    ) -> MysqlResult<String> {
        let explain_sql = format!("EXPLAIN {}", sql);
        client.exec_sql_db(db, &explain_sql).await
    }

    /// Kill a connection/query by process ID.
    pub async fn kill_query(client: &MysqlClient, process_id: u64) -> MysqlResult<()> {
        client.exec_sql(&format!("KILL QUERY {}", process_id)).await?;
        Ok(())
    }

    /// Get global status variables.
    pub async fn get_global_status(client: &MysqlClient) -> MysqlResult<Vec<MysqlVariable>> {
        let out = client.exec_sql("SHOW GLOBAL STATUS").await?;
        let mut vars = Vec::new();
        for line in out.lines() {
            let cols: Vec<&str> = line.split('\t').collect();
            if cols.len() >= 2 {
                vars.push(MysqlVariable {
                    name: cols[0].to_string(),
                    value: cols[1].to_string(),
                    is_global: true,
                    is_session: false,
                });
            }
        }
        Ok(vars)
    }

    /// Get query cache status variables.
    pub async fn get_query_cache_status(client: &MysqlClient) -> MysqlResult<Vec<MysqlVariable>> {
        let out = client.exec_sql("SHOW GLOBAL STATUS LIKE 'Qcache%'").await?;
        let mut vars = Vec::new();
        for line in out.lines() {
            let cols: Vec<&str> = line.split('\t').collect();
            if cols.len() >= 2 {
                vars.push(MysqlVariable {
                    name: cols[0].to_string(),
                    value: cols[1].to_string(),
                    is_global: true,
                    is_session: false,
                });
            }
        }
        Ok(vars)
    }
}

/// Parse MySQL time format "HH:MM:SS.ffffff" into fractional seconds.
fn parse_time_to_secs(s: &str) -> f64 {
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() == 3 {
        let h: f64 = parts[0].parse().unwrap_or(0.0);
        let m: f64 = parts[1].parse().unwrap_or(0.0);
        let s: f64 = parts[2].parse().unwrap_or(0.0);
        h * 3600.0 + m * 60.0 + s
    } else {
        s.parse().unwrap_or(0.0)
    }
}

/// Parse "user[user] @ host [ip]" into (user, host).
fn parse_user_host(s: &str) -> (String, String) {
    let parts: Vec<&str> = s.split('@').collect();
    let user = parts.first()
        .unwrap_or(&"")
        .split('[')
        .next()
        .unwrap_or("")
        .trim()
        .to_string();
    let host = parts.get(1)
        .unwrap_or(&"")
        .split('[')
        .next()
        .unwrap_or("")
        .trim()
        .to_string();
    (user, host)
}
