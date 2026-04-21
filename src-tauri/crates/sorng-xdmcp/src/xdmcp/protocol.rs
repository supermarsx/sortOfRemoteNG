//! XDMCP wire protocol encoding/decoding per RFC 1198.

use crate::xdmcp::types::*;
use bytes::{BufMut, BytesMut};

// ── Wire format ─────────────────────────────────────────────────────────────
//
// All XDMCP packets start with:
//   version (u16) | opcode (u16) | length (u16) | payload...
//
// Strings are length-prefixed: length (u16) | bytes...
// Arrays are count-prefixed: count (u16) | elements...

/// XDMCP packet header.
#[derive(Debug, Clone, Copy)]
pub struct XdmcpHeader {
    pub version: u16,
    pub opcode: XdmcpOpcode,
    pub length: u16,
}

impl XdmcpHeader {
    pub const SIZE: usize = 6;

    pub fn new(opcode: XdmcpOpcode, length: u16) -> Self {
        Self {
            version: XDMCP_PROTOCOL_VERSION,
            opcode,
            length,
        }
    }

    pub fn encode(&self, buf: &mut BytesMut) {
        buf.put_u16(self.version);
        buf.put_u16(self.opcode.to_u16());
        buf.put_u16(self.length);
    }

    pub fn decode(data: &[u8]) -> Option<Self> {
        if data.len() < 6 {
            return None;
        }
        let version = u16::from_be_bytes([data[0], data[1]]);
        let opcode_raw = u16::from_be_bytes([data[2], data[3]]);
        let length = u16::from_be_bytes([data[4], data[5]]);
        let opcode = XdmcpOpcode::from_u16(opcode_raw)?;
        Some(Self {
            version,
            opcode,
            length,
        })
    }
}

/// Encode a length-prefixed string.
pub fn encode_string(buf: &mut BytesMut, s: &str) {
    buf.put_u16(s.len() as u16);
    buf.put_slice(s.as_bytes());
}

/// Decode a length-prefixed string from a byte slice, returning (string, bytes_consumed).
pub fn decode_string(data: &[u8]) -> Option<(String, usize)> {
    if data.len() < 2 {
        return None;
    }
    let len = u16::from_be_bytes([data[0], data[1]]) as usize;
    if data.len() < 2 + len {
        return None;
    }
    let s = String::from_utf8_lossy(&data[2..2 + len]).to_string();
    Some((s, 2 + len))
}

/// Encode a list of strings (count-prefixed).
pub fn encode_string_list(buf: &mut BytesMut, strings: &[&str]) {
    buf.put_u16(strings.len() as u16);
    for s in strings {
        encode_string(buf, s);
    }
}

/// Decode a list of strings.
pub fn decode_string_list(data: &[u8]) -> Option<(Vec<String>, usize)> {
    if data.len() < 2 {
        return None;
    }
    let count = u16::from_be_bytes([data[0], data[1]]) as usize;
    let mut offset = 2;
    let mut strings = Vec::with_capacity(count);
    for _ in 0..count {
        let (s, consumed) = decode_string(&data[offset..])?;
        strings.push(s);
        offset += consumed;
    }
    Some((strings, offset))
}

// ── Packet builders ─────────────────────────────────────────────────────────

/// Build a Query packet.
pub fn build_query(auth_names: &[&str]) -> BytesMut {
    let mut payload = BytesMut::new();
    encode_string_list(&mut payload, auth_names);

    let mut buf = BytesMut::new();
    XdmcpHeader::new(XdmcpOpcode::Query, payload.len() as u16).encode(&mut buf);
    buf.put_slice(&payload);
    buf
}

/// Build a BroadcastQuery packet.
pub fn build_broadcast_query(auth_names: &[&str]) -> BytesMut {
    let mut payload = BytesMut::new();
    encode_string_list(&mut payload, auth_names);

    let mut buf = BytesMut::new();
    XdmcpHeader::new(XdmcpOpcode::BroadcastQuery, payload.len() as u16).encode(&mut buf);
    buf.put_slice(&payload);
    buf
}

/// Build a Request packet.
pub fn build_request(
    display_number: u16,
    connection_types: &[u16],
    connection_addresses: &[&[u8]],
    auth_name: &str,
    auth_data: &[u8],
    manufacturer_id: &str,
) -> BytesMut {
    let mut payload = BytesMut::new();

    // Display number
    payload.put_u16(display_number);

    // Connection types (array of CARD16)
    payload.put_u8(connection_types.len() as u8);
    for ct in connection_types {
        payload.put_u16(*ct);
    }

    // Connection addresses (array of ARRAY8)
    payload.put_u8(connection_addresses.len() as u8);
    for addr in connection_addresses {
        payload.put_u16(addr.len() as u16);
        payload.put_slice(addr);
    }

    // Authentication
    encode_string(&mut payload, auth_name);
    payload.put_u16(auth_data.len() as u16);
    payload.put_slice(auth_data);

    // Authorization protocols
    encode_string_list(&mut payload, &[auth_name]);

    // Manufacturer display ID
    encode_string(&mut payload, manufacturer_id);

    let mut buf = BytesMut::new();
    XdmcpHeader::new(XdmcpOpcode::Request, payload.len() as u16).encode(&mut buf);
    buf.put_slice(&payload);
    buf
}

/// Build a Manage packet.
pub fn build_manage(session_id: u32, display_number: u16, display_class: &str) -> BytesMut {
    let mut payload = BytesMut::new();
    payload.put_u32(session_id);
    payload.put_u16(display_number);
    encode_string(&mut payload, display_class);

    let mut buf = BytesMut::new();
    XdmcpHeader::new(XdmcpOpcode::Manage, payload.len() as u16).encode(&mut buf);
    buf.put_slice(&payload);
    buf
}

/// Build a KeepAlive packet.
pub fn build_keepalive(display_number: u16, session_id: u32) -> BytesMut {
    let mut payload = BytesMut::new();
    payload.put_u16(display_number);
    payload.put_u32(session_id);

    let mut buf = BytesMut::new();
    XdmcpHeader::new(XdmcpOpcode::KeepAlive, payload.len() as u16).encode(&mut buf);
    buf.put_slice(&payload);
    buf
}

// ── Packet parsing ──────────────────────────────────────────────────────────

/// Parsed Willing response.
#[derive(Debug, Clone)]
pub struct WillingResponse {
    pub auth_name: String,
    pub hostname: String,
    pub status: String,
}

/// Parse a Willing response payload (after header).
pub fn parse_willing(payload: &[u8]) -> Option<WillingResponse> {
    let (auth_name, consumed1) = decode_string(payload)?;
    let (hostname, consumed2) = decode_string(&payload[consumed1..])?;
    let (status, _) = decode_string(&payload[consumed1 + consumed2..])?;
    Some(WillingResponse {
        auth_name,
        hostname,
        status,
    })
}

/// Parsed Accept response.
#[derive(Debug, Clone)]
pub struct AcceptResponse {
    pub session_id: u32,
    pub auth_name: String,
    pub auth_data: Vec<u8>,
}

/// Parse an Accept response payload.
pub fn parse_accept(payload: &[u8]) -> Option<AcceptResponse> {
    if payload.len() < 4 {
        return None;
    }
    let session_id = u32::from_be_bytes([payload[0], payload[1], payload[2], payload[3]]);
    let offset = 4;
    let (auth_name, consumed) = decode_string(&payload[offset..])?;
    let data_offset = offset + consumed;
    if payload.len() < data_offset + 2 {
        return None;
    }
    let data_len = u16::from_be_bytes([payload[data_offset], payload[data_offset + 1]]) as usize;
    let data = payload
        .get(data_offset + 2..data_offset + 2 + data_len)?
        .to_vec();
    Some(AcceptResponse {
        session_id,
        auth_name,
        auth_data: data,
    })
}

/// Parsed Decline response.
#[derive(Debug, Clone)]
pub struct DeclineResponse {
    pub status: String,
    pub auth_name: String,
    pub auth_data: Vec<u8>,
}

/// Parse a Decline response payload.
pub fn parse_decline(payload: &[u8]) -> Option<DeclineResponse> {
    let (status, consumed1) = decode_string(payload)?;
    let (auth_name, consumed2) = decode_string(&payload[consumed1..])?;
    let data_offset = consumed1 + consumed2;
    if payload.len() < data_offset + 2 {
        return None;
    }
    let data_len = u16::from_be_bytes([payload[data_offset], payload[data_offset + 1]]) as usize;
    let data = payload
        .get(data_offset + 2..data_offset + 2 + data_len)?
        .to_vec();
    Some(DeclineResponse {
        status,
        auth_name,
        auth_data: data,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn header_roundtrip() {
        let header = XdmcpHeader::new(XdmcpOpcode::Query, 10);
        let mut buf = BytesMut::new();
        header.encode(&mut buf);
        assert_eq!(buf.len(), 6);

        let decoded = XdmcpHeader::decode(&buf).unwrap();
        assert_eq!(decoded.opcode, XdmcpOpcode::Query);
        assert_eq!(decoded.length, 10);
    }

    #[test]
    fn string_roundtrip() {
        let mut buf = BytesMut::new();
        encode_string(&mut buf, "hello");
        let (s, consumed) = decode_string(&buf).unwrap();
        assert_eq!(s, "hello");
        assert_eq!(consumed, 7); // 2 + 5
    }

    #[test]
    fn string_list_roundtrip() {
        let mut buf = BytesMut::new();
        encode_string_list(&mut buf, &["MIT-MAGIC-COOKIE-1", "XDM-AUTHORIZATION-1"]);
        let (list, _) = decode_string_list(&buf).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0], "MIT-MAGIC-COOKIE-1");
    }

    #[test]
    fn query_packet() {
        let pkt = build_query(&[]);
        let header = XdmcpHeader::decode(&pkt).unwrap();
        assert_eq!(header.opcode, XdmcpOpcode::Query);
    }

    #[test]
    fn keepalive_packet() {
        let pkt = build_keepalive(1, 12345);
        let header = XdmcpHeader::decode(&pkt).unwrap();
        assert_eq!(header.opcode, XdmcpOpcode::KeepAlive);
        assert_eq!(header.length, 6); // u16 + u32
    }

    #[test]
    fn willing_parse() {
        let mut payload = BytesMut::new();
        encode_string(&mut payload, "");
        encode_string(&mut payload, "myhost.local");
        encode_string(&mut payload, "Runlevel 5");
        let resp = parse_willing(&payload).unwrap();
        assert_eq!(resp.hostname, "myhost.local");
        assert_eq!(resp.status, "Runlevel 5");
    }
}
