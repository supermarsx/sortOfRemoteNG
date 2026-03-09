//! Data types, enums, and configuration structs for the updater.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ─── UpdateChannel ──────────────────────────────────────────────────

/// Supported update channels.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
#[derive(Default)]
pub enum UpdateChannel {
    #[default]
    Stable,
    Beta,
    Nightly,
    Custom {
        name: String,
    },
}

impl std::fmt::Display for UpdateChannel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Stable => write!(f, "stable"),
            Self::Beta => write!(f, "beta"),
            Self::Nightly => write!(f, "nightly"),
            Self::Custom { name } => write!(f, "custom:{name}"),
        }
    }
}

// ─── UpdateAsset ────────────────────────────────────────────────────

/// A single downloadable asset attached to an update release.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateAsset {
    pub name: String,
    pub url: String,
    pub size: u64,
    pub content_type: String,
    pub os: Option<String>,
    pub arch: Option<String>,
}

// ─── UpdateInfo ─────────────────────────────────────────────────────

/// Full description of an available update.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub version: String,
    pub channel: UpdateChannel,
    pub release_date: DateTime<Utc>,
    pub release_notes: String,
    pub download_url: String,
    pub download_size: u64,
    pub checksum_sha256: String,
    pub signature: Option<String>,
    pub mandatory: bool,
    pub min_version: Option<String>,
    pub assets: Vec<UpdateAsset>,
}

// ─── UpdateStatus ───────────────────────────────────────────────────

/// Current status of the updater state machine.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum UpdateStatus {
    UpToDate,
    UpdateAvailable {
        info: UpdateInfo,
    },
    Checking,
    Downloading {
        progress_pct: f64,
        bytes_downloaded: u64,
        total_bytes: u64,
    },
    Installing,
    Restarting,
    Error {
        message: String,
    },
}

// ─── UpdateConfig ───────────────────────────────────────────────────

/// Persistent configuration for the auto-updater.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateConfig {
    pub enabled: bool,
    pub check_interval_hours: u64,
    pub channel: UpdateChannel,
    pub auto_download: bool,
    pub auto_install: bool,
    pub install_on_exit: bool,
    pub github_owner: String,
    pub github_repo: String,
    pub custom_update_url: Option<String>,
    pub pre_release: bool,
    pub show_release_notes: bool,
}

impl Default for UpdateConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            check_interval_hours: 24,
            channel: UpdateChannel::Stable,
            auto_download: false,
            auto_install: false,
            install_on_exit: false,
            github_owner: String::new(),
            github_repo: String::new(),
            custom_update_url: None,
            pre_release: false,
            show_release_notes: true,
        }
    }
}

// ─── UpdateHistory ──────────────────────────────────────────────────

/// Record of a past update attempt.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateHistory {
    pub id: String,
    pub from_version: String,
    pub to_version: String,
    pub channel: UpdateChannel,
    pub timestamp: DateTime<Utc>,
    pub success: bool,
    pub error: Option<String>,
    pub rollback_available: bool,
}

// ─── RollbackInfo ───────────────────────────────────────────────────

/// Metadata for a rollback point.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RollbackInfo {
    pub previous_version: String,
    pub backup_path: String,
    pub created_at: DateTime<Utc>,
    pub size_bytes: u64,
}

// ─── VersionInfo ────────────────────────────────────────────────────

/// Summary of version information shown in the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionInfo {
    pub current_version: String,
    pub latest_version: Option<String>,
    pub channel: UpdateChannel,
    pub last_check: Option<DateTime<Utc>>,
    pub update_available: bool,
}

// ─── DownloadProgress ───────────────────────────────────────────────

/// Real-time download progress report.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgress {
    pub url: String,
    pub bytes_downloaded: u64,
    pub total_bytes: u64,
    pub speed_bps: u64,
    pub eta_seconds: u64,
}
