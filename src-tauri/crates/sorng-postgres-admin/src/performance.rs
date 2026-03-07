// ── sorng-postgres-admin – performance management ────────────────────────────
//! Table stats, index stats, IO stats, query stats, bloat, and diagnostics.

use crate::client::PgAdminClient;
use crate::error::PgAdminResult;
use crate::types::*;

pub struct PerformanceManager;

impl PerformanceManager {
    /// Get table statistics from pg_stat_user_tables.
    pub async fn get_table_stats(client: &PgAdminClient, db: &str) -> PgAdminResult<Vec<PgStatUserTable>> {
        let raw = client.exec_psql_db(db,
            "SELECT schemaname, relname, seq_scan, seq_tup_read, idx_scan, idx_tup_fetch, \
             n_tup_ins, n_tup_upd, n_tup_del, n_tup_hot_upd, n_live_tup, n_dead_tup, \
             last_vacuum::text, last_autovacuum::text, last_analyze::text, last_autoanalyze::text, \
             vacuum_count, autovacuum_count, analyze_count, autoanalyze_count \
             FROM pg_stat_user_tables ORDER BY schemaname, relname;"
        ).await?;

        let mut stats = Vec::new();
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            let c: Vec<&str> = line.splitn(20, '|').collect();
            if c.len() < 20 { continue; }
            stats.push(PgStatUserTable {
                schemaname: c[0].trim().to_string(),
                relname: c[1].trim().to_string(),
                seq_scan: c[2].trim().parse().unwrap_or(0),
                seq_tup_read: c[3].trim().parse().unwrap_or(0),
                idx_scan: c[4].trim().parse().ok(),
                idx_tup_fetch: c[5].trim().parse().ok(),
                n_tup_ins: c[6].trim().parse().unwrap_or(0),
                n_tup_upd: c[7].trim().parse().unwrap_or(0),
                n_tup_del: c[8].trim().parse().unwrap_or(0),
                n_tup_hot_upd: c[9].trim().parse().unwrap_or(0),
                n_live_tup: c[10].trim().parse().unwrap_or(0),
                n_dead_tup: c[11].trim().parse().unwrap_or(0),
                last_vacuum: non_empty(c[12]),
                last_autovacuum: non_empty(c[13]),
                last_analyze: non_empty(c[14]),
                last_autoanalyze: non_empty(c[15]),
                vacuum_count: c[16].trim().parse().unwrap_or(0),
                autovacuum_count: c[17].trim().parse().unwrap_or(0),
                analyze_count: c[18].trim().parse().unwrap_or(0),
                autoanalyze_count: c[19].trim().parse().unwrap_or(0),
            });
        }
        Ok(stats)
    }

    /// Get index statistics from pg_stat_user_indexes.
    pub async fn get_index_stats(client: &PgAdminClient, db: &str) -> PgAdminResult<Vec<PgStatUserIndex>> {
        let raw = client.exec_psql_db(db,
            "SELECT schemaname, relname, indexrelname, idx_scan, idx_tup_read, idx_tup_fetch, \
             pg_relation_size(indexrelid) as idx_size \
             FROM pg_stat_user_indexes ORDER BY schemaname, relname, indexrelname;"
        ).await?;

        let mut stats = Vec::new();
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            let c: Vec<&str> = line.splitn(7, '|').collect();
            if c.len() < 7 { continue; }
            stats.push(PgStatUserIndex {
                schemaname: c[0].trim().to_string(),
                relname: c[1].trim().to_string(),
                indexrelname: c[2].trim().to_string(),
                idx_scan: c[3].trim().parse().unwrap_or(0),
                idx_tup_read: c[4].trim().parse().unwrap_or(0),
                idx_tup_fetch: c[5].trim().parse().unwrap_or(0),
                idx_size: c[6].trim().parse().unwrap_or(0),
            });
        }
        Ok(stats)
    }

    /// Get IO statistics (PG16+ pg_stat_io).
    pub async fn get_io_stats(client: &PgAdminClient) -> PgAdminResult<Vec<PgStatIo>> {
        let raw = client.exec_psql(
            "SELECT backend_type, object, context, reads, read_time, writes, write_time, \
             writebacks, writeback_time, extends, extend_time, hits, evictions, reuses, \
             fsyncs, fsync_time, stats_reset::text \
             FROM pg_stat_io ORDER BY backend_type, object, context;"
        ).await?;

        let mut stats = Vec::new();
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            let c: Vec<&str> = line.splitn(17, '|').collect();
            if c.len() < 17 { continue; }
            stats.push(PgStatIo {
                backend_type: c[0].trim().to_string(),
                object: c[1].trim().to_string(),
                context: c[2].trim().to_string(),
                reads: c[3].trim().parse().unwrap_or(0),
                read_time: c[4].trim().parse().unwrap_or(0.0),
                writes: c[5].trim().parse().unwrap_or(0),
                write_time: c[6].trim().parse().unwrap_or(0.0),
                writebacks: c[7].trim().parse().unwrap_or(0),
                writeback_time: c[8].trim().parse().unwrap_or(0.0),
                extends: c[9].trim().parse().unwrap_or(0),
                extend_time: c[10].trim().parse().unwrap_or(0.0),
                hits: c[11].trim().parse().unwrap_or(0),
                evictions: c[12].trim().parse().unwrap_or(0),
                reuses: c[13].trim().parse().unwrap_or(0),
                fsyncs: c[14].trim().parse().unwrap_or(0),
                fsync_time: c[15].trim().parse().unwrap_or(0.0),
                stats_reset: non_empty(c[16]),
            });
        }
        Ok(stats)
    }

    /// Get query statistics from pg_stat_statements.
    pub async fn get_query_stats(client: &PgAdminClient, db: &str) -> PgAdminResult<Vec<PgQueryStats>> {
        let raw = client.exec_psql_db(db,
            "SELECT queryid::text, query, calls, total_exec_time, mean_exec_time, \
             min_exec_time, max_exec_time, rows, shared_blks_hit, shared_blks_read, \
             shared_blks_written, temp_blks_read, temp_blks_written \
             FROM pg_stat_statements \
             ORDER BY total_exec_time DESC LIMIT 100;"
        ).await?;

        let mut stats = Vec::new();
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            let c: Vec<&str> = line.splitn(13, '|').collect();
            if c.len() < 13 { continue; }
            stats.push(PgQueryStats {
                queryid: non_empty(c[0]),
                query: c[1].trim().to_string(),
                calls: c[2].trim().parse().unwrap_or(0),
                total_exec_time: c[3].trim().parse().unwrap_or(0.0),
                mean_exec_time: c[4].trim().parse().unwrap_or(0.0),
                min_exec_time: c[5].trim().parse().unwrap_or(0.0),
                max_exec_time: c[6].trim().parse().unwrap_or(0.0),
                rows: c[7].trim().parse().unwrap_or(0),
                shared_blks_hit: c[8].trim().parse().unwrap_or(0),
                shared_blks_read: c[9].trim().parse().unwrap_or(0),
                shared_blks_written: c[10].trim().parse().unwrap_or(0),
                temp_blks_read: c[11].trim().parse().unwrap_or(0),
                temp_blks_written: c[12].trim().parse().unwrap_or(0),
            });
        }
        Ok(stats)
    }

    /// Get buffer cache statistics (requires pg_buffercache).
    pub async fn get_buffer_cache_stats(client: &PgAdminClient) -> PgAdminResult<PgBufferCacheStats> {
        let raw = client.exec_psql(
            "SELECT count(*) FILTER (WHERE reldatabase IS NOT NULL) AS used, \
             count(*) FILTER (WHERE reldatabase IS NULL) AS unused, \
             count(*) FILTER (WHERE isdirty) AS dirty, \
             count(*) FILTER (WHERE pinning_backends > 0) AS pinned, \
             count(*) AS total \
             FROM pg_buffercache;"
        ).await?;

        let c: Vec<&str> = raw.trim().splitn(5, '|').collect();
        let used: i64 = c.first().and_then(|s| s.trim().parse().ok()).unwrap_or(0);
        let total: i64 = c.get(4).and_then(|s| s.trim().parse().ok()).unwrap_or(1);
        Ok(PgBufferCacheStats {
            buffers_used: used,
            buffers_unused: c.get(1).and_then(|s| s.trim().parse().ok()).unwrap_or(0),
            buffers_dirty: c.get(2).and_then(|s| s.trim().parse().ok()).unwrap_or(0),
            buffers_pinned: c.get(3).and_then(|s| s.trim().parse().ok()).unwrap_or(0),
            total_buffers: total,
            usage_percent: if total > 0 { (used as f64 / total as f64) * 100.0 } else { 0.0 },
        })
    }

    /// Get table bloat estimates.
    pub async fn get_table_bloat(client: &PgAdminClient, db: &str) -> PgAdminResult<Vec<TableBloatInfo>> {
        let raw = client.exec_psql_db(db,
            "SELECT schemaname, relname, \
             pg_total_relation_size(schemaname || '.' || relname) AS real_size, \
             COALESCE(n_dead_tup, 0) * avg_width AS bloat_size \
             FROM pg_stat_user_tables \
             JOIN (SELECT schemaname AS sn, relname AS rn, \
                   COALESCE(avg_width, 0) AS avg_width \
                   FROM pg_stats \
                   JOIN pg_stat_user_tables USING (schemaname) \
                   WHERE pg_stats.tablename = pg_stat_user_tables.relname \
                   GROUP BY sn, rn, avg_width) sub \
             ON schemaname = sub.sn AND relname = sub.rn \
             WHERE n_dead_tup > 0 ORDER BY bloat_size DESC LIMIT 50;"
        ).await.unwrap_or_default();

        let mut bloats = Vec::new();
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            let c: Vec<&str> = line.splitn(4, '|').collect();
            if c.len() < 4 { continue; }
            let real: i64 = c[2].trim().parse().unwrap_or(0);
            let bloat: i64 = c[3].trim().parse().unwrap_or(0);
            bloats.push(TableBloatInfo {
                schemaname: c[0].trim().to_string(),
                relname: c[1].trim().to_string(),
                real_size: real,
                bloat_size: bloat,
                bloat_ratio: if real > 0 { (bloat as f64 / real as f64) * 100.0 } else { 0.0 },
            });
        }
        Ok(bloats)
    }

    /// Get index bloat estimates.
    pub async fn get_index_bloat(client: &PgAdminClient, db: &str) -> PgAdminResult<Vec<IndexBloatInfo>> {
        let raw = client.exec_psql_db(db,
            "SELECT s.schemaname, s.relname, s.indexrelname, \
             pg_relation_size(s.indexrelid) AS real_size, \
             CASE WHEN s.idx_scan = 0 THEN pg_relation_size(s.indexrelid) ELSE 0 END AS bloat_size \
             FROM pg_stat_user_indexes s \
             ORDER BY pg_relation_size(s.indexrelid) DESC LIMIT 50;"
        ).await.unwrap_or_default();

        let mut bloats = Vec::new();
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            let c: Vec<&str> = line.splitn(5, '|').collect();
            if c.len() < 5 { continue; }
            let real: i64 = c[3].trim().parse().unwrap_or(0);
            let bloat: i64 = c[4].trim().parse().unwrap_or(0);
            bloats.push(IndexBloatInfo {
                schemaname: c[0].trim().to_string(),
                relname: c[1].trim().to_string(),
                indexrelname: c[2].trim().to_string(),
                real_size: real,
                bloat_size: bloat,
                bloat_ratio: if real > 0 { (bloat as f64 / real as f64) * 100.0 } else { 0.0 },
            });
        }
        Ok(bloats)
    }

    /// EXPLAIN a query.
    pub async fn explain_query(client: &PgAdminClient, db: &str, query: &str, analyze: bool) -> PgAdminResult<String> {
        let prefix = if analyze { "EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)" } else { "EXPLAIN (FORMAT TEXT)" };
        let raw = client.exec_psql_db(db, &format!("{} {}", prefix, query)).await?;
        Ok(raw)
    }

    /// Get long-running queries (> threshold seconds).
    pub async fn get_long_running_queries(client: &PgAdminClient, threshold_secs: i32) -> PgAdminResult<Vec<PgBackendProcess>> {
        let raw = client.exec_psql(&format!(
            "SELECT pid, usename, datname, application_name, client_addr, client_port, \
             backend_start::text, xact_start::text, query_start::text, state_change::text, \
             wait_event_type, wait_event, state, query, backend_type \
             FROM pg_stat_activity \
             WHERE state = 'active' AND query_start < now() - interval '{} seconds' \
             ORDER BY query_start;",
            threshold_secs
        )).await?;

        let mut backends = Vec::new();
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            let c: Vec<&str> = line.splitn(15, '|').collect();
            if c.len() < 15 { continue; }
            backends.push(PgBackendProcess {
                pid: c[0].trim().parse().unwrap_or(0),
                usename: non_empty(c[1]),
                datname: non_empty(c[2]),
                application_name: non_empty(c[3]),
                client_addr: non_empty(c[4]),
                client_port: c[5].trim().parse().ok(),
                backend_start: non_empty(c[6]),
                xact_start: non_empty(c[7]),
                query_start: non_empty(c[8]),
                state_change: non_empty(c[9]),
                wait_event_type: non_empty(c[10]),
                wait_event: non_empty(c[11]),
                state: non_empty(c[12]),
                query: non_empty(c[13]),
                backend_type: non_empty(c[14]),
            });
        }
        Ok(backends)
    }

    /// Get queries that are blocking other queries.
    pub async fn get_blocking_queries(client: &PgAdminClient) -> PgAdminResult<String> {
        let raw = client.exec_psql(
            "SELECT blocked_locks.pid AS blocked_pid, \
             blocked_activity.usename AS blocked_user, \
             blocking_locks.pid AS blocking_pid, \
             blocking_activity.usename AS blocking_user, \
             blocked_activity.query AS blocked_query, \
             blocking_activity.query AS blocking_query \
             FROM pg_catalog.pg_locks blocked_locks \
             JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid \
             JOIN pg_catalog.pg_locks blocking_locks ON blocking_locks.locktype = blocked_locks.locktype \
               AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database \
               AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation \
               AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page \
               AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple \
               AND blocking_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid \
               AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid \
               AND blocking_locks.classid IS NOT DISTINCT FROM blocked_locks.classid \
               AND blocking_locks.objid IS NOT DISTINCT FROM blocked_locks.objid \
               AND blocking_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid \
               AND blocking_locks.pid != blocked_locks.pid \
             JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid \
             WHERE NOT blocked_locks.granted;"
        ).await?;
        Ok(raw)
    }

    /// Get unused indexes (zero scans since last stats reset).
    pub async fn get_unused_indexes(client: &PgAdminClient, db: &str) -> PgAdminResult<Vec<PgStatUserIndex>> {
        let raw = client.exec_psql_db(db,
            "SELECT schemaname, relname, indexrelname, idx_scan, idx_tup_read, idx_tup_fetch, \
             pg_relation_size(indexrelid) AS idx_size \
             FROM pg_stat_user_indexes \
             WHERE idx_scan = 0 \
             ORDER BY pg_relation_size(indexrelid) DESC;"
        ).await?;

        let mut indexes = Vec::new();
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            let c: Vec<&str> = line.splitn(7, '|').collect();
            if c.len() < 7 { continue; }
            indexes.push(PgStatUserIndex {
                schemaname: c[0].trim().to_string(),
                relname: c[1].trim().to_string(),
                indexrelname: c[2].trim().to_string(),
                idx_scan: c[3].trim().parse().unwrap_or(0),
                idx_tup_read: c[4].trim().parse().unwrap_or(0),
                idx_tup_fetch: c[5].trim().parse().unwrap_or(0),
                idx_size: c[6].trim().parse().unwrap_or(0),
            });
        }
        Ok(indexes)
    }

    /// Get tables that might benefit from indexes (high seq scan, low/no idx scan).
    pub async fn get_missing_indexes(client: &PgAdminClient, db: &str) -> PgAdminResult<Vec<PgStatUserTable>> {
        let raw = client.exec_psql_db(db,
            "SELECT schemaname, relname, seq_scan, seq_tup_read, idx_scan, idx_tup_fetch, \
             n_tup_ins, n_tup_upd, n_tup_del, n_tup_hot_upd, n_live_tup, n_dead_tup, \
             last_vacuum::text, last_autovacuum::text, last_analyze::text, last_autoanalyze::text, \
             vacuum_count, autovacuum_count, analyze_count, autoanalyze_count \
             FROM pg_stat_user_tables \
             WHERE seq_scan > 100 AND COALESCE(idx_scan, 0) = 0 AND n_live_tup > 1000 \
             ORDER BY seq_scan DESC;"
        ).await?;

        let mut tables = Vec::new();
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            let c: Vec<&str> = line.splitn(20, '|').collect();
            if c.len() < 20 { continue; }
            tables.push(PgStatUserTable {
                schemaname: c[0].trim().to_string(),
                relname: c[1].trim().to_string(),
                seq_scan: c[2].trim().parse().unwrap_or(0),
                seq_tup_read: c[3].trim().parse().unwrap_or(0),
                idx_scan: c[4].trim().parse().ok(),
                idx_tup_fetch: c[5].trim().parse().ok(),
                n_tup_ins: c[6].trim().parse().unwrap_or(0),
                n_tup_upd: c[7].trim().parse().unwrap_or(0),
                n_tup_del: c[8].trim().parse().unwrap_or(0),
                n_tup_hot_upd: c[9].trim().parse().unwrap_or(0),
                n_live_tup: c[10].trim().parse().unwrap_or(0),
                n_dead_tup: c[11].trim().parse().unwrap_or(0),
                last_vacuum: non_empty(c[12]),
                last_autovacuum: non_empty(c[13]),
                last_analyze: non_empty(c[14]),
                last_autoanalyze: non_empty(c[15]),
                vacuum_count: c[16].trim().parse().unwrap_or(0),
                autovacuum_count: c[17].trim().parse().unwrap_or(0),
                analyze_count: c[18].trim().parse().unwrap_or(0),
                autoanalyze_count: c[19].trim().parse().unwrap_or(0),
            });
        }
        Ok(tables)
    }

    /// Get overall cache hit ratio.
    pub async fn get_cache_hit_ratio(client: &PgAdminClient) -> PgAdminResult<f64> {
        let raw = client.exec_psql(
            "SELECT CASE WHEN (sum(blks_hit) + sum(blks_read)) = 0 THEN 0 \
             ELSE round(sum(blks_hit)::numeric / (sum(blks_hit) + sum(blks_read)) * 100, 2) END \
             FROM pg_stat_database;"
        ).await?;
        raw.trim().parse().map_err(|_| crate::error::PgAdminError::parse("Failed to parse cache hit ratio"))
    }
}

fn non_empty(s: &str) -> Option<String> {
    let s = s.trim();
    if s.is_empty() { None } else { Some(s.to_string()) }
}
