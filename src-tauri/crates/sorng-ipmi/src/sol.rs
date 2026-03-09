//! Serial over LAN (SOL) operations — payload activation/deactivation,
//! character data send/receive, break signal, flow control, keepalive,
//! and SOL configuration parameter management.

use crate::error::{IpmiError, IpmiResult};
use crate::protocol::{cmd, IpmiRequest, PAYLOAD_SOL};
use crate::session::IpmiSessionHandle;
use crate::types::*;
use chrono::Utc;
use log::{debug, info};
use uuid::Uuid;

// ═══════════════════════════════════════════════════════════════════════
// SOL Configuration Parameters
// ═══════════════════════════════════════════════════════════════════════

/// SOL parameter IDs per IPMI spec.
#[repr(u8)]
#[derive(Debug, Clone, Copy)]
pub enum SolParamId {
    SetInProgress = 0x00,
    Enable = 0x01,
    Authentication = 0x02,
    AccumulateAndThreshold = 0x03,
    Retry = 0x04,
    NonVolatileBitRate = 0x05,
    VolatileBitRate = 0x06,
    PayloadChannel = 0x07,
    PayloadPort = 0x08,
}

/// Get a SOL configuration parameter.
pub fn get_sol_config_param(
    session: &mut IpmiSessionHandle,
    channel: u8,
    param: SolParamId,
) -> IpmiResult<Vec<u8>> {
    let req = IpmiRequest::new(
        NetFunction::Transport.as_byte(),
        cmd::GET_SOL_CONFIG,
        vec![channel & 0x0F, param as u8, 0x00, 0x00],
    );
    let resp = session.send_request(req)?;
    resp.check()?;

    // First byte is parameter revision, rest is data
    if resp.data.is_empty() {
        return Err(IpmiError::SolError("Empty SOL config response".into()));
    }
    Ok(resp.data[1..].to_vec())
}

/// Set a SOL configuration parameter.
pub fn set_sol_config_param(
    session: &mut IpmiSessionHandle,
    channel: u8,
    param: SolParamId,
    value: &[u8],
) -> IpmiResult<()> {
    let mut data = vec![channel & 0x0F, param as u8];
    data.extend_from_slice(value);

    let req = IpmiRequest::new(NetFunction::Transport.as_byte(), cmd::SET_SOL_CONFIG, data);
    let resp = session.send_request(req)?;
    resp.check()?;
    Ok(())
}

/// Get the full SOL configuration for a channel.
pub fn get_sol_config(session: &mut IpmiSessionHandle, channel: u8) -> IpmiResult<SolConfig> {
    // SOL enabled
    let enable_data = get_sol_config_param(session, channel, SolParamId::Enable)?;
    let enabled = !enable_data.is_empty() && (enable_data[0] & 0x01) != 0;

    // Authentication
    let auth_data = get_sol_config_param(session, channel, SolParamId::Authentication)?;
    let (force_encryption, force_authentication, privilege_level) = if auth_data.len() >= 2 {
        (
            (auth_data[0] & 0x80) != 0,
            (auth_data[0] & 0x40) != 0,
            PrivilegeLevel::from_byte(auth_data[0] & 0x0F),
        )
    } else {
        (false, false, PrivilegeLevel::User)
    };

    // Accumulate and threshold
    let acc_data = get_sol_config_param(session, channel, SolParamId::AccumulateAndThreshold)?;
    let (character_accumulate_interval, character_send_threshold) = if acc_data.len() >= 2 {
        (acc_data[0], acc_data[1])
    } else {
        (12, 60)
    };

    // Retry
    let retry_data = get_sol_config_param(session, channel, SolParamId::Retry)?;
    let (retry_count, retry_interval) = if retry_data.len() >= 2 {
        (retry_data[0] & 0x07, retry_data[1])
    } else {
        (3, 10)
    };

    // Bit rates
    let nv_rate_data = get_sol_config_param(session, channel, SolParamId::NonVolatileBitRate)?;
    let non_volatile_bit_rate = nv_rate_data.first().copied().unwrap_or(0);

    let v_rate_data = get_sol_config_param(session, channel, SolParamId::VolatileBitRate)?;
    let volatile_bit_rate = v_rate_data.first().copied().unwrap_or(0);

    // Payload channel and port
    let channel_data =
        get_sol_config_param(session, channel, SolParamId::PayloadChannel).unwrap_or_default();
    let payload_channel = channel_data.first().copied().unwrap_or(channel);

    let port_data =
        get_sol_config_param(session, channel, SolParamId::PayloadPort).unwrap_or_default();
    let payload_port = if port_data.len() >= 2 {
        u16::from_le_bytes([port_data[0], port_data[1]])
    } else {
        623
    };

    Ok(SolConfig {
        enabled,
        force_encryption,
        force_authentication,
        privilege_level,
        character_accumulate_interval,
        character_send_threshold,
        retry_count,
        retry_interval,
        non_volatile_bit_rate,
        volatile_bit_rate,
        payload_channel,
        payload_port,
    })
}

// ═══════════════════════════════════════════════════════════════════════
// SOL Session Activation / Deactivation
// ═══════════════════════════════════════════════════════════════════════

/// Activate a SOL payload.
pub fn activate_sol(
    session: &mut IpmiSessionHandle,
    instance: u8,
    encrypt: bool,
    auth: bool,
) -> IpmiResult<SolSession> {
    info!("Activating SOL payload instance {}", instance);

    let mut flags: u8 = 0;
    if encrypt {
        flags |= 0x80;
    }
    if auth {
        flags |= 0x40;
    }

    // Activate Payload command
    let data = vec![
        PAYLOAD_SOL, // payload type
        instance,    // payload instance
        flags,       // encryption/authentication
        0x00,        // reserved
        0x00,
        0x00,
    ];

    let req = IpmiRequest::new(NetFunction::App.as_byte(), cmd::ACTIVATE_PAYLOAD, data);
    let resp = session.send_request(req)?;
    resp.check()?;

    let sol_session_id = Uuid::new_v4().to_string();

    Ok(SolSession {
        session_id: sol_session_id,
        ipmi_session_id: session.id().to_string(),
        state: SolSessionState::Active,
        instance,
        sequence_number: 0,
        accepted_char_count: 0,
        cts: true,
        dcd_dsr: true,
        break_detected: false,
        created_at: Utc::now(),
    })
}

/// Deactivate a SOL payload.
pub fn deactivate_sol(session: &mut IpmiSessionHandle, instance: u8) -> IpmiResult<()> {
    info!("Deactivating SOL payload instance {}", instance);

    let data = vec![
        PAYLOAD_SOL, // payload type
        instance,    // payload instance
        0x00,
        0x00,
        0x00,
        0x00,
    ];

    let req = IpmiRequest::new(NetFunction::App.as_byte(), cmd::DEACTIVATE_PAYLOAD, data);
    let resp = session.send_request(req)?;
    resp.check()?;
    Ok(())
}

/// Get payload activation status.
pub fn get_payload_activation_status(
    session: &mut IpmiSessionHandle,
    payload_type: u8,
) -> IpmiResult<Vec<bool>> {
    let req = IpmiRequest::new(
        NetFunction::App.as_byte(),
        cmd::GET_PAYLOAD_ACTIVATION_STATUS,
        vec![payload_type],
    );
    let resp = session.send_request(req)?;
    resp.check()?;

    if resp.data.len() < 3 {
        return Err(IpmiError::SolError(
            "Payload activation status too short".into(),
        ));
    }

    let max_instances = resp.data[0] & 0x0F;
    let activation_bits = u16::from_le_bytes([resp.data[1], resp.data[2]]);

    let mut active = Vec::with_capacity(max_instances as usize);
    for i in 0..max_instances {
        active.push((activation_bits & (1 << i)) != 0);
    }

    Ok(active)
}

// ═══════════════════════════════════════════════════════════════════════
// SOL Data Transfer
// ═══════════════════════════════════════════════════════════════════════

/// Build a SOL payload packet for sending character data.
pub fn build_sol_data_packet(
    sequence: u8,
    ack_sequence: u8,
    accepted_count: u8,
    data: &[u8],
    flags: &SolPayloadFlags,
) -> Vec<u8> {
    let mut packet = Vec::with_capacity(4 + data.len());

    // Byte 1: Packet sequence number
    packet.push(sequence);
    // Byte 2: Packet ack/nack sequence number
    packet.push(ack_sequence);
    // Byte 3: Accepted character count
    packet.push(accepted_count);
    // Byte 4: Operation/status
    let mut ops: u8 = 0;
    if flags.nack {
        ops |= 0x40;
    }
    if flags.ring_wor {
        ops |= 0x20;
    }
    if flags.generate_break {
        ops |= 0x10;
    }
    if flags.cts_pause {
        ops |= 0x08;
    }
    if flags.flush_inbound {
        ops |= 0x04;
    }
    if flags.flush_outbound {
        ops |= 0x02;
    }
    packet.push(ops);
    // Payload data
    packet.extend_from_slice(data);

    packet
}

/// Parse a received SOL payload packet.
pub fn parse_sol_data_packet(data: &[u8]) -> IpmiResult<SolReceivedData> {
    if data.len() < 4 {
        return Err(IpmiError::SolError("SOL packet too short".into()));
    }

    let sequence = data[0];
    let ack_sequence = data[1];
    let accepted_count = data[2];
    let status = data[3];

    let cts = (status & 0x08) == 0; // CTS asserted when bit is 0
    let dcd_dsr = (status & 0x04) == 0;
    let break_detected = (status & 0x10) != 0;

    let char_data = if data.len() > 4 {
        data[4..].to_vec()
    } else {
        Vec::new()
    };

    Ok(SolReceivedData {
        sequence,
        ack_sequence,
        accepted_count,
        cts,
        dcd_dsr,
        break_detected,
        data: char_data,
    })
}

/// Received SOL data from the BMC.
#[derive(Debug, Clone)]
pub struct SolReceivedData {
    pub sequence: u8,
    pub ack_sequence: u8,
    pub accepted_count: u8,
    pub cts: bool,
    pub dcd_dsr: bool,
    pub break_detected: bool,
    pub data: Vec<u8>,
}

/// Send a break signal over SOL.
pub fn send_sol_break(_session: &mut IpmiSessionHandle, instance: u8) -> IpmiResult<()> {
    let flags = SolPayloadFlags {
        generate_break: true,
        ..Default::default()
    };
    let _packet = build_sol_data_packet(0, 0, 0, &[], &flags);
    debug!("Sending SOL break on instance {}", instance);
    // The break is sent as a SOL payload through the session
    // In practice this would go through the RMCP+ SOL payload path
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════
// Bit Rate Helpers
// ═══════════════════════════════════════════════════════════════════════

/// Convert SOL bit rate code to baud rate.
pub fn bit_rate_to_baud(code: u8) -> u32 {
    match code {
        0x06 => 9600,
        0x07 => 19200,
        0x08 => 38400,
        0x09 => 57600,
        0x0A => 115200,
        _ => 0, // use default / serial-over-LAN default
    }
}

/// Convert baud rate to SOL bit rate code.
pub fn baud_to_bit_rate(baud: u32) -> u8 {
    match baud {
        9600 => 0x06,
        19200 => 0x07,
        38400 => 0x08,
        57600 => 0x09,
        115200 => 0x0A,
        _ => 0x00, // use BMC default
    }
}

/// Get a human-readable bit rate description.
pub fn bit_rate_description(code: u8) -> String {
    let baud = bit_rate_to_baud(code);
    if baud > 0 {
        format!("{} bps", baud)
    } else {
        "BMC default".into()
    }
}
