//! # YubiKey Device Detection
//!
//! Detects `ykman` on the system and enumerates connected YubiKey
//! devices via `ykman list` and `ykman info`.

use crate::types::*;
use log::{debug, info, warn};

/// Common install locations for `ykman` on various platforms.
const YKMAN_SEARCH_PATHS: &[&str] = &[
    // Windows
    "C:\\Program Files\\Yubico\\YubiKey Manager\\ykman.exe",
    "C:\\Program Files (x86)\\Yubico\\YubiKey Manager\\ykman.exe",
    // macOS (Homebrew)
    "/usr/local/bin/ykman",
    "/opt/homebrew/bin/ykman",
    // Linux
    "/usr/bin/ykman",
    "/usr/local/bin/ykman",
    "/snap/bin/ykman",
];

/// Try to find the `ykman` binary on the system.
///
/// Checks PATH first, then common install locations.
pub async fn detect_ykman() -> Result<String, String> {
    // 1. Check PATH
    let check = tokio::process::Command::new(if cfg!(windows) { "where" } else { "which" })
        .arg("ykman")
        .output()
        .await;

    if let Ok(output) = check {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            if !path.is_empty() {
                info!("Found ykman on PATH: {}", path);
                return Ok(path);
            }
        }
    }

    // 2. Check common locations
    for candidate in YKMAN_SEARCH_PATHS {
        if tokio::fs::metadata(candidate).await.is_ok() {
            info!("Found ykman at: {}", candidate);
            return Ok(candidate.to_string());
        }
    }

    Err("ykman not found. Please install YubiKey Manager (ykman).".to_string())
}

/// Run a `ykman` command and return stdout.
pub(crate) async fn run_ykman(
    ykman: &str,
    serial: Option<u32>,
    args: &[&str],
) -> Result<String, String> {
    let mut cmd = tokio::process::Command::new(ykman);

    // Target a specific device by serial
    if let Some(s) = serial {
        cmd.args(["--device", &s.to_string()]);
    }

    cmd.args(args);

    debug!("Running ykman {:?}", cmd);

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to run ykman: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        Err(format!(
            "ykman command failed (exit {}): {}{}",
            output.status.code().unwrap_or(-1),
            stderr,
            if stdout.is_empty() {
                String::new()
            } else {
                format!("\nstdout: {}", stdout)
            }
        ))
    }
}

/// List all connected YubiKey serial numbers.
pub async fn list_serials(ykman: &str) -> Result<Vec<u32>, String> {
    let output = run_ykman(ykman, None, &["list", "--serials"]).await?;
    let mut serials = Vec::new();
    for line in output.lines() {
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            if let Ok(s) = trimmed.parse::<u32>() {
                serials.push(s);
            }
        }
    }
    Ok(serials)
}

/// Enumerate all connected YubiKey devices.
pub async fn list_devices(ykman: &str) -> Result<Vec<YubiKeyDevice>, String> {
    let serials = list_serials(ykman).await?;
    let mut devices = Vec::with_capacity(serials.len());

    for serial in serials {
        match get_device_info(ykman, Some(serial)).await {
            Ok(dev) => devices.push(dev),
            Err(e) => {
                warn!("Could not get info for serial {}: {}", serial, e);
            }
        }
    }

    Ok(devices)
}

/// Get detailed info for a single YubiKey.
pub async fn get_device_info(ykman: &str, serial: Option<u32>) -> Result<YubiKeyDevice, String> {
    let output = run_ykman(ykman, serial, &["info"]).await?;
    let mut device = parse_ykman_info(&output);
    // If serial was specified but not parsed, fill it in
    if device.serial == 0 {
        if let Some(s) = serial {
            device.serial = s;
        }
    }
    Ok(device)
}

/// Parse the output of `ykman info` into a `YubiKeyDevice`.
pub fn parse_ykman_info(output: &str) -> YubiKeyDevice {
    let mut device = YubiKeyDevice::default();

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        if let Some((key, value)) = line.split_once(':') {
            let key = key.trim().to_lowercase();
            let value = value.trim();

            match key.as_str() {
                "device type" | "device name" => {
                    device.device_name = value.to_string();
                    device.form_factor = FormFactor::from_str_label(value);
                    device.is_fips = value.to_lowercase().contains("fips");
                    device.is_sky = value.to_lowercase().contains("security key");
                }
                "serial number" | "serial" => {
                    if let Ok(s) = value.parse::<u32>() {
                        device.serial = s;
                    }
                }
                "firmware version" | "firmware" => {
                    device.firmware_version = value.to_string();
                }
                "form factor" => {
                    device.form_factor = FormFactor::from_str_label(value);
                }
                "nfc transport" | "nfc supported" => {
                    device.has_nfc = value.to_lowercase() != "no"
                        && value.to_lowercase() != "false"
                        && value.to_lowercase() != "disabled";
                }
                "usb enabled" | "usb interfaces" => {
                    device.usb_interfaces_enabled = value
                        .split('+')
                        .filter_map(|s| YubiKeyInterface::from_str_label(s.trim()))
                        .collect();
                }
                "nfc enabled" | "nfc interfaces" => {
                    device.nfc_interfaces_enabled = value
                        .split('+')
                        .filter_map(|s| YubiKeyInterface::from_str_label(s.trim()))
                        .collect();
                    if !device.nfc_interfaces_enabled.is_empty() {
                        device.has_nfc = true;
                    }
                }
                "pin complexity" => {
                    device.pin_complexity =
                        value == "1" || value.to_lowercase() == "true" || value.to_lowercase() == "enabled";
                }
                "fips approved" | "fips" => {
                    device.is_fips =
                        value == "1" || value.to_lowercase() == "true" || value.to_lowercase() == "yes";
                }
                "configuration locked" | "config locked" => {
                    device.config_locked = value.to_lowercase() == "true"
                        || value.to_lowercase() == "yes"
                        || value == "1";
                }
                "auto-eject timeout" | "auto eject timeout" => {
                    device.auto_eject_timeout = value.parse().unwrap_or(0);
                }
                "challenge-response timeout" | "chalresp timeout" => {
                    device.challenge_response_timeout = value.parse().unwrap_or(15);
                }
                _ => {
                    // Collect unknown keys as device flags
                    if !value.is_empty() {
                        device
                            .device_flags
                            .push(format!("{}={}", key.trim(), value));
                    }
                }
            }
        }
    }

    device
}

/// Wait for a YubiKey device to be inserted, polling up to `timeout_ms`.
pub async fn wait_for_device(ykman: &str, timeout_ms: u64) -> Option<YubiKeyDevice> {
    let poll_interval = std::time::Duration::from_millis(500);
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms);

    while std::time::Instant::now() < deadline {
        if let Ok(devices) = list_devices(ykman).await {
            if let Some(dev) = devices.into_iter().next() {
                return Some(dev);
            }
        }
        tokio::time::sleep(poll_interval).await;
    }

    None
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_ykman_info_basic() {
        let output = "\
Device type: YubiKey 5 NFC
Serial number: 12345678
Firmware version: 5.4.3
Form Factor: USB-A Keychain
NFC transport: yes
USB enabled: OTP+FIDO+CCID
NFC enabled: OTP+FIDO+CCID
PIN complexity: 0
Configuration locked: false
";
        let device = parse_ykman_info(output);
        assert_eq!(device.serial, 12345678);
        assert_eq!(device.firmware_version, "5.4.3");
        assert_eq!(device.form_factor, FormFactor::UsbAKeychain);
        assert!(device.has_nfc);
        assert_eq!(device.usb_interfaces_enabled.len(), 3);
        assert_eq!(device.nfc_interfaces_enabled.len(), 3);
        assert!(!device.config_locked);
    }

    #[test]
    fn test_parse_ykman_info_fips() {
        let output = "\
Device type: YubiKey 5 FIPS
Serial number: 99887766
Firmware version: 5.4.2
Form Factor: USB-A Keychain
FIPS Approved: yes
USB enabled: FIDO+CCID
";
        let device = parse_ykman_info(output);
        assert!(device.is_fips);
        assert_eq!(device.serial, 99887766);
        assert_eq!(device.usb_interfaces_enabled.len(), 2);
    }

    #[test]
    fn test_parse_ykman_info_usb_c_nano() {
        let output = "\
Device type: YubiKey 5C Nano
Serial number: 11223344
Firmware version: 5.2.7
Form Factor: USB-C Nano
";
        let device = parse_ykman_info(output);
        assert_eq!(device.form_factor, FormFactor::UsbCNano);
    }

    #[test]
    fn test_parse_ykman_info_empty() {
        let device = parse_ykman_info("");
        assert_eq!(device.serial, 0);
        assert_eq!(device.form_factor, FormFactor::Unknown);
    }

    #[test]
    fn test_parse_ykman_info_security_key() {
        let output = "\
Device type: Security Key NFC
Serial number: 55667788
Firmware version: 5.1.0
";
        let device = parse_ykman_info(output);
        assert!(device.is_sky);
    }
}
