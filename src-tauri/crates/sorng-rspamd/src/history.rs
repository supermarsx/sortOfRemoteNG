// ── rspamd history management ────────────────────────────────────────────────

use crate::client::RspamdClient;
use crate::error::{RspamdError, RspamdResult};
use crate::types::*;
use log::debug;

pub struct HistoryManager;

impl HistoryManager {
    /// GET /history — retrieve scan history
    pub async fn get(
        client: &RspamdClient,
        limit: Option<u64>,
        offset: Option<u64>,
    ) -> RspamdResult<RspamdHistory> {
        debug!("RSPAMD get_history limit={limit:?} offset={offset:?}");
        let mut path = "/history".to_string();
        let mut params = Vec::new();
        if let Some(l) = limit {
            params.push(format!("limit={}", l));
        }
        if let Some(o) = offset {
            params.push(format!("offset={}", o));
        }
        if !params.is_empty() {
            path = format!("{}?{}", path, params.join("&"));
        }
        let raw: serde_json::Value = client.get(&path).await?;
        Self::parse_history(&raw)
    }

    /// Get a specific history entry by id
    pub async fn get_by_id(
        client: &RspamdClient,
        entry_id: &str,
    ) -> RspamdResult<RspamdHistoryEntry> {
        debug!("RSPAMD get_history_entry: {entry_id}");
        let history = Self::get(client, None, None).await?;
        history
            .rows
            .into_iter()
            .find(|e| e.id.as_deref() == Some(entry_id))
            .ok_or_else(|| RspamdError::not_found(format!("History entry not found: {entry_id}")))
    }

    /// POST /historyreset — reset scan history
    pub async fn reset(client: &RspamdClient) -> RspamdResult<()> {
        debug!("RSPAMD reset_history");
        client.post_no_body("/historyreset").await
    }

    // ── Internal helpers ─────────────────────────────────────────────

    fn parse_history(raw: &serde_json::Value) -> RspamdResult<RspamdHistory> {
        let rows_val = raw.get("rows").or(Some(raw));

        let rows = match rows_val {
            Some(serde_json::Value::Array(arr)) => arr.iter().map(Self::parse_entry).collect(),
            _ => Vec::new(),
        };

        Ok(RspamdHistory { rows })
    }

    fn parse_entry(item: &serde_json::Value) -> RspamdHistoryEntry {
        let symbols = item
            .get("symbols")
            .and_then(|v| {
                if let Some(obj) = v.as_object() {
                    Some(obj.keys().cloned().collect())
                } else {
                    v.as_array().map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(String::from))
                            .collect()
                    })
                }
            })
            .unwrap_or_default();

        RspamdHistoryEntry {
            id: item.get("id").and_then(|v| v.as_str()).map(String::from),
            timestamp: item
                .get("time")
                .or_else(|| item.get("timestamp"))
                .and_then(|v| v.as_f64()),
            ip: item.get("ip").and_then(|v| v.as_str()).map(String::from),
            action: item
                .get("action")
                .and_then(|v| v.as_str())
                .map(String::from),
            score: item.get("score").and_then(|v| v.as_f64()),
            required_score: item.get("required_score").and_then(|v| v.as_f64()),
            symbols,
            size: item.get("size").and_then(|v| v.as_u64()),
            scan_time_ms: item
                .get("scan_time")
                .or_else(|| item.get("time_real"))
                .and_then(|v| v.as_f64()),
            user: item.get("user").and_then(|v| v.as_str()).map(String::from),
            message_id: item
                .get("message-id")
                .or_else(|| item.get("message_id"))
                .and_then(|v| v.as_str())
                .map(String::from),
            subject: item
                .get("subject")
                .and_then(|v| v.as_str())
                .map(String::from),
        }
    }
}
