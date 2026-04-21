//! Crate-local error types for cPanel / WHM operations.

use std::fmt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CpanelErrorKind {
    NotConnected,
    AlreadyConnected,
    ConnectionFailed,
    AuthenticationFailed,
    Forbidden,
    AccountNotFound,
    DomainNotFound,
    DatabaseNotFound,
    EmailNotFound,
    DnsZoneNotFound,
    CertificateNotFound,
    BackupNotFound,
    FtpAccountNotFound,
    CronJobNotFound,
    PackageNotFound,
    FileNotFound,
    QuotaExceeded,
    LimitReached,
    InvalidRequest,
    ApiError,
    HttpError,
    ParseError,
    Timeout,
    SshError,
    SslError,
    InternalError,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CpanelError {
    pub kind: CpanelErrorKind,
    pub message: String,
}

impl fmt::Display for CpanelError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for CpanelError {}

impl CpanelError {
    pub fn new(kind: CpanelErrorKind, msg: impl Into<String>) -> Self {
        Self {
            kind,
            message: msg.into(),
        }
    }
    pub fn not_connected(msg: impl Into<String>) -> Self {
        Self::new(CpanelErrorKind::NotConnected, msg)
    }
    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(CpanelErrorKind::ConnectionFailed, msg)
    }
    pub fn auth(msg: impl Into<String>) -> Self {
        Self::new(CpanelErrorKind::AuthenticationFailed, msg)
    }
    pub fn forbidden(msg: impl Into<String>) -> Self {
        Self::new(CpanelErrorKind::Forbidden, msg)
    }
    pub fn api(msg: impl Into<String>) -> Self {
        Self::new(CpanelErrorKind::ApiError, msg)
    }
    pub fn http(msg: impl Into<String>) -> Self {
        Self::new(CpanelErrorKind::HttpError, msg)
    }
    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(CpanelErrorKind::ParseError, msg)
    }
    pub fn not_found(kind: CpanelErrorKind, name: &str) -> Self {
        Self::new(kind, format!("Not found: {name}"))
    }
    pub fn account_not_found(name: &str) -> Self {
        Self::not_found(CpanelErrorKind::AccountNotFound, name)
    }
    pub fn domain_not_found(name: &str) -> Self {
        Self::not_found(CpanelErrorKind::DomainNotFound, name)
    }
    pub fn database_not_found(name: &str) -> Self {
        Self::not_found(CpanelErrorKind::DatabaseNotFound, name)
    }
    pub fn email_not_found(name: &str) -> Self {
        Self::not_found(CpanelErrorKind::EmailNotFound, name)
    }
    pub fn dns_zone_not_found(name: &str) -> Self {
        Self::not_found(CpanelErrorKind::DnsZoneNotFound, name)
    }
    pub fn cert_not_found(name: &str) -> Self {
        Self::not_found(CpanelErrorKind::CertificateNotFound, name)
    }
    pub fn backup_not_found(name: &str) -> Self {
        Self::not_found(CpanelErrorKind::BackupNotFound, name)
    }
    pub fn ftp_not_found(name: &str) -> Self {
        Self::not_found(CpanelErrorKind::FtpAccountNotFound, name)
    }
    pub fn ssh(e: impl fmt::Display) -> Self {
        Self::new(CpanelErrorKind::SshError, e.to_string())
    }
    pub fn ssl(e: impl fmt::Display) -> Self {
        Self::new(CpanelErrorKind::SslError, e.to_string())
    }
    pub fn invalid_request(msg: impl Into<String>) -> Self {
        Self::new(CpanelErrorKind::InvalidRequest, msg)
    }
    pub fn quota_exceeded(msg: impl Into<String>) -> Self {
        Self::new(CpanelErrorKind::QuotaExceeded, msg)
    }
    pub fn limit_reached(msg: impl Into<String>) -> Self {
        Self::new(CpanelErrorKind::LimitReached, msg)
    }
}

pub type CpanelResult<T> = Result<T, CpanelError>;
