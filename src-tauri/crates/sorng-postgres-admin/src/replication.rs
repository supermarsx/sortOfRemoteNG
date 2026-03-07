// ── sorng-postgres-admin – replication management ────────────────────────────
//! WAL, replication slots, standbys, publications, and subscriptions.

use crate::client::PgAdminClient;
use crate::error::{PgAdminError, PgAdminResult};
use crate::types::*;

pub struct ReplicationManager;

impl ReplicationManager {
    /// Get WAL status including archive info.
    pub async fn get_wal_status(client: &PgAdminClient) -> PgAdminResult<PgWalStatus> {
        let lsn = client.exec_psql("SELECT pg_current_wal_lsn()::text;").await.ok();
        let timeline = client.exec_psql("SELECT timeline_id FROM pg_control_checkpoint();").await.ok();
        let wal_level = client.exec_psql("SELECT setting FROM pg_settings WHERE name = 'wal_level';").await.ok();
        let archive_mode = client.exec_psql("SELECT setting FROM pg_settings WHERE name = 'archive_mode';").await.ok();
        let archive_cmd = client.exec_psql("SELECT setting FROM pg_settings WHERE name = 'archive_command';").await.ok();
        let archive_lib = client.exec_psql("SELECT setting FROM pg_settings WHERE name = 'archive_library';").await.ok();

        let archiver = client.exec_psql(
            "SELECT last_archived_wal, last_archived_time::text, \
             last_failed_wal, last_failed_time::text, stats_reset::text \
             FROM pg_stat_archiver;"
        ).await.unwrap_or_default();
        let ac: Vec<&str> = archiver.trim().splitn(5, '|').collect();

        Ok(PgWalStatus {
            current_lsn: lsn.map(|s| s.trim().to_string()),
            current_timeline: timeline.and_then(|s| s.trim().parse().ok()),
            wal_level: wal_level.map(|s| s.trim().to_string()),
            archive_mode: archive_mode.map(|s| s.trim().to_string()),
            archive_command: archive_cmd.map(|s| s.trim().to_string()),
            archive_library: archive_lib.map(|s| s.trim().to_string()),
            last_archived_wal: ac.first().and_then(|s| non_empty(s)),
            last_archived_time: ac.get(1).and_then(|s| non_empty(s)),
            last_failed_wal: ac.get(2).and_then(|s| non_empty(s)),
            last_failed_time: ac.get(3).and_then(|s| non_empty(s)),
            stats_reset: ac.get(4).and_then(|s| non_empty(s)),
        })
    }

    /// List replication slots.
    pub async fn list_replication_slots(client: &PgAdminClient) -> PgAdminResult<Vec<PgReplicationSlot>> {
        let raw = client.exec_psql(
            "SELECT slot_name, plugin, slot_type, datoid, \
             (SELECT datname FROM pg_database WHERE oid = datoid), \
             temporary, active, active_pid, xmin::text, catalog_xmin::text, \
             restart_lsn::text, confirmed_flush_lsn::text, wal_status, safe_wal_size \
             FROM pg_replication_slots ORDER BY slot_name;"
        ).await?;

        let mut slots = Vec::new();
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            let c: Vec<&str> = line.splitn(14, '|').collect();
            if c.len() < 14 { continue; }
            slots.push(PgReplicationSlot {
                slot_name: c[0].trim().to_string(),
                plugin: non_empty(c[1]),
                slot_type: c[2].trim().to_string(),
                datoid: c[3].trim().parse().ok(),
                database: non_empty(c[4]),
                temporary: c[5].trim() == "t",
                active: c[6].trim() == "t",
                active_pid: c[7].trim().parse().ok(),
                xmin: non_empty(c[8]),
                catalog_xmin: non_empty(c[9]),
                restart_lsn: non_empty(c[10]),
                confirmed_flush_lsn: non_empty(c[11]),
                wal_status: non_empty(c[12]),
                safe_wal_size: c[13].trim().parse().ok(),
            });
        }
        Ok(slots)
    }

    /// Create a replication slot.
    pub async fn create_replication_slot(client: &PgAdminClient, req: &CreateReplicationSlotRequest) -> PgAdminResult<PgReplicationSlot> {
        let temporary = if req.temporary.unwrap_or(false) { " TEMPORARY" } else { "" };
        if req.slot_type == "logical" {
            let plugin = req.plugin.as_deref().unwrap_or("pgoutput");
            client.exec_psql(&format!(
                "SELECT pg_create_logical_replication_slot('{}', '{}'{});",
                req.slot_name.replace('\'', "''"), plugin, temporary
            )).await?;
        } else {
            client.exec_psql(&format!(
                "SELECT pg_create_physical_replication_slot('{}'{});",
                req.slot_name.replace('\'', "''"), temporary
            )).await?;
        }

        Self::list_replication_slots(client).await?
            .into_iter()
            .find(|s| s.slot_name == req.slot_name)
            .ok_or_else(|| PgAdminError::replication("Failed to find created slot"))
    }

    /// Drop a replication slot.
    pub async fn drop_replication_slot(client: &PgAdminClient, name: &str) -> PgAdminResult<()> {
        client.exec_psql(&format!(
            "SELECT pg_drop_replication_slot('{}');",
            name.replace('\'', "''")
        )).await?;
        Ok(())
    }

    /// List streaming standbys.
    pub async fn list_standbys(client: &PgAdminClient) -> PgAdminResult<Vec<PgStandbyInfo>> {
        let raw = client.exec_psql(
            "SELECT pid, usesysid, usename, application_name, client_addr, client_hostname, \
             client_port, backend_start::text, state, sent_lsn::text, write_lsn::text, \
             flush_lsn::text, replay_lsn::text, write_lag::text, flush_lag::text, \
             replay_lag::text, sync_priority, sync_state \
             FROM pg_stat_replication ORDER BY pid;"
        ).await?;

        let mut standbys = Vec::new();
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            let c: Vec<&str> = line.splitn(18, '|').collect();
            if c.len() < 18 { continue; }
            standbys.push(PgStandbyInfo {
                pid: c[0].trim().parse().unwrap_or(0),
                usesysid: c[1].trim().parse().ok(),
                usename: non_empty(c[2]),
                application_name: non_empty(c[3]),
                client_addr: non_empty(c[4]),
                client_hostname: non_empty(c[5]),
                client_port: c[6].trim().parse().ok(),
                backend_start: non_empty(c[7]),
                state: non_empty(c[8]),
                sent_lsn: non_empty(c[9]),
                write_lsn: non_empty(c[10]),
                flush_lsn: non_empty(c[11]),
                replay_lsn: non_empty(c[12]),
                write_lag: non_empty(c[13]),
                flush_lag: non_empty(c[14]),
                replay_lag: non_empty(c[15]),
                sync_priority: c[16].trim().parse().ok(),
                sync_state: non_empty(c[17]),
            });
        }
        Ok(standbys)
    }

    /// Promote standby to primary.
    pub async fn promote_standby(client: &PgAdminClient) -> PgAdminResult<()> {
        client.exec_psql("SELECT pg_promote();").await?;
        Ok(())
    }

    /// Get replication lag in bytes from standby perspective.
    pub async fn get_replication_lag(client: &PgAdminClient) -> PgAdminResult<String> {
        let raw = client.exec_psql(
            "SELECT CASE WHEN pg_is_in_recovery() THEN \
             pg_wal_lsn_diff(pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn())::text \
             ELSE '0' END;"
        ).await?;
        Ok(raw.trim().to_string())
    }

    /// List publications.
    pub async fn list_publications(client: &PgAdminClient) -> PgAdminResult<Vec<PgPublicationInfo>> {
        let raw = client.exec_psql(
            "SELECT pubname, pg_get_userbyid(pubowner) as pubowner, \
             puballtables, pubinsert, pubupdate, pubdelete, pubtruncate, pubviaroot \
             FROM pg_publication ORDER BY pubname;"
        ).await?;

        let mut pubs = Vec::new();
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            let c: Vec<&str> = line.splitn(8, '|').collect();
            if c.len() < 8 { continue; }
            pubs.push(PgPublicationInfo {
                pubname: c[0].trim().to_string(),
                pubowner: c[1].trim().to_string(),
                puballtables: c[2].trim() == "t",
                pubinsert: c[3].trim() == "t",
                pubupdate: c[4].trim() == "t",
                pubdelete: c[5].trim() == "t",
                pubtruncate: c[6].trim() == "t",
                pubviaroot: c[7].trim() == "t",
            });
        }
        Ok(pubs)
    }

    /// Create a publication.
    pub async fn create_publication(client: &PgAdminClient, name: &str, for_all_tables: bool, tables: Option<&[String]>) -> PgAdminResult<()> {
        let target = if for_all_tables {
            "FOR ALL TABLES".to_string()
        } else if let Some(tbls) = tables {
            format!("FOR TABLE {}", tbls.iter().map(|t| format!("\"{}\"", t)).collect::<Vec<_>>().join(", "))
        } else {
            String::new()
        };
        client.exec_psql(&format!("CREATE PUBLICATION \"{}\" {};", name, target)).await?;
        Ok(())
    }

    /// Drop a publication.
    pub async fn drop_publication(client: &PgAdminClient, name: &str) -> PgAdminResult<()> {
        client.exec_psql(&format!("DROP PUBLICATION \"{}\";", name)).await?;
        Ok(())
    }

    /// List subscriptions.
    pub async fn list_subscriptions(client: &PgAdminClient) -> PgAdminResult<Vec<PgSubscriptionInfo>> {
        let raw = client.exec_psql(
            "SELECT subname, pg_get_userbyid(subowner), subenabled, subconninfo, \
             subslotname, subsynccommit, \
             array_to_string(subpublications, ',') \
             FROM pg_subscription ORDER BY subname;"
        ).await?;

        let mut subs = Vec::new();
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            let c: Vec<&str> = line.splitn(7, '|').collect();
            if c.len() < 7 { continue; }
            subs.push(PgSubscriptionInfo {
                subname: c[0].trim().to_string(),
                subowner: c[1].trim().to_string(),
                subenabled: c[2].trim() == "t",
                subconninfo: c[3].trim().to_string(),
                subslotname: non_empty(c[4]),
                subsynccommit: c[5].trim().to_string(),
                subpublications: c[6].trim().split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect(),
            });
        }
        Ok(subs)
    }

    /// Create a subscription.
    pub async fn create_subscription(client: &PgAdminClient, name: &str, conninfo: &str, publications: &[String]) -> PgAdminResult<()> {
        let pubs = publications.iter().map(|p| format!("'{}'", p.replace('\'', "''"))).collect::<Vec<_>>().join(", ");
        client.exec_psql(&format!(
            "CREATE SUBSCRIPTION \"{}\" CONNECTION '{}' PUBLICATION {};",
            name, conninfo.replace('\'', "''"), pubs
        )).await?;
        Ok(())
    }

    /// Drop a subscription.
    pub async fn drop_subscription(client: &PgAdminClient, name: &str) -> PgAdminResult<()> {
        client.exec_psql(&format!("DROP SUBSCRIPTION \"{}\";", name)).await?;
        Ok(())
    }

    /// Enable a subscription.
    pub async fn enable_subscription(client: &PgAdminClient, name: &str) -> PgAdminResult<()> {
        client.exec_psql(&format!("ALTER SUBSCRIPTION \"{}\" ENABLE;", name)).await?;
        Ok(())
    }

    /// Disable a subscription.
    pub async fn disable_subscription(client: &PgAdminClient, name: &str) -> PgAdminResult<()> {
        client.exec_psql(&format!("ALTER SUBSCRIPTION \"{}\" DISABLE;", name)).await?;
        Ok(())
    }
}

fn non_empty(s: &str) -> Option<String> {
    let s = s.trim();
    if s.is_empty() { None } else { Some(s.to_string()) }
}
