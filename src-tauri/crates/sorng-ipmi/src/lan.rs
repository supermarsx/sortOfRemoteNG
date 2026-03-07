//! LAN configuration parameter management — retrieve and set IP address,
//! subnet mask, MAC address, gateway, VLAN, default gateway, cipher suites,
//! community string, and other LAN configuration parameters via IPMI.

use crate::error::{IpmiError, IpmiResult};
use crate::protocol::{cmd, IpmiRequest};
use crate::session::IpmiSessionHandle;
use crate::types::*;
use log::{debug, info};

// ═══════════════════════════════════════════════════════════════════════
// Get / Set LAN Configuration Parameters
// ═══════════════════════════════════════════════════════════════════════

/// Get a single LAN configuration parameter.
pub fn get_lan_param(
    session: &mut IpmiSessionHandle,
    channel: u8,
    param: LanParameterId,
    set_selector: u8,
    block_selector: u8,
) -> IpmiResult<LanParameter> {
    let data = vec![
        channel & 0x0F,
        param.as_byte(),
        set_selector,
        block_selector,
    ];

    let req = IpmiRequest::new(
        NetFunction::Transport.as_byte(),
        cmd::GET_LAN_CONFIG,
        data,
    );
    let resp = session.send_request(req)?;
    resp.check()?;

    if resp.data.is_empty() {
        return Err(IpmiError::LanConfigError(
            "Empty LAN parameter response".into(),
        ));
    }

    // Byte 0 is parameter revision; payload starts at byte 1
    let payload = &resp.data[1..];

    parse_lan_parameter(param, payload)
}

/// Set a LAN configuration parameter.
pub fn set_lan_param(
    session: &mut IpmiSessionHandle,
    channel: u8,
    param: LanParameterId,
    value: &[u8],
) -> IpmiResult<()> {
    let mut data = vec![channel & 0x0F, param.as_byte()];
    data.extend_from_slice(value);

    let req = IpmiRequest::new(
        NetFunction::Transport.as_byte(),
        cmd::SET_LAN_CONFIG,
        data,
    );
    let resp = session.send_request(req)?;
    resp.check()?;
    Ok(())
}

/// Lock LAN parameters for writing (set-in-progress).
pub fn set_lan_in_progress(
    session: &mut IpmiSessionHandle,
    channel: u8,
    state: u8,
) -> IpmiResult<()> {
    set_lan_param(session, channel, LanParameterId::SetInProgress, &[state])
}

// ═══════════════════════════════════════════════════════════════════════
// Parse LAN Parameters
// ═══════════════════════════════════════════════════════════════════════

/// Parse a LAN parameter response into a typed value.
fn parse_lan_parameter(param: LanParameterId, data: &[u8]) -> IpmiResult<LanParameter> {
    match param {
        LanParameterId::SetInProgress => {
            let state = data.first().copied().unwrap_or(0) & 0x03;
            Ok(LanParameter::SetInProgress(state))
        }
        LanParameterId::AuthTypeSupport => {
            let flags = data.first().copied().unwrap_or(0);
            Ok(LanParameter::AuthTypeSupport(flags))
        }
        LanParameterId::IpAddress => {
            if data.len() < 4 {
                return Err(IpmiError::data_too_short("IP address", 4, data.len()));
            }
            Ok(LanParameter::IpAddress([data[0], data[1], data[2], data[3]]))
        }
        LanParameterId::IpAddressSource => {
            let source = IpSource::from_byte(data.first().copied().unwrap_or(0));
            Ok(LanParameter::IpAddressSource(source))
        }
        LanParameterId::MacAddress => {
            if data.len() < 6 {
                return Err(IpmiError::data_too_short("MAC address", 6, data.len()));
            }
            Ok(LanParameter::MacAddress([
                data[0], data[1], data[2], data[3], data[4], data[5],
            ]))
        }
        LanParameterId::SubnetMask => {
            if data.len() < 4 {
                return Err(IpmiError::data_too_short("Subnet mask", 4, data.len()));
            }
            Ok(LanParameter::SubnetMask([
                data[0], data[1], data[2], data[3],
            ]))
        }
        LanParameterId::DefaultGateway => {
            if data.len() < 4 {
                return Err(IpmiError::data_too_short("Gateway", 4, data.len()));
            }
            Ok(LanParameter::DefaultGateway([
                data[0], data[1], data[2], data[3],
            ]))
        }
        LanParameterId::DefaultGatewayMac => {
            if data.len() < 6 {
                return Err(IpmiError::data_too_short("Gateway MAC", 6, data.len()));
            }
            Ok(LanParameter::DefaultGatewayMac([
                data[0], data[1], data[2], data[3], data[4], data[5],
            ]))
        }
        LanParameterId::BackupGateway => {
            if data.len() < 4 {
                return Err(IpmiError::data_too_short("Backup gateway", 4, data.len()));
            }
            Ok(LanParameter::BackupGateway([
                data[0], data[1], data[2], data[3],
            ]))
        }
        LanParameterId::CommunityString => {
            let s = String::from_utf8_lossy(data).trim_end_matches('\0').to_string();
            Ok(LanParameter::CommunityString(s))
        }
        LanParameterId::VlanId => {
            if data.len() < 2 {
                return Err(IpmiError::data_too_short("VLAN ID", 2, data.len()));
            }
            let id = u16::from_le_bytes([data[0], data[1]]);
            let enabled = (id & 0x8000) != 0;
            Ok(LanParameter::VlanId {
                id: id & 0x0FFF,
                enabled,
            })
        }
        LanParameterId::VlanPriority => {
            let priority = data.first().copied().unwrap_or(0) & 0x07;
            Ok(LanParameter::VlanPriority(priority))
        }
        LanParameterId::CipherSuiteEntrySupport => {
            let count = data.first().copied().unwrap_or(0) & 0x1F;
            Ok(LanParameter::CipherSuiteEntrySupport(count))
        }
        LanParameterId::CipherSuiteEntries => {
            let suites: Vec<u8> = data.to_vec();
            Ok(LanParameter::CipherSuiteEntries(suites))
        }
    }
}

/// Typed LAN parameter values.
#[derive(Debug, Clone)]
pub enum LanParameter {
    SetInProgress(u8),
    AuthTypeSupport(u8),
    IpAddress([u8; 4]),
    IpAddressSource(IpSource),
    MacAddress([u8; 6]),
    SubnetMask([u8; 4]),
    DefaultGateway([u8; 4]),
    DefaultGatewayMac([u8; 6]),
    BackupGateway([u8; 4]),
    CommunityString(String),
    VlanId { id: u16, enabled: bool },
    VlanPriority(u8),
    CipherSuiteEntrySupport(u8),
    CipherSuiteEntries(Vec<u8>),
}

// ═══════════════════════════════════════════════════════════════════════
// High-Level LAN Config Retrieval
// ═══════════════════════════════════════════════════════════════════════

/// Retrieve the full LAN configuration for a channel.
pub fn get_lan_config(
    session: &mut IpmiSessionHandle,
    channel: u8,
) -> IpmiResult<LanConfig> {
    debug!("Getting LAN config for channel {}", channel);

    // IP address
    let ip_address = match get_lan_param(session, channel, LanParameterId::IpAddress, 0, 0)? {
        LanParameter::IpAddress(ip) => format!("{}.{}.{}.{}", ip[0], ip[1], ip[2], ip[3]),
        _ => String::new(),
    };

    // IP source
    let ip_source = match get_lan_param(session, channel, LanParameterId::IpAddressSource, 0, 0)? {
        LanParameter::IpAddressSource(src) => src,
        _ => IpSource::Static,
    };

    // Subnet mask
    let subnet_mask =
        match get_lan_param(session, channel, LanParameterId::SubnetMask, 0, 0)? {
            LanParameter::SubnetMask(m) => format!("{}.{}.{}.{}", m[0], m[1], m[2], m[3]),
            _ => String::new(),
        };

    // MAC address
    let mac_address =
        match get_lan_param(session, channel, LanParameterId::MacAddress, 0, 0)? {
            LanParameter::MacAddress(m) => {
                format!(
                    "{:02X}:{:02X}:{:02X}:{:02X}:{:02X}:{:02X}",
                    m[0], m[1], m[2], m[3], m[4], m[5]
                )
            }
            _ => String::new(),
        };

    // Default gateway
    let default_gateway =
        match get_lan_param(session, channel, LanParameterId::DefaultGateway, 0, 0)? {
            LanParameter::DefaultGateway(g) => {
                format!("{}.{}.{}.{}", g[0], g[1], g[2], g[3])
            }
            _ => String::new(),
        };

    // Default gateway MAC (optional, may not be supported)
    let default_gateway_mac = match get_lan_param(
        session,
        channel,
        LanParameterId::DefaultGatewayMac,
        0,
        0,
    ) {
        Ok(LanParameter::DefaultGatewayMac(m)) => Some(format!(
            "{:02X}:{:02X}:{:02X}:{:02X}:{:02X}:{:02X}",
            m[0], m[1], m[2], m[3], m[4], m[5]
        )),
        _ => None,
    };

    // Backup gateway (optional)
    let backup_gateway = match get_lan_param(
        session,
        channel,
        LanParameterId::BackupGateway,
        0,
        0,
    ) {
        Ok(LanParameter::BackupGateway(g)) => {
            Some(format!("{}.{}.{}.{}", g[0], g[1], g[2], g[3]))
        }
        _ => None,
    };

    // VLAN (optional)
    let (vlan_id, vlan_enabled) = match get_lan_param(
        session,
        channel,
        LanParameterId::VlanId,
        0,
        0,
    ) {
        Ok(LanParameter::VlanId { id, enabled }) => (Some(id), enabled),
        _ => (None, false),
    };

    let vlan_priority = match get_lan_param(
        session,
        channel,
        LanParameterId::VlanPriority,
        0,
        0,
    ) {
        Ok(LanParameter::VlanPriority(p)) => Some(p),
        _ => None,
    };

    // Community string (optional)
    let community_string = match get_lan_param(
        session,
        channel,
        LanParameterId::CommunityString,
        0,
        0,
    ) {
        Ok(LanParameter::CommunityString(s)) => Some(s),
        _ => None,
    };

    // Cipher suites (optional)
    let cipher_suites = match get_lan_param(
        session,
        channel,
        LanParameterId::CipherSuiteEntries,
        0,
        0,
    ) {
        Ok(LanParameter::CipherSuiteEntries(s)) => Some(s),
        _ => None,
    };

    Ok(LanConfig {
        ip_address,
        ip_source,
        subnet_mask,
        mac_address,
        default_gateway,
        default_gateway_mac,
        backup_gateway,
        vlan_id,
        vlan_enabled,
        vlan_priority,
        community_string,
        cipher_suites,
    })
}

// ═══════════════════════════════════════════════════════════════════════
// Set Specific LAN Parameters
// ═══════════════════════════════════════════════════════════════════════

/// Set the IP address.
pub fn set_ip_address(
    session: &mut IpmiSessionHandle,
    channel: u8,
    ip: [u8; 4],
) -> IpmiResult<()> {
    info!("Setting IP address to {}.{}.{}.{}", ip[0], ip[1], ip[2], ip[3]);
    set_lan_param(session, channel, LanParameterId::IpAddress, &ip)
}

/// Set the subnet mask.
pub fn set_subnet_mask(
    session: &mut IpmiSessionHandle,
    channel: u8,
    mask: [u8; 4],
) -> IpmiResult<()> {
    set_lan_param(session, channel, LanParameterId::SubnetMask, &mask)
}

/// Set the default gateway.
pub fn set_default_gateway(
    session: &mut IpmiSessionHandle,
    channel: u8,
    gateway: [u8; 4],
) -> IpmiResult<()> {
    set_lan_param(session, channel, LanParameterId::DefaultGateway, &gateway)
}

/// Set the IP address source (static, DHCP, etc.).
pub fn set_ip_source(
    session: &mut IpmiSessionHandle,
    channel: u8,
    source: IpSource,
) -> IpmiResult<()> {
    set_lan_param(
        session,
        channel,
        LanParameterId::IpAddressSource,
        &[source.as_byte()],
    )
}

/// Set VLAN ID.
pub fn set_vlan_id(
    session: &mut IpmiSessionHandle,
    channel: u8,
    vlan_id: u16,
    enabled: bool,
) -> IpmiResult<()> {
    let mut id = vlan_id & 0x0FFF;
    if enabled {
        id |= 0x8000;
    }
    set_lan_param(
        session,
        channel,
        LanParameterId::VlanId,
        &id.to_le_bytes(),
    )
}

/// Set SNMP community string.
pub fn set_community_string(
    session: &mut IpmiSessionHandle,
    channel: u8,
    community: &str,
) -> IpmiResult<()> {
    let mut data = [0u8; 18];
    let bytes = community.as_bytes();
    let len = bytes.len().min(18);
    data[..len].copy_from_slice(&bytes[..len]);
    set_lan_param(session, channel, LanParameterId::CommunityString, &data)
}

// ═══════════════════════════════════════════════════════════════════════
// Helper Methods on Types
// ═══════════════════════════════════════════════════════════════════════

impl LanParameterId {
    /// Convert to the parameter byte.
    pub fn as_byte(&self) -> u8 {
        match self {
            Self::SetInProgress => 0,
            Self::AuthTypeSupport => 1,
            Self::IpAddress => 3,
            Self::IpAddressSource => 4,
            Self::MacAddress => 5,
            Self::SubnetMask => 6,
            Self::DefaultGateway => 12,
            Self::DefaultGatewayMac => 13,
            Self::BackupGateway => 14,
            Self::CommunityString => 16,
            Self::VlanId => 20,
            Self::VlanPriority => 21,
            Self::CipherSuiteEntrySupport => 22,
            Self::CipherSuiteEntries => 23,
        }
    }
}

impl IpSource {
    /// Convert a byte to IpSource.
    pub fn from_byte(value: u8) -> Self {
        match value & 0x0F {
            0x00 => Self::Unspecified,
            0x01 => Self::Static,
            0x02 => Self::Dhcp,
            0x03 => Self::Bios,
            _ => Self::Unspecified,
        }
    }

    /// Convert to byte.
    pub fn as_byte(&self) -> u8 {
        match self {
            Self::Unspecified => 0x00,
            Self::Static => 0x01,
            Self::Dhcp => 0x02,
            Self::Bios => 0x03,
        }
    }

    /// Get a human-readable description.
    pub fn description(&self) -> &'static str {
        match self {
            Self::Unspecified => "Unspecified",
            Self::Static => "Static",
            Self::Dhcp => "DHCP",
            Self::Bios => "BIOS/System software",
        }
    }
}

/// Parse an IP address string to 4 bytes.
pub fn parse_ip_address(ip: &str) -> IpmiResult<[u8; 4]> {
    let parts: Vec<&str> = ip.split('.').collect();
    if parts.len() != 4 {
        return Err(IpmiError::InvalidParameter(format!(
            "Invalid IP address: {}",
            ip
        )));
    }

    let mut bytes = [0u8; 4];
    for (i, part) in parts.iter().enumerate() {
        bytes[i] = part
            .parse::<u8>()
            .map_err(|_| IpmiError::InvalidParameter(format!("Invalid IP octet: {}", part)))?;
    }
    Ok(bytes)
}

/// Format 4 bytes as an IP address string.
pub fn format_ip_address(ip: &[u8; 4]) -> String {
    format!("{}.{}.{}.{}", ip[0], ip[1], ip[2], ip[3])
}

/// Format 6 bytes as a MAC address string.
pub fn format_mac_address(mac: &[u8; 6]) -> String {
    format!(
        "{:02X}:{:02X}:{:02X}:{:02X}:{:02X}:{:02X}",
        mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]
    )
}
