//! # BER (Basic Encoding Rules) Codec
//!
//! Encode and decode ASN.1 BER primitives used by the SNMP protocol.
//! This module handles the TLV (Tag-Length-Value) encoding for SNMP PDUs.

use crate::error::{SnmpError, SnmpResult};
use crate::oid::Oid;
use crate::types::{SnmpValue, VarBind};

// ── Tag constants ───────────────────────────────────────────────────

pub const TAG_INTEGER: u8 = 0x02;
pub const TAG_OCTET_STRING: u8 = 0x04;
pub const TAG_NULL: u8 = 0x05;
pub const TAG_OID: u8 = 0x06;
pub const TAG_SEQUENCE: u8 = 0x30;
pub const TAG_IP_ADDRESS: u8 = 0x40;
pub const TAG_COUNTER32: u8 = 0x41;
pub const TAG_GAUGE32: u8 = 0x42;
pub const TAG_TIMETICKS: u8 = 0x43;
pub const TAG_OPAQUE: u8 = 0x44;
pub const TAG_COUNTER64: u8 = 0x46;
pub const TAG_NO_SUCH_OBJECT: u8 = 0x80;
pub const TAG_NO_SUCH_INSTANCE: u8 = 0x81;
pub const TAG_END_OF_MIB_VIEW: u8 = 0x82;

// ── Length encoding ─────────────────────────────────────────────────

/// Encode a BER length field.
pub fn encode_length(len: usize) -> Vec<u8> {
    if len < 0x80 {
        vec![len as u8]
    } else if len <= 0xFF {
        vec![0x81, len as u8]
    } else if len <= 0xFFFF {
        vec![0x82, (len >> 8) as u8, len as u8]
    } else if len <= 0xFF_FFFF {
        vec![0x83, (len >> 16) as u8, (len >> 8) as u8, len as u8]
    } else {
        vec![0x84, (len >> 24) as u8, (len >> 16) as u8, (len >> 8) as u8, len as u8]
    }
}

/// Decode a BER length field. Returns (length, bytes consumed).
pub fn decode_length(data: &[u8]) -> SnmpResult<(usize, usize)> {
    if data.is_empty() {
        return Err(SnmpError::encoding("Empty length field"));
    }
    let first = data[0];
    if first < 0x80 {
        Ok((first as usize, 1))
    } else {
        let num_bytes = (first & 0x7F) as usize;
        if num_bytes == 0 || num_bytes > 4 {
            return Err(SnmpError::encoding(format!("Invalid length byte count: {}", num_bytes)));
        }
        if data.len() < 1 + num_bytes {
            return Err(SnmpError::encoding("Truncated length field"));
        }
        let mut len: usize = 0;
        for i in 0..num_bytes {
            len = (len << 8) | data[1 + i] as usize;
        }
        Ok((len, 1 + num_bytes))
    }
}

// ── TLV wrappers ────────────────────────────────────────────────────

/// Wrap value bytes in a TLV (Tag-Length-Value) encoding.
pub fn encode_tlv(tag: u8, value: &[u8]) -> Vec<u8> {
    let mut result = vec![tag];
    result.extend_from_slice(&encode_length(value.len()));
    result.extend_from_slice(value);
    result
}

/// Decode a TLV. Returns (tag, value_bytes, total_bytes_consumed).
pub fn decode_tlv(data: &[u8]) -> SnmpResult<(u8, &[u8], usize)> {
    if data.is_empty() {
        return Err(SnmpError::encoding("Empty TLV data"));
    }
    let tag = data[0];
    let (len, len_bytes) = decode_length(&data[1..])?;
    let header_len = 1 + len_bytes;
    if data.len() < header_len + len {
        return Err(SnmpError::encoding(format!(
            "TLV truncated: need {} bytes, have {}",
            header_len + len,
            data.len()
        )));
    }
    Ok((tag, &data[header_len..header_len + len], header_len + len))
}

// ── Primitive encoders ──────────────────────────────────────────────

/// Encode a signed integer.
pub fn encode_integer(value: i64) -> Vec<u8> {
    let mut bytes = vec![];
    let mut v = value;
    loop {
        bytes.push((v & 0xFF) as u8);
        v >>= 8;
        if (v == 0 && bytes.last().unwrap() & 0x80 == 0)
            || (v == -1 && bytes.last().unwrap() & 0x80 != 0)
        {
            break;
        }
    }
    bytes.reverse();
    encode_tlv(TAG_INTEGER, &bytes)
}

/// Decode a signed integer from TLV bytes.
pub fn decode_integer(value_bytes: &[u8]) -> SnmpResult<i64> {
    if value_bytes.is_empty() {
        return Err(SnmpError::encoding("Empty integer value"));
    }
    let mut result: i64 = if value_bytes[0] & 0x80 != 0 { -1 } else { 0 };
    for &b in value_bytes {
        result = (result << 8) | b as i64;
    }
    Ok(result)
}

/// Encode an unsigned 32-bit value with a given tag.
pub fn encode_unsigned32(tag: u8, value: u32) -> Vec<u8> {
    let bytes = value.to_be_bytes();
    // Strip leading zeros but keep at least one byte
    let start = bytes.iter().position(|&b| b != 0).unwrap_or(3);
    // If high bit is set, prepend a zero byte to keep it positive
    let needs_padding = bytes[start] & 0x80 != 0;
    let mut val = vec![];
    if needs_padding {
        val.push(0);
    }
    val.extend_from_slice(&bytes[start..]);
    encode_tlv(tag, &val)
}

/// Decode an unsigned 32-bit value.
pub fn decode_unsigned32(value_bytes: &[u8]) -> SnmpResult<u32> {
    if value_bytes.is_empty() || value_bytes.len() > 5 {
        return Err(SnmpError::encoding("Invalid unsigned32 length"));
    }
    let mut result: u32 = 0;
    for &b in value_bytes {
        result = result.checked_shl(8)
            .ok_or_else(|| SnmpError::encoding("Unsigned32 overflow"))?
            | b as u32;
    }
    Ok(result)
}

/// Encode a Counter64 (unsigned 64-bit).
pub fn encode_counter64(value: u64) -> Vec<u8> {
    let bytes = value.to_be_bytes();
    let start = bytes.iter().position(|&b| b != 0).unwrap_or(7);
    let needs_padding = bytes[start] & 0x80 != 0;
    let mut val = vec![];
    if needs_padding {
        val.push(0);
    }
    val.extend_from_slice(&bytes[start..]);
    encode_tlv(TAG_COUNTER64, &val)
}

/// Decode a Counter64.
pub fn decode_counter64(value_bytes: &[u8]) -> SnmpResult<u64> {
    if value_bytes.is_empty() || value_bytes.len() > 9 {
        return Err(SnmpError::encoding("Invalid counter64 length"));
    }
    let mut result: u64 = 0;
    for &b in value_bytes {
        result = result.checked_shl(8)
            .ok_or_else(|| SnmpError::encoding("Counter64 overflow"))?
            | b as u64;
    }
    Ok(result)
}

/// Encode an OCTET STRING.
pub fn encode_octet_string(value: &[u8]) -> Vec<u8> {
    encode_tlv(TAG_OCTET_STRING, value)
}

/// Encode a NULL value.
pub fn encode_null() -> Vec<u8> {
    vec![TAG_NULL, 0x00]
}

/// Encode an OID.
pub fn encode_oid(oid: &Oid) -> Vec<u8> {
    encode_tlv(TAG_OID, &oid.encode_value())
}

/// Encode an IpAddress (4 bytes).
pub fn encode_ip_address(ip: &str) -> SnmpResult<Vec<u8>> {
    let parts: Vec<u8> = ip.split('.')
        .map(|p| p.parse::<u8>().map_err(|_| SnmpError::encoding(format!("Invalid IP octet: {}", p))))
        .collect::<Result<Vec<_>, _>>()?;
    if parts.len() != 4 {
        return Err(SnmpError::encoding(format!("IpAddress must have 4 octets, got {}", parts.len())));
    }
    Ok(encode_tlv(TAG_IP_ADDRESS, &parts))
}

/// Encode an SNMP SEQUENCE.
pub fn encode_sequence(contents: &[u8]) -> Vec<u8> {
    encode_tlv(TAG_SEQUENCE, contents)
}

// ── Value encoder / decoder ─────────────────────────────────────────

/// Encode an SnmpValue into BER bytes.
pub fn encode_value(value: &SnmpValue) -> SnmpResult<Vec<u8>> {
    match value {
        SnmpValue::Integer(v) => Ok(encode_integer(*v)),
        SnmpValue::OctetString(s) => Ok(encode_octet_string(s.as_bytes())),
        SnmpValue::ObjectIdentifier(oid_str) => {
            let oid = Oid::parse(oid_str)?;
            Ok(encode_oid(&oid))
        }
        SnmpValue::IpAddress(ip) => encode_ip_address(ip),
        SnmpValue::Counter32(v) => Ok(encode_unsigned32(TAG_COUNTER32, *v)),
        SnmpValue::Gauge32(v) => Ok(encode_unsigned32(TAG_GAUGE32, *v)),
        SnmpValue::TimeTicks(v) => Ok(encode_unsigned32(TAG_TIMETICKS, *v)),
        SnmpValue::Counter64(v) => Ok(encode_counter64(*v)),
        SnmpValue::Opaque(bytes) => Ok(encode_tlv(TAG_OPAQUE, bytes)),
        SnmpValue::Null => Ok(encode_null()),
        SnmpValue::NoSuchObject => Ok(vec![TAG_NO_SUCH_OBJECT, 0x00]),
        SnmpValue::NoSuchInstance => Ok(vec![TAG_NO_SUCH_INSTANCE, 0x00]),
        SnmpValue::EndOfMibView => Ok(vec![TAG_END_OF_MIB_VIEW, 0x00]),
    }
}

/// Decode an SnmpValue from a TLV's tag and value bytes.
pub fn decode_value(tag: u8, value_bytes: &[u8]) -> SnmpResult<SnmpValue> {
    match tag {
        TAG_INTEGER => Ok(SnmpValue::Integer(decode_integer(value_bytes)?)),
        TAG_OCTET_STRING => {
            // Try UTF-8, fall back to hex if not valid text
            match std::str::from_utf8(value_bytes) {
                Ok(s) => Ok(SnmpValue::OctetString(s.to_string())),
                Err(_) => {
                    let hex: String = value_bytes.iter().map(|b| format!("{:02x}", b)).collect();
                    Ok(SnmpValue::OctetString(hex))
                }
            }
        }
        TAG_OID => {
            let oid = Oid::decode_value(value_bytes)?;
            Ok(SnmpValue::ObjectIdentifier(oid.to_dotted()))
        }
        TAG_NULL => Ok(SnmpValue::Null),
        TAG_IP_ADDRESS => {
            if value_bytes.len() == 4 {
                Ok(SnmpValue::IpAddress(format!(
                    "{}.{}.{}.{}",
                    value_bytes[0], value_bytes[1], value_bytes[2], value_bytes[3]
                )))
            } else {
                Err(SnmpError::encoding("IpAddress must be 4 bytes"))
            }
        }
        TAG_COUNTER32 => Ok(SnmpValue::Counter32(decode_unsigned32(value_bytes)?)),
        TAG_GAUGE32 => Ok(SnmpValue::Gauge32(decode_unsigned32(value_bytes)?)),
        TAG_TIMETICKS => Ok(SnmpValue::TimeTicks(decode_unsigned32(value_bytes)?)),
        TAG_OPAQUE => Ok(SnmpValue::Opaque(value_bytes.to_vec())),
        TAG_COUNTER64 => Ok(SnmpValue::Counter64(decode_counter64(value_bytes)?)),
        TAG_NO_SUCH_OBJECT => Ok(SnmpValue::NoSuchObject),
        TAG_NO_SUCH_INSTANCE => Ok(SnmpValue::NoSuchInstance),
        TAG_END_OF_MIB_VIEW => Ok(SnmpValue::EndOfMibView),
        _ => Err(SnmpError::encoding(format!("Unknown BER tag: 0x{:02x}", tag))),
    }
}

// ── VarBind list encoding ───────────────────────────────────────────

/// Encode a list of (oid, value) pairs as a VarBindList SEQUENCE.
pub fn encode_varbind_list(varbinds: &[(String, SnmpValue)]) -> SnmpResult<Vec<u8>> {
    let mut contents = vec![];
    for (oid_str, value) in varbinds {
        let oid = Oid::parse(oid_str)?;
        let oid_bytes = encode_oid(&oid);
        let val_bytes = encode_value(value)?;
        let mut varbind = vec![];
        varbind.extend_from_slice(&oid_bytes);
        varbind.extend_from_slice(&val_bytes);
        contents.extend_from_slice(&encode_sequence(&varbind));
    }
    Ok(encode_sequence(&contents))
}

/// Decode a VarBindList SEQUENCE into a vec of VarBind.
pub fn decode_varbind_list(data: &[u8]) -> SnmpResult<Vec<VarBind>> {
    let (tag, seq_bytes, _) = decode_tlv(data)?;
    if tag != TAG_SEQUENCE {
        return Err(SnmpError::encoding(format!("Expected SEQUENCE tag 0x30, got 0x{:02x}", tag)));
    }

    let mut varbinds = vec![];
    let mut offset = 0;
    while offset < seq_bytes.len() {
        let (vb_tag, vb_bytes, vb_consumed) = decode_tlv(&seq_bytes[offset..])?;
        if vb_tag != TAG_SEQUENCE {
            return Err(SnmpError::encoding("VarBind must be a SEQUENCE"));
        }

        // Decode OID
        let (oid_tag, oid_value, oid_consumed) = decode_tlv(vb_bytes)?;
        if oid_tag != TAG_OID {
            return Err(SnmpError::encoding("Expected OID in VarBind"));
        }
        let oid = Oid::decode_value(oid_value)?;

        // Decode value
        let (val_tag, val_bytes, _) = decode_tlv(&vb_bytes[oid_consumed..])?;
        let value = decode_value(val_tag, val_bytes)?;

        varbinds.push(VarBind {
            oid: oid.to_dotted(),
            value,
            name: None,
        });

        offset += vb_consumed;
    }

    Ok(varbinds)
}
