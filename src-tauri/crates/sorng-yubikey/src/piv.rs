//! # PIV (Personal Identity Verification) Operations
//!
//! Key generation, certificate management, signing, PIN/PUK lifecycle,
//! and attestation for all PIV slots via `ykman piv`.

use crate::detect::{run_ykman, run_ykman_with_secret_prompts, run_ykman_with_sensitive_stdin};
use crate::types::*;
use log::info;

// ── Helpers ─────────────────────────────────────────────────────────

/// Build the serial args prefix.
#[allow(dead_code)]
pub(crate) fn serial_arg(serial: Option<u32>) -> Vec<String> {
    match serial {
        Some(s) => vec!["--device".to_string(), s.to_string()],
        None => Vec::new(),
    }
}

/// Parse PEM-encoded certificate text from ykman output.
fn extract_pem(output: &str) -> String {
    let mut pem = String::new();
    let mut in_pem = false;
    for line in output.lines() {
        if line.contains("-----BEGIN") {
            in_pem = true;
        }
        if in_pem {
            pem.push_str(line);
            pem.push('\n');
        }
        if line.contains("-----END") {
            break;
        }
    }
    pem
}

// ── PIV Information ─────────────────────────────────────────────────

/// Get an overview of the PIV applet state.
pub async fn get_piv_info(ykman: &str, serial: Option<u32>) -> Result<String, String> {
    run_ykman(ykman, serial, &["piv", "info"]).await
}

/// List all PIV certificates (populated slots).
pub async fn list_certificates(
    ykman: &str,
    serial: Option<u32>,
) -> Result<Vec<PivSlotInfo>, String> {
    let output = run_ykman(ykman, serial, &["piv", "certificates", "list"]).await?;
    let mut slots = Vec::new();
    let mut current: Option<PivSlotInfo> = None;

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            if let Some(s) = current.take() {
                slots.push(s);
            }
            continue;
        }

        // New slot header: "Slot 9a (Authentication):"
        if trimmed.starts_with("Slot ") {
            if let Some(s) = current.take() {
                slots.push(s);
            }
            let hex = trimmed
                .split_whitespace()
                .nth(1)
                .unwrap_or("")
                .trim_end_matches(':');
            if let Some(slot_id) = PivSlot::from_hex(hex) {
                let info = PivSlotInfo {
                    slot: slot_id,
                    has_certificate: true,
                    ..Default::default()
                };
                current = Some(info);
            }
        } else if let Some(ref mut info) = current {
            if let Some((key, value)) = trimmed.split_once(':') {
                let key_lower = key.trim().to_lowercase();
                let val = value.trim();
                match key_lower.as_str() {
                    "algorithm" => {
                        info.algorithm = PivAlgorithm::from_str_label(val);
                        info.has_key = true;
                    }
                    "subject" | "subject dn" => {
                        if info.certificate.is_none() {
                            info.certificate = Some(PivCertificate {
                                subject: String::new(),
                                issuer: String::new(),
                                serial: String::new(),
                                not_before: String::new(),
                                not_after: String::new(),
                                fingerprint_sha256: String::new(),
                                algorithm: String::new(),
                                is_self_signed: false,
                                key_usage: Vec::new(),
                                extended_key_usage: Vec::new(),
                                san: Vec::new(),
                                pem: String::new(),
                                der_base64: String::new(),
                            });
                        }
                        if let Some(ref mut cert) = info.certificate {
                            cert.subject = val.to_string();
                        }
                    }
                    "issuer" | "issuer dn" => {
                        if let Some(ref mut cert) = info.certificate {
                            cert.issuer = val.to_string();
                        }
                    }
                    "serial" => {
                        if let Some(ref mut cert) = info.certificate {
                            cert.serial = val.to_string();
                        }
                    }
                    "not before" => {
                        if let Some(ref mut cert) = info.certificate {
                            cert.not_before = val.to_string();
                        }
                    }
                    "not after" => {
                        if let Some(ref mut cert) = info.certificate {
                            cert.not_after = val.to_string();
                        }
                    }
                    "fingerprint" => {
                        if let Some(ref mut cert) = info.certificate {
                            cert.fingerprint_sha256 = val.to_string();
                        }
                    }
                    "pin policy" => info.pin_policy = PinPolicy::from_str_label(val),
                    "touch policy" => info.touch_policy = TouchPolicy::from_str_label(val),
                    _ => {}
                }
            }
        }
    }

    // Don't forget the last in-flight slot
    if let Some(s) = current.take() {
        slots.push(s);
    }

    Ok(slots)
}

/// Get info about a specific PIV slot.
pub async fn get_slot_info(
    ykman: &str,
    serial: Option<u32>,
    slot: &PivSlot,
) -> Result<PivSlotInfo, String> {
    let output = run_ykman(
        ykman,
        serial,
        &["piv", "certificates", "export", slot.hex_id(), "-"],
    )
    .await;

    let mut info = PivSlotInfo {
        slot: slot.clone(),
        ..Default::default()
    };

    match output {
        Ok(pem) => {
            info.has_certificate = true;
            if let Some(ref mut cert) = info.certificate {
                cert.pem = pem;
            } else {
                info.certificate = Some(PivCertificate {
                    subject: String::new(),
                    issuer: String::new(),
                    serial: String::new(),
                    not_before: String::new(),
                    not_after: String::new(),
                    fingerprint_sha256: String::new(),
                    algorithm: String::new(),
                    is_self_signed: false,
                    key_usage: Vec::new(),
                    extended_key_usage: Vec::new(),
                    san: Vec::new(),
                    pem,
                    der_base64: String::new(),
                });
            }
        }
        Err(_) => {
            info.has_certificate = false;
        }
    }

    Ok(info)
}

// ── Key Generation ──────────────────────────────────────────────────

/// Generate a new key pair in a PIV slot.
pub async fn generate_key(
    ykman: &str,
    serial: Option<u32>,
    slot: &PivSlot,
    algorithm: &PivAlgorithm,
    pin_policy: &PinPolicy,
    touch_policy: &TouchPolicy,
) -> Result<PivSlotInfo, String> {
    let args = vec![
        "piv",
        "keys",
        "generate",
        slot.hex_id(),
        "-",
        "-a",
        algorithm.ykman_arg(),
        "--pin-policy",
        pin_policy.ykman_arg(),
        "--touch-policy",
        touch_policy.ykman_arg(),
        "-F",
        "PEM",
    ];

    run_ykman(ykman, serial, &args).await?;
    info!(
        "Generated {} key in PIV slot {}",
        algorithm.ykman_arg(),
        slot.hex_id()
    );

    let info = PivSlotInfo {
        slot: slot.clone(),
        algorithm: algorithm.clone(),
        has_key: true,
        pin_policy: pin_policy.clone(),
        touch_policy: touch_policy.clone(),
        origin: KeyOrigin::Generated,
        ..Default::default()
    };

    Ok(info)
}

/// Generate a self-signed certificate for a PIV slot.
pub async fn generate_self_signed_cert(
    ykman: &str,
    serial: Option<u32>,
    slot: &PivSlot,
    subject: &str,
    valid_days: u32,
) -> Result<PivCertificate, String> {
    let days_str = valid_days.to_string();
    let args = vec![
        "piv",
        "certificates",
        "generate",
        slot.hex_id(),
        "-",
        "-s",
        subject,
        "-d",
        &days_str,
        "--self-sign",
    ];

    let output = run_ykman(ykman, serial, &args).await?;
    info!(
        "Generated self-signed cert in slot {} for {}",
        slot.hex_id(),
        subject
    );

    let pem = extract_pem(&output);

    Ok(PivCertificate {
        subject: subject.to_string(),
        issuer: subject.to_string(),
        serial: String::new(),
        not_before: String::new(),
        not_after: String::new(),
        fingerprint_sha256: String::new(),
        algorithm: String::new(),
        is_self_signed: true,
        key_usage: Vec::new(),
        extended_key_usage: Vec::new(),
        san: Vec::new(),
        pem,
        der_base64: String::new(),
    })
}

/// Generate a CSR from a key in a PIV slot.
pub async fn generate_csr(
    ykman: &str,
    serial: Option<u32>,
    slot: &PivSlot,
    params: &CsrParams,
) -> Result<String, String> {
    // Build subject string  CN=...,O=...,OU=...,L=...,ST=...,C=...
    let mut subject_parts = vec![format!("CN={}", params.common_name)];
    if let Some(ref o) = params.organization {
        subject_parts.push(format!("O={}", o));
    }
    if let Some(ref ou) = params.organizational_unit {
        subject_parts.push(format!("OU={}", ou));
    }
    if let Some(ref l) = params.locality {
        subject_parts.push(format!("L={}", l));
    }
    if let Some(ref st) = params.state {
        subject_parts.push(format!("ST={}", st));
    }
    if let Some(ref c) = params.country {
        subject_parts.push(format!("C={}", c));
    }
    let subject = subject_parts.join(",");

    let args = vec![
        "piv",
        "certificates",
        "request",
        slot.hex_id(),
        "-",
        "-s",
        &subject,
    ];

    let output = run_ykman(ykman, serial, &args).await?;
    info!("Generated CSR for slot {}", slot.hex_id());
    Ok(extract_pem(&output))
}

/// Import a PEM-encoded certificate into a PIV slot.
pub async fn import_certificate(
    ykman: &str,
    serial: Option<u32>,
    slot: &PivSlot,
    pem: &str,
) -> Result<bool, String> {
    let result = run_ykman_with_sensitive_stdin(
        ykman,
        serial,
        &["piv", "certificates", "import", slot.hex_id(), "-"],
        pem.as_bytes(),
    )
    .await;

    result.map(|_| {
        info!("Imported certificate into slot {}", slot.hex_id());
        true
    })
}

/// Import a private key from PEM into a PIV slot.
pub async fn import_key(
    ykman: &str,
    serial: Option<u32>,
    slot: &PivSlot,
    key_pem: &str,
    pin_policy: &PinPolicy,
    touch_policy: &TouchPolicy,
) -> Result<bool, String> {
    let result = run_ykman_with_sensitive_stdin(
        ykman,
        serial,
        &[
            "piv",
            "keys",
            "import",
            slot.hex_id(),
            "-",
            "--pin-policy",
            pin_policy.ykman_arg(),
            "--touch-policy",
            touch_policy.ykman_arg(),
        ],
        key_pem.as_bytes(),
    )
    .await;

    result.map(|_| {
        info!("Imported key into slot {}", slot.hex_id());
        true
    })
}

/// Export a certificate from a PIV slot (PEM).
pub async fn export_certificate(
    ykman: &str,
    serial: Option<u32>,
    slot: &PivSlot,
) -> Result<String, String> {
    let output = run_ykman(
        ykman,
        serial,
        &["piv", "certificates", "export", slot.hex_id(), "-"],
    )
    .await?;
    Ok(extract_pem(&output))
}

/// Delete a certificate from a PIV slot.
pub async fn delete_certificate(
    ykman: &str,
    serial: Option<u32>,
    slot: &PivSlot,
) -> Result<bool, String> {
    run_ykman(
        ykman,
        serial,
        &["piv", "certificates", "delete", slot.hex_id(), "-f"],
    )
    .await?;
    info!("Deleted certificate from slot {}", slot.hex_id());
    Ok(true)
}

/// Delete the key in a PIV slot (requires reset or overwrite).
pub async fn delete_key(ykman: &str, serial: Option<u32>, slot: &PivSlot) -> Result<bool, String> {
    // ykman doesn't have a direct "delete key" — we delete cert and note
    // the slot is unusable until re-generated. Some firmware supports
    // `piv keys delete`.
    let result = run_ykman(
        ykman,
        serial,
        &["piv", "keys", "delete", slot.hex_id(), "-f"],
    )
    .await;

    match result {
        Ok(_) => {
            info!("Deleted key from slot {}", slot.hex_id());
            Ok(true)
        }
        Err(e) => {
            // Fallback: older firmware may not support this
            Err(format!(
                "Delete key not supported or failed for slot {}: {}",
                slot.hex_id(),
                e
            ))
        }
    }
}

/// Perform attestation on a PIV slot.
pub async fn attest(
    ykman: &str,
    serial: Option<u32>,
    slot: &PivSlot,
) -> Result<AttestationResult, String> {
    let output = run_ykman(
        ykman,
        serial,
        &["piv", "keys", "attest", slot.hex_id(), "-"],
    )
    .await?;

    let attestation_pem = extract_pem(&output);

    // Also get the device attestation certificate (f9)
    let device_cert_output =
        run_ykman(ykman, serial, &["piv", "certificates", "export", "f9", "-"])
            .await
            .unwrap_or_default();
    let device_pem = extract_pem(&device_cert_output);

    // Get device info for serial / firmware
    let info_output = run_ykman(ykman, serial, &["info"])
        .await
        .unwrap_or_default();
    let dev = crate::detect::parse_ykman_info(&info_output);

    Ok(AttestationResult {
        slot: slot.clone(),
        device_certificate_pem: device_pem,
        attestation_certificate_pem: attestation_pem,
        serial: dev.serial,
        firmware_version: dev.firmware_version,
        pin_policy: PinPolicy::Default,
        touch_policy: TouchPolicy::Default,
        form_factor: dev.form_factor,
        is_fips: dev.is_fips,
        generated_on_device: true,
    })
}

// ── PIN/PUK Management ──────────────────────────────────────────────

/// Change the PIV PIN.
pub async fn change_pin(
    ykman: &str,
    serial: Option<u32>,
    old_pin: &str,
    new_pin: &str,
) -> Result<bool, String> {
    run_ykman_with_secret_prompts(
        ykman,
        serial,
        &["piv", "access", "change-pin"],
        &[old_pin, new_pin],
    )
    .await?;
    info!("PIV PIN changed");
    Ok(true)
}

/// Change the PIV PUK.
pub async fn change_puk(
    ykman: &str,
    serial: Option<u32>,
    old_puk: &str,
    new_puk: &str,
) -> Result<bool, String> {
    run_ykman_with_secret_prompts(
        ykman,
        serial,
        &["piv", "access", "change-puk"],
        &[old_puk, new_puk],
    )
    .await?;
    info!("PIV PUK changed");
    Ok(true)
}

/// Change the PIV management key.
pub async fn change_management_key(
    ykman: &str,
    serial: Option<u32>,
    old_key: Option<&str>,
    new_key: &str,
    key_type: &ManagementKeyType,
    protect: bool,
) -> Result<bool, String> {
    let _ = (ykman, serial, old_key, new_key, key_type, protect);
    Err(
        "PIV management-key rotation is unavailable through ykman because its prompt sequence can depend on device PIN state; refusing to expose keys in process arguments"
            .to_string(),
    )
}

/// Unblock the PIV PIN with PUK.
pub async fn unblock_pin(
    ykman: &str,
    serial: Option<u32>,
    puk: &str,
    new_pin: &str,
) -> Result<bool, String> {
    run_ykman_with_secret_prompts(
        ykman,
        serial,
        &["piv", "access", "unblock-pin"],
        &[puk, new_pin],
    )
    .await?;
    info!("PIV PIN unblocked");
    Ok(true)
}

/// Get PIN/PUK status (attempts remaining, defaults).
pub async fn get_pin_status(ykman: &str, serial: Option<u32>) -> Result<PivPinStatus, String> {
    let output = run_ykman(ykman, serial, &["piv", "info"]).await?;

    let mut status = PivPinStatus::default();

    for line in output.lines() {
        let trimmed = line.trim().to_lowercase();
        if trimmed.contains("pin tries remaining") || trimmed.contains("pin attempts") {
            if let Some(num) = trimmed
                .split_whitespace()
                .find_map(|w| w.parse::<u32>().ok())
            {
                status.pin_attempts_remaining = num;
            }
        }
        if trimmed.contains("puk tries remaining") || trimmed.contains("puk attempts") {
            if let Some(num) = trimmed
                .split_whitespace()
                .find_map(|w| w.parse::<u32>().ok())
            {
                status.puk_attempts_remaining = num;
            }
        }
        if trimmed.contains("management key") {
            if trimmed.contains("default") {
                status.management_key_is_default = true;
            }
            if trimmed.contains("aes128") {
                status.management_key_type = ManagementKeyType::Aes128;
            } else if trimmed.contains("aes192") {
                status.management_key_type = ManagementKeyType::Aes192;
            } else if trimmed.contains("aes256") {
                status.management_key_type = ManagementKeyType::Aes256;
            }
        }
    }

    Ok(status)
}

/// Full PIV factory reset (destroys all keys, certs, resets PIN/PUK).
pub async fn reset_piv(ykman: &str, serial: Option<u32>) -> Result<bool, String> {
    run_ykman(ykman, serial, &["piv", "reset", "-f"]).await?;
    info!("PIV applet reset");
    Ok(true)
}

/// Sign data using a key in a PIV slot.
pub async fn sign_data(
    ykman: &str,
    serial: Option<u32>,
    slot: &PivSlot,
    data: &[u8],
    algorithm: &str,
) -> Result<Vec<u8>, String> {
    // Write data to temp file
    let tmp_in = std::env::temp_dir().join(format!("yk_sign_in_{}", uuid::Uuid::new_v4()));
    let tmp_out = std::env::temp_dir().join(format!("yk_sign_out_{}", uuid::Uuid::new_v4()));

    tokio::fs::write(&tmp_in, data)
        .await
        .map_err(|e| format!("Failed to write temp data: {}", e))?;

    let in_str = tmp_in.to_string_lossy().to_string();
    let out_str = tmp_out.to_string_lossy().to_string();

    let result = run_ykman(
        ykman,
        serial,
        &[
            "piv",
            "keys",
            "sign",
            slot.hex_id(),
            &in_str,
            "-o",
            &out_str,
            "-a",
            algorithm,
        ],
    )
    .await;

    let _ = tokio::fs::remove_file(&tmp_in).await;

    match result {
        Ok(_) => {
            let sig = tokio::fs::read(&tmp_out)
                .await
                .map_err(|e| format!("Failed to read signature: {}", e))?;
            let _ = tokio::fs::remove_file(&tmp_out).await;
            Ok(sig)
        }
        Err(e) => {
            let _ = tokio::fs::remove_file(&tmp_out).await;
            Err(e)
        }
    }
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_pem() {
        let output = "Some header info\n-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----\nsome trailer";
        let pem = extract_pem(output);
        assert!(pem.contains("BEGIN CERTIFICATE"));
        assert!(pem.contains("END CERTIFICATE"));
    }

    #[test]
    fn test_extract_pem_no_pem() {
        let output = "No PEM data here";
        let pem = extract_pem(output);
        assert!(pem.is_empty());
    }

    #[test]
    fn test_serial_arg_some() {
        let args = serial_arg(Some(12345));
        assert_eq!(args, vec!["--device", "12345"]);
    }

    #[test]
    fn test_serial_arg_none() {
        let args = serial_arg(None);
        assert!(args.is_empty());
    }
}
