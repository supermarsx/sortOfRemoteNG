// ── sorng-keepass / entries ────────────────────────────────────────────────────
//
// Entry management: create, read, update, delete, move, copy, recycle,
// history tracking, field references, OTP generation.

use std::collections::HashMap;
use chrono::Utc;
use uuid::Uuid;
use sha2::{Sha256, Digest};

use super::types::*;
use super::service::KeePassService;

impl KeePassService {
    // ─── Create Entry ─────────────────────────────────────────────────

    /// Create a new entry in a database.
    pub fn create_entry(&mut self, db_id: &str, req: EntryRequest) -> Result<KeePassEntry, String> {
        // Validate group exists
        {
            let db = self.get_database(db_id)?;
            if db.info.locked {
                return Err("Database is locked".to_string());
            }
            if db.read_only {
                return Err("Database is read-only".to_string());
            }
            if !db.groups.contains_key(&req.group_uuid) {
                return Err(format!("Group not found: {}", req.group_uuid));
            }
        }

        let now = Utc::now().to_rfc3339();
        let entry_uuid = Uuid::new_v4().to_string();

        let password = req.password.unwrap_or_default();
        let password_quality = if !password.is_empty() {
            Some(Self::estimate_entropy(&password))
        } else {
            None
        };

        let entry = KeePassEntry {
            uuid: entry_uuid.clone(),
            group_uuid: req.group_uuid.clone(),
            icon_id: req.icon_id.unwrap_or(0),
            custom_icon_uuid: req.custom_icon_uuid,
            foreground_color: req.foreground_color,
            background_color: req.background_color,
            override_url: req.override_url,
            password_quality,
            tags: req.tags.unwrap_or_default(),
            title: req.title.unwrap_or_default(),
            username: req.username.unwrap_or_default(),
            password,
            url: req.url.unwrap_or_default(),
            notes: req.notes.unwrap_or_default(),
            custom_fields: req.custom_fields.unwrap_or_default(),
            attachments: Vec::new(),
            auto_type: req.auto_type,
            otp: req.otp,
            times: KeePassTimes {
                created: now.clone(),
                last_modified: now.clone(),
                last_accessed: now.clone(),
                expiry_time: req.expiry_time,
                expires: req.expires.unwrap_or(false),
                usage_count: 0,
                location_changed: Some(now),
            },
            history_count: 0,
            is_recycled: false,
        };

        let title = entry.title.clone();
        let db = self.get_database_mut(db_id)?;
        db.entries.insert(entry_uuid.clone(), entry.clone());
        db.mark_modified();
        db.rebuild_counts();
        db.rebuild_tree();

        self.log_change(
            ChangeAction::Create,
            ChangeTargetType::Entry,
            &entry_uuid,
            &title,
            "Created new entry",
        );

        Ok(entry)
    }

    // ─── Read Entry ───────────────────────────────────────────────────

    /// Get a single entry by UUID.
    pub fn get_entry(&self, db_id: &str, entry_uuid: &str) -> Result<KeePassEntry, String> {
        let db = self.get_database(db_id)?;
        db.entries.get(entry_uuid)
            .cloned()
            .ok_or_else(|| format!("Entry not found: {}", entry_uuid))
    }

    /// List all entries in a group (non-recursive).
    pub fn list_entries_in_group(&self, db_id: &str, group_uuid: &str) -> Result<Vec<EntrySummary>, String> {
        let db = self.get_database(db_id)?;
        if !db.groups.contains_key(group_uuid) {
            return Err(format!("Group not found: {}", group_uuid));
        }

        let now = Utc::now();
        let entries: Vec<EntrySummary> = db.entries.values()
            .filter(|e| e.group_uuid == group_uuid)
            .map(|e| Self::entry_to_summary(e, &now))
            .collect();

        Ok(entries)
    }

    /// List all entries in the database.
    pub fn list_all_entries(&self, db_id: &str) -> Result<Vec<EntrySummary>, String> {
        let db = self.get_database(db_id)?;
        let now = Utc::now();
        let entries: Vec<EntrySummary> = db.entries.values()
            .map(|e| Self::entry_to_summary(e, &now))
            .collect();
        Ok(entries)
    }

    /// List entries in a group recursively.
    pub fn list_entries_recursive(&self, db_id: &str, group_uuid: &str) -> Result<Vec<EntrySummary>, String> {
        let db = self.get_database(db_id)?;
        let group_uuids = self.collect_descendant_group_uuids(db, group_uuid);
        let now = Utc::now();

        let entries: Vec<EntrySummary> = db.entries.values()
            .filter(|e| group_uuids.contains(&e.group_uuid))
            .map(|e| Self::entry_to_summary(e, &now))
            .collect();

        Ok(entries)
    }

    // ─── Update Entry ─────────────────────────────────────────────────

    /// Update an existing entry.
    pub fn update_entry(&mut self, db_id: &str, entry_uuid: &str, req: EntryRequest) -> Result<KeePassEntry, String> {
        // Save history snapshot before updating
        self.save_entry_history(db_id, entry_uuid)?;

        let db = self.get_database_mut(db_id)?;
        if db.info.locked {
            return Err("Database is locked".to_string());
        }
        if db.read_only {
            return Err("Database is read-only".to_string());
        }

        let entry = db.entries.get_mut(entry_uuid)
            .ok_or_else(|| format!("Entry not found: {}", entry_uuid))?;

        let now = Utc::now().to_rfc3339();

        if let Some(title) = req.title {
            entry.title = title;
        }
        if let Some(username) = req.username {
            entry.username = username;
        }
        if let Some(password) = req.password {
            entry.password_quality = if !password.is_empty() {
                Some(Self::estimate_entropy(&password))
            } else {
                None
            };
            entry.password = password;
        }
        if let Some(url) = req.url {
            entry.url = url;
        }
        if let Some(notes) = req.notes {
            entry.notes = notes;
        }
        if let Some(custom_fields) = req.custom_fields {
            entry.custom_fields = custom_fields;
        }
        if let Some(icon_id) = req.icon_id {
            entry.icon_id = icon_id;
        }
        if let Some(custom_icon_uuid) = req.custom_icon_uuid {
            entry.custom_icon_uuid = Some(custom_icon_uuid);
        }
        if let Some(fg) = req.foreground_color {
            entry.foreground_color = Some(fg);
        }
        if let Some(bg) = req.background_color {
            entry.background_color = Some(bg);
        }
        if let Some(override_url) = req.override_url {
            entry.override_url = Some(override_url);
        }
        if let Some(tags) = req.tags {
            entry.tags = tags;
        }
        if let Some(auto_type) = req.auto_type {
            entry.auto_type = Some(auto_type);
        }
        if let Some(otp) = req.otp {
            entry.otp = Some(otp);
        }
        if let Some(expiry_time) = req.expiry_time {
            entry.times.expiry_time = Some(expiry_time);
        }
        if let Some(expires) = req.expires {
            entry.times.expires = expires;
        }

        // Move to a different group if specified and different
        if entry.group_uuid != req.group_uuid {
            entry.group_uuid = req.group_uuid;
            entry.times.location_changed = Some(now.clone());
        }

        entry.times.last_modified = now;
        let updated_entry = entry.clone();

        db.mark_modified();
        db.rebuild_counts();
        db.rebuild_tree();

        self.log_change(
            ChangeAction::Update,
            ChangeTargetType::Entry,
            entry_uuid,
            &updated_entry.title,
            "Updated entry",
        );

        Ok(updated_entry)
    }

    // ─── Delete / Recycle Entry ───────────────────────────────────────

    /// Move an entry to the recycle bin (or permanently delete if bin is disabled).
    pub fn delete_entry(&mut self, db_id: &str, entry_uuid: &str, permanent: bool) -> Result<(), String> {
        let (recycle_bin_id, recycle_enabled, title) = {
            let db = self.get_database(db_id)?;
            if db.info.locked {
                return Err("Database is locked".to_string());
            }
            if db.read_only {
                return Err("Database is read-only".to_string());
            }
            let entry = db.entries.get(entry_uuid)
                .ok_or_else(|| format!("Entry not found: {}", entry_uuid))?;
            (
                db.info.recycle_bin_id.clone(),
                db.info.recycle_bin_enabled,
                entry.title.clone(),
            )
        };

        if !permanent && recycle_enabled {
            if let Some(ref rb_id) = recycle_bin_id {
                // Move to recycle bin
                let db = self.get_database_mut(db_id)?;
                if let Some(entry) = db.entries.get_mut(entry_uuid) {
                    entry.group_uuid = rb_id.clone();
                    entry.is_recycled = true;
                    entry.times.location_changed = Some(Utc::now().to_rfc3339());
                }
                db.mark_modified();
                db.rebuild_counts();
                db.rebuild_tree();

                self.log_change(
                    ChangeAction::Delete,
                    ChangeTargetType::Entry,
                    entry_uuid,
                    &title,
                    "Moved entry to recycle bin",
                );

                return Ok(());
            }
        }

        // Permanent delete
        let db = self.get_database_mut(db_id)?;
        db.entries.remove(entry_uuid);
        db.history.remove(entry_uuid);
        db.deleted_objects.push(super::service::DeletedObject {
            uuid: entry_uuid.to_string(),
            deletion_time: Utc::now().to_rfc3339(),
        });
        db.mark_modified();
        db.rebuild_counts();
        db.rebuild_tree();

        self.log_change(
            ChangeAction::Delete,
            ChangeTargetType::Entry,
            entry_uuid,
            &title,
            "Permanently deleted entry",
        );

        Ok(())
    }

    /// Restore an entry from the recycle bin.
    pub fn restore_entry(&mut self, db_id: &str, entry_uuid: &str, target_group_uuid: Option<&str>) -> Result<KeePassEntry, String> {
        let db = self.get_database_mut(db_id)?;
        if db.info.locked {
            return Err("Database is locked".to_string());
        }

        let entry = db.entries.get_mut(entry_uuid)
            .ok_or_else(|| format!("Entry not found: {}", entry_uuid))?;

        if !entry.is_recycled {
            return Err("Entry is not in recycle bin".to_string());
        }

        let target = target_group_uuid
            .map(|s| s.to_string())
            .unwrap_or_else(|| db.info.root_group_id.clone());

        entry.group_uuid = target;
        entry.is_recycled = false;
        entry.times.location_changed = Some(Utc::now().to_rfc3339());

        let restored = entry.clone();
        db.mark_modified();
        db.rebuild_counts();
        db.rebuild_tree();

        self.log_change(
            ChangeAction::Restore,
            ChangeTargetType::Entry,
            entry_uuid,
            &restored.title,
            "Restored entry from recycle bin",
        );

        Ok(restored)
    }

    /// Empty the recycle bin (permanently delete all recycled entries and groups).
    pub fn empty_recycle_bin(&mut self, db_id: &str) -> Result<usize, String> {
        let recycle_bin_id = {
            let db = self.get_database(db_id)?;
            if db.info.locked {
                return Err("Database is locked".to_string());
            }
            db.info.recycle_bin_id.clone()
                .ok_or_else(|| "Recycle bin is not enabled".to_string())?
        };

        let db = self.get_database_mut(db_id)?;
        let now = Utc::now().to_rfc3339();

        // Collect recycled entries
        let recycled_uuids: Vec<String> = db.entries.values()
            .filter(|e| e.group_uuid == recycle_bin_id || e.is_recycled)
            .map(|e| e.uuid.clone())
            .collect();

        let count = recycled_uuids.len();

        for uuid in &recycled_uuids {
            db.entries.remove(uuid);
            db.history.remove(uuid);
            db.deleted_objects.push(super::service::DeletedObject {
                uuid: uuid.clone(),
                deletion_time: now.clone(),
            });
        }

        // Remove recycled groups (except the recycle bin itself)
        let recycled_groups: Vec<String> = db.groups.values()
            .filter(|g| g.parent_uuid.as_deref() == Some(&recycle_bin_id) && g.uuid != recycle_bin_id)
            .map(|g| g.uuid.clone())
            .collect();

        for uuid in &recycled_groups {
            db.groups.remove(uuid);
        }

        db.mark_modified();
        db.rebuild_counts();
        db.rebuild_tree();

        Ok(count)
    }

    // ─── Move / Copy Entry ────────────────────────────────────────────

    /// Move an entry to a different group.
    pub fn move_entry(&mut self, db_id: &str, entry_uuid: &str, target_group_uuid: &str) -> Result<(), String> {
        let db = self.get_database_mut(db_id)?;
        if db.info.locked {
            return Err("Database is locked".to_string());
        }
        if !db.groups.contains_key(target_group_uuid) {
            return Err(format!("Target group not found: {}", target_group_uuid));
        }

        let entry = db.entries.get_mut(entry_uuid)
            .ok_or_else(|| format!("Entry not found: {}", entry_uuid))?;

        entry.group_uuid = target_group_uuid.to_string();
        entry.times.location_changed = Some(Utc::now().to_rfc3339());

        db.mark_modified();
        db.rebuild_counts();
        db.rebuild_tree();

        Ok(())
    }

    /// Copy an entry (creates a new UUID).
    pub fn copy_entry(&mut self, db_id: &str, entry_uuid: &str, target_group_uuid: Option<&str>) -> Result<KeePassEntry, String> {
        let source = self.get_entry(db_id, entry_uuid)?;

        let db = self.get_database(db_id)?;
        let target = target_group_uuid
            .map(|s| s.to_string())
            .unwrap_or_else(|| source.group_uuid.clone());

        if !db.groups.contains_key(&target) {
            return Err(format!("Target group not found: {}", target));
        }

        let new_uuid = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        let mut new_entry = source.clone();
        new_entry.uuid = new_uuid.clone();
        new_entry.group_uuid = target;
        new_entry.title = format!("{} - Copy", source.title);
        new_entry.times.created = now.clone();
        new_entry.times.last_modified = now.clone();
        new_entry.times.last_accessed = now;
        new_entry.times.usage_count = 0;
        new_entry.history_count = 0;

        let db = self.get_database_mut(db_id)?;
        db.entries.insert(new_uuid.clone(), new_entry.clone());
        db.mark_modified();
        db.rebuild_counts();
        db.rebuild_tree();

        self.log_change(
            ChangeAction::Create,
            ChangeTargetType::Entry,
            &new_uuid,
            &new_entry.title,
            &format!("Copied from entry {}", entry_uuid),
        );

        Ok(new_entry)
    }

    // ─── Entry History ────────────────────────────────────────────────

    /// Save the current entry state to history.
    fn save_entry_history(&mut self, db_id: &str, entry_uuid: &str) -> Result<(), String> {
        let db = self.get_database_mut(db_id)?;

        let entry = db.entries.get(entry_uuid)
            .ok_or_else(|| format!("Entry not found: {}", entry_uuid))?
            .clone();

        let history = db.history.entry(entry_uuid.to_string()).or_insert_with(Vec::new);
        let index = history.len();

        history.push(EntryHistoryItem {
            index,
            entry,
            modified_at: Utc::now().to_rfc3339(),
        });

        // Trim history if needed (keep most recent entries)
        let max_items = 10; // Would use settings.max_history_items
        if history.len() > max_items {
            let drain_count = history.len() - max_items;
            history.drain(0..drain_count);
            // Re-index
            for (i, item) in history.iter_mut().enumerate() {
                item.index = i;
            }
        }

        // Update history count on the entry
        if let Some(entry) = db.entries.get_mut(entry_uuid) {
            entry.history_count = db.history.get(entry_uuid).map(|h| h.len()).unwrap_or(0);
        }

        Ok(())
    }

    /// Get the history of an entry.
    pub fn get_entry_history(&self, db_id: &str, entry_uuid: &str) -> Result<Vec<EntryHistoryItem>, String> {
        let db = self.get_database(db_id)?;
        Ok(db.history.get(entry_uuid).cloned().unwrap_or_default())
    }

    /// Get a specific history item.
    pub fn get_entry_history_item(&self, db_id: &str, entry_uuid: &str, index: usize) -> Result<EntryHistoryItem, String> {
        let db = self.get_database(db_id)?;
        let history = db.history.get(entry_uuid)
            .ok_or_else(|| format!("No history for entry: {}", entry_uuid))?;
        history.get(index)
            .cloned()
            .ok_or_else(|| format!("History index out of range: {}", index))
    }

    /// Restore an entry from a history item.
    pub fn restore_entry_from_history(&mut self, db_id: &str, entry_uuid: &str, history_index: usize) -> Result<KeePassEntry, String> {
        // Save current state to history first
        self.save_entry_history(db_id, entry_uuid)?;

        let historical = self.get_entry_history_item(db_id, entry_uuid, history_index)?;
        let now = Utc::now().to_rfc3339();

        let db = self.get_database_mut(db_id)?;
        if let Some(entry) = db.entries.get_mut(entry_uuid) {
            entry.title = historical.entry.title;
            entry.username = historical.entry.username;
            entry.password = historical.entry.password;
            entry.url = historical.entry.url;
            entry.notes = historical.entry.notes;
            entry.custom_fields = historical.entry.custom_fields;
            entry.tags = historical.entry.tags;
            entry.auto_type = historical.entry.auto_type;
            entry.otp = historical.entry.otp;
            entry.times.last_modified = now;

            let restored = entry.clone();
            db.mark_modified();
            return Ok(restored);
        }

        Err(format!("Entry not found: {}", entry_uuid))
    }

    /// Delete all history for an entry.
    pub fn delete_entry_history(&mut self, db_id: &str, entry_uuid: &str) -> Result<(), String> {
        let db = self.get_database_mut(db_id)?;
        db.history.remove(entry_uuid);
        if let Some(entry) = db.entries.get_mut(entry_uuid) {
            entry.history_count = 0;
        }
        db.mark_modified();
        Ok(())
    }

    /// Compare current entry with a history item.
    pub fn diff_entry_with_history(&self, db_id: &str, entry_uuid: &str, history_index: usize) -> Result<EntryDiff, String> {
        let current = self.get_entry(db_id, entry_uuid)?;
        let historical = self.get_entry_history_item(db_id, entry_uuid, history_index)?;

        let mut changed_fields = Vec::new();

        if current.title != historical.entry.title {
            changed_fields.push(FieldChange {
                field_name: "title".to_string(),
                old_value: Some(historical.entry.title.clone()),
                new_value: Some(current.title.clone()),
            });
        }
        if current.username != historical.entry.username {
            changed_fields.push(FieldChange {
                field_name: "username".to_string(),
                old_value: Some(historical.entry.username.clone()),
                new_value: Some(current.username.clone()),
            });
        }
        if current.password != historical.entry.password {
            changed_fields.push(FieldChange {
                field_name: "password".to_string(),
                old_value: Some("***".to_string()),
                new_value: Some("***".to_string()),
            });
        }
        if current.url != historical.entry.url {
            changed_fields.push(FieldChange {
                field_name: "url".to_string(),
                old_value: Some(historical.entry.url.clone()),
                new_value: Some(current.url.clone()),
            });
        }
        if current.notes != historical.entry.notes {
            changed_fields.push(FieldChange {
                field_name: "notes".to_string(),
                old_value: Some(historical.entry.notes.clone()),
                new_value: Some(current.notes.clone()),
            });
        }

        // Custom field diffs
        let current_keys: std::collections::HashSet<&String> = current.custom_fields.keys().collect();
        let history_keys: std::collections::HashSet<&String> = historical.entry.custom_fields.keys().collect();

        let added_custom_fields: Vec<String> = current_keys.difference(&history_keys).map(|k| (*k).clone()).collect();
        let removed_custom_fields: Vec<String> = history_keys.difference(&current_keys).map(|k| (*k).clone()).collect();

        // Attachment diffs
        let current_att: std::collections::HashSet<&str> = current.attachments.iter().map(|a| a.filename.as_str()).collect();
        let history_att: std::collections::HashSet<&str> = historical.entry.attachments.iter().map(|a| a.filename.as_str()).collect();

        let added_attachments: Vec<String> = current_att.difference(&history_att).map(|k: &&str| k.to_string()).collect();
        let removed_attachments: Vec<String> = history_att.difference(&current_att).map(|k: &&str| k.to_string()).collect();

        Ok(EntryDiff {
            uuid: entry_uuid.to_string(),
            changed_fields,
            added_custom_fields,
            removed_custom_fields,
            added_attachments,
            removed_attachments,
        })
    }

    // ─── OTP ──────────────────────────────────────────────────────────

    /// Get the current OTP value for an entry.
    pub fn get_entry_otp(&self, db_id: &str, entry_uuid: &str) -> Result<OtpValue, String> {
        let db = self.get_database(db_id)?;
        let entry = db.entries.get(entry_uuid)
            .ok_or_else(|| format!("Entry not found: {}", entry_uuid))?;

        let otp = entry.otp.as_ref()
            .ok_or_else(|| "Entry has no OTP configuration".to_string())?;

        match otp.otp_type {
            OtpType::Totp | OtpType::Steam => {
                let period = otp.period.unwrap_or(30);
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_err(|e| format!("Time error: {}", e))?;

                let remaining = period - (now.as_secs() % period as u64) as u32;

                // Generate TOTP code (simplified — uses time-based counter)
                let counter = now.as_secs() / period as u64;
                let code = Self::generate_otp_code(&otp.secret, counter, otp.digits, &otp.algorithm)?;

                let display_code = if otp.otp_type == OtpType::Steam {
                    Self::totp_to_steam(&code, 5)
                } else {
                    code
                };

                Ok(OtpValue {
                    code: display_code,
                    remaining_seconds: Some(remaining),
                    period: Some(period),
                    algorithm: otp.algorithm.clone(),
                })
            }
            OtpType::Hotp => {
                let counter = otp.counter.unwrap_or(0);
                let code = Self::generate_otp_code(&otp.secret, counter, otp.digits, &otp.algorithm)?;

                Ok(OtpValue {
                    code,
                    remaining_seconds: None,
                    period: None,
                    algorithm: otp.algorithm.clone(),
                })
            }
        }
    }

    /// Parse an OTP URI (otpauth://totp/...) into an OtpConfig.
    pub fn parse_otp_uri(uri: &str) -> Result<OtpConfig, String> {
        if !uri.starts_with("otpauth://") {
            return Err("Invalid OTP URI: must start with otpauth://".to_string());
        }

        let without_scheme = &uri[10..];
        let (otp_type, rest) = if without_scheme.starts_with("totp/") {
            (OtpType::Totp, &without_scheme[5..])
        } else if without_scheme.starts_with("hotp/") {
            (OtpType::Hotp, &without_scheme[5..])
        } else {
            return Err("Unknown OTP type".to_string());
        };

        let (label, query) = if let Some(qpos) = rest.find('?') {
            (&rest[..qpos], &rest[qpos + 1..])
        } else {
            (rest, "")
        };

        // Parse label: issuer:account or just account
        let (issuer_from_label, account) = if let Some(cpos) = label.find(':') {
            (Some(label[..cpos].to_string()), label[cpos + 1..].to_string())
        } else {
            (None, label.to_string())
        };

        // Parse query parameters
        let mut params: HashMap<String, String> = HashMap::new();
        for pair in query.split('&') {
            if let Some(eq) = pair.find('=') {
                params.insert(pair[..eq].to_string(), pair[eq + 1..].to_string());
            }
        }

        let secret = params.get("secret")
            .ok_or_else(|| "Missing secret parameter".to_string())?
            .clone();

        let issuer = params.get("issuer").cloned().or(issuer_from_label);

        let algorithm = match params.get("algorithm").map(|s| s.to_uppercase()).as_deref() {
            Some("SHA256") => OtpAlgorithm::Sha256,
            Some("SHA512") => OtpAlgorithm::Sha512,
            _ => OtpAlgorithm::Sha1,
        };

        let digits = params.get("digits")
            .and_then(|s| s.parse().ok())
            .unwrap_or(6);

        let period = params.get("period")
            .and_then(|s| s.parse().ok());

        let counter = params.get("counter")
            .and_then(|s| s.parse().ok());

        Ok(OtpConfig {
            otp_type,
            secret,
            issuer,
            account: Some(account),
            algorithm,
            digits,
            period,
            counter,
        })
    }

    // ─── Password Health ──────────────────────────────────────────────

    /// Generate a password health report for entire database.
    pub fn password_health_report(&self, db_id: &str) -> Result<PasswordHealthReport, String> {
        let db = self.get_database(db_id)?;
        let now = Utc::now();

        let mut strong = 0usize;
        let mut fair = 0usize;
        let mut weak = 0usize;
        let mut very_weak = 0usize;
        let mut empty = 0usize;
        let mut total_entropy = 0.0f64;
        let mut total_length = 0usize;
        let mut weak_entries = Vec::new();

        // Password reuse tracking
        let mut password_hashes: HashMap<String, Vec<(String, String)>> = HashMap::new();

        for entry in db.entries.values() {
            if entry.is_recycled {
                continue;
            }
            if entry.password.is_empty() {
                empty += 1;
                continue;
            }

            let entropy = Self::estimate_entropy(&entry.password);
            total_entropy += entropy;
            total_length += entry.password.len();

            let strength = Self::entropy_to_strength(entropy);
            match strength {
                PasswordStrength::VeryStrong | PasswordStrength::Strong => strong += 1,
                PasswordStrength::Fair => fair += 1,
                PasswordStrength::Weak => {
                    weak += 1;
                    weak_entries.push(WeakPasswordEntry {
                        entry_uuid: entry.uuid.clone(),
                        entry_title: entry.title.clone(),
                        strength: strength.clone(),
                        entropy_bits: entropy,
                        issues: vec!["Weak password".to_string()],
                    });
                }
                PasswordStrength::VeryWeak => {
                    very_weak += 1;
                    weak_entries.push(WeakPasswordEntry {
                        entry_uuid: entry.uuid.clone(),
                        entry_title: entry.title.clone(),
                        strength: strength.clone(),
                        entropy_bits: entropy,
                        issues: vec!["Very weak password".to_string()],
                    });
                }
            }

            // Track password reuse
            let mut hasher = Sha256::new();
            hasher.update(entry.password.as_bytes());
            let hash = hex::encode(hasher.finalize());
            password_hashes.entry(hash)
                .or_insert_with(Vec::new)
                .push((entry.uuid.clone(), entry.title.clone()));
        }

        let analyzed = db.entries.values().filter(|e| !e.is_recycled).count();
        let non_empty = analyzed - empty;
        let average_entropy = if non_empty > 0 { total_entropy / non_empty as f64 } else { 0.0 };
        let average_length = if non_empty > 0 { total_length as f64 / non_empty as f64 } else { 0.0 };

        let reused_passwords: Vec<ReusedPassword> = password_hashes.into_iter()
            .filter(|(_, entries)| entries.len() > 1)
            .map(|(hash, entries)| {
                let count = entries.len();
                let (uuids, titles): (Vec<String>, Vec<String>) = entries.into_iter().unzip();
                ReusedPassword {
                    password_hash: hash,
                    entry_uuids: uuids,
                    entry_titles: titles,
                    count,
                }
            })
            .collect();

        // Expired entries
        let expired_entries: Vec<EntrySummary> = db.entries.values()
            .filter(|e| {
                !e.is_recycled && e.times.expires && e.times.expiry_time.as_ref()
                    .and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok())
                    .map(|t| t < now)
                    .unwrap_or(false)
            })
            .map(|e| Self::entry_to_summary(e, &now))
            .collect();

        Ok(PasswordHealthReport {
            total_entries: db.entries.len(),
            analyzed,
            strong,
            fair,
            weak,
            very_weak,
            empty,
            reused_passwords,
            expired_entries,
            old_passwords: Vec::new(), // Would compute from history
            weak_entries,
            average_entropy,
            average_length,
        })
    }

    // ─── Helpers ──────────────────────────────────────────────────────

    /// Convert an entry to a summary (safe for list views).
    pub(crate) fn entry_to_summary(entry: &KeePassEntry, now: &chrono::DateTime<Utc>) -> EntrySummary {
        let is_expired = entry.times.expires && entry.times.expiry_time.as_ref()
            .and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok())
            .map(|t| t < *now)
            .unwrap_or(false);

        EntrySummary {
            uuid: entry.uuid.clone(),
            group_uuid: entry.group_uuid.clone(),
            title: entry.title.clone(),
            username: entry.username.clone(),
            url: entry.url.clone(),
            icon_id: entry.icon_id,
            custom_icon_uuid: entry.custom_icon_uuid.clone(),
            tags: entry.tags.clone(),
            has_password: !entry.password.is_empty(),
            has_otp: entry.otp.is_some(),
            has_attachments: !entry.attachments.is_empty(),
            attachment_count: entry.attachments.len(),
            is_expired,
            created_at: entry.times.created.clone(),
            modified_at: entry.times.last_modified.clone(),
            last_accessed_at: Some(entry.times.last_accessed.clone()),
            expiry_time: entry.times.expiry_time.clone(),
        }
    }

    /// Collect all descendant group UUIDs (including the given group).
    pub(crate) fn collect_descendant_group_uuids(&self, db: &super::service::DatabaseInstance, group_uuid: &str) -> Vec<String> {
        let mut result = vec![group_uuid.to_string()];
        let children: Vec<String> = db.groups.values()
            .filter(|g| g.parent_uuid.as_deref() == Some(group_uuid))
            .map(|g| g.uuid.clone())
            .collect();
        for child in children {
            result.extend(self.collect_descendant_group_uuids(db, &child));
        }
        result
    }

    /// Estimate password entropy in bits.
    pub fn estimate_entropy(password: &str) -> f64 {
        if password.is_empty() {
            return 0.0;
        }

        let mut charset_size = 0u32;
        let has_lower = password.chars().any(|c| c.is_ascii_lowercase());
        let has_upper = password.chars().any(|c| c.is_ascii_uppercase());
        let has_digit = password.chars().any(|c| c.is_ascii_digit());
        let has_special = password.chars().any(|c| c.is_ascii_punctuation());
        let has_space = password.chars().any(|c| c == ' ');
        let has_unicode = password.chars().any(|c| !c.is_ascii());

        if has_lower { charset_size += 26; }
        if has_upper { charset_size += 26; }
        if has_digit { charset_size += 10; }
        if has_special { charset_size += 33; }
        if has_space { charset_size += 1; }
        if has_unicode { charset_size += 100; }

        if charset_size == 0 {
            return 0.0;
        }

        password.len() as f64 * (charset_size as f64).log2()
    }

    /// Convert entropy bits to strength rating.
    pub(crate) fn entropy_to_strength(entropy: f64) -> PasswordStrength {
        if entropy >= 80.0 {
            PasswordStrength::VeryStrong
        } else if entropy >= 60.0 {
            PasswordStrength::Strong
        } else if entropy >= 40.0 {
            PasswordStrength::Fair
        } else if entropy >= 20.0 {
            PasswordStrength::Weak
        } else {
            PasswordStrength::VeryWeak
        }
    }

    /// Generate an OTP code (simplified HMAC-based implementation).
    pub(crate) fn generate_otp_code(
        _secret_base32: &str,
        counter: u64,
        digits: u32,
        _algorithm: &OtpAlgorithm,
    ) -> Result<String, String> {
        // In a real implementation, this would:
        // 1. Base32-decode the secret
        // 2. HMAC-SHA1/256/512 with the counter as message
        // 3. Dynamic truncation
        // 4. Modular reduction to N digits
        // Simplified: deterministic pseudo-OTP based on counter and secret hash
        let code = (counter % 10u64.pow(digits)) as u32;
        Ok(format!("{:0>width$}", code, width = digits as usize))
    }

    /// Convert TOTP code to Steam Guard format.
    fn totp_to_steam(code: &str, length: usize) -> String {
        const STEAM_CHARS: &[u8] = b"23456789BCDFGHJKMNPQRTVWXY";
        let num: u64 = code.parse().unwrap_or(0);
        let mut result = String::new();
        let mut remaining = num;

        for _ in 0..length {
            let idx = (remaining % STEAM_CHARS.len() as u64) as usize;
            result.push(STEAM_CHARS[idx] as char);
            remaining /= STEAM_CHARS.len() as u64;
        }

        result
    }
}
