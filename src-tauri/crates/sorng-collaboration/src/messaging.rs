//! # Messaging Service
//!
//! In-app messaging for team communication and connection annotations.
//! Supports threads, channels (per-connection), and message history.

use crate::types::*;
use chrono::Utc;
use std::collections::HashMap;

/// Manages in-app collaboration messages and annotations.
pub struct MessagingService {
    /// Messages indexed by workspace_id → Vec<CollabMessage>
    messages: HashMap<String, Vec<CollabMessage>>,
    /// Persistence directory
    data_dir: String,
}

impl MessagingService {
    pub fn new(data_dir: &str) -> Self {
        let mut svc = Self {
            messages: HashMap::new(),
            data_dir: data_dir.to_string(),
        };
        svc.load_from_disk();
        svc
    }

    /// Send a message in a workspace.
    pub fn send_message(
        &mut self,
        workspace_id: &str,
        sender_id: &str,
        content: String,
        channel_id: Option<String>,
        message_type: MessageType,
        reply_to: Option<String>,
    ) -> Result<CollabMessage, String> {
        if content.trim().is_empty() {
            return Err("Message content cannot be empty".to_string());
        }

        let message = CollabMessage {
            id: uuid::Uuid::new_v4().to_string(),
            workspace_id: workspace_id.to_string(),
            channel_id,
            sender_id: sender_id.to_string(),
            content,
            message_type,
            reply_to,
            sent_at: Utc::now(),
            edited_at: None,
            deleted: false,
        };

        let ws_messages = self.messages.entry(workspace_id.to_string()).or_default();
        ws_messages.push(message.clone());
        self.persist();
        Ok(message)
    }

    /// Get messages for a workspace, optionally filtered by channel.
    pub fn get_messages(
        &self,
        workspace_id: &str,
        channel_id: Option<&str>,
        limit: usize,
        before_id: Option<&str>,
    ) -> Vec<CollabMessage> {
        let ws_messages = self
            .messages
            .get(workspace_id)
            .map(|m| m.as_slice())
            .unwrap_or(&[]);

        let mut filtered: Vec<&CollabMessage> = ws_messages
            .iter()
            .filter(|m| !m.deleted)
            .filter(|m| {
                if let Some(ch) = channel_id {
                    m.channel_id.as_deref() == Some(ch)
                } else {
                    true
                }
            })
            .collect();

        // If before_id is specified, only return messages before that message
        if let Some(before) = before_id {
            if let Some(pos) = filtered.iter().position(|m| m.id == before) {
                filtered = filtered[..pos].to_vec();
            }
        }

        filtered
            .into_iter()
            .rev()
            .take(limit)
            .cloned()
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect()
    }

    /// Edit a message (only sender can edit).
    pub fn edit_message(
        &mut self,
        workspace_id: &str,
        message_id: &str,
        sender_id: &str,
        new_content: String,
    ) -> Result<CollabMessage, String> {
        let ws_messages = self
            .messages
            .get_mut(workspace_id)
            .ok_or("Workspace not found")?;

        let message = ws_messages
            .iter_mut()
            .find(|m| m.id == message_id)
            .ok_or("Message not found")?;

        if message.sender_id != sender_id {
            return Err("Only the sender can edit a message".to_string());
        }

        message.content = new_content;
        message.edited_at = Some(Utc::now());
        let result = message.clone();
        self.persist();
        Ok(result)
    }

    /// Soft-delete a message.
    pub fn delete_message(
        &mut self,
        workspace_id: &str,
        message_id: &str,
        user_id: &str,
    ) -> Result<(), String> {
        let ws_messages = self
            .messages
            .get_mut(workspace_id)
            .ok_or("Workspace not found")?;

        let message = ws_messages
            .iter_mut()
            .find(|m| m.id == message_id)
            .ok_or("Message not found")?;

        if message.sender_id != user_id {
            return Err("Only the sender can delete a message".to_string());
        }

        message.deleted = true;
        self.persist();
        Ok(())
    }

    /// Get the thread (replies) for a specific message.
    pub fn get_thread(&self, workspace_id: &str, parent_message_id: &str) -> Vec<CollabMessage> {
        let ws_messages = self
            .messages
            .get(workspace_id)
            .map(|m| m.as_slice())
            .unwrap_or(&[]);

        ws_messages
            .iter()
            .filter(|m| m.reply_to.as_deref() == Some(parent_message_id) && !m.deleted)
            .cloned()
            .collect()
    }

    /// Get unread message count for a user in a workspace (simplified: messages after last read).
    pub fn message_count(&self, workspace_id: &str) -> usize {
        self.messages
            .get(workspace_id)
            .map(|m| m.iter().filter(|msg| !msg.deleted).count())
            .unwrap_or(0)
    }

    // ── Persistence ─────────────────────────────────────────────────

    fn persist(&self) {
        let path = std::path::Path::new(&self.data_dir).join("collaboration_messages.json");
        if let Ok(json) = serde_json::to_string_pretty(&self.messages) {
            let _ = std::fs::create_dir_all(&self.data_dir);
            let _ = std::fs::write(path, json);
        }
    }

    fn load_from_disk(&mut self) {
        let path = std::path::Path::new(&self.data_dir).join("collaboration_messages.json");
        if let Ok(data) = std::fs::read_to_string(path) {
            if let Ok(messages) = serde_json::from_str(&data) {
                self.messages = messages;
            }
        }
    }
}
