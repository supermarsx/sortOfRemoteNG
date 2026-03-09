use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Target Types ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TargetType {
    FileSystem,
    Database,
    VirtualMachine,
    Container,
    Application,
    CloudBucket,
    NasShare,
    MailServer,
    LdapDirectory,
}

impl std::fmt::Display for TargetType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::FileSystem => write!(f, "FileSystem"),
            Self::Database => write!(f, "Database"),
            Self::VirtualMachine => write!(f, "VirtualMachine"),
            Self::Container => write!(f, "Container"),
            Self::Application => write!(f, "Application"),
            Self::CloudBucket => write!(f, "CloudBucket"),
            Self::NasShare => write!(f, "NasShare"),
            Self::MailServer => write!(f, "MailServer"),
            Self::LdapDirectory => write!(f, "LdapDirectory"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub key_path: Option<String>,
    pub known_hosts_check: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupTarget {
    pub id: String,
    pub name: String,
    pub target_type: TargetType,
    pub host: String,
    pub paths: Vec<String>,
    pub credentials: Option<String>,
    pub ssh_config: Option<SshConfig>,
    pub tags: Vec<String>,
}

// ─── Backup Method ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum BackupMethod {
    Full,
    Incremental,
    Differential,
    Synthetic,
    ContinuousReplication,
    Snapshot,
    Mirror,
}

impl std::fmt::Display for BackupMethod {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Full => write!(f, "Full"),
            Self::Incremental => write!(f, "Incremental"),
            Self::Differential => write!(f, "Differential"),
            Self::Synthetic => write!(f, "Synthetic"),
            Self::ContinuousReplication => write!(f, "ContinuousReplication"),
            Self::Snapshot => write!(f, "Snapshot"),
            Self::Mirror => write!(f, "Mirror"),
        }
    }
}

// ─── Compression ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum CompressionAlgorithm {
    None,
    Gzip,
    Zstd,
    Lz4,
    Bzip2,
    Xz,
}

impl std::fmt::Display for CompressionAlgorithm {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::None => write!(f, "None"),
            Self::Gzip => write!(f, "gzip"),
            Self::Zstd => write!(f, "zstd"),
            Self::Lz4 => write!(f, "lz4"),
            Self::Bzip2 => write!(f, "bzip2"),
            Self::Xz => write!(f, "xz"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompressionConfig {
    pub algorithm: CompressionAlgorithm,
    pub level: u8,
}

impl Default for CompressionConfig {
    fn default() -> Self {
        Self {
            algorithm: CompressionAlgorithm::Zstd,
            level: 3,
        }
    }
}

// ─── Encryption ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum EncryptionAlgorithm {
    None,
    AES256,
    ChaCha20,
    AES128GCM,
}

impl std::fmt::Display for EncryptionAlgorithm {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::None => write!(f, "None"),
            Self::AES256 => write!(f, "AES-256"),
            Self::ChaCha20 => write!(f, "ChaCha20"),
            Self::AES128GCM => write!(f, "AES-128-GCM"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptionConfig {
    pub algorithm: EncryptionAlgorithm,
    pub key_id: Option<String>,
    pub passphrase_hint: Option<String>,
}

impl Default for EncryptionConfig {
    fn default() -> Self {
        Self {
            algorithm: EncryptionAlgorithm::None,
            key_id: None,
            passphrase_hint: None,
        }
    }
}

// ─── Schedule ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlackoutPeriod {
    pub start_time: String,
    pub end_time: String,
    pub days_of_week: Vec<u8>,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupSchedule {
    pub cron_expression: String,
    pub timezone: String,
    pub start_window_minutes: u32,
    pub blackout_periods: Vec<BlackoutPeriod>,
    pub retry_count: u32,
    pub retry_delay_secs: u64,
}

impl Default for BackupSchedule {
    fn default() -> Self {
        Self {
            cron_expression: "0 2 * * *".to_string(),
            timezone: "UTC".to_string(),
            start_window_minutes: 60,
            blackout_periods: Vec::new(),
            retry_count: 3,
            retry_delay_secs: 300,
        }
    }
}

// ─── Retention ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetentionPolicy {
    pub daily_count: u32,
    pub weekly_count: u32,
    pub monthly_count: u32,
    pub yearly_count: u32,
    pub min_retention_days: u32,
    pub max_retention_days: u32,
    pub gfs_enabled: bool,
    pub immutable_period_days: u32,
}

impl Default for RetentionPolicy {
    fn default() -> Self {
        Self {
            daily_count: 7,
            weekly_count: 4,
            monthly_count: 12,
            yearly_count: 3,
            min_retention_days: 30,
            max_retention_days: 1095,
            gfs_enabled: true,
            immutable_period_days: 0,
        }
    }
}

// ─── Notification Types ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum NotifyChannel {
    Email,
    Webhook,
    Syslog,
    Snmp,
    Tauri,
}

impl std::fmt::Display for NotifyChannel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Email => write!(f, "Email"),
            Self::Webhook => write!(f, "Webhook"),
            Self::Syslog => write!(f, "Syslog"),
            Self::Snmp => write!(f, "SNMP"),
            Self::Tauri => write!(f, "Tauri"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum NotifyEvent {
    JobStarted,
    JobCompleted,
    JobFailed,
    VerificationFailed,
    RetentionApplied,
    DrTestResult,
    ComplianceAlert,
    ReplicationLag,
    StorageThreshold,
}

impl std::fmt::Display for NotifyEvent {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::JobStarted => write!(f, "JobStarted"),
            Self::JobCompleted => write!(f, "JobCompleted"),
            Self::JobFailed => write!(f, "JobFailed"),
            Self::VerificationFailed => write!(f, "VerificationFailed"),
            Self::RetentionApplied => write!(f, "RetentionApplied"),
            Self::DrTestResult => write!(f, "DrTestResult"),
            Self::ComplianceAlert => write!(f, "ComplianceAlert"),
            Self::ReplicationLag => write!(f, "ReplicationLag"),
            Self::StorageThreshold => write!(f, "StorageThreshold"),
        }
    }
}

// ─── Backup Policy ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupPolicy {
    pub id: String,
    pub name: String,
    pub targets: Vec<BackupTarget>,
    pub schedule: BackupSchedule,
    pub retention: RetentionPolicy,
    pub method: BackupMethod,
    pub compression: CompressionConfig,
    pub encryption: EncryptionConfig,
    pub pre_scripts: Vec<String>,
    pub post_scripts: Vec<String>,
    pub verify_after: bool,
    pub notify_on: Vec<NotifyEvent>,
    pub max_parallel: u32,
    pub bandwidth_limit: Option<u64>,
    pub priority: u32,
    pub enabled: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl BackupPolicy {
    pub fn new(id: String, name: String) -> Self {
        let now = Utc::now();
        Self {
            id,
            name,
            targets: Vec::new(),
            schedule: BackupSchedule::default(),
            retention: RetentionPolicy::default(),
            method: BackupMethod::Full,
            compression: CompressionConfig::default(),
            encryption: EncryptionConfig::default(),
            pre_scripts: Vec::new(),
            post_scripts: Vec::new(),
            verify_after: true,
            notify_on: vec![NotifyEvent::JobFailed, NotifyEvent::VerificationFailed],
            max_parallel: 1,
            bandwidth_limit: None,
            priority: 5,
            enabled: true,
            created_at: now,
            updated_at: now,
        }
    }
}

// ─── Backup Job ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum BackupJobState {
    Queued,
    Running,
    Verifying,
    Completed,
    Failed,
    Cancelled,
    PartiallyCompleted,
}

impl std::fmt::Display for BackupJobState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Queued => write!(f, "Queued"),
            Self::Running => write!(f, "Running"),
            Self::Verifying => write!(f, "Verifying"),
            Self::Completed => write!(f, "Completed"),
            Self::Failed => write!(f, "Failed"),
            Self::Cancelled => write!(f, "Cancelled"),
            Self::PartiallyCompleted => write!(f, "PartiallyCompleted"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupJob {
    pub id: String,
    pub policy_id: String,
    pub state: BackupJobState,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub duration_secs: Option<u64>,
    pub size_bytes: u64,
    pub files_count: u64,
    pub error_message: Option<String>,
    pub verification_result: Option<VerificationResult>,
    pub transfer_speed_bps: u64,
    pub source_snapshot: Option<String>,
    pub target_location: String,
}

impl BackupJob {
    pub fn new(id: String, policy_id: String, target_location: String) -> Self {
        Self {
            id,
            policy_id,
            state: BackupJobState::Queued,
            started_at: None,
            completed_at: None,
            duration_secs: None,
            size_bytes: 0,
            files_count: 0,
            error_message: None,
            verification_result: None,
            transfer_speed_bps: 0,
            source_snapshot: None,
            target_location,
        }
    }
}

// ─── Verification ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum VerificationMethod {
    ChecksumFull,
    ChecksumSampled,
    MetadataOnly,
    RestoreTest,
    ContentDiff,
    MountAndScan,
}

impl std::fmt::Display for VerificationMethod {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ChecksumFull => write!(f, "ChecksumFull"),
            Self::ChecksumSampled => write!(f, "ChecksumSampled"),
            Self::MetadataOnly => write!(f, "MetadataOnly"),
            Self::RestoreTest => write!(f, "RestoreTest"),
            Self::ContentDiff => write!(f, "ContentDiff"),
            Self::MountAndScan => write!(f, "MountAndScan"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum VerificationStatus {
    Passed,
    Failed,
    Warning,
    Skipped,
    InProgress,
}

impl std::fmt::Display for VerificationStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Passed => write!(f, "Passed"),
            Self::Failed => write!(f, "Failed"),
            Self::Warning => write!(f, "Warning"),
            Self::Skipped => write!(f, "Skipped"),
            Self::InProgress => write!(f, "InProgress"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationResult {
    pub verified_at: DateTime<Utc>,
    pub method: VerificationMethod,
    pub status: VerificationStatus,
    pub files_checked: u64,
    pub files_ok: u64,
    pub files_corrupted: u64,
    pub files_missing: u64,
    pub checksum_errors: u64,
    pub metadata_errors: u64,
    pub details: Vec<String>,
}

impl VerificationResult {
    pub fn new(method: VerificationMethod) -> Self {
        Self {
            verified_at: Utc::now(),
            method,
            status: VerificationStatus::InProgress,
            files_checked: 0,
            files_ok: 0,
            files_corrupted: 0,
            files_missing: 0,
            checksum_errors: 0,
            metadata_errors: 0,
            details: Vec::new(),
        }
    }

    pub fn passed(method: VerificationMethod, files_checked: u64) -> Self {
        Self {
            verified_at: Utc::now(),
            method,
            status: VerificationStatus::Passed,
            files_checked,
            files_ok: files_checked,
            files_corrupted: 0,
            files_missing: 0,
            checksum_errors: 0,
            metadata_errors: 0,
            details: vec!["All checks passed".to_string()],
        }
    }
}

// ─── Catalog ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogEntry {
    pub id: String,
    pub job_id: String,
    pub policy_id: String,
    pub target_id: String,
    pub backup_type: BackupMethod,
    pub timestamp: DateTime<Utc>,
    pub size_bytes: u64,
    pub file_count: u64,
    pub location: String,
    pub checksum: String,
    pub retention_until: DateTime<Utc>,
    pub verified: bool,
    pub verification_result: Option<VerificationResult>,
    pub tags: Vec<String>,
    pub metadata: HashMap<String, String>,
}

impl CatalogEntry {
    pub fn new(
        id: String,
        job_id: String,
        policy_id: String,
        target_id: String,
        backup_type: BackupMethod,
        location: String,
        retention_until: DateTime<Utc>,
    ) -> Self {
        Self {
            id,
            job_id,
            policy_id,
            target_id,
            backup_type,
            timestamp: Utc::now(),
            size_bytes: 0,
            file_count: 0,
            location,
            checksum: String::new(),
            retention_until,
            verified: false,
            verification_result: None,
            tags: Vec::new(),
            metadata: HashMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CatalogFilter {
    pub policy_id: Option<String>,
    pub target_id: Option<String>,
    pub backup_type: Option<BackupMethod>,
    pub from_date: Option<DateTime<Utc>>,
    pub to_date: Option<DateTime<Utc>>,
    pub verified_only: bool,
    pub tags: Vec<String>,
    pub min_size_bytes: Option<u64>,
    pub max_size_bytes: Option<u64>,
}

// ─── Disaster Recovery ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum DrTestType {
    RestoreVerify,
    BootTest,
    ApplicationTest,
    NetworkTest,
    FullDrDrill,
}

impl std::fmt::Display for DrTestType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::RestoreVerify => write!(f, "RestoreVerify"),
            Self::BootTest => write!(f, "BootTest"),
            Self::ApplicationTest => write!(f, "ApplicationTest"),
            Self::NetworkTest => write!(f, "NetworkTest"),
            Self::FullDrDrill => write!(f, "FullDrDrill"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrTest {
    pub id: String,
    pub name: String,
    pub policy_ids: Vec<String>,
    pub test_type: DrTestType,
    pub schedule: Option<String>,
    pub last_run: Option<DateTime<Utc>>,
    pub last_result: Option<DrTestResult>,
    pub timeout_secs: u64,
}

impl DrTest {
    pub fn new(id: String, name: String, test_type: DrTestType, policy_ids: Vec<String>) -> Self {
        Self {
            id,
            name,
            policy_ids,
            test_type,
            schedule: None,
            last_run: None,
            last_result: None,
            timeout_secs: 3600,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrTestResult {
    pub test_id: String,
    pub executed_at: DateTime<Utc>,
    pub duration_secs: u64,
    pub status: VerificationStatus,
    pub rto_actual_secs: u64,
    pub rpo_actual_secs: u64,
    pub steps_completed: u32,
    pub steps_total: u32,
    pub details: Vec<String>,
    pub artifacts: Vec<String>,
}

impl DrTestResult {
    pub fn new(test_id: String, steps_total: u32) -> Self {
        Self {
            test_id,
            executed_at: Utc::now(),
            duration_secs: 0,
            status: VerificationStatus::InProgress,
            rto_actual_secs: 0,
            rpo_actual_secs: 0,
            steps_completed: 0,
            steps_total,
            details: Vec::new(),
            artifacts: Vec::new(),
        }
    }
}

// ─── Compliance ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ComplianceFramework {
    SOX,
    HIPAA,
    GDPR,
    #[serde(rename = "PCI_DSS")]
    PciDss,
    ISO27001,
    NIST,
    Custom,
}

impl std::fmt::Display for ComplianceFramework {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::SOX => write!(f, "SOX"),
            Self::HIPAA => write!(f, "HIPAA"),
            Self::GDPR => write!(f, "GDPR"),
            Self::PciDss => write!(f, "PCI-DSS"),
            Self::ISO27001 => write!(f, "ISO 27001"),
            Self::NIST => write!(f, "NIST"),
            Self::Custom => write!(f, "Custom"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
pub enum FindingSeverity {
    Critical,
    High,
    Medium,
    Low,
    Info,
}

impl std::fmt::Display for FindingSeverity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Critical => write!(f, "Critical"),
            Self::High => write!(f, "High"),
            Self::Medium => write!(f, "Medium"),
            Self::Low => write!(f, "Low"),
            Self::Info => write!(f, "Info"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComplianceFinding {
    pub severity: FindingSeverity,
    pub category: String,
    pub description: String,
    pub policy_id: Option<String>,
    pub remediation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComplianceReport {
    pub id: String,
    pub generated_at: DateTime<Utc>,
    pub framework: ComplianceFramework,
    pub period_start: DateTime<Utc>,
    pub period_end: DateTime<Utc>,
    pub policies_evaluated: u32,
    pub policies_compliant: u32,
    pub findings: Vec<ComplianceFinding>,
    pub score_percent: f64,
    pub recommendations: Vec<String>,
}

impl ComplianceReport {
    pub fn new(
        id: String,
        framework: ComplianceFramework,
        period_start: DateTime<Utc>,
        period_end: DateTime<Utc>,
    ) -> Self {
        Self {
            id,
            generated_at: Utc::now(),
            framework,
            period_start,
            period_end,
            policies_evaluated: 0,
            policies_compliant: 0,
            findings: Vec::new(),
            score_percent: 0.0,
            recommendations: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomComplianceRule {
    pub name: String,
    pub description: String,
    pub check_type: String,
    pub expected_value: String,
    pub severity: FindingSeverity,
}

// ─── Replication ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ReplicationState {
    InSync,
    Syncing,
    Lagging,
    Error,
    Paused,
    Initial,
}

impl std::fmt::Display for ReplicationState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InSync => write!(f, "InSync"),
            Self::Syncing => write!(f, "Syncing"),
            Self::Lagging => write!(f, "Lagging"),
            Self::Error => write!(f, "Error"),
            Self::Paused => write!(f, "Paused"),
            Self::Initial => write!(f, "Initial"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplicationTarget {
    pub id: String,
    pub name: String,
    pub site_name: String,
    pub host: String,
    pub protocol: String,
    pub path: String,
    pub bandwidth_limit: Option<u64>,
    pub sync_interval_secs: u64,
    pub compression: CompressionConfig,
    pub encryption: EncryptionConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplicationStatus {
    pub target_id: String,
    pub state: ReplicationState,
    pub last_sync: Option<DateTime<Utc>>,
    pub lag_bytes: u64,
    pub lag_secs: u64,
    pub transfer_speed_bps: u64,
    pub error_message: Option<String>,
}

impl ReplicationStatus {
    pub fn new(target_id: String) -> Self {
        Self {
            target_id,
            state: ReplicationState::Initial,
            last_sync: None,
            lag_bytes: 0,
            lag_secs: 0,
            transfer_speed_bps: 0,
            error_message: None,
        }
    }
}

// ─── Notifications ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupNotification {
    pub event: NotifyEvent,
    pub severity: FindingSeverity,
    pub message: String,
    pub timestamp: DateTime<Utc>,
    pub policy_id: Option<String>,
    pub job_id: Option<String>,
    pub channels: Vec<NotifyChannel>,
}

impl BackupNotification {
    pub fn new(event: NotifyEvent, severity: FindingSeverity, message: String) -> Self {
        Self {
            event,
            severity,
            message,
            timestamp: Utc::now(),
            policy_id: None,
            job_id: None,
            channels: vec![NotifyChannel::Tauri],
        }
    }
}

// ─── Overview ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BackupOverview {
    pub total_policies: u32,
    pub active_policies: u32,
    pub total_catalog_entries: u64,
    pub total_size_bytes: u64,
    pub last_backup_at: Option<DateTime<Utc>>,
    pub next_backup_at: Option<DateTime<Utc>>,
    pub failed_last_24h: u32,
    pub verified_last_24h: u32,
    pub storage_used_bytes: u64,
    pub storage_available_bytes: u64,
    pub compliance_score: Option<f64>,
}

// ─── SMTP Config ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmtpConfig {
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
    pub use_tls: bool,
    pub from_address: String,
}

// ─── Notification Channel Config ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelConfig {
    pub policy_id: String,
    pub channels: Vec<NotifyChannel>,
    pub email_recipients: Vec<String>,
    pub webhook_urls: Vec<String>,
    pub syslog_target: Option<String>,
    pub snmp_target: Option<String>,
    pub events: Vec<NotifyEvent>,
}

impl ChannelConfig {
    pub fn new(policy_id: String) -> Self {
        Self {
            policy_id,
            channels: vec![NotifyChannel::Tauri],
            email_recipients: Vec::new(),
            webhook_urls: Vec::new(),
            syslog_target: None,
            snmp_target: None,
            events: vec![NotifyEvent::JobFailed, NotifyEvent::VerificationFailed],
        }
    }
}

// ─── Integrity Structures ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub checksum: String,
    pub size: u64,
    pub mtime: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileManifest {
    pub entries: HashMap<String, FileEntry>,
    pub generated_at: DateTime<Utc>,
    pub algorithm: String,
}

impl FileManifest {
    pub fn new(algorithm: &str) -> Self {
        Self {
            entries: HashMap::new(),
            generated_at: Utc::now(),
            algorithm: algorithm.to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestDiff {
    pub added: Vec<String>,
    pub removed: Vec<String>,
    pub modified: Vec<String>,
    pub unchanged_count: u64,
}

impl ManifestDiff {
    pub fn new() -> Self {
        Self {
            added: Vec::new(),
            removed: Vec::new(),
            modified: Vec::new(),
            unchanged_count: 0,
        }
    }
}

impl Default for ManifestDiff {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntegrityResult {
    pub entry_id: String,
    pub checked_at: DateTime<Utc>,
    pub status: VerificationStatus,
    pub files_checked: u64,
    pub errors: Vec<String>,
}

impl IntegrityResult {
    pub fn new(entry_id: String) -> Self {
        Self {
            entry_id,
            checked_at: Utc::now(),
            status: VerificationStatus::InProgress,
            files_checked: 0,
            errors: Vec::new(),
        }
    }
}

// ─── Policy Status ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyStatus {
    pub policy_id: String,
    pub last_run: Option<DateTime<Utc>>,
    pub last_status: Option<BackupJobState>,
    pub next_run: Option<DateTime<Utc>>,
    pub total_jobs: u64,
    pub successful_jobs: u64,
    pub failed_jobs: u64,
    pub total_size_bytes: u64,
    pub health: PolicyHealth,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum PolicyHealth {
    Healthy,
    Warning,
    Critical,
    Unknown,
}

impl std::fmt::Display for PolicyHealth {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Healthy => write!(f, "Healthy"),
            Self::Warning => write!(f, "Warning"),
            Self::Critical => write!(f, "Critical"),
            Self::Unknown => write!(f, "Unknown"),
        }
    }
}

// ─── Prune List ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PruneList {
    pub entries_to_remove: Vec<String>,
    pub entries_to_keep: Vec<String>,
    pub storage_savings_bytes: u64,
    pub reason: HashMap<String, String>,
}

impl PruneList {
    pub fn new() -> Self {
        Self {
            entries_to_remove: Vec::new(),
            entries_to_keep: Vec::new(),
            storage_savings_bytes: 0,
            reason: HashMap::new(),
        }
    }
}

impl Default for PruneList {
    fn default() -> Self {
        Self::new()
    }
}
