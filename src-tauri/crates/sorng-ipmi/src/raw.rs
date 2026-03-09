//! Raw IPMI command execution — send arbitrary NetFn/Cmd bytes to the BMC,
//! optionally bridged, with hex parse/format helpers and common presets.

use crate::error::{IpmiError, IpmiResult};
use crate::protocol::IpmiRequest;
use crate::session::IpmiSessionHandle;
use crate::types::*;
use log::{debug, info};

// ═══════════════════════════════════════════════════════════════════════
// Raw Command Execution
// ═══════════════════════════════════════════════════════════════════════

/// Send a raw IPMI command and return the raw response data.
pub fn raw_command(
    session: &mut IpmiSessionHandle,
    netfn: u8,
    cmd: u8,
    data: &[u8],
) -> IpmiResult<RawIpmiResponse> {
    debug!(
        "Raw command: NetFn=0x{:02X} Cmd=0x{:02X} Data=[{}]",
        netfn,
        cmd,
        hex_string(data)
    );

    let req = IpmiRequest::new(netfn, cmd, data.to_vec());
    let resp = session.send_request(req)?;

    Ok(RawIpmiResponse {
        completion_code: resp.completion_code(),
        data: resp.data.clone(),
    })
}

/// Send a raw IPMI command, checking the completion code.
pub fn raw_command_checked(
    session: &mut IpmiSessionHandle,
    netfn: u8,
    cmd: u8,
    data: &[u8],
) -> IpmiResult<Vec<u8>> {
    let req = IpmiRequest::new(netfn, cmd, data.to_vec());
    let resp = session.send_request(req)?;
    resp.check()?;
    Ok(resp.data.clone())
}

/// Send a raw IPMI command from a RawIpmiRequest struct.
pub fn execute_raw_request(
    session: &mut IpmiSessionHandle,
    request: &RawIpmiRequest,
) -> IpmiResult<RawIpmiResponse> {
    raw_command(session, request.netfn, request.cmd, &request.data)
}

// ═══════════════════════════════════════════════════════════════════════
// Bridged Commands
// ═══════════════════════════════════════════════════════════════════════

/// Send a bridged IPMI command through a specific channel to a target address.
pub fn bridged_command(
    session: &mut IpmiSessionHandle,
    target_channel: u8,
    target_address: u8,
    netfn: u8,
    cmd: u8,
    data: &[u8],
) -> IpmiResult<RawIpmiResponse> {
    info!(
        "Bridged command: channel={} target=0x{:02X} NetFn=0x{:02X} Cmd=0x{:02X}",
        target_channel, target_address, netfn, cmd
    );

    // Send Message command (NetFn App, Cmd 0x34)
    let mut send_msg_data = Vec::with_capacity(8 + data.len());
    send_msg_data.push(target_channel & 0x0F); // channel number
                                               // Embedded IPMI message
    send_msg_data.push(target_address); // target slave address
    send_msg_data.push(netfn << 2); // NetFn/LUN
                                    // Checksum of target addr + netfn
    let hdr_sum = checksum(&[target_address, netfn << 2]);
    send_msg_data.push(hdr_sum);
    send_msg_data.push(0x20); // source address (BMC)
    send_msg_data.push(0x00); // seq/source LUN
    send_msg_data.push(cmd);
    send_msg_data.extend_from_slice(data);
    // Checksum of the body
    let mut body_bytes = vec![0x20, 0x00, cmd];
    body_bytes.extend_from_slice(data);
    send_msg_data.push(checksum(&body_bytes));

    let req = IpmiRequest::new(
        NetFunction::App.as_byte(),
        0x34, // Send Message
        send_msg_data,
    );
    let resp = session.send_request(req)?;
    resp.check()?;

    // Parse the embedded response
    if resp.data.len() < 7 {
        return Ok(RawIpmiResponse {
            completion_code: resp.completion_code(),
            data: resp.data.clone(),
        });
    }

    // The response is wrapped in a Get Message response
    // Extract the embedded completion code and data
    let embedded_cc = resp.data.get(6).copied().unwrap_or(0xFF);
    let embedded_data = if resp.data.len() > 7 {
        resp.data[7..resp.data.len().saturating_sub(1)].to_vec()
    } else {
        vec![]
    };

    Ok(RawIpmiResponse {
        completion_code: embedded_cc,
        data: embedded_data,
    })
}

/// Simple 8-bit checksum (two's complement of the sum).
fn checksum(data: &[u8]) -> u8 {
    let sum: u8 = data.iter().fold(0u8, |acc, &b| acc.wrapping_add(b));
    (!sum).wrapping_add(1)
}

// ═══════════════════════════════════════════════════════════════════════
// Hex Parse / Format Utilities
// ═══════════════════════════════════════════════════════════════════════

/// Format a byte slice as a hex string (e.g. "0A 1B 2C").
pub fn hex_string(data: &[u8]) -> String {
    data.iter()
        .map(|b| format!("{:02X}", b))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Format a byte slice as a compact hex string (e.g. "0a1b2c").
pub fn hex_compact(data: &[u8]) -> String {
    data.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Parse a hex string into bytes. Supports space-separated ("0A 1B")
/// and compact ("0a1b") formats, with optional "0x" prefixes.
pub fn parse_hex(input: &str) -> IpmiResult<Vec<u8>> {
    let cleaned = input.trim();
    if cleaned.is_empty() {
        return Ok(vec![]);
    }

    // Try space-separated first
    if cleaned.contains(' ') {
        return cleaned
            .split_whitespace()
            .map(|token| {
                let t = token
                    .strip_prefix("0x")
                    .or_else(|| token.strip_prefix("0X"))
                    .unwrap_or(token);
                u8::from_str_radix(t, 16).map_err(|_| {
                    IpmiError::InvalidParameter(format!("Invalid hex byte: {}", token))
                })
            })
            .collect();
    }

    // Compact hex: strip single 0x prefix
    let hex = cleaned
        .strip_prefix("0x")
        .or_else(|| cleaned.strip_prefix("0X"))
        .unwrap_or(cleaned);

    if !hex.len().is_multiple_of(2) {
        return Err(IpmiError::InvalidParameter(
            "Hex string must have even number of characters".into(),
        ));
    }

    (0..hex.len())
        .step_by(2)
        .map(|i| {
            u8::from_str_radix(&hex[i..i + 2], 16).map_err(|_| {
                IpmiError::InvalidParameter(format!(
                    "Invalid hex at position {}: {}",
                    i,
                    &hex[i..i + 2]
                ))
            })
        })
        .collect()
}

// ═══════════════════════════════════════════════════════════════════════
// Common Raw Command Presets
// ═══════════════════════════════════════════════════════════════════════

/// Common raw command presets for frequently used IPMI commands.
pub struct RawPresets;

impl RawPresets {
    /// Get Device ID (NetFn=App, Cmd=0x01).
    pub fn get_device_id() -> RawIpmiRequest {
        RawIpmiRequest {
            netfn: NetFunction::App.as_byte(),
            cmd: 0x01,
            data: vec![],
        }
    }

    /// Cold Reset (NetFn=App, Cmd=0x02).
    pub fn cold_reset() -> RawIpmiRequest {
        RawIpmiRequest {
            netfn: NetFunction::App.as_byte(),
            cmd: 0x02,
            data: vec![],
        }
    }

    /// Warm Reset (NetFn=App, Cmd=0x03).
    pub fn warm_reset() -> RawIpmiRequest {
        RawIpmiRequest {
            netfn: NetFunction::App.as_byte(),
            cmd: 0x03,
            data: vec![],
        }
    }

    /// Get Self Test Results (NetFn=App, Cmd=0x04).
    pub fn get_self_test_results() -> RawIpmiRequest {
        RawIpmiRequest {
            netfn: NetFunction::App.as_byte(),
            cmd: 0x04,
            data: vec![],
        }
    }

    /// Get System GUID (NetFn=App, Cmd=0x37).
    pub fn get_system_guid() -> RawIpmiRequest {
        RawIpmiRequest {
            netfn: NetFunction::App.as_byte(),
            cmd: 0x37,
            data: vec![],
        }
    }

    /// Get Channel Authentication Capabilities.
    pub fn get_channel_auth_cap(channel: u8, privilege: u8) -> RawIpmiRequest {
        RawIpmiRequest {
            netfn: NetFunction::App.as_byte(),
            cmd: 0x38,
            data: vec![channel | 0x80, privilege],
        }
    }

    /// Get Chassis Status (NetFn=Chassis, Cmd=0x01).
    pub fn get_chassis_status() -> RawIpmiRequest {
        RawIpmiRequest {
            netfn: NetFunction::Chassis.as_byte(),
            cmd: 0x01,
            data: vec![],
        }
    }

    /// Chassis Control (NetFn=Chassis, Cmd=0x02).
    pub fn chassis_control(action: u8) -> RawIpmiRequest {
        RawIpmiRequest {
            netfn: NetFunction::Chassis.as_byte(),
            cmd: 0x02,
            data: vec![action],
        }
    }

    /// Get SDR Repository Info (NetFn=Storage, Cmd=0x20).
    pub fn get_sdr_repo_info() -> RawIpmiRequest {
        RawIpmiRequest {
            netfn: NetFunction::Storage.as_byte(),
            cmd: 0x20,
            data: vec![],
        }
    }

    /// Get SEL Info (NetFn=Storage, Cmd=0x40).
    pub fn get_sel_info() -> RawIpmiRequest {
        RawIpmiRequest {
            netfn: NetFunction::Storage.as_byte(),
            cmd: 0x40,
            data: vec![],
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Raw Command History
// ═══════════════════════════════════════════════════════════════════════

/// Record a raw command execution for history/auditing.
pub fn record_raw_command(
    session_id: &str,
    request: &RawIpmiRequest,
    response: &RawIpmiResponse,
) -> RawCommandHistoryEntry {
    RawCommandHistoryEntry {
        timestamp: chrono::Utc::now(),
        session_id: session_id.to_string(),
        netfn: request.netfn,
        cmd: request.cmd,
        request_data: hex_string(&request.data),
        completion_code: response.completion_code,
        response_data: hex_string(&response.data),
    }
}

use chrono;
