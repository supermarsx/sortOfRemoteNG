// ── sorng-postgres-admin/src/vacuum.rs ────────────────────────────────────────
//! PostgreSQL VACUUM, ANALYZE, REINDEX, and autovacuum management.

use crate::client::PgClient;
use crate::error::PgResult;
use crate::types::{PgSetting, PgVacuumInfo};

pub struct VacuumManager;

impl VacuumManager {
    /// Get vacuum/analyze statistics from pg_stat_user_tables.
    pub async fn get_stats(client: &PgClient, db: &str) -> PgResult<Vec<PgVacuumInfo>> {
        let sql = r#"
            SELECT schemaname, relname,
                   COALESCE(last_vacuum::text, ''),
                   COALESCE(last_autovacuum::text, ''),
                   vacuum_count, autovacuum_count,
                   COALESCE(last_analyze::text, ''),
                   COALESCE(last_autoanalyze::text, ''),
                   n_dead_tup, n_live_tup, n_mod_since_analyze
            FROM pg_stat_user_tables
            ORDER BY schemaname, relname
        "#;
        let out = client.exec_sql_db(db, sql).await?;
        let mut infos = Vec::new();
        for line in out.lines().filter(|l| !l.is_empty()) {
            let cols: Vec<&str> = line.splitn(11, '|').collect();
            if cols.len() >= 11 {
                infos.push(PgVacuumInfo {
                    schemaname: cols[0].to_string(),
                    relname: cols[1].to_string(),
                    last_vacuum: if cols[2].is_empty() { None } else { Some(cols[2].to_string()) },
                    last_autovacuum: if cols[3].is_empty() { None } else { Some(cols[3].to_string()) },
                    vacuum_count: cols[4].trim().parse().unwrap_or(0),
                    autovacuum_count: cols[5].trim().parse().unwrap_or(0),
                    last_analyze: if cols[6].is_empty() { None } else { Some(cols[6].to_string()) },
                    last_autoanalyze: if cols[7].is_empty() { None } else { Some(cols[7].to_string()) },
                    dead_tuples: cols[8].trim().parse().unwrap_or(0),
                    live_tuples: cols[9].trim().parse().unwrap_or(0),
                    n_mod_since_analyze: cols[10].trim().parse().unwrap_or(0),
                });
            }
        }
        Ok(infos)
    }

    /// Run VACUUM on a specific table.
    pub async fn vacuum(
        client: &PgClient,
        db: &str,
        table: &str,
        full: bool,
        analyze: bool,
        verbose: bool,
    ) -> PgResult<()> {
        let mut opts = Vec::new();
        if full { opts.push("FULL"); }
        if analyze { opts.push("ANALYZE"); }
        if verbose { opts.push("VERBOSE"); }
        let opt_str = if opts.is_empty() { String::new() } else { format!("({})", opts.join(", ")) };
        let sql = format!("VACUUM {} \"{}\"", opt_str, table);
        client.exec_sql_db(db, &sql).await?;
        Ok(())
    }

    /// Run VACUUM on an entire database.
    pub async fn vacuum_database(
        client: &PgClient,
        db: &str,
        full: bool,
        analyze: bool,
    ) -> PgResult<()> {
        let mut opts = Vec::new();
        if full { opts.push("FULL"); }
        if analyze { opts.push("ANALYZE"); }
        let opt_str = if opts.is_empty() { String::new() } else { format!("({})", opts.join(", ")) };
        let sql = format!("VACUUM {}", opt_str);
        client.exec_sql_db(db, &sql).await?;
        Ok(())
    }

    /// Run ANALYZE on a table.
    pub async fn analyze(client: &PgClient, db: &str, table: Option<&str>) -> PgResult<()> {
        let sql = match table {
            Some(t) => format!("ANALYZE \"{}\"", t),
            None => "ANALYZE".to_string(),
        };
        client.exec_sql_db(db, &sql).await?;
        Ok(())
    }

    /// Run REINDEX on a table or index.
    pub async fn reindex(client: &PgClient, db: &str, table_or_index: &str) -> PgResult<()> {
        let sql = format!("REINDEX TABLE \"{}\"", table_or_index);
        client.exec_sql_db(db, &sql).await?;
        Ok(())
    }

    /// Get tables with significant bloat (dead tuples > 0).
    pub async fn get_bloat(client: &PgClient, db: &str) -> PgResult<Vec<PgVacuumInfo>> {
        let stats = Self::get_stats(client, db).await?;
        Ok(stats.into_iter().filter(|s| s.dead_tuples > 0).collect())
    }

    /// Get autovacuum-related settings.
    pub async fn get_autovacuum_config(client: &PgClient) -> PgResult<Vec<PgSetting>> {
        let sql = r#"
            SELECT name, setting, COALESCE(unit, ''), category,
                   short_desc, context, source,
                   COALESCE(boot_val, ''), COALESCE(reset_val, ''),
                   pending_restart
            FROM pg_settings
            WHERE name LIKE 'autovacuum%'
            ORDER BY name
        "#;
        let out = client.exec_sql(sql).await?;
        parse_settings(&out)
    }

    /// Set an autovacuum configuration parameter.
    pub async fn set_autovacuum_config(
        client: &PgClient,
        setting: &str,
        value: &str,
    ) -> PgResult<()> {
        let sql = format!(
            "ALTER SYSTEM SET {} = '{}'",
            setting,
            value.replace('\'', "''")
        );
        client.exec_sql(&sql).await?;
        Ok(())
    }
}

/// Parse pg_settings output into PgSetting vec.
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
