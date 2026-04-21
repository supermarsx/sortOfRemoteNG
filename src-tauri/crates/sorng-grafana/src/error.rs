// ── sorng-grafana/src/error.rs ───────────────────────────────────────────────
//! Crate-local error types for Grafana operations.

use std::fmt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GrafanaErrorKind {
    NotConnected,
    AlreadyConnected,
    ConnectionFailed,
    AuthenticationFailed,
    DashboardNotFound,
    DatasourceNotFound,
    FolderNotFound,
    OrgNotFound,
    UserNotFound,
    TeamNotFound,
    AlertNotFound,
    AnnotationNotFound,
    PlaylistNotFound,
    SnapshotNotFound,
    PanelNotFound,
    PermissionDenied,
    Conflict,
    InvalidRequest,
    ApiError,
    HttpError,
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
        Self {
            kind,
            message: msg.into(),
        }
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
    pub fn permission_denied(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::PermissionDenied, msg)
    }
    pub fn conflict(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::Conflict, msg)
    }
    pub fn api(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::ApiError, msg)
    }
    pub fn http(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::HttpError, msg)
    }
    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::ParseError, msg)
    }
    pub fn invalid_request(msg: impl Into<String>) -> Self {
        Self::new(GrafanaErrorKind::InvalidRequest, msg)
    }
    pub fn not_found(kind: GrafanaErrorKind, name: &str) -> Self {
        Self::new(kind, format!("Not found: {name}"))
    }
    pub fn dashboard_not_found(name: &str) -> Self {
        Self::not_found(GrafanaErrorKind::DashboardNotFound, name)
    }
    pub fn datasource_not_found(name: &str) -> Self {
        Self::not_found(GrafanaErrorKind::DatasourceNotFound, name)
    }
    pub fn folder_not_found(name: &str) -> Self {
        Self::not_found(GrafanaErrorKind::FolderNotFound, name)
    }
    pub fn org_not_found(name: &str) -> Self {
        Self::not_found(GrafanaErrorKind::OrgNotFound, name)
    }
    pub fn user_not_found(name: &str) -> Self {
        Self::not_found(GrafanaErrorKind::UserNotFound, name)
    }
    pub fn team_not_found(name: &str) -> Self {
        Self::not_found(GrafanaErrorKind::TeamNotFound, name)
    }
    pub fn alert_not_found(name: &str) -> Self {
        Self::not_found(GrafanaErrorKind::AlertNotFound, name)
    }
    pub fn annotation_not_found(name: &str) -> Self {
        Self::not_found(GrafanaErrorKind::AnnotationNotFound, name)
    }
    pub fn playlist_not_found(name: &str) -> Self {
        Self::not_found(GrafanaErrorKind::PlaylistNotFound, name)
    }
    pub fn snapshot_not_found(name: &str) -> Self {
        Self::not_found(GrafanaErrorKind::SnapshotNotFound, name)
    }
    pub fn panel_not_found(name: &str) -> Self {
        Self::not_found(GrafanaErrorKind::PanelNotFound, name)
    }
}

pub type GrafanaResult<T> = Result<T, GrafanaError>;
