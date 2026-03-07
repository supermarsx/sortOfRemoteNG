// ── sorng-consul – Event operations ──────────────────────────────────────────
//! Consul event API: fire custom events, list recent events.

use crate::client::ConsulClient;
use crate::error::{ConsulError, ConsulResult};
use crate::types::*;
use log::debug;

/// Manager for Consul event operations.
pub struct EventManager;

impl EventManager {
    /// PUT /v1/event/fire/:name — fires a new user event.
    pub async fn fire_event(client: &ConsulClient, req: &EventFireRequest) -> ConsulResult<ConsulEvent> {
        let path = format!("/v1/event/fire/{}", req.name);
        debug!("CONSUL fire event: {}", req.name);

        let mut params: Vec<(&str, &str)> = Vec::new();
        if let Some(ref nf) = req.node_filter {
            params.push(("node", nf.as_str()));
        }
        if let Some(ref sf) = req.service_filter {
            params.push(("service", sf.as_str()));
        }
        if let Some(ref tf) = req.tag_filter {
            params.push(("tag", tf.as_str()));
        }

        let payload = req.payload.as_deref().unwrap_or("");
        let raw: serde_json::Value = client.post_with_params(&path, &payload, &params).await?;
        parse_event(&raw).ok_or_else(|| ConsulError::parse("Failed to parse event response"))
    }

    /// GET /v1/event/list — returns the most recent events known to the agent.
    pub async fn list_events(client: &ConsulClient) -> ConsulResult<Vec<ConsulEvent>> {
        debug!("CONSUL list events");
        let raw: Vec<serde_json::Value> = client.get("/v1/event/list").await?;
        Ok(raw.iter().filter_map(parse_event).collect())
    }

    /// GET /v1/event/list?name=:name — returns events filtered by name.
    pub async fn get_event(client: &ConsulClient, name: &str) -> ConsulResult<Vec<ConsulEvent>> {
        debug!("CONSUL get event: {name}");
        let raw: Vec<serde_json::Value> = client.get_with_params("/v1/event/list", &[("name", name)]).await?;
        Ok(raw.iter().filter_map(parse_event).collect())
    }
}

// ── helpers ──────────────────────────────────────────────────────────────────

fn parse_event(v: &serde_json::Value) -> Option<ConsulEvent> {
    let id = v.get("ID").and_then(|v| v.as_str())?.to_string();
    let name = v.get("Name").and_then(|v| v.as_str())?.to_string();

    let payload = v.get("Payload")
        .and_then(|v| v.as_str())
        .and_then(|encoded| base64_decode(encoded).ok());

    Some(ConsulEvent {
        id,
        name,
        payload,
        node_filter: v.get("NodeFilter").and_then(|v| v.as_str()).map(|s| s.to_string()),
        service_filter: v.get("ServiceFilter").and_then(|v| v.as_str()).map(|s| s.to_string()),
        tag_filter: v.get("TagFilter").and_then(|v| v.as_str()).map(|s| s.to_string()),
        version: v.get("Version").and_then(|v| v.as_u64()),
        l_time: v.get("LTime").and_then(|v| v.as_u64()),
    })
}

/// Decode a base64 string to UTF-8 text.
fn base64_decode(input: &str) -> Result<String, String> {
    let chars: Vec<u8> = input.bytes()
        .filter(|b| !b.is_ascii_whitespace())
        .collect();
    let mut bytes = Vec::with_capacity(chars.len() * 3 / 4);
    let mut buf: u32 = 0;
    let mut bits: u32 = 0;
    for c in chars {
        let val = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => continue,
            _ => return Err(format!("Invalid base64 char: {c}")),
        };
        buf = (buf << 6) | val as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            bytes.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }
    String::from_utf8(bytes).map_err(|e| format!("UTF-8 decode: {e}"))
}
