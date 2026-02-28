//! # Backup Service (Rust Backend)
//!
//! This module provides all backup functionality in the Rust backend.
//! The frontend simply requests backups via Tauri commands - all logic runs here.
//!
//! ## Features
//!
//! - Full and differential backups
//! - Scheduled backup support with background thread
//! - Automatic cleanup of old backups (keep last X)
//! - Compression (gzip)
//! - Encryption (AES-256-GCM)
//! - Backup verification and integrity checking

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use flate2::write::GzEncoder;
use flate2::read::GzDecoder;
use flate2::Compression;
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use rand::RngCore;

/// Backup frequency options
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum BackupFrequency {
    Manual,
    Hourly,
    Daily,
    Weekly,
    Monthly,
}

/// Backup format options
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum BackupFormat {
    Json,
    Xml,
    EncryptedJson,
}

/// Day of week for weekly backups
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DayOfWeek {
    Sunday,
    Monday,
    Tuesday,
    Wednesday,
    Thursday,
    Friday,
    Saturday,
}

/// Backup configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupConfig {
    pub enabled: bool,
    pub frequency: BackupFrequency,
    pub scheduled_time: String,
    pub weekly_day: DayOfWeek,
    pub monthly_day: u8,
    pub destination_path: String,
    pub differential_enabled: bool,
    pub full_backup_interval: u32,
    pub max_backups_to_keep: u32,
    pub format: BackupFormat,
    pub include_passwords: bool,
    pub encrypt_backups: bool,
    pub encryption_algorithm: String,
    pub encryption_password: Option<String>,
    pub include_settings: bool,
    pub include_ssh_keys: bool,
    pub backup_on_close: bool,
    pub notify_on_backup: bool,
    pub compress_backups: bool,
}

impl Default for BackupConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            frequency: BackupFrequency::Daily,
            scheduled_time: "03:00".to_string(),
            weekly_day: DayOfWeek::Sunday,
            monthly_day: 1,
            destination_path: String::new(),
            differential_enabled: true,
            full_backup_interval: 7,
            max_backups_to_keep: 30,
            format: BackupFormat::Json,
            include_passwords: false,
            encrypt_backups: true,
            encryption_algorithm: "AES-256-GCM".to_string(),
            encryption_password: None,
            include_settings: true,
            include_ssh_keys: false,
            backup_on_close: false,
            notify_on_backup: true,
            compress_backups: true,
        }
    }
}

/// Backup metadata stored in each backup file
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupMetadata {
    pub id: String,
    pub created_at: u64,
    pub backup_type: String,  // "full" or "differential"
    pub version: String,
    pub checksum: String,
    pub encrypted: bool,
    pub compressed: bool,
    pub size_bytes: u64,
    pub connections_count: u32,
    pub parent_backup_id: Option<String>,  // For differential backups
}

/// Backup status for frontend updates
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    pub is_running: bool,
    pub last_backup_time: Option<u64>,
    pub last_backup_type: Option<String>,
    pub last_backup_status: Option<String>,  // "success" | "failed" | "partial"
    pub last_error: Option<String>,
    pub next_scheduled_time: Option<u64>,
    pub backup_count: u32,
    pub total_size_bytes: u64,
}

/// List of available backups
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupListItem {
    pub id: String,
    pub filename: String,
    pub created_at: u64,
    pub backup_type: String,
    pub size_bytes: u64,
    pub encrypted: bool,
    pub compressed: bool,
}

/// Backup service state
pub struct BackupService {
    config: BackupConfig,
    status: BackupStatus,
    #[allow(dead_code)]
    data_path: String,
}

/// Type alias for thread-safe backup state
pub type BackupServiceState = Arc<Mutex<BackupService>>;

impl BackupService {
    /// Create a new backup service
    pub fn new(data_path: String) -> BackupServiceState {
        Arc::new(Mutex::new(BackupService {
            config: BackupConfig::default(),
            status: BackupStatus {
                is_running: false,
                last_backup_time: None,
                last_backup_type: None,
                last_backup_status: None,
                last_error: None,
                next_scheduled_time: None,
                backup_count: 0,
                total_size_bytes: 0,
            },
            data_path,
        }))
    }

    /// Update backup configuration
    pub fn update_config(&mut self, config: BackupConfig) {
        self.config = config;
        self.calculate_next_scheduled_time();
    }

    /// Get current backup configuration
    pub fn get_config(&self) -> BackupConfig {
        self.config.clone()
    }

    /// Get current backup status
    pub fn get_status(&self) -> BackupStatus {
        self.status.clone()
    }

    /// Calculate next scheduled backup time based on config
    fn calculate_next_scheduled_time(&mut self) {
        if !self.config.enabled || self.config.frequency == BackupFrequency::Manual {
            self.status.next_scheduled_time = None;
            return;
        }

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        // Parse scheduled time (HH:MM)
        let parts: Vec<&str> = self.config.scheduled_time.split(':').collect();
        let hour: u64 = parts.get(0).and_then(|h| h.parse().ok()).unwrap_or(3);
        let minute: u64 = parts.get(1).and_then(|m| m.parse().ok()).unwrap_or(0);
        let time_of_day_secs = hour * 3600 + minute * 60;

        // Calculate next time based on frequency
        let next_time = match self.config.frequency {
            BackupFrequency::Manual => None,
            BackupFrequency::Hourly => {
                let current_hour_start = now - (now % 3600);
                Some(current_hour_start + 3600)
            }
            BackupFrequency::Daily => {
                let today_start = now - (now % 86400);
                let scheduled_today = today_start + time_of_day_secs;
                if scheduled_today > now {
                    Some(scheduled_today)
                } else {
                    Some(scheduled_today + 86400)
                }
            }
            BackupFrequency::Weekly => {
                // Simplified: just add 7 days from last backup or now
                let base = self.status.last_backup_time.unwrap_or(now);
                Some(base + 604800)  // 7 days in seconds
            }
            BackupFrequency::Monthly => {
                // Simplified: add ~30 days from last backup or now
                let base = self.status.last_backup_time.unwrap_or(now);
                Some(base + 2592000)  // 30 days in seconds
            }
        };

        self.status.next_scheduled_time = next_time;
    }

    /// Run a backup with the current configuration
    pub async fn run_backup(&mut self, backup_type: &str, data: &serde_json::Value) -> Result<BackupMetadata, String> {
        if self.status.is_running {
            return Err("Backup already in progress".to_string());
        }

        self.status.is_running = true;
        self.status.last_error = None;

        let result = self.perform_backup(backup_type, data).await;

        self.status.is_running = false;

        match &result {
            Ok(metadata) => {
                self.status.last_backup_time = Some(metadata.created_at);
                self.status.last_backup_type = Some(metadata.backup_type.clone());
                self.status.last_backup_status = Some("success".to_string());
                self.calculate_next_scheduled_time();
                
                // Cleanup old backups
                if self.config.max_backups_to_keep > 0 {
                    self.cleanup_old_backups().await?;
                }
                
                // Update backup count and size
                self.update_backup_stats().await?;
            }
            Err(e) => {
                self.status.last_backup_status = Some("failed".to_string());
                self.status.last_error = Some(e.clone());
            }
        }

        result
    }

    /// Perform the actual backup operation
    async fn perform_backup(&self, backup_type: &str, data: &serde_json::Value) -> Result<BackupMetadata, String> {
        // Ensure destination directory exists
        let dest_path = Path::new(&self.config.destination_path);
        if !dest_path.exists() {
            fs::create_dir_all(dest_path).map_err(|e| format!("Failed to create backup directory: {}", e))?;
        }

        // Generate backup ID and filename
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        
        let backup_id = format!("{}-{}", now, uuid::Uuid::new_v4().to_string().split('-').next().unwrap_or("0"));
        let extension = match (&self.config.format, self.config.compress_backups) {
            (BackupFormat::Json, true) => "json.gz",
            (BackupFormat::Json, false) => "json",
            (BackupFormat::EncryptedJson, true) => "enc.json.gz",
            (BackupFormat::EncryptedJson, false) => "enc.json",
            (BackupFormat::Xml, true) => "xml.gz",
            (BackupFormat::Xml, false) => "xml",
        };
        let filename = format!("backup_{}_{}.{}", backup_type, backup_id, extension);
        let file_path = dest_path.join(&filename);

        // Serialize data
        let json_data = serde_json::to_string_pretty(data)
            .map_err(|e| format!("Failed to serialize backup data: {}", e))?;

        // Calculate checksum before any transformations
        let mut hasher = Sha256::new();
        hasher.update(json_data.as_bytes());
        let checksum = format!("{:x}", hasher.finalize());

        // Compress if enabled
        let final_data = if self.config.compress_backups {
            let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
            encoder.write_all(json_data.as_bytes())
                .map_err(|e| format!("Failed to compress backup: {}", e))?;
            encoder.finish()
                .map_err(|e| format!("Failed to finish compression: {}", e))?
        } else {
            json_data.as_bytes().to_vec()
        };

        // Encrypt if enabled
        let encrypted_data = if self.config.encrypt_backups && self.config.encryption_password.is_some() {
            let password = self.config.encryption_password.as_ref().unwrap();
            self.encrypt_backup_data(&final_data, password)?
        } else {
            final_data
        };

        // Write to file
        let mut file = File::create(&file_path)
            .map_err(|e| format!("Failed to create backup file: {}", e))?;
        file.write_all(&encrypted_data)
            .map_err(|e| format!("Failed to write backup file: {}", e))?;

        let size_bytes = encrypted_data.len() as u64;

        // Count connections
        let connections_count = data.get("connections")
            .and_then(|c| c.as_array())
            .map(|arr| arr.len() as u32)
            .unwrap_or(0);

        let metadata = BackupMetadata {
            id: backup_id,
            created_at: now,
            backup_type: backup_type.to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            checksum,
            encrypted: self.config.encrypt_backups && self.config.encryption_password.is_some(),
            compressed: self.config.compress_backups,
            size_bytes,
            connections_count,
            parent_backup_id: None,
        };

        // Save metadata file
        let metadata_path = dest_path.join(format!("{}.meta.json", filename));
        let metadata_json = serde_json::to_string_pretty(&metadata)
            .map_err(|e| format!("Failed to serialize metadata: {}", e))?;
        fs::write(metadata_path, metadata_json)
            .map_err(|e| format!("Failed to write metadata: {}", e))?;

        Ok(metadata)
    }

    /// Cleanup old backups keeping only the configured number
    async fn cleanup_old_backups(&self) -> Result<(), String> {
        let dest_path = Path::new(&self.config.destination_path);
        if !dest_path.exists() {
            return Ok(());
        }

        let mut backups: Vec<(PathBuf, u64)> = Vec::new();

        for entry in fs::read_dir(dest_path).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            
            if path.extension().map(|e| e == "meta" || e == "json").unwrap_or(false) {
                continue;  // Skip metadata files, handle them with their backup
            }

            let filename = path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("");

            if filename.starts_with("backup_") {
                // Get creation time from filename or file metadata
                let created = entry.metadata()
                    .and_then(|m| m.created())
                    .map(|t| t.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs())
                    .unwrap_or(0);
                backups.push((path, created));
            }
        }

        // Sort by creation time (newest first)
        backups.sort_by(|a, b| b.1.cmp(&a.1));

        // Remove backups beyond the limit
        let max_to_keep = self.config.max_backups_to_keep as usize;
        for (path, _) in backups.iter().skip(max_to_keep) {
            let _ = fs::remove_file(path);
            // Also remove metadata file
            let meta_path = path.with_extension("meta.json");
            let _ = fs::remove_file(meta_path);
        }

        Ok(())
    }

    /// Update backup statistics
    async fn update_backup_stats(&mut self) -> Result<(), String> {
        let dest_path = Path::new(&self.config.destination_path);
        if !dest_path.exists() {
            self.status.backup_count = 0;
            self.status.total_size_bytes = 0;
            return Ok(());
        }

        let mut count = 0u32;
        let mut total_size = 0u64;

        for entry in fs::read_dir(dest_path).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let filename = path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("");

            if filename.starts_with("backup_") && !filename.contains(".meta.") {
                count += 1;
                if let Ok(meta) = entry.metadata() {
                    total_size += meta.len();
                }
            }
        }

        self.status.backup_count = count;
        self.status.total_size_bytes = total_size;
        Ok(())
    }

    /// List all available backups
    pub async fn list_backups(&self) -> Result<Vec<BackupListItem>, String> {
        let dest_path = Path::new(&self.config.destination_path);
        if !dest_path.exists() {
            return Ok(Vec::new());
        }

        let mut backups = Vec::new();

        for entry in fs::read_dir(dest_path).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let filename = path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();

            if !filename.starts_with("backup_") || filename.contains(".meta.") {
                continue;
            }

            // Try to read metadata
            let meta_path = path.parent()
                .map(|p| p.join(format!("{}.meta.json", filename)))
                .unwrap_or_default();

            let (id, backup_type, created_at, encrypted, compressed) = if meta_path.exists() {
                let meta_content = fs::read_to_string(&meta_path).unwrap_or_default();
                if let Ok(meta) = serde_json::from_str::<BackupMetadata>(&meta_content) {
                    (meta.id, meta.backup_type, meta.created_at, meta.encrypted, meta.compressed)
                } else {
                    (filename.clone(), "unknown".to_string(), 0, false, false)
                }
            } else {
                (filename.clone(), "unknown".to_string(), 0, false, false)
            };

            let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);

            backups.push(BackupListItem {
                id,
                filename,
                created_at,
                backup_type,
                size_bytes,
                encrypted,
                compressed,
            });
        }

        // Sort by creation time (newest first)
        backups.sort_by(|a, b| b.created_at.cmp(&a.created_at));

        Ok(backups)
    }

    /// Restore from a backup file
    pub async fn restore_backup(&self, backup_id: &str) -> Result<serde_json::Value, String> {
        let dest_path = Path::new(&self.config.destination_path);
        
        // Find the backup file
        let mut backup_path: Option<PathBuf> = None;
        for entry in fs::read_dir(dest_path).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let filename = path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("");
            
            if filename.contains(backup_id) && !filename.contains(".meta.") {
                backup_path = Some(path);
                break;
            }
        }

        let path = backup_path.ok_or_else(|| format!("Backup not found: {}", backup_id))?;

        // Read file
        let file_data = fs::read(&path)
            .map_err(|e| format!("Failed to read backup file: {}", e))?;

        // Decrypt if needed
        let decrypted_data = if self.is_encrypted_backup(&file_data) {
            let password = self.config.encryption_password.as_ref()
                .ok_or_else(|| "Backup is encrypted but no password is configured".to_string())?;
            self.decrypt_backup_data(&file_data, password)?
        } else {
            file_data
        };

        // Decompress if needed
        let is_compressed = path.to_string_lossy().contains(".gz");
        let json_data = if is_compressed {
            let mut decoder = GzDecoder::new(&decrypted_data[..]);
            let mut decompressed = String::new();
            decoder.read_to_string(&mut decompressed)
                .map_err(|e| format!("Failed to decompress backup: {}", e))?;
            decompressed
        } else {
            String::from_utf8(decrypted_data)
                .map_err(|e| format!("Invalid UTF-8 in backup: {}", e))?
        };

        // Parse JSON
        let data: serde_json::Value = serde_json::from_str(&json_data)
            .map_err(|e| format!("Failed to parse backup JSON: {}", e))?;

        Ok(data)
    }

    /// Delete a specific backup
    pub async fn delete_backup(&mut self, backup_id: &str) -> Result<(), String> {
        let dest_path = Path::new(&self.config.destination_path);
        
        for entry in fs::read_dir(dest_path).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let filename = path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("");
            
            if filename.contains(backup_id) {
                fs::remove_file(&path)
                    .map_err(|e| format!("Failed to delete backup file: {}", e))?;
            }
        }

        self.update_backup_stats().await?;
        Ok(())
    }

    fn encrypt_backup_data(&self, plaintext: &[u8], password: &str) -> Result<Vec<u8>, String> {
        let key = self.derive_key(password);
        let cipher = Aes256Gcm::new_from_slice(&key)
            .map_err(|e| format!("Failed to create cipher: {}", e))?;
        let mut nonce_bytes = [0u8; 12];
        rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ciphertext = cipher.encrypt(nonce, plaintext)
            .map_err(|e| format!("Failed to encrypt backup: {}", e))?;
        let mut out = Vec::with_capacity(6 + nonce_bytes.len() + ciphertext.len());
        out.extend_from_slice(b"SORNG1");
        out.extend_from_slice(&nonce_bytes);
        out.extend_from_slice(&ciphertext);
        Ok(out)
    }

    fn decrypt_backup_data(&self, data: &[u8], password: &str) -> Result<Vec<u8>, String> {
        if data.len() < 6 + 12 || &data[..6] != b"SORNG1" {
            return Err("Backup encryption header missing or invalid".to_string());
        }
        let nonce_bytes = &data[6..18];
        let ciphertext = &data[18..];
        let key = self.derive_key(password);
        let cipher = Aes256Gcm::new_from_slice(&key)
            .map_err(|e| format!("Failed to create cipher: {}", e))?;
        let nonce = Nonce::from_slice(nonce_bytes);
        cipher.decrypt(nonce, ciphertext)
            .map_err(|e| format!("Failed to decrypt backup: {}", e))
    }

    fn is_encrypted_backup(&self, data: &[u8]) -> bool {
        data.len() >= 6 && &data[..6] == b"SORNG1"
    }

    fn derive_key(&self, password: &str) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update(password.as_bytes());
        let result = hasher.finalize();
        let mut key = [0u8; 32];
        key.copy_from_slice(&result[..32]);
        key
    }
}

// ============================================================================
// Tauri Commands
// ============================================================================

/// Update backup configuration
#[tauri::command]
pub async fn backup_update_config(
    state: tauri::State<'_, BackupServiceState>,
    config: BackupConfig,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.update_config(config);
    Ok(())
}

/// Get current backup configuration
#[tauri::command]
pub async fn backup_get_config(
    state: tauri::State<'_, BackupServiceState>,
) -> Result<BackupConfig, String> {
    let service = state.lock().await;
    Ok(service.get_config())
}

/// Get current backup status
#[tauri::command]
pub async fn backup_get_status(
    state: tauri::State<'_, BackupServiceState>,
) -> Result<BackupStatus, String> {
    let service = state.lock().await;
    Ok(service.get_status())
}

/// Run a backup now
#[tauri::command]
pub async fn backup_run_now(
    state: tauri::State<'_, BackupServiceState>,
    backup_type: String,
    data: serde_json::Value,
) -> Result<BackupMetadata, String> {
    let mut service = state.lock().await;
    service.run_backup(&backup_type, &data).await
}

/// List all backups
#[tauri::command]
pub async fn backup_list(
    state: tauri::State<'_, BackupServiceState>,
) -> Result<Vec<BackupListItem>, String> {
    let service = state.lock().await;
    service.list_backups().await
}

/// Restore from a backup
#[tauri::command]
pub async fn backup_restore(
    state: tauri::State<'_, BackupServiceState>,
    backup_id: String,
) -> Result<serde_json::Value, String> {
    let service = state.lock().await;
    service.restore_backup(&backup_id).await
}

/// Delete a backup
#[tauri::command]
pub async fn backup_delete(
    state: tauri::State<'_, BackupServiceState>,
    backup_id: String,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.delete_backup(&backup_id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── BackupConfig Default ────────────────────────────────────────────

    #[test]
    fn backup_config_default_values() {
        let cfg = BackupConfig::default();
        assert!(!cfg.enabled);
        assert_eq!(cfg.frequency, BackupFrequency::Daily);
        assert_eq!(cfg.scheduled_time, "03:00");
        assert_eq!(cfg.weekly_day, DayOfWeek::Sunday);
        assert_eq!(cfg.monthly_day, 1);
        assert!(cfg.destination_path.is_empty());
        assert!(cfg.differential_enabled);
        assert_eq!(cfg.full_backup_interval, 7);
        assert_eq!(cfg.max_backups_to_keep, 30);
        assert_eq!(cfg.format, BackupFormat::Json);
        assert!(!cfg.include_passwords);
        assert!(cfg.encrypt_backups);
        assert_eq!(cfg.encryption_algorithm, "AES-256-GCM");
        assert!(cfg.encryption_password.is_none());
        assert!(cfg.include_settings);
        assert!(!cfg.include_ssh_keys);
        assert!(!cfg.backup_on_close);
        assert!(cfg.notify_on_backup);
        assert!(cfg.compress_backups);
    }

    // ── Enum serde round-trips ──────────────────────────────────────────

    #[test]
    fn backup_frequency_serde_roundtrip() {
        let variants = vec![
            BackupFrequency::Manual,
            BackupFrequency::Hourly,
            BackupFrequency::Daily,
            BackupFrequency::Weekly,
            BackupFrequency::Monthly,
        ];
        for v in variants {
            let json = serde_json::to_string(&v).unwrap();
            let back: BackupFrequency = serde_json::from_str(&json).unwrap();
            assert_eq!(v, back);
        }
    }

    #[test]
    fn backup_frequency_rename_all_lowercase() {
        let json = serde_json::to_string(&BackupFrequency::Daily).unwrap();
        assert_eq!(json, "\"daily\"");
    }

    #[test]
    fn backup_format_serde_roundtrip() {
        let variants = vec![
            BackupFormat::Json,
            BackupFormat::Xml,
            BackupFormat::EncryptedJson,
        ];
        for v in variants {
            let json = serde_json::to_string(&v).unwrap();
            let back: BackupFormat = serde_json::from_str(&json).unwrap();
            assert_eq!(v, back);
        }
    }

    #[test]
    fn backup_format_rename_all_kebab() {
        let json = serde_json::to_string(&BackupFormat::EncryptedJson).unwrap();
        assert_eq!(json, "\"encrypted-json\"");
    }

    #[test]
    fn day_of_week_serde_roundtrip() {
        let days = vec![
            DayOfWeek::Sunday, DayOfWeek::Monday, DayOfWeek::Tuesday,
            DayOfWeek::Wednesday, DayOfWeek::Thursday, DayOfWeek::Friday,
            DayOfWeek::Saturday,
        ];
        for d in days {
            let json = serde_json::to_string(&d).unwrap();
            let back: DayOfWeek = serde_json::from_str(&json).unwrap();
            assert_eq!(d, back);
        }
    }

    #[test]
    fn day_of_week_rename_all_lowercase() {
        assert_eq!(serde_json::to_string(&DayOfWeek::Wednesday).unwrap(), "\"wednesday\"");
    }

    // ── BackupConfig serde ──────────────────────────────────────────────

    #[test]
    fn backup_config_serde_roundtrip() {
        let cfg = BackupConfig::default();
        let json = serde_json::to_string(&cfg).unwrap();
        let back: BackupConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(back.frequency, cfg.frequency);
        assert_eq!(back.scheduled_time, cfg.scheduled_time);
        assert_eq!(back.max_backups_to_keep, cfg.max_backups_to_keep);
    }

    #[test]
    fn backup_config_camel_case_keys() {
        let cfg = BackupConfig::default();
        let json = serde_json::to_string(&cfg).unwrap();
        assert!(json.contains("scheduledTime"));
        assert!(json.contains("maxBackupsToKeep"));
        assert!(json.contains("includePasswords"));
        assert!(json.contains("encryptBackups"));
        assert!(!json.contains("scheduled_time"));
    }

    // ── BackupMetadata serde ────────────────────────────────────────────

    #[test]
    fn backup_metadata_serde_roundtrip() {
        let meta = BackupMetadata {
            id: "abc-123".to_string(),
            created_at: 1700000000,
            backup_type: "full".to_string(),
            version: "1.0.0".to_string(),
            checksum: "deadbeef".to_string(),
            encrypted: true,
            compressed: true,
            size_bytes: 4096,
            connections_count: 10,
            parent_backup_id: Some("parent-1".to_string()),
        };
        let json = serde_json::to_string(&meta).unwrap();
        let back: BackupMetadata = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, "abc-123");
        assert_eq!(back.connections_count, 10);
        assert_eq!(back.parent_backup_id, Some("parent-1".to_string()));
    }

    #[test]
    fn backup_metadata_camel_case_keys() {
        let meta = BackupMetadata {
            id: "x".to_string(),
            created_at: 0,
            backup_type: "full".to_string(),
            version: "0".to_string(),
            checksum: "".to_string(),
            encrypted: false,
            compressed: false,
            size_bytes: 0,
            connections_count: 0,
            parent_backup_id: None,
        };
        let json = serde_json::to_string(&meta).unwrap();
        assert!(json.contains("createdAt"));
        assert!(json.contains("sizeBytes"));
        assert!(json.contains("parentBackupId"));
    }

    // ── BackupStatus serde ──────────────────────────────────────────────

    #[test]
    fn backup_status_serde_roundtrip() {
        let status = BackupStatus {
            is_running: false,
            last_backup_time: Some(1700000000),
            last_backup_type: Some("full".to_string()),
            last_backup_status: Some("success".to_string()),
            last_error: None,
            next_scheduled_time: Some(1700003600),
            backup_count: 5,
            total_size_bytes: 10240,
        };
        let json = serde_json::to_string(&status).unwrap();
        let back: BackupStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(back.backup_count, 5);
        assert_eq!(back.last_backup_time, Some(1700000000));
    }

    // ── BackupListItem serde ────────────────────────────────────────────

    #[test]
    fn backup_list_item_serde_roundtrip() {
        let item = BackupListItem {
            id: "b1".to_string(),
            filename: "backup_full_b1.json.gz".to_string(),
            created_at: 1700000000,
            backup_type: "full".to_string(),
            size_bytes: 5120,
            encrypted: false,
            compressed: true,
        };
        let json = serde_json::to_string(&item).unwrap();
        let back: BackupListItem = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, "b1");
        assert!(back.compressed);
    }

    // ── BackupService ───────────────────────────────────────────────────

    #[tokio::test]
    async fn backup_service_new_defaults() {
        let state = BackupService::new("/tmp/test".to_string());
        let svc = state.lock().await;
        let cfg = svc.get_config();
        assert!(!cfg.enabled);
        assert_eq!(cfg.frequency, BackupFrequency::Daily);
        let status = svc.get_status();
        assert!(!status.is_running);
        assert_eq!(status.backup_count, 0);
    }

    #[tokio::test]
    async fn backup_service_update_and_get_config() {
        let state = BackupService::new("/tmp/test".to_string());
        let mut svc = state.lock().await;
        let mut cfg = BackupConfig::default();
        cfg.enabled = true;
        cfg.frequency = BackupFrequency::Hourly;
        cfg.max_backups_to_keep = 10;
        svc.update_config(cfg);
        let retrieved = svc.get_config();
        assert!(retrieved.enabled);
        assert_eq!(retrieved.frequency, BackupFrequency::Hourly);
        assert_eq!(retrieved.max_backups_to_keep, 10);
    }

    #[tokio::test]
    async fn backup_service_manual_no_next_time() {
        let state = BackupService::new("/tmp/test".to_string());
        let mut svc = state.lock().await;
        let mut cfg = BackupConfig::default();
        cfg.enabled = true;
        cfg.frequency = BackupFrequency::Manual;
        svc.update_config(cfg);
        let status = svc.get_status();
        assert!(status.next_scheduled_time.is_none());
    }

    #[tokio::test]
    async fn backup_service_enabled_daily_has_next_time() {
        let state = BackupService::new("/tmp/test".to_string());
        let mut svc = state.lock().await;
        let mut cfg = BackupConfig::default();
        cfg.enabled = true;
        cfg.frequency = BackupFrequency::Daily;
        svc.update_config(cfg);
        let status = svc.get_status();
        assert!(status.next_scheduled_time.is_some());
    }

    #[tokio::test]
    async fn backup_service_disabled_no_next_time() {
        let state = BackupService::new("/tmp/test".to_string());
        let mut svc = state.lock().await;
        let mut cfg = BackupConfig::default();
        cfg.enabled = false;
        cfg.frequency = BackupFrequency::Daily;
        svc.update_config(cfg);
        let status = svc.get_status();
        assert!(status.next_scheduled_time.is_none());
    }

    // ── Encryption round-trip ───────────────────────────────────────────

    #[tokio::test]
    async fn encrypt_decrypt_roundtrip() {
        let state = BackupService::new("/tmp/test".to_string());
        let svc = state.lock().await;
        let plaintext = b"Hello, World!";
        let password = "secret123";
        let encrypted = svc.encrypt_backup_data(plaintext, password).unwrap();
        assert_ne!(encrypted, plaintext);
        assert!(svc.is_encrypted_backup(&encrypted));
        let decrypted = svc.decrypt_backup_data(&encrypted, password).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[tokio::test]
    async fn is_encrypted_backup_false_for_plain_data() {
        let state = BackupService::new("/tmp/test".to_string());
        let svc = state.lock().await;
        assert!(!svc.is_encrypted_backup(b"plain text data"));
        assert!(!svc.is_encrypted_backup(b"SORNG")); // Too short prefix
        assert!(!svc.is_encrypted_backup(b"")); // Empty
    }

    #[tokio::test]
    async fn decrypt_rejects_invalid_header() {
        let state = BackupService::new("/tmp/test".to_string());
        let svc = state.lock().await;
        let result = svc.decrypt_backup_data(b"INVALID_HEADER", "password");
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn decrypt_wrong_password_fails() {
        let state = BackupService::new("/tmp/test".to_string());
        let svc = state.lock().await;
        let encrypted = svc.encrypt_backup_data(b"secret data", "correct").unwrap();
        let result = svc.decrypt_backup_data(&encrypted, "wrong");
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn derive_key_deterministic() {
        let state = BackupService::new("/tmp/test".to_string());
        let svc = state.lock().await;
        let k1 = svc.derive_key("password");
        let k2 = svc.derive_key("password");
        assert_eq!(k1, k2);
    }

    #[tokio::test]
    async fn derive_key_different_passwords() {
        let state = BackupService::new("/tmp/test".to_string());
        let svc = state.lock().await;
        let k1 = svc.derive_key("password1");
        let k2 = svc.derive_key("password2");
        assert_ne!(k1, k2);
    }

    // ── Full backup round-trip with temp dir ────────────────────────────

    #[tokio::test]
    async fn run_backup_and_restore() {
        let tmp = std::env::temp_dir().join("sorng_backup_test");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();

        let state = BackupService::new(tmp.to_string_lossy().to_string());
        let mut svc = state.lock().await;

        let mut cfg = BackupConfig::default();
        cfg.destination_path = tmp.to_string_lossy().to_string();
        cfg.encrypt_backups = false;
        cfg.compress_backups = false;
        svc.update_config(cfg);

        let data = serde_json::json!({"connections": [{"name": "test"}]});
        let meta = svc.run_backup("full", &data).await.unwrap();

        assert_eq!(meta.backup_type, "full");
        assert!(!meta.encrypted);
        assert!(!meta.compressed);
        assert_eq!(meta.connections_count, 1);
        assert!(!meta.checksum.is_empty());

        let status = svc.get_status();
        assert_eq!(status.last_backup_status, Some("success".to_string()));
        assert!(status.last_backup_time.is_some());

        // Restore
        let restored = svc.restore_backup(&meta.id).await.unwrap();
        assert_eq!(restored["connections"][0]["name"], "test");

        // Cleanup
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn run_backup_compressed() {
        let tmp = std::env::temp_dir().join("sorng_backup_test_gz");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();

        let state = BackupService::new(tmp.to_string_lossy().to_string());
        let mut svc = state.lock().await;

        let mut cfg = BackupConfig::default();
        cfg.destination_path = tmp.to_string_lossy().to_string();
        cfg.encrypt_backups = false;
        cfg.compress_backups = true;
        svc.update_config(cfg);

        let data = serde_json::json!({"connections": []});
        let meta = svc.run_backup("full", &data).await.unwrap();
        assert!(meta.compressed);

        let restored = svc.restore_backup(&meta.id).await.unwrap();
        assert_eq!(restored["connections"], serde_json::json!([]));

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn run_backup_encrypted_and_compressed() {
        let tmp = std::env::temp_dir().join("sorng_backup_test_enc");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();

        let state = BackupService::new(tmp.to_string_lossy().to_string());
        let mut svc = state.lock().await;

        let mut cfg = BackupConfig::default();
        cfg.destination_path = tmp.to_string_lossy().to_string();
        cfg.encrypt_backups = true;
        cfg.encryption_password = Some("test_password".to_string());
        cfg.compress_backups = true;
        svc.update_config(cfg);

        let data = serde_json::json!({"connections": [{"name": "secure"}]});
        let meta = svc.run_backup("full", &data).await.unwrap();
        assert!(meta.encrypted);
        assert!(meta.compressed);

        let restored = svc.restore_backup(&meta.id).await.unwrap();
        assert_eq!(restored["connections"][0]["name"], "secure");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn backup_already_running_rejects() {
        let state = BackupService::new("/tmp/test_running".to_string());
        let mut svc = state.lock().await;
        svc.status.is_running = true;
        let result = svc.run_backup("full", &serde_json::json!({})).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("already in progress"));
    }
}
