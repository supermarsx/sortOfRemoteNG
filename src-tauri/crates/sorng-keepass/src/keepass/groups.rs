// ── sorng-keepass / groups ─────────────────────────────────────────────────────
//
// Group (folder) management: create, read, update, delete, move,
// tree operations, recycle bin support.

use chrono::Utc;
use uuid::Uuid;
use std::collections::HashMap;

use super::types::*;
use super::service::KeePassService;

impl KeePassService {
    // ─── Create Group ─────────────────────────────────────────────────

    /// Create a new group in a database.
    pub fn create_group(&mut self, db_id: &str, req: GroupRequest) -> Result<KeePassGroup, String> {
        let parent_uuid = {
            let db = self.get_database(db_id)?;
            if db.info.locked {
                return Err("Database is locked".to_string());
            }
            if db.read_only {
                return Err("Database is read-only".to_string());
            }

            let parent = req.parent_uuid.as_deref()
                .unwrap_or(&db.info.root_group_id);

            if !db.groups.contains_key(parent) {
                return Err(format!("Parent group not found: {}", parent));
            }
            parent.to_string()
        };

        let now = Utc::now().to_rfc3339();
        let group_uuid = Uuid::new_v4().to_string();

        let group = KeePassGroup {
            uuid: group_uuid.clone(),
            name: req.name.clone(),
            notes: req.notes.unwrap_or_default(),
            icon_id: req.icon_id.unwrap_or(48), // default folder icon
            custom_icon_uuid: req.custom_icon_uuid,
            parent_uuid: Some(parent_uuid),
            is_expanded: true,
            default_auto_type_sequence: req.default_auto_type_sequence,
            enable_auto_type: req.enable_auto_type,
            enable_searching: req.enable_searching,
            last_top_visible_entry: None,
            is_recycle_bin: false,
            entry_count: 0,
            child_group_count: 0,
            total_entry_count: 0,
            times: KeePassTimes {
                created: now.clone(),
                last_modified: now.clone(),
                last_accessed: now.clone(),
                expiry_time: None,
                expires: false,
                usage_count: 0,
                location_changed: Some(now),
            },
            tags: req.tags.unwrap_or_default(),
            custom_data: HashMap::new(),
        };

        let name = group.name.clone();
        let db = self.get_database_mut(db_id)?;
        db.groups.insert(group_uuid.clone(), group.clone());
        db.mark_modified();
        db.rebuild_counts();
        db.rebuild_tree();

        self.log_change(
            ChangeAction::Create,
            ChangeTargetType::Group,
            &group_uuid,
            &name,
            "Created new group",
        );

        Ok(group)
    }

    // ─── Read Groups ──────────────────────────────────────────────────

    /// Get a single group by UUID.
    pub fn get_group(&self, db_id: &str, group_uuid: &str) -> Result<KeePassGroup, String> {
        let db = self.get_database(db_id)?;
        db.groups.get(group_uuid)
            .cloned()
            .ok_or_else(|| format!("Group not found: {}", group_uuid))
    }

    /// List all groups in a database (flat list).
    pub fn list_groups(&self, db_id: &str) -> Result<Vec<KeePassGroup>, String> {
        let db = self.get_database(db_id)?;
        Ok(db.groups.values().cloned().collect())
    }

    /// List child groups of a parent.
    pub fn list_child_groups(&self, db_id: &str, parent_uuid: &str) -> Result<Vec<KeePassGroup>, String> {
        let db = self.get_database(db_id)?;
        Ok(db.groups.values()
            .filter(|g| g.parent_uuid.as_deref() == Some(parent_uuid))
            .cloned()
            .collect())
    }

    /// Get the entire group tree for hierarchical display.
    pub fn get_group_tree(&self, db_id: &str) -> Result<GroupTreeNode, String> {
        let db = self.get_database(db_id)?;
        let root_uuid = db.info.root_group_id.clone();
        Ok(self.build_tree_node(db, &root_uuid, 0))
    }

    fn build_tree_node(&self, db: &super::service::DatabaseInstance, group_uuid: &str, depth: usize) -> GroupTreeNode {
        let group = db.groups.get(group_uuid);

        let name = group.map(|g| g.name.clone()).unwrap_or_else(|| "Root".to_string());
        let icon_id = group.map(|g| g.icon_id).unwrap_or(49);
        let custom_icon_uuid = group.and_then(|g| g.custom_icon_uuid.clone());
        let is_recycle_bin = group.map(|g| g.is_recycle_bin).unwrap_or(false);

        let entry_count = db.entries.values()
            .filter(|e| e.group_uuid == group_uuid)
            .count();

        let child_uuids: Vec<String> = db.groups.values()
            .filter(|g| g.parent_uuid.as_deref() == Some(group_uuid))
            .map(|g| g.uuid.clone())
            .collect();

        let children = child_uuids.iter()
            .map(|uuid| self.build_tree_node(db, uuid, depth + 1))
            .collect();

        GroupTreeNode {
            uuid: group_uuid.to_string(),
            name,
            icon_id,
            custom_icon_uuid,
            is_recycle_bin,
            entry_count,
            children,
            depth,
        }
    }

    /// Get the full path of a group (e.g., "Root/Internet/Banking").
    pub fn get_group_path(&self, db_id: &str, group_uuid: &str) -> Result<String, String> {
        let db = self.get_database(db_id)?;
        let mut path_parts = Vec::new();
        let mut current_uuid = Some(group_uuid.to_string());

        while let Some(uuid) = current_uuid {
            if let Some(group) = db.groups.get(&uuid) {
                path_parts.push(group.name.clone());
                current_uuid = group.parent_uuid.clone();
            } else {
                break;
            }
        }

        path_parts.reverse();
        Ok(path_parts.join("/"))
    }

    // ─── Update Group ─────────────────────────────────────────────────

    /// Update a group's properties.
    pub fn update_group(&mut self, db_id: &str, group_uuid: &str, req: GroupRequest) -> Result<KeePassGroup, String> {
        let db = self.get_database_mut(db_id)?;
        if db.info.locked {
            return Err("Database is locked".to_string());
        }
        if db.read_only {
            return Err("Database is read-only".to_string());
        }

        {
            let group = db.groups.get_mut(group_uuid)
                .ok_or_else(|| format!("Group not found: {}", group_uuid))?;

            group.name = req.name;
            if let Some(icon_id) = req.icon_id {
                group.icon_id = icon_id;
            }
            if let Some(custom_icon_uuid) = req.custom_icon_uuid {
                group.custom_icon_uuid = Some(custom_icon_uuid);
            }
            if let Some(notes) = req.notes {
                group.notes = notes;
            }
            if let Some(seq) = req.default_auto_type_sequence {
                group.default_auto_type_sequence = Some(seq);
            }
            if let Some(enable) = req.enable_auto_type {
                group.enable_auto_type = Some(enable);
            }
            if let Some(enable) = req.enable_searching {
                group.enable_searching = Some(enable);
            }
            if let Some(tags) = req.tags {
                group.tags = tags;
            }
        }

        // Handle parent change (move)
        if let Some(ref new_parent) = req.parent_uuid {
            let current_parent = db.groups.get(group_uuid).and_then(|g| g.parent_uuid.clone());
            if current_parent.as_deref() != Some(new_parent) {
                if !db.groups.contains_key(new_parent) {
                    return Err(format!("New parent group not found: {}", new_parent));
                }
                let group = db.groups.get_mut(group_uuid).unwrap();
                group.parent_uuid = Some(new_parent.clone());
                group.times.location_changed = Some(Utc::now().to_rfc3339());
            }
        }

        let group = db.groups.get_mut(group_uuid).unwrap();
        group.times.last_modified = Utc::now().to_rfc3339();
        let updated = group.clone();

        db.mark_modified();
        db.rebuild_counts();
        db.rebuild_tree();

        self.log_change(
            ChangeAction::Update,
            ChangeTargetType::Group,
            group_uuid,
            &updated.name,
            "Updated group",
        );

        Ok(updated)
    }

    // ─── Delete Group ─────────────────────────────────────────────────

    /// Delete a group (moves to recycle bin or permanently deletes).
    pub fn delete_group(&mut self, db_id: &str, group_uuid: &str, permanent: bool) -> Result<usize, String> {
        let (recycle_bin_id, recycle_enabled, _root_group_id, group_name) = {
            let db = self.get_database(db_id)?;
            if db.info.locked {
                return Err("Database is locked".to_string());
            }
            if db.read_only {
                return Err("Database is read-only".to_string());
            }
            let group = db.groups.get(group_uuid)
                .ok_or_else(|| format!("Group not found: {}", group_uuid))?;

            if group_uuid == db.info.root_group_id {
                return Err("Cannot delete the root group".to_string());
            }
            if group.is_recycle_bin {
                return Err("Cannot delete the recycle bin group directly (use empty_recycle_bin)".to_string());
            }

            (
                db.info.recycle_bin_id.clone(),
                db.info.recycle_bin_enabled,
                db.info.root_group_id.clone(),
                group.name.clone(),
            )
        };

        // Collect all descendant groups and entries
        let db = self.get_database(db_id)?;
        let descendant_groups = self.collect_descendant_group_uuids(db, group_uuid);
        // Get entry UUIDs affected by group deletion
        let entry_uuids: Vec<String> = db.entries.values()
            .filter(|e| descendant_groups.contains(&e.group_uuid))
            .map(|e| e.uuid.clone())
            .collect();

        let total_affected = entry_uuids.len() + descendant_groups.len();

        if !permanent && recycle_enabled {
            if let Some(ref rb_id) = recycle_bin_id {
                // Move group to recycle bin
                let db = self.get_database_mut(db_id)?;
                if let Some(group) = db.groups.get_mut(group_uuid) {
                    group.parent_uuid = Some(rb_id.clone());
                    group.times.location_changed = Some(Utc::now().to_rfc3339());
                }
                // Mark entries as recycled
                for uuid in &entry_uuids {
                    if let Some(entry) = db.entries.get_mut(uuid) {
                        entry.is_recycled = true;
                    }
                }

                db.mark_modified();
                db.rebuild_counts();
                db.rebuild_tree();

                self.log_change(
                    ChangeAction::Delete,
                    ChangeTargetType::Group,
                    group_uuid,
                    &group_name,
                    &format!("Moved group to recycle bin ({} entries)", entry_uuids.len()),
                );

                return Ok(total_affected);
            }
        }

        // Permanent delete
        let now = Utc::now().to_rfc3339();
        let db = self.get_database_mut(db_id)?;

        for uuid in &entry_uuids {
            db.entries.remove(uuid);
            db.history.remove(uuid);
            db.deleted_objects.push(super::service::DeletedObject {
                uuid: uuid.clone(),
                deletion_time: now.clone(),
            });
        }

        for uuid in &descendant_groups {
            db.groups.remove(uuid);
            db.deleted_objects.push(super::service::DeletedObject {
                uuid: uuid.clone(),
                deletion_time: now.clone(),
            });
        }

        db.mark_modified();
        db.rebuild_counts();
        db.rebuild_tree();

        self.log_change(
            ChangeAction::Delete,
            ChangeTargetType::Group,
            group_uuid,
            &group_name,
            &format!("Permanently deleted group ({} entries, {} subgroups)", entry_uuids.len(), descendant_groups.len() - 1),
        );

        Ok(total_affected)
    }

    // ─── Move Group ───────────────────────────────────────────────────

    /// Move a group to a new parent.
    pub fn move_group(&mut self, db_id: &str, group_uuid: &str, new_parent_uuid: &str) -> Result<(), String> {
        // Validate move is not circular
        {
            let db = self.get_database(db_id)?;
            if db.info.locked {
                return Err("Database is locked".to_string());
            }
            if group_uuid == new_parent_uuid {
                return Err("Cannot move a group into itself".to_string());
            }
            if group_uuid == db.info.root_group_id {
                return Err("Cannot move the root group".to_string());
            }
            if !db.groups.contains_key(new_parent_uuid) {
                return Err(format!("Target parent group not found: {}", new_parent_uuid));
            }

            // Check for circular reference
            let descendants = self.collect_descendant_group_uuids(db, group_uuid);
            if descendants.contains(&new_parent_uuid.to_string()) {
                return Err("Cannot move a group into its own descendant".to_string());
            }
        }

        let db = self.get_database_mut(db_id)?;
        if let Some(group) = db.groups.get_mut(group_uuid) {
            group.parent_uuid = Some(new_parent_uuid.to_string());
            group.times.location_changed = Some(Utc::now().to_rfc3339());
        }

        db.mark_modified();
        db.rebuild_counts();
        db.rebuild_tree();

        self.log_change(
            ChangeAction::Move,
            ChangeTargetType::Group,
            group_uuid,
            "",
            &format!("Moved group to {}", new_parent_uuid),
        );

        Ok(())
    }

    // ─── Sort Groups ──────────────────────────────────────────────────

    /// Sort child groups of a parent alphabetically.
    pub fn sort_groups(&self, db_id: &str, parent_uuid: &str) -> Result<Vec<KeePassGroup>, String> {
        let db = self.get_database(db_id)?;
        let mut children: Vec<KeePassGroup> = db.groups.values()
            .filter(|g| g.parent_uuid.as_deref() == Some(parent_uuid))
            .cloned()
            .collect();

        children.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(children)
    }

    // ─── Group Statistics ─────────────────────────────────────────────

    /// Get entry count for a group (recursive).
    pub fn group_entry_count(&self, db_id: &str, group_uuid: &str, recursive: bool) -> Result<usize, String> {
        let db = self.get_database(db_id)?;

        if recursive {
            let descendant_groups = self.collect_descendant_group_uuids(db, group_uuid);
            Ok(db.entries.values()
                .filter(|e| descendant_groups.contains(&e.group_uuid))
                .count())
        } else {
            Ok(db.entries.values()
                .filter(|e| e.group_uuid == group_uuid)
                .count())
        }
    }

    /// Get all tags used by entries in a group (recursive).
    pub fn group_tags(&self, db_id: &str, group_uuid: &str) -> Result<Vec<TagCount>, String> {
        let db = self.get_database(db_id)?;
        let descendant_groups = self.collect_descendant_group_uuids(db, group_uuid);

        let mut tag_counts: HashMap<String, usize> = HashMap::new();
        for entry in db.entries.values() {
            if descendant_groups.contains(&entry.group_uuid) {
                for tag in &entry.tags {
                    *tag_counts.entry(tag.clone()).or_insert(0) += 1;
                }
            }
        }

        let mut tags: Vec<TagCount> = tag_counts.into_iter()
            .map(|(tag, count)| TagCount { tag, count })
            .collect();
        tags.sort_by(|a, b| b.count.cmp(&a.count));
        Ok(tags)
    }

    // ─── Custom Icons ─────────────────────────────────────────────────

    /// Add a custom icon to the database.
    pub fn add_custom_icon(&mut self, db_id: &str, icon_data_base64: &str) -> Result<String, String> {
        let icon_uuid = Uuid::new_v4().to_string();
        let db = self.get_database_mut(db_id)?;
        db.custom_icons.insert(icon_uuid.clone(), icon_data_base64.to_string());
        db.info.custom_icon_count = db.custom_icons.len();
        db.mark_modified();
        Ok(icon_uuid)
    }

    /// Get a custom icon by UUID.
    pub fn get_custom_icon(&self, db_id: &str, icon_uuid: &str) -> Result<String, String> {
        let db = self.get_database(db_id)?;
        db.custom_icons.get(icon_uuid)
            .cloned()
            .ok_or_else(|| format!("Custom icon not found: {}", icon_uuid))
    }

    /// List all custom icon UUIDs.
    pub fn list_custom_icons(&self, db_id: &str) -> Result<Vec<String>, String> {
        let db = self.get_database(db_id)?;
        Ok(db.custom_icons.keys().cloned().collect())
    }

    /// Delete a custom icon.
    pub fn delete_custom_icon(&mut self, db_id: &str, icon_uuid: &str) -> Result<(), String> {
        let db = self.get_database_mut(db_id)?;
        db.custom_icons.remove(icon_uuid)
            .ok_or_else(|| format!("Custom icon not found: {}", icon_uuid))?;
        db.info.custom_icon_count = db.custom_icons.len();
        db.mark_modified();
        Ok(())
    }
}
