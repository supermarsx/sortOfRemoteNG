use std::fmt;

/// Errors produced by the filters engine.
#[derive(Debug)]
pub enum FilterError {
    FilterNotFound(String),
    SmartGroupNotFound(String),
    InvalidCondition(String),
    InvalidExpression(String),
    RegexError(String),
    EvaluationError(String),
    LimitExceeded(String),
    StorageError(String),
}

impl fmt::Display for FilterError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            FilterError::FilterNotFound(id) => write!(f, "Filter not found: {id}"),
            FilterError::SmartGroupNotFound(id) => write!(f, "Smart group not found: {id}"),
            FilterError::InvalidCondition(msg) => write!(f, "Invalid condition: {msg}"),
            FilterError::InvalidExpression(msg) => write!(f, "Invalid expression: {msg}"),
            FilterError::RegexError(msg) => write!(f, "Regex error: {msg}"),
            FilterError::EvaluationError(msg) => write!(f, "Evaluation error: {msg}"),
            FilterError::LimitExceeded(msg) => write!(f, "Limit exceeded: {msg}"),
            FilterError::StorageError(msg) => write!(f, "Storage error: {msg}"),
        }
    }
}

impl std::error::Error for FilterError {}

impl From<regex::Error> for FilterError {
    fn from(err: regex::Error) -> Self {
        FilterError::RegexError(err.to_string())
    }
}

impl From<serde_json::Error> for FilterError {
    fn from(err: serde_json::Error) -> Self {
        FilterError::StorageError(err.to_string())
    }
}

/// Convenience alias used throughout the crate.
pub type Result<T> = std::result::Result<T, FilterError>;
