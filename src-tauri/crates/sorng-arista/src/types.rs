//! Serializable types for the Arista EOS fan-speed collector.

use serde::{Deserialize, Serialize};

/// Connection parameters for the EOS eAPI (HTTP(S) JSON-RPC at `/command-api`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AristaConfig {
    pub host: String,
    /// Defaults to 443 (https) or 80 (http).
    #[serde(default)]
    pub port: Option<u16>,
    pub username: String,
    #[serde(default)]
    pub password: String,
    /// Use HTTPS (default true).
    #[serde(default = "default_true")]
    pub use_https: bool,
    /// Accept self-signed / untrusted certificates (common on switches).
    #[serde(default)]
    pub insecure_tls: bool,
    /// Request timeout in seconds (default 15).
    #[serde(default)]
    pub timeout_secs: Option<u64>,
}

fn default_true() -> bool {
    true
}

/// One fan, either in a fan tray or inside a power supply.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AristaFan {
    /// Owning slot (fan tray or power supply) label.
    pub tray_label: String,
    /// `fanTray` or `powerSupply`.
    pub tray_kind: String,
    pub fan_label: String,
    pub status: Option<String>,
    pub actual_speed_pct: Option<f64>,
    pub configured_speed_pct: Option<f64>,
    pub rpm: Option<u32>,
    pub max_rpm: Option<u32>,
    pub uptime_secs: Option<f64>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AristaCoolingReport {
    pub system_status: Option<String>,
    pub airflow: Option<String>,
    pub ambient_c: Option<f64>,
    pub fans: Vec<AristaFan>,
    /// The CLI command that produced the data.
    pub source: String,
}
