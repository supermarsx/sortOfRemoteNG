// ── rspamd fuzzy storage management ──────────────────────────────────────────

use crate::client::RspamdClient;
use crate::error::{RspamdError, RspamdResult};
use crate::types::*;
use log::debug;

pub struct FuzzyManager;

impl FuzzyManager {
    /// GET /fuzzystatus — get fuzzy storage status
    pub async fn status(client: &RspamdClient) -> RspamdResult<Vec<RspamdFuzzyStatus>> {
        debug!("RSPAMD fuzzy_status");
        let raw: serde_json::Value = client.get("/plugins/fuzzy/status").await.or_else(
            |_| -> RspamdResult<serde_json::Value> {
                // Fallback: try stat endpoint and extract fuzzy_hashes section
                Ok(serde_json::Value::Array(vec![]))
            },
        )?;
        Self::parse_fuzzy_status(&raw, client).await
    }

    /// POST /checkv2 with fuzzy flag — check message against fuzzy storage
    pub async fn check(
        client: &RspamdClient,
        message: &str,
    ) -> RspamdResult<Vec<RspamdSymbolResult>> {
        debug!("RSPAMD fuzzy_check");
        // Perform a regular scan and filter for fuzzy-related symbols
        let full_url = format!("{}/checkv2", client.config.base_url.trim_end_matches('/'));
        let mut req = reqwest::Client::new()
            .post(&full_url)
            .header("Content-Type", "text/plain")
            .body(message.to_string());
        if let Some(ref pw) = client.config.password {
            req = req.header("Password", pw.as_str());
        }
        let resp = req
            .send()
            .await
            .map_err(|e| RspamdError::connection(format!("POST /checkv2: {e}")))?;
        let status = resp.status();
        let body_text = resp
            .text()
            .await
            .map_err(|e| RspamdError::parse(format!("read body: {e}")))?;
        if !status.is_success() {
            return Err(RspamdError::api(format!(
                "HTTP {}: {body_text}",
                status.as_u16()
            )));
        }
        let raw: serde_json::Value = serde_json::from_str(&body_text)
            .map_err(|e| RspamdError::parse(format!("json: {e}")))?;

        let mut results = Vec::new();
        if let Some(sym_obj) = raw.get("symbols").and_then(|v| v.as_object()) {
            for (name, info) in sym_obj {
                // Filter for fuzzy-related symbols
                let lower_name = name.to_lowercase();
                if lower_name.contains("fuzzy") || lower_name.contains("fuzz") {
                    results.push(RspamdSymbolResult {
                        name: name.clone(),
                        score: info.get("score").and_then(|v| v.as_f64()).unwrap_or(0.0),
                        weight: info.get("weight").and_then(|v| v.as_f64()),
                        description: info
                            .get("description")
                            .and_then(|v| v.as_str())
                            .map(String::from),
                        options: info
                            .get("options")
                            .and_then(|v| v.as_array())
                            .map(|arr| {
                                arr.iter()
                                    .filter_map(|v| v.as_str().map(String::from))
                                    .collect()
                            })
                            .unwrap_or_default(),
                        metric_score: info.get("metric_score").and_then(|v| v.as_f64()),
                    });
                }
            }
        }

        Ok(results)
    }

    // ── Internal helpers ─────────────────────────────────────────────

    async fn parse_fuzzy_status(
        raw: &serde_json::Value,
        client: &RspamdClient,
    ) -> RspamdResult<Vec<RspamdFuzzyStatus>> {
        // First try direct fuzzy status endpoint response
        if let Some(arr) = raw.as_array() {
            if !arr.is_empty() {
                let mut statuses = Vec::new();
                for item in arr {
                    statuses.push(RspamdFuzzyStatus {
                        name: item
                            .get("name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        version: item.get("version").and_then(|v| v.as_u64()),
                        size: item.get("size").and_then(|v| v.as_u64()),
                        buckets: item.get("buckets").and_then(|v| v.as_u64()),
                    });
                }
                return Ok(statuses);
            }
        }

        // Fallback: extract from /stat endpoint
        let stat_raw: serde_json::Value = client.get("/stat").await?;
        let mut statuses = Vec::new();

        if let Some(fh_obj) = stat_raw.get("fuzzy_hashes").and_then(|v| v.as_object()) {
            for (name, info) in fh_obj {
                statuses.push(RspamdFuzzyStatus {
                    name: name.clone(),
                    version: info.get("version").and_then(|v| v.as_u64()),
                    size: info.get("size").and_then(|v| v.as_u64()),
                    buckets: info.get("buckets").and_then(|v| v.as_u64()),
                });
            }
        }

        Ok(statuses)
    }
}
