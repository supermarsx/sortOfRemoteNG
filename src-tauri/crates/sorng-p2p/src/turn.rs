//! # TURN Relay Client
//!
//! TURN (Traversal Using Relays around NAT) client implementation based on
//! RFC 5766. Allocates relay addresses on TURN servers for fallback connectivity
//! when direct hole-punching fails.

use crate::types::{TurnAllocation, TurnServer};
use chrono::Utc;
use log::{debug, info, warn};
use std::collections::HashMap;
use std::time::Duration;

/// TURN message types (subset relevant to client).
#[repr(u16)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TurnMessageType {
    AllocateRequest = 0x0003,
    AllocateResponse = 0x0103,
    AllocateErrorResponse = 0x0113,
    RefreshRequest = 0x0004,
    RefreshResponse = 0x0104,
    CreatePermissionRequest = 0x0008,
    CreatePermissionResponse = 0x0108,
    ChannelBindRequest = 0x0009,
    ChannelBindResponse = 0x0109,
    SendIndication = 0x0016,
    DataIndication = 0x0017,
}

/// TURN attribute types.
#[repr(u16)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TurnAttribute {
    ChannelNumber = 0x000C,
    Lifetime = 0x000D,
    XorPeerAddress = 0x0012,
    Data = 0x0013,
    XorRelayedAddress = 0x0016,
    RequestedTransport = 0x0019,
    DontFragment = 0x001A,
    ReservationToken = 0x0022,
    // Auth attributes
    Username = 0x0006,
    Realm = 0x0014,
    Nonce = 0x0015,
    MessageIntegrity = 0x0008,
}

/// Transport protocol for TURN allocation.
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TurnTransport {
    Udp = 17,
    Tcp = 6,
}

/// Manages TURN allocations and relay channels.
pub struct TurnClient {
    /// Active allocations by allocation ID
    allocations: HashMap<String, TurnAllocationState>,
    /// Channel bindings (channel number → peer address)
    channel_bindings: HashMap<u16, String>,
    /// Next available channel number (0x4000-0x7FFF per RFC 5766)
    next_channel: u16,
}

struct TurnAllocationState {
    allocation: TurnAllocation,
    server: TurnServer,
    auth_realm: String,
    auth_nonce: String,
}

impl TurnClient {
    pub fn new() -> Self {
        Self {
            allocations: HashMap::new(),
            channel_bindings: HashMap::new(),
            next_channel: 0x4000,
        }
    }

    /// Allocate a relay address on a TURN server.
    ///
    /// Flow (RFC 5766 §6):
    ///  1. Send Allocate Request (unauthenticated)
    ///  2. Receive 401 Unauthorized with realm+nonce
    ///  3. Re-send Allocate Request with credentials (username, realm, nonce, MESSAGE-INTEGRITY)
    ///  4. Receive Allocate Success Response with XOR-RELAYED-ADDRESS and LIFETIME
    pub fn allocate(
        &mut self,
        server: &TurnServer,
        transport: TurnTransport,
    ) -> Result<TurnAllocation, String> {
        info!(
            "Allocating TURN relay on {}:{} (transport={:?})",
            server.host, server.port, transport
        );

        let allocation_id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now();
        let lifetime_secs = 600; // Default 10 minutes, server may adjust

        // In a full implementation, this sends UDP/TCP packets to the TURN server.
        // The allocation dance:
        //   1. Build Allocate Request with REQUESTED-TRANSPORT
        //   2. Handle 401 challenge → re-send with long-term credentials
        //   3. Parse response for XOR-RELAYED-ADDRESS and LIFETIME

        let allocation = TurnAllocation {
            id: allocation_id.clone(),
            server: format!("{}:{}", server.host, server.port),
            relayed_addr: String::new(), // Would be filled from server response
            mapped_addr: String::new(),  // Our server-reflexive address from the TURN server
            lifetime_secs,
            created_at: now,
            expires_at: now + chrono::Duration::seconds(lifetime_secs as i64),
            permissions: Vec::new(),
        };

        self.allocations.insert(
            allocation_id.clone(),
            TurnAllocationState {
                allocation: allocation.clone(),
                server: server.clone(),
                auth_realm: String::new(),
                auth_nonce: String::new(),
            },
        );

        info!("TURN allocation {} created", allocation_id);
        Ok(allocation)
    }

    /// Refresh an existing allocation (extend its lifetime).
    pub fn refresh(&mut self, allocation_id: &str, lifetime_secs: u32) -> Result<(), String> {
        let state = self
            .allocations
            .get_mut(allocation_id)
            .ok_or("Allocation not found")?;

        info!(
            "Refreshing TURN allocation {} (new lifetime: {}s)",
            allocation_id, lifetime_secs
        );

        // In a full implementation, sends a Refresh Request with LIFETIME attribute
        state.allocation.lifetime_secs = lifetime_secs;
        state.allocation.expires_at =
            Utc::now() + chrono::Duration::seconds(lifetime_secs as i64);

        Ok(())
    }

    /// Deallocate (set lifetime to 0).
    pub fn deallocate(&mut self, allocation_id: &str) -> Result<(), String> {
        info!("Deallocating TURN allocation {}", allocation_id);
        // Send Refresh with Lifetime=0
        let _ = self.refresh(allocation_id, 0);
        self.allocations.remove(allocation_id);
        Ok(())
    }

    /// Create a permission for a peer address on an allocation.
    /// The peer must have a permission before the relay will forward data to/from them.
    pub fn create_permission(
        &mut self,
        allocation_id: &str,
        peer_addr: &str,
    ) -> Result<(), String> {
        let state = self
            .allocations
            .get_mut(allocation_id)
            .ok_or("Allocation not found")?;

        info!(
            "Creating TURN permission for {} on allocation {}",
            peer_addr, allocation_id
        );

        // In a full implementation, sends CreatePermission Request with XOR-PEER-ADDRESS
        if !state.allocation.permissions.contains(&peer_addr.to_string()) {
            state.allocation.permissions.push(peer_addr.to_string());
        }

        Ok(())
    }

    /// Bind a channel number to a peer address for efficient data relay.
    /// Channel bindings use 4-byte headers instead of 36-byte Send/Data indications.
    pub fn bind_channel(
        &mut self,
        allocation_id: &str,
        peer_addr: &str,
    ) -> Result<u16, String> {
        let _state = self
            .allocations
            .get(allocation_id)
            .ok_or("Allocation not found")?;

        if self.next_channel > 0x7FFF {
            return Err("Channel number range exhausted".to_string());
        }

        let channel = self.next_channel;
        self.next_channel += 1;

        info!(
            "Binding channel 0x{:04X} to {} on allocation {}",
            channel, peer_addr, allocation_id
        );

        // In a full implementation, sends ChannelBind Request
        self.channel_bindings
            .insert(channel, peer_addr.to_string());

        Ok(channel)
    }

    /// Send data to a peer through the relay (using Send Indication).
    pub fn send_data(
        &self,
        allocation_id: &str,
        peer_addr: &str,
        data: &[u8],
    ) -> Result<(), String> {
        let _state = self
            .allocations
            .get(allocation_id)
            .ok_or("Allocation not found")?;

        debug!(
            "Sending {} bytes to {} via TURN allocation {}",
            data.len(),
            peer_addr,
            allocation_id
        );

        // In a full implementation, builds a Send Indication:
        //   - XOR-PEER-ADDRESS attribute with the peer's transport address
        //   - DATA attribute with the payload
        // Or, if a channel is bound, sends a ChannelData message (more efficient)

        Ok(())
    }

    /// Send data via a bound channel (4-byte header, more efficient).
    pub fn send_channel_data(
        &self,
        channel: u16,
        data: &[u8],
    ) -> Result<(), String> {
        let peer = self
            .channel_bindings
            .get(&channel)
            .ok_or("Channel not bound")?;

        debug!(
            "Sending {} bytes via channel 0x{:04X} to {}",
            data.len(),
            channel,
            peer
        );

        // ChannelData message format:
        //   [channel number (2 bytes)] [length (2 bytes)] [data (padded to 4 bytes)]

        Ok(())
    }

    /// Get an allocation by ID.
    pub fn get_allocation(&self, allocation_id: &str) -> Option<&TurnAllocation> {
        self.allocations.get(allocation_id).map(|s| &s.allocation)
    }

    /// List all active allocations.
    pub fn list_allocations(&self) -> Vec<&TurnAllocation> {
        self.allocations.values().map(|s| &s.allocation).collect()
    }

    /// Check for expired allocations and remove them.
    pub fn cleanup_expired(&mut self) -> usize {
        let now = Utc::now();
        let expired: Vec<String> = self
            .allocations
            .iter()
            .filter(|(_, s)| s.allocation.expires_at < now)
            .map(|(id, _)| id.clone())
            .collect();
        let count = expired.len();
        for id in expired {
            self.allocations.remove(&id);
            info!("Removed expired TURN allocation {}", id);
        }
        count
    }

    /// Build TURN Allocate Request message bytes.
    pub fn build_allocate_request(
        transaction_id: &[u8; 12],
        transport: TurnTransport,
    ) -> Vec<u8> {
        let mut msg = Vec::with_capacity(32);
        // Message type: Allocate Request
        msg.extend_from_slice(&0x0003u16.to_be_bytes());
        // Length placeholder (fill after attributes)
        let len_offset = msg.len();
        msg.extend_from_slice(&0x0000u16.to_be_bytes());
        // Magic cookie
        msg.extend_from_slice(&crate::stun::STUN_MAGIC_COOKIE.to_be_bytes());
        // Transaction ID
        msg.extend_from_slice(transaction_id);

        // REQUESTED-TRANSPORT attribute (type 0x0019, length 4)
        msg.extend_from_slice(&0x0019u16.to_be_bytes());
        msg.extend_from_slice(&0x0004u16.to_be_bytes());
        msg.push(transport as u8);
        msg.push(0); // RFFU
        msg.push(0);
        msg.push(0);

        // Update length
        let attr_len = (msg.len() - 20) as u16;
        msg[len_offset] = (attr_len >> 8) as u8;
        msg[len_offset + 1] = attr_len as u8;

        msg
    }

    /// Build TURN Allocate Request with long-term credentials.
    pub fn build_authenticated_allocate_request(
        transaction_id: &[u8; 12],
        transport: TurnTransport,
        username: &str,
        realm: &str,
        nonce: &str,
        password: &str,
    ) -> Vec<u8> {
        // Start with basic allocate request structure
        let mut msg = Self::build_allocate_request(transaction_id, transport);

        // Add USERNAME attribute
        let username_bytes = username.as_bytes();
        let padded_len = (username_bytes.len() + 3) & !3;
        msg.extend_from_slice(&0x0006u16.to_be_bytes()); // type
        msg.extend_from_slice(&(username_bytes.len() as u16).to_be_bytes()); // length
        msg.extend_from_slice(username_bytes);
        msg.resize(msg.len() + padded_len - username_bytes.len(), 0);

        // Add REALM attribute
        let realm_bytes = realm.as_bytes();
        let padded_len = (realm_bytes.len() + 3) & !3;
        msg.extend_from_slice(&0x0014u16.to_be_bytes());
        msg.extend_from_slice(&(realm_bytes.len() as u16).to_be_bytes());
        msg.extend_from_slice(realm_bytes);
        msg.resize(msg.len() + padded_len - realm_bytes.len(), 0);

        // Add NONCE attribute
        let nonce_bytes = nonce.as_bytes();
        let padded_len = (nonce_bytes.len() + 3) & !3;
        msg.extend_from_slice(&0x0015u16.to_be_bytes());
        msg.extend_from_slice(&(nonce_bytes.len() as u16).to_be_bytes());
        msg.extend_from_slice(nonce_bytes);
        msg.resize(msg.len() + padded_len - nonce_bytes.len(), 0);

        // MESSAGE-INTEGRITY would be computed as HMAC-SHA1 of the message
        // using key = MD5(username:realm:password)
        // This is a structural placeholder — real implementation would compute HMAC

        // Update total message length
        let attr_len = (msg.len() - 20) as u16;
        msg[2] = (attr_len >> 8) as u8;
        msg[3] = attr_len as u8;

        msg
    }
}

impl Default for TurnClient {
    fn default() -> Self {
        Self::new()
    }
}

/// Build a ChannelData message for efficient relay.
pub fn build_channel_data(channel: u16, data: &[u8]) -> Vec<u8> {
    let mut msg = Vec::with_capacity(4 + data.len());
    msg.extend_from_slice(&channel.to_be_bytes());
    msg.extend_from_slice(&(data.len() as u16).to_be_bytes());
    msg.extend_from_slice(data);
    // Pad to 4-byte boundary
    let padding = (4 - (data.len() % 4)) % 4;
    msg.resize(msg.len() + padding, 0);
    msg
}

/// Parse a ChannelData message.
pub fn parse_channel_data(data: &[u8]) -> Result<(u16, &[u8]), String> {
    if data.len() < 4 {
        return Err("ChannelData message too short".to_string());
    }
    let channel = u16::from_be_bytes([data[0], data[1]]);
    if !(0x4000..=0x7FFF).contains(&channel) {
        return Err(format!("Invalid channel number: 0x{:04X}", channel));
    }
    let length = u16::from_be_bytes([data[2], data[3]]) as usize;
    if 4 + length > data.len() {
        return Err("ChannelData payload truncated".to_string());
    }
    Ok((channel, &data[4..4 + length]))
}
