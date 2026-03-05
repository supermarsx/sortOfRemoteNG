//! Data types for portable mode support.

use serde::{Deserialize, Serialize};

// ─── PortableMode ───────────────────────────────────────────────────

/// Whether the application is running in installed or portable mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PortableMode {
    /// Standard installation — data stored in OS-standard locations
    /// (e.g. `%APPDATA%` on Windows).
    Installed,
    /// Portable mode — all data stored relative to the executable.
    Portable,
}

impl std::fmt::Display for PortableMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Installed => write!(f, "installed"),
            Self::Portable => write!(f, "portable"),
        }
    }
}

// ─── PortableConfig ─────────────────────────────────────────────────

/// Configuration for portable mode behavior.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortableConfig {
    /// Current operating mode.
    pub mode: PortableMode,
    /// Absolute path to the data directory.
    pub data_directory: String,
    /// Relative name of the data subdirectory (used in portable mode).
    pub relative_data_dir: String,
    /// Name of the marker file that triggers portable mode.
    pub portable_marker_file: String,
    /// Store settings alongside the executable.
    pub store_settings_alongside: bool,
    /// Store screen recordings alongside the executable.
    pub store_recordings_alongside: bool,
    /// Store backups alongside the executable.
    pub store_backups_alongside: bool,
    /// Store extensions alongside the executable.
    pub store_extensions_alongside: bool,
    /// Maximum size for portable data in MB (None = unlimited).
    pub max_portable_size_mb: Option<u64>,
}

impl Default for PortableConfig {
    fn default() -> Self {
        Self {
            mode: PortableMode::Installed,
            data_directory: String::new(),
            relative_data_dir: "data".to_string(),
            portable_marker_file: ".portable".to_string(),
            store_settings_alongside: true,
            store_recordings_alongside: true,
            store_backups_alongside: true,
            store_extensions_alongside: true,
            max_portable_size_mb: None,
        }
    }
}

// ─── PortablePaths ──────────────────────────────────────────────────

/// Resolved absolute paths for all application data directories.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortablePaths {
    /// Base directory (executable dir in portable mode, app data dir in installed).
    pub base_dir: String,
    /// Main data directory.
    pub data_dir: String,
    /// Settings / configuration files.
    pub settings_dir: String,
    /// Connection collections.
    pub collections_dir: String,
    /// Backup files.
    pub backups_dir: String,
    /// Screen recordings / session logs.
    pub recordings_dir: String,
    /// Plugin/extension files.
    pub extensions_dir: String,
    /// Log files.
    pub logs_dir: String,
    /// Temporary files.
    pub temp_dir: String,
    /// Cache files.
    pub cache_dir: String,
}

// ─── PortableStatus ─────────────────────────────────────────────────

/// Runtime status information about the portable environment.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortableStatus {
    /// Current mode.
    pub mode: PortableMode,
    /// Data directory in use.
    pub data_dir: String,
    /// Total size of all data files in bytes.
    pub total_size_bytes: u64,
    /// Free space on the volume in bytes.
    pub free_space_bytes: u64,
    /// Total number of data files.
    pub file_count: u64,
    /// Whether the data resides on a removable drive.
    pub is_removable_drive: bool,
    /// Volume label (e.g. "USBDRIVE"), if available.
    pub drive_label: Option<String>,
}

// ─── MigrationPlan ──────────────────────────────────────────────────

/// Describes what will happen during a mode migration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationPlan {
    /// Source mode being migrated from.
    pub source_mode: PortableMode,
    /// Target mode being migrated to.
    pub target_mode: PortableMode,
    /// Files that will be copied.
    pub files_to_copy: Vec<String>,
    /// Total size of files to copy in bytes.
    pub total_size_bytes: u64,
    /// Estimated time for the migration in seconds.
    pub estimated_time_seconds: f64,
}

// ─── DriveInfo ──────────────────────────────────────────────────────

/// Information about the drive/volume hosting the data directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DriveInfo {
    /// Volume label.
    pub label: String,
    /// Total capacity in bytes.
    pub total_bytes: u64,
    /// Free space in bytes.
    pub free_bytes: u64,
    /// Whether the drive is removable (USB, SD card, etc.).
    pub is_removable: bool,
    /// Filesystem type (e.g. "NTFS", "FAT32", "exFAT").
    pub filesystem_type: String,
}
