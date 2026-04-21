//! # DNS Types
//!
//! Shared type definitions used across all DNS modules.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  DNS Record Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// All supported DNS record types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum DnsRecordType {
    /// IPv4 address (RFC 1035).
    A,
    /// IPv6 address (RFC 3596).
    AAAA,
    /// Canonical name alias (RFC 1035).
    CNAME,
    /// Mail exchange (RFC 1035).
    MX,
    /// Text record (RFC 1035).
    TXT,
    /// Service locator (RFC 2782).
    SRV,
    /// Pointer / reverse DNS (RFC 1035).
    PTR,
    /// Name server (RFC 1035).
    NS,
    /// Start of authority (RFC 1035).
    SOA,
    /// Certificate authority authorization (RFC 8659).
    CAA,
    /// Naming authority pointer (RFC 3403).
    NAPTR,
    /// SSH fingerprint (RFC 4255).
    SSHFP,
    /// DANE TLS association (RFC 6698).
    TLSA,
    /// HTTPS binding (RFC 9460).
    HTTPS,
    /// Service binding (RFC 9460).
    SVCB,
    /// DNSKEY (RFC 4034) — DNSSEC.
    DNSKEY,
    /// DS — Delegation Signer (RFC 4034).
    DS,
    /// RRSIG — signature (RFC 4034).
    RRSIG,
    /// NSEC — authenticated denial of existence (RFC 4034).
    NSEC,
    /// NSEC3 — hashed denial of existence (RFC 5155).
    NSEC3,
    /// Any / wildcard (query only).
    ANY,
}

impl DnsRecordType {
    /// Numeric type code per IANA.
    pub fn type_code(&self) -> u16 {
        match self {
            Self::A => 1,
            Self::NS => 2,
            Self::CNAME => 5,
            Self::SOA => 6,
            Self::PTR => 12,
            Self::MX => 15,
            Self::TXT => 16,
            Self::AAAA => 28,
            Self::SRV => 33,
            Self::NAPTR => 35,
            Self::DS => 43,
            Self::SSHFP => 44,
            Self::RRSIG => 46,
            Self::NSEC => 47,
            Self::DNSKEY => 48,
            Self::NSEC3 => 50,
            Self::TLSA => 52,
            Self::CAA => 257,
            Self::SVCB => 64,
            Self::HTTPS => 65,
            Self::ANY => 255,
        }
    }

    /// Parse from IANA type code.
    pub fn from_type_code(code: u16) -> Option<Self> {
        match code {
            1 => Some(Self::A),
            2 => Some(Self::NS),
            5 => Some(Self::CNAME),
            6 => Some(Self::SOA),
            12 => Some(Self::PTR),
            15 => Some(Self::MX),
            16 => Some(Self::TXT),
            28 => Some(Self::AAAA),
            33 => Some(Self::SRV),
            35 => Some(Self::NAPTR),
            43 => Some(Self::DS),
            44 => Some(Self::SSHFP),
            46 => Some(Self::RRSIG),
            47 => Some(Self::NSEC),
            48 => Some(Self::DNSKEY),
            50 => Some(Self::NSEC3),
            52 => Some(Self::TLSA),
            64 => Some(Self::SVCB),
            65 => Some(Self::HTTPS),
            255 => Some(Self::ANY),
            257 => Some(Self::CAA),
            _ => None,
        }
    }

    /// RFC name string.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::A => "A",
            Self::AAAA => "AAAA",
            Self::CNAME => "CNAME",
            Self::MX => "MX",
            Self::TXT => "TXT",
            Self::SRV => "SRV",
            Self::PTR => "PTR",
            Self::NS => "NS",
            Self::SOA => "SOA",
            Self::CAA => "CAA",
            Self::NAPTR => "NAPTR",
            Self::SSHFP => "SSHFP",
            Self::TLSA => "TLSA",
            Self::HTTPS => "HTTPS",
            Self::SVCB => "SVCB",
            Self::DNSKEY => "DNSKEY",
            Self::DS => "DS",
            Self::RRSIG => "RRSIG",
            Self::NSEC => "NSEC",
            Self::NSEC3 => "NSEC3",
            Self::ANY => "ANY",
        }
    }

    /// Parse from string (case-insensitive).
    pub fn from_str_loose(s: &str) -> Option<Self> {
        match s.to_uppercase().as_str() {
            "A" => Some(Self::A),
            "AAAA" => Some(Self::AAAA),
            "CNAME" => Some(Self::CNAME),
            "MX" => Some(Self::MX),
            "TXT" => Some(Self::TXT),
            "SRV" => Some(Self::SRV),
            "PTR" => Some(Self::PTR),
            "NS" => Some(Self::NS),
            "SOA" => Some(Self::SOA),
            "CAA" => Some(Self::CAA),
            "NAPTR" => Some(Self::NAPTR),
            "SSHFP" => Some(Self::SSHFP),
            "TLSA" => Some(Self::TLSA),
            "HTTPS" => Some(Self::HTTPS),
            "SVCB" => Some(Self::SVCB),
            "DNSKEY" => Some(Self::DNSKEY),
            "DS" => Some(Self::DS),
            "RRSIG" => Some(Self::RRSIG),
            "NSEC" => Some(Self::NSEC),
            "NSEC3" => Some(Self::NSEC3),
            "ANY" | "*" => Some(Self::ANY),
            _ => None,
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  DNS Records (parsed)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// A single DNS resource record.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsRecord {
    pub name: String,
    pub record_type: DnsRecordType,
    pub ttl: u32,
    pub data: DnsRecordData,
}

/// Typed record data.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum DnsRecordData {
    A {
        address: String,
    },
    AAAA {
        address: String,
    },
    CNAME {
        target: String,
    },
    MX {
        priority: u16,
        exchange: String,
    },
    TXT {
        text: String,
    },
    SRV {
        priority: u16,
        weight: u16,
        port: u16,
        target: String,
    },
    PTR {
        domain: String,
    },
    NS {
        nameserver: String,
    },
    SOA {
        mname: String,
        rname: String,
        serial: u32,
        refresh: u32,
        retry: u32,
        expire: u32,
        minimum: u32,
    },
    CAA {
        flags: u8,
        tag: String,
        value: String,
    },
    NAPTR {
        order: u16,
        preference: u16,
        flags: String,
        services: String,
        regexp: String,
        replacement: String,
    },
    SSHFP {
        algorithm: u8,
        fingerprint_type: u8,
        fingerprint: String,
    },
    TLSA {
        usage: u8,
        selector: u8,
        matching_type: u8,
        certificate_data: String,
    },
    HTTPS {
        priority: u16,
        target: String,
        params: HashMap<String, String>,
    },
    SVCB {
        priority: u16,
        target: String,
        params: HashMap<String, String>,
    },
    DNSKEY {
        flags: u16,
        protocol: u8,
        algorithm: u8,
        public_key: String,
    },
    DS {
        key_tag: u16,
        algorithm: u8,
        digest_type: u8,
        digest: String,
    },
    RRSIG {
        type_covered: String,
        algorithm: u8,
        labels: u8,
        original_ttl: u32,
        expiration: u32,
        inception: u32,
        key_tag: u16,
        signer: String,
        signature: String,
    },
    Raw {
        data: Vec<u8>,
    },
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  DNS Query / Response
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// A DNS query to execute.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsQuery {
    pub name: String,
    pub record_type: DnsRecordType,
    pub class: DnsClass,
    /// Use DNSSEC validation.
    pub dnssec: bool,
    /// Recursion desired.
    pub rd: bool,
    /// Checking disabled (skip DNSSEC validation on server).
    pub cd: bool,
}

impl DnsQuery {
    pub fn new(name: &str, record_type: DnsRecordType) -> Self {
        Self {
            name: name.to_string(),
            record_type,
            class: DnsClass::IN,
            dnssec: false,
            rd: true,
            cd: false,
        }
    }

    pub fn with_dnssec(mut self) -> Self {
        self.dnssec = true;
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DnsClass {
    IN,
    CH,
    HS,
    ANY,
}

impl DnsClass {
    pub fn code(&self) -> u16 {
        match self {
            Self::IN => 1,
            Self::CH => 3,
            Self::HS => 4,
            Self::ANY => 255,
        }
    }
}

/// A complete DNS response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsResponse {
    /// Response code.
    pub rcode: DnsRcode,
    /// Whether the response is authoritative.
    pub authoritative: bool,
    /// Whether the response is truncated.
    pub truncated: bool,
    /// Recursion available.
    pub recursion_available: bool,
    /// DNSSEC: Authenticated Data flag.
    pub authenticated_data: bool,
    /// Answer section records.
    pub answers: Vec<DnsRecord>,
    /// Authority section records.
    pub authority: Vec<DnsRecord>,
    /// Additional section records.
    pub additional: Vec<DnsRecord>,
    /// Query duration in milliseconds.
    pub duration_ms: u64,
    /// Which server answered.
    pub server: String,
    /// Protocol used.
    pub protocol: DnsProtocol,
}

impl DnsResponse {
    /// Get all A record addresses.
    pub fn a_records(&self) -> Vec<String> {
        self.answers
            .iter()
            .filter_map(|r| match &r.data {
                DnsRecordData::A { address } => Some(address.clone()),
                _ => None,
            })
            .collect()
    }

    /// Get all AAAA record addresses.
    pub fn aaaa_records(&self) -> Vec<String> {
        self.answers
            .iter()
            .filter_map(|r| match &r.data {
                DnsRecordData::AAAA { address } => Some(address.clone()),
                _ => None,
            })
            .collect()
    }

    /// Get all IP addresses (A + AAAA).
    pub fn ip_addresses(&self) -> Vec<String> {
        let mut ips = self.a_records();
        ips.extend(self.aaaa_records());
        ips
    }

    /// Get MX records sorted by priority.
    pub fn mx_records(&self) -> Vec<(u16, String)> {
        let mut mx: Vec<(u16, String)> = self
            .answers
            .iter()
            .filter_map(|r| match &r.data {
                DnsRecordData::MX { priority, exchange } => Some((*priority, exchange.clone())),
                _ => None,
            })
            .collect();
        mx.sort_by_key(|(p, _)| *p);
        mx
    }

    /// Get all TXT record strings.
    pub fn txt_records(&self) -> Vec<String> {
        self.answers
            .iter()
            .filter_map(|r| match &r.data {
                DnsRecordData::TXT { text } => Some(text.clone()),
                _ => None,
            })
            .collect()
    }

    /// Get SRV records sorted by priority then weight.
    pub fn srv_records(&self) -> Vec<(u16, u16, u16, String)> {
        let mut srv: Vec<(u16, u16, u16, String)> = self
            .answers
            .iter()
            .filter_map(|r| match &r.data {
                DnsRecordData::SRV {
                    priority,
                    weight,
                    port,
                    target,
                } => Some((*priority, *weight, *port, target.clone())),
                _ => None,
            })
            .collect();
        srv.sort_by(|a, b| a.0.cmp(&b.0).then(b.1.cmp(&a.1)));
        srv
    }

    /// Get PTR domain names.
    pub fn ptr_records(&self) -> Vec<String> {
        self.answers
            .iter()
            .filter_map(|r| match &r.data {
                DnsRecordData::PTR { domain } => Some(domain.clone()),
                _ => None,
            })
            .collect()
    }

    /// Get SSHFP fingerprints.
    pub fn sshfp_records(&self) -> Vec<(u8, u8, String)> {
        self.answers
            .iter()
            .filter_map(|r| match &r.data {
                DnsRecordData::SSHFP {
                    algorithm,
                    fingerprint_type,
                    fingerprint,
                } => Some((*algorithm, *fingerprint_type, fingerprint.clone())),
                _ => None,
            })
            .collect()
    }

    /// Get TLSA records.
    pub fn tlsa_records(&self) -> Vec<(u8, u8, u8, String)> {
        self.answers
            .iter()
            .filter_map(|r| match &r.data {
                DnsRecordData::TLSA {
                    usage,
                    selector,
                    matching_type,
                    certificate_data,
                } => Some((*usage, *selector, *matching_type, certificate_data.clone())),
                _ => None,
            })
            .collect()
    }

    /// Minimum TTL across all answer records.
    pub fn min_ttl(&self) -> u32 {
        self.answers.iter().map(|r| r.ttl).min().unwrap_or(0)
    }

    /// Check if DNSSEC-validated.
    pub fn is_dnssec_validated(&self) -> bool {
        self.authenticated_data
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DnsRcode {
    NoError,
    FormErr,
    ServFail,
    NXDomain,
    NotImp,
    Refused,
    YXDomain,
    YXRRSet,
    NXRRSet,
    NotAuth,
    NotZone,
    Other(u16),
}

impl DnsRcode {
    pub fn from_code(code: u16) -> Self {
        match code {
            0 => Self::NoError,
            1 => Self::FormErr,
            2 => Self::ServFail,
            3 => Self::NXDomain,
            4 => Self::NotImp,
            5 => Self::Refused,
            6 => Self::YXDomain,
            7 => Self::YXRRSet,
            8 => Self::NXRRSet,
            9 => Self::NotAuth,
            10 => Self::NotZone,
            other => Self::Other(other),
        }
    }

    pub fn code(&self) -> u16 {
        match self {
            Self::NoError => 0,
            Self::FormErr => 1,
            Self::ServFail => 2,
            Self::NXDomain => 3,
            Self::NotImp => 4,
            Self::Refused => 5,
            Self::YXDomain => 6,
            Self::YXRRSet => 7,
            Self::NXRRSet => 8,
            Self::NotAuth => 9,
            Self::NotZone => 10,
            Self::Other(c) => *c,
        }
    }

    pub fn is_success(&self) -> bool {
        matches!(self, Self::NoError)
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  DNS Transport Protocol
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// DNS transport protocol.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum DnsProtocol {
    /// Plain UDP port 53.
    Udp,
    /// Plain TCP port 53.
    Tcp,
    /// DNS-over-HTTPS (RFC 8484).
    DoH,
    /// DNS-over-TLS (RFC 7858), port 853.
    DoT,
    /// DNS-over-QUIC (RFC 9250), port 853.
    DoQ,
    /// Oblivious DoH (RFC 9230).
    ODoH,
    /// mDNS multicast (RFC 6762).
    MDns,
    /// LLMNR (RFC 4795).
    Llmnr,
    /// System resolver (OS-provided, protocol unknown).
    System,
}

impl DnsProtocol {
    /// Whether this protocol provides encryption.
    pub fn is_encrypted(&self) -> bool {
        matches!(self, Self::DoH | Self::DoT | Self::DoQ | Self::ODoH)
    }

    /// Whether this protocol authenticates responses.
    pub fn is_authenticated(&self) -> bool {
        // DoH/DoT/DoQ authenticate the server via TLS.
        // ODoH authenticates via proxy chain.
        matches!(self, Self::DoH | Self::DoT | Self::DoQ | Self::ODoH)
    }

    /// Default port.
    pub fn default_port(&self) -> u16 {
        match self {
            Self::Udp | Self::Tcp => 53,
            Self::DoH => 443,
            Self::DoT | Self::DoQ => 853,
            Self::ODoH => 443,
            Self::MDns => 5353,
            Self::Llmnr => 5355,
            Self::System => 0,
        }
    }
}

impl std::fmt::Display for DnsProtocol {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Udp => write!(f, "UDP"),
            Self::Tcp => write!(f, "TCP"),
            Self::DoH => write!(f, "DoH"),
            Self::DoT => write!(f, "DoT"),
            Self::DoQ => write!(f, "DoQ"),
            Self::ODoH => write!(f, "ODoH"),
            Self::MDns => write!(f, "mDNS"),
            Self::Llmnr => write!(f, "LLMNR"),
            Self::System => write!(f, "System"),
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Resolver Configuration
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// DNS resolver configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsResolverConfig {
    /// Primary resolution protocol.
    pub protocol: DnsProtocol,
    /// Fallback protocol if primary fails.
    pub fallback_protocol: Option<DnsProtocol>,
    /// Server addresses (IP or URL for DoH).
    pub servers: Vec<DnsServer>,
    /// Enable caching.
    pub cache_enabled: bool,
    /// Maximum cache entries.
    pub cache_max_entries: usize,
    /// Override TTL minimum (seconds).
    pub min_ttl: u32,
    /// Override TTL maximum (seconds).
    pub max_ttl: u32,
    /// Query timeout in milliseconds.
    pub timeout_ms: u64,
    /// Number of retries.
    pub retries: u32,
    /// Rotate through servers (round-robin).
    pub rotate_servers: bool,
    /// Use EDNS0 (RFC 6891).
    pub edns0: bool,
    /// EDNS0 UDP payload size.
    pub edns0_payload_size: u16,
    /// Request DNSSEC validation.
    pub dnssec: bool,
    /// Disable IPv6 queries (A-only).
    pub ipv4_only: bool,
    /// Disable IPv4 queries (AAAA-only).
    pub ipv6_only: bool,
    /// Search domains to append.
    pub search_domains: Vec<String>,
    /// Number of dots before name is tried as absolute.
    pub ndots: u8,
}

impl Default for DnsResolverConfig {
    fn default() -> Self {
        Self {
            protocol: DnsProtocol::System,
            fallback_protocol: None,
            servers: Vec::new(),
            cache_enabled: true,
            cache_max_entries: 10_000,
            min_ttl: 10,
            max_ttl: 86_400,
            timeout_ms: 5_000,
            retries: 2,
            rotate_servers: false,
            edns0: true,
            edns0_payload_size: 4096,
            dnssec: false,
            ipv4_only: false,
            ipv6_only: false,
            search_domains: Vec::new(),
            ndots: 1,
        }
    }
}

/// A DNS server endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsServer {
    /// Server address (IP for UDP/TCP/DoT, URL for DoH/ODoH).
    pub address: String,
    /// Optional port override.
    pub port: Option<u16>,
    /// Server name for TLS SNI (DoT/DoH).
    pub tls_hostname: Option<String>,
    /// Provider name for display.
    pub provider: Option<String>,
    /// Protocol override (if different from resolver config).
    pub protocol: Option<DnsProtocol>,
    /// HTTP path for DoH (default: /dns-query).
    pub doh_path: Option<String>,
    /// Use wire-format (RFC 8484) vs JSON API for DoH.
    pub doh_wire_format: bool,
    /// Bootstrap addresses (to resolve DoH hostname without DNS).
    pub bootstrap: Vec<String>,
}

impl DnsServer {
    /// Create a plain DNS server (UDP/TCP).
    pub fn plain(address: &str) -> Self {
        Self {
            address: address.to_string(),
            port: None,
            tls_hostname: None,
            provider: None,
            protocol: None,
            doh_path: None,
            doh_wire_format: true,
            bootstrap: Vec::new(),
        }
    }

    /// Create a DoH server.
    pub fn doh(url: &str) -> Self {
        Self {
            address: url.to_string(),
            port: Some(443),
            tls_hostname: None,
            provider: None,
            protocol: Some(DnsProtocol::DoH),
            doh_path: Some("/dns-query".to_string()),
            doh_wire_format: true,
            bootstrap: Vec::new(),
        }
    }

    /// Create a DoT server.
    pub fn dot(address: &str, hostname: &str) -> Self {
        Self {
            address: address.to_string(),
            port: Some(853),
            tls_hostname: Some(hostname.to_string()),
            provider: None,
            protocol: Some(DnsProtocol::DoT),
            doh_path: None,
            doh_wire_format: true,
            bootstrap: Vec::new(),
        }
    }

    /// Set the provider name.
    pub fn with_provider(mut self, name: &str) -> Self {
        self.provider = Some(name.to_string());
        self
    }

    /// Set bootstrap addresses.
    pub fn with_bootstrap(mut self, addrs: Vec<String>) -> Self {
        self.bootstrap = addrs;
        self
    }

    /// Effective port.
    pub fn effective_port(&self, default_protocol: DnsProtocol) -> u16 {
        self.port
            .unwrap_or_else(|| self.protocol.unwrap_or(default_protocol).default_port())
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Resolver State (Tauri pattern)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

pub type DnsResolverState = Arc<Mutex<crate::resolver::DnsResolver>>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  mDNS types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// mDNS service instance discovered on the network.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MdnsService {
    pub instance_name: String,
    pub service_type: String,
    pub domain: String,
    pub hostname: String,
    pub port: u16,
    pub addresses: Vec<String>,
    pub txt_records: HashMap<String, String>,
    pub ttl: u32,
    pub discovered_at: String,
}

/// mDNS service registration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MdnsRegistration {
    pub instance_name: String,
    pub service_type: String,
    pub port: u16,
    pub txt_records: HashMap<String, String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Diagnostics types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// DNS resolution benchmark result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsBenchmarkResult {
    pub server: DnsServer,
    pub protocol: DnsProtocol,
    pub avg_latency_ms: f64,
    pub min_latency_ms: f64,
    pub max_latency_ms: f64,
    pub success_rate: f64,
    pub queries_sent: u32,
    pub queries_failed: u32,
    pub dnssec_supported: bool,
}

/// DNS leak test result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsLeakTestResult {
    pub leaked: bool,
    pub servers_seen: Vec<String>,
    pub expected_server: Option<String>,
    pub protocol_detected: Option<DnsProtocol>,
    pub details: String,
}
