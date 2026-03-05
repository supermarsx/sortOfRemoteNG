//! # GPG Trust Model
//!
//! Manages the GPG web of trust: owner trust assignments, trust database
//! statistics, validity calculations, and ownertrust import/export.

use crate::keyring;
use crate::protocol::run_gpg_command;
use crate::types::*;
use log::{debug, info};

/// Trust model manager.
pub struct TrustManager {
    gpg_binary: String,
    home_dir: Option<String>,
}

impl TrustManager {
    /// Create a new trust manager.
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

    /// Set the owner trust level on a key.
    pub async fn set_owner_trust(
        &self,
        key_id: &str,
        trust: KeyOwnerTrust,
    ) -> Result<bool, String> {
        // Owner trust is set by piping to --import-ownertrust:
        // <fingerprint>:<trust_value>:
        // First need the fingerprint
        let mut fpr_args = self.base_args();
        fpr_args.push("--with-colons".to_string());
        fpr_args.push("--fingerprint".to_string());
        fpr_args.push(key_id.to_string());

        let args_ref: Vec<&str> = fpr_args.iter().map(|s| s.as_str()).collect();
        let output = run_gpg_command(&self.gpg_binary, &args_ref).await?;

        let fingerprint = output
            .lines()
            .find(|l| l.starts_with("fpr:"))
            .and_then(|l| l.split(':').nth(9))
            .map(|s| s.to_string())
            .ok_or_else(|| format!("Could not find fingerprint for {}", key_id))?;

        // Write trust
        let trust_line = format!("{}:{}:\n", fingerprint, trust.to_gpg_trust_value());

        let mut args = self.base_args();
        args.push("--import-ownertrust".to_string());

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let _output = crate::protocol::run_gpg_command_with_input(
            &self.gpg_binary,
            &args_ref,
            trust_line.as_bytes(),
        )
        .await?;

        info!("Set owner trust on {} to {}", key_id, trust);
        Ok(true)
    }

    /// Get trust database statistics by inspecting all keys.
    pub async fn get_trust_db_stats(&self) -> Result<TrustDbStats, String> {
        let mut args = self.base_args();
        args.push("--with-colons".to_string());
        args.push("--list-keys".to_string());
        args.push("--fixed-list-mode".to_string());

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let output = run_gpg_command(&self.gpg_binary, &args_ref).await?;

        let keys = keyring::parse_colon_key_listing(&output, false);
        let mut stats = TrustDbStats::default();

        stats.total_keys = keys.len() as u32;

        for key in &keys {
            match key.owner_trust {
                KeyOwnerTrust::Unknown => stats.unknown_trust += 1,
                KeyOwnerTrust::Untrusted => stats.unknown_trust += 1,
                KeyOwnerTrust::Marginal => {
                    stats.marginal_trust += 1;
                    stats.trusted_keys += 1;
                }
                KeyOwnerTrust::Full => {
                    stats.full_trust += 1;
                    stats.trusted_keys += 1;
                }
                KeyOwnerTrust::Ultimate => {
                    stats.ultimate_trust += 1;
                    stats.trusted_keys += 1;
                }
            }

            if key.is_revoked {
                stats.revoked_keys += 1;
            }
            if key.is_expired {
                stats.expired_keys += 1;
            }
        }

        Ok(stats)
    }

    /// Check the trust database for consistency.
    pub async fn check_trust_db(&self) -> Result<bool, String> {
        let mut args = self.base_args();
        args.push("--check-trustdb".to_string());

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let _output = run_gpg_command(&self.gpg_binary, &args_ref).await?;
        info!("Trust database check completed");
        Ok(true)
    }

    /// Update / rebuild the trust database.
    pub async fn update_trust_db(&self) -> Result<bool, String> {
        let mut args = self.base_args();
        args.push("--update-trustdb".to_string());

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let _output = run_gpg_command(&self.gpg_binary, &args_ref).await?;
        info!("Trust database updated");
        Ok(true)
    }

    /// Export ownertrust values to a string.
    pub async fn export_ownertrust(&self) -> Result<String, String> {
        let mut args = self.base_args();
        args.push("--export-ownertrust".to_string());

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        run_gpg_command(&self.gpg_binary, &args_ref).await
    }

    /// Import ownertrust values from a string.
    pub async fn import_ownertrust(&self, data: &str) -> Result<bool, String> {
        let mut args = self.base_args();
        args.push("--import-ownertrust".to_string());

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let _output = crate::protocol::run_gpg_command_with_input(
            &self.gpg_binary,
            &args_ref,
            data.as_bytes(),
        )
        .await?;
        info!("Imported ownertrust data");
        Ok(true)
    }

    /// Calculate the validity of a specific key.
    pub async fn calculate_validity(&self, key_id: &str) -> Result<KeyValidity, String> {
        let mut args = self.base_args();
        args.push("--with-colons".to_string());
        args.push("--list-keys".to_string());
        args.push(key_id.to_string());

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let output = run_gpg_command(&self.gpg_binary, &args_ref).await?;

        let keys = keyring::parse_colon_key_listing(&output, false);
        if let Some(key) = keys.first() {
            Ok(key.validity)
        } else {
            Err(format!("Key {} not found", key_id))
        }
    }
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_trust_manager_new() {
        let mgr = TrustManager::new("gpg", None);
        assert_eq!(mgr.gpg_binary, "gpg");
    }

    #[test]
    fn test_trust_db_stats_default() {
        let stats = TrustDbStats::default();
        assert_eq!(stats.total_keys, 0);
        assert_eq!(stats.trusted_keys, 0);
        assert_eq!(stats.marginal_trust, 0);
        assert_eq!(stats.full_trust, 0);
        assert_eq!(stats.ultimate_trust, 0);
    }

    #[test]
    fn test_owner_trust_values() {
        assert_eq!(KeyOwnerTrust::Unknown.to_gpg_trust_value(), 1);
        assert_eq!(KeyOwnerTrust::Untrusted.to_gpg_trust_value(), 2);
        assert_eq!(KeyOwnerTrust::Marginal.to_gpg_trust_value(), 3);
        assert_eq!(KeyOwnerTrust::Full.to_gpg_trust_value(), 4);
        assert_eq!(KeyOwnerTrust::Ultimate.to_gpg_trust_value(), 5);
    }

    #[test]
    fn test_owner_trust_from_str() {
        assert_eq!(KeyOwnerTrust::from_str_name("full"), KeyOwnerTrust::Full);
        assert_eq!(
            KeyOwnerTrust::from_str_name("marginal"),
            KeyOwnerTrust::Marginal
        );
        assert_eq!(
            KeyOwnerTrust::from_str_name("ultimate"),
            KeyOwnerTrust::Ultimate
        );
        assert_eq!(
            KeyOwnerTrust::from_str_name("never"),
            KeyOwnerTrust::Untrusted
        );
        assert_eq!(
            KeyOwnerTrust::from_str_name("garbage"),
            KeyOwnerTrust::Unknown
        );
    }
}
