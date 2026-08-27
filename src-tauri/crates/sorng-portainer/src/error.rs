//! Crate-local error types for Portainer operations.

use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PortainerErrorKind {
    NotConnected,
    AlreadyConnected,
    ConfigError,
    ConnectionFailed,
    TlsUntrusted,
    AuthenticationFailed,
    TokenExpired,
    PermissionDenied,
    NotFound,
    HttpError,
    ParseError,
    Timeout,
    InternalError,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PortainerError {
    pub kind: PortainerErrorKind,
    pub message: String,
}

impl fmt::Display for PortainerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for PortainerError {}

impl PortainerError {
    pub fn new(kind: PortainerErrorKind, msg: impl Into<String>) -> Self {
        Self {
            kind,
            message: msg.into(),
        }
    }
    pub fn not_connected(msg: impl Into<String>) -> Self {
        Self::new(PortainerErrorKind::NotConnected, msg)
    }
    pub fn already_connected(msg: impl Into<String>) -> Self {
        Self::new(PortainerErrorKind::AlreadyConnected, msg)
    }
    pub fn config(msg: impl Into<String>) -> Self {
        Self::new(PortainerErrorKind::ConfigError, msg)
    }
    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(PortainerErrorKind::ConnectionFailed, msg)
    }
    pub fn tls_untrusted(msg: impl Into<String>) -> Self {
        Self::new(PortainerErrorKind::TlsUntrusted, msg)
    }
    pub fn auth(msg: impl Into<String>) -> Self {
        Self::new(PortainerErrorKind::AuthenticationFailed, msg)
    }
    pub fn token_expired() -> Self {
        Self::new(
            PortainerErrorKind::TokenExpired,
            "Authentication token has expired",
        )
    }
    pub fn permission_denied(msg: impl Into<String>) -> Self {
        Self::new(PortainerErrorKind::PermissionDenied, msg)
    }
    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::new(PortainerErrorKind::NotFound, msg)
    }
    pub fn http(msg: impl Into<String>) -> Self {
        Self::new(PortainerErrorKind::HttpError, msg)
    }
    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(PortainerErrorKind::ParseError, msg)
    }
    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(PortainerErrorKind::Timeout, msg)
    }
    pub fn internal(msg: impl Into<String>) -> Self {
        Self::new(PortainerErrorKind::InternalError, msg)
    }

    /// Map an HTTP status code (+ response body excerpt) to an error kind.
    /// `api_key_auth` decides how a 401 is classified: with an API key there is
    /// nothing to refresh, so it is a hard authentication failure; with JWT
    /// auth the caller handles the single re-login and only reports
    /// `TokenExpired` when the retry also fails.
    pub fn from_status(status: u16, body: &str, api_key_auth: bool) -> Self {
        let excerpt: String = body.chars().take(300).collect();
        match status {
            401 if api_key_auth => Self::auth(format!("HTTP 401: {excerpt}")),
            401 => Self::token_expired(),
            403 => Self::permission_denied(format!("HTTP 403: {excerpt}")),
            404 => Self::not_found(format!("HTTP 404: {excerpt}")),
            408 | 504 => Self::timeout(format!("HTTP {status}: {excerpt}")),
            _ => Self::http(format!("HTTP {status}: {excerpt}")),
        }
    }

    /// Classify a transport-level `reqwest` failure.
    pub fn from_reqwest(context: &str, err: &reqwest::Error, https: bool) -> Self {
        if err.is_timeout() {
            return Self::timeout(format!("{context}: {err}"));
        }
        let mut chain = err.to_string();
        let mut source = std::error::Error::source(err);
        while let Some(s) = source {
            chain.push_str(" | ");
            chain.push_str(&s.to_string());
            source = s.source();
        }
        let lower = chain.to_ascii_lowercase();
        if https
            && (lower.contains("certificate")
                || lower.contains("tls")
                || lower.contains("trust")
                || lower.contains("handshake"))
        {
            return Self::tls_untrusted(format!(
                "{context}: the server's TLS certificate is not trusted ({chain}). \
                 Trust the certificate in Trust Center, or enable \"Accept self-signed certificate\" for this connection."
            ));
        }
        Self::connection(format!("{context}: {chain}"))
    }
}

pub type PortainerResult<T> = Result<T, PortainerError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_mapping_honours_auth_mode() {
        assert_eq!(
            PortainerError::from_status(401, "", true).kind,
            PortainerErrorKind::AuthenticationFailed
        );
        assert_eq!(
            PortainerError::from_status(401, "", false).kind,
            PortainerErrorKind::TokenExpired
        );
        assert_eq!(
            PortainerError::from_status(403, "", false).kind,
            PortainerErrorKind::PermissionDenied
        );
        assert_eq!(
            PortainerError::from_status(404, "", false).kind,
            PortainerErrorKind::NotFound
        );
        assert_eq!(
            PortainerError::from_status(504, "", false).kind,
            PortainerErrorKind::Timeout
        );
        assert_eq!(
            PortainerError::from_status(500, "boom", false).kind,
            PortainerErrorKind::HttpError
        );
    }

    #[test]
    fn error_kind_serialises_snake_case() {
        let json = serde_json::to_string(&PortainerErrorKind::TlsUntrusted).unwrap();
        assert_eq!(json, "\"tls_untrusted\"");
    }
}
