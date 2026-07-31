//! # YubiKey Device Detection
//!
//! Detects `ykman` on the system and enumerates connected YubiKey
//! devices via `ykman list` and `ykman info`.

use crate::types::*;
use log::{debug, info, warn};
use std::io;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};

const YKMAN_TIMEOUT: Duration = Duration::from_secs(120);
const YKMAN_STDIN_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_YKMAN_OUTPUT_BYTES: usize = 4 * 1024 * 1024;
const MAX_PROMPT_VALUE_BYTES: usize = 16 * 1024;
const MAX_PROMPT_INPUT_BYTES: usize = 64 * 1024;
const MAX_SENSITIVE_STDIN_BYTES: usize = 1024 * 1024;

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
    run_ykman_inner(ykman, serial, args, None).await
}

/// Run a `ykman` command and answer its interactive prompts over stdin.
///
/// `ykman`'s prompt wrapper explicitly reads one line at a time when stdin is
/// piped. Keeping secret values out of the argument vector prevents them from
/// being exposed through process inspection.
pub(crate) async fn run_ykman_with_secret_prompts(
    ykman: &str,
    serial: Option<u32>,
    args: &[&str],
    prompt_values: &[&str],
) -> Result<String, String> {
    if prompt_values.is_empty() {
        return Err("Refusing to start ykman without required secret input".to_string());
    }

    let mut input = Vec::new();
    for value in prompt_values {
        let bytes = value.as_bytes();
        if value.trim().is_empty() {
            input.fill(0);
            return Err("Refusing to pass a blank secret value to ykman".to_string());
        }
        if bytes.len() > MAX_PROMPT_VALUE_BYTES {
            input.fill(0);
            return Err("Refusing oversized secret input for ykman".to_string());
        }
        if bytes
            .iter()
            .any(|byte| matches!(*byte, b'\r' | b'\n' | b'\0'))
        {
            input.fill(0);
            return Err("Refusing secret input containing a line break or NUL byte".to_string());
        }
        let new_len = input
            .len()
            .checked_add(bytes.len() + 1)
            .ok_or_else(|| "Secret input size overflow".to_string())?;
        if new_len > MAX_PROMPT_INPUT_BYTES {
            input.fill(0);
            return Err("Refusing oversized aggregate secret input for ykman".to_string());
        }
        input.extend_from_slice(bytes);
        input.push(b'\n');
    }

    run_ykman_inner(ykman, serial, args, Some(input)).await
}

/// Run a `ykman` command with a sensitive file payload on stdin.
pub(crate) async fn run_ykman_with_sensitive_stdin(
    ykman: &str,
    serial: Option<u32>,
    args: &[&str],
    payload: &[u8],
) -> Result<String, String> {
    if payload.is_empty() {
        return Err("Refusing to pass an empty sensitive payload to ykman".to_string());
    }
    if payload.len() > MAX_SENSITIVE_STDIN_BYTES {
        return Err("Refusing oversized sensitive payload for ykman".to_string());
    }

    run_ykman_inner(ykman, serial, args, Some(payload.to_vec())).await
}

async fn read_bounded<R>(reader: R) -> io::Result<Vec<u8>>
where
    R: AsyncRead + Unpin,
{
    let mut output = Vec::new();
    let mut limited = reader.take((MAX_YKMAN_OUTPUT_BYTES + 1) as u64);
    limited.read_to_end(&mut output).await?;
    if output.len() > MAX_YKMAN_OUTPUT_BYTES {
        output.fill(0);
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "ykman output exceeded the configured limit",
        ));
    }
    Ok(output)
}

async fn run_ykman_inner(
    ykman: &str,
    serial: Option<u32>,
    args: &[&str],
    mut secret_stdin: Option<Vec<u8>>,
) -> Result<String, String> {
    if ykman.trim().is_empty() {
        if let Some(input) = secret_stdin.as_mut() {
            input.fill(0);
        }
        return Err("Refusing to run an empty ykman executable path".to_string());
    }

    let mut cmd = tokio::process::Command::new(ykman);

    // Target a specific device by serial
    if let Some(s) = serial {
        cmd.args(["--device", &s.to_string()]);
    }

    cmd.args(args);
    cmd.stdin(if secret_stdin.is_some() {
        Stdio::piped()
    } else {
        Stdio::null()
    })
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .kill_on_drop(true);

    debug!("Starting bounded ykman operation");

    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(error) => {
            if let Some(input) = secret_stdin.as_mut() {
                input.fill(0);
            }
            return Err(format!("Failed to start ykman: {}", error));
        }
    };

    if let Some(mut input) = secret_stdin.take() {
        let Some(mut stdin) = child.stdin.take() else {
            input.fill(0);
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Err("Failed to open protected stdin for ykman".to_string());
        };

        let write_result = tokio::time::timeout(YKMAN_STDIN_TIMEOUT, async {
            stdin.write_all(&input).await?;
            stdin.shutdown().await
        })
        .await;
        input.fill(0);

        match write_result {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                return Err(format!(
                    "Failed to send protected input to ykman: {}",
                    error
                ));
            }
            Err(_) => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                return Err("Timed out sending protected input to ykman".to_string());
            }
        }
    }

    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill().await;
        let _ = child.wait().await;
        return Err("Failed to capture ykman stdout".to_string());
    };
    let Some(stderr) = child.stderr.take() else {
        let _ = child.kill().await;
        let _ = child.wait().await;
        return Err("Failed to capture ykman stderr".to_string());
    };

    let execution =
        async { tokio::try_join!(read_bounded(stdout), read_bounded(stderr), child.wait()) };

    let (mut stdout, mut stderr, status) =
        match tokio::time::timeout(YKMAN_TIMEOUT, execution).await {
            Ok(Ok(result)) => result,
            Ok(Err(error)) => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                return Err(format!(
                    "Failed while running bounded ykman command: {}",
                    error
                ));
            }
            Err(_) => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                return Err("ykman operation timed out".to_string());
            }
        };

    if !status.success() {
        let failure_text = String::from_utf8_lossy(&stderr).to_ascii_lowercase();
        let oath_password_required = args.first() == Some(&"oath")
            && (failure_text.contains("password")
                || failure_text.contains("locked")
                || failure_text.contains("authentication required"));
        stdout.fill(0);
        stderr.fill(0);
        if oath_password_required {
            return Err(
                "The OATH applet is password protected; this operation requires a protected \
                 password input that the current API does not accept"
                    .to_string(),
            );
        }
        return Err(format!(
            "ykman operation failed (exit {}); command output was suppressed",
            status.code().unwrap_or(-1)
        ));
    }

    stderr.fill(0);
    let result = String::from_utf8_lossy(&stdout).to_string();
    stdout.fill(0);
    Ok(result)
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
                    device.pin_complexity = value == "1"
                        || value.to_lowercase() == "true"
                        || value.to_lowercase() == "enabled";
                }
                "fips approved" | "fips" => {
                    device.is_fips = value == "1"
                        || value.to_lowercase() == "true"
                        || value.to_lowercase() == "yes";
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
