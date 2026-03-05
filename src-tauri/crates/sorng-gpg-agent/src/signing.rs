//! # GPG Signing & Verification
//!
//! Sign data and files, verify signatures, and perform key signing
//! via GPG command-line operations.

use crate::protocol::{run_gpg_command, run_gpg_command_bytes, run_gpg_command_with_input};
use crate::types::*;
use log::info;

/// GPG signing engine.
pub struct SigningEngine {
    gpg_binary: String,
    home_dir: Option<String>,
}

impl SigningEngine {
    /// Create a new signing engine.
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

    /// Sign data with a key.
    pub async fn sign_data(
        &self,
        key_id: &str,
        data: &[u8],
        detached: bool,
        armor: bool,
        hash_algo: Option<&str>,
    ) -> Result<SignatureResult, String> {
        let mut args = self.base_args();
        args.push("--status-fd".to_string());
        args.push("2".to_string());
        args.push("--local-user".to_string());
        args.push(key_id.to_string());

        if detached {
            args.push("--detach-sign".to_string());
        } else {
            args.push("--sign".to_string());
        }

        if armor {
            args.push("--armor".to_string());
        }

        if let Some(algo) = hash_algo {
            args.push("--digest-algo".to_string());
            args.push(algo.to_string());
        }

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let output =
            run_gpg_command_with_input(&self.gpg_binary, &args_ref, data).await?;

        let armor_str = if armor {
            String::from_utf8_lossy(&output).to_string()
        } else {
            String::new()
        };

        info!("Signed data with key {}", key_id);

        Ok(SignatureResult {
            success: true,
            signature_data: output.clone(),
            signature_armor: armor_str,
            hash_algo: hash_algo.unwrap_or("SHA256").to_string(),
            sig_class: "00".to_string(),
            signer_key_id: key_id.to_string(),
            signer_fingerprint: String::new(),
            created_at: chrono::Utc::now().to_rfc3339(),
            expires_at: None,
        })
    }

    /// Sign a file.
    pub async fn sign_file(
        &self,
        key_id: &str,
        path: &str,
        detached: bool,
        armor: bool,
    ) -> Result<SignatureResult, String> {
        let mut args = self.base_args();
        args.push("--status-fd".to_string());
        args.push("1".to_string());
        args.push("--local-user".to_string());
        args.push(key_id.to_string());

        if detached {
            args.push("--detach-sign".to_string());
        } else {
            args.push("--sign".to_string());
        }

        if armor {
            args.push("--armor".to_string());
        }

        args.push("--output".to_string());
        args.push("-".to_string());
        args.push(path.to_string());

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let output = run_gpg_command_bytes(&self.gpg_binary, &args_ref).await?;

        let armor_str = if armor {
            String::from_utf8_lossy(&output).to_string()
        } else {
            String::new()
        };

        info!("Signed file {} with key {}", path, key_id);

        Ok(SignatureResult {
            success: true,
            signature_data: output,
            signature_armor: armor_str,
            hash_algo: "SHA256".to_string(),
            sig_class: "00".to_string(),
            signer_key_id: key_id.to_string(),
            signer_fingerprint: String::new(),
            created_at: chrono::Utc::now().to_rfc3339(),
            expires_at: None,
        })
    }

    /// Create a clear-text signature.
    pub async fn clearsign_data(
        &self,
        key_id: &str,
        data: &[u8],
    ) -> Result<SignatureResult, String> {
        let mut args = self.base_args();
        args.push("--local-user".to_string());
        args.push(key_id.to_string());
        args.push("--clearsign".to_string());

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let output =
            run_gpg_command_with_input(&self.gpg_binary, &args_ref, data).await?;

        let armor_str = String::from_utf8_lossy(&output).to_string();
        info!("Clearsigned data with key {}", key_id);

        Ok(SignatureResult {
            success: true,
            signature_data: output,
            signature_armor: armor_str,
            hash_algo: "SHA256".to_string(),
            sig_class: "01".to_string(),
            signer_key_id: key_id.to_string(),
            signer_fingerprint: String::new(),
            created_at: chrono::Utc::now().to_rfc3339(),
            expires_at: None,
        })
    }

    /// Verify a signature.
    pub async fn verify_signature(
        &self,
        data: &[u8],
        signature: Option<&[u8]>,
    ) -> Result<VerificationResult, String> {
        let mut args = self.base_args();
        args.push("--status-fd".to_string());
        args.push("1".to_string());
        args.push("--verify".to_string());

        if let Some(sig) = signature {
            // Detached signature: write sig to temp, pass data via stdin
            let sig_path = std::env::temp_dir().join(format!(
                "gpg_sig_{}.sig",
                uuid::Uuid::new_v4()
            ));
            std::fs::write(&sig_path, sig)
                .map_err(|e| format!("Failed to write temp sig file: {}", e))?;
            args.push(sig_path.to_string_lossy().to_string());
            args.push("-".to_string());

            let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
            let output =
                run_gpg_command_with_input(&self.gpg_binary, &args_ref, data).await;

            // Clean up temp file
            let _ = std::fs::remove_file(&sig_path);

            let output_str = match output {
                Ok(o) => String::from_utf8_lossy(&o).to_string(),
                Err(e) => e,
            };

            return Ok(parse_verification_output(&output_str));
        }

        // Inline/clear-text signature
        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let output =
            run_gpg_command_with_input(&self.gpg_binary, &args_ref, data).await;

        let output_str = match output {
            Ok(o) => String::from_utf8_lossy(&o).to_string(),
            Err(e) => e,
        };

        Ok(parse_verification_output(&output_str))
    }

    /// Verify a file signature.
    pub async fn verify_file(
        &self,
        path: &str,
        sig_path: Option<&str>,
    ) -> Result<VerificationResult, String> {
        let mut args = self.base_args();
        args.push("--status-fd".to_string());
        args.push("1".to_string());
        args.push("--verify".to_string());

        if let Some(sp) = sig_path {
            args.push(sp.to_string());
        }
        args.push(path.to_string());

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let output = run_gpg_command(&self.gpg_binary, &args_ref).await;

        let output_str = match output {
            Ok(o) => o,
            Err(e) => e,
        };

        Ok(parse_verification_output(&output_str))
    }

    /// Sign someone else's key (key signing / certification).
    pub async fn sign_key(
        &self,
        signer_id: &str,
        target_id: &str,
        _uid_names: &[String],
        local_only: bool,
        _trust_level: u8,
        _exportable: bool,
    ) -> Result<bool, String> {
        let mut args = self.base_args();
        args.push("--local-user".to_string());
        args.push(signer_id.to_string());

        if local_only {
            args.push("--lsign-key".to_string());
        } else {
            args.push("--sign-key".to_string());
        }

        args.push("--yes".to_string());
        args.push(target_id.to_string());

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let _output = run_gpg_command(&self.gpg_binary, &args_ref).await?;
        info!(
            "Key {} signed by {} (local: {})",
            target_id, signer_id, local_only
        );
        Ok(true)
    }
}

// ── Verification Output Parsing ─────────────────────────────────────

/// Parse GPG --status-fd verification output.
fn parse_verification_output(output: &str) -> VerificationResult {
    let mut result = VerificationResult::default();

    for line in output.lines() {
        let line = line.trim();

        // GOODSIG <long_keyid> <uid>
        if line.contains("GOODSIG") {
            result.valid = true;
            result.signature_status = SigStatus::Good;
            let parts: Vec<&str> = line.splitn(4, ' ').collect();
            if parts.len() >= 3 {
                let idx = parts.iter().position(|p| *p == "GOODSIG").unwrap_or(0);
                if idx + 1 < parts.len() {
                    result.signer_key_id = parts[idx + 1].to_string();
                }
                if idx + 2 < parts.len() {
                    result.signer_uid = parts[idx + 2..].join(" ");
                }
            }
        }

        // BADSIG <long_keyid> <uid>
        if line.contains("BADSIG") {
            result.valid = false;
            result.signature_status = SigStatus::Bad;
            let parts: Vec<&str> = line.splitn(4, ' ').collect();
            if parts.len() >= 3 {
                let idx = parts.iter().position(|p| *p == "BADSIG").unwrap_or(0);
                if idx + 1 < parts.len() {
                    result.signer_key_id = parts[idx + 1].to_string();
                }
            }
        }

        // ERRSIG <keyid> <pkalgo> <hashalgo> <sig_class> <time> <rc>
        if line.contains("ERRSIG") {
            result.valid = false;
            result.signature_status = SigStatus::Error;
            let parts: Vec<&str> = line.split_whitespace().collect();
            if let Some(idx) = parts.iter().position(|p| *p == "ERRSIG") {
                if idx + 1 < parts.len() {
                    result.signer_key_id = parts[idx + 1].to_string();
                }
                if idx + 3 < parts.len() {
                    result.hash_algo = parts[idx + 3].to_string();
                }
                // rc = 9 means missing key
                if let Some(rc) = parts.last() {
                    if *rc == "9" {
                        result.signature_status = SigStatus::MissingSigner;
                    }
                }
            }
        }

        // VALIDSIG <fpr> <date> <sig_ts> ... <pkalgo> <hashalgo> <sig_class> <key_fpr>
        if line.contains("VALIDSIG") {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if let Some(idx) = parts.iter().position(|p| *p == "VALIDSIG") {
                if idx + 1 < parts.len() {
                    result.signer_fingerprint = parts[idx + 1].to_string();
                }
                if idx + 2 < parts.len() {
                    result.creation_date = parts[idx + 2].to_string();
                }
                if idx + 3 < parts.len() {
                    let ts = parts[idx + 3];
                    if ts != "0" && !ts.is_empty() {
                        result.expiration_date = Some(ts.to_string());
                    }
                }
            }
        }

        // EXPKEYSIG — expired key
        if line.contains("EXPKEYSIG") {
            result.valid = false;
            result.signature_status = SigStatus::ExpiredKey;
        }

        // EXPSIG — expired signature
        if line.contains("EXPSIG") {
            result.valid = false;
            result.signature_status = SigStatus::ExpiredSig;
        }

        // REVKEYSIG — revoked key
        if line.contains("REVKEYSIG") {
            result.valid = false;
            result.signature_status = SigStatus::RevokedKey;
        }

        // TRUST_ULTIMATE, TRUST_FULLY, etc.
        if line.contains("TRUST_ULTIMATE") {
            result.trust_level = "ultimate".to_string();
            result.key_validity = KeyValidity::Ultimate;
        } else if line.contains("TRUST_FULLY") {
            result.trust_level = "full".to_string();
            result.key_validity = KeyValidity::Full;
        } else if line.contains("TRUST_MARGINAL") {
            result.trust_level = "marginal".to_string();
            result.key_validity = KeyValidity::Marginal;
        } else if line.contains("TRUST_UNDEFINED") {
            result.trust_level = "undefined".to_string();
            result.key_validity = KeyValidity::Undefined;
        } else if line.contains("TRUST_NEVER") {
            result.trust_level = "never".to_string();
            result.key_validity = KeyValidity::NeverValid;
        }

        // NOTATION_NAME / NOTATION_DATA
        if line.contains("NOTATION_NAME") {
            let parts: Vec<&str> = line.splitn(3, ' ').collect();
            if parts.len() >= 3 {
                result.notations.push(Notation {
                    name: parts[2].to_string(),
                    value: String::new(),
                    is_human_readable: true,
                    is_critical: false,
                });
            }
        }
        if line.contains("NOTATION_DATA") {
            let parts: Vec<&str> = line.splitn(3, ' ').collect();
            if parts.len() >= 3 {
                if let Some(n) = result.notations.last_mut() {
                    n.value = parts[2].to_string();
                }
            }
        }
    }

    result
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_good_signature() {
        let output = "[GNUPG:] SIG_ID abc123 2024-01-01 1704067200\n\
                       [GNUPG:] GOODSIG AABBCCDD11223344 Alice Smith <alice@example.com>\n\
                       [GNUPG:] VALIDSIG AABBCCDD1122334455667788AABBCCDD11223344 2024-01-01 0 0 0 1 10 01 AABBCCDD1122334455667788AABBCCDD11223344\n\
                       [GNUPG:] TRUST_ULTIMATE 0 pgp\n";
        let result = parse_verification_output(output);
        assert!(result.valid);
        assert_eq!(result.signature_status, SigStatus::Good);
        assert_eq!(result.signer_key_id, "AABBCCDD11223344");
        assert_eq!(
            result.signer_fingerprint,
            "AABBCCDD1122334455667788AABBCCDD11223344"
        );
        assert_eq!(result.trust_level, "ultimate");
        assert_eq!(result.key_validity, KeyValidity::Ultimate);
    }

    #[test]
    fn test_parse_bad_signature() {
        let output = "[GNUPG:] BADSIG AABBCCDD11223344 Alice Smith\n";
        let result = parse_verification_output(output);
        assert!(!result.valid);
        assert_eq!(result.signature_status, SigStatus::Bad);
    }

    #[test]
    fn test_parse_missing_signer() {
        let output =
            "[GNUPG:] ERRSIG AABBCCDD11223344 1 10 00 1704067200 9\n";
        let result = parse_verification_output(output);
        assert!(!result.valid);
        assert_eq!(result.signature_status, SigStatus::MissingSigner);
    }

    #[test]
    fn test_parse_expired_key() {
        let output =
            "[GNUPG:] EXPKEYSIG AABBCCDD11223344 Alice Smith <alice@example.com>\n";
        let result = parse_verification_output(output);
        assert!(!result.valid);
        assert_eq!(result.signature_status, SigStatus::ExpiredKey);
    }

    #[test]
    fn test_parse_revoked_key() {
        let output = "[GNUPG:] REVKEYSIG AABBCCDD11223344 Alice Smith\n";
        let result = parse_verification_output(output);
        assert!(!result.valid);
        assert_eq!(result.signature_status, SigStatus::RevokedKey);
    }

    #[test]
    fn test_parse_notation() {
        let output = "[GNUPG:] GOODSIG AABBCCDD11223344 Alice\n\
                       [GNUPG:] NOTATION_NAME issuer@example.com\n\
                       [GNUPG:] NOTATION_DATA some-value\n\
                       [GNUPG:] VALIDSIG ABC 2024-01-01 0\n";
        let result = parse_verification_output(output);
        assert_eq!(result.notations.len(), 1);
        assert_eq!(result.notations[0].name, "issuer@example.com");
        assert_eq!(result.notations[0].value, "some-value");
    }

    #[test]
    fn test_signing_engine_new() {
        let engine = SigningEngine::new("gpg2", Some("/tmp/.gnupg".to_string()));
        assert_eq!(engine.gpg_binary, "gpg2");
    }

    #[test]
    fn test_signature_result_default() {
        let r = SignatureResult::default();
        assert!(!r.success);
        assert!(r.signature_data.is_empty());
    }
}
