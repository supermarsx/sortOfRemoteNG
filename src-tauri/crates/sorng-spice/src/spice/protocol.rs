//! SPICE wire protocol: link messages, ticket authentication, capability negotiation,
//! mini-header and full-header framing.

use crate::spice::types::*;
use bytes::{Buf, BufMut, BytesMut};
use std::collections::HashSet;

// ── Link Message (connection handshake) ─────────────────────────────────────

/// SPICE link header (client → server and server → client).
#[derive(Debug, Clone)]
pub struct SpiceLinkHeader {
    pub magic: u32,
    pub major_version: u32,
    pub minor_version: u32,
    pub size: u32,
}

impl SpiceLinkHeader {
    pub const SIZE: usize = 16;

    pub fn new(version: SpiceVersion) -> Self {
        Self {
            magic: SPICE_MAGIC,
            major_version: version.major(),
            minor_version: version.minor(),
            size: 0, // set later
        }
    }

    pub fn encode(&self, buf: &mut BytesMut) {
        buf.put_u32_le(self.magic);
        buf.put_u32_le(self.major_version);
        buf.put_u32_le(self.minor_version);
        buf.put_u32_le(self.size);
    }

    pub fn decode(buf: &mut BytesMut) -> Result<Self, SpiceError> {
        if buf.len() < Self::SIZE {
            return Err(SpiceError::protocol("Incomplete link header"));
        }
        let magic = buf.get_u32_le();
        if magic != SPICE_MAGIC {
            return Err(SpiceError::protocol(format!(
                "Invalid SPICE magic: 0x{:08X}",
                magic
            )));
        }
        let major = buf.get_u32_le();
        let minor = buf.get_u32_le();
        let size = buf.get_u32_le();
        Ok(Self {
            magic,
            major_version: major,
            minor_version: minor,
            size,
        })
    }
}

/// Client link message (sent after header).
#[derive(Debug, Clone)]
pub struct SpiceLinkMess {
    pub connection_id: u32,
    pub channel_type: SpiceChannelType,
    pub channel_id: u8,
    pub num_common_caps: u32,
    pub num_channel_caps: u32,
    pub caps_offset: u32,
    pub common_caps: Vec<u32>,
    pub channel_caps: Vec<u32>,
}

impl SpiceLinkMess {
    pub fn new(channel_type: SpiceChannelType, channel_id: u8) -> Self {
        Self {
            connection_id: 0,
            channel_type,
            channel_id,
            num_common_caps: 0,
            num_channel_caps: 0,
            caps_offset: 18,
            common_caps: vec![],
            channel_caps: vec![],
        }
    }

    /// Size of the link message payload in bytes (excluding caps data encoded separately).
    pub fn size(&self) -> usize {
        // connection_id(4) + channel_type(1) + channel_id(1) + num_common_caps(4)
        // + num_channel_caps(4) + caps_offset(4) = 18, plus caps words
        18 + (self.common_caps.len() + self.channel_caps.len()) * 4
    }

    pub fn encode(&self, buf: &mut BytesMut) {
        buf.put_u32_le(self.connection_id);
        buf.put_u8(self.channel_type as u8);
        buf.put_u8(self.channel_id);
        buf.put_u16_le(0); // padding
        buf.put_u32_le(self.num_common_caps);
        buf.put_u32_le(self.num_channel_caps);
        buf.put_u32_le(self.caps_offset);
        for cap in &self.common_caps {
            buf.put_u32_le(*cap);
        }
        for cap in &self.channel_caps {
            buf.put_u32_le(*cap);
        }
    }
}

/// Server link reply.
#[derive(Debug, Clone)]
pub struct SpiceLinkReply {
    pub error: u32,
    pub pub_key: Vec<u8>,
    pub num_common_caps: u32,
    pub num_channel_caps: u32,
    pub caps_offset: u32,
    pub common_caps: Vec<u32>,
    pub channel_caps: Vec<u32>,
}

impl SpiceLinkReply {
    pub fn decode(buf: &mut BytesMut) -> Result<Self, SpiceError> {
        if buf.remaining() < 16 {
            return Err(SpiceError::protocol("Incomplete link reply"));
        }
        let error = buf.get_u32_le();
        if error != 0 {
            return Err(SpiceError::protocol(format!(
                "Server link error: {}",
                error
            )));
        }
        // Public key (1024 bits = 128 bytes + overhead, but varies).
        // For simplicity, read the DER-encoded RSA pub key.
        let key_len = buf.remaining().min(1024);
        let pub_key = buf.split_to(key_len).to_vec();
        // In real implementation, parse caps after key; simplified here.
        Ok(Self {
            error,
            pub_key,
            num_common_caps: 0,
            num_channel_caps: 0,
            caps_offset: 0,
            common_caps: vec![],
            channel_caps: vec![],
        })
    }
}

// ── Ticket Authentication ───────────────────────────────────────────────────

/// Encode a SPICE ticket (password encrypted with server's RSA public key).
pub fn encode_ticket(password: &str) -> Vec<u8> {
    // SPICE ticket is a 128-byte RSA-encrypted block.
    // In a full implementation this would use the server's public key.
    // Here we provide the structure; actual RSA encryption requires the key.
    let mut ticket = vec![0u8; 128];
    let pw_bytes = password.as_bytes();
    let copy_len = pw_bytes.len().min(128);
    ticket[..copy_len].copy_from_slice(&pw_bytes[..copy_len]);
    ticket
}

// ── Data Header Framing ─────────────────────────────────────────────────────

/// Full data header (legacy, 18 bytes).
#[derive(Debug, Clone, Copy)]
pub struct SpiceDataHeader {
    pub serial: u64,
    pub msg_type: u16,
    pub size: u32,
    pub sub_list: u32,
}

impl SpiceDataHeader {
    pub const SIZE: usize = 18;

    pub fn encode(&self, buf: &mut BytesMut) {
        buf.put_u64_le(self.serial);
        buf.put_u16_le(self.msg_type);
        buf.put_u32_le(self.size);
        buf.put_u32_le(self.sub_list);
    }

    pub fn decode(buf: &[u8]) -> Result<Self, SpiceError> {
        if buf.len() < Self::SIZE {
            return Err(SpiceError::protocol("Incomplete data header"));
        }
        let mut b = buf;
        Ok(Self {
            serial: read_u64_le(&mut b),
            msg_type: read_u16_le(&mut b),
            size: read_u32_le(&mut b),
            sub_list: read_u32_le(&mut b),
        })
    }
}

/// Mini data header (SPICE 2+, 6 bytes).
#[derive(Debug, Clone, Copy)]
pub struct SpiceMiniDataHeader {
    pub msg_type: u16,
    pub size: u32,
}

impl SpiceMiniDataHeader {
    pub const SIZE: usize = 6;

    pub fn encode(&self, buf: &mut BytesMut) {
        buf.put_u16_le(self.msg_type);
        buf.put_u32_le(self.size);
    }

    pub fn decode(buf: &[u8]) -> Result<Self, SpiceError> {
        if buf.len() < Self::SIZE {
            return Err(SpiceError::protocol("Incomplete mini data header"));
        }
        Ok(Self {
            msg_type: u16::from_le_bytes([buf[0], buf[1]]),
            size: u32::from_le_bytes([buf[2], buf[3], buf[4], buf[5]]),
        })
    }
}

// ── Capability negotiation ──────────────────────────────────────────────────

/// Common capability bits (shared across channels).
pub struct CommonCaps;
impl CommonCaps {
    pub const AUTH_SELECTION: u32 = 0;
    pub const AUTH_SPICE: u32 = 1;
    pub const AUTH_SASL: u32 = 2;
    pub const MINI_HEADER: u32 = 3;
}

/// Capability set builder.
pub struct CapabilitySet {
    caps: HashSet<u32>,
}

impl Default for CapabilitySet {
    fn default() -> Self {
        Self::new()
    }
}

impl CapabilitySet {
    pub fn new() -> Self {
        Self {
            caps: HashSet::new(),
        }
    }

    pub fn add(&mut self, cap: u32) -> &mut Self {
        self.caps.insert(cap);
        self
    }

    pub fn has(&self, cap: u32) -> bool {
        self.caps.contains(&cap)
    }

    /// Encode as a vector of u32 words (bitmask).
    pub fn encode(&self) -> Vec<u32> {
        if self.caps.is_empty() {
            return vec![];
        }
        let max = *self.caps.iter().max().expect("caps checked non-empty");
        let words = (max / 32 + 1) as usize;
        let mut result = vec![0u32; words];
        for &cap in &self.caps {
            let word = (cap / 32) as usize;
            let bit = cap % 32;
            result[word] |= 1 << bit;
        }
        result
    }

    /// Decode from a slice of u32 words.
    pub fn decode(words: &[u32]) -> Self {
        let mut set = Self::new();
        for (i, &word) in words.iter().enumerate() {
            for bit in 0..32 {
                if word & (1 << bit) != 0 {
                    set.add(i as u32 * 32 + bit);
                }
            }
        }
        set
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

fn read_u64_le(b: &mut &[u8]) -> u64 {
    let val = u64::from_le_bytes(b[..8].try_into().expect("slice length matches target type"));
    *b = &b[8..];
    val
}

fn read_u32_le(b: &mut &[u8]) -> u32 {
    let val = u32::from_le_bytes(b[..4].try_into().expect("slice length matches target type"));
    *b = &b[4..];
    val
}

fn read_u16_le(b: &mut &[u8]) -> u16 {
    let val = u16::from_le_bytes(b[..2].try_into().expect("slice length matches target type"));
    *b = &b[2..];
    val
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn link_header_roundtrip() {
        let header = SpiceLinkHeader::new(SpiceVersion::V2);
        let mut buf = BytesMut::new();
        header.encode(&mut buf);
        assert_eq!(buf.len(), SpiceLinkHeader::SIZE);
        let decoded = SpiceLinkHeader::decode(&mut buf).unwrap();
        assert_eq!(decoded.magic, SPICE_MAGIC);
        assert_eq!(decoded.major_version, 2);
    }

    #[test]
    fn mini_header_roundtrip() {
        let h = SpiceMiniDataHeader {
            msg_type: 42,
            size: 1024,
        };
        let mut buf = BytesMut::new();
        h.encode(&mut buf);
        assert_eq!(buf.len(), SpiceMiniDataHeader::SIZE);
        let decoded = SpiceMiniDataHeader::decode(&buf).unwrap();
        assert_eq!(decoded.msg_type, 42);
        assert_eq!(decoded.size, 1024);
    }

    #[test]
    fn capability_set() {
        let mut caps = CapabilitySet::new();
        caps.add(CommonCaps::AUTH_SELECTION);
        caps.add(CommonCaps::MINI_HEADER);
        assert!(caps.has(CommonCaps::AUTH_SELECTION));
        assert!(caps.has(CommonCaps::MINI_HEADER));
        assert!(!caps.has(CommonCaps::AUTH_SASL));

        let encoded = caps.encode();
        let decoded = CapabilitySet::decode(&encoded);
        assert!(decoded.has(CommonCaps::AUTH_SELECTION));
        assert!(decoded.has(CommonCaps::MINI_HEADER));
    }

    #[test]
    fn ticket_encoding() {
        let ticket = encode_ticket("secret");
        assert_eq!(ticket.len(), 128);
        assert_eq!(&ticket[..6], b"secret");
    }
}
