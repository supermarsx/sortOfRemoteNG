//! # Teleport Certificate Management
//!
//! Certificate inspection, expiry checking, CA information,
//! and certificate renewal utilities.

use crate::types::*;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Build `tsh status` to inspect current certificate.
pub fn cert_status_command() -> Vec<String> {
    vec!["tsh".to_string(), "status".to_string()]
}

/// Build `tctl auth export` to export the cluster CA cert.
pub fn export_ca_command(ca_type: &str) -> Vec<String> {
    vec![
        "tctl".to_string(),
        "auth".to_string(),
        "export".to_string(),
        format!("--type={}", ca_type),
    ]
}

/// Build `tctl auth sign` to issue new certificates.
pub fn sign_cert_command(
    user: &str,
    out: &str,
    ttl: Option<&str>,
    format: Option<&str>,
) -> Vec<String> {
    let mut cmd = vec![
        "tctl".to_string(),
        "auth".to_string(),
        "sign".to_string(),
        format!("--user={}", user),
        format!("--out={}", out),
    ];
    if let Some(t) = ttl {
        cmd.push(format!("--ttl={}", t));
    }
    if let Some(f) = format {
        cmd.push(format!("--format={}", f));
    }
    cmd
}

/// Build `tctl auth rotate` to rotate the cluster CA.
pub fn rotate_ca_command(ca_type: &str, grace_period: Option<&str>) -> Vec<String> {
    let mut cmd = vec![
        "tctl".to_string(),
        "auth".to_string(),
        "rotate".to_string(),
        format!("--type={}", ca_type),
    ];
    if let Some(gp) = grace_period {
        cmd.push(format!("--grace-period={}", gp));
    }
    cmd
}

/// Check if a cert is expired relative to a given timestamp.
pub fn is_cert_expired(cert: &UserCertificate, now: DateTime<Utc>) -> bool {
    cert.valid_before <= now
}

/// Check how many seconds until expiry. Returns `None` if already expired.
pub fn cert_ttl_secs(cert: &UserCertificate, now: DateTime<Utc>) -> Option<i64> {
    let diff = cert.valid_before.signed_duration_since(now).num_seconds();
    if diff > 0 {
        Some(diff)
    } else {
        None
    }
}

/// True if the cert expires within the given threshold seconds.
pub fn cert_expiring_soon(cert: &UserCertificate, now: DateTime<Utc>, threshold_secs: i64) -> bool {
    match cert_ttl_secs(cert, now) {
        Some(remaining) => remaining < threshold_secs,
        None => true, // already expired
    }
}

/// Group certificates by type.
pub fn group_certs_by_type<'a>(
    certs: &[&'a UserCertificate],
) -> (Vec<&'a UserCertificate>, Vec<&'a UserCertificate>) {
    let user: Vec<_> = certs
        .iter()
        .filter(|c| c.cert_type == CertType::User)
        .copied()
        .collect();
    let host: Vec<_> = certs
        .iter()
        .filter(|c| c.cert_type == CertType::Host)
        .copied()
        .collect();
    (user, host)
}

/// Certificate summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CertSummary {
    pub total: u32,
    pub user_certs: u32,
    pub host_certs: u32,
    pub expired: u32,
    pub expiring_soon: u32,
}

pub fn summarize_certs(
    certs: &[&UserCertificate],
    now: DateTime<Utc>,
    threshold_secs: i64,
) -> CertSummary {
    let (user, host) = group_certs_by_type(certs);
    let expired = certs.iter().filter(|c| is_cert_expired(c, now)).count() as u32;
    let expiring = certs
        .iter()
        .filter(|c| cert_expiring_soon(c, now, threshold_secs))
        .count() as u32;
    CertSummary {
        total: certs.len() as u32,
        user_certs: user.len() as u32,
        host_certs: host.len() as u32,
        expired,
        expiring_soon: expiring,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;
    use std::collections::HashMap;

    fn sample_cert(cert_type: CertType, valid_before: DateTime<Utc>) -> UserCertificate {
        UserCertificate {
            user: "alice@example.com".to_string(),
            valid_after: Utc::now() - Duration::hours(1),
            valid_before,
            principals: vec!["root".to_string()],
            key_id: "key-abc123".to_string(),
            cert_type,
            extensions: HashMap::new(),
            fingerprint: Some("SHA256:abc".to_string()),
        }
    }

    #[test]
    fn test_cert_ttl() {
        let now = Utc::now();
        let cert = sample_cert(CertType::User, now + Duration::seconds(1000));
        let ttl = cert_ttl_secs(&cert, now);
        assert!(ttl.is_some());
        assert!(ttl.unwrap() > 990);
    }

    #[test]
    fn test_cert_expired() {
        let now = Utc::now();
        let cert = sample_cert(CertType::User, now - Duration::seconds(10));
        assert!(is_cert_expired(&cert, now));
    }

    #[test]
    fn test_cert_expiring_soon() {
        let now = Utc::now();
        let cert = sample_cert(CertType::User, now + Duration::seconds(100));
        assert!(cert_expiring_soon(&cert, now, 3600));
        assert!(!cert_expiring_soon(&cert, now, 50));
    }

    #[test]
    fn test_export_ca_command() {
        let cmd = export_ca_command("user");
        assert!(cmd.contains(&"--type=user".to_string()));
    }

    #[test]
    fn test_sign_cert_command() {
        let cmd = sign_cert_command("alice", "/tmp/alice", Some("8h"), None);
        assert!(cmd.contains(&"--user=alice".to_string()));
        assert!(cmd.contains(&"--ttl=8h".to_string()));
    }
}
