//! Platform Event Filtering (PEF) — capabilities, get/set configuration
//! parameters, arm postpone timer, and last processed event ID management.

use crate::error::{IpmiError, IpmiResult};
use crate::protocol::{cmd, IpmiRequest};
use crate::session::IpmiSessionHandle;
use crate::types::*;
use log::{debug, info};

// ═══════════════════════════════════════════════════════════════════════
// PEF Capabilities
// ═══════════════════════════════════════════════════════════════════════

/// Get PEF capabilities from the BMC.
pub fn get_pef_capabilities(
    session: &mut IpmiSessionHandle,
) -> IpmiResult<PefCapabilities> {
    let req = IpmiRequest::new(
        NetFunction::SensorEvent.as_byte(),
        cmd::GET_PEF_CAPABILITIES,
        vec![],
    );
    let resp = session.send_request(req)?;
    resp.check()?;

    if resp.data.len() < 3 {
        return Err(IpmiError::PefError(
            "PEF capabilities response too short".into(),
        ));
    }

    let version = resp.data[0];
    let action_support = resp.data[1];
    let filter_table_size = resp.data[2];

    Ok(PefCapabilities {
        version,
        action_support,
        filter_table_size,
    })
}

// ═══════════════════════════════════════════════════════════════════════
// PEF Configuration Parameters
// ═══════════════════════════════════════════════════════════════════════

/// PEF configuration parameter selectors.
#[repr(u8)]
#[derive(Debug, Clone, Copy)]
pub enum PefParamId {
    SetInProgress = 0x00,
    PefControl = 0x01,
    PefActionGlobalControl = 0x02,
    PefStartupDelay = 0x03,
    PefAlertStartupDelay = 0x04,
    NumberOfEventFilters = 0x05,
    EventFilterTable = 0x06,
    EventFilterData1 = 0x07,
    AlertPolicyTable = 0x09,
    SystemGuid = 0x0A,
    AlertStringKeys = 0x0C,
    AlertStrings = 0x0D,
    NumberOfGroupControlEntries = 0x0E,
    GroupControlTable = 0x0F,
}

/// Get a PEF configuration parameter.
pub fn get_pef_config_param(
    session: &mut IpmiSessionHandle,
    param: PefParamId,
    set_selector: u8,
    block_selector: u8,
) -> IpmiResult<Vec<u8>> {
    let data = vec![param as u8, set_selector, block_selector];

    let req = IpmiRequest::new(
        NetFunction::SensorEvent.as_byte(),
        cmd::GET_PEF_CONFIG,
        data,
    );
    let resp = session.send_request(req)?;
    resp.check()?;

    if resp.data.is_empty() {
        return Err(IpmiError::PefError("Empty PEF config response".into()));
    }

    // Byte 0 is parameter revision; rest is data
    Ok(resp.data[1..].to_vec())
}

/// Set a PEF configuration parameter.
pub fn set_pef_config_param(
    session: &mut IpmiSessionHandle,
    param: PefParamId,
    value: &[u8],
) -> IpmiResult<()> {
    let mut data = vec![param as u8];
    data.extend_from_slice(value);

    let req = IpmiRequest::new(
        NetFunction::SensorEvent.as_byte(),
        cmd::SET_PEF_CONFIG,
        data,
    );
    let resp = session.send_request(req)?;
    resp.check()?;
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════
// PEF Control
// ═══════════════════════════════════════════════════════════════════════

/// Get PEF control status (enabled/disabled).
pub fn get_pef_control(session: &mut IpmiSessionHandle) -> IpmiResult<PefControlStatus> {
    let data = get_pef_config_param(session, PefParamId::PefControl, 0, 0)?;
    let byte = data.first().copied().unwrap_or(0);

    Ok(PefControlStatus {
        pef_enabled: (byte & 0x01) != 0,
        event_messages_enabled: (byte & 0x02) != 0,
        startup_delay_enabled: (byte & 0x04) != 0,
        alert_startup_delay_enabled: (byte & 0x08) != 0,
    })
}

/// Enable or disable PEF.
pub fn set_pef_control(
    session: &mut IpmiSessionHandle,
    enabled: bool,
    event_messages: bool,
) -> IpmiResult<()> {
    let mut byte: u8 = 0;
    if enabled {
        byte |= 0x01;
    }
    if event_messages {
        byte |= 0x02;
    }
    set_pef_config_param(session, PefParamId::PefControl, &[byte])
}

/// PEF control status.
#[derive(Debug, Clone)]
pub struct PefControlStatus {
    pub pef_enabled: bool,
    pub event_messages_enabled: bool,
    pub startup_delay_enabled: bool,
    pub alert_startup_delay_enabled: bool,
}

// ═══════════════════════════════════════════════════════════════════════
// Event Filter Table
// ═══════════════════════════════════════════════════════════════════════

/// Get the number of event filters.
pub fn get_event_filter_count(session: &mut IpmiSessionHandle) -> IpmiResult<u8> {
    let data =
        get_pef_config_param(session, PefParamId::NumberOfEventFilters, 0, 0)?;
    Ok(data.first().copied().unwrap_or(0))
}

/// Get a specific event filter entry.
pub fn get_event_filter(
    session: &mut IpmiSessionHandle,
    filter_number: u8,
) -> IpmiResult<PefFilter> {
    let data =
        get_pef_config_param(session, PefParamId::EventFilterTable, filter_number, 0)?;

    if data.len() < 20 {
        return Err(IpmiError::PefError("Event filter data too short".into()));
    }

    parse_event_filter(filter_number, &data)
}

/// Parse an event filter table entry.
fn parse_event_filter(filter_number: u8, data: &[u8]) -> IpmiResult<PefFilter> {
    let config_byte = data[0];
    let enabled = (config_byte & 0x80) != 0;

    let action_byte = data[1];
    let action = PefAction {
        diagnostic_interrupt: (action_byte & 0x20) != 0,
        oem: (action_byte & 0x10) != 0,
        power_cycle: (action_byte & 0x08) != 0,
        reset: (action_byte & 0x04) != 0,
        power_off: (action_byte & 0x02) != 0,
        alert: (action_byte & 0x01) != 0,
    };

    let alert_policy_number = data[2] & 0x0F;
    let severity = data[3];
    let generator_id = u16::from_le_bytes([data[4], data[5]]);

    let sensor_type = data[6];
    let sensor_number = data[7];
    let event_trigger = data[8];

    // Event data masks
    let event_data1_and_mask = data.get(9).copied().unwrap_or(0xFF);
    let event_data1_compare1 = data.get(10).copied().unwrap_or(0);
    let event_data1_compare2 = data.get(11).copied().unwrap_or(0);
    let event_data2_and_mask = data.get(12).copied().unwrap_or(0xFF);
    let event_data2_compare1 = data.get(13).copied().unwrap_or(0);
    let event_data2_compare2 = data.get(14).copied().unwrap_or(0);
    let event_data3_and_mask = data.get(15).copied().unwrap_or(0xFF);
    let event_data3_compare1 = data.get(16).copied().unwrap_or(0);
    let event_data3_compare2 = data.get(17).copied().unwrap_or(0);

    Ok(PefFilter {
        filter_number,
        enabled,
        action,
        alert_policy_number,
        severity,
        generator_id,
        sensor_type,
        sensor_number,
        event_trigger,
    })
}

/// Get all event filters.
pub fn get_all_event_filters(
    session: &mut IpmiSessionHandle,
) -> IpmiResult<Vec<PefFilter>> {
    let count = get_event_filter_count(session)?;
    debug!("Reading {} PEF event filters", count);

    let mut filters = Vec::with_capacity(count as usize);
    for i in 1..=count {
        match get_event_filter(session, i) {
            Ok(f) => filters.push(f),
            Err(e) => {
                debug!("Failed to read filter {}: {}", i, e);
            }
        }
    }

    Ok(filters)
}

// ═══════════════════════════════════════════════════════════════════════
// PEF Action Global Control
// ═══════════════════════════════════════════════════════════════════════

/// Get PEF action global control (which actions are globally enabled).
pub fn get_pef_action_control(session: &mut IpmiSessionHandle) -> IpmiResult<PefAction> {
    let data = get_pef_config_param(
        session,
        PefParamId::PefActionGlobalControl,
        0,
        0,
    )?;
    let byte = data.first().copied().unwrap_or(0);

    Ok(PefAction {
        diagnostic_interrupt: (byte & 0x20) != 0,
        oem: (byte & 0x10) != 0,
        power_cycle: (byte & 0x08) != 0,
        reset: (byte & 0x04) != 0,
        power_off: (byte & 0x02) != 0,
        alert: (byte & 0x01) != 0,
    })
}

/// Set PEF action global control.
pub fn set_pef_action_control(
    session: &mut IpmiSessionHandle,
    actions: &PefAction,
) -> IpmiResult<()> {
    let mut byte: u8 = 0;
    if actions.diagnostic_interrupt {
        byte |= 0x20;
    }
    if actions.oem {
        byte |= 0x10;
    }
    if actions.power_cycle {
        byte |= 0x08;
    }
    if actions.reset {
        byte |= 0x04;
    }
    if actions.power_off {
        byte |= 0x02;
    }
    if actions.alert {
        byte |= 0x01;
    }
    set_pef_config_param(session, PefParamId::PefActionGlobalControl, &[byte])
}

// ═══════════════════════════════════════════════════════════════════════
// Arm / Postpone PEF Timer
// ═══════════════════════════════════════════════════════════════════════

/// Arm the PEF postpone timer.
pub fn arm_pef_postpone_timer(
    session: &mut IpmiSessionHandle,
    countdown: u8,
) -> IpmiResult<u8> {
    let req = IpmiRequest::new(
        NetFunction::SensorEvent.as_byte(),
        cmd::ARM_PEF_POSTPONE_TIMER,
        vec![countdown],
    );
    let resp = session.send_request(req)?;
    resp.check()?;

    Ok(resp.data.first().copied().unwrap_or(0))
}

// ═══════════════════════════════════════════════════════════════════════
// Last Processed Event ID
// ═══════════════════════════════════════════════════════════════════════

/// Get the last BMC-processed event ID.
pub fn get_last_processed_event_id(
    session: &mut IpmiSessionHandle,
) -> IpmiResult<LastProcessedEvent> {
    let req = IpmiRequest::new(
        NetFunction::SensorEvent.as_byte(),
        cmd::GET_LAST_PROCESSED_EVENT_ID,
        vec![],
    );
    let resp = session.send_request(req)?;
    resp.check()?;

    if resp.data.len() < 7 {
        return Err(IpmiError::PefError(
            "Last processed event response too short".into(),
        ));
    }

    let last_sel_timestamp =
        u32::from_le_bytes([resp.data[0], resp.data[1], resp.data[2], resp.data[3]]);
    let last_sw_processed_record_id = u16::from_le_bytes([resp.data[4], resp.data[5]]);
    let last_bmc_processed_record_id = u16::from_le_bytes([resp.data[5], resp.data[6]]);

    Ok(LastProcessedEvent {
        last_sel_timestamp,
        last_sw_processed_record_id,
        last_bmc_processed_record_id,
    })
}

/// Set the last software-processed event ID.
pub fn set_last_processed_event_id(
    session: &mut IpmiSessionHandle,
    processing_type: u8,
    record_id: u16,
) -> IpmiResult<()> {
    let id_bytes = record_id.to_le_bytes();
    let req = IpmiRequest::new(
        NetFunction::SensorEvent.as_byte(),
        cmd::SET_LAST_PROCESSED_EVENT_ID,
        vec![processing_type, id_bytes[0], id_bytes[1]],
    );
    let resp = session.send_request(req)?;
    resp.check()?;
    Ok(())
}

/// Last processed event information.
#[derive(Debug, Clone)]
pub struct LastProcessedEvent {
    pub last_sel_timestamp: u32,
    pub last_sw_processed_record_id: u16,
    pub last_bmc_processed_record_id: u16,
}

// ═══════════════════════════════════════════════════════════════════════
// Full PEF Configuration
// ═══════════════════════════════════════════════════════════════════════

/// Get the full PEF configuration.
pub fn get_pef_config(session: &mut IpmiSessionHandle) -> IpmiResult<PefConfig> {
    let capabilities = get_pef_capabilities(session)?;
    let control = get_pef_control(session)?;
    let action_control = get_pef_action_control(session)?;
    let filters = get_all_event_filters(session)?;

    // Startup delay
    let startup_delay = get_pef_config_param(session, PefParamId::PefStartupDelay, 0, 0)
        .ok()
        .and_then(|d| d.first().copied())
        .unwrap_or(0);

    // Alert startup delay
    let alert_startup_delay =
        get_pef_config_param(session, PefParamId::PefAlertStartupDelay, 0, 0)
            .ok()
            .and_then(|d| d.first().copied())
            .unwrap_or(0);

    Ok(PefConfig {
        capabilities,
        pef_enabled: control.pef_enabled,
        event_messages_enabled: control.event_messages_enabled,
        action_control,
        startup_delay,
        alert_startup_delay,
        filters,
    })
}

/// Describe a severity byte.
pub fn severity_description(severity: u8) -> &'static str {
    match severity {
        0x00 => "Unspecified",
        0x01 => "Monitor",
        0x02 => "Information",
        0x04 => "OK",
        0x08 => "Non-critical",
        0x10 => "Critical",
        0x20 => "Non-recoverable",
        _ => "Unknown",
    }
}
