// ── haproxy runtime commands ─────────────────────────────────────────────────

use crate::client::HaproxyClient;
use crate::error::HaproxyResult;
use crate::types::*;

pub struct RuntimeManager;

impl RuntimeManager {
    pub async fn execute(client: &HaproxyClient, command: &str) -> HaproxyResult<String> {
        client.socket_cmd(command).await
    }

    pub async fn show_servers_state(client: &HaproxyClient) -> HaproxyResult<String> {
        client.show_servers_state().await
    }

    pub async fn show_sessions(client: &HaproxyClient) -> HaproxyResult<Vec<SessionEntry>> {
        let raw = client.show_sess().await?;
        Ok(parse_sessions(&raw))
    }

    pub async fn show_backend_list(client: &HaproxyClient) -> HaproxyResult<Vec<String>> {
        let raw = client.show_backend().await?;
        Ok(raw
            .lines()
            .filter(|l| !l.starts_with('#') && !l.is_empty())
            .map(String::from)
            .collect())
    }
}

fn parse_sessions(raw: &str) -> Vec<SessionEntry> {
    raw.lines()
        .filter_map(|line| {
            if line.starts_with('#') || line.is_empty() {
                return None;
            }
            Some(SessionEntry {
                id: String::new(),
                frontend: String::new(),
                backend: String::new(),
                server: String::new(),
                source: line.to_string(),
                destination: None,
                age_secs: 0,
                idle_secs: None,
                bytes_in: 0,
                bytes_out: 0,
            })
        })
        .collect()
}
