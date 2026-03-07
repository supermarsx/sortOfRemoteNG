//! Crate-local error types for Grafana operations.

use std::fmt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GrafanaErrorKind {
    NotConnected,
    AlreadyConnected,
    ConnectionFailed,
    AuthenticationFailed,
    ApiError,
    DashboardNotFound,
    DatasourceNotFound,
    FolderNotFound,
    OrgNotFound,
    UserNotFound,
    TeamNotFound,
    AlertNotFound,
    PluginNotFound,
    PermissionDenied,
    ConflictError,
    ValidationError,
    ParseError,
    Timeout,
    InternalError,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct GrafanaError {
    pub kind: GrafanaErrorKind,
    pub message: String,
}

impl fmt::Display for GrafanaError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for GrafanaError {}

impl GrafanaError {
    pub fn new(kind: GrafanaErrorKind, msg: impl Into<String>) -> Self {
        Self { kind, message: msg.into() }
    }
    pub fn not_connected() -> Self {
        Self::new(GrafanaErrorKind::NotConnected, "Not connected to Grafana")
    }
    pub fn already_connected() -> Self {
        Self::new(GrafanaErrorKind::AlreadyConnected, "Already connected to Grafana")
    }
    pub fn connection_failed(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::ConnectionFailed, msg)
    }
    pub fn auth_failed(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::AuthenticationFailed, msg)
    }
    pub fn api_error(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::ApiError, msg)
    }
    pub fn dashboard_not_found(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::DashboardNotFound, msg)
    }
    pub fn datasource_not_found(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::DatasourceNotFound, msg)
    }
    pub fn folder_not_found(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::FolderNotFound, msg)
    }
    pub fn org_not_found(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::OrgNotFound, msg)
    }
    pub fn user_not_found(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::UserNotFound, msg)
    }
    pub fn team_not_found(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::TeamNotFound, msg)
    }
    pub fn alert_not_found(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::AlertNotFound, msg)
    }
    pub fn plugin_not_found(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::PluginNotFound, msg)
    }
    pub fn permission_denied(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::PermissionDenied, msg)
    }
    pub fn conflict(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::ConflictError, msg)
    }
    pub fn validation(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::ValidationError, msg)
    }
    pub fn parse_error(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::ParseError, msg)
    }
    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::Timeout, msg)
    }
    pub fn internal(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::InternalError, msg)
    }
}

impl From<reqwest::Error> for GrafanaError {
    fn from(e: reqwest::Error) -> Self {
        if e.is_timeout() {
            Self::timeout(e.to_string())
        } else if e.is_connect() {
            Self::connection_failed(e.to_string())
        } else {
            Self::api_error(e.to_string())
        }
    }
}

impl From<serde_json::Error> for GrafanaError {
    fn from(e: serde_json::Error) -> Self {
        Self::parse_error(e.to_string())
    }
}

pub type GrafanaResult<T> = Result<T, GrafanaError>;
