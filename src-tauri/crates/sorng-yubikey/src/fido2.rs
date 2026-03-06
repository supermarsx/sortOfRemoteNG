//! # FIDO2/WebAuthn Operations
//!
//! Credential management, PIN operations, and device info for
//! the FIDO2 applet via `ykman fido`.

use crate::detect::run_ykman;
use crate::types::*;
use log::info;

// ── Device Info ─────────────────────────────────────────────────────

/// Get FIDO2 device info (CTAP2 GetInfo).
pub async fn get_fido2_info(
    ykman: &str,
    serial: Option<u32>,
) -> Result<Fido2DeviceInfo, String> {
    let output = run_ykman(ykman, serial, &["fido", "info"]).await?;
    Ok(parse_fido2_info(&output))
}

/// Parse `ykman fido info` output.
fn parse_fido2_info(output: &str) -> Fido2DeviceInfo {
    let mut info = Fido2DeviceInfo::default();

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let Some((key, value)) = trimmed.split_once(':') {
            let key_lower = key.trim().to_lowercase();
            let val = value.trim();

            match key_lower.as_str() {
                "versions" => {
                    info.versions = val.split(',').map(|s| s.trim().to_string()).collect();
                }
                "extensions" => {
                    info.extensions = val.split(',').map(|s| s.trim().to_string()).collect();
                }
                "aaguid" => {
                    info.aaguid = val.to_string();
                }
                "max message size" | "max msg size" => {
                    info.max_msg_size = val.parse().unwrap_or(1200);
                }
                "firmware version" | "firmware" => {
                    info.firmware_version = val.to_string();
                }
                "remaining credentials" | "remaining discoverable credentials" => {
                    info.remaining_discoverable_credentials = val.parse().unwrap_or(0);
                }
                "min pin length" | "min_pin_length" => {
                    info.min_pin_length = val.parse().unwrap_or(4);
                }
                "force pin change" => {
                    info.force_pin_change =
                        val == "true" || val == "True" || val == "1" || val == "yes";
                }
                _ => {
                    // Try to parse as option: key = true/false
                    if let Ok(b) = val.parse::<bool>() {
                        info.options.insert(key.trim().to_string(), b);
                    }
                }
            }
        }
    }

    info
}

// ── Credential Management ───────────────────────────────────────────

/// List all discoverable (resident) credentials.
pub async fn list_credentials(
    ykman: &str,
    serial: Option<u32>,
    pin: &str,
) -> Result<Vec<Fido2Credential>, String> {
    let output = run_ykman(
        ykman,
        serial,
        &["fido", "credentials", "list", "--pin", pin],
    )
    .await?;

    Ok(parse_credentials(&output))
}

/// Parse credentials from `ykman fido credentials list` output.
fn parse_credentials(output: &str) -> Vec<Fido2Credential> {
    let mut credentials = Vec::new();
    let mut current: Option<Fido2Credential> = None;

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            if let Some(c) = current.take() {
                credentials.push(c);
            }
            continue;
        }

        // A new credential block typically starts with the RP ID
        if !trimmed.starts_with(' ') && !trimmed.contains(':') {
            if let Some(c) = current.take() {
                credentials.push(c);
            }
            let mut cred = Fido2Credential {
                credential_id: String::new(),
                rp_id: trimmed.to_string(),
                rp_name: String::new(),
                user_name: String::new(),
                user_display_name: String::new(),
                user_id_base64: String::new(),
                creation_time: None,
                large_blob_key: false,
                hmac_secret: false,
                cred_protect: CredProtect::None,
                discoverable: true,
            };
            cred.rp_name = trimmed.to_string();
            current = Some(cred);
        } else if let Some(ref mut cred) = current {
            if let Some((key, value)) = trimmed.split_once(':') {
                let k = key.trim().to_lowercase();
                let v = value.trim();
                match k.as_str() {
                    "credential id" | "id" => cred.credential_id = v.to_string(),
                    "rp id" | "relying party" => cred.rp_id = v.to_string(),
                    "rp name" => cred.rp_name = v.to_string(),
                    "user name" | "username" | "user" => cred.user_name = v.to_string(),
                    "user display name" | "display name" => {
                        cred.user_display_name = v.to_string()
                    }
                    "user id" => cred.user_id_base64 = v.to_string(),
                    "created" | "creation time" => cred.creation_time = Some(v.to_string()),
                    "large blob key" | "largeblobkey" => {
                        cred.large_blob_key =
                            v == "true" || v == "True" || v == "1" || v == "yes";
                    }
                    "hmac-secret" | "hmac_secret" => {
                        cred.hmac_secret =
                            v == "true" || v == "True" || v == "1" || v == "yes";
                    }
                    "cred protect" | "credprotect" => {
                        cred.cred_protect = match v {
                            "required" | "3" => CredProtect::Required,
                            "optional-with-list" | "2" => CredProtect::OptionalWithList,
                            "optional" | "1" => CredProtect::Optional,
                            _ => CredProtect::None,
                        };
                    }
                    _ => {}
                }
            }
        }
    }

    if let Some(c) = current {
        credentials.push(c);
    }

    credentials
}

/// Delete a credential by ID.
pub async fn delete_credential(
    ykman: &str,
    serial: Option<u32>,
    credential_id: &str,
    pin: &str,
) -> Result<bool, String> {
    run_ykman(
        ykman,
        serial,
        &[
            "fido",
            "credentials",
            "delete",
            credential_id,
            "--pin",
            pin,
            "-f",
        ],
    )
    .await?;
    info!("Deleted FIDO2 credential {}", credential_id);
    Ok(true)
}

// ── PIN Management ──────────────────────────────────────────────────

/// Set the initial FIDO2 PIN (when no PIN has been set).
pub async fn set_pin(
    ykman: &str,
    serial: Option<u32>,
    new_pin: &str,
) -> Result<bool, String> {
    run_ykman(
        ykman,
        serial,
        &["fido", "access", "change-pin", "-n", new_pin],
    )
    .await?;
    info!("FIDO2 PIN set");
    Ok(true)
}

/// Change the FIDO2 PIN.
pub async fn change_pin(
    ykman: &str,
    serial: Option<u32>,
    old_pin: &str,
    new_pin: &str,
) -> Result<bool, String> {
    run_ykman(
        ykman,
        serial,
        &[
            "fido",
            "access",
            "change-pin",
            "-P",
            old_pin,
            "-n",
            new_pin,
        ],
    )
    .await?;
    info!("FIDO2 PIN changed");
    Ok(true)
}

/// Get FIDO2 PIN/UV status.
pub async fn get_pin_status(
    ykman: &str,
    serial: Option<u32>,
) -> Result<Fido2PinStatus, String> {
    let output = run_ykman(ykman, serial, &["fido", "info"]).await?;

    let mut status = Fido2PinStatus::default();

    for line in output.lines() {
        let trimmed = line.trim().to_lowercase();
        if trimmed.contains("pin is set") || trimmed.contains("pin set") {
            status.pin_set = trimmed.contains("true") || trimmed.contains("yes");
        }
        if trimmed.contains("pin retries")
            || trimmed.contains("pin tries remaining")
            || trimmed.contains("pin attempts")
        {
            if let Some(n) = trimmed.split_whitespace().find_map(|w| w.parse::<u32>().ok()) {
                status.pin_retries = n;
            }
        }
        if trimmed.contains("uv retries") || trimmed.contains("uv attempts") {
            if let Some(n) = trimmed.split_whitespace().find_map(|w| w.parse::<u32>().ok()) {
                status.uv_retries = Some(n);
            }
        }
        if trimmed.contains("force pin change") {
            status.force_change = trimmed.contains("true") || trimmed.contains("yes");
        }
        if trimmed.contains("min pin length") {
            if let Some(n) = trimmed.split_whitespace().find_map(|w| w.parse::<u32>().ok()) {
                status.min_length = n;
            }
        }
    }

    Ok(status)
}

/// Reset the FIDO2 applet (must be done within 5 seconds of device insertion).
pub async fn reset_fido(
    ykman: &str,
    serial: Option<u32>,
) -> Result<bool, String> {
    run_ykman(ykman, serial, &["fido", "reset", "-f"]).await?;
    info!("FIDO2 applet reset");
    Ok(true)
}

/// Verify a FIDO2 PIN is correct (by attempting a benign operation).
pub async fn verify_pin(
    ykman: &str,
    serial: Option<u32>,
    pin: &str,
) -> Result<bool, String> {
    let result = run_ykman(
        ykman,
        serial,
        &["fido", "credentials", "list", "--pin", pin],
    )
    .await;
    Ok(result.is_ok())
}

/// Set the minimum PIN length.
pub async fn set_min_pin_length(
    ykman: &str,
    serial: Option<u32>,
    length: u32,
    pin: &str,
) -> Result<bool, String> {
    let len_str = length.to_string();
    run_ykman(
        ykman,
        serial,
        &[
            "fido",
            "config",
            "set-min-pin-length",
            &len_str,
            "--pin",
            pin,
            "-f",
        ],
    )
    .await?;
    info!("FIDO2 min PIN length set to {}", length);
    Ok(true)
}

/// Toggle always-UV requirement.
pub async fn toggle_always_uv(
    ykman: &str,
    serial: Option<u32>,
    enable: bool,
    pin: &str,
) -> Result<bool, String> {
    let flag = if enable { "--enable" } else { "--disable" };
    run_ykman(
        ykman,
        serial,
        &["fido", "config", "toggle-always-uv", flag, "--pin", pin, "-f"],
    )
    .await?;
    info!("FIDO2 always-UV toggled to {}", enable);
    Ok(true)
}

/// Force a PIN change on next use.
pub async fn force_pin_change(
    ykman: &str,
    serial: Option<u32>,
    pin: &str,
) -> Result<bool, String> {
    run_ykman(
        ykman,
        serial,
        &[
            "fido",
            "config",
            "force-pin-change",
            "--pin",
            pin,
            "-f",
        ],
    )
    .await?;
    info!("FIDO2 force PIN change set");
    Ok(true)
}

/// List relying party IDs with stored credentials.
pub async fn list_rp_ids(
    ykman: &str,
    serial: Option<u32>,
    pin: &str,
) -> Result<Vec<String>, String> {
    let creds = list_credentials(ykman, serial, pin).await?;
    let mut rps: Vec<String> = creds.iter().map(|c| c.rp_id.clone()).collect();
    rps.sort();
    rps.dedup();
    Ok(rps)
}

/// Get large blob data associated with a credential.
pub async fn get_large_blob(
    ykman: &str,
    serial: Option<u32>,
    credential_id: &str,
    pin: &str,
) -> Result<Option<Vec<u8>>, String> {
    let result = run_ykman(
        ykman,
        serial,
        &[
            "fido",
            "credentials",
            "large-blob",
            "get",
            credential_id,
            "--pin",
            pin,
        ],
    )
    .await;

    match result {
        Ok(data) => {
            let trimmed = data.trim();
            if trimmed.is_empty() {
                Ok(None)
            } else {
                Ok(Some(trimmed.as_bytes().to_vec()))
            }
        }
        Err(_) => Ok(None),
    }
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_fido2_info_basic() {
        let output = "\
FIDO2 device info:
Versions: FIDO_2_0, FIDO_2_1_PRE, FIDO_2_1
Extensions: credProtect, hmac-secret, largeBlobKey, credBlob, minPinLength
AAGUID: cb69481e-8ff7-4039-93ec-0a2729a154a8
Max message size: 1200
Firmware version: 5.4.3
Remaining discoverable credentials: 22
Min PIN length: 4
Force PIN change: false
";
        let info = parse_fido2_info(output);
        assert!(!info.versions.is_empty());
        assert!(info.extensions.contains(&"hmac-secret".to_string()));
        assert_eq!(
            info.aaguid,
            "cb69481e-8ff7-4039-93ec-0a2729a154a8"
        );
        assert_eq!(info.max_msg_size, 1200);
        assert_eq!(info.remaining_discoverable_credentials, 22);
        assert_eq!(info.min_pin_length, 4);
        assert!(!info.force_pin_change);
    }

    #[test]
    fn test_parse_credentials_empty() {
        let creds = parse_credentials("");
        assert!(creds.is_empty());
    }

    #[test]
    fn test_parse_credentials_single() {
        let output = "\
github.com
  Credential ID: abc123
  User name: alice
  User display name: Alice Example
  User ID: dXNlcl8x
";
        let creds = parse_credentials(output);
        assert_eq!(creds.len(), 1);
        assert_eq!(creds[0].rp_id, "github.com");
        assert_eq!(creds[0].credential_id, "abc123");
        assert_eq!(creds[0].user_name, "alice");
        assert_eq!(creds[0].user_display_name, "Alice Example");
    }

    #[test]
    fn test_parse_credentials_multiple() {
        let output = "\
example.com
  Credential ID: cred1
  User name: user1

other.org
  Credential ID: cred2
  User name: user2
";
        let creds = parse_credentials(output);
        assert_eq!(creds.len(), 2);
        assert_eq!(creds[0].rp_id, "example.com");
        assert_eq!(creds[1].rp_id, "other.org");
    }
}
