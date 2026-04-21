//! # Sharing Manager
//!
//! Manages connection and folder sharing within workspaces, including
//! per-resource permission overrides and expiring share links.

use crate::types::*;
use chrono::Utc;
use std::collections::HashMap;

/// Manages all resource sharing records.
pub struct SharingManager {
    /// All shared resources indexed by (workspace_id, resource_id)
    resources: HashMap<String, SharedResource>,
    /// Persistence directory
    data_dir: String,
}

impl SharingManager {
    pub fn new(data_dir: &str) -> Self {
        let mut mgr = Self {
            resources: HashMap::new(),
            data_dir: data_dir.to_string(),
        };
        mgr.load_from_disk();
        mgr
    }

    /// Share a connection within a workspace.
    pub fn share_connection(
        &mut self,
        workspace_id: &str,
        connection_id: &str,
        shared_by: &str,
        user_permissions: HashMap<String, ResourcePermission>,
    ) -> Result<SharedResource, String> {
        let key = format!("{}:{}", workspace_id, connection_id);
        if self.resources.contains_key(&key) {
            return Err("Connection is already shared in this workspace".to_string());
        }

        let resource = SharedResource {
            id: uuid::Uuid::new_v4().to_string(),
            resource_type: ResourceType::Connection,
            resource_id: connection_id.to_string(),
            workspace_id: workspace_id.to_string(),
            shared_by: shared_by.to_string(),
            user_permissions,
            shared_at: Utc::now(),
            expires_at: None,
            active: true,
        };
        self.resources.insert(key, resource.clone());
        self.persist();
        Ok(resource)
    }

    /// Share a folder within a workspace.
    pub fn share_folder(
        &mut self,
        workspace_id: &str,
        folder_id: &str,
        shared_by: &str,
        user_permissions: HashMap<String, ResourcePermission>,
    ) -> Result<SharedResource, String> {
        let key = format!("{}:{}", workspace_id, folder_id);
        if self.resources.contains_key(&key) {
            return Err("Folder is already shared in this workspace".to_string());
        }

        let resource = SharedResource {
            id: uuid::Uuid::new_v4().to_string(),
            resource_type: ResourceType::Folder,
            resource_id: folder_id.to_string(),
            workspace_id: workspace_id.to_string(),
            shared_by: shared_by.to_string(),
            user_permissions,
            shared_at: Utc::now(),
            expires_at: None,
            active: true,
        };
        self.resources.insert(key, resource.clone());
        self.persist();
        Ok(resource)
    }

    /// Remove sharing for a resource.
    pub fn unshare(&mut self, workspace_id: &str, resource_id: &str) -> Result<(), String> {
        let key = format!("{}:{}", workspace_id, resource_id);
        self.resources
            .remove(&key)
            .ok_or("Shared resource not found")?;
        self.persist();
        Ok(())
    }

    /// Get a shared resource record.
    pub fn get_shared_resource(
        &self,
        workspace_id: &str,
        resource_id: &str,
    ) -> Option<&SharedResource> {
        let key = format!("{}:{}", workspace_id, resource_id);
        self.resources.get(&key)
    }

    /// List all shared resources in a workspace.
    pub fn list_workspace_resources(&self, workspace_id: &str) -> Vec<&SharedResource> {
        self.resources
            .values()
            .filter(|r| r.workspace_id == workspace_id && r.active)
            .collect()
    }

    /// Check if a user has a specific permission on a resource.
    pub fn check_permission(
        &self,
        workspace_id: &str,
        resource_id: &str,
        user_id: &str,
        required: ResourcePermission,
    ) -> bool {
        if let Some(resource) = self.get_shared_resource(workspace_id, resource_id) {
            if !resource.active {
                return false;
            }
            // Check expiration
            if let Some(expires) = resource.expires_at {
                if Utc::now() > expires {
                    return false;
                }
            }
            // Check user-specific permission
            if let Some(perm) = resource.user_permissions.get(user_id) {
                return *perm >= required;
            }
        }
        false
    }

    /// Update permissions for a user on a shared resource.
    pub fn update_permission(
        &mut self,
        workspace_id: &str,
        resource_id: &str,
        user_id: &str,
        permission: ResourcePermission,
    ) -> Result<(), String> {
        let key = format!("{}:{}", workspace_id, resource_id);
        let resource = self
            .resources
            .get_mut(&key)
            .ok_or("Shared resource not found")?;
        resource
            .user_permissions
            .insert(user_id.to_string(), permission);
        self.persist();
        Ok(())
    }

    /// Set an expiration time on a shared resource.
    pub fn set_expiration(
        &mut self,
        workspace_id: &str,
        resource_id: &str,
        expires_at: chrono::DateTime<Utc>,
    ) -> Result<(), String> {
        let key = format!("{}:{}", workspace_id, resource_id);
        let resource = self
            .resources
            .get_mut(&key)
            .ok_or("Shared resource not found")?;
        resource.expires_at = Some(expires_at);
        self.persist();
        Ok(())
    }

    /// Sweep expired shares and deactivate them.
    pub fn sweep_expired(&mut self) {
        let now = Utc::now();
        let mut changed = false;
        for resource in self.resources.values_mut() {
            if resource.active {
                if let Some(expires) = resource.expires_at {
                    if now > expires {
                        resource.active = false;
                        changed = true;
                    }
                }
            }
        }
        if changed {
            self.persist();
        }
    }

    // ── Persistence ─────────────────────────────────────────────────

    fn persist(&self) {
        let path = std::path::Path::new(&self.data_dir).join("collaboration_shares.json");
        if let Ok(json) = serde_json::to_string_pretty(&self.resources) {
            let _ = std::fs::create_dir_all(&self.data_dir);
            let _ = std::fs::write(path, json);
        }
    }

    fn load_from_disk(&mut self) {
        let path = std::path::Path::new(&self.data_dir).join("collaboration_shares.json");
        if let Ok(data) = std::fs::read_to_string(path) {
            if let Ok(resources) = serde_json::from_str(&data) {
                self.resources = resources;
            }
        }
    }
}
