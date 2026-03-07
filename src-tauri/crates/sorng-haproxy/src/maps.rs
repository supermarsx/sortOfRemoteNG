// ── haproxy map management ───────────────────────────────────────────────────

use crate::client::HaproxyClient;
use crate::error::HaproxyResult;
use crate::types::*;

pub struct MapManager;

impl MapManager {
    pub async fn list(client: &HaproxyClient) -> HaproxyResult<Vec<HaproxyMap>> {
        let raw = client.socket_cmd("show map").await?;
        Ok(parse_map_list(&raw))
    }

    pub async fn get(client: &HaproxyClient, map_id: &str) -> HaproxyResult<Vec<MapEntry>> {
        let raw = client.show_map(map_id).await?;
        Ok(parse_map_entries(&raw))
    }

    pub async fn add_entry(client: &HaproxyClient, map_id: &str, key: &str, value: &str) -> HaproxyResult<String> {
        client.add_map_entry(map_id, key, value).await
    }

    pub async fn del_entry(client: &HaproxyClient, map_id: &str, key: &str) -> HaproxyResult<String> {
        client.del_map_entry(map_id, key).await
    }

    pub async fn set_entry(client: &HaproxyClient, map_id: &str, key: &str, value: &str) -> HaproxyResult<String> {
        client.socket_cmd(&format!("set map #{} {} {}", map_id, key, value)).await
    }

    pub async fn clear(client: &HaproxyClient, map_id: &str) -> HaproxyResult<String> {
        client.socket_cmd(&format!("clear map #{}", map_id)).await
    }
}

fn parse_map_list(raw: &str) -> Vec<HaproxyMap> {
    raw.lines().filter_map(|line| {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 {
            Some(HaproxyMap {
                id: parts[0].trim_start_matches('#').to_string(),
                description: Some(parts[1..].join(" ")),
                entries: vec![],
            })
        } else {
            None
        }
    }).collect()
}

fn parse_map_entries(raw: &str) -> Vec<MapEntry> {
    raw.lines().filter_map(|line| {
        let parts: Vec<&str> = line.splitn(3, ' ').collect();
        if parts.len() >= 3 {
            Some(MapEntry { id: parts[0].parse().unwrap_or(0), key: parts[1].to_string(), value: parts[2].to_string() })
        } else {
            None
        }
    }).collect()
}
