//! # Certificate Monitor
//!
//! Watches the health of all managed certificates and emits alerts
//! for expiry, revocation, and other issues.  Integrates with the
//! gateway health system.

use crate::types::*;
use chrono::Utc;
use serde::{Deserialize, Serialize};

/// Certificate health check result for a single certificate.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CertHealthCheck {
    /// Certificate ID.
    pub certificate_id: String,
    /// Primary domain.
    pub domain: String,
    /// Health status.
    pub status: CertHealthStatus,
    /// Human-readable message.
    pub message: String,
    /// Days until expiry.
    pub days_until_expiry: Option<i64>,
    /// OCSP status.
    pub ocsp_status: Option<OcspCertStatus>,
    /// When this check was performed.
    pub checked_at: chrono::DateTime<Utc>,
}

/// Health status for a certificate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CertHealthStatus {
    /// Certificate is valid and not expiring soon.
    Healthy,
    /// Certificate is expiring within the warning threshold.
    Warning,
    /// Certificate is expiring within the critical threshold.
    Critical,
    /// Certificate has expired.
    Expired,
    /// Certificate has been revoked.
    Revoked,
    /// Certificate check failed (couldn't read cert, etc.).
    Error,
}

/// Overall health summary for all managed certificates.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CertificateHealthSummary {
    /// Total certificates.
    pub total: usize,
    /// Healthy certificates.
    pub healthy: usize,
    /// Certificates with warnings.
    pub warning: usize,
    /// Certificates in critical state.
    pub critical: usize,
    /// Expired certificates.
    pub expired: usize,
    /// Revoked certificates.
    pub revoked: usize,
    /// Error state certificates.
    pub error: usize,
    /// Individual checks.
    pub checks: Vec<CertHealthCheck>,
    /// When this summary was generated.
    pub generated_at: chrono::DateTime<Utc>,
}

/// The certificate monitor.
pub struct CertificateMonitor {
    /// Warning threshold (days before expiry).
    warning_days: i64,
    /// Critical threshold (days before expiry).
    critical_days: i64,
    /// Last health summary.
    last_summary: Option<CertificateHealthSummary>,
}

impl CertificateMonitor {
    pub fn new(warning_days: i64, critical_days: i64) -> Self {
        Self {
            warning_days,
            critical_days,
            last_summary: None,
        }
    }

    /// Check the health of a single certificate.
    pub fn check_certificate(&self, cert: &ManagedCertificate) -> CertHealthCheck {
        let (status, message) = match cert.status {
            CertificateStatus::Revoked => (
                CertHealthStatus::Revoked,
                "Certificate has been revoked".to_string(),
            ),
            CertificateStatus::Expired => (
                CertHealthStatus::Expired,
                "Certificate has expired".to_string(),
            ),
            CertificateStatus::Failed => (
                CertHealthStatus::Error,
                "Certificate request failed".to_string(),
            ),
            _ => {
                if let Some(days) = cert.days_until_expiry {
                    if days <= 0 {
                        (
                            CertHealthStatus::Expired,
                            format!("Certificate expired {} day(s) ago", -days),
                        )
                    } else if days <= self.critical_days {
                        (
                            CertHealthStatus::Critical,
                            format!("Certificate expires in {} day(s)", days),
                        )
                    } else if days <= self.warning_days {
                        (
                            CertHealthStatus::Warning,
                            format!("Certificate expires in {} day(s)", days),
                        )
                    } else {
                        (
                            CertHealthStatus::Healthy,
                            format!("Certificate valid for {} more day(s)", days),
                        )
                    }
                } else {
                    (
                        CertHealthStatus::Error,
                        "Unable to determine expiry date".to_string(),
                    )
                }
            }
        };

        CertHealthCheck {
            certificate_id: cert.id.clone(),
            domain: cert.primary_domain.clone(),
            status,
            message,
            days_until_expiry: cert.days_until_expiry,
            ocsp_status: None,
            checked_at: Utc::now(),
        }
    }

    /// Check all certificates and generate a health summary.
    pub fn check_all(
        &mut self,
        certificates: &[ManagedCertificate],
    ) -> CertificateHealthSummary {
        let checks: Vec<CertHealthCheck> = certificates
            .iter()
            .map(|c| self.check_certificate(c))
            .collect();

        let summary = CertificateHealthSummary {
            total: checks.len(),
            healthy: checks.iter().filter(|c| c.status == CertHealthStatus::Healthy).count(),
            warning: checks.iter().filter(|c| c.status == CertHealthStatus::Warning).count(),
            critical: checks.iter().filter(|c| c.status == CertHealthStatus::Critical).count(),
            expired: checks.iter().filter(|c| c.status == CertHealthStatus::Expired).count(),
            revoked: checks.iter().filter(|c| c.status == CertHealthStatus::Revoked).count(),
            error: checks.iter().filter(|c| c.status == CertHealthStatus::Error).count(),
            checks,
            generated_at: Utc::now(),
        };

        self.last_summary = Some(summary.clone());
        summary
    }

    /// Get the last generated health summary.
    pub fn last_summary(&self) -> Option<&CertificateHealthSummary> {
        self.last_summary.as_ref()
    }

    /// Check if there are any certificates in critical or expired state.
    pub fn has_critical_issues(&self) -> bool {
        self.last_summary
            .as_ref()
            .map(|s| s.critical > 0 || s.expired > 0)
            .unwrap_or(false)
    }

    /// Get the most urgent certificate (closest to expiry).
    pub fn most_urgent(&self) -> Option<&CertHealthCheck> {
        self.last_summary
            .as_ref()?
            .checks
            .iter()
            .filter(|c| matches!(c.status, CertHealthStatus::Warning | CertHealthStatus::Critical))
            .min_by_key(|c| c.days_until_expiry.unwrap_or(i64::MAX))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn make_cert(id: &str, days: i64, status: CertificateStatus) -> ManagedCertificate {
        ManagedCertificate {
            id: id.to_string(),
            account_id: "acct".to_string(),
            primary_domain: format!("{}.example.com", id),
            domains: vec![format!("{}.example.com", id)],
            status,
            key_algorithm: KeyAlgorithm::EcdsaP256,
            cert_pem_path: None,
            key_pem_path: None,
            issuer_pem_path: None,
            serial: None,
            issuer_cn: None,
            not_before: None,
            not_after: None,
            days_until_expiry: Some(days),
            fingerprint_sha256: None,
            order_id: None,
            obtained_at: None,
            last_renewed_at: None,
            renewal_count: 0,
            auto_renew: true,
            preferred_challenge: ChallengeType::Http01,
            ocsp_response: None,
            ocsp_fetched_at: None,
            metadata: HashMap::new(),
        }
    }

    #[test]
    fn test_health_check_healthy() {
        let monitor = CertificateMonitor::new(30, 7);
        let cert = make_cert("healthy", 90, CertificateStatus::Active);
        let check = monitor.check_certificate(&cert);
        assert_eq!(check.status, CertHealthStatus::Healthy);
    }

    #[test]
    fn test_health_check_warning() {
        let monitor = CertificateMonitor::new(30, 7);
        let cert = make_cert("warn", 20, CertificateStatus::Active);
        let check = monitor.check_certificate(&cert);
        assert_eq!(check.status, CertHealthStatus::Warning);
    }

    #[test]
    fn test_health_check_critical() {
        let monitor = CertificateMonitor::new(30, 7);
        let cert = make_cert("crit", 3, CertificateStatus::Active);
        let check = monitor.check_certificate(&cert);
        assert_eq!(check.status, CertHealthStatus::Critical);
    }

    #[test]
    fn test_health_check_expired() {
        let monitor = CertificateMonitor::new(30, 7);
        let cert = make_cert("exp", -5, CertificateStatus::Active);
        let check = monitor.check_certificate(&cert);
        assert_eq!(check.status, CertHealthStatus::Expired);
    }

    #[test]
    fn test_health_summary() {
        let mut monitor = CertificateMonitor::new(30, 7);
        let certs = vec![
            make_cert("a", 90, CertificateStatus::Active),
            make_cert("b", 20, CertificateStatus::Active),
            make_cert("c", 3, CertificateStatus::Active),
            make_cert("d", -1, CertificateStatus::Expired),
        ];

        let summary = monitor.check_all(&certs);
        assert_eq!(summary.total, 4);
        assert_eq!(summary.healthy, 1);
        assert_eq!(summary.warning, 1);
        assert_eq!(summary.critical, 1);
        assert_eq!(summary.expired, 1);
        assert!(monitor.has_critical_issues());
    }
}
