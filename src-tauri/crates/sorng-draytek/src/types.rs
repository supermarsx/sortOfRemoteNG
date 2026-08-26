//! Domain types for the DrayTek integration. Field names are snake_case and
//! serialised verbatim by Tauri (mirrors `sorng-pfsense`).

use serde::{Deserialize, Serialize};

/// Default vendor tag; UniFi / MikroTik may later reuse the same panel shell.
pub const DEFAULT_VENDOR: &str = "draytek";

// ── Connection ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DraytekConnectionConfig {
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
    #[serde(default = "default_true")]
    pub use_tls: bool,
    #[serde(default)]
    pub accept_invalid_certs: bool,
    /// Runtime-only acknowledgement for this insecure connection attempt.
    #[serde(default, skip_serializing)]
    pub acknowledge_invalid_cert_risk: bool,
    #[serde(default = "default_timeout")]
    pub timeout_secs: u64,
    #[serde(default, alias = "proxyUrl")]
    pub proxy_url: Option<String>,
    #[serde(default = "default_vendor")]
    pub vendor: String,
}

impl Default for DraytekConnectionConfig {
    fn default() -> Self {
        Self {
            host: String::new(),
            port: default_port(),
            username: String::new(),
            password: String::new(),
            use_tls: true,
            accept_invalid_certs: false,
            acknowledge_invalid_cert_risk: false,
            timeout_secs: default_timeout(),
            proxy_url: None,
            vendor: default_vendor(),
        }
    }
}

fn default_true() -> bool {
    true
}
fn default_port() -> u16 {
    443
}
fn default_timeout() -> u64 {
    30
}
fn default_vendor() -> String {
    DEFAULT_VENDOR.to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DraytekConnectionSummary {
    pub host: String,
    pub vendor: String,
    pub model: Option<String>,
    pub firmware: Option<String>,
    pub hostname: Option<String>,
}

// ── Status ───────────────────────────────────────────────────────

/// One WAN interface as reported by the status page or `wan status` CLI.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct WanStatus {
    pub name: String,
    /// Raw link state as reported ("Up", "Down", "Connected", ...).
    pub state: Option<String>,
    pub ip: Option<String>,
    pub gateway: Option<String>,
    pub mode: Option<String>,
    pub uptime: Option<String>,
}

impl WanStatus {
    /// Whether the reported state reads as an active link.
    pub fn is_up(&self) -> bool {
        matches!(
            self.state
                .as_deref()
                .map(str::to_ascii_lowercase)
                .as_deref(),
            Some("up") | Some("connected") | Some("online")
        )
    }
}

/// Device status; every field is optional — never hard-fail on a field a
/// model omits.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DraytekStatus {
    pub model: Option<String>,
    pub firmware: Option<String>,
    pub build: Option<String>,
    pub hostname: Option<String>,
    pub uptime: Option<String>,
    #[serde(default)]
    pub wan: Vec<WanStatus>,
}

// ── Actions ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DraytekRebootResult {
    pub accepted: bool,
    pub message: String,
}

// ── CLI ──────────────────────────────────────────────────────────

/// Whitelisted DrayOS CLI verbs executed over an existing SSH/telnet session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DraytekCliVerb {
    SysVersion,
    WanStatus,
    SysReboot,
}

/// Parsed `sys version` output.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DraytekCliVersion {
    pub model: Option<String>,
    pub firmware: Option<String>,
    pub build: Option<String>,
}
