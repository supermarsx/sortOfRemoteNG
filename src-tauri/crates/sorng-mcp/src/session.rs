//! # MCP Session Management
//!
//! Manages MCP client sessions — creation, lookup, expiration, and cleanup.
//! Each session tracks client info, capabilities, subscriptions, and metrics.

use crate::types::*;
use chrono::Utc;
use std::collections::HashMap;
use uuid::Uuid;

/// Manages all active MCP sessions.
#[derive(Debug)]
pub struct SessionManager {
    sessions: HashMap<String, McpSession>,
    max_sessions: u32,
    session_timeout_secs: u64,
}

impl SessionManager {
    pub fn new(max_sessions: u32, session_timeout_secs: u64) -> Self {
        Self {
            sessions: HashMap::new(),
            max_sessions,
            session_timeout_secs,
        }
    }

    /// Create a new session. Returns the session ID.
    pub fn create_session(
        &mut self,
        client_info: Option<ImplementationInfo>,
        client_capabilities: ClientCapabilities,
        protocol_version: String,
    ) -> Result<String, String> {
        // Enforce max sessions
        if self.sessions.len() as u32 >= self.max_sessions {
            // Try to clean up expired sessions first
            self.cleanup_expired();
            if self.sessions.len() as u32 >= self.max_sessions {
                return Err("Maximum number of MCP sessions reached".to_string());
            }
        }

        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
        let session = McpSession {
            id: id.clone(),
            client_info,
            protocol_version,
            client_capabilities,
            created_at: now,
            last_active: now,
            request_count: 0,
            log_level: McpLogLevel::Info,
            subscriptions: vec![],
            initialized: false,
        };
        self.sessions.insert(id.clone(), session);
        Ok(id)
    }

    /// Mark a session as fully initialized.
    pub fn mark_initialized(&mut self, session_id: &str) -> bool {
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.initialized = true;
            session.last_active = Utc::now();
            true
        } else {
            false
        }
    }

    /// Get a session by ID.
    pub fn get_session(&self, session_id: &str) -> Option<&McpSession> {
        self.sessions.get(session_id)
    }

    /// Get a mutable session by ID.
    pub fn get_session_mut(&mut self, session_id: &str) -> Option<&mut McpSession> {
        self.sessions.get_mut(session_id)
    }

    /// Record activity on a session (updates last_active and request_count).
    pub fn touch_session(&mut self, session_id: &str) {
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.last_active = Utc::now();
            session.request_count += 1;
        }
    }

    /// Remove a session.
    pub fn remove_session(&mut self, session_id: &str) -> Option<McpSession> {
        self.sessions.remove(session_id)
    }

    /// Check if a session exists and is valid.
    pub fn is_valid(&self, session_id: &str) -> bool {
        if let Some(session) = self.sessions.get(session_id) {
            if self.session_timeout_secs > 0 {
                let elapsed = Utc::now()
                    .signed_duration_since(session.last_active)
                    .num_seconds();
                elapsed < self.session_timeout_secs as i64
            } else {
                true
            }
        } else {
            false
        }
    }

    /// Remove expired sessions.
    pub fn cleanup_expired(&mut self) -> Vec<String> {
        if self.session_timeout_secs == 0 {
            return vec![];
        }
        let now = Utc::now();
        let expired: Vec<String> = self
            .sessions
            .iter()
            .filter(|(_, s)| {
                now.signed_duration_since(s.last_active).num_seconds()
                    >= self.session_timeout_secs as i64
            })
            .map(|(id, _)| id.clone())
            .collect();
        for id in &expired {
            self.sessions.remove(id);
        }
        expired
    }

    /// Get count of active sessions.
    pub fn active_count(&self) -> u32 {
        self.sessions.len() as u32
    }

    /// List all active sessions.
    pub fn list_sessions(&self) -> Vec<McpSession> {
        self.sessions.values().cloned().collect()
    }

    /// Add a resource subscription to a session.
    pub fn add_subscription(&mut self, session_id: &str, uri: &str) -> bool {
        if let Some(session) = self.sessions.get_mut(session_id) {
            if !session.subscriptions.contains(&uri.to_string()) {
                session.subscriptions.push(uri.to_string());
            }
            true
        } else {
            false
        }
    }

    /// Remove a resource subscription from a session.
    pub fn remove_subscription(&mut self, session_id: &str, uri: &str) -> bool {
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.subscriptions.retain(|s| s != uri);
            true
        } else {
            false
        }
    }

    /// Get all session IDs subscribed to a given resource URI.
    pub fn get_subscribers(&self, uri: &str) -> Vec<String> {
        self.sessions
            .iter()
            .filter(|(_, s)| s.subscriptions.contains(&uri.to_string()))
            .map(|(id, _)| id.clone())
            .collect()
    }

    /// Set the log level for a session.
    pub fn set_log_level(&mut self, session_id: &str, level: McpLogLevel) -> bool {
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.log_level = level;
            true
        } else {
            false
        }
    }

    /// Update configuration.
    pub fn update_config(&mut self, max_sessions: u32, session_timeout_secs: u64) {
        self.max_sessions = max_sessions;
        self.session_timeout_secs = session_timeout_secs;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_manager() -> SessionManager {
        SessionManager::new(10, 3600)
    }

    #[test]
    fn test_create_and_get_session() {
        let mut mgr = make_manager();
        let id = mgr
            .create_session(
                Some(ImplementationInfo {
                    name: "TestClient".to_string(),
                    version: "1.0".to_string(),
                }),
                ClientCapabilities::default(),
                MCP_PROTOCOL_VERSION.to_string(),
            )
            .unwrap();
        assert!(mgr.get_session(&id).is_some());
        assert!(!mgr.get_session(&id).unwrap().initialized);
    }

    #[test]
    fn test_mark_initialized() {
        let mut mgr = make_manager();
        let id = mgr
            .create_session(
                None,
                ClientCapabilities::default(),
                "2025-03-26".to_string(),
            )
            .unwrap();
        assert!(mgr.mark_initialized(&id));
        assert!(mgr.get_session(&id).unwrap().initialized);
    }

    #[test]
    fn test_max_sessions() {
        let mut mgr = SessionManager::new(2, 3600);
        mgr.create_session(
            None,
            ClientCapabilities::default(),
            "2025-03-26".to_string(),
        )
        .unwrap();
        mgr.create_session(
            None,
            ClientCapabilities::default(),
            "2025-03-26".to_string(),
        )
        .unwrap();
        let result = mgr.create_session(
            None,
            ClientCapabilities::default(),
            "2025-03-26".to_string(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_remove_session() {
        let mut mgr = make_manager();
        let id = mgr
            .create_session(
                None,
                ClientCapabilities::default(),
                "2025-03-26".to_string(),
            )
            .unwrap();
        assert!(mgr.remove_session(&id).is_some());
        assert!(mgr.get_session(&id).is_none());
    }

    #[test]
    fn test_subscriptions() {
        let mut mgr = make_manager();
        let id = mgr
            .create_session(
                None,
                ClientCapabilities::default(),
                "2025-03-26".to_string(),
            )
            .unwrap();
        assert!(mgr.add_subscription(&id, "sorng://connections"));
        let subs = mgr.get_subscribers("sorng://connections");
        assert_eq!(subs.len(), 1);
        assert!(mgr.remove_subscription(&id, "sorng://connections"));
        assert_eq!(mgr.get_subscribers("sorng://connections").len(), 0);
    }

    #[test]
    fn test_touch_session() {
        let mut mgr = make_manager();
        let id = mgr
            .create_session(
                None,
                ClientCapabilities::default(),
                "2025-03-26".to_string(),
            )
            .unwrap();
        mgr.touch_session(&id);
        assert_eq!(mgr.get_session(&id).unwrap().request_count, 1);
    }
}
