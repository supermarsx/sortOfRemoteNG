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
    pub(crate) diagnostic: Option<crate::response_diagnostics::ResponseDiagnostic>,
}

impl SynologyError {
    /// Safe explanations for common File Station failures. Never include the
    /// NAS's nested error details, which can contain private paths or tokens.
    /// Keep the numeric kind for the scoped login challenge dispatcher.
    pub fn file_station(code: i32) -> Self {
        let detail = match code {
            105 => "The account's API session lacks permission. Check the account's File Station application permissions in DSM.",
            106 => "The NAS API session timed out. Reconnect before continuing; inspect the destination before retrying a change.",
            107 => "The NAS ended this API session after another login. Reconnect before continuing; failed operations were not replayed.",
            119 => "The NAS rejected the API session ID (SID not found or invalid). Reconnect to File Station. If this happens immediately after sign-in, verify that login and API requests reach the same DSM server. This code alone does not indicate a wrong password or a certificate failure.",
            150 => "The request source IP differs from the login IP. Check your network route, then reconnect; failed operations were not replayed.",
            _ => return Self::api(code, format!("File Station request failed (DSM code {code})")),
        };
        Self::api(
            code,
            format!("File Station request failed (DSM code {code}). {detail}"),
        )
    }

    pub fn new(kind: SynologyErrorKind, msg: impl Into<String>) -> Self {
        Self {
            kind,
            message: msg.into(),
            diagnostic: None,
        }
    }

    pub(crate) fn with_diagnostic_from(mut self, source: &Self) -> Self {
        self.diagnostic = source.diagnostic;
        self
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
            100 => Self::new(
                SynologyErrorKind::Unknown,
                format!("{context}: Unknown error"),
            ),
            101..=104 => Self::api(
                code,
                format!("{context}: Invalid API request (code {code})"),
            ),
            105 | 120 => Self::permission(format!("{context}: Permission denied (code {code})")),
            106 => Self::session_expired(format!("{context}: Session timeout")),
            107 => {
                Self::session_expired(format!("{context}: Session interrupted by duplicate login"))
            }
            108 => Self::new(
                SynologyErrorKind::FileOperationError,
                format!("{context}: File upload failed"),
            ),
            109..=111 | 117 | 118 => Self::busy(format!(
                "{context}: Network unstable or system busy (code {code})"
            )),
            115 => Self::permission(format!("{context}: File upload is not permitted")),
            160 => Self::new(
                SynologyErrorKind::IpBlocked,
                format!("{context}: IP blocked (code {code})"),
            ),
            119 => Self::session_expired(format!("{context}: Invalid session")),
            150 => Self::session_expired(format!("{context}: Session source IP changed")),
            // Auth-specific
            400 if context == "SYNO.API.Auth" => {
                Self::auth(format!("{context}: Invalid credentials"))
            }
            401 if context == "SYNO.API.Auth" => Self::auth(format!("{context}: Account disabled")),
            402 if context == "SYNO.API.Auth" => {
                Self::permission(format!("{context}: Permission denied"))
            }
            403 if context == "SYNO.API.Auth" => {
                Self::two_factor(format!("{context}: 2FA code required"))
            }
            404 if context == "SYNO.API.Auth" => Self::auth(format!("{context}: Invalid 2FA code")),
            406 if context == "SYNO.API.Auth" => {
                Self::two_factor(format!("{context}: 2FA enforcement required"))
            }
            407 if context == "SYNO.API.Auth" => Self::new(
                SynologyErrorKind::IpBlocked,
                format!("{context}: IP blocked by auto-block"),
            ),
            408..=410 if context == "SYNO.API.Auth" => {
                Self::auth(format!("{context}: Password expired (code {code})"))
            }
            449 if context == "SYNO.API.Auth" => {
                Self::approve_signin(format!("{context}: Approve sign-in required"))
            }
            _ => Self::api(code, format!("{context}: DSM error code {code}")),
        }
    }
}

impl fmt::Display for SynologyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.message)?;
        if let Some(diagnostic) = self.diagnostic {
            write!(f, "{diagnostic}")?;
        }
        Ok(())
    }
}

impl std::error::Error for SynologyError {}

impl From<reqwest::Error> for SynologyError {
    fn from(e: reqwest::Error) -> Self {
        Self::connection(if e.is_timeout() {
            "NAS request timed out; its outcome may be unknown. Refresh before retrying a change."
        } else if e.is_connect() {
            "Unable to reach the NAS. Check its address and verified TLS certificate."
        } else {
            "NAS HTTP request failed. Refresh before retrying a change."
        })
    }
}

impl From<serde_json::Error> for SynologyError {
    fn from(_: serde_json::Error) -> Self {
        Self::parse("NAS returned an invalid or unsupported JSON response")
    }
}

impl From<url::ParseError> for SynologyError {
    fn from(e: url::ParseError) -> Self {
        Self::connection(format!("URL parse error: {e}"))
    }
}

/// Convenience type alias.
pub type SynologyResult<T> = Result<T, SynologyError>;

pub fn command_error(error: SynologyError) -> String {
    if let SynologyErrorKind::ApiError(code @ (106 | 107 | 119 | 150)) = error.kind {
        let mut message = format!(
            "SYNOLOGY_SESSION_EXPIRED: {}",
            SynologyError::file_station(code)
        );
        if let Some(diagnostic) = error.diagnostic {
            message.push_str(&diagnostic.to_string());
        }
        message
    } else if matches!(error.kind, SynologyErrorKind::SessionExpired) {
        let mut message = "SYNOLOGY_SESSION_EXPIRED: This Synology session ended. Connect again before continuing.".to_string();
        if let Some(diagnostic) = error.diagnostic {
            message.push_str(&diagnostic.to_string());
        }
        message
    } else {
        error.to_string()
    }
}
