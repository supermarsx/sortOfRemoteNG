// ── rspamd scanning operations ───────────────────────────────────────────────

use crate::client::RspamdClient;
use crate::error::{RspamdError, RspamdResult};
use crate::types::*;
use log::debug;

pub struct ScanManager;

impl ScanManager {
    /// POST /checkv2 — scan a message for spam
    pub async fn check_message(
        client: &RspamdClient,
        message: &str,
    ) -> RspamdResult<RspamdScanResult> {
        debug!("RSPAMD check_message");
        let raw: serde_json::Value = client.post_body("/checkv2", message).await?;
        Self::parse_scan_result(&raw)
    }

    /// POST /checkv2 — scan a file for spam (reads file, sends content)
    pub async fn check_file(client: &RspamdClient, path: &str) -> RspamdResult<RspamdScanResult> {
        debug!("RSPAMD check_file: {path}");
        let content = tokio::fs::read_to_string(path).await.map_err(|e| {
            RspamdError::new(
                crate::error::RspamdErrorKind::ProcessError,
                format!("read file {path}: {e}"),
            )
        })?;
        let raw: serde_json::Value = client.post_body("/checkv2", &content).await?;
        Self::parse_scan_result(&raw)
    }

    /// POST /learnspam — train Bayes classifier with spam message
    pub async fn learn_spam(
        client: &RspamdClient,
        message: &str,
    ) -> RspamdResult<RspamdBayesLearnResult> {
        debug!("RSPAMD learn_spam");
        let raw: serde_json::Value = client.post_body("/learnspam", message).await?;
        Ok(RspamdBayesLearnResult {
            success: raw
                .get("success")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            message: raw
                .get("message")
                .and_then(|v| v.as_str())
                .map(String::from),
        })
    }

    /// POST /learnham — train Bayes classifier with ham message
    pub async fn learn_ham(
        client: &RspamdClient,
        message: &str,
    ) -> RspamdResult<RspamdBayesLearnResult> {
        debug!("RSPAMD learn_ham");
        let raw: serde_json::Value = client.post_body("/learnham", message).await?;
        Ok(RspamdBayesLearnResult {
            success: raw
                .get("success")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            message: raw
                .get("message")
                .and_then(|v| v.as_str())
                .map(String::from),
        })
    }

    /// POST /fuzzyadd — add message to fuzzy storage
    pub async fn fuzzy_add(
        client: &RspamdClient,
        message: &str,
        flag: u32,
        weight: f64,
    ) -> RspamdResult<()> {
        debug!("RSPAMD fuzzy_add flag={flag} weight={weight}");
        client
            .post_body_with_headers(
                "/fuzzyadd",
                message,
                &[("Flag", flag.to_string()), ("Weight", weight.to_string())],
            )
            .await
    }

    /// POST /fuzzydel — remove message from fuzzy storage
    pub async fn fuzzy_delete(client: &RspamdClient, message: &str, flag: u32) -> RspamdResult<()> {
        debug!("RSPAMD fuzzy_delete flag={flag}");
        client
            .post_body_with_headers("/fuzzydel", message, &[("Flag", flag.to_string())])
            .await
    }

    // ── Internal helpers ─────────────────────────────────────────────

    fn parse_scan_result(raw: &serde_json::Value) -> RspamdResult<RspamdScanResult> {
        let object = raw
            .as_object()
            .ok_or_else(|| RspamdError::parse("Rspamd scan response must be a JSON object"))?;
        let action = raw
            .get("action")
            .and_then(|v| v.as_str())
            .filter(|action| !action.trim().is_empty())
            .ok_or_else(|| RspamdError::parse("Rspamd scan response is missing action"))?
            .to_string();
        let score = raw
            .get("score")
            .and_then(|v| v.as_f64())
            .ok_or_else(|| RspamdError::parse("Rspamd scan response is missing score"))?;
        let required_score = raw
            .get("required_score")
            .and_then(|v| v.as_f64())
            .ok_or_else(|| RspamdError::parse("Rspamd scan response is missing required_score"))?;
        let is_skipped = raw
            .get("is_skipped")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let is_spam = action == "reject"
            || action == "soft reject"
            || action == "rewrite subject"
            || action == "add header"
            || score >= required_score;
        let message_id = raw
            .get("message-id")
            .or_else(|| raw.get("message_id"))
            .and_then(|v| v.as_str())
            .map(String::from);
        let subject = raw
            .get("subject")
            .and_then(|v| v.as_str())
            .map(String::from);

        // Parse symbols from the symbols map
        let mut symbols = Vec::new();
        if let Some(sym_obj) = object.get("symbols").and_then(|v| v.as_object()) {
            for (name, info) in sym_obj {
                symbols.push(RspamdSymbolResult {
                    name: name.clone(),
                    score: info.get("score").and_then(|v| v.as_f64()).ok_or_else(|| {
                        RspamdError::parse(format!(
                            "Rspamd scan symbol '{name}' is missing its score"
                        ))
                    })?,
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

        // Parse urls
        let urls = raw
            .get("urls")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();

        // Parse emails
        let emails = raw
            .get("emails")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();

        Ok(RspamdScanResult {
            is_spam,
            is_skipped,
            score,
            required_score,
            action,
            symbols,
            message_id,
            urls,
            emails,
            subject,
        })
    }
}
