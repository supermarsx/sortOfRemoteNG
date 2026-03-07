// ── sorng-postgres-admin/src/replication.rs ───────────────────────────────────
//! PostgreSQL replication monitoring and slot management.

use crate::client::PgClient;
use crate::error::PgResult;
use crate::types::{PgReplicationSlot, PgReplicationStat};

pub struct ReplicationManager;

impl ReplicationManager {
    /// Get replication status from pg_stat_replication.
    pub async fn get_status(client: &PgClient) -> PgResult<Vec<PgReplicationStat>> {
        let sql = r#"
            SELECT pid, usename, application_name,
                   COALESCE(client_addr::text, ''),
                   state,
                   COALESCE(sent_lsn::text, ''),
                   COALESCE(write_lsn::text, ''),
                   COALESCE(flush_lsn::text, ''),
                   COALESCE(replay_lsn::text, ''),
                   COALESCE(write_lag::text, ''),
                   COALESCE(flush_lag::text, ''),
                   COALESCE(replay_lag::text, ''),
                   sync_state
            FROM pg_stat_replication
            ORDER BY application_name
        "#;
        let out = client.exec_sql(sql).await?;
        let mut stats = Vec::new();
        for line in out.lines().filter(|l| !l.is_empty()) {
            let cols: Vec<&str> = line.splitn(13, '|').collect();
            if cols.len() >= 13 {
                stats.push(PgReplicationStat {
                    pid: cols[0].trim().parse().unwrap_or(0),
                    usename: cols[1].to_string(),
                    application_name: cols[2].to_string(),
                    client_addr: if cols[3].is_empty() { None } else { Some(cols[3].to_string()) },
                    state: cols[4].to_string(),
                    sent_lsn: if cols[5].is_empty() { None } else { Some(cols[5].to_string()) },
                    write_lsn: if cols[6].is_empty() { None } else { Some(cols[6].to_string()) },
                    flush_lsn: if cols[7].is_empty() { None } else { Some(cols[7].to_string()) },
                    replay_lsn: if cols[8].is_empty() { None } else { Some(cols[8].to_string()) },
                    write_lag: if cols[9].is_empty() { None } else { Some(cols[9].to_string()) },
                    flush_lag: if cols[10].is_empty() { None } else { Some(cols[10].to_string()) },
                    replay_lag: if cols[11].is_empty() { None } else { Some(cols[11].to_string()) },
                    sync_state: cols[12].to_string(),
                });
            }
        }
        Ok(stats)
    }

    /// List all replication slots.
    pub async fn list_slots(client: &PgClient) -> PgResult<Vec<PgReplicationSlot>> {
        let sql = r#"
            SELECT slot_name, COALESCE(plugin, ''), slot_type,
                   COALESCE(datoid::text, ''), COALESCE(database, ''),
                   temporary, active,
                   COALESCE(active_pid::text, ''),
                   COALESCE(xmin::text, ''),
                   COALESCE(catalog_xmin::text, ''),
                   COALESCE(restart_lsn::text, ''),
                   COALESCE(confirmed_flush_lsn::text, '')
            FROM pg_replication_slots
            ORDER BY slot_name
        "#;
        let out = client.exec_sql(sql).await?;
        let mut slots = Vec::new();
        for line in out.lines().filter(|l| !l.is_empty()) {
            let cols: Vec<&str> = line.splitn(12, '|').collect();
            if cols.len() >= 12 {
                slots.push(PgReplicationSlot {
                    slot_name: cols[0].to_string(),
                    plugin: if cols[1].is_empty() { None } else { Some(cols[1].to_string()) },
                    slot_type: cols[2].to_string(),
                    datoid: if cols[3].is_empty() { None } else { Some(cols[3].to_string()) },
                    database: if cols[4].is_empty() { None } else { Some(cols[4].to_string()) },
                    temporary: cols[5] == "t",
                    active: cols[6] == "t",
                    active_pid: cols[7].trim().parse().ok(),
                    xmin: if cols[8].is_empty() { None } else { Some(cols[8].to_string()) },
                    catalog_xmin: if cols[9].is_empty() { None } else { Some(cols[9].to_string()) },
                    restart_lsn: if cols[10].is_empty() { None } else { Some(cols[10].to_string()) },
                    confirmed_flush_lsn: if cols[11].is_empty() { None } else { Some(cols[11].to_string()) },
                });
            }
        }
        Ok(slots)
    }

    /// Create a physical replication slot.
    pub async fn create_physical_slot(client: &PgClient, name: &str) -> PgResult<()> {
        let sql = format!(
            "SELECT pg_create_physical_replication_slot('{}')",
            name.replace('\'', "''")
        );
        client.exec_sql(&sql).await?;
        Ok(())
    }

    /// Create a logical replication slot.
    pub async fn create_logical_slot(client: &PgClient, name: &str, plugin: &str) -> PgResult<()> {
        let sql = format!(
            "SELECT pg_create_logical_replication_slot('{}', '{}')",
            name.replace('\'', "''"),
            plugin.replace('\'', "''")
        );
        client.exec_sql(&sql).await?;
        Ok(())
    }

    /// Create a replication slot (dispatches to physical or logical).
    pub async fn create_slot(client: &PgClient, name: &str, plugin: Option<&str>) -> PgResult<()> {
        match plugin {
            Some(p) => Self::create_logical_slot(client, name, p).await,
            None => Self::create_physical_slot(client, name).await,
        }
    }

    /// Drop a replication slot.
    pub async fn drop_slot(client: &PgClient, name: &str) -> PgResult<()> {
        let sql = format!(
            "SELECT pg_drop_replication_slot('{}')",
            name.replace('\'', "''")
        );
        client.exec_sql(&sql).await?;
        Ok(())
    }

    /// Get WAL receiver status (on standby servers).
    pub async fn get_wal_receiver_status(client: &PgClient) -> PgResult<String> {
        let sql = r#"
            SELECT pid, status, receive_start_lsn::text,
                   receive_start_tli, received_lsn::text,
                   received_tli, last_msg_send_time::text,
                   last_msg_receipt_time::text, sender_host, sender_port
            FROM pg_stat_wal_receiver
        "#;
        client.exec_sql(sql).await
    }

    /// Promote a standby to primary.
    pub async fn promote_standby(client: &PgClient) -> PgResult<()> {
        client.exec_sql("SELECT pg_promote()").await?;
        Ok(())
    }

    /// Get current replication lag as human-readable string.
    pub async fn get_lag(client: &PgClient) -> PgResult<String> {
        let sql = r#"
            SELECT CASE
              WHEN pg_is_in_recovery() THEN
                COALESCE(now() - pg_last_xact_replay_timestamp(), interval '0')::text
              ELSE 'not a standby'
            END
        "#;
        let out = client.exec_sql(sql).await?;
        Ok(out.trim().to_string())
    }
}
