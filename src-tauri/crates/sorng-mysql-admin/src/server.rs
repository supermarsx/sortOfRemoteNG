// ── sorng-mysql-admin – server management ────────────────────────────────────

use crate::client::MysqlAdminClient;
use crate::error::MysqlAdminResult;
use crate::types::*;

pub struct ServerManager;

impl ServerManager {
    pub async fn get_status(client: &MysqlAdminClient) -> MysqlAdminResult<MysqlServerStatus> {
        let version = client.exec_mysql("SELECT VERSION()").await.unwrap_or_default().trim().to_string();
        let status = |key: &str| async move {
            client.exec_mysql(&format!(
                "SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME='{}'", key
            )).await.ok().and_then(|s| s.trim().parse::<u64>().ok()).unwrap_or(0)
        };
        Ok(MysqlServerStatus {
            version,
            uptime: status("Uptime").await,
            threads_connected: status("Threads_connected").await,
            threads_running: status("Threads_running").await,
            queries: status("Queries").await,
            slow_queries: status("Slow_queries").await,
            opens: status("Opened_tables").await,
            open_tables: status("Open_tables").await,
            flush_tables: status("Flush_commands").await,
            bytes_received: status("Bytes_received").await,
            bytes_sent: status("Bytes_sent").await,
            aborted_connects: status("Aborted_connects").await,
            aborted_clients: status("Aborted_clients").await,
            max_connections: client.exec_mysql("SELECT @@max_connections").await
                .ok().and_then(|s| s.trim().parse::<u64>().ok()).unwrap_or(0),
            connection_errors: status("Connection_errors_internal").await,
        })
    }

    pub async fn list_processes(client: &MysqlAdminClient) -> MysqlAdminResult<Vec<ProcessListEntry>> {
        let out = client.exec_mysql(
            "SELECT Id, User, Host, db, Command, Time, State, Info FROM information_schema.PROCESSLIST"
        ).await?;
        let procs = out.lines()
            .filter(|l| !l.is_empty())
            .map(|l| {
                let c: Vec<&str> = l.split('\t').collect();
                ProcessListEntry {
                    id: c.first().and_then(|s| s.parse().ok()).unwrap_or(0),
                    user: c.get(1).map(|s| s.to_string()).unwrap_or_default(),
                    host: c.get(2).map(|s| s.to_string()).unwrap_or_default(),
                    db: c.get(3).filter(|s| *s != "NULL").map(|s| s.to_string()),
                    command: c.get(4).map(|s| s.to_string()).unwrap_or_default(),
                    time: c.get(5).and_then(|s| s.parse().ok()).unwrap_or(0),
                    state: c.get(6).filter(|s| *s != "NULL").map(|s| s.to_string()),
                    info: c.get(7).filter(|s| *s != "NULL").map(|s| s.to_string()),
                    progress: None,
                }
            })
            .collect();
        Ok(procs)
    }

    pub async fn kill_process(client: &MysqlAdminClient, process_id: u64) -> MysqlAdminResult<()> {
        client.exec_mysql(&format!("KILL {}", process_id)).await?;
        Ok(())
    }

    pub async fn get_global_status(client: &MysqlAdminClient) -> MysqlAdminResult<Vec<MysqlGlobalStatus>> {
        let out = client.exec_mysql("SHOW GLOBAL STATUS").await?;
        let vars = out.lines()
            .filter(|l| !l.is_empty())
            .map(|l| {
                let c: Vec<&str> = l.split('\t').collect();
                MysqlGlobalStatus {
                    key: c.first().map(|s| s.to_string()).unwrap_or_default(),
                    value: c.get(1).map(|s| s.to_string()).unwrap_or_default(),
                }
            })
            .collect();
        Ok(vars)
    }

    pub async fn get_uptime(client: &MysqlAdminClient) -> MysqlAdminResult<u64> {
        let out = client.exec_mysql(
            "SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME='Uptime'"
        ).await?;
        Ok(out.trim().parse::<u64>().unwrap_or(0))
    }

    pub async fn get_version(client: &MysqlAdminClient) -> MysqlAdminResult<String> {
        let out = client.exec_mysql("SELECT VERSION()").await?;
        Ok(out.trim().to_string())
    }

    pub async fn flush_privileges(client: &MysqlAdminClient) -> MysqlAdminResult<()> {
        client.exec_mysql("FLUSH PRIVILEGES").await?;
        Ok(())
    }

    pub async fn flush_tables(client: &MysqlAdminClient) -> MysqlAdminResult<()> {
        client.exec_mysql("FLUSH TABLES").await?;
        Ok(())
    }

    pub async fn flush_logs(client: &MysqlAdminClient) -> MysqlAdminResult<()> {
        client.exec_mysql("FLUSH LOGS").await?;
        Ok(())
    }

    pub async fn flush_hosts(client: &MysqlAdminClient) -> MysqlAdminResult<()> {
        client.exec_mysql("FLUSH HOSTS").await?;
        Ok(())
    }

    pub async fn shutdown(client: &MysqlAdminClient) -> MysqlAdminResult<()> {
        client.exec_mysql("SHUTDOWN").await?;
        Ok(())
    }
}
