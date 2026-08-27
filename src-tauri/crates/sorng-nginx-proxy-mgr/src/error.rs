//! Crate-local error types for Nginx Proxy Manager operations.

use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NpmErrorKind {
    NotConnected,
    AlreadyConnected,
    /// Invalid connection configuration (no request was made).
    ConfigError,
    ConnectionFailed,
    /// The server presented a TLS certificate the Trust Center does not trust.
    TlsUntrusted,
    AuthenticationFailed,
    TokenExpired,
    ProxyHostNotFound,
    RedirectionHostNotFound,
    DeadHostNotFound,
    StreamNotFound,
    CertificateNotFound,
    AccessListNotFound,
    UserNotFound,
    PermissionDenied,
    HttpError,
    ParseError,
    Timeout,
    InternalError,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct NpmError {
    pub kind: NpmErrorKind,
    pub message: String,
}

impl fmt::Display for NpmError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for NpmError {}

impl NpmError {
    pub fn new(kind: NpmErrorKind, msg: impl Into<String>) -> Self {
        Self {
            kind,
            message: msg.into(),
        }
    }
    pub fn not_connected(msg: impl Into<String>) -> Self {
        Self::new(NpmErrorKind::NotConnected, msg)
    }
    pub fn config(msg: impl Into<String>) -> Self {
        Self::new(NpmErrorKind::ConfigError, msg)
    }
    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(NpmErrorKind::ConnectionFailed, msg)
    }
    pub fn tls_untrusted(msg: impl Into<String>) -> Self {
        Self::new(NpmErrorKind::TlsUntrusted, msg)
    }
    pub fn auth(msg: impl Into<String>) -> Self {
        Self::new(NpmErrorKind::AuthenticationFailed, msg)
    }
    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(NpmErrorKind::ParseError, msg)
    }
    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(NpmErrorKind::Timeout, msg)
    }
    pub fn proxy_host_not_found(id: u64) -> Self {
        Self::new(
            NpmErrorKind::ProxyHostNotFound,
            format!("Proxy host not found: {id}"),
        )
    }
    pub fn token_expired() -> Self {
        Self::new(
            NpmErrorKind::TokenExpired,
            "Authentication token has expired",
        )
    }
    pub fn http(e: impl fmt::Display) -> Self {
        Self::new(NpmErrorKind::HttpError, e.to_string())
    }

    /// Map an HTTP status to an error kind. Bodies are truncated so a stray
    /// HTML error page does not flood the UI.
    pub fn from_status(status: u16, body: &str) -> Self {
        let excerpt: String = body.chars().take(512).collect();
        let kind = match status {
            401 => NpmErrorKind::TokenExpired,
            403 => NpmErrorKind::PermissionDenied,
            404 => NpmErrorKind::ProxyHostNotFound,
            _ => NpmErrorKind::HttpError,
        };
        Self::new(kind, format!("HTTP {status}: {excerpt}"))
    }

    /// Classify a transport-level `reqwest` failure. TLS failures against an
    /// `https://` endpoint become [`NpmErrorKind::TlsUntrusted`] with a hint
    /// towards Trust Center / the accept-self-signed toggle.
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
        if https && looks_like_tls_failure(&chain) {
            return Self::tls_untrusted(format!(
                "{context}: the server's TLS certificate is not trusted ({chain}). \
                 Trust the certificate in Trust Center, or enable \"Accept self-signed certificate\" for this connection."
            ));
        }
        Self::connection(format!("{context}: {chain}"))
    }
}

/// Heuristic over the reqwest/rustls error chain (the TOFU verifier rejects
/// with `rustls::Error::General(..)` strings mentioning trust/certificate).
pub fn looks_like_tls_failure(chain: &str) -> bool {
    let lower = chain.to_ascii_lowercase();
    lower.contains("certificate")
        || lower.contains("tls")
        || lower.contains("trust")
        || lower.contains("handshake")
}

pub type NpmResult<T> = Result<T, NpmError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_mapping() {
        assert_eq!(
            NpmError::from_status(401, "").kind,
            NpmErrorKind::TokenExpired
        );
        assert_eq!(
            NpmError::from_status(403, "").kind,
            NpmErrorKind::PermissionDenied
        );
        assert_eq!(
            NpmError::from_status(404, "").kind,
            NpmErrorKind::ProxyHostNotFound
        );
        assert_eq!(NpmError::from_status(500, "").kind, NpmErrorKind::HttpError);
    }

    #[test]
    fn status_body_is_truncated() {
        let body = "x".repeat(2000);
        let err = NpmError::from_status(500, &body);
        assert!(err.message.len() < 600);
    }

    #[test]
    fn error_kinds_serialize_snake_case() {
        assert_eq!(
            serde_json::to_string(&NpmErrorKind::TlsUntrusted).unwrap(),
            "\"tls_untrusted\""
        );
        assert_eq!(
            serde_json::to_string(&NpmErrorKind::ConfigError).unwrap(),
            "\"config_error\""
        );
    }

    #[test]
    fn tls_heuristic() {
        assert!(looks_like_tls_failure(
            "error sending request | invalid peer certificate: UnknownIssuer"
        ));
        assert!(looks_like_tls_failure("TOFU: identity not trusted"));
        assert!(!looks_like_tls_failure("connection refused"));
    }
}
