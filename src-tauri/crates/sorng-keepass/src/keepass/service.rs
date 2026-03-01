// ── sorng-keepass / service ────────────────────────────────────────────────────
//
// Core KeePass service managing open databases, providing the central
// coordination layer between database I/O, entries, groups, crypto, and search.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use chrono::Utc;
use uuid::Uuid;

use super::types::*;

/// Type alias for Tauri state management.
pub type KeePassServiceState = Arc<Mutex<KeePassService>>;

/// Core KeePass service that manages open database instances.
pub struct KeePassService {
    /// Currently open databases (db_id → DatabaseInstance)
    databases: HashMap<String, DatabaseInstance>,
    /// Recently opened database files
    recent_databases: Vec<RecentDatabase>,
    /// Saved password generator profiles
    password_profiles: Vec<PasswordProfile>,
    /// Change log for undo tracking
    change_log: Vec<ChangeLogEntry>,
    /// Global settings
    settings: KeePassSettings,
}

/// An open database instance with its in-memory state.
pub struct DatabaseInstance {
    /// Database metadata and configuration
    pub info: KeePassDatabase,
    /// Root group with full tree
    pub root_group: GroupNode,
    /// All entries indexed by UUID
    pub entries: HashMap<String, KeePassEntry>,
    /// All groups indexed by UUID
    pub groups: HashMap<String, KeePassGroup>,
    /// Binary attachment pool
    pub attachment_pool: HashMap<String, AttachmentData>,
    /// Entry history (entry_uuid → history items)
    pub history: HashMap<String, Vec<EntryHistoryItem>>,
    /// Custom icons (icon_uuid → base64-encoded PNG)
    pub custom_icons: HashMap<String, String>,
    /// Deleted object UUIDs (for merge/sync)
    pub deleted_objects: Vec<DeletedObject>,
    /// The composite key used to open (kept for saving; never serialized)
    pub composite_key: Option<CompositeKeyInternal>,
    /// Whether opened as read-only
    pub read_only: bool,
    /// Next binary pool ref ID
    pub next_ref_id: u32,
}

/// Internal representation of the composite key (not serialized).
pub struct CompositeKeyInternal {
    pub password_hash: Option<Vec<u8>>,
    pub key_file_hash: Option<Vec<u8>>,
    pub combined_hash: Vec<u8>,
}

/// In-memory group tree node.
#[derive(Debug, Clone)]
pub struct GroupNode {
    pub uuid: String,
    pub name: String,
    pub children: Vec<GroupNode>,
    pub entry_uuids: Vec<String>,
}

/// Raw attachment data in the binary pool.
pub struct AttachmentData {
    pub data: Vec<u8>,
    pub hash: String,
    pub ref_count: usize,
}

/// A deleted object record for merge/sync tracking.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DeletedObject {
    pub uuid: String,
    pub deletion_time: String,
}

/// Global KeePass service settings.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct KeePassSettings {
    /// Auto-save interval in seconds (0 = disabled)
    pub auto_save_interval: u64,
    /// Auto-lock after idle seconds (0 = disabled)
    pub auto_lock_seconds: u64,
    /// Maximum recent databases to track
    pub max_recent_databases: usize,
    /// Default password generator profile ID
    pub default_password_profile: Option<String>,
    /// Whether to create backup on save
    pub backup_on_save: bool,
    /// Maximum backup files to keep
    pub max_backups: usize,
    /// Whether to clear clipboard after paste (seconds)
    pub clipboard_clear_seconds: u32,
    /// Default cipher for new databases
    pub default_cipher: KeePassCipher,
    /// Default KDF for new databases
    pub default_kdf: KdfAlgorithm,
    /// Maximum entry history items per entry
    pub max_history_items: usize,
    /// Maximum total history size in bytes per entry
    pub max_history_size: u64,
    /// Sort entries by title by default
    pub sort_entries_by_title: bool,
    /// Show expired entries warning on open
    pub warn_expired_entries: bool,
}

impl Default for KeePassSettings {
    fn default() -> Self {
        Self {
            auto_save_interval: 0,
            auto_lock_seconds: 300,
            max_recent_databases: 20,
            default_password_profile: None,
            backup_on_save: true,
            max_backups: 5,
            clipboard_clear_seconds: 12,
            default_cipher: KeePassCipher::Aes256,
            default_kdf: KdfAlgorithm::Argon2d,
            max_history_items: 10,
            max_history_size: 6 * 1024 * 1024,
            sort_entries_by_title: true,
            warn_expired_entries: true,
        }
    }
}

impl KeePassService {
    /// Create a new KeePass service wrapped in Arc<Mutex<>> for Tauri state.
    pub fn new() -> KeePassServiceState {
        let service = Self {
            databases: HashMap::new(),
            recent_databases: Vec::new(),
            password_profiles: Self::builtin_profiles(),
            change_log: Vec::new(),
            settings: KeePassSettings::default(),
        };
        Arc::new(Mutex::new(service))
    }

    // ─── Database Registry ────────────────────────────────────────────

    /// Get a reference to an open database.
    pub fn get_database(&self, db_id: &str) -> Result<&DatabaseInstance, String> {
        self.databases.get(db_id).ok_or_else(|| format!("Database not found: {}", db_id))
    }

    /// Get a mutable reference to an open database.
    pub fn get_database_mut(&mut self, db_id: &str) -> Result<&mut DatabaseInstance, String> {
        self.databases.get_mut(db_id).ok_or_else(|| format!("Database not found: {}", db_id))
    }

    /// List all currently open databases.
    pub fn list_databases(&self) -> Vec<KeePassDatabase> {
        self.databases.values().map(|db| db.info.clone()).collect()
    }

    /// Check if a database is open by file path.
    pub fn is_database_open(&self, file_path: &str) -> bool {
        self.databases.values().any(|db| db.info.file_path == file_path)
    }

    /// Get the ID of a database opened from a given file path.
    pub fn database_id_for_path(&self, file_path: &str) -> Option<String> {
        self.databases.iter()
            .find(|(_, db)| db.info.file_path == file_path)
            .map(|(id, _)| id.clone())
    }

    /// Register a newly opened/created database.
    pub fn register_database(&mut self, instance: DatabaseInstance) -> String {
        let db_id = instance.info.id.clone();
        self.databases.insert(db_id.clone(), instance);
        db_id
    }

    /// Remove a database from the open registry.
    pub fn unregister_database(&mut self, db_id: &str) -> Result<DatabaseInstance, String> {
        self.databases.remove(db_id).ok_or_else(|| format!("Database not found: {}", db_id))
    }

    /// Count open databases.
    pub fn open_database_count(&self) -> usize {
        self.databases.len()
    }

    // ─── Recent Databases ─────────────────────────────────────────────

    /// Add or update a recent database entry.
    pub fn add_recent_database(&mut self, file_path: &str, name: &str) {
        let now = Utc::now().to_rfc3339();
        let file_exists = std::path::Path::new(file_path).exists();
        let file_size = std::fs::metadata(file_path).ok().map(|m| m.len());

        // Remove existing entry for this path
        self.recent_databases.retain(|r| r.file_path != file_path);

        self.recent_databases.insert(0, RecentDatabase {
            file_path: file_path.to_string(),
            name: name.to_string(),
            last_opened: now,
            file_exists,
            file_size,
            is_favorite: false,
        });

        // Trim to max
        let max = self.settings.max_recent_databases;
        if self.recent_databases.len() > max {
            self.recent_databases.truncate(max);
        }
    }

    /// List recent databases.
    pub fn list_recent_databases(&self) -> Vec<RecentDatabase> {
        self.recent_databases.clone()
    }

    /// Toggle favorite status of a recent database.
    pub fn toggle_favorite(&mut self, file_path: &str) -> Result<bool, String> {
        if let Some(recent) = self.recent_databases.iter_mut().find(|r| r.file_path == file_path) {
            recent.is_favorite = !recent.is_favorite;
            Ok(recent.is_favorite)
        } else {
            Err(format!("Not in recent list: {}", file_path))
        }
    }

    /// Remove a path from recent databases list.
    pub fn remove_recent_database(&mut self, file_path: &str) {
        self.recent_databases.retain(|r| r.file_path != file_path);
    }

    /// Clear all recent databases.
    pub fn clear_recent_databases(&mut self) {
        self.recent_databases.clear();
    }

    // ─── Password Profiles ────────────────────────────────────────────

    /// List password generator profiles.
    pub fn list_password_profiles(&self) -> Vec<PasswordProfile> {
        self.password_profiles.clone()
    }

    /// Get a password profile by ID.
    pub fn get_password_profile(&self, id: &str) -> Option<PasswordProfile> {
        self.password_profiles.iter().find(|p| p.id == id).cloned()
    }

    /// Save or update a password profile.
    pub fn save_password_profile(&mut self, mut profile: PasswordProfile) -> String {
        let now = Utc::now().to_rfc3339();
        if profile.id.is_empty() {
            profile.id = Uuid::new_v4().to_string();
            profile.created_at = now.clone();
        }
        profile.modified_at = now;
        profile.is_builtin = false;

        if let Some(existing) = self.password_profiles.iter_mut().find(|p| p.id == profile.id) {
            *existing = profile.clone();
        } else {
            self.password_profiles.push(profile.clone());
        }
        profile.id
    }

    /// Delete a custom password profile.
    pub fn delete_password_profile(&mut self, id: &str) -> Result<(), String> {
        let initial_len = self.password_profiles.len();
        self.password_profiles.retain(|p| p.id != id || p.is_builtin);
        if self.password_profiles.len() == initial_len {
            Err(format!("Profile not found or is built-in: {}", id))
        } else {
            Ok(())
        }
    }

    // ─── Change Log ───────────────────────────────────────────────────

    /// Record a change to the log.
    pub fn log_change(
        &mut self,
        action: ChangeAction,
        target_type: ChangeTargetType,
        target_uuid: &str,
        target_name: &str,
        description: &str,
    ) {
        let entry = ChangeLogEntry {
            id: Uuid::new_v4().to_string(),
            timestamp: Utc::now().to_rfc3339(),
            action,
            target_type,
            target_uuid: target_uuid.to_string(),
            target_name: target_name.to_string(),
            description: description.to_string(),
            reversible: true,
        };
        self.change_log.push(entry);

        // Limit log size
        if self.change_log.len() > 1000 {
            self.change_log.drain(0..500);
        }
    }

    /// Get change log entries (most recent first).
    pub fn get_change_log(&self, limit: Option<usize>) -> Vec<ChangeLogEntry> {
        let mut log: Vec<_> = self.change_log.iter().rev().cloned().collect();
        if let Some(limit) = limit {
            log.truncate(limit);
        }
        log
    }

    /// Clear the change log.
    pub fn clear_change_log(&mut self) {
        self.change_log.clear();
    }

    // ─── Settings ─────────────────────────────────────────────────────

    /// Get current settings.
    pub fn get_settings(&self) -> KeePassSettings {
        self.settings.clone()
    }

    /// Update settings.
    pub fn update_settings(&mut self, settings: KeePassSettings) {
        self.settings = settings;
    }

    // ─── Shutdown ─────────────────────────────────────────────────────

    /// Close all open databases and clean up.
    pub fn shutdown(&mut self) -> Vec<String> {
        let db_ids: Vec<String> = self.databases.keys().cloned().collect();
        self.databases.clear();
        db_ids
    }

    // ─── Built-in Profiles ────────────────────────────────────────────

    fn builtin_profiles() -> Vec<PasswordProfile> {
        let now = Utc::now().to_rfc3339();
        vec![
            PasswordProfile {
                id: "builtin-strong".to_string(),
                name: "Strong (20 chars)".to_string(),
                description: "Upper, lower, digits, special — 20 characters".to_string(),
                config: PasswordGeneratorRequest {
                    mode: PasswordGenMode::CharacterSet,
                    length: 20,
                    character_sets: Some(vec![
                        CharacterSet::UpperCase,
                        CharacterSet::LowerCase,
                        CharacterSet::Digits,
                        CharacterSet::Special,
                    ]),
                    custom_characters: None,
                    exclude_characters: None,
                    exclude_lookalikes: true,
                    ensure_each_set: true,
                    pattern: None,
                    count: None,
                },
                is_builtin: true,
                created_at: now.clone(),
                modified_at: now.clone(),
            },
            PasswordProfile {
                id: "builtin-pin".to_string(),
                name: "PIN (6 digits)".to_string(),
                description: "Numeric PIN — 6 digits".to_string(),
                config: PasswordGeneratorRequest {
                    mode: PasswordGenMode::CharacterSet,
                    length: 6,
                    character_sets: Some(vec![CharacterSet::Digits]),
                    custom_characters: None,
                    exclude_characters: None,
                    exclude_lookalikes: false,
                    ensure_each_set: false,
                    pattern: None,
                    count: None,
                },
                is_builtin: true,
                created_at: now.clone(),
                modified_at: now.clone(),
            },
            PasswordProfile {
                id: "builtin-hex".to_string(),
                name: "Hex Key (40 chars)".to_string(),
                description: "Hex characters — 40 characters".to_string(),
                config: PasswordGeneratorRequest {
                    mode: PasswordGenMode::Pattern,
                    length: 40,
                    character_sets: None,
                    custom_characters: None,
                    exclude_characters: None,
                    exclude_lookalikes: false,
                    ensure_each_set: false,
                    pattern: Some("h".repeat(40)),
                    count: None,
                },
                is_builtin: true,
                created_at: now.clone(),
                modified_at: now.clone(),
            },
            PasswordProfile {
                id: "builtin-memorable".to_string(),
                name: "Memorable (16 chars)".to_string(),
                description: "Upper, lower, digits — 16 characters, no special".to_string(),
                config: PasswordGeneratorRequest {
                    mode: PasswordGenMode::CharacterSet,
                    length: 16,
                    character_sets: Some(vec![
                        CharacterSet::UpperCase,
                        CharacterSet::LowerCase,
                        CharacterSet::Digits,
                    ]),
                    custom_characters: None,
                    exclude_characters: None,
                    exclude_lookalikes: true,
                    ensure_each_set: true,
                    pattern: None,
                    count: None,
                },
                is_builtin: true,
                created_at: now.clone(),
                modified_at: now,
            },
        ]
    }
}

// ─── DatabaseInstance helpers ──────────────────────────────────────────────────

impl DatabaseInstance {
    /// Create a new empty database instance.
    pub fn new_empty(info: KeePassDatabase) -> Self {
        let root_uuid = info.root_group_id.clone();
        Self {
            info,
            root_group: GroupNode {
                uuid: root_uuid.clone(),
                name: "Root".to_string(),
                children: Vec::new(),
                entry_uuids: Vec::new(),
            },
            entries: HashMap::new(),
            groups: HashMap::new(),
            attachment_pool: HashMap::new(),
            history: HashMap::new(),
            custom_icons: HashMap::new(),
            deleted_objects: Vec::new(),
            composite_key: None,
            read_only: false,
            next_ref_id: 1,
        }
    }

    /// Mark the database as modified.
    pub fn mark_modified(&mut self) {
        self.info.modified = true;
        self.info.modified_at = Utc::now().to_rfc3339();
    }

    /// Get the next available binary pool ref ID.
    pub fn next_attachment_ref_id(&mut self) -> String {
        let id = self.next_ref_id;
        self.next_ref_id += 1;
        id.to_string()
    }

    /// Rebuild the entry and group counts.
    pub fn rebuild_counts(&mut self) {
        self.info.entry_count = self.entries.len();
        self.info.group_count = self.groups.len();
        self.info.custom_icon_count = self.custom_icons.len();

        // Pre-compute counts to avoid borrow conflicts
        let entry_counts: HashMap<String, usize> = {
            let mut counts = HashMap::new();
            for entry in self.entries.values() {
                *counts.entry(entry.group_uuid.clone()).or_insert(0) += 1;
            }
            counts
        };
        let child_counts: HashMap<String, usize> = {
            let mut counts = HashMap::new();
            for group in self.groups.values() {
                if let Some(ref parent) = group.parent_uuid {
                    *counts.entry(parent.clone()).or_insert(0) += 1;
                }
            }
            counts
        };

        for group in self.groups.values_mut() {
            group.entry_count = *entry_counts.get(&group.uuid).unwrap_or(&0);
            group.child_group_count = *child_counts.get(&group.uuid).unwrap_or(&0);
            group.total_entry_count = group.entry_count; // simplified; recursive would require tree walk
        }
    }

    /// Rebuild the group tree from flat group map.
    pub fn rebuild_tree(&mut self) {
        let root_uuid = self.info.root_group_id.clone();
        self.root_group = self.build_subtree(&root_uuid);
    }

    fn build_subtree(&self, parent_uuid: &str) -> GroupNode {
        let name = self.groups.get(parent_uuid)
            .map(|g| g.name.clone())
            .unwrap_or_else(|| "Root".to_string());

        let entry_uuids: Vec<String> = self.entries.values()
            .filter(|e| e.group_uuid == parent_uuid)
            .map(|e| e.uuid.clone())
            .collect();

        let child_uuids: Vec<String> = self.groups.values()
            .filter(|g| g.parent_uuid.as_deref() == Some(parent_uuid))
            .map(|g| g.uuid.clone())
            .collect();

        let children = child_uuids.iter()
            .map(|uuid| self.build_subtree(uuid))
            .collect();

        GroupNode {
            uuid: parent_uuid.to_string(),
            name,
            children,
            entry_uuids,
        }
    }
}
