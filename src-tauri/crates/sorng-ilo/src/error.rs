//! Error types for the HP iLO management crate.
//!
//! Wraps `sorng_bmc_common::error::BmcError` and adds iLO-specific variants.

use sorng_bmc_common::error::{BmcError, BmcErrorKind};
use std::fmt;

/// iLO-specific error kinds beyond the base BMC errors.
#[derive(Debug, Clone)]
pub enum IloErrorKind {
    /// Base BMC error (Redfish, IPMI, connection, etc.)
    Bmc(BmcErrorKind),
    /// RIBCL XML protocol error
    RibclError,
    /// iLO license error (feature requires Advanced/Premium)
    LicenseError,
    /// Federation error
    FederationError,
    /// Security / encryption error
    SecurityError,
    /// Smart Array / storage error
    StorageError,
    /// Virtual console not available
    ConsoleError,
    /// Virtual media error
    VirtualMediaError,
    /// Firmware update error
    FirmwareError,
    /// BIOS / boot configuration error
    BiosError,
    /// Event log error (IML / iLO log)
    EventLogError,
    /// User management error
    UserError,
    /// Certificate management error
    CertificateError,
}

/// Crate error type.
#[derive(Debug, Clone)]
pub struct IloError {
    pub kind: IloErrorKind,
    pub message: String,
}

impl IloError {
    pub fn new(kind: IloErrorKind, msg: impl Into<String>) -> Self {
        Self { kind, message: msg.into() }
    }

    // ── Convenience constructors ────────────────────────────────────

    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(IloErrorKind::Bmc(BmcErrorKind::ConnectionError), msg)
    }

    pub fn auth(msg: impl Into<String>) -> Self {
        Self::new(IloErrorKind::Bmc(BmcErrorKind::AuthenticationError), msg)
    }

    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::new(IloErrorKind::Bmc(BmcErrorKind::NotFound), msg)
    }

    pub fn api(status: u16, msg: impl Into<String>) -> Self {
        Self::new(IloErrorKind::Bmc(BmcErrorKind::ApiError(status)), msg)
    }

    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(IloErrorKind::Bmc(BmcErrorKind::ParseError), msg)
    }

    pub fn unsupported(msg: impl Into<String>) -> Self {
        Self::new(IloErrorKind::Bmc(BmcErrorKind::UnsupportedProtocol), msg)
    }

    pub fn ipmi(msg: impl Into<String>) -> Self {
        Self::new(IloErrorKind::Bmc(BmcErrorKind::IpmiError), msg)
    }

    pub fn access_denied(msg: impl Into<String>) -> Self {
        Self::new(IloErrorKind::Bmc(BmcErrorKind::AccessDenied), msg)
    }

    pub fn ribcl(msg: impl Into<String>) -> Self {
        Self::new(IloErrorKind::RibclError, msg)
    }

    pub fn license(msg: impl Into<String>) -> Self {
        Self::new(IloErrorKind::LicenseError, msg)
    }

    pub fn federation(msg: impl Into<String>) -> Self {
        Self::new(IloErrorKind::FederationError, msg)
    }

    pub fn security(msg: impl Into<String>) -> Self {
        Self::new(IloErrorKind::SecurityError, msg)
    }

    pub fn storage(msg: impl Into<String>) -> Self {
        Self::new(IloErrorKind::StorageError, msg)
    }

    pub fn console(msg: impl Into<String>) -> Self {
        Self::new(IloErrorKind::ConsoleError, msg)
    }

    pub fn virtual_media(msg: impl Into<String>) -> Self {
        Self::new(IloErrorKind::VirtualMediaError, msg)
    }

    pub fn firmware(msg: impl Into<String>) -> Self {
        Self::new(IloErrorKind::FirmwareError, msg)
    }

    pub fn bios(msg: impl Into<String>) -> Self {
        Self::new(IloErrorKind::BiosError, msg)
    }

    pub fn event_log(msg: impl Into<String>) -> Self {
        Self::new(IloErrorKind::EventLogError, msg)
    }

    pub fn user(msg: impl Into<String>) -> Self {
        Self::new(IloErrorKind::UserError, msg)
    }

    pub fn certificate(msg: impl Into<String>) -> Self {
        Self::new(IloErrorKind::CertificateError, msg)
    }
}

impl fmt::Display for IloError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{:?}] {}", self.kind, self.message)
    }
}

impl std::error::Error for IloError {}

impl From<BmcError> for IloError {
    fn from(e: BmcError) -> Self {
        Self {
            kind: IloErrorKind::Bmc(e.kind),
            message: e.message,
        }
    }
}

/// Convenience alias.
pub type IloResult<T> = Result<T, IloError>;
