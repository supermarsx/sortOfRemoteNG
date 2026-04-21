// ── sorng-ansible/src/error.rs ───────────────────────────────────────────────
//! Ansible crate error types.

use std::fmt;

/// Categorizes the kind of Ansible error.
#[derive(Debug, Clone, PartialEq)]
pub enum AnsibleErrorKind {
    /// Ansible binary not found or not executable.
    NotInstalled,
    /// Version of Ansible is unsupported.
    VersionMismatch,
    /// Connection to a managed node failed.
    ConnectionFailed,
    /// SSH authentication failure.
    AuthError,
    /// Playbook syntax or semantics error.
    PlaybookError,
    /// Task execution failure.
    TaskError,
    /// Inventory parsing or resolution error.
    InventoryError,
    /// Role not found or malformed.
    RoleError,
    /// Vault encrypt / decrypt error.
    VaultError,
    /// Galaxy operation failure.
    GalaxyError,
    /// Ansible configuration error.
    ConfigError,
    /// Fact-gathering failure.
    FactError,
    /// Command timed out.
    Timeout,
    /// Failed to parse CLI output.
    ParseError,
    /// Validation error.
    ValidationError,
    /// Process execution error.
    ProcessError,
    /// File I/O error.
    IoError,
    /// Unclassified error.
    Other,
}

impl fmt::Display for AnsibleErrorKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotInstalled => write!(f, "NotInstalled"),
            Self::VersionMismatch => write!(f, "VersionMismatch"),
            Self::ConnectionFailed => write!(f, "ConnectionFailed"),
            Self::AuthError => write!(f, "AuthError"),
            Self::PlaybookError => write!(f, "PlaybookError"),
            Self::TaskError => write!(f, "TaskError"),
            Self::InventoryError => write!(f, "InventoryError"),
            Self::RoleError => write!(f, "RoleError"),
            Self::VaultError => write!(f, "VaultError"),
            Self::GalaxyError => write!(f, "GalaxyError"),
            Self::ConfigError => write!(f, "ConfigError"),
            Self::FactError => write!(f, "FactError"),
            Self::Timeout => write!(f, "Timeout"),
            Self::ParseError => write!(f, "ParseError"),
            Self::ValidationError => write!(f, "ValidationError"),
            Self::ProcessError => write!(f, "ProcessError"),
            Self::IoError => write!(f, "IoError"),
            Self::Other => write!(f, "Other"),
        }
    }
}

/// Structured error for Ansible operations.
#[derive(Debug, Clone)]
pub struct AnsibleError {
    pub kind: AnsibleErrorKind,
    pub message: String,
    pub details: Option<String>,
}

impl AnsibleError {
    pub fn new(kind: AnsibleErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            details: None,
        }
    }

    pub fn with_details(
        kind: AnsibleErrorKind,
        message: impl Into<String>,
        details: impl Into<String>,
    ) -> Self {
        Self {
            kind,
            message: message.into(),
            details: Some(details.into()),
        }
    }

    // ── Convenience constructors ──

    pub fn not_installed(msg: impl Into<String>) -> Self {
        Self::new(AnsibleErrorKind::NotInstalled, msg)
    }

    pub fn version_mismatch(msg: impl Into<String>) -> Self {
        Self::new(AnsibleErrorKind::VersionMismatch, msg)
    }

    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(AnsibleErrorKind::ConnectionFailed, msg)
    }

    pub fn auth(msg: impl Into<String>) -> Self {
        Self::new(AnsibleErrorKind::AuthError, msg)
    }

    pub fn playbook(msg: impl Into<String>) -> Self {
        Self::new(AnsibleErrorKind::PlaybookError, msg)
    }

    pub fn task(msg: impl Into<String>) -> Self {
        Self::new(AnsibleErrorKind::TaskError, msg)
    }

    pub fn inventory(msg: impl Into<String>) -> Self {
        Self::new(AnsibleErrorKind::InventoryError, msg)
    }

    pub fn role(msg: impl Into<String>) -> Self {
        Self::new(AnsibleErrorKind::RoleError, msg)
    }

    pub fn vault(msg: impl Into<String>) -> Self {
        Self::new(AnsibleErrorKind::VaultError, msg)
    }

    pub fn galaxy(msg: impl Into<String>) -> Self {
        Self::new(AnsibleErrorKind::GalaxyError, msg)
    }

    pub fn config(msg: impl Into<String>) -> Self {
        Self::new(AnsibleErrorKind::ConfigError, msg)
    }

    pub fn facts(msg: impl Into<String>) -> Self {
        Self::new(AnsibleErrorKind::FactError, msg)
    }

    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(AnsibleErrorKind::Timeout, msg)
    }

    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(AnsibleErrorKind::ParseError, msg)
    }

    pub fn validation(msg: impl Into<String>) -> Self {
        Self::new(AnsibleErrorKind::ValidationError, msg)
    }

    pub fn process(msg: impl Into<String>) -> Self {
        Self::new(AnsibleErrorKind::ProcessError, msg)
    }

    pub fn io(msg: impl Into<String>) -> Self {
        Self::new(AnsibleErrorKind::IoError, msg)
    }

    pub fn other(msg: impl Into<String>) -> Self {
        Self::new(AnsibleErrorKind::Other, msg)
    }
}

impl fmt::Display for AnsibleError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{}] {}", self.kind, self.message)?;
        if let Some(ref details) = self.details {
            write!(f, " — {}", details)?;
        }
        Ok(())
    }
}

impl std::error::Error for AnsibleError {}

impl From<std::io::Error> for AnsibleError {
    fn from(err: std::io::Error) -> Self {
        Self::with_details(AnsibleErrorKind::IoError, "I/O error", err.to_string())
    }
}

impl From<serde_json::Error> for AnsibleError {
    fn from(err: serde_json::Error) -> Self {
        Self::with_details(
            AnsibleErrorKind::ParseError,
            "JSON parse error",
            err.to_string(),
        )
    }
}

impl From<serde_yaml::Error> for AnsibleError {
    fn from(err: serde_yaml::Error) -> Self {
        Self::with_details(
            AnsibleErrorKind::ParseError,
            "YAML parse error",
            err.to_string(),
        )
    }
}

/// Convenience type alias.
pub type AnsibleResult<T> = Result<T, AnsibleError>;
