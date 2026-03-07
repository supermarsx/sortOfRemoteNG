// ── sorng-etcd/src/lease.rs ──────────────────────────────────────────────────
//! Lease management via the etcd v3 gRPC-gateway.

use crate::client::EtcdClient;
use crate::error::EtcdResult;
use crate::types::*;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};

// ── Wire types ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
struct LeaseGrantRequest {
    #[serde(rename = "TTL")]
    ttl: i64,
    #[serde(rename = "ID", skip_serializing_if = "Option::is_none")]
    id: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct LeaseGrantResponseWire {
    #[serde(rename = "ID", default)]
    id: Option<String>,
    #[serde(rename = "TTL", default)]
    ttl: Option<String>,
}

#[derive(Debug, Serialize)]
struct LeaseRevokeRequest {
    #[serde(rename = "ID")]
    id: i64,
}

#[derive(Debug, Serialize)]
struct LeaseTimeToLiveRequest {
    #[serde(rename = "ID")]
    id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    keys: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct LeaseTimeToLiveResponseWire {
    #[serde(rename = "ID", default)]
    id: Option<String>,
    #[serde(rename = "TTL", default)]
    ttl: Option<String>,
    #[serde(rename = "grantedTTL", default)]
    granted_ttl: Option<String>,
    #[serde(default)]
    keys: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct LeaseLeasesResponseWire {
    #[serde(default)]
    leases: Vec<LeaseIdWire>,
}

#[derive(Debug, Deserialize)]
struct LeaseIdWire {
    #[serde(rename = "ID", default)]
    id: Option<String>,
}

#[derive(Debug, Serialize)]
struct LeaseKeepAliveRequest {
    #[serde(rename = "ID")]
    id: i64,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn parse_i64(s: &Option<String>) -> i64 {
    s.as_deref()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0)
}

fn decode_b64_keys(keys: &Option<Vec<String>>) -> Vec<String> {
    keys.as_deref()
        .unwrap_or_default()
        .iter()
        .filter_map(|k| B64.decode(k).ok())
        .filter_map(|b| String::from_utf8(b).ok())
        .collect()
}

// ── Public API ───────────────────────────────────────────────────────────────

pub struct LeaseManager;

impl LeaseManager {
    /// Grant a new lease.
    pub async fn grant(
        client: &EtcdClient,
        ttl: i64,
        id: Option<i64>,
    ) -> EtcdResult<EtcdLease> {
        let req = LeaseGrantRequest { ttl, id };
        let resp: LeaseGrantResponseWire =
            client.post_json("/v3/lease/grant", &req).await?;
        let lease_id = parse_i64(&resp.id);
        let lease_ttl = parse_i64(&resp.ttl);
        Ok(EtcdLease {
            id: lease_id,
            ttl: lease_ttl,
            granted_ttl: ttl,
            keys: Vec::new(),
        })
    }

    /// Revoke a lease.
    pub async fn revoke(client: &EtcdClient, id: i64) -> EtcdResult<()> {
        let req = LeaseRevokeRequest { id };
        let _: serde_json::Value = client.post_json("/v3/lease/revoke", &req).await?;
        Ok(())
    }

    /// Query a lease's time-to-live and attached keys.
    pub async fn time_to_live(
        client: &EtcdClient,
        id: i64,
        keys: bool,
    ) -> EtcdResult<EtcdLeaseTimeToLive> {
        let req = LeaseTimeToLiveRequest {
            id,
            keys: if keys { Some(true) } else { None },
        };
        let resp: LeaseTimeToLiveResponseWire =
            client.post_json("/v3/lease/timetolive", &req).await?;
        Ok(EtcdLeaseTimeToLive {
            id: parse_i64(&resp.id),
            ttl: parse_i64(&resp.ttl),
            granted_ttl: parse_i64(&resp.granted_ttl),
            keys: decode_b64_keys(&resp.keys),
        })
    }

    /// List all active leases.
    pub async fn list(client: &EtcdClient) -> EtcdResult<Vec<EtcdLease>> {
        let resp: LeaseLeasesResponseWire =
            client.post_empty("/v3/lease/leases").await?;
        let mut leases = Vec::new();
        for l in &resp.leases {
            let lid = parse_i64(&l.id);
            // Fetch TTL info for each lease.
            match Self::time_to_live(client, lid, true).await {
                Ok(info) => leases.push(EtcdLease {
                    id: info.id,
                    ttl: info.ttl,
                    granted_ttl: info.granted_ttl,
                    keys: info.keys,
                }),
                Err(_) => leases.push(EtcdLease {
                    id: lid,
                    ttl: 0,
                    granted_ttl: 0,
                    keys: Vec::new(),
                }),
            }
        }
        Ok(leases)
    }

    /// Send a keep-alive for a lease.
    pub async fn keep_alive(client: &EtcdClient, id: i64) -> EtcdResult<()> {
        let req = LeaseKeepAliveRequest { id };
        let _: serde_json::Value =
            client.post_json("/v3/lease/keepalive", &req).await?;
        Ok(())
    }
}
