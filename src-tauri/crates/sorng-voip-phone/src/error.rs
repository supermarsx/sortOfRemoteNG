//! Crate-local error type. Carries a structured `auth_shape` so a user with a
//! real phone can paste a log and an executor can fix the endpoint constants.

use std::fmt;

use crate::types::VoipPhoneAuthShape;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VoipPhoneErrorKind {
    Connection,
    Auth,
    Unsupported,
    Parse,
    NotConnected,
    Forbidden,
}

impl VoipPhoneErrorKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Connection => "connection",
            Self::Auth => "auth",
            Self::Unsupported => "unsupported",
            Self::Parse => "parse",
            Self::NotConnected => "not_connected",
            Self::Forbidden => "forbidden",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VoipPhoneError {
    pub kind: VoipPhoneErrorKind,
    pub message: String,
    /// Login shape that was being attempted when the error occurred (if any).
    pub auth_shape: Option<VoipPhoneAuthShape>,
}

impl fmt::Display for VoipPhoneError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.kind.as_str(), self.message)?;
        if let Some(shape) = &self.auth_shape {
            write!(f, " (auth shape: {})", shape.as_str())?;
        }
        Ok(())
    }
}

impl std::error::Error for VoipPhoneError {}

/// Serialized as the display string (Tauri commands surface errors as strings).
impl serde::Serialize for VoipPhoneError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

impl VoipPhoneError {
    pub fn new(kind: VoipPhoneErrorKind, msg: impl Into<String>) -> Self {
        Self {
            kind,
            message: msg.into(),
            auth_shape: None,
        }
    }
    pub fn with_shape(mut self, shape: VoipPhoneAuthShape) -> Self {
        self.auth_shape = Some(shape);
        self
    }
    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(VoipPhoneErrorKind::Connection, msg)
    }
    pub fn auth(msg: impl Into<String>) -> Self {
        Self::new(VoipPhoneErrorKind::Auth, msg)
    }
    pub fn unsupported(msg: impl Into<String>) -> Self {
        Self::new(VoipPhoneErrorKind::Unsupported, msg)
    }
    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(VoipPhoneErrorKind::Parse, msg)
    }
    pub fn not_connected(id: &str) -> Self {
        Self::new(
            VoipPhoneErrorKind::NotConnected,
            format!("No phone session '{id}'"),
        )
    }
    pub fn forbidden(msg: impl Into<String>) -> Self {
        Self::new(VoipPhoneErrorKind::Forbidden, msg)
    }
    /// Network-level failure from reqwest. The error text never includes the
    /// request body, so no credential can leak through it.
    pub fn http(e: reqwest::Error) -> Self {
        Self::connection(e.without_url().to_string())
    }
}

pub type VoipPhoneResult<T> = Result<T, VoipPhoneError>;
