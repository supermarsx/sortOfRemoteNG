// ── haproxy backend management ───────────────────────────────────────────────

use crate::client::HaproxyClient;
use crate::error::HaproxyResult;
use crate::types::*;

pub struct BackendManager;

impl BackendManager {
    pub async fn list(client: &HaproxyClient) -> HaproxyResult<Vec<HaproxyBackend>> {
        if client.config.dataplane_url.is_some() {
            client.dp_get("/services/haproxy/configuration/backends").await
        } else {
            let csv = client.show_stat().await?;
            Ok(parse_backends_from_csv(&csv))
        }
    }

    pub async fn get(client: &HaproxyClient, name: &str) -> HaproxyResult<HaproxyBackend> {
        if client.config.dataplane_url.is_some() {
            client.dp_get(&format!("/services/haproxy/configuration/backends/{}", name)).await
        } else {
            let all = Self::list(client).await?;
            all.into_iter().find(|b| b.name == name)
                .ok_or_else(|| crate::error::HaproxyError::backend_not_found(name.to_string()))
        }
    }
}

fn parse_backends_from_csv(csv: &str) -> Vec<HaproxyBackend> {
    let mut result = Vec::new();
    let lines: Vec<&str> = csv.lines().collect();
    if lines.is_empty() { return result; }
    for line in &lines[1..] {
        let cols: Vec<&str> = line.split(',').collect();
        if cols.len() < 2 { continue; }
        if cols.get(1).map(|c| *c) != Some("BACKEND") { continue; }
        result.push(HaproxyBackend {
            name: cols[0].to_string(),
            mode: cols.get(75).map(|s| s.to_string()),
            balance: None,
            servers: vec![],
            status: cols.get(17).map(|s| s.to_string()),
            current_sessions: cols.get(4).and_then(|s| s.parse().ok()),
            max_sessions: cols.get(5).and_then(|s| s.parse().ok()),
            total_sessions: cols.get(7).and_then(|s| s.parse().ok()),
            bytes_in: cols.get(8).and_then(|s| s.parse().ok()),
            bytes_out: cols.get(9).and_then(|s| s.parse().ok()),
            http_responses: None,
            active_servers: cols.get(19).and_then(|s| s.parse().ok()),
            backup_servers: cols.get(20).and_then(|s| s.parse().ok()),
        });
    }
    result
}
