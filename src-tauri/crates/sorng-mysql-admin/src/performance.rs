// ── sorng-mysql-admin – performance management ───────────────────────────────

use crate::client::MysqlAdminClient;
use crate::error::MysqlAdminResult;
use crate::types::*;

pub struct PerformanceManager;

impl PerformanceManager {
    pub async fn list_slow_queries(client: &MysqlAdminClient, limit: Option<u32>) -> MysqlAdminResult<Vec<SlowQuery>> {
        let lim = limit.unwrap_or(50);
        let out = client.exec_mysql(&format!(
            "SELECT start_time, user_host, db, query_time, lock_time, rows_sent, rows_examined, sql_text \
             FROM mysql.slow_log ORDER BY start_time DESC LIMIT {}", lim
        )).await?;
        let queries = out.lines()
            .filter(|l| !l.is_empty())
            .map(|l| {
                let c: Vec<&str> = l.split('\t').collect();
                SlowQuery {
                    id: None,
                    start_time: c.first().map(|s| s.to_string()),
                    user: c.get(1).map(|s| s.to_string()),
                    host: None,
                    db: c.get(2).filter(|s| *s != "NULL").map(|s| s.to_string()),
                    query_time: c.get(3).map(|s| s.to_string()),
                    lock_time: c.get(4).map(|s| s.to_string()),
                    rows_sent: c.get(5).and_then(|s| s.parse().ok()),
                    rows_examined: c.get(6).and_then(|s| s.parse().ok()),
                    sql_text: c.get(7).map(|s| s.to_string()).unwrap_or_default(),
                }
            })
            .collect();
        Ok(queries)
    }

    pub async fn get_performance_digests(client: &MysqlAdminClient, limit: Option<u32>) -> MysqlAdminResult<Vec<PerformanceDigest>> {
        let lim = limit.unwrap_or(20);
        let out = client.exec_mysql(&format!(
            "SELECT SCHEMA_NAME, DIGEST_TEXT, COUNT_STAR, \
             AVG_TIMER_WAIT/1000000000000, SUM_ROWS_SENT, SUM_ROWS_EXAMINED, \
             FIRST_SEEN, LAST_SEEN \
             FROM performance_schema.events_statements_summary_by_digest \
             ORDER BY COUNT_STAR DESC LIMIT {}", lim
        )).await?;
        let digests = out.lines()
            .filter(|l| !l.is_empty())
            .map(|l| {
                let c: Vec<&str> = l.split('\t').collect();
                PerformanceDigest {
                    schema_name: c.first().filter(|s| *s != "NULL").map(|s| s.to_string()),
                    digest_text: c.get(1).map(|s| s.to_string()).unwrap_or_default(),
                    count_star: c.get(2).and_then(|s| s.parse().ok()).unwrap_or(0),
                    avg_timer_wait: c.get(3).and_then(|s| s.parse().ok()),
                    sum_rows_sent: c.get(4).and_then(|s| s.parse().ok()),
                    sum_rows_examined: c.get(5).and_then(|s| s.parse().ok()),
                    first_seen: c.get(6).filter(|s| *s != "NULL").map(|s| s.to_string()),
                    last_seen: c.get(7).filter(|s| *s != "NULL").map(|s| s.to_string()),
                }
            })
            .collect();
        Ok(digests)
    }

    pub async fn get_table_io_stats(client: &MysqlAdminClient, db: Option<&str>) -> MysqlAdminResult<Vec<TableIoStats>> {
        let mut sql = "SELECT OBJECT_SCHEMA, OBJECT_NAME, COUNT_READ, COUNT_WRITE, \
             COUNT_FETCH, COUNT_INSERT, COUNT_UPDATE, COUNT_DELETE \
             FROM performance_schema.table_io_waits_summary_by_table".to_string();
        if let Some(schema) = db {
            sql.push_str(&format!(" WHERE OBJECT_SCHEMA='{}'", schema));
        }
        let out = client.exec_mysql(&sql).await?;
        let stats = out.lines()
            .filter(|l| !l.is_empty())
            .map(|l| {
                let c: Vec<&str> = l.split('\t').collect();
                TableIoStats {
                    table_schema: c.first().map(|s| s.to_string()).unwrap_or_default(),
                    table_name: c.get(1).map(|s| s.to_string()).unwrap_or_default(),
                    count_read: c.get(2).and_then(|s| s.parse().ok()),
                    count_write: c.get(3).and_then(|s| s.parse().ok()),
                    count_fetch: c.get(4).and_then(|s| s.parse().ok()),
                    count_insert: c.get(5).and_then(|s| s.parse().ok()),
                    count_update: c.get(6).and_then(|s| s.parse().ok()),
                    count_delete: c.get(7).and_then(|s| s.parse().ok()),
                }
            })
            .collect();
        Ok(stats)
    }

    pub async fn get_index_stats(client: &MysqlAdminClient, db: Option<&str>) -> MysqlAdminResult<Vec<IndexStats>> {
        let mut sql = "SELECT OBJECT_SCHEMA, OBJECT_NAME, INDEX_NAME, COUNT_READ, COUNT_WRITE, \
             AVG_TIMER_WAIT/1000000000000 \
             FROM performance_schema.table_io_waits_summary_by_index_usage \
             WHERE INDEX_NAME IS NOT NULL".to_string();
        if let Some(schema) = db {
            sql.push_str(&format!(" AND OBJECT_SCHEMA='{}'", schema));
        }
        let out = client.exec_mysql(&sql).await?;
        let stats = out.lines()
            .filter(|l| !l.is_empty())
            .map(|l| {
                let c: Vec<&str> = l.split('\t').collect();
                IndexStats {
                    table_schema: c.first().map(|s| s.to_string()).unwrap_or_default(),
                    table_name: c.get(1).map(|s| s.to_string()).unwrap_or_default(),
                    index_name: c.get(2).map(|s| s.to_string()).unwrap_or_default(),
                    count_read: c.get(3).and_then(|s| s.parse().ok()),
                    count_write: c.get(4).and_then(|s| s.parse().ok()),
                    avg_timer_wait: c.get(5).and_then(|s| s.parse().ok()),
                }
            })
            .collect();
        Ok(stats)
    }

    pub async fn get_wait_stats(client: &MysqlAdminClient, limit: Option<u32>) -> MysqlAdminResult<Vec<WaitStats>> {
        let lim = limit.unwrap_or(20);
        let out = client.exec_mysql(&format!(
            "SELECT EVENT_NAME, COUNT_STAR, SUM_TIMER_WAIT/1000000000000, AVG_TIMER_WAIT/1000000000000 \
             FROM performance_schema.events_waits_summary_global_by_event_name \
             WHERE COUNT_STAR > 0 ORDER BY SUM_TIMER_WAIT DESC LIMIT {}", lim
        )).await?;
        let events = out.lines()
            .filter(|l| !l.is_empty())
            .map(|l| {
                let c: Vec<&str> = l.split('\t').collect();
                WaitStats {
                    event_name: c.first().map(|s| s.to_string()).unwrap_or_default(),
                    count_star: c.get(1).and_then(|s| s.parse().ok()).unwrap_or(0),
                    sum_timer_wait: c.get(2).and_then(|s| s.parse().ok()),
                    avg_timer_wait: c.get(3).and_then(|s| s.parse().ok()),
                }
            })
            .collect();
        Ok(events)
    }

    pub async fn get_processlist(client: &MysqlAdminClient) -> MysqlAdminResult<Vec<ProcessListEntry>> {
        let out = client.exec_mysql(
            "SELECT Id, User, Host, db, Command, Time, State, Info \
             FROM information_schema.PROCESSLIST"
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

    pub async fn explain_query(client: &MysqlAdminClient, db: &str, query: &str) -> MysqlAdminResult<String> {
        client.exec_mysql_db(db, &format!("EXPLAIN {}", query)).await
    }

    pub async fn get_query_profile(client: &MysqlAdminClient) -> MysqlAdminResult<String> {
        client.exec_mysql("SHOW PROFILES").await
    }

    pub async fn enable_slow_log(client: &MysqlAdminClient) -> MysqlAdminResult<()> {
        client.exec_mysql("SET GLOBAL slow_query_log = 'ON'").await?;
        Ok(())
    }

    pub async fn disable_slow_log(client: &MysqlAdminClient) -> MysqlAdminResult<()> {
        client.exec_mysql("SET GLOBAL slow_query_log = 'OFF'").await?;
        Ok(())
    }

    pub async fn clear_performance_schema(client: &MysqlAdminClient) -> MysqlAdminResult<()> {
        client.exec_mysql("TRUNCATE TABLE performance_schema.events_statements_summary_by_digest").await?;
        client.exec_mysql("TRUNCATE TABLE performance_schema.events_waits_summary_global_by_event_name").await?;
        client.exec_mysql("TRUNCATE TABLE performance_schema.table_io_waits_summary_by_table").await?;
        client.exec_mysql("TRUNCATE TABLE performance_schema.table_io_waits_summary_by_index_usage").await?;
        Ok(())
    }
}
