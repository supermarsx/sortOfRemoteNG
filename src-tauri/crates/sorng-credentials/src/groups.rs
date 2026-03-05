//! # Group Manager
//!
//! Manage logical groupings of related credentials so they can share
//! policies and be rotated together.

use crate::error::CredentialError;
use crate::types::CredentialGroup;
use log::info;
use std::collections::HashMap;

/// Manages credential groups.
#[derive(Debug)]
pub struct GroupManager {
    /// All groups keyed by ID.
    pub groups: HashMap<String, CredentialGroup>,
}

impl GroupManager {
    /// Create an empty group manager.
    pub fn new() -> Self {
        Self {
            groups: HashMap::new(),
        }
    }

    /// Create a new group. Returns an error if the ID already exists.
    pub fn create_group(&mut self, group: CredentialGroup) -> Result<(), CredentialError> {
        if self.groups.contains_key(&group.id) {
            return Err(CredentialError::GroupAlreadyExists(group.id.clone()));
        }
        info!("Creating credential group {}", group.id);
        self.groups.insert(group.id.clone(), group);
        Ok(())
    }

    /// Delete a group by ID, returning the removed group.
    pub fn delete_group(&mut self, id: &str) -> Result<CredentialGroup, CredentialError> {
        self.groups
            .remove(id)
            .ok_or_else(|| CredentialError::GroupNotFound(id.to_string()))
    }

    /// Add a credential ID to an existing group.
    pub fn add_to_group(
        &mut self,
        group_id: &str,
        credential_id: String,
    ) -> Result<(), CredentialError> {
        let group = self
            .groups
            .get_mut(group_id)
            .ok_or_else(|| CredentialError::GroupNotFound(group_id.to_string()))?;
        if !group.credential_ids.contains(&credential_id) {
            group.credential_ids.push(credential_id);
        }
        Ok(())
    }

    /// Remove a credential ID from a group.
    pub fn remove_from_group(
        &mut self,
        group_id: &str,
        credential_id: &str,
    ) -> Result<(), CredentialError> {
        let group = self
            .groups
            .get_mut(group_id)
            .ok_or_else(|| CredentialError::GroupNotFound(group_id.to_string()))?;
        group.credential_ids.retain(|id| id != credential_id);
        Ok(())
    }

    /// List all groups.
    pub fn list_groups(&self) -> Vec<&CredentialGroup> {
        self.groups.values().collect()
    }

    /// Get a group by ID.
    pub fn get_group(&self, id: &str) -> Result<&CredentialGroup, CredentialError> {
        self.groups
            .get(id)
            .ok_or_else(|| CredentialError::GroupNotFound(id.to_string()))
    }

    /// Find the group that contains a given credential ID (if any).
    pub fn get_group_for_credential(&self, credential_id: &str) -> Option<&CredentialGroup> {
        self.groups
            .values()
            .find(|g| g.credential_ids.iter().any(|id| id == credential_id))
    }
}

impl Default for GroupManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_group(id: &str) -> CredentialGroup {
        CredentialGroup {
            id: id.to_string(),
            name: format!("Group {id}"),
            description: String::new(),
            credential_ids: vec![],
            shared_policy_id: None,
            auto_rotate_together: false,
        }
    }

    #[test]
    fn create_and_get_group() {
        let mut mgr = GroupManager::new();
        mgr.create_group(make_group("g1")).unwrap();
        assert!(mgr.get_group("g1").is_ok());
    }

    #[test]
    fn duplicate_group_fails() {
        let mut mgr = GroupManager::new();
        mgr.create_group(make_group("g1")).unwrap();
        assert!(mgr.create_group(make_group("g1")).is_err());
    }

    #[test]
    fn add_remove_credential() {
        let mut mgr = GroupManager::new();
        mgr.create_group(make_group("g1")).unwrap();
        mgr.add_to_group("g1", "cred-1".to_string()).unwrap();
        assert_eq!(mgr.get_group("g1").unwrap().credential_ids.len(), 1);
        mgr.remove_from_group("g1", "cred-1").unwrap();
        assert!(mgr.get_group("g1").unwrap().credential_ids.is_empty());
    }

    #[test]
    fn find_group_for_credential() {
        let mut mgr = GroupManager::new();
        mgr.create_group(make_group("g1")).unwrap();
        mgr.add_to_group("g1", "cred-1".to_string()).unwrap();
        let found = mgr.get_group_for_credential("cred-1").unwrap();
        assert_eq!(found.id, "g1");
        assert!(mgr.get_group_for_credential("cred-99").is_none());
    }

    #[test]
    fn delete_group() {
        let mut mgr = GroupManager::new();
        mgr.create_group(make_group("g1")).unwrap();
        mgr.delete_group("g1").unwrap();
        assert!(mgr.get_group("g1").is_err());
    }
}
