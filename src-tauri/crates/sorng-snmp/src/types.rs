//! # SNMP Types
//!
//! Shared type definitions used across all SNMP modules.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  SNMP Versions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// SNMP protocol version.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum SnmpVersion {
    /// SNMPv1 — community-based, limited error reporting.
    V1,
    /// SNMPv2c — community-based, supports GET-BULK and 64-bit counters.
    V2c,
    /// SNMPv3 — User-based Security Model (USM) with auth + priv.
    V3,
}

impl SnmpVersion {
    /// Protocol version number (0, 1, 3).
    pub fn version_number(&self) -> i32 {
        match self {
            Self::V1 => 0,
            Self::V2c => 1,
            Self::V3 => 3,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::V1 => "v1",
            Self::V2c => "v2c",
            Self::V3 => "v3",
        }
    }
}

impl Default for SnmpVersion {
    fn default() -> Self {
        Self::V2c
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ASN.1 / SNMP Value Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// An SNMP value type tag (ASN.1 / RFC 2578 Application types).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum SnmpValueType {
    /// ASN.1 INTEGER
    Integer,
    /// OCTET STRING
    OctetString,
    /// OBJECT IDENTIFIER
    ObjectIdentifier,
    /// NULL
    Null,
    /// IpAddress (APPLICATION 0) — 4-byte IPv4
    IpAddress,
    /// Counter32 (APPLICATION 1)
    Counter32,
    /// Gauge32 / Unsigned32 (APPLICATION 2)
    Gauge32,
    /// TimeTicks (APPLICATION 3) — hundredths of a second
    TimeTicks,
    /// Opaque (APPLICATION 4) — arbitrary ASN.1 encoding
    Opaque,
    /// Counter64 (APPLICATION 6) — v2c/v3 only
    Counter64,
    /// NoSuchObject (CONTEXT 0) — v2c/v3 exception
    NoSuchObject,
    /// NoSuchInstance (CONTEXT 1) — v2c/v3 exception
    NoSuchInstance,
    /// EndOfMibView (CONTEXT 2) — v2c/v3 exception
    EndOfMibView,
}

impl SnmpValueType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Integer => "INTEGER",
            Self::OctetString => "OCTET STRING",
            Self::ObjectIdentifier => "OBJECT IDENTIFIER",
            Self::Null => "NULL",
            Self::IpAddress => "IpAddress",
            Self::Counter32 => "Counter32",
            Self::Gauge32 => "Gauge32",
            Self::TimeTicks => "TimeTicks",
            Self::Opaque => "Opaque",
            Self::Counter64 => "Counter64",
            Self::NoSuchObject => "noSuchObject",
            Self::NoSuchInstance => "noSuchInstance",
            Self::EndOfMibView => "endOfMibView",
        }
    }

    /// BER tag byte for this value type.
    pub fn tag(&self) -> u8 {
        match self {
            Self::Integer => 0x02,
            Self::OctetString => 0x04,
            Self::ObjectIdentifier => 0x06,
            Self::Null => 0x05,
            Self::IpAddress => 0x40,
            Self::Counter32 => 0x41,
            Self::Gauge32 => 0x42,
            Self::TimeTicks => 0x43,
            Self::Opaque => 0x44,
            Self::Counter64 => 0x46,
            Self::NoSuchObject => 0x80,
            Self::NoSuchInstance => 0x81,
            Self::EndOfMibView => 0x82,
        }
    }

    /// Parse a BER tag byte into a value type (if recognised).
    pub fn from_tag(tag: u8) -> Option<Self> {
        match tag {
            0x02 => Some(Self::Integer),
            0x04 => Some(Self::OctetString),
            0x06 => Some(Self::ObjectIdentifier),
            0x05 => Some(Self::Null),
            0x40 => Some(Self::IpAddress),
            0x41 => Some(Self::Counter32),
            0x42 => Some(Self::Gauge32),
            0x43 => Some(Self::TimeTicks),
            0x44 => Some(Self::Opaque),
            0x46 => Some(Self::Counter64),
            0x80 => Some(Self::NoSuchObject),
            0x81 => Some(Self::NoSuchInstance),
            0x82 => Some(Self::EndOfMibView),
            _ => None,
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  SNMP Values
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// A decoded SNMP variable value.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum SnmpValue {
    Integer(i64),
    OctetString(String),
    ObjectIdentifier(String),
    IpAddress(String),
    Counter32(u32),
    Gauge32(u32),
    TimeTicks(u32),
    Counter64(u64),
    Opaque(Vec<u8>),
    Null,
    NoSuchObject,
    NoSuchInstance,
    EndOfMibView,
}

impl SnmpValue {
    /// Human-readable type label.
    pub fn type_name(&self) -> &'static str {
        match self {
            Self::Integer(_) => "INTEGER",
            Self::OctetString(_) => "OCTET STRING",
            Self::ObjectIdentifier(_) => "OBJECT IDENTIFIER",
            Self::IpAddress(_) => "IpAddress",
            Self::Counter32(_) => "Counter32",
            Self::Gauge32(_) => "Gauge32",
            Self::TimeTicks(_) => "TimeTicks",
            Self::Counter64(_) => "Counter64",
            Self::Opaque(_) => "Opaque",
            Self::Null => "NULL",
            Self::NoSuchObject => "noSuchObject",
            Self::NoSuchInstance => "noSuchInstance",
            Self::EndOfMibView => "endOfMibView",
        }
    }

    /// Returns the value as a display string.
    pub fn display_value(&self) -> String {
        match self {
            Self::Integer(v) => v.to_string(),
            Self::OctetString(s) => s.clone(),
            Self::ObjectIdentifier(oid) => oid.clone(),
            Self::IpAddress(ip) => ip.clone(),
            Self::Counter32(v) => v.to_string(),
            Self::Gauge32(v) => v.to_string(),
            Self::TimeTicks(v) => format_timeticks(*v),
            Self::Counter64(v) => v.to_string(),
            Self::Opaque(bytes) => format!("0x{}", hex_encode(bytes)),
            Self::Null => "NULL".to_string(),
            Self::NoSuchObject => "noSuchObject".to_string(),
            Self::NoSuchInstance => "noSuchInstance".to_string(),
            Self::EndOfMibView => "endOfMibView".to_string(),
        }
    }

    /// Returns true if this value represents an SNMP exception.
    pub fn is_exception(&self) -> bool {
        matches!(self, Self::NoSuchObject | Self::NoSuchInstance | Self::EndOfMibView)
    }

    /// Try to extract an integer value.
    pub fn as_integer(&self) -> Option<i64> {
        match self {
            Self::Integer(v) => Some(*v),
            _ => None,
        }
    }

    /// Try to extract a string value.
    pub fn as_string(&self) -> Option<&str> {
        match self {
            Self::OctetString(s) => Some(s),
            _ => None,
        }
    }

    /// Try to extract a u32 counter/gauge.
    pub fn as_u32(&self) -> Option<u32> {
        match self {
            Self::Counter32(v) | Self::Gauge32(v) | Self::TimeTicks(v) => Some(*v),
            _ => None,
        }
    }

    /// Try to extract a u64 counter.
    pub fn as_u64(&self) -> Option<u64> {
        match self {
            Self::Counter64(v) => Some(*v),
            Self::Counter32(v) | Self::Gauge32(v) | Self::TimeTicks(v) => Some(*v as u64),
            _ => None,
        }
    }
}

/// Format TimeTicks value (hundredths of a second) into human-readable form.
pub fn format_timeticks(ticks: u32) -> String {
    let total_seconds = ticks / 100;
    let days = total_seconds / 86400;
    let hours = (total_seconds % 86400) / 3600;
    let minutes = (total_seconds % 3600) / 60;
    let seconds = total_seconds % 60;
    let hundredths = ticks % 100;
    format!("{}d {}h {}m {}s.{:02}", days, hours, minutes, seconds, hundredths)
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Variable Binding
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// A single OID → value binding returned by an SNMP response.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VarBind {
    /// The OID in dotted-decimal notation, e.g. "1.3.6.1.2.1.1.1.0".
    pub oid: String,
    /// The decoded value.
    pub value: SnmpValue,
    /// Optional resolved MIB name (e.g. "sysDescr.0").
    pub name: Option<String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  PDU Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// SNMP PDU type discriminant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PduType {
    GetRequest,
    GetNextRequest,
    GetResponse,
    SetRequest,
    /// SNMPv1 trap PDU.
    TrapV1,
    /// SNMPv2c / v3 GET-BULK request.
    GetBulkRequest,
    /// SNMPv2c / v3 INFORM request.
    InformRequest,
    /// SNMPv2c / v3 trap PDU (Trap2).
    TrapV2,
    /// SNMPv2c / v3 report PDU.
    Report,
}

impl PduType {
    /// BER context-specific tag for this PDU type.
    pub fn tag(&self) -> u8 {
        match self {
            Self::GetRequest => 0xA0,
            Self::GetNextRequest => 0xA1,
            Self::GetResponse => 0xA2,
            Self::SetRequest => 0xA3,
            Self::TrapV1 => 0xA4,
            Self::GetBulkRequest => 0xA5,
            Self::InformRequest => 0xA6,
            Self::TrapV2 => 0xA7,
            Self::Report => 0xA8,
        }
    }

    pub fn from_tag(tag: u8) -> Option<Self> {
        match tag {
            0xA0 => Some(Self::GetRequest),
            0xA1 => Some(Self::GetNextRequest),
            0xA2 => Some(Self::GetResponse),
            0xA3 => Some(Self::SetRequest),
            0xA4 => Some(Self::TrapV1),
            0xA5 => Some(Self::GetBulkRequest),
            0xA6 => Some(Self::InformRequest),
            0xA7 => Some(Self::TrapV2),
            0xA8 => Some(Self::Report),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::GetRequest => "GET",
            Self::GetNextRequest => "GET-NEXT",
            Self::GetResponse => "RESPONSE",
            Self::SetRequest => "SET",
            Self::TrapV1 => "TRAP-V1",
            Self::GetBulkRequest => "GET-BULK",
            Self::InformRequest => "INFORM",
            Self::TrapV2 => "TRAP-V2",
            Self::Report => "REPORT",
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Error Status Codes
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// SNMP error-status codes from agent responses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum SnmpErrorStatus {
    NoError,
    TooBig,
    NoSuchName,
    BadValue,
    ReadOnly,
    GenErr,
    NoAccess,
    WrongType,
    WrongLength,
    WrongEncoding,
    WrongValue,
    NoCreation,
    InconsistentValue,
    ResourceUnavailable,
    CommitFailed,
    UndoFailed,
    AuthorizationError,
    NotWritable,
    InconsistentName,
}

impl SnmpErrorStatus {
    pub fn from_code(code: i32) -> Self {
        match code {
            0 => Self::NoError,
            1 => Self::TooBig,
            2 => Self::NoSuchName,
            3 => Self::BadValue,
            4 => Self::ReadOnly,
            5 => Self::GenErr,
            6 => Self::NoAccess,
            7 => Self::WrongType,
            8 => Self::WrongLength,
            9 => Self::WrongEncoding,
            10 => Self::WrongValue,
            11 => Self::NoCreation,
            12 => Self::InconsistentValue,
            13 => Self::ResourceUnavailable,
            14 => Self::CommitFailed,
            15 => Self::UndoFailed,
            16 => Self::AuthorizationError,
            17 => Self::NotWritable,
            18 => Self::InconsistentName,
            _ => Self::GenErr,
        }
    }

    pub fn code(&self) -> i32 {
        match self {
            Self::NoError => 0,
            Self::TooBig => 1,
            Self::NoSuchName => 2,
            Self::BadValue => 3,
            Self::ReadOnly => 4,
            Self::GenErr => 5,
            Self::NoAccess => 6,
            Self::WrongType => 7,
            Self::WrongLength => 8,
            Self::WrongEncoding => 9,
            Self::WrongValue => 10,
            Self::NoCreation => 11,
            Self::InconsistentValue => 12,
            Self::ResourceUnavailable => 13,
            Self::CommitFailed => 14,
            Self::UndoFailed => 15,
            Self::AuthorizationError => 16,
            Self::NotWritable => 17,
            Self::InconsistentName => 18,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::NoError => "noError",
            Self::TooBig => "tooBig",
            Self::NoSuchName => "noSuchName",
            Self::BadValue => "badValue",
            Self::ReadOnly => "readOnly",
            Self::GenErr => "genErr",
            Self::NoAccess => "noAccess",
            Self::WrongType => "wrongType",
            Self::WrongLength => "wrongLength",
            Self::WrongEncoding => "wrongEncoding",
            Self::WrongValue => "wrongValue",
            Self::NoCreation => "noCreation",
            Self::InconsistentValue => "inconsistentValue",
            Self::ResourceUnavailable => "resourceUnavailable",
            Self::CommitFailed => "commitFailed",
            Self::UndoFailed => "undoFailed",
            Self::AuthorizationError => "authorizationError",
            Self::NotWritable => "notWritable",
            Self::InconsistentName => "inconsistentName",
        }
    }

    pub fn is_error(&self) -> bool {
        *self != Self::NoError
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Connection / Target Configuration
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Configuration for connecting to an SNMP agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnmpTarget {
    /// Hostname or IP address of the agent.
    pub host: String,
    /// UDP port (default 161).
    pub port: u16,
    /// SNMP version to use.
    pub version: SnmpVersion,
    /// Community string (v1/v2c) — ignored for v3.
    pub community: Option<String>,
    /// SNMPv3 credentials (ignored for v1/v2c).
    pub v3_credentials: Option<V3Credentials>,
    /// Request timeout in milliseconds.
    pub timeout_ms: u64,
    /// Number of retries on timeout.
    pub retries: u32,
}

impl Default for SnmpTarget {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 161,
            version: SnmpVersion::V2c,
            community: Some("public".to_string()),
            v3_credentials: None,
            timeout_ms: 5000,
            retries: 1,
        }
    }
}

impl SnmpTarget {
    pub fn v1(host: impl Into<String>, community: impl Into<String>) -> Self {
        Self {
            host: host.into(),
            version: SnmpVersion::V1,
            community: Some(community.into()),
            ..Default::default()
        }
    }

    pub fn v2c(host: impl Into<String>, community: impl Into<String>) -> Self {
        Self {
            host: host.into(),
            version: SnmpVersion::V2c,
            community: Some(community.into()),
            ..Default::default()
        }
    }

    pub fn v3(host: impl Into<String>, creds: V3Credentials) -> Self {
        Self {
            host: host.into(),
            version: SnmpVersion::V3,
            community: None,
            v3_credentials: Some(creds),
            ..Default::default()
        }
    }

    /// Socket address string "host:port".
    pub fn addr(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  SNMPv3 Credentials & Security
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// SNMPv3 User-based Security Model (USM) credentials.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct V3Credentials {
    /// USM username.
    pub username: String,
    /// Security level.
    pub security_level: SecurityLevel,
    /// Authentication protocol.
    pub auth_protocol: Option<AuthProtocol>,
    /// Authentication passphrase / key.
    pub auth_passphrase: Option<String>,
    /// Privacy (encryption) protocol.
    pub priv_protocol: Option<PrivProtocol>,
    /// Privacy passphrase / key.
    pub priv_passphrase: Option<String>,
    /// Context engine ID (hex string, auto-discovered if absent).
    pub context_engine_id: Option<String>,
    /// Context name.
    pub context_name: Option<String>,
}

impl V3Credentials {
    /// Create noAuthNoPriv credentials.
    pub fn no_auth(username: impl Into<String>) -> Self {
        Self {
            username: username.into(),
            security_level: SecurityLevel::NoAuthNoPriv,
            auth_protocol: None,
            auth_passphrase: None,
            priv_protocol: None,
            priv_passphrase: None,
            context_engine_id: None,
            context_name: None,
        }
    }

    /// Create authNoPriv credentials.
    pub fn auth_no_priv(
        username: impl Into<String>,
        auth_protocol: AuthProtocol,
        auth_passphrase: impl Into<String>,
    ) -> Self {
        Self {
            username: username.into(),
            security_level: SecurityLevel::AuthNoPriv,
            auth_protocol: Some(auth_protocol),
            auth_passphrase: Some(auth_passphrase.into()),
            priv_protocol: None,
            priv_passphrase: None,
            context_engine_id: None,
            context_name: None,
        }
    }

    /// Create authPriv credentials.
    pub fn auth_priv(
        username: impl Into<String>,
        auth_protocol: AuthProtocol,
        auth_passphrase: impl Into<String>,
        priv_protocol: PrivProtocol,
        priv_passphrase: impl Into<String>,
    ) -> Self {
        Self {
            username: username.into(),
            security_level: SecurityLevel::AuthPriv,
            auth_protocol: Some(auth_protocol),
            auth_passphrase: Some(auth_passphrase.into()),
            priv_protocol: Some(priv_protocol),
            priv_passphrase: Some(priv_passphrase.into()),
            context_engine_id: None,
            context_name: None,
        }
    }
}

/// SNMPv3 security level.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum SecurityLevel {
    /// No authentication, no privacy.
    NoAuthNoPriv,
    /// Authentication only, no privacy.
    AuthNoPriv,
    /// Authentication and privacy (encryption).
    AuthPriv,
}

impl SecurityLevel {
    pub fn flags(&self) -> u8 {
        match self {
            Self::NoAuthNoPriv => 0x00,
            Self::AuthNoPriv => 0x01,
            Self::AuthPriv => 0x03,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::NoAuthNoPriv => "noAuthNoPriv",
            Self::AuthNoPriv => "authNoPriv",
            Self::AuthPriv => "authPriv",
        }
    }
}

/// SNMPv3 authentication protocol.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum AuthProtocol {
    Md5,
    Sha1,
    Sha224,
    Sha256,
    Sha384,
    Sha512,
}

impl AuthProtocol {
    pub fn digest_length(&self) -> usize {
        match self {
            Self::Md5 => 16,
            Self::Sha1 => 20,
            Self::Sha224 => 28,
            Self::Sha256 => 32,
            Self::Sha384 => 48,
            Self::Sha512 => 64,
        }
    }

    /// Truncated HMAC length used in SNMP auth parameters (12 bytes for all).
    pub fn auth_param_length(&self) -> usize {
        12
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Md5 => "MD5",
            Self::Sha1 => "SHA",
            Self::Sha224 => "SHA-224",
            Self::Sha256 => "SHA-256",
            Self::Sha384 => "SHA-384",
            Self::Sha512 => "SHA-512",
        }
    }
}

/// SNMPv3 privacy (encryption) protocol.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PrivProtocol {
    Des,
    Aes128,
    Aes192,
    Aes256,
}

impl PrivProtocol {
    pub fn key_length(&self) -> usize {
        match self {
            Self::Des => 8,
            Self::Aes128 => 16,
            Self::Aes192 => 24,
            Self::Aes256 => 32,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Des => "DES",
            Self::Aes128 => "AES-128",
            Self::Aes192 => "AES-192",
            Self::Aes256 => "AES-256",
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  SNMP Response
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// An SNMP response from an agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnmpResponse {
    /// Variable bindings returned by the agent.
    pub varbinds: Vec<VarBind>,
    /// Error status code.
    pub error_status: SnmpErrorStatus,
    /// 1-based index of the varbind that caused the error (0 = no error).
    pub error_index: u32,
    /// Request ID that was echoed back.
    pub request_id: i32,
    /// Round-trip time in milliseconds.
    pub rtt_ms: u64,
}

impl SnmpResponse {
    /// Returns the first varbind value, if any.
    pub fn first_value(&self) -> Option<&SnmpValue> {
        self.varbinds.first().map(|vb| &vb.value)
    }

    /// Returns all values as a vec.
    pub fn values(&self) -> Vec<&SnmpValue> {
        self.varbinds.iter().map(|vb| &vb.value).collect()
    }

    pub fn is_error(&self) -> bool {
        self.error_status.is_error()
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Trap Information
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// A received SNMP trap notification.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnmpTrap {
    /// Unique ID for this trap reception.
    pub id: String,
    /// Source address of the trap sender.
    pub source_ip: String,
    /// Source port.
    pub source_port: u16,
    /// SNMP version of the trap.
    pub version: SnmpVersion,
    /// Community string (v1/v2c).
    pub community: Option<String>,
    /// Trap OID / enterprise OID.
    pub trap_oid: String,
    /// Human-readable trap name (resolved from MIB).
    pub trap_name: Option<String>,
    /// Generic trap type (v1 only: 0-6).
    pub generic_trap: Option<i32>,
    /// Specific trap code (v1 only).
    pub specific_trap: Option<i32>,
    /// Agent address (v1 only).
    pub agent_addr: Option<String>,
    /// sysUpTime when trap was generated.
    pub uptime: Option<u32>,
    /// Variable bindings carried by the trap.
    pub varbinds: Vec<VarBind>,
    /// Timestamp when this trap was received.
    pub received_at: String,
    /// Severity level inferred from trap OID or MIB.
    pub severity: TrapSeverity,
}

/// Trap severity classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum TrapSeverity {
    Emergency,
    Alert,
    Critical,
    Error,
    Warning,
    Notice,
    Informational,
    Debug,
    Unknown,
}

impl TrapSeverity {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Emergency => "emergency",
            Self::Alert => "alert",
            Self::Critical => "critical",
            Self::Error => "error",
            Self::Warning => "warning",
            Self::Notice => "notice",
            Self::Informational => "informational",
            Self::Debug => "debug",
            Self::Unknown => "unknown",
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Device / Agent Information
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Information about a discovered or queried SNMP device.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnmpDevice {
    /// Hostname or IP address.
    pub host: String,
    /// UDP port.
    pub port: u16,
    /// SNMP version supported.
    pub version: SnmpVersion,
    /// sysDescr.0 value.
    pub sys_descr: Option<String>,
    /// sysObjectID.0 value.
    pub sys_object_id: Option<String>,
    /// sysUpTime.0 formatted.
    pub sys_uptime: Option<String>,
    /// sysContact.0.
    pub sys_contact: Option<String>,
    /// sysName.0.
    pub sys_name: Option<String>,
    /// sysLocation.0.
    pub sys_location: Option<String>,
    /// sysServices.0.
    pub sys_services: Option<i64>,
    /// Number of interfaces (ifNumber.0).
    pub if_number: Option<i64>,
    /// Timestamp of last successful query.
    pub last_seen: Option<String>,
    /// Whether the device is currently reachable.
    pub reachable: bool,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  MIB Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// A parsed MIB module.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MibModule {
    /// Module name (e.g. "IF-MIB").
    pub name: String,
    /// Last revision date.
    pub last_updated: Option<String>,
    /// Organisation that defined the module.
    pub organization: Option<String>,
    /// Module description.
    pub description: Option<String>,
    /// All object definitions in this module.
    pub objects: Vec<MibObject>,
}

/// A single MIB object definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MibObject {
    /// Object name (e.g. "ifDescr").
    pub name: String,
    /// Full OID in dotted-decimal.
    pub oid: String,
    /// SYNTAX clause (e.g. "DisplayString", "Counter32").
    pub syntax: Option<String>,
    /// MAX-ACCESS (e.g. "read-only", "read-write").
    pub access: Option<String>,
    /// STATUS (e.g. "current", "deprecated").
    pub status: Option<String>,
    /// DESCRIPTION text.
    pub description: Option<String>,
    /// Parent object name.
    pub parent: Option<String>,
    /// Child object names.
    pub children: Vec<String>,
}

/// A flat OID→name mapping entry for resolution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OidMapping {
    pub oid: String,
    pub name: String,
    pub module: String,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Table Retrieval Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// An SNMP table, retrieved via GET-NEXT / GET-BULK walk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnmpTable {
    /// Base OID of the table entry (e.g. "1.3.6.1.2.1.2.2.1" for ifTable).
    pub base_oid: String,
    /// Resolved table name (e.g. "ifTable").
    pub table_name: Option<String>,
    /// Column OID suffixes (e.g. ["1", "2", "3"]).
    pub columns: Vec<String>,
    /// Column names resolved from MIB (e.g. ["ifIndex", "ifDescr", "ifType"]).
    pub column_names: Vec<String>,
    /// Row data indexed by row index string.
    pub rows: Vec<SnmpTableRow>,
}

/// A single row in an SNMP table.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnmpTableRow {
    /// Row index (the OID suffix identifying this row, e.g. "1", "2").
    pub index: String,
    /// Column values keyed by column OID suffix or column name.
    pub values: HashMap<String, SnmpValue>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Walk Result
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Result of an SNMP walk operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalkResult {
    /// Root OID that was walked.
    pub root_oid: String,
    /// All variable bindings collected during the walk.
    pub varbinds: Vec<VarBind>,
    /// Total number of SNMP requests sent.
    pub request_count: u32,
    /// Total elapsed time in milliseconds.
    pub elapsed_ms: u64,
    /// Whether the walk completed without errors.
    pub complete: bool,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Monitoring Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// A polled SNMP monitoring target.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorTarget {
    /// Unique ID for this monitor.
    pub id: String,
    /// Human-readable label.
    pub label: String,
    /// Connection target.
    pub target: SnmpTarget,
    /// OIDs to poll.
    pub oids: Vec<String>,
    /// Poll interval in seconds.
    pub interval_secs: u64,
    /// Whether monitoring is currently active.
    pub enabled: bool,
    /// Optional threshold alerts.
    pub thresholds: Vec<MonitorThreshold>,
}

/// A threshold-based alert configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorThreshold {
    /// The OID being watched.
    pub oid: String,
    /// Comparison operator.
    pub operator: ThresholdOperator,
    /// Threshold value.
    pub value: f64,
    /// Severity if triggered.
    pub severity: TrapSeverity,
    /// Human-readable description.
    pub description: String,
}

/// Comparison operator for thresholds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ThresholdOperator {
    GreaterThan,
    GreaterThanOrEqual,
    LessThan,
    LessThanOrEqual,
    Equal,
    NotEqual,
}

/// A single polled data point.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PollDataPoint {
    /// The OID that was polled.
    pub oid: String,
    /// The value retrieved.
    pub value: SnmpValue,
    /// Timestamp of this poll (ISO 8601).
    pub timestamp: String,
    /// Round-trip time in ms.
    pub rtt_ms: u64,
}

/// A triggered alert from a monitor threshold.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorAlert {
    /// Unique alert ID.
    pub id: String,
    /// Monitor target ID.
    pub monitor_id: String,
    /// The OID that triggered the alert.
    pub oid: String,
    /// Current value.
    pub current_value: f64,
    /// Threshold value.
    pub threshold_value: f64,
    /// Operator.
    pub operator: ThresholdOperator,
    /// Severity.
    pub severity: TrapSeverity,
    /// Description from the threshold.
    pub description: String,
    /// When the alert was triggered.
    pub triggered_at: String,
    /// Whether the alert has been acknowledged.
    pub acknowledged: bool,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Discovery Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Configuration for an SNMP device discovery scan.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveryConfig {
    /// Subnet(s) to scan (CIDR notation, e.g. "192.168.1.0/24").
    pub subnets: Vec<String>,
    /// SNMP versions to probe.
    pub versions: Vec<SnmpVersion>,
    /// Community strings to try (v1/v2c).
    pub communities: Vec<String>,
    /// V3 credentials to try.
    pub v3_credentials: Vec<V3Credentials>,
    /// UDP port (default 161).
    pub port: u16,
    /// Timeout per probe in milliseconds.
    pub timeout_ms: u64,
    /// Max concurrent probes.
    pub concurrency: u32,
    /// Whether to fetch device info (sysDescr, sysName, etc.) on discovery.
    pub fetch_info: bool,
}

impl Default for DiscoveryConfig {
    fn default() -> Self {
        Self {
            subnets: vec!["192.168.1.0/24".to_string()],
            versions: vec![SnmpVersion::V2c],
            communities: vec!["public".to_string()],
            v3_credentials: vec![],
            port: 161,
            timeout_ms: 2000,
            concurrency: 50,
            fetch_info: true,
        }
    }
}

/// Result of a discovery scan.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveryResult {
    /// Discovered devices.
    pub devices: Vec<SnmpDevice>,
    /// Total addresses probed.
    pub total_probed: u32,
    /// Number responding to SNMP.
    pub total_found: u32,
    /// Elapsed time in milliseconds.
    pub elapsed_ms: u64,
    /// Addresses that timed out.
    pub unreachable: Vec<String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Interface Statistics (IF-MIB)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Network interface information from IF-MIB.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterfaceInfo {
    /// ifIndex.
    pub index: i64,
    /// ifDescr.
    pub descr: String,
    /// ifType (IANA ifType).
    pub if_type: i64,
    /// ifMtu.
    pub mtu: Option<i64>,
    /// ifSpeed (bps).
    pub speed: Option<u64>,
    /// ifHighSpeed (Mbps, from IF-MIB).
    pub high_speed: Option<u64>,
    /// ifPhysAddress (MAC).
    pub phys_address: Option<String>,
    /// ifAdminStatus (1=up, 2=down, 3=testing).
    pub admin_status: InterfaceStatus,
    /// ifOperStatus.
    pub oper_status: InterfaceStatus,
    /// ifLastChange.
    pub last_change: Option<u32>,
    /// ifInOctets / ifHCInOctets.
    pub in_octets: Option<u64>,
    /// ifOutOctets / ifHCOutOctets.
    pub out_octets: Option<u64>,
    /// ifInUcastPkts / ifHCInUcastPkts.
    pub in_ucast_pkts: Option<u64>,
    /// ifOutUcastPkts / ifHCOutUcastPkts.
    pub out_ucast_pkts: Option<u64>,
    /// ifInErrors.
    pub in_errors: Option<u64>,
    /// ifOutErrors.
    pub out_errors: Option<u64>,
    /// ifInDiscards.
    pub in_discards: Option<u64>,
    /// ifOutDiscards.
    pub out_discards: Option<u64>,
    /// ifAlias (interface alias / description).
    pub alias: Option<String>,
}

/// Interface administrative / operational status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum InterfaceStatus {
    Up,
    Down,
    Testing,
    Unknown,
    Dormant,
    NotPresent,
    LowerLayerDown,
}

impl InterfaceStatus {
    pub fn from_code(code: i64) -> Self {
        match code {
            1 => Self::Up,
            2 => Self::Down,
            3 => Self::Testing,
            4 => Self::Unknown,
            5 => Self::Dormant,
            6 => Self::NotPresent,
            7 => Self::LowerLayerDown,
            _ => Self::Unknown,
        }
    }

    pub fn code(&self) -> i64 {
        match self {
            Self::Up => 1,
            Self::Down => 2,
            Self::Testing => 3,
            Self::Unknown => 4,
            Self::Dormant => 5,
            Self::NotPresent => 6,
            Self::LowerLayerDown => 7,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Up => "up",
            Self::Down => "down",
            Self::Testing => "testing",
            Self::Unknown => "unknown",
            Self::Dormant => "dormant",
            Self::NotPresent => "notPresent",
            Self::LowerLayerDown => "lowerLayerDown",
        }
    }
}

/// Computed bandwidth utilisation for an interface.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterfaceBandwidth {
    /// Interface index.
    pub if_index: i64,
    /// Interface description.
    pub if_descr: String,
    /// Inbound bits per second.
    pub in_bps: f64,
    /// Outbound bits per second.
    pub out_bps: f64,
    /// Inbound utilisation percentage (0-100).
    pub in_utilization: f64,
    /// Outbound utilisation percentage (0-100).
    pub out_utilization: f64,
    /// Interface speed in bps used for calculation.
    pub speed_bps: u64,
    /// Timestamp of this measurement.
    pub timestamp: String,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Trap Receiver Configuration
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Configuration for the trap receiver.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrapReceiverConfig {
    /// Bind address (default "0.0.0.0").
    pub bind_addr: String,
    /// UDP port to listen on (default 162).
    pub port: u16,
    /// Community strings to accept (v1/v2c). Empty = accept all.
    pub allowed_communities: Vec<String>,
    /// Source IPs to accept. Empty = accept all.
    pub allowed_sources: Vec<String>,
    /// Maximum traps to keep in the in-memory buffer.
    pub max_buffer_size: usize,
    /// Whether to enable the receiver on start.
    pub auto_start: bool,
}

impl Default for TrapReceiverConfig {
    fn default() -> Self {
        Self {
            bind_addr: "0.0.0.0".to_string(),
            port: 162,
            allowed_communities: vec![],
            allowed_sources: vec![],
            max_buffer_size: 10000,
            auto_start: false,
        }
    }
}

/// Status of the trap receiver.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrapReceiverStatus {
    /// Whether the receiver is currently running.
    pub running: bool,
    /// Bind address.
    pub bind_addr: String,
    /// Port.
    pub port: u16,
    /// Total traps received since start.
    pub total_received: u64,
    /// Number of traps currently in the buffer.
    pub buffer_size: usize,
    /// Timestamp when the receiver was started.
    pub started_at: Option<String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  USM Engine / User Table
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// USM user entry stored by the service.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsmUser {
    /// Unique user ID.
    pub id: String,
    /// SNMPv3 username.
    pub username: String,
    /// Security level.
    pub security_level: SecurityLevel,
    /// Auth protocol.
    pub auth_protocol: Option<AuthProtocol>,
    /// Auth passphrase (stored encrypted / masked).
    pub auth_passphrase: Option<String>,
    /// Priv protocol.
    pub priv_protocol: Option<PrivProtocol>,
    /// Priv passphrase (stored encrypted / masked).
    pub priv_passphrase: Option<String>,
    /// Associated engine ID (hex).
    pub engine_id: Option<String>,
    /// User description / notes.
    pub description: Option<String>,
    /// When this user was created.
    pub created_at: String,
}

/// Discovered engine information (SNMPv3 engine discovery).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineInfo {
    /// Engine ID (hex string).
    pub engine_id: String,
    /// Engine boots counter.
    pub engine_boots: u32,
    /// Engine time counter.
    pub engine_time: u32,
    /// Max message size.
    pub max_message_size: u32,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Bulk Operation Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Configuration for a bulk SNMP operation across multiple targets.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulkOperationConfig {
    /// Targets to query.
    pub targets: Vec<SnmpTarget>,
    /// OIDs to retrieve from each target.
    pub oids: Vec<String>,
    /// Max concurrent requests.
    pub concurrency: u32,
}

/// Result from a bulk operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulkOperationResult {
    /// Per-target results.
    pub results: Vec<BulkTargetResult>,
    /// Total elapsed time.
    pub elapsed_ms: u64,
    /// Number of successful queries.
    pub success_count: u32,
    /// Number of failed queries.
    pub failure_count: u32,
}

/// Result for a single target in a bulk operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulkTargetResult {
    /// Target address.
    pub host: String,
    /// Whether the query succeeded.
    pub success: bool,
    /// Variable bindings (empty on failure).
    pub varbinds: Vec<VarBind>,
    /// Error message (if failed).
    pub error: Option<String>,
    /// RTT in milliseconds.
    pub rtt_ms: u64,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Service Status
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Overall SNMP service status.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnmpServiceStatus {
    /// Total GET/SET/WALK requests performed.
    pub total_requests: u64,
    /// Number of active monitors.
    pub active_monitors: u32,
    /// Trap receiver status.
    pub trap_receiver: TrapReceiverStatus,
    /// Number of loaded MIB modules.
    pub loaded_mibs: u32,
    /// Number of known USMv3 users.
    pub usm_users: u32,
    /// Number of discovered devices in cache.
    pub discovered_devices: u32,
}
