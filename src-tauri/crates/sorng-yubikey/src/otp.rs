//! # OTP Slot Operations
//!
//! Configure OTP slots (Yubico OTP, challenge-response, static
//! password, HOTP) via `ykman otp`.

use crate::detect::run_ykman;
use crate::types::*;
use log::info;

// ── Info ────────────────────────────────────────────────────────────

/// Get the configuration of both OTP slots.
pub async fn get_otp_info(
    ykman: &str,
    serial: Option<u32>,
) -> Result<(OtpSlotConfig, OtpSlotConfig), String> {
    let output = run_ykman(ykman, serial, &["otp", "info"]).await?;
    Ok(parse_otp_info(&output))
}

/// Parse `ykman otp info` output.
fn parse_otp_info(output: &str) -> (OtpSlotConfig, OtpSlotConfig) {
    let mut short = OtpSlotConfig {
        slot: OtpSlot::Short,
        configured: false,
        slot_type: None,
        require_touch: false,
    };
    let mut long = OtpSlotConfig {
        slot: OtpSlot::Long,
        configured: false,
        slot_type: None,
        require_touch: false,
    };

    let mut current_slot: Option<&mut OtpSlotConfig> = None;

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let lower = trimmed.to_lowercase();

        // Detect slot header
        if lower.contains("slot 1") || lower.starts_with("short") {
            current_slot = Some(&mut short);
            continue;
        }
        if lower.contains("slot 2") || lower.starts_with("long") {
            current_slot = Some(&mut long);
            continue;
        }

        if let Some(ref mut slot_cfg) = current_slot {
            if lower.contains("empty") || lower.contains("not configured") {
                slot_cfg.configured = false;
            } else if lower.contains("programmed") || lower.contains("configured") {
                slot_cfg.configured = true;
            }

            if let Some(st) = OtpSlotType::from_str_label(trimmed) {
                slot_cfg.slot_type = Some(st);
                slot_cfg.configured = true;
            }

            if lower.contains("touch") {
                slot_cfg.require_touch = true;
            }
        }
    }

    (short, long)
}

// ── Configure ───────────────────────────────────────────────────────

/// Configure a slot with Yubico OTP.
pub async fn configure_yubico_otp(
    ykman: &str,
    serial: Option<u32>,
    slot: &OtpSlot,
    public_id: Option<&str>,
    private_id: Option<&str>,
    key: Option<&str>,
) -> Result<bool, String> {
    let mut args = vec!["otp", "yubiotp", slot.ykman_arg(), "-f"];

    if let Some(pid) = public_id {
        args.extend_from_slice(&["--public-id", pid]);
    }
    if let Some(pvid) = private_id {
        args.extend_from_slice(&["--private-id", pvid]);
    }
    if let Some(k) = key {
        args.extend_from_slice(&["--key", k]);
    }
    if public_id.is_none() {
        args.push("--generate-public-id");
    }
    if private_id.is_none() {
        args.push("--generate-private-id");
    }
    if key.is_none() {
        args.push("--generate-key");
    }

    run_ykman(ykman, serial, &args).await?;
    info!("Configured Yubico OTP on slot {}", slot);
    Ok(true)
}

/// Configure a slot with HMAC-SHA1 challenge-response.
pub async fn configure_challenge_response(
    ykman: &str,
    serial: Option<u32>,
    slot: &OtpSlot,
    key: Option<&str>,
    require_touch: bool,
) -> Result<bool, String> {
    let mut args = vec!["otp", "chalresp", slot.ykman_arg(), "-f"];

    if let Some(k) = key {
        args.push(k);
    } else {
        args.push("--generate");
    }
    if require_touch {
        args.push("--touch");
    }

    run_ykman(ykman, serial, &args).await?;
    info!("Configured challenge-response on slot {}", slot);
    Ok(true)
}

/// Configure a slot with a static password.
pub async fn configure_static_password(
    ykman: &str,
    serial: Option<u32>,
    slot: &OtpSlot,
    password: &str,
    keyboard_layout: &str,
) -> Result<bool, String> {
    let args = vec![
        "otp",
        "static",
        slot.ykman_arg(),
        password,
        "--keyboard-layout",
        keyboard_layout,
        "-f",
    ];

    run_ykman(ykman, serial, &args).await?;
    info!("Configured static password on slot {}", slot);
    Ok(true)
}

/// Configure a slot with HOTP.
pub async fn configure_hotp(
    ykman: &str,
    serial: Option<u32>,
    slot: &OtpSlot,
    key: &str,
    digits: u8,
) -> Result<bool, String> {
    let digits_str = digits.to_string();
    let args = vec![
        "otp",
        "hotp",
        slot.ykman_arg(),
        key,
        "-d",
        &digits_str,
        "-f",
    ];

    run_ykman(ykman, serial, &args).await?;
    info!("Configured HOTP on slot {}", slot);
    Ok(true)
}

/// Delete (clear) an OTP slot.
pub async fn delete_slot(
    ykman: &str,
    serial: Option<u32>,
    slot: &OtpSlot,
) -> Result<bool, String> {
    run_ykman(
        ykman,
        serial,
        &["otp", "delete", slot.ykman_arg(), "-f"],
    )
    .await?;
    info!("Deleted OTP slot {}", slot);
    Ok(true)
}

/// Swap the two OTP slots.
pub async fn swap_slots(
    ykman: &str,
    serial: Option<u32>,
) -> Result<bool, String> {
    run_ykman(ykman, serial, &["otp", "swap", "-f"]).await?;
    info!("Swapped OTP slots");
    Ok(true)
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_otp_info_both_configured() {
        let output = "\
Slot 1 (Short Touch):
  Yubico OTP

Slot 2 (Long Touch):
  Challenge-Response (HMAC-SHA1)
";
        let (short, long) = parse_otp_info(output);
        assert!(short.configured);
        assert_eq!(short.slot_type, Some(OtpSlotType::YubicoOtp));
        assert!(long.configured);
        assert_eq!(long.slot_type, Some(OtpSlotType::ChallengeResponse));
    }

    #[test]
    fn test_parse_otp_info_empty_slots() {
        let output = "\
Slot 1:
  empty

Slot 2:
  empty
";
        let (short, long) = parse_otp_info(output);
        assert!(!short.configured);
        assert!(!long.configured);
    }

    #[test]
    fn test_parse_otp_info_mixed() {
        let output = "\
Slot 1:
  Static Password

Slot 2:
  not configured
";
        let (short, long) = parse_otp_info(output);
        assert!(short.configured);
        assert_eq!(short.slot_type, Some(OtpSlotType::StaticPassword));
        assert!(!long.configured);
        assert_eq!(long.slot_type, None);
    }

    #[test]
    fn test_parse_otp_info_empty_output() {
        let (short, long) = parse_otp_info("");
        assert!(!short.configured);
        assert!(!long.configured);
    }
}
