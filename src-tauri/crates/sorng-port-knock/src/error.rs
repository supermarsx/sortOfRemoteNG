use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PortKnockError {
    ConnectionFailed(String),
    Timeout(String),
    InvalidSequence(String),
    InvalidPort(u16),
    InvalidProtocol(String),
    EncryptionError(String),
    DecryptionError(String),
    HmacVerificationFailed,
    ReplayDetected(String),
    KeyDerivationFailed(String),
    FirewallError(String),
    FirewallNotAvailable(String),
    RuleInsertionFailed(String),
    RuleRemovalFailed(String),
    KnockdConfigError(String),
    KnockdParseError { line: usize, message: String },
    FwknopError(String),
    FwknopProtocolError(String),
    SpaConstructionError(String),
    SpaVerificationFailed(String),
    ProfileNotFound(String),
    ProfileAlreadyExists(String),
    ProfileValidationError(String),
    HostNotFound(String),
    HostAlreadyExists(String),
    DnsResolutionFailed(String),
    Ipv6NotSupported,
    PortNotOpen { host: String, port: u16 },
    VerificationTimeout { host: String, port: u16, timeout_ms: u64 },
    SequenceGenerationFailed(String),
    ImportError(String),
    ExportError(String),
    HistoryError(String),
    IoError(String),
    SshCommandFailed(String),
    PermissionDenied(String),
    ConfigError(String),
    SerializationError(String),
    InternalError(String),
}

impl fmt::Display for PortKnockError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ConnectionFailed(msg) => write!(f, "Connection failed: {}", msg),
            Self::Timeout(msg) => write!(f, "Timeout: {}", msg),
            Self::InvalidSequence(msg) => write!(f, "Invalid sequence: {}", msg),
            Self::InvalidPort(port) => write!(f, "Invalid port: {}", port),
            Self::InvalidProtocol(proto) => write!(f, "Invalid protocol: {}", proto),
            Self::EncryptionError(msg) => write!(f, "Encryption error: {}", msg),
            Self::DecryptionError(msg) => write!(f, "Decryption error: {}", msg),
            Self::HmacVerificationFailed => write!(f, "HMAC verification failed"),
            Self::ReplayDetected(msg) => write!(f, "Replay detected: {}", msg),
            Self::KeyDerivationFailed(msg) => write!(f, "Key derivation failed: {}", msg),
            Self::FirewallError(msg) => write!(f, "Firewall error: {}", msg),
            Self::FirewallNotAvailable(fw) => write!(f, "Firewall not available: {}", fw),
            Self::RuleInsertionFailed(msg) => write!(f, "Rule insertion failed: {}", msg),
            Self::RuleRemovalFailed(msg) => write!(f, "Rule removal failed: {}", msg),
            Self::KnockdConfigError(msg) => write!(f, "knockd config error: {}", msg),
            Self::KnockdParseError { line, message } => write!(f, "knockd parse error at line {}: {}", line, message),
            Self::FwknopError(msg) => write!(f, "fwknop error: {}", msg),
            Self::FwknopProtocolError(msg) => write!(f, "fwknop protocol error: {}", msg),
            Self::SpaConstructionError(msg) => write!(f, "SPA construction error: {}", msg),
            Self::SpaVerificationFailed(msg) => write!(f, "SPA verification failed: {}", msg),
            Self::ProfileNotFound(name) => write!(f, "Profile not found: {}", name),
            Self::ProfileAlreadyExists(name) => write!(f, "Profile already exists: {}", name),
            Self::ProfileValidationError(msg) => write!(f, "Profile validation error: {}", msg),
            Self::HostNotFound(host) => write!(f, "Host not found: {}", host),
            Self::HostAlreadyExists(host) => write!(f, "Host already exists: {}", host),
            Self::DnsResolutionFailed(host) => write!(f, "DNS resolution failed: {}", host),
            Self::Ipv6NotSupported => write!(f, "IPv6 not supported"),
            Self::PortNotOpen { host, port } => write!(f, "Port {}:{} not open after knock", host, port),
            Self::VerificationTimeout { host, port, timeout_ms } => write!(f, "Verification timeout for {}:{} after {}ms", host, port, timeout_ms),
            Self::SequenceGenerationFailed(msg) => write!(f, "Sequence generation failed: {}", msg),
            Self::ImportError(msg) => write!(f, "Import error: {}", msg),
            Self::ExportError(msg) => write!(f, "Export error: {}", msg),
            Self::HistoryError(msg) => write!(f, "History error: {}", msg),
            Self::IoError(msg) => write!(f, "I/O error: {}", msg),
            Self::SshCommandFailed(msg) => write!(f, "SSH command failed: {}", msg),
            Self::PermissionDenied(msg) => write!(f, "Permission denied: {}", msg),
            Self::ConfigError(msg) => write!(f, "Config error: {}", msg),
            Self::SerializationError(msg) => write!(f, "Serialization error: {}", msg),
            Self::InternalError(msg) => write!(f, "Internal error: {}", msg),
        }
    }
}

impl std::error::Error for PortKnockError {}

impl From<std::io::Error> for PortKnockError {
    fn from(e: std::io::Error) -> Self {
        Self::IoError(e.to_string())
    }
}

impl From<serde_json::Error> for PortKnockError {
    fn from(e: serde_json::Error) -> Self {
        Self::SerializationError(e.to_string())
    }
}
