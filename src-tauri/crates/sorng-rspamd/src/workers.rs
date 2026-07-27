// ── rspamd worker management ─────────────────────────────────────────────────

use crate::client::RspamdClient;
use crate::error::{RspamdError, RspamdResult};
use crate::types::*;
use log::debug;

pub struct WorkerManager;

impl WorkerManager {
    /// The standard controller exposes aggregate health, not local worker inventory.
    pub async fn list(_client: &RspamdClient) -> RspamdResult<Vec<RspamdWorker>> {
        debug!("RSPAMD list_workers");
        Err(RspamdError::api(
            "Rspamd's controller API does not expose local worker inventory",
        ))
    }

    /// The standard controller cannot retrieve a local worker by id.
    pub async fn get(_client: &RspamdClient, worker_id: &str) -> RspamdResult<RspamdWorker> {
        debug!("RSPAMD get_worker: {worker_id}");
        Err(RspamdError::api(format!(
            "Rspamd's controller API cannot retrieve local worker '{worker_id}'"
        )))
    }

    /// GET /neighbours — list neighbour rspamd instances
    pub async fn list_neighbours(client: &RspamdClient) -> RspamdResult<Vec<RspamdNeighbour>> {
        debug!("RSPAMD list_neighbours");
        let raw: serde_json::Value = client.get("/neighbours").await?;
        Self::parse_neighbours(&raw)
    }

    // ── Internal helpers ─────────────────────────────────────────────

    fn parse_neighbours(raw: &serde_json::Value) -> RspamdResult<Vec<RspamdNeighbour>> {
        let mut neighbours = Vec::new();

        if let Some(arr) = raw.as_array() {
            for item in arr {
                neighbours.push(RspamdNeighbour {
                    name: item
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    host: item
                        .get("host")
                        .or_else(|| item.get("url"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    version: item
                        .get("version")
                        .and_then(|v| v.as_str())
                        .map(String::from),
                    is_self: item
                        .get("self")
                        .or_else(|| item.get("is_self"))
                        .and_then(|v| v.as_bool()),
                });
            }
        } else if let Some(obj) = raw.as_object() {
            for (name, info) in obj {
                neighbours.push(RspamdNeighbour {
                    name: name.clone(),
                    host: info
                        .get("host")
                        .or_else(|| info.get("url"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    version: info
                        .get("version")
                        .and_then(|v| v.as_str())
                        .map(String::from),
                    is_self: info
                        .get("self")
                        .or_else(|| info.get("is_self"))
                        .and_then(|v| v.as_bool()),
                });
            }
        }

        Ok(neighbours)
    }
}
