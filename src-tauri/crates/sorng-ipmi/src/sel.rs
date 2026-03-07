//! System Event Log (SEL) operations — SEL info, entry reading/clearing,
//! reservation, event record parsing (system events, OEM timestamped,
//! OEM non-timestamped), severity classification, and timestamp conversion.

use crate::error::{IpmiError, IpmiResult, Severity};
use crate::protocol::{cmd, IpmiRequest};
use crate::session::IpmiSessionHandle;
use crate::types::*;
use chrono::{DateTime, TimeZone, Utc};
use log::{debug, warn};

/// IPMI epoch: 1970-01-01 00:00:00 UTC.
/// SEL timestamps are seconds since the IPMI epoch (same as UNIX).
const IPMI_EPOCH_OFFSET: i64 = 0;

// ═══════════════════════════════════════════════════════════════════════
// SEL Info
// ═══════════════════════════════════════════════════════════════════════

/// Get SEL repository information.
pub fn get_sel_info(session: &mut IpmiSessionHandle) -> IpmiResult<SelInfo> {
    let req = IpmiRequest::new(
        NetFunction::Storage.as_byte(),
        cmd::GET_SEL_INFO,
        vec![],
    );
    let resp = session.send_request(req)?;
    resp.check()?;

    if resp.data.len() < 14 {
        return Err(IpmiError::SelParseError(
            "SEL info response too short".into(),
        ));
    }

    let operations = resp.data[13];

    Ok(SelInfo {
        sel_version: resp.data[0],
        entries: u16::from_le_bytes([resp.data[1], resp.data[2]]),
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
        overflow: (operations & 0x80) != 0,
        get_allocation_supported: (operations & 0x01) != 0,
        reserve_supported: (operations & 0x02) != 0,
        partial_add_supported: (operations & 0x04) != 0,
        delete_supported: (operations & 0x08) != 0,
    })
}

// ═══════════════════════════════════════════════════════════════════════
// SEL Reservation
// ═══════════════════════════════════════════════════════════════════════

/// Reserve the SEL for partial reads.
pub fn reserve_sel(session: &mut IpmiSessionHandle) -> IpmiResult<u16> {
    let req = IpmiRequest::new(
        NetFunction::Storage.as_byte(),
        cmd::RESERVE_SEL,
        vec![],
    );
    let resp = session.send_request(req)?;
    resp.check()?;

    if resp.data.len() < 2 {
        return Err(IpmiError::SelParseError(
            "Reserve SEL response too short".into(),
        ));
    }

    Ok(u16::from_le_bytes([resp.data[0], resp.data[1]]))
}

// ═══════════════════════════════════════════════════════════════════════
// SEL Entry Reading
// ═══════════════════════════════════════════════════════════════════════

/// Get a single SEL entry by record ID.
///
/// Returns `(entry, next_record_id)`.
pub fn get_sel_entry(
    session: &mut IpmiSessionHandle,
    reservation_id: u16,
    record_id: u16,
) -> IpmiResult<(SelEntry, u16)> {
    let mut data = Vec::with_capacity(6);
    data.extend_from_slice(&reservation_id.to_le_bytes());
    data.extend_from_slice(&record_id.to_le_bytes());
    data.push(0x00); // offset
    data.push(0xFF); // read entire record

    let req = IpmiRequest::new(NetFunction::Storage.as_byte(), cmd::GET_SEL_ENTRY, data);
    let resp = session.send_request(req)?;
    resp.check()?;

    if resp.data.len() < 2 {
        return Err(IpmiError::SelParseError(
            "SEL entry response too short".into(),
        ));
    }

    let next_record_id = u16::from_le_bytes([resp.data[0], resp.data[1]]);
    let record_data = &resp.data[2..];

    let entry = parse_sel_entry(record_data)?;
    Ok((entry, next_record_id))
}

/// Read all SEL entries.
pub fn get_all_sel_entries(session: &mut IpmiSessionHandle) -> IpmiResult<Vec<SelEntry>> {
    let info = get_sel_info(session)?;
    if info.entries == 0 {
        return Ok(Vec::new());
    }

    let reservation_id = if info.reserve_supported {
        reserve_sel(session)?
    } else {
        0
    };

    let mut entries = Vec::with_capacity(info.entries as usize);
    let mut record_id: u16 = 0x0000;

    loop {
        match get_sel_entry(session, reservation_id, record_id) {
            Ok((entry, next_id)) => {
                entries.push(entry);
                if next_id == 0xFFFF {
                    break;
                }
                record_id = next_id;
            }
            Err(e) => {
                warn!("Error reading SEL entry 0x{:04X}: {}", record_id, e);
                break;
            }
        }
    }

    debug!("Read {} SEL entries", entries.len());
    Ok(entries)
}

// ═══════════════════════════════════════════════════════════════════════
// SEL Clear
// ═══════════════════════════════════════════════════════════════════════

/// Clear the entire SEL.
pub fn clear_sel(session: &mut IpmiSessionHandle) -> IpmiResult<()> {
    let reservation_id = reserve_sel(session)?;

    // Clear SEL command: reservation_id + 'CLR' + action
    let mut data = Vec::with_capacity(6);
    data.extend_from_slice(&reservation_id.to_le_bytes());
    data.push(b'C');
    data.push(b'L');
    data.push(b'R');
    data.push(0xAA); // initiate erase

    let req = IpmiRequest::new(NetFunction::Storage.as_byte(), cmd::CLEAR_SEL, data);
    let resp = session.send_request(req)?;
    resp.check()?;

    // Check completion status
    if !resp.data.is_empty() {
        let status = resp.data[0] & 0x0F;
        debug!("SEL clear status: 0x{:02X}", status);
    }

    // Poll for completion
    for _ in 0..10 {
        let mut poll_data = Vec::with_capacity(6);
        poll_data.extend_from_slice(&reservation_id.to_le_bytes());
        poll_data.push(b'C');
        poll_data.push(b'L');
        poll_data.push(b'R');
        poll_data.push(0x00); // get status

        let req = IpmiRequest::new(
            NetFunction::Storage.as_byte(),
            cmd::CLEAR_SEL,
            poll_data,
        );
        let resp = session.send_request(req)?;
        resp.check()?;

        if !resp.data.is_empty() && (resp.data[0] & 0x01) != 0 {
            debug!("SEL cleared successfully");
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }

    warn!("SEL clear may not have completed");
    Ok(())
}

/// Delete a single SEL entry by record ID.
pub fn delete_sel_entry(
    session: &mut IpmiSessionHandle,
    record_id: u16,
) -> IpmiResult<u16> {
    let reservation_id = reserve_sel(session)?;

    let mut data = Vec::with_capacity(4);
    data.extend_from_slice(&reservation_id.to_le_bytes());
    data.extend_from_slice(&record_id.to_le_bytes());

    let req = IpmiRequest::new(
        NetFunction::Storage.as_byte(),
        cmd::DELETE_SEL_ENTRY,
        data,
    );
    let resp = session.send_request(req)?;
    resp.check()?;

    if resp.data.len() < 2 {
        return Err(IpmiError::SelParseError(
            "Delete SEL response too short".into(),
        ));
    }

    Ok(u16::from_le_bytes([resp.data[0], resp.data[1]]))
}

// ═══════════════════════════════════════════════════════════════════════
// SEL Entry Parsing
// ═══════════════════════════════════════════════════════════════════════

/// Parse a raw 16-byte SEL record.
fn parse_sel_entry(data: &[u8]) -> IpmiResult<SelEntry> {
    if data.len() < 16 {
        return Err(IpmiError::SelParseError(format!(
            "SEL record too short: {} bytes (expected 16)",
            data.len()
        )));
    }

    let record_id = u16::from_le_bytes([data[0], data[1]]);
    let record_type = data[2];
    let record_type_enum = SelRecordType::from_byte(record_type);

    match record_type_enum {
        SelRecordType::SystemEvent => parse_system_event(record_id, record_type, data),
        SelRecordType::OemTimestamped => parse_oem_timestamped(record_id, record_type, data),
        SelRecordType::OemNonTimestamped => {
            parse_oem_non_timestamped(record_id, record_type, data)
        }
        SelRecordType::Unknown(_) => Ok(SelEntry {
            record_id,
            record_type,
            record_type_name: format!("Unknown (0x{:02X})", record_type),
            timestamp: None,
            generator_id: None,
            event_msg_rev: None,
            sensor_type: None,
            sensor_number: None,
            event_dir: None,
            event_type: None,
            event_data: data[3..].to_vec(),
            description: "Unknown record type".into(),
            raw_data: data.to_vec(),
        }),
    }
}

/// Parse a standard system event record (type 0x02).
fn parse_system_event(record_id: u16, record_type: u8, data: &[u8]) -> IpmiResult<SelEntry> {
    if data.len() < 16 {
        return Err(IpmiError::SelParseError("System event too short".into()));
    }

    let timestamp_raw = u32::from_le_bytes([data[3], data[4], data[5], data[6]]);
    let timestamp = ipmi_timestamp_to_datetime(timestamp_raw);

    let generator_id = u16::from_le_bytes([data[7], data[8]]);
    let event_msg_rev = data[9];
    let sensor_type = SensorType::from_byte(data[10]);
    let sensor_number = data[11];
    let event_dir_type = data[12];
    let event_dir = if (event_dir_type & 0x80) != 0 {
        "Deassertion"
    } else {
        "Assertion"
    };
    let event_type = event_dir_type & 0x7F;
    let event_data = vec![data[13], data[14], data[15]];

    let description = describe_system_event(
        &sensor_type,
        sensor_number,
        event_type,
        &event_data,
        event_dir,
    );

    Ok(SelEntry {
        record_id,
        record_type,
        record_type_name: "System Event".into(),
        timestamp: Some(timestamp),
        generator_id: Some(generator_id),
        event_msg_rev: Some(event_msg_rev),
        sensor_type: Some(sensor_type),
        sensor_number: Some(sensor_number),
        event_dir: Some(event_dir.into()),
        event_type: Some(event_type),
        event_data,
        description,
        raw_data: data.to_vec(),
    })
}

/// Parse an OEM timestamped event record (types 0xC0-0xDF).
fn parse_oem_timestamped(record_id: u16, record_type: u8, data: &[u8]) -> IpmiResult<SelEntry> {
    let timestamp_raw = u32::from_le_bytes([data[3], data[4], data[5], data[6]]);
    let timestamp = ipmi_timestamp_to_datetime(timestamp_raw);
    let manufacturer_id = if data.len() >= 10 {
        u32::from_le_bytes([data[7], data[8], data[9], 0])
    } else {
        0
    };

    Ok(SelEntry {
        record_id,
        record_type,
        record_type_name: format!("OEM Timestamped (0x{:02X})", record_type),
        timestamp: Some(timestamp),
        generator_id: None,
        event_msg_rev: None,
        sensor_type: None,
        sensor_number: None,
        event_dir: None,
        event_type: None,
        event_data: data[10..].to_vec(),
        description: format!(
            "OEM event from manufacturer 0x{:06X}",
            manufacturer_id
        ),
        raw_data: data.to_vec(),
    })
}

/// Parse an OEM non-timestamped event record (types 0xE0-0xFF).
fn parse_oem_non_timestamped(
    record_id: u16,
    record_type: u8,
    data: &[u8],
) -> IpmiResult<SelEntry> {
    Ok(SelEntry {
        record_id,
        record_type,
        record_type_name: format!("OEM Non-Timestamped (0x{:02X})", record_type),
        timestamp: None,
        generator_id: None,
        event_msg_rev: None,
        sensor_type: None,
        sensor_number: None,
        event_dir: None,
        event_type: None,
        event_data: data[3..].to_vec(),
        description: "OEM non-timestamped event".into(),
        raw_data: data.to_vec(),
    })
}

// ═══════════════════════════════════════════════════════════════════════
// Event Description
// ═══════════════════════════════════════════════════════════════════════

/// Generate a human-readable description for a system event.
fn describe_system_event(
    sensor_type: &SensorType,
    sensor_number: u8,
    event_type: u8,
    event_data: &[u8],
    event_dir: &str,
) -> String {
    let sensor_desc = match sensor_type {
        SensorType::Temperature => "Temperature",
        SensorType::Voltage => "Voltage",
        SensorType::Current => "Current",
        SensorType::Fan => "Fan",
        SensorType::PhysicalSecurity => "Physical Security",
        SensorType::PlatformSecurity => "Platform Security",
        SensorType::Processor => "Processor",
        SensorType::PowerSupply => "Power Supply",
        SensorType::PowerUnit => "Power Unit",
        SensorType::CoolingDevice => "Cooling Device",
        SensorType::MemoryModule => "Memory",
        SensorType::DriveSlot => "Drive Slot/Bay",
        SensorType::SystemFirmware => "System Firmware",
        SensorType::EventLogging => "Event Logging",
        SensorType::SystemEvent => "System Event",
        SensorType::CriticalInterrupt => "Critical Interrupt",
        SensorType::ButtonSwitch => "Button/Switch",
        SensorType::SystemBoot => "System Boot",
        SensorType::OsBoot => "OS Boot",
        SensorType::OsCriticalStop => "OS Critical Stop",
        SensorType::Watchdog2 => "Watchdog 2",
        SensorType::Battery => "Battery",
        SensorType::ManagementSubsystemHealth => "Management Subsystem Health",
        _ => "Sensor",
    };

    let event_desc = if event_type == 0x01 {
        // Threshold event
        let offset = event_data.first().map(|d| d & 0x0F).unwrap_or(0);
        match offset {
            0x00 => "lower non-critical going low",
            0x01 => "lower non-critical going high",
            0x02 => "lower critical going low",
            0x03 => "lower critical going high",
            0x04 => "lower non-recoverable going low",
            0x05 => "lower non-recoverable going high",
            0x06 => "upper non-critical going low",
            0x07 => "upper non-critical going high",
            0x08 => "upper critical going low",
            0x09 => "upper critical going high",
            0x0A => "upper non-recoverable going low",
            0x0B => "upper non-recoverable going high",
            _ => "threshold event",
        }
    } else {
        "discrete event"
    };

    format!(
        "{} #{}: {} ({})",
        sensor_desc, sensor_number, event_desc, event_dir
    )
}

/// Classify the severity of a SEL entry.
pub fn classify_severity(entry: &SelEntry) -> Severity {
    if let Some(event_type) = entry.event_type {
        if event_type == 0x01 {
            // Threshold event
            let offset = entry.event_data.first().map(|d| d & 0x0F).unwrap_or(0);
            return Severity::from_threshold_offset(offset);
        }
    }

    // Classify by sensor type
    match entry.sensor_type {
        Some(SensorType::CriticalInterrupt) | Some(SensorType::OsCriticalStop) => {
            Severity::Critical
        }
        Some(SensorType::PowerSupply) | Some(SensorType::Processor) => Severity::Warning,
        _ => Severity::Informational,
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Timestamp Conversion
// ═══════════════════════════════════════════════════════════════════════

/// Convert an IPMI timestamp (seconds since 1970-01-01) to a `DateTime<Utc>`.
///
/// Special values:
/// - 0x00000000 = unspecified
/// - 0xFFFFFFFF = unspecified
/// - 0x20000000 or below = initialization in progress (pre-dating)
pub fn ipmi_timestamp_to_datetime(timestamp: u32) -> DateTime<Utc> {
    if timestamp == 0 || timestamp == 0xFFFFFFFF {
        return Utc.timestamp_opt(0, 0).unwrap();
    }
    let secs = timestamp as i64 + IPMI_EPOCH_OFFSET;
    Utc.timestamp_opt(secs, 0).single().unwrap_or_else(|| Utc.timestamp_opt(0, 0).unwrap())
}

/// Convert a `DateTime<Utc>` to an IPMI timestamp value.
pub fn datetime_to_ipmi_timestamp(dt: &DateTime<Utc>) -> u32 {
    let secs = dt.timestamp() - IPMI_EPOCH_OFFSET;
    if secs < 0 {
        0
    } else {
        secs as u32
    }
}

/// Get the SEL time from the BMC.
pub fn get_sel_time(session: &mut IpmiSessionHandle) -> IpmiResult<DateTime<Utc>> {
    let req = IpmiRequest::new(
        NetFunction::Storage.as_byte(),
        cmd::GET_SEL_TIME,
        vec![],
    );
    let resp = session.send_request(req)?;
    resp.check()?;

    if resp.data.len() < 4 {
        return Err(IpmiError::SelParseError(
            "SEL time response too short".into(),
        ));
    }

    let timestamp = u32::from_le_bytes([resp.data[0], resp.data[1], resp.data[2], resp.data[3]]);
    Ok(ipmi_timestamp_to_datetime(timestamp))
}

/// Set the SEL time on the BMC.
pub fn set_sel_time(session: &mut IpmiSessionHandle, time: &DateTime<Utc>) -> IpmiResult<()> {
    let timestamp = datetime_to_ipmi_timestamp(time);
    let req = IpmiRequest::new(
        NetFunction::Storage.as_byte(),
        cmd::SET_SEL_TIME,
        timestamp.to_le_bytes().to_vec(),
    );
    let resp = session.send_request(req)?;
    resp.check()?;
    Ok(())
}
