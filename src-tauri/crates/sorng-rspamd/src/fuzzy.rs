// ── rspamd fuzzy storage management ──────────────────────────────────────────

use crate::client::RspamdClient;
use crate::error::{RspamdErrorKind, RspamdResult};
use crate::scanning::ScanManager;
use crate::types::*;
use log::debug;

pub struct FuzzyManager;

impl FuzzyManager {
    /// GET /fuzzystatus — get fuzzy storage status
    pub async fn status(client: &RspamdClient) -> RspamdResult<Vec<RspamdFuzzyStatus>> {
        debug!("RSPAMD fuzzy_status");
        match client.get("/plugins/fuzzy/status").await {
            Ok(raw) => Self::parse_fuzzy_status(&raw, client).await,
            Err(error) if matches!(error.kind, RspamdErrorKind::NotFound) => {
                Self::parse_fuzzy_status(&serde_json::Value::Array(vec![]), client).await
            }
            Err(error) => Err(error),
        }
    }

    /// POST /checkv2 with fuzzy flag — check message against fuzzy storage
    pub async fn check(
        client: &RspamdClient,
        message: &str,
    ) -> RspamdResult<Vec<RspamdSymbolResult>> {
        debug!("RSPAMD fuzzy_check");
        // Perform a regular scan and filter for fuzzy-related symbols
        Ok(ScanManager::check_message(client, message)
            .await?
            .symbols
            .into_iter()
            .filter(|symbol| {
                let name = symbol.name.to_ascii_lowercase();
                name.contains("fuzzy") || name.contains("fuzz")
            })
            .collect())
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
