//! Field Replaceable Unit (FRU) inventory operations — FRU area reading,
//! parsing (Internal, Chassis, Board, Product, MultiRecord), 6-bit packed
//! ASCII decoding, BCD+ decoding, type/length field parsing, FRU write support.

use crate::error::{IpmiError, IpmiResult};
use crate::protocol::{cmd, IpmiRequest};
use crate::session::IpmiSessionHandle;
use crate::types::*;
use chrono::{Duration, NaiveDate, TimeZone, Utc};
use log::{debug, warn};

/// Maximum FRU read chunk size (bytes per read).
const FRU_READ_CHUNK: u8 = 20;

/// Byte value signaling end of FRU area fields.
const END_OF_FIELDS: u8 = 0xC1;

// ═══════════════════════════════════════════════════════════════════════
// FRU Inventory Info
// ═══════════════════════════════════════════════════════════════════════

/// Get FRU inventory area size.
pub fn get_fru_inventory_info(
    session: &mut IpmiSessionHandle,
    device_id: u8,
) -> IpmiResult<FruInventoryInfo> {
    let req = IpmiRequest::new(
        NetFunction::Storage.as_byte(),
        cmd::GET_FRU_INVENTORY_AREA,
        vec![device_id],
    );
    let resp = session.send_request(req)?;
    resp.check()?;

    if resp.data.len() < 3 {
        return Err(IpmiError::FruParseError(
            "FRU inventory info response too short".into(),
        ));
    }

    Ok(FruInventoryInfo {
        area_size: u16::from_le_bytes([resp.data[0], resp.data[1]]),
        access_by_words: (resp.data[2] & 0x01) != 0,
    })
}

// ═══════════════════════════════════════════════════════════════════════
// FRU Data Read / Write
// ═══════════════════════════════════════════════════════════════════════

/// Read raw FRU data.
pub fn read_fru_data(
    session: &mut IpmiSessionHandle,
    device_id: u8,
    offset: u16,
    count: u8,
) -> IpmiResult<Vec<u8>> {
    let mut req_data = vec![device_id];
    req_data.extend_from_slice(&offset.to_le_bytes());
    req_data.push(count);

    let req = IpmiRequest::new(NetFunction::Storage.as_byte(), cmd::READ_FRU_DATA, req_data);
    let resp = session.send_request(req)?;
    resp.check()?;

    if resp.data.is_empty() {
        return Err(IpmiError::FruParseError("Empty FRU data response".into()));
    }

    let bytes_returned = resp.data[0] as usize;
    if resp.data.len() < 1 + bytes_returned {
        return Err(IpmiError::FruParseError(
            "FRU data response length mismatch".into(),
        ));
    }

    Ok(resp.data[1..1 + bytes_returned].to_vec())
}

/// Read the entire FRU inventory data for a device.
fn read_full_fru(
    session: &mut IpmiSessionHandle,
    device_id: u8,
    total_size: u16,
) -> IpmiResult<Vec<u8>> {
    let mut buffer = Vec::with_capacity(total_size as usize);
    let mut offset: u16 = 0;

    while offset < total_size {
        let remaining = (total_size - offset) as u8;
        let chunk_size = remaining.min(FRU_READ_CHUNK);
        let chunk = read_fru_data(session, device_id, offset, chunk_size)?;
        if chunk.is_empty() {
            break;
        }
        buffer.extend_from_slice(&chunk);
        offset += chunk.len() as u16;
    }

    Ok(buffer)
}

/// Write FRU data at a given offset.
pub fn write_fru_data(
    session: &mut IpmiSessionHandle,
    device_id: u8,
    offset: u16,
    data: &[u8],
) -> IpmiResult<u8> {
    let mut req_data = vec![device_id];
    req_data.extend_from_slice(&offset.to_le_bytes());
    req_data.extend_from_slice(data);

    let req = IpmiRequest::new(
        NetFunction::Storage.as_byte(),
        cmd::WRITE_FRU_DATA,
        req_data,
    );
    let resp = session.send_request(req)?;
    resp.check()?;

    if resp.data.is_empty() {
        return Err(IpmiError::FruParseError(
            "Write FRU response missing count".into(),
        ));
    }

    Ok(resp.data[0])
}

// ═══════════════════════════════════════════════════════════════════════
// Complete FRU Info Retrieval
// ═══════════════════════════════════════════════════════════════════════

/// Read and parse complete FRU device info.
pub fn get_fru_info(session: &mut IpmiSessionHandle, device_id: u8) -> IpmiResult<FruDeviceInfo> {
    let inv_info = get_fru_inventory_info(session, device_id)?;
    debug!(
        "FRU device {}: {} bytes, access_by_words={}",
        device_id, inv_info.area_size, inv_info.access_by_words
    );

    let raw = read_full_fru(session, device_id, inv_info.area_size)?;
    parse_fru_data(device_id, &raw)
}

// ═══════════════════════════════════════════════════════════════════════
// FRU Data Parsing
// ═══════════════════════════════════════════════════════════════════════

/// Parse raw FRU inventory data into structured info.
pub fn parse_fru_data(device_id: u8, data: &[u8]) -> IpmiResult<FruDeviceInfo> {
    if data.len() < 8 {
        return Err(IpmiError::FruParseError(
            "FRU data too short for common header".into(),
        ));
    }

    // Common Header (8 bytes)
    let format_version = data[0];
    if format_version != 0x01 {
        warn!("Unexpected FRU format version: 0x{:02X}", format_version);
    }

    let internal_use_offset = data[1] as usize * 8;
    let chassis_info_offset = data[2] as usize * 8;
    let board_info_offset = data[3] as usize * 8;
    let product_info_offset = data[4] as usize * 8;
    let multi_record_offset = data[5] as usize * 8;

    // Verify header checksum
    let header_sum: u8 = data[..8].iter().fold(0u8, |acc, &b| acc.wrapping_add(b));
    if header_sum != 0 {
        warn!("FRU common header checksum mismatch");
    }

    // Internal use area
    let internal_use_data = if internal_use_offset > 0 && internal_use_offset < data.len() {
        // Internal use area: version byte + data until next area
        let end = find_next_area_offset(
            chassis_info_offset,
            board_info_offset,
            product_info_offset,
            multi_record_offset,
            internal_use_offset,
            data.len(),
        );
        data[internal_use_offset..end].to_vec()
    } else {
        Vec::new()
    };

    // Chassis info
    let chassis = if chassis_info_offset > 0 && chassis_info_offset < data.len() {
        match parse_chassis_info(&data[chassis_info_offset..]) {
            Ok(c) => Some(c),
            Err(e) => {
                warn!("Failed to parse chassis info: {}", e);
                None
            }
        }
    } else {
        None
    };

    // Board info
    let board = if board_info_offset > 0 && board_info_offset < data.len() {
        match parse_board_info(&data[board_info_offset..]) {
            Ok(b) => Some(b),
            Err(e) => {
                warn!("Failed to parse board info: {}", e);
                None
            }
        }
    } else {
        None
    };

    // Product info
    let product = if product_info_offset > 0 && product_info_offset < data.len() {
        match parse_product_info(&data[product_info_offset..]) {
            Ok(p) => Some(p),
            Err(e) => {
                warn!("Failed to parse product info: {}", e);
                None
            }
        }
    } else {
        None
    };

    // Multi-record area
    let multi_records = if multi_record_offset > 0 && multi_record_offset < data.len() {
        parse_multi_records(&data[multi_record_offset..])
    } else {
        Vec::new()
    };

    Ok(FruDeviceInfo {
        device_id,
        chassis,
        board,
        product,
        multi_records,
        internal_use_data,
    })
}

/// Find the offset of the next area for boundary calculation.
fn find_next_area_offset(
    chassis: usize,
    board: usize,
    product: usize,
    multi: usize,
    current: usize,
    data_len: usize,
) -> usize {
    [chassis, board, product, multi]
        .iter()
        .filter(|&&o| o > current)
        .min()
        .copied()
        .unwrap_or(data_len)
}

// ═══════════════════════════════════════════════════════════════════════
// Area Parsers
// ═══════════════════════════════════════════════════════════════════════

/// Parse Chassis Info Area.
fn parse_chassis_info(data: &[u8]) -> IpmiResult<FruChassisInfo> {
    if data.len() < 4 {
        return Err(IpmiError::FruParseError("Chassis area too short".into()));
    }

    let _format_version = data[0];
    let area_length = data[1] as usize * 8;
    let chassis_type = data[2];
    let chassis_type_name = chassis_type_name(chassis_type);

    let mut offset = 3;
    let (part_number, consumed) = parse_type_length_field(data, offset)?;
    offset += consumed;

    let (serial_number, consumed) = parse_type_length_field(data, offset)?;
    offset += consumed;

    // Custom fields
    let mut custom_fields = Vec::new();
    let mut field_idx = 0;
    while offset < data.len().min(area_length) {
        if data[offset] == END_OF_FIELDS {
            break;
        }
        let (value, consumed) = parse_type_length_field(data, offset)?;
        offset += consumed;
        custom_fields.push(FruField {
            name: format!("custom_{}", field_idx),
            value,
        });
        field_idx += 1;
    }

    Ok(FruChassisInfo {
        chassis_type,
        chassis_type_name,
        part_number,
        serial_number,
        custom_fields,
    })
}

/// Parse Board Info Area.
fn parse_board_info(data: &[u8]) -> IpmiResult<FruBoardInfo> {
    if data.len() < 6 {
        return Err(IpmiError::FruParseError("Board area too short".into()));
    }

    let _format_version = data[0];
    let _area_length = data[1] as usize * 8;
    let language_code = data[2];

    // Manufacturing date — minutes since 1996-01-01 00:00:00
    let mfg_minutes = u32::from_le_bytes([data[3], data[4], data[5], 0]);
    let manufacture_date = if mfg_minutes == 0 {
        None
    } else {
        let base = NaiveDate::from_ymd_opt(1996, 1, 1)
            .unwrap()
            .and_hms_opt(0, 0, 0)
            .unwrap();
        let dt = base + Duration::minutes(mfg_minutes as i64);
        Some(Utc.from_utc_datetime(&dt))
    };

    let mut offset = 6;

    let (manufacturer, consumed) = parse_type_length_field(data, offset)?;
    offset += consumed;

    let (product_name, consumed) = parse_type_length_field(data, offset)?;
    offset += consumed;

    let (serial_number, consumed) = parse_type_length_field(data, offset)?;
    offset += consumed;

    let (part_number, consumed) = parse_type_length_field(data, offset)?;
    offset += consumed;

    let (fru_file_id, consumed) = parse_type_length_field(data, offset)?;
    offset += consumed;

    let mut custom_fields = Vec::new();
    let mut field_idx = 0;
    while offset < data.len() {
        if data[offset] == END_OF_FIELDS {
            break;
        }
        let (value, consumed) = parse_type_length_field(data, offset)?;
        offset += consumed;
        custom_fields.push(FruField {
            name: format!("custom_{}", field_idx),
            value,
        });
        field_idx += 1;
    }

    Ok(FruBoardInfo {
        language_code,
        manufacture_date,
        manufacturer,
        product_name,
        serial_number,
        part_number,
        fru_file_id,
        custom_fields,
    })
}

/// Parse Product Info Area.
fn parse_product_info(data: &[u8]) -> IpmiResult<FruProductInfo> {
    if data.len() < 4 {
        return Err(IpmiError::FruParseError("Product area too short".into()));
    }

    let _format_version = data[0];
    let _area_length = data[1] as usize * 8;
    let language_code = data[2];

    let mut offset = 3;

    let (manufacturer, consumed) = parse_type_length_field(data, offset)?;
    offset += consumed;

    let (product_name, consumed) = parse_type_length_field(data, offset)?;
    offset += consumed;

    let (part_number, consumed) = parse_type_length_field(data, offset)?;
    offset += consumed;

    let (version, consumed) = parse_type_length_field(data, offset)?;
    offset += consumed;

    let (serial_number, consumed) = parse_type_length_field(data, offset)?;
    offset += consumed;

    let (asset_tag, consumed) = parse_type_length_field(data, offset)?;
    offset += consumed;

    let (fru_file_id, consumed) = parse_type_length_field(data, offset)?;
    offset += consumed;

    let mut custom_fields = Vec::new();
    let mut field_idx = 0;
    while offset < data.len() {
        if data[offset] == END_OF_FIELDS {
            break;
        }
        let (value, consumed) = parse_type_length_field(data, offset)?;
        offset += consumed;
        custom_fields.push(FruField {
            name: format!("custom_{}", field_idx),
            value,
        });
        field_idx += 1;
    }

    Ok(FruProductInfo {
        language_code,
        manufacturer,
        product_name,
        part_number,
        version,
        serial_number,
        asset_tag,
        fru_file_id,
        custom_fields,
    })
}

/// Parse Multi-Record area.
fn parse_multi_records(data: &[u8]) -> Vec<FruMultiRecord> {
    let mut records = Vec::new();
    let mut offset = 0;

    while offset + 5 <= data.len() {
        let record_type_id = data[offset];
        let format_flags = data[offset + 1];
        let end_of_list = (format_flags & 0x80) != 0;
        let record_length = data[offset + 2] as usize;
        // bytes [3] = record checksum, [4] = header checksum
        let data_start = offset + 5;
        let data_end = (data_start + record_length).min(data.len());

        records.push(FruMultiRecord {
            record_type_id,
            end_of_list,
            data: data[data_start..data_end].to_vec(),
        });

        if end_of_list {
            break;
        }
        offset = data_end;
    }

    records
}

// ═══════════════════════════════════════════════════════════════════════
// Type/Length Field Parsing
// ═══════════════════════════════════════════════════════════════════════

/// Parse a type/length field from FRU data.
///
/// Returns `(decoded_string, bytes_consumed)`.
fn parse_type_length_field(data: &[u8], offset: usize) -> IpmiResult<(String, usize)> {
    if offset >= data.len() {
        return Ok((String::new(), 0));
    }

    let type_length = data[offset];
    if type_length == END_OF_FIELDS || type_length == 0x00 {
        return Ok((String::new(), 1));
    }

    let field_type = (type_length >> 6) & 0x03;
    let field_len = (type_length & 0x3F) as usize;

    if offset + 1 + field_len > data.len() {
        return Err(IpmiError::FruParseError(format!(
            "FRU field at offset {} overflows buffer (type=0x{:02X}, len={})",
            offset, type_length, field_len
        )));
    }

    let field_data = &data[offset + 1..offset + 1 + field_len];

    let value = match field_type {
        0x00 => {
            // Binary/unspecified — hex dump
            field_data
                .iter()
                .map(|b| format!("{:02X}", b))
                .collect::<Vec<_>>()
                .join(" ")
        }
        0x01 => {
            // BCD+
            decode_bcd_plus_field(field_data)
        }
        0x02 => {
            // 6-bit packed ASCII
            decode_6bit_packed_ascii(field_data)
        }
        0x03 => {
            // 8-bit ASCII / Latin-1
            String::from_utf8_lossy(field_data).trim().to_string()
        }
        _ => String::new(),
    };

    Ok((value, 1 + field_len))
}

/// Decode BCD+ field data.
fn decode_bcd_plus_field(data: &[u8]) -> String {
    const BCD_PLUS_CHARS: &[u8; 16] = b"0123456789 -.:,_";
    let mut result = String::with_capacity(data.len() * 2);
    for &byte in data {
        let hi = ((byte >> 4) & 0x0F) as usize;
        let lo = (byte & 0x0F) as usize;
        if hi < BCD_PLUS_CHARS.len() {
            result.push(BCD_PLUS_CHARS[hi] as char);
        }
        if lo < BCD_PLUS_CHARS.len() {
            result.push(BCD_PLUS_CHARS[lo] as char);
        }
    }
    result.trim().to_string()
}

/// Decode 6-bit packed ASCII field data.
fn decode_6bit_packed_ascii(data: &[u8]) -> String {
    let mut bits: u64 = 0;
    let mut bit_count = 0;
    let mut result = String::new();

    for &byte in data {
        bits |= (byte as u64) << bit_count;
        bit_count += 8;

        while bit_count >= 6 {
            let ch = ((bits & 0x3F) as u8).wrapping_add(0x20);
            result.push(ch as char);
            bits >>= 6;
            bit_count -= 6;
        }
    }

    result.trim().to_string()
}

// ═══════════════════════════════════════════════════════════════════════
// Chassis Type Names
// ═══════════════════════════════════════════════════════════════════════

/// Get the human-readable name for a chassis type byte.
fn chassis_type_name(t: u8) -> String {
    match t {
        0x01 => "Other".into(),
        0x02 => "Unknown".into(),
        0x03 => "Desktop".into(),
        0x04 => "Low Profile Desktop".into(),
        0x05 => "Pizza Box".into(),
        0x06 => "Mini Tower".into(),
        0x07 => "Tower".into(),
        0x08 => "Portable".into(),
        0x09 => "Laptop".into(),
        0x0A => "Notebook".into(),
        0x0B => "Hand Held".into(),
        0x0C => "Docking Station".into(),
        0x0D => "All in One".into(),
        0x0E => "Sub Notebook".into(),
        0x0F => "Space-saving".into(),
        0x10 => "Lunch Box".into(),
        0x11 => "Main Server Chassis".into(),
        0x12 => "Expansion Chassis".into(),
        0x13 => "SubChassis".into(),
        0x14 => "Bus Expansion Chassis".into(),
        0x15 => "Peripheral Chassis".into(),
        0x16 => "RAID Chassis".into(),
        0x17 => "Rack Mount Chassis".into(),
        0x18 => "Sealed-case PC".into(),
        0x19 => "Multi-system Chassis".into(),
        0x1A => "Compact PCI".into(),
        0x1B => "Advanced TCA".into(),
        0x1C => "Blade".into(),
        0x1D => "Blade Enclosure".into(),
        0x1E => "Tablet".into(),
        0x1F => "Convertible".into(),
        0x20 => "Detachable".into(),
        _ => format!("Type 0x{:02X}", t),
    }
}
