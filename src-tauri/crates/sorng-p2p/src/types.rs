//! # P2P Types
//!
//! Core data types for the peer-to-peer connectivity engine — NAT classification,
//! ICE candidates, STUN/TURN bindings, signaling messages, session state, and metrics.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

// ── NAT Classification ──────────────────────────────────────────────

/// Detected NAT type for the local network.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NatType {
    /// No NAT — public IP directly reachable
    OpenInternet,
    /// Full-cone NAT — any external host can send to the mapped port
    FullCone,
    /// Address-restricted cone — only hosts we've sent to can reply
    AddressRestrictedCone,
    /// Port-restricted cone — only the specific host:port we sent to can reply
    PortRestrictedCone,
    /// Symmetric NAT — different mapping for each destination (hardest to traverse)
    Symmetric,
    /// Symmetric with random ports (worst case — requires TURN relay)
    SymmetricRandom,
    /// Behind carrier-grade NAT (100.64.0.0/10)
    CarrierGradeNat,
    /// Could not determine NAT type
    Unknown,
}

impl NatType {
    /// Whether hole-punching is likely to succeed.
    pub fn hole_punch_viable(&self) -> bool {
        matches!(
            self,
            Self::OpenInternet
                | Self::FullCone
                | Self::AddressRestrictedCone
                | Self::PortRestrictedCone
        )
    }

    /// Whether a TURN relay is required for connectivity.
    pub fn requires_relay(&self) -> bool {
        matches!(self, Self::Symmetric | Self::SymmetricRandom)
    }

    /// Human-readable label.
    pub fn label(&self) -> &'static str {
        match self {
            Self::OpenInternet => "Open Internet (no NAT)",
            Self::FullCone => "Full-cone NAT",
            Self::AddressRestrictedCone => "Address-restricted cone NAT",
            Self::PortRestrictedCone => "Port-restricted cone NAT",
            Self::Symmetric => "Symmetric NAT",
            Self::SymmetricRandom => "Symmetric NAT (random ports)",
            Self::CarrierGradeNat => "Carrier-grade NAT (CGNAT)",
            Self::Unknown => "Unknown",
        }
    }
}

/// Result of a NAT detection probe.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NatDetectionResult {
    /// Detected NAT type
    pub nat_type: NatType,
    /// Local (private) address used for the test
    pub local_addr: String,
    /// Public (server-reflexive) address seen by the STUN server
    pub public_addr: Option<String>,
    /// Whether the public IP matches the local IP (no NAT)
    pub is_direct: bool,
    /// Whether we're behind CGNAT (100.64.0.0/10)
    pub is_cgnat: bool,
    /// Mapping consistency (true if same public port for different destinations)
    pub mapping_consistent: bool,
    /// Filtering behavior (who can send us packets)
    pub filtering: FilteringBehavior,
    /// STUN server(s) used for detection
    pub stun_servers_used: Vec<String>,
    /// Detection timestamp
    pub detected_at: DateTime<Utc>,
    /// Detection duration in milliseconds
    pub detection_time_ms: u64,
}

/// How the NAT filters incoming packets.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FilteringBehavior {
    /// No filtering — any external host can send to mapped port
    EndpointIndependent,
    /// Only hosts we've sent to can send back (by IP)
    AddressDependent,
    /// Only the specific IP:port we've sent to can reply
    AddressAndPortDependent,
    /// Could not determine
    Unknown,
}

// ── STUN ────────────────────────────────────────────────────────────

/// A STUN server endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StunServer {
    /// Server hostname or IP
    pub host: String,
    /// Server port (default: 3478)
    pub port: u16,
    /// Whether this server supports STUNS (STUN over TLS)
    pub tls: bool,
}

impl StunServer {
    pub fn new(host: &str, port: u16) -> Self {
        Self {
            host: host.to_string(),
            port,
            tls: false,
        }
    }

    /// Well-known public STUN servers.
    pub fn public_servers() -> Vec<Self> {
        vec![
            Self::new("stun.l.google.com", 19302),
            Self::new("stun1.l.google.com", 19302),
            Self::new("stun2.l.google.com", 19302),
            Self::new("stun3.l.google.com", 19302),
            Self::new("stun4.l.google.com", 19302),
            Self::new("stun.cloudflare.com", 3478),
            Self::new("stun.nextcloud.com", 443),
            Self::new("stun.stunprotocol.org", 3478),
        ]
    }
}

/// Result of a single STUN binding request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StunBinding {
    /// The STUN server queried
    pub server: String,
    /// Our local address used
    pub local_addr: String,
    /// The server-reflexive (public) address returned
    pub mapped_addr: String,
    /// Response time in milliseconds
    pub rtt_ms: u64,
    /// Whether the server indicated we changed IP
    pub changed_ip: bool,
    /// Whether the server indicated we changed port
    pub changed_port: bool,
}

// ── TURN ────────────────────────────────────────────────────────────

/// A TURN relay server endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TurnServer {
    /// Server hostname or IP
    pub host: String,
    /// Server port (default: 3478)
    pub port: u16,
    /// Username for TURN authentication
    pub username: String,
    /// Credential (password or HMAC key)
    pub credential: String,
    /// Whether to use TURNS (TURN over TLS)
    pub tls: bool,
    /// Transport protocol (udp or tcp)
    pub transport: String,
}

/// An allocated TURN relay.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TurnAllocation {
    /// Unique allocation ID
    pub id: String,
    /// The TURN server used
    pub server: String,
    /// The relayed transport address allocated on the server
    pub relayed_addr: String,
    /// Our server-reflexive address as seen by the TURN server
    pub mapped_addr: String,
    /// Allocation lifetime in seconds
    pub lifetime_secs: u32,
    /// When the allocation was created
    pub created_at: DateTime<Utc>,
    /// When the allocation expires
    pub expires_at: DateTime<Utc>,
    /// Permissions granted (peer addresses allowed to send via this allocation)
    pub permissions: Vec<String>,
}

// ── ICE ─────────────────────────────────────────────────────────────

/// An ICE candidate (local, server-reflexive, peer-reflexive, or relayed).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IceCandidate {
    /// Unique candidate ID
    pub id: String,
    /// Candidate type
    pub candidate_type: IceCandidateType,
    /// Transport protocol (udp or tcp)
    pub transport: String,
    /// Address (IP or hostname)
    pub address: String,
    /// Port
    pub port: u16,
    /// Candidate priority (higher = preferred)
    pub priority: u32,
    /// Foundation (for grouping related candidates)
    pub foundation: String,
    /// Component ID (1 = RTP/data, 2 = RTCP)
    pub component: u8,
    /// Related address (the base for srflx/relay candidates)
    pub related_address: Option<String>,
    /// Related port
    pub related_port: Option<u16>,
}

/// Types of ICE candidates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum IceCandidateType {
    /// Host candidate — local interface address
    Host,
    /// Server-reflexive — public address from STUN
    ServerReflexive,
    /// Peer-reflexive — discovered during connectivity checks
    PeerReflexive,
    /// Relayed — address on a TURN server
    Relayed,
}

impl IceCandidateType {
    /// Type preference for ICE priority calculation (RFC 8445 §5.1.2.1).
    pub fn type_preference(&self) -> u32 {
        match self {
            Self::Host => 126,
            Self::PeerReflexive => 110,
            Self::ServerReflexive => 100,
            Self::Relayed => 0,
        }
    }
}

/// State of the ICE agent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum IceState {
    /// Gathering candidates
    Gathering,
    /// Checking connectivity pairs
    Checking,
    /// A valid pair has been found
    Connected,
    /// All pairs checked, best selected
    Completed,
    /// All pairs failed — no connectivity
    Failed,
    /// ICE agent has been closed
    Closed,
    /// Temporarily disconnected (was connected, lost connectivity)
    Disconnected,
}

/// A candidate pair being checked for connectivity.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IceCandidatePair {
    /// Local candidate
    pub local: IceCandidate,
    /// Remote candidate
    pub remote: IceCandidate,
    /// Pair priority
    pub priority: u64,
    /// Pair state
    pub state: IcePairState,
    /// Whether this pair is nominated (selected for use)
    pub nominated: bool,
    /// Round-trip time in milliseconds (if checked successfully)
    pub rtt_ms: Option<u64>,
    /// Number of check attempts
    pub check_count: u32,
    /// Last check timestamp
    pub last_check: Option<DateTime<Utc>>,
}

/// State of an ICE candidate pair.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum IcePairState {
    /// Waiting to be checked
    Frozen,
    /// Waiting for turn
    Waiting,
    /// Connectivity check in progress
    InProgress,
    /// Check succeeded
    Succeeded,
    /// Check failed
    Failed,
}

// ── Signaling ───────────────────────────────────────────────────────

/// A signaling message exchanged between peers via the signaling broker.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignalingMessage {
    /// Message type
    pub msg_type: SignalingMessageType,
    /// Sender peer ID
    pub from_peer: String,
    /// Target peer ID
    pub to_peer: String,
    /// Session ID this message belongs to
    pub session_id: String,
    /// Message payload (JSON-encoded)
    pub payload: String,
    /// Timestamp
    pub timestamp: DateTime<Utc>,
}

/// Types of signaling messages.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SignalingMessageType {
    /// Connection offer (initiator → responder)
    Offer,
    /// Connection answer (responder → initiator)
    Answer,
    /// ICE candidate trickle
    IceCandidate,
    /// ICE gathering complete
    IceGatheringComplete,
    /// Session hangup / close
    Hangup,
    /// Keepalive / heartbeat
    Keepalive,
    /// Peer presence announcement
    PeerAnnounce,
    /// Renegotiation needed
    Renegotiate,
}

/// A connection offer from the initiating peer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionOffer {
    /// Session ID for this P2P connection
    pub session_id: String,
    /// Offering peer ID
    pub peer_id: String,
    /// Display name of the offering peer
    pub peer_name: String,
    /// Target protocol the peer wants to reach (SSH, RDP, VNC, etc.)
    pub target_protocol: String,
    /// Target port on the remote side
    pub target_port: u16,
    /// NAT type of the offering peer
    pub nat_type: NatType,
    /// ICE candidates gathered so far
    pub candidates: Vec<IceCandidate>,
    /// Public key for key exchange (X25519, base64)
    pub public_key: String,
    /// Offered encryption cipher suite
    pub cipher_suite: String,
    /// When the offer was created
    pub created_at: DateTime<Utc>,
    /// Offer TTL in seconds (after which it should be discarded)
    pub ttl_secs: u32,
}

/// A connection answer from the responding peer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionAnswer {
    /// Session ID (must match the offer)
    pub session_id: String,
    /// Answering peer ID
    pub peer_id: String,
    /// Display name of the answering peer
    pub peer_name: String,
    /// Whether the peer accepts the connection
    pub accepted: bool,
    /// Rejection reason (if not accepted)
    pub reject_reason: Option<String>,
    /// ICE candidates from the answering peer
    pub candidates: Vec<IceCandidate>,
    /// Public key for key exchange (X25519, base64)
    pub public_key: String,
    /// Agreed cipher suite
    pub cipher_suite: String,
    /// When the answer was created
    pub created_at: DateTime<Utc>,
}

// ── P2P Sessions ────────────────────────────────────────────────────

/// A P2P session representing an active or pending peer connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct P2pSession {
    /// Unique session ID
    pub id: String,
    /// Local peer ID
    pub local_peer_id: String,
    /// Remote peer ID
    pub remote_peer_id: String,
    /// Remote peer display name
    pub remote_peer_name: String,
    /// Session state
    pub state: P2pSessionState,
    /// How the connection was established
    pub transport: P2pTransport,
    /// Target protocol being tunneled
    pub target_protocol: String,
    /// Target port on the remote side
    pub target_port: u16,
    /// Local port for applications to connect to (acts like a tunnel endpoint)
    pub local_port: u16,
    /// ICE state
    pub ice_state: IceState,
    /// The selected (nominated) candidate pair
    pub selected_pair: Option<IceCandidatePair>,
    /// All local candidates gathered
    pub local_candidates: Vec<IceCandidate>,
    /// All remote candidates received
    pub remote_candidates: Vec<IceCandidate>,
    /// NAT type of the local side
    pub local_nat_type: NatType,
    /// NAT type of the remote side (from offer/answer)
    pub remote_nat_type: Option<NatType>,
    /// Bytes sent
    pub bytes_sent: u64,
    /// Bytes received
    pub bytes_received: u64,
    /// Current round-trip time in milliseconds
    pub rtt_ms: Option<u64>,
    /// Session creation time
    pub created_at: DateTime<Utc>,
    /// When the connection became active
    pub connected_at: Option<DateTime<Utc>>,
    /// When the session ended
    pub ended_at: Option<DateTime<Utc>>,
    /// Whether the data channel is encrypted
    pub encrypted: bool,
    /// Cipher suite used for the data channel
    pub cipher_suite: String,
}

/// State of a P2P session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum P2pSessionState {
    /// Offer created, waiting for answer
    OfferSent,
    /// Answer received, establishing connection
    Connecting,
    /// ICE gathering in progress
    Gathering,
    /// ICE connectivity checks in progress
    Checking,
    /// P2P connection established
    Connected,
    /// Connection established via TURN relay (fallback)
    Relayed,
    /// Session ended normally
    Closed,
    /// Session failed to establish
    Failed,
    /// Was connected, temporarily lost connectivity
    Reconnecting,
}

impl P2pSessionState {
    /// Whether the session is in an active/connected state.
    pub fn is_active(&self) -> bool {
        matches!(self, Self::Connected | Self::Relayed | Self::Reconnecting)
    }
}

/// Transport mode used for the P2P connection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum P2pTransport {
    /// Direct UDP (hole-punched)
    DirectUdp,
    /// Direct TCP (simultaneous open)
    DirectTcp,
    /// TURN relay (UDP)
    TurnRelayUdp,
    /// TURN relay (TCP)
    TurnRelayTcp,
    /// Application-level relay through signaling server
    AppRelay,
    /// Not yet determined
    Unknown,
}

impl P2pTransport {
    /// Whether this is a direct (non-relayed) connection.
    pub fn is_direct(&self) -> bool {
        matches!(self, Self::DirectUdp | Self::DirectTcp)
    }
}

// ── Peer Discovery ──────────────────────────────────────────────────

/// A discovered peer on the network.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredPeer {
    /// Peer ID
    pub peer_id: String,
    /// Display name
    pub name: String,
    /// How the peer was discovered
    pub discovery_method: DiscoveryMethod,
    /// Advertised addresses (may include LAN and WAN)
    pub addresses: Vec<String>,
    /// Peer's advertised services/capabilities
    pub capabilities: Vec<String>,
    /// Whether the peer is currently reachable
    pub reachable: bool,
    /// Last seen timestamp
    pub last_seen: DateTime<Utc>,
    /// Latency in ms (if we've pinged them)
    pub latency_ms: Option<u64>,
    /// Peer version/platform info
    pub platform: Option<String>,
}

/// How a peer was discovered.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DiscoveryMethod {
    /// mDNS/DNS-SD on the local network
    Mdns,
    /// LAN broadcast/multicast probe
    LanBroadcast,
    /// Rendezvous server (WAN)
    Rendezvous,
    /// Previously known (from saved peers)
    Saved,
    /// Manual configuration
    Manual,
    /// Via ZeroTier network peers
    ZeroTier,
    /// Via Tailscale tailnet peers
    Tailscale,
}

// ── Peer Identity ───────────────────────────────────────────────────

/// Local peer identity for authentication.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerIdentity {
    /// Unique peer ID (UUID v4, stable across sessions)
    pub peer_id: String,
    /// Display name
    pub display_name: String,
    /// X25519 public key (base64)
    pub public_key: String,
    /// When this identity was created
    pub created_at: DateTime<Utc>,
    /// Fingerprint of the public key (SHA-256, hex)
    pub fingerprint: String,
}

/// A trusted peer (we've verified their identity before).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustedPeer {
    /// Peer ID
    pub peer_id: String,
    /// Display name at time of trust
    pub name: String,
    /// Their public key fingerprint
    pub fingerprint: String,
    /// When we first trusted this peer
    pub trusted_at: DateTime<Utc>,
    /// Number of successful connections
    pub connection_count: u32,
    /// Last connected timestamp
    pub last_connected: Option<DateTime<Utc>>,
}

// ── Connection Quality Metrics ──────────────────────────────────────

/// Connection quality metrics for a P2P session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct P2pMetrics {
    /// Session ID
    pub session_id: String,
    /// Current round-trip time in milliseconds
    pub rtt_ms: u64,
    /// RTT jitter in milliseconds
    pub jitter_ms: u64,
    /// Packet loss percentage (0-100)
    pub packet_loss_pct: f32,
    /// Throughput (bytes/sec) send direction
    pub throughput_send: u64,
    /// Throughput (bytes/sec) receive direction
    pub throughput_recv: u64,
    /// Total bytes sent
    pub total_bytes_sent: u64,
    /// Total bytes received
    pub total_bytes_received: u64,
    /// Number of STUN keepalives sent
    pub keepalives_sent: u64,
    /// Number of retransmissions
    pub retransmissions: u64,
    /// Connection uptime in seconds
    pub uptime_secs: u64,
    /// Quality score (0-100, computed)
    pub quality_score: u8,
    /// Measurement timestamp
    pub measured_at: DateTime<Utc>,
}

impl P2pMetrics {
    /// Compute a quality score (0-100) based on RTT, jitter, and packet loss.
    pub fn compute_quality_score(rtt_ms: u64, jitter_ms: u64, packet_loss_pct: f32) -> u8 {
        let mut score: f32 = 100.0;

        // Penalize RTT (ideal < 50ms)
        if rtt_ms > 50 {
            score -= ((rtt_ms - 50) as f32 * 0.2).min(30.0);
        }

        // Penalize jitter (ideal < 10ms)
        if jitter_ms > 10 {
            score -= ((jitter_ms - 10) as f32 * 0.5).min(20.0);
        }

        // Penalize packet loss heavily
        score -= (packet_loss_pct * 10.0).min(50.0);

        score.clamp(0.0, 100.0) as u8
    }
}

// ── Configuration ───────────────────────────────────────────────────

/// P2P engine configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct P2pConfig {
    /// STUN servers to use for NAT detection and candidate gathering
    pub stun_servers: Vec<StunServer>,
    /// TURN servers for relay fallback
    pub turn_servers: Vec<TurnServer>,
    /// Signaling server URL (WebSocket)
    pub signaling_url: Option<String>,
    /// Rendezvous server URL (for WAN peer discovery)
    pub rendezvous_url: Option<String>,
    /// Enable mDNS-based LAN peer discovery
    pub mdns_enabled: bool,
    /// Enable LAN broadcast peer discovery
    pub lan_broadcast_enabled: bool,
    /// Maximum number of concurrent P2P sessions
    pub max_sessions: u32,
    /// ICE connectivity check timeout in seconds
    pub ice_check_timeout_secs: u32,
    /// Whether to prefer direct connections over relay
    pub prefer_direct: bool,
    /// Whether to allow unencrypted data channels (dangerous, for testing only)
    pub allow_unencrypted: bool,
    /// STUN keepalive interval in seconds
    pub keepalive_interval_secs: u32,
    /// ICE nomination mode
    pub ice_nomination: IceNomination,
    /// Port range for local candidate binding
    pub port_range_start: u16,
    /// Port range end
    pub port_range_end: u16,
}

/// ICE nomination strategy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum IceNomination {
    /// Regular nomination — check all pairs, then nominate the best
    Regular,
    /// Aggressive nomination — nominate the first pair that succeeds
    Aggressive,
}

impl Default for P2pConfig {
    fn default() -> Self {
        Self {
            stun_servers: StunServer::public_servers(),
            turn_servers: Vec::new(),
            signaling_url: None,
            rendezvous_url: None,
            mdns_enabled: true,
            lan_broadcast_enabled: true,
            max_sessions: 50,
            ice_check_timeout_secs: 30,
            prefer_direct: true,
            allow_unencrypted: false,
            keepalive_interval_secs: 25,
            ice_nomination: IceNomination::Aggressive,
            port_range_start: 49152,
            port_range_end: 65535,
        }
    }
}

/// Type alias for the P2P service state (Tauri managed state pattern).
pub type P2pServiceState = Arc<Mutex<P2pService>>;

// Forward declaration — actual impl in service.rs
use crate::service::P2pService;
