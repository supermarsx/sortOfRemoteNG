// ── haproxy stick table management ───────────────────────────────────────────

use crate::client::HaproxyClient;
use crate::error::HaproxyResult;
use crate::types::*;

pub struct StickTableManager;

impl StickTableManager {
    pub async fn list(client: &HaproxyClient) -> HaproxyResult<Vec<StickTable>> {
        let raw = client.socket_cmd("show table").await?;
        Ok(parse_tables(&raw))
    }

    pub async fn get(client: &HaproxyClient, name: &str) -> HaproxyResult<Vec<StickTableEntry>> {
        let raw = client.show_table(name).await?;
        Ok(parse_table_entries(&raw))
    }

    pub async fn clear(client: &HaproxyClient, name: &str) -> HaproxyResult<String> {
        client.socket_cmd(&format!("clear table {}", name)).await
    }

    pub async fn set_entry(client: &HaproxyClient, name: &str, key: &str, data: &str) -> HaproxyResult<String> {
        client.socket_cmd(&format!("set table {} key {} data.{}", name, key, data)).await
    }
}

fn parse_tables(raw: &str) -> Vec<StickTable> {
    raw.lines().filter_map(|line| {
        if !line.starts_with("# table:") { return None; }
        let parts: Vec<&str> = line.split(',').collect();
        let name = parts.first()
            .map(|p| p.trim_start_matches("# table: ").trim().to_string())
            .unwrap_or_default();
        let size = parts.iter().find_map(|p| p.trim().strip_prefix("size:")).and_then(|s| s.trim().parse().ok());
        let used = parts.iter().find_map(|p| p.trim().strip_prefix("used:")).and_then(|s| s.trim().parse().ok());
        Some(StickTable { name, table_type: None, size, used, entries: vec![] })
    }).collect()
}

fn parse_table_entries(raw: &str) -> Vec<StickTableEntry> {
    raw.lines().filter_map(|line| {
        if line.starts_with('#') { return None; }
        let parts: Vec<&str> = line.splitn(2, ' ').collect();
        if parts.len() < 2 { return None; }
        Some(StickTableEntry {
            key: parts[0].to_string(),
            data: parts.get(1).map(|s| s.to_string()),
            expire: None,
            use_count: None,
        })
    }).collect()
}
