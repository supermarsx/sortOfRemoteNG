//! # RBAC Enforcer
//!
//! Role-Based Access Control enforcement for workspace operations.
//! Checks whether a user has sufficient privileges for a requested action.

use crate::types::*;
use crate::workspace::WorkspaceManager;

/// Enforces role-based access control across all collaboration operations.
pub struct RbacEnforcer {
    // Stateless enforcer — all state comes from WorkspaceManager
}

impl RbacEnforcer {
    pub fn new() -> Self {
        Self {}
    }

    /// Check if a user has at least the required role in a workspace.
    /// Returns Ok(()) if authorized, Err with message if not.
    pub fn require_permission(
        &self,
        workspaces: &WorkspaceManager,
        workspace_id: &str,
        user_id: &str,
        required_role: WorkspaceRole,
    ) -> Result<(), String> {
        let role = workspaces
            .get_user_role(workspace_id, user_id)?
            .ok_or_else(|| {
                format!(
                    "User {} is not a member of workspace {}",
                    user_id, workspace_id
                )
            })?;

        if role.has_at_least(required_role) {
            Ok(())
        } else {
            Err(format!(
                "Insufficient permissions: user has {:?} but {:?} is required",
                role, required_role
            ))
        }
    }

    /// Check permission and return a boolean (non-error version).
    pub fn has_permission(
        &self,
        workspaces: &WorkspaceManager,
        workspace_id: &str,
        user_id: &str,
        required_role: WorkspaceRole,
    ) -> bool {
        self.require_permission(workspaces, workspace_id, user_id, required_role)
            .is_ok()
    }

    /// Check if a user can manage members (Admin or higher).
    pub fn can_manage_members(
        &self,
        workspaces: &WorkspaceManager,
        workspace_id: &str,
        user_id: &str,
    ) -> bool {
        self.has_permission(workspaces, workspace_id, user_id, WorkspaceRole::Admin)
    }

    /// Check if a user can edit connections (Editor or higher).
    pub fn can_edit_connections(
        &self,
        workspaces: &WorkspaceManager,
        workspace_id: &str,
        user_id: &str,
    ) -> bool {
        self.has_permission(workspaces, workspace_id, user_id, WorkspaceRole::Editor)
    }

    /// Check if a user can initiate connections (Operator or higher).
    pub fn can_connect(
        &self,
        workspaces: &WorkspaceManager,
        workspace_id: &str,
        user_id: &str,
    ) -> bool {
        self.has_permission(workspaces, workspace_id, user_id, WorkspaceRole::Operator)
    }

    /// Check if a user can view connections (Viewer or higher — any member).
    pub fn can_view(
        &self,
        workspaces: &WorkspaceManager,
        workspace_id: &str,
        user_id: &str,
    ) -> bool {
        self.has_permission(workspaces, workspace_id, user_id, WorkspaceRole::Viewer)
    }

    /// Check if a user is the workspace owner.
    pub fn is_owner(
        &self,
        workspaces: &WorkspaceManager,
        workspace_id: &str,
        user_id: &str,
    ) -> bool {
        self.has_permission(workspaces, workspace_id, user_id, WorkspaceRole::Owner)
    }

    /// Validate that a role change is allowed.
    /// Rules:
    /// - Only owners can promote to Admin
    /// - Admins can promote to Editor or demote from Editor
    /// - You can't change the owner's role
    /// - You can't change your own role
    pub fn validate_role_change(
        &self,
        workspaces: &WorkspaceManager,
        workspace_id: &str,
        actor_id: &str,
        target_id: &str,
        new_role: WorkspaceRole,
    ) -> Result<(), String> {
        if actor_id == target_id {
            return Err("Cannot change your own role".to_string());
        }

        let actor_role = workspaces
            .get_user_role(workspace_id, actor_id)?
            .ok_or("Actor is not a member")?;

        let target_role = workspaces
            .get_user_role(workspace_id, target_id)?
            .ok_or("Target is not a member")?;

        // Can't modify someone with equal or higher role (unless you're Owner)
        if actor_role != WorkspaceRole::Owner && target_role >= actor_role {
            return Err("Cannot modify a user with equal or higher role".to_string());
        }

        // Only Owner can grant Admin
        if new_role == WorkspaceRole::Admin && actor_role != WorkspaceRole::Owner {
            return Err("Only the workspace owner can grant Admin role".to_string());
        }

        // Can't grant Owner (ownership transfer is a separate operation)
        if new_role == WorkspaceRole::Owner {
            return Err("Ownership transfer must use the dedicated transfer operation".to_string());
        }

        Ok(())
    }
}
