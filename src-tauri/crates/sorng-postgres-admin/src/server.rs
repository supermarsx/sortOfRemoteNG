// ── sorng-postgres-admin – server management ─────────────────────────────────
//! Server-level status, configuration, process, and lock management.

use crate::client::PgAdminClient;
use crate::error::PgAdminResult;
use crate::types::*;

pub struct ServerManager;

impl ServerManager {
    /// Get comprehensive server status.
    pub async fn get_status(client: &PgAdminClient) -> PgAdminResult<PgServerStatus> {
        let version = client.exec_psql("SELECT version();").await?;
        let uptime = client.exec_psql("SELECT now() - pg_postmaster_start_time();").await?;
        let max_conn = client.exec_psql("SELECT setting FROM pg_settings WHERE name = 'max_connections';").await?;

        let conns = client.exec_psql(
            "SELECT count(*) FILTER (WHERE state = 'active'), \
             count(*) FILTER (WHERE state = 'idle'), \
             count(*) FILTER (WHERE wait_event IS NOT NULL AND state = 'active') \
             FROM pg_stat_activity;"
        ).await?;
        let parts: Vec<&str> = conns.trim().split('|').collect();

        let db_count = client.exec_psql("SELECT count(*) FROM pg_database WHERE datistemplate = false;").await?;
        let total_size = client.exec_psql("SELECT sum(pg_database_size(datname))::bigint FROM pg_database;").await?;

        let hit_ratio = client.exec_psql(
            "SELECT CASE WHEN (sum(blks_hit) + sum(blks_read)) = 0 THEN 0 \
             ELSE round(sum(blks_hit)::numeric / (sum(blks_hit) + sum(blks_read)) * 100, 2) END \
             FROM pg_stat_database;"
        ).await?;

        let commit_ratio = client.exec_psql(
            "SELECT CASE WHEN (sum(xact_commit) + sum(xact_rollback)) = 0 THEN 0 \
             ELSE round(sum(xact_commit)::numeric / (sum(xact_commit) + sum(xact_rollback)) * 100, 2) END \
             FROM pg_stat_database;"
        ).await?;

        let deadlocks = client.exec_psql("SELECT sum(deadlocks) FROM pg_stat_database;").await?;
        let checkpoints = client.exec_psql("SELECT checkpoints_timed + checkpoints_req FROM pg_stat_bgwriter;").await?;

        Ok(PgServerStatus {
            version: version.trim().to_string(),
            uptime: uptime.trim().to_string(),
            max_connections: max_conn.trim().parse().unwrap_or(0),
            active_connections: parts.first().and_then(|s| s.trim().parse().ok()).unwrap_or(0),
            idle_connections: parts.get(1).and_then(|s| s.trim().parse().ok()).unwrap_or(0),
            waiting_connections: parts.get(2).and_then(|s| s.trim().parse().ok()).unwrap_or(0),
            databases: db_count.trim().parse().unwrap_or(0),
            total_size_bytes: total_size.trim().parse().unwrap_or(0),
            cache_hit_ratio: hit_ratio.trim().parse().unwrap_or(0.0),
            commit_ratio: commit_ratio.trim().parse().unwrap_or(0.0),
            deadlocks: deadlocks.trim().parse().unwrap_or(0),
            checkpoints: checkpoints.trim().parse().unwrap_or(0),
            bgwriter_stats: None,
        })
    }

    /// List all pg_settings.
    pub async fn list_settings(client: &PgAdminClient) -> PgAdminResult<Vec<PgSetting>> {
        let raw = client.exec_psql(
            "SELECT name, setting, unit, category, short_desc, context, vartype, source, \
             min_val, max_val, boot_val, reset_val, pending_restart \
             FROM pg_settings ORDER BY name;"
        ).await?;

        let mut settings = Vec::new();
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            let cols: Vec<&str> = line.splitn(13, '|').collect();
            if cols.len() < 13 { continue; }
            settings.push(PgSetting {
                name: cols[0].to_string(),
                setting: cols[1].to_string(),
                unit: non_empty(cols[2]),
                category: cols[3].to_string(),
                short_desc: cols[4].to_string(),
                context: cols[5].to_string(),
                vartype: cols[6].to_string(),
                source: cols[7].to_string(),
                min_val: non_empty(cols[8]),
                max_val: non_empty(cols[9]),
                boot_val: non_empty(cols[10]),
                reset_val: non_empty(cols[11]),
                pending_restart: cols[12].trim() == "t",
            });
        }
        Ok(settings)
    }

    /// Get a single setting by name.
    pub async fn get_setting(client: &PgAdminClient, name: &str) -> PgAdminResult<PgSetting> {
        let raw = client.exec_psql(&format!(
            "SELECT name, setting, unit, category, short_desc, context, vartype, source, \
             min_val, max_val, boot_val, reset_val, pending_restart \
             FROM pg_settings WHERE name = '{}';",
            name.replace('\'', "''")
        )).await?;

        let line = raw.trim();
        let cols: Vec<&str> = line.splitn(13, '|').collect();
        if cols.len() < 13 {
            return Err(crate::error::PgAdminError::config(format!("Setting not found: {name}")));
        }
        Ok(PgSetting {
            name: cols[0].to_string(),
            setting: cols[1].to_string(),
            unit: non_empty(cols[2]),
            category: cols[3].to_string(),
            short_desc: cols[4].to_string(),
            context: cols[5].to_string(),
            vartype: cols[6].to_string(),
            source: cols[7].to_string(),
            min_val: non_empty(cols[8]),
            max_val: non_empty(cols[9]),
            boot_val: non_empty(cols[10]),
            reset_val: non_empty(cols[11]),
            pending_restart: cols[12].trim() == "t",
        })
    }

    /// Set a configuration value via ALTER SYSTEM.
    pub async fn set_setting(client: &PgAdminClient, name: &str, value: &str) -> PgAdminResult<()> {
        client.exec_psql(&format!(
            "ALTER SYSTEM SET {} = '{}';",
            name.replace('\'', "''"),
            value.replace('\'', "''")
        )).await?;
        Ok(())
    }

    /// Reload server configuration.
    pub async fn reload_config(client: &PgAdminClient) -> PgAdminResult<()> {
        client.exec_psql("SELECT pg_reload_conf();").await?;
        Ok(())
    }

    /// List all backend processes.
    pub async fn list_backends(client: &PgAdminClient) -> PgAdminResult<Vec<PgBackendProcess>> {
        let raw = client.exec_psql(
            "SELECT pid, usename, datname, application_name, client_addr, client_port, \
             backend_start, xact_start, query_start, state_change, \
             wait_event_type, wait_event, state, query, backend_type \
             FROM pg_stat_activity ORDER BY pid;"
        ).await?;

        let mut backends = Vec::new();
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            let cols: Vec<&str> = line.splitn(15, '|').collect();
            if cols.len() < 15 { continue; }
            backends.push(PgBackendProcess {
                pid: cols[0].trim().parse().unwrap_or(0),
                usename: non_empty(cols[1]),
                datname: non_empty(cols[2]),
                application_name: non_empty(cols[3]),
                client_addr: non_empty(cols[4]),
                client_port: cols[5].trim().parse().ok(),
                backend_start: non_empty(cols[6]),
                xact_start: non_empty(cols[7]),
                query_start: non_empty(cols[8]),
                state_change: non_empty(cols[9]),
                wait_event_type: non_empty(cols[10]),
                wait_event: non_empty(cols[11]),
                state: non_empty(cols[12]),
                query: non_empty(cols[13]),
                backend_type: non_empty(cols[14]),
            });
        }
        Ok(backends)
    }

    /// Terminate a backend process by PID.
    pub async fn terminate_backend(client: &PgAdminClient, pid: i32) -> PgAdminResult<bool> {
        let raw = client.exec_psql(&format!("SELECT pg_terminate_backend({pid});")).await?;
        Ok(raw.trim() == "t")
    }

    /// Cancel a running query by PID.
    pub async fn cancel_backend(client: &PgAdminClient, pid: i32) -> PgAdminResult<bool> {
        let raw = client.exec_psql(&format!("SELECT pg_cancel_backend({pid});")).await?;
        Ok(raw.trim() == "t")
    }

    /// List all locks.
    pub async fn list_locks(client: &PgAdminClient) -> PgAdminResult<Vec<PgLock>> {
        let raw = client.exec_psql(
            "SELECT locktype, d.datname, c.relname, l.page, l.tuple, \
             l.virtualxid, l.transactionid::text, l.classid::text, l.objid::text, l.objsubid, \
             l.virtualtransaction, l.pid, l.mode, l.granted, l.fastpath \
             FROM pg_locks l \
             LEFT JOIN pg_database d ON d.oid = l.database \
             LEFT JOIN pg_class c ON c.oid = l.relation \
             ORDER BY l.pid;"
        ).await?;

        let mut locks = Vec::new();
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            let cols: Vec<&str> = line.splitn(15, '|').collect();
            if cols.len() < 15 { continue; }
            locks.push(PgLock {
                locktype: cols[0].to_string(),
                database: non_empty(cols[1]),
                relation: non_empty(cols[2]),
                page: cols[3].trim().parse().ok(),
                tuple: cols[4].trim().parse().ok(),
                virtualxid: non_empty(cols[5]),
                transactionid: non_empty(cols[6]),
                classid: non_empty(cols[7]),
                objid: non_empty(cols[8]),
                objsubid: cols[9].trim().parse().ok(),
                virtualtransaction: non_empty(cols[10]),
                pid: cols[11].trim().parse().ok(),
                mode: cols[12].to_string(),
                granted: cols[13].trim() == "t",
                fastpath: cols[14].trim() == "t",
            });
        }
        Ok(locks)
    }

    /// Get connection statistics summary.
    pub async fn get_connection_stats(client: &PgAdminClient) -> PgAdminResult<String> {
        let raw = client.exec_psql(
            "SELECT state, count(*) FROM pg_stat_activity GROUP BY state ORDER BY state;"
        ).await?;
        Ok(raw.trim().to_string())
    }

    /// Get checkpoint statistics from pg_stat_bgwriter.
    pub async fn get_checkpoint_stats(client: &PgAdminClient) -> PgAdminResult<String> {
        let raw = client.exec_psql(
            "SELECT checkpoints_timed, checkpoints_req, checkpoint_write_time, \
             checkpoint_sync_time, buffers_checkpoint, buffers_clean, \
             maxwritten_clean, buffers_backend, buffers_backend_fsync, \
             buffers_alloc, stats_reset \
             FROM pg_stat_bgwriter;"
        ).await?;
        Ok(raw.trim().to_string())
    }

    /// Reset statistics.
    pub async fn pg_stat_reset(client: &PgAdminClient) -> PgAdminResult<()> {
        client.exec_psql("SELECT pg_stat_reset();").await?;
        Ok(())
    }
}

fn non_empty(s: &str) -> Option<String> {
    let s = s.trim();
    if s.is_empty() { None } else { Some(s.to_string()) }
}
