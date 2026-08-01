//! # OpenPGP Smart Card Operations
//!
//! Manages OpenPGP smart cards and hardware tokens (YubiKey, etc.)
//! via `gpg --card-status`, scdaemon commands, and the Assuan protocol.

use crate::protocol::{
    run_gpg_command_classified, run_gpg_command_with_input, AssuanClient, GpgCommandStatus,
};
use crate::types::*;
use log::info;

const FACTORY_RESET_SCRIPT: &str = "admin\nfactory-reset\ny\nyes\nquit\n";

#[derive(Clone, Copy)]
enum CardEditField {
    Name,
    Url,
    Login,
    Language,
    Sex,
}

impl CardEditField {
    fn command(self) -> &'static str {
        match self {
            Self::Name => "name",
            Self::Url => "url",
            Self::Login => "login",
            Self::Language => "lang",
            Self::Sex => "sex",
        }
    }

    fn display_name(self) -> &'static str {
        match self {
            Self::Name => "card holder name",
            Self::Url => "card URL",
            Self::Login => "card login",
            Self::Language => "card language",
            Self::Sex => "card sex",
        }
    }

    fn max_bytes(self) -> usize {
        match self {
            Self::Name => 39,
            Self::Url | Self::Login => 254,
            Self::Language | Self::Sex => 2,
        }
    }
}

fn validate_card_edit_value(field: CardEditField, value: &str) -> Result<String, String> {
    if value.len() > field.max_bytes()
        || value
            .chars()
            .any(|ch| ch.is_control() || matches!(ch, '\u{2028}' | '\u{2029}'))
    {
        return Err(format!("Invalid {}", field.display_name()));
    }

    match field {
        CardEditField::Language => {
            if value.len() != 2 || !value.bytes().all(|byte| byte.is_ascii_alphabetic()) {
                return Err("Invalid card language".to_string());
            }
            Ok(value.to_ascii_lowercase())
        }
        CardEditField::Sex if !matches!(value, "0" | "1" | "2") => {
            Err("Invalid card sex".to_string())
        }
        _ => Ok(value.to_string()),
    }
}

fn build_card_edit_script(field: CardEditField, value: &str) -> Result<String, String> {
    let value = validate_card_edit_value(field, value)?;
    let extra_prompt = if matches!(field, CardEditField::Name) {
        "\n"
    } else {
        ""
    };
    Ok(format!(
        "admin\n{}\n{}\n{}quit\n",
        field.command(),
        value,
        extra_prompt
    ))
}

fn propagate_card_edit_result(result: Result<Vec<u8>, String>) -> Result<bool, String> {
    result.map(|_| true)
}

fn pin_change_chv(pin_type: &str) -> Result<&'static str, String> {
    match pin_type.to_ascii_lowercase().as_str() {
        "pin" | "user" => Ok("1"),
        "admin" => Ok("3"),
        _ => Err("Unsupported card PIN action".to_string()),
    }
}

fn slot_fingerprint(info: &SmartCardInfo, slot: CardSlot) -> Option<&str> {
    match slot {
        CardSlot::Signature => info.signature_key_fingerprint.as_deref(),
        CardSlot::Encryption => info.encryption_key_fingerprint.as_deref(),
        CardSlot::Authentication => info.authentication_key_fingerprint.as_deref(),
    }
}

fn validate_card_generation(
    info: &SmartCardInfo,
    slot: CardSlot,
    requested: &GpgKeyAlgorithm,
) -> Result<(), String> {
    if matches!(
        requested,
        GpgKeyAlgorithm::Rsa1024
            | GpgKeyAlgorithm::Dsa
            | GpgKeyAlgorithm::ElGamal
            | GpgKeyAlgorithm::Unknown(_)
    ) {
        return Err("Requested smart-card key algorithm is unsupported or unsafe".to_string());
    }
    if slot_fingerprint(info, slot).is_some_and(|fingerprint| !fingerprint.is_empty()) {
        return Err("The selected smart-card slot already contains a key".to_string());
    }
    let configured = info
        .key_attributes
        .iter()
        .find(|attribute| attribute.slot == slot)
        .ok_or_else(|| {
            "The selected smart-card slot has no configured key algorithm".to_string()
        })?;
    if configured.algorithm != *requested {
        return Err(format!(
            "Requested algorithm {} does not match the card slot algorithm {}",
            requested, configured.algorithm
        ));
    }
    Ok(())
}

/// Smart card / hardware token manager.
pub struct CardManager {
    gpg_binary: String,
    home_dir: Option<String>,
}

impl CardManager {
    /// Create a new card manager.
    pub fn new(gpg_binary: &str, home_dir: Option<String>) -> Self {
        Self {
            gpg_binary: gpg_binary.to_string(),
            home_dir,
        }
    }

    /// Common GPG arguments.
    fn base_args(&self) -> Vec<String> {
        let mut args = vec!["--batch".to_string(), "--no-tty".to_string()];
        if let Some(ref home) = self.home_dir {
            if !home.is_empty() {
                args.push("--homedir".to_string());
                args.push(home.clone());
            }
        }
        args
    }

    /// Get the status of the current smart card.
    pub async fn get_card_status(&self) -> Result<Option<SmartCardInfo>, String> {
        let mut args = self.base_args();
        args.push("--with-colons".to_string());
        args.push("--card-status".to_string());

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let output = run_gpg_command_classified(&self.gpg_binary, &args_ref).await?;
        if output.status() == GpgCommandStatus::CardAbsent {
            return Ok(None);
        }
        if output.status() != GpgCommandStatus::Success {
            return Err(output.sanitized_error());
        }
        let output = String::from_utf8_lossy(output.stdout()).into_owned();
        if output.trim().is_empty() {
            return Ok(None);
        }

        Ok(Some(parse_card_status_colons(&output)))
    }

    /// Change card PIN.
    ///
    /// `pin_type` can be "user" (CHV1/CHV2) or "admin" (CHV3).
    pub async fn change_pin(&self, pin_type: &str) -> Result<bool, String> {
        let chv = pin_change_chv(pin_type)?;
        let mut client = AssuanClient::new(&self.gpg_binary, self.home_dir.clone());
        client.connect().await?;
        client.scd_passwd(chv).await?;
        info!("Changed card PIN type: {}", pin_type);
        Ok(true)
    }

    /// Unblock a blocked PIN using the reset code.
    pub async fn unblock_pin(&self) -> Result<bool, String> {
        let mut client = AssuanClient::new(&self.gpg_binary, self.home_dir.clone());
        client.connect().await?;
        client.scd_unblock_pin().await?;
        info!("Unblocked card PIN");
        Ok(true)
    }

    /// Factory-reset the smart card.
    pub async fn factory_reset(&self, expected_serial: &str) -> Result<bool, String> {
        let current = self
            .get_card_status()
            .await?
            .ok_or_else(|| "No smart card is present".to_string())?;
        if current.serial.is_empty() || current.serial != expected_serial {
            return Err(
                "The inserted smart card no longer matches the reset confirmation".to_string(),
            );
        }

        let mut args = self.base_args();
        args.retain(|a| a != "--with-colons");
        args.push("--command-fd".to_string());
        args.push("0".to_string());
        args.push("--card-edit".to_string());

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        propagate_card_edit_result(
            run_gpg_command_with_input(
                &self.gpg_binary,
                &args_ref,
                FACTORY_RESET_SCRIPT.as_bytes(),
            )
            .await,
        )?;

        info!("Factory-reset smart card");
        Ok(true)
    }

    /// Set the card holder name.
    pub async fn set_card_holder(&self, name: &str) -> Result<bool, String> {
        let script = build_card_edit_script(CardEditField::Name, name)?;
        self.card_edit_command(&script).await
    }

    /// Set the card public key URL.
    pub async fn set_card_url(&self, url: &str) -> Result<bool, String> {
        let script = build_card_edit_script(CardEditField::Url, url)?;
        self.card_edit_command(&script).await
    }

    /// Set the card login data.
    pub async fn set_card_login(&self, login: &str) -> Result<bool, String> {
        let script = build_card_edit_script(CardEditField::Login, login)?;
        self.card_edit_command(&script).await
    }

    /// Set the card language preference.
    pub async fn set_card_lang(&self, lang: &str) -> Result<bool, String> {
        let script = build_card_edit_script(CardEditField::Language, lang)?;
        self.card_edit_command(&script).await
    }

    /// Set the card holder sex.
    pub async fn set_card_sex(&self, sex: char) -> Result<bool, String> {
        let sex_val = match sex {
            'm' | 'M' => "1",
            'f' | 'F' => "2",
            _ => "0",
        };
        let script = build_card_edit_script(CardEditField::Sex, sex_val)?;
        self.card_edit_command(&script).await
    }

    /// Generate a key on the smart card.
    pub async fn generate_key_on_card(
        &self,
        slot: CardSlot,
        algorithm: &GpgKeyAlgorithm,
    ) -> Result<bool, String> {
        let info = self
            .get_card_status()
            .await?
            .ok_or_else(|| "No smart card is present".to_string())?;
        validate_card_generation(&info, slot, algorithm)?;

        let mut client = AssuanClient::new(&self.gpg_binary, self.home_dir.clone());
        client.connect().await?;

        let result = client.scd_genkey(slot.index(), false).await?;
        info!(
            "Generated key on card slot {}: {}",
            slot,
            if result.is_empty() { "ok" } else { &result }
        );
        Ok(true)
    }

    /// Move (transfer) a subkey to the smart card.
    pub async fn move_key_to_card(
        &self,
        key_id: &str,
        subkey_index: usize,
        slot: CardSlot,
    ) -> Result<bool, String> {
        if subkey_index == 0 || subkey_index > 255 {
            return Err("Subkey index must be between 1 and 255".to_string());
        }
        let slot_num = slot.index();
        let script = format!("key {}\nkeytocard\n{}\nsave\n", subkey_index, slot_num);

        let mut args = self.base_args();
        args.retain(|a| a != "--with-colons");
        args.push("--command-fd".to_string());
        args.push("0".to_string());
        args.push("--edit-key".to_string());
        args.push(key_id.to_string());

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let _output =
            run_gpg_command_with_input(&self.gpg_binary, &args_ref, script.as_bytes()).await?;

        info!(
            "Moved subkey {} of {} to card slot {}",
            subkey_index, key_id, slot
        );
        Ok(true)
    }

    /// Fetch the public key from the URL stored on the card.
    pub async fn fetch_key_from_card(&self) -> Result<KeyImportResult, String> {
        let mut args = self.base_args();
        args.push("--card-edit".to_string());

        let script = "fetch\nquit\n";
        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let output =
            run_gpg_command_with_input(&self.gpg_binary, &args_ref, script.as_bytes()).await?;

        let output_str = String::from_utf8_lossy(&output).to_string();
        Ok(crate::keyring::parse_import_result(&output_str))
    }

    // ── Internal helpers ────────────────────────────────────────────

    /// Run a card-edit command with a script.
    async fn card_edit_command(&self, script: &str) -> Result<bool, String> {
        let mut args = self.base_args();
        args.retain(|a| a != "--with-colons");
        args.push("--command-fd".to_string());
        args.push("0".to_string());
        args.push("--card-edit".to_string());

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        propagate_card_edit_result(
            run_gpg_command_with_input(&self.gpg_binary, &args_ref, script.as_bytes()).await,
        )
    }
}

// ── Card Status Parsing ─────────────────────────────────────────────

/// Parse `gpg --card-status --with-colons` output.
pub fn parse_card_status_colons(output: &str) -> SmartCardInfo {
    let mut info = SmartCardInfo::default();

    for line in output.lines() {
        let fields: Vec<&str> = line.split(':').collect();
        if fields.is_empty() {
            continue;
        }

        match fields[0] {
            "Reader" if fields.len() > 1 => {
                info.reader = fields[1..].join(":");
            }
            "AID" | "serialno" if fields.len() > 1 => {
                info.serial = fields[1].to_string();
            }
            "version" if fields.len() > 1 => {
                info.application_version = fields[1].to_string();
            }
            "vendor" | "manufacturer" => {
                if fields.len() > 2 {
                    info.manufacturer = fields[2].to_string();
                } else if fields.len() > 1 {
                    info.manufacturer = fields[1].to_string();
                }
            }
            "disp-name" if fields.len() > 1 => {
                info.card_holder = fields[1].to_string();
            }
            "lang" if fields.len() > 1 => {
                info.language = fields[1].to_string();
            }
            "sex" if fields.len() > 1 => {
                info.sex = fields[1].chars().next();
            }
            "url" if fields.len() > 1 => {
                info.public_key_url = fields[1..].join(":");
            }
            "login" if fields.len() > 1 => {
                info.login_data = fields[1].to_string();
            }
            "forcepin" => {}
            "maxpinlen" => {}
            "pinretry" if fields.len() > 3 => {
                let p1 = fields[1].parse().unwrap_or(3);
                let p2 = fields[2].parse().unwrap_or(0);
                let p3 = fields[3].parse().unwrap_or(3);
                info.pin_retry_count = (p1, p2, p3);
            }
            "sigcount" if fields.len() > 1 => {
                info.signature_count = fields[1].parse().unwrap_or(0);
            }
            "cafpr" => {
                for f in &fields[1..] {
                    if !f.is_empty() {
                        info.ca_fingerprints.push(f.to_string());
                    }
                }
            }
            "fpr" if fields.len() > 1 && !fields[1].is_empty() => {
                // Key fingerprints: signature, encryption, authentication slots
                if info.signature_key_fingerprint.is_none() {
                    info.signature_key_fingerprint = Some(fields[1].to_string());
                } else if info.encryption_key_fingerprint.is_none() {
                    info.encryption_key_fingerprint = Some(fields[1].to_string());
                } else if info.authentication_key_fingerprint.is_none() {
                    info.authentication_key_fingerprint = Some(fields[1].to_string());
                }
            }
            "private-do-1" if fields.len() > 1 => {
                info.private_do1 = fields[1].to_string();
            }
            "private-do-2" if fields.len() > 1 => {
                info.private_do2 = fields[1].to_string();
            }
            "private-do-3" if fields.len() > 1 => {
                info.private_do3 = fields[1].to_string();
            }
            "private-do-4" if fields.len() > 1 => {
                info.private_do4 = fields[1].to_string();
            }
            "key-attr" if fields.len() > 3 => {
                // key-attr:<slot>:<algo>:<bits_or_curve>
                let slot = match fields[1] {
                    "1" => CardSlot::Signature,
                    "2" => CardSlot::Encryption,
                    "3" => CardSlot::Authentication,
                    _ => continue,
                };
                let algo = match (fields[2], fields[3]) {
                    ("1" | "RSA", "1024") => GpgKeyAlgorithm::Rsa1024,
                    ("1" | "RSA", "2048") => GpgKeyAlgorithm::Rsa2048,
                    ("1" | "RSA", "3072") => GpgKeyAlgorithm::Rsa3072,
                    ("1" | "RSA", "4096") => GpgKeyAlgorithm::Rsa4096,
                    (id, parameter) => {
                        let by_parameter = GpgKeyAlgorithm::from_gpg_id(parameter);
                        if matches!(by_parameter, GpgKeyAlgorithm::Unknown(_)) {
                            GpgKeyAlgorithm::from_gpg_id(id)
                        } else {
                            by_parameter
                        }
                    }
                };
                let bits = fields[3].parse().unwrap_or(0);
                let curve = if bits == 0 {
                    Some(fields[3].to_string())
                } else {
                    None
                };
                info.key_attributes.push(CardKeyAttribute {
                    slot,
                    algorithm: algo,
                    bits,
                    curve,
                });
            }
            "extcap" if fields.len() > 1 => {
                for cap in fields[1].split(',') {
                    if !cap.is_empty() {
                        info.extended_capabilities.push(cap.to_string());
                    }
                }
            }
            _ => {}
        }
    }

    info
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_CARD_STATUS: &str = "\
Reader:Yubico YubiKey OTP+FIDO+CCID 0\n\
AID:D27600012401030400050000XXXX\n\
version:0304\n\
vendor:0006:Yubico\n\
disp-name:Smith<<John\n\
lang:en\n\
sex:m\n\
url:https://example.com/key.asc\n\
login:jsmith\n\
pinretry:3:0:3\n\
sigcount:42\n\
fpr:AABBCCDD11223344AABBCCDD11223344AABBCCDD\n\
fpr:EEFF001122334455EEFF001122334455EEFF0011\n\
fpr:1234567890ABCDEF1234567890ABCDEF12345678\n\
key-attr:1:22:ed25519\n\
key-attr:2:18:cv25519\n\
key-attr:3:22:ed25519\n\
extcap:ki=1,aac=1,bt=1,kdf=1\n\
";

    #[test]
    fn test_parse_card_status() {
        let info = parse_card_status_colons(SAMPLE_CARD_STATUS);
        assert_eq!(info.reader, "Yubico YubiKey OTP+FIDO+CCID 0");
        assert_eq!(info.serial, "D27600012401030400050000XXXX");
        assert_eq!(info.application_version, "0304");
        assert_eq!(info.manufacturer, "Yubico");
        assert_eq!(info.card_holder, "Smith<<John");
        assert_eq!(info.language, "en");
        assert_eq!(info.sex, Some('m'));
        assert_eq!(info.public_key_url, "https://example.com/key.asc");
        assert_eq!(info.login_data, "jsmith");
        assert_eq!(info.pin_retry_count, (3, 0, 3));
        assert_eq!(info.signature_count, 42);
        assert_eq!(
            info.signature_key_fingerprint.as_deref(),
            Some("AABBCCDD11223344AABBCCDD11223344AABBCCDD")
        );
        assert_eq!(
            info.encryption_key_fingerprint.as_deref(),
            Some("EEFF001122334455EEFF001122334455EEFF0011")
        );
        assert_eq!(
            info.authentication_key_fingerprint.as_deref(),
            Some("1234567890ABCDEF1234567890ABCDEF12345678")
        );
        assert_eq!(info.key_attributes.len(), 3);
        assert_eq!(info.key_attributes[0].slot, CardSlot::Signature);
        assert!(!info.extended_capabilities.is_empty());
    }

    #[test]
    fn test_parse_empty_card_status() {
        let info = parse_card_status_colons("");
        assert!(info.serial.is_empty());
        assert!(info.card_holder.is_empty());
    }

    #[test]
    fn test_card_manager_new() {
        let mgr = CardManager::new("gpg", Some("/tmp/card-home".to_string()));
        assert_eq!(mgr.gpg_binary, "gpg");
        assert_eq!(mgr.home_dir.as_deref(), Some("/tmp/card-home"));
    }

    #[test]
    fn test_card_slot_index() {
        assert_eq!(CardSlot::Signature.index(), 1);
        assert_eq!(CardSlot::Encryption.index(), 2);
        assert_eq!(CardSlot::Authentication.index(), 3);
    }

    #[test]
    fn test_parse_card_fingerprints_partial() {
        let output = "fpr:AAAA\nfpr:BBBB\n";
        let info = parse_card_status_colons(output);
        assert_eq!(info.signature_key_fingerprint.as_deref(), Some("AAAA"));
        assert_eq!(info.encryption_key_fingerprint.as_deref(), Some("BBBB"));
        assert!(info.authentication_key_fingerprint.is_none());
    }

    #[test]
    fn card_edit_scripts_are_deterministic() {
        assert_eq!(
            build_card_edit_script(CardEditField::Name, "Doe").unwrap(),
            "admin\nname\nDoe\n\nquit\n"
        );
        assert_eq!(
            build_card_edit_script(CardEditField::Url, "https://example.test/key").unwrap(),
            "admin\nurl\nhttps://example.test/key\nquit\n"
        );
        assert_eq!(
            build_card_edit_script(CardEditField::Language, "EN").unwrap(),
            "admin\nlang\nen\nquit\n"
        );
        assert_eq!(FACTORY_RESET_SCRIPT, "admin\nfactory-reset\ny\nyes\nquit\n");
    }

    #[test]
    fn card_edit_values_reject_script_and_control_injection() {
        for field in [
            CardEditField::Name,
            CardEditField::Url,
            CardEditField::Login,
            CardEditField::Language,
        ] {
            for value in [
                "safe\nquit",
                "safe\rquit",
                "safe\0quit",
                "safe\tquit",
                "safe\u{1b}quit",
                "safe\u{2028}quit",
            ] {
                assert!(build_card_edit_script(field, value).is_err());
            }
        }
        assert!(build_card_edit_script(CardEditField::Language, "eng").is_err());
        assert!(build_card_edit_script(CardEditField::Language, "1n").is_err());
        assert!(build_card_edit_script(CardEditField::Sex, "admin").is_err());
    }

    #[test]
    fn card_edit_helper_failures_are_propagated() {
        let error = "deterministic helper failure".to_string();
        assert_eq!(
            propagate_card_edit_result(Err(error.clone())).unwrap_err(),
            error
        );
        assert_eq!(propagate_card_edit_result(Ok(Vec::new())), Ok(true));
    }

    #[test]
    fn pin_change_and_unblock_semantics_are_not_conflated() {
        assert_eq!(pin_change_chv("user").unwrap(), "1");
        assert_eq!(pin_change_chv("admin").unwrap(), "3");
        assert!(pin_change_chv("reset").is_err());
        assert!(pin_change_chv("unblock").is_err());
    }

    #[test]
    fn generation_requires_matching_safe_empty_slot_algorithm() {
        let mut info = SmartCardInfo::default();
        info.key_attributes.push(CardKeyAttribute {
            slot: CardSlot::Signature,
            algorithm: GpgKeyAlgorithm::Rsa3072,
            bits: 3072,
            curve: None,
        });
        assert!(
            validate_card_generation(&info, CardSlot::Signature, &GpgKeyAlgorithm::Rsa3072).is_ok()
        );
        assert!(
            validate_card_generation(&info, CardSlot::Signature, &GpgKeyAlgorithm::Rsa2048)
                .is_err()
        );
        info.signature_key_fingerprint = Some("AABBCCDD".to_string());
        assert!(
            validate_card_generation(&info, CardSlot::Signature, &GpgKeyAlgorithm::Rsa3072)
                .is_err()
        );
    }

    #[test]
    fn card_rsa_attribute_size_controls_algorithm() {
        let info = parse_card_status_colons("key-attr:1:1:4096\n");
        assert_eq!(info.key_attributes[0].algorithm, GpgKeyAlgorithm::Rsa4096);
    }
}
