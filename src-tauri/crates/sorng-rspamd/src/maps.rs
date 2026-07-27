// ── rspamd map management ────────────────────────────────────────────────────

use crate::client::RspamdClient;
use crate::error::{RspamdError, RspamdErrorKind, RspamdResult};
use crate::types::*;
use log::debug;

pub struct MapManager;

impl MapManager {
    /// GET /maps — list all maps
    pub async fn list(client: &RspamdClient) -> RspamdResult<Vec<RspamdMap>> {
        debug!("RSPAMD list_maps");
        let raw: serde_json::Value = client.get("/maps").await?;
        Self::parse_maps(&raw)
    }

    /// Get a specific map by id
    pub async fn get(client: &RspamdClient, id: u64) -> RspamdResult<RspamdMap> {
        debug!("RSPAMD get_map: {id}");
        let maps = Self::list(client).await?;
        maps.into_iter().find(|m| m.id == id).ok_or_else(|| {
            RspamdError::new(RspamdErrorKind::MapNotFound, format!("Map not found: {id}"))
        })
    }

    /// GET /getmap — get raw map content and parse entries
    pub async fn get_entries(client: &RspamdClient, id: u64) -> RspamdResult<Vec<RspamdMapEntry>> {
        debug!("RSPAMD get_map_entries: {id}");
        let raw = client
            .get_raw_with_headers("/getmap", &[("Map", id.to_string())])
            .await?;
        Ok(Self::parse_entries(&raw))
    }

    /// POST /savemap — save raw content to a map
    pub async fn save_entries(client: &RspamdClient, id: u64, content: &str) -> RspamdResult<()> {
        debug!("RSPAMD save_map_entries: {id}");
        client
            .post_body_with_headers("/savemap", content, &[("Map", id.to_string())])
            .await
    }

    /// Add a single entry to a map (reads current, appends, saves)
    pub async fn add_entry(
        client: &RspamdClient,
        id: u64,
        key: &str,
        value: Option<&str>,
    ) -> RspamdResult<()> {
        debug!("RSPAMD add_map_entry: map={id} key={key}");
        let current = client
            .get_raw_with_headers("/getmap", &[("Map", id.to_string())])
            .await?;

        let new_line = match value {
            Some(v) if !v.is_empty() => format!("{} {}", key, v),
            _ => key.to_string(),
        };

        let updated = if current.is_empty() {
            new_line
        } else {
            format!("{}\n{}", current.trim_end(), new_line)
        };

        client
            .post_body_with_headers("/savemap", &updated, &[("Map", id.to_string())])
            .await
    }

    /// Remove an entry from a map by key (reads current, filters, saves)
    pub async fn remove_entry(client: &RspamdClient, id: u64, key: &str) -> RspamdResult<()> {
        debug!("RSPAMD remove_map_entry: map={id} key={key}");
        let current = client
            .get_raw_with_headers("/getmap", &[("Map", id.to_string())])
            .await?;

        let updated: Vec<&str> = current
            .lines()
            .filter(|line| {
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.starts_with('#') {
                    return true;
                }
                let line_key = trimmed.split_whitespace().next().unwrap_or("");
                line_key != key
            })
            .collect();

        client
            .post_body_with_headers("/savemap", &updated.join("\n"), &[("Map", id.to_string())])
            .await
    }

    // ── Internal helpers ─────────────────────────────────────────────

    fn parse_maps(raw: &serde_json::Value) -> RspamdResult<Vec<RspamdMap>> {
        let mut maps = Vec::new();
        let entries = raw
            .as_array()
            .ok_or_else(|| RspamdError::parse("Rspamd /maps response must be an array"))?;
        for item in entries {
            let id = item
                .get("map")
                .and_then(|value| value.as_u64())
                .ok_or_else(|| RspamdError::parse("Rspamd map entry is missing its numeric id"))?;
            let uri = item
                .get("uri")
                .and_then(|value| value.as_str())
                .filter(|uri| !uri.trim().is_empty())
                .ok_or_else(|| RspamdError::parse(format!("Rspamd map {id} is missing its URI")))?;
            maps.push(RspamdMap {
                id,
                uri: uri.to_string(),
                description: item
                    .get("description")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                map_type: item.get("type").and_then(|v| v.as_str()).map(String::from),
                entries_count: item.get("nelts").and_then(|v| v.as_u64()),
                hits: item.get("hits").and_then(|v| v.as_u64()),
                last_reload: item
                    .get("last_reload")
                    .and_then(|v| v.as_str())
                    .map(String::from),
            });
        }
        Ok(maps)
    }

    fn parse_entries(raw: &str) -> Vec<RspamdMapEntry> {
        let mut entries = Vec::new();
        for line in raw.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            let mut parts = trimmed.splitn(2, char::is_whitespace);
            let key = parts.next().unwrap_or("").to_string();
            let value = parts.next().map(|v| v.trim().to_string());
            entries.push(RspamdMapEntry {
                key,
                value,
                hits: None,
            });
        }
        entries
    }
}
