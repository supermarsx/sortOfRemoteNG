use serde::{Deserialize, Serialize};
use std::fmt;

/// Categories of Ceph errors.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum CephErrorKind {
    /// Failed to establish connection to the Ceph manager API.
    ConnectionFailed,
    /// Authentication credentials are invalid or expired.
    AuthenticationFailed,
    /// The referenced session ID does not exist.
    SessionNotFound,
    /// General cluster-level error.
    ClusterError,
    /// OSD operation failed.
    OsdError,
    /// Pool operation failed.
    PoolError,
    /// RBD (RADOS Block Device) operation failed.
    RbdError,
    /// CephFS filesystem operation failed.
    CephFsError,
    /// RADOS Gateway operation failed.
    RgwError,
    /// CRUSH map operation failed.
    CrushError,
    /// Placement group operation failed.
    PgError,
    /// Configuration operation failed.
    ConfigError,
    /// Insufficient permissions for the requested action.
    PermissionDenied,
    /// The request timed out.
    Timeout,
    /// Generic API-level error from the Ceph manager.
    ApiError,
    /// Monitor operation failed.
    MonitorError,
    /// MDS operation failed.
    MdsError,
    /// Performance query failed.
    PerformanceError,
    /// Alert operation failed.
    AlertError,
    /// Invalid parameter supplied.
    InvalidParameter,
    /// Resource not found.
    NotFound,
}

impl fmt::Display for CephErrorKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ConnectionFailed => write!(f, "ConnectionFailed"),
            Self::AuthenticationFailed => write!(f, "AuthenticationFailed"),
            Self::SessionNotFound => write!(f, "SessionNotFound"),
            Self::ClusterError => write!(f, "ClusterError"),
            Self::OsdError => write!(f, "OsdError"),
            Self::PoolError => write!(f, "PoolError"),
            Self::RbdError => write!(f, "RbdError"),
            Self::CephFsError => write!(f, "CephFsError"),
            Self::RgwError => write!(f, "RgwError"),
            Self::CrushError => write!(f, "CrushError"),
            Self::PgError => write!(f, "PgError"),
            Self::ConfigError => write!(f, "ConfigError"),
            Self::PermissionDenied => write!(f, "PermissionDenied"),
            Self::Timeout => write!(f, "Timeout"),
            Self::ApiError => write!(f, "ApiError"),
            Self::MonitorError => write!(f, "MonitorError"),
            Self::MdsError => write!(f, "MdsError"),
            Self::PerformanceError => write!(f, "PerformanceError"),
            Self::AlertError => write!(f, "AlertError"),
            Self::InvalidParameter => write!(f, "InvalidParameter"),
            Self::NotFound => write!(f, "NotFound"),
        }
    }
}

/// Unified error type for all Ceph operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CephError {
    pub kind: CephErrorKind,
    pub message: String,
    pub status_code: Option<u16>,
    pub detail: Option<String>,
}

impl CephError {
    pub fn new(kind: CephErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            status_code: None,
            detail: None,
        }
    }

    pub fn with_status(mut self, code: u16) -> Self {
        self.status_code = Some(code);
        self
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(CephErrorKind::ConnectionFailed, msg)
    }

    pub fn auth(msg: impl Into<String>) -> Self {
        Self::new(CephErrorKind::AuthenticationFailed, msg)
    }

    pub fn session_not_found(session_id: &str) -> Self {
        Self::new(
            CephErrorKind::SessionNotFound,
            format!("Session not found: {}", session_id),
        )
    }

    pub fn api(msg: impl Into<String>, status: Option<u16>) -> Self {
        let mut err = Self::new(CephErrorKind::ApiError, msg);
        err.status_code = status;
        err
    }

    pub fn not_found(resource: impl Into<String>) -> Self {
        Self::new(CephErrorKind::NotFound, format!("Not found: {}", resource.into()))
    }

    pub fn invalid_param(msg: impl Into<String>) -> Self {
        Self::new(CephErrorKind::InvalidParameter, msg)
    }
}

impl fmt::Display for CephError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{}] {}", self.kind, self.message)?;
        if let Some(code) = self.status_code {
            write!(f, " (HTTP {})", code)?;
        }
        if let Some(ref detail) = self.detail {
            write!(f, " — {}", detail)?;
        }
        Ok(())
    }
}

impl std::error::Error for CephError {}

impl From<reqwest::Error> for CephError {
    fn from(err: reqwest::Error) -> Self {
        if err.is_timeout() {
            CephError::new(CephErrorKind::Timeout, format!("Request timed out: {}", err))
        } else if err.is_connect() {
            CephError::connection(format!("Connection failed: {}", err))
        } else {
            let status = err.status().map(|s| s.as_u16());
            CephError::api(format!("HTTP error: {}", err), status)
        }
    }
}

impl From<serde_json::Error> for CephError {
    fn from(err: serde_json::Error) -> Self {
        CephError::new(
            CephErrorKind::ApiError,
            format!("JSON parse error: {}", err),
        )
    }
}

impl From<url::ParseError> for CephError {
    fn from(err: url::ParseError) -> Self {
        CephError::new(
            CephErrorKind::ConnectionFailed,
            format!("Invalid URL: {}", err),
        )
    }
}
