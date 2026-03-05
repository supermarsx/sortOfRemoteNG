//! Error types for the Synology NAS management crate.
//!
//! Maps DSM API error codes to structured Rust errors.

use std::fmt;

/// Synology-specific error kinds.
#[derive(Debug, Clone)]
pub enum SynologyErrorKind {
    /// Network / connection error
    ConnectionError,
    /// Authentication failure (bad credentials, 2FA, blocked)
    AuthenticationError,
    /// Session expired or interrupted
    SessionExpired,
    /// Two-factor authentication required
    TwoFactorRequired,
    /// Approve sign-in required (Secure SignIn app)
    ApproveSignInRequired,
    /// API not found on this DSM installation
    ApiNotFound,
    /// API version not supported
    VersionNotSupported,
    /// Permission denied
    PermissionDenied,
    /// Resource not found (file, folder, share, etc.)
    NotFound,
    /// Conflict (file exists, duplicate, etc.)
    Conflict,
    /// Out of disk space
    DiskFull,
    /// System busy / rate limited
    SystemBusy,
    /// IP blocked by auto-block
    IpBlocked,
    /// CSRF SynoToken mismatch
    TokenMismatch,
    /// DSM API returned an error with a code
    ApiError(i32),
    /// Response parsing error
    ParseError,
    /// File operation error
    FileOperationError,
    /// Storage error
    StorageError,
    /// Docker / Container Manager error
    DockerError,
    /// Virtualization (VMM) error
    VirtualizationError,
    /// Surveillance Station error
    SurveillanceError,
    /// Download Station error
    DownloadStationError,
    /// Backup error
    BackupError,
    /// Package management error
    PackageError,
    /// Generic / unknown error
    Unknown,
}

/// Crate error type.
#[derive(Debug, Clone)]
pub struct SynologyError {
    pub kind: SynologyErrorKind,
    pub message: String,
}

impl SynologyError {
    pub fn new(kind: SynologyErrorKind, msg: impl Into<String>) -> Self {
        Self { kind, message: msg.into() }
    }

    // ── Convenience constructors ────────────────────────────────────

    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(SynologyErrorKind::ConnectionError, msg)
    }

    pub fn auth(msg: impl Into<String>) -> Self {
        Self::new(SynologyErrorKind::AuthenticationError, msg)
    }

    pub fn session_expired(msg: impl Into<String>) -> Self {
        Self::new(SynologyErrorKind::SessionExpired, msg)
    }

    pub fn two_factor(msg: impl Into<String>) -> Self {
        Self::new(SynologyErrorKind::TwoFactorRequired, msg)
    }

    pub fn approve_signin(msg: impl Into<String>) -> Self {
        Self::new(SynologyErrorKind::ApproveSignInRequired, msg)
    }

    pub fn api_not_found(msg: impl Into<String>) -> Self {
        Self::new(SynologyErrorKind::ApiNotFound, msg)
    }

    pub fn version_not_supported(msg: impl Into<String>) -> Self {
        Self::new(SynologyErrorKind::VersionNotSupported, msg)
    }

    pub fn permission(msg: impl Into<String>) -> Self {
        Self::new(SynologyErrorKind::PermissionDenied, msg)
    }

    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::new(SynologyErrorKind::NotFound, msg)
    }

    pub fn api(code: i32, msg: impl Into<String>) -> Self {
        Self::new(SynologyErrorKind::ApiError(code), msg)
    }

    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(SynologyErrorKind::ParseError, msg)
    }

    pub fn busy(msg: impl Into<String>) -> Self {
        Self::new(SynologyErrorKind::SystemBusy, msg)
    }

    /// Map a global DSM error code to a typed error.
    pub fn from_dsm_code(code: i32, context: &str) -> Self {
        match code {
            100 => Self::new(SynologyErrorKind::Unknown, format!("{context}: Unknown error")),
            101..=104 => Self::api(code, format!("{context}: Invalid API request (code {code})")),
            105 | 120 => Self::permission(format!("{context}: Permission denied (code {code})")),
            106 => Self::session_expired(format!("{context}: Session timeout")),
            107 => Self::session_expired(format!("{context}: Session interrupted by duplicate login")),
            108 => Self::new(SynologyErrorKind::FileOperationError, format!("{context}: File upload failed")),
            109..=111 => Self::busy(format!("{context}: System busy (code {code})")),
            115 | 160 => Self::new(SynologyErrorKind::IpBlocked, format!("{context}: IP blocked (code {code})")),
            117 => Self::new(SynologyErrorKind::FileOperationError, format!("{context}: File/folder locked")),
            119 => Self::new(SynologyErrorKind::TokenMismatch, format!("{context}: SynoToken mismatch")),
            150 => Self::busy(format!("{context}: Operation timed out")),
            // Auth-specific
            400 => Self::auth(format!("{context}: Invalid credentials")),
            401 => Self::auth(format!("{context}: Account disabled")),
            402 => Self::permission(format!("{context}: Permission denied")),
            403 => Self::two_factor(format!("{context}: 2FA code required")),
            404 => Self::auth(format!("{context}: Invalid 2FA code")),
            406 => Self::two_factor(format!("{context}: 2FA enforcement required")),
            407 => Self::new(SynologyErrorKind::IpBlocked, format!("{context}: IP blocked by auto-block")),
            408..=410 => Self::auth(format!("{context}: Password expired (code {code})")),
            449 => Self::approve_signin(format!("{context}: Approve sign-in required")),
            _ => Self::api(code, format!("{context}: DSM error code {code}")),
        }
    }
}

impl fmt::Display for SynologyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for SynologyError {}

impl From<reqwest::Error> for SynologyError {
    fn from(e: reqwest::Error) -> Self {
        Self::connection(format!("HTTP error: {e}"))
    }
}

impl From<serde_json::Error> for SynologyError {
    fn from(e: serde_json::Error) -> Self {
        Self::parse(format!("JSON parse error: {e}"))
    }
}

impl From<url::ParseError> for SynologyError {
    fn from(e: url::ParseError) -> Self {
        Self::connection(format!("URL parse error: {e}"))
    }
}

/// Convenience type alias.
pub type SynologyResult<T> = Result<T, SynologyError>;
