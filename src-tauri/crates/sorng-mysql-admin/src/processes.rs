// ── sorng-mysql-admin – process management ───────────────────────────────────
//! MySQL process list, kill, and thread statistics via SSH.

use crate::client::MysqlClient;
use crate::error::{MysqlError, MysqlResult};
use crate::types::*;

pub struct ProcessManager;

impl ProcessManager {
    /// List all processes (SHOW PROCESSLIST).
    pub async fn list(client: &MysqlClient) -> MysqlResult<Vec<MysqlProcess>> {
        let out = client.exec_sql("SHOW FULL PROCESSLIST").await?;
        parse_processlist(&out)
    }

    /// Get a specific process by ID.
    pub async fn get(client: &MysqlClient, id: u64) -> MysqlResult<MysqlProcess> {
        let sql = format!(
            "SELECT ID, USER, HOST, DB, COMMAND, TIME, STATE, INFO \
             FROM information_schema.PROCESSLIST WHERE ID = {}",
            id
        );
        let out = client.exec_sql(&sql).await?;
        let line = out.lines().next()
            .ok_or_else(|| MysqlError::process_not_found(id))?;
        parse_process_line(line)
            .ok_or_else(|| MysqlError::parse("failed to parse process info"))
    }

    /// Kill a connection by process ID.
    pub async fn kill(client: &MysqlClient, id: u64) -> MysqlResult<()> {
        client.exec_sql(&format!("KILL {}", id)).await?;
        Ok(())
    }

    /// Kill only the query running on a connection.
    pub async fn kill_query(client: &MysqlClient, id: u64) -> MysqlResult<()> {
        client.exec_sql(&format!("KILL QUERY {}", id)).await?;
        Ok(())
    }

    /// List processes filtered by user.
    pub async fn list_by_user(client: &MysqlClient, user: &str) -> MysqlResult<Vec<MysqlProcess>> {
        let sql = format!(
            "SELECT ID, USER, HOST, DB, COMMAND, TIME, STATE, INFO \
             FROM information_schema.PROCESSLIST WHERE USER = '{}'",
            sql_escape(user)
        );
        let out = client.exec_sql(&sql).await?;
        parse_processlist(&out)
    }

    /// List processes filtered by database.
    pub async fn list_by_db(client: &MysqlClient, db: &str) -> MysqlResult<Vec<MysqlProcess>> {
        let sql = format!(
            "SELECT ID, USER, HOST, DB, COMMAND, TIME, STATE, INFO \
             FROM information_schema.PROCESSLIST WHERE DB = '{}'",
            sql_escape(db)
        );
        let out = client.exec_sql(&sql).await?;
        parse_processlist(&out)
    }

    /// Get the max_connections value.
    pub async fn get_max_connections(client: &MysqlClient) -> MysqlResult<u64> {
        let out = client.exec_sql("SELECT @@global.max_connections").await?;
        Ok(out.trim().parse().unwrap_or(0))
    }

    /// Get thread-related status variables.
    pub async fn get_thread_stats(client: &MysqlClient) -> MysqlResult<String> {
        let sql = "SHOW GLOBAL STATUS WHERE Variable_name LIKE 'Threads_%' \
                   OR Variable_name LIKE 'Connections' \
                   OR Variable_name = 'Max_used_connections'";
        client.exec_sql(sql).await
    }
}

fn parse_processlist(output: &str) -> MysqlResult<Vec<MysqlProcess>> {
    let mut processes = Vec::new();
    for line in output.lines() {
        if let Some(p) = parse_process_line(line) {
            processes.push(p);
        }
    }
    Ok(processes)
}

fn parse_process_line(line: &str) -> Option<MysqlProcess> {
    let cols: Vec<&str> = line.split('\t').collect();
    if cols.len() >= 8 {
        Some(MysqlProcess {
            id: cols[0].parse().unwrap_or(0),
            user: cols[1].to_string(),
            host: cols[2].to_string(),
            db: if cols[3] == "NULL" { None } else { Some(cols[3].to_string()) },
            command: cols[4].to_string(),
            time: cols[5].parse().unwrap_or(0),
            state: cols[6].to_string(),
            info: if cols[7] == "NULL" { None } else { Some(cols[7].to_string()) },
        })
    } else {
        None
    }
}

fn sql_escape(s: &str) -> String {
    s.replace('\'', "\\'")
}
