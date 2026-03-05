//! # GPG Encryption & Decryption
//!
//! Public-key and symmetric encryption/decryption via GPG command
//! execution. Supports multi-recipient, armor output, and combined
//! sign+encrypt operations.

use crate::protocol::{run_gpg_command, run_gpg_command_with_input};
use crate::types::*;
use log::info;

/// GPG encryption engine.
pub struct EncryptionEngine {
    gpg_binary: String,
    home_dir: Option<String>,
}

impl EncryptionEngine {
    /// Create a new encryption engine.
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

    /// Encrypt data for multiple recipients.
    pub async fn encrypt_data(
        &self,
        recipients: &[String],
        data: &[u8],
        armor: bool,
        sign: bool,
        signer: Option<&str>,
    ) -> Result<EncryptionResult, String> {
        let mut args = self.base_args();
        args.push("--trust-model".to_string());
        args.push("always".to_string());

        if sign {
            args.push("--sign".to_string());
            args.push("--encrypt".to_string());
            if let Some(s) = signer {
                args.push("--local-user".to_string());
                args.push(s.to_string());
            }
        } else {
            args.push("--encrypt".to_string());
        }

        if armor {
            args.push("--armor".to_string());
        }

        for r in recipients {
            args.push("--recipient".to_string());
            args.push(r.to_string());
        }

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let output =
            run_gpg_command_with_input(&self.gpg_binary, &args_ref, data).await?;

        let armor_str = if armor {
            String::from_utf8_lossy(&output).to_string()
        } else {
            String::new()
        };

        info!("Encrypted data for {} recipients", recipients.len());

        Ok(EncryptionResult {
            success: true,
            ciphertext: output,
            armor: armor_str,
            recipients: recipients.to_vec(),
            session_key_algo: "AES256".to_string(),
            is_symmetric: false,
        })
    }

    /// Encrypt a file.
    pub async fn encrypt_file(
        &self,
        recipients: &[String],
        path: &str,
        output_path: &str,
        armor: bool,
    ) -> Result<EncryptionResult, String> {
        let mut args = self.base_args();
        args.push("--trust-model".to_string());
        args.push("always".to_string());
        args.push("--encrypt".to_string());

        if armor {
            args.push("--armor".to_string());
        }

        for r in recipients {
            args.push("--recipient".to_string());
            args.push(r.to_string());
        }

        args.push("--output".to_string());
        args.push(output_path.to_string());
        args.push(path.to_string());

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let _output = run_gpg_command(&self.gpg_binary, &args_ref).await?;

        info!("Encrypted file {} to {}", path, output_path);

        Ok(EncryptionResult {
            success: true,
            ciphertext: Vec::new(),
            armor: String::new(),
            recipients: recipients.to_vec(),
            session_key_algo: "AES256".to_string(),
            is_symmetric: false,
        })
    }

    /// Symmetric encryption.
    pub async fn encrypt_symmetric(
        &self,
        data: &[u8],
        armor: bool,
        cipher: Option<&str>,
    ) -> Result<EncryptionResult, String> {
        let mut args = self.base_args();
        args.push("--symmetric".to_string());

        if armor {
            args.push("--armor".to_string());
        }

        if let Some(c) = cipher {
            args.push("--cipher-algo".to_string());
            args.push(c.to_string());
        }

        // For batch symmetric, need passphrase through pinentry or loopback
        args.push("--pinentry-mode".to_string());
        args.push("loopback".to_string());

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let output =
            run_gpg_command_with_input(&self.gpg_binary, &args_ref, data).await?;

        let armor_str = if armor {
            String::from_utf8_lossy(&output).to_string()
        } else {
            String::new()
        };

        info!("Encrypted data symmetrically");

        Ok(EncryptionResult {
            success: true,
            ciphertext: output,
            armor: armor_str,
            recipients: Vec::new(),
            session_key_algo: cipher.unwrap_or("AES256").to_string(),
            is_symmetric: true,
        })
    }

    /// Decrypt data.
    pub async fn decrypt_data(&self, data: &[u8]) -> Result<DecryptionResult, String> {
        let mut args = self.base_args();
        args.push("--status-fd".to_string());
        args.push("2".to_string());
        args.push("--decrypt".to_string());

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let output =
            run_gpg_command_with_input(&self.gpg_binary, &args_ref, data).await?;

        info!("Decrypted data ({} bytes)", output.len());

        Ok(DecryptionResult {
            success: true,
            plaintext: output,
            session_key_algo: "AES256".to_string(),
            recipients: Vec::new(),
            signature_info: None,
            filename: None,
        })
    }

    /// Decrypt a file.
    pub async fn decrypt_file(
        &self,
        path: &str,
        output_path: &str,
    ) -> Result<DecryptionResult, String> {
        let mut args = self.base_args();
        args.push("--status-fd".to_string());
        args.push("1".to_string());
        args.push("--decrypt".to_string());
        args.push("--output".to_string());
        args.push(output_path.to_string());
        args.push(path.to_string());

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let output = run_gpg_command(&self.gpg_binary, &args_ref).await?;

        // Parse status output for recipient info
        let recipients = parse_decryption_recipients(&output);

        info!("Decrypted file {} to {}", path, output_path);

        Ok(DecryptionResult {
            success: true,
            plaintext: Vec::new(), // data is in output file
            session_key_algo: "AES256".to_string(),
            recipients,
            signature_info: None,
            filename: Some(output_path.to_string()),
        })
    }
}

// ── Parsing ─────────────────────────────────────────────────────────

/// Parse decryption status output for recipient info.
fn parse_decryption_recipients(output: &str) -> Vec<DecryptionRecipient> {
    let mut recipients = Vec::new();

    for line in output.lines() {
        // [GNUPG:] ENC_TO <long_keyid> <keytype> <keylength>
        if line.contains("ENC_TO") {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if let Some(idx) = parts.iter().position(|p| *p == "ENC_TO") {
                let key_id = parts.get(idx + 1).unwrap_or(&"").to_string();
                let algo_id = parts.get(idx + 2).unwrap_or(&"");
                let _bits = parts.get(idx + 3).unwrap_or(&"0");

                recipients.push(DecryptionRecipient {
                    key_id: key_id.clone(),
                    fingerprint: String::new(),
                    algorithm: GpgKeyAlgorithm::from_gpg_id(algo_id),
                    status: "ok".to_string(),
                });
            }
        }
    }

    recipients
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_decryption_recipients() {
        let output = "[GNUPG:] ENC_TO AABBCCDD11223344 1 4096\n\
                       [GNUPG:] ENC_TO EEFF001122334455 22 256\n";
        let recipients = parse_decryption_recipients(output);
        assert_eq!(recipients.len(), 2);
        assert_eq!(recipients[0].key_id, "AABBCCDD11223344");
        assert_eq!(recipients[1].key_id, "EEFF001122334455");
    }

    #[test]
    fn test_encryption_engine_new() {
        let engine = EncryptionEngine::new("gpg", None);
        assert_eq!(engine.gpg_binary, "gpg");
    }

    #[test]
    fn test_encryption_result_default() {
        let result = EncryptionResult::default();
        assert!(!result.success);
        assert!(result.ciphertext.is_empty());
        assert!(!result.is_symmetric);
    }

    #[test]
    fn test_decryption_result_default() {
        let result = DecryptionResult::default();
        assert!(!result.success);
        assert!(result.plaintext.is_empty());
        assert!(result.signature_info.is_none());
    }

    #[test]
    fn test_parse_no_recipients() {
        let output = "some random output\n";
        let recipients = parse_decryption_recipients(output);
        assert!(recipients.is_empty());
    }
}
