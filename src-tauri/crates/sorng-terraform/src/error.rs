// ── sorng-terraform/src/error.rs ──────────────────────────────────────────────
//! Crate-level error types.

use std::fmt;
use std::io;

/// All possible error kinds for Terraform operations.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TerraformErrorKind {
    /// Binary not found or not executable.
    BinaryNotFound,
    /// Working directory does not exist or is not readable.
    WorkingDirNotFound,
    /// terraform init failed.
    InitFailed,
    /// terraform plan failed.
    PlanFailed,
    /// terraform apply failed.
    ApplyFailed,
    /// terraform destroy failed.
    DestroyFailed,
    /// terraform validate failed.
    ValidationFailed,
    /// State operation failed.
    StateFailed,
    /// Workspace operation failed.
    WorkspaceFailed,
    /// Import operation failed.
    ImportFailed,
    /// Graph generation failed.
    GraphFailed,
    /// Output retrieval failed.
    OutputFailed,
    /// Provider operation failed.
    ProviderFailed,
    /// Module operation failed.
    ModuleFailed,
    /// HCL parsing/analysis failed.
    HclParseFailed,
    /// Drift detection failed.
    DriftDetectionFailed,
    /// JSON parsing error.
    JsonParse,
    /// I/O error.
    Io,
    /// Process execution error.
    ProcessExecution,
    /// Lock conflict.
    LockConflict,
    /// State locked.
    StateLocked,
    /// Backend configuration error.
    BackendConfig,
    /// Version constraint error.
    VersionMismatch,
    /// Timeout exceeded.
    Timeout,
    /// Connection not found (no matching id).
    ConnectionNotFound,
    /// Authentication/credentials error.
    AuthenticationFailed,
    /// Generic / catch-all.
    Unknown,
}

use serde::{Deserialize, Serialize};

/// The main error type for this crate.
#[derive(Debug, Clone)]
pub struct TerraformError {
    pub kind: TerraformErrorKind,
    pub message: String,
    pub detail: Option<String>,
}

impl TerraformError {
    pub fn new(kind: TerraformErrorKind, msg: impl Into<String>) -> Self {
        Self { kind, message: msg.into(), detail: None }
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    // ── convenience constructors ─────────────────────────────────────

    pub fn binary_not_found(msg: impl Into<String>) -> Self {
        Self::new(TerraformErrorKind::BinaryNotFound, msg)
    }

    pub fn working_dir_not_found(msg: impl Into<String>) -> Self {
        Self::new(TerraformErrorKind::WorkingDirNotFound, msg)
    }

    pub fn connection_not_found(id: &str) -> Self {
        Self::new(TerraformErrorKind::ConnectionNotFound, format!("connection '{}' not found", id))
    }

    pub fn init_failed(msg: impl Into<String>) -> Self {
        Self::new(TerraformErrorKind::InitFailed, msg)
    }

    pub fn plan_failed(msg: impl Into<String>) -> Self {
        Self::new(TerraformErrorKind::PlanFailed, msg)
    }

    pub fn apply_failed(msg: impl Into<String>) -> Self {
        Self::new(TerraformErrorKind::ApplyFailed, msg)
    }

    pub fn destroy_failed(msg: impl Into<String>) -> Self {
        Self::new(TerraformErrorKind::DestroyFailed, msg)
    }

    pub fn state_failed(msg: impl Into<String>) -> Self {
        Self::new(TerraformErrorKind::StateFailed, msg)
    }

    pub fn workspace_failed(msg: impl Into<String>) -> Self {
        Self::new(TerraformErrorKind::WorkspaceFailed, msg)
    }

    pub fn import_failed(msg: impl Into<String>) -> Self {
        Self::new(TerraformErrorKind::ImportFailed, msg)
    }

    pub fn hcl_parse_failed(msg: impl Into<String>) -> Self {
        Self::new(TerraformErrorKind::HclParseFailed, msg)
    }

    pub fn drift_failed(msg: impl Into<String>) -> Self {
        Self::new(TerraformErrorKind::DriftDetectionFailed, msg)
    }

    pub fn json_parse(msg: impl Into<String>) -> Self {
        Self::new(TerraformErrorKind::JsonParse, msg)
    }

    pub fn io(msg: impl Into<String>) -> Self {
        Self::new(TerraformErrorKind::Io, msg)
    }

    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(TerraformErrorKind::Timeout, msg)
    }
}

impl fmt::Display for TerraformError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{:?}] {}", self.kind, self.message)?;
        if let Some(ref d) = self.detail {
            write!(f, " — {}", d)?;
        }
        Ok(())
    }
}

impl std::error::Error for TerraformError {}

impl From<io::Error> for TerraformError {
    fn from(e: io::Error) -> Self {
        Self::new(TerraformErrorKind::Io, e.to_string())
    }
}

impl From<serde_json::Error> for TerraformError {
    fn from(e: serde_json::Error) -> Self {
        Self::new(TerraformErrorKind::JsonParse, e.to_string())
    }
}

/// Convenience alias.
pub type TerraformResult<T> = Result<T, TerraformError>;
