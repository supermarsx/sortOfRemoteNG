//! # Types
//!
//! Core domain types for credential lifecycle management.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── Credential Type ─────────────────────────────────────────────────

/// The kind of credential being tracked.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CredentialType {
    Password,
    SshKey,
    SshCertificate,
    TlsCertificate,
    ApiKey,
    Token,
    Passphrase,
    SamlAssertion,
    KerberosTicket,
    OtpSecret,
}

impl std::fmt::Display for CredentialType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Password => write!(f, "Password"),
            Self::SshKey => write!(f, "SSH Key"),
            Self::SshCertificate => write!(f, "SSH Certificate"),
            Self::TlsCertificate => write!(f, "TLS Certificate"),
            Self::ApiKey => write!(f, "API Key"),
            Self::Token => write!(f, "Token"),
            Self::Passphrase => write!(f, "Passphrase"),
            Self::SamlAssertion => write!(f, "SAML Assertion"),
            Self::KerberosTicket => write!(f, "Kerberos Ticket"),
            Self::OtpSecret => write!(f, "OTP Secret"),
        }
    }
}

// ── Password Strength ───────────────────────────────────────────────

/// Estimated strength of a password / passphrase.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PasswordStrength {
    VeryWeak,
    Weak,
    Fair,
    Strong,
    VeryStrong,
}

impl PasswordStrength {
    /// Return a numeric score (0–4) for this strength level.
    pub fn score(&self) -> u8 {
        match self {
            Self::VeryWeak => 0,
            Self::Weak => 1,
            Self::Fair => 2,
            Self::Strong => 3,
            Self::VeryStrong => 4,
        }
    }

    /// Create a `PasswordStrength` from a numeric score, clamping to the valid range.
    pub fn from_score(score: u8) -> Self {
        match score {
            0 => Self::VeryWeak,
            1 => Self::Weak,
            2 => Self::Fair,
            3 => Self::Strong,
            _ => Self::VeryStrong,
        }
    }
}

impl std::fmt::Display for PasswordStrength {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::VeryWeak => write!(f, "Very Weak"),
            Self::Weak => write!(f, "Weak"),
            Self::Fair => write!(f, "Fair"),
            Self::Strong => write!(f, "Strong"),
            Self::VeryStrong => write!(f, "Very Strong"),
        }
    }
}

// ── Credential Record ───────────────────────────────────────────────

/// A tracked credential (never stores the actual secret — only a fingerprint).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialRecord {
    /// Unique identifier for this credential record.
    pub id: String,
    /// The connection this credential belongs to.
    pub connection_id: String,
    /// What kind of credential this is.
    pub credential_type: CredentialType,
    /// Human-readable label.
    pub label: String,
    /// Optional username associated with the credential.
    pub username: Option<String>,
    /// SHA-256 hash of the credential value (never the value itself).
    pub fingerprint: String,
    /// When the credential was first recorded.
    pub created_at: DateTime<Utc>,
    /// When the credential was last rotated.
    pub last_rotated_at: Option<DateTime<Utc>>,
    /// When the credential expires (certificates, tokens, etc.).
    pub expires_at: Option<DateTime<Utc>>,
    /// ID of the rotation policy governing this credential.
    pub rotation_policy_id: Option<String>,
    /// ID of the credential group this belongs to.
    pub group_id: Option<String>,
    /// Estimated strength (passwords / passphrases only).
    pub strength: Option<PasswordStrength>,
    /// Free-form notes.
    pub notes: String,
    /// Arbitrary key-value metadata.
    pub metadata: HashMap<String, String>,
}

// ── Rotation Policy ─────────────────────────────────────────────────

/// A rotation / expiry policy that can be applied to credentials.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RotationPolicy {
    /// Unique identifier.
    pub id: String,
    /// Human-readable policy name.
    pub name: String,
    /// Maximum age in days before the credential is considered stale.
    pub max_age_days: u64,
    /// How many days before expiry to start warning.
    pub warn_before_days: u64,
    /// Require a new value to differ from the previous one.
    pub require_different: bool,
    /// Minimum acceptable password strength.
    pub min_strength: Option<PasswordStrength>,
    /// Which credential types this policy applies to.
    pub applies_to: Vec<CredentialType>,
    /// Automatically generate alerts when violations occur.
    pub auto_notify: bool,
    /// Whether to hard-enforce (reject / flag) or merely warn.
    pub enforce: bool,
}

// ── Credential Group ────────────────────────────────────────────────

/// A logical grouping of related credentials (e.g. same service account across
/// multiple hosts).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialGroup {
    /// Unique identifier.
    pub id: String,
    /// Human-readable name.
    pub name: String,
    /// Optional description.
    pub description: String,
    /// IDs of the credentials in this group.
    pub credential_ids: Vec<String>,
    /// Optional shared rotation policy.
    pub shared_policy_id: Option<String>,
    /// Whether all credentials in the group should be rotated together.
    pub auto_rotate_together: bool,
}

// ── Expiry Status ───────────────────────────────────────────────────

/// Computed expiry status of a credential.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ExpiryStatus {
    Valid,
    ExpiringSoon { days_remaining: u64 },
    Expired { days_overdue: u64 },
    NeverExpires,
    Unknown,
}

// ── Alerts ──────────────────────────────────────────────────────────

/// A generated alert about a credential issue.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialAlert {
    /// Unique identifier.
    pub id: String,
    /// The credential this alert is about.
    pub credential_id: String,
    /// The connection the credential belongs to.
    pub connection_id: String,
    /// The kind of alert.
    pub alert_type: AlertType,
    /// Human-readable alert message.
    pub message: String,
    /// Alert severity.
    pub severity: AlertSeverity,
    /// When the alert was generated.
    pub created_at: DateTime<Utc>,
    /// Whether the alert has been acknowledged.
    pub acknowledged: bool,
    /// When the alert was acknowledged.
    pub acknowledged_at: Option<DateTime<Utc>>,
}

/// The kind of credential alert.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AlertType {
    ExpiringCertificate,
    ExpiredCertificate,
    StalePassword,
    WeakPassword,
    DuplicatePassword,
    ExpiringKey,
    RotationOverdue,
    PolicyViolation,
}

impl std::fmt::Display for AlertType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ExpiringCertificate => write!(f, "Expiring Certificate"),
            Self::ExpiredCertificate => write!(f, "Expired Certificate"),
            Self::StalePassword => write!(f, "Stale Password"),
            Self::WeakPassword => write!(f, "Weak Password"),
            Self::DuplicatePassword => write!(f, "Duplicate Password"),
            Self::ExpiringKey => write!(f, "Expiring Key"),
            Self::RotationOverdue => write!(f, "Rotation Overdue"),
            Self::PolicyViolation => write!(f, "Policy Violation"),
        }
    }
}

/// Alert severity level.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AlertSeverity {
    Info,
    Warning,
    Critical,
}

impl std::fmt::Display for AlertSeverity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Info => write!(f, "Info"),
            Self::Warning => write!(f, "Warning"),
            Self::Critical => write!(f, "Critical"),
        }
    }
}

// ── Audit ───────────────────────────────────────────────────────────

/// A single audit log entry recording a credential lifecycle event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialAuditEntry {
    /// Unique identifier.
    pub id: String,
    /// The credential this event pertains to.
    pub credential_id: String,
    /// What happened.
    pub action: AuditAction,
    /// When it happened.
    pub timestamp: DateTime<Utc>,
    /// Free-form details.
    pub details: String,
    /// Who performed the action.
    pub user: String,
}

/// Credential lifecycle audit actions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuditAction {
    Created,
    Rotated,
    Expired,
    Renewed,
    Deleted,
    PolicyChanged,
    StrengthChecked,
    GroupChanged,
    AlertAcknowledged,
}

impl std::fmt::Display for AuditAction {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Created => write!(f, "Created"),
            Self::Rotated => write!(f, "Rotated"),
            Self::Expired => write!(f, "Expired"),
            Self::Renewed => write!(f, "Renewed"),
            Self::Deleted => write!(f, "Deleted"),
            Self::PolicyChanged => write!(f, "Policy Changed"),
            Self::StrengthChecked => write!(f, "Strength Checked"),
            Self::GroupChanged => write!(f, "Group Changed"),
            Self::AlertAcknowledged => write!(f, "Alert Acknowledged"),
        }
    }
}

// ── Statistics ───────────────────────────────────────────────────────

/// Aggregate statistics about all tracked credentials.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialStats {
    /// Total number of tracked credentials.
    pub total_credentials: usize,
    /// Count of credentials by type.
    pub by_type: HashMap<String, usize>,
    /// Number of credentials that have expired.
    pub expired_count: usize,
    /// Number of credentials expiring within the next 30 days.
    pub expiring_soon_count: usize,
    /// Number of credentials older than their policy's max age.
    pub stale_count: usize,
    /// Number of credentials with weak or very-weak strength.
    pub weak_count: usize,
    /// Number of credentials sharing a fingerprint with at least one other.
    pub duplicate_count: usize,
    /// Average age (in days) of all tracked credentials.
    pub avg_age_days: f64,
    /// Age (in days) of the oldest tracked credential.
    pub oldest_credential_days: u64,
}

// ── Configuration ───────────────────────────────────────────────────

/// Global configuration for the credential-tracking subsystem.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialsConfig {
    /// How often (in seconds) to run automated expiry checks.
    pub check_interval_seconds: u64,
    /// Default maximum password age in days when no policy is assigned.
    pub default_max_age_days: u64,
    /// Default number of days before expiry to start warning.
    pub default_warn_before_days: u64,
    /// Whether to detect credentials with the same fingerprint.
    pub duplicate_detection: bool,
    /// Whether to estimate password strength on ingestion / rotation.
    pub strength_checking: bool,
    /// Whether to automatically generate alerts during periodic checks.
    pub auto_alerts: bool,
}

impl Default for CredentialsConfig {
    fn default() -> Self {
        Self {
            check_interval_seconds: 3600,
            default_max_age_days: 90,
            default_warn_before_days: 14,
            duplicate_detection: true,
            strength_checking: true,
            auto_alerts: true,
        }
    }
}
