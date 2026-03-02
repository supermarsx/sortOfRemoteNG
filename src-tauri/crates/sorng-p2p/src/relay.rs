//! # Application-Level Relay
//!
//! Fallback relay service for when NAT traversal fails and no TURN server is
//! available. Routes encrypted data through the signaling server or a dedicated
//! relay node. This is the transport of last resort.

use crate::types::*;
use chrono::{DateTime, Utc};
use log::{debug, info, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Relay session state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RelaySessionState {
    /// Requesting relay allocation
    Requesting,
    /// Relay allocated, waiting for peer
    Allocated,
    /// Both peers connected, relay active
    Active,
    /// Relay session closed
    Closed,
    /// Relay failed
    Failed,
}

/// A relay session — two peers connected through a relay node.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelaySession {
    /// Session ID
    pub id: String,
    /// Relay node used
    pub relay_node: String,
    /// Relay allocation token
    pub allocation_token: String,
    /// State
    pub state: RelaySessionState,
    /// Peer A ID
    pub peer_a: String,
    /// Peer B ID
    pub peer_b: String,
    /// Whether the data is end-to-end encrypted (relay can't read it)
    pub e2e_encrypted: bool,
    /// Bytes relayed
    pub bytes_relayed: u64,
    /// Session creation time
    pub created_at: DateTime<Utc>,
    /// Session end time
    pub ended_at: Option<DateTime<Utc>>,
    /// Maximum relay duration in seconds (0 = unlimited)
    pub max_duration_secs: u32,
    /// Maximum relay bandwidth in bytes/sec (0 = unlimited)
    pub max_bandwidth: u64,
}

/// Relay node configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelayConfig {
    /// Maximum concurrent relay sessions
    pub max_sessions: u32,
    /// Maximum relay session duration in seconds
    pub max_session_duration_secs: u32,
    /// Maximum bandwidth per session (bytes/sec)
    pub max_bandwidth_per_session: u64,
    /// Total bandwidth budget (bytes/sec)
    pub total_bandwidth_budget: u64,
    /// Whether to require end-to-end encryption
    pub require_e2e_encryption: bool,
    /// Relay server URL
    pub relay_url: Option<String>,
}

impl Default for RelayConfig {
    fn default() -> Self {
        Self {
            max_sessions: 100,
            max_session_duration_secs: 3600, // 1 hour
            max_bandwidth_per_session: 10 * 1024 * 1024, // 10 MB/s
            total_bandwidth_budget: 100 * 1024 * 1024, // 100 MB/s
            require_e2e_encryption: true,
            relay_url: None,
        }
    }
}

/// The relay client — manages relay sessions for NAT traversal fallback.
pub struct RelayClient {
    /// Configuration
    config: RelayConfig,
    /// Active relay sessions
    sessions: HashMap<String, RelaySession>,
    /// Total bytes relayed across all sessions
    total_bytes_relayed: u64,
}

impl RelayClient {
    /// Create a new relay client.
    pub fn new(config: RelayConfig) -> Self {
        Self {
            config,
            sessions: HashMap::new(),
            total_bytes_relayed: 0,
        }
    }

    /// Request a relay allocation for a P2P session.
    pub fn request_relay(
        &mut self,
        session_id: &str,
        local_peer_id: &str,
        remote_peer_id: &str,
    ) -> Result<RelaySession, String> {
        if self.sessions.len() >= self.config.max_sessions as usize {
            return Err("Maximum relay sessions reached".to_string());
        }

        let relay_url = self
            .config
            .relay_url
            .as_ref()
            .ok_or("No relay server configured")?;

        info!(
            "Requesting relay allocation for session {} (peers: {} <-> {})",
            session_id, local_peer_id, remote_peer_id
        );

        // In a real implementation:
        // 1. POST /api/v1/relay/allocate to the relay server
        //    - Include both peer IDs and session ID
        //    - Server allocates relay resources and returns a token
        // 2. Both peers connect to the relay server with the token
        // 3. Relay server bridges data between the two connections

        let allocation_token = uuid::Uuid::new_v4().to_string();

        let session = RelaySession {
            id: session_id.to_string(),
            relay_node: relay_url.clone(),
            allocation_token,
            state: RelaySessionState::Allocated,
            peer_a: local_peer_id.to_string(),
            peer_b: remote_peer_id.to_string(),
            e2e_encrypted: true,
            bytes_relayed: 0,
            created_at: Utc::now(),
            ended_at: None,
            max_duration_secs: self.config.max_session_duration_secs,
            max_bandwidth: self.config.max_bandwidth_per_session,
        };

        self.sessions.insert(session_id.to_string(), session.clone());

        info!("Relay allocated for session {}", session_id);
        Ok(session)
    }

    /// Activate a relay session (both peers have connected).
    pub fn activate_session(&mut self, session_id: &str) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or("Relay session not found")?;

        if session.state != RelaySessionState::Allocated {
            return Err(format!("Cannot activate session in state {:?}", session.state));
        }

        session.state = RelaySessionState::Active;
        info!("Relay session {} activated", session_id);
        Ok(())
    }

    /// Send data through a relay session.
    pub fn relay_data(
        &mut self,
        session_id: &str,
        data: &[u8],
    ) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or("Relay session not found")?;

        if session.state != RelaySessionState::Active {
            return Err(format!("Relay session is {:?}", session.state));
        }

        // Check bandwidth limits
        // In a real implementation, this would send the data to the relay server

        session.bytes_relayed += data.len() as u64;
        self.total_bytes_relayed += data.len() as u64;

        debug!(
            "Relayed {} bytes for session {} (total: {})",
            data.len(),
            session_id,
            session.bytes_relayed
        );

        Ok(())
    }

    /// Close a relay session.
    pub fn close_session(&mut self, session_id: &str) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or("Relay session not found")?;

        session.state = RelaySessionState::Closed;
        session.ended_at = Some(Utc::now());

        info!(
            "Relay session {} closed (relayed {} bytes)",
            session_id, session.bytes_relayed
        );

        Ok(())
    }

    /// Get a relay session by ID.
    pub fn get_session(&self, session_id: &str) -> Option<&RelaySession> {
        self.sessions.get(session_id)
    }

    /// List all relay sessions.
    pub fn list_sessions(&self) -> Vec<&RelaySession> {
        self.sessions.values().collect()
    }

    /// List active relay sessions.
    pub fn active_sessions(&self) -> Vec<&RelaySession> {
        self.sessions
            .values()
            .filter(|s| s.state == RelaySessionState::Active)
            .collect()
    }

    /// Get total bytes relayed.
    pub fn total_bytes_relayed(&self) -> u64 {
        self.total_bytes_relayed
    }

    /// Cleanup expired sessions.
    pub fn cleanup_expired(&mut self) -> usize {
        let now = Utc::now();
        let expired: Vec<String> = self
            .sessions
            .iter()
            .filter(|(_, s)| {
                if s.state == RelaySessionState::Closed || s.state == RelaySessionState::Failed {
                    return false;
                }
                if s.max_duration_secs > 0 {
                    let elapsed = (now - s.created_at).num_seconds() as u32;
                    elapsed > s.max_duration_secs
                } else {
                    false
                }
            })
            .map(|(id, _)| id.clone())
            .collect();

        let count = expired.len();
        for id in &expired {
            if let Some(session) = self.sessions.get_mut(id) {
                session.state = RelaySessionState::Closed;
                session.ended_at = Some(now);
            }
        }

        if count > 0 {
            info!("Expired {} relay sessions", count);
        }
        count
    }
}

impl Default for RelayClient {
    fn default() -> Self {
        Self::new(RelayConfig::default())
    }
}

/// Try to upgrade a relayed connection to a direct one (ICE restart).
/// Returns true if upgrade is recommended based on the relay session metrics.
pub fn should_attempt_upgrade(session: &RelaySession) -> bool {
    // If the session has been relaying for a while and has significant traffic,
    // it's worth trying to establish a direct connection
    let duration = (Utc::now() - session.created_at).num_seconds();
    duration > 60 && session.bytes_relayed > 1024 * 1024 // Running >1min with >1MB relayed
}
