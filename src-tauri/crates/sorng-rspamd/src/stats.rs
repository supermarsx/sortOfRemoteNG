// ── rspamd statistics management ─────────────────────────────────────────────

use crate::client::RspamdClient;
use crate::error::{RspamdError, RspamdResult};
use crate::types::*;
use log::debug;
use std::collections::HashMap;

pub struct StatsManager;

impl StatsManager {
    /// GET /stat — retrieve comprehensive statistics
    pub async fn get_stats(client: &RspamdClient) -> RspamdResult<RspamdStat> {
        debug!("RSPAMD get_stats");
        let raw: serde_json::Value = client.get("/stat").await?;
        Self::parse_stat(&raw)
    }

    /// GET /graph?type=<graph_type> — retrieve graph data
    pub async fn get_graph(
        client: &RspamdClient,
        graph_type: &str,
    ) -> RspamdResult<Vec<RspamdGraphData>> {
        debug!("RSPAMD get_graph type={graph_type}");
        let path = format!("/graph?type={}", graph_type);
        let raw: serde_json::Value = client.get(&path).await?;
        Self::parse_graph_data(&raw)
    }

    /// GET /graph?type=throughput — retrieve throughput graph data
    pub async fn get_throughput(client: &RspamdClient) -> RspamdResult<Vec<RspamdGraphData>> {
        debug!("RSPAMD get_throughput");
        Self::get_graph(client, "throughput").await
    }

    /// POST /statreset — reset all statistics counters
    pub async fn reset_stats(client: &RspamdClient) -> RspamdResult<()> {
        debug!("RSPAMD reset_stats");
        client.post_no_body("/statreset").await
    }

    /// GET /errors — retrieve error log entries
    pub async fn get_errors(client: &RspamdClient) -> RspamdResult<Vec<String>> {
        debug!("RSPAMD get_errors");
        let raw: serde_json::Value = client.get("/errors").await?;
        let errors = match raw {
            serde_json::Value::Array(arr) => arr
                .iter()
                .map(|v| {
                    if let Some(s) = v.as_str() {
                        s.to_string()
                    } else {
                        v.to_string()
                    }
                })
                .collect(),
            serde_json::Value::String(s) => vec![s],
            other => vec![other.to_string()],
        };
        Ok(errors)
    }

    // ── Internal helpers ─────────────────────────────────────────────

    fn parse_stat(raw: &serde_json::Value) -> RspamdResult<RspamdStat> {
        let scanned = raw.get("scanned").and_then(|v| v.as_u64()).unwrap_or(0);
        let learned = raw.get("learned").and_then(|v| v.as_u64()).unwrap_or(0);
        let spam_count = raw.get("spam_count").and_then(|v| v.as_u64()).unwrap_or(0);
        let ham_count = raw.get("ham_count").and_then(|v| v.as_u64()).unwrap_or(0);
        let connections = raw.get("connections").and_then(|v| v.as_u64()).unwrap_or(0);
        let control_connections = raw
            .get("control_connections")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let pools_allocated = raw
            .get("pools_allocated")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let pools_freed = raw.get("pools_freed").and_then(|v| v.as_u64()).unwrap_or(0);
        let bytes_allocated = raw
            .get("bytes_allocated")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let chunks_allocated = raw
            .get("chunks_allocated")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let shared_chunks_allocated = raw
            .get("shared_chunks_allocated")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let chunks_oversized = raw
            .get("chunks_oversized")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);

        // Parse fuzzy hashes
        let mut fuzzy_hashes = HashMap::new();
        if let Some(fh_obj) = raw.get("fuzzy_hashes").and_then(|v| v.as_object()) {
            for (name, info) in fh_obj {
                fuzzy_hashes.insert(
                    name.clone(),
                    RspamdFuzzyHash {
                        version: info.get("version").and_then(|v| v.as_u64()),
                        size: info.get("size").and_then(|v| v.as_u64()),
                        buckets: info.get("buckets").and_then(|v| v.as_u64()),
                    },
                );
            }
        }

        // Parse statfiles
        let statfiles = raw
            .get("statfiles")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .map(|sf| RspamdStatfile {
                        symbol: sf
                            .get("symbol")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        type_name: sf.get("type").and_then(|v| v.as_str()).map(String::from),
                        size: sf.get("size").and_then(|v| v.as_u64()),
                        used: sf.get("used").and_then(|v| v.as_u64()),
                        total: sf.get("total").and_then(|v| v.as_u64()),
                        languages: sf.get("languages").and_then(|v| v.as_u64()),
                        users: sf.get("users").and_then(|v| v.as_u64()),
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(RspamdStat {
            scanned,
            learned,
            spam_count,
            ham_count,
            connections,
            control_connections,
            pools_allocated,
            pools_freed,
            bytes_allocated,
            chunks_allocated,
            shared_chunks_allocated,
            chunks_oversized,
            fuzzy_hashes,
            statfiles,
        })
    }

    fn parse_graph_data(raw: &serde_json::Value) -> RspamdResult<Vec<RspamdGraphData>> {
        match raw {
            serde_json::Value::Array(arr) => {
                let mut result = Vec::new();
                for item in arr {
                    let label = item
                        .get("label")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let data = item
                        .get("data")
                        .and_then(|v| v.as_array())
                        .map(|points| {
                            points
                                .iter()
                                .map(|p| {
                                    if let Some(arr) = p.as_array() {
                                        arr.iter().filter_map(|v| v.as_f64()).collect()
                                    } else {
                                        vec![]
                                    }
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    result.push(RspamdGraphData { label, data });
                }
                Ok(result)
            }
            serde_json::Value::Object(obj) => {
                let mut result = Vec::new();
                for (label, data_val) in obj {
                    let data = data_val
                        .as_array()
                        .map(|points| {
                            points
                                .iter()
                                .map(|p| {
                                    if let Some(arr) = p.as_array() {
                                        arr.iter().filter_map(|v| v.as_f64()).collect()
                                    } else {
                                        vec![]
                                    }
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    result.push(RspamdGraphData {
                        label: label.clone(),
                        data,
                    });
                }
                Ok(result)
            }
            _ => Err(RspamdError::parse("unexpected graph data format")),
        }
    }
}
