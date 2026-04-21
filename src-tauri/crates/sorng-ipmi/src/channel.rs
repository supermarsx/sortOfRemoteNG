//! IPMI Channel management — get channel info, get/set channel access,
//! authentication capabilities, and cipher suite records.

use crate::error::{IpmiError, IpmiResult};
use crate::protocol::{cmd, IpmiRequest};
use crate::session::IpmiSessionHandle;
use crate::types::*;
use log::{debug, info};

// ═══════════════════════════════════════════════════════════════════════
// Channel Information
// ═══════════════════════════════════════════════════════════════════════

/// Get channel information for a specific channel.
pub fn get_channel_info(session: &mut IpmiSessionHandle, channel: u8) -> IpmiResult<ChannelInfo> {
    let req = IpmiRequest::new(
        NetFunction::App.as_byte(),
        cmd::GET_CHANNEL_INFO,
        vec![channel & 0x0F],
    );
    let resp = session.send_request(req)?;
    resp.check()?;

    if resp.data.len() < 9 {
        return Err(IpmiError::ChannelError(
            "Channel info response too short".into(),
        ));
    }

    let actual_channel = resp.data[0] & 0x0F;
    let medium_type = ChannelMedium::from_byte(resp.data[1] & 0x7F);
    let protocol_type = ChannelProtocol::from_byte(resp.data[2] & 0x1F);

    // Session support from bits [7:6] of byte 3
    let session_support = match (resp.data[3] >> 6) & 0x03 {
        0x00 => "Session-less",
        0x01 => "Single-session",
        0x02 => "Multi-session",
        0x03 => "Session-based",
        _ => "Unknown",
    };

    // Vendor ID (bytes 4-6, 3 bytes IANA)
    let vendor_id = u32::from_le_bytes([resp.data[4], resp.data[5], resp.data[6], 0x00]);

    // Auxiliary info (bytes 7-8)
    let _aux_info = u16::from_le_bytes([resp.data[7], resp.data[8]]);

    Ok(ChannelInfo {
        channel_number: actual_channel,
        medium_type,
        protocol_type,
        session_support: session_support.to_string(),
        vendor_id,
    })
}

/// Enumerate all valid channels (typically 0-15).
pub fn list_channels(session: &mut IpmiSessionHandle) -> IpmiResult<Vec<ChannelInfo>> {
    let mut channels = Vec::new();
    for ch in 0..16u8 {
        match get_channel_info(session, ch) {
            Ok(info) => channels.push(info),
            Err(_) => {
                // Channel doesn't exist or is not accessible
                debug!("Channel {} not available", ch);
            }
        }
    }
    Ok(channels)
}

// ═══════════════════════════════════════════════════════════════════════
// Channel Access
// ═══════════════════════════════════════════════════════════════════════

/// Access type for get/set operations.
#[derive(Debug, Clone, Copy)]
pub enum ChannelAccessType {
    /// Get non-volatile settings.
    NonVolatile,
    /// Get current volatile settings.
    Volatile,
}

impl ChannelAccessType {
    fn as_byte(&self) -> u8 {
        match self {
            Self::NonVolatile => 0x40,
            Self::Volatile => 0x80,
        }
    }
}

/// Get channel access settings.
pub fn get_channel_access(
    session: &mut IpmiSessionHandle,
    channel: u8,
    access_type: ChannelAccessType,
) -> IpmiResult<ChannelAccess> {
    let req = IpmiRequest::new(
        NetFunction::App.as_byte(),
        cmd::GET_CHANNEL_ACCESS,
        vec![channel & 0x0F, access_type.as_byte()],
    );
    let resp = session.send_request(req)?;
    resp.check()?;

    if resp.data.len() < 2 {
        return Err(IpmiError::ChannelError(
            "Channel access response too short".into(),
        ));
    }

    let access_byte = resp.data[0];
    let privilege_byte = resp.data[1];

    let alerting_enabled = (access_byte & 0x20) == 0; // bit 5: 0 = enabled
    let per_msg_auth_disabled = (access_byte & 0x10) != 0;
    let user_level_auth_disabled = (access_byte & 0x08) != 0;
    let access_mode = access_byte & 0x07;

    let max_privilege = PrivilegeLevel::from_byte(privilege_byte & 0x0F);

    Ok(ChannelAccess {
        alerting_enabled,
        per_msg_auth_disabled,
        user_level_auth_disabled,
        access_mode,
        max_privilege,
    })
}

/// Set channel access settings.
pub fn set_channel_access(
    session: &mut IpmiSessionHandle,
    channel: u8,
    access: &ChannelAccess,
    set_volatile: bool,
    set_non_volatile: bool,
) -> IpmiResult<()> {
    info!(
        "Setting channel {} access: mode={}, max_privilege={:?}",
        channel, access.access_mode, access.max_privilege
    );

    let mut access_byte: u8 = access.access_mode & 0x07;
    if !access.alerting_enabled {
        access_byte |= 0x20;
    }
    if access.per_msg_auth_disabled {
        access_byte |= 0x10;
    }
    if access.user_level_auth_disabled {
        access_byte |= 0x08;
    }
    // Bits [7:6]: 00 = don't set, 01 = set non-volatile, 10 = set volatile
    if set_non_volatile {
        access_byte |= 0x40;
    }
    if set_volatile {
        access_byte |= 0x80;
    }

    let mut privilege_byte: u8 = access.max_privilege.as_byte() & 0x0F;
    if set_non_volatile {
        privilege_byte |= 0x40;
    }
    if set_volatile {
        privilege_byte |= 0x80;
    }

    let req = IpmiRequest::new(
        NetFunction::App.as_byte(),
        cmd::SET_CHANNEL_ACCESS,
        vec![channel & 0x0F, access_byte, privilege_byte],
    );
    let resp = session.send_request(req)?;
    resp.check()?;
    Ok(())
}

/// Channel access settings.
#[derive(Debug, Clone)]
pub struct ChannelAccess {
    pub alerting_enabled: bool,
    pub per_msg_auth_disabled: bool,
    pub user_level_auth_disabled: bool,
    pub access_mode: u8,
    pub max_privilege: PrivilegeLevel,
}

impl ChannelAccess {
    /// Get the access mode description.
    pub fn access_mode_description(&self) -> &'static str {
        match self.access_mode {
            0 => "Disabled",
            1 => "Pre-boot only",
            2 => "Always available",
            3 => "Shared",
            _ => "Unknown",
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Channel Authentication Capabilities
// ═══════════════════════════════════════════════════════════════════════

/// Get channel authentication capabilities.
pub fn get_channel_auth_capabilities(
    session: &mut IpmiSessionHandle,
    channel: u8,
    privilege: PrivilegeLevel,
) -> IpmiResult<ChannelAuthCapabilities> {
    let req = IpmiRequest::new(
        NetFunction::App.as_byte(),
        cmd::GET_CHANNEL_AUTH_CAP,
        vec![channel & 0x0F | 0x80, privilege.as_byte()],
    );
    let resp = session.send_request(req)?;
    resp.check()?;

    if resp.data.len() < 8 {
        return Err(IpmiError::ChannelError(
            "Auth capabilities response too short".into(),
        ));
    }

    let actual_channel = resp.data[0] & 0x0F;
    let auth_type_flags = resp.data[1];

    let none = (auth_type_flags & 0x01) != 0;
    let md2 = (auth_type_flags & 0x02) != 0;
    let md5 = (auth_type_flags & 0x04) != 0;
    let password = (auth_type_flags & 0x10) != 0;
    let oem = (auth_type_flags & 0x20) != 0;

    let kg_status = resp.data[2];
    let kg_set = (kg_status & 0x20) != 0;
    let per_msg_auth = (kg_status & 0x10) != 0;
    let user_level_auth = (kg_status & 0x08) != 0;
    let non_null_users = (kg_status & 0x04) != 0;
    let null_users = (kg_status & 0x02) != 0;
    let anonymous = (kg_status & 0x01) != 0;

    let supports_v20 = (resp.data[3] & 0x02) != 0;
    let supports_v15 = (resp.data[3] & 0x01) != 0;

    // OEM ID (bytes 4-6)
    let oem_id = u32::from_le_bytes([resp.data[4], resp.data[5], resp.data[6], 0]);
    let oem_aux = resp.data[7];

    Ok(ChannelAuthCapabilities {
        channel: actual_channel,
        auth_none: none,
        auth_md2: md2,
        auth_md5: md5,
        auth_password: password,
        auth_oem: oem,
        kg_set,
        per_message_auth: per_msg_auth,
        user_level_auth,
        non_null_users,
        null_users,
        anonymous_login: anonymous,
        supports_v15,
        supports_v20,
        oem_id,
        oem_aux,
    })
}

/// Channel authentication capabilities.
#[derive(Debug, Clone)]
pub struct ChannelAuthCapabilities {
    pub channel: u8,
    pub auth_none: bool,
    pub auth_md2: bool,
    pub auth_md5: bool,
    pub auth_password: bool,
    pub auth_oem: bool,
    pub kg_set: bool,
    pub per_message_auth: bool,
    pub user_level_auth: bool,
    pub non_null_users: bool,
    pub null_users: bool,
    pub anonymous_login: bool,
    pub supports_v15: bool,
    pub supports_v20: bool,
    pub oem_id: u32,
    pub oem_aux: u8,
}

// ═══════════════════════════════════════════════════════════════════════
// Cipher Suites
// ═══════════════════════════════════════════════════════════════════════

/// Get cipher suite records for a channel.
pub fn get_channel_cipher_suites(
    session: &mut IpmiSessionHandle,
    channel: u8,
) -> IpmiResult<Vec<CipherSuite>> {
    let mut all_data = Vec::new();
    let mut index: u8 = 0;

    // Read cipher suite records in 16-byte chunks
    loop {
        let req = IpmiRequest::new(
            NetFunction::App.as_byte(),
            cmd::GET_CHANNEL_CIPHER_SUITES,
            vec![channel & 0x0F, 0x00, index | 0x80],
        );
        let resp = session.send_request(req)?;
        resp.check()?;

        if resp.data.is_empty() {
            break;
        }

        // First byte is channel, rest is cipher suite data
        let chunk = if resp.data.len() > 1 {
            &resp.data[1..]
        } else {
            break;
        };

        all_data.extend_from_slice(chunk);

        // If we got less than 16 bytes of data, that's the last record
        if chunk.len() < 16 {
            break;
        }

        index += 1;
        if index > 0x3F {
            break; // safety limit
        }
    }

    parse_cipher_suite_records(&all_data)
}

/// Parse cipher suite record data into structured suites.
fn parse_cipher_suite_records(data: &[u8]) -> IpmiResult<Vec<CipherSuite>> {
    let mut suites = Vec::new();
    let mut i = 0;

    while i < data.len() {
        // Start of standard cipher suite record (0xC0) or OEM (0xC1)
        let tag = data[i];
        if tag == 0xC0 {
            // Standard cipher suite: tag + suite ID + auth + integrity + confidentiality
            if i + 4 >= data.len() {
                break;
            }
            let suite_id = data[i + 1];
            let auth_alg = data[i + 2] & 0x3F;
            let integrity_alg = data[i + 3] & 0x3F;
            let confidentiality_alg = data[i + 4] & 0x3F;

            suites.push(CipherSuite {
                id: suite_id,
                auth_algorithm: auth_alg_name(auth_alg),
                integrity_algorithm: integrity_alg_name(integrity_alg),
                confidentiality_algorithm: confidentiality_alg_name(confidentiality_alg),
            });
            i += 5;
        } else if tag == 0xC1 {
            // OEM cipher suite: tag + OEM IANA (3 bytes) + suite ID + auth + integ + conf
            if i + 7 >= data.len() {
                break;
            }
            let suite_id = data[i + 4];
            let auth_alg = data[i + 5] & 0x3F;
            let integrity_alg = data[i + 6] & 0x3F;
            let confidentiality_alg = data[i + 7] & 0x3F;

            suites.push(CipherSuite {
                id: suite_id,
                auth_algorithm: format!("OEM-{}", auth_alg_name(auth_alg)),
                integrity_algorithm: format!("OEM-{}", integrity_alg_name(integrity_alg)),
                confidentiality_algorithm: format!(
                    "OEM-{}",
                    confidentiality_alg_name(confidentiality_alg)
                ),
            });
            i += 8;
        } else {
            // Skip unknown tags
            i += 1;
        }
    }

    Ok(suites)
}

/// Authentication algorithm name.
fn auth_alg_name(alg: u8) -> String {
    match alg {
        0x00 => "RAKP-none".into(),
        0x01 => "RAKP-HMAC-SHA1".into(),
        0x02 => "RAKP-HMAC-MD5".into(),
        0x03 => "RAKP-HMAC-SHA256".into(),
        _ => format!("Unknown(0x{:02X})", alg),
    }
}

/// Integrity algorithm name.
fn integrity_alg_name(alg: u8) -> String {
    match alg {
        0x00 => "None".into(),
        0x01 => "HMAC-SHA1-96".into(),
        0x02 => "HMAC-MD5-128".into(),
        0x03 => "MD5-128".into(),
        0x04 => "HMAC-SHA256-128".into(),
        _ => format!("Unknown(0x{:02X})", alg),
    }
}

/// Confidentiality algorithm name.
fn confidentiality_alg_name(alg: u8) -> String {
    match alg {
        0x00 => "None".into(),
        0x01 => "AES-CBC-128".into(),
        0x02 => "xRC4-128".into(),
        0x03 => "xRC4-40".into(),
        _ => format!("Unknown(0x{:02X})", alg),
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Channel Medium / Protocol Helpers
// ═══════════════════════════════════════════════════════════════════════

impl ChannelMedium {
    pub fn from_byte(value: u8) -> Self {
        match value {
            0x01 => Self::Ipmb,
            0x02 => Self::IcmbV10,
            0x03 => Self::IcmbV09,
            0x04 => Self::Lan8023,
            0x05 => Self::Serial,
            0x06 => Self::OtherLan,
            0x07 => Self::PciSmbus,
            0x08 => Self::SmBusV11,
            0x09 => Self::SmBusV20,
            0x0C => Self::SystemInterface,
            _ => Self::Reserved,
        }
    }

    pub fn description(&self) -> &'static str {
        match self {
            Self::Ipmb => "IPMB (I2C)",
            Self::IcmbV10 => "ICMB v1.0",
            Self::IcmbV09 => "ICMB v0.9",
            Self::Lan8023 => "802.3 LAN",
            Self::Serial => "Serial/Modem",
            Self::OtherLan => "Other LAN",
            Self::PciSmbus => "PCI SMBus",
            Self::SmBusV11 => "SMBus v1.1",
            Self::SmBusV20 => "SMBus v2.0",
            Self::SystemInterface => "System Interface",
            Self::Reserved => "Reserved",
        }
    }
}

impl ChannelProtocol {
    pub fn from_byte(value: u8) -> Self {
        match value {
            0x01 => Self::Ipmb,
            0x02 => Self::IcmbV10,
            0x03 => Self::IcmbV09,
            0x04 => Self::Ipmi,
            0x05 => Self::Kcs,
            0x06 => Self::Smic,
            0x07 => Self::Bt10,
            0x08 => Self::Bt15,
            0x09 => Self::TMode,
            _ => Self::Reserved,
        }
    }

    pub fn description(&self) -> &'static str {
        match self {
            Self::Ipmb => "IPMB-1.0",
            Self::IcmbV10 => "ICMB-1.0",
            Self::IcmbV09 => "ICMB-0.9",
            Self::Ipmi => "IPMI-SMBus",
            Self::Kcs => "KCS",
            Self::Smic => "SMIC",
            Self::Bt10 => "BT-10",
            Self::Bt15 => "BT-15",
            Self::TMode => "TMode",
            Self::Reserved => "Reserved",
        }
    }
}
