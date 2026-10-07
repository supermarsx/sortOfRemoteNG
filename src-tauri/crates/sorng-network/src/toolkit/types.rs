use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolkitRequest {
    pub job_id: String,
    pub tool: String,
    #[serde(default)]
    pub target: String,
    pub timeout_ms: u64,
    pub route: String,
    #[serde(default)]
    pub proxy_url: Option<String>,
    #[serde(default)]
    pub options: BTreeMap<String, String>,
}

impl ToolkitRequest {
    pub fn option(&self, key: &str) -> Option<&str> {
        self.options
            .get(key)
            .map(String::as_str)
            .filter(|s| !s.is_empty())
    }

    pub fn number(&self, key: &str, default: u64, min: u64, max: u64) -> Result<u64, String> {
        let value = self
            .option(key)
            .map(str::parse::<u64>)
            .transpose()
            .map_err(|_| format!("{key} must be a whole number"))?
            .unwrap_or(default);
        if !(min..=max).contains(&value) {
            return Err(format!("{key} must be between {min} and {max}"));
        }
        Ok(value)
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolkitReport {
    pub job_id: String,
    pub tool: String,
    pub started_at: String,
    pub duration_ms: u64,
    pub route: String,
    pub data: serde_json::Value,
}
