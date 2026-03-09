// ── sorng-k8s/src/error.rs ──────────────────────────────────────────────────
//! Kubernetes crate error types.

use std::fmt;

/// Categorizes the kind of Kubernetes error.
#[derive(Debug, Clone, PartialEq)]
pub enum K8sErrorKind {
    /// Could not reach the API server.
    ConnectionFailed,
    /// Authentication / authorization failure.
    AuthError,
    /// HTTP 4xx from the API server.
    ApiError(u16),
    /// Resource was not found (404).
    NotFound,
    /// Conflict (409) — resource version mismatch.
    Conflict,
    /// Forbidden (403).
    Forbidden,
    /// Request timed out.
    Timeout,
    /// Failed to parse API response.
    ParseError,
    /// Kubeconfig is missing, malformed, or context not found.
    KubeconfigError,
    /// Helm CLI operation failed.
    HelmError,
    /// Port-forward or exec session error.
    SessionError,
    /// Resource validation error.
    ValidationError,
    /// Watch / streaming error.
    WatchError,
    /// Metrics server not available.
    MetricsUnavailable,
    /// Unclassified error.
    Other,
}

impl fmt::Display for K8sErrorKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ConnectionFailed => write!(f, "ConnectionFailed"),
            Self::AuthError => write!(f, "AuthError"),
            Self::ApiError(code) => write!(f, "ApiError({})", code),
            Self::NotFound => write!(f, "NotFound"),
            Self::Conflict => write!(f, "Conflict"),
            Self::Forbidden => write!(f, "Forbidden"),
            Self::Timeout => write!(f, "Timeout"),
            Self::ParseError => write!(f, "ParseError"),
            Self::KubeconfigError => write!(f, "KubeconfigError"),
            Self::HelmError => write!(f, "HelmError"),
            Self::SessionError => write!(f, "SessionError"),
            Self::ValidationError => write!(f, "ValidationError"),
            Self::WatchError => write!(f, "WatchError"),
            Self::MetricsUnavailable => write!(f, "MetricsUnavailable"),
            Self::Other => write!(f, "Other"),
        }
    }
}

/// Structured error for Kubernetes operations.
#[derive(Debug, Clone)]
pub struct K8sError {
    pub kind: K8sErrorKind,
    pub message: String,
    pub details: Option<String>,
}

impl K8sError {
    pub fn new(kind: K8sErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            details: None,
        }
    }

    pub fn with_details(
        kind: K8sErrorKind,
        message: impl Into<String>,
        details: impl Into<String>,
    ) -> Self {
        Self {
            kind,
            message: message.into(),
            details: Some(details.into()),
        }
    }

    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(K8sErrorKind::ConnectionFailed, msg)
    }

    pub fn auth(msg: impl Into<String>) -> Self {
        Self::new(K8sErrorKind::AuthError, msg)
    }

    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::new(K8sErrorKind::NotFound, msg)
    }

    pub fn api(status: u16, msg: impl Into<String>) -> Self {
        Self::new(K8sErrorKind::ApiError(status), msg)
    }

    pub fn conflict(msg: impl Into<String>) -> Self {
        Self::new(K8sErrorKind::Conflict, msg)
    }

    pub fn forbidden(msg: impl Into<String>) -> Self {
        Self::new(K8sErrorKind::Forbidden, msg)
    }

    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(K8sErrorKind::Timeout, msg)
    }

    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(K8sErrorKind::ParseError, msg)
    }

    pub fn kubeconfig(msg: impl Into<String>) -> Self {
        Self::new(K8sErrorKind::KubeconfigError, msg)
    }

    pub fn helm(msg: impl Into<String>) -> Self {
        Self::new(K8sErrorKind::HelmError, msg)
    }

    pub fn session(msg: impl Into<String>) -> Self {
        Self::new(K8sErrorKind::SessionError, msg)
    }

    pub fn validation(msg: impl Into<String>) -> Self {
        Self::new(K8sErrorKind::ValidationError, msg)
    }

    pub fn watch(msg: impl Into<String>) -> Self {
        Self::new(K8sErrorKind::WatchError, msg)
    }

    pub fn metrics_unavailable(msg: impl Into<String>) -> Self {
        Self::new(K8sErrorKind::MetricsUnavailable, msg)
    }
}

impl fmt::Display for K8sError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[K8s::{}] {}", self.kind, self.message)?;
        if let Some(ref d) = self.details {
            write!(f, " — {}", d)?;
        }
        Ok(())
    }
}

impl std::error::Error for K8sError {}

impl From<K8sError> for String {
    fn from(e: K8sError) -> String {
        e.to_string()
    }
}

impl From<reqwest::Error> for K8sError {
    fn from(e: reqwest::Error) -> Self {
        if e.is_timeout() {
            Self::timeout(e.to_string())
        } else if e.is_connect() {
            Self::connection(e.to_string())
        } else if let Some(status) = e.status() {
            let code = status.as_u16();
            match code {
                401 => Self::auth(e.to_string()),
                403 => Self::forbidden(e.to_string()),
                404 => Self::not_found(e.to_string()),
                409 => Self::conflict(e.to_string()),
                _ => Self::api(code, e.to_string()),
            }
        } else {
            Self::new(K8sErrorKind::Other, e.to_string())
        }
    }
}

impl From<serde_json::Error> for K8sError {
    fn from(e: serde_json::Error) -> Self {
        Self::parse(e.to_string())
    }
}

impl From<serde_yaml::Error> for K8sError {
    fn from(e: serde_yaml::Error) -> Self {
        Self::parse(format!("YAML: {}", e))
    }
}

impl From<std::io::Error> for K8sError {
    fn from(e: std::io::Error) -> Self {
        Self::new(K8sErrorKind::Other, format!("IO: {}", e))
    }
}

impl From<url::ParseError> for K8sError {
    fn from(e: url::ParseError) -> Self {
        Self::parse(format!("URL: {}", e))
    }
}

/// Convenience result alias.
pub type K8sResult<T> = Result<T, K8sError>;
