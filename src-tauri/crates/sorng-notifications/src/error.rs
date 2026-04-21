//! # Notification Errors
//!
//! Unified error type for the notification subsystem.

use serde::{Deserialize, Serialize};
use std::fmt;

/// Errors that can occur during notification processing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum NotificationError {
    /// The requested rule ID was not found.
    RuleNotFound(String),
    /// The requested template ID was not found.
    TemplateNotFound(String),
    /// A channel-specific error occurred.
    ChannelError(String),
    /// The notification was suppressed because the throttle limit was exceeded.
    ThrottleExceeded,
    /// An error occurred while evaluating rule conditions.
    ConditionEvalError(String),
    /// An error occurred while rendering a template.
    TemplateRenderError(String),
    /// A delivery attempt to a channel failed.
    DeliveryError(String),
    /// The notification configuration is invalid.
    ConfigError(String),
    /// An error occurred while storing/loading notification data.
    StorageError(String),
}

impl fmt::Display for NotificationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::RuleNotFound(id) => write!(f, "notification rule not found: {id}"),
            Self::TemplateNotFound(id) => write!(f, "notification template not found: {id}"),
            Self::ChannelError(msg) => write!(f, "channel error: {msg}"),
            Self::ThrottleExceeded => write!(f, "throttle limit exceeded"),
            Self::ConditionEvalError(msg) => write!(f, "condition evaluation error: {msg}"),
            Self::TemplateRenderError(msg) => write!(f, "template render error: {msg}"),
            Self::DeliveryError(msg) => write!(f, "delivery error: {msg}"),
            Self::ConfigError(msg) => write!(f, "configuration error: {msg}"),
            Self::StorageError(msg) => write!(f, "storage error: {msg}"),
        }
    }
}

impl std::error::Error for NotificationError {}

impl From<NotificationError> for String {
    fn from(e: NotificationError) -> Self {
        e.to_string()
    }
}
