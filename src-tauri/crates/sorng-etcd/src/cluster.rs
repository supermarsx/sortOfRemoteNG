// ── sorng-etcd/src/cluster.rs ────────────────────────────────────────────────
//! Cluster membership management via the etcd v3 gRPC-gateway.

use crate::client::EtcdClient;
use crate::error::EtcdResult;
use crate::types::*;
use serde::{Deserialize, Serialize};

// ── Wire types ───────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct MemberListResponseWire {
    #[serde(default)]
    members: Vec<MemberWire>,
}

#[derive(Debug, Deserialize)]
struct MemberWire {
    #[serde(rename = "ID", default)]
    id: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(rename = "peerURLs", default)]
    peer_urls: Option<Vec<String>>,
    #[serde(rename = "clientURLs", default)]
    client_urls: Option<Vec<String>>,
    #[serde(rename = "isLearner", default)]
    is_learner: Option<bool>,
}

#[derive(Debug, Serialize)]
struct MemberAddRequest {
    #[serde(rename = "peerURLs")]
    peer_urls: Vec<String>,
    #[serde(rename = "isLearner", skip_serializing_if = "Option::is_none")]
    is_learner: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct MemberAddResponseWire {
    member: Option<MemberWire>,
}

#[derive(Debug, Serialize)]
struct MemberRemoveRequest {
    #[serde(rename = "ID")]
    id: u64,
}

#[derive(Debug, Serialize)]
struct MemberUpdateRequest {
    #[serde(rename = "ID")]
    id: u64,
    #[serde(rename = "peerURLs")]
    peer_urls: Vec<String>,
}

#[derive(Debug, Serialize)]
struct MemberPromoteRequest {
    #[serde(rename = "ID")]
    id: u64,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn parse_u64(s: &Option<String>) -> u64 {
    s.as_deref()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0)
}

fn wire_to_member(w: &MemberWire) -> EtcdMember {
    EtcdMember {
        id: parse_u64(&w.id),
        name: w.name.clone().unwrap_or_default(),
        peer_urls: w.peer_urls.clone().unwrap_or_default(),
        client_urls: w.client_urls.clone().unwrap_or_default(),
        is_learner: w.is_learner.unwrap_or(false),
        status: None,
    }
}

// ── Public API ───────────────────────────────────────────────────────────────

pub struct ClusterManager;

impl ClusterManager {
    /// List all cluster members.
    pub async fn member_list(client: &EtcdClient) -> EtcdResult<Vec<EtcdMember>> {
        let resp: MemberListResponseWire =
            client.post_empty("/v3/cluster/member/list").await?;
        Ok(resp.members.iter().map(wire_to_member).collect())
    }

    /// Add a new member (optionally as learner).
    pub async fn member_add(
        client: &EtcdClient,
        peer_urls: Vec<String>,
        is_learner: Option<bool>,
    ) -> EtcdResult<EtcdMember> {
        let req = MemberAddRequest {
            peer_urls,
            is_learner,
        };
        let resp: MemberAddResponseWire =
            client.post_json("/v3/cluster/member/add", &req).await?;
        let member = resp
            .member
            .as_ref()
            .map(wire_to_member)
            .unwrap_or_else(|| EtcdMember {
                id: 0,
                name: String::new(),
                peer_urls: Vec::new(),
                client_urls: Vec::new(),
                is_learner: false,
                status: None,
            });
        Ok(member)
    }

    /// Remove a member from the cluster.
    pub async fn member_remove(client: &EtcdClient, id: u64) -> EtcdResult<()> {
        let req = MemberRemoveRequest { id };
        let _: serde_json::Value =
            client.post_json("/v3/cluster/member/remove", &req).await?;
        Ok(())
    }

    /// Update a member's peer URLs.
    pub async fn member_update(
        client: &EtcdClient,
        id: u64,
        peer_urls: Vec<String>,
    ) -> EtcdResult<()> {
        let req = MemberUpdateRequest { id, peer_urls };
        let _: serde_json::Value =
            client.post_json("/v3/cluster/member/update", &req).await?;
        Ok(())
    }

    /// Promote a learner member to a voting member.
    pub async fn member_promote(client: &EtcdClient, id: u64) -> EtcdResult<()> {
        let req = MemberPromoteRequest { id };
        let _: serde_json::Value =
            client.post_json("/v3/cluster/member/promote", &req).await?;
        Ok(())
    }

    /// Check cluster health by querying each known endpoint.
    pub async fn cluster_health(client: &EtcdClient) -> EtcdResult<EtcdClusterHealth> {
        let members = Self::member_list(client).await?;
        let mut checks = Vec::new();
        let mut all_healthy = true;

        for member in &members {
            for ep in &member.client_urls {
                let start = std::time::Instant::now();
                let url = format!("{}/health", ep.trim_end_matches('/'));
                let result = reqwest::get(&url).await;
                let took = start.elapsed().as_millis() as u64;
                match result {
                    Ok(resp) if resp.status().is_success() => {
                        checks.push(EtcdEndpointHealth {
                            endpoint: ep.clone(),
                            healthy: true,
                            took_ms: took,
                            error: None,
                        });
                    }
                    Ok(resp) => {
                        all_healthy = false;
                        checks.push(EtcdEndpointHealth {
                            endpoint: ep.clone(),
                            healthy: false,
                            took_ms: took,
                            error: Some(format!("HTTP {}", resp.status())),
                        });
                    }
                    Err(e) => {
                        all_healthy = false;
                        checks.push(EtcdEndpointHealth {
                            endpoint: ep.clone(),
                            healthy: false,
                            took_ms: took,
                            error: Some(e.to_string()),
                        });
                    }
                }
            }
        }

        Ok(EtcdClusterHealth {
            healthy: all_healthy,
            members: checks,
        })
    }

    /// Get status for each known endpoint.
    pub async fn endpoint_status(
        client: &EtcdClient,
    ) -> EtcdResult<Vec<EtcdEndpointStatus>> {
        // Use the primary connection status; for full multi-endpoint we would
        // iterate, but the gateway only exposes the connected node.
        let status = client.get_status().await?;
        let endpoint = format!(
            "{}://{}:{}",
            if client.config.tls { "https" } else { "http" },
            client.config.host,
            client.config.port,
        );
        Ok(vec![EtcdEndpointStatus {
            endpoint,
            version: status.version,
            db_size: status.db_size,
            leader: status.leader,
            raft_index: status.raft_index,
            raft_term: status.raft_term,
            is_learner: status.is_learner,
            errors: status.errors,
        }])
    }
}
