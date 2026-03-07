//! Error types for the CUPS/IPP crate.

use std::fmt;

/// Broad categories of CUPS errors.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum CupsErrorKind {
    ConnectionFailed,
    AuthenticationFailed,
    SessionNotFound,
    PrinterNotFound,
    JobNotFound,
    ClassNotFound,
    IppError,
    PpdError,
    DriverError,
    PermissionDenied,
    ServerError,
    InvalidConfig,
    Timeout,
    SubscriptionError,
    ParseError,
    IoError,
    Other,
}

/// A structured CUPS error.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CupsError {
    pub kind: CupsErrorKind,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
    /// The IPP status-code when the error originated from an IPP response.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ipp_status_code: Option<u16>,
}

impl CupsError {
    pub fn new(kind: CupsErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            details: None,
            ipp_status_code: None,
        }
    }

    pub fn with_details(mut self, details: impl Into<String>) -> Self {
        self.details = Some(details.into());
        self
    }

    pub fn with_ipp_status(mut self, code: u16) -> Self {
        self.ipp_status_code = Some(code);
        self
    }

    // ── convenience constructors ────────────────────────────────

    pub fn connection_failed(msg: impl Into<String>) -> Self {
        Self::new(CupsErrorKind::ConnectionFailed, msg)
    }

    pub fn auth_failed(msg: impl Into<String>) -> Self {
        Self::new(CupsErrorKind::AuthenticationFailed, msg)
    }

    pub fn session_not_found(id: &str) -> Self {
        Self::new(CupsErrorKind::SessionNotFound, format!("Session not found: {id}"))
    }

    pub fn printer_not_found(name: &str) -> Self {
        Self::new(CupsErrorKind::PrinterNotFound, format!("Printer not found: {name}"))
    }

    pub fn job_not_found(id: u32) -> Self {
        Self::new(CupsErrorKind::JobNotFound, format!("Job not found: {id}"))
    }

    pub fn class_not_found(name: &str) -> Self {
        Self::new(CupsErrorKind::ClassNotFound, format!("Class not found: {name}"))
    }

    pub fn ipp_error(status: u16, msg: impl Into<String>) -> Self {
        Self::new(CupsErrorKind::IppError, msg).with_ipp_status(status)
    }

    pub fn ppd_error(msg: impl Into<String>) -> Self {
        Self::new(CupsErrorKind::PpdError, msg)
    }

    pub fn driver_error(msg: impl Into<String>) -> Self {
        Self::new(CupsErrorKind::DriverError, msg)
    }

    pub fn permission_denied(msg: impl Into<String>) -> Self {
        Self::new(CupsErrorKind::PermissionDenied, msg)
    }

    pub fn server_error(msg: impl Into<String>) -> Self {
        Self::new(CupsErrorKind::ServerError, msg)
    }

    pub fn invalid_config(msg: impl Into<String>) -> Self {
        Self::new(CupsErrorKind::InvalidConfig, msg)
    }

    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(CupsErrorKind::Timeout, msg)
    }

    pub fn parse_error(msg: impl Into<String>) -> Self {
        Self::new(CupsErrorKind::ParseError, msg)
    }
}

impl fmt::Display for CupsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{:?}] {}", self.kind, self.message)?;
        if let Some(ref d) = self.details {
            write!(f, " — {d}")?;
        }
        if let Some(code) = self.ipp_status_code {
            write!(f, " (IPP 0x{code:04x})")?;
        }
        Ok(())
    }
}

impl std::error::Error for CupsError {}

impl From<std::io::Error> for CupsError {
    fn from(err: std::io::Error) -> Self {
        Self::new(CupsErrorKind::IoError, err.to_string())
    }
}

impl From<serde_json::Error> for CupsError {
    fn from(err: serde_json::Error) -> Self {
        Self::new(CupsErrorKind::ParseError, err.to_string())
    }
}

impl From<reqwest::Error> for CupsError {
    fn from(err: reqwest::Error) -> Self {
        if err.is_timeout() {
            Self::timeout(err.to_string())
        } else if err.is_connect() {
            Self::connection_failed(err.to_string())
        } else {
            Self::new(CupsErrorKind::Other, err.to_string())
        }
    }
}

impl From<url::ParseError> for CupsError {
    fn from(err: url::ParseError) -> Self {
        Self::invalid_config(format!("Invalid URL: {err}"))
    }
}
