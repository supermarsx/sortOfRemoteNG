// ── sorng-ansible/src/vault.rs ───────────────────────────────────────────────
//! Ansible Vault operations — encrypt, decrypt, rekey, view, encrypt_string.

use log::debug;

use crate::client::AnsibleClient;
use crate::error::{AnsibleError, AnsibleResult};
use crate::types::*;

/// Vault management operations.
pub struct VaultManager;

impl VaultManager {
    /// Encrypt a file.
    pub async fn encrypt_file(
        client: &AnsibleClient,
        file_path: &str,
        vault_password_file: Option<&str>,
        vault_id: Option<&str>,
    ) -> AnsibleResult<VaultResult> {
        let mut args = vec!["encrypt".to_string(), file_path.to_string()];

        if let Some(vpf) = vault_password_file {
            args.push("--vault-password-file".to_string());
            args.push(vpf.to_string());
        } else if let Some(ref vpf) = client.vault_password_file {
            args.push("--vault-password-file".to_string());
            args.push(vpf.clone());
        }

        if let Some(vid) = vault_id {
            args.push("--vault-id".to_string());
            args.push(vid.to_string());
        }

        let output = client
            .run_raw(
                &client.vault_bin,
                &args.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
            )
            .await?;

        if output.exit_code != 0 {
            return Err(AnsibleError::vault(format!(
                "ansible-vault encrypt failed: {}",
                output.stderr
            )));
        }

        debug!("Encrypted file: {}", file_path);

        Ok(VaultResult {
            success: true,
            output: output.stdout,
            encrypted: Some(true),
        })
    }

    /// Decrypt a file.
    pub async fn decrypt_file(
        client: &AnsibleClient,
        file_path: &str,
        vault_password_file: Option<&str>,
        vault_id: Option<&str>,
    ) -> AnsibleResult<VaultResult> {
        let mut args = vec!["decrypt".to_string(), file_path.to_string()];

        if let Some(vpf) = vault_password_file {
            args.push("--vault-password-file".to_string());
            args.push(vpf.to_string());
        } else if let Some(ref vpf) = client.vault_password_file {
            args.push("--vault-password-file".to_string());
            args.push(vpf.clone());
        }

        if let Some(vid) = vault_id {
            args.push("--vault-id".to_string());
            args.push(vid.to_string());
        }

        let output = client
            .run_raw(
                &client.vault_bin,
                &args.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
            )
            .await?;

        if output.exit_code != 0 {
            return Err(AnsibleError::vault(format!(
                "ansible-vault decrypt failed: {}",
                output.stderr
            )));
        }

        debug!("Decrypted file: {}", file_path);

        Ok(VaultResult {
            success: true,
            output: output.stdout,
            encrypted: Some(false),
        })
    }

    /// View an encrypted file without decrypting on disk.
    pub async fn view(
        client: &AnsibleClient,
        file_path: &str,
        vault_password_file: Option<&str>,
    ) -> AnsibleResult<String> {
        let mut args = vec!["view".to_string(), file_path.to_string()];

        if let Some(vpf) = vault_password_file {
            args.push("--vault-password-file".to_string());
            args.push(vpf.to_string());
        } else if let Some(ref vpf) = client.vault_password_file {
            args.push("--vault-password-file".to_string());
            args.push(vpf.clone());
        }

        let output = client
            .run_raw(
                &client.vault_bin,
                &args.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
            )
            .await?;

        if output.exit_code != 0 {
            return Err(AnsibleError::vault(format!(
                "ansible-vault view failed: {}",
                output.stderr
            )));
        }

        Ok(output.stdout)
    }

    /// Rekey an encrypted file (change its vault password).
    pub async fn rekey(
        client: &AnsibleClient,
        options: &VaultRekeyOptions,
    ) -> AnsibleResult<VaultResult> {
        let mut args = vec!["rekey".to_string(), options.file_path.clone()];

        if let Some(ref old_vpf) = options.old_vault_password_file {
            args.push("--vault-password-file".to_string());
            args.push(old_vpf.clone());
        }

        if let Some(ref new_vpf) = options.new_vault_password_file {
            args.push("--new-vault-password-file".to_string());
            args.push(new_vpf.clone());
        }

        if let Some(ref old_id) = options.old_vault_id {
            args.push("--vault-id".to_string());
            args.push(old_id.clone());
        }

        if let Some(ref new_id) = options.new_vault_id {
            args.push("--new-vault-id".to_string());
            args.push(new_id.clone());
        }

        let output = client
            .run_raw(
                &client.vault_bin,
                &args.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
            )
            .await?;

        if output.exit_code != 0 {
            return Err(AnsibleError::vault(format!(
                "ansible-vault rekey failed: {}",
                output.stderr
            )));
        }

        debug!("Rekeyed file: {}", options.file_path);

        Ok(VaultResult {
            success: true,
            output: output.stdout,
            encrypted: Some(true),
        })
    }

    /// Encrypt a string inline (for use in YAML vars).
    pub async fn encrypt_string(
        client: &AnsibleClient,
        options: &VaultEncryptStringOptions,
    ) -> AnsibleResult<String> {
        let mut args = vec![
            "encrypt_string".to_string(),
            "--name".to_string(),
            options.variable_name.clone(),
            options.plaintext.clone(),
        ];

        if let Some(ref vpf) = options.vault_password_file {
            args.push("--vault-password-file".to_string());
            args.push(vpf.clone());
        } else if let Some(ref vpf) = client.vault_password_file {
            args.push("--vault-password-file".to_string());
            args.push(vpf.clone());
        }

        if let Some(ref vid) = options.vault_id {
            args.push("--vault-id".to_string());
            args.push(vid.clone());
        }

        let output = client
            .run_raw(
                &client.vault_bin,
                &args.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
            )
            .await?;

        if output.exit_code != 0 {
            return Err(AnsibleError::vault(format!(
                "ansible-vault encrypt_string failed: {}",
                output.stderr
            )));
        }

        Ok(output.stdout)
    }

    /// Check whether a file is vault-encrypted.
    pub async fn is_encrypted(file_path: &str) -> AnsibleResult<bool> {
        let content = tokio::fs::read_to_string(file_path)
            .await
            .map_err(|e| AnsibleError::io(format!("Cannot read {}: {}", file_path, e)))?;

        Ok(content.starts_with("$ANSIBLE_VAULT;"))
    }
}
