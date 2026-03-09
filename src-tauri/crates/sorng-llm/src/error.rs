use serde::{Deserialize, Serialize};
use std::fmt;

/// Core error type for LLM operations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmError {
    pub code: String,
    pub message: String,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub retryable: bool,
    pub status_code: Option<u16>,
    pub details: Option<serde_json::Value>,
}

impl fmt::Display for LlmError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if let Some(ref provider) = self.provider {
            write!(f, "[{}] ", provider)?;
        }
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for LlmError {}

pub type LlmResult<T> = Result<T, LlmError>;

impl LlmError {
    pub fn provider_error(provider: &str, message: &str, status: Option<u16>) -> Self {
        Self {
            code: "PROVIDER_ERROR".to_string(),
            message: message.to_string(),
            provider: Some(provider.to_string()),
            model: None,
            retryable: status.map(|s| s == 429 || s >= 500).unwrap_or(false),
            status_code: status,
            details: None,
        }
    }

    pub fn rate_limited(provider: &str, retry_after: Option<u64>) -> Self {
        Self {
            code: "RATE_LIMITED".to_string(),
            message: format!("Rate limited by {}", provider),
            provider: Some(provider.to_string()),
            model: None,
            retryable: true,
            status_code: Some(429),
            details: retry_after.map(|r| serde_json::json!({"retry_after_seconds": r})),
        }
    }

    pub fn model_not_found(model: &str) -> Self {
        Self {
            code: "MODEL_NOT_FOUND".to_string(),
            message: format!("Model '{}' not found in catalog", model),
            provider: None,
            model: Some(model.to_string()),
            retryable: false,
            status_code: None,
            details: None,
        }
    }

    pub fn provider_not_found(provider: &str) -> Self {
        Self {
            code: "PROVIDER_NOT_FOUND".to_string(),
            message: format!("Provider '{}' not registered", provider),
            provider: Some(provider.to_string()),
            model: None,
            retryable: false,
            status_code: None,
            details: None,
        }
    }

    pub fn invalid_config(message: &str) -> Self {
        Self {
            code: "INVALID_CONFIG".to_string(),
            message: message.to_string(),
            provider: None,
            model: None,
            retryable: false,
            status_code: None,
            details: None,
        }
    }

    pub fn auth_error(provider: &str, message: &str) -> Self {
        Self {
            code: "AUTH_ERROR".to_string(),
            message: message.to_string(),
            provider: Some(provider.to_string()),
            model: None,
            retryable: false,
            status_code: Some(401),
            details: None,
        }
    }

    pub fn context_overflow(model: &str, tokens: u32, max: u32) -> Self {
        Self {
            code: "CONTEXT_OVERFLOW".to_string(),
            message: format!(
                "Token count {} exceeds model {} context window of {}",
                tokens, model, max
            ),
            provider: None,
            model: Some(model.to_string()),
            retryable: false,
            status_code: None,
            details: Some(serde_json::json!({"tokens": tokens, "max_context": max})),
        }
    }

    pub fn stream_error(message: &str) -> Self {
        Self {
            code: "STREAM_ERROR".to_string(),
            message: message.to_string(),
            provider: None,
            model: None,
            retryable: true,
            status_code: None,
            details: None,
        }
    }

    pub fn timeout(provider: &str) -> Self {
        Self {
            code: "TIMEOUT".to_string(),
            message: format!("Request to {} timed out", provider),
            provider: Some(provider.to_string()),
            model: None,
            retryable: true,
            status_code: None,
            details: None,
        }
    }

    pub fn cache_error(message: &str) -> Self {
        Self {
            code: "CACHE_ERROR".to_string(),
            message: message.to_string(),
            provider: None,
            model: None,
            retryable: false,
            status_code: None,
            details: None,
        }
    }

    pub fn tool_error(message: &str) -> Self {
        Self {
            code: "TOOL_ERROR".to_string(),
            message: message.to_string(),
            provider: None,
            model: None,
            retryable: false,
            status_code: None,
            details: None,
        }
    }

    pub fn all_providers_failed(errors: Vec<LlmError>) -> Self {
        Self {
            code: "ALL_PROVIDERS_FAILED".to_string(),
            message: "All providers failed to process the request".to_string(),
            provider: None,
            model: None,
            retryable: false,
            status_code: None,
            details: Some(serde_json::to_value(&errors).unwrap_or_default()),
        }
    }
}

impl From<reqwest::Error> for LlmError {
    fn from(err: reqwest::Error) -> Self {
        let status = err.status().map(|s| s.as_u16());
        Self {
            code: "HTTP_ERROR".to_string(),
            message: err.to_string(),
            provider: None,
            model: None,
            retryable: status.map(|s| s == 429 || s >= 500).unwrap_or(true),
            status_code: status,
            details: None,
        }
    }
}

impl From<serde_json::Error> for LlmError {
    fn from(err: serde_json::Error) -> Self {
        Self {
            code: "PARSE_ERROR".to_string(),
            message: err.to_string(),
            provider: None,
            model: None,
            retryable: false,
            status_code: None,
            details: None,
        }
    }
}
