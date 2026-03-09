//! # DNS Record Helpers
//!
//! Convenience builders and validators for common DNS record operations:
//! SPF/DKIM/DMARC checks, SRV service discovery, SSHFP verification,
//! TLSA/DANE validation, CAA policy checks.

use crate::types::*;
use serde::{Deserialize, Serialize};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  SPF / DKIM / DMARC  (email security via TXT records)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// SPF record analysis.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpfResult {
    pub found: bool,
    pub record: Option<String>,
    pub mechanisms: Vec<String>,
    pub qualifier: String,
    pub includes: Vec<String>,
    pub issues: Vec<String>,
}

/// Parse and validate SPF record from TXT records.
pub fn analyze_spf(txt_records: &[String]) -> SpfResult {
    let spf = txt_records.iter().find(|t| t.starts_with("v=spf1 "));

    let Some(record) = spf else {
        return SpfResult {
            found: false,
            record: None,
            mechanisms: Vec::new(),
            qualifier: String::new(),
            includes: Vec::new(),
            issues: vec!["No SPF record found".to_string()],
        };
    };

    let mut mechanisms = Vec::new();
    let mut includes = Vec::new();
    let mut issues = Vec::new();
    let mut qualifier = String::new();

    for part in record.split_whitespace().skip(1) {
        // skip "v=spf1"
        if let Some(stripped) = part.strip_prefix("include:") {
            includes.push(stripped.to_string());
        } else if part.starts_with('+')
            || part.starts_with('-')
            || part.starts_with('~')
            || part.starts_with('?')
        {
            qualifier = part[..1].to_string();
            mechanisms.push(part.to_string());
        } else if part == "all" || part == "-all" || part == "~all" || part == "+all" {
            qualifier = if part.starts_with('+') || part == "all" {
                "+".to_string()
            } else if part.starts_with('-') {
                "-".to_string()
            } else {
                "~".to_string()
            };
            mechanisms.push(part.to_string());
        } else {
            mechanisms.push(part.to_string());
        }
    }

    // Validate
    if qualifier == "+" || !record.contains("all") {
        issues.push(
            "SPF record allows all senders (+all or missing 'all') — very permissive".to_string(),
        );
    }

    if includes.len() > 10 {
        issues.push(format!(
            "SPF record has {} includes — may exceed DNS lookup limit (10)",
            includes.len()
        ));
    }

    if record.len() > 255 {
        issues.push("SPF record exceeds 255 characters — may need splitting".to_string());
    }

    SpfResult {
        found: true,
        record: Some(record.clone()),
        mechanisms,
        qualifier,
        includes,
        issues,
    }
}

/// DKIM record analysis.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DkimResult {
    pub found: bool,
    pub version: Option<String>,
    pub key_type: Option<String>,
    pub public_key: Option<String>,
    pub issues: Vec<String>,
}

/// Parse DKIM record from TXT records (queried at `selector._domainkey.domain`).
pub fn analyze_dkim(txt_records: &[String]) -> DkimResult {
    let dkim = txt_records.iter().find(|t| t.contains("v=DKIM1"));

    let Some(record) = dkim else {
        return DkimResult {
            found: false,
            version: None,
            key_type: None,
            public_key: None,
            issues: vec!["No DKIM record found".to_string()],
        };
    };

    let mut version = None;
    let mut key_type = None;
    let mut public_key = None;
    let mut issues = Vec::new();

    for part in record.split(';') {
        let part = part.trim();
        if let Some(v) = part.strip_prefix("v=") {
            version = Some(v.trim().to_string());
        } else if let Some(k) = part.strip_prefix("k=") {
            key_type = Some(k.trim().to_string());
        } else if let Some(p) = part.strip_prefix("p=") {
            let key = p.trim().to_string();
            if key.is_empty() {
                issues.push("DKIM key is revoked (empty p= value)".to_string());
            }
            public_key = Some(key);
        }
    }

    if public_key.is_none() {
        issues.push("No public key (p=) in DKIM record".to_string());
    }

    if key_type.as_deref() == Some("rsa") {
        if let Some(ref pk) = public_key {
            // Check minimum RSA key size (base64 encoded: 256 bytes ≈ 344 chars for 2048-bit)
            if pk.len() < 300 {
                issues.push(
                    "DKIM RSA key appears to be less than 2048 bits — upgrade recommended"
                        .to_string(),
                );
            }
        }
    }

    DkimResult {
        found: true,
        version,
        key_type,
        public_key,
        issues,
    }
}

/// DMARC record analysis.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DmarcResult {
    pub found: bool,
    pub policy: Option<String>,
    pub subdomain_policy: Option<String>,
    pub rua: Vec<String>,
    pub ruf: Vec<String>,
    pub pct: u8,
    pub issues: Vec<String>,
}

/// Parse DMARC record from TXT records (queried at `_dmarc.domain`).
pub fn analyze_dmarc(txt_records: &[String]) -> DmarcResult {
    let dmarc = txt_records.iter().find(|t| t.starts_with("v=DMARC1"));

    let Some(record) = dmarc else {
        return DmarcResult {
            found: false,
            policy: None,
            subdomain_policy: None,
            rua: Vec::new(),
            ruf: Vec::new(),
            pct: 100,
            issues: vec!["No DMARC record found".to_string()],
        };
    };

    let mut policy = None;
    let mut subdomain_policy = None;
    let mut rua = Vec::new();
    let mut ruf = Vec::new();
    let mut pct = 100u8;
    let mut issues = Vec::new();

    for part in record.split(';') {
        let part = part.trim();
        if let Some(p) = part.strip_prefix("p=") {
            policy = Some(p.trim().to_string());
        } else if let Some(sp) = part.strip_prefix("sp=") {
            subdomain_policy = Some(sp.trim().to_string());
        } else if let Some(r) = part.strip_prefix("rua=") {
            rua.extend(r.split(',').map(|s| s.trim().to_string()));
        } else if let Some(r) = part.strip_prefix("ruf=") {
            ruf.extend(r.split(',').map(|s| s.trim().to_string()));
        } else if let Some(p) = part.strip_prefix("pct=") {
            pct = p.trim().parse().unwrap_or(100);
        }
    }

    if policy.as_deref() == Some("none") {
        issues.push("DMARC policy is 'none' — monitoring only, no enforcement".to_string());
    }

    if rua.is_empty() {
        issues.push("No aggregate report URI (rua) configured".to_string());
    }

    if pct < 100 {
        issues.push(format!("DMARC only applies to {}% of messages", pct));
    }

    DmarcResult {
        found: true,
        policy,
        subdomain_policy,
        rua,
        ruf,
        pct,
        issues,
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  SRV Service Discovery
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Well-known SRV service names.
pub fn srv_name(service: &str, protocol: &str, domain: &str) -> String {
    format!("_{}._{}.{}", service, protocol, domain)
}

/// Common SRV lookups for RDP, SSH, Kerberos, LDAP, etc.
pub fn common_srv_queries(domain: &str) -> Vec<(String, String)> {
    vec![
        (
            srv_name("kerberos", "tcp", domain),
            "Kerberos KDC".to_string(),
        ),
        (
            srv_name("kerberos", "udp", domain),
            "Kerberos KDC (UDP)".to_string(),
        ),
        (srv_name("ldap", "tcp", domain), "LDAP".to_string()),
        (srv_name("ldaps", "tcp", domain), "LDAPS".to_string()),
        (
            srv_name("kpasswd", "tcp", domain),
            "Kerberos password change".to_string(),
        ),
        (srv_name("gc", "tcp", domain), "Global Catalog".to_string()),
        (srv_name("rdp", "tcp", domain), "Remote Desktop".to_string()),
        (srv_name("ssh", "tcp", domain), "SSH".to_string()),
        (srv_name("sip", "tcp", domain), "SIP".to_string()),
        (
            srv_name("xmpp-client", "tcp", domain),
            "XMPP client".to_string(),
        ),
    ]
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  SSHFP Verification
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// SSH fingerprint algorithm types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SshfpAlgorithm {
    Rsa,
    Dsa,
    Ecdsa,
    Ed25519,
    Unknown(u8),
}

impl SshfpAlgorithm {
    pub fn from_code(code: u8) -> Self {
        match code {
            1 => Self::Rsa,
            2 => Self::Dsa,
            3 => Self::Ecdsa,
            4 => Self::Ed25519,
            other => Self::Unknown(other),
        }
    }
}

/// SSH fingerprint hash types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SshfpHashType {
    Sha1,
    Sha256,
    Unknown(u8),
}

impl SshfpHashType {
    pub fn from_code(code: u8) -> Self {
        match code {
            1 => Self::Sha1,
            2 => Self::Sha256,
            other => Self::Unknown(other),
        }
    }
}

/// Verify an SSH host key against SSHFP records.
pub fn verify_sshfp(
    sshfp_records: &[(u8, u8, String)],
    host_key_algorithm: SshfpAlgorithm,
    host_key_fingerprint_sha256: &str,
) -> SshfpVerification {
    let expected_algo = match host_key_algorithm {
        SshfpAlgorithm::Rsa => 1,
        SshfpAlgorithm::Dsa => 2,
        SshfpAlgorithm::Ecdsa => 3,
        SshfpAlgorithm::Ed25519 => 4,
        SshfpAlgorithm::Unknown(c) => c,
    };

    // Find matching SSHFP records (match algorithm + SHA-256 hash type)
    let matches: Vec<&(u8, u8, String)> = sshfp_records
        .iter()
        .filter(|(algo, hash_type, _)| *algo == expected_algo && *hash_type == 2)
        .collect();

    if matches.is_empty() {
        return SshfpVerification {
            verified: false,
            details: format!(
                "No SSHFP records for algorithm {:?} with SHA-256",
                host_key_algorithm
            ),
        };
    }

    let fp_normalized = host_key_fingerprint_sha256
        .to_lowercase()
        .replace([':', ' '], "");

    for (_, _, record_fp) in &matches {
        let record_normalized = record_fp.to_lowercase().replace([':', ' '], "");
        if record_normalized == fp_normalized {
            return SshfpVerification {
                verified: true,
                details: "SSH host key matches SSHFP record".to_string(),
            };
        }
    }

    SshfpVerification {
        verified: false,
        details: "SSH host key does NOT match any SSHFP record — possible MITM".to_string(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshfpVerification {
    pub verified: bool,
    pub details: String,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  TLSA / DANE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// DANE TLSA usage types (RFC 6698).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TlsaUsage {
    /// CA constraint (PKIX-TA).
    CaConstraint,
    /// Service certificate constraint (PKIX-EE).
    ServiceCertificateConstraint,
    /// Trust anchor assertion (DANE-TA).
    TrustAnchorAssertion,
    /// Domain-issued certificate (DANE-EE).
    DomainIssuedCertificate,
    Unknown(u8),
}

impl TlsaUsage {
    pub fn from_code(code: u8) -> Self {
        match code {
            0 => Self::CaConstraint,
            1 => Self::ServiceCertificateConstraint,
            2 => Self::TrustAnchorAssertion,
            3 => Self::DomainIssuedCertificate,
            other => Self::Unknown(other),
        }
    }
}

/// Validate TLSA records for a service.
pub fn validate_tlsa_records(records: &[(u8, u8, u8, String)]) -> TlsaValidation {
    let mut issues = Vec::new();

    for (usage, selector, matching_type, _data) in records {
        let u = TlsaUsage::from_code(*usage);

        if *selector > 1 {
            issues.push(format!("Unknown TLSA selector: {}", selector));
        }

        if *matching_type > 2 {
            issues.push(format!("Unknown TLSA matching type: {}", matching_type));
        }

        if *matching_type == 0 && matches!(u, TlsaUsage::DomainIssuedCertificate) {
            issues.push(
                "DANE-EE with full certificate (matching_type=0) — SHA-256 (1) is preferred"
                    .to_string(),
            );
        }
    }

    TlsaValidation {
        records_found: records.len(),
        has_dane_ee: records.iter().any(|(u, _, _, _)| *u == 3),
        has_dane_ta: records.iter().any(|(u, _, _, _)| *u == 2),
        issues,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TlsaValidation {
    pub records_found: usize,
    pub has_dane_ee: bool,
    pub has_dane_ta: bool,
    pub issues: Vec<String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CAA Policy
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Analyze CAA records for certificate issuance policy.
pub fn analyze_caa(response: &DnsResponse) -> CaaAnalysis {
    let caa_records: Vec<_> = response
        .answers
        .iter()
        .filter_map(|r| {
            if let DnsRecordData::CAA { flags, tag, value } = &r.data {
                Some((*flags, tag.clone(), value.clone()))
            } else {
                None
            }
        })
        .collect();

    if caa_records.is_empty() {
        return CaaAnalysis {
            has_caa: false,
            allowed_issuers: Vec::new(),
            allows_wildcard: true,
            has_iodef: false,
            critical_flags: false,
            issues: vec!["No CAA records — any CA can issue certificates".to_string()],
        };
    }

    let allowed_issuers: Vec<String> = caa_records
        .iter()
        .filter(|(_, tag, _)| tag == "issue")
        .map(|(_, _, value)| value.clone())
        .collect();

    let allows_wildcard = caa_records.iter().any(|(_, tag, _)| tag == "issuewild")
        || allowed_issuers.iter().any(|v| !v.is_empty() && v != ";");

    let has_iodef = caa_records.iter().any(|(_, tag, _)| tag == "iodef");
    let critical_flags = caa_records.iter().any(|(flags, _, _)| *flags & 0x80 != 0);

    let mut issues = Vec::new();
    if !has_iodef {
        issues.push("No iodef tag — CA violation reports won't be sent".to_string());
    }

    CaaAnalysis {
        has_caa: true,
        allowed_issuers,
        allows_wildcard,
        has_iodef,
        critical_flags,
        issues,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaaAnalysis {
    pub has_caa: bool,
    pub allowed_issuers: Vec<String>,
    pub allows_wildcard: bool,
    pub has_iodef: bool,
    pub critical_flags: bool,
    pub issues: Vec<String>,
}
