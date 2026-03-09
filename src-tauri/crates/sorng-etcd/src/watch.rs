// ── sorng-etcd/src/watch.rs ──────────────────────────────────────────────────
//! Watch functionality for etcd key/range change notifications.

use crate::client::EtcdClient;
use crate::error::EtcdResult;
use crate::types::*;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};

// ── Wire types ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
struct WatchCreateRequestWire {
    create_request: WatchCreateInner,
}

#[derive(Debug, Serialize)]
struct WatchCreateInner {
    key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    range_end: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    start_revision: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    prev_kv: Option<bool>,
}

#[derive(Debug, Serialize)]
struct WatchCancelRequestWire {
    cancel_request: WatchCancelInner,
}

#[derive(Debug, Serialize)]
struct WatchCancelInner {
    watch_id: String,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct WatchResponseWire {
    #[serde(default)]
    watch_id: Option<String>,
    #[serde(default)]
    created: Option<bool>,
    #[serde(default)]
    canceled: Option<bool>,
    #[serde(default)]
    events: Vec<EventWire>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct EventWire {
    #[serde(rename = "type", default)]
    event_type: Option<String>,
    kv: Option<KvWire>,
    prev_kv: Option<KvWire>,
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
            if v == 0 {
                None
            } else {
                Some(v)
            }
        },
    }
}

// ── Public API ───────────────────────────────────────────────────────────────

pub struct WatchManager;

impl WatchManager {
    /// Create a watch request. Returns the initial response (with watch_id).
    pub async fn create_watch(client: &EtcdClient, config: &EtcdWatchConfig) -> EtcdResult<String> {
        let req = WatchCreateRequestWire {
            create_request: WatchCreateInner {
                key: encode_key(&config.key),
                range_end: config.range_end.as_deref().map(encode_key),
                start_revision: config.start_revision,
                prev_kv: config.prev_kv,
            },
        };
        let resp: WatchResponseWire = client.post_json("/v3/watch", &req).await?;
        Ok(resp.watch_id.unwrap_or_default())
    }

    /// Cancel an active watch.
    pub async fn cancel_watch(client: &EtcdClient, watch_id: &str) -> EtcdResult<()> {
        let req = WatchCancelRequestWire {
            cancel_request: WatchCancelInner {
                watch_id: watch_id.to_string(),
            },
        };
        let _: serde_json::Value = client.post_json("/v3/watch", &req).await?;
        Ok(())
    }

    /// Parse watch events from a wire response.
    pub(crate) fn parse_events(events: &[EventWire]) -> Vec<EtcdWatchEvent> {
        events
            .iter()
            .filter_map(|e| {
                let kv_wire = e.kv.as_ref()?;
                Some(EtcdWatchEvent {
                    event_type: e.event_type.clone().unwrap_or_else(|| "PUT".to_string()),
                    kv: wire_to_kv(kv_wire),
                    prev_kv: e.prev_kv.as_ref().map(wire_to_kv),
                })
            })
            .collect()
    }
}
