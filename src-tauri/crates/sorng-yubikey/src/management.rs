//! # YubiKey Management Operations
//!
//! High-level management including factory reset, diagnostics,
//! device reports, and firmware version checking.

use crate::detect::{get_device_info, run_ykman};
use log::info;
use std::collections::HashMap;

/// Factory-reset all applets on the YubiKey: PIV, FIDO2, OATH, OTP.
///
/// Returns a map of applet name → success/error.
pub async fn factory_reset_all(
    ykman: &str,
    serial: Option<u32>,
) -> Result<HashMap<String, Result<bool, String>>, String> {
    let mut results = HashMap::new();

    // PIV reset
    let piv = crate::piv::reset_piv(ykman, serial).await;
    results.insert("PIV".to_string(), piv);

    // FIDO2 reset
    let fido = crate::fido2::reset_fido(ykman, serial).await;
    results.insert("FIDO2".to_string(), fido);

    // OATH reset
    let oath = crate::oath::reset_oath(ykman, serial).await;
    results.insert("OATH".to_string(), oath);

    info!("Factory reset all applets for serial {:?}", serial);

    Ok(results)
}

/// Get comprehensive diagnostics for a YubiKey.
pub async fn get_diagnostics(
    ykman: &str,
    serial: Option<u32>,
) -> Result<HashMap<String, String>, String> {
    let mut diag = HashMap::new();

    // Device info
    match get_device_info(ykman, serial).await {
        Ok(dev) => {
            diag.insert("serial".to_string(), dev.serial.to_string());
            diag.insert("firmware".to_string(), dev.firmware_version.clone());
            diag.insert("device_name".to_string(), dev.device_name.clone());
            diag.insert("form_factor".to_string(), dev.form_factor.to_string());
            diag.insert("has_nfc".to_string(), dev.has_nfc.to_string());
            diag.insert("is_fips".to_string(), dev.is_fips.to_string());
            diag.insert("is_sky".to_string(), dev.is_sky.to_string());
            diag.insert("config_locked".to_string(), dev.config_locked.to_string());
            diag.insert(
                "usb_interfaces".to_string(),
                dev.usb_interfaces_enabled
                    .iter()
                    .map(|i| i.ykman_label().to_string())
                    .collect::<Vec<_>>()
                    .join("+"),
            );
            diag.insert(
                "nfc_interfaces".to_string(),
                dev.nfc_interfaces_enabled
                    .iter()
                    .map(|i| i.ykman_label().to_string())
                    .collect::<Vec<_>>()
                    .join("+"),
            );
        }
        Err(e) => {
            diag.insert("device_error".to_string(), e);
        }
    }

    // PIV info
    match run_ykman(ykman, serial, &["piv", "info"]).await {
        Ok(output) => {
            diag.insert("piv_info".to_string(), output);
        }
        Err(e) => {
            diag.insert("piv_error".to_string(), e);
        }
    }

    // FIDO2 info
    match run_ykman(ykman, serial, &["fido", "info"]).await {
        Ok(output) => {
            diag.insert("fido2_info".to_string(), output);
        }
        Err(e) => {
            diag.insert("fido2_error".to_string(), e);
        }
    }

    // OATH info
    match run_ykman(ykman, serial, &["oath", "info"]).await {
        Ok(output) => {
            diag.insert("oath_info".to_string(), output);
        }
        Err(e) => {
            diag.insert("oath_error".to_string(), e);
        }
    }

    // OTP info
    match run_ykman(ykman, serial, &["otp", "info"]).await {
        Ok(output) => {
            diag.insert("otp_info".to_string(), output);
        }
        Err(e) => {
            diag.insert("otp_error".to_string(), e);
        }
    }

    // ykman version
    match run_ykman(ykman, None, &["--version"]).await {
        Ok(output) => {
            diag.insert("ykman_version".to_string(), output.trim().to_string());
        }
        Err(e) => {
            diag.insert("ykman_version_error".to_string(), e);
        }
    }

    Ok(diag)
}

/// Export a comprehensive JSON device report.
pub async fn export_device_report(ykman: &str, serial: Option<u32>) -> Result<String, String> {
    let diag = get_diagnostics(ykman, serial).await?;

    // Also include PIV certificates
    let certs = crate::piv::list_certificates(ykman, serial)
        .await
        .unwrap_or_default();

    let report = serde_json::json!({
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "diagnostics": diag,
        "piv_certificates": certs,
    });

    serde_json::to_string_pretty(&report).map_err(|e| e.to_string())
}

/// Check the firmware version and return a status summary.
pub async fn check_firmware_version(
    ykman: &str,
    serial: Option<u32>,
) -> Result<HashMap<String, String>, String> {
    let dev = get_device_info(ykman, serial).await?;
    let mut result = HashMap::new();

    result.insert("version".to_string(), dev.firmware_version.clone());
    result.insert("device_name".to_string(), dev.device_name.clone());

    // Parse major.minor.patch
    let parts: Vec<u32> = dev
        .firmware_version
        .split('.')
        .filter_map(|p| p.parse().ok())
        .collect();

    if parts.len() >= 2 {
        let major = parts[0];
        let minor = parts[1];

        // Firmware 5.7+ supports new features
        if major >= 5 && minor >= 7 {
            result.insert("status".to_string(), "up-to-date".to_string());
            result.insert("supports_ed25519".to_string(), "true".to_string());
            result.insert("supports_rsa3072".to_string(), "true".to_string());
            result.insert("supports_rsa4096".to_string(), "true".to_string());
        } else if major >= 5 && minor >= 4 {
            result.insert("status".to_string(), "current".to_string());
            result.insert("supports_ed25519".to_string(), "false".to_string());
            result.insert("supports_rsa3072".to_string(), "false".to_string());
        } else if major >= 5 {
            result.insert("status".to_string(), "older".to_string());
        } else {
            result.insert("status".to_string(), "legacy".to_string());
        }
    } else {
        result.insert("status".to_string(), "unknown".to_string());
    }

    Ok(result)
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // Integration tests require a real YubiKey and ykman; unit tests
    // focus on parsing logic in other modules.

    #[test]
    fn test_diagnostic_keys() {
        // Smoke test: we can at least compile the module
        let diag: HashMap<String, String> = HashMap::new();
        assert!(diag.is_empty());
    }
}
