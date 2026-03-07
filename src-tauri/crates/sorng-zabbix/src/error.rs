// ─── Zabbix – Error types ────────────────────────────────────────────────────

use std::fmt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum ZabbixError {
    ConnectionFailed(String),
    AuthenticationFailed(String),
    SessionExpired,
    NotFound { resource: String, id: String },
    HostNotFound(String),
    TemplateNotFound(String),
    ItemError(String),
    TriggerError(String),
    DiscoveryError(String),
    MaintenanceError(String),
    ApiError { code: i32, message: String, data: Option<String> },
    PermissionDenied(String),
    ParseError(String),
    Timeout(String),
    Other(String),
}

impl fmt::Display for ZabbixError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ConnectionFailed(m) => write!(f, "connection failed: {m}"),
            Self::AuthenticationFailed(m) => write!(f, "authentication failed: {m}"),
            Self::SessionExpired => write!(f, "session expired"),
            Self::NotFound { resource, id } => write!(f, "{resource} not found: {id}"),
            Self::HostNotFound(m) => write!(f, "host not found: {m}"),
            Self::TemplateNotFound(m) => write!(f, "template not found: {m}"),
            Self::ItemError(m) => write!(f, "item error: {m}"),
            Self::TriggerError(m) => write!(f, "trigger error: {m}"),
            Self::DiscoveryError(m) => write!(f, "discovery error: {m}"),
            Self::MaintenanceError(m) => write!(f, "maintenance error: {m}"),
            Self::ApiError { code, message, data } => {
                write!(f, "API error {code}: {message}")?;
                if let Some(d) = data {
                    write!(f, " ({d})")?;
                }
                Ok(())
            }
            Self::PermissionDenied(m) => write!(f, "permission denied: {m}"),
            Self::ParseError(m) => write!(f, "parse error: {m}"),
            Self::Timeout(m) => write!(f, "timeout: {m}"),
            Self::Other(m) => write!(f, "{m}"),
        }
    }
}

impl std::error::Error for ZabbixError {}

impl From<reqwest::Error> for ZabbixError {
    fn from(e: reqwest::Error) -> Self {
        if e.is_timeout() {
            Self::Timeout(e.to_string())
        } else if e.is_connect() {
            Self::ConnectionFailed(e.to_string())
        } else {
            Self::Other(e.to_string())
        }
    }
}

impl From<serde_json::Error> for ZabbixError {
    fn from(e: serde_json::Error) -> Self {
        Self::ParseError(e.to_string())
    }
}

impl From<ZabbixError> for String {
    fn from(e: ZabbixError) -> Self {
        e.to_string()
    }
}

pub fn err_str(e: ZabbixError) -> String {
    e.to_string()
}

pub type ZabbixResult<T> = Result<T, ZabbixError>;
