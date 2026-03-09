//! # SNMP Error Types
//!
//! Structured error handling for all SNMP operations.

use std::fmt;

/// Categorises the kind of SNMP error that occurred.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum SnmpErrorKind {
    /// Network-level connectivity failure (socket, DNS, unreachable).
    Connection,
    /// Request timed out waiting for a response.
    Timeout,
    /// Authentication or authorisation failure (bad community / USM creds).
    Auth,
    /// The agent returned a protocol-level error-status (noSuchName, badValue, etc.).
    ProtocolError,
    /// BER / ASN.1 encoding or decoding failure.
    Encoding,
    /// Invalid or malformed OID string.
    InvalidOid,
    /// Requested OID does not exist on the agent (noSuchObject / noSuchInstance / endOfMibView).
    NoSuchObject,
    /// SET operation was rejected by the agent.
    SetRejected,
    /// SNMPv3 USM engine discovery or time-window failure.
    UsmError,
    /// SNMPv3 privacy (encryption/decryption) failure.
    PrivacyError,
    /// MIB parsing or resolution error.
    MibError,
    /// Trap listener error (bind, receive, parse).
    TrapError,
    /// Discovery / scan error.
    DiscoveryError,
    /// Monitoring / polling engine error.
    MonitorError,
    /// Table retrieval error.
    TableError,
    /// Invalid or missing configuration.
    Config,
    /// Serialisation / deserialisation error.
    Serialization,
    /// Generic / uncategorised error.
    Other,
}

impl fmt::Display for SnmpErrorKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Connection => write!(f, "Connection"),
            Self::Timeout => write!(f, "Timeout"),
            Self::Auth => write!(f, "Auth"),
            Self::ProtocolError => write!(f, "ProtocolError"),
            Self::Encoding => write!(f, "Encoding"),
            Self::InvalidOid => write!(f, "InvalidOid"),
            Self::NoSuchObject => write!(f, "NoSuchObject"),
            Self::SetRejected => write!(f, "SetRejected"),
            Self::UsmError => write!(f, "UsmError"),
            Self::PrivacyError => write!(f, "PrivacyError"),
            Self::MibError => write!(f, "MibError"),
            Self::TrapError => write!(f, "TrapError"),
            Self::DiscoveryError => write!(f, "DiscoveryError"),
            Self::MonitorError => write!(f, "MonitorError"),
            Self::TableError => write!(f, "TableError"),
            Self::Config => write!(f, "Config"),
            Self::Serialization => write!(f, "Serialization"),
            Self::Other => write!(f, "Other"),
        }
    }
}

/// Structured SNMP error with a kind discriminant and human-readable message.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SnmpError {
    pub kind: SnmpErrorKind,
    pub message: String,
}

impl SnmpError {
    pub fn new(kind: SnmpErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(SnmpErrorKind::Connection, msg)
    }

    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(SnmpErrorKind::Timeout, msg)
    }

    pub fn auth(msg: impl Into<String>) -> Self {
        Self::new(SnmpErrorKind::Auth, msg)
    }

    pub fn protocol_error(msg: impl Into<String>) -> Self {
        Self::new(SnmpErrorKind::ProtocolError, msg)
    }

    pub fn encoding(msg: impl Into<String>) -> Self {
        Self::new(SnmpErrorKind::Encoding, msg)
    }

    pub fn invalid_oid(msg: impl Into<String>) -> Self {
        Self::new(SnmpErrorKind::InvalidOid, msg)
    }

    pub fn no_such_object(msg: impl Into<String>) -> Self {
        Self::new(SnmpErrorKind::NoSuchObject, msg)
    }

    pub fn set_rejected(msg: impl Into<String>) -> Self {
        Self::new(SnmpErrorKind::SetRejected, msg)
    }

    pub fn usm_error(msg: impl Into<String>) -> Self {
        Self::new(SnmpErrorKind::UsmError, msg)
    }

    pub fn privacy_error(msg: impl Into<String>) -> Self {
        Self::new(SnmpErrorKind::PrivacyError, msg)
    }

    pub fn mib_error(msg: impl Into<String>) -> Self {
        Self::new(SnmpErrorKind::MibError, msg)
    }

    pub fn trap_error(msg: impl Into<String>) -> Self {
        Self::new(SnmpErrorKind::TrapError, msg)
    }

    pub fn discovery_error(msg: impl Into<String>) -> Self {
        Self::new(SnmpErrorKind::DiscoveryError, msg)
    }

    pub fn monitor_error(msg: impl Into<String>) -> Self {
        Self::new(SnmpErrorKind::MonitorError, msg)
    }

    pub fn table_error(msg: impl Into<String>) -> Self {
        Self::new(SnmpErrorKind::TableError, msg)
    }

    pub fn config(msg: impl Into<String>) -> Self {
        Self::new(SnmpErrorKind::Config, msg)
    }

    pub fn serialization(msg: impl Into<String>) -> Self {
        Self::new(SnmpErrorKind::Serialization, msg)
    }

    pub fn other(msg: impl Into<String>) -> Self {
        Self::new(SnmpErrorKind::Other, msg)
    }
}

impl fmt::Display for SnmpError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[SNMP:{}] {}", self.kind, self.message)
    }
}

impl std::error::Error for SnmpError {}

impl From<SnmpError> for String {
    fn from(e: SnmpError) -> String {
        e.to_string()
    }
}

/// Convenience result alias used throughout the crate.
pub type SnmpResult<T> = Result<T, SnmpError>;
