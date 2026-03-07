// ── sorng-etcd/src/error.rs ──────────────────────────────────────────────────
//! Crate-local error types for etcd operations.

use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EtcdErrorKind {
    NotConnected,
    ConnectionFailed,
    AuthenticationFailed,
    KeyNotFound,
    LeaseNotFound,
    PermissionDenied,
    ClusterUnavailable,
    LeaderLost,
    Timeout,
    InvalidArgument,
    RequestTooLarge,
    TooManyRequests,
    Internal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EtcdError {
    pub kind: EtcdErrorKind,
    pub message: String,
}

impl fmt::Display for EtcdError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[etcd::{:?}] {}", self.kind, self.message)
    }
}

impl std::error::Error for EtcdError {}

impl EtcdError {
    pub fn new(kind: EtcdErrorKind, msg: impl Into<String>) -> Self {
        Self { kind, message: msg.into() }
    }
    pub fn not_connected(msg: impl Into<String>) -> Self {
        Self::new(EtcdErrorKind::NotConnected, msg)
    }
    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(EtcdErrorKind::ConnectionFailed, msg)
    }
    pub fn auth(msg: impl Into<String>) -> Self {
        Self::new(EtcdErrorKind::AuthenticationFailed, msg)
    }
    pub fn key_not_found(msg: impl Into<String>) -> Self {
        Self::new(EtcdErrorKind::KeyNotFound, msg)
    }
    pub fn lease_not_found(msg: impl Into<String>) -> Self {
        Self::new(EtcdErrorKind::LeaseNotFound, msg)
    }
    pub fn permission_denied(msg: impl Into<String>) -> Self {
        Self::new(EtcdErrorKind::PermissionDenied, msg)
    }
    pub fn cluster_unavailable(msg: impl Into<String>) -> Self {
        Self::new(EtcdErrorKind::ClusterUnavailable, msg)
    }
    pub fn leader_lost(msg: impl Into<String>) -> Self {
        Self::new(EtcdErrorKind::LeaderLost, msg)
    }
    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(EtcdErrorKind::Timeout, msg)
    }
    pub fn invalid_argument(msg: impl Into<String>) -> Self {
        Self::new(EtcdErrorKind::InvalidArgument, msg)
    }
    pub fn internal(msg: impl Into<String>) -> Self {
        Self::new(EtcdErrorKind::Internal, msg)
    }
}

pub type EtcdResult<T> = Result<T, EtcdError>;

impl From<reqwest::Error> for EtcdError {
    fn from(e: reqwest::Error) -> Self {
        if e.is_timeout() {
            Self::timeout(format!("Request timed out: {e}"))
        } else if e.is_connect() {
            Self::connection(format!("Connection failed: {e}"))
        } else {
            Self::internal(format!("HTTP error: {e}"))
        }
    }
}

impl From<serde_json::Error> for EtcdError {
    fn from(e: serde_json::Error) -> Self {
        Self::internal(format!("JSON parse error: {e}"))
    }
}
