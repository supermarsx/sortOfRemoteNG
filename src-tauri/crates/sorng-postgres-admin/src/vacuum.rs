// ── sorng-postgres-admin – vacuum management ─────────────────────────────────
//! VACUUM, ANALYZE, autovacuum configuration, and progress monitoring.

use crate::client::PgAdminClient;
use crate::error::PgAdminResult;
use crate::types::*;

pub struct VacuumManager;

impl VacuumManager {
    /// Get vacuum statistics for all tables in a database.
    pub async fn get_vacuum_stats(client: &PgAdminClient, db: &str) -> PgAdminResult<Vec<VacuumStats>> {
        let raw = client.exec_psql_db(db,
            "SELECT relname, last_vacuum::text, last_autovacuum::text, \
             last_analyze::text, last_autoanalyze::text, \
             n_dead_tup, n_live_tup, autovacuum_count, vacuum_count \
             FROM pg_stat_user_tables ORDER BY n_dead_tup DESC;"
        ).await?;

        let mut stats = Vec::new();
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            let c: Vec<&str> = line.splitn(9, '|').collect();
            if c.len() < 9 { continue; }
            stats.push(VacuumStats {
                relname: c[0].trim().to_string(),
                last_vacuum: non_empty(c[1]),
                last_autovacuum: non_empty(c[2]),
                last_analyze: non_empty(c[3]),
                last_autoanalyze: non_empty(c[4]),
                n_dead_tup: c[5].trim().parse().unwrap_or(0),
                n_live_tup: c[6].trim().parse().unwrap_or(0),
                autovacuum_count: c[7].trim().parse().unwrap_or(0),
                vacuum_count: c[8].trim().parse().unwrap_or(0),
            });
        }
        Ok(stats)
    }

    /// Run VACUUM on a table or database.
    pub async fn run_vacuum(client: &PgAdminClient, req: &VacuumRequest) -> PgAdminResult<String> {
        let mut sql = String::from("VACUUM");
        if req.full.unwrap_or(false) { sql.push_str(" FULL"); }
        if req.freeze.unwrap_or(false) { sql.push_str(" FREEZE"); }
        if req.analyze.unwrap_or(false) { sql.push_str(" ANALYZE"); }
        if req.verbose.unwrap_or(false) { sql.push_str(" VERBOSE"); }

        if let Some(ref table) = req.table_name {
            if let Some(ref schema) = req.schema {
                sql.push_str(&format!(" \"{}\".\"{}\"", schema, table));
            } else {
                sql.push_str(&format!(" \"{}\"", table));
            }
        }
        sql.push(';');

        let db = req.database.as_deref().unwrap_or(client.pg_database());
        let out = client.exec_psql_db(db, &sql).await?;
        Ok(out)
    }

    /// Run ANALYZE on a table or database.
    pub async fn run_analyze(client: &PgAdminClient, db: &str, schema: Option<&str>, table: Option<&str>) -> PgAdminResult<String> {
        let target = match (schema, table) {
            (Some(s), Some(t)) => format!(" \"{}\".\"{}\"", s, t),
            (None, Some(t)) => format!(" \"{}\"", t),
            _ => String::new(),
        };
        let out = client.exec_psql_db(db, &format!("ANALYZE{};", target)).await?;
        Ok(out)
    }

    /// Get autovacuum configuration.
    pub async fn get_autovacuum_config(client: &PgAdminClient) -> PgAdminResult<AutovacuumConfig> {
        let get = |name: &str| async move {
            client.exec_psql(&format!(
                "SELECT setting FROM pg_settings WHERE name = '{}';", name
            )).await.map(|s| s.trim().to_string())
        };

        let autovacuum = get("autovacuum").await?;
        let naptime = get("autovacuum_naptime").await?;
        let vac_thresh = get("autovacuum_vacuum_threshold").await?;
        let vac_scale = get("autovacuum_vacuum_scale_factor").await?;
        let ana_thresh = get("autovacuum_analyze_threshold").await?;
        let ana_scale = get("autovacuum_analyze_scale_factor").await?;
        let freeze = get("autovacuum_freeze_max_age").await?;
        let workers = get("autovacuum_max_workers").await?;

        Ok(AutovacuumConfig {
            autovacuum: autovacuum == "on",
            autovacuum_naptime: naptime,
            autovacuum_vacuum_threshold: vac_thresh.parse().unwrap_or(50),
            autovacuum_vacuum_scale_factor: vac_scale.parse().unwrap_or(0.2),
            autovacuum_analyze_threshold: ana_thresh.parse().unwrap_or(50),
            autovacuum_analyze_scale_factor: ana_scale.parse().unwrap_or(0.1),
            autovacuum_freeze_max_age: freeze.parse().unwrap_or(200000000),
            autovacuum_max_workers: workers.parse().unwrap_or(3),
        })
    }

    /// Set autovacuum configuration values.
    pub async fn set_autovacuum_config(client: &PgAdminClient, config: &AutovacuumConfig) -> PgAdminResult<()> {
        let val = if config.autovacuum { "on" } else { "off" };
        client.exec_psql(&format!("ALTER SYSTEM SET autovacuum = '{}';", val)).await?;
        client.exec_psql(&format!("ALTER SYSTEM SET autovacuum_naptime = '{}';", config.autovacuum_naptime)).await?;
        client.exec_psql(&format!("ALTER SYSTEM SET autovacuum_vacuum_threshold = {};", config.autovacuum_vacuum_threshold)).await?;
        client.exec_psql(&format!("ALTER SYSTEM SET autovacuum_vacuum_scale_factor = {};", config.autovacuum_vacuum_scale_factor)).await?;
        client.exec_psql(&format!("ALTER SYSTEM SET autovacuum_analyze_threshold = {};", config.autovacuum_analyze_threshold)).await?;
        client.exec_psql(&format!("ALTER SYSTEM SET autovacuum_analyze_scale_factor = {};", config.autovacuum_analyze_scale_factor)).await?;
        client.exec_psql(&format!("ALTER SYSTEM SET autovacuum_freeze_max_age = {};", config.autovacuum_freeze_max_age)).await?;
        client.exec_psql(&format!("ALTER SYSTEM SET autovacuum_max_workers = {};", config.autovacuum_max_workers)).await?;
        client.exec_psql("SELECT pg_reload_conf();").await?;
        Ok(())
    }

    /// Get vacuum progress from pg_stat_progress_vacuum.
    pub async fn get_vacuum_progress(client: &PgAdminClient) -> PgAdminResult<Vec<VacuumProgress>> {
        let raw = client.exec_psql(
            "SELECT p.pid, d.datname, c.relname, p.phase, \
             p.heap_blks_total, p.heap_blks_scanned, p.heap_blks_vacuumed, \
             p.index_vacuum_count, p.max_dead_tuples, p.num_dead_tuples \
             FROM pg_stat_progress_vacuum p \
             JOIN pg_database d ON d.oid = p.datid \
             JOIN pg_class c ON c.oid = p.relid \
             ORDER BY p.pid;"
        ).await?;

        let mut progress = Vec::new();
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            let c: Vec<&str> = line.splitn(10, '|').collect();
            if c.len() < 10 { continue; }
            progress.push(VacuumProgress {
                pid: c[0].trim().parse().unwrap_or(0),
                datname: c[1].trim().to_string(),
                relname: c[2].trim().to_string(),
                phase: c[3].trim().to_string(),
                heap_blks_total: c[4].trim().parse().unwrap_or(0),
                heap_blks_scanned: c[5].trim().parse().unwrap_or(0),
                heap_blks_vacuumed: c[6].trim().parse().unwrap_or(0),
                index_vacuum_count: c[7].trim().parse().unwrap_or(0),
                max_dead_tuples: c[8].trim().parse().unwrap_or(0),
                num_dead_tuples: c[9].trim().parse().unwrap_or(0),
            });
        }
        Ok(progress)
    }

    /// Get dead tuple counts per table.
    pub async fn get_dead_tuples(client: &PgAdminClient, db: &str) -> PgAdminResult<Vec<VacuumStats>> {
        Self::get_vacuum_stats(client, db).await
    }

    /// Get frozen xid age for all databases.
    pub async fn get_frozen_xid_age(client: &PgAdminClient) -> PgAdminResult<String> {
        let raw = client.exec_psql(
            "SELECT datname, age(datfrozenxid)::text AS xid_age \
             FROM pg_database ORDER BY age(datfrozenxid) DESC;"
        ).await?;
        Ok(raw.trim().to_string())
    }

    /// List tables that need vacuuming (high dead tuple ratio).
    pub async fn list_tables_needing_vacuum(client: &PgAdminClient, db: &str) -> PgAdminResult<Vec<VacuumStats>> {
        let raw = client.exec_psql_db(db,
            "SELECT relname, last_vacuum::text, last_autovacuum::text, \
             last_analyze::text, last_autoanalyze::text, \
             n_dead_tup, n_live_tup, autovacuum_count, vacuum_count \
             FROM pg_stat_user_tables \
             WHERE n_dead_tup > (n_live_tup * 0.1 + 50) \
             ORDER BY n_dead_tup DESC;"
        ).await?;

        let mut stats = Vec::new();
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            let c: Vec<&str> = line.splitn(9, '|').collect();
            if c.len() < 9 { continue; }
            stats.push(VacuumStats {
                relname: c[0].trim().to_string(),
                last_vacuum: non_empty(c[1]),
                last_autovacuum: non_empty(c[2]),
                last_analyze: non_empty(c[3]),
                last_autoanalyze: non_empty(c[4]),
                n_dead_tup: c[5].trim().parse().unwrap_or(0),
                n_live_tup: c[6].trim().parse().unwrap_or(0),
                autovacuum_count: c[7].trim().parse().unwrap_or(0),
                vacuum_count: c[8].trim().parse().unwrap_or(0),
            });
        }
        Ok(stats)
    }
}

fn non_empty(s: &str) -> Option<String> {
    let s = s.trim();
    if s.is_empty() { None } else { Some(s.to_string()) }
}
