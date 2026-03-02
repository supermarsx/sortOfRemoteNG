//! # P2P Service
//!
//! Central orchestrator for the P2P engine — manages sessions, coordinates NAT detection,
//! ICE gathering, signaling, hole-punching, and relay fallback.

use crate::types::*;
use chrono::Utc;
use log::{debug, error, info, warn};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

pub type P2pServiceState = Arc<Mutex<P2pService>>;

/// The P2P service — manages all P2P sessions and coordinates the connection lifecycle.
pub struct P2pService {
    /// Engine configuration
    config: P2pConfig,
    /// Local peer identity
    identity: Option<PeerIdentity>,
    /// Active and recent sessions
    sessions: HashMap<String, P2pSession>,
    /// Discovered peers
    discovered_peers: HashMap<String, DiscoveredPeer>,
    /// Trusted peers (verified identities)
    trusted_peers: HashMap<String, TrustedPeer>,
    /// Cached NAT detection result
    cached_nat: Option<NatDetectionResult>,
    /// Session metrics history (session_id → Vec<metrics snapshots>)
    metrics_history: HashMap<String, Vec<P2pMetrics>>,
    /// Whether the service is running
    running: bool,
}

impl P2pService {
    /// Create a new P2P service with default configuration.
    pub fn new() -> Self {
        Self {
            config: P2pConfig::default(),
            identity: None,
            sessions: HashMap::new(),
            discovered_peers: HashMap::new(),
            trusted_peers: HashMap::new(),
            cached_nat: None,
            metrics_history: HashMap::new(),
            running: false,
        }
    }

    /// Create a new P2P service with custom configuration.
    pub fn with_config(config: P2pConfig) -> Self {
        Self {
            config,
            identity: None,
            sessions: HashMap::new(),
            discovered_peers: HashMap::new(),
            trusted_peers: HashMap::new(),
            cached_nat: None,
            metrics_history: HashMap::new(),
            running: false,
        }
    }

    // ── Configuration ──────────────────────────────────────────

    /// Get the current configuration.
    pub fn config(&self) -> &P2pConfig {
        &self.config
    }

    /// Update the configuration.
    pub fn set_config(&mut self, config: P2pConfig) {
        self.config = config;
    }

    /// Add a STUN server.
    pub fn add_stun_server(&mut self, server: StunServer) {
        self.config.stun_servers.push(server);
    }

    /// Add a TURN server.
    pub fn add_turn_server(&mut self, server: TurnServer) {
        self.config.turn_servers.push(server);
    }

    /// Set the signaling server URL.
    pub fn set_signaling_url(&mut self, url: &str) {
        self.config.signaling_url = Some(url.to_string());
    }

    /// Set the rendezvous server URL.
    pub fn set_rendezvous_url(&mut self, url: &str) {
        self.config.rendezvous_url = Some(url.to_string());
    }

    // ── Identity ───────────────────────────────────────────────

    /// Get the local peer identity.
    pub fn identity(&self) -> Option<&PeerIdentity> {
        self.identity.as_ref()
    }

    /// Initialize or load the local peer identity.
    pub fn init_identity(&mut self, display_name: &str) -> Result<PeerIdentity, String> {
        let peer_id = uuid::Uuid::new_v4().to_string();
        // Generate X25519 keypair
        let keypair = crate::peer_identity::generate_keypair();
        let public_key = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &keypair.public_key,
        );
        let fingerprint = crate::peer_identity::compute_fingerprint(&keypair.public_key);

        let identity = PeerIdentity {
            peer_id,
            display_name: display_name.to_string(),
            public_key,
            created_at: Utc::now(),
            fingerprint,
        };

        self.identity = Some(identity.clone());
        info!("P2P identity initialized: {}", identity.peer_id);
        Ok(identity)
    }

    /// Set an externally-created identity.
    pub fn set_identity(&mut self, identity: PeerIdentity) {
        info!("P2P identity set: {}", identity.peer_id);
        self.identity = Some(identity);
    }

    // ── Lifecycle ──────────────────────────────────────────────

    /// Start the P2P service (begin mDNS discovery, signaling connection, etc.).
    pub fn start(&mut self) -> Result<(), String> {
        if self.running {
            return Err("P2P service is already running".to_string());
        }
        if self.identity.is_none() {
            return Err("Identity must be initialized before starting".to_string());
        }
        info!("Starting P2P service");
        self.running = true;
        // In a full implementation, this would:
        // 1. Connect to the signaling server (WebSocket)
        // 2. Start mDNS listener/advertiser
        // 3. Start LAN broadcast listener
        // 4. Run initial NAT detection
        Ok(())
    }

    /// Stop the P2P service and close all sessions.
    pub fn stop(&mut self) -> Result<(), String> {
        if !self.running {
            return Ok(());
        }
        info!("Stopping P2P service — closing {} sessions", self.sessions.len());
        // Close all active sessions
        let session_ids: Vec<String> = self
            .sessions
            .iter()
            .filter(|(_, s)| s.state.is_active())
            .map(|(id, _)| id.clone())
            .collect();
        for id in session_ids {
            let _ = self.close_session(&id);
        }
        self.running = false;
        Ok(())
    }

    /// Whether the service is running.
    pub fn is_running(&self) -> bool {
        self.running
    }

    // ── NAT Detection ──────────────────────────────────────────

    /// Get the cached NAT detection result.
    pub fn nat_result(&self) -> Option<&NatDetectionResult> {
        self.cached_nat.as_ref()
    }

    /// Run NAT detection (using configured STUN servers).
    pub fn detect_nat(&mut self) -> Result<NatDetectionResult, String> {
        info!("Running NAT detection");
        let result = crate::nat_detect::detect_nat_type(&self.config.stun_servers)?;
        info!("NAT type detected: {:?}", result.nat_type);
        self.cached_nat = Some(result.clone());
        Ok(result)
    }

    // ── Session Management ─────────────────────────────────────

    /// Create a connection offer to initiate a P2P session with a remote peer.
    pub fn create_offer(
        &mut self,
        remote_peer_id: &str,
        target_protocol: &str,
        target_port: u16,
    ) -> Result<ConnectionOffer, String> {
        let identity = self
            .identity
            .as_ref()
            .ok_or("Identity not initialized")?
            .clone();

        // NAT type for the offer
        let nat_type = self
            .cached_nat
            .as_ref()
            .map(|n| n.nat_type)
            .unwrap_or(NatType::Unknown);

        let session_id = uuid::Uuid::new_v4().to_string();

        // Gather ICE candidates
        let candidates = crate::ice::gather_candidates(&self.config)?;

        let offer = ConnectionOffer {
            session_id: session_id.clone(),
            peer_id: identity.peer_id.clone(),
            peer_name: identity.display_name.clone(),
            target_protocol: target_protocol.to_string(),
            target_port,
            nat_type,
            candidates: candidates.clone(),
            public_key: identity.public_key.clone(),
            cipher_suite: "CHACHA20-POLY1305".to_string(),
            created_at: Utc::now(),
            ttl_secs: 120,
        };

        // Create the session
        let session = P2pSession {
            id: session_id.clone(),
            local_peer_id: identity.peer_id.clone(),
            remote_peer_id: remote_peer_id.to_string(),
            remote_peer_name: String::new(),
            state: P2pSessionState::OfferSent,
            transport: P2pTransport::Unknown,
            target_protocol: target_protocol.to_string(),
            target_port,
            local_port: 0,
            ice_state: IceState::Gathering,
            selected_pair: None,
            local_candidates: candidates,
            remote_candidates: Vec::new(),
            local_nat_type: nat_type,
            remote_nat_type: None,
            bytes_sent: 0,
            bytes_received: 0,
            rtt_ms: None,
            created_at: Utc::now(),
            connected_at: None,
            ended_at: None,
            encrypted: true,
            cipher_suite: "CHACHA20-POLY1305".to_string(),
        };

        self.sessions.insert(session_id.clone(), session);
        info!("Created P2P offer for session {}", session_id);

        Ok(offer)
    }

    /// Accept a connection offer and generate an answer.
    pub fn accept_offer(&mut self, offer: &ConnectionOffer) -> Result<ConnectionAnswer, String> {
        let identity = self
            .identity
            .as_ref()
            .ok_or("Identity not initialized")?
            .clone();

        // Gather our own ICE candidates
        let candidates = crate::ice::gather_candidates(&self.config)?;

        let answer = ConnectionAnswer {
            session_id: offer.session_id.clone(),
            peer_id: identity.peer_id.clone(),
            peer_name: identity.display_name.clone(),
            accepted: true,
            reject_reason: None,
            candidates: candidates.clone(),
            public_key: identity.public_key.clone(),
            cipher_suite: offer.cipher_suite.clone(),
            created_at: Utc::now(),
        };

        // Create the session on our side
        let session = P2pSession {
            id: offer.session_id.clone(),
            local_peer_id: identity.peer_id.clone(),
            remote_peer_id: offer.peer_id.clone(),
            remote_peer_name: offer.peer_name.clone(),
            state: P2pSessionState::Connecting,
            transport: P2pTransport::Unknown,
            target_protocol: offer.target_protocol.clone(),
            target_port: offer.target_port,
            local_port: 0,
            ice_state: IceState::Checking,
            selected_pair: None,
            local_candidates: candidates,
            remote_candidates: offer.candidates.clone(),
            local_nat_type: self
                .cached_nat
                .as_ref()
                .map(|n| n.nat_type)
                .unwrap_or(NatType::Unknown),
            remote_nat_type: Some(offer.nat_type),
            bytes_sent: 0,
            bytes_received: 0,
            rtt_ms: None,
            created_at: Utc::now(),
            connected_at: None,
            ended_at: None,
            encrypted: true,
            cipher_suite: offer.cipher_suite.clone(),
        };

        self.sessions.insert(offer.session_id.clone(), session);
        info!("Accepted P2P offer for session {}", offer.session_id);

        Ok(answer)
    }

    /// Reject a connection offer.
    pub fn reject_offer(
        &self,
        offer: &ConnectionOffer,
        reason: &str,
    ) -> Result<ConnectionAnswer, String> {
        let identity = self.identity.as_ref().ok_or("Identity not initialized")?;

        Ok(ConnectionAnswer {
            session_id: offer.session_id.clone(),
            peer_id: identity.peer_id.clone(),
            peer_name: identity.display_name.clone(),
            accepted: false,
            reject_reason: Some(reason.to_string()),
            candidates: Vec::new(),
            public_key: String::new(),
            cipher_suite: String::new(),
            created_at: Utc::now(),
        })
    }

    /// Process a received answer to our offer.
    pub fn process_answer(&mut self, answer: &ConnectionAnswer) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(&answer.session_id)
            .ok_or("Session not found")?;

        if !answer.accepted {
            session.state = P2pSessionState::Failed;
            session.ended_at = Some(Utc::now());
            let reason = answer.reject_reason.as_deref().unwrap_or("unknown");
            warn!("P2P offer rejected for session {}: {}", answer.session_id, reason);
            return Err(format!("Offer rejected: {}", reason));
        }

        session.remote_peer_name = answer.peer_name.clone();
        session.remote_candidates = answer.candidates.clone();
        session.state = P2pSessionState::Checking;
        session.ice_state = IceState::Checking;

        info!(
            "Processing answer for session {} — {} remote candidates",
            answer.session_id,
            answer.candidates.len()
        );

        Ok(())
    }

    /// Add a trickled ICE candidate to a session.
    pub fn add_remote_candidate(
        &mut self,
        session_id: &str,
        candidate: IceCandidate,
    ) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or("Session not found")?;

        debug!(
            "Adding remote candidate to session {}: {:?} {}:{}",
            session_id, candidate.candidate_type, candidate.address, candidate.port
        );
        session.remote_candidates.push(candidate);
        Ok(())
    }

    /// Establish the P2P connection for a session (run ICE, hole-punch, or relay).
    pub fn connect(&mut self, session_id: &str) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or("Session not found")?;

        info!("Connecting P2P session {}", session_id);

        // Determine best approach based on NAT types
        let local_nat = session.local_nat_type;
        let remote_nat = session.remote_nat_type.unwrap_or(NatType::Unknown);

        if local_nat.hole_punch_viable() && remote_nat.hole_punch_viable() {
            info!("Attempting direct hole-punch (local={:?}, remote={:?})", local_nat, remote_nat);
            session.state = P2pSessionState::Checking;

            // Try ICE connectivity checks to find a working pair
            let pair = crate::ice::check_connectivity(
                &session.local_candidates,
                &session.remote_candidates,
                self.config.ice_check_timeout_secs,
            )?;

            session.selected_pair = Some(pair.clone());
            session.transport = if pair.local.transport == "udp" {
                P2pTransport::DirectUdp
            } else {
                P2pTransport::DirectTcp
            };
            session.state = P2pSessionState::Connected;
            session.ice_state = IceState::Connected;
            session.connected_at = Some(Utc::now());
            session.rtt_ms = pair.rtt_ms;

            info!(
                "P2P session {} connected directly via {:?}",
                session_id, session.transport
            );
        } else if local_nat.requires_relay() || remote_nat.requires_relay() {
            info!("NAT requires relay — using TURN fallback");
            session.state = P2pSessionState::Relayed;
            session.transport = P2pTransport::TurnRelayUdp;
            session.ice_state = IceState::Completed;
            session.connected_at = Some(Utc::now());

            info!("P2P session {} connected via TURN relay", session_id);
        } else {
            // Try hole-punch first, fall back to relay
            info!("Attempting hole-punch with relay fallback");
            match crate::hole_punch::attempt_hole_punch(
                &session.local_candidates,
                &session.remote_candidates,
            ) {
                Ok(pair) => {
                    session.selected_pair = Some(pair.clone());
                    session.transport = P2pTransport::DirectUdp;
                    session.state = P2pSessionState::Connected;
                    session.ice_state = IceState::Connected;
                    session.connected_at = Some(Utc::now());
                    session.rtt_ms = pair.rtt_ms;
                    info!("P2P session {} hole-punched successfully", session_id);
                }
                Err(e) => {
                    warn!("Hole-punch failed for session {}: {} — falling back to relay", session_id, e);
                    session.state = P2pSessionState::Relayed;
                    session.transport = P2pTransport::AppRelay;
                    session.ice_state = IceState::Completed;
                    session.connected_at = Some(Utc::now());
                }
            }
        }

        Ok(())
    }

    /// Close a P2P session.
    pub fn close_session(&mut self, session_id: &str) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or("Session not found")?;

        if !session.state.is_active()
            && session.state != P2pSessionState::OfferSent
            && session.state != P2pSessionState::Connecting
            && session.state != P2pSessionState::Gathering
            && session.state != P2pSessionState::Checking
        {
            return Ok(());
        }

        info!("Closing P2P session {}", session_id);
        session.state = P2pSessionState::Closed;
        session.ice_state = IceState::Closed;
        session.ended_at = Some(Utc::now());

        Ok(())
    }

    // ── Session Queries ────────────────────────────────────────

    /// Get a session by ID.
    pub fn get_session(&self, session_id: &str) -> Option<&P2pSession> {
        self.sessions.get(session_id)
    }

    /// List all sessions.
    pub fn list_sessions(&self) -> Vec<&P2pSession> {
        self.sessions.values().collect()
    }

    /// List active sessions.
    pub fn active_sessions(&self) -> Vec<&P2pSession> {
        self.sessions
            .values()
            .filter(|s| s.state.is_active())
            .collect()
    }

    /// Get session count.
    pub fn session_count(&self) -> usize {
        self.sessions.len()
    }

    /// Get active session count.
    pub fn active_session_count(&self) -> usize {
        self.sessions.values().filter(|s| s.state.is_active()).count()
    }

    // ── Peer Discovery ─────────────────────────────────────────

    /// Get all discovered peers.
    pub fn discovered_peers(&self) -> Vec<&DiscoveredPeer> {
        self.discovered_peers.values().collect()
    }

    /// Add or update a discovered peer.
    pub fn upsert_discovered_peer(&mut self, peer: DiscoveredPeer) {
        debug!("Discovered peer: {} ({})", peer.name, peer.peer_id);
        self.discovered_peers.insert(peer.peer_id.clone(), peer);
    }

    /// Remove a discovered peer.
    pub fn remove_discovered_peer(&mut self, peer_id: &str) {
        self.discovered_peers.remove(peer_id);
    }

    // ── Trusted Peers ──────────────────────────────────────────

    /// Get all trusted peers.
    pub fn trusted_peers(&self) -> Vec<&TrustedPeer> {
        self.trusted_peers.values().collect()
    }

    /// Trust a peer.
    pub fn trust_peer(&mut self, peer_id: &str, name: &str, fingerprint: &str) {
        let trusted = TrustedPeer {
            peer_id: peer_id.to_string(),
            name: name.to_string(),
            fingerprint: fingerprint.to_string(),
            trusted_at: Utc::now(),
            connection_count: 0,
            last_connected: None,
        };
        self.trusted_peers.insert(peer_id.to_string(), trusted);
        info!("Trusted peer: {} ({})", name, peer_id);
    }

    /// Revoke trust for a peer.
    pub fn untrust_peer(&mut self, peer_id: &str) -> bool {
        self.trusted_peers.remove(peer_id).is_some()
    }

    /// Whether a peer is trusted.
    pub fn is_trusted(&self, peer_id: &str) -> bool {
        self.trusted_peers.contains_key(peer_id)
    }

    // ── Metrics ────────────────────────────────────────────────

    /// Record a metrics snapshot for a session.
    pub fn record_metrics(&mut self, metrics: P2pMetrics) {
        let session_id = metrics.session_id.clone();
        self.metrics_history
            .entry(session_id)
            .or_default()
            .push(metrics);
    }

    /// Get metrics history for a session.
    pub fn get_metrics(&self, session_id: &str) -> Vec<&P2pMetrics> {
        self.metrics_history
            .get(session_id)
            .map(|v| v.iter().collect())
            .unwrap_or_default()
    }

    /// Get the most recent metrics for a session.
    pub fn latest_metrics(&self, session_id: &str) -> Option<&P2pMetrics> {
        self.metrics_history.get(session_id).and_then(|v| v.last())
    }

    /// Get aggregate stats across all active sessions.
    pub fn aggregate_stats(&self) -> P2pAggregateStats {
        let active = self.active_sessions();
        P2pAggregateStats {
            active_sessions: active.len(),
            direct_connections: active
                .iter()
                .filter(|s| s.transport.is_direct())
                .count(),
            relayed_connections: active
                .iter()
                .filter(|s| !s.transport.is_direct() && s.transport != P2pTransport::Unknown)
                .count(),
            total_bytes_sent: active.iter().map(|s| s.bytes_sent).sum(),
            total_bytes_received: active.iter().map(|s| s.bytes_received).sum(),
            avg_rtt_ms: {
                let rtts: Vec<u64> = active.iter().filter_map(|s| s.rtt_ms).collect();
                if rtts.is_empty() {
                    None
                } else {
                    Some(rtts.iter().sum::<u64>() / rtts.len() as u64)
                }
            },
            discovered_peers: self.discovered_peers.len(),
            trusted_peers: self.trusted_peers.len(),
        }
    }
}

impl Default for P2pService {
    fn default() -> Self {
        Self::new()
    }
}

/// Aggregate stats across all P2P sessions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct P2pAggregateStats {
    pub active_sessions: usize,
    pub direct_connections: usize,
    pub relayed_connections: usize,
    pub total_bytes_sent: u64,
    pub total_bytes_received: u64,
    pub avg_rtt_ms: Option<u64>,
    pub discovered_peers: usize,
    pub trusted_peers: usize,
}

use serde::{Deserialize, Serialize};
