use serde::{Serialize, Deserialize};
use std::fmt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshScriptError {
    pub kind: SshScriptErrorKind,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SshScriptErrorKind {
    NotFound,
    AlreadyExists,
    ValidationError,
    ExecutionFailed,
    Timeout,
    ConditionFailed,
    SchedulerError,
    StoreError,
    Cancelled,
    DependencyFailed,
    ChainAborted,
    RateLimited,
    PermissionDenied,
}

pub type SshScriptResult<T> = Result<T, SshScriptError>;

impl fmt::Display for SshScriptError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl SshScriptError {
    pub fn not_found(msg: impl Into<String>) -> Self {
        SshScriptError { kind: SshScriptErrorKind::NotFound, message: msg.into() }
    }
    pub fn already_exists(msg: impl Into<String>) -> Self {
        SshScriptError { kind: SshScriptErrorKind::AlreadyExists, message: msg.into() }
    }
    pub fn validation(msg: impl Into<String>) -> Self {
        SshScriptError { kind: SshScriptErrorKind::ValidationError, message: msg.into() }
    }
    pub fn execution(msg: impl Into<String>) -> Self {
        SshScriptError { kind: SshScriptErrorKind::ExecutionFailed, message: msg.into() }
    }
    pub fn timeout(msg: impl Into<String>) -> Self {
        SshScriptError { kind: SshScriptErrorKind::Timeout, message: msg.into() }
    }
    pub fn condition(msg: impl Into<String>) -> Self {
        SshScriptError { kind: SshScriptErrorKind::ConditionFailed, message: msg.into() }
    }
    pub fn scheduler(msg: impl Into<String>) -> Self {
        SshScriptError { kind: SshScriptErrorKind::SchedulerError, message: msg.into() }
    }
    pub fn store(msg: impl Into<String>) -> Self {
        SshScriptError { kind: SshScriptErrorKind::StoreError, message: msg.into() }
    }
    pub fn cancelled(msg: impl Into<String>) -> Self {
        SshScriptError { kind: SshScriptErrorKind::Cancelled, message: msg.into() }
    }
    pub fn dependency(msg: impl Into<String>) -> Self {
        SshScriptError { kind: SshScriptErrorKind::DependencyFailed, message: msg.into() }
    }
    pub fn chain_aborted(msg: impl Into<String>) -> Self {
        SshScriptError { kind: SshScriptErrorKind::ChainAborted, message: msg.into() }
    }
}

impl From<SshScriptError> for String {
    fn from(e: SshScriptError) -> Self {
        format!("{}", e)
    }
}
