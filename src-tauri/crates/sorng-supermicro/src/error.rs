//! Crate-specific error types for Supermicro BMC management.

use sorng_bmc_common::error::{BmcError, BmcErrorKind};
use std::fmt;

/// Supermicro-specific error categories.
#[derive(Debug, Clone)]
pub enum SmcErrorKind {
    /// Wraps a generic BMC error.
    Bmc(BmcErrorKind),
    /// Legacy ATEN CGI web API error.
    LegacyWebError,
    /// License / activation key error.
    LicenseError,
    /// Security configuration error.
    SecurityError,
    /// Storage / RAID error.
    StorageError,
    /// Console / iKVM error.
    ConsoleError,
    /// Virtual media mount/eject error.
    VirtualMediaError,
    /// Firmware update error.
    FirmwareError,
    /// BIOS configuration error.
    BiosError,
    /// Event log error.
    EventLogError,
    /// User management error.
    UserError,
    /// Certificate error.
    CertificateError,
    /// Intel Node Manager error.
    NodeManagerError,
    /// Network configuration error.
    NetworkError,
    /// Power management error.
    PowerError,
    /// Thermal / cooling error.
    ThermalError,
    /// Hardware inventory error.
    HardwareError,
    /// Health rollup error.
    HealthError,
}

impl fmt::Display for SmcErrorKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Bmc(k) => write!(f, "BMC: {k}"),
            Self::LegacyWebError => write!(f, "Legacy web API error"),
            Self::LicenseError => write!(f, "License error"),
            Self::SecurityError => write!(f, "Security error"),
            Self::StorageError => write!(f, "Storage error"),
            Self::ConsoleError => write!(f, "Console error"),
            Self::VirtualMediaError => write!(f, "Virtual media error"),
            Self::FirmwareError => write!(f, "Firmware error"),
            Self::BiosError => write!(f, "BIOS error"),
            Self::EventLogError => write!(f, "Event log error"),
            Self::UserError => write!(f, "User management error"),
            Self::CertificateError => write!(f, "Certificate error"),
            Self::NodeManagerError => write!(f, "Intel Node Manager error"),
            Self::NetworkError => write!(f, "Network error"),
            Self::PowerError => write!(f, "Power error"),
            Self::ThermalError => write!(f, "Thermal error"),
            Self::HardwareError => write!(f, "Hardware error"),
            Self::HealthError => write!(f, "Health error"),
        }
    }
}

/// Supermicro BMC error.
#[derive(Debug, Clone)]
pub struct SmcError {
    pub kind: SmcErrorKind,
    pub message: String,
    pub source_url: Option<String>,
}

impl fmt::Display for SmcError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{}] {}", self.kind, self.message)?;
        if let Some(ref url) = self.source_url {
            write!(f, " (url: {url})")?;
        }
        Ok(())
    }
}

impl std::error::Error for SmcError {}

impl SmcError {
    pub fn new(kind: SmcErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            source_url: None,
        }
    }

    pub fn with_url(mut self, url: impl Into<String>) -> Self {
        self.source_url = Some(url.into());
        self
    }

    // Convenience constructors
    pub fn legacy_web(msg: impl Into<String>) -> Self {
        Self::new(SmcErrorKind::LegacyWebError, msg)
    }
    pub fn license(msg: impl Into<String>) -> Self {
        Self::new(SmcErrorKind::LicenseError, msg)
    }
    pub fn security(msg: impl Into<String>) -> Self {
        Self::new(SmcErrorKind::SecurityError, msg)
    }
    pub fn storage(msg: impl Into<String>) -> Self {
        Self::new(SmcErrorKind::StorageError, msg)
    }
    pub fn console(msg: impl Into<String>) -> Self {
        Self::new(SmcErrorKind::ConsoleError, msg)
    }
    pub fn virtual_media(msg: impl Into<String>) -> Self {
        Self::new(SmcErrorKind::VirtualMediaError, msg)
    }
    pub fn firmware(msg: impl Into<String>) -> Self {
        Self::new(SmcErrorKind::FirmwareError, msg)
    }
    pub fn bios(msg: impl Into<String>) -> Self {
        Self::new(SmcErrorKind::BiosError, msg)
    }
    pub fn event_log(msg: impl Into<String>) -> Self {
        Self::new(SmcErrorKind::EventLogError, msg)
    }
    pub fn user(msg: impl Into<String>) -> Self {
        Self::new(SmcErrorKind::UserError, msg)
    }
    pub fn certificate(msg: impl Into<String>) -> Self {
        Self::new(SmcErrorKind::CertificateError, msg)
    }
    pub fn node_manager(msg: impl Into<String>) -> Self {
        Self::new(SmcErrorKind::NodeManagerError, msg)
    }
    pub fn network(msg: impl Into<String>) -> Self {
        Self::new(SmcErrorKind::NetworkError, msg)
    }
    pub fn power(msg: impl Into<String>) -> Self {
        Self::new(SmcErrorKind::PowerError, msg)
    }
    pub fn thermal(msg: impl Into<String>) -> Self {
        Self::new(SmcErrorKind::ThermalError, msg)
    }
    pub fn hardware(msg: impl Into<String>) -> Self {
        Self::new(SmcErrorKind::HardwareError, msg)
    }
    pub fn health(msg: impl Into<String>) -> Self {
        Self::new(SmcErrorKind::HealthError, msg)
    }
}

impl From<BmcError> for SmcError {
    fn from(e: BmcError) -> Self {
        Self {
            kind: SmcErrorKind::Bmc(e.kind),
            message: e.message,
            source_url: e.source_url,
        }
    }
}

impl serde::Serialize for SmcError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

/// Result alias for Supermicro BMC operations.
pub type SmcResult<T> = Result<T, SmcError>;
