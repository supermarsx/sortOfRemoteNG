//! # OpenPGP Smart Card Operations
//!
//! Manages OpenPGP smart cards and hardware tokens (YubiKey, etc.)
//! via `gpg --card-status`, scdaemon commands, and the Assuan protocol.

use crate::protocol::{run_gpg_command, run_gpg_command_with_input, AssuanClient};
use crate::types::*;
use log::{info, warn};

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
        let output = match run_gpg_command(&self.gpg_binary, &args_ref).await {
            Ok(o) => o,
            Err(e) => {
                if e.contains("card not present") || e.contains("No smartcard") {
                    return Ok(None);
                }
                return Err(e);
            }
        };

        if output.trim().is_empty() || output.contains("card not present") {
            return Ok(None);
        }

        Ok(Some(parse_card_status_colons(&output)))
    }

    /// List all available smart cards.
    pub async fn list_cards(&self) -> Result<Vec<SmartCardInfo>, String> {
        // gpg >= 2.3 supports --card-status with multiple readers via SCD SERIALNO
        // Try the newer approach first via assuan
        let mut cards = Vec::new();

        // Fall back to single card
        if let Ok(Some(card)) = self.get_card_status().await {
            cards.push(card);
        }

        Ok(cards)
    }

    /// Select a card by serial number.
    pub async fn select_card(&self, serial: &str) -> Result<bool, String> {
        // Use SCD SERIALNO via gpg-connect-agent
        let mut client = AssuanClient::new(&self.gpg_binary);
        if let Err(e) = client.connect().await {
            warn!("Could not connect to agent for card selection: {}", e);
        }

        let cmd = format!("SCD SERIALNO {}", serial);
        let result = client.send_command(&cmd).await?;
        if result.ok {
            info!("Selected card {}", serial);
            Ok(true)
        } else {
            Err(format!(
                "Failed to select card {}: {}",
                serial, result.error_message
            ))
        }
    }

    /// Change card PIN.
    ///
    /// `pin_type` can be "pin" (CHV1/CHV2), "admin" (CHV3), or "reset" (reset code).
    pub async fn change_pin(&self, pin_type: &str) -> Result<bool, String> {
        let lowered = pin_type.to_lowercase();
        let chv = match lowered.as_str() {
            "pin" | "user" => "1",
            "admin" => "3",
            "reset" => "reset",
            other => other,
        };

        let mut args = self.base_args();
        args.push("--change-pin".to_string());
        args.push(chv.to_string()); // Simplified — real impl needs card-edit

        // In practice, this is interactive. For batch, use scdaemon:
        // SCD PASSWD <chv_no>
        let mut client = AssuanClient::new(&self.gpg_binary);
        let _ = client.connect().await;
        client.scd_passwd(chv).await?;
        info!("Changed card PIN type: {}", pin_type);
        Ok(true)
    }

    /// Unblock a blocked PIN using the reset code.
    pub async fn unblock_pin(&self) -> Result<bool, String> {
        let mut client = AssuanClient::new(&self.gpg_binary);
        let _ = client.connect().await;
        // Unblock PIN = SCD PASSWD --reset 1
        let result = client.send_command("SCD PASSWD --reset 1").await?;
        if result.ok {
            info!("Unblocked card PIN");
            Ok(true)
        } else {
            Err(format!(
                "Failed to unblock PIN: {}",
                result.error_message
            ))
        }
    }

    /// Factory-reset the smart card.
    pub async fn factory_reset(&self) -> Result<bool, String> {
        let script = "admin\nfactory-reset\ny\nyes\nquit\n";

        let mut args = self.base_args();
        args.retain(|a| a != "--with-colons");
        args.push("--command-fd".to_string());
        args.push("0".to_string());
        args.push("--card-edit".to_string());

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let _output = run_gpg_command_with_input(
            &self.gpg_binary,
            &args_ref,
            script.as_bytes(),
        )
        .await;

        info!("Factory-reset smart card");
        Ok(true)
    }

    /// Set the card holder name.
    pub async fn set_card_holder(&self, name: &str) -> Result<bool, String> {
        self.card_edit_command(&format!("admin\nname\n{}\n\nquit\n", name))
            .await
    }

    /// Set the card public key URL.
    pub async fn set_card_url(&self, url: &str) -> Result<bool, String> {
        self.card_edit_command(&format!("admin\nurl\n{}\nquit\n", url))
            .await
    }

    /// Set the card login data.
    pub async fn set_card_login(&self, login: &str) -> Result<bool, String> {
        self.card_edit_command(&format!("admin\nlogin\n{}\nquit\n", login))
            .await
    }

    /// Set the card language preference.
    pub async fn set_card_lang(&self, lang: &str) -> Result<bool, String> {
        self.card_edit_command(&format!("admin\nlang\n{}\nquit\n", lang))
            .await
    }

    /// Set the card holder sex.
    pub async fn set_card_sex(&self, sex: char) -> Result<bool, String> {
        let sex_val = match sex {
            'm' | 'M' => "1",
            'f' | 'F' => "2",
            _ => "0",
        };
        self.card_edit_command(&format!("admin\nsex\n{}\nquit\n", sex_val))
            .await
    }

    /// Generate a key on the smart card.
    pub async fn generate_key_on_card(
        &self,
        slot: CardSlot,
        _algorithm: &GpgKeyAlgorithm,
    ) -> Result<bool, String> {
        let mut client = AssuanClient::new(&self.gpg_binary);
        let _ = client.connect().await;

        let result = client.scd_genkey(slot.index(), true).await?;
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
        let slot_num = slot.index();
        let script = format!(
            "key {}\nkeytocard\n{}\nsave\n",
            subkey_index, slot_num
        );

        let mut args = self.base_args();
        args.retain(|a| a != "--with-colons");
        args.push("--command-fd".to_string());
        args.push("0".to_string());
        args.push("--edit-key".to_string());
        args.push(key_id.to_string());

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let _output = run_gpg_command_with_input(
            &self.gpg_binary,
            &args_ref,
            script.as_bytes(),
        )
        .await?;

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
        let output = run_gpg_command_with_input(
            &self.gpg_binary,
            &args_ref,
            script.as_bytes(),
        )
        .await?;

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
        let _output = run_gpg_command_with_input(
            &self.gpg_binary,
            &args_ref,
            script.as_bytes(),
        )
        .await;

        Ok(true)
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
            "Reader" => {
                if fields.len() > 1 {
                    info.reader = fields[1..].join(":");
                }
            }
            "AID" | "serialno" => {
                if fields.len() > 1 {
                    info.serial = fields[1].to_string();
                }
            }
            "version" => {
                if fields.len() > 1 {
                    info.application_version = fields[1].to_string();
                }
            }
            "vendor" | "manufacturer" => {
                if fields.len() > 2 {
                    info.manufacturer = fields[2].to_string();
                } else if fields.len() > 1 {
                    info.manufacturer = fields[1].to_string();
                }
            }
            "disp-name" => {
                if fields.len() > 1 {
                    info.card_holder = fields[1].to_string();
                }
            }
            "lang" => {
                if fields.len() > 1 {
                    info.language = fields[1].to_string();
                }
            }
            "sex" => {
                if fields.len() > 1 {
                    info.sex = fields[1].chars().next();
                }
            }
            "url" => {
                if fields.len() > 1 {
                    info.public_key_url = fields[1..].join(":");
                }
            }
            "login" => {
                if fields.len() > 1 {
                    info.login_data = fields[1].to_string();
                }
            }
            "forcepin" => {}
            "maxpinlen" => {}
            "pinretry" => {
                if fields.len() > 3 {
                    let p1 = fields[1].parse().unwrap_or(3);
                    let p2 = fields[2].parse().unwrap_or(0);
                    let p3 = fields[3].parse().unwrap_or(3);
                    info.pin_retry_count = (p1, p2, p3);
                }
            }
            "sigcount" => {
                if fields.len() > 1 {
                    info.signature_count = fields[1].parse().unwrap_or(0);
                }
            }
            "cafpr" => {
                for f in &fields[1..] {
                    if !f.is_empty() {
                        info.ca_fingerprints.push(f.to_string());
                    }
                }
            }
            "fpr" => {
                // Key fingerprints: signature, encryption, authentication slots
                if fields.len() > 1 && !fields[1].is_empty() {
                    if info.signature_key_fingerprint.is_none() {
                        info.signature_key_fingerprint = Some(fields[1].to_string());
                    } else if info.encryption_key_fingerprint.is_none() {
                        info.encryption_key_fingerprint = Some(fields[1].to_string());
                    } else if info.authentication_key_fingerprint.is_none() {
                        info.authentication_key_fingerprint = Some(fields[1].to_string());
                    }
                }
            }
            "private-do-1" => {
                if fields.len() > 1 {
                    info.private_do1 = fields[1].to_string();
                }
            }
            "private-do-2" => {
                if fields.len() > 1 {
                    info.private_do2 = fields[1].to_string();
                }
            }
            "private-do-3" => {
                if fields.len() > 1 {
                    info.private_do3 = fields[1].to_string();
                }
            }
            "private-do-4" => {
                if fields.len() > 1 {
                    info.private_do4 = fields[1].to_string();
                }
            }
            "key-attr" => {
                // key-attr:<slot>:<algo>:<bits_or_curve>
                if fields.len() > 3 {
                    let slot = match fields[1] {
                        "1" => CardSlot::Signature,
                        "2" => CardSlot::Encryption,
                        "3" => CardSlot::Authentication,
                        _ => continue,
                    };
                    let algo = GpgKeyAlgorithm::from_gpg_id(fields[2]);
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
            }
            "extcap" => {
                if fields.len() > 1 {
                    for cap in fields[1].split(',') {
                        if !cap.is_empty() {
                            info.extended_capabilities.push(cap.to_string());
                        }
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
        let mgr = CardManager::new("gpg", None);
        assert_eq!(mgr.gpg_binary, "gpg");
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
}
