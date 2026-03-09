// ── haproxy server management ────────────────────────────────────────────────

use crate::client::HaproxyClient;
use crate::error::HaproxyResult;
use crate::types::*;

pub struct ServerManager;

impl ServerManager {
    pub async fn list(client: &HaproxyClient, backend: &str) -> HaproxyResult<Vec<HaproxyServer>> {
        if client.config.dataplane_url.is_some() {
            client
                .dp_get(&format!(
                    "/services/haproxy/configuration/servers?backend={}",
                    backend
                ))
                .await
        } else {
            let csv = client.show_stat().await?;
            Ok(parse_servers_from_csv(&csv, backend))
        }
    }

    pub async fn get(
        client: &HaproxyClient,
        backend: &str,
        server: &str,
    ) -> HaproxyResult<HaproxyServer> {
        if client.config.dataplane_url.is_some() {
            client
                .dp_get(&format!(
                    "/services/haproxy/configuration/servers/{}?backend={}",
                    server, backend
                ))
                .await
        } else {
            let all = Self::list(client, backend).await?;
            all.into_iter().find(|s| s.name == server).ok_or_else(|| {
                crate::error::HaproxyError::server_not_found(&format!("{}/{}", backend, server))
            })
        }
    }

    pub async fn set_state(
        client: &HaproxyClient,
        backend: &str,
        server: &str,
        action: &ServerAction,
    ) -> HaproxyResult<String> {
        let cmd = match action {
            ServerAction::Enable => "state ready",
            ServerAction::Disable => "state maint",
            ServerAction::Drain => "state drain",
            ServerAction::Maint => "state maint",
            ServerAction::Ready => "state ready",
            ServerAction::SetWeight => {
                return client.set_server(backend, server, "weight 100").await
            }
            ServerAction::SetAddr => {
                return client.set_server(backend, server, "addr 127.0.0.1").await
            }
            ServerAction::AgentUp => "agent-check force-up",
            ServerAction::AgentDown => "agent-check force-nochk",
        };
        client.set_server(backend, server, cmd).await
    }
}

fn parse_servers_from_csv(csv: &str, backend: &str) -> Vec<HaproxyServer> {
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
        if cols[0] != backend {
            continue;
        }
        let svtype = cols.get(1).copied().unwrap_or("");
        if svtype == "FRONTEND" || svtype == "BACKEND" {
            continue;
        }
        result.push(HaproxyServer {
            name: svtype.to_string(),
            backend: cols[0].to_string(),
            address: cols.get(73).map(|s| s.to_string()).unwrap_or_default(),
            port: cols.get(74).and_then(|s| s.parse().ok()),
            status: cols.get(17).map(|s| s.to_string()).unwrap_or_default(),
            weight: cols.get(18).and_then(|s| s.parse().ok()).unwrap_or(0),
            current_sessions: cols.get(4).and_then(|s| s.parse().ok()).unwrap_or(0),
            max_sessions: cols.get(5).and_then(|s| s.parse().ok()).unwrap_or(0),
            total_sessions: cols.get(7).and_then(|s| s.parse().ok()).unwrap_or(0),
            bytes_in: cols.get(8).and_then(|s| s.parse().ok()).unwrap_or(0),
            bytes_out: cols.get(9).and_then(|s| s.parse().ok()).unwrap_or(0),
            connection_errors: cols.get(13).and_then(|s| s.parse().ok()).unwrap_or(0),
            response_errors: cols.get(14).and_then(|s| s.parse().ok()).unwrap_or(0),
            retry_warnings: cols.get(15).and_then(|s| s.parse().ok()).unwrap_or(0),
            redispatch_warnings: cols.get(16).and_then(|s| s.parse().ok()).unwrap_or(0),
            check_status: cols.get(36).map(|s| s.to_string()),
            check_code: cols.get(37).and_then(|s| s.parse().ok()),
            check_duration: cols.get(38).and_then(|s| s.parse().ok()),
            last_change: cols.get(23).and_then(|s| s.parse().ok()).unwrap_or(0),
            downtime: cols.get(24).and_then(|s| s.parse().ok()).unwrap_or(0),
            queue_current: cols.get(2).and_then(|s| s.parse().ok()).unwrap_or(0),
            queue_max: cols.get(3).and_then(|s| s.parse().ok()).unwrap_or(0),
            throttle: cols.get(34).and_then(|s| s.parse().ok()),
            agent_status: cols.get(62).map(|s| s.to_string()),
            active: cols.get(19).map(|s| *s == "1").unwrap_or(false),
            backup: cols.get(20).map(|s| *s == "1").unwrap_or(false),
        });
    }
    result
}
