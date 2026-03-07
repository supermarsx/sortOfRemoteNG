//! Chassis subsystem operations — power status, power control, identify,
//! boot device selection, restart cause, power-on hours, and system info.

use crate::error::{IpmiError, IpmiResult};
use crate::protocol::{cmd, IpmiRequest};
use crate::session::IpmiSessionHandle;
use crate::types::*;
use log::{debug, info};

// ═══════════════════════════════════════════════════════════════════════
// Chassis Status
// ═══════════════════════════════════════════════════════════════════════

/// Parse a Get Chassis Status response into a `ChassisStatus`.
pub fn parse_chassis_status(data: &[u8]) -> IpmiResult<ChassisStatus> {
    if data.len() < 3 {
        return Err(IpmiError::InvalidResponse(
            "Chassis status response too short".into(),
        ));
    }

    let current_power = data[0];
    let last_power_event = data[1];
    let misc = data[2];

    Ok(ChassisStatus {
        power_on: (current_power & 0x01) != 0,
        power_overload: (current_power & 0x02) != 0,
        power_interlock: (current_power & 0x04) != 0,
        power_fault: (current_power & 0x08) != 0,
        power_control_fault: (current_power & 0x10) != 0,
        power_restore_policy: PowerRestorePolicy::from_bits((current_power >> 5) & 0x03),
        last_power_event,
        ac_failed: (last_power_event & 0x01) != 0,
        power_down_overload: (last_power_event & 0x02) != 0,
        power_down_interlock: (last_power_event & 0x04) != 0,
        power_down_fault: (last_power_event & 0x08) != 0,
        power_down_ipmi: (last_power_event & 0x10) != 0,
        chassis_intrusion: (misc & 0x01) != 0,
        front_panel_lockout: (misc & 0x02) != 0,
        drive_fault: (misc & 0x04) != 0,
        cooling_fault: (misc & 0x08) != 0,
    })
}

/// Get the chassis power status.
pub fn get_chassis_status(session: &mut IpmiSessionHandle) -> IpmiResult<ChassisStatus> {
    let req = IpmiRequest::new(NetFunction::Chassis.as_byte(), cmd::GET_CHASSIS_STATUS, vec![]);
    let resp = session.send_request(req)?;
    resp.check()?;
    parse_chassis_status(&resp.data)
}

// ═══════════════════════════════════════════════════════════════════════
// Power Control
// ═══════════════════════════════════════════════════════════════════════

/// Send a chassis control command (power on/off/cycle/reset/soft-shutdown/diag).
pub fn chassis_control(
    session: &mut IpmiSessionHandle,
    action: ChassisControl,
) -> IpmiResult<()> {
    info!("Sending chassis control: {:?}", action);
    let req = IpmiRequest::new(
        NetFunction::Chassis.as_byte(),
        cmd::CHASSIS_CONTROL,
        vec![action as u8],
    );
    let resp = session.send_request(req)?;
    resp.check()?;
    Ok(())
}

/// Power on the chassis.
pub fn power_on(session: &mut IpmiSessionHandle) -> IpmiResult<()> {
    chassis_control(session, ChassisControl::PowerUp)
}

/// Power off the chassis.
pub fn power_off(session: &mut IpmiSessionHandle) -> IpmiResult<()> {
    chassis_control(session, ChassisControl::PowerDown)
}

/// Power cycle the chassis.
pub fn power_cycle(session: &mut IpmiSessionHandle) -> IpmiResult<()> {
    chassis_control(session, ChassisControl::PowerCycle)
}

/// Hard reset the chassis.
pub fn hard_reset(session: &mut IpmiSessionHandle) -> IpmiResult<()> {
    chassis_control(session, ChassisControl::HardReset)
}

/// Soft shutdown via ACPI.
pub fn soft_shutdown(session: &mut IpmiSessionHandle) -> IpmiResult<()> {
    chassis_control(session, ChassisControl::SoftShutdown)
}

/// Send diagnostic interrupt.
pub fn diagnostic_interrupt(session: &mut IpmiSessionHandle) -> IpmiResult<()> {
    chassis_control(session, ChassisControl::DiagInterrupt)
}

// ═══════════════════════════════════════════════════════════════════════
// Chassis Identify
// ═══════════════════════════════════════════════════════════════════════

/// Chassis Identify — blink the chassis LED for identification.
///
/// `duration_secs`: 0 = turn off, 1-255 = seconds, `force` overrides BMC timer limit.
pub fn chassis_identify(
    session: &mut IpmiSessionHandle,
    duration_secs: u8,
    force: bool,
) -> IpmiResult<()> {
    let mut data = vec![duration_secs];
    if force {
        data.push(0x01); // Force identify on
    }
    info!(
        "Chassis identify: {} seconds, force={}",
        duration_secs, force
    );
    let req = IpmiRequest::new(NetFunction::Chassis.as_byte(), cmd::CHASSIS_IDENTIFY, data);
    let resp = session.send_request(req)?;
    resp.check()?;
    Ok(())
}

/// Turn off chassis identify.
pub fn chassis_identify_off(session: &mut IpmiSessionHandle) -> IpmiResult<()> {
    chassis_identify(session, 0, false)
}

// ═══════════════════════════════════════════════════════════════════════
// Boot Device
// ═══════════════════════════════════════════════════════════════════════

/// Set the boot device for the next chassis restart.
///
/// # Parameters
/// - `device`: The boot device to set.
/// - `persistent`: If true, the setting persists across restarts.
/// - `efi`: If true, use EFI boot.
pub fn set_boot_device(
    session: &mut IpmiSessionHandle,
    device: BootDevice,
    persistent: bool,
    efi: bool,
) -> IpmiResult<()> {
    info!(
        "Setting boot device: {:?}, persistent={}, efi={}",
        device, persistent, efi
    );

    // First set boot flag valid bit (parameter 5, selector 4)
    let param5_set4 = vec![
        0x05, // parameter selector
        0x80, // boot flag valid, all others clear
        0x00, 0x00, 0x00,
    ];
    let req = IpmiRequest::new(
        NetFunction::Chassis.as_byte(),
        cmd::SET_SYSTEM_BOOT_OPTIONS,
        param5_set4,
    );
    let resp = session.send_request(req)?;
    resp.check()?;

    // Now set boot device (parameter 5)
    let mut byte2: u8 = device as u8;
    if persistent {
        byte2 |= 0x40;
    }
    if efi {
        byte2 |= 0x20;
    }
    byte2 |= 0x80; // boot flag valid

    let param5 = vec![0x05, byte2, 0x00, 0x00, 0x00];
    let req = IpmiRequest::new(
        NetFunction::Chassis.as_byte(),
        cmd::SET_SYSTEM_BOOT_OPTIONS,
        param5,
    );
    let resp = session.send_request(req)?;
    resp.check()?;
    Ok(())
}

/// Get the current boot options.
pub fn get_boot_options(session: &mut IpmiSessionHandle) -> IpmiResult<BootOptions> {
    // Get boot flags (parameter 5)
    let req = IpmiRequest::new(
        NetFunction::Chassis.as_byte(),
        cmd::GET_SYSTEM_BOOT_OPTIONS,
        vec![0x05, 0x00, 0x00],
    );
    let resp = session.send_request(req)?;
    resp.check()?;

    if resp.data.len() < 5 {
        return Err(IpmiError::InvalidResponse(
            "Boot options response too short".into(),
        ));
    }

    // data[0] = parameter version
    // data[1] = parameter valid (bit 7) + parameter selector
    // data[2..] = boot flags
    let valid = (resp.data[1] & 0x80) != 0;
    let flags = if resp.data.len() >= 4 {
        &resp.data[2..]
    } else {
        return Err(IpmiError::InvalidResponse("Boot flags too short".into()));
    };

    let byte1 = flags[0];
    let byte2 = if flags.len() > 1 { flags[1] } else { 0 };
    let byte3 = if flags.len() > 2 { flags[2] } else { 0 };

    Ok(BootOptions {
        boot_device: BootDevice::from_byte(byte1),
        persistent: (byte1 & 0x40) != 0,
        efi_boot: (byte1 & 0x20) != 0,
        bios_verbosity: (byte2 >> 5) & 0x03,
        console_redirection: byte2 & 0x03,
        bios_mux_override: (byte3 >> 2) & 0x07,
        valid,
    })
}

// ═══════════════════════════════════════════════════════════════════════
// Restart Cause
// ═══════════════════════════════════════════════════════════════════════

/// Get the system restart cause.
pub fn get_restart_cause(session: &mut IpmiSessionHandle) -> IpmiResult<RestartCause> {
    let req = IpmiRequest::new(
        NetFunction::Chassis.as_byte(),
        cmd::GET_RESTART_CAUSE,
        vec![],
    );
    let resp = session.send_request(req)?;
    resp.check()?;
    if resp.data.is_empty() {
        return Err(IpmiError::InvalidResponse(
            "Empty restart cause response".into(),
        ));
    }
    Ok(RestartCause::from_byte(resp.data[0]))
}

// ═══════════════════════════════════════════════════════════════════════
// Power-On Hours
// ═══════════════════════════════════════════════════════════════════════

/// Get the power-on hours counter.
pub fn get_power_on_hours(session: &mut IpmiSessionHandle) -> IpmiResult<PowerOnHours> {
    let req = IpmiRequest::new(
        NetFunction::Chassis.as_byte(),
        cmd::GET_POH_COUNTER,
        vec![],
    );
    let resp = session.send_request(req)?;
    resp.check()?;

    if resp.data.len() < 5 {
        return Err(IpmiError::InvalidResponse(
            "POH counter response too short".into(),
        ));
    }

    let minutes_per_count = resp.data[0];
    let counter = u32::from_le_bytes([resp.data[1], resp.data[2], resp.data[3], resp.data[4]]);
    let total_hours = (counter as f64 * minutes_per_count as f64) / 60.0;

    Ok(PowerOnHours {
        minutes_per_count,
        counter,
        total_hours,
    })
}

// ═══════════════════════════════════════════════════════════════════════
// Device ID / System Info
// ═══════════════════════════════════════════════════════════════════════

/// Get device ID information from the BMC.
pub fn get_device_id(session: &mut IpmiSessionHandle) -> IpmiResult<IpmiDeviceId> {
    let req = IpmiRequest::new(
        NetFunction::App.as_byte(),
        cmd::GET_DEVICE_ID,
        vec![],
    );
    let resp = session.send_request(req)?;
    resp.check()?;

    if resp.data.len() < 11 {
        return Err(IpmiError::InvalidResponse(
            "Device ID response too short".into(),
        ));
    }

    let device_id = resp.data[0];
    let device_revision = resp.data[1] & 0x0F;
    let firmware_major = resp.data[2] & 0x7F;
    let firmware_minor_bcd = resp.data[3];
    let firmware_minor = format!(
        "{:02}",
        (firmware_minor_bcd >> 4) * 10 + (firmware_minor_bcd & 0x0F)
    );
    let ipmi_version_byte = resp.data[4];
    let ipmi_version = format!("{}.{}", ipmi_version_byte & 0x0F, (ipmi_version_byte >> 4) & 0x0F);
    let additional_device_support = resp.data[5];
    let manufacturer_id = u32::from_le_bytes([resp.data[6], resp.data[7], resp.data[8], 0x00]);
    let product_id = u16::from_le_bytes([resp.data[9], resp.data[10]]);
    let aux_firmware_revision = if resp.data.len() >= 15 {
        Some(resp.data[11..15].to_vec())
    } else {
        None
    };

    Ok(IpmiDeviceId {
        device_id,
        device_revision,
        firmware_major,
        firmware_minor,
        ipmi_version,
        additional_device_support,
        manufacturer_id,
        product_id,
        aux_firmware_revision,
        sdr_repository_support: (additional_device_support & 0x02) != 0,
        sel_device_support: (additional_device_support & 0x04) != 0,
        fru_inventory_support: (additional_device_support & 0x08) != 0,
        ipmb_event_receiver_support: (additional_device_support & 0x10) != 0,
        ipmb_event_generator_support: (additional_device_support & 0x20) != 0,
        chassis_device_support: (additional_device_support & 0x80) != 0,
    })
}

/// Helper: Parse a chassis control string into the enum.
pub fn parse_chassis_control_action(action: &str) -> IpmiResult<ChassisControl> {
    ChassisControl::from_str_name(action).ok_or_else(|| {
        IpmiError::InvalidParameter(format!(
            "Unknown chassis control action '{}'. Valid: on, off, cycle, reset, soft, diag",
            action
        ))
    })
}
