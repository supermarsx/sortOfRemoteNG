//! # YubiKey Configuration Manager
//!
//! Manage USB/NFC interface enable/disable, auto-eject, challenge-
//! response timeout, and configuration lock via `ykman config`.

use crate::detect::run_ykman;
use crate::types::*;
use log::info;

/// YubiKey configuration manager.
pub struct YubiKeyConfigManager {
    /// Path to `ykman` binary.
    pub ykman_path: String,
}

impl YubiKeyConfigManager {
    /// Create a new config manager.
    pub fn new(ykman_path: &str) -> Self {
        Self {
            ykman_path: ykman_path.to_string(),
        }
    }
}

/// Set the enabled USB/NFC interfaces.
pub async fn set_mode(
    ykman: &str,
    serial: Option<u32>,
    usb_interfaces: &[YubiKeyInterface],
    nfc_interfaces: &[YubiKeyInterface],
) -> Result<bool, String> {
    // Build interface strings like "OTP+FIDO2+CCID"
    let usb_str: String = usb_interfaces
        .iter()
        .map(|i| i.ykman_label().to_string())
        .collect::<Vec<_>>()
        .join("+");

    let nfc_str: String = nfc_interfaces
        .iter()
        .map(|i| i.ykman_label().to_string())
        .collect::<Vec<_>>()
        .join("+");

    let _args = ["config", "usb", "--enable-all", "--force"];

    // Use a dedicated call for USB
    if !usb_str.is_empty() {
        let usb_disable_result =
            run_ykman(ykman, serial, &["config", "usb", "--disable-all", "-f"]).await;
        if usb_disable_result.is_ok() {
            for iface in usb_interfaces {
                run_ykman(
                    ykman,
                    serial,
                    &["config", "usb", "--enable", iface.ykman_label(), "-f"],
                )
                .await?;
            }
        }
    }

    // NFC (if the device supports it)
    if !nfc_str.is_empty() {
        let nfc_disable_result =
            run_ykman(ykman, serial, &["config", "nfc", "--disable-all", "-f"]).await;
        if nfc_disable_result.is_ok() {
            for iface in nfc_interfaces {
                run_ykman(
                    ykman,
                    serial,
                    &["config", "nfc", "--enable", iface.ykman_label(), "-f"],
                )
                .await?;
            }
        }
    }

    info!("Updated interface configuration");
    Ok(true)
}

/// Set the CCID auto-eject timeout.
pub async fn set_auto_eject(
    ykman: &str,
    serial: Option<u32>,
    timeout: u16,
) -> Result<bool, String> {
    let t = timeout.to_string();
    run_ykman(
        ykman,
        serial,
        &["config", "usb", "--autoeject-timeout", &t, "-f"],
    )
    .await?;
    info!("Auto-eject timeout set to {}", timeout);
    Ok(true)
}

/// Set the challenge-response timeout.
pub async fn set_chalresp_timeout(
    ykman: &str,
    serial: Option<u32>,
    timeout: u8,
) -> Result<bool, String> {
    let t = timeout.to_string();
    run_ykman(
        ykman,
        serial,
        &["config", "usb", "--chalresp-timeout", &t, "-f"],
    )
    .await?;
    info!("Challenge-response timeout set to {}", timeout);
    Ok(true)
}

/// Toggle a specific NFC interface on/off.
pub async fn toggle_nfc_interface(
    ykman: &str,
    serial: Option<u32>,
    interface: &YubiKeyInterface,
    enable: bool,
) -> Result<bool, String> {
    let flag = if enable { "--enable" } else { "--disable" };
    run_ykman(
        ykman,
        serial,
        &["config", "nfc", flag, interface.ykman_label(), "-f"],
    )
    .await?;
    info!(
        "NFC {} {} {}",
        interface.ykman_label(),
        if enable { "enabled" } else { "disabled" },
        serial.map_or("default".to_string(), |s| s.to_string())
    );
    Ok(true)
}

/// Toggle a specific USB interface on/off.
pub async fn toggle_usb_interface(
    ykman: &str,
    serial: Option<u32>,
    interface: &YubiKeyInterface,
    enable: bool,
) -> Result<bool, String> {
    let flag = if enable { "--enable" } else { "--disable" };
    run_ykman(
        ykman,
        serial,
        &["config", "usb", flag, interface.ykman_label(), "-f"],
    )
    .await?;
    info!(
        "USB {} {} {}",
        interface.ykman_label(),
        if enable { "enabled" } else { "disabled" },
        serial.map_or("default".to_string(), |s| s.to_string())
    );
    Ok(true)
}

/// Lock the YubiKey configuration with a lock code.
pub async fn lock_config(
    ykman: &str,
    serial: Option<u32>,
    lock_code: &str,
) -> Result<bool, String> {
    run_ykman(
        ykman,
        serial,
        &["config", "set-lock-code", "-n", lock_code, "-f"],
    )
    .await?;
    info!("Configuration locked");
    Ok(true)
}

/// Unlock the YubiKey configuration with the current lock code.
pub async fn unlock_config(
    ykman: &str,
    serial: Option<u32>,
    lock_code: &str,
) -> Result<bool, String> {
    run_ykman(
        ykman,
        serial,
        &["config", "set-lock-code", "--clear", "-l", lock_code, "-f"],
    )
    .await?;
    info!("Configuration unlocked");
    Ok(true)
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_manager_new() {
        let mgr = YubiKeyConfigManager::new("/usr/bin/ykman");
        assert_eq!(mgr.ykman_path, "/usr/bin/ykman");
    }
}
