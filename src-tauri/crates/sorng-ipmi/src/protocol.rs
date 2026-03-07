//! RMCP / IPMI wire-protocol encoding and decoding — RMCP header, IPMI
//! message wrappers, ASF Ping/Pong, RMCP+ (IPMI 2.0) payloads, sequence
//! tracking, checksum computation, and completion-code handling.

use crate::error::{IpmiError, IpmiResult};
use crate::types::*;
use log::{debug, trace};

// ═══════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════

/// RMCP version 0x06 (ASF 2.0).
pub const RMCP_VERSION: u8 = 0x06;
/// Reserved field value.
pub const RMCP_RESERVED: u8 = 0x00;
/// RMCP sequence number for IPMI (no ACK requested).
pub const RMCP_SEQ_NO_ACK: u8 = 0xFF;
/// RMCP message class — IPMI.
pub const RMCP_CLASS_IPMI: u8 = 0x07;
/// RMCP message class — ASF.
pub const RMCP_CLASS_ASF: u8 = 0x06;
/// Standard IPMI port.
pub const IPMI_PORT: u16 = 623;
/// ASF IANA Enterprise Number.
pub const ASF_IANA: u32 = 0x000011BE;
/// ASF message type — Presence Ping.
pub const ASF_TYPE_PING: u8 = 0x80;
/// ASF message type — Presence Pong.
pub const ASF_TYPE_PONG: u8 = 0x40;
/// BMC slave address (default responder address on IPMB).
pub const BMC_SA: u8 = 0x20;
/// Software / remote-console slave address.
pub const SWID: u8 = 0x81;

/// Maximum IPMI message size (conservative).
pub const MAX_MSG_SIZE: usize = 1024;

// ── RMCP+ / IPMI 2.0 payload types ────────────────────────────────

/// IPMI Message payload type.
pub const PAYLOAD_IPMI: u8 = 0x00;
/// SOL payload type.
pub const PAYLOAD_SOL: u8 = 0x01;
/// OEM Explicit payload type.
pub const PAYLOAD_OEM: u8 = 0x02;
/// RMCP+ Open Session Request.
pub const PAYLOAD_OPEN_SESSION_REQ: u8 = 0x10;
/// RMCP+ Open Session Response.
pub const PAYLOAD_OPEN_SESSION_RSP: u8 = 0x11;
/// RAKP Message 1.
pub const PAYLOAD_RAKP1: u8 = 0x12;
/// RAKP Message 2.
pub const PAYLOAD_RAKP2: u8 = 0x13;
/// RAKP Message 3.
pub const PAYLOAD_RAKP3: u8 = 0x14;
/// RAKP Message 4.
pub const PAYLOAD_RAKP4: u8 = 0x15;

// ═══════════════════════════════════════════════════════════════════════
// RMCP Header
// ═══════════════════════════════════════════════════════════════════════

/// 4-byte RMCP header that prefixes every UDP datagram.
#[derive(Debug, Clone, Copy)]
pub struct RmcpHeader {
    /// RMCP version (always 0x06).
    pub version: u8,
    /// Reserved (0x00).
    pub reserved: u8,
    /// Sequence number (0xFF = no ACK).
    pub seq_number: u8,
    /// Message class (0x07 = IPMI, 0x06 = ASF).
    pub class: u8,
}

impl Default for RmcpHeader {
    fn default() -> Self {
        Self {
            version: RMCP_VERSION,
            reserved: RMCP_RESERVED,
            seq_number: RMCP_SEQ_NO_ACK,
            class: RMCP_CLASS_IPMI,
        }
    }
}

impl RmcpHeader {
    /// Create an RMCP header for an IPMI message.
    pub fn ipmi() -> Self {
        Self::default()
    }

    /// Create an RMCP header for an ASF message.
    pub fn asf() -> Self {
        Self {
            class: RMCP_CLASS_ASF,
            ..Self::default()
        }
    }

    /// Encode header to bytes.
    pub fn encode(&self) -> [u8; 4] {
        [self.version, self.reserved, self.seq_number, self.class]
    }

    /// Decode header from bytes.
    pub fn decode(data: &[u8]) -> IpmiResult<Self> {
        if data.len() < 4 {
            return Err(IpmiError::data_too_short(4, data.len()));
        }
        let header = Self {
            version: data[0],
            reserved: data[1],
            seq_number: data[2],
            class: data[3],
        };
        if header.version != RMCP_VERSION {
            return Err(IpmiError::RmcpError(format!(
                "Unexpected RMCP version: 0x{:02X}",
                header.version
            )));
        }
        Ok(header)
    }
}

// ═══════════════════════════════════════════════════════════════════════
// ASF Ping / Pong
// ═══════════════════════════════════════════════════════════════════════

/// ASF message header (follows RMCP header).
#[derive(Debug, Clone)]
pub struct AsfHeader {
    pub iana_enterprise: u32,
    pub message_type: u8,
    pub message_tag: u8,
    pub reserved: u8,
    pub data_length: u8,
}

impl AsfHeader {
    /// Encode an ASF Presence Ping.
    pub fn encode_ping(tag: u8) -> Vec<u8> {
        let mut buf = Vec::with_capacity(12);
        // RMCP header (ASF class)
        buf.extend_from_slice(&RmcpHeader::asf().encode());
        // IANA enterprise number (4 bytes BE)
        buf.extend_from_slice(&ASF_IANA.to_be_bytes());
        // Message type = Ping
        buf.push(ASF_TYPE_PING);
        // Message tag
        buf.push(tag);
        // Reserved
        buf.push(0x00);
        // Data length
        buf.push(0x00);
        buf
    }

    /// Decode an ASF message (after RMCP header already consumed).
    pub fn decode(data: &[u8]) -> IpmiResult<Self> {
        if data.len() < 8 {
            return Err(IpmiError::data_too_short(8, data.len()));
        }
        Ok(Self {
            iana_enterprise: u32::from_be_bytes([data[0], data[1], data[2], data[3]]),
            message_type: data[4],
            message_tag: data[5],
            reserved: data[6],
            data_length: data[7],
        })
    }

    /// Check if this is a valid Pong response.
    pub fn is_pong(&self) -> bool {
        self.message_type == ASF_TYPE_PONG && self.iana_enterprise == ASF_IANA
    }
}

/// ASF Pong payload.
#[derive(Debug, Clone)]
pub struct AsfPong {
    pub iana_enterprise: u32,
    pub oem_defined: u32,
    pub supported_entities: u8,
    pub supported_interactions: u8,
}

impl AsfPong {
    /// Decode a Pong payload (data portion after ASF header).
    pub fn decode(data: &[u8]) -> IpmiResult<Self> {
        if data.len() < 16 {
            return Err(IpmiError::data_too_short(16, data.len()));
        }
        Ok(Self {
            iana_enterprise: u32::from_be_bytes([data[0], data[1], data[2], data[3]]),
            oem_defined: u32::from_be_bytes([data[4], data[5], data[6], data[7]]),
            supported_entities: data[8],
            supported_interactions: data[9],
        })
    }

    /// Whether the BMC supports IPMI.
    pub fn supports_ipmi(&self) -> bool {
        (self.supported_entities & 0x80) != 0
    }
}

// ═══════════════════════════════════════════════════════════════════════
// IPMI 1.5 Session Wrapper
// ═══════════════════════════════════════════════════════════════════════

/// IPMI 1.5 session header wrapping the IPMI message.
#[derive(Debug, Clone)]
pub struct Ipmi15Header {
    /// Authentication type.
    pub auth_type: AuthType,
    /// Session sequence number.
    pub session_seq: u32,
    /// Session ID.
    pub session_id: u32,
    /// Authentication code (16 bytes if auth != None, else empty).
    pub auth_code: Vec<u8>,
    /// Payload length.
    pub payload_length: u8,
}

impl Ipmi15Header {
    /// Encode the IPMI 1.5 session header (without RMCP).
    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(26);
        buf.push(self.auth_type as u8);
        buf.extend_from_slice(&self.session_seq.to_le_bytes());
        buf.extend_from_slice(&self.session_id.to_le_bytes());
        if self.auth_type as u8 != 0 {
            // Pad or truncate auth_code to 16 bytes
            let mut ac = [0u8; 16];
            let len = self.auth_code.len().min(16);
            ac[..len].copy_from_slice(&self.auth_code[..len]);
            buf.extend_from_slice(&ac);
        }
        buf.push(self.payload_length);
        buf
    }

    /// Decode IPMI 1.5 session header from data (after RMCP header).
    pub fn decode(data: &[u8]) -> IpmiResult<(Self, usize)> {
        if data.len() < 10 {
            return Err(IpmiError::data_too_short(10, data.len()));
        }
        let auth_type = AuthType::from_byte(data[0]);
        let session_seq = u32::from_le_bytes([data[1], data[2], data[3], data[4]]);
        let session_id = u32::from_le_bytes([data[5], data[6], data[7], data[8]]);
        let (auth_code, offset) = if auth_type as u8 != 0 {
            if data.len() < 26 {
                return Err(IpmiError::data_too_short(26, data.len()));
            }
            (data[9..25].to_vec(), 25)
        } else {
            (Vec::new(), 9)
        };
        if data.len() <= offset {
            return Err(IpmiError::data_too_short(offset + 1, data.len()));
        }
        let payload_length = data[offset];
        let header = Self {
            auth_type,
            session_seq,
            session_id,
            auth_code,
            payload_length,
        };
        Ok((header, offset + 1))
    }
}

// ═══════════════════════════════════════════════════════════════════════
// IPMI 2.0 / RMCP+ Session Wrapper
// ═══════════════════════════════════════════════════════════════════════

/// RMCP+ (IPMI 2.0) session header.
#[derive(Debug, Clone)]
pub struct Ipmi20Header {
    /// Authentication type (always 0x06 = RMCP+).
    pub auth_type: u8,
    /// Payload type (encrypted flag, authenticated flag, type code).
    pub payload_encrypted: bool,
    /// Whether the payload is authenticated.
    pub payload_authenticated: bool,
    /// Payload type code.
    pub payload_type: u8,
    /// OEM IANA (only for OEM payloads).
    pub oem_iana: u32,
    /// OEM payload ID (only for OEM payloads).
    pub oem_payload_id: u16,
    /// Session ID.
    pub session_id: u32,
    /// Session sequence number.
    pub session_seq: u32,
    /// Payload length.
    pub payload_length: u16,
}

impl Ipmi20Header {
    /// Encode the RMCP+ header.
    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(16);
        buf.push(0x06); // auth type = RMCP+
        let mut pt = self.payload_type & 0x3F;
        if self.payload_encrypted {
            pt |= 0x80;
        }
        if self.payload_authenticated {
            pt |= 0x40;
        }
        buf.push(pt);
        if self.payload_type == PAYLOAD_OEM {
            buf.extend_from_slice(&self.oem_iana.to_le_bytes());
            buf.extend_from_slice(&self.oem_payload_id.to_le_bytes());
        }
        buf.extend_from_slice(&self.session_id.to_le_bytes());
        buf.extend_from_slice(&self.session_seq.to_le_bytes());
        buf.extend_from_slice(&self.payload_length.to_le_bytes());
        buf
    }

    /// Decode an RMCP+ header from data (after RMCP header).
    pub fn decode(data: &[u8]) -> IpmiResult<(Self, usize)> {
        if data.len() < 12 {
            return Err(IpmiError::data_too_short(12, data.len()));
        }
        let auth_type = data[0];
        if auth_type != 0x06 {
            return Err(IpmiError::RmcpError(format!(
                "Expected RMCP+ auth type 0x06, got 0x{:02X}",
                auth_type
            )));
        }
        let pt_byte = data[1];
        let payload_encrypted = (pt_byte & 0x80) != 0;
        let payload_authenticated = (pt_byte & 0x40) != 0;
        let payload_type = pt_byte & 0x3F;
        let mut offset = 2;
        let (oem_iana, oem_payload_id) = if payload_type == PAYLOAD_OEM {
            if data.len() < offset + 6 {
                return Err(IpmiError::data_too_short(offset + 6, data.len()));
            }
            let iana = u32::from_le_bytes([
                data[offset],
                data[offset + 1],
                data[offset + 2],
                data[offset + 3],
            ]);
            let pid = u16::from_le_bytes([data[offset + 4], data[offset + 5]]);
            offset += 6;
            (iana, pid)
        } else {
            (0, 0)
        };
        if data.len() < offset + 10 {
            return Err(IpmiError::data_too_short(offset + 10, data.len()));
        }
        let session_id = u32::from_le_bytes([
            data[offset],
            data[offset + 1],
            data[offset + 2],
            data[offset + 3],
        ]);
        offset += 4;
        let session_seq = u32::from_le_bytes([
            data[offset],
            data[offset + 1],
            data[offset + 2],
            data[offset + 3],
        ]);
        offset += 4;
        let payload_length = u16::from_le_bytes([data[offset], data[offset + 1]]);
        offset += 2;
        let header = Self {
            auth_type,
            payload_encrypted,
            payload_authenticated,
            payload_type,
            oem_iana,
            oem_payload_id,
            session_id,
            session_seq,
            payload_length,
        };
        Ok((header, offset))
    }
}

// ═══════════════════════════════════════════════════════════════════════
// IPMI Message (inner payload)
// ═══════════════════════════════════════════════════════════════════════

/// An IPMI request message (inner payload inside the session wrapper).
#[derive(Debug, Clone)]
pub struct IpmiRequest {
    /// Target slave address (usually 0x20 = BMC).
    pub rs_addr: u8,
    /// Network function (upper 6 bits) + LUN (lower 2 bits).
    pub net_fn: u8,
    /// Target LUN.
    pub rs_lun: u8,
    /// Source slave address / SWID.
    pub rq_addr: u8,
    /// Request sequence number (upper 6 bits) + source LUN (lower 2 bits).
    pub rq_seq: u8,
    /// Source LUN.
    pub rq_lun: u8,
    /// Command code.
    pub cmd: u8,
    /// Request data.
    pub data: Vec<u8>,
}

impl IpmiRequest {
    /// Create a new request for the BMC.
    pub fn new(net_fn: u8, cmd: u8, data: Vec<u8>) -> Self {
        Self {
            rs_addr: BMC_SA,
            net_fn,
            rs_lun: 0,
            rq_addr: SWID,
            rq_seq: 0,
            rq_lun: 0,
            cmd,
            data,
        }
    }

    /// Encode the IPMI request message (with checksums).
    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(8 + self.data.len());

        // Header part 1: rsAddr, netFn/rsLUN, checksum1
        buf.push(self.rs_addr);
        buf.push((self.net_fn << 2) | (self.rs_lun & 0x03));
        let cksum1 = checksum(&buf);
        buf.push(cksum1);

        // Header part 2: rqAddr, rqSeq/rqLUN, cmd, data..., checksum2
        let chk2_start = buf.len();
        buf.push(self.rq_addr);
        buf.push((self.rq_seq << 2) | (self.rq_lun & 0x03));
        buf.push(self.cmd);
        buf.extend_from_slice(&self.data);
        let cksum2 = checksum(&buf[chk2_start..]);
        buf.push(cksum2);

        buf
    }

    /// Set the request sequence number.
    pub fn with_seq(mut self, seq: u8) -> Self {
        self.rq_seq = seq & 0x3F;
        self
    }

    /// Set a custom target address (for bridging).
    pub fn with_target(mut self, addr: u8, lun: u8) -> Self {
        self.rs_addr = addr;
        self.rs_lun = lun & 0x03;
        self
    }
}

/// A decoded IPMI response message.
#[derive(Debug, Clone)]
pub struct IpmiResponse {
    /// Responder address.
    pub rs_addr: u8,
    /// Network function.
    pub net_fn: u8,
    /// Responder LUN.
    pub rs_lun: u8,
    /// Requester address.
    pub rq_addr: u8,
    /// Request sequence.
    pub rq_seq: u8,
    /// Requester LUN.
    pub rq_lun: u8,
    /// Command code.
    pub cmd: u8,
    /// Completion code.
    pub completion_code: u8,
    /// Response data.
    pub data: Vec<u8>,
}

impl IpmiResponse {
    /// Decode an IPMI response message from raw bytes.
    pub fn decode(data: &[u8]) -> IpmiResult<Self> {
        // Minimum: rsAddr(1) + netFn/rsLUN(1) + cksum1(1) + rqAddr(1)
        //        + rqSeq/rqLUN(1) + cmd(1) + cc(1) + cksum2(1) = 8
        if data.len() < 8 {
            return Err(IpmiError::data_too_short(8, data.len()));
        }

        // Verify checksum 1 (first 2 bytes)
        let computed_ck1 = checksum(&data[..2]);
        if data[2] != computed_ck1 {
            return Err(IpmiError::checksum_error(computed_ck1, data[2]));
        }

        let rs_addr = data[0];
        let net_fn = (data[1] >> 2) & 0x3F;
        let rs_lun = data[1] & 0x03;
        let rq_addr = data[3];
        let rq_seq = (data[4] >> 2) & 0x3F;
        let rq_lun = data[4] & 0x03;
        let cmd = data[5];
        let completion_code = data[6];

        // Verify checksum 2
        let body = &data[3..data.len() - 1];
        let computed_ck2 = checksum(body);
        if data[data.len() - 1] != computed_ck2 {
            return Err(IpmiError::checksum_error(
                computed_ck2,
                data[data.len() - 1],
            ));
        }

        let response_data = if data.len() > 8 {
            data[7..data.len() - 1].to_vec()
        } else {
            Vec::new()
        };

        Ok(Self {
            rs_addr,
            net_fn,
            rs_lun,
            rq_addr,
            rq_seq,
            rq_lun,
            cmd,
            completion_code,
            data: response_data,
        })
    }

    /// Get the completion code.
    pub fn completion_code(&self) -> u8 {
        self.completion_code
    }

    /// Check whether this response indicates success.
    pub fn is_success(&self) -> bool {
        self.completion_code == 0x00
    }

    /// Return an error if the completion code is non-zero.
    pub fn check(&self) -> IpmiResult<()> {
        if self.is_success() {
            Ok(())
        } else {
            Err(IpmiError::from_completion_code(self.completion_code))
        }
    }

    /// Convert into a `RawIpmiResponse`.
    pub fn to_raw(&self) -> RawIpmiResponse {
        RawIpmiResponse {
            completion_code: self.completion_code,
            data: self.data.clone(),
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Sequence Tracker
// ═══════════════════════════════════════════════════════════════════════

/// Manages IPMI message sequence numbers.
#[derive(Debug)]
pub struct SequenceTracker {
    /// Current rqSeq (6-bit, wraps at 64).
    rq_seq: u8,
    /// Session sequence counter (32-bit, wraps).
    session_seq: u32,
    /// Outstanding requests indexed by rqSeq.
    outstanding: [Option<OutstandingRequest>; 64],
}

/// Tracks an in-flight request for matching responses.
#[derive(Debug, Clone)]
pub struct OutstandingRequest {
    /// Network function of the sent request.
    pub net_fn: u8,
    /// Command code of the sent request.
    pub cmd: u8,
    /// Timestamp when the request was sent (ms since epoch).
    pub sent_at_ms: u64,
}

impl SequenceTracker {
    /// Create a new sequence tracker.
    pub fn new() -> Self {
        Self {
            rq_seq: 0,
            session_seq: 1,
            outstanding: std::array::from_fn(|_| None),
        }
    }

    /// Allocate the next rqSeq value and register the outstanding request.
    pub fn next_rq_seq(&mut self, net_fn: u8, cmd: u8) -> u8 {
        let seq = self.rq_seq;
        self.rq_seq = (self.rq_seq + 1) & 0x3F;
        self.outstanding[seq as usize] = Some(OutstandingRequest {
            net_fn,
            cmd,
            sent_at_ms: current_time_ms(),
        });
        seq
    }

    /// Get and increment the session sequence number.
    pub fn next_session_seq(&mut self) -> u32 {
        let seq = self.session_seq;
        self.session_seq = self.session_seq.wrapping_add(1);
        if self.session_seq == 0 {
            self.session_seq = 1; // 0 is reserved for unauthenticated
        }
        seq
    }

    /// Match a response to an outstanding request and remove it.
    pub fn match_response(&mut self, rq_seq: u8) -> Option<OutstandingRequest> {
        let idx = (rq_seq & 0x3F) as usize;
        self.outstanding[idx].take()
    }

    /// Clear all outstanding requests.
    pub fn clear(&mut self) {
        for slot in &mut self.outstanding {
            *slot = None;
        }
    }

    /// Get the current rqSeq value without incrementing.
    pub fn current_rq_seq(&self) -> u8 {
        self.rq_seq
    }

    /// Get the current session sequence number without incrementing.
    pub fn current_session_seq(&self) -> u32 {
        self.session_seq
    }

    /// Count outstanding (in-flight) requests.
    pub fn outstanding_count(&self) -> usize {
        self.outstanding.iter().filter(|r| r.is_some()).count()
    }

    /// Remove timed-out requests (older than `timeout_ms`).
    pub fn expire_old(&mut self, timeout_ms: u64) -> Vec<OutstandingRequest> {
        let now = current_time_ms();
        let mut expired = Vec::new();
        for slot in &mut self.outstanding {
            if let Some(ref req) = slot {
                if now.saturating_sub(req.sent_at_ms) > timeout_ms {
                    expired.push(slot.take().unwrap());
                }
            }
        }
        expired
    }
}

impl Default for SequenceTracker {
    fn default() -> Self {
        Self::new()
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Full message builders
// ═══════════════════════════════════════════════════════════════════════

/// Build a complete RMCP + IPMI 1.5 unauthenticated message.
pub fn build_v15_unauth_message(request: &IpmiRequest) -> Vec<u8> {
    let payload = request.encode();
    let session_header = Ipmi15Header {
        auth_type: AuthType::None,
        session_seq: 0,
        session_id: 0,
        auth_code: Vec::new(),
        payload_length: payload.len() as u8,
    };
    let mut msg = Vec::with_capacity(4 + 10 + payload.len());
    msg.extend_from_slice(&RmcpHeader::ipmi().encode());
    msg.extend_from_slice(&session_header.encode());
    msg.extend_from_slice(&payload);
    msg
}

/// Build a complete RMCP + IPMI 1.5 authenticated message.
pub fn build_v15_auth_message(
    auth_type: AuthType,
    session_id: u32,
    session_seq: u32,
    auth_code: &[u8],
    request: &IpmiRequest,
) -> Vec<u8> {
    let payload = request.encode();
    let session_header = Ipmi15Header {
        auth_type,
        session_seq,
        session_id,
        auth_code: auth_code.to_vec(),
        payload_length: payload.len() as u8,
    };
    let mut msg = Vec::with_capacity(4 + 26 + payload.len());
    msg.extend_from_slice(&RmcpHeader::ipmi().encode());
    msg.extend_from_slice(&session_header.encode());
    msg.extend_from_slice(&payload);
    msg
}

/// Build a complete RMCP+ (IPMI 2.0) session message.
pub fn build_v20_message(
    session_id: u32,
    session_seq: u32,
    payload_type: u8,
    encrypted: bool,
    authenticated: bool,
    payload: &[u8],
) -> Vec<u8> {
    let header = Ipmi20Header {
        auth_type: 0x06,
        payload_encrypted: encrypted,
        payload_authenticated: authenticated,
        payload_type,
        oem_iana: 0,
        oem_payload_id: 0,
        session_id,
        session_seq,
        payload_length: payload.len() as u16,
    };
    let h_bytes = header.encode();
    let mut msg = Vec::with_capacity(4 + h_bytes.len() + payload.len());
    msg.extend_from_slice(&RmcpHeader::ipmi().encode());
    msg.extend_from_slice(&h_bytes);
    msg.extend_from_slice(payload);
    msg
}

// ═══════════════════════════════════════════════════════════════════════
// Message parsing helpers
// ═══════════════════════════════════════════════════════════════════════

/// Result of parsing a received RMCP datagram.
#[derive(Debug)]
pub enum ParsedMessage {
    /// IPMI 1.5 message.
    V15 {
        header: Ipmi15Header,
        response: IpmiResponse,
    },
    /// RMCP+ (IPMI 2.0) message.
    V20 {
        header: Ipmi20Header,
        payload: Vec<u8>,
    },
    /// ASF Pong.
    AsfPong(AsfPong),
}

/// Parse a received UDP datagram.
pub fn parse_datagram(data: &[u8]) -> IpmiResult<ParsedMessage> {
    let rmcp = RmcpHeader::decode(data)?;

    match rmcp.class & 0x0F {
        // ASF
        0x06 => {
            let asf = AsfHeader::decode(&data[4..])?;
            if asf.is_pong() && data.len() >= 12 + asf.data_length as usize {
                let pong = AsfPong::decode(&data[12..])?;
                Ok(ParsedMessage::AsfPong(pong))
            } else {
                Err(IpmiError::RmcpError(format!(
                    "Unexpected ASF message type 0x{:02X}",
                    asf.message_type
                )))
            }
        }
        // IPMI
        0x07 => {
            let session_data = &data[4..];
            // Peek at auth type to decide 1.5 vs 2.0
            if session_data.is_empty() {
                return Err(IpmiError::data_too_short(1, 0));
            }
            let auth_byte = session_data[0];
            if auth_byte == 0x06 {
                // RMCP+
                let (header, offset) = Ipmi20Header::decode(session_data)?;
                let plen = header.payload_length as usize;
                if session_data.len() < offset + plen {
                    return Err(IpmiError::data_too_short(
                        offset + plen,
                        session_data.len(),
                    ));
                }
                let payload = session_data[offset..offset + plen].to_vec();
                Ok(ParsedMessage::V20 { header, payload })
            } else {
                // IPMI 1.5
                let (header, offset) = Ipmi15Header::decode(session_data)?;
                let plen = header.payload_length as usize;
                if session_data.len() < offset + plen {
                    return Err(IpmiError::data_too_short(
                        offset + plen,
                        session_data.len(),
                    ));
                }
                let response =
                    IpmiResponse::decode(&session_data[offset..offset + plen])?;
                Ok(ParsedMessage::V15 { header, response })
            }
        }
        other => Err(IpmiError::RmcpError(format!(
            "Unknown RMCP class: 0x{:02X}",
            other
        ))),
    }
}

// ═══════════════════════════════════════════════════════════════════════
// IPMI Command Definitions (commonly used)
// ═══════════════════════════════════════════════════════════════════════

/// Common IPMI command codes organized by NetFn.
pub mod cmd {
    // ── App (NetFn 0x06) ───────────────────────────────────────────
    pub const GET_DEVICE_ID: u8 = 0x01;
    pub const COLD_RESET: u8 = 0x02;
    pub const WARM_RESET: u8 = 0x03;
    pub const GET_SELF_TEST_RESULTS: u8 = 0x04;
    pub const GET_AUTH_CAPABILITIES: u8 = 0x38;
    pub const GET_SESSION_CHALLENGE: u8 = 0x39;
    pub const ACTIVATE_SESSION: u8 = 0x3A;
    pub const SET_SESSION_PRIVILEGE: u8 = 0x3B;
    pub const CLOSE_SESSION: u8 = 0x3C;
    pub const GET_SESSION_INFO: u8 = 0x3D;
    pub const SET_CHANNEL_ACCESS: u8 = 0x40;
    pub const GET_CHANNEL_ACCESS: u8 = 0x41;
    pub const GET_CHANNEL_INFO: u8 = 0x42;
    pub const SET_USER_ACCESS: u8 = 0x43;
    pub const GET_USER_ACCESS: u8 = 0x44;
    pub const SET_USER_NAME: u8 = 0x45;
    pub const GET_USER_NAME: u8 = 0x46;
    pub const SET_USER_PASSWORD: u8 = 0x47;
    pub const GET_CHANNEL_CIPHER_SUITES: u8 = 0x54;
    pub const SEND_MESSAGE: u8 = 0x34;

    // ── Chassis (NetFn 0x00) ───────────────────────────────────────
    pub const GET_CHASSIS_STATUS: u8 = 0x01;
    pub const CHASSIS_CONTROL: u8 = 0x02;
    pub const CHASSIS_RESET: u8 = 0x03;
    pub const CHASSIS_IDENTIFY: u8 = 0x04;
    pub const SET_SYSTEM_BOOT_OPTIONS: u8 = 0x08;
    pub const GET_SYSTEM_BOOT_OPTIONS: u8 = 0x09;
    pub const GET_POH_COUNTER: u8 = 0x0F;
    pub const GET_RESTART_CAUSE: u8 = 0x07;

    // ── Sensor/Event (NetFn 0x04) ──────────────────────────────────
    pub const GET_SENSOR_READING: u8 = 0x2D;
    pub const GET_SENSOR_THRESHOLDS: u8 = 0x27;
    pub const SET_SENSOR_THRESHOLDS: u8 = 0x26;
    pub const GET_SENSOR_TYPE: u8 = 0x2F;
    pub const GET_SENSOR_EVENT_ENABLE: u8 = 0x29;
    pub const SET_SENSOR_EVENT_ENABLE: u8 = 0x28;
    pub const GET_SENSOR_EVENT_STATUS: u8 = 0x2B;
    pub const PLATFORM_EVENT_MESSAGE: u8 = 0x02;

    // ── Storage (NetFn 0x0A) ───────────────────────────────────────
    pub const GET_SDR_REPO_INFO: u8 = 0x20;
    pub const GET_SDR_REPO_ALLOC_INFO: u8 = 0x21;
    pub const RESERVE_SDR_REPO: u8 = 0x22;
    pub const GET_SDR: u8 = 0x23;
    pub const GET_SEL_INFO: u8 = 0x40;
    pub const GET_SEL_ALLOC_INFO: u8 = 0x41;
    pub const RESERVE_SEL: u8 = 0x42;
    pub const GET_SEL_ENTRY: u8 = 0x43;
    pub const ADD_SEL_ENTRY: u8 = 0x44;
    pub const DELETE_SEL_ENTRY: u8 = 0x46;
    pub const CLEAR_SEL: u8 = 0x47;
    pub const GET_SEL_TIME: u8 = 0x48;
    pub const SET_SEL_TIME: u8 = 0x49;
    pub const GET_FRU_INVENTORY_AREA: u8 = 0x10;
    pub const READ_FRU_DATA: u8 = 0x11;
    pub const WRITE_FRU_DATA: u8 = 0x12;

    // ── Transport (NetFn 0x0C) ─────────────────────────────────────
    pub const SET_LAN_CONFIG: u8 = 0x01;
    pub const GET_LAN_CONFIG: u8 = 0x02;
    pub const SET_SOL_CONFIG: u8 = 0x21;
    pub const GET_SOL_CONFIG: u8 = 0x22;
    pub const GET_PAYLOAD_ACTIVATION_STATUS: u8 = 0x4A;
    pub const ACTIVATE_PAYLOAD: u8 = 0x48;
    pub const DEACTIVATE_PAYLOAD: u8 = 0x49;

    // ── App – Watchdog ─────────────────────────────────────────────
    pub const RESET_WATCHDOG: u8 = 0x22;
    pub const SET_WATCHDOG: u8 = 0x24;
    pub const GET_WATCHDOG: u8 = 0x25;

    // ── App – PEF ──────────────────────────────────────────────────
    pub const GET_PEF_CAPABILITIES: u8 = 0x10;
    pub const ARM_PEF_POSTPONE: u8 = 0x11;
    pub const SET_PEF_CONFIG: u8 = 0x12;
    pub const GET_PEF_CONFIG: u8 = 0x13;
    pub const SET_LAST_PROCESSED_EVENT_ID: u8 = 0x14;
    pub const GET_LAST_PROCESSED_EVENT_ID: u8 = 0x15;

    // Aliases used by subsystem modules
    pub const GET_CHANNEL_AUTH_CAP: u8 = GET_AUTH_CAPABILITIES;
    pub const GET_WATCHDOG_TIMER: u8 = GET_WATCHDOG;
    pub const SET_WATCHDOG_TIMER: u8 = SET_WATCHDOG;
    pub const RESET_WATCHDOG_TIMER: u8 = RESET_WATCHDOG;
    pub const ARM_PEF_POSTPONE_TIMER: u8 = ARM_PEF_POSTPONE;
}

// ═══════════════════════════════════════════════════════════════════════
// Checksum
// ═══════════════════════════════════════════════════════════════════════

/// Compute the IPMI 2's-complement checksum over a byte slice.
///
/// The checksum is defined as: `cksum = -(sum of all bytes) mod 256`.
pub fn checksum(data: &[u8]) -> u8 {
    let sum: u8 = data.iter().fold(0u8, |acc, &b| acc.wrapping_add(b));
    (!sum).wrapping_add(1)
}

/// Verify a checksum over `data` (the last byte of `data` is the checksum).
pub fn verify_checksum(data: &[u8]) -> bool {
    if data.is_empty() {
        return true;
    }
    let sum: u8 = data.iter().fold(0u8, |acc, &b| acc.wrapping_add(b));
    sum == 0
}

// ═══════════════════════════════════════════════════════════════════════
// Utility
// ═══════════════════════════════════════════════════════════════════════

/// Current time in milliseconds (monotonic / wall-clock for logging).
fn current_time_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Format a byte slice as a hex string (e.g. "0A FF 2B").
pub fn hex_string(data: &[u8]) -> String {
    data.iter()
        .map(|b| format!("{:02X}", b))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Parse a hex string (space or colon separated) into bytes.
pub fn parse_hex(s: &str) -> IpmiResult<Vec<u8>> {
    let clean: String = s
        .chars()
        .filter(|c| c.is_ascii_hexdigit() || c.is_ascii_whitespace() || *c == ':')
        .collect();
    let tokens: Vec<&str> = clean
        .split(|c: char| c.is_ascii_whitespace() || c == ':')
        .filter(|t| !t.is_empty())
        .collect();
    let mut bytes = Vec::with_capacity(tokens.len());
    for tok in tokens {
        let b = u8::from_str_radix(tok, 16)
            .map_err(|e| IpmiError::InvalidParameter(format!("Invalid hex '{}': {}", tok, e)))?;
        bytes.push(b);
    }
    Ok(bytes)
}

/// Format an IP address from 4 bytes.
pub fn format_ip(data: &[u8]) -> String {
    if data.len() >= 4 {
        format!("{}.{}.{}.{}", data[0], data[1], data[2], data[3])
    } else {
        "0.0.0.0".to_string()
    }
}

/// Format a MAC address from 6 bytes.
pub fn format_mac(data: &[u8]) -> String {
    if data.len() >= 6 {
        format!(
            "{:02X}:{:02X}:{:02X}:{:02X}:{:02X}:{:02X}",
            data[0], data[1], data[2], data[3], data[4], data[5]
        )
    } else {
        "00:00:00:00:00:00".to_string()
    }
}

/// Parse an IP address string into 4 bytes.
pub fn parse_ip(s: &str) -> IpmiResult<[u8; 4]> {
    let parts: Vec<&str> = s.split('.').collect();
    if parts.len() != 4 {
        return Err(IpmiError::InvalidParameter(format!(
            "Invalid IP address: {}",
            s
        )));
    }
    let mut octets = [0u8; 4];
    for (i, part) in parts.iter().enumerate() {
        octets[i] = part
            .parse()
            .map_err(|_| IpmiError::InvalidParameter(format!("Invalid IP octet: {}", part)))?;
    }
    Ok(octets)
}

/// Parse a MAC address string into 6 bytes.
pub fn parse_mac(s: &str) -> IpmiResult<[u8; 6]> {
    let clean: String = s.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    if clean.len() != 12 {
        return Err(IpmiError::InvalidParameter(format!(
            "Invalid MAC address: {}",
            s
        )));
    }
    let mut mac = [0u8; 6];
    for i in 0..6 {
        mac[i] = u8::from_str_radix(&clean[i * 2..i * 2 + 2], 16)
            .map_err(|e| IpmiError::InvalidParameter(format!("Invalid MAC byte: {}", e)))?;
    }
    Ok(mac)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_checksum() {
        // Empty => 0
        assert_eq!(checksum(&[]), 0);
        // Single byte 0x20 => -(0x20) = 0xE0
        assert_eq!(checksum(&[0x20]), 0xE0);
        // Two bytes: 0x20 + 0x18 = 0x38 => -(0x38) = 0xC8
        assert_eq!(checksum(&[0x20, 0x18]), 0xC8);
    }

    #[test]
    fn test_verify_checksum() {
        let data = [0x20, 0x18, 0xC8];
        assert!(verify_checksum(&data));
        assert!(!verify_checksum(&[0x20, 0x18, 0xFF]));
    }

    #[test]
    fn test_rmcp_header_roundtrip() {
        let hdr = RmcpHeader::ipmi();
        let encoded = hdr.encode();
        let decoded = RmcpHeader::decode(&encoded).unwrap();
        assert_eq!(decoded.version, RMCP_VERSION);
        assert_eq!(decoded.class, RMCP_CLASS_IPMI);
    }

    #[test]
    fn test_hex_roundtrip() {
        let data = vec![0x0A, 0xFF, 0x2B, 0x00];
        let s = hex_string(&data);
        let parsed = parse_hex(&s).unwrap();
        assert_eq!(data, parsed);
    }

    #[test]
    fn test_ip_roundtrip() {
        let ip = parse_ip("192.168.1.100").unwrap();
        assert_eq!(format_ip(&ip), "192.168.1.100");
    }

    #[test]
    fn test_mac_roundtrip() {
        let mac = parse_mac("AA:BB:CC:DD:EE:FF").unwrap();
        assert_eq!(format_mac(&mac), "AA:BB:CC:DD:EE:FF");
    }

    #[test]
    fn test_ipmi_request_encode() {
        let req = IpmiRequest::new(0x06, 0x01, vec![]);
        let encoded = req.encode();
        // rsAddr=0x20, netFn/lun=0x18, cksum, swid=0x81, seq/lun, cmd=0x01, cksum
        assert_eq!(encoded.len(), 7);
        assert!(verify_checksum(&encoded[..3]));
    }
}
