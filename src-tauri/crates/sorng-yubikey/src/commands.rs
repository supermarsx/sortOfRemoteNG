//! # Tauri Commands for YubiKey
//!
//! Each function is a `#[tauri::command]` that locks the shared state
//! (`YubiKeyServiceState = Arc<tokio::sync::Mutex<YubiKeyService>>`)
//! and delegates to `YubiKeyService`.

use crate::types::*;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use std::collections::HashMap;
use tauri::State;

/// Decode a base64-encoded string to bytes.
fn b64_decode(s: &str) -> Result<Vec<u8>, String> {
    B64.decode(s).map_err(|e| format!("base64 decode error: {}", e))
}

/// Encode bytes to base64.
fn b64_encode(data: &[u8]) -> String {
    B64.encode(data)
}

/// Convenience alias for command return types.
type CmdResult<T> = Result<T, String>;

// ═══════════════════════════════════════════════════════════════════
//  Device commands
// ═══════════════════════════════════════════════════════════════════

/// Enumerate all connected YubiKey devices.
#[tauri::command]
pub async fn yk_list_devices(
    state: State<'_, YubiKeyServiceState>,
) -> CmdResult<Vec<YubiKeyDevice>> {
    let mut svc = state.lock().await;
    if !svc.ykman_detected {
        let _ = svc.detect_ykman().await;
    }
    svc.list_devices().await
}

/// Get detailed info for a YubiKey (by serial, or the default device).
#[tauri::command]
pub async fn yk_get_device_info(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
) -> CmdResult<YubiKeyDevice> {
    let svc = state.lock().await;
    svc.get_device_info(serial).await
}

/// Wait for a device to be inserted.
#[tauri::command]
pub async fn yk_wait_for_device(
    state: State<'_, YubiKeyServiceState>,
    timeout_ms: u64,
) -> CmdResult<Option<YubiKeyDevice>> {
    let svc = state.lock().await;
    svc.wait_for_device(timeout_ms).await
}

/// Get comprehensive diagnostics.
#[tauri::command]
pub async fn yk_get_diagnostics(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
) -> CmdResult<HashMap<String, String>> {
    let svc = state.lock().await;
    svc.get_diagnostics(serial).await
}

// ═══════════════════════════════════════════════════════════════════
//  PIV commands
// ═══════════════════════════════════════════════════════════════════

/// List all PIV certificates.
#[tauri::command]
pub async fn yk_piv_list_certs(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
) -> CmdResult<Vec<PivSlotInfo>> {
    let svc = state.lock().await;
    svc.piv_list_certificates(serial).await
}

/// Get info for a specific PIV slot.
#[tauri::command]
pub async fn yk_piv_get_slot(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
    slot: String,
) -> CmdResult<PivSlotInfo> {
    let piv_slot = PivSlot::from_hex(&slot)
        .ok_or_else(|| format!("Invalid PIV slot: {}", slot))?;
    let svc = state.lock().await;
    svc.piv_get_slot_info(serial, &piv_slot).await
}

/// Generate a new key pair in a PIV slot.
#[tauri::command]
pub async fn yk_piv_generate_key(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
    slot: String,
    algo: String,
    pin_policy: String,
    touch_policy: String,
) -> CmdResult<PivSlotInfo> {
    let piv_slot = PivSlot::from_hex(&slot)
        .ok_or_else(|| format!("Invalid PIV slot: {}", slot))?;
    let algorithm = PivAlgorithm::from_str_label(&algo);
    let pp = PinPolicy::from_str_label(&pin_policy);
    let tp = TouchPolicy::from_str_label(&touch_policy);

    let mut svc = state.lock().await;
    svc.piv_generate_key(serial, &piv_slot, &algorithm, &pp, &tp)
        .await
}

/// Generate a self-signed certificate.
#[tauri::command]
pub async fn yk_piv_self_sign_cert(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
    slot: String,
    subject: String,
    valid_days: u32,
) -> CmdResult<PivCertificate> {
    let piv_slot = PivSlot::from_hex(&slot)
        .ok_or_else(|| format!("Invalid PIV slot: {}", slot))?;
    let mut svc = state.lock().await;
    svc.piv_self_sign_cert(serial, &piv_slot, &subject, valid_days)
        .await
}

/// Generate a CSR (Certificate Signing Request).
#[tauri::command]
pub async fn yk_piv_generate_csr(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
    slot: String,
    params: CsrParams,
) -> CmdResult<String> {
    let piv_slot = PivSlot::from_hex(&slot)
        .ok_or_else(|| format!("Invalid PIV slot: {}", slot))?;
    let svc = state.lock().await;
    svc.piv_generate_csr(serial, &piv_slot, &params).await
}

/// Import a PEM-encoded certificate.
#[tauri::command]
pub async fn yk_piv_import_cert(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
    slot: String,
    pem: String,
) -> CmdResult<bool> {
    let piv_slot = PivSlot::from_hex(&slot)
        .ok_or_else(|| format!("Invalid PIV slot: {}", slot))?;
    let mut svc = state.lock().await;
    svc.piv_import_cert(serial, &piv_slot, &pem).await
}

/// Import a private key.
#[tauri::command]
pub async fn yk_piv_import_key(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
    slot: String,
    key_pem: String,
    pin_policy: String,
    touch_policy: String,
) -> CmdResult<bool> {
    let piv_slot = PivSlot::from_hex(&slot)
        .ok_or_else(|| format!("Invalid PIV slot: {}", slot))?;
    let pp = PinPolicy::from_str_label(&pin_policy);
    let tp = TouchPolicy::from_str_label(&touch_policy);
    let mut svc = state.lock().await;
    svc.piv_import_key(serial, &piv_slot, &key_pem, &pp, &tp)
        .await
}

/// Export a PIV certificate as PEM.
#[tauri::command]
pub async fn yk_piv_export_cert(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
    slot: String,
) -> CmdResult<String> {
    let piv_slot = PivSlot::from_hex(&slot)
        .ok_or_else(|| format!("Invalid PIV slot: {}", slot))?;
    let svc = state.lock().await;
    svc.piv_export_cert(serial, &piv_slot).await
}

/// Delete a certificate from a PIV slot.
#[tauri::command]
pub async fn yk_piv_delete_cert(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
    slot: String,
) -> CmdResult<bool> {
    let piv_slot = PivSlot::from_hex(&slot)
        .ok_or_else(|| format!("Invalid PIV slot: {}", slot))?;
    let mut svc = state.lock().await;
    svc.piv_delete_cert(serial, &piv_slot).await
}

/// Delete the key from a PIV slot.
#[tauri::command]
pub async fn yk_piv_delete_key(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
    slot: String,
) -> CmdResult<bool> {
    let piv_slot = PivSlot::from_hex(&slot)
        .ok_or_else(|| format!("Invalid PIV slot: {}", slot))?;
    let mut svc = state.lock().await;
    svc.piv_delete_key(serial, &piv_slot).await
}

/// Attestation — prove a key was generated on-device.
#[tauri::command]
pub async fn yk_piv_attest(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
    slot: String,
) -> CmdResult<AttestationResult> {
    let piv_slot = PivSlot::from_hex(&slot)
        .ok_or_else(|| format!("Invalid PIV slot: {}", slot))?;
    let svc = state.lock().await;
    svc.piv_attest(serial, &piv_slot).await
}

/// Change the PIV PIN.
#[tauri::command]
pub async fn yk_piv_change_pin(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
    old_pin: String,
    new_pin: String,
) -> CmdResult<bool> {
    let mut svc = state.lock().await;
    svc.piv_change_pin(serial, &old_pin, &new_pin).await
}

/// Change the PIV PUK.
#[tauri::command]
pub async fn yk_piv_change_puk(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
    old_puk: String,
    new_puk: String,
) -> CmdResult<bool> {
    let mut svc = state.lock().await;
    svc.piv_change_puk(serial, &old_puk, &new_puk).await
}

/// Change the PIV management key.
#[tauri::command]
pub async fn yk_piv_change_mgmt_key(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
    current: Option<String>,
    new_key: String,
    key_type: String,
    protect: bool,
) -> CmdResult<bool> {
    let kt = ManagementKeyType::from_str_label(&key_type);
    let mut svc = state.lock().await;
    svc.piv_change_management_key(serial, current.as_deref(), &new_key, &kt, protect)
        .await
}

/// Unblock the PIV PIN with the PUK.
#[tauri::command]
pub async fn yk_piv_unblock_pin(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
    puk: String,
    new_pin: String,
) -> CmdResult<bool> {
    let mut svc = state.lock().await;
    svc.piv_unblock_pin(serial, &puk, &new_pin).await
}

/// Get PIV PIN/PUK status.
#[tauri::command]
pub async fn yk_piv_get_pin_status(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
) -> CmdResult<PivPinStatus> {
    let svc = state.lock().await;
    svc.piv_get_pin_status(serial).await
}

/// Reset the PIV applet (destroys all keys and certs).
#[tauri::command]
pub async fn yk_piv_reset(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
) -> CmdResult<bool> {
    let mut svc = state.lock().await;
    svc.piv_reset(serial).await
}

/// Sign data using a PIV slot key. Data and result are base64-encoded.
#[tauri::command]
pub async fn yk_piv_sign(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
    slot: String,
    data: String,
    algo: String,
) -> CmdResult<String> {
    let piv_slot = PivSlot::from_hex(&slot)
        .ok_or_else(|| format!("Invalid PIV slot: {}", slot))?;
    let bytes = b64_decode(&data)?;
    let mut svc = state.lock().await;
    let sig = svc.piv_sign(serial, &piv_slot, &bytes, &algo).await?;
    Ok(b64_encode(&sig))
}

// ═══════════════════════════════════════════════════════════════════
//  FIDO2 commands
// ═══════════════════════════════════════════════════════════════════

/// Get FIDO2 device info.
#[tauri::command]
pub async fn yk_fido2_info(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
) -> CmdResult<Fido2DeviceInfo> {
    let svc = state.lock().await;
    svc.fido2_info(serial).await
}

/// List FIDO2 discoverable credentials.
#[tauri::command]
pub async fn yk_fido2_list_credentials(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
    pin: String,
) -> CmdResult<Vec<Fido2Credential>> {
    let svc = state.lock().await;
    svc.fido2_list_credentials(serial, &pin).await
}

/// Delete a FIDO2 credential.
#[tauri::command]
pub async fn yk_fido2_delete_credential(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
    credential_id: String,
    pin: String,
) -> CmdResult<bool> {
    let mut svc = state.lock().await;
    svc.fido2_delete_credential(serial, &credential_id, &pin)
        .await
}

/// Set the initial FIDO2 PIN.
#[tauri::command]
pub async fn yk_fido2_set_pin(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
    new_pin: String,
) -> CmdResult<bool> {
    let mut svc = state.lock().await;
    svc.fido2_set_pin(serial, &new_pin).await
}

/// Change the FIDO2 PIN.
#[tauri::command]
pub async fn yk_fido2_change_pin(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
    old_pin: String,
    new_pin: String,
) -> CmdResult<bool> {
    let mut svc = state.lock().await;
    svc.fido2_change_pin(serial, &old_pin, &new_pin).await
}

/// Get FIDO2 PIN status.
#[tauri::command]
pub async fn yk_fido2_pin_status(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
) -> CmdResult<Fido2PinStatus> {
    let svc = state.lock().await;
    svc.fido2_pin_status(serial).await
}

/// Reset the FIDO2 applet.
#[tauri::command]
pub async fn yk_fido2_reset(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
) -> CmdResult<bool> {
    let mut svc = state.lock().await;
    svc.fido2_reset(serial).await
}

/// Toggle FIDO2 always-UV policy.
#[tauri::command]
pub async fn yk_fido2_toggle_always_uv(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
    enable: bool,
    pin: String,
) -> CmdResult<bool> {
    let svc = state.lock().await;
    svc.fido2_toggle_always_uv(serial, enable, &pin).await
}

/// List FIDO2 relying party IDs.
#[tauri::command]
pub async fn yk_fido2_list_rps(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
    pin: String,
) -> CmdResult<Vec<String>> {
    let svc = state.lock().await;
    svc.fido2_list_rps(serial, &pin).await
}

// ═══════════════════════════════════════════════════════════════════
//  OATH commands
// ═══════════════════════════════════════════════════════════════════

/// List OATH accounts.
#[tauri::command]
pub async fn yk_oath_list(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
) -> CmdResult<Vec<OathAccount>> {
    let svc = state.lock().await;
    svc.oath_list(serial).await
}

/// Add an OATH account.
#[tauri::command]
pub async fn yk_oath_add(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
    issuer: String,
    name: String,
    secret: String,
    oath_type: String,
    algo: String,
    digits: u8,
    period: u32,
    touch: bool,
) -> CmdResult<bool> {
    let ot = OathType::from_str_label(&oath_type);
    let oa = OathAlgorithm::from_str_label(&algo);
    let mut svc = state.lock().await;
    svc.oath_add(serial, &issuer, &name, &secret, &ot, &oa, digits, period, touch)
        .await
}

/// Delete an OATH account.
#[tauri::command]
pub async fn yk_oath_delete(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
    credential_id: String,
) -> CmdResult<bool> {
    let mut svc = state.lock().await;
    svc.oath_delete(serial, &credential_id).await
}

/// Rename an OATH account.
#[tauri::command]
pub async fn yk_oath_rename(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
    old_id: String,
    new_issuer: String,
    new_name: String,
) -> CmdResult<bool> {
    let svc = state.lock().await;
    svc.oath_rename(serial, &old_id, &new_issuer, &new_name)
        .await
}

/// Calculate a single OATH code.
#[tauri::command]
pub async fn yk_oath_calculate(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
    credential_id: String,
) -> CmdResult<OathCode> {
    let mut svc = state.lock().await;
    svc.oath_calculate(serial, &credential_id).await
}

/// Calculate all OATH codes at once.
#[tauri::command]
pub async fn yk_oath_calculate_all(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
) -> CmdResult<Vec<(OathAccount, OathCode)>> {
    let svc = state.lock().await;
    svc.oath_calculate_all(serial).await
}

/// Set the OATH applet password.
#[tauri::command]
pub async fn yk_oath_set_password(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
    password: String,
) -> CmdResult<bool> {
    let mut svc = state.lock().await;
    svc.oath_set_password(serial, &password).await
}

/// Reset the OATH applet.
#[tauri::command]
pub async fn yk_oath_reset(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
) -> CmdResult<bool> {
    let mut svc = state.lock().await;
    svc.oath_reset(serial).await
}

// ═══════════════════════════════════════════════════════════════════
//  OTP commands
// ═══════════════════════════════════════════════════════════════════

/// Get OTP slot info.
#[tauri::command]
pub async fn yk_otp_info(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
) -> CmdResult<(OtpSlotConfig, OtpSlotConfig)> {
    let svc = state.lock().await;
    svc.otp_info(serial).await
}

/// Configure Yubico OTP.
#[tauri::command]
pub async fn yk_otp_configure_yubico(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
    slot: String,
    public_id: Option<String>,
    private_id: Option<String>,
    key: Option<String>,
) -> CmdResult<bool> {
    let otp_slot = OtpSlot::from_str_label(&slot);
    let mut svc = state.lock().await;
    svc.otp_configure_yubico(
        serial,
        &otp_slot,
        public_id.as_deref(),
        private_id.as_deref(),
        key.as_deref(),
    )
    .await
}

/// Configure HMAC-SHA1 challenge-response.
#[tauri::command]
pub async fn yk_otp_configure_chalresp(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
    slot: String,
    key: Option<String>,
    touch: bool,
) -> CmdResult<bool> {
    let otp_slot = OtpSlot::from_str_label(&slot);
    let mut svc = state.lock().await;
    svc.otp_configure_chalresp(serial, &otp_slot, key.as_deref(), touch)
        .await
}

/// Configure a static password.
#[tauri::command]
pub async fn yk_otp_configure_static(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
    slot: String,
    password: String,
    layout: String,
) -> CmdResult<bool> {
    let otp_slot = OtpSlot::from_str_label(&slot);
    let mut svc = state.lock().await;
    svc.otp_configure_static(serial, &otp_slot, &password, &layout)
        .await
}

/// Configure HOTP.
#[tauri::command]
pub async fn yk_otp_configure_hotp(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
    slot: String,
    key: String,
    digits: u8,
) -> CmdResult<bool> {
    let otp_slot = OtpSlot::from_str_label(&slot);
    let mut svc = state.lock().await;
    svc.otp_configure_hotp(serial, &otp_slot, &key, digits)
        .await
}

/// Delete (clear) an OTP slot.
#[tauri::command]
pub async fn yk_otp_delete(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
    slot: String,
) -> CmdResult<bool> {
    let otp_slot = OtpSlot::from_str_label(&slot);
    let mut svc = state.lock().await;
    svc.otp_delete(serial, &otp_slot).await
}

/// Swap the two OTP slots.
#[tauri::command]
pub async fn yk_otp_swap(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
) -> CmdResult<bool> {
    let mut svc = state.lock().await;
    svc.otp_swap(serial).await
}

// ═══════════════════════════════════════════════════════════════════
//  Config commands
// ═══════════════════════════════════════════════════════════════════

/// Set enabled USB and NFC interfaces.
#[tauri::command]
pub async fn yk_config_set_interfaces(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
    usb: Vec<String>,
    nfc: Vec<String>,
) -> CmdResult<bool> {
    let usb_ifaces: Vec<YubiKeyInterface> = usb
        .iter()
        .filter_map(|s| YubiKeyInterface::from_str_label(s))
        .collect();
    let nfc_ifaces: Vec<YubiKeyInterface> = nfc
        .iter()
        .filter_map(|s| YubiKeyInterface::from_str_label(s))
        .collect();
    let svc = state.lock().await;
    svc.config_set_interfaces(serial, &usb_ifaces, &nfc_ifaces)
        .await
}

/// Lock the device configuration.
#[tauri::command]
pub async fn yk_config_lock(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
    lock_code: String,
) -> CmdResult<bool> {
    let svc = state.lock().await;
    svc.config_lock(serial, &lock_code).await
}

/// Unlock the device configuration.
#[tauri::command]
pub async fn yk_config_unlock(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
    lock_code: String,
) -> CmdResult<bool> {
    let svc = state.lock().await;
    svc.config_unlock(serial, &lock_code).await
}

/// Get the application-level YubiKey config.
#[tauri::command]
pub async fn yk_get_config(
    state: State<'_, YubiKeyServiceState>,
) -> CmdResult<YubiKeyConfig> {
    let svc = state.lock().await;
    Ok(svc.get_config())
}

/// Update the application-level YubiKey config.
#[tauri::command]
pub async fn yk_update_config(
    state: State<'_, YubiKeyServiceState>,
    config: YubiKeyConfig,
) -> CmdResult<()> {
    let mut svc = state.lock().await;
    svc.update_config(config);
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════
//  Audit commands
// ═══════════════════════════════════════════════════════════════════

/// Get recent audit entries.
#[tauri::command]
pub async fn yk_audit_log(
    state: State<'_, YubiKeyServiceState>,
    limit: usize,
) -> CmdResult<Vec<YubiKeyAuditEntry>> {
    let svc = state.lock().await;
    Ok(svc.audit_get_entries(limit))
}

/// Export audit log as JSON.
#[tauri::command]
pub async fn yk_audit_export(
    state: State<'_, YubiKeyServiceState>,
) -> CmdResult<String> {
    let svc = state.lock().await;
    svc.audit_export()
}

/// Clear the audit log.
#[tauri::command]
pub async fn yk_audit_clear(
    state: State<'_, YubiKeyServiceState>,
) -> CmdResult<()> {
    let mut svc = state.lock().await;
    svc.audit_clear();
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════
//  Management commands
// ═══════════════════════════════════════════════════════════════════

/// Factory reset all applets on a YubiKey.
#[tauri::command]
pub async fn yk_factory_reset_all(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
) -> CmdResult<HashMap<String, String>> {
    let mut svc = state.lock().await;
    let results = svc.factory_reset_all(serial).await?;
    // Flatten Result values to strings for JSON serialization
    let flat: HashMap<String, String> = results
        .into_iter()
        .map(|(k, v)| {
            let msg = match v {
                Ok(true) => "success".to_string(),
                Ok(false) => "failed".to_string(),
                Err(e) => format!("error: {}", e),
            };
            (k, msg)
        })
        .collect();
    Ok(flat)
}

/// Export a comprehensive device report.
#[tauri::command]
pub async fn yk_export_report(
    state: State<'_, YubiKeyServiceState>,
    serial: Option<u32>,
) -> CmdResult<String> {
    let svc = state.lock().await;
    svc.export_report(serial).await
}
