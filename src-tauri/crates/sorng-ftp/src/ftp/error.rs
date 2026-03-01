//! FTP-specific error type.

use serde::{Deserialize, Serialize};
use std::fmt;

/// Categorised FTP error.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FtpError {
    pub kind: FtpErrorKind,
    pub message: String,
    /// FTP response code that triggered the error, if any.
    pub code: Option<u16>,
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum FtpErrorKind {
    /// TCP / DNS resolution failure.
    ConnectionFailed,
    /// AUTH TLS / TLS handshake failure.
    TlsFailed,
    /// Wrong username/password.
    AuthFailed,
    /// Server returned a 4xx/5xx for a command.
    CommandRejected,
    /// Data channel could not be established (PASV/PORT failed).
    DataChannelFailed,
    /// Transfer aborted, incomplete, or timed out.
    TransferFailed,
    /// Server sent an un-parseable response.
    ProtocolError,
    /// An I/O error on the local side (file read/write).
    IoError,
    /// Operation timed out.
    Timeout,
    /// Session was not found (invalid session_id).
    SessionNotFound,
    /// Session is disconnected / dropped.
    Disconnected,
    /// Permission denied on the server.
    PermissionDenied,
    /// File/directory not found on the server.
    NotFound,
    /// Disk quota exceeded.
    QuotaExceeded,
    /// Operation cancelled by user.
    Cancelled,
    /// Config / parameter validation error.
    InvalidConfig,
    /// Catch-all.
    Unknown,
}

pub type FtpResult<T> = Result<T, FtpError>;

// ── Construction helpers ─────────────────────────────────────────────

impl FtpError {
    pub fn new(kind: FtpErrorKind, msg: impl Into<String>) -> Self {
        Self {
            kind,
            message: msg.into(),
            code: None,
            session_id: None,
        }
    }

    pub fn with_code(mut self, code: u16) -> Self {
        self.code = Some(code);
        self
    }

    pub fn with_session(mut self, id: impl Into<String>) -> Self {
        self.session_id = Some(id.into());
        self
    }

    // ── Convenience constructors ─────────────────────────────────

    pub fn connection_failed(msg: impl Into<String>) -> Self {
        Self::new(FtpErrorKind::ConnectionFailed, msg)
    }

    pub fn tls_failed(msg: impl Into<String>) -> Self {
        Self::new(FtpErrorKind::TlsFailed, msg)
    }

    pub fn auth_failed(msg: impl Into<String>) -> Self {
        Self::new(FtpErrorKind::AuthFailed, msg)
    }

    pub fn command_rejected(code: u16, msg: impl Into<String>) -> Self {
        Self::new(FtpErrorKind::CommandRejected, msg).with_code(code)
    }

    pub fn data_channel(msg: impl Into<String>) -> Self {
        Self::new(FtpErrorKind::DataChannelFailed, msg)
    }

    pub fn transfer_failed(msg: impl Into<String>) -> Self {
        Self::new(FtpErrorKind::TransferFailed, msg)
    }

    pub fn protocol_error(msg: impl Into<String>) -> Self {
        Self::new(FtpErrorKind::ProtocolError, msg)
    }

    pub fn io_error(msg: impl Into<String>) -> Self {
        Self::new(FtpErrorKind::IoError, msg)
    }

    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(FtpErrorKind::Timeout, msg)
    }

    pub fn session_not_found(id: &str) -> Self {
        Self::new(
            FtpErrorKind::SessionNotFound,
            format!("FTP session '{}' not found", id),
        )
        .with_session(id)
    }

    pub fn disconnected(msg: impl Into<String>) -> Self {
        Self::new(FtpErrorKind::Disconnected, msg)
    }

    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::new(FtpErrorKind::NotFound, msg)
    }

    pub fn invalid_config(msg: impl Into<String>) -> Self {
        Self::new(FtpErrorKind::InvalidConfig, msg)
    }

    pub fn unsupported(msg: impl Into<String>) -> Self {
        Self::new(FtpErrorKind::InvalidConfig, msg)
    }

    pub fn pool_exhausted(msg: impl Into<String>) -> Self {
        Self::new(FtpErrorKind::InvalidConfig, msg)
    }

    /// Classify an FTP reply code into the most appropriate error kind.
    pub fn from_reply(code: u16, text: &str) -> Self {
        let kind = match code {
            421 => FtpErrorKind::Disconnected,
            425 | 426 => FtpErrorKind::DataChannelFailed,
            430 | 530 => FtpErrorKind::AuthFailed,
            450 | 550 => {
                let lower = text.to_lowercase();
                if lower.contains("permission") || lower.contains("denied") {
                    FtpErrorKind::PermissionDenied
                } else if lower.contains("not found") || lower.contains("no such") {
                    FtpErrorKind::NotFound
                } else if lower.contains("quota") {
                    FtpErrorKind::QuotaExceeded
                } else {
                    FtpErrorKind::CommandRejected
                }
            }
            451 | 452 | 552 => FtpErrorKind::TransferFailed,
            500..=504 => FtpErrorKind::CommandRejected,
            _ if code >= 400 => FtpErrorKind::CommandRejected,
            _ => FtpErrorKind::Unknown,
        };
        Self {
            kind,
            message: text.to_string(),
            code: Some(code),
            session_id: None,
        }
    }
}

impl fmt::Display for FtpError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if let Some(code) = self.code {
            write!(f, "[FTP {:?} {}] {}", self.kind, code, self.message)
        } else {
            write!(f, "[FTP {:?}] {}", self.kind, self.message)
        }
    }
}

impl std::error::Error for FtpError {}

impl From<std::io::Error> for FtpError {
    fn from(e: std::io::Error) -> Self {
        if e.kind() == std::io::ErrorKind::TimedOut {
            Self::timeout(format!("I/O timeout: {}", e))
        } else {
            Self::io_error(e.to_string())
        }
    }
}

impl From<FtpError> for String {
    fn from(e: FtpError) -> String {
        e.message
    }
}

impl From<native_tls::Error> for FtpError {
    fn from(e: native_tls::Error) -> Self {
        Self::tls_failed(e.to_string())
    }
}
