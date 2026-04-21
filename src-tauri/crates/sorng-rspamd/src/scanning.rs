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
        let url = "/fuzzyadd".to_string();
        let resp_text = client.post_raw(&url, message).await?;
        // Rspamd returns JSON on success; for fuzzyadd we use header-based params.
        // Use the client directly for better control.
        let full_url = format!("{}/fuzzyadd", client.config.base_url.trim_end_matches('/'));
        let mut req = reqwest::Client::new()
            .post(&full_url)
            .header("Content-Type", "text/plain")
            .header("Flag", flag.to_string())
            .header("Weight", weight.to_string())
            .body(message.to_string());
        if let Some(ref pw) = client.config.password {
            req = req.header("Password", pw.as_str());
        }
        let resp = req
            .send()
            .await
            .map_err(|e| RspamdError::connection(format!("POST /fuzzyadd: {e}")))?;
        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(RspamdError::api(format!("fuzzyadd failed: {body}")));
        }
        let _ = resp_text; // consumed above for initial attempt
        Ok(())
    }

    /// POST /fuzzydel — remove message from fuzzy storage
    pub async fn fuzzy_delete(client: &RspamdClient, message: &str, flag: u32) -> RspamdResult<()> {
        debug!("RSPAMD fuzzy_delete flag={flag}");
        let full_url = format!("{}/fuzzydel", client.config.base_url.trim_end_matches('/'));
        let mut req = reqwest::Client::new()
            .post(&full_url)
            .header("Content-Type", "text/plain")
            .header("Flag", flag.to_string())
            .body(message.to_string());
        if let Some(ref pw) = client.config.password {
            req = req.header("Password", pw.as_str());
        }
        let resp = req
            .send()
            .await
            .map_err(|e| RspamdError::connection(format!("POST /fuzzydel: {e}")))?;
        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(RspamdError::api(format!("fuzzydel failed: {body}")));
        }
        Ok(())
    }

    // ── Internal helpers ─────────────────────────────────────────────

    fn parse_scan_result(raw: &serde_json::Value) -> RspamdResult<RspamdScanResult> {
        let action = raw
            .get("action")
            .and_then(|v| v.as_str())
            .unwrap_or("no action")
            .to_string();
        let score = raw.get("score").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let required_score = raw
            .get("required_score")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
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
        if let Some(sym_obj) = raw.get("symbols").and_then(|v| v.as_object()) {
            for (name, info) in sym_obj {
                symbols.push(RspamdSymbolResult {
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
