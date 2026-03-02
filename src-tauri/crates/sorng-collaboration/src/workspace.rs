//! # Workspace Manager
//!
//! Manages shared workspace lifecycle — creation, membership, archival, and persistence.

use crate::types::*;
use chrono::Utc;
use std::collections::HashMap;

/// Manages all shared workspaces and their membership.
pub struct WorkspaceManager {
    /// All workspaces indexed by ID
    workspaces: HashMap<String, SharedWorkspace>,
    /// Persistence directory
    data_dir: String,
}

impl WorkspaceManager {
    pub fn new(data_dir: &str) -> Self {
        let mut mgr = Self {
            workspaces: HashMap::new(),
            data_dir: data_dir.to_string(),
        };
        mgr.load_from_disk();
        mgr
    }

    /// Create a new shared workspace.
    pub fn create(
        &mut self,
        name: String,
        description: Option<String>,
        owner: &CollabUser,
    ) -> Result<SharedWorkspace, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now();
        let mut members = HashMap::new();
        members.insert(owner.id.clone(), WorkspaceRole::Owner);

        let workspace = SharedWorkspace {
            id: id.clone(),
            name,
            description,
            owner_id: owner.id.clone(),
            members,
            team_access: HashMap::new(),
            connection_ids: Vec::new(),
            folder_ids: Vec::new(),
            archived: false,
            settings: WorkspaceSettings::default(),
            created_at: now,
            updated_at: now,
        };
        self.workspaces.insert(id, workspace.clone());
        self.persist();
        Ok(workspace)
    }

    /// Get a workspace by ID.
    pub fn get(&self, workspace_id: &str) -> Result<Option<SharedWorkspace>, String> {
        Ok(self.workspaces.get(workspace_id).cloned())
    }

    /// List all workspaces the given user is a member of.
    pub fn list_for_user(&self, user_id: &str) -> Vec<SharedWorkspace> {
        self.workspaces
            .values()
            .filter(|ws| ws.members.contains_key(user_id))
            .cloned()
            .collect()
    }

    /// Add a member to a workspace.
    pub fn add_member(
        &mut self,
        workspace_id: &str,
        user_id: &str,
        role: WorkspaceRole,
    ) -> Result<(), String> {
        let ws = self
            .workspaces
            .get_mut(workspace_id)
            .ok_or("Workspace not found")?;
        if ws.archived {
            return Err("Cannot modify archived workspace".to_string());
        }
        ws.members.insert(user_id.to_string(), role);
        ws.updated_at = Utc::now();
        self.persist();
        Ok(())
    }

    /// Remove a member from a workspace.
    pub fn remove_member(
        &mut self,
        workspace_id: &str,
        user_id: &str,
    ) -> Result<(), String> {
        let ws = self
            .workspaces
            .get_mut(workspace_id)
            .ok_or("Workspace not found")?;
        if ws.owner_id == user_id {
            return Err("Cannot remove the workspace owner".to_string());
        }
        ws.members.remove(user_id);
        ws.updated_at = Utc::now();
        self.persist();
        Ok(())
    }

    /// Change a member's role in a workspace.
    pub fn change_member_role(
        &mut self,
        workspace_id: &str,
        user_id: &str,
        new_role: WorkspaceRole,
    ) -> Result<(), String> {
        let ws = self
            .workspaces
            .get_mut(workspace_id)
            .ok_or("Workspace not found")?;
        if !ws.members.contains_key(user_id) {
            return Err("User is not a member of this workspace".to_string());
        }
        if ws.owner_id == user_id && new_role != WorkspaceRole::Owner {
            return Err("Cannot demote the workspace owner".to_string());
        }
        ws.members.insert(user_id.to_string(), new_role);
        ws.updated_at = Utc::now();
        self.persist();
        Ok(())
    }

    /// Get all member IDs for a workspace.
    pub fn get_member_ids(&self, workspace_id: &str) -> Result<Vec<String>, String> {
        let ws = self
            .workspaces
            .get(workspace_id)
            .ok_or("Workspace not found")?;
        Ok(ws.members.keys().cloned().collect())
    }

    /// Get the role of a user in a workspace.
    pub fn get_user_role(
        &self,
        workspace_id: &str,
        user_id: &str,
    ) -> Result<Option<WorkspaceRole>, String> {
        let ws = self
            .workspaces
            .get(workspace_id)
            .ok_or("Workspace not found")?;
        Ok(ws.members.get(user_id).copied())
    }

    /// Add a connection to a workspace.
    pub fn add_connection(
        &mut self,
        workspace_id: &str,
        connection_id: &str,
    ) -> Result<(), String> {
        let ws = self
            .workspaces
            .get_mut(workspace_id)
            .ok_or("Workspace not found")?;
        if !ws.connection_ids.contains(&connection_id.to_string()) {
            ws.connection_ids.push(connection_id.to_string());
            ws.updated_at = Utc::now();
            self.persist();
        }
        Ok(())
    }

    /// Remove a connection from a workspace.
    pub fn remove_connection(
        &mut self,
        workspace_id: &str,
        connection_id: &str,
    ) -> Result<(), String> {
        let ws = self
            .workspaces
            .get_mut(workspace_id)
            .ok_or("Workspace not found")?;
        ws.connection_ids.retain(|id| id != connection_id);
        ws.updated_at = Utc::now();
        self.persist();
        Ok(())
    }

    /// Archive a workspace (make read-only).
    pub fn archive(&mut self, workspace_id: &str) -> Result<(), String> {
        let ws = self
            .workspaces
            .get_mut(workspace_id)
            .ok_or("Workspace not found")?;
        ws.archived = true;
        ws.updated_at = Utc::now();
        self.persist();
        Ok(())
    }

    /// Update workspace settings.
    pub fn update_settings(
        &mut self,
        workspace_id: &str,
        settings: WorkspaceSettings,
    ) -> Result<(), String> {
        let ws = self
            .workspaces
            .get_mut(workspace_id)
            .ok_or("Workspace not found")?;
        ws.settings = settings;
        ws.updated_at = Utc::now();
        self.persist();
        Ok(())
    }

    /// Delete a workspace permanently.
    pub fn delete(&mut self, workspace_id: &str) -> Result<(), String> {
        self.workspaces
            .remove(workspace_id)
            .ok_or("Workspace not found")?;
        self.persist();
        Ok(())
    }

    // ── Persistence ─────────────────────────────────────────────────

    fn persist(&self) {
        let path = std::path::Path::new(&self.data_dir).join("collaboration_workspaces.json");
        if let Ok(json) = serde_json::to_string_pretty(&self.workspaces) {
            let _ = std::fs::create_dir_all(&self.data_dir);
            let _ = std::fs::write(path, json);
        }
    }

    fn load_from_disk(&mut self) {
        let path = std::path::Path::new(&self.data_dir).join("collaboration_workspaces.json");
        if let Ok(data) = std::fs::read_to_string(path) {
            if let Ok(workspaces) = serde_json::from_str(&data) {
                self.workspaces = workspaces;
            }
        }
    }
}
