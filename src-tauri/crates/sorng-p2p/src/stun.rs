//! # STUN Client
//!
//! STUN (Session Traversal Utilities for NAT) client implementation based on
//! RFC 5389. Discovers public-facing addresses by querying STUN servers.

use crate::types::{StunBinding, StunServer};
use log::debug;
use std::net::SocketAddr;
use std::time::{Duration, Instant};
use tokio::net::UdpSocket;
use tokio::runtime::Runtime;

/// STUN message types (RFC 5389 §6).
#[repr(u16)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StunMessageType {
    BindingRequest = 0x0001,
    BindingResponse = 0x0101,
    BindingErrorResponse = 0x0111,
}

/// STUN attribute types (RFC 5389 §15).
#[repr(u16)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StunAttribute {
    MappedAddress = 0x0001,
    ResponseAddress = 0x0002,
    ChangeRequest = 0x0003,
    SourceAddress = 0x0004,
    ChangedAddress = 0x0005,
    Username = 0x0006,
    MessageIntegrity = 0x0008,
    ErrorCode = 0x0009,
    UnknownAttributes = 0x000A,
    ReflectedFrom = 0x000B,
    // RFC 5389
    XorMappedAddress = 0x0020,
    Software = 0x8022,
    Fingerprint = 0x8028,
    // RFC 5780 (NAT behavior discovery)
    OtherAddress = 0x802C,
    ResponseOrigin = 0x802B,
}

/// A decoded STUN response.
#[derive(Debug, Clone)]
pub struct StunResponse {
    /// Transaction ID (96 bits)
    pub transaction_id: [u8; 12],
    /// Mapped address (MAPPED-ADDRESS or XOR-MAPPED-ADDRESS)
    pub mapped_address: Option<SocketAddr>,
    /// Other address (for NAT behavior tests)
    pub other_address: Option<SocketAddr>,
    /// Response source address
    pub response_origin: Option<SocketAddr>,
    /// Whether the response indicated changed IP
    pub changed_ip: bool,
    /// Whether the response indicated changed port
    pub changed_port: bool,
}

/// STUN magic cookie (RFC 5389 §6).
pub const STUN_MAGIC_COOKIE: u32 = 0x2112A442;

/// Build a STUN Binding Request message.
pub fn build_binding_request(transaction_id: &[u8; 12]) -> Vec<u8> {
    let mut msg = Vec::with_capacity(20);
    // Message type: Binding Request (0x0001)
    msg.extend_from_slice(&0x0001u16.to_be_bytes());
    // Message length (0 — no attributes)
    msg.extend_from_slice(&0x0000u16.to_be_bytes());
    // Magic cookie
    msg.extend_from_slice(&STUN_MAGIC_COOKIE.to_be_bytes());
    // Transaction ID (12 bytes)
    msg.extend_from_slice(transaction_id);
    msg
}

/// Build a STUN Binding Request with CHANGE-REQUEST attribute (RFC 5780).
/// Used for NAT behavior discovery.
pub fn build_binding_request_change(
    transaction_id: &[u8; 12],
    change_ip: bool,
    change_port: bool,
) -> Vec<u8> {
    let mut msg = Vec::with_capacity(32);
    // Message type: Binding Request
    msg.extend_from_slice(&0x0001u16.to_be_bytes());
    // Attribute: CHANGE-REQUEST (type 0x0003, length 4)
    let attr_len = 4u16;
    let msg_len = 4 + attr_len; // attr header (4) + attr value (4)
    msg.extend_from_slice(&msg_len.to_be_bytes());
    // Magic cookie
    msg.extend_from_slice(&STUN_MAGIC_COOKIE.to_be_bytes());
    // Transaction ID
    msg.extend_from_slice(transaction_id);
    // CHANGE-REQUEST attribute
    msg.extend_from_slice(&0x0003u16.to_be_bytes()); // type
    msg.extend_from_slice(&0x0004u16.to_be_bytes()); // length
    let mut flags: u32 = 0;
    if change_ip {
        flags |= 0x04;
    }
    if change_port {
        flags |= 0x02;
    }
    msg.extend_from_slice(&flags.to_be_bytes());
    msg
}

/// Generate a random 12-byte transaction ID.
pub fn generate_transaction_id() -> [u8; 12] {
    let mut id = [0u8; 12];
    for byte in id.iter_mut() {
        *byte = rand::random();
    }
    id
}

/// Parse a STUN response message.
pub fn parse_stun_response(data: &[u8], local_txn: &[u8; 12]) -> Result<StunResponse, String> {
    if data.len() < 20 {
        return Err("Response too short".to_string());
    }

    let msg_type = u16::from_be_bytes([data[0], data[1]]);
    if msg_type != StunMessageType::BindingResponse as u16
        && msg_type != StunMessageType::BindingErrorResponse as u16
    {
        return Err(format!("Unexpected message type: 0x{:04X}", msg_type));
    }

    let msg_len = u16::from_be_bytes([data[2], data[3]]) as usize;
    let magic = u32::from_be_bytes([data[4], data[5], data[6], data[7]]);
    if magic != STUN_MAGIC_COOKIE {
        return Err("Invalid magic cookie".to_string());
    }

    let mut txn = [0u8; 12];
    txn.copy_from_slice(&data[8..20]);
    if txn != *local_txn {
        return Err("Transaction ID mismatch".to_string());
    }

    if msg_type == StunMessageType::BindingErrorResponse as u16 {
        return Err("STUN binding error response".to_string());
    }

    let mut response = StunResponse {
        transaction_id: txn,
        mapped_address: None,
        other_address: None,
        response_origin: None,
        changed_ip: false,
        changed_port: false,
    };

    // Parse attributes
    let attrs_data = &data[20..20 + msg_len.min(data.len() - 20)];
    let mut offset = 0;
    while offset + 4 <= attrs_data.len() {
        let attr_type = u16::from_be_bytes([attrs_data[offset], attrs_data[offset + 1]]);
        let attr_len =
            u16::from_be_bytes([attrs_data[offset + 2], attrs_data[offset + 3]]) as usize;
        let attr_start = offset + 4;
        let attr_end = attr_start + attr_len;

        if attr_end > attrs_data.len() {
            break;
        }

        let attr_data = &attrs_data[attr_start..attr_end];

        match attr_type {
            0x0001 => {
                // MAPPED-ADDRESS
                if let Some(addr) = parse_address(attr_data, false, &txn) {
                    response.mapped_address = Some(addr);
                }
            }
            0x0020 => {
                // XOR-MAPPED-ADDRESS (preferred)
                if let Some(addr) = parse_address(attr_data, true, &txn) {
                    response.mapped_address = Some(addr);
                }
            }
            0x802C => {
                // OTHER-ADDRESS
                if let Some(addr) = parse_address(attr_data, false, &txn) {
                    response.other_address = Some(addr);
                }
            }
            0x802B => {
                // RESPONSE-ORIGIN
                if let Some(addr) = parse_address(attr_data, false, &txn) {
                    response.response_origin = Some(addr);
                }
            }
            0x0005 => {
                // CHANGED-ADDRESS
                if let Some(addr) = parse_address(attr_data, false, &txn) {
                    response.other_address = Some(addr);
                }
            }
            _ => {
                debug!("Unknown STUN attribute 0x{:04X}", attr_type);
            }
        }

        // Attributes are padded to 4-byte boundaries
        offset = attr_end + (4 - (attr_len % 4)) % 4;
    }

    Ok(response)
}

/// Parse a STUN address attribute (MAPPED-ADDRESS or XOR-MAPPED-ADDRESS).
fn parse_address(data: &[u8], xor: bool, txn: &[u8; 12]) -> Option<SocketAddr> {
    if data.len() < 4 {
        return None;
    }

    let family = data[1];
    let port_raw = u16::from_be_bytes([data[2], data[3]]);

    match family {
        0x01 => {
            // IPv4
            if data.len() < 8 {
                return None;
            }
            let port = if xor {
                port_raw ^ (STUN_MAGIC_COOKIE >> 16) as u16
            } else {
                port_raw
            };
            let ip_bytes = if xor {
                let cookie_bytes = STUN_MAGIC_COOKIE.to_be_bytes();
                [
                    data[4] ^ cookie_bytes[0],
                    data[5] ^ cookie_bytes[1],
                    data[6] ^ cookie_bytes[2],
                    data[7] ^ cookie_bytes[3],
                ]
            } else {
                [data[4], data[5], data[6], data[7]]
            };
            let ip = std::net::Ipv4Addr::new(ip_bytes[0], ip_bytes[1], ip_bytes[2], ip_bytes[3]);
            Some(SocketAddr::new(std::net::IpAddr::V4(ip), port))
        }
        0x02 => {
            // IPv6
            if data.len() < 20 {
                return None;
            }
            let port = if xor {
                port_raw ^ (STUN_MAGIC_COOKIE >> 16) as u16
            } else {
                port_raw
            };
            let mut ip_bytes = [0u8; 16];
            ip_bytes.copy_from_slice(&data[4..20]);
            if xor {
                let cookie_bytes = STUN_MAGIC_COOKIE.to_be_bytes();
                for i in 0..4 {
                    ip_bytes[i] ^= cookie_bytes[i];
                }
                for i in 0..12 {
                    ip_bytes[4 + i] ^= txn[i];
                }
            }
            let ip = std::net::Ipv6Addr::from(ip_bytes);
            Some(SocketAddr::new(std::net::IpAddr::V6(ip), port))
        }
        _ => None,
    }
}

/// Perform a single STUN binding request to a server and return the result.
pub fn stun_binding(
    server: &StunServer,
    local_addr: &str,
    timeout: Duration,
) -> Result<StunBinding, String> {
    let txn = generate_transaction_id();
    let request = build_binding_request(&txn);
    let server_addr = format!("{}:{}", server.host, server.port);
    let server_sock_addr: SocketAddr = server_addr
        .parse()
        .map_err(|e| format!("Invalid STUN server address: {e}"))?;
    let start = Instant::now();

    // Use a Tokio runtime for async UDP
    let rt = Runtime::new().map_err(|e| format!("Tokio runtime error: {e}"))?;
    let result = rt.block_on(async {
        let sock = UdpSocket::bind(local_addr)
            .await
            .map_err(|e| format!("UDP bind failed: {e}"))?;
        sock.send_to(&request, server_sock_addr)
            .await
            .map_err(|e| format!("UDP send failed: {e}"))?;

        let mut buf = [0u8; 1500];
        let recv_fut = sock.recv_from(&mut buf);
        let timeout_fut = tokio::time::sleep(timeout);
        tokio::select! {
            res = recv_fut => {
                let (n, _src) = res.map_err(|e| format!("UDP recv failed: {e}"))?;
                let response = parse_stun_response(&buf[..n], &txn)?;
                if let Some(addr) = response.mapped_address {
                    let rtt = start.elapsed();
                    Ok(StunBinding {
                        server: server_addr.clone(),
                        local_addr: local_addr.to_string(),
                        mapped_addr: addr.to_string(),
                        rtt_ms: rtt.as_millis() as u64,
                        changed_ip: response.changed_ip,
                        changed_port: response.changed_port,
                    })
                } else {
                    Err("No mapped address in STUN response".to_string())
                }
            },
            _ = timeout_fut => {
                Err("STUN response timed out".to_string())
            }
        }
    });
    result
}

/// Perform STUN binding requests to multiple servers in parallel
/// and return all results.
pub fn stun_binding_multi(
    servers: &[StunServer],
    timeout: Duration,
) -> Vec<Result<StunBinding, String>> {
    servers
        .iter()
        .map(|server| stun_binding(server, "0.0.0.0:0", timeout))
        .collect()
}

/// Check if two STUN bindings show consistent mapped addresses
/// (same public IP and port, indicating endpoint-independent mapping).
pub fn bindings_consistent(a: &StunBinding, b: &StunBinding) -> bool {
    a.mapped_addr == b.mapped_addr
}

/// Check if two STUN bindings from different destinations show the same
/// mapped IP but different ports (port-dependent mapping).
pub fn bindings_same_ip_different_port(a: &StunBinding, b: &StunBinding) -> bool {
    let a_parts: Vec<&str> = a.mapped_addr.rsplitn(2, ':').collect();
    let b_parts: Vec<&str> = b.mapped_addr.rsplitn(2, ':').collect();

    if a_parts.len() == 2 && b_parts.len() == 2 {
        // Same IP, different port
        a_parts[1] == b_parts[1] && a_parts[0] != b_parts[0]
    } else {
        false
    }
}
