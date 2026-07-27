// ── sorng-keepass / database ───────────────────────────────────────────────────
//
// Database lifecycle operations: create, open, close, save, lock/unlock,
// backup, change master key, get statistics, merge.

use chrono::Utc;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::Read;

use super::service::{CompositeKeyInternal, KeePassService};
use super::types::*;

impl KeePassService {
    // ─── Create Database ──────────────────────────────────────────────

    /// Create a new empty KeePass database.
    pub fn create_database(
        &mut self,
        req: CreateDatabaseRequest,
    ) -> Result<KeePassDatabase, String> {
        // Validate inputs
        if req.file_path.is_empty() {
            return Err("File path is required".to_string());
        }
        if req.password.is_none() && req.key_file_path.is_none() {
            return Err("At least a password or key file is required".to_string());
        }

        // Check if already open
        if self.is_database_open(&req.file_path) {
            return Err(format!("Database already open: {}", req.file_path));
        }

        Err(
            "Creating KDBX files is not implemented by this backend; no file was written and no database was registered"
                .to_string(),
        )
    }

    // ─── Open Database ────────────────────────────────────────────────

    /// Open an existing KeePass database file.
    pub fn open_database(&mut self, req: OpenDatabaseRequest) -> Result<KeePassDatabase, String> {
        if req.file_path.is_empty() {
            return Err("File path is required".to_string());
        }

        // Check if already open
        if let Some(existing_id) = self.database_id_for_path(&req.file_path) {
            return self.get_database(&existing_id).map(|db| db.info.clone());
        }

        // Verify file exists
        let path = std::path::Path::new(&req.file_path);
        if !path.exists() {
            return Err(format!("File not found: {}", req.file_path));
        }

        // Build composite key
        Self::build_composite_key(req.password.as_deref(), req.key_file_path.as_deref())?;

        const KDBX_SIGNATURE: [u8; 8] = [0x03, 0xD9, 0xA2, 0x9A, 0x67, 0xFB, 0x4B, 0xB5];
        let mut file = std::fs::File::open(path)
            .map_err(|e| format!("Failed to read KeePass database: {e}"))?;
        let mut header = [0_u8; KDBX_SIGNATURE.len()];
        let header_len = file
            .read(&mut header)
            .map_err(|e| format!("Failed to read KeePass database header: {e}"))?;
        if header_len != KDBX_SIGNATURE.len() || header != KDBX_SIGNATURE {
            return Err("Invalid KeePass KDBX file signature".to_string());
        }

        Err(
            "Opening KDBX files is not implemented by this backend; no database was registered"
                .to_string(),
        )
    }

    // ─── Close Database ───────────────────────────────────────────────

    /// Close an open database, optionally saving first.
    pub fn close_database(&mut self, db_id: &str, save_first: bool) -> Result<(), String> {
        let requires_save = {
            let db = self.get_database(db_id)?;
            save_first && db.info.modified && !db.read_only
        };
        if requires_save {
            self.save_database(db_id, None)?;
        }

        let mut db = self.unregister_database(db_id)?;
        db.clear_sensitive();
        log::info!("Closed database: {} ({})", db.info.name, db.info.file_path);
        Ok(())
    }

    /// Close all open databases.
    pub fn close_all_databases(&mut self, save_first: bool) -> Result<Vec<String>, String> {
        let db_ids: Vec<String> = self.list_databases().iter().map(|d| d.id.clone()).collect();
        let mut closed = Vec::new();
        for db_id in &db_ids {
            self.close_database(db_id, save_first)?;
            closed.push(db_id.clone());
        }
        Ok(closed)
    }

    // ─── Save Database ────────────────────────────────────────────────

    /// Save the database to disk.
    pub fn save_database(
        &mut self,
        db_id: &str,
        _options: Option<SaveDatabaseOptions>,
    ) -> Result<String, String> {
        let db = self.get_database(db_id)?;

        if db.read_only {
            return Err("Database is open as read-only".to_string());
        }
        Err(
            "Saving KDBX files is not implemented by this backend; in-memory changes remain unsaved"
                .to_string(),
        )
    }

    // ─── Lock / Unlock ────────────────────────────────────────────────

    /// Lock a database (keeps metadata but clears sensitive data from memory).
    pub fn lock_database(&mut self, db_id: &str) -> Result<(), String> {
        let db = self.get_database_mut(db_id)?;

        if db.info.locked {
            return Ok(());
        }

        // Clear sensitive data from entries (passwords, protected fields)
        for entry in db.entries.values_mut() {
            entry.password = String::new();
            for field in entry.custom_fields.values_mut() {
                if field.is_protected {
                    field.value = String::new();
                }
            }
        }

        db.info.locked = true;
        log::info!("Locked database: {}", db.info.name);
        Ok(())
    }

    /// Unlock a database with the composite key.
    pub fn unlock_database(
        &mut self,
        db_id: &str,
        password: Option<&str>,
        key_file_path: Option<&str>,
    ) -> Result<(), String> {
        let composite_key = Self::build_composite_key(password, key_file_path)?;

        let db = self.get_database_mut(db_id)?;

        if !db.info.locked {
            return Ok(());
        }

        // Verify the key matches (in real impl, would re-derive and compare)
        if let Some(ref stored) = db.composite_key {
            if stored.combined_hash != composite_key.combined_hash {
                return Err("Invalid master key".to_string());
            }
        }

        db.info.locked = false;
        db.info.last_opened_at = Utc::now().to_rfc3339();
        log::info!("Unlocked database: {}", db.info.name);
        Ok(())
    }

    // ─── Backup ───────────────────────────────────────────────────────

    /// Create a backup of a database file.
    pub fn backup_database(&self, db_id: &str, backup_dir: Option<&str>) -> Result<String, String> {
        self.get_database(db_id)?;
        let _ = backup_dir;
        Err(
            "Backing up KDBX databases is not implemented by this backend; no backup was written"
                .to_string(),
        )
    }

    /// List backup files for a database.
    pub fn list_backups(&self, db_id: &str) -> Result<Vec<DatabaseFileInfo>, String> {
        let db = self.get_database(db_id)?;
        let source_path = std::path::Path::new(&db.info.file_path);

        let backup_directory = source_path
            .parent()
            .unwrap_or(std::path::Path::new("."))
            .join("backups");

        if !backup_directory.exists() {
            return Ok(Vec::new());
        }

        let stem = source_path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();

        let mut backups = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&backup_directory) {
            for entry in entries.flatten() {
                let path = entry.path();
                let file_name = path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();

                if file_name.starts_with(&stem) && file_name.ends_with(".kdbx") {
                    let metadata = std::fs::metadata(&path).ok();
                    backups.push(DatabaseFileInfo {
                        file_path: path.to_string_lossy().to_string(),
                        file_size: metadata.as_ref().map(|m| m.len()).unwrap_or(0),
                        format_version: None,
                        cipher: None,
                        kdf: None,
                        created: metadata.and_then(|m| m.created().ok()).map(|t| {
                            let dt: chrono::DateTime<Utc> = t.into();
                            dt.to_rfc3339()
                        }),
                        modified: None,
                    });
                }
            }
        }

        backups.sort_by(|a, b| b.created.cmp(&a.created));
        Ok(backups)
    }

    // ─── Change Master Key ────────────────────────────────────────────

    /// Change the master key of a database.
    pub fn change_master_key(
        &mut self,
        db_id: &str,
        old_password: Option<&str>,
        old_key_file: Option<&str>,
        new_password: Option<&str>,
        new_key_file: Option<&str>,
    ) -> Result<(), String> {
        self.get_database(db_id)?;
        let _ = (old_password, old_key_file, new_password, new_key_file);
        Err(
            "Changing a KDBX master key is not implemented by this backend; the key was not changed"
                .to_string(),
        )
    }

    // ─── Database Info ────────────────────────────────────────────────

    /// Get database file info without opening it.
    pub fn get_database_file_info(file_path: &str) -> Result<DatabaseFileInfo, String> {
        let path = std::path::Path::new(file_path);
        if !path.exists() {
            return Err(format!("File not found: {}", file_path));
        }

        let metadata =
            std::fs::metadata(path).map_err(|e| format!("Cannot read metadata: {}", e))?;

        Ok(DatabaseFileInfo {
            file_path: file_path.to_string(),
            file_size: metadata.len(),
            format_version: Some("4.x".to_string()), // Would parse header in real impl
            cipher: Some("AES-256".to_string()),
            kdf: Some("Argon2".to_string()),
            created: metadata.created().ok().map(|t| {
                let dt: chrono::DateTime<Utc> = t.into();
                dt.to_rfc3339()
            }),
            modified: metadata.modified().ok().map(|t| {
                let dt: chrono::DateTime<Utc> = t.into();
                dt.to_rfc3339()
            }),
        })
    }

    /// Get comprehensive database statistics.
    pub fn get_database_statistics(&self, db_id: &str) -> Result<DatabaseStatistics, String> {
        let db = self.get_database(db_id)?;
        let now = Utc::now();

        let expired_entries = db
            .entries
            .values()
            .filter(|e| {
                e.times.expires
                    && e.times
                        .expiry_time
                        .as_ref()
                        .and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok())
                        .map(|t| t < now)
                        .unwrap_or(false)
            })
            .count();

        let soon_threshold = now + chrono::Duration::days(30);
        let entries_expiring_soon = db
            .entries
            .values()
            .filter(|e| {
                e.times.expires
                    && e.times
                        .expiry_time
                        .as_ref()
                        .and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok())
                        .map(|t| {
                            let t_utc = t.with_timezone(&Utc);
                            t_utc > now && t_utc <= soon_threshold
                        })
                        .unwrap_or(false)
            })
            .count();

        let entries_without_password = db
            .entries
            .values()
            .filter(|e| e.password.is_empty())
            .count();

        // Count duplicate passwords
        let mut password_counts: HashMap<String, usize> = HashMap::new();
        for entry in db.entries.values() {
            if !entry.password.is_empty() {
                *password_counts.entry(entry.password.clone()).or_insert(0) += 1;
            }
        }
        let entries_with_duplicate_password =
            password_counts.values().filter(|&&c| c > 1).sum::<usize>();

        let entries_with_otp = db.entries.values().filter(|e| e.otp.is_some()).count();

        let entries_with_attachments = db
            .entries
            .values()
            .filter(|e| !e.attachments.is_empty())
            .count();

        let total_attachment_size: u64 = db
            .attachment_pool
            .values()
            .map(|a| a.data.len() as u64)
            .sum();

        let total_history_items: usize = db.history.values().map(|h| h.len()).sum();

        // Tag counts
        let mut tag_counts: HashMap<String, usize> = HashMap::new();
        for entry in db.entries.values() {
            for tag in &entry.tags {
                *tag_counts.entry(tag.clone()).or_insert(0) += 1;
            }
        }
        let mut most_used_tags: Vec<TagCount> = tag_counts
            .into_iter()
            .map(|(tag, count)| TagCount { tag, count })
            .collect();
        most_used_tags.sort_by_key(|tag| std::cmp::Reverse(tag.count));
        most_used_tags.truncate(20);

        // Group distribution
        let group_distribution: Vec<GroupEntryCount> = db
            .groups
            .values()
            .map(|g| GroupEntryCount {
                group_uuid: g.uuid.clone(),
                group_name: g.name.clone(),
                count: db
                    .entries
                    .values()
                    .filter(|e| e.group_uuid == g.uuid)
                    .count(),
            })
            .collect();

        let file_size = std::fs::metadata(&db.info.file_path)
            .map(|m| m.len())
            .unwrap_or(0);

        Ok(DatabaseStatistics {
            total_entries: db.entries.len(),
            total_groups: db.groups.len(),
            total_attachments: db.attachment_pool.len(),
            total_attachment_size,
            total_custom_icons: db.custom_icons.len(),
            total_history_items,
            expired_entries,
            entries_expiring_soon,
            entries_without_password,
            entries_with_weak_password: 0, // Would need crypto analysis
            entries_with_duplicate_password,
            entries_with_otp,
            entries_with_attachments,
            most_used_tags,
            group_distribution,
            oldest_password: None, // Would compute from modification times
            database_size_bytes: file_size,
            format_version: db.info.format_version.clone(),
            cipher: db.info.cipher.clone(),
            kdf_algorithm: db.info.kdf.algorithm.clone(),
        })
    }

    // ─── Merge ────────────────────────────────────────────────────────

    /// Merge another database into the currently open one.
    pub fn merge_database(
        &mut self,
        db_id: &str,
        config: MergeConfig,
    ) -> Result<MergeResult, String> {
        self.get_database(db_id)?;
        let _ = config;
        Err(
            "Merging KDBX databases is not implemented by this backend; no data was changed"
                .to_string(),
        )
    }

    // ─── Update Metadata ──────────────────────────────────────────────

    /// Update database metadata (name, description, default username, etc.).
    pub fn update_database_metadata(
        &mut self,
        db_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        default_username: Option<&str>,
        color: Option<&str>,
        recycle_bin_enabled: Option<bool>,
    ) -> Result<KeePassDatabase, String> {
        let db = self.get_database_mut(db_id)?;

        if let Some(name) = name {
            db.info.name = name.to_string();
        }
        if let Some(desc) = description {
            db.info.description = desc.to_string();
        }
        if let Some(username) = default_username {
            db.info.default_username = username.to_string();
        }
        if let Some(color) = color {
            db.info.color = Some(color.to_string());
        }
        if let Some(enabled) = recycle_bin_enabled {
            db.info.recycle_bin_enabled = enabled;
        }

        db.mark_modified();
        Ok(db.info.clone())
    }

    // ─── Composite Key Helpers ────────────────────────────────────────

    /// Build a composite key from password and/or key file.
    fn build_composite_key(
        password: Option<&str>,
        key_file_path: Option<&str>,
    ) -> Result<CompositeKeyInternal, String> {
        let mut hasher = Sha256::new();

        let password_hash = password.map(|p| {
            let mut h = Sha256::new();
            h.update(p.as_bytes());
            h.finalize().to_vec()
        });

        let key_file_hash = if let Some(path) = key_file_path {
            let data = std::fs::read(path).map_err(|e| format!("Cannot read key file: {}", e))?;
            let mut h = Sha256::new();
            h.update(&data);
            Some(h.finalize().to_vec())
        } else {
            None
        };

        // Combine components
        if let Some(ref ph) = password_hash {
            hasher.update(ph);
        }
        if let Some(ref kh) = key_file_hash {
            hasher.update(kh);
        }

        let combined_hash = hasher.finalize().to_vec();

        Ok(CompositeKeyInternal {
            password_hash,
            key_file_hash,
            combined_hash,
        })
    }
}
