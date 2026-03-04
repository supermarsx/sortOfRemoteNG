//! # SNMP PDU Construction & Parsing
//!
//! Build and parse SNMP protocol data units for v1, v2c, and v3.

use crate::ber;
use crate::error::{SnmpError, SnmpResult};
use crate::types::*;

/// Build a complete SNMPv1 / v2c message (SEQUENCE wrapping version + community + PDU).
pub fn build_v1v2c_message(
    version: SnmpVersion,
    community: &str,
    pdu_type: PduType,
    request_id: i32,
    varbinds: &[(String, SnmpValue)],
) -> SnmpResult<Vec<u8>> {
    let version_num = match version {
        SnmpVersion::V1 => 0i64,
        SnmpVersion::V2c => 1i64,
        _ => return Err(SnmpError::config("Use build_v3_message for SNMPv3")),
    };

    let version_bytes = ber::encode_integer(version_num);
    let community_bytes = ber::encode_octet_string(community.as_bytes());
    let pdu_bytes = build_pdu(pdu_type, request_id, 0, 0, varbinds)?;

    let mut message = vec![];
    message.extend_from_slice(&version_bytes);
    message.extend_from_slice(&community_bytes);
    message.extend_from_slice(&pdu_bytes);

    Ok(ber::encode_sequence(&message))
}

/// Build a GET-BULK PDU (v2c/v3). Uses non-repeaters and max-repetitions instead of error-status/index.
pub fn build_getbulk_message(
    version: SnmpVersion,
    community: &str,
    request_id: i32,
    non_repeaters: i32,
    max_repetitions: i32,
    varbinds: &[(String, SnmpValue)],
) -> SnmpResult<Vec<u8>> {
    let version_num = match version {
        SnmpVersion::V1 => return Err(SnmpError::config("GET-BULK not supported in SNMPv1")),
        SnmpVersion::V2c => 1i64,
        SnmpVersion::V3 => 3i64,
    };

    let version_bytes = ber::encode_integer(version_num);
    let community_bytes = ber::encode_octet_string(community.as_bytes());

    // GET-BULK uses non_repeaters and max_repetitions in place of error-status/index
    let pdu_bytes = build_pdu(
        PduType::GetBulkRequest,
        request_id,
        non_repeaters,
        max_repetitions,
        varbinds,
    )?;

    let mut message = vec![];
    message.extend_from_slice(&version_bytes);
    message.extend_from_slice(&community_bytes);
    message.extend_from_slice(&pdu_bytes);

    Ok(ber::encode_sequence(&message))
}

/// Build a raw PDU (without the outer message wrapper).
pub fn build_pdu(
    pdu_type: PduType,
    request_id: i32,
    error_status_or_non_repeaters: i32,
    error_index_or_max_repetitions: i32,
    varbinds: &[(String, SnmpValue)],
) -> SnmpResult<Vec<u8>> {
    let req_id_bytes = ber::encode_integer(request_id as i64);
    let err_status_bytes = ber::encode_integer(error_status_or_non_repeaters as i64);
    let err_index_bytes = ber::encode_integer(error_index_or_max_repetitions as i64);
    let varbind_list = ber::encode_varbind_list(varbinds)?;

    let mut pdu_contents = vec![];
    pdu_contents.extend_from_slice(&req_id_bytes);
    pdu_contents.extend_from_slice(&err_status_bytes);
    pdu_contents.extend_from_slice(&err_index_bytes);
    pdu_contents.extend_from_slice(&varbind_list);

    Ok(ber::encode_tlv(pdu_type.tag(), &pdu_contents))
}

/// Parse a received SNMPv1/v2c message. Returns (version, community, response).
pub fn parse_v1v2c_message(data: &[u8]) -> SnmpResult<(SnmpVersion, String, SnmpResponse)> {
    // Outer SEQUENCE
    let (tag, seq_bytes, _) = ber::decode_tlv(data)?;
    if tag != ber::TAG_SEQUENCE {
        return Err(SnmpError::encoding("Expected outer SEQUENCE"));
    }

    let mut offset = 0;

    // Version INTEGER
    let (vtag, vbytes, vconsumed) = ber::decode_tlv(&seq_bytes[offset..])?;
    if vtag != ber::TAG_INTEGER {
        return Err(SnmpError::encoding("Expected INTEGER for version"));
    }
    let version_num = ber::decode_integer(vbytes)?;
    let version = match version_num {
        0 => SnmpVersion::V1,
        1 => SnmpVersion::V2c,
        _ => return Err(SnmpError::encoding(format!("Unsupported SNMP version: {}", version_num))),
    };
    offset += vconsumed;

    // Community OCTET STRING
    let (ctag, cbytes, cconsumed) = ber::decode_tlv(&seq_bytes[offset..])?;
    if ctag != ber::TAG_OCTET_STRING {
        return Err(SnmpError::encoding("Expected OCTET STRING for community"));
    }
    let community = String::from_utf8_lossy(cbytes).to_string();
    offset += cconsumed;

    // PDU
    let response = parse_pdu(&seq_bytes[offset..])?;

    Ok((version, community, response))
}

/// Parse a PDU (GetResponse, Trap, etc.).
pub fn parse_pdu(data: &[u8]) -> SnmpResult<SnmpResponse> {
    let (tag, pdu_bytes, _) = ber::decode_tlv(data)?;

    let _pdu_type = PduType::from_tag(tag)
        .ok_or_else(|| SnmpError::encoding(format!("Unknown PDU tag: 0x{:02x}", tag)))?;

    let mut offset = 0;

    // Request ID
    let (_, rid_bytes, rid_consumed) = ber::decode_tlv(&pdu_bytes[offset..])?;
    let request_id = ber::decode_integer(rid_bytes)? as i32;
    offset += rid_consumed;

    // Error status
    let (_, es_bytes, es_consumed) = ber::decode_tlv(&pdu_bytes[offset..])?;
    let error_status_code = ber::decode_integer(es_bytes)? as i32;
    offset += es_consumed;

    // Error index
    let (_, ei_bytes, ei_consumed) = ber::decode_tlv(&pdu_bytes[offset..])?;
    let error_index = ber::decode_integer(ei_bytes)? as u32;
    offset += ei_consumed;

    // VarBindList
    let varbinds = ber::decode_varbind_list(&pdu_bytes[offset..])?;

    Ok(SnmpResponse {
        varbinds,
        error_status: SnmpErrorStatus::from_code(error_status_code),
        error_index,
        request_id,
        rtt_ms: 0, // Caller fills this in
    })
}

/// Build a list of null-valued varbinds for GET / GET-NEXT requests.
pub fn null_varbinds(oids: &[String]) -> Vec<(String, SnmpValue)> {
    oids.iter().map(|oid| (oid.clone(), SnmpValue::Null)).collect()
}

/// Generate a random request ID.
pub fn random_request_id() -> i32 {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    rng.gen_range(1..i32::MAX)
}
