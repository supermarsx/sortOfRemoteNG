// ── haproxy frontend management ──────────────────────────────────────────────

use crate::client::HaproxyClient;
use crate::error::HaproxyResult;
use crate::types::*;

pub struct FrontendManager;

impl FrontendManager {
    pub async fn list(client: &HaproxyClient) -> HaproxyResult<Vec<HaproxyFrontend>> {
        if client.config.dataplane_url.is_some() {
            client.dp_get("/services/haproxy/configuration/frontends").await
        } else {
            let csv = client.show_stat().await?;
            Ok(parse_frontends_from_csv(&csv))
        }
    }

    pub async fn get(client: &HaproxyClient, name: &str) -> HaproxyResult<HaproxyFrontend> {
        if client.config.dataplane_url.is_some() {
            client.dp_get(&format!("/services/haproxy/configuration/frontends/{}", name)).await
        } else {
            let all = Self::list(client).await?;
            all.into_iter().find(|f| f.name == name)
                .ok_or_else(|| crate::error::HaproxyError::frontend_not_found(name.to_string()))
        }
    }
}

fn parse_frontends_from_csv(csv: &str) -> Vec<HaproxyFrontend> {
    let mut result = Vec::new();
    let lines: Vec<&str> = csv.lines().collect();
    if lines.is_empty() { return result; }
    for line in &lines[1..] {
        let cols: Vec<&str> = line.split(',').collect();
        if cols.len() < 2 { continue; }
        if cols.get(1).map(|c| *c) != Some("FRONTEND") { continue; }
        result.push(HaproxyFrontend {
            name: cols[0].to_string(),
            mode: cols.get(75).map(|s| s.to_string()),
            bind: vec![],
            default_backend: None,
            maxconn: cols.get(6).and_then(|s| s.parse().ok()),
            status: cols.get(17).map(|s| s.to_string()),
            current_sessions: cols.get(4).and_then(|s| s.parse().ok()),
            max_sessions: cols.get(5).and_then(|s| s.parse().ok()),
            total_sessions: cols.get(7).and_then(|s| s.parse().ok()),
            bytes_in: cols.get(8).and_then(|s| s.parse().ok()),
            bytes_out: cols.get(9).and_then(|s| s.parse().ok()),
            request_rate: cols.get(46).and_then(|s| s.parse().ok()),
            http_responses: None,
        });
    }
    result
}
