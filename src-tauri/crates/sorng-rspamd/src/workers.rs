// ── rspamd worker management ─────────────────────────────────────────────────

use crate::client::RspamdClient;
use crate::error::{RspamdError, RspamdResult};
use crate::types::*;
use log::debug;

pub struct WorkerManager;

impl WorkerManager {
    /// GET /stat — extract worker information from stats
    pub async fn list(client: &RspamdClient) -> RspamdResult<Vec<RspamdWorker>> {
        debug!("RSPAMD list_workers");
        let raw: serde_json::Value = client.get("/stat").await?;
        Self::parse_workers(&raw)
    }

    /// Get a specific worker by id
    pub async fn get(client: &RspamdClient, worker_id: &str) -> RspamdResult<RspamdWorker> {
        debug!("RSPAMD get_worker: {worker_id}");
        let workers = Self::list(client).await?;
        workers
            .into_iter()
            .find(|w| w.id == worker_id)
            .ok_or_else(|| RspamdError::not_found(format!("Worker not found: {worker_id}")))
    }

    /// GET /neighbours — list neighbour rspamd instances
    pub async fn list_neighbours(client: &RspamdClient) -> RspamdResult<Vec<RspamdNeighbour>> {
        debug!("RSPAMD list_neighbours");
        let raw: serde_json::Value = client.get("/neighbours").await?;
        Self::parse_neighbours(&raw)
    }

    // ── Internal helpers ─────────────────────────────────────────────

    fn parse_workers(raw: &serde_json::Value) -> RspamdResult<Vec<RspamdWorker>> {
        let mut workers = Vec::new();

        // Workers may be nested under "workers" key
        let workers_val = raw.get("workers").unwrap_or(raw);

        if let Some(arr) = workers_val.as_array() {
            for item in arr {
                workers.push(RspamdWorker {
                    id: item
                        .get("id")
                        .and_then(|v| v.as_str().map(String::from).or_else(|| Some(v.to_string())))
                        .unwrap_or_default(),
                    worker_type: item.get("type").and_then(|v| v.as_str()).map(String::from),
                    pid: item.get("pid").and_then(|v| v.as_u64()),
                    status: item
                        .get("status")
                        .and_then(|v| v.as_str())
                        .map(String::from),
                });
            }
        } else if let Some(obj) = workers_val.as_object() {
            for (id, info) in obj {
                workers.push(RspamdWorker {
                    id: id.clone(),
                    worker_type: info.get("type").and_then(|v| v.as_str()).map(String::from),
                    pid: info.get("pid").and_then(|v| v.as_u64()),
                    status: info
                        .get("status")
                        .and_then(|v| v.as_str())
                        .map(String::from),
                });
            }
        }

        Ok(workers)
    }

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
