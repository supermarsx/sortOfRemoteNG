//! Crate-local error types for pfSense/OPNsense operations.

use std::fmt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PfsenseErrorKind {
    NotConnected,
    AlreadyConnected,
    ConnectionFailed,
    AuthenticationFailed,
    ApiError,
    InterfaceNotFound,
    RuleNotFound,
    NatRuleNotFound,
    CertificateNotFound,
    VpnTunnelNotFound,
    DhcpError,
    DnsError,
    RoutingError,
    PackageNotFound,
    BackupError,
    ValidationError,
    ConfigError,
    PermissionDenied,
    ParseError,
    Timeout,
    InternalError,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PfsenseError {
    pub kind: PfsenseErrorKind,
    pub message: String,
}

impl fmt::Display for PfsenseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for PfsenseError {}

pub type PfsenseResult<T> = Result<T, PfsenseError>;

impl PfsenseError {
    pub fn new(kind: PfsenseErrorKind, msg: impl Into<String>) -> Self {
        Self { kind, message: msg.into() }
    }

    pub fn not_connected(msg: impl Into<String>) -> Self {
        Self::new(PfsenseErrorKind::NotConnected, msg)
    }

    pub fn already_connected(msg: impl Into<String>) -> Self {
        Self::new(PfsenseErrorKind::AlreadyConnected, msg)
    }

    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(PfsenseErrorKind::ConnectionFailed, msg)
    }

    pub fn auth(msg: impl Into<String>) -> Self {
        Self::new(PfsenseErrorKind::AuthenticationFailed, msg)
    }

    pub fn api(msg: impl Into<String>) -> Self {
        Self::new(PfsenseErrorKind::ApiError, msg)
    }

    pub fn interface_not_found(name: &str) -> Self {
        Self::new(PfsenseErrorKind::InterfaceNotFound, format!("Interface not found: {name}"))
    }

    pub fn rule_not_found(id: &str) -> Self {
        Self::new(PfsenseErrorKind::RuleNotFound, format!("Rule not found: {id}"))
    }

    pub fn nat_rule_not_found(id: &str) -> Self {
        Self::new(PfsenseErrorKind::NatRuleNotFound, format!("NAT rule not found: {id}"))
    }

    pub fn cert_not_found(id: &str) -> Self {
        Self::new(PfsenseErrorKind::CertificateNotFound, format!("Certificate not found: {id}"))
    }

    pub fn vpn_tunnel_not_found(id: &str) -> Self {
        Self::new(PfsenseErrorKind::VpnTunnelNotFound, format!("VPN tunnel not found: {id}"))
    }

    pub fn dhcp(msg: impl Into<String>) -> Self {
        Self::new(PfsenseErrorKind::DhcpError, msg)
    }

    pub fn dns(msg: impl Into<String>) -> Self {
        Self::new(PfsenseErrorKind::DnsError, msg)
    }

    pub fn routing(msg: impl Into<String>) -> Self {
        Self::new(PfsenseErrorKind::RoutingError, msg)
    }

    pub fn package_not_found(name: &str) -> Self {
        Self::new(PfsenseErrorKind::PackageNotFound, format!("Package not found: {name}"))
    }

    pub fn backup(msg: impl Into<String>) -> Self {
        Self::new(PfsenseErrorKind::BackupError, msg)
    }

    pub fn validation(msg: impl Into<String>) -> Self {
        Self::new(PfsenseErrorKind::ValidationError, msg)
    }

    pub fn config(msg: impl Into<String>) -> Self {
        Self::new(PfsenseErrorKind::ConfigError, msg)
    }

    pub fn permission(msg: impl Into<String>) -> Self {
        Self::new(PfsenseErrorKind::PermissionDenied, msg)
    }

    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(PfsenseErrorKind::ParseError, msg)
    }

    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(PfsenseErrorKind::Timeout, msg)
    }

    pub fn internal(msg: impl Into<String>) -> Self {
        Self::new(PfsenseErrorKind::InternalError, msg)
    }
}
