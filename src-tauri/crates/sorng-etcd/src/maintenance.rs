// ── sorng-etcd/src/maintenance.rs ────────────────────────────────────────────
//! Maintenance operations via the etcd v3 gRPC-gateway.

use crate::client::EtcdClient;
use crate::error::EtcdResult;
use crate::types::*;
use serde::{Deserialize, Serialize};

// ── Wire types ───────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct AlarmListResponseWire {
    #[serde(default)]
    alarms: Vec<AlarmWire>,
}

#[derive(Debug, Deserialize)]
struct AlarmWire {
    #[serde(rename = "memberID", default)]
    member_id: Option<String>,
    #[serde(default)]
    alarm: Option<String>,
}

#[derive(Debug, Serialize)]
struct AlarmRequest {
    action: String,
    #[serde(rename = "memberID")]
    member_id: u64,
    alarm: String,
}

#[derive(Debug, Serialize)]
struct MoveLeaderRequest {
    #[serde(rename = "targetID")]
    target_id: u64,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn parse_u64(s: &Option<String>) -> u64 {
    s.as_deref()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0)
}

// ── Public API ───────────────────────────────────────────────────────────────

pub struct MaintenanceManager;

impl MaintenanceManager {
    /// List all active alarms.
    pub async fn alarm_list(client: &EtcdClient) -> EtcdResult<Vec<EtcdAlarm>> {
        let req = serde_json::json!({ "action": "GET", "memberID": 0, "alarm": "NONE" });
        let resp: AlarmListResponseWire =
            client.post_json("/v3/maintenance/alarm", &req).await?;
        Ok(resp
            .alarms
            .iter()
            .map(|a| EtcdAlarm {
                member_id: parse_u64(&a.member_id),
                alarm: a.alarm.clone().unwrap_or_default(),
            })
            .collect())
    }

    /// Disarm an alarm on a specific member.
    pub async fn alarm_disarm(
        client: &EtcdClient,
        member_id: u64,
        alarm: &str,
    ) -> EtcdResult<()> {
        let req = AlarmRequest {
            action: "DEACTIVATE".to_string(),
            member_id,
            alarm: alarm.to_string(),
        };
        let _: serde_json::Value =
            client.post_json("/v3/maintenance/alarm", &req).await?;
        Ok(())
    }

    /// Defragment a specific endpoint.
    pub async fn defragment(
        client: &EtcdClient,
        endpoint: &str,
    ) -> EtcdResult<EtcdDefragResult> {
        // The gRPC-gateway defrag endpoint works on the connected node.
        // For remote endpoints, a dedicated client would be needed.
        let result: Result<serde_json::Value, _> =
            client.post_empty("/v3/maintenance/defragment").await;
        match result {
            Ok(_) => Ok(EtcdDefragResult {
                endpoint: endpoint.to_string(),
                success: true,
                message: "Defragmentation completed".to_string(),
            }),
            Err(e) => Ok(EtcdDefragResult {
                endpoint: endpoint.to_string(),
                success: false,
                message: e.to_string(),
            }),
        }
    }

    /// Get cluster status.
    pub async fn status(client: &EtcdClient) -> EtcdResult<EtcdStatusResponse> {
        client.get_status().await
    }

    /// Get snapshot metadata from the current status.
    pub async fn snapshot_info(client: &EtcdClient) -> EtcdResult<EtcdSnapshotInfo> {
        let status = client.get_status().await?;
        Ok(EtcdSnapshotInfo {
            db_size: status.db_size,
            revision: status.raft_index as i64,
            member_id: status.leader,
        })
    }

    /// Transfer leadership to a target member.
    pub async fn move_leader(
        client: &EtcdClient,
        target_id: u64,
    ) -> EtcdResult<()> {
        let req = MoveLeaderRequest { target_id };
        let _: serde_json::Value =
            client.post_json("/v3/maintenance/transfer-leadership", &req).await?;
        Ok(())
    }
}
