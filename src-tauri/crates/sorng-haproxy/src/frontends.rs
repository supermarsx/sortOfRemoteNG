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
                .ok_or_else(|| crate::error::HaproxyError::frontend_not_found(name))
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
            status: cols.get(17).map(|s| s.to_string()).unwrap_or_default(),
            current_sessions: cols.get(4).and_then(|s| s.parse().ok()).unwrap_or(0),
            max_sessions: cols.get(5).and_then(|s| s.parse().ok()).unwrap_or(0),
            session_limit: cols.get(6).and_then(|s| s.parse().ok()).unwrap_or(0),
            total_sessions: cols.get(7).and_then(|s| s.parse().ok()).unwrap_or(0),
            bytes_in: cols.get(8).and_then(|s| s.parse().ok()).unwrap_or(0),
            bytes_out: cols.get(9).and_then(|s| s.parse().ok()).unwrap_or(0),
            denied_requests: cols.get(10).and_then(|s| s.parse().ok()).unwrap_or(0),
            denied_responses: cols.get(11).and_then(|s| s.parse().ok()).unwrap_or(0),
            request_errors: cols.get(12).and_then(|s| s.parse().ok()).unwrap_or(0),
            request_rate: cols.get(46).and_then(|s| s.parse().ok()).unwrap_or(0),
            request_rate_max: cols.get(47).and_then(|s| s.parse().ok()).unwrap_or(0),
            request_total: cols.get(48).and_then(|s| s.parse().ok()).unwrap_or(0),
            connection_rate: cols.get(78).and_then(|s| s.parse().ok()).unwrap_or(0),
            connection_rate_max: cols.get(79).and_then(|s| s.parse().ok()).unwrap_or(0),
            connection_total: cols.get(7).and_then(|s| s.parse().ok()).unwrap_or(0),
            http_responses: HttpResponses {
                http_1xx: cols.get(39).and_then(|s| s.parse().ok()).unwrap_or(0),
                http_2xx: cols.get(40).and_then(|s| s.parse().ok()).unwrap_or(0),
                http_3xx: cols.get(41).and_then(|s| s.parse().ok()).unwrap_or(0),
                http_4xx: cols.get(42).and_then(|s| s.parse().ok()).unwrap_or(0),
                http_5xx: cols.get(43).and_then(|s| s.parse().ok()).unwrap_or(0),
                http_other: cols.get(44).and_then(|s| s.parse().ok()).unwrap_or(0),
            },
            mode: cols.get(75).map(|s| s.to_string()),
            bind: None,
        });
    }
    result
}
