use std::collections::HashMap;

use crate::error::{FilterError, Result};
use crate::evaluator;
use crate::types::*;

/// Manages smart groups (virtual folders backed by a filter).
pub struct SmartGroupManager {
    groups: HashMap<String, SmartGroup>,
}

impl SmartGroupManager {
    pub fn new() -> Self {
        Self {
            groups: HashMap::new(),
        }
    }

    /// Create a new smart group and return its ID.
    pub fn create_group(&mut self, group: SmartGroup) -> Result<String> {
        let id = group.id.clone();
        if self.groups.contains_key(&id) {
            return Err(FilterError::InvalidCondition(format!(
                "Smart group with id '{id}' already exists"
            )));
        }
        self.groups.insert(id.clone(), group);
        log::info!("Created smart group '{id}'");
        Ok(id)
    }

    /// Delete a smart group by ID.
    pub fn delete_group(&mut self, id: &str) -> Result<()> {
        self.groups
            .remove(id)
            .ok_or_else(|| FilterError::SmartGroupNotFound(id.to_string()))?;
        log::info!("Deleted smart group '{id}'");
        Ok(())
    }

    /// Get a smart group by ID.
    pub fn get_group(&self, id: &str) -> Result<&SmartGroup> {
        self.groups
            .get(id)
            .ok_or_else(|| FilterError::SmartGroupNotFound(id.to_string()))
    }

    /// List all smart groups, ordered by position.
    pub fn list_groups(&self) -> Vec<&SmartGroup> {
        let mut groups: Vec<&SmartGroup> = self.groups.values().collect();
        groups.sort_by_key(|g| g.position);
        groups
    }

    /// Update a smart group in place.
    pub fn update_group(&mut self, updated: SmartGroup) -> Result<()> {
        let id = updated.id.clone();
        if !self.groups.contains_key(&id) {
            return Err(FilterError::SmartGroupNotFound(id));
        }
        self.groups.insert(id.clone(), updated);
        log::info!("Updated smart group '{id}'");
        Ok(())
    }

    /// Reorder a smart group to a new position, shifting others as needed.
    pub fn reorder_group(&mut self, id: &str, new_position: i32) -> Result<()> {
        if !self.groups.contains_key(id) {
            return Err(FilterError::SmartGroupNotFound(id.to_string()));
        }

        // Collect sorted IDs by current position (excluding the moving one)
        let mut ordered: Vec<(String, i32)> = self
            .groups
            .iter()
            .filter(|(gid, _)| gid.as_str() != id)
            .map(|(gid, g)| (gid.clone(), g.position))
            .collect();
        ordered.sort_by_key(|(_, pos)| *pos);

        // Insert the target at the desired position
        let insert_idx = (new_position as usize).min(ordered.len());
        ordered.insert(insert_idx, (id.to_string(), new_position));

        // Reassign sequential positions
        for (i, (gid, _)) in ordered.iter().enumerate() {
            if let Some(g) = self.groups.get_mut(gid) {
                g.position = i as i32;
            }
        }

        log::info!("Reordered smart group '{id}' to position {new_position}");
        Ok(())
    }

    /// Evaluate a smart group: look up its filter and run it against connections.
    pub fn evaluate_group(
        &self,
        _group: &SmartGroup,
        filter: &SmartFilter,
        connections: &[serde_json::Value],
    ) -> Result<FilterResult> {
        evaluator::evaluate_filter(filter, connections)
    }

    /// Return the total number of smart groups.
    pub fn count(&self) -> usize {
        self.groups.len()
    }
}

impl Default for SmartGroupManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_and_list() {
        let mut mgr = SmartGroupManager::new();
        let g1 = SmartGroup::new("Group A", "filter-1");
        let g2 = SmartGroup::new("Group B", "filter-2");
        mgr.create_group(g1).unwrap();
        mgr.create_group(g2).unwrap();
        assert_eq!(mgr.list_groups().len(), 2);
    }

    #[test]
    fn test_delete() {
        let mut mgr = SmartGroupManager::new();
        let g = SmartGroup::new("Group A", "filter-1");
        let id = mgr.create_group(g).unwrap();
        mgr.delete_group(&id).unwrap();
        assert_eq!(mgr.count(), 0);
    }

    #[test]
    fn test_delete_not_found() {
        let mut mgr = SmartGroupManager::new();
        let result = mgr.delete_group("nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn test_update() {
        let mut mgr = SmartGroupManager::new();
        let mut g = SmartGroup::new("Group A", "filter-1");
        let id = mgr.create_group(g.clone()).unwrap();
        g.id = id.clone();
        g.name = "Updated Group".to_string();
        mgr.update_group(g).unwrap();
        assert_eq!(mgr.get_group(&id).unwrap().name, "Updated Group");
    }

    #[test]
    fn test_reorder() {
        let mut mgr = SmartGroupManager::new();
        let mut g1 = SmartGroup::new("A", "f1");
        g1.position = 0;
        let mut g2 = SmartGroup::new("B", "f2");
        g2.position = 1;
        let mut g3 = SmartGroup::new("C", "f3");
        g3.position = 2;
        let id1 = mgr.create_group(g1).unwrap();
        let _id2 = mgr.create_group(g2).unwrap();
        let _id3 = mgr.create_group(g3).unwrap();
        // Move group A (pos 0) to pos 2
        mgr.reorder_group(&id1, 2).unwrap();
        let groups = mgr.list_groups();
        // The one at position 0 should no longer be id1
        assert_ne!(groups[0].id, id1);
    }
}
