//! Sensor Data Record (SDR) repository and sensor reading operations —
//! SDR repository access, record parsing (Type 01 Full, Type 02 Compact,
//! Type 11 FRU Locator, Type 12 MC Locator), sensor reading, linearization,
//! threshold retrieval, and event enable configuration.

use crate::error::{IpmiError, IpmiResult};
use crate::protocol::{cmd, IpmiRequest};
use crate::session::IpmiSessionHandle;
use crate::types::*;
use log::{debug, warn};

/// Maximum bytes per SDR partial read.
const SDR_READ_CHUNK: u8 = 20;

// ═══════════════════════════════════════════════════════════════════════
// SDR Repository Info
// ═══════════════════════════════════════════════════════════════════════

/// Get SDR repository info.
pub fn get_sdr_repo_info(session: &mut IpmiSessionHandle) -> IpmiResult<SdrRepositoryInfo> {
    let req = IpmiRequest::new(
        NetFunction::Storage.as_byte(),
        cmd::GET_SDR_REPO_INFO,
        vec![],
    );
    let resp = session.send_request(req)?;
    resp.check()?;

    if resp.data.len() < 14 {
        return Err(IpmiError::SdrParseError(
            "SDR repo info response too short".into(),
        ));
    }

    Ok(SdrRepositoryInfo {
        sdr_version: resp.data[0],
        record_count: u16::from_le_bytes([resp.data[1], resp.data[2]]),
        free_space: u16::from_le_bytes([resp.data[3], resp.data[4]]),
        most_recent_addition: u32::from_le_bytes([
            resp.data[5],
            resp.data[6],
            resp.data[7],
            resp.data[8],
        ]),
        most_recent_erase: u32::from_le_bytes([
            resp.data[9],
            resp.data[10],
            resp.data[11],
            resp.data[12],
        ]),
        overflow: (resp.data[13] & 0x80) != 0,
        supported_ops: resp.data[13] & 0x0F,
    })
}

/// Reserve the SDR repository (needed before reading records).
pub fn reserve_sdr_repo(session: &mut IpmiSessionHandle) -> IpmiResult<u16> {
    let req = IpmiRequest::new(
        NetFunction::Storage.as_byte(),
        cmd::RESERVE_SDR_REPO,
        vec![],
    );
    let resp = session.send_request(req)?;
    resp.check()?;

    if resp.data.len() < 2 {
        return Err(IpmiError::SdrParseError(
            "Reserve SDR response too short".into(),
        ));
    }

    Ok(u16::from_le_bytes([resp.data[0], resp.data[1]]))
}

// ═══════════════════════════════════════════════════════════════════════
// SDR Record Reading
// ═══════════════════════════════════════════════════════════════════════

/// Read a single SDR record by record ID.
pub fn get_sdr_record(
    session: &mut IpmiSessionHandle,
    reservation_id: u16,
    record_id: u16,
) -> IpmiResult<(SdrRecord, u16)> {
    // Read the 5-byte header first
    let header_data = read_sdr_partial(session, reservation_id, record_id, 0, 5)?;
    if header_data.len() < 7 {
        // 2 bytes next_record_id + 5 bytes header
        return Err(IpmiError::SdrParseError(
            "SDR partial read returned insufficient data".into(),
        ));
    }

    let next_record_id = u16::from_le_bytes([header_data[0], header_data[1]]);
    let header = parse_sdr_header(&header_data[2..])?;
    let body_length = header.record_length as usize;

    // Now read the full record body
    let mut body = Vec::with_capacity(body_length);
    let mut offset: u8 = 5;
    while body.len() < body_length {
        let remaining = (body_length - body.len()) as u8;
        let chunk_size = remaining.min(SDR_READ_CHUNK);
        let chunk = read_sdr_partial(session, reservation_id, record_id, offset, chunk_size)?;
        if chunk.len() < 2 {
            break;
        }
        body.extend_from_slice(&chunk[2..]); // skip next_record_id
        offset += chunk_size;
    }

    let record = parse_sdr_record(header, &body)?;
    Ok((record, next_record_id))
}

/// Read a partial SDR record.
fn read_sdr_partial(
    session: &mut IpmiSessionHandle,
    reservation_id: u16,
    record_id: u16,
    offset: u8,
    bytes_to_read: u8,
) -> IpmiResult<Vec<u8>> {
    let mut data = Vec::with_capacity(6);
    data.extend_from_slice(&reservation_id.to_le_bytes());
    data.extend_from_slice(&record_id.to_le_bytes());
    data.push(offset);
    data.push(bytes_to_read);

    let req = IpmiRequest::new(NetFunction::Storage.as_byte(), cmd::GET_SDR, data);
    let resp = session.send_request(req)?;
    resp.check()?;
    Ok(resp.data)
}

/// Read all SDR records from the repository.
pub fn get_all_sdr_records(session: &mut IpmiSessionHandle) -> IpmiResult<Vec<SdrRecord>> {
    let info = get_sdr_repo_info(session)?;
    debug!(
        "SDR repository: {} records, {} bytes free",
        info.record_count, info.free_space
    );

    let reservation_id = reserve_sdr_repo(session)?;
    let mut records = Vec::with_capacity(info.record_count as usize);
    let mut record_id: u16 = 0x0000;

    loop {
        match get_sdr_record(session, reservation_id, record_id) {
            Ok((record, next_id)) => {
                records.push(record);
                if next_id == 0xFFFF {
                    break;
                }
                record_id = next_id;
            }
            Err(e) => {
                warn!("Error reading SDR record 0x{:04X}: {}", record_id, e);
                break;
            }
        }
    }

    debug!("Read {} SDR records", records.len());
    Ok(records)
}

// ═══════════════════════════════════════════════════════════════════════
// SDR Parsing
// ═══════════════════════════════════════════════════════════════════════

/// Parse a 5-byte SDR header.
fn parse_sdr_header(data: &[u8]) -> IpmiResult<SdrHeader> {
    if data.len() < 5 {
        return Err(IpmiError::SdrParseError("SDR header too short".into()));
    }
    Ok(SdrHeader {
        record_id: u16::from_le_bytes([data[0], data[1]]),
        sdr_version: data[2],
        record_type: data[3],
        record_length: data[4],
    })
}

/// Parse an SDR record body given its header.
fn parse_sdr_record(header: SdrHeader, body: &[u8]) -> IpmiResult<SdrRecord> {
    match header.record_type {
        0x01 => parse_full_sensor(header, body),
        0x02 => parse_compact_sensor(header, body),
        0x11 => parse_fru_locator(header, body),
        0x12 => parse_mc_locator(header, body),
        _ => Ok(SdrRecord::Unknown {
            header,
            data: body.to_vec(),
        }),
    }
}

/// Parse an SDR Type 01 (Full Sensor Record).
fn parse_full_sensor(header: SdrHeader, data: &[u8]) -> IpmiResult<SdrRecord> {
    if data.len() < 43 {
        return Err(IpmiError::SdrParseError(format!(
            "Full sensor record too short: {} bytes",
            data.len()
        )));
    }

    let sensor_owner_id = data[0];
    let sensor_owner_lun = data[1] & 0x03;
    let sensor_number = data[2];
    let entity_id = data[3];
    let entity_instance = data[4];
    let sensor_type = SensorType::from_byte(data[7]);
    let event_reading_type = data[8];
    let sensor_units_1 = data[15];
    let sensor_units_2_base = data[16];
    let sensor_units_3_modifier = data[17];
    let linearization = Linearization::from_byte(data[18]);

    // M, tolerance (bytes 19-20)
    let m_lsb = data[19] as i16;
    let m_msb = ((data[20] & 0xC0) as i16) << 2;
    let m_raw = m_lsb | m_msb;
    let m = if m_raw & 0x200 != 0 {
        m_raw | !0x3FF // sign-extend 10-bit
    } else {
        m_raw
    };
    let tolerance = data[20] & 0x3F;

    // B, accuracy (bytes 21-23)
    let b_lsb = data[21] as i16;
    let b_msb = ((data[22] & 0xC0) as i16) << 2;
    let b_raw = b_lsb | b_msb;
    let b = if b_raw & 0x200 != 0 {
        b_raw | !0x3FF
    } else {
        b_raw
    };
    let accuracy_lsb = (data[22] & 0x3F) as u16;
    let accuracy_msb = ((data[23] & 0xF0) as u16) << 2;
    let accuracy = accuracy_lsb | accuracy_msb;

    // Exponents (byte 24)
    let r_exp_raw = ((data[24] >> 4) & 0x0F) as i8;
    let r_exp = if r_exp_raw & 0x08 != 0 {
        r_exp_raw | !0x0F // sign-extend 4-bit
    } else {
        r_exp_raw
    };
    let b_exp_raw = (data[24] & 0x0F) as i8;
    let b_exp = if b_exp_raw & 0x08 != 0 {
        b_exp_raw | !0x0F
    } else {
        b_exp_raw
    };

    let analog_flags = data[25];
    let nominal_reading = data[26];
    let normal_max = data[27];
    let normal_min = data[28];
    let sensor_max = data[29];
    let sensor_min = data[30];
    let upper_non_recoverable = data[31];
    let upper_critical = data[32];
    let upper_non_critical = data[33];
    let lower_non_recoverable = data[34];
    let lower_critical = data[35];
    let lower_non_critical = data[36];
    let positive_hysteresis = data[37];
    let negative_hysteresis = data[38];

    // Sensor name starts at byte 42 (type/length byte) + body
    let sensor_name = if data.len() > 43 {
        parse_sensor_id_string(&data[42..])
    } else {
        String::new()
    };

    Ok(SdrRecord::FullSensor(SdrFullSensor {
        header,
        sensor_owner_id,
        sensor_owner_lun,
        sensor_number,
        entity_id,
        entity_instance,
        sensor_type,
        event_reading_type,
        sensor_units_1,
        sensor_units_2_base,
        sensor_units_3_modifier,
        linearization,
        m,
        b,
        b_exp,
        r_exp,
        tolerance,
        accuracy,
        analog_flags,
        nominal_reading,
        normal_max,
        normal_min,
        sensor_max,
        sensor_min,
        upper_non_recoverable,
        upper_critical,
        upper_non_critical,
        lower_non_recoverable,
        lower_critical,
        lower_non_critical,
        positive_hysteresis,
        negative_hysteresis,
        sensor_name,
    }))
}

/// Parse an SDR Type 02 (Compact Sensor Record).
fn parse_compact_sensor(header: SdrHeader, data: &[u8]) -> IpmiResult<SdrRecord> {
    if data.len() < 26 {
        return Err(IpmiError::SdrParseError(format!(
            "Compact sensor record too short: {} bytes",
            data.len()
        )));
    }

    let sensor_owner_id = data[0];
    let sensor_owner_lun = data[1] & 0x03;
    let sensor_number = data[2];
    let entity_id = data[3];
    let entity_instance = data[4];
    let sensor_type = SensorType::from_byte(data[7]);
    let event_reading_type = data[8];

    let sensor_name = if data.len() > 26 {
        parse_sensor_id_string(&data[25..])
    } else {
        String::new()
    };

    Ok(SdrRecord::CompactSensor(SdrCompactSensor {
        header,
        sensor_owner_id,
        sensor_owner_lun,
        sensor_number,
        entity_id,
        entity_instance,
        sensor_type,
        event_reading_type,
        sensor_name,
    }))
}

/// Parse an SDR Type 11 (FRU Device Locator Record).
fn parse_fru_locator(header: SdrHeader, data: &[u8]) -> IpmiResult<SdrRecord> {
    if data.len() < 11 {
        return Err(IpmiError::SdrParseError(
            "FRU locator record too short".into(),
        ));
    }

    let device_access_addr = data[0];
    let fru_device_id = data[1];
    let logical_physical = (data[2] & 0x80) != 0;
    let access_lun = (data[2] >> 3) & 0x03;
    let channel_number = ((data[2] & 0x07) << 1) | ((data[3] >> 7) & 0x01);
    let device_type = data[5];
    let device_type_modifier = data[6];
    let entity_id = data[7];
    let entity_instance = data[8];

    let device_name = if data.len() > 11 {
        parse_sensor_id_string(&data[10..])
    } else {
        String::new()
    };

    Ok(SdrRecord::FruLocator(SdrFruLocator {
        header,
        device_access_addr,
        fru_device_id,
        logical_physical,
        access_lun,
        channel_number,
        device_type,
        device_type_modifier,
        entity_id,
        entity_instance,
        device_name,
    }))
}

/// Parse an SDR Type 12 (Management Controller Device Locator Record).
fn parse_mc_locator(header: SdrHeader, data: &[u8]) -> IpmiResult<SdrRecord> {
    if data.len() < 8 {
        return Err(IpmiError::SdrParseError(
            "MC locator record too short".into(),
        ));
    }

    let device_slave_addr = data[0];
    let channel_number = data[1] & 0x0F;
    let power_state_notification = data[2];
    let device_capabilities = data[3];
    let entity_id = data[5];
    let entity_instance = data[6];

    let device_name = if data.len() > 8 {
        parse_sensor_id_string(&data[7..])
    } else {
        String::new()
    };

    Ok(SdrRecord::McLocator(SdrMcLocator {
        header,
        device_slave_addr,
        channel_number,
        power_state_notification,
        device_capabilities,
        entity_id,
        entity_instance,
        device_name,
    }))
}

/// Parse sensor ID string from type/length byte + data.
fn parse_sensor_id_string(data: &[u8]) -> String {
    if data.is_empty() {
        return String::new();
    }
    let type_length = data[0];
    let str_type = (type_length >> 6) & 0x03;
    let str_len = (type_length & 0x1F) as usize;

    if data.len() < 1 + str_len {
        return String::new();
    }

    let str_data = &data[1..1 + str_len];

    match str_type {
        0x00 => {
            // Unicode
            String::from_utf8_lossy(str_data).to_string()
        }
        0x01 => {
            // BCD+
            decode_bcd_plus(str_data)
        }
        0x02 => {
            // 6-bit packed ASCII
            decode_6bit_ascii(str_data, str_len)
        }
        0x03 => {
            // 8-bit ASCII + Latin1
            String::from_utf8_lossy(str_data).trim().to_string()
        }
        _ => String::new(),
    }
}

/// Decode BCD+ encoded string.
fn decode_bcd_plus(data: &[u8]) -> String {
    const BCD_PLUS_CHARS: &[u8; 16] = b"0123456789 -.:,_";
    let mut result = String::with_capacity(data.len() * 2);
    for &byte in data {
        let hi = (byte >> 4) & 0x0F;
        let lo = byte & 0x0F;
        if (hi as usize) < BCD_PLUS_CHARS.len() {
            result.push(BCD_PLUS_CHARS[hi as usize] as char);
        }
        if (lo as usize) < BCD_PLUS_CHARS.len() {
            result.push(BCD_PLUS_CHARS[lo as usize] as char);
        }
    }
    result.trim().to_string()
}

/// Decode 6-bit packed ASCII.
fn decode_6bit_ascii(data: &[u8], _expected_chars: usize) -> String {
    let mut bits: u64 = 0;
    let mut bit_count = 0;
    let mut result = String::new();

    for &byte in data {
        bits |= (byte as u64) << bit_count;
        bit_count += 8;

        while bit_count >= 6 {
            let ch = (bits & 0x3F) as u8 + 0x20;
            result.push(ch as char);
            bits >>= 6;
            bit_count -= 6;
        }
    }

    result.trim().to_string()
}

// ═══════════════════════════════════════════════════════════════════════
// Sensor Reading
// ═══════════════════════════════════════════════════════════════════════

/// Get a sensor reading by sensor number.
pub fn get_sensor_reading(
    session: &mut IpmiSessionHandle,
    sensor_number: u8,
) -> IpmiResult<(u8, u8, u16)> {
    let req = IpmiRequest::new(
        NetFunction::SensorEvent.as_byte(),
        cmd::GET_SENSOR_READING,
        vec![sensor_number],
    );
    let resp = session.send_request(req)?;
    resp.check()?;

    if resp.data.len() < 2 {
        return Err(IpmiError::SensorError(
            "Sensor reading response too short".into(),
        ));
    }

    let raw_reading = resp.data[0];
    let reading_status = resp.data[1];
    let discrete_state = if resp.data.len() >= 4 {
        u16::from_le_bytes([resp.data[2], resp.data[3]])
    } else if resp.data.len() >= 3 {
        resp.data[2] as u16
    } else {
        0
    };

    Ok((raw_reading, reading_status, discrete_state))
}

/// Convert a raw sensor reading to a real-world value using SDR factors.
///
/// Formula: `y = L((M * x + B * 10^K1) * 10^K2)`
/// Where L is the linearization function.
pub fn convert_sensor_reading(sdr: &SdrFullSensor, raw: u8) -> f64 {
    let x = if (sdr.analog_flags & 0xC0) == 0x00 {
        // Unsigned
        raw as f64
    } else if (sdr.analog_flags & 0xC0) == 0x40 {
        // 1's complement
        if raw & 0x80 != 0 {
            -((!raw & 0x7F) as f64)
        } else {
            raw as f64
        }
    } else {
        // 2's complement
        (raw as i8) as f64
    };

    let m = sdr.m as f64;
    let b = sdr.b as f64;
    let k1 = sdr.b_exp as f64;
    let k2 = sdr.r_exp as f64;

    let raw_value = (m * x + b * (10.0_f64).powf(k1)) * (10.0_f64).powf(k2);
    sdr.linearization.apply(raw_value)
}

/// Convert a threshold value from raw byte to real-world value.
pub fn convert_threshold(sdr: &SdrFullSensor, raw: u8) -> f64 {
    convert_sensor_reading(sdr, raw)
}

/// Read a sensor and produce a full `SensorReading` with converted value.
pub fn read_sensor(
    session: &mut IpmiSessionHandle,
    sdr: &SdrFullSensor,
) -> IpmiResult<SensorReading> {
    let (raw, status, discrete) = get_sensor_reading(session, sdr.sensor_number)?;

    let scanning_enabled = (status & 0x40) != 0;
    let reading_available = (status & 0x20) == 0; // bit 5 = unavailable
    let event_messages_enabled = (status & 0x80) != 0;

    let converted = if reading_available && scanning_enabled {
        Some(convert_sensor_reading(sdr, raw))
    } else {
        None
    };

    let units = get_sensor_units_name(sdr.sensor_units_2_base);

    let threshold_status = if sdr.event_reading_type == 0x01 && resp_has_threshold_status(status) {
        Some(SensorThresholdStatus {
            upper_non_recoverable: (status & 0x20) != 0,
            upper_critical: (status & 0x10) != 0,
            upper_non_critical: (status & 0x08) != 0,
            lower_non_recoverable: (status & 0x04) != 0,
            lower_critical: (status & 0x02) != 0,
            lower_non_critical: (status & 0x01) != 0,
        })
    } else {
        None
    };

    Ok(SensorReading {
        sensor_number: sdr.sensor_number,
        sensor_name: sdr.sensor_name.clone(),
        sensor_type: sdr.sensor_type,
        raw_value: raw,
        converted_value: converted,
        units,
        reading_available,
        scanning_enabled,
        event_messages_enabled,
        threshold_status,
        discrete_state: if sdr.event_reading_type != 0x01 {
            Some(discrete)
        } else {
            None
        },
    })
}

/// Check if the status byte has threshold information.
fn resp_has_threshold_status(_status: u8) -> bool {
    true // Threshold sensors always report threshold status in discrete state
}

// ═══════════════════════════════════════════════════════════════════════
// Sensor Thresholds
// ═══════════════════════════════════════════════════════════════════════

/// Get sensor thresholds.
pub fn get_sensor_thresholds(
    session: &mut IpmiSessionHandle,
    sensor_number: u8,
    sdr: &SdrFullSensor,
) -> IpmiResult<SensorThresholds> {
    let req = IpmiRequest::new(
        NetFunction::SensorEvent.as_byte(),
        cmd::GET_SENSOR_THRESHOLDS,
        vec![sensor_number],
    );
    let resp = session.send_request(req)?;
    resp.check()?;

    if resp.data.len() < 7 {
        return Err(IpmiError::SensorError(
            "Sensor thresholds response too short".into(),
        ));
    }

    let readable = resp.data[0];

    Ok(SensorThresholds {
        sensor_number,
        lower_non_critical: if readable & 0x01 != 0 {
            Some(convert_threshold(sdr, resp.data[1]))
        } else {
            None
        },
        lower_critical: if readable & 0x02 != 0 {
            Some(convert_threshold(sdr, resp.data[2]))
        } else {
            None
        },
        lower_non_recoverable: if readable & 0x04 != 0 {
            Some(convert_threshold(sdr, resp.data[3]))
        } else {
            None
        },
        upper_non_critical: if readable & 0x08 != 0 {
            Some(convert_threshold(sdr, resp.data[4]))
        } else {
            None
        },
        upper_critical: if readable & 0x10 != 0 {
            Some(convert_threshold(sdr, resp.data[5]))
        } else {
            None
        },
        upper_non_recoverable: if readable & 0x20 != 0 {
            Some(convert_threshold(sdr, resp.data[6]))
        } else {
            None
        },
    })
}

// ═══════════════════════════════════════════════════════════════════════
// Sensor Units
// ═══════════════════════════════════════════════════════════════════════

/// Get a human-readable sensor unit name from the base unit byte.
pub fn get_sensor_units_name(base_unit: u8) -> String {
    match base_unit {
        0 => "unspecified".into(),
        1 => "°C".into(),
        2 => "°F".into(),
        3 => "K".into(),
        4 => "V".into(),
        5 => "A".into(),
        6 => "W".into(),
        7 => "J".into(),
        8 => "C".into(),
        9 => "VA".into(),
        10 => "Nits".into(),
        11 => "lm".into(),
        12 => "lx".into(),
        13 => "Cd".into(),
        14 => "kPa".into(),
        15 => "PSI".into(),
        16 => "N".into(),
        17 => "CFM".into(),
        18 => "RPM".into(),
        19 => "Hz".into(),
        20 => "μs".into(),
        21 => "ms".into(),
        22 => "s".into(),
        23 => "min".into(),
        24 => "hr".into(),
        25 => "day".into(),
        26 => "week".into(),
        27 => "mil".into(),
        28 => "in".into(),
        29 => "ft".into(),
        30 => "cu in".into(),
        31 => "cu ft".into(),
        32 => "mm".into(),
        33 => "cm".into(),
        34 => "m".into(),
        35 => "cu cm".into(),
        36 => "cu m".into(),
        37 => "L".into(),
        38 => "fl oz".into(),
        39 => "rad".into(),
        40 => "sr".into(),
        41 => "rev".into(),
        42 => "cycle".into(),
        43 => "g".into(),
        44 => "oz".into(),
        45 => "lb".into(),
        46 => "ft-lb".into(),
        47 => "oz-in".into(),
        48 => "Gauss".into(),
        49 => "G".into(),
        50 => "Oe".into(),
        51 => "Mx".into(),
        52 => "T".into(),
        53 => "hit".into(),
        54 => "miss".into(),
        55 => "retry".into(),
        56 => "reset".into(),
        57 => "overflow".into(),
        58 => "underrun".into(),
        59 => "collision".into(),
        60 => "packets".into(),
        61 => "messages".into(),
        62 => "characters".into(),
        63 => "error".into(),
        64 => "corr error".into(),
        65 => "uncorr error".into(),
        66 => "fatal error".into(),
        67 => "grams".into(),
        _ => format!("unit_{}", base_unit),
    }
}
