use serde_json;
use std::path::{Path, PathBuf};

use crate::types::*;

/// Manages persistence of font configuration to disk.
pub struct FontConfigManager {
    data_dir: PathBuf,
    config: FontConfiguration,
}

impl FontConfigManager {
    /// Create a new config manager with the given data directory.
    pub fn new(data_dir: &Path) -> Self {
        Self {
            data_dir: data_dir.to_path_buf(),
            config: FontConfiguration::default(),
        }
    }

    /// Path to the config JSON file.
    fn config_path(&self) -> PathBuf {
        self.data_dir.join("font_config.json")
    }

    /// Get current configuration.
    pub fn config(&self) -> &FontConfiguration {
        &self.config
    }

    /// Get mutable configuration.
    pub fn config_mut(&mut self) -> &mut FontConfiguration {
        &mut self.config
    }

    /// Replace the entire configuration.
    pub fn set_config(&mut self, config: FontConfiguration) {
        self.config = config;
    }

    // ─── Persistence ────────────────────────────────────────────

    /// Load configuration from disk. Uses defaults if file doesn't exist.
    pub fn load(&mut self) -> Result<(), String> {
        let path = self.config_path();
        if !path.exists() {
            log::info!("No font config file found at {:?}, using defaults", path);
            self.config = FontConfiguration::default();
            return Ok(());
        }

        let data = std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read font config: {}", e))?;

        let persistent: FontPersistentData = serde_json::from_str(&data)
            .map_err(|e| format!("Failed to parse font config: {}", e))?;

        self.config = persistent.config;
        log::info!(
            "Loaded font config from {:?} (v{})",
            path,
            persistent.version
        );
        Ok(())
    }

    /// Save current configuration to disk.
    pub fn save(&self) -> Result<(), String> {
        let path = self.config_path();

        // Ensure data directory exists.
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create font config directory: {}", e))?;
        }

        let persistent = FontPersistentData {
            config: self.config.clone(),
            custom_stacks: self.config.custom_stacks.clone(),
            saved_at: chrono::Utc::now(),
            version: 1,
        };

        let json = serde_json::to_string_pretty(&persistent)
            .map_err(|e| format!("Failed to serialize font config: {}", e))?;

        std::fs::write(&path, json).map_err(|e| format!("Failed to write font config: {}", e))?;

        log::info!("Saved font config to {:?}", path);
        Ok(())
    }

    // ─── Import / Export ────────────────────────────────────────

    /// Export configuration to an arbitrary path.
    pub fn export_to(&self, path: &Path) -> Result<(), String> {
        let persistent = FontPersistentData {
            config: self.config.clone(),
            custom_stacks: self.config.custom_stacks.clone(),
            saved_at: chrono::Utc::now(),
            version: 1,
        };

        let json = serde_json::to_string_pretty(&persistent)
            .map_err(|e| format!("Failed to serialize font config for export: {}", e))?;

        std::fs::write(path, json).map_err(|e| format!("Failed to write font export: {}", e))?;

        log::info!("Exported font config to {:?}", path);
        Ok(())
    }

    /// Import configuration from an arbitrary path.
    pub fn import_from(&mut self, path: &Path) -> Result<(), String> {
        let data = std::fs::read_to_string(path)
            .map_err(|e| format!("Failed to read font import file: {}", e))?;

        let persistent: FontPersistentData = serde_json::from_str(&data)
            .map_err(|e| format!("Failed to parse font import file: {}", e))?;

        self.config = persistent.config;
        log::info!(
            "Imported font config from {:?} (v{})",
            path,
            persistent.version
        );
        Ok(())
    }

    // ─── Connection overrides ───────────────────────────────────

    /// Set font settings for a specific connection.
    pub fn set_connection_override(&mut self, connection_id: &str, settings: FontSettings) {
        self.config
            .connection_overrides
            .insert(connection_id.to_string(), settings);
    }

    /// Remove font override for a connection.
    pub fn remove_connection_override(&mut self, connection_id: &str) -> bool {
        self.config
            .connection_overrides
            .remove(connection_id)
            .is_some()
    }

    /// Get font settings for a connection (override or default SSH terminal).
    pub fn settings_for_connection(&self, connection_id: &str) -> &FontSettings {
        self.config
            .connection_overrides
            .get(connection_id)
            .unwrap_or(&self.config.ssh_terminal)
    }

    // ─── Favourites ─────────────────────────────────────────────

    /// Add a font ID to favourites.
    pub fn add_favourite(&mut self, font_id: &str) {
        let id = font_id.to_string();
        if !self.config.favourites.contains(&id) {
            self.config.favourites.push(id);
        }
    }

    /// Remove a font ID from favourites.
    pub fn remove_favourite(&mut self, font_id: &str) -> bool {
        let before = self.config.favourites.len();
        self.config.favourites.retain(|f| f != font_id);
        self.config.favourites.len() < before
    }

    // ─── Recent fonts ───────────────────────────────────────────

    /// Record a font as recently used (keeps last 20).
    pub fn record_recent(&mut self, font_id: &str) {
        let id = font_id.to_string();
        self.config.recent_fonts.retain(|f| f != &id);
        self.config.recent_fonts.insert(0, id);
        self.config.recent_fonts.truncate(20);
    }

    // ─── Custom stacks ─────────────────────────────────────────

    /// Add or update a custom font stack.
    pub fn upsert_custom_stack(&mut self, stack: FontStack) {
        let idx = self
            .config
            .custom_stacks
            .iter()
            .position(|s| s.id == stack.id);
        match idx {
            Some(i) => self.config.custom_stacks[i] = stack,
            None => self.config.custom_stacks.push(stack),
        }
    }

    /// Delete a custom font stack by ID.
    pub fn delete_custom_stack(&mut self, stack_id: &str) -> bool {
        let before = self.config.custom_stacks.len();
        self.config.custom_stacks.retain(|s| s.id != stack_id);
        self.config.custom_stacks.len() < before
    }
}
