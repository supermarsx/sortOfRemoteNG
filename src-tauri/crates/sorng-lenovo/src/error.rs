//! Error types for the Lenovo XCC/IMM management crate.

use sorng_bmc_common::error::BmcError;
use std::fmt;

/// Categorised error kinds for Lenovo BMC operations.
#[derive(Debug, Clone)]
pub enum LenovoErrorKind {
    // ── Common (wrapping BmcError) ──────────────────────────────────
    ConnectionError,
    AuthenticationError,
    NotFound,
    InvalidState,
    ApiError(u16),
    Timeout,
    AccessDenied,
    ParseError,
    UnsupportedProtocol,
    IpmiError,

    // ── Lenovo-specific ─────────────────────────────────────────────
    /// Legacy REST API error (IMM2-specific)
    LegacyRestError,
    /// License management error
    LicenseError,
    /// Security configuration error
    SecurityError,
    /// Storage / RAID operation error
    StorageError,
    /// Virtual console / KVM error
    ConsoleError,
    /// Virtual media mount/unmount error
    VirtualMediaError,
    /// Firmware update error
    FirmwareError,
    /// BIOS configuration error
    BiosError,
    /// Event log error
    EventLogError,
    /// User management error
    UserError,
    /// Certificate management error
    CertificateError,
    /// OneCLI passthrough error
    OnecliError,
    /// Network configuration error
    NetworkError,
    /// Power management error
    PowerError,
    /// Thermal / cooling error
    ThermalError,
    /// Hardware inventory error
    HardwareError,
    /// Health rollup error
    HealthError,

    /// Generic catch-all
    Other,
}

/// Crate error type carrying a kind + human-readable message.
#[derive(Debug, Clone)]
pub struct LenovoError {
    pub kind: LenovoErrorKind,
    pub message: String,
}

impl LenovoError {
    pub fn new(kind: LenovoErrorKind, msg: impl Into<String>) -> Self {
        Self {
            kind,
            message: msg.into(),
        }
    }

    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(LenovoErrorKind::ConnectionError, msg)
    }
    pub fn auth(msg: impl Into<String>) -> Self {
        Self::new(LenovoErrorKind::AuthenticationError, msg)
    }
    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::new(LenovoErrorKind::NotFound, msg)
    }
    pub fn api(status: u16, msg: impl Into<String>) -> Self {
        Self::new(LenovoErrorKind::ApiError(status), msg)
    }
    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(LenovoErrorKind::ParseError, msg)
    }
    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(LenovoErrorKind::Timeout, msg)
    }
    pub fn invalid_state(msg: impl Into<String>) -> Self {
        Self::new(LenovoErrorKind::InvalidState, msg)
    }
    pub fn access_denied(msg: impl Into<String>) -> Self {
        Self::new(LenovoErrorKind::AccessDenied, msg)
    }
    pub fn unsupported(msg: impl Into<String>) -> Self {
        Self::new(LenovoErrorKind::UnsupportedProtocol, msg)
    }
    pub fn legacy_rest(msg: impl Into<String>) -> Self {
        Self::new(LenovoErrorKind::LegacyRestError, msg)
    }
    pub fn license(msg: impl Into<String>) -> Self {
        Self::new(LenovoErrorKind::LicenseError, msg)
    }
    pub fn security(msg: impl Into<String>) -> Self {
        Self::new(LenovoErrorKind::SecurityError, msg)
    }
    pub fn storage(msg: impl Into<String>) -> Self {
        Self::new(LenovoErrorKind::StorageError, msg)
    }
    pub fn console(msg: impl Into<String>) -> Self {
        Self::new(LenovoErrorKind::ConsoleError, msg)
    }
    pub fn virtual_media(msg: impl Into<String>) -> Self {
        Self::new(LenovoErrorKind::VirtualMediaError, msg)
    }
    pub fn firmware(msg: impl Into<String>) -> Self {
        Self::new(LenovoErrorKind::FirmwareError, msg)
    }
    pub fn bios(msg: impl Into<String>) -> Self {
        Self::new(LenovoErrorKind::BiosError, msg)
    }
    pub fn event_log(msg: impl Into<String>) -> Self {
        Self::new(LenovoErrorKind::EventLogError, msg)
    }
    pub fn user(msg: impl Into<String>) -> Self {
        Self::new(LenovoErrorKind::UserError, msg)
    }
    pub fn certificate(msg: impl Into<String>) -> Self {
        Self::new(LenovoErrorKind::CertificateError, msg)
    }
    pub fn onecli(msg: impl Into<String>) -> Self {
        Self::new(LenovoErrorKind::OnecliError, msg)
    }
    pub fn network(msg: impl Into<String>) -> Self {
        Self::new(LenovoErrorKind::NetworkError, msg)
    }
    pub fn power(msg: impl Into<String>) -> Self {
        Self::new(LenovoErrorKind::PowerError, msg)
    }
    pub fn thermal(msg: impl Into<String>) -> Self {
        Self::new(LenovoErrorKind::ThermalError, msg)
    }
    pub fn hardware(msg: impl Into<String>) -> Self {
        Self::new(LenovoErrorKind::HardwareError, msg)
    }
    pub fn health(msg: impl Into<String>) -> Self {
        Self::new(LenovoErrorKind::HealthError, msg)
    }
    pub fn ipmi(msg: impl Into<String>) -> Self {
        Self::new(LenovoErrorKind::IpmiError, msg)
    }
}

impl fmt::Display for LenovoError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{:?}] {}", self.kind, self.message)
    }
}

impl std::error::Error for LenovoError {}

/// Convert common BMC errors into Lenovo errors.
impl From<BmcError> for LenovoError {
    fn from(e: BmcError) -> Self {
        use sorng_bmc_common::error::BmcErrorKind;
        let kind = match &e.kind {
            BmcErrorKind::ConnectionError => LenovoErrorKind::ConnectionError,
            BmcErrorKind::AuthenticationError => LenovoErrorKind::AuthenticationError,
            BmcErrorKind::NotFound => LenovoErrorKind::NotFound,
            BmcErrorKind::InvalidState => LenovoErrorKind::InvalidState,
            BmcErrorKind::ApiError(s) => LenovoErrorKind::ApiError(*s),
            BmcErrorKind::Timeout => LenovoErrorKind::Timeout,
            BmcErrorKind::AccessDenied => LenovoErrorKind::AccessDenied,
            BmcErrorKind::ParseError => LenovoErrorKind::ParseError,
            BmcErrorKind::UnsupportedProtocol => LenovoErrorKind::UnsupportedProtocol,
            BmcErrorKind::IpmiError => LenovoErrorKind::IpmiError,
            BmcErrorKind::Other => LenovoErrorKind::Other,
        };
        Self {
            kind,
            message: e.message,
        }
    }
}

/// Convenience type alias.
pub type LenovoResult<T> = Result<T, LenovoError>;
