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
            // NPM rejects a wrong email/password on `POST /api/tokens` with
            // **400**, not 401 — without this the panel would show a generic
            // HTTP error instead of "invalid credentials".
            400 if is_invalid_auth_body(body) => NpmErrorKind::AuthenticationFailed,
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

/// Does an HTTP 400 body carry NPM's "bad credentials" marker?
///
/// A wrong secret on `POST /api/tokens` answers **400** with
/// `{"error":{"code":400,"message":"Invalid email or password",
/// "message_i18n":"error.invalid-auth"}}` (verified against
/// `jc21/nginx-proxy-manager:2.15.1`). The structured `message_i18n` is the
/// primary signal; the message text is a fallback for builds that omit it.
pub fn is_invalid_auth_body(body: &str) -> bool {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(body) {
        let err = &value["error"];
        if err["message_i18n"].as_str() == Some("error.invalid-auth") {
            return true;
        }
        if let Some(message) = err["message"].as_str() {
            if message.eq_ignore_ascii_case("invalid email or password") {
                return true;
            }
        }
        return false;
    }
    // Non-JSON body (proxy error page, truncated response): fall back to text.
    let lower = body.to_ascii_lowercase();
    lower.contains("error.invalid-auth") || lower.contains("invalid email or password")
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

    /// NPM 2.15.1 answers a wrong password with 400, not 401.
    #[test]
    fn invalid_credentials_400_is_authentication_failed() {
        let body = r#"{"error":{"code":400,"message":"Invalid email or password","message_i18n":"error.invalid-auth"}}"#;
        assert_eq!(
            NpmError::from_status(400, body).kind,
            NpmErrorKind::AuthenticationFailed
        );
        // message text alone (no message_i18n) is enough
        let no_i18n = r#"{"error":{"code":400,"message":"Invalid email or password"}}"#;
        assert_eq!(
            NpmError::from_status(400, no_i18n).kind,
            NpmErrorKind::AuthenticationFailed
        );
        // an unrelated 400 stays a generic HTTP error
        let other = r#"{"error":{"code":400,"message":"domain_names must be an array"}}"#;
        assert_eq!(
            NpmError::from_status(400, other).kind,
            NpmErrorKind::HttpError
        );
        assert_eq!(NpmError::from_status(400, "").kind, NpmErrorKind::HttpError);
    }

    #[test]
    fn invalid_auth_body_detection() {
        assert!(is_invalid_auth_body(
            r#"{"error":{"message_i18n":"error.invalid-auth"}}"#
        ));
        // non-JSON fallback
        assert!(is_invalid_auth_body("Invalid email or password"));
        assert!(!is_invalid_auth_body("{}"));
        assert!(!is_invalid_auth_body("gateway timeout"));
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
