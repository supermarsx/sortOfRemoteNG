//! Data types, enums, tool configs, and job definitions for remote backup.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Backup Tool ────────────────────────────────────────────────────

/// Supported backup / sync tools.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BackupTool {
    Rsync,
    Rclone,
    Restic,
    Borg,
    Sftp,
    Scp,
    Unison,
    Duplicity,
}

impl std::fmt::Display for BackupTool {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Rsync => write!(f, "rsync"),
            Self::Rclone => write!(f, "rclone"),
            Self::Restic => write!(f, "restic"),
            Self::Borg => write!(f, "borg"),
            Self::Sftp => write!(f, "sftp"),
            Self::Scp => write!(f, "scp"),
            Self::Unison => write!(f, "unison"),
            Self::Duplicity => write!(f, "duplicity"),
        }
    }
}

// ─── SSH Transport Config ───────────────────────────────────────────

/// SSH connection info used as transport for backup tools.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshTransportConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub private_key_passphrase: Option<String>,
    /// SSH options passed via -o (e.g. StrictHostKeyChecking=no)
    #[serde(default)]
    pub ssh_options: HashMap<String, String>,
    /// Path to custom SSH binary
    pub ssh_binary: Option<String>,
    /// Connection timeout in seconds
    pub connect_timeout: Option<u64>,
    /// Use SSH agent forwarding
    #[serde(default)]
    pub agent_forwarding: bool,
    /// Use compression over SSH
    #[serde(default)]
    pub compression: bool,
    /// Jump hosts for multi-hop
    #[serde(default)]
    pub jump_hosts: Vec<JumpHost>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JumpHost {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub private_key_path: Option<String>,
}

impl SshTransportConfig {
    /// Build the SSH command-line fragment for use with rsync/rclone/etc.
    pub fn to_ssh_command(&self) -> String {
        let mut parts = Vec::new();
        let ssh = self.ssh_binary.as_deref().unwrap_or("ssh");
        parts.push(ssh.to_string());
        parts.push(format!("-p {}", self.port));

        if let Some(key) = &self.private_key_path {
            parts.push(format!("-i {}", key));
        }
        if self.compression {
            parts.push("-C".to_string());
        }
        if self.agent_forwarding {
            parts.push("-A".to_string());
        }
        if let Some(timeout) = self.connect_timeout {
            parts.push(format!("-o ConnectTimeout={}", timeout));
        }
        for (k, v) in &self.ssh_options {
            parts.push(format!("-o {}={}", k, v));
        }
        if !self.jump_hosts.is_empty() {
            let jumps: Vec<String> = self
                .jump_hosts
                .iter()
                .map(|j| {
                    if let Some(key) = &j.private_key_path {
                        format!("-i {} {}@{}:{}", key, j.username, j.host, j.port)
                    } else {
                        format!("{}@{}:{}", j.username, j.host, j.port)
                    }
                })
                .collect();
            parts.push(format!("-J {}", jumps.join(",")));
        }
        parts.join(" ")
    }
}

// ─── Bandwidth Limit ────────────────────────────────────────────────

/// Bandwidth throttle configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BandwidthLimit {
    /// Limit in KiB/s (0 = unlimited)
    pub rate_kbps: u64,
    /// Time-based scheduling: only apply limit during these hours (HH:MM)
    pub schedule_start: Option<String>,
    pub schedule_end: Option<String>,
}

// ─── Rsync Config ───────────────────────────────────────────────────

/// Configuration for an rsync-based backup job.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RsyncConfig {
    /// Source path(s) — local or remote (user@host:path)
    pub sources: Vec<String>,
    /// Destination path — local or remote
    pub destination: String,
    /// SSH transport when remote
    pub ssh: Option<SshTransportConfig>,
    /// Delete extraneous files from destination
    #[serde(default)]
    pub delete: bool,
    /// Delete before transfer instead of after
    #[serde(default)]
    pub delete_before: bool,
    /// Exclude patterns
    #[serde(default)]
    pub exclude: Vec<String>,
    /// Include patterns (overrides exclude)
    #[serde(default)]
    pub include: Vec<String>,
    /// Filter rules (rsync filter syntax)
    #[serde(default)]
    pub filters: Vec<String>,
    /// Preserve hard links
    #[serde(default)]
    pub hard_links: bool,
    /// Preserve ACLs
    #[serde(default)]
    pub acls: bool,
    /// Preserve xattrs
    #[serde(default)]
    pub xattrs: bool,
    /// Compress during transfer
    #[serde(default = "default_true")]
    pub compress: bool,
    /// Skip based on checksum instead of mod-time & size
    #[serde(default)]
    pub checksum: bool,
    /// Partial transfers (resume broken transfers)
    #[serde(default = "default_true")]
    pub partial: bool,
    /// Show progress during transfer
    #[serde(default = "default_true")]
    pub progress: bool,
    /// Use --archive mode (-rlptgoD)
    #[serde(default = "default_true")]
    pub archive: bool,
    /// Bandwidth limit
    pub bandwidth_limit: Option<BandwidthLimit>,
    /// Max delete count (--max-delete)
    pub max_delete: Option<u64>,
    /// Dry run mode
    #[serde(default)]
    pub dry_run: bool,
    /// Additional rsync flags
    #[serde(default)]
    pub extra_args: Vec<String>,
    /// Rsync binary path
    pub rsync_binary: Option<String>,
    /// Use --link-dest for incremental backups
    pub link_dest: Option<String>,
    /// Backup directory for --backup
    pub backup_dir: Option<String>,
    /// File with list of files to transfer (--files-from)
    pub files_from: Option<String>,
    /// Numeric IDs instead of names
    #[serde(default)]
    pub numeric_ids: bool,
    /// Block size for delta-transfer algorithm
    pub block_size: Option<u32>,
    /// Timeout for I/O operations (seconds)
    pub io_timeout: Option<u64>,
}

// ─── Rclone Config ──────────────────────────────────────────────────

/// Rclone remote backend type.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RcloneBackend {
    Sftp,
    S3,
    Gcs,
    AzureBlob,
    B2,
    Dropbox,
    GoogleDrive,
    OneDrive,
    Ftp,
    WebDav,
    Swift,
    Mega,
    Local,
    Crypt,
    Union,
    Custom(String),
}

/// Rclone sync operation type.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RcloneSyncMode {
    Sync,
    Copy,
    Move,
    Check,
    Bisync,
    Dedupe,
}

/// Configuration for an rclone-based backup job.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RcloneConfig {
    /// Source (remote:path or local path)
    pub source: String,
    /// Destination (remote:path or local path)
    pub destination: String,
    /// Sync operation type
    pub mode: RcloneSyncMode,
    /// Named remote configurations (from rclone config)
    #[serde(default)]
    pub remotes: HashMap<String, RcloneRemoteConfig>,
    /// SSH transport for SFTP remotes
    pub ssh: Option<SshTransportConfig>,
    /// Exclude patterns
    #[serde(default)]
    pub exclude: Vec<String>,
    /// Include patterns
    #[serde(default)]
    pub include: Vec<String>,
    /// Filter rules (rclone filter syntax)
    #[serde(default)]
    pub filter_rules: Vec<String>,
    /// Bandwidth limit
    pub bandwidth_limit: Option<BandwidthLimit>,
    /// Number of parallel transfers
    pub transfers: Option<u32>,
    /// Number of checker threads
    pub checkers: Option<u32>,
    /// Min/max file age filters
    pub min_age: Option<String>,
    pub max_age: Option<String>,
    /// Min/max file size filters
    pub min_size: Option<String>,
    pub max_size: Option<String>,
    /// Dry run
    #[serde(default)]
    pub dry_run: bool,
    /// Additional rclone flags
    #[serde(default)]
    pub extra_args: Vec<String>,
    /// Rclone binary path
    pub rclone_binary: Option<String>,
    /// Delete empty directories after transfer
    #[serde(default)]
    pub delete_empty_dirs: bool,
    /// Track renames (requires hash support)
    #[serde(default)]
    pub track_renames: bool,
    /// Verbose level (0-2)
    pub verbose: Option<u8>,
}

/// Rclone remote configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RcloneRemoteConfig {
    pub remote_type: RcloneBackend,
    pub params: HashMap<String, String>,
}

// ─── Restic Config ──────────────────────────────────────────────────

/// Configuration for a restic-based backup job.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResticConfig {
    /// Repository URL (local, sftp, s3, rest, etc.)
    pub repository: String,
    /// Repository password
    pub password: Option<String>,
    /// Path to password file
    pub password_file: Option<String>,
    /// SSH transport for sftp repos
    pub ssh: Option<SshTransportConfig>,
    /// Paths to back up
    pub paths: Vec<String>,
    /// Exclude patterns
    #[serde(default)]
    pub exclude: Vec<String>,
    /// Exclude files listed in this file
    pub exclude_file: Option<String>,
    /// Tags for this snapshot
    #[serde(default)]
    pub tags: Vec<String>,
    /// Host name override
    pub hostname: Option<String>,
    /// Compression mode (auto, off, max)
    pub compression: Option<String>,
    /// Pack size in MiB
    pub pack_size: Option<u32>,
    /// Read concurrency
    pub read_concurrency: Option<u32>,
    /// Bandwidth limit (KiB/s)
    pub bandwidth_limit_kbps: Option<u64>,
    /// Verbose level (0-3)
    pub verbose: Option<u8>,
    /// Dry run
    #[serde(default)]
    pub dry_run: bool,
    /// Restic binary path
    pub restic_binary: Option<String>,
    /// Extra flags
    #[serde(default)]
    pub extra_args: Vec<String>,
    /// Retention policy for `restic forget`
    pub retention: Option<ResticRetention>,
    /// Cache directory
    pub cache_dir: Option<String>,
}

/// Restic retention policy (maps to `restic forget` flags).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResticRetention {
    pub keep_last: Option<u32>,
    pub keep_hourly: Option<u32>,
    pub keep_daily: Option<u32>,
    pub keep_weekly: Option<u32>,
    pub keep_monthly: Option<u32>,
    pub keep_yearly: Option<u32>,
    /// Keep snapshots within this duration (e.g. "30d", "1y")
    pub keep_within: Option<String>,
    /// Keep tag-based snapshots
    #[serde(default)]
    pub keep_tags: Vec<String>,
    /// Prune unreferenced data after forget
    #[serde(default = "default_true")]
    pub prune: bool,
}

// ─── Borg Config ────────────────────────────────────────────────────

/// Borg compression algorithm.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BorgCompression {
    None,
    Lz4,
    Zstd,
    Zlib,
    Lzma,
    Auto,
}

/// Borg encryption mode.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BorgEncryption {
    None,
    Repokey,
    RepokeyBlake2,
    Keyfile,
    KeyfileBlake2,
    Authenticated,
    AuthenticatedBlake2,
}

/// Configuration for a borg-based backup job.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BorgConfig {
    /// Repository path (local or ssh://user@host:port/path)
    pub repository: String,
    /// Passphrase (BORG_PASSPHRASE)
    pub passphrase: Option<String>,
    /// Path to passphrase file
    pub passphrase_file: Option<String>,
    /// SSH transport configuration
    pub ssh: Option<SshTransportConfig>,
    /// Paths to back up
    pub paths: Vec<String>,
    /// Patterns to exclude
    #[serde(default)]
    pub exclude: Vec<String>,
    /// Exclude file list
    pub exclude_file: Option<String>,
    /// Compression algorithm
    pub compression: Option<BorgCompression>,
    /// Compression level (0-22 for zstd)
    pub compression_level: Option<u8>,
    /// Encryption mode (for `borg init`)
    pub encryption: Option<BorgEncryption>,
    /// Archive name pattern (supports {hostname}, {now}, {user})
    pub archive_name: Option<String>,
    /// Info/stats after create
    #[serde(default = "default_true")]
    pub stats: bool,
    /// Show file list during backup
    #[serde(default)]
    pub list_files: bool,
    /// Dry run
    #[serde(default)]
    pub dry_run: bool,
    /// One file system (don't cross FS boundaries)
    #[serde(default)]
    pub one_file_system: bool,
    /// Borg binary path
    pub borg_binary: Option<String>,
    /// Extra flags
    #[serde(default)]
    pub extra_args: Vec<String>,
    /// Retention policy for `borg prune`
    pub retention: Option<BorgRetention>,
    /// Enable compact after prune
    #[serde(default = "default_true")]
    pub compact_after_prune: bool,
}

/// Borg retention policy.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BorgRetention {
    pub keep_last: Option<u32>,
    pub keep_hourly: Option<u32>,
    pub keep_daily: Option<u32>,
    pub keep_weekly: Option<u32>,
    pub keep_monthly: Option<u32>,
    pub keep_yearly: Option<u32>,
    pub keep_within: Option<String>,
    /// Prefix filter for archive names
    pub prefix: Option<String>,
    /// Glob pattern filter for archive names
    pub glob_archives: Option<String>,
}

// ─── SFTP Config ────────────────────────────────────────────────────

/// SFTP transfer mode.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SftpTransferMode {
    Upload,
    Download,
    Sync,
    Mirror,
}

/// Configuration for SFTP-based transfers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SftpConfig {
    /// SSH transport
    pub ssh: SshTransportConfig,
    /// Local path(s)
    pub local_paths: Vec<String>,
    /// Remote path
    pub remote_path: String,
    /// Transfer direction/mode
    pub mode: SftpTransferMode,
    /// Overwrite existing files
    #[serde(default = "default_true")]
    pub overwrite: bool,
    /// Resume incomplete transfers
    #[serde(default = "default_true")]
    pub resume: bool,
    /// Preserve timestamps
    #[serde(default = "default_true")]
    pub preserve_timestamps: bool,
    /// Preserve permissions
    #[serde(default)]
    pub preserve_permissions: bool,
    /// Recursive directory transfer
    #[serde(default = "default_true")]
    pub recursive: bool,
    /// Exclude patterns (glob)
    #[serde(default)]
    pub exclude: Vec<String>,
    /// Bandwidth limit
    pub bandwidth_limit: Option<BandwidthLimit>,
    /// Buffer size in bytes
    pub buffer_size: Option<usize>,
    /// Max concurrent transfers
    pub concurrency: Option<u32>,
    /// Verify checksums after transfer
    #[serde(default)]
    pub verify_checksum: bool,
}

// ─── SCP Config ─────────────────────────────────────────────────────

/// Configuration for SCP-based transfers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScpConfig {
    /// SSH transport
    pub ssh: SshTransportConfig,
    /// Source path(s)
    pub sources: Vec<String>,
    /// Destination path
    pub destination: String,
    /// Direction: upload or download
    pub direction: ScpDirection,
    /// Recursive copy
    #[serde(default = "default_true")]
    pub recursive: bool,
    /// Preserve attributes
    #[serde(default = "default_true")]
    pub preserve: bool,
    /// Compression
    #[serde(default)]
    pub compress: bool,
    /// Bandwidth limit (KiB/s)
    pub bandwidth_limit_kbps: Option<u64>,
    /// SCP binary path
    pub scp_binary: Option<String>,
    /// Extra flags
    #[serde(default)]
    pub extra_args: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScpDirection {
    Upload,
    Download,
}

// ─── Unison Config ──────────────────────────────────────────────────

/// Conflict resolution strategy for unison.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnisonConflictPolicy {
    /// Ask the user (interactive — not used in automated mode)
    Ask,
    /// Prefer the newer file
    Newer,
    /// Prefer replica 1 (source)
    PreferSource,
    /// Prefer replica 2 (destination)
    PreferDest,
    /// Skip conflicting files
    Skip,
}

/// Configuration for unison bidirectional sync.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnisonConfig {
    /// Replica 1 (root1 — local or ssh://...)
    pub root1: String,
    /// Replica 2 (root2 — local or ssh://...)
    pub root2: String,
    /// SSH transport (used when a root is remote)
    pub ssh: Option<SshTransportConfig>,
    /// Paths to sync within the roots
    #[serde(default)]
    pub paths: Vec<String>,
    /// Ignore patterns
    #[serde(default)]
    pub ignore: Vec<String>,
    /// Force direction (override bi-directional)
    pub force: Option<String>,
    /// Prefer direction on conflict
    pub prefer: Option<UnisonConflictPolicy>,
    /// Batch mode — no user prompts
    #[serde(default = "default_true")]
    pub batch: bool,
    /// Auto accept non-conflicting changes
    #[serde(default = "default_true")]
    pub auto: bool,
    /// Fastcheck (use file size + modtime instead of content)
    #[serde(default = "default_true")]
    pub fastcheck: bool,
    /// Synchronize permissions
    #[serde(default = "default_true")]
    pub perms: bool,
    /// Synchronize ownership
    #[serde(default)]
    pub owner: bool,
    /// Synchronize group
    #[serde(default)]
    pub group: bool,
    /// Log file path
    pub log_file: Option<String>,
    /// Profile name (for Unison profiles)
    pub profile: Option<String>,
    /// Unison binary path
    pub unison_binary: Option<String>,
    /// Extra flags
    #[serde(default)]
    pub extra_args: Vec<String>,
}

// ─── Duplicity Config ───────────────────────────────────────────────

/// Duplicity backup type.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DuplicityBackupType {
    Full,
    Incremental,
    Auto,
}

/// Configuration for duplicity-based encrypted incremental backups.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicityConfig {
    /// Source directory
    pub source: String,
    /// Target URL (scp://user@host/path, s3://bucket, file:///path, etc.)
    pub target_url: String,
    /// SSH transport for scp/sftp targets
    pub ssh: Option<SshTransportConfig>,
    /// Backup type
    pub backup_type: Option<DuplicityBackupType>,
    /// GPG encryption key ID
    pub encrypt_key: Option<String>,
    /// GPG signing key ID
    pub sign_key: Option<String>,
    /// Passphrase for symmetric encryption
    pub passphrase: Option<String>,
    /// No encryption
    #[serde(default)]
    pub no_encryption: bool,
    /// Exclude patterns
    #[serde(default)]
    pub exclude: Vec<String>,
    /// Include patterns
    #[serde(default)]
    pub include: Vec<String>,
    /// Full backup every N days (--full-if-older-than)
    pub full_if_older_than: Option<String>,
    /// Volume size in MB
    pub volsize: Option<u32>,
    /// Number of retries
    pub num_retries: Option<u32>,
    /// Temp directory
    pub temp_dir: Option<String>,
    /// Archive directory
    pub archive_dir: Option<String>,
    /// Dry run
    #[serde(default)]
    pub dry_run: bool,
    /// Duplicity binary path
    pub duplicity_binary: Option<String>,
    /// Extra flags
    #[serde(default)]
    pub extra_args: Vec<String>,
    /// Retention: remove backups older than
    pub remove_older_than: Option<String>,
    /// Retention: remove all but N full backups
    pub remove_all_but_n_full: Option<u32>,
}

// ─── Backup Job ─────────────────────────────────────────────────────

/// Status of a backup job.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BackupJobStatus {
    Idle,
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
    Paused,
    PartiallyCompleted,
}

/// Priority level.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobPriority {
    Low,
    Normal,
    High,
    Critical,
}

/// Pre/post hooks for backup jobs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobHooks {
    /// Command to run before backup starts
    pub pre_backup: Option<String>,
    /// Command to run after successful backup
    pub post_backup: Option<String>,
    /// Command to run on backup failure
    pub on_failure: Option<String>,
    /// Timeout for hook execution (seconds)
    pub hook_timeout: Option<u64>,
}

/// Notification configuration for job events.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobNotification {
    /// Notify on success
    #[serde(default)]
    pub on_success: bool,
    /// Notify on failure
    #[serde(default = "default_true")]
    pub on_failure: bool,
    /// Notify on warning (partial completion)
    #[serde(default = "default_true")]
    pub on_warning: bool,
    /// Webhook URL for notifications
    pub webhook_url: Option<String>,
    /// Email notification target
    pub email: Option<String>,
}

/// The tool-specific configuration for a backup job.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "tool", rename_all = "snake_case")]
pub enum BackupToolConfig {
    Rsync(RsyncConfig),
    Rclone(RcloneConfig),
    Restic(ResticConfig),
    Borg(BorgConfig),
    Sftp(SftpConfig),
    Scp(ScpConfig),
    Unison(UnisonConfig),
    Duplicity(DuplicityConfig),
}

/// A backup job definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupJob {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub enabled: bool,
    pub tool_config: BackupToolConfig,
    pub status: BackupJobStatus,
    pub priority: JobPriority,
    /// Cron expression or interval
    pub schedule: Option<BackupSchedule>,
    /// Tags for grouping / filtering
    #[serde(default)]
    pub tags: Vec<String>,
    /// Pre/post hooks
    pub hooks: Option<JobHooks>,
    /// Notification config
    pub notifications: Option<JobNotification>,
    /// Maximum number of retry attempts on failure
    pub max_retries: Option<u32>,
    /// Delay between retries in seconds
    pub retry_delay_secs: Option<u64>,
    /// Maximum allowed runtime in seconds (0 = unlimited)
    pub timeout_secs: Option<u64>,
    /// Created timestamp
    pub created_at: DateTime<Utc>,
    /// Last modified timestamp
    pub updated_at: DateTime<Utc>,
    /// Last execution timestamp
    pub last_run_at: Option<DateTime<Utc>>,
    /// Next scheduled run
    pub next_run_at: Option<DateTime<Utc>>,
    /// Total run count
    pub run_count: u64,
    /// Total failure count
    pub fail_count: u64,
}

/// Backup schedule definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BackupSchedule {
    Cron {
        expression: String,
    },
    Interval {
        every_seconds: u64,
    },
    Daily {
        time: String,
        timezone: Option<String>,
    },
    Weekly {
        day: String,
        time: String,
    },
    Monthly {
        day: u8,
        time: String,
    },
}

// ─── Execution Records ──────────────────────────────────────────────

/// A single file transfer record within a job execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferRecord {
    pub path: String,
    pub size_bytes: u64,
    pub action: TransferAction,
    pub checksum: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferAction {
    Created,
    Updated,
    Deleted,
    Skipped,
    Failed,
}

/// Execution record of a backup job run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupExecutionRecord {
    pub id: String,
    pub job_id: String,
    pub job_name: String,
    pub tool: BackupTool,
    pub status: BackupJobStatus,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
    pub duration_secs: Option<f64>,
    /// Total bytes transferred
    pub bytes_transferred: u64,
    /// Total files transferred
    pub files_transferred: u64,
    /// Files deleted at destination
    pub files_deleted: u64,
    /// Files skipped (unchanged)
    pub files_skipped: u64,
    /// Files that failed to transfer
    pub files_failed: u64,
    /// Average transfer speed in bytes/sec
    pub speed_bps: Option<f64>,
    /// Individual file records (optional, can be large)
    #[serde(default)]
    pub file_records: Vec<TransferRecord>,
    /// Command that was executed
    pub command: Option<String>,
    /// Tool stdout (last N lines)
    pub stdout: Option<String>,
    /// Tool stderr
    pub stderr: Option<String>,
    /// Exit code
    pub exit_code: Option<i32>,
    /// Error message if failed
    pub error: Option<String>,
    /// Retry attempt number (0 = first try)
    pub retry_attempt: u32,
    /// Snapshot/archive ID (for restic/borg)
    pub snapshot_id: Option<String>,
}

// ─── Progress ───────────────────────────────────────────────────────

/// Real-time progress information for a running job.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupProgress {
    pub job_id: String,
    pub bytes_transferred: u64,
    pub bytes_total: Option<u64>,
    pub files_transferred: u64,
    pub files_total: Option<u64>,
    pub current_file: Option<String>,
    pub speed_bps: f64,
    pub eta_seconds: Option<u64>,
    pub percent_complete: Option<f64>,
    pub phase: BackupPhase,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BackupPhase {
    Preparing,
    Scanning,
    Transferring,
    Verifying,
    CleaningUp,
    Pruning,
    Compacting,
    Finished,
}

// ─── Snapshot / Archive Info ────────────────────────────────────────

/// Information about a restic snapshot or borg archive.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotInfo {
    pub id: String,
    pub short_id: Option<String>,
    pub time: DateTime<Utc>,
    pub hostname: Option<String>,
    pub username: Option<String>,
    pub paths: Vec<String>,
    pub tags: Vec<String>,
    pub size_bytes: Option<u64>,
    pub deduplicated_size: Option<u64>,
    pub files_count: Option<u64>,
    pub tool: BackupTool,
}

// ─── Repo Status ────────────────────────────────────────────────────

/// Status of a backup repository.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoStatus {
    pub repository: String,
    pub tool: BackupTool,
    pub total_size: Option<u64>,
    pub deduplicated_size: Option<u64>,
    pub snapshot_count: u64,
    pub last_backup: Option<DateTime<Utc>>,
    pub is_locked: bool,
    pub needs_repair: bool,
    pub encryption: Option<String>,
    pub compression: Option<String>,
}

// ─── Integrity ──────────────────────────────────────────────────────

/// Checksum algorithm for integrity verification.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChecksumAlgorithm {
    Md5,
    Sha1,
    Sha256,
    Sha512,
    Blake2b,
    Xxhash,
}

/// Result of an integrity check.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntegrityCheckResult {
    pub job_id: String,
    pub checked_at: DateTime<Utc>,
    pub total_files: u64,
    pub verified_ok: u64,
    pub mismatched: u64,
    pub missing: u64,
    pub errors: Vec<IntegrityError>,
    pub algorithm: ChecksumAlgorithm,
    pub duration_secs: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntegrityError {
    pub path: String,
    pub error_type: IntegrityErrorType,
    pub expected: Option<String>,
    pub actual: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IntegrityErrorType {
    ChecksumMismatch,
    FileMissing,
    PermissionDenied,
    ReadError,
}

// ─── Retention ──────────────────────────────────────────────────────

/// Generic retention policy applicable to any tool.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetentionPolicy {
    pub keep_last: Option<u32>,
    pub keep_daily: Option<u32>,
    pub keep_weekly: Option<u32>,
    pub keep_monthly: Option<u32>,
    pub keep_yearly: Option<u32>,
    /// Keep backups within this duration (e.g. "30d", "6m", "1y")
    pub keep_within: Option<String>,
    /// Maximum total size in bytes (oldest removed first)
    pub max_total_size: Option<u64>,
    /// Dry run — only report what would be removed
    #[serde(default)]
    pub dry_run: bool,
}

// ─── Tool Detection ─────────────────────────────────────────────────

/// Information about a detected backup tool installation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolInfo {
    pub tool: BackupTool,
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

// ─── Helpers ────────────────────────────────────────────────────────

fn default_true() -> bool {
    true
}
