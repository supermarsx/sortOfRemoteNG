//! # Peer Discovery
//!
//! LAN (mDNS/DNS-SD) and WAN (rendezvous server) peer discovery.
//! Discovers other SortOfRemoteNG instances on the network and maintains
//! a registry of known peers.

use crate::types::*;
use chrono::Utc;
use log::info;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// mDNS service type for SortOfRemoteNG peer discovery.
pub const MDNS_SERVICE_TYPE: &str = "_sorng._tcp.local.";

/// Multicast address for LAN broadcast discovery.
pub const LAN_MULTICAST_ADDR: &str = "239.255.77.77";

/// LAN broadcast port.
pub const LAN_BROADCAST_PORT: u16 = 45777;

/// Discovery configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveryConfig {
    /// Enable mDNS/DNS-SD discovery
    pub mdns_enabled: bool,
    /// Enable LAN multicast broadcast discovery
    pub lan_broadcast_enabled: bool,
    /// LAN broadcast interval in seconds
    pub broadcast_interval_secs: u32,
    /// Rendezvous server URL (for WAN discovery)
    pub rendezvous_url: Option<String>,
    /// How long before a peer is considered stale (seconds)
    pub stale_timeout_secs: u32,
    /// Maximum number of discovered peers to track
    pub max_peers: u32,
    /// Advertised capabilities of this node
    pub capabilities: Vec<String>,
}

impl Default for DiscoveryConfig {
    fn default() -> Self {
        Self {
            mdns_enabled: true,
            lan_broadcast_enabled: true,
            broadcast_interval_secs: 30,
            rendezvous_url: None,
            stale_timeout_secs: 120,
            max_peers: 1000,
            capabilities: vec![
                "ssh".to_string(),
                "rdp".to_string(),
                "vnc".to_string(),
                "sftp".to_string(),
                "p2p".to_string(),
            ],
        }
    }
}

/// A discovery announcement (what we broadcast/advertise).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveryAnnouncement {
    /// Our peer ID
    pub peer_id: String,
    /// Display name
    pub name: String,
    /// Version
    pub version: String,
    /// Platform (windows, macos, linux)
    pub platform: String,
    /// Addresses we're reachable at
    pub addresses: Vec<String>,
    /// Capabilities
    pub capabilities: Vec<String>,
    /// Public key fingerprint (for identity verification)
    pub fingerprint: String,
    /// Timestamp
    pub timestamp: i64,
}

/// The discovery service — manages peer discovery across LAN and WAN.
pub struct DiscoveryService {
    /// Configuration
    config: DiscoveryConfig,
    /// Our announcement
    our_announcement: Option<DiscoveryAnnouncement>,
    /// Discovered peers (peer_id → peer info)
    peers: HashMap<String, DiscoveredPeer>,
    /// Whether discovery is running
    running: bool,
}

impl DiscoveryService {
    /// Create a new discovery service.
    pub fn new(config: DiscoveryConfig) -> Self {
        Self {
            config,
            our_announcement: None,
            peers: HashMap::new(),
            running: false,
        }
    }

    /// Set our announcement info.
    pub fn set_announcement(&mut self, announcement: DiscoveryAnnouncement) {
        self.our_announcement = Some(announcement);
    }

    /// Start the discovery service.
    pub fn start(&mut self) -> Result<(), String> {
        if self.running {
            return Ok(());
        }
        if self.our_announcement.is_none() {
            return Err("Must set announcement before starting discovery".to_string());
        }

        info!("Starting peer discovery");

        // In a real implementation:
        // 1. If mDNS enabled:
        //    - Register mDNS service: _sorng._tcp.local.
        //    - Start mDNS query for other instances
        // 2. If LAN broadcast enabled:
        //    - Bind UDP socket to multicast group 239.255.77.77:45777
        //    - Start periodic broadcast of our announcement
        //    - Listen for announcements from others
        // 3. If rendezvous URL set:
        //    - Connect to rendezvous server
        //    - Register our presence
        //    - Query for other peers

        self.running = true;
        Ok(())
    }

    /// Stop the discovery service.
    pub fn stop(&mut self) {
        if self.running {
            info!("Stopping peer discovery");
            self.running = false;
        }
    }

    /// Whether discovery is running.
    pub fn is_running(&self) -> bool {
        self.running
    }

    // ── mDNS Discovery ─────────────────────────────────────────

    /// Start mDNS service registration.
    pub fn register_mdns(&self) -> Result<(), String> {
        let announcement = self.our_announcement.as_ref().ok_or("No announcement")?;
        // Try to use mdns crate, fallback to UDP multicast if not available
        #[cfg(feature = "mdns")]
        {
            // TODO(t3): integrate mdns 2.0 API (no Responder in 2.x; use
            // `mdns::discover` + a separate announce path). Until then the
            // feature-gated path surfaces a typed error rather than a silent
            // fallback (matches the pattern used in sorng-vpn/softether).
            let _ = announcement;
            Err(format!(
                "mDNS registration not yet wired for mdns 2.0 ({} / {})",
                MDNS_SERVICE_TYPE, "register_mdns"
            ))
        }
        #[cfg(not(feature = "mdns"))]
        {
            // Fallback: UDP multicast announcement
            use std::net::{Ipv4Addr, SocketAddrV4, UdpSocket};
            let addr = SocketAddrV4::new(Ipv4Addr::new(224, 0, 0, 251), 5353);
            let sock = UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
            sock.set_multicast_loop_v4(true).ok();
            let data = serde_json::to_vec(announcement).map_err(|e| e.to_string())?;
            sock.send_to(&data, addr).map_err(|e| e.to_string())?;
            info!("Sent UDP multicast announcement for mDNS fallback");
            Ok(())
        }
    }

    /// Browse for mDNS services.
    pub fn browse_mdns(&mut self) -> Result<Vec<DiscoveredPeer>, String> {
        #[cfg(feature = "mdns")]
        {
            // TODO(t3): integrate mdns 2.0 async discover::all() stream.
            // Feature-gated code compiles but currently returns an empty
            // result set rather than a silent fallback.
            let found: Vec<DiscoveredPeer> = Vec::new();
            info!(
                "mDNS browse feature enabled but not yet wired for mdns 2.0 ({}); returning empty peer list",
                MDNS_SERVICE_TYPE
            );
            Ok(found)
        }
        #[cfg(not(feature = "mdns"))]
        {
            // Fallback: listen for UDP multicast announcements
            use std::net::{Ipv4Addr, SocketAddrV4, UdpSocket};
            let _addr = SocketAddrV4::new(Ipv4Addr::new(224, 0, 0, 251), 5353);
            let sock = UdpSocket::bind("0.0.0.0:5353").map_err(|e| e.to_string())?;
            sock.join_multicast_v4(&Ipv4Addr::new(224, 0, 0, 251), &Ipv4Addr::UNSPECIFIED)
                .map_err(|e| e.to_string())?;
            sock.set_nonblocking(true).ok();
            let start = std::time::Instant::now();
            let mut found = Vec::new();
            let mut buf = [0u8; 1500];
            while start.elapsed().as_secs() < 3 {
                if let Ok((n, _src)) = sock.recv_from(&mut buf) {
                    if let Ok(peer) = self.parse_broadcast_packet(&buf[..n]) {
                        found.push(peer);
                    }
                }
            }
            Ok(found)
        }
    }

    // ── LAN Broadcast Discovery ────────────────────────────────

    /// Build a LAN broadcast packet.
    pub fn build_broadcast_packet(&self) -> Result<Vec<u8>, String> {
        let announcement = self.our_announcement.as_ref().ok_or("No announcement")?;

        serde_json::to_vec(announcement).map_err(|e| e.to_string())
    }

    /// Parse a received LAN broadcast packet.
    pub fn parse_broadcast_packet(&mut self, data: &[u8]) -> Result<DiscoveredPeer, String> {
        let announcement: DiscoveryAnnouncement =
            serde_json::from_slice(data).map_err(|e| e.to_string())?;

        // Don't add ourselves
        if let Some(ours) = &self.our_announcement {
            if announcement.peer_id == ours.peer_id {
                return Err("Received our own announcement".to_string());
            }
        }

        let peer = DiscoveredPeer {
            peer_id: announcement.peer_id.clone(),
            name: announcement.name,
            discovery_method: DiscoveryMethod::LanBroadcast,
            addresses: announcement.addresses,
            capabilities: announcement.capabilities,
            reachable: true,
            last_seen: Utc::now(),
            latency_ms: None,
            platform: Some(announcement.platform),
        };

        self.peers.insert(peer.peer_id.clone(), peer.clone());
        Ok(peer)
    }

    // ── Rendezvous Discovery ───────────────────────────────────

    /// Register with the rendezvous server.
    pub fn register_rendezvous(&self) -> Result<(), String> {
        let url = self
            .config
            .rendezvous_url
            .as_ref()
            .ok_or("No rendezvous URL configured")?;

        info!("Registering with rendezvous server: {}", url);

        // In a real implementation:
        // POST /api/v1/peers/register with our announcement JSON body
        // The rendezvous server stores our peer info for other peers to discover

        Ok(())
    }

    /// Query the rendezvous server for peers.
    pub fn query_rendezvous(&mut self) -> Result<Vec<DiscoveredPeer>, String> {
        let url = self
            .config
            .rendezvous_url
            .as_ref()
            .ok_or("No rendezvous URL configured")?;

        info!("Querying rendezvous server: {}", url);

        // In a real implementation:
        // GET /api/v1/peers
        // Parse response into DiscoveredPeer list

        Ok(Vec::new())
    }

    // ── Peer Management ────────────────────────────────────────

    /// Get all discovered peers.
    pub fn peers(&self) -> Vec<&DiscoveredPeer> {
        self.peers.values().collect()
    }

    /// Get a peer by ID.
    pub fn get_peer(&self, peer_id: &str) -> Option<&DiscoveredPeer> {
        self.peers.get(peer_id)
    }

    /// Manually add a peer (e.g., from saved connections).
    pub fn add_peer(&mut self, peer: DiscoveredPeer) {
        self.peers.insert(peer.peer_id.clone(), peer);
    }

    /// Remove a peer.
    pub fn remove_peer(&mut self, peer_id: &str) -> bool {
        self.peers.remove(peer_id).is_some()
    }

    /// Remove stale peers (not seen within the stale timeout).
    pub fn cleanup_stale(&mut self) -> usize {
        let cutoff = Utc::now() - chrono::Duration::seconds(self.config.stale_timeout_secs as i64);
        let stale: Vec<String> = self
            .peers
            .iter()
            .filter(|(_, p)| p.last_seen < cutoff)
            .map(|(id, _)| id.clone())
            .collect();
        let count = stale.len();
        for id in stale {
            self.peers.remove(&id);
        }
        if count > 0 {
            info!("Removed {} stale peers", count);
        }
        count
    }

    /// Get peers discovered by a specific method.
    pub fn peers_by_method(&self, method: DiscoveryMethod) -> Vec<&DiscoveredPeer> {
        self.peers
            .values()
            .filter(|p| p.discovery_method == method)
            .collect()
    }

    /// Merge peers from another source (e.g., signaling server).
    pub fn merge_peers(&mut self, peers: Vec<DiscoveredPeer>) {
        for peer in peers {
            if let Some(existing) = self.peers.get_mut(&peer.peer_id) {
                // Update existing peer's info
                existing.last_seen = peer.last_seen;
                existing.reachable = peer.reachable;
                if !peer.addresses.is_empty() {
                    existing.addresses = peer.addresses;
                }
            } else {
                self.peers.insert(peer.peer_id.clone(), peer);
            }
        }
    }

    /// Peer count.
    pub fn peer_count(&self) -> usize {
        self.peers.len()
    }

    /// Count of reachable peers.
    pub fn reachable_count(&self) -> usize {
        self.peers.values().filter(|p| p.reachable).count()
    }
}

impl Default for DiscoveryService {
    fn default() -> Self {
        Self::new(DiscoveryConfig::default())
    }
}
