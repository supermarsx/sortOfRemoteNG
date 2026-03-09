//! # Agent Forwarding Manager
//!
//! Manages SSH agent forwarding sessions. Tracks active forwarding channels,
//! enforces depth limits, applies key filtering per session, and controls
//! which keys are exposed through each forwarding hop.

use crate::types::*;
use log::info;
use std::collections::HashMap;

/// Manages agent forwarding sessions and policies.
pub struct ForwardingManager {
    /// Active forwarding sessions.
    sessions: HashMap<String, ForwardingSession>,
    /// Maximum forwarding depth (0 = unlimited).
    max_depth: u32,
    /// Whether forwarding is globally enabled.
    enabled: bool,
    /// Default key filter mode.
    _default_filter_mode: KeyFilterMode,
    /// Hosts for which forwarding is allowed (empty = all).
    allowed_hosts: Vec<String>,
    /// Hosts for which forwarding is denied.
    denied_hosts: Vec<String>,
}

/// How to filter keys when forwarding.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub enum KeyFilterMode {
    /// Forward all keys.
    #[default]
    AllKeys,
    /// Forward no keys (block forwarding).
    NoKeys,
    /// Forward only keys matching specific fingerprints.
    SelectedKeys(Vec<String>),
    /// Forward keys matching a pattern (glob on comment/fingerprint).
    Pattern(String),
}

/// Per-session forwarding policy.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ForwardingPolicy {
    /// Key filter for this session.
    pub filter: KeyFilterMode,
    /// Maximum depth from this point.
    pub max_sub_depth: u32,
    /// Whether to log all sign requests.
    pub audit_signs: bool,
}

impl Default for ForwardingPolicy {
    fn default() -> Self {
        Self {
            filter: KeyFilterMode::AllKeys,
            max_sub_depth: 1,
            audit_signs: true,
        }
    }
}

impl ForwardingManager {
    /// Create a new forwarding manager.
    pub fn new(max_depth: u32, enabled: bool) -> Self {
        Self {
            sessions: HashMap::new(),
            max_depth,
            enabled,
            _default_filter_mode: KeyFilterMode::AllKeys,
            allowed_hosts: Vec::new(),
            denied_hosts: Vec::new(),
        }
    }

    /// Whether forwarding is globally enabled.
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    /// Enable or disable forwarding globally.
    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    /// Start a new forwarding session.
    pub fn start_session(
        &mut self,
        session_id: &str,
        remote_host: &str,
        remote_user: &str,
        depth: u32,
        policy: Option<ForwardingPolicy>,
    ) -> Result<(), String> {
        if !self.enabled {
            return Err("Agent forwarding is disabled".to_string());
        }

        if self.max_depth > 0 && depth > self.max_depth {
            return Err(format!(
                "Forwarding depth {} exceeds maximum {}",
                depth, self.max_depth
            ));
        }

        if !self.is_host_allowed(remote_host) {
            return Err(format!("Forwarding not allowed to host: {}", remote_host));
        }

        let session = ForwardingSession {
            id: session_id.to_string(),
            remote_host: remote_host.to_string(),
            remote_user: remote_user.to_string(),
            started_at: chrono::Utc::now(),
            depth,
            active: true,
            key_filter: policy
                .as_ref()
                .map(|p| serde_json::to_string(&p.filter).unwrap_or_default())
                .unwrap_or_default(),
            sign_count: 0,
        };

        info!(
            "Starting forwarding session {} to {}@{} (depth={})",
            session_id, remote_user, remote_host, depth
        );

        self.sessions.insert(session_id.to_string(), session);
        Ok(())
    }

    /// Stop a forwarding session.
    pub fn stop_session(&mut self, session_id: &str) -> Result<ForwardingSession, String> {
        let mut session = self
            .sessions
            .remove(session_id)
            .ok_or_else(|| format!("Session not found: {}", session_id))?;

        session.active = false;
        info!(
            "Stopped forwarding session {} ({} signs)",
            session_id, session.sign_count
        );
        Ok(session)
    }

    /// Stop all sessions.
    pub fn stop_all_sessions(&mut self) -> usize {
        let count = self.sessions.len();
        self.sessions.clear();
        info!("Stopped all {} forwarding sessions", count);
        count
    }

    /// Get active sessions.
    pub fn active_sessions(&self) -> Vec<&ForwardingSession> {
        self.sessions.values().filter(|s| s.active).collect()
    }

    /// Get a session by ID.
    pub fn get_session(&self, session_id: &str) -> Option<&ForwardingSession> {
        self.sessions.get(session_id)
    }

    /// Record a sign operation in a forwarding session.
    pub fn record_sign(&mut self, session_id: &str) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("Session not found: {}", session_id))?;
        session.sign_count += 1;
        Ok(())
    }

    /// Check if a key (by fingerprint) should be visible in the given session.
    pub fn is_key_allowed_in_session(
        &self,
        session_id: &str,
        fingerprint: &str,
        comment: &str,
    ) -> bool {
        if let Some(session) = self.sessions.get(session_id) {
            if session.key_filter.is_empty() {
                return true;
            }
            // Try to deserialize the filter
            if let Ok(filter) = serde_json::from_str::<KeyFilterMode>(&session.key_filter) {
                return match filter {
                    KeyFilterMode::AllKeys => true,
                    KeyFilterMode::NoKeys => false,
                    KeyFilterMode::SelectedKeys(fps) => fps.iter().any(|f| f == fingerprint),
                    KeyFilterMode::Pattern(pat) => {
                        fingerprint.contains(&pat) || comment.contains(&pat)
                    }
                };
            }
        }
        // No session or unparseable filter → allow
        true
    }

    /// Check if a host is allowed for forwarding.
    fn is_host_allowed(&self, host: &str) -> bool {
        // Check deny list first
        for deny in &self.denied_hosts {
            if host == deny || (deny.starts_with("*.") && host.ends_with(&deny[1..])) {
                return false;
            }
        }
        // If allow list is empty, everything is allowed
        if self.allowed_hosts.is_empty() {
            return true;
        }
        // Check allow list
        for allow in &self.allowed_hosts {
            if host == allow || (allow.starts_with("*.") && host.ends_with(&allow[1..])) {
                return true;
            }
        }
        false
    }

    /// Set the allowed hosts.
    pub fn set_allowed_hosts(&mut self, hosts: Vec<String>) {
        self.allowed_hosts = hosts;
    }

    /// Set the denied hosts.
    pub fn set_denied_hosts(&mut self, hosts: Vec<String>) {
        self.denied_hosts = hosts;
    }

    /// Get the maximum depth.
    pub fn max_depth(&self) -> u32 {
        self.max_depth
    }

    /// Set the maximum depth.
    pub fn set_max_depth(&mut self, depth: u32) {
        self.max_depth = depth;
    }

    /// Count of active sessions.
    pub fn active_session_count(&self) -> usize {
        self.sessions.values().filter(|s| s.active).count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_start_stop_session() {
        let mut mgr = ForwardingManager::new(5, true);
        mgr.start_session("s1", "host.com", "user", 1, None)
            .unwrap();
        assert_eq!(mgr.active_session_count(), 1);

        let stopped = mgr.stop_session("s1").unwrap();
        assert!(!stopped.active);
        assert_eq!(mgr.active_session_count(), 0);
    }

    #[test]
    fn test_depth_limit() {
        let mut mgr = ForwardingManager::new(2, true);
        assert!(mgr.start_session("s1", "h", "u", 3, None).is_err());
    }

    #[test]
    fn test_disabled() {
        let mut mgr = ForwardingManager::new(5, false);
        assert!(mgr.start_session("s1", "h", "u", 1, None).is_err());
    }

    #[test]
    fn test_host_deny() {
        let mut mgr = ForwardingManager::new(5, true);
        mgr.set_denied_hosts(vec!["evil.com".to_string()]);
        assert!(mgr.start_session("s1", "evil.com", "u", 1, None).is_err());
        assert!(mgr.start_session("s2", "good.com", "u", 1, None).is_ok());
    }

    #[test]
    fn test_host_allow() {
        let mut mgr = ForwardingManager::new(5, true);
        mgr.set_allowed_hosts(vec!["*.safe.org".to_string()]);
        assert!(mgr.start_session("s1", "a.safe.org", "u", 1, None).is_ok());
        assert!(mgr.start_session("s2", "other.com", "u", 1, None).is_err());
    }

    #[test]
    fn test_record_sign() {
        let mut mgr = ForwardingManager::new(5, true);
        mgr.start_session("s1", "h", "u", 1, None).unwrap();
        mgr.record_sign("s1").unwrap();
        assert_eq!(mgr.get_session("s1").unwrap().sign_count, 1);
    }

    #[test]
    fn test_stop_all() {
        let mut mgr = ForwardingManager::new(5, true);
        mgr.start_session("s1", "h1", "u", 1, None).unwrap();
        mgr.start_session("s2", "h2", "u", 1, None).unwrap();
        assert_eq!(mgr.stop_all_sessions(), 2);
    }
}
