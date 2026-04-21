//! # Notification Service
//!
//! Event-driven notification system for collaboration events.
//! Manages per-user notification queues with read/dismiss tracking.

use crate::types::*;
use crate::workspace::WorkspaceManager;
use chrono::Utc;
use std::collections::HashMap;

/// Manages collaboration notifications for all users.
pub struct NotificationService {
    /// Notifications indexed by user_id → Vec<CollabNotification>
    notifications: HashMap<String, Vec<CollabNotification>>,
}

impl Default for NotificationService {
    fn default() -> Self {
        Self::new()
    }
}

impl NotificationService {
    pub fn new() -> Self {
        Self {
            notifications: HashMap::new(),
        }
    }

    /// Send a notification to a specific user.
    pub fn notify_user(
        &mut self,
        target_user_id: &str,
        category: NotificationCategory,
        title: &str,
        body: &str,
        workspace_id: Option<&str>,
        resource_id: Option<&str>,
    ) {
        let notification = CollabNotification {
            id: uuid::Uuid::new_v4().to_string(),
            target_user_id: target_user_id.to_string(),
            category,
            title: title.to_string(),
            body: body.to_string(),
            workspace_id: workspace_id.map(|s| s.to_string()),
            resource_id: resource_id.map(|s| s.to_string()),
            created_at: Utc::now(),
            read: false,
            dismissed: false,
        };

        let user_notifications = self
            .notifications
            .entry(target_user_id.to_string())
            .or_default();
        user_notifications.push(notification);
    }

    /// Broadcast a notification to all members of a workspace (except the actor).
    pub fn broadcast_workspace(
        &mut self,
        workspace_id: &str,
        workspaces: &WorkspaceManager,
        actor_id: &str,
        category: NotificationCategory,
        title: &str,
        body: &str,
    ) {
        if let Ok(members) = workspaces.get_member_ids(workspace_id) {
            for member_id in members {
                if member_id != actor_id {
                    self.notify_user(&member_id, category, title, body, Some(workspace_id), None);
                }
            }
        }
    }

    /// Get all notifications for a user (unread + recent).
    pub fn get_for_user(&self, user_id: &str) -> Vec<CollabNotification> {
        self.notifications
            .get(user_id)
            .map(|n| n.iter().filter(|notif| !notif.dismissed).cloned().collect())
            .unwrap_or_default()
    }

    /// Get unread notifications for a user.
    pub fn get_unread(&self, user_id: &str) -> Vec<CollabNotification> {
        self.notifications
            .get(user_id)
            .map(|n| {
                n.iter()
                    .filter(|notif| !notif.read && !notif.dismissed)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Get unread count for a user.
    pub fn unread_count(&self, user_id: &str) -> usize {
        self.get_unread(user_id).len()
    }

    /// Mark a specific notification as read.
    pub fn mark_read(&mut self, user_id: &str, notification_id: &str) -> Result<(), String> {
        let user_notifs = self
            .notifications
            .get_mut(user_id)
            .ok_or("No notifications for user")?;

        let notif = user_notifs
            .iter_mut()
            .find(|n| n.id == notification_id)
            .ok_or("Notification not found")?;

        notif.read = true;
        Ok(())
    }

    /// Mark all notifications as read for a user.
    pub fn mark_all_read(&mut self, user_id: &str) {
        if let Some(notifs) = self.notifications.get_mut(user_id) {
            for notif in notifs.iter_mut() {
                notif.read = true;
            }
        }
    }

    /// Dismiss a specific notification.
    pub fn dismiss(&mut self, user_id: &str, notification_id: &str) -> Result<(), String> {
        let user_notifs = self
            .notifications
            .get_mut(user_id)
            .ok_or("No notifications for user")?;

        let notif = user_notifs
            .iter_mut()
            .find(|n| n.id == notification_id)
            .ok_or("Notification not found")?;

        notif.dismissed = true;
        Ok(())
    }

    /// Dismiss all notifications for a user.
    pub fn dismiss_all(&mut self, user_id: &str) {
        if let Some(notifs) = self.notifications.get_mut(user_id) {
            for notif in notifs.iter_mut() {
                notif.dismissed = true;
            }
        }
    }

    /// Clean up old dismissed notifications (housekeeping).
    pub fn cleanup_dismissed(&mut self) {
        for notifs in self.notifications.values_mut() {
            notifs.retain(|n| !n.dismissed);
        }
    }
}
