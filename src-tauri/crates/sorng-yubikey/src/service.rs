//! # YubiKey Service
//!
//! Top-level orchestrator combining detect, PIV, FIDO2, OATH, OTP,
//! config, management, and audit into a single service.

use crate::audit::YubiKeyAuditLogger;
use crate::types::*;
use log::info;
use std::collections::HashMap;

/// The main YubiKey service — orchestrates all modules.
pub struct YubiKeyService {
    /// Path to the `ykman` binary.
    pub ykman_path: String,
    /// Whether ykman has been detected.
    pub ykman_detected: bool,
    /// Audit logger.
    pub audit: YubiKeyAuditLogger,
    /// Application-level configuration.
    pub config: YubiKeyConfig,
    /// Cached list of detected devices.
    pub detected_devices: Vec<YubiKeyDevice>,
}

impl Default for YubiKeyService {
    fn default() -> Self {
        Self::new()
    }
}

impl YubiKeyService {
    /// Create a new YubiKey service.
    pub fn new() -> Self {
        Self {
            ykman_path: String::new(),
            ykman_detected: false,
            audit: YubiKeyAuditLogger::default_logger(),
            config: YubiKeyConfig::default(),
            detected_devices: Vec::new(),
        }
    }

    /// Detect `ykman` on the system.
    pub async fn detect_ykman(&mut self) -> Result<String, String> {
        // Use explicit path if configured
        if let Some(ref path) = self.config.ykman_path {
            if tokio::fs::metadata(path).await.is_ok() {
                self.ykman_path = path.clone();
                self.ykman_detected = true;
                info!("Using configured ykman at: {}", path);
                return Ok(path.clone());
            }
        }

        match crate::detect::detect_ykman().await {
            Ok(path) => {
                self.ykman_path = path.clone();
                self.ykman_detected = true;
                info!("Detected ykman at: {}", path);
                Ok(path)
            }
            Err(e) => {
                self.ykman_detected = false;
                Err(e)
            }
        }
    }

    /// Ensure ykman is available.
    fn require_ykman(&self) -> Result<&str, String> {
        if !self.ykman_detected || self.ykman_path.is_empty() {
            Err("ykman not detected. Call detect_ykman() first.".to_string())
        } else {
            Ok(&self.ykman_path)
        }
    }

    /// List all connected devices (refreshes cache).
    pub async fn list_devices(&mut self) -> Result<Vec<YubiKeyDevice>, String> {
        let ykman = self.require_ykman()?.to_string();
        let devices = crate::detect::list_devices(&ykman).await?;
        self.detected_devices = devices.clone();

        for dev in &devices {
            self.audit.log_event(
                YubiKeyAuditAction::DeviceDetected,
                Some(dev.serial),
                &format!(
                    "Detected: {} (fw {})",
                    dev.device_name, dev.firmware_version
                ),
                true,
                None,
            );
        }

        Ok(devices)
    }

    /// Get info for a specific device.
    pub async fn get_device_info(&self, serial: Option<u32>) -> Result<YubiKeyDevice, String> {
        let ykman = self.require_ykman()?;
        crate::detect::get_device_info(ykman, serial).await
    }

    /// Wait for a device to be inserted.
    pub async fn wait_for_device(&self, timeout_ms: u64) -> Result<Option<YubiKeyDevice>, String> {
        let ykman = self.require_ykman()?;
        Ok(crate::detect::wait_for_device(ykman, timeout_ms).await)
    }

    // ── PIV Delegates ───────────────────────────────────────────────

    pub async fn piv_list_certificates(
        &self,
        serial: Option<u32>,
    ) -> Result<Vec<PivSlotInfo>, String> {
        let ykman = self.require_ykman()?;
        crate::piv::list_certificates(ykman, serial).await
    }

    pub async fn piv_get_slot_info(
        &self,
        serial: Option<u32>,
        slot: &PivSlot,
    ) -> Result<PivSlotInfo, String> {
        let ykman = self.require_ykman()?;
        crate::piv::get_slot_info(ykman, serial, slot).await
    }

    pub async fn piv_generate_key(
        &mut self,
        serial: Option<u32>,
        slot: &PivSlot,
        algorithm: &PivAlgorithm,
        pin_policy: &PinPolicy,
        touch_policy: &TouchPolicy,
    ) -> Result<PivSlotInfo, String> {
        let ykman = self.require_ykman()?.to_string();
        let result =
            crate::piv::generate_key(&ykman, serial, slot, algorithm, pin_policy, touch_policy)
                .await;
        self.audit.log_event(
            YubiKeyAuditAction::PivGenerate,
            serial,
            &format!("Generate {} in slot {}", algorithm, slot),
            result.is_ok(),
            result.as_ref().err().cloned(),
        );
        result
    }

    pub async fn piv_self_sign_cert(
        &mut self,
        serial: Option<u32>,
        slot: &PivSlot,
        subject: &str,
        valid_days: u32,
    ) -> Result<PivCertificate, String> {
        let ykman = self.require_ykman()?.to_string();
        crate::piv::generate_self_signed_cert(&ykman, serial, slot, subject, valid_days).await
    }

    pub async fn piv_generate_csr(
        &self,
        serial: Option<u32>,
        slot: &PivSlot,
        params: &CsrParams,
    ) -> Result<String, String> {
        let ykman = self.require_ykman()?;
        crate::piv::generate_csr(ykman, serial, slot, params).await
    }

    pub async fn piv_import_cert(
        &mut self,
        serial: Option<u32>,
        slot: &PivSlot,
        pem: &str,
    ) -> Result<bool, String> {
        let ykman = self.require_ykman()?.to_string();
        let result = crate::piv::import_certificate(&ykman, serial, slot, pem).await;
        self.audit.log_event(
            YubiKeyAuditAction::PivImport,
            serial,
            &format!("Import cert to slot {}", slot),
            result.is_ok(),
            result.as_ref().err().cloned(),
        );
        result
    }

    pub async fn piv_import_key(
        &mut self,
        serial: Option<u32>,
        slot: &PivSlot,
        key_pem: &str,
        pin_policy: &PinPolicy,
        touch_policy: &TouchPolicy,
    ) -> Result<bool, String> {
        let ykman = self.require_ykman()?.to_string();
        let result =
            crate::piv::import_key(&ykman, serial, slot, key_pem, pin_policy, touch_policy).await;
        self.audit.log_event(
            YubiKeyAuditAction::PivImport,
            serial,
            &format!("Import key to slot {}", slot),
            result.is_ok(),
            result.as_ref().err().cloned(),
        );
        result
    }

    pub async fn piv_export_cert(
        &self,
        serial: Option<u32>,
        slot: &PivSlot,
    ) -> Result<String, String> {
        let ykman = self.require_ykman()?;
        crate::piv::export_certificate(ykman, serial, slot).await
    }

    pub async fn piv_delete_cert(
        &mut self,
        serial: Option<u32>,
        slot: &PivSlot,
    ) -> Result<bool, String> {
        let ykman = self.require_ykman()?.to_string();
        crate::piv::delete_certificate(&ykman, serial, slot).await
    }

    pub async fn piv_delete_key(
        &mut self,
        serial: Option<u32>,
        slot: &PivSlot,
    ) -> Result<bool, String> {
        let ykman = self.require_ykman()?.to_string();
        crate::piv::delete_key(&ykman, serial, slot).await
    }

    pub async fn piv_attest(
        &self,
        serial: Option<u32>,
        slot: &PivSlot,
    ) -> Result<AttestationResult, String> {
        let ykman = self.require_ykman()?;
        crate::piv::attest(ykman, serial, slot).await
    }

    pub async fn piv_change_pin(
        &mut self,
        serial: Option<u32>,
        old_pin: &str,
        new_pin: &str,
    ) -> Result<bool, String> {
        let ykman = self.require_ykman()?.to_string();
        let result = crate::piv::change_pin(&ykman, serial, old_pin, new_pin).await;
        self.audit.log_event(
            YubiKeyAuditAction::PivChangePIN,
            serial,
            "PIV PIN changed",
            result.is_ok(),
            result.as_ref().err().cloned(),
        );
        result
    }

    pub async fn piv_change_puk(
        &mut self,
        serial: Option<u32>,
        old_puk: &str,
        new_puk: &str,
    ) -> Result<bool, String> {
        let ykman = self.require_ykman()?.to_string();
        let result = crate::piv::change_puk(&ykman, serial, old_puk, new_puk).await;
        self.audit.log_event(
            YubiKeyAuditAction::PivChangePUK,
            serial,
            "PIV PUK changed",
            result.is_ok(),
            result.as_ref().err().cloned(),
        );
        result
    }

    pub async fn piv_change_management_key(
        &mut self,
        serial: Option<u32>,
        old_key: Option<&str>,
        new_key: &str,
        key_type: &ManagementKeyType,
        protect: bool,
    ) -> Result<bool, String> {
        let ykman = self.require_ykman()?.to_string();
        crate::piv::change_management_key(&ykman, serial, old_key, new_key, key_type, protect).await
    }

    pub async fn piv_unblock_pin(
        &mut self,
        serial: Option<u32>,
        puk: &str,
        new_pin: &str,
    ) -> Result<bool, String> {
        let ykman = self.require_ykman()?.to_string();
        crate::piv::unblock_pin(&ykman, serial, puk, new_pin).await
    }

    pub async fn piv_get_pin_status(&self, serial: Option<u32>) -> Result<PivPinStatus, String> {
        let ykman = self.require_ykman()?;
        crate::piv::get_pin_status(ykman, serial).await
    }

    pub async fn piv_reset(&mut self, serial: Option<u32>) -> Result<bool, String> {
        let ykman = self.require_ykman()?.to_string();
        let result = crate::piv::reset_piv(&ykman, serial).await;
        self.audit.log_event(
            YubiKeyAuditAction::PivResetPIV,
            serial,
            "PIV applet reset",
            result.is_ok(),
            result.as_ref().err().cloned(),
        );
        result
    }

    pub async fn piv_sign(
        &mut self,
        serial: Option<u32>,
        slot: &PivSlot,
        data: &[u8],
        algorithm: &str,
    ) -> Result<Vec<u8>, String> {
        let ykman = self.require_ykman()?.to_string();
        let result = crate::piv::sign_data(&ykman, serial, slot, data, algorithm).await;
        self.audit.log_event(
            YubiKeyAuditAction::PivSign,
            serial,
            &format!("Sign with slot {} ({})", slot, algorithm),
            result.is_ok(),
            result.as_ref().err().cloned(),
        );
        result
    }

    // ── FIDO2 Delegates ─────────────────────────────────────────────

    pub async fn fido2_info(&self, serial: Option<u32>) -> Result<Fido2DeviceInfo, String> {
        let ykman = self.require_ykman()?;
        crate::fido2::get_fido2_info(ykman, serial).await
    }

    pub async fn fido2_list_credentials(
        &self,
        serial: Option<u32>,
        pin: &str,
    ) -> Result<Vec<Fido2Credential>, String> {
        let ykman = self.require_ykman()?;
        crate::fido2::list_credentials(ykman, serial, pin).await
    }

    pub async fn fido2_delete_credential(
        &mut self,
        serial: Option<u32>,
        credential_id: &str,
        pin: &str,
    ) -> Result<bool, String> {
        let ykman = self.require_ykman()?.to_string();
        let result = crate::fido2::delete_credential(&ykman, serial, credential_id, pin).await;
        self.audit.log_event(
            YubiKeyAuditAction::FidoDeleteCredential,
            serial,
            &format!("Delete FIDO2 credential {}", credential_id),
            result.is_ok(),
            result.as_ref().err().cloned(),
        );
        result
    }

    pub async fn fido2_set_pin(
        &mut self,
        serial: Option<u32>,
        new_pin: &str,
    ) -> Result<bool, String> {
        let ykman = self.require_ykman()?.to_string();
        let result = crate::fido2::set_pin(&ykman, serial, new_pin).await;
        self.audit.log_event(
            YubiKeyAuditAction::FidoSetPIN,
            serial,
            "FIDO2 PIN set",
            result.is_ok(),
            result.as_ref().err().cloned(),
        );
        result
    }

    pub async fn fido2_change_pin(
        &mut self,
        serial: Option<u32>,
        old_pin: &str,
        new_pin: &str,
    ) -> Result<bool, String> {
        let ykman = self.require_ykman()?.to_string();
        let result = crate::fido2::change_pin(&ykman, serial, old_pin, new_pin).await;
        self.audit.log_event(
            YubiKeyAuditAction::FidoSetPIN,
            serial,
            "FIDO2 PIN changed",
            result.is_ok(),
            result.as_ref().err().cloned(),
        );
        result
    }

    pub async fn fido2_pin_status(&self, serial: Option<u32>) -> Result<Fido2PinStatus, String> {
        let ykman = self.require_ykman()?;
        crate::fido2::get_pin_status(ykman, serial).await
    }

    pub async fn fido2_reset(&mut self, serial: Option<u32>) -> Result<bool, String> {
        let ykman = self.require_ykman()?.to_string();
        let result = crate::fido2::reset_fido(&ykman, serial).await;
        self.audit.log_event(
            YubiKeyAuditAction::FidoResetFIDO,
            serial,
            "FIDO2 applet reset",
            result.is_ok(),
            result.as_ref().err().cloned(),
        );
        result
    }

    pub async fn fido2_toggle_always_uv(
        &self,
        serial: Option<u32>,
        enable: bool,
        pin: &str,
    ) -> Result<bool, String> {
        let ykman = self.require_ykman()?;
        crate::fido2::toggle_always_uv(ykman, serial, enable, pin).await
    }

    pub async fn fido2_list_rps(
        &self,
        serial: Option<u32>,
        pin: &str,
    ) -> Result<Vec<String>, String> {
        let ykman = self.require_ykman()?;
        crate::fido2::list_rp_ids(ykman, serial, pin).await
    }

    // ── OATH Delegates ──────────────────────────────────────────────

    pub async fn oath_list(&self, serial: Option<u32>) -> Result<Vec<OathAccount>, String> {
        let ykman = self.require_ykman()?;
        crate::oath::list_accounts(ykman, serial).await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn oath_add(
        &mut self,
        serial: Option<u32>,
        issuer: &str,
        name: &str,
        secret: &str,
        oath_type: &OathType,
        algorithm: &OathAlgorithm,
        digits: u8,
        period: u32,
        touch: bool,
    ) -> Result<bool, String> {
        let ykman = self.require_ykman()?.to_string();
        let result = crate::oath::add_account(
            &ykman, serial, issuer, name, secret, oath_type, algorithm, digits, period, touch,
        )
        .await;
        self.audit.log_event(
            YubiKeyAuditAction::OathAdd,
            serial,
            &format!("Add OATH {}:{}", issuer, name),
            result.is_ok(),
            result.as_ref().err().cloned(),
        );
        result
    }

    pub async fn oath_delete(
        &mut self,
        serial: Option<u32>,
        credential_id: &str,
    ) -> Result<bool, String> {
        let ykman = self.require_ykman()?.to_string();
        let result = crate::oath::delete_account(&ykman, serial, credential_id).await;
        self.audit.log_event(
            YubiKeyAuditAction::OathDelete,
            serial,
            &format!("Delete OATH {}", credential_id),
            result.is_ok(),
            result.as_ref().err().cloned(),
        );
        result
    }

    pub async fn oath_rename(
        &self,
        serial: Option<u32>,
        old_id: &str,
        new_issuer: &str,
        new_name: &str,
    ) -> Result<bool, String> {
        let ykman = self.require_ykman()?;
        crate::oath::rename_account(ykman, serial, old_id, new_issuer, new_name).await
    }

    pub async fn oath_calculate(
        &mut self,
        serial: Option<u32>,
        credential_id: &str,
    ) -> Result<OathCode, String> {
        let ykman = self.require_ykman()?.to_string();
        let result = crate::oath::calculate(&ykman, serial, credential_id).await;
        self.audit.log_event(
            YubiKeyAuditAction::OathCalculate,
            serial,
            &format!("Calculate OATH {}", credential_id),
            result.is_ok(),
            result.as_ref().err().cloned(),
        );
        result
    }

    pub async fn oath_calculate_all(
        &self,
        serial: Option<u32>,
    ) -> Result<Vec<(OathAccount, OathCode)>, String> {
        let ykman = self.require_ykman()?;
        crate::oath::calculate_all(ykman, serial).await
    }

    pub async fn oath_set_password(
        &mut self,
        serial: Option<u32>,
        password: &str,
    ) -> Result<bool, String> {
        let ykman = self.require_ykman()?.to_string();
        let result = crate::oath::set_password(&ykman, serial, password).await;
        self.audit.log_event(
            YubiKeyAuditAction::OathSetPassword,
            serial,
            "OATH password set",
            result.is_ok(),
            result.as_ref().err().cloned(),
        );
        result
    }

    pub async fn oath_reset(&mut self, serial: Option<u32>) -> Result<bool, String> {
        let ykman = self.require_ykman()?.to_string();
        let result = crate::oath::reset_oath(&ykman, serial).await;
        self.audit.log_event(
            YubiKeyAuditAction::OathResetOATH,
            serial,
            "OATH applet reset",
            result.is_ok(),
            result.as_ref().err().cloned(),
        );
        result
    }

    // ── OTP Delegates ───────────────────────────────────────────────

    pub async fn otp_info(
        &self,
        serial: Option<u32>,
    ) -> Result<(OtpSlotConfig, OtpSlotConfig), String> {
        let ykman = self.require_ykman()?;
        crate::otp::get_otp_info(ykman, serial).await
    }

    pub async fn otp_configure_yubico(
        &mut self,
        serial: Option<u32>,
        slot: &OtpSlot,
        public_id: Option<&str>,
        private_id: Option<&str>,
        key: Option<&str>,
    ) -> Result<bool, String> {
        let ykman = self.require_ykman()?.to_string();
        let result =
            crate::otp::configure_yubico_otp(&ykman, serial, slot, public_id, private_id, key)
                .await;
        self.audit.log_event(
            YubiKeyAuditAction::OtpConfigure,
            serial,
            &format!("Configure Yubico OTP on {}", slot),
            result.is_ok(),
            result.as_ref().err().cloned(),
        );
        result
    }

    pub async fn otp_configure_chalresp(
        &mut self,
        serial: Option<u32>,
        slot: &OtpSlot,
        key: Option<&str>,
        touch: bool,
    ) -> Result<bool, String> {
        let ykman = self.require_ykman()?.to_string();
        let result =
            crate::otp::configure_challenge_response(&ykman, serial, slot, key, touch).await;
        self.audit.log_event(
            YubiKeyAuditAction::OtpConfigure,
            serial,
            &format!("Configure challenge-response on {}", slot),
            result.is_ok(),
            result.as_ref().err().cloned(),
        );
        result
    }

    pub async fn otp_configure_static(
        &mut self,
        serial: Option<u32>,
        slot: &OtpSlot,
        password: &str,
        layout: &str,
    ) -> Result<bool, String> {
        let ykman = self.require_ykman()?.to_string();
        let result =
            crate::otp::configure_static_password(&ykman, serial, slot, password, layout).await;
        self.audit.log_event(
            YubiKeyAuditAction::OtpConfigure,
            serial,
            &format!("Configure static password on {}", slot),
            result.is_ok(),
            result.as_ref().err().cloned(),
        );
        result
    }

    pub async fn otp_configure_hotp(
        &mut self,
        serial: Option<u32>,
        slot: &OtpSlot,
        key: &str,
        digits: u8,
    ) -> Result<bool, String> {
        let ykman = self.require_ykman()?.to_string();
        let result = crate::otp::configure_hotp(&ykman, serial, slot, key, digits).await;
        self.audit.log_event(
            YubiKeyAuditAction::OtpConfigure,
            serial,
            &format!("Configure HOTP on {}", slot),
            result.is_ok(),
            result.as_ref().err().cloned(),
        );
        result
    }

    pub async fn otp_delete(
        &mut self,
        serial: Option<u32>,
        slot: &OtpSlot,
    ) -> Result<bool, String> {
        let ykman = self.require_ykman()?.to_string();
        let result = crate::otp::delete_slot(&ykman, serial, slot).await;
        self.audit.log_event(
            YubiKeyAuditAction::OtpDelete,
            serial,
            &format!("Delete OTP {}", slot),
            result.is_ok(),
            result.as_ref().err().cloned(),
        );
        result
    }

    pub async fn otp_swap(&mut self, serial: Option<u32>) -> Result<bool, String> {
        let ykman = self.require_ykman()?.to_string();
        let result = crate::otp::swap_slots(&ykman, serial).await;
        self.audit.log_event(
            YubiKeyAuditAction::OtpSwap,
            serial,
            "Swapped OTP slots",
            result.is_ok(),
            result.as_ref().err().cloned(),
        );
        result
    }

    // ── Config Delegates ────────────────────────────────────────────

    pub async fn config_set_interfaces(
        &self,
        serial: Option<u32>,
        usb: &[YubiKeyInterface],
        nfc: &[YubiKeyInterface],
    ) -> Result<bool, String> {
        let ykman = self.require_ykman()?;
        crate::config::set_mode(ykman, serial, usb, nfc).await
    }

    pub async fn config_lock(&self, serial: Option<u32>, lock_code: &str) -> Result<bool, String> {
        let ykman = self.require_ykman()?;
        crate::config::lock_config(ykman, serial, lock_code).await
    }

    pub async fn config_unlock(
        &self,
        serial: Option<u32>,
        lock_code: &str,
    ) -> Result<bool, String> {
        let ykman = self.require_ykman()?;
        crate::config::unlock_config(ykman, serial, lock_code).await
    }

    pub fn get_config(&self) -> YubiKeyConfig {
        self.config.clone()
    }

    pub fn update_config(&mut self, config: YubiKeyConfig) {
        self.config = config;
        self.audit.log_event(
            YubiKeyAuditAction::ConfigUpdate,
            None,
            "Configuration updated",
            true,
            None,
        );
    }

    // ── Management Delegates ────────────────────────────────────────

    pub async fn factory_reset_all(
        &mut self,
        serial: Option<u32>,
    ) -> Result<HashMap<String, Result<bool, String>>, String> {
        let ykman = self.require_ykman()?.to_string();
        let result = crate::management::factory_reset_all(&ykman, serial).await;
        self.audit.log_event(
            YubiKeyAuditAction::FactoryReset,
            serial,
            "Factory reset all applets",
            result.is_ok(),
            result.as_ref().err().cloned(),
        );
        result
    }

    pub async fn get_diagnostics(
        &self,
        serial: Option<u32>,
    ) -> Result<HashMap<String, String>, String> {
        let ykman = self.require_ykman()?;
        crate::management::get_diagnostics(ykman, serial).await
    }

    pub async fn export_report(&self, serial: Option<u32>) -> Result<String, String> {
        let ykman = self.require_ykman()?;
        crate::management::export_device_report(ykman, serial).await
    }

    // ── Audit Delegates ─────────────────────────────────────────────

    pub fn audit_get_entries(&self, limit: usize) -> Vec<YubiKeyAuditEntry> {
        self.audit.get_entries(limit)
    }

    pub fn audit_export(&self) -> Result<String, String> {
        self.audit.export_json()
    }

    pub fn audit_clear(&mut self) {
        self.audit.clear();
    }
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_service_new() {
        let svc = YubiKeyService::new();
        assert!(!svc.ykman_detected);
        assert!(svc.ykman_path.is_empty());
        assert!(svc.detected_devices.is_empty());
    }

    #[test]
    fn test_require_ykman_fails_undetected() {
        let svc = YubiKeyService::new();
        assert!(svc.require_ykman().is_err());
    }

    #[test]
    fn test_get_config_default() {
        let svc = YubiKeyService::new();
        let cfg = svc.get_config();
        assert!(cfg.auto_detect);
        assert_eq!(cfg.poll_interval_ms, 5000);
    }

    #[test]
    fn test_update_config() {
        let mut svc = YubiKeyService::new();
        let mut cfg = svc.get_config();
        cfg.poll_interval_ms = 10000;
        svc.update_config(cfg);
        assert_eq!(svc.config.poll_interval_ms, 10000);
        // Audit should have one entry
        assert_eq!(svc.audit.entry_count(), 1);
    }

    #[test]
    fn test_audit_operations() {
        let mut svc = YubiKeyService::new();
        svc.audit.log_event(
            YubiKeyAuditAction::DeviceDetected,
            Some(111),
            "test",
            true,
            None,
        );
        assert_eq!(svc.audit_get_entries(10).len(), 1);
        let json = svc.audit_export().unwrap();
        assert!(json.contains("DeviceDetected"));
        svc.audit_clear();
        assert_eq!(svc.audit_get_entries(10).len(), 0);
    }
}
