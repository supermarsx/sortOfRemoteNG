//! Error types for the hook engine.

use std::fmt;

/// All errors that can originate from the hook engine.
#[derive(Debug, Clone)]
pub enum HookError {
    /// A subscription with the given ID was not found.
    SubscriptionNotFound(String),
    /// A pipeline with the given ID was not found.
    PipelineNotFound(String),
    /// Event dispatch failed for the given reason.
    EventDispatchFailed(String),
    /// A filter expression could not be evaluated.
    FilterError(String),
    /// An operation exceeded its timeout.
    TimeoutError(String),
    /// A script action failed.
    ScriptError(String),
    /// A webhook action failed.
    WebhookError(String),
    /// Serialization or deserialization failed.
    SerializationError(String),
    /// A storage / persistence operation failed.
    StorageError(String),
}

impl fmt::Display for HookError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SubscriptionNotFound(id) => write!(f, "subscription not found: {id}"),
            Self::PipelineNotFound(id) => write!(f, "pipeline not found: {id}"),
            Self::EventDispatchFailed(msg) => write!(f, "event dispatch failed: {msg}"),
            Self::FilterError(msg) => write!(f, "filter error: {msg}"),
            Self::TimeoutError(msg) => write!(f, "timeout: {msg}"),
            Self::ScriptError(msg) => write!(f, "script error: {msg}"),
            Self::WebhookError(msg) => write!(f, "webhook error: {msg}"),
            Self::SerializationError(msg) => write!(f, "serialization error: {msg}"),
            Self::StorageError(msg) => write!(f, "storage error: {msg}"),
        }
    }
}

impl std::error::Error for HookError {}

impl From<serde_json::Error> for HookError {
    fn from(e: serde_json::Error) -> Self {
        Self::SerializationError(e.to_string())
    }
}
