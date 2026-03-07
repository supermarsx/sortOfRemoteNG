//! Crate-local error types for Prometheus operations.

use std::fmt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PrometheusErrorKind {
    NotConnected,
    ConnectionFailed,
    AuthenticationFailed,
    ApiError,
    QueryFailed,
    InvalidQuery,
    TargetNotFound,
    RuleNotFound,
    AlertNotFound,
    ConfigError,
    ReloadFailed,
    SnapshotError,
    TsdbError,
    FederationError,
    SshError,
    ParseError,
    CommandFailed,
    Timeout,
    InternalError,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PrometheusError {
    pub kind: PrometheusErrorKind,
    pub message: String,
}

impl fmt::Display for PrometheusError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for PrometheusError {}

impl PrometheusError {
    pub fn new(kind: PrometheusErrorKind, msg: impl Into<String>) -> Self {
        Self { kind, message: msg.into() }
    }
    pub fn not_connected(msg: impl Into<String>) -> Self {
        Self::new(PrometheusErrorKind::NotConnected, msg)
    }
    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(PrometheusErrorKind::ConnectionFailed, msg)
    }
    pub fn auth(msg: impl Into<String>) -> Self {
        Self::new(PrometheusErrorKind::AuthenticationFailed, msg)
    }
    pub fn api(msg: impl Into<String>) -> Self {
        Self::new(PrometheusErrorKind::ApiError, msg)
    }
    pub fn query_failed(msg: impl Into<String>) -> Self {
        Self::new(PrometheusErrorKind::QueryFailed, msg)
    }
    pub fn invalid_query(msg: impl Into<String>) -> Self {
        Self::new(PrometheusErrorKind::InvalidQuery, msg)
    }
    pub fn target_not_found(msg: impl Into<String>) -> Self {
        Self::new(PrometheusErrorKind::TargetNotFound, msg)
    }
    pub fn rule_not_found(msg: impl Into<String>) -> Self {
        Self::new(PrometheusErrorKind::RuleNotFound, msg)
    }
    pub fn alert_not_found(msg: impl Into<String>) -> Self {
        Self::new(PrometheusErrorKind::AlertNotFound, msg)
    }
    pub fn config(msg: impl Into<String>) -> Self {
        Self::new(PrometheusErrorKind::ConfigError, msg)
    }
    pub fn reload(msg: impl Into<String>) -> Self {
        Self::new(PrometheusErrorKind::ReloadFailed, msg)
    }
    pub fn snapshot(msg: impl Into<String>) -> Self {
        Self::new(PrometheusErrorKind::SnapshotError, msg)
    }
    pub fn tsdb(msg: impl Into<String>) -> Self {
        Self::new(PrometheusErrorKind::TsdbError, msg)
    }
    pub fn federation(msg: impl Into<String>) -> Self {
        Self::new(PrometheusErrorKind::FederationError, msg)
    }
    pub fn ssh(msg: impl fmt::Display) -> Self {
        Self::new(PrometheusErrorKind::SshError, msg.to_string())
    }
    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(PrometheusErrorKind::ParseError, msg)
    }
    pub fn command_failed(msg: impl Into<String>) -> Self {
        Self::new(PrometheusErrorKind::CommandFailed, msg)
    }
    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(PrometheusErrorKind::Timeout, msg)
    }
    pub fn internal(msg: impl Into<String>) -> Self {
        Self::new(PrometheusErrorKind::InternalError, msg)
    }
    pub fn http(e: impl fmt::Display) -> Self {
        Self::new(PrometheusErrorKind::ConnectionFailed, e.to_string())
    }
}

pub type PrometheusResult<T> = Result<T, PrometheusError>;
