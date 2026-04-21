// ── sorng-docker-compose/src/error.rs ──────────────────────────────────────────
//! Error types for Docker Compose operations.

use serde::{Deserialize, Serialize};
use std::fmt;

/// All compose-specific error kinds.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ComposeErrorKind {
    /// `docker compose` binary not found / not available.
    NotAvailable,
    /// A compose file could not be found or read.
    FileNotFound,
    /// YAML / JSON parse error.
    ParseError,
    /// Compose file validation error.
    ValidationError,
    /// CLI execution failed.
    CommandFailed,
    /// A specific service was not found in the project.
    ServiceNotFound,
    /// A dependency cycle was detected.
    DependencyCycle,
    /// Environment variable interpolation error.
    InterpolationError,
    /// Build error.
    BuildError,
    /// Pull error.
    PullError,
    /// Push error.
    PushError,
    /// Exec error.
    ExecError,
    /// Health check error.
    HealthCheckError,
    /// Timeout waiting for operation.
    Timeout,
    /// Profile error.
    ProfileError,
    /// Template error.
    TemplateError,
    /// I/O error.
    IoError,
    /// Generic / uncategorised.
    Other,
}

/// Compose error with kind, message, and optional detail.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComposeError {
    pub kind: ComposeErrorKind,
    pub message: String,
    pub details: Option<String>,
    pub exit_code: Option<i32>,
}

impl ComposeError {
    pub fn new(kind: ComposeErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            details: None,
            exit_code: None,
        }
    }

    pub fn with_details(
        kind: ComposeErrorKind,
        message: impl Into<String>,
        details: impl Into<String>,
    ) -> Self {
        Self {
            kind,
            message: message.into(),
            details: Some(details.into()),
            exit_code: None,
        }
    }

    pub fn with_exit_code(mut self, code: i32) -> Self {
        self.exit_code = Some(code);
        self
    }

    // ── Convenience constructors ──────────────────────────────────

    pub fn not_available(msg: &str) -> Self {
        Self::new(ComposeErrorKind::NotAvailable, msg)
    }
    pub fn file_not_found(msg: &str) -> Self {
        Self::new(ComposeErrorKind::FileNotFound, msg)
    }
    pub fn parse(msg: &str) -> Self {
        Self::new(ComposeErrorKind::ParseError, msg)
    }
    pub fn validation(msg: &str) -> Self {
        Self::new(ComposeErrorKind::ValidationError, msg)
    }
    pub fn command(msg: &str) -> Self {
        Self::new(ComposeErrorKind::CommandFailed, msg)
    }
    pub fn service_not_found(svc: &str) -> Self {
        Self::new(
            ComposeErrorKind::ServiceNotFound,
            format!("Service '{}' not found in compose project", svc),
        )
    }
    pub fn cycle(msg: &str) -> Self {
        Self::new(ComposeErrorKind::DependencyCycle, msg)
    }
    pub fn interpolation(msg: &str) -> Self {
        Self::new(ComposeErrorKind::InterpolationError, msg)
    }
    pub fn build_err(msg: &str) -> Self {
        Self::new(ComposeErrorKind::BuildError, msg)
    }
    pub fn pull_err(msg: &str) -> Self {
        Self::new(ComposeErrorKind::PullError, msg)
    }
    pub fn push_err(msg: &str) -> Self {
        Self::new(ComposeErrorKind::PushError, msg)
    }
    pub fn exec_err(msg: &str) -> Self {
        Self::new(ComposeErrorKind::ExecError, msg)
    }
    pub fn health(msg: &str) -> Self {
        Self::new(ComposeErrorKind::HealthCheckError, msg)
    }
    pub fn timeout(msg: &str) -> Self {
        Self::new(ComposeErrorKind::Timeout, msg)
    }
    pub fn profile(msg: &str) -> Self {
        Self::new(ComposeErrorKind::ProfileError, msg)
    }
    pub fn template(msg: &str) -> Self {
        Self::new(ComposeErrorKind::TemplateError, msg)
    }
    pub fn io(msg: &str) -> Self {
        Self::new(ComposeErrorKind::IoError, msg)
    }
    pub fn other(msg: &str) -> Self {
        Self::new(ComposeErrorKind::Other, msg)
    }
}

impl fmt::Display for ComposeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.message)?;
        if let Some(ref d) = self.details {
            write!(f, " — {}", d)?;
        }
        Ok(())
    }
}

impl std::error::Error for ComposeError {}

/// Convenience result alias.
pub type ComposeResult<T> = Result<T, ComposeError>;
