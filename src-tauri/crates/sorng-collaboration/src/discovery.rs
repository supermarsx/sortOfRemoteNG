//! # Discovery Service
//!
//! User and team discovery, invitation management, and onboarding.
//! Handles the invitation lifecycle: create → send → accept/decline → expire.

use crate::types::*;
use chrono::{Duration, Utc};
use std::collections::HashMap;

/// Manages user/team discovery and invitation workflows.
pub struct DiscoveryService {
    /// All invitations indexed by invitation ID
    invitations: HashMap<String, Invitation>,
    /// Known users indexed by email (for discovery)
    known_users: HashMap<String, CollabUser>,
    /// Persistence directory
    data_dir: String,
}

impl DiscoveryService {
    pub fn new(data_dir: &str) -> Self {
        let mut svc = Self {
            invitations: HashMap::new(),
            known_users: HashMap::new(),
            data_dir: data_dir.to_string(),
        };
        svc.load_from_disk();
        svc
    }

    /// Register a user for discovery (called when a user authenticates).
    pub fn register_user(&mut self, user: CollabUser) {
        self.known_users.insert(user.email.clone(), user);
        self.persist();
    }

    /// Search for users by email prefix or display name.
    pub fn search_users(&self, query: &str, limit: usize) -> Vec<&CollabUser> {
        let query_lower = query.to_lowercase();
        self.known_users
            .values()
            .filter(|u| {
                u.email.to_lowercase().contains(&query_lower)
                    || u.display_name.to_lowercase().contains(&query_lower)
            })
            .take(limit)
            .collect()
    }

    /// Create a new invitation.
    pub fn create_invitation(
        &mut self,
        invitation_type: InvitationType,
        target_id: &str,
        target_name: &str,
        invited_by: &str,
        invitee: &str,
        granted_role: WorkspaceRole,
        message: Option<String>,
    ) -> Result<Invitation, String> {
        // Check for duplicate pending invitations
        let already_invited = self.invitations.values().any(|inv| {
            inv.target_id == target_id
                && inv.invitee == invitee
                && inv.status == InvitationStatus::Pending
        });
        if already_invited {
            return Err("An invitation is already pending for this user".to_string());
        }

        let invitation = Invitation {
            id: uuid::Uuid::new_v4().to_string(),
            invitation_type,
            target_id: target_id.to_string(),
            target_name: target_name.to_string(),
            invited_by: invited_by.to_string(),
            invitee: invitee.to_string(),
            granted_role,
            message,
            status: InvitationStatus::Pending,
            created_at: Utc::now(),
            expires_at: Utc::now() + Duration::days(7),
        };

        self.invitations
            .insert(invitation.id.clone(), invitation.clone());
        self.persist();
        Ok(invitation)
    }

    /// Get an invitation by ID.
    pub fn get_invitation(&self, invitation_id: &str) -> Result<Option<Invitation>, String> {
        Ok(self.invitations.get(invitation_id).cloned())
    }

    /// Accept an invitation.
    pub fn accept_invitation(&mut self, invitation_id: &str) -> Result<(), String> {
        let invitation = self
            .invitations
            .get_mut(invitation_id)
            .ok_or("Invitation not found")?;

        if invitation.status != InvitationStatus::Pending {
            return Err(format!(
                "Invitation is {:?}, cannot accept",
                invitation.status
            ));
        }

        if Utc::now() > invitation.expires_at {
            invitation.status = InvitationStatus::Expired;
            self.persist();
            return Err("Invitation has expired".to_string());
        }

        invitation.status = InvitationStatus::Accepted;
        self.persist();
        Ok(())
    }

    /// Decline an invitation.
    pub fn decline_invitation(&mut self, invitation_id: &str) -> Result<(), String> {
        let invitation = self
            .invitations
            .get_mut(invitation_id)
            .ok_or("Invitation not found")?;

        if invitation.status != InvitationStatus::Pending {
            return Err(format!(
                "Invitation is {:?}, cannot decline",
                invitation.status
            ));
        }

        invitation.status = InvitationStatus::Declined;
        self.persist();
        Ok(())
    }

    /// Revoke an invitation (by the sender).
    pub fn revoke_invitation(
        &mut self,
        invitation_id: &str,
        user_id: &str,
    ) -> Result<(), String> {
        let invitation = self
            .invitations
            .get_mut(invitation_id)
            .ok_or("Invitation not found")?;

        if invitation.invited_by != user_id {
            return Err("Only the sender can revoke an invitation".to_string());
        }

        invitation.status = InvitationStatus::Revoked;
        self.persist();
        Ok(())
    }

    /// List pending invitations for a user (by email).
    pub fn list_pending_for_user(&self, email: &str) -> Vec<Invitation> {
        self.invitations
            .values()
            .filter(|inv| inv.invitee == email && inv.status == InvitationStatus::Pending)
            .cloned()
            .collect()
    }

    /// List invitations sent by a user.
    pub fn list_sent_by_user(&self, user_id: &str) -> Vec<Invitation> {
        self.invitations
            .values()
            .filter(|inv| inv.invited_by == user_id)
            .cloned()
            .collect()
    }

    /// Sweep expired invitations.
    pub fn sweep_expired(&mut self) {
        let now = Utc::now();
        let mut changed = false;
        for invitation in self.invitations.values_mut() {
            if invitation.status == InvitationStatus::Pending && now > invitation.expires_at {
                invitation.status = InvitationStatus::Expired;
                changed = true;
            }
        }
        if changed {
            self.persist();
        }
    }

    // ── Persistence ─────────────────────────────────────────────────

    fn persist(&self) {
        let path = std::path::Path::new(&self.data_dir).join("collaboration_discovery.json");
        let data = serde_json::json!({
            "invitations": self.invitations,
            "known_users": self.known_users,
        });
        if let Ok(json) = serde_json::to_string_pretty(&data) {
            let _ = std::fs::create_dir_all(&self.data_dir);
            let _ = std::fs::write(path, json);
        }
    }

    fn load_from_disk(&mut self) {
        let path = std::path::Path::new(&self.data_dir).join("collaboration_discovery.json");
        if let Ok(data) = std::fs::read_to_string(path) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&data) {
                if let Some(inv) = json.get("invitations") {
                    if let Ok(invitations) = serde_json::from_value(inv.clone()) {
                        self.invitations = invitations;
                    }
                }
                if let Some(users) = json.get("known_users") {
                    if let Ok(known) = serde_json::from_value(users.clone()) {
                        self.known_users = known;
                    }
                }
            }
        }
    }
}
