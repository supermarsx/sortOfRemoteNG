// ── sorng-etcd/src/kv.rs ─────────────────────────────────────────────────────
//! Key-value operations via the etcd v3 gRPC-gateway.

use crate::client::EtcdClient;
use crate::error::EtcdResult;
use crate::types::*;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};

// ── Wire types (base64-encoded as etcd v3 gateway uses) ──────────────────────

#[derive(Debug, Serialize)]
struct RangeRequest {
    key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    range_end: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    limit: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    revision: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sort_order: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sort_target: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    keys_only: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct RangeResponseWire {
    #[serde(default)]
    kvs: Vec<KvWire>,
    #[serde(default)]
    count: Option<String>,
    #[serde(default)]
    more: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct KvWire {
    key: Option<String>,
    value: Option<String>,
    #[serde(default)]
    create_revision: Option<String>,
    #[serde(default)]
    mod_revision: Option<String>,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    lease: Option<String>,
}

#[derive(Debug, Serialize)]
struct PutRequestWire {
    key: String,
    value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    lease: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    prev_kv: Option<bool>,
}

#[derive(Debug, Serialize)]
struct DeleteRangeRequestWire {
    key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    range_end: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    prev_kv: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct DeleteRangeResponseWire {
    #[serde(default)]
    deleted: Option<String>,
    #[serde(default)]
    prev_kvs: Option<Vec<KvWire>>,
}

#[derive(Debug, Serialize)]
struct CompactionRequest {
    revision: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    physical: Option<bool>,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn encode_key(s: &str) -> String {
    B64.encode(s.as_bytes())
}

fn decode_b64(s: &Option<String>) -> String {
    s.as_deref()
        .and_then(|v| B64.decode(v).ok())
        .and_then(|b| String::from_utf8(b).ok())
        .unwrap_or_default()
}

fn parse_i64(s: &Option<String>) -> i64 {
    s.as_deref()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0)
}

fn wire_to_kv(w: &KvWire) -> EtcdKeyValue {
    EtcdKeyValue {
        key: decode_b64(&w.key),
        value: decode_b64(&w.value),
        create_revision: parse_i64(&w.create_revision),
        mod_revision: parse_i64(&w.mod_revision),
        version: parse_i64(&w.version),
        lease: {
            let v = parse_i64(&w.lease);
            if v == 0 { None } else { Some(v) }
        },
    }
}

// ── Public API ───────────────────────────────────────────────────────────────

pub struct KvManager;

impl KvManager {
    /// Get a single key.
    pub async fn get(client: &EtcdClient, key: &str) -> EtcdResult<Option<EtcdKeyValue>> {
        let req = RangeRequest {
            key: encode_key(key),
            range_end: None,
            limit: Some(1),
            revision: None,
            sort_order: None,
            sort_target: None,
            keys_only: None,
        };
        let resp: RangeResponseWire = client.post_json("/v3/kv/range", &req).await?;
        Ok(resp.kvs.first().map(wire_to_kv))
    }

    /// Get a key at a specific revision.
    pub async fn get_at_revision(
        client: &EtcdClient,
        key: &str,
        revision: i64,
    ) -> EtcdResult<Option<EtcdKeyValue>> {
        let req = RangeRequest {
            key: encode_key(key),
            range_end: None,
            limit: Some(1),
            revision: Some(revision),
            sort_order: None,
            sort_target: None,
            keys_only: None,
        };
        let resp: RangeResponseWire = client.post_json("/v3/kv/range", &req).await?;
        Ok(resp.kvs.first().map(wire_to_kv))
    }

    /// Put a key-value pair.
    pub async fn put(
        client: &EtcdClient,
        key: &str,
        value: &str,
        lease: Option<i64>,
        prev_kv: Option<bool>,
    ) -> EtcdResult<()> {
        let req = PutRequestWire {
            key: encode_key(key),
            value: B64.encode(value.as_bytes()),
            lease,
            prev_kv,
        };
        let _: serde_json::Value = client.post_json("/v3/kv/put", &req).await?;
        Ok(())
    }

    /// Delete keys.
    pub async fn delete(
        client: &EtcdClient,
        key: &str,
        range_end: Option<&str>,
    ) -> EtcdResult<i64> {
        let req = DeleteRangeRequestWire {
            key: encode_key(key),
            range_end: range_end.map(encode_key),
            prev_kv: None,
        };
        let resp: DeleteRangeResponseWire =
            client.post_json("/v3/kv/deleterange", &req).await?;
        Ok(parse_i64(&resp.deleted))
    }

    /// Range query.
    pub async fn range(
        client: &EtcdClient,
        key: &str,
        range_end: Option<&str>,
        limit: Option<i64>,
        revision: Option<i64>,
        sort_order: Option<i32>,
        sort_target: Option<i32>,
    ) -> EtcdResult<EtcdRangeResponse> {
        let req = RangeRequest {
            key: encode_key(key),
            range_end: range_end.map(encode_key),
            limit,
            revision,
            sort_order,
            sort_target,
            keys_only: None,
        };
        let resp: RangeResponseWire = client.post_json("/v3/kv/range", &req).await?;
        Ok(EtcdRangeResponse {
            kvs: resp.kvs.iter().map(wire_to_kv).collect(),
            count: parse_i64(&resp.count),
            more: resp.more.unwrap_or(false),
        })
    }

    /// Compact revisions up to the given revision.
    pub async fn compact(client: &EtcdClient, revision: i64) -> EtcdResult<()> {
        let req = CompactionRequest {
            revision,
            physical: Some(true),
        };
        let _: serde_json::Value = client.post_json("/v3/kv/compaction", &req).await?;
        Ok(())
    }

    /// Get key history by fetching multiple past revisions.
    pub async fn get_history(
        client: &EtcdClient,
        key: &str,
    ) -> EtcdResult<Vec<EtcdKeyValue>> {
        // Get the current value to learn its revision range.
        let current = Self::get(client, key).await?;
        let Some(kv) = current else {
            return Ok(Vec::new());
        };

        let mut history = Vec::new();
        let create_rev = kv.create_revision;
        let mod_rev = kv.mod_revision;

        // Walk backwards from mod_revision to create_revision (cap at 50).
        let start = std::cmp::max(create_rev, mod_rev.saturating_sub(49));
        for rev in start..=mod_rev {
            if let Ok(Some(entry)) = Self::get_at_revision(client, key, rev).await {
                if entry.mod_revision == rev {
                    history.push(entry);
                }
            }
        }
        Ok(history)
    }
}
