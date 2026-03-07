//! IPMI User management — get/set user access, user name get/set,
//! set password, enable/disable users, and user listing.

use crate::error::{IpmiError, IpmiResult};
use crate::protocol::{cmd, IpmiRequest};
use crate::session::IpmiSessionHandle;
use crate::types::*;
use log::{debug, info, warn};

// ═══════════════════════════════════════════════════════════════════════
// User Information Retrieval
// ═══════════════════════════════════════════════════════════════════════

/// Get user access information for a specific user on a channel.
pub fn get_user_access(
    session: &mut IpmiSessionHandle,
    channel: u8,
    user_id: u8,
) -> IpmiResult<UserAccess> {
    let req = IpmiRequest::new(
        NetFunction::App.as_byte(),
        cmd::GET_USER_ACCESS,
        vec![channel & 0x0F | 0x40, user_id & 0x3F],
    );
    let resp = session.send_request(req)?;
    resp.check()?;

    if resp.data.len() < 4 {
        return Err(IpmiError::UserError("User access response too short".into()));
    }

    let max_user_ids = resp.data[0] & 0x3F;
    let enabled_user_count = resp.data[1] & 0x3F;
    let fixed_names_count = resp.data[2] & 0x3F;

    let access_byte = resp.data[3];
    let privilege = PrivilegeLevel::from_byte(access_byte & 0x0F);
    let link_auth_enabled = (access_byte & 0x20) != 0;
    let ipmi_messaging_enabled = (access_byte & 0x10) != 0;
    let callin_allowed = (access_byte & 0x40) == 0;

    Ok(UserAccess {
        max_user_ids,
        enabled_user_count,
        fixed_names_count,
        privilege,
        link_auth_enabled,
        ipmi_messaging_enabled,
        callin_allowed,
    })
}

/// Get a user name by user ID.
pub fn get_user_name(
    session: &mut IpmiSessionHandle,
    user_id: u8,
) -> IpmiResult<String> {
    let req = IpmiRequest::new(
        NetFunction::App.as_byte(),
        cmd::GET_USER_NAME,
        vec![user_id & 0x3F],
    );
    let resp = session.send_request(req)?;
    resp.check()?;

    let name = String::from_utf8_lossy(&resp.data)
        .trim_end_matches('\0')
        .to_string();
    Ok(name)
}

/// List all users on a channel, returning their ID, name, and access info.
pub fn list_users(
    session: &mut IpmiSessionHandle,
    channel: u8,
) -> IpmiResult<Vec<IpmiUser>> {
    // First get user access to find max user IDs
    let access = get_user_access(session, channel, 1)?;
    let max = access.max_user_ids.min(20); // cap at 20 for safety

    debug!("Enumerating up to {} users on channel {}", max, channel);

    let mut users = Vec::new();

    for user_id in 1..=max {
        let name = match get_user_name(session, user_id) {
            Ok(n) => n,
            Err(_) => continue,
        };

        let user_access = match get_user_access(session, channel, user_id) {
            Ok(a) => a,
            Err(_) => continue,
        };

        let enabled = user_access.ipmi_messaging_enabled;
        let has_name = !name.is_empty();

        users.push(IpmiUser {
            user_id,
            name: if has_name { name } else { String::new() },
            enabled,
            callin: user_access.callin_allowed,
            link_auth: user_access.link_auth_enabled,
            ipmi_messaging: user_access.ipmi_messaging_enabled,
            privilege: user_access.privilege.clone(),
        });
    }

    Ok(users)
}

// ═══════════════════════════════════════════════════════════════════════
// User Modification
// ═══════════════════════════════════════════════════════════════════════

/// Set a user name.
pub fn set_user_name(
    session: &mut IpmiSessionHandle,
    user_id: u8,
    name: &str,
) -> IpmiResult<()> {
    if user_id == 0 || user_id > 63 {
        return Err(IpmiError::InvalidParameter(format!(
            "Invalid user ID: {}",
            user_id
        )));
    }
    if name.len() > 16 {
        return Err(IpmiError::InvalidParameter(
            "User name must be 16 characters or less".into(),
        ));
    }

    info!("Setting user name for user ID {}", user_id);

    let mut data = vec![user_id & 0x3F];
    let mut name_bytes = [0u8; 16];
    let len = name.len().min(16);
    name_bytes[..len].copy_from_slice(&name.as_bytes()[..len]);
    data.extend_from_slice(&name_bytes);

    let req = IpmiRequest::new(
        NetFunction::App.as_byte(),
        cmd::SET_USER_NAME,
        data,
    );
    let resp = session.send_request(req)?;
    resp.check()?;
    Ok(())
}

/// Set a user password. Operation: 0x00 = disable, 0x01 = enable,
/// 0x02 = set password, 0x03 = test password.
pub fn set_user_password(
    session: &mut IpmiSessionHandle,
    user_id: u8,
    password: &str,
    operation: UserPasswordOperation,
) -> IpmiResult<()> {
    if user_id == 0 || user_id > 63 {
        return Err(IpmiError::InvalidParameter(format!(
            "Invalid user ID: {}",
            user_id
        )));
    }

    let op = operation.as_byte();

    let mut data = vec![user_id & 0x3F, op];

    match operation {
        UserPasswordOperation::SetPassword | UserPasswordOperation::TestPassword => {
            // 16-byte or 20-byte password field
            let mut pw_bytes = [0u8; 20];
            let pw = password.as_bytes();
            let len = pw.len().min(20);
            pw_bytes[..len].copy_from_slice(&pw[..len]);

            if pw.len() > 16 {
                // Use 20-byte format, set bit 7 of user_id byte
                data[0] |= 0x80;
                data.extend_from_slice(&pw_bytes);
            } else {
                data.extend_from_slice(&pw_bytes[..16]);
            }
        }
        _ => {
            // Enable/Disable don't need password data
        }
    }

    let req = IpmiRequest::new(
        NetFunction::App.as_byte(),
        cmd::SET_USER_PASSWORD,
        data,
    );
    let resp = session.send_request(req)?;
    resp.check()?;
    Ok(())
}

/// User password operations.
#[derive(Debug, Clone, Copy)]
pub enum UserPasswordOperation {
    DisableUser,
    EnableUser,
    SetPassword,
    TestPassword,
}

impl UserPasswordOperation {
    pub fn as_byte(&self) -> u8 {
        match self {
            Self::DisableUser => 0x00,
            Self::EnableUser => 0x01,
            Self::SetPassword => 0x02,
            Self::TestPassword => 0x03,
        }
    }
}

/// Set user access for a specific channel.
pub fn set_user_access(
    session: &mut IpmiSessionHandle,
    channel: u8,
    user_id: u8,
    callin: bool,
    link_auth: bool,
    ipmi_messaging: bool,
    privilege: &PrivilegeLevel,
) -> IpmiResult<()> {
    info!(
        "Setting user {} access on channel {}: privilege={:?}",
        user_id, channel, privilege
    );

    let mut access_byte: u8 = 0x80; // bit 7: change bits in byte
    access_byte |= (channel & 0x0F) << 0;

    let mut user_byte: u8 = user_id & 0x3F;

    let mut privilege_byte: u8 = privilege.as_byte() & 0x0F;
    if !callin {
        privilege_byte |= 0x40;
    }
    if link_auth {
        privilege_byte |= 0x20;
    }
    if ipmi_messaging {
        privilege_byte |= 0x10;
    }

    // Set User Access: [channel], [user_id], [privilege/access], [session limit]
    let data = vec![
        access_byte,
        user_byte,
        privilege_byte,
        0x00, // no session limit
    ];

    let req = IpmiRequest::new(
        NetFunction::App.as_byte(),
        cmd::SET_USER_ACCESS,
        data,
    );
    let resp = session.send_request(req)?;
    resp.check()?;
    Ok(())
}

/// Enable a user (shortcut for set_user_password with enable operation).
pub fn enable_user(
    session: &mut IpmiSessionHandle,
    user_id: u8,
) -> IpmiResult<()> {
    set_user_password(session, user_id, "", UserPasswordOperation::EnableUser)
}

/// Disable a user.
pub fn disable_user(
    session: &mut IpmiSessionHandle,
    user_id: u8,
) -> IpmiResult<()> {
    set_user_password(session, user_id, "", UserPasswordOperation::DisableUser)
}

/// Test a user's password.
pub fn test_user_password(
    session: &mut IpmiSessionHandle,
    user_id: u8,
    password: &str,
) -> IpmiResult<bool> {
    match set_user_password(session, user_id, password, UserPasswordOperation::TestPassword) {
        Ok(()) => Ok(true),
        Err(IpmiError::CompletionCodeError { code, .. }) if code == 0x81 => Ok(false),
        Err(e) => Err(e),
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Helper on PrivilegeLevel
// ═══════════════════════════════════════════════════════════════════════

impl PrivilegeLevel {
    /// Convert to byte value.
    pub fn as_byte(&self) -> u8 {
        match self {
            Self::Callback => 0x01,
            Self::User => 0x02,
            Self::Operator => 0x03,
            Self::Administrator => 0x04,
            Self::Oem => 0x05,
        }
    }
}
