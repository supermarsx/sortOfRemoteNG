use chrono::Utc;
use std::path::{Path, PathBuf};

use crate::types::PersistentData;

/// Manages JSON-based persistence of palette data (history, snippets, aliases,
/// config) under the app's data directory.
pub struct PersistenceManager {
    file_path: PathBuf,
}

impl PersistenceManager {
    /// Create a new manager.  `data_dir` is the app-data directory
    /// (e.g. from `app.path().app_data_dir()`).
    pub fn new(data_dir: &Path) -> Self {
        Self {
            file_path: data_dir.join("command_palette.json"),
        }
    }

    /// Load persisted data from disk.  Returns default data if the file
    /// does not exist or cannot be parsed.
    pub fn load(&self) -> PersistentData {
        match std::fs::read_to_string(&self.file_path) {
            Ok(contents) => match serde_json::from_str::<PersistentData>(&contents) {
                Ok(data) => {
                    log::info!(
                        "Loaded command palette data: {} history, {} snippets, {} aliases",
                        data.history.len(),
                        data.snippets.len(),
                        data.aliases.len(),
                    );
                    data
                }
                Err(e) => {
                    log::warn!(
                        "Failed to parse command_palette.json, using defaults: {}",
                        e
                    );
                    PersistentData::default()
                }
            },
            Err(_) => {
                log::info!("No existing command_palette.json, using defaults");
                PersistentData::default()
            }
        }
    }

    /// Persist current data to disk.
    pub fn save(&self, data: &mut PersistentData) -> Result<(), String> {
        data.saved_at = Utc::now();

        // Ensure parent directory exists
        if let Some(parent) = self.file_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create data directory: {}", e))?;
        }

        let json = serde_json::to_string_pretty(data)
            .map_err(|e| format!("Failed to serialize palette data: {}", e))?;

        // Atomic-ish write: write to temp then rename
        let tmp_path = self.file_path.with_extension("json.tmp");
        std::fs::write(&tmp_path, &json)
            .map_err(|e| format!("Failed to write palette data: {}", e))?;
        std::fs::rename(&tmp_path, &self.file_path)
            .map_err(|e| format!("Failed to rename palette data file: {}", e))?;

        log::debug!("Saved command palette data ({} bytes)", json.len());
        Ok(())
    }

    /// Export a subset of data (e.g. just snippets) to an arbitrary path.
    pub fn export_to(&self, path: &Path, data: &PersistentData) -> Result<(), String> {
        let json = serde_json::to_string_pretty(data)
            .map_err(|e| format!("Failed to serialize export data: {}", e))?;
        std::fs::write(path, json).map_err(|e| format!("Failed to write export file: {}", e))?;
        Ok(())
    }

    /// Import data from an arbitrary path, merging with existing data.
    pub fn import_from(&self, path: &Path) -> Result<PersistentData, String> {
        let contents = std::fs::read_to_string(path)
            .map_err(|e| format!("Failed to read import file: {}", e))?;
        serde_json::from_str(&contents).map_err(|e| format!("Failed to parse import file: {}", e))
    }

    /// Return the file path (for debugging / UI display).
    pub fn file_path(&self) -> &Path {
        &self.file_path
    }
}
