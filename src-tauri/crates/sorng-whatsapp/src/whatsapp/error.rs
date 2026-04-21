//! Crate-level error types for the WhatsApp integration.

use serde::{Deserialize, Serialize};
use std::fmt;

/// Alias for `Result<T, WhatsAppError>`.
pub type WhatsAppResult<T> = Result<T, WhatsAppError>;

/// Uniform error type used across the WhatsApp crate.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WhatsAppError {
    pub code: WhatsAppErrorCode,
    pub message: String,
    /// Optional sub-error detail from the upstream API.
    pub details: Option<String>,
    /// HTTP status code if originated from an API call.
    pub http_status: Option<u16>,
}

impl fmt::Display for WhatsAppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{:?}] {}", self.code, self.message)?;
        if let Some(ref d) = self.details {
            write!(f, " — {}", d)?;
        }
        Ok(())
    }
}

impl std::error::Error for WhatsAppError {}

/// Categorised error codes.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WhatsAppErrorCode {
    // ── Auth ─────────────────────────────────────────────
    InvalidAccessToken,
    TokenExpired,
    InsufficientPermissions,
    // ── API ──────────────────────────────────────────────
    RateLimited,
    InvalidParameter,
    ResourceNotFound,
    DuplicateResource,
    MediaTooLarge,
    UnsupportedMediaType,
    // ── Messaging ────────────────────────────────────────
    RecipientNotOnWhatsApp,
    MessageUndeliverable,
    TemplateNotApproved,
    TemplateNotFound,
    MessageWindowExpired,
    // ── Webhooks ─────────────────────────────────────────
    WebhookVerificationFailed,
    InvalidSignature,
    // ── Internal ─────────────────────────────────────────
    NotConfigured,
    SessionNotFound,
    NetworkError,
    SerializationError,
    InternalError,
}

impl WhatsAppError {
    pub fn not_configured(msg: impl Into<String>) -> Self {
        Self {
            code: WhatsAppErrorCode::NotConfigured,
            message: msg.into(),
            details: None,
            http_status: None,
        }
    }

    pub fn session_not_found(id: &str) -> Self {
        Self {
            code: WhatsAppErrorCode::SessionNotFound,
            message: format!("Session not found: {}", id),
            details: None,
            http_status: None,
        }
    }

    pub fn network(msg: impl Into<String>) -> Self {
        Self {
            code: WhatsAppErrorCode::NetworkError,
            message: msg.into(),
            details: None,
            http_status: None,
        }
    }

    pub fn internal(msg: impl Into<String>) -> Self {
        Self {
            code: WhatsAppErrorCode::InternalError,
            message: msg.into(),
            details: None,
            http_status: None,
        }
    }

    /// Build from an upstream API JSON error body.
    pub fn from_api_response(status: u16, body: &str) -> Self {
        // Meta returns:  { "error": { "message": "...", "type": "...", "code": N, "error_subcode": N, "fbtrace_id": "..." } }
        let (msg, details) = Self::parse_meta_error(body);
        let code = Self::classify_api_error(status, &msg);
        Self {
            code,
            message: msg,
            details: Some(details),
            http_status: Some(status),
        }
    }

    fn parse_meta_error(body: &str) -> (String, String) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(body) {
            let err = &v["error"];
            let msg = err["message"]
                .as_str()
                .unwrap_or("Unknown API error")
                .to_string();
            let detail = format!(
                "type={}, code={}, error_subcode={}, fbtrace_id={}",
                err["type"].as_str().unwrap_or(""),
                err["code"].as_u64().unwrap_or(0),
                err["error_subcode"].as_u64().unwrap_or(0),
                err["fbtrace_id"].as_str().unwrap_or(""),
            );
            (msg, detail)
        } else {
            (
                "Unparseable API error".to_string(),
                body.chars().take(500).collect(),
            )
        }
    }

    fn classify_api_error(status: u16, msg: &str) -> WhatsAppErrorCode {
        let lower = msg.to_lowercase();
        match status {
            401 => {
                if lower.contains("expired") {
                    WhatsAppErrorCode::TokenExpired
                } else {
                    WhatsAppErrorCode::InvalidAccessToken
                }
            }
            403 => WhatsAppErrorCode::InsufficientPermissions,
            404 => WhatsAppErrorCode::ResourceNotFound,
            429 => WhatsAppErrorCode::RateLimited,
            _ => {
                if lower.contains("template") && lower.contains("not found") {
                    WhatsAppErrorCode::TemplateNotFound
                } else if lower.contains("rate") {
                    WhatsAppErrorCode::RateLimited
                } else if lower.contains("recipient") || lower.contains("not on whatsapp") {
                    WhatsAppErrorCode::RecipientNotOnWhatsApp
                } else {
                    WhatsAppErrorCode::InternalError
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_display() {
        let err = WhatsAppError::not_configured("No API key");
        assert!(err.to_string().contains("No API key"));
        assert!(err.to_string().contains("NotConfigured"));
    }

    #[test]
    fn test_from_api_response_401() {
        let body = r#"{"error":{"message":"Invalid OAuth access token","type":"OAuthException","code":190,"fbtrace_id":"abc"}}"#;
        let err = WhatsAppError::from_api_response(401, body);
        assert_eq!(err.code, WhatsAppErrorCode::InvalidAccessToken);
        assert!(err.message.contains("Invalid OAuth access token"));
    }

    #[test]
    fn test_from_api_response_429() {
        let body = r#"{"error":{"message":"Rate limit hit","type":"OAuthException","code":4,"fbtrace_id":"xyz"}}"#;
        let err = WhatsAppError::from_api_response(429, body);
        assert_eq!(err.code, WhatsAppErrorCode::RateLimited);
    }

    #[test]
    fn test_classify_expired_token() {
        let body = r#"{"error":{"message":"Token has expired","type":"OAuthException","code":190,"fbtrace_id":""}}"#;
        let err = WhatsAppError::from_api_response(401, body);
        assert_eq!(err.code, WhatsAppErrorCode::TokenExpired);
    }
}
