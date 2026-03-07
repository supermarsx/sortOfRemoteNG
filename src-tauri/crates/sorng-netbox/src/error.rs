// ── sorng-netbox/src/error.rs ────────────────────────────────────────────────
//! Crate-local error types for NetBox operations.

use std::fmt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NetboxErrorKind {
    NotConnected,
    AlreadyConnected,
    ConnectionFailed,
    AuthenticationFailed,
    SiteNotFound,
    RackNotFound,
    DeviceNotFound,
    InterfaceNotFound,
    IpAddressNotFound,
    PrefixNotFound,
    VlanNotFound,
    CircuitNotFound,
    CableNotFound,
    TenantNotFound,
    ContactNotFound,
    VmNotFound,
    ClusterNotFound,
    PermissionDenied,
    Conflict,
    InvalidRequest,
    ApiError,
    HttpError,
    ParseError,
    Timeout,
    InternalError,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct NetboxError {
    pub kind: NetboxErrorKind,
    pub message: String,
}

impl fmt::Display for NetboxError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for NetboxError {}

impl NetboxError {
    pub fn new(kind: NetboxErrorKind, msg: impl Into<String>) -> Self {
        Self { kind, message: msg.into() }
    }
    pub fn not_connected(msg: impl Into<String>) -> Self {
        Self::new(NetboxErrorKind::NotConnected, msg)
    }
    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(NetboxErrorKind::ConnectionFailed, msg)
    }
    pub fn auth(msg: impl Into<String>) -> Self {
        Self::new(NetboxErrorKind::AuthenticationFailed, msg)
    }
    pub fn permission_denied(msg: impl Into<String>) -> Self {
        Self::new(NetboxErrorKind::PermissionDenied, msg)
    }
    pub fn conflict(msg: impl Into<String>) -> Self {
        Self::new(NetboxErrorKind::Conflict, msg)
    }
    pub fn api(msg: impl Into<String>) -> Self {
        Self::new(NetboxErrorKind::ApiError, msg)
    }
    pub fn http(msg: impl Into<String>) -> Self {
        Self::new(NetboxErrorKind::HttpError, msg)
    }
    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(NetboxErrorKind::ParseError, msg)
    }
    pub fn invalid_request(msg: impl Into<String>) -> Self {
        Self::new(NetboxErrorKind::InvalidRequest, msg)
    }
    pub fn not_found(kind: NetboxErrorKind, name: &str) -> Self {
        Self::new(kind, format!("Not found: {name}"))
    }
    pub fn site_not_found(name: &str) -> Self {
        Self::not_found(NetboxErrorKind::SiteNotFound, name)
    }
    pub fn rack_not_found(name: &str) -> Self {
        Self::not_found(NetboxErrorKind::RackNotFound, name)
    }
    pub fn device_not_found(name: &str) -> Self {
        Self::not_found(NetboxErrorKind::DeviceNotFound, name)
    }
    pub fn interface_not_found(name: &str) -> Self {
        Self::not_found(NetboxErrorKind::InterfaceNotFound, name)
    }
    pub fn ip_not_found(name: &str) -> Self {
        Self::not_found(NetboxErrorKind::IpAddressNotFound, name)
    }
    pub fn prefix_not_found(name: &str) -> Self {
        Self::not_found(NetboxErrorKind::PrefixNotFound, name)
    }
    pub fn vlan_not_found(name: &str) -> Self {
        Self::not_found(NetboxErrorKind::VlanNotFound, name)
    }
    pub fn circuit_not_found(name: &str) -> Self {
        Self::not_found(NetboxErrorKind::CircuitNotFound, name)
    }
    pub fn cable_not_found(name: &str) -> Self {
        Self::not_found(NetboxErrorKind::CableNotFound, name)
    }
    pub fn tenant_not_found(name: &str) -> Self {
        Self::not_found(NetboxErrorKind::TenantNotFound, name)
    }
    pub fn contact_not_found(name: &str) -> Self {
        Self::not_found(NetboxErrorKind::ContactNotFound, name)
    }
    pub fn vm_not_found(name: &str) -> Self {
        Self::not_found(NetboxErrorKind::VmNotFound, name)
    }
    pub fn cluster_not_found(name: &str) -> Self {
        Self::not_found(NetboxErrorKind::ClusterNotFound, name)
    }
}

pub type NetboxResult<T> = Result<T, NetboxError>;
