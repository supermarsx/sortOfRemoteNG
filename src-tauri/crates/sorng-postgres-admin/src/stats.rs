// ── sorng-postgres-admin/src/stats.rs ─────────────────────────────────────────
//! PostgreSQL statistics, settings, locks, and activity queries.

use crate::client::PgClient;
use crate::error::PgResult;
use crate::types::*;

pub struct StatsManager;

impl StatsManager {
    /// Get per-database statistics from pg_stat_database.
    pub async fn get_database_stats(client: &PgClient) -> PgResult<Vec<PgStatDatabase>> {
        let sql = r#"
            SELECT datname, numbackends, xact_commit, xact_rollback,
                   blks_read, blks_hit,
                   tup_returned, tup_fetched, tup_inserted, tup_updated, tup_deleted,
                   conflicts, temp_files, temp_bytes, deadlocks,
                   blk_read_time, blk_write_time,
                   COALESCE(stats_reset::text, '')
            FROM pg_stat_database
            WHERE datname IS NOT NULL
            ORDER BY datname
        "#;
        let out = client.exec_sql(sql).await?;
        let mut stats = Vec::new();
        for line in out.lines().filter(|l| !l.is_empty()) {
            let cols: Vec<&str> = line.splitn(18, '|').collect();
            if cols.len() >= 18 {
                stats.push(PgStatDatabase {
                    datname: cols[0].to_string(),
                    numbackends: cols[1].trim().parse().unwrap_or(0),
                    xact_commit: cols[2].trim().parse().unwrap_or(0),
                    xact_rollback: cols[3].trim().parse().unwrap_or(0),
                    blks_read: cols[4].trim().parse().unwrap_or(0),
                    blks_hit: cols[5].trim().parse().unwrap_or(0),
                    tup_returned: cols[6].trim().parse().unwrap_or(0),
                    tup_fetched: cols[7].trim().parse().unwrap_or(0),
                    tup_inserted: cols[8].trim().parse().unwrap_or(0),
                    tup_updated: cols[9].trim().parse().unwrap_or(0),
                    tup_deleted: cols[10].trim().parse().unwrap_or(0),
                    conflicts: cols[11].trim().parse().unwrap_or(0),
                    temp_files: cols[12].trim().parse().unwrap_or(0),
                    temp_bytes: cols[13].trim().parse().unwrap_or(0),
                    deadlocks: cols[14].trim().parse().unwrap_or(0),
                    blk_read_time: cols[15].trim().parse().unwrap_or(0.0),
                    blk_write_time: cols[16].trim().parse().unwrap_or(0.0),
                    stats_reset: if cols[17].is_empty() { None } else { Some(cols[17].to_string()) },
                });
            }
        }
        Ok(stats)
    }

    /// Get per-table statistics from pg_stat_user_tables.
    pub async fn get_table_stats(
        client: &PgClient,
        db: &str,
        schema: Option<&str>,
    ) -> PgResult<Vec<PgStatTable>> {
        let where_clause = match schema {
            Some(s) => format!("WHERE schemaname = '{}'", s.replace('\'', "''")),
            None => String::new(),
        };
        let sql = format!(
            r#"SELECT schemaname, relname, seq_scan, seq_tup_read,
                      COALESCE(idx_scan, 0), COALESCE(idx_tup_fetch, 0),
                      n_tup_ins, n_tup_upd, n_tup_del, n_tup_hot_upd,
                      n_live_tup, n_dead_tup,
                      COALESCE(last_vacuum::text, ''),
                      COALESCE(last_autovacuum::text, '')
               FROM pg_stat_user_tables
               {}
               ORDER BY schemaname, relname"#,
            where_clause
        );
        let out = client.exec_sql_db(db, &sql).await?;
        let mut stats = Vec::new();
        for line in out.lines().filter(|l| !l.is_empty()) {
            let cols: Vec<&str> = line.splitn(14, '|').collect();
            if cols.len() >= 14 {
                stats.push(PgStatTable {
                    schemaname: cols[0].to_string(),
                    relname: cols[1].to_string(),
                    seq_scan: cols[2].trim().parse().unwrap_or(0),
                    seq_tup_read: cols[3].trim().parse().unwrap_or(0),
                    idx_scan: Some(cols[4].trim().parse().unwrap_or(0)),
                    idx_tup_fetch: Some(cols[5].trim().parse().unwrap_or(0)),
                    n_tup_ins: cols[6].trim().parse().unwrap_or(0),
                    n_tup_upd: cols[7].trim().parse().unwrap_or(0),
                    n_tup_del: cols[8].trim().parse().unwrap_or(0),
                    n_tup_hot_upd: cols[9].trim().parse().unwrap_or(0),
                    n_live_tup: cols[10].trim().parse().unwrap_or(0),
                    n_dead_tup: cols[11].trim().parse().unwrap_or(0),
                    last_vacuum: if cols[12].is_empty() { None } else { Some(cols[12].to_string()) },
                    last_autovacuum: if cols[13].is_empty() { None } else { Some(cols[13].to_string()) },
                });
            }
        }
        Ok(stats)
    }

    /// Get index statistics from pg_stat_user_indexes + pg_indexes.
    pub async fn get_index_stats(
        client: &PgClient,
        db: &str,
        schema: Option<&str>,
    ) -> PgResult<Vec<PgIndex>> {
        let where_clause = match schema {
            Some(s) => format!("WHERE s.schemaname = '{}'", s.replace('\'', "''")),
            None => String::new(),
        };
        let sql = format!(
            r#"SELECT s.schemaname, s.relname, s.indexrelname,
                      COALESCE(i.indexdef, ''),
                      pg_relation_size(s.indexrelid),
                      s.idx_scan, s.idx_tup_read, s.idx_tup_fetch
               FROM pg_stat_user_indexes s
               LEFT JOIN pg_indexes i
                 ON i.schemaname = s.schemaname
                 AND i.indexname = s.indexrelname
               {}
               ORDER BY s.schemaname, s.relname, s.indexrelname"#,
            where_clause
        );
        let out = client.exec_sql_db(db, &sql).await?;
        let mut indexes = Vec::new();
        for line in out.lines().filter(|l| !l.is_empty()) {
            let cols: Vec<&str> = line.splitn(8, '|').collect();
            if cols.len() >= 8 {
                indexes.push(PgIndex {
                    schemaname: cols[0].to_string(),
                    tablename: cols[1].to_string(),
                    indexname: cols[2].to_string(),
                    indexdef: cols[3].to_string(),
                    size_bytes: cols[4].trim().parse().unwrap_or(0),
                    idx_scan: cols[5].trim().parse().unwrap_or(0),
                    idx_tup_read: cols[6].trim().parse().unwrap_or(0),
                    idx_tup_fetch: cols[7].trim().parse().unwrap_or(0),
                });
            }
        }
        Ok(indexes)
    }

    /// Get current locks from pg_locks.
    pub async fn get_locks(client: &PgClient) -> PgResult<Vec<PgLock>> {
        let sql = r#"
            SELECT locktype,
                   COALESCE(d.datname, ''),
                   COALESCE(c.relname, ''),
                   COALESCE(l.page::text, ''),
                   COALESCE(l.tuple::text, ''),
                   l.pid, l.mode, l.granted,
                   COALESCE(l.waitstart::text, '')
            FROM pg_locks l
            LEFT JOIN pg_database d ON d.oid = l.database
            LEFT JOIN pg_class c ON c.oid = l.relation
            ORDER BY l.pid
        "#;
        let out = client.exec_sql(sql).await?;
        let mut locks = Vec::new();
        for line in out.lines().filter(|l| !l.is_empty()) {
            let cols: Vec<&str> = line.splitn(9, '|').collect();
            if cols.len() >= 9 {
                locks.push(PgLock {
                    locktype: cols[0].to_string(),
                    database: if cols[1].is_empty() { None } else { Some(cols[1].to_string()) },
                    relation: if cols[2].is_empty() { None } else { Some(cols[2].to_string()) },
                    page: cols[3].trim().parse().ok(),
                    tuple: cols[4].trim().parse().ok(),
                    pid: cols[5].trim().parse().unwrap_or(0),
                    mode: cols[6].to_string(),
                    granted: cols[7] == "t",
                    waitstart: if cols[8].is_empty() { None } else { Some(cols[8].to_string()) },
                });
            }
        }
        Ok(locks)
    }

    /// Get current activity from pg_stat_activity.
    pub async fn get_activity(client: &PgClient) -> PgResult<Vec<PgActivity>> {
        let sql = r#"
            SELECT pid, COALESCE(datname, ''), COALESCE(usename, ''),
                   COALESCE(application_name, ''),
                   COALESCE(client_addr::text, ''),
                   COALESCE(state, ''),
                   COALESCE(query, ''),
                   COALESCE(backend_start::text, ''),
                   COALESCE(query_start::text, ''),
                   COALESCE(wait_event_type, ''),
                   COALESCE(wait_event, '')
            FROM pg_stat_activity
            ORDER BY pid
        "#;
        let out = client.exec_sql(sql).await?;
        let mut activity = Vec::new();
        for line in out.lines().filter(|l| !l.is_empty()) {
            let cols: Vec<&str> = line.splitn(11, '|').collect();
            if cols.len() >= 11 {
                activity.push(PgActivity {
                    pid: cols[0].trim().parse().unwrap_or(0),
                    datname: if cols[1].is_empty() { None } else { Some(cols[1].to_string()) },
                    usename: if cols[2].is_empty() { None } else { Some(cols[2].to_string()) },
                    application_name: cols[3].to_string(),
                    client_addr: if cols[4].is_empty() { None } else { Some(cols[4].to_string()) },
                    state: if cols[5].is_empty() { None } else { Some(cols[5].to_string()) },
                    query: if cols[6].is_empty() { None } else { Some(cols[6].to_string()) },
                    backend_start: if cols[7].is_empty() { None } else { Some(cols[7].to_string()) },
                    query_start: if cols[8].is_empty() { None } else { Some(cols[8].to_string()) },
                    wait_event_type: if cols[9].is_empty() { None } else { Some(cols[9].to_string()) },
                    wait_event: if cols[10].is_empty() { None } else { Some(cols[10].to_string()) },
                });
            }
        }
        Ok(activity)
    }

    /// Get all PostgreSQL settings.
    pub async fn get_settings(client: &PgClient) -> PgResult<Vec<PgSetting>> {
        let sql = r#"
            SELECT name, setting, COALESCE(unit, ''), category,
                   short_desc, context, source,
                   COALESCE(boot_val, ''), COALESCE(reset_val, ''),
                   pending_restart
            FROM pg_settings
            ORDER BY name
        "#;
        let out = client.exec_sql(sql).await?;
        parse_settings(&out)
    }

    /// Get a single setting by name.
    pub async fn get_setting(client: &PgClient, name: &str) -> PgResult<PgSetting> {
        let sql = format!(
            r#"SELECT name, setting, COALESCE(unit, ''), category,
                      short_desc, context, source,
                      COALESCE(boot_val, ''), COALESCE(reset_val, ''),
                      pending_restart
               FROM pg_settings
               WHERE name = '{}'"#,
            name.replace('\'', "''")
        );
        let out = client.exec_sql(&sql).await?;
        let settings = parse_settings(&out)?;
        settings.into_iter().next()
            .ok_or_else(|| crate::error::PgError::command_failed(format!("Setting not found: {}", name)))
    }

    /// Set a configuration parameter via ALTER SYSTEM.
    pub async fn set_setting(client: &PgClient, name: &str, value: &str) -> PgResult<()> {
        let sql = format!(
            "ALTER SYSTEM SET {} = '{}'",
            name,
            value.replace('\'', "''")
        );
        client.exec_sql(&sql).await?;
        Ok(())
    }

    /// Reload server configuration.
    pub async fn reload_config(client: &PgClient) -> PgResult<()> {
        client.exec_sql("SELECT pg_reload_conf()").await?;
        Ok(())
    }

    /// Reset statistics for a database.
    pub async fn reset_stats(client: &PgClient, db: &str) -> PgResult<()> {
        let sql = format!(
            "SELECT pg_stat_reset_single_table_counters(c.oid) \
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
             WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')"
        );
        client.exec_sql_db(db, &sql).await?;
        Ok(())
    }
}

fn parse_settings(output: &str) -> PgResult<Vec<PgSetting>> {
    let mut settings = Vec::new();
    for line in output.lines().filter(|l| !l.is_empty()) {
        let cols: Vec<&str> = line.splitn(10, '|').collect();
        if cols.len() >= 10 {
            settings.push(PgSetting {
                name: cols[0].to_string(),
                setting: cols[1].to_string(),
                unit: if cols[2].is_empty() { None } else { Some(cols[2].to_string()) },
                category: cols[3].to_string(),
                short_desc: cols[4].to_string(),
                context: cols[5].to_string(),
                source: cols[6].to_string(),
                boot_val: if cols[7].is_empty() { None } else { Some(cols[7].to_string()) },
                reset_val: if cols[8].is_empty() { None } else { Some(cols[8].to_string()) },
                pending_restart: cols[9] == "t",
            });
        }
    }
    Ok(settings)
}
