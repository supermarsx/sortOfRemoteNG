// ── haproxy backend management ───────────────────────────────────────────────

use crate::client::HaproxyClient;
use crate::error::HaproxyResult;
use crate::types::*;

pub struct BackendManager;

impl BackendManager {
    pub async fn list(client: &HaproxyClient) -> HaproxyResult<Vec<HaproxyBackend>> {
        if client.config.dataplane_url.is_some() {
            client
                .dp_get("/services/haproxy/configuration/backends")
                .await
        } else {
            let csv = client.show_stat().await?;
            Ok(parse_backends_from_csv(&csv))
        }
    }

    pub async fn get(client: &HaproxyClient, name: &str) -> HaproxyResult<HaproxyBackend> {
        if client.config.dataplane_url.is_some() {
            client
                .dp_get(&format!(
                    "/services/haproxy/configuration/backends/{}",
                    name
                ))
                .await
        } else {
            let all = Self::list(client).await?;
            all.into_iter()
                .find(|b| b.name == name)
                .ok_or_else(|| crate::error::HaproxyError::backend_not_found(name))
        }
    }
}

fn parse_backends_from_csv(csv: &str) -> Vec<HaproxyBackend> {
    let mut result = Vec::new();
    let lines: Vec<&str> = csv.lines().collect();
    if lines.is_empty() {
        return result;
    }
    for line in &lines[1..] {
        let cols: Vec<&str> = line.split(',').collect();
        if cols.len() < 2 {
            continue;
        }
        if cols.get(1).copied() != Some("BACKEND") {
            continue;
        }
        result.push(HaproxyBackend {
            name: cols[0].to_string(),
            status: cols.get(17).map(|s| s.to_string()).unwrap_or_default(),
            current_sessions: cols.get(4).and_then(|s| s.parse().ok()).unwrap_or(0),
            max_sessions: cols.get(5).and_then(|s| s.parse().ok()).unwrap_or(0),
            total_sessions: cols.get(7).and_then(|s| s.parse().ok()).unwrap_or(0),
            bytes_in: cols.get(8).and_then(|s| s.parse().ok()).unwrap_or(0),
            bytes_out: cols.get(9).and_then(|s| s.parse().ok()).unwrap_or(0),
            denied_requests: cols.get(10).and_then(|s| s.parse().ok()).unwrap_or(0),
            denied_responses: cols.get(11).and_then(|s| s.parse().ok()).unwrap_or(0),
            connection_errors: cols.get(13).and_then(|s| s.parse().ok()).unwrap_or(0),
            response_errors: cols.get(14).and_then(|s| s.parse().ok()).unwrap_or(0),
            retry_warnings: cols.get(15).and_then(|s| s.parse().ok()).unwrap_or(0),
            redispatch_warnings: cols.get(16).and_then(|s| s.parse().ok()).unwrap_or(0),
            request_total: cols.get(48).and_then(|s| s.parse().ok()).unwrap_or(0),
            http_responses: HttpResponses {
                http_1xx: cols.get(39).and_then(|s| s.parse().ok()).unwrap_or(0),
                http_2xx: cols.get(40).and_then(|s| s.parse().ok()).unwrap_or(0),
                http_3xx: cols.get(41).and_then(|s| s.parse().ok()).unwrap_or(0),
                http_4xx: cols.get(42).and_then(|s| s.parse().ok()).unwrap_or(0),
                http_5xx: cols.get(43).and_then(|s| s.parse().ok()).unwrap_or(0),
                http_other: cols.get(44).and_then(|s| s.parse().ok()).unwrap_or(0),
            },
            active_servers: cols.get(19).and_then(|s| s.parse().ok()).unwrap_or(0),
            backup_servers: cols.get(20).and_then(|s| s.parse().ok()).unwrap_or(0),
            check_down: cols.get(21).and_then(|s| s.parse().ok()).unwrap_or(0),
            last_change: cols.get(23).and_then(|s| s.parse().ok()).unwrap_or(0),
            downtime: cols.get(24).and_then(|s| s.parse().ok()).unwrap_or(0),
            queue_current: cols.get(2).and_then(|s| s.parse().ok()).unwrap_or(0),
            queue_max: cols.get(3).and_then(|s| s.parse().ok()).unwrap_or(0),
            balance_algorithm: None,
            mode: cols.get(75).map(|s| s.to_string()),
            servers: vec![],
        });
    }
    result
}
