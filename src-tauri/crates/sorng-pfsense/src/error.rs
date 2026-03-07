//! Crate-local error types for pfSense operations.

use std::fmt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PfsenseErrorKind {
    NotConnected,
    AlreadyConnected,
    ConnectionFailed,
    AuthenticationFailed,
    InterfaceNotFound,
    RuleNotFound,
    AliasNotFound,
    NatRuleNotFound,
    DhcpError,
    DnsError,
    VpnError,
    RouteNotFound,
    GatewayNotFound,
    ServiceNotFound,
    CertificateNotFound,
    UserNotFound,
    GroupNotFound,
    BackupError,
    DiagnosticError,
    InvalidRequest,
    ApiError,
    HttpError,
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

    pub fn http(msg: impl Into<String>) -> Self {
        Self::new(PfsenseErrorKind::HttpError, msg)
    }

    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(PfsenseErrorKind::ParseError, msg)
    }

    pub fn interface_not_found(name: &str) -> Self {
        Self::new(PfsenseErrorKind::InterfaceNotFound, format!("Interface not found: {name}"))
    }

    pub fn rule_not_found(id: &str) -> Self {
        Self::new(PfsenseErrorKind::RuleNotFound, format!("Rule not found: {id}"))
    }

    pub fn alias_not_found(name: &str) -> Self {
        Self::new(PfsenseErrorKind::AliasNotFound, format!("Alias not found: {name}"))
    }

    pub fn nat_rule_not_found(id: &str) -> Self {
        Self::new(PfsenseErrorKind::NatRuleNotFound, format!("NAT rule not found: {id}"))
    }

    pub fn dhcp(msg: impl Into<String>) -> Self {
        Self::new(PfsenseErrorKind::DhcpError, msg)
    }

    pub fn dns(msg: impl Into<String>) -> Self {
        Self::new(PfsenseErrorKind::DnsError, msg)
    }

    pub fn vpn(msg: impl Into<String>) -> Self {
        Self::new(PfsenseErrorKind::VpnError, msg)
    }

    pub fn route_not_found(id: &str) -> Self {
        Self::new(PfsenseErrorKind::RouteNotFound, format!("Route not found: {id}"))
    }

    pub fn gateway_not_found(name: &str) -> Self {
        Self::new(PfsenseErrorKind::GatewayNotFound, format!("Gateway not found: {name}"))
    }

    pub fn service_not_found(name: &str) -> Self {
        Self::new(PfsenseErrorKind::ServiceNotFound, format!("Service not found: {name}"))
    }

    pub fn cert_not_found(id: &str) -> Self {
        Self::new(PfsenseErrorKind::CertificateNotFound, format!("Certificate not found: {id}"))
    }

    pub fn user_not_found(name: &str) -> Self {
        Self::new(PfsenseErrorKind::UserNotFound, format!("User not found: {name}"))
    }

    pub fn group_not_found(name: &str) -> Self {
        Self::new(PfsenseErrorKind::GroupNotFound, format!("Group not found: {name}"))
    }

    pub fn backup(msg: impl Into<String>) -> Self {
        Self::new(PfsenseErrorKind::BackupError, msg)
    }

    pub fn diagnostic(msg: impl Into<String>) -> Self {
        Self::new(PfsenseErrorKind::DiagnosticError, msg)
    }

    pub fn invalid_request(msg: impl Into<String>) -> Self {
        Self::new(PfsenseErrorKind::InvalidRequest, msg)
    }

    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(PfsenseErrorKind::Timeout, msg)
    }

    pub fn internal(msg: impl Into<String>) -> Self {
        Self::new(PfsenseErrorKind::InternalError, msg)
    }
}
