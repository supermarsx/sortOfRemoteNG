//! # Presence Tracker
//!
//! Real-time user presence tracking with heartbeat management.
//! Tracks who is online, what they're doing, and when they were last active.

use crate::types::*;
use chrono::Utc;
use std::collections::HashMap;

/// Tracks the real-time presence of all collaborating users.
pub struct PresenceTracker {
    /// Current presence state for each user
    presences: HashMap<String, UserPresence>,
    /// Heartbeat interval in seconds (users must heartbeat within 2x this to stay online)
    heartbeat_interval_secs: u64,
}

impl Default for PresenceTracker {
    fn default() -> Self {
        Self::new()
    }
}

impl PresenceTracker {
    pub fn new() -> Self {
        Self {
            presences: HashMap::new(),
            heartbeat_interval_secs: 30,
        }
    }

    /// Set a user's presence status.
    pub fn set_status(&mut self, user_id: &str, status: PresenceStatus) {
        let presence = self
            .presences
            .entry(user_id.to_string())
            .or_insert_with(|| UserPresence {
                user_id: user_id.to_string(),
                status: PresenceStatus::Offline,
                activity: None,
                last_heartbeat: Utc::now(),
                client_info: None,
                client_ip: None,
            });
        presence.status = status;
        presence.last_heartbeat = Utc::now();
    }

    /// Set a user's current activity.
    pub fn set_activity(&mut self, user_id: &str, activity: UserActivity) {
        if let Some(presence) = self.presences.get_mut(user_id) {
            presence.activity = Some(activity);
            presence.status = PresenceStatus::Busy;
            presence.last_heartbeat = Utc::now();
        }
    }

    /// Clear a user's activity (back to idle/online).
    pub fn clear_activity(&mut self, user_id: &str) {
        if let Some(presence) = self.presences.get_mut(user_id) {
            presence.activity = None;
            if presence.status == PresenceStatus::Busy {
                presence.status = PresenceStatus::Online;
            }
        }
    }

    /// Record a heartbeat from a user, keeping them marked as online.
    pub fn heartbeat(
        &mut self,
        user_id: &str,
        client_info: Option<String>,
        client_ip: Option<String>,
    ) {
        let presence = self
            .presences
            .entry(user_id.to_string())
            .or_insert_with(|| UserPresence {
                user_id: user_id.to_string(),
                status: PresenceStatus::Online,
                activity: None,
                last_heartbeat: Utc::now(),
                client_info: None,
                client_ip: None,
            });
        presence.last_heartbeat = Utc::now();
        if let Some(info) = client_info {
            presence.client_info = Some(info);
        }
        if let Some(ip) = client_ip {
            presence.client_ip = Some(ip);
        }
    }

    /// Get a single user's presence.
    pub fn get_presence(&self, user_id: &str) -> Option<&UserPresence> {
        self.presences.get(user_id)
    }

    /// Get presence for a list of user IDs.
    pub fn get_presence_for_users(&self, user_ids: &[String]) -> Vec<UserPresence> {
        user_ids
            .iter()
            .filter_map(|id| self.presences.get(id).cloned())
            .collect()
    }

    /// Get all users currently online.
    pub fn get_online_users(&self) -> Vec<&UserPresence> {
        self.presences
            .values()
            .filter(|p| {
                matches!(
                    p.status,
                    PresenceStatus::Online
                        | PresenceStatus::Busy
                        | PresenceStatus::Away
                        | PresenceStatus::DoNotDisturb
                )
            })
            .collect()
    }

    /// Mark stale users as offline (heartbeat timeout check).
    /// Should be called periodically by a background task.
    pub fn sweep_stale_users(&mut self) {
        let now = Utc::now();
        let timeout = chrono::Duration::seconds((self.heartbeat_interval_secs * 2) as i64);

        for presence in self.presences.values_mut() {
            if presence.status != PresenceStatus::Offline {
                if let Ok(elapsed) = now.signed_duration_since(presence.last_heartbeat).to_std() {
                    if elapsed
                        > timeout
                            .to_std()
                            .unwrap_or(std::time::Duration::from_secs(60))
                    {
                        log::info!(
                            "Marking user {} as offline (heartbeat timeout)",
                            presence.user_id
                        );
                        presence.status = PresenceStatus::Offline;
                        presence.activity = None;
                    }
                }
            }
        }
    }

    /// Remove a user from tracking entirely.
    pub fn remove_user(&mut self, user_id: &str) {
        self.presences.remove(user_id);
    }

    /// Get the heartbeat interval in seconds.
    pub fn heartbeat_interval(&self) -> u64 {
        self.heartbeat_interval_secs
    }

    /// Set the heartbeat interval in seconds.
    pub fn set_heartbeat_interval(&mut self, secs: u64) {
        self.heartbeat_interval_secs = secs;
    }

    /// Get total online user count.
    pub fn online_count(&self) -> usize {
        self.get_online_users().len()
    }
}
