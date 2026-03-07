//! IPMI error types — comprehensive error enum covering every failure mode
//! from transport through protocol parsing, authentication, and subsystem
//! operations.

use std::fmt;
use thiserror::Error;

use crate::types::CompletionCode;

/// Result type alias for IPMI operations.
pub type IpmiResult<T> = Result<T, IpmiError>;

/// Comprehensive error type for all IPMI operations.
#[derive(Debug, Error)]
pub enum IpmiError {
    // ── Transport / connection ──────────────────────────────────────

    /// Failed to establish a UDP connection to the BMC.
    #[error("Connection failed: {message}")]
    ConnectionFailed {
        message: String,
        #[source]
        source: Option<Box<dyn std::error::Error + Send + Sync>>,
    },

    /// Connection was lost or unexpectedly closed.
    #[error("Connection lost: {0}")]
    ConnectionLost(String),

    /// Command timed out waiting for BMC response.
    #[error("Timeout after {timeout_ms}ms waiting for response (retries: {retries})")]
    Timeout { timeout_ms: u64, retries: u8 },

    /// DNS resolution or address parsing failed.
    #[error("Address resolution failed for '{host}': {reason}")]
    AddressResolution { host: String, reason: String },

    // ── Authentication / session ────────────────────────────────────

    /// Authentication with the BMC failed.
    #[error("Authentication failed: {0}")]
    AuthenticationFailed(String),

    /// Session was not found in the session map.
    #[error("Session not found: {session_id}")]
    SessionNotFound { session_id: String },

    /// Session expired or was closed by the BMC.
    #[error("Session expired: {session_id}")]
    SessionExpired { session_id: String },

    /// Privilege level insufficient for the requested operation.
    #[error("Insufficient privilege: requested {requested:?}, active {active:?}")]
    InsufficientPrivilege {
        requested: String,
        active: String,
    },

    /// RAKP handshake failure during IPMI 2.0 session establishment.
    #[error("RAKP handshake failed at step {step}: {reason}")]
    RakpFailed { step: u8, reason: String },

    /// Cipher suite negotiation failed.
    #[error("Cipher suite {suite_id} not supported by BMC")]
    CipherSuiteUnsupported { suite_id: u8 },

    /// Key exchange / derivation error.
    #[error("Key exchange error: {0}")]
    KeyExchangeError(String),

    // ── Protocol / wire format ──────────────────────────────────────

    /// IPMI command failed with a non-zero completion code.
    #[error("Command failed: {code:?} — {}", code.description())]
    CompletionCodeError { code: CompletionCode },

    /// Generic command failure with a message.
    #[error("Command failed: {0}")]
    CommandFailed(String),

    /// Invalid or corrupt response from the BMC.
    #[error("Invalid response: {0}")]
    InvalidResponse(String),

    /// RMCP header or ASF format error.
    #[error("RMCP protocol error: {0}")]
    RmcpError(String),

    /// Message integrity check (auth code / HMAC) failed.
    #[error("Integrity check failed: {0}")]
    IntegrityCheckFailed(String),

    /// Payload decryption failure (IPMI 2.0).
    #[error("Decryption failed: {0}")]
    DecryptionFailed(String),

    /// Response checksum mismatch.
    #[error("Checksum error: expected 0x{expected:02X}, got 0x{actual:02X}")]
    ChecksumError { expected: u8, actual: u8 },

    /// Sequence number mismatch or reuse.
    #[error("Sequence mismatch: expected {expected}, got {actual}")]
    SequenceMismatch { expected: u32, actual: u32 },

    // ── Subsystem parsing errors ────────────────────────────────────

    /// SDR record parsing error.
    #[error("SDR parse error: {0}")]
    SdrParseError(String),

    /// SEL record parsing error.
    #[error("SEL parse error: {0}")]
    SelParseError(String),

    /// FRU data parsing error.
    #[error("FRU parse error: {0}")]
    FruParseError(String),

    /// SOL session or payload error.
    #[error("SOL error: {0}")]
    SolError(String),

    /// Sensor reading error.
    #[error("Sensor error: {0}")]
    SensorError(String),

    /// Watchdog timer configuration error.
    #[error("Watchdog error: {0}")]
    WatchdogError(String),

    /// LAN configuration parameter error.
    #[error("LAN config error: {0}")]
    LanConfigError(String),

    /// User management error.
    #[error("User management error: {0}")]
    UserError(String),

    /// PEF configuration error.
    #[error("PEF error: {0}")]
    PefError(String),

    /// Channel access or info error.
    #[error("Channel error: {0}")]
    ChannelError(String),

    // ── Bridging ────────────────────────────────────────────────────

    /// Bridged (Send Message) command error.
    #[error("Bridge error: target 0x{target_addr:02X} channel {channel}: {reason}")]
    BridgeError {
        target_addr: u8,
        channel: u8,
        reason: String,
    },

    // ── Generic / internal ──────────────────────────────────────────

    /// I/O error from tokio / std.
    #[error("I/O error: {0}")]
    IoError(#[from] std::io::Error),

    /// Serialization / deserialization error.
    #[error("Serialization error: {0}")]
    SerdeError(String),

    /// Internal logic error (should not happen).
    #[error("Internal error: {0}")]
    InternalError(String),

    /// Feature or command not supported by this implementation.
    #[error("Not supported: {0}")]
    NotSupported(String),

    /// Data too short to parse.
    #[error("Data too short: expected at least {expected} bytes, got {actual}")]
    DataTooShort { expected: usize, actual: usize },

    /// Invalid parameter supplied by caller.
    #[error("Invalid parameter: {0}")]
    InvalidParameter(String),
}

impl IpmiError {
    // ── Convenience constructors ────────────────────────────────────

    /// Create a `ConnectionFailed` error from a message string.
    pub fn connection_failed(msg: impl Into<String>) -> Self {
        Self::ConnectionFailed {
            message: msg.into(),
            source: None,
        }
    }

    /// Create a `ConnectionFailed` error from a message and underlying cause.
    pub fn connection_failed_with(
        msg: impl Into<String>,
        source: impl std::error::Error + Send + Sync + 'static,
    ) -> Self {
        Self::ConnectionFailed {
            message: msg.into(),
            source: Some(Box::new(source)),
        }
    }

    /// Create a `Timeout` error.
    pub fn timeout(timeout_ms: u64, retries: u8) -> Self {
        Self::Timeout {
            timeout_ms,
            retries,
        }
    }

    /// Create a `SessionNotFound` error.
    pub fn session_not_found(id: impl Into<String>) -> Self {
        Self::SessionNotFound {
            session_id: id.into(),
        }
    }

    /// Create an error from a raw completion code byte.
    pub fn from_completion_code(cc: u8) -> Self {
        let code = CompletionCode::from_byte(cc);
        if code == CompletionCode::Success {
            Self::InternalError("from_completion_code called with success code".into())
        } else {
            Self::CompletionCodeError { code }
        }
    }

    /// Return `Ok(())` if cc == 0x00, otherwise an error.
    pub fn check_completion_code(cc: u8) -> IpmiResult<()> {
        if cc == 0x00 {
            Ok(())
        } else {
            Err(Self::from_completion_code(cc))
        }
    }

    /// Create a `DataTooShort` error.
    pub fn data_too_short(expected: usize, actual: usize) -> Self {
        Self::DataTooShort { expected, actual }
    }

    /// Create a `ChecksumError`.
    pub fn checksum_error(expected: u8, actual: u8) -> Self {
        Self::ChecksumError { expected, actual }
    }

    /// Whether the error indicates the session is dead and should be removed.
    pub fn is_session_dead(&self) -> bool {
        matches!(
            self,
            Self::ConnectionLost(_)
                | Self::SessionExpired { .. }
                | Self::Timeout { .. }
        )
    }

    /// Whether the error is retryable.
    pub fn is_retryable(&self) -> bool {
        matches!(
            self,
            Self::Timeout { .. }
                | Self::CompletionCodeError {
                    code: CompletionCode::NodeBusy
                }
                | Self::CompletionCodeError {
                    code: CompletionCode::BmcInitializing
                }
        )
    }

    /// Human-readable short label for the error category.
    pub fn category(&self) -> &'static str {
        match self {
            Self::ConnectionFailed { .. } | Self::ConnectionLost(_) => "connection",
            Self::Timeout { .. } => "timeout",
            Self::AddressResolution { .. } => "address",
            Self::AuthenticationFailed(_)
            | Self::RakpFailed { .. }
            | Self::CipherSuiteUnsupported { .. }
            | Self::KeyExchangeError(_) => "authentication",
            Self::SessionNotFound { .. } | Self::SessionExpired { .. } => "session",
            Self::InsufficientPrivilege { .. } => "privilege",
            Self::CompletionCodeError { .. }
            | Self::CommandFailed(_)
            | Self::InvalidResponse(_) => "command",
            Self::RmcpError(_)
            | Self::IntegrityCheckFailed(_)
            | Self::DecryptionFailed(_)
            | Self::ChecksumError { .. }
            | Self::SequenceMismatch { .. } => "protocol",
            Self::SdrParseError(_)
            | Self::SelParseError(_)
            | Self::FruParseError(_)
            | Self::SolError(_)
            | Self::SensorError(_)
            | Self::WatchdogError(_)
            | Self::LanConfigError(_)
            | Self::UserError(_)
            | Self::PefError(_)
            | Self::ChannelError(_) => "subsystem",
            Self::BridgeError { .. } => "bridge",
            Self::IoError(_) => "io",
            Self::SerdeError(_) => "serde",
            Self::InternalError(_) | Self::NotSupported(_) => "internal",
            Self::DataTooShort { .. }
            | Self::InvalidParameter(_) => "validation",
        }
    }

    /// Convert to a user-presentable message (Tauri frontend).
    pub fn to_user_message(&self) -> String {
        format!("[{}] {}", self.category(), self)
    }
}

impl From<serde_json::Error> for IpmiError {
    fn from(e: serde_json::Error) -> Self {
        Self::SerdeError(e.to_string())
    }
}

/// Trait for mapping IPMI completion codes into typed errors.
pub trait CheckCompletionCode {
    /// Check an IPMI response for a non-zero completion code.
    fn check_cc(&self) -> IpmiResult<()>;
}

impl CheckCompletionCode for u8 {
    fn check_cc(&self) -> IpmiResult<()> {
        IpmiError::check_completion_code(*self)
    }
}

/// Severity classification for errors (useful for SEL/PEF).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Severity {
    /// Informational event — no action required.
    Informational,
    /// Warning — monitor, may need attention.
    Warning,
    /// Critical — immediate attention recommended.
    Critical,
    /// Non-recoverable — hardware failure, component replacement needed.
    NonRecoverable,
}

impl fmt::Display for Severity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Informational => write!(f, "Informational"),
            Self::Warning => write!(f, "Warning"),
            Self::Critical => write!(f, "Critical"),
            Self::NonRecoverable => write!(f, "Non-Recoverable"),
        }
    }
}

impl Severity {
    /// Classify severity from a threshold sensor event reading type offset.
    pub fn from_threshold_offset(offset: u8) -> Self {
        match offset {
            0x00 | 0x01 => Self::Warning,       // lower non-critical going low/high
            0x02 | 0x03 => Self::Critical,       // lower critical going low/high
            0x04 | 0x05 => Self::NonRecoverable, // lower non-recoverable
            0x06 | 0x07 => Self::Warning,        // upper non-critical
            0x08 | 0x09 => Self::Critical,       // upper critical
            0x0A | 0x0B => Self::NonRecoverable, // upper non-recoverable
            _ => Self::Informational,
        }
    }

    /// Classify severity from an event data severity nibble (PEF uses this).
    pub fn from_pef_severity(b: u8) -> Self {
        match b & 0x0F {
            0x01 => Self::Informational,
            0x02 => Self::Warning,
            0x04 => Self::Critical,
            0x08 => Self::NonRecoverable,
            _ => Self::Informational,
        }
    }
}
