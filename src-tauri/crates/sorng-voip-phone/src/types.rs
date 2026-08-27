//! Public types shared with the frontend (camelCase over the boundary).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum VoipPhoneVendor {
    #[default]
    Yealink,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum VoipPhoneAuthMode {
    /// Probe the phone and pick the shape (recommended).
    #[default]
    Auto,
    /// Force HTTP Basic against the legacy CGI UI.
    Basic,
    /// Force the servlet login form.
    Form,
}

/// Web-UI firmware generation as classified by the probe.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum VoipPhoneGeneration {
    /// `/cgi-bin/ConfigManApp.com` + HTTP Basic (T20P/T21P/T2xP on v7x).
    Legacy,
    /// `/servlet?m=mod_listener…` form login + `JSESSIONID` (T21P E2, v8x+).
    Servlet,
}

impl VoipPhoneGeneration {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Legacy => "legacy",
            Self::Servlet => "servlet",
        }
    }
}

/// Login shape used (or attempted).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum VoipPhoneAuthShape {
    Basic,
    FormPlain,
    FormRsa,
}

impl VoipPhoneAuthShape {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Basic => "basic",
            Self::FormPlain => "form-plain",
            Self::FormRsa => "form-rsa",
        }
    }
}

fn default_port() -> u16 {
    80
}
fn default_timeout() -> u64 {
    15
}
fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoipPhoneConnectionConfig {
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default)]
    pub use_ssl: bool,
    /// `false` maps to an explicit AlwaysTrust override in the Trust Center
    /// (visible + revocable), never to a blind certificate skip.
    #[serde(default = "default_true")]
    pub verify_cert: bool,
    #[serde(default)]
    pub vendor: VoipPhoneVendor,
    pub username: String,
    #[serde(skip_serializing)]
    pub password: String,
    #[serde(default = "default_timeout")]
    pub timeout_secs: u64,
    #[serde(default)]
    pub auth_mode: VoipPhoneAuthMode,
    /// Whether the phone's "Features → Remote Control → Action URI" allow
    /// list includes us. When `false`, reboot skips straight to the web form.
    #[serde(default)]
    pub action_uri_enabled: bool,
}

impl Default for VoipPhoneConnectionConfig {
    fn default() -> Self {
        Self {
            host: String::new(),
            port: default_port(),
            use_ssl: false,
            verify_cert: true,
            vendor: VoipPhoneVendor::Yealink,
            username: String::from("admin"),
            password: String::new(),
            timeout_secs: default_timeout(),
            auth_mode: VoipPhoneAuthMode::Auto,
            action_uri_enabled: false,
        }
    }
}

impl VoipPhoneConnectionConfig {
    pub fn base_url(&self) -> String {
        let scheme = if self.use_ssl { "https" } else { "http" };
        format!("{}://{}:{}", scheme, self.host, self.port)
    }
}

/// Safe view of the config (no password).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoipPhoneConfigSafe {
    pub host: String,
    pub port: u16,
    pub use_ssl: bool,
    pub verify_cert: bool,
    pub vendor: VoipPhoneVendor,
    pub username: String,
    pub timeout_secs: u64,
    pub auth_mode: VoipPhoneAuthMode,
    pub action_uri_enabled: bool,
}

impl From<&VoipPhoneConnectionConfig> for VoipPhoneConfigSafe {
    fn from(c: &VoipPhoneConnectionConfig) -> Self {
        Self {
            host: c.host.clone(),
            port: c.port,
            use_ssl: c.use_ssl,
            verify_cert: c.verify_cert,
            vendor: c.vendor,
            username: c.username.clone(),
            timeout_secs: c.timeout_secs,
            auth_mode: c.auth_mode,
            action_uri_enabled: c.action_uri_enabled,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoipAccountStatus {
    pub index: u32,
    pub label: String,
    pub user: Option<String>,
    pub server: Option<String>,
    pub registered: bool,
    pub raw_state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoipPhoneStatus {
    pub vendor: VoipPhoneVendor,
    pub model: Option<String>,
    pub firmware: Option<String>,
    pub hardware: Option<String>,
    pub mac: Option<String>,
    pub ip: Option<String>,
    pub uptime: Option<String>,
    pub generation: VoipPhoneGeneration,
    pub auth_shape: VoipPhoneAuthShape,
    pub accounts: Vec<VoipAccountStatus>,
    /// Every label/value pair scraped from the status page (diagnostics).
    pub raw_fields: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoipPhoneSessionSummary {
    pub id: String,
    pub host: String,
    pub vendor: VoipPhoneVendor,
    pub generation: VoipPhoneGeneration,
    pub auth_shape: VoipPhoneAuthShape,
    pub web_ui_url: String,
}

/// Result of `probe` (detection only, no login).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoipPhoneProbeResult {
    pub vendor: VoipPhoneVendor,
    pub generation: VoipPhoneGeneration,
    pub web_ui_url: String,
    /// The login shape the driver will try first for this generation.
    pub expected_auth_shape: VoipPhoneAuthShape,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum VoipRebootMethod {
    ActionUri,
    WebForm,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoipRebootResult {
    pub method: VoipRebootMethod,
    pub accepted: bool,
}

/// Selectors for the embedded-browser auto-login (proxy-mediated `http`
/// session). `form_login == false` means HTTP Basic: the proxy injects the
/// `Authorization` header and no selectors are needed.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebLoginHint {
    pub form_login: bool,
    pub login_url: String,
    pub username_selector: Option<String>,
    pub password_selector: Option<String>,
    pub submit_selector: Option<String>,
    /// Human-readable note for the UI (e.g. why the native login may fail on
    /// v8x+ firmware while the browser auto-login still works).
    pub note: Option<String>,
}
