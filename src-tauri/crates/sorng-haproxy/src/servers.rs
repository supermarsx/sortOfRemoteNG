// ── haproxy server management ────────────────────────────────────────────────

use crate::client::HaproxyClient;
use crate::error::HaproxyResult;
use crate::types::*;

pub struct ServerManager;

impl ServerManager {
    pub async fn list(client: &HaproxyClient, backend: &str) -> HaproxyResult<Vec<HaproxyServer>> {
        if client.config.dataplane_url.is_some() {
            client.dp_get(&format!("/services/haproxy/configuration/servers?backend={}", backend)).await
        } else {
            let csv = client.show_stat().await?;
            Ok(parse_servers_from_csv(&csv, backend))
        }
    }

    pub async fn get(client: &HaproxyClient, backend: &str, server: &str) -> HaproxyResult<HaproxyServer> {
        if client.config.dataplane_url.is_some() {
            client.dp_get(&format!("/services/haproxy/configuration/servers/{}?backend={}", server, backend)).await
        } else {
            let all = Self::list(client, backend).await?;
            all.into_iter().find(|s| s.name == server)
                .ok_or_else(|| crate::error::HaproxyError::server_not_found(format!("{}/{}", backend, server)))
        }
    }

    pub async fn set_state(client: &HaproxyClient, backend: &str, server: &str, action: &ServerAction) -> HaproxyResult<String> {
        let cmd = match action {
            ServerAction::Enable => "state ready",
            ServerAction::Disable => "state maint",
            ServerAction::Drain => "state drain",
            ServerAction::Maint => "state maint",
            ServerAction::Ready => "state ready",
            ServerAction::SetWeight(w) => return client.set_server(backend, server, &format!("weight {}", w)).await,
            ServerAction::SetAddr(a) => return client.set_server(backend, server, &format!("addr {}", a)).await,
            ServerAction::AgentUp => "agent-check force-up",
            ServerAction::AgentDown => "agent-check force-nochk",
        };
        client.set_server(backend, server, cmd).await
    }
}

fn parse_servers_from_csv(csv: &str, backend: &str) -> Vec<HaproxyServer> {
    let mut result = Vec::new();
    let lines: Vec<&str> = csv.lines().collect();
    if lines.is_empty() { return result; }
    for line in &lines[1..] {
        let cols: Vec<&str> = line.split(',').collect();
        if cols.len() < 2 { continue; }
        if cols[0] != backend { continue; }
        let svtype = cols.get(1).map(|s| *s).unwrap_or("");
        if svtype == "FRONTEND" || svtype == "BACKEND" { continue; }
        result.push(HaproxyServer {
            name: svtype.to_string(),
            address: cols.get(73).map(|s| s.to_string()),
            port: cols.get(74).and_then(|s| s.parse().ok()),
            status: cols.get(17).map(|s| s.to_string()),
            weight: cols.get(18).and_then(|s| s.parse().ok()),
            current_sessions: cols.get(4).and_then(|s| s.parse().ok()),
            max_sessions: cols.get(5).and_then(|s| s.parse().ok()),
            total_sessions: cols.get(7).and_then(|s| s.parse().ok()),
            bytes_in: cols.get(8).and_then(|s| s.parse().ok()),
            bytes_out: cols.get(9).and_then(|s| s.parse().ok()),
            check_status: cols.get(36).map(|s| s.to_string()),
            check_code: cols.get(37).and_then(|s| s.parse().ok()),
            check_duration: cols.get(38).and_then(|s| s.parse().ok()),
            last_change: cols.get(23).and_then(|s| s.parse().ok()),
            downtime: cols.get(24).and_then(|s| s.parse().ok()),
            queue_current: cols.get(2).and_then(|s| s.parse().ok()),
            queue_max: cols.get(3).and_then(|s| s.parse().ok()),
            rate: cols.get(33).and_then(|s| s.parse().ok()),
            rate_max: cols.get(35).and_then(|s| s.parse().ok()),
            response_time_avg: cols.get(60).and_then(|s| s.parse().ok()),
            connect_time_avg: cols.get(61).and_then(|s| s.parse().ok()),
            http_responses: None,
            backup: cols.get(20).map(|s| s == "1"),
            active: cols.get(19).map(|s| s == "1"),
        });
    }
    result
}
