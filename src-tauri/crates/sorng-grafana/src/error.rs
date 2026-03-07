//! Crate-local error types for Grafana operations.

use std::fmt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GrafanaErrorKind {
    NotConnected,
    ConnectionFailed,
    AuthenticationFailed,
    ApiError,
    Forbidden,
    DashboardNotFound,
    DatasourceNotFound,
    FolderNotFound,
    UserNotFound,
    OrgNotFound,
    AlertNotFound,
    AnnotationNotFound,
    PlaylistNotFound,
    ApiKeyNotFound,
    PluginNotFound,
    PanelNotFound,
    TeamNotFound,
    SnapshotNotFound,
    SshError,
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
    pub fn not_connected(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::NotConnected, msg)
    }
    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::ConnectionFailed, msg)
    }
    pub fn auth(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::AuthenticationFailed, msg)
    }
    pub fn api(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::ApiError, msg)
    }
    pub fn forbidden(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::Forbidden, msg)
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
    pub fn user_not_found(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::UserNotFound, msg)
    }
    pub fn org_not_found(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::OrgNotFound, msg)
    }
    pub fn alert_not_found(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::AlertNotFound, msg)
    }
    pub fn annotation_not_found(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::AnnotationNotFound, msg)
    }
    pub fn playlist_not_found(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::PlaylistNotFound, msg)
    }
    pub fn api_key_not_found(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::ApiKeyNotFound, msg)
    }
    pub fn plugin_not_found(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::PluginNotFound, msg)
    }
    pub fn panel_not_found(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::PanelNotFound, msg)
    }
    pub fn team_not_found(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::TeamNotFound, msg)
    }
    pub fn snapshot_not_found(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::SnapshotNotFound, msg)
    }
    pub fn ssh(e: impl fmt::Display) -> Self {
        Self::new(GrafanaErrorKind::SshError, e.to_string())
    }
    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::ParseError, msg)
    }
    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::Timeout, msg)
    }
    pub fn internal(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::InternalError, msg)
    }
    pub fn http(e: impl fmt::Display) -> Self {
        Self::new(GrafanaErrorKind::ConnectionFailed, e.to_string())
    }
}

pub type GrafanaResult<T> = Result<T, GrafanaError>;
