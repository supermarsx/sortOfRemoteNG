//! # Signaling Client
//!
//! WebSocket-based signaling client for exchanging SDP offers, answers, and
//! ICE candidates between peers. The signaling server acts as a rendezvous
//! point — it does not relay data, only control messages.

use crate::types::*;
use chrono::{DateTime, Utc};
use log::{debug, error, info, warn};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

/// Signaling client state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SignalingState {
    /// Not connected to signaling server
    Disconnected,
    /// Connecting to signaling server
    Connecting,
    /// Connected and authenticated
    Connected,
    /// Connection failed
    Failed,
    /// Reconnecting after disconnection
    Reconnecting,
}

/// Signaling client configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignalingConfig {
    /// WebSocket URL of the signaling server
    pub server_url: String,
    /// Authentication token
    pub auth_token: Option<String>,
    /// Auto-reconnect on disconnection
    pub auto_reconnect: bool,
    /// Reconnect delay in milliseconds
    pub reconnect_delay_ms: u64,
    /// Maximum reconnect attempts
    pub max_reconnect_attempts: u32,
    /// Heartbeat interval in seconds
    pub heartbeat_interval_secs: u32,
    /// Message timeout in seconds
    pub message_timeout_secs: u32,
}

impl Default for SignalingConfig {
    fn default() -> Self {
        Self {
            server_url: String::new(),
            auth_token: None,
            auto_reconnect: true,
            reconnect_delay_ms: 2000,
            max_reconnect_attempts: 10,
            heartbeat_interval_secs: 30,
            message_timeout_secs: 15,
        }
    }
}

/// Protocol messages exchanged with the signaling server.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum SignalingProtocol {
    /// Register with the signaling server
    Register {
        peer_id: String,
        display_name: String,
        capabilities: Vec<String>,
    },
    /// Registration acknowledged
    RegisterAck {
        server_id: String,
        ice_servers: Vec<IceServerInfo>,
    },
    /// Relay a message to another peer
    Relay {
        to_peer: String,
        message: SignalingMessage,
    },
    /// A message was relayed to us from another peer
    Relayed {
        from_peer: String,
        message: SignalingMessage,
    },
    /// Query online peers
    PeerQuery {
        filter: Option<String>,
    },
    /// Peer list response
    PeerList {
        peers: Vec<OnlinePeer>,
    },
    /// Peer came online
    PeerOnline {
        peer_id: String,
        display_name: String,
    },
    /// Peer went offline
    PeerOffline {
        peer_id: String,
    },
    /// Heartbeat
    Ping {
        timestamp: i64,
    },
    /// Heartbeat response
    Pong {
        timestamp: i64,
    },
    /// Error from server
    Error {
        code: u32,
        message: String,
    },
}

/// ICE server info provided by the signaling server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IceServerInfo {
    /// Server URLs (stun: or turn:)
    pub urls: Vec<String>,
    /// Username (for TURN)
    pub username: Option<String>,
    /// Credential (for TURN)
    pub credential: Option<String>,
}

/// An online peer reported by the signaling server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OnlinePeer {
    /// Peer ID
    pub peer_id: String,
    /// Display name
    pub display_name: String,
    /// Capabilities advertised
    pub capabilities: Vec<String>,
    /// When the peer registered
    pub online_since: DateTime<Utc>,
}

/// Signaling client — manages the WebSocket connection to the signaling server.
pub struct SignalingClient {
    /// Configuration
    config: SignalingConfig,
    /// Current state
    state: SignalingState,
    /// Our peer ID
    peer_id: Option<String>,
    /// Queue of outbound messages
    outbound_queue: VecDeque<SignalingProtocol>,
    /// Queue of inbound messages (received from server)
    inbound_queue: VecDeque<SignalingProtocol>,
    /// Reconnect attempt counter
    reconnect_attempts: u32,
    /// Known online peers
    online_peers: Vec<OnlinePeer>,
    /// ICE servers provided by the signaling server
    ice_servers: Vec<IceServerInfo>,
    /// Message sequence number
    sequence: u64,
}

impl SignalingClient {
    /// Create a new signaling client.
    pub fn new(config: SignalingConfig) -> Self {
        Self {
            config,
            state: SignalingState::Disconnected,
            peer_id: None,
            outbound_queue: VecDeque::new(),
            inbound_queue: VecDeque::new(),
            reconnect_attempts: 0,
            online_peers: Vec::new(),
            ice_servers: Vec::new(),
            sequence: 0,
        }
    }

    /// Get the current state.
    pub fn state(&self) -> SignalingState {
        self.state
    }

    /// Whether the client is connected.
    pub fn is_connected(&self) -> bool {
        self.state == SignalingState::Connected
    }

    /// Connect to the signaling server.
    pub fn connect(&mut self, peer_id: &str, display_name: &str) -> Result<(), String> {
        if self.state == SignalingState::Connected {
            return Ok(());
        }

        info!("Connecting to signaling server: {}", self.config.server_url);
        self.state = SignalingState::Connecting;
        self.peer_id = Some(peer_id.to_string());

        // In a real implementation:
        // 1. Open WebSocket connection to self.config.server_url
        // 2. Send Register message
        // 3. Wait for RegisterAck
        // 4. Start heartbeat timer

        let register = SignalingProtocol::Register {
            peer_id: peer_id.to_string(),
            display_name: display_name.to_string(),
            capabilities: vec![
                "p2p".to_string(),
                "ssh".to_string(),
                "rdp".to_string(),
                "vnc".to_string(),
                "sftp".to_string(),
            ],
        };

        self.outbound_queue.push_back(register);
        self.state = SignalingState::Connected;
        self.reconnect_attempts = 0;

        info!("Connected to signaling server as {}", peer_id);
        Ok(())
    }

    /// Disconnect from the signaling server.
    pub fn disconnect(&mut self) {
        info!("Disconnecting from signaling server");
        self.state = SignalingState::Disconnected;
        self.outbound_queue.clear();
        self.online_peers.clear();
    }

    /// Send a connection offer to a remote peer via the signaling server.
    pub fn send_offer(
        &mut self,
        to_peer: &str,
        offer: &ConnectionOffer,
    ) -> Result<(), String> {
        if !self.is_connected() {
            return Err("Not connected to signaling server".to_string());
        }

        let message = SignalingMessage {
            msg_type: SignalingMessageType::Offer,
            from_peer: self.peer_id.clone().unwrap_or_default(),
            to_peer: to_peer.to_string(),
            session_id: offer.session_id.clone(),
            payload: serde_json::to_string(offer).map_err(|e| e.to_string())?,
            timestamp: Utc::now(),
        };

        self.send_relay(to_peer, message)
    }

    /// Send a connection answer to a remote peer.
    pub fn send_answer(
        &mut self,
        to_peer: &str,
        answer: &ConnectionAnswer,
    ) -> Result<(), String> {
        if !self.is_connected() {
            return Err("Not connected to signaling server".to_string());
        }

        let message = SignalingMessage {
            msg_type: SignalingMessageType::Answer,
            from_peer: self.peer_id.clone().unwrap_or_default(),
            to_peer: to_peer.to_string(),
            session_id: answer.session_id.clone(),
            payload: serde_json::to_string(answer).map_err(|e| e.to_string())?,
            timestamp: Utc::now(),
        };

        self.send_relay(to_peer, message)
    }

    /// Send a trickled ICE candidate to a remote peer.
    pub fn send_ice_candidate(
        &mut self,
        to_peer: &str,
        session_id: &str,
        candidate: &IceCandidate,
    ) -> Result<(), String> {
        if !self.is_connected() {
            return Err("Not connected to signaling server".to_string());
        }

        let message = SignalingMessage {
            msg_type: SignalingMessageType::IceCandidate,
            from_peer: self.peer_id.clone().unwrap_or_default(),
            to_peer: to_peer.to_string(),
            session_id: session_id.to_string(),
            payload: serde_json::to_string(candidate).map_err(|e| e.to_string())?,
            timestamp: Utc::now(),
        };

        self.send_relay(to_peer, message)
    }

    /// Signal that ICE gathering is complete.
    pub fn send_ice_gathering_complete(
        &mut self,
        to_peer: &str,
        session_id: &str,
    ) -> Result<(), String> {
        let message = SignalingMessage {
            msg_type: SignalingMessageType::IceGatheringComplete,
            from_peer: self.peer_id.clone().unwrap_or_default(),
            to_peer: to_peer.to_string(),
            session_id: session_id.to_string(),
            payload: String::new(),
            timestamp: Utc::now(),
        };

        self.send_relay(to_peer, message)
    }

    /// Send a hangup/close signal.
    pub fn send_hangup(
        &mut self,
        to_peer: &str,
        session_id: &str,
    ) -> Result<(), String> {
        let message = SignalingMessage {
            msg_type: SignalingMessageType::Hangup,
            from_peer: self.peer_id.clone().unwrap_or_default(),
            to_peer: to_peer.to_string(),
            session_id: session_id.to_string(),
            payload: String::new(),
            timestamp: Utc::now(),
        };

        self.send_relay(to_peer, message)
    }

    /// Send a relay message to a peer.
    fn send_relay(&mut self, to_peer: &str, message: SignalingMessage) -> Result<(), String> {
        let relay = SignalingProtocol::Relay {
            to_peer: to_peer.to_string(),
            message,
        };

        self.sequence += 1;
        self.outbound_queue.push_back(relay);
        debug!("Queued relay message to {} (seq={})", to_peer, self.sequence);
        Ok(())
    }

    /// Query online peers.
    pub fn query_peers(&mut self, filter: Option<&str>) -> Result<(), String> {
        if !self.is_connected() {
            return Err("Not connected to signaling server".to_string());
        }

        let query = SignalingProtocol::PeerQuery {
            filter: filter.map(|s| s.to_string()),
        };
        self.outbound_queue.push_back(query);
        Ok(())
    }

    /// Get known online peers.
    pub fn online_peers(&self) -> &[OnlinePeer] {
        &self.online_peers
    }

    /// Get ICE servers provided by the signaling server.
    pub fn ice_servers(&self) -> &[IceServerInfo] {
        &self.ice_servers
    }

    /// Drain outbound messages (for the WebSocket sender to consume).
    pub fn drain_outbound(&mut self) -> Vec<SignalingProtocol> {
        self.outbound_queue.drain(..).collect()
    }

    /// Feed an inbound message from the WebSocket.
    pub fn handle_inbound(&mut self, msg: SignalingProtocol) {
        match &msg {
            SignalingProtocol::RegisterAck {
                server_id,
                ice_servers,
            } => {
                info!("Registration acknowledged by server {}", server_id);
                self.ice_servers = ice_servers.clone();
                self.state = SignalingState::Connected;
            }
            SignalingProtocol::PeerList { peers } => {
                info!("Received peer list: {} peers", peers.len());
                self.online_peers = peers.clone();
            }
            SignalingProtocol::PeerOnline {
                peer_id,
                display_name,
            } => {
                info!("Peer online: {} ({})", display_name, peer_id);
                self.online_peers.push(OnlinePeer {
                    peer_id: peer_id.clone(),
                    display_name: display_name.clone(),
                    capabilities: Vec::new(),
                    online_since: Utc::now(),
                });
            }
            SignalingProtocol::PeerOffline { peer_id } => {
                info!("Peer offline: {}", peer_id);
                self.online_peers.retain(|p| p.peer_id != *peer_id);
            }
            SignalingProtocol::Pong { timestamp } => {
                let now = Utc::now().timestamp_millis();
                let rtt = now - timestamp;
                debug!("Signaling pong (rtt={}ms)", rtt);
            }
            SignalingProtocol::Error { code, message } => {
                error!("Signaling error {}: {}", code, message);
            }
            _ => {}
        }

        self.inbound_queue.push_back(msg);
    }

    /// Drain received relay messages (offers/answers/candidates from peers).
    pub fn drain_inbound(&mut self) -> Vec<SignalingProtocol> {
        self.inbound_queue.drain(..).collect()
    }

    /// Send a heartbeat ping.
    pub fn send_ping(&mut self) {
        if self.is_connected() {
            let ping = SignalingProtocol::Ping {
                timestamp: Utc::now().timestamp_millis(),
            };
            self.outbound_queue.push_back(ping);
        }
    }

    /// Handle a disconnection event.
    pub fn on_disconnected(&mut self) {
        warn!("Signaling connection lost");
        if self.config.auto_reconnect
            && self.reconnect_attempts < self.config.max_reconnect_attempts
        {
            self.state = SignalingState::Reconnecting;
            self.reconnect_attempts += 1;
            info!(
                "Will attempt reconnect ({}/{})",
                self.reconnect_attempts, self.config.max_reconnect_attempts
            );
        } else {
            self.state = SignalingState::Failed;
            error!("Signaling connection failed after {} attempts", self.reconnect_attempts);
        }
    }

    /// Get the outbound queue length.
    pub fn outbound_queue_len(&self) -> usize {
        self.outbound_queue.len()
    }

    /// Get the inbound queue length.
    pub fn inbound_queue_len(&self) -> usize {
        self.inbound_queue.len()
    }
}

/// Encode a signaling protocol message to JSON.
pub fn encode_message(msg: &SignalingProtocol) -> Result<String, String> {
    serde_json::to_string(msg).map_err(|e| e.to_string())
}

/// Decode a signaling protocol message from JSON.
pub fn decode_message(json: &str) -> Result<SignalingProtocol, String> {
    serde_json::from_str(json).map_err(|e| e.to_string())
}
