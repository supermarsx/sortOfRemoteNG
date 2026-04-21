use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VaultErrorKind {
    ConnectionFailed,
    AuthenticationFailed,
    Sealed,
    NotFound,
    PermissionDenied,
    SecretNotFound,
    MountNotFound,
    PolicyNotFound,
    TokenExpired,
    TokenRevoked,
    LeaseNotFound,
    TransitError,
    PkiError,
    AuditError,
    ApiError,
    ParseError,
    Timeout,
    InvalidPath,
    VersionConflict,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultError {
    pub kind: VaultErrorKind,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_errors: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_version: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_version: Option<u64>,
}

impl fmt::Display for VaultError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.kind {
            VaultErrorKind::ApiError => {
                if let (Some(status), Some(errors)) = (&self.status, &self.api_errors) {
                    write!(f, "Vault API error ({}): {}", status, errors.join(", "))
                } else {
                    write!(f, "Vault API error: {}", self.message)
                }
            }
            VaultErrorKind::SecretNotFound => {
                if let Some(path) = &self.path {
                    write!(f, "Secret not found at path: {}", path)
                } else {
                    write!(f, "Secret not found: {}", self.message)
                }
            }
            VaultErrorKind::VersionConflict => {
                write!(
                    f,
                    "Version conflict: current={}, expected={}",
                    self.current_version
                        .map(|v| v.to_string())
                        .unwrap_or_else(|| "none".into()),
                    self.expected_version
                        .map(|v| v.to_string())
                        .unwrap_or_else(|| "none".into())
                )
            }
            _ => write!(f, "{}", self.message),
        }
    }
}

impl std::error::Error for VaultError {}

impl VaultError {
    pub fn connection_failed(msg: impl Into<String>) -> Self {
        Self {
            kind: VaultErrorKind::ConnectionFailed,
            message: msg.into(),
            status: None,
            api_errors: None,
            path: None,
            current_version: None,
            expected_version: None,
        }
    }

    pub fn authentication_failed(msg: impl Into<String>) -> Self {
        Self {
            kind: VaultErrorKind::AuthenticationFailed,
            message: msg.into(),
            status: None,
            api_errors: None,
            path: None,
            current_version: None,
            expected_version: None,
        }
    }

    pub fn sealed() -> Self {
        Self {
            kind: VaultErrorKind::Sealed,
            message: "Vault is sealed".into(),
            status: None,
            api_errors: None,
            path: None,
            current_version: None,
            expected_version: None,
        }
    }

    pub fn not_found(msg: impl Into<String>) -> Self {
        Self {
            kind: VaultErrorKind::NotFound,
            message: msg.into(),
            status: None,
            api_errors: None,
            path: None,
            current_version: None,
            expected_version: None,
        }
    }

    pub fn permission_denied(msg: impl Into<String>) -> Self {
        Self {
            kind: VaultErrorKind::PermissionDenied,
            message: msg.into(),
            status: None,
            api_errors: None,
            path: None,
            current_version: None,
            expected_version: None,
        }
    }

    pub fn secret_not_found(path: impl Into<String>) -> Self {
        let p = path.into();
        Self {
            kind: VaultErrorKind::SecretNotFound,
            message: format!("Secret not found at path: {}", p),
            status: None,
            api_errors: None,
            path: Some(p),
            current_version: None,
            expected_version: None,
        }
    }

    pub fn mount_not_found(msg: impl Into<String>) -> Self {
        Self {
            kind: VaultErrorKind::MountNotFound,
            message: msg.into(),
            status: None,
            api_errors: None,
            path: None,
            current_version: None,
            expected_version: None,
        }
    }

    pub fn policy_not_found(msg: impl Into<String>) -> Self {
        Self {
            kind: VaultErrorKind::PolicyNotFound,
            message: msg.into(),
            status: None,
            api_errors: None,
            path: None,
            current_version: None,
            expected_version: None,
        }
    }

    pub fn token_expired() -> Self {
        Self {
            kind: VaultErrorKind::TokenExpired,
            message: "Token has expired".into(),
            status: None,
            api_errors: None,
            path: None,
            current_version: None,
            expected_version: None,
        }
    }

    pub fn token_revoked() -> Self {
        Self {
            kind: VaultErrorKind::TokenRevoked,
            message: "Token has been revoked".into(),
            status: None,
            api_errors: None,
            path: None,
            current_version: None,
            expected_version: None,
        }
    }

    pub fn lease_not_found(msg: impl Into<String>) -> Self {
        Self {
            kind: VaultErrorKind::LeaseNotFound,
            message: msg.into(),
            status: None,
            api_errors: None,
            path: None,
            current_version: None,
            expected_version: None,
        }
    }

    pub fn transit_error(msg: impl Into<String>) -> Self {
        Self {
            kind: VaultErrorKind::TransitError,
            message: msg.into(),
            status: None,
            api_errors: None,
            path: None,
            current_version: None,
            expected_version: None,
        }
    }

    pub fn pki_error(msg: impl Into<String>) -> Self {
        Self {
            kind: VaultErrorKind::PkiError,
            message: msg.into(),
            status: None,
            api_errors: None,
            path: None,
            current_version: None,
            expected_version: None,
        }
    }

    pub fn audit_error(msg: impl Into<String>) -> Self {
        Self {
            kind: VaultErrorKind::AuditError,
            message: msg.into(),
            status: None,
            api_errors: None,
            path: None,
            current_version: None,
            expected_version: None,
        }
    }

    pub fn api_error(status: u16, errors: Vec<String>) -> Self {
        let message = format!("API error ({}): {}", status, errors.join(", "));
        Self {
            kind: VaultErrorKind::ApiError,
            message,
            status: Some(status),
            api_errors: Some(errors),
            path: None,
            current_version: None,
            expected_version: None,
        }
    }

    pub fn parse_error(msg: impl Into<String>) -> Self {
        Self {
            kind: VaultErrorKind::ParseError,
            message: msg.into(),
            status: None,
            api_errors: None,
            path: None,
            current_version: None,
            expected_version: None,
        }
    }

    pub fn timeout(msg: impl Into<String>) -> Self {
        Self {
            kind: VaultErrorKind::Timeout,
            message: msg.into(),
            status: None,
            api_errors: None,
            path: None,
            current_version: None,
            expected_version: None,
        }
    }

    pub fn invalid_path(msg: impl Into<String>) -> Self {
        Self {
            kind: VaultErrorKind::InvalidPath,
            message: msg.into(),
            status: None,
            api_errors: None,
            path: None,
            current_version: None,
            expected_version: None,
        }
    }

    pub fn version_conflict(current: Option<u64>, expected: Option<u64>) -> Self {
        Self {
            kind: VaultErrorKind::VersionConflict,
            message: format!(
                "Version conflict: current={}, expected={}",
                current
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| "none".into()),
                expected
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| "none".into())
            ),
            status: None,
            api_errors: None,
            path: None,
            current_version: current,
            expected_version: expected,
        }
    }

    pub fn other(msg: impl Into<String>) -> Self {
        Self {
            kind: VaultErrorKind::Other,
            message: msg.into(),
            status: None,
            api_errors: None,
            path: None,
            current_version: None,
            expected_version: None,
        }
    }
}

pub fn err_str(msg: impl Into<String>) -> VaultError {
    VaultError::other(msg)
}

impl From<reqwest::Error> for VaultError {
    fn from(e: reqwest::Error) -> Self {
        if e.is_timeout() {
            VaultError::timeout(e.to_string())
        } else if e.is_connect() {
            VaultError::connection_failed(e.to_string())
        } else {
            VaultError::other(e.to_string())
        }
    }
}

impl From<serde_json::Error> for VaultError {
    fn from(e: serde_json::Error) -> Self {
        VaultError::parse_error(e.to_string())
    }
}

impl From<String> for VaultError {
    fn from(s: String) -> Self {
        VaultError::other(s)
    }
}

impl From<&str> for VaultError {
    fn from(s: &str) -> Self {
        VaultError::other(s)
    }
}

pub type VaultResult<T> = Result<T, VaultError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_display() {
        let err = VaultError::connection_failed("connection refused");
        assert_eq!(err.to_string(), "connection refused");
    }

    #[test]
    fn test_api_error_display() {
        let err = VaultError::api_error(403, vec!["permission denied".into()]);
        assert_eq!(err.to_string(), "Vault API error (403): permission denied");
    }

    #[test]
    fn test_secret_not_found_display() {
        let err = VaultError::secret_not_found("secret/data/myapp");
        assert_eq!(
            err.to_string(),
            "Secret not found at path: secret/data/myapp"
        );
        assert_eq!(err.path, Some("secret/data/myapp".into()));
    }

    #[test]
    fn test_version_conflict_display() {
        let err = VaultError::version_conflict(Some(3), Some(2));
        assert!(err.to_string().contains("current=3"));
        assert!(err.to_string().contains("expected=2"));
    }

    #[test]
    fn test_sealed_error() {
        let err = VaultError::sealed();
        assert_eq!(err.to_string(), "Vault is sealed");
    }

    #[test]
    fn test_error_serialization() {
        let err = VaultError::api_error(500, vec!["internal error".into()]);
        let json = serde_json::to_string(&err).unwrap();
        let deserialized: VaultError = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.status, Some(500));
    }
}
