//! Error types for the Dell iDRAC management crate.

use std::fmt;

/// Categorised error kinds covering all iDRAC protocol/domain errors.
#[derive(Debug, Clone)]
pub enum IdracErrorKind {
    /// iDRAC unreachable or session expired
    ConnectionError,
    /// Authentication failed (401 / bad credentials)
    AuthenticationError,
    /// Resource not found (404 / no such component)
    NotFound,
    /// Server is in an unexpected state for the requested operation
    InvalidState,
    /// BIOS configuration error
    BiosError,
    /// Storage / RAID operation error
    StorageError,
    /// Network configuration error
    NetworkError,
    /// Firmware update error
    FirmwareError,
    /// Lifecycle Controller error
    LifecycleError,
    /// Virtual media mount/unmount error
    VirtualMediaError,
    /// Virtual console / KVM error
    VirtualConsoleError,
    /// Event log / SEL error
    EventLogError,
    /// User management error
    UserError,
    /// Certificate management error
    CertificateError,
    /// Power management error
    PowerError,
    /// Thermal / cooling error
    ThermalError,
    /// Hardware inventory error
    HardwareError,
    /// Health rollup error
    HealthError,
    /// Telemetry / metrics error
    TelemetryError,
    /// RACADM command error
    RacadmError,
    /// WS-Management / SOAP protocol error
    WsmanError,
    /// IPMI protocol error
    IpmiError,
    /// HTTP / Redfish API error with status code
    ApiError(u16),
    /// Request timeout
    Timeout,
    /// Permission denied (403)
    AccessDenied,
    /// JSON/XML parse or deserialization error
    ParseError,
    /// Protocol not supported for this iDRAC generation
    UnsupportedProtocol,
    /// Job queue / task error
    JobError,
    /// Generic
    Other,
}

/// Crate error type carrying a kind + human-readable message.
#[derive(Debug, Clone)]
pub struct IdracError {
    pub kind: IdracErrorKind,
    pub message: String,
}

impl IdracError {
    pub fn new(kind: IdracErrorKind, msg: impl Into<String>) -> Self {
        Self { kind, message: msg.into() }
    }

    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(IdracErrorKind::ConnectionError, msg)
    }

    pub fn auth(msg: impl Into<String>) -> Self {
        Self::new(IdracErrorKind::AuthenticationError, msg)
    }

    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::new(IdracErrorKind::NotFound, msg)
    }

    pub fn api(status: u16, msg: impl Into<String>) -> Self {
        Self::new(IdracErrorKind::ApiError(status), msg)
    }

    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(IdracErrorKind::ParseError, msg)
    }

    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(IdracErrorKind::Timeout, msg)
    }

    pub fn invalid_state(msg: impl Into<String>) -> Self {
        Self::new(IdracErrorKind::InvalidState, msg)
    }

    pub fn access_denied(msg: impl Into<String>) -> Self {
        Self::new(IdracErrorKind::AccessDenied, msg)
    }

    pub fn bios(msg: impl Into<String>) -> Self {
        Self::new(IdracErrorKind::BiosError, msg)
    }

    pub fn storage(msg: impl Into<String>) -> Self {
        Self::new(IdracErrorKind::StorageError, msg)
    }

    pub fn network(msg: impl Into<String>) -> Self {
        Self::new(IdracErrorKind::NetworkError, msg)
    }

    pub fn firmware(msg: impl Into<String>) -> Self {
        Self::new(IdracErrorKind::FirmwareError, msg)
    }

    pub fn lifecycle(msg: impl Into<String>) -> Self {
        Self::new(IdracErrorKind::LifecycleError, msg)
    }

    pub fn virtual_media(msg: impl Into<String>) -> Self {
        Self::new(IdracErrorKind::VirtualMediaError, msg)
    }

    pub fn virtual_console(msg: impl Into<String>) -> Self {
        Self::new(IdracErrorKind::VirtualConsoleError, msg)
    }

    pub fn event_log(msg: impl Into<String>) -> Self {
        Self::new(IdracErrorKind::EventLogError, msg)
    }

    pub fn user(msg: impl Into<String>) -> Self {
        Self::new(IdracErrorKind::UserError, msg)
    }

    pub fn certificate(msg: impl Into<String>) -> Self {
        Self::new(IdracErrorKind::CertificateError, msg)
    }

    pub fn power(msg: impl Into<String>) -> Self {
        Self::new(IdracErrorKind::PowerError, msg)
    }

    pub fn thermal(msg: impl Into<String>) -> Self {
        Self::new(IdracErrorKind::ThermalError, msg)
    }

    pub fn hardware(msg: impl Into<String>) -> Self {
        Self::new(IdracErrorKind::HardwareError, msg)
    }

    pub fn health(msg: impl Into<String>) -> Self {
        Self::new(IdracErrorKind::HealthError, msg)
    }

    pub fn telemetry(msg: impl Into<String>) -> Self {
        Self::new(IdracErrorKind::TelemetryError, msg)
    }

    pub fn racadm(msg: impl Into<String>) -> Self {
        Self::new(IdracErrorKind::RacadmError, msg)
    }

    pub fn wsman(msg: impl Into<String>) -> Self {
        Self::new(IdracErrorKind::WsmanError, msg)
    }

    pub fn ipmi(msg: impl Into<String>) -> Self {
        Self::new(IdracErrorKind::IpmiError, msg)
    }

    pub fn unsupported(msg: impl Into<String>) -> Self {
        Self::new(IdracErrorKind::UnsupportedProtocol, msg)
    }

    pub fn job(msg: impl Into<String>) -> Self {
        Self::new(IdracErrorKind::JobError, msg)
    }
}

impl fmt::Display for IdracError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{:?}] {}", self.kind, self.message)
    }
}

impl std::error::Error for IdracError {}

/// Convenience result alias.
pub type IdracResult<T> = Result<T, IdracError>;
