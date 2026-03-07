use std::collections::HashMap;
use chrono::{DateTime, Utc, Duration};
use log::{info, warn};
use uuid::Uuid;

use crate::error::{BackupVerifyError, Result};
use crate::types::{
    BackupPolicy, CatalogEntry, ComplianceFinding, ComplianceFramework,
    ComplianceReport, CustomComplianceRule, FindingSeverity, RetentionPolicy,
    VerificationResult, VerificationStatus,
};

// ─── Audit trail ────────────────────────────────────────────────────────────

/// A timestamped audit event.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AuditEvent {
    pub id: String,
    pub timestamp: DateTime<Utc>,
    pub actor: String,
    pub action: String,
    pub resource: String,
    pub details: String,
    pub framework: Option<ComplianceFramework>,
}

/// Aggregated policy-violation record.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PolicyViolation {
    pub policy_id: String,
    pub policy_name: String,
    pub violation: String,
    pub severity: FindingSeverity,
    pub detected_at: DateTime<Utc>,
    pub framework: ComplianceFramework,
}

// ─── ComplianceReporter ─────────────────────────────────────────────────────

/// Generates compliance reports against standard regulatory frameworks by
/// evaluating backup policies, catalog entries, and verification history.
pub struct ComplianceReporter {
    audit_log: Vec<AuditEvent>,
    custom_rules: Vec<CustomComplianceRule>,
    report_history: Vec<ComplianceReport>,
}

impl ComplianceReporter {
    pub fn new() -> Self {
        Self {
            audit_log: Vec::new(),
            custom_rules: Vec::new(),
            report_history: Vec::new(),
        }
    }

    // ── Report generation ──────────────────────────────────────────────────

    /// Generate a compliance report for a given framework and date range.
    pub fn generate_report(
        &mut self,
        framework: ComplianceFramework,
        period_start: DateTime<Utc>,
        period_end: DateTime<Utc>,
        policies: &[&BackupPolicy],
        entries: &[&CatalogEntry],
        verifications: &HashMap<String, Vec<VerificationResult>>,
    ) -> Result<ComplianceReport> {
        info!(
            "Generating {} compliance report for {} — {}",
            framework, period_start, period_end
        );

        let mut report = ComplianceReport::new(
            Uuid::new_v4().to_string(),
            framework.clone(),
            period_start,
            period_end,
        );
        report.policies_evaluated = policies.len() as u32;

        let findings = match framework {
            ComplianceFramework::SOX => self.check_sox_compliance(policies, entries, verifications),
            ComplianceFramework::HIPAA => self.check_hipaa_compliance(policies, entries, verifications),
            ComplianceFramework::GDPR => self.check_gdpr_compliance(policies, entries, verifications),
            ComplianceFramework::PciDss => self.check_pci_compliance(policies, entries, verifications),
            ComplianceFramework::ISO27001 => self.check_iso27001_compliance(policies, entries, verifications),
            ComplianceFramework::NIST => self.check_nist_compliance(policies, entries, verifications),
            ComplianceFramework::Custom => self.check_custom_compliance(policies, entries),
        };

        report.findings = findings;
        report.policies_compliant = self.count_compliant_policies(policies, &report.findings);
        report.score_percent = self.calculate_score(&report);
        report.recommendations = self.generate_recommendations(&report);

        self.log_audit_event(
            "system",
            "generate_compliance_report",
            &format!("report:{}", report.id),
            &format!("{} report generated, score: {:.1}%", framework, report.score_percent),
            Some(framework),
        );

        self.report_history.push(report.clone());
        Ok(report)
    }

    // ── Framework-specific checks ──────────────────────────────────────────

    /// SOX: Financial-data retention, access controls, audit trails.
    pub fn check_sox_compliance(
        &self,
        policies: &[&BackupPolicy],
        entries: &[&CatalogEntry],
        verifications: &HashMap<String, Vec<VerificationResult>>,
    ) -> Vec<ComplianceFinding> {
        let mut findings = Vec::new();

        // SOX requires 7-year retention for financial data
        for policy in policies {
            if policy.retention.max_retention_days < 2555 {
                findings.push(ComplianceFinding {
                    severity: FindingSeverity::High,
                    category: "Retention".into(),
                    description: format!(
                        "Policy '{}' retention ({} days) below SOX 7-year requirement",
                        policy.name, policy.retention.max_retention_days
                    ),
                    policy_id: Some(policy.id.clone()),
                    remediation: "Increase max_retention_days to at least 2555 (7 years)".into(),
                });
            }
        }

        // SOX: every backup must be verified
        let unverified: Vec<_> = entries.iter().filter(|e| !e.verified).collect();
        if !unverified.is_empty() {
            findings.push(ComplianceFinding {
                severity: FindingSeverity::Medium,
                category: "Verification".into(),
                description: format!(
                    "{} backup entries have not been verified",
                    unverified.len()
                ),
                policy_id: None,
                remediation: "Run verification on all unverified backups".into(),
            });
        }

        // SOX: audit trail must be present
        if self.audit_log.is_empty() {
            findings.push(ComplianceFinding {
                severity: FindingSeverity::High,
                category: "Audit Trail".into(),
                description: "No audit events recorded".into(),
                policy_id: None,
                remediation: "Enable audit logging for all backup operations".into(),
            });
        }

        // SOX: encryption required
        self.check_encryption_findings(policies, &mut findings, "SOX");

        findings
    }

    /// HIPAA: PHI data protection, encryption, access controls.
    pub fn check_hipaa_compliance(
        &self,
        policies: &[&BackupPolicy],
        entries: &[&CatalogEntry],
        verifications: &HashMap<String, Vec<VerificationResult>>,
    ) -> Vec<ComplianceFinding> {
        let mut findings = Vec::new();

        // HIPAA requires encryption at rest
        self.check_encryption_findings(policies, &mut findings, "HIPAA");

        // HIPAA: 6-year retention minimum
        for policy in policies {
            if policy.retention.max_retention_days < 2190 {
                findings.push(ComplianceFinding {
                    severity: FindingSeverity::High,
                    category: "Retention".into(),
                    description: format!(
                        "Policy '{}' retention ({} days) below HIPAA 6-year requirement",
                        policy.name, policy.retention.max_retention_days
                    ),
                    policy_id: Some(policy.id.clone()),
                    remediation: "Increase retention to at least 2190 days (6 years)".into(),
                });
            }
        }

        // HIPAA: regular backup testing
        self.check_verification_recency(entries, verifications, &mut findings, 30, "HIPAA");

        // HIPAA: integrity verification
        for (entry_id, results) in verifications {
            let has_integrity = results.iter().any(|r| {
                r.method == crate::types::VerificationMethod::ChecksumFull
                    && r.status == VerificationStatus::Passed
            });
            if !has_integrity {
                findings.push(ComplianceFinding {
                    severity: FindingSeverity::Medium,
                    category: "Integrity".into(),
                    description: format!(
                        "Entry '{}' lacks a passing full-checksum verification",
                        entry_id
                    ),
                    policy_id: None,
                    remediation: "Run ChecksumFull verification on this entry".into(),
                });
            }
        }

        findings
    }

    /// GDPR: Data-protection, right to erasure support, geographic constraints.
    pub fn check_gdpr_compliance(
        &self,
        policies: &[&BackupPolicy],
        entries: &[&CatalogEntry],
        verifications: &HashMap<String, Vec<VerificationResult>>,
    ) -> Vec<ComplianceFinding> {
        let mut findings = Vec::new();

        // GDPR: encryption is effectively required
        self.check_encryption_findings(policies, &mut findings, "GDPR");

        // GDPR: retention must not be indefinite
        for policy in policies {
            if policy.retention.max_retention_days == 0 || policy.retention.max_retention_days > 3650 {
                findings.push(ComplianceFinding {
                    severity: FindingSeverity::Medium,
                    category: "Retention".into(),
                    description: format!(
                        "Policy '{}' has excessive or indefinite retention ({} days); GDPR data minimisation applies",
                        policy.name, policy.retention.max_retention_days
                    ),
                    policy_id: Some(policy.id.clone()),
                    remediation: "Set a bounded retention period appropriate for the data category".into(),
                });
            }
        }

        // GDPR: must have the ability to delete specific data (right to erasure)
        // Check that immutability does not block erasure indefinitely
        for policy in policies {
            if policy.retention.immutable_period_days > 365 {
                findings.push(ComplianceFinding {
                    severity: FindingSeverity::Medium,
                    category: "Right to Erasure".into(),
                    description: format!(
                        "Policy '{}' immutability ({} days) may conflict with GDPR erasure requests",
                        policy.name, policy.retention.immutable_period_days
                    ),
                    policy_id: Some(policy.id.clone()),
                    remediation: "Review immutability period vs. data-subject erasure obligations".into(),
                });
            }
        }

        findings
    }

    /// PCI-DSS: Card-holder data protection, testing, access.
    pub fn check_pci_compliance(
        &self,
        policies: &[&BackupPolicy],
        entries: &[&CatalogEntry],
        verifications: &HashMap<String, Vec<VerificationResult>>,
    ) -> Vec<ComplianceFinding> {
        let mut findings = Vec::new();

        // PCI-DSS: strong encryption is mandatory
        for policy in policies {
            let weak = policy.encryption.algorithm == crate::types::EncryptionAlgorithm::None;
            if weak {
                findings.push(ComplianceFinding {
                    severity: FindingSeverity::Critical,
                    category: "Encryption".into(),
                    description: format!(
                        "Policy '{}' has no encryption; PCI-DSS requires strong encryption of cardholder data",
                        policy.name
                    ),
                    policy_id: Some(policy.id.clone()),
                    remediation: "Enable AES-256 or ChaCha20 encryption".into(),
                });
            }
        }

        // PCI-DSS: quarterly restore tests
        self.check_verification_recency(entries, verifications, &mut findings, 90, "PCI-DSS");

        // PCI-DSS: 1-year minimum retention
        for policy in policies {
            if policy.retention.max_retention_days < 365 {
                findings.push(ComplianceFinding {
                    severity: FindingSeverity::High,
                    category: "Retention".into(),
                    description: format!(
                        "Policy '{}' retention ({} days) below PCI-DSS 1-year requirement",
                        policy.name, policy.retention.max_retention_days
                    ),
                    policy_id: Some(policy.id.clone()),
                    remediation: "Increase retention to at least 365 days".into(),
                });
            }
        }

        findings
    }

    /// ISO 27001: Information security management best practices.
    pub fn check_iso27001_compliance(
        &self,
        policies: &[&BackupPolicy],
        entries: &[&CatalogEntry],
        verifications: &HashMap<String, Vec<VerificationResult>>,
    ) -> Vec<ComplianceFinding> {
        let mut findings = Vec::new();

        // A.12.3.1 — Information backup
        for policy in policies {
            if !policy.verify_after {
                findings.push(ComplianceFinding {
                    severity: FindingSeverity::Medium,
                    category: "A.12.3.1 Backup Verification".into(),
                    description: format!(
                        "Policy '{}' does not auto-verify after backup",
                        policy.name
                    ),
                    policy_id: Some(policy.id.clone()),
                    remediation: "Enable verify_after on the policy".into(),
                });
            }
        }

        // A.12.3.1 — Regular restore testing
        self.check_verification_recency(entries, verifications, &mut findings, 90, "ISO-27001");

        // Encryption check
        self.check_encryption_findings(policies, &mut findings, "ISO-27001");

        // GFS rotation recommended
        for policy in policies {
            if !policy.retention.gfs_enabled {
                findings.push(ComplianceFinding {
                    severity: FindingSeverity::Low,
                    category: "A.12.3.1 Retention Strategy".into(),
                    description: format!(
                        "Policy '{}' does not use GFS rotation",
                        policy.name
                    ),
                    policy_id: Some(policy.id.clone()),
                    remediation: "Enable GFS rotation for better retention coverage".into(),
                });
            }
        }

        findings
    }

    /// NIST SP 800-34 / 800-53: Contingency planning controls.
    pub fn check_nist_compliance(
        &self,
        policies: &[&BackupPolicy],
        entries: &[&CatalogEntry],
        verifications: &HashMap<String, Vec<VerificationResult>>,
    ) -> Vec<ComplianceFinding> {
        let mut findings = Vec::new();

        // CP-9: Information System Backup
        if policies.is_empty() {
            findings.push(ComplianceFinding {
                severity: FindingSeverity::Critical,
                category: "CP-9 System Backup".into(),
                description: "No backup policies defined".into(),
                policy_id: None,
                remediation: "Create at least one backup policy covering critical systems".into(),
            });
        }

        // CP-9(1): Testing for reliability and integrity
        self.check_verification_recency(entries, verifications, &mut findings, 30, "NIST");

        // CP-10: Information System Recovery
        // Recommend DR testing
        if entries.len() > 10 {
            let verified_count = entries.iter().filter(|e| e.verified).count();
            let pct = (verified_count as f64 / entries.len() as f64) * 100.0;
            if pct < 80.0 {
                findings.push(ComplianceFinding {
                    severity: FindingSeverity::Medium,
                    category: "CP-10 Recovery Verification".into(),
                    description: format!(
                        "Only {:.0}% of catalog entries are verified (target: 80%+)",
                        pct
                    ),
                    policy_id: None,
                    remediation: "Increase verification coverage to at least 80%".into(),
                });
            }
        }

        // SC-28: Protection of Information at Rest
        self.check_encryption_findings(policies, &mut findings, "NIST");

        findings
    }

    /// Custom compliance rules defined by the user.
    fn check_custom_compliance(
        &self,
        policies: &[&BackupPolicy],
        entries: &[&CatalogEntry],
    ) -> Vec<ComplianceFinding> {
        let mut findings = Vec::new();

        for rule in &self.custom_rules {
            // Evaluate simple property-based checks
            match rule.check_type.as_str() {
                "min_retention_days" => {
                    if let Ok(min) = rule.expected_value.parse::<u32>() {
                        for policy in policies {
                            if policy.retention.max_retention_days < min {
                                findings.push(ComplianceFinding {
                                    severity: rule.severity.clone(),
                                    category: "Custom".into(),
                                    description: format!(
                                        "{}: Policy '{}' retention {} < {} required",
                                        rule.name, policy.name,
                                        policy.retention.max_retention_days, min
                                    ),
                                    policy_id: Some(policy.id.clone()),
                                    remediation: rule.description.clone(),
                                });
                            }
                        }
                    }
                }
                "require_encryption" => {
                    if rule.expected_value == "true" {
                        self.check_encryption_findings(policies, &mut findings, "Custom");
                    }
                }
                "require_verification" => {
                    let unverified = entries.iter().filter(|e| !e.verified).count();
                    if unverified > 0 {
                        findings.push(ComplianceFinding {
                            severity: rule.severity.clone(),
                            category: "Custom".into(),
                            description: format!(
                                "{}: {} entries unverified",
                                rule.name, unverified
                            ),
                            policy_id: None,
                            remediation: rule.description.clone(),
                        });
                    }
                }
                _ => {
                    warn!("Unknown custom check_type: {}", rule.check_type);
                }
            }
        }

        findings
    }

    // ── Policy violations ──────────────────────────────────────────────────

    /// Scan policies and entries for violations against a specific framework.
    pub fn get_policy_violations(
        &self,
        framework: &ComplianceFramework,
        policies: &[&BackupPolicy],
        entries: &[&CatalogEntry],
        verifications: &HashMap<String, Vec<VerificationResult>>,
    ) -> Vec<PolicyViolation> {
        let empty_verifications: HashMap<String, Vec<VerificationResult>> = HashMap::new();
        let findings = match framework {
            ComplianceFramework::SOX => self.check_sox_compliance(policies, entries, verifications),
            ComplianceFramework::HIPAA => self.check_hipaa_compliance(policies, entries, verifications),
            ComplianceFramework::GDPR => self.check_gdpr_compliance(policies, entries, verifications),
            ComplianceFramework::PciDss => self.check_pci_compliance(policies, entries, verifications),
            ComplianceFramework::ISO27001 => self.check_iso27001_compliance(policies, entries, verifications),
            ComplianceFramework::NIST => self.check_nist_compliance(policies, entries, verifications),
            ComplianceFramework::Custom => self.check_custom_compliance(policies, entries),
        };

        findings
            .into_iter()
            .filter(|f| f.severity <= FindingSeverity::Medium)
            .map(|f| PolicyViolation {
                policy_id: f.policy_id.clone().unwrap_or_default(),
                policy_name: f.policy_id.as_deref()
                    .and_then(|pid| policies.iter().find(|p| p.id == pid))
                    .map(|p| p.name.clone())
                    .unwrap_or_default(),
                violation: f.description,
                severity: f.severity,
                detected_at: Utc::now(),
                framework: framework.clone(),
            })
            .collect()
    }

    // ── Audit trail ────────────────────────────────────────────────────────

    /// Record an audit event.
    pub fn log_audit_event(
        &mut self,
        actor: &str,
        action: &str,
        resource: &str,
        details: &str,
        framework: Option<ComplianceFramework>,
    ) {
        self.audit_log.push(AuditEvent {
            id: Uuid::new_v4().to_string(),
            timestamp: Utc::now(),
            actor: actor.into(),
            action: action.into(),
            resource: resource.into(),
            details: details.into(),
            framework,
        });
    }

    /// Generate the audit trail for a given time range.
    pub fn generate_audit_trail(
        &self,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> Vec<&AuditEvent> {
        self.audit_log
            .iter()
            .filter(|e| e.timestamp >= from && e.timestamp <= to)
            .collect()
    }

    /// Get all audit events.
    pub fn get_audit_log(&self) -> &[AuditEvent] {
        &self.audit_log
    }

    // ── Custom rules management ────────────────────────────────────────────

    /// Add a custom compliance rule.
    pub fn add_custom_rule(&mut self, rule: CustomComplianceRule) {
        info!("Added custom compliance rule: {}", rule.name);
        self.custom_rules.push(rule);
    }

    /// Remove a custom rule by name.
    pub fn remove_custom_rule(&mut self, name: &str) -> bool {
        let before = self.custom_rules.len();
        self.custom_rules.retain(|r| r.name != name);
        self.custom_rules.len() < before
    }

    /// List all custom rules.
    pub fn list_custom_rules(&self) -> &[CustomComplianceRule] {
        &self.custom_rules
    }

    // ── Report history ─────────────────────────────────────────────────────

    /// Get previously generated reports.
    pub fn get_report_history(&self) -> &[ComplianceReport] {
        &self.report_history
    }

    /// Get reports filtered by framework.
    pub fn get_reports_for_framework(&self, framework: &ComplianceFramework) -> Vec<&ComplianceReport> {
        self.report_history
            .iter()
            .filter(|r| r.framework == *framework)
            .collect()
    }

    // ── Internal helpers ───────────────────────────────────────────────────

    fn check_encryption_findings(
        &self,
        policies: &[&BackupPolicy],
        findings: &mut Vec<ComplianceFinding>,
        framework_label: &str,
    ) {
        for policy in policies {
            if policy.encryption.algorithm == crate::types::EncryptionAlgorithm::None {
                findings.push(ComplianceFinding {
                    severity: FindingSeverity::High,
                    category: "Encryption".into(),
                    description: format!(
                        "Policy '{}' has no encryption configured ({} control)",
                        policy.name, framework_label
                    ),
                    policy_id: Some(policy.id.clone()),
                    remediation: "Enable AES-256 or ChaCha20 encryption".into(),
                });
            }
        }
    }

    fn check_verification_recency(
        &self,
        entries: &[&CatalogEntry],
        verifications: &HashMap<String, Vec<VerificationResult>>,
        findings: &mut Vec<ComplianceFinding>,
        max_age_days: i64,
        framework_label: &str,
    ) {
        let cutoff = Utc::now() - Duration::days(max_age_days);
        let mut stale_count = 0u32;

        for entry in entries {
            let recent_ok = verifications
                .get(&entry.id)
                .map(|results| {
                    results.iter().any(|r| {
                        r.verified_at > cutoff && r.status == VerificationStatus::Passed
                    })
                })
                .unwrap_or(false);

            if !recent_ok {
                stale_count += 1;
            }
        }

        if stale_count > 0 {
            findings.push(ComplianceFinding {
                severity: FindingSeverity::Medium,
                category: "Verification Recency".into(),
                description: format!(
                    "{} entries lack a passing verification within the last {} days ({} control)",
                    stale_count, max_age_days, framework_label
                ),
                policy_id: None,
                remediation: format!(
                    "Run verification on stale entries (threshold: {} days)",
                    max_age_days
                ),
            });
        }
    }

    fn count_compliant_policies(
        &self,
        policies: &[&BackupPolicy],
        findings: &[ComplianceFinding],
    ) -> u32 {
        let mut compliant = 0u32;
        for policy in policies {
            let has_critical = findings.iter().any(|f| {
                f.policy_id.as_deref() == Some(&policy.id)
                    && (f.severity == FindingSeverity::Critical || f.severity == FindingSeverity::High)
            });
            if !has_critical {
                compliant += 1;
            }
        }
        compliant
    }

    fn calculate_score(&self, report: &ComplianceReport) -> f64 {
        if report.policies_evaluated == 0 {
            return 0.0;
        }

        let base = (report.policies_compliant as f64 / report.policies_evaluated as f64) * 100.0;

        // Deductions for findings
        let critical = report.findings.iter().filter(|f| f.severity == FindingSeverity::Critical).count() as f64;
        let high = report.findings.iter().filter(|f| f.severity == FindingSeverity::High).count() as f64;
        let medium = report.findings.iter().filter(|f| f.severity == FindingSeverity::Medium).count() as f64;

        let deductions = critical * 15.0 + high * 8.0 + medium * 3.0;
        (base - deductions).max(0.0).min(100.0)
    }

    fn generate_recommendations(&self, report: &ComplianceReport) -> Vec<String> {
        let mut recs = Vec::new();

        let has_encryption_issue = report.findings.iter().any(|f| f.category == "Encryption");
        let has_retention_issue = report.findings.iter().any(|f| f.category == "Retention");
        let has_verification_issue = report.findings.iter().any(|f| {
            f.category.contains("Verification") || f.category.contains("Integrity")
        });

        if has_encryption_issue {
            recs.push("Enable encryption on all backup policies to protect data at rest".into());
        }
        if has_retention_issue {
            recs.push("Review and extend retention periods to meet framework requirements".into());
        }
        if has_verification_issue {
            recs.push("Implement regular backup verification schedules (at least monthly)".into());
        }
        if report.score_percent < 70.0 {
            recs.push("Overall compliance score is low — prioritise critical and high findings".into());
        }
        if report.findings.is_empty() {
            recs.push("All checks passed — continue monitoring and periodic review".into());
        }

        recs
    }
}

impl Default for ComplianceReporter {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::*;

    fn make_policy(id: &str, name: &str) -> BackupPolicy {
        let mut p = BackupPolicy::new(id.into(), name.into());
        p.targets.push(BackupTarget {
            id: "t1".into(),
            name: "Test".into(),
            target_type: TargetType::FileSystem,
            host: "localhost".into(),
            paths: vec!["/data".into()],
            credentials: None,
            ssh_config: None,
            tags: Vec::new(),
        });
        p
    }

    #[test]
    fn test_sox_missing_encryption() {
        let reporter = ComplianceReporter::new();
        let policy = make_policy("p1", "TestPolicy");
        let findings = reporter.check_sox_compliance(
            &[&policy],
            &[],
            &HashMap::new(),
        );
        assert!(findings.iter().any(|f| f.category == "Encryption"));
    }

    #[test]
    fn test_score_calculation() {
        let reporter = ComplianceReporter::new();
        let mut report = ComplianceReport::new(
            "r1".into(),
            ComplianceFramework::SOX,
            Utc::now() - Duration::days(30),
            Utc::now(),
        );
        report.policies_evaluated = 2;
        report.policies_compliant = 2;
        // No findings → 100%
        let score = reporter.calculate_score(&report);
        assert_eq!(score, 100.0);
    }
}
