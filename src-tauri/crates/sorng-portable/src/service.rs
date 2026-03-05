//! Service façade for portable mode.
//!
//! Wraps all portable operations behind a single `Arc<Mutex<..>>` state
//! compatible with Tauri's managed-state model.

use std::sync::Arc;
use tokio::sync::Mutex;

use crate::detector;
use crate::error::PortableError;
use crate::migration;
use crate::paths;
use crate::types::*;

/// Type alias for the Tauri managed state.
pub type PortableServiceState = Arc<Mutex<PortableService>>;

/// Top-level façade for portable mode operations.
pub struct PortableService {
    /// Current configuration.
    pub config: PortableConfig,
    /// Resolved paths.
    pub paths: PortablePaths,
}

impl PortableService {
    /// Create a new `PortableService` by detecting the mode from the
    /// given executable directory.
    pub fn new(exe_dir: &str) -> PortableServiceState {
        let mode = detector::detect_mode(exe_dir);
        let mut config = PortableConfig::default();
        config.mode = mode;

        let resolved = paths::resolve_paths(&config, exe_dir);

        let service = Self {
            config,
            paths: resolved,
        };
        Arc::new(Mutex::new(service))
    }

    /// Create with explicit configuration.
    pub fn with_config(config: PortableConfig, exe_dir: &str) -> PortableServiceState {
        let resolved = paths::resolve_paths(&config, exe_dir);
        let service = Self {
            config,
            paths: resolved,
        };
        Arc::new(Mutex::new(service))
    }

    // ── Detection ───────────────────────────────────────────────

    /// Get the current detected mode.
    pub fn detect_mode(&self) -> PortableMode {
        self.config.mode
    }

    // ── Status ──────────────────────────────────────────────────

    /// Get runtime status information.
    pub fn get_status(&self) -> Result<PortableStatus, PortableError> {
        paths::get_portable_status(&self.paths)
    }

    // ── Paths ───────────────────────────────────────────────────

    /// Get the resolved paths.
    pub fn get_paths(&self) -> PortablePaths {
        self.paths.clone()
    }

    // ── Config ──────────────────────────────────────────────────

    /// Get the current configuration.
    pub fn get_config(&self) -> PortableConfig {
        self.config.clone()
    }

    /// Update the configuration and re-resolve paths.
    pub fn update_config(&mut self, config: PortableConfig, exe_dir: &str) {
        self.paths = paths::resolve_paths(&config, exe_dir);
        self.config = config;
    }

    // ── Migration ───────────────────────────────────────────────

    /// Migrate to portable mode.
    pub fn migrate_to_portable(&mut self, exe_dir: &str) -> Result<(), PortableError> {
        let mut target_config = self.config.clone();
        target_config.mode = PortableMode::Portable;
        let target_paths = paths::resolve_paths(&target_config, exe_dir);

        let plan = migration::plan_migration(&self.paths, &target_paths)?;
        migration::execute_migration(&plan, &self.paths, &target_paths)?;

        self.config = target_config;
        self.paths = target_paths;
        Ok(())
    }

    /// Migrate to installed mode.
    pub fn migrate_to_installed(
        &mut self,
        exe_dir: &str,
        data_dir: &str,
    ) -> Result<(), PortableError> {
        let mut target_config = self.config.clone();
        target_config.mode = PortableMode::Installed;
        target_config.data_directory = data_dir.to_string();
        let target_paths = paths::resolve_paths(&target_config, exe_dir);

        let plan = migration::plan_migration(&self.paths, &target_paths)?;
        migration::execute_migration(&plan, &self.paths, &target_paths)?;

        self.config = target_config;
        self.paths = target_paths;
        Ok(())
    }

    // ── Marker ──────────────────────────────────────────────────

    /// Create the portable marker in the base directory.
    pub fn create_marker(&self) -> Result<(), PortableError> {
        migration::create_portable_marker(&self.paths.base_dir)
    }

    /// Remove the portable marker from the base directory.
    pub fn remove_marker(&self) -> Result<(), PortableError> {
        migration::remove_portable_marker(&self.paths.base_dir)
    }

    // ── Validation ──────────────────────────────────────────────

    /// Validate the current portable directory structure.
    pub fn validate(&self) -> Vec<String> {
        migration::validate_portable_directory(&self.paths.data_dir)
    }

    // ── Drive info ──────────────────────────────────────────────

    /// Get information about the drive hosting the data directory.
    pub fn get_drive_info(&self) -> Option<DriveInfo> {
        detector::get_drive_info(&self.paths.data_dir)
    }
}
