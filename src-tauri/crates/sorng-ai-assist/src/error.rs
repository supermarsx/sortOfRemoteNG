use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiAssistError {
    pub code: String,
    pub message: String,
    pub context: Option<String>,
}

impl AiAssistError {
    pub fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.to_string(),
            message: message.to_string(),
            context: None,
        }
    }

    pub fn with_context(mut self, ctx: &str) -> Self {
        self.context = Some(ctx.to_string());
        self
    }

    pub fn llm_error(message: &str) -> Self {
        Self::new("LLM_ERROR", message)
    }

    pub fn context_error(message: &str) -> Self {
        Self::new("CONTEXT_ERROR", message)
    }

    pub fn session_error(message: &str) -> Self {
        Self::new("SESSION_ERROR", message)
    }

    pub fn parse_error(message: &str) -> Self {
        Self::new("PARSE_ERROR", message)
    }

    pub fn completion_error(message: &str) -> Self {
        Self::new("COMPLETION_ERROR", message)
    }

    pub fn explanation_error(message: &str) -> Self {
        Self::new("EXPLANATION_ERROR", message)
    }

    pub fn snippet_error(message: &str) -> Self {
        Self::new("SNIPPET_ERROR", message)
    }

    pub fn risk_error(message: &str) -> Self {
        Self::new("RISK_ERROR", message)
    }

    pub fn not_found(what: &str) -> Self {
        Self::new("NOT_FOUND", &format!("{} not found", what))
    }
}

impl fmt::Display for AiAssistError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for AiAssistError {}

impl From<sorng_llm::LlmError> for AiAssistError {
    fn from(e: sorng_llm::LlmError) -> Self {
        Self::llm_error(&e.message)
    }
}

impl From<serde_json::Error> for AiAssistError {
    fn from(e: serde_json::Error) -> Self {
        Self::parse_error(&e.to_string())
    }
}
