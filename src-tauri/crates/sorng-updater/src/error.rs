//! Error types for the updater facade.

use std::fmt;

#[derive(Debug, Clone)]
pub enum UpdateError {
    InvalidEndpoint(String),
    Settings(String),
    Plugin(String),
    Io(String),
    Serialization(String),
    NoUpdateAvailable,
    VersionMismatch {
        requested: String,
        available: String,
    },
    State(String),
}

impl fmt::Display for UpdateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidEndpoint(msg) => write!(f, "invalid updater endpoint: {msg}"),
            Self::Settings(msg) => write!(f, "updater settings error: {msg}"),
            Self::Plugin(msg) => write!(f, "tauri updater plugin error: {msg}"),
            Self::Io(msg) => write!(f, "I/O error: {msg}"),
            Self::Serialization(msg) => write!(f, "serialization error: {msg}"),
            Self::NoUpdateAvailable => write!(f, "no update available"),
            Self::VersionMismatch {
                requested,
                available,
            } => write!(
                f,
                "requested updater version {requested}, but the signed feed offered {available}"
            ),
            Self::State(msg) => write!(f, "updater state error: {msg}"),
        }
    }
}

impl std::error::Error for UpdateError {}

impl From<std::io::Error> for UpdateError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value.to_string())
    }
}

impl From<serde_json::Error> for UpdateError {
    fn from(value: serde_json::Error) -> Self {
        Self::Serialization(value.to_string())
    }
}

impl From<tauri_plugin_updater::Error> for UpdateError {
    fn from(value: tauri_plugin_updater::Error) -> Self {
        Self::Plugin(value.to_string())
    }
}

impl From<url::ParseError> for UpdateError {
    fn from(value: url::ParseError) -> Self {
        Self::InvalidEndpoint(value.to_string())
    }
}
