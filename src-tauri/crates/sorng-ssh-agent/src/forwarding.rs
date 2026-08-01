//! # Agent Forwarding Manager
//!
//! Manages SSH agent forwarding sessions. Tracks active forwarding channels,
//! enforces depth limits, applies key filtering per session, and controls
//! which keys are exposed through each forwarding hop.

use crate::types::*;
use log::info;
use std::collections::HashMap;

const MAX_FORWARDING_SESSIONS: usize = 64;
const MAX_SESSION_FIELD_LEN: usize = 255;
const MAX_HOST_RULES: usize = 256;

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
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub enum KeyFilterMode {
    /// Forward all keys.
    AllKeys,
    /// Forward no keys (block forwarding).
    #[default]
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
            filter: KeyFilterMode::NoKeys,
            max_sub_depth: 0,
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
            _default_filter_mode: KeyFilterMode::NoKeys,
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

        if self.max_depth == 0 || depth == 0 || depth > self.max_depth {
            return Err(format!(
                "Forwarding depth {} exceeds maximum {}",
                depth, self.max_depth
            ));
        }
        if self.sessions.len() >= MAX_FORWARDING_SESSIONS {
            return Err("Maximum forwarding session count reached".to_string());
        }
        if self.sessions.contains_key(session_id) {
            return Err("Forwarding session identifier already exists".to_string());
        }
        if [session_id, remote_host, remote_user].iter().any(|value| {
            value.is_empty()
                || value.len() > MAX_SESSION_FIELD_LEN
                || value.chars().any(char::is_control)
        }) {
            return Err("Invalid forwarding session field".to_string());
        }

        if !self.is_host_allowed(remote_host) {
            return Err("Forwarding destination is not explicitly allowed".to_string());
        }
        let policy =
            policy.ok_or_else(|| "An explicit forwarding key policy is required".to_string())?;
        if policy.max_sub_depth != 0 {
            return Err("Multi-hop forwarding policy is not implemented safely".to_string());
        }
        validate_filter(&policy.filter)?;
        let key_filter = serde_json::to_string(&policy.filter)
            .map_err(|_| "Failed to encode forwarding key policy".to_string())?;

        let session = ForwardingSession {
            id: session_id.to_string(),
            remote_host: remote_host.to_string(),
            remote_user: remote_user.to_string(),
            started_at: chrono::Utc::now(),
            depth,
            active: true,
            key_filter,
            sign_count: 0,
        };

        info!("Starting explicitly authorised forwarding session");

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
        session.sign_count = session
            .sign_count
            .checked_add(1)
            .ok_or_else(|| "Forwarding signature counter overflow".to_string())?;
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
                return false;
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
        // Missing sessions and malformed filters must never expose keys.
        false
    }

    /// Check if a host is allowed for forwarding.
    fn is_host_allowed(&self, host: &str) -> bool {
        // Check deny list first
        for deny in &self.denied_hosts {
            if host == deny || (deny.starts_with("*.") && host.ends_with(&deny[1..])) {
                return false;
            }
        }
        // Forwarding requires an explicit allow list.
        if self.allowed_hosts.is_empty() {
            return false;
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
    pub fn set_allowed_hosts(&mut self, hosts: Vec<String>) -> Result<(), String> {
        validate_host_rules(&hosts)?;
        self.allowed_hosts = hosts;
        Ok(())
    }

    /// Set the denied hosts.
    pub fn set_denied_hosts(&mut self, hosts: Vec<String>) -> Result<(), String> {
        validate_host_rules(&hosts)?;
        self.denied_hosts = hosts;
        Ok(())
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

fn validate_filter(filter: &KeyFilterMode) -> Result<(), String> {
    match filter {
        KeyFilterMode::SelectedKeys(fingerprints) => {
            if fingerprints.is_empty()
                || fingerprints.len() > 64
                || fingerprints
                    .iter()
                    .any(|value| value.is_empty() || value.len() > 256)
            {
                return Err("Invalid selected-key forwarding policy".to_string());
            }
        }
        KeyFilterMode::Pattern(pattern) => {
            if pattern.is_empty() || pattern.len() > 256 || pattern.chars().any(char::is_control) {
                return Err("Invalid forwarding key pattern".to_string());
            }
        }
        KeyFilterMode::AllKeys | KeyFilterMode::NoKeys => {}
    }
    Ok(())
}

fn validate_host_rules(hosts: &[String]) -> Result<(), String> {
    if hosts.len() > MAX_HOST_RULES
        || hosts.iter().any(|host| {
            let hostname = host.strip_prefix("*.").unwrap_or(host);
            hostname.is_empty()
                || host.len() > MAX_SESSION_FIELD_LEN
                || host.chars().any(char::is_control)
                || host.chars().any(char::is_whitespace)
                || host.contains('/')
                || hostname.contains('*')
        })
    {
        return Err("Invalid forwarding host policy".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn deny_all_policy() -> Option<ForwardingPolicy> {
        Some(ForwardingPolicy::default())
    }

    #[test]
    fn test_start_stop_session() {
        let mut mgr = ForwardingManager::new(5, true);
        mgr.set_allowed_hosts(vec!["host.com".to_string()]).unwrap();
        mgr.start_session("s1", "host.com", "user", 1, deny_all_policy())
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
        mgr.set_allowed_hosts(vec!["good.com".to_string(), "evil.com".to_string()])
            .unwrap();
        mgr.set_denied_hosts(vec!["evil.com".to_string()]).unwrap();
        assert!(mgr
            .start_session("s1", "evil.com", "u", 1, deny_all_policy())
            .is_err());
        assert!(mgr
            .start_session("s2", "good.com", "u", 1, deny_all_policy())
            .is_ok());
    }

    #[test]
    fn test_host_allow() {
        let mut mgr = ForwardingManager::new(5, true);
        mgr.set_allowed_hosts(vec!["*.safe.org".to_string()])
            .unwrap();
        assert!(mgr
            .start_session("s1", "a.safe.org", "u", 1, deny_all_policy())
            .is_ok());
        assert!(mgr
            .start_session("s2", "other.com", "u", 1, deny_all_policy())
            .is_err());
    }

    #[test]
    fn test_record_sign() {
        let mut mgr = ForwardingManager::new(5, true);
        mgr.set_allowed_hosts(vec!["h".to_string()]).unwrap();
        mgr.start_session("s1", "h", "u", 1, deny_all_policy())
            .unwrap();
        mgr.record_sign("s1").unwrap();
        assert_eq!(mgr.get_session("s1").unwrap().sign_count, 1);
    }

    #[test]
    fn test_stop_all() {
        let mut mgr = ForwardingManager::new(5, true);
        mgr.set_allowed_hosts(vec!["h1".to_string(), "h2".to_string()])
            .unwrap();
        mgr.start_session("s1", "h1", "u", 1, deny_all_policy())
            .unwrap();
        mgr.start_session("s2", "h2", "u", 1, deny_all_policy())
            .unwrap();
        assert_eq!(mgr.stop_all_sessions(), 2);
    }
}
