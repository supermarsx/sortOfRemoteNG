// ── sorng-keepass / database ───────────────────────────────────────────────────
//
// Database lifecycle operations: create, open, close, save, lock/unlock,
// backup, change master key, get statistics, merge.

use chrono::Utc;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use super::codec;
use super::service::KeePassService;
use super::types::*;

impl KeePassService {
    // ─── Create Database ──────────────────────────────────────────────

    /// Create a new empty KeePass database.
    pub fn create_database(
        &mut self,
        req: CreateDatabaseRequest,
    ) -> Result<KeePassDatabase, String> {
        if req.file_path.trim().is_empty() {
            return Err("File path is required".to_string());
        }
        if req.password.is_none() && req.key_file_path.is_none() {
            return Err("At least a password or key file is required".to_string());
        }
        let path = codec::resolve_destination_path(&req.file_path, false)?;
        let path_string = path.to_string_lossy().to_string();
        if self.is_database_open(&path_string) {
            return Err(format!("Database already open: {path_string}"));
        }
        let (key, fingerprint) =
            codec::build_database_key(req.password.as_deref(), req.key_file_path.as_deref())?;
        let (native, _) = codec::new_native_database(&req)?;
        let source_hash = codec::save_native_atomic(&native, &key, &path)?;
        let id = uuid::Uuid::new_v4().to_string();
        let instance = codec::database_instance_from_native(
            id.clone(),
            path_string.clone(),
            native,
            key,
            fingerprint,
            source_hash,
            false,
        )?;
        let info = instance.info.clone();
        self.register_database(instance);
        self.add_recent_database(&path_string, &info.name);
        Ok(info)
    }

    // ─── Open Database ────────────────────────────────────────────────

    /// Open an existing KeePass database file.
    pub fn open_database(&mut self, req: OpenDatabaseRequest) -> Result<KeePassDatabase, String> {
        if req.file_path.trim().is_empty() {
            return Err("File path is required".to_string());
        }
        let resolved = codec::resolve_existing_database_path(&req.file_path)?;
        let path_string = resolved.to_string_lossy().to_string();
        if let Some(existing_id) = self.database_id_for_path(&path_string) {
            return self.get_database(&existing_id).map(|db| db.info.clone());
        }
        let opened = codec::open_native_database(
            &path_string,
            req.password.as_deref(),
            req.key_file_path.as_deref(),
        )?;
        let codec_read_only = !matches!(
            opened.native.config.version,
            keepass::config::DatabaseVersion::KDB4(_)
        );
        let read_only = req.read_only.unwrap_or(false) || codec_read_only;
        let id = uuid::Uuid::new_v4().to_string();
        let instance = codec::database_instance_from_native(
            id.clone(),
            opened.path.to_string_lossy().to_string(),
            opened.native,
            opened.key,
            opened.fingerprint,
            opened.source_hash,
            read_only,
        )?;
        let info = instance.info.clone();
        self.register_database(instance);
        self.add_recent_database(&path_string, &info.name);
        Ok(info)
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
        options: Option<SaveDatabaseOptions>,
    ) -> Result<String, String> {
        let settings = self.get_settings();
        let (source_path, target_path, mut native, key, fingerprint, source_hash, create_backup) = {
            let db = self.get_database(db_id)?;
            if db.info.locked {
                return Err("Database is locked".to_string());
            }
            if db.read_only {
                return Err("Database is open as read-only".to_string());
            }
            let source_path = PathBuf::from(&db.info.file_path);
            let target_path = if let Some(path) = options
                .as_ref()
                .and_then(|value| value.file_path.as_deref())
            {
                let candidate = codec::resolve_destination_path(path, true)?;
                if candidate != source_path && candidate.exists() {
                    return Err(format!(
                        "Refusing to overwrite an existing Save As target: {}",
                        candidate.display()
                    ));
                }
                candidate
            } else {
                source_path.clone()
            };
            if target_path == source_path {
                codec::verify_source_unchanged(&source_path, db.source_hash)?;
            }
            let native = codec::reconcile_native(db)?;
            let key = db
                .database_key
                .clone()
                .ok_or_else(|| "Database key is unavailable; reopen the database".to_string())?;
            let fingerprint = db
                .composite_key
                .clone()
                .ok_or_else(|| "Database key fingerprint is unavailable".to_string())?;
            let create_backup = options
                .as_ref()
                .and_then(|value| value.create_backup)
                .unwrap_or(settings.backup_on_save);
            (
                source_path,
                target_path,
                native,
                key,
                fingerprint,
                db.source_hash,
                create_backup,
            )
        };
        codec::apply_save_options(&mut native, options.as_ref())?;
        if create_backup && target_path.exists() {
            codec::durable_backup(&target_path, None)?;
        }
        let new_hash = codec::save_native_atomic(&native, &key, &target_path)?;
        let refreshed = codec::database_instance_from_native(
            db_id.to_string(),
            target_path.to_string_lossy().to_string(),
            native,
            key,
            fingerprint,
            new_hash,
            false,
        )?;
        *self.get_database_mut(db_id)? = refreshed;
        let name = self.get_database(db_id)?.info.name.clone();
        self.add_recent_database(&target_path.to_string_lossy(), &name);
        if target_path != source_path && source_hash.is_some() {
            self.remove_recent_database(&source_path.to_string_lossy());
        }
        Ok(target_path.to_string_lossy().to_string())
    }

    // ─── Lock / Unlock ────────────────────────────────────────────────

    /// Lock a database (keeps metadata but clears sensitive data from memory).
    pub fn lock_database(&mut self, db_id: &str) -> Result<(), String> {
        if self.get_database(db_id)?.info.locked {
            return Ok(());
        }
        let requires_save = {
            let db = self.get_database(db_id)?;
            db.info.modified && !db.read_only
        };
        if requires_save {
            self.save_database(db_id, None)?;
        }
        let db = self.get_database_mut(db_id)?;
        db.clear_sensitive();
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
        let (file_path, read_only, id) = {
            let db = self.get_database(db_id)?;
            if !db.info.locked {
                return Ok(());
            }
            (db.info.file_path.clone(), db.read_only, db.info.id.clone())
        };
        let opened = codec::open_native_database(&file_path, password, key_file_path)?;
        let refreshed = codec::database_instance_from_native(
            id,
            opened.path.to_string_lossy().to_string(),
            opened.native,
            opened.key,
            opened.fingerprint,
            opened.source_hash,
            read_only,
        )?;
        *self.get_database_mut(db_id)? = refreshed;
        if !self.get_database(db_id)?.info.locked {
            return Ok(());
        }
        Err("Failed to unlock KeePass database".to_string())
    }

    // ─── Backup ───────────────────────────────────────────────────────

    /// Create a backup of a database file.
    pub fn backup_database(&self, db_id: &str, backup_dir: Option<&str>) -> Result<String, String> {
        let db = self.get_database(db_id)?;
        let source = Path::new(&db.info.file_path);
        codec::verify_source_unchanged(source, db.source_hash)?;
        let backup = codec::durable_backup(source, backup_dir.map(Path::new))?;
        Ok(backup.to_string_lossy().to_string())
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
                let metadata = match std::fs::symlink_metadata(&path) {
                    Ok(metadata)
                        if metadata.is_file()
                            && !metadata.file_type().is_symlink()
                            && metadata.len() <= codec::MAX_DATABASE_SIZE =>
                    {
                        metadata
                    }
                    _ => continue,
                };
                let file_name = path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();

                if file_name.starts_with(&stem) && file_name.ends_with(".kdbx") {
                    backups.push(DatabaseFileInfo {
                        file_path: path.to_string_lossy().to_string(),
                        file_size: metadata.len(),
                        format_version: None,
                        cipher: None,
                        kdf: None,
                        created: metadata.created().ok().map(|t| {
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
        let (source_path, native, current_hash, read_only) = {
            let db = self.get_database(db_id)?;
            if db.info.locked {
                return Err("Database is locked".to_string());
            }
            if db.read_only {
                return Err("Database is open as read-only".to_string());
            }
            let source = PathBuf::from(&db.info.file_path);
            codec::verify_source_unchanged(&source, db.source_hash)?;
            (
                source,
                codec::reconcile_native(db)?,
                db.source_hash,
                db.read_only,
            )
        };
        let _verified_old = codec::open_native_database(
            &source_path.to_string_lossy(),
            old_password,
            old_key_file,
        )?;
        let (new_key, new_fingerprint) = codec::build_database_key(new_password, new_key_file)?;
        codec::durable_backup(&source_path, None)?;
        let new_hash = codec::save_native_atomic(&native, &new_key, &source_path)?;
        let refreshed = codec::database_instance_from_native(
            db_id.to_string(),
            source_path.to_string_lossy().to_string(),
            native,
            new_key,
            new_fingerprint,
            new_hash,
            read_only,
        )?;
        *self.get_database_mut(db_id)? = refreshed;
        let _ = current_hash;
        Ok(())
    }

    // ─── Database Info ────────────────────────────────────────────────

    /// Get database file info without opening it.
    pub fn get_database_file_info(file_path: &str) -> Result<DatabaseFileInfo, String> {
        let (path, file_size, header) = codec::inspect_database_file(file_path)?;
        let metadata =
            std::fs::metadata(&path).map_err(|e| format!("Cannot read metadata: {e}"))?;
        Ok(DatabaseFileInfo {
            file_path: path.to_string_lossy().to_string(),
            file_size,
            format_version: Some(header.format_version),
            cipher: header.cipher,
            kdf: header.kdf,
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
}
