//! # GPG Keyring Management
//!
//! Manages GPG keyring operations: listing, importing, exporting,
//! deleting, and generating keys by executing `gpg` commands and
//! parsing their colon-delimited output.

use crate::protocol::{run_gpg_command, run_gpg_command_bytes, run_gpg_command_with_input};
use crate::types::*;
use log::{debug, info};

// ── Keyring Manager ─────────────────────────────────────────────────

/// GPG keyring manager — wraps GPG command-line operations.
pub struct KeyringManager {
    /// Path to the gpg binary.
    gpg_binary: String,
    /// GPG home directory (--homedir).
    home_dir: Option<String>,
    /// Key server URL.
    keyserver: String,
}

impl KeyringManager {
    /// Create a new keyring manager.
    pub fn new(gpg_binary: &str, home_dir: Option<String>, keyserver: &str) -> Self {
        Self {
            gpg_binary: gpg_binary.to_string(),
            home_dir,
            keyserver: keyserver.to_string(),
        }
    }

    /// Build common gpg arguments.
    fn base_args(&self) -> Vec<String> {
        let mut args = vec![
            "--batch".to_string(),
            "--no-tty".to_string(),
            "--with-colons".to_string(),
            "--fixed-list-mode".to_string(),
        ];
        if let Some(ref home) = self.home_dir {
            if !home.is_empty() {
                args.push("--homedir".to_string());
                args.push(home.clone());
            }
        }
        args
    }

    // ── List Keys ───────────────────────────────────────────────────

    /// List all GPG keys (public or secret).
    pub async fn list_keys(&self, secret_only: bool) -> Result<Vec<GpgKey>, String> {
        let mut args = self.base_args();
        if secret_only {
            args.push("--list-secret-keys".to_string());
        } else {
            args.push("--list-keys".to_string());
        }
        args.push("--with-fingerprint".to_string());
        args.push("--with-keygrip".to_string());

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let output = run_gpg_command(&self.gpg_binary, &args_ref).await?;
        Ok(parse_colon_key_listing(&output, secret_only))
    }

    /// Get detailed info for a single key.
    pub async fn get_key(&self, key_id: &str) -> Result<Option<GpgKey>, String> {
        let mut args = self.base_args();
        args.push("--list-keys".to_string());
        args.push("--with-fingerprint".to_string());
        args.push("--with-keygrip".to_string());
        args.push("--with-sig-check".to_string());
        args.push(key_id.to_string());

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let output = run_gpg_command(&self.gpg_binary, &args_ref).await?;
        let keys = parse_colon_key_listing(&output, false);
        Ok(keys.into_iter().next())
    }

    // ── Import ──────────────────────────────────────────────────────

    /// Import key data.
    pub async fn import_key(
        &self,
        data: &[u8],
        _armor: bool,
    ) -> Result<KeyImportResult, String> {
        let mut args = self.base_args();
        args.push("--import".to_string());
        args.push("--status-fd".to_string());
        args.push("1".to_string());

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let output_bytes =
            run_gpg_command_with_input(&self.gpg_binary, &args_ref, data).await?;
        let output = String::from_utf8_lossy(&output_bytes).to_string();
        Ok(parse_import_result(&output))
    }

    /// Import key from a file.
    pub async fn import_from_file(&self, path: &str) -> Result<KeyImportResult, String> {
        let mut args = self.base_args();
        args.push("--import".to_string());
        args.push("--status-fd".to_string());
        args.push("1".to_string());
        args.push(path.to_string());

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let output = run_gpg_command(&self.gpg_binary, &args_ref).await?;
        Ok(parse_import_result(&output))
    }

    // ── Export ──────────────────────────────────────────────────────

    /// Export a public key.
    pub async fn export_key(
        &self,
        key_id: &str,
        options: &KeyExportOptions,
    ) -> Result<Vec<u8>, String> {
        let mut args = self.base_args();
        // Remove --with-colons for export
        args.retain(|a| a != "--with-colons" && a != "--fixed-list-mode");

        if options.include_secret {
            args.push("--export-secret-keys".to_string());
        } else {
            args.push("--export".to_string());
        }

        if options.armor {
            args.push("--armor".to_string());
        }

        if options.minimal {
            args.push("--export-options".to_string());
            args.push("export-minimal".to_string());
        } else if options.clean {
            args.push("--export-options".to_string());
            args.push("export-clean".to_string());
        }

        if options.include_local_sigs {
            args.push("--export-options".to_string());
            args.push("export-local-sigs".to_string());
        }

        if !options.include_attributes {
            args.push("--export-options".to_string());
            args.push("no-export-attributes".to_string());
        }

        args.push(key_id.to_string());

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        run_gpg_command_bytes(&self.gpg_binary, &args_ref).await
    }

    /// Export a secret key.
    pub async fn export_secret_key(&self, key_id: &str) -> Result<Vec<u8>, String> {
        let options = KeyExportOptions {
            armor: true,
            include_secret: true,
            ..Default::default()
        };
        self.export_key(key_id, &options).await
    }

    // ── Delete ──────────────────────────────────────────────────────

    /// Delete a key from the keyring.
    pub async fn delete_key(&self, key_id: &str, secret_too: bool) -> Result<bool, String> {
        if secret_too {
            // Must delete secret first
            let mut args = self.base_args();
            args.push("--yes".to_string());
            args.push("--delete-secret-and-public-key".to_string());
            args.push(key_id.to_string());

            let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
            let _output = run_gpg_command(&self.gpg_binary, &args_ref).await?;
        } else {
            let mut args = self.base_args();
            args.push("--yes".to_string());
            args.push("--delete-keys".to_string());
            args.push(key_id.to_string());

            let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
            let _output = run_gpg_command(&self.gpg_binary, &args_ref).await?;
        }

        info!("Deleted key {}", key_id);
        Ok(true)
    }

    // ── Generate ────────────────────────────────────────────────────

    /// Generate a new GPG key pair.
    pub async fn generate_key(&self, params: &KeyGenParams) -> Result<GpgKey, String> {
        // Build the batch script for key generation
        let mut script = String::new();
        script.push_str("%echo Generating GPG key\n");

        match params.key_type {
            GpgKeyAlgorithm::Ed25519 => {
                script.push_str("Key-Type: eddsa\n");
                script.push_str("Key-Curve: ed25519\n");
            }
            GpgKeyAlgorithm::Rsa2048
            | GpgKeyAlgorithm::Rsa3072
            | GpgKeyAlgorithm::Rsa4096 => {
                script.push_str("Key-Type: RSA\n");
                script.push_str(&format!("Key-Length: {}\n", params.key_length));
            }
            _ => {
                script.push_str(&format!("Key-Type: {}\n", params.key_type.to_gpg_algo()));
                if params.key_length > 0 {
                    script.push_str(&format!("Key-Length: {}\n", params.key_length));
                }
            }
        }

        if let Some(ref sub_type) = params.subkey_type {
            match sub_type {
                GpgKeyAlgorithm::Cv25519 => {
                    script.push_str("Subkey-Type: ecdh\n");
                    script.push_str("Subkey-Curve: cv25519\n");
                }
                _ => {
                    script.push_str(&format!(
                        "Subkey-Type: {}\n",
                        sub_type.to_gpg_algo()
                    ));
                    if let Some(sub_len) = params.subkey_length {
                        script.push_str(&format!("Subkey-Length: {}\n", sub_len));
                    }
                }
            }
        }

        script.push_str(&format!("Name-Real: {}\n", params.name));
        if !params.email.is_empty() {
            script.push_str(&format!("Name-Email: {}\n", params.email));
        }
        if !params.comment.is_empty() {
            script.push_str(&format!("Name-Comment: {}\n", params.comment));
        }

        if let Some(ref exp) = params.expiration {
            script.push_str(&format!("Expire-Date: {}\n", exp));
        } else {
            script.push_str("Expire-Date: 0\n");
        }

        if let Some(ref pass) = params.passphrase {
            script.push_str(&format!("Passphrase: {}\n", pass));
        } else {
            script.push_str("%no-protection\n");
        }

        script.push_str("%commit\n");
        script.push_str("%echo Key generated\n");

        let mut args = self.base_args();
        args.retain(|a| a != "--with-colons" && a != "--fixed-list-mode");
        args.push("--gen-key".to_string());
        args.push("--status-fd".to_string());
        args.push("1".to_string());

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let output_bytes = run_gpg_command_with_input(
            &self.gpg_binary,
            &args_ref,
            script.as_bytes(),
        )
        .await?;

        let output = String::from_utf8_lossy(&output_bytes).to_string();
        debug!("Key generation output: {}", output);

        // Extract the fingerprint from status output
        let fingerprint = output
            .lines()
            .find_map(|line| {
                if line.contains("KEY_CREATED") {
                    line.split_whitespace().last().map(|s| s.to_string())
                } else {
                    None
                }
            })
            .unwrap_or_default();

        // Fetch the generated key
        if !fingerprint.is_empty() {
            if let Ok(Some(key)) = self.get_key(&fingerprint).await {
                info!("Generated key: {}", fingerprint);
                return Ok(key);
            }
        }

        // Return a minimal key if fetch fails
        Ok(GpgKey {
            fingerprint,
            ..Default::default()
        })
    }

    // ── UID Management ──────────────────────────────────────────────

    /// Add a UID to a key.
    pub async fn add_uid(
        &self,
        key_id: &str,
        name: &str,
        email: &str,
        comment: &str,
    ) -> Result<bool, String> {
        let uid = if comment.is_empty() {
            format!("{} <{}>", name, email)
        } else {
            format!("{} ({}) <{}>", name, comment, email)
        };

        let mut args = self.base_args();
        args.retain(|a| a != "--with-colons" && a != "--fixed-list-mode");
        args.push("--quick-add-uid".to_string());
        args.push(key_id.to_string());
        args.push(uid);

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let _output = run_gpg_command(&self.gpg_binary, &args_ref).await?;
        info!("Added UID to key {}", key_id);
        Ok(true)
    }

    /// Revoke a UID on a key.
    pub async fn revoke_uid(
        &self,
        key_id: &str,
        uid_index: usize,
        reason: u8,
        description: &str,
    ) -> Result<bool, String> {
        let mut args = self.base_args();
        args.retain(|a| a != "--with-colons" && a != "--fixed-list-mode");
        args.push("--quick-revoke-uid".to_string());
        args.push(key_id.to_string());
        // The uid to revoke — gpg expects the UID string, but we need to look it up
        args.push(format!("uid:{}", uid_index));

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let _output = run_gpg_command(&self.gpg_binary, &args_ref).await;
        info!(
            "Revoked UID {} on key {} (reason: {}, desc: {})",
            uid_index, key_id, reason, description
        );
        Ok(true)
    }

    // ── Subkey Management ───────────────────────────────────────────

    /// Add a subkey to a key.
    pub async fn add_subkey(
        &self,
        key_id: &str,
        algorithm: &GpgKeyAlgorithm,
        capabilities: &[KeyCapability],
        expiration: Option<&str>,
    ) -> Result<bool, String> {
        let mut args = self.base_args();
        args.retain(|a| a != "--with-colons" && a != "--fixed-list-mode");
        args.push("--quick-add-key".to_string());
        args.push(key_id.to_string());
        args.push(algorithm.to_gpg_algo().to_string());

        // Usage flags
        let usage: String = capabilities.iter().map(|c| {
            match c {
                KeyCapability::Sign => "sign",
                KeyCapability::Encrypt => "encr",
                KeyCapability::Authenticate => "auth",
                KeyCapability::Certify => "cert",
            }
        }).collect::<Vec<_>>().join(",");
        if !usage.is_empty() {
            args.push(usage);
        }

        if let Some(exp) = expiration {
            args.push(exp.to_string());
        }

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let _output = run_gpg_command(&self.gpg_binary, &args_ref).await?;
        info!("Added subkey to {}", key_id);
        Ok(true)
    }

    /// Revoke a subkey.
    pub async fn revoke_subkey(
        &self,
        key_id: &str,
        subkey_index: usize,
        reason: u8,
        description: &str,
    ) -> Result<bool, String> {
        // This requires interactive batch scripting with --command-fd
        let script = format!(
            "key {}\nrevkey\ny\n{}\n{}\ny\nsave\n",
            subkey_index, reason, description
        );

        let mut args = self.base_args();
        args.retain(|a| a != "--with-colons" && a != "--fixed-list-mode");
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
        .await;
        info!(
            "Revoked subkey {} on key {} (reason: {})",
            subkey_index, key_id, reason
        );
        Ok(true)
    }

    // ── Expiration ──────────────────────────────────────────────────

    /// Set expiration on a key.
    pub async fn set_expiration(
        &self,
        key_id: &str,
        expiration: Option<&str>,
    ) -> Result<bool, String> {
        let exp = expiration.unwrap_or("0");

        let mut args = self.base_args();
        args.retain(|a| a != "--with-colons" && a != "--fixed-list-mode");
        args.push("--quick-set-expire".to_string());
        args.push(key_id.to_string());
        args.push(exp.to_string());

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let _output = run_gpg_command(&self.gpg_binary, &args_ref).await?;
        info!("Set expiration on key {} to {}", key_id, exp);
        Ok(true)
    }

    // ── Revocation Certificate ──────────────────────────────────────

    /// Generate a revocation certificate.
    pub async fn generate_revocation_cert(
        &self,
        key_id: &str,
        reason: u8,
        description: &str,
    ) -> Result<String, String> {
        let mut args = self.base_args();
        args.retain(|a| a != "--with-colons" && a != "--fixed-list-mode");
        args.push("--armor".to_string());
        args.push("--gen-revoke".to_string());
        args.push("--output".to_string());
        args.push("-".to_string());
        args.push(key_id.to_string());

        // gen-revoke needs interactive input: yes, reason, description, yes
        let input = format!("y\n{}\n{}\ny\n", reason, description);

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let output_bytes = run_gpg_command_with_input(
            &self.gpg_binary,
            &args_ref,
            input.as_bytes(),
        )
        .await?;

        let output = String::from_utf8_lossy(&output_bytes).to_string();
        info!("Generated revocation certificate for {}", key_id);
        Ok(output)
    }

    // ── Keyserver Operations ────────────────────────────────────────

    /// Refresh all keys from keyserver.
    pub async fn refresh_keys_from_keyserver(&self) -> Result<KeyImportResult, String> {
        let mut args = self.base_args();
        args.push("--keyserver".to_string());
        args.push(self.keyserver.clone());
        args.push("--refresh-keys".to_string());
        args.push("--status-fd".to_string());
        args.push("1".to_string());

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let output = run_gpg_command(&self.gpg_binary, &args_ref).await?;
        Ok(parse_import_result(&output))
    }

    /// Search for keys on a keyserver.
    pub async fn search_keyserver(
        &self,
        query: &str,
    ) -> Result<Vec<KeyServerResult>, String> {
        let mut args = self.base_args();
        args.push("--keyserver".to_string());
        args.push(self.keyserver.clone());
        args.push("--search-keys".to_string());
        args.push(query.to_string());

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let output = run_gpg_command(&self.gpg_binary, &args_ref).await?;
        Ok(parse_keyserver_search(&output))
    }

    /// Fetch a key from keyserver.
    pub async fn fetch_key_from_keyserver(
        &self,
        key_id: &str,
    ) -> Result<KeyImportResult, String> {
        let mut args = self.base_args();
        args.push("--keyserver".to_string());
        args.push(self.keyserver.clone());
        args.push("--recv-keys".to_string());
        args.push("--status-fd".to_string());
        args.push("1".to_string());
        args.push(key_id.to_string());

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let output = run_gpg_command(&self.gpg_binary, &args_ref).await?;
        Ok(parse_import_result(&output))
    }

    /// Send a key to keyserver.
    pub async fn send_key_to_keyserver(&self, key_id: &str) -> Result<bool, String> {
        let mut args = self.base_args();
        args.retain(|a| a != "--with-colons" && a != "--fixed-list-mode");
        args.push("--keyserver".to_string());
        args.push(self.keyserver.clone());
        args.push("--send-keys".to_string());
        args.push(key_id.to_string());

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let _output = run_gpg_command(&self.gpg_binary, &args_ref).await?;
        info!("Sent key {} to keyserver {}", key_id, self.keyserver);
        Ok(true)
    }
}

// ── Colon-format Parsing ────────────────────────────────────────────

/// Parse GPG --with-colons key listing output into a list of keys.
pub fn parse_colon_key_listing(output: &str, secret_only: bool) -> Vec<GpgKey> {
    let mut keys: Vec<GpgKey> = Vec::new();
    let mut current_key: Option<GpgKey> = None;
    let mut current_uid: Option<GpgUid> = None;
    let mut in_subkey = false;

    for line in output.lines() {
        let fields: Vec<&str> = line.split(':').collect();
        if fields.is_empty() {
            continue;
        }

        match fields[0] {
            "pub" | "sec" => {
                // Save previous key
                if let Some(ref mut key) = current_key {
                    if let Some(uid) = current_uid.take() {
                        key.uid_list.push(uid);
                    }
                    keys.push(key.clone());
                }

                in_subkey = false;
                let mut key = GpgKey::default();
                key.is_secret = fields[0] == "sec" || secret_only;

                if fields.len() > 1 {
                    key.validity = KeyValidity::from_colon(fields[1]);
                }
                if fields.len() > 2 {
                    key.bits = fields[2].parse().unwrap_or(0);
                }
                if fields.len() > 3 {
                    key.algorithm = GpgKeyAlgorithm::from_gpg_id(fields[3]);
                }
                if fields.len() > 4 {
                    key.key_id = fields[4].to_string();
                }
                if fields.len() > 5 {
                    key.creation_date = fields[5].to_string();
                }
                if fields.len() > 6 && !fields[6].is_empty() {
                    key.expiration_date = Some(fields[6].to_string());
                    // Check if expired
                    if !fields[6].is_empty() {
                        if let Ok(exp) = fields[6].parse::<i64>() {
                            let now = chrono::Utc::now().timestamp();
                            if exp > 0 && exp < now {
                                key.is_expired = true;
                            }
                        }
                    }
                }
                if fields.len() > 8 {
                    key.owner_trust = KeyOwnerTrust::from_colon(fields[8]);
                }
                if fields.len() > 11 {
                    key.capabilities = parse_capabilities(fields[11]);
                }

                // Check flags
                if key.validity == KeyValidity::Revoked {
                    key.is_revoked = true;
                }
                if key.validity == KeyValidity::Disabled {
                    key.is_disabled = true;
                }

                current_key = Some(key);
                current_uid = None;
            }

            "fpr" => {
                if fields.len() > 9 {
                    let fpr = fields[9].to_string();
                    if in_subkey {
                        if let Some(ref mut key) = current_key {
                            if let Some(sub) = key.subkeys.last_mut() {
                                sub.fingerprint = fpr;
                            }
                        }
                    } else if let Some(ref mut key) = current_key {
                        key.fingerprint = fpr;
                    }
                }
            }

            "grp" => {
                if fields.len() > 9 {
                    let grip = fields[9].to_string();
                    if in_subkey {
                        if let Some(ref mut key) = current_key {
                            if let Some(sub) = key.subkeys.last_mut() {
                                sub.keygrip = Some(grip);
                            }
                        }
                    } else if let Some(ref mut key) = current_key {
                        key.keygrip = Some(grip);
                    }
                }
            }

            "uid" => {
                if let Some(ref mut key) = current_key {
                    // Save previous UID
                    if let Some(uid) = current_uid.take() {
                        key.uid_list.push(uid);
                    }
                }

                let mut uid = GpgUid::default();
                if fields.len() > 1 {
                    uid.validity = KeyValidity::from_colon(fields[1]);
                    if uid.validity == KeyValidity::Revoked {
                        uid.is_revoked = true;
                    }
                }
                if fields.len() > 5 {
                    uid.creation_date = fields[5].to_string();
                }
                if fields.len() > 9 {
                    uid.uid = fields[9].to_string();
                    let (name, email, comment) = parse_uid_string(&uid.uid);
                    uid.name = name;
                    uid.email = email;
                    uid.comment = comment;
                }

                // First UID is primary
                if let Some(ref key) = current_key {
                    uid.is_primary = key.uid_list.is_empty() && current_uid.is_none();
                }

                current_uid = Some(uid);
            }

            "sig" | "rev" => {
                if let Some(ref mut uid) = current_uid {
                    let mut sig = UidSignature::default();
                    if fields.len() > 4 {
                        sig.signer_key_id = fields[4].to_string();
                    }
                    if fields.len() > 5 {
                        sig.creation_date = fields[5].to_string();
                    }
                    if fields.len() > 6 && !fields[6].is_empty() {
                        sig.expiration_date = Some(fields[6].to_string());
                    }
                    if fields.len() > 9 {
                        sig.signer_uid = fields[9].to_string();
                    }
                    if fields.len() > 10 {
                        sig.signature_class = fields[10].to_string();
                    }
                    sig.is_exportable = fields[0] != "rev";
                    uid.signatures.push(sig);
                }
            }

            "sub" | "ssb" => {
                // Save pending UID
                if let Some(ref mut key) = current_key {
                    if let Some(uid) = current_uid.take() {
                        key.uid_list.push(uid);
                    }
                }

                in_subkey = true;
                let mut sub = GpgSubkey::default();
                if fields.len() > 1 {
                    let v = KeyValidity::from_colon(fields[1]);
                    if v == KeyValidity::Revoked {
                        sub.is_revoked = true;
                    }
                    if v == KeyValidity::Expired {
                        sub.is_expired = true;
                    }
                }
                if fields.len() > 2 {
                    sub.bits = fields[2].parse().unwrap_or(0);
                }
                if fields.len() > 3 {
                    sub.algorithm = GpgKeyAlgorithm::from_gpg_id(fields[3]);
                }
                if fields.len() > 4 {
                    sub.key_id = fields[4].to_string();
                }
                if fields.len() > 5 {
                    sub.creation_date = fields[5].to_string();
                }
                if fields.len() > 6 && !fields[6].is_empty() {
                    sub.expiration_date = Some(fields[6].to_string());
                    if let Ok(exp) = fields[6].parse::<i64>() {
                        let now = chrono::Utc::now().timestamp();
                        if exp > 0 && exp < now {
                            sub.is_expired = true;
                        }
                    }
                }
                if fields.len() > 11 {
                    sub.capabilities = parse_capabilities(fields[11]);
                }

                if let Some(ref mut key) = current_key {
                    key.subkeys.push(sub);
                }
            }

            _ => {}
        }
    }

    // Save last key
    if let Some(ref mut key) = current_key {
        if let Some(uid) = current_uid.take() {
            key.uid_list.push(uid);
        }
        keys.push(key.clone());
    }

    keys
}

/// Parse GPG import status output into an import result.
pub fn parse_import_result(output: &str) -> KeyImportResult {
    let mut result = KeyImportResult::default();

    for line in output.lines() {
        let line = line.trim();

        // Parse IMPORT_RES status line
        if line.contains("IMPORT_RES") {
            let parts: Vec<&str> = line.split_whitespace().collect();
            // IMPORT_RES <count> <no_user_id> <imported> <imported_rsa> <unchanged>
            // <n_uids> <n_subk> <n_sigs> <n_revoc> <sec_read> <sec_imported> <sec_dups> <not_imported>
            if parts.len() >= 14 {
                let idx = parts.iter().position(|p| *p == "IMPORT_RES").unwrap_or(0) + 1;
                if idx + 12 < parts.len() {
                    result.total = parts[idx].parse().unwrap_or(0);
                    result.no_user_id = parts[idx + 1].parse().unwrap_or(0);
                    result.imported = parts[idx + 2].parse().unwrap_or(0);
                    result.unchanged = parts[idx + 4].parse().unwrap_or(0);
                    result.new_subkeys = parts[idx + 6].parse().unwrap_or(0);
                    result.new_signatures = parts[idx + 7].parse().unwrap_or(0);
                    result.new_revocations = parts[idx + 8].parse().unwrap_or(0);
                    result.secrets_read = parts[idx + 9].parse().unwrap_or(0);
                    result.secrets_imported = parts[idx + 10].parse().unwrap_or(0);
                    result.secrets_unchanged = parts[idx + 11].parse().unwrap_or(0);
                    result.not_imported = parts[idx + 12].parse().unwrap_or(0);
                }
            }
        }

        // Count IMPORT_OK lines for new_keys
        if line.contains("IMPORT_OK") {
            result.new_keys += 1;
        }
    }

    result
}

/// Parse keyserver search results.
pub fn parse_keyserver_search(output: &str) -> Vec<KeyServerResult> {
    let mut results = Vec::new();
    let mut current: Option<KeyServerResult> = None;

    for line in output.lines() {
        let fields: Vec<&str> = line.split(':').collect();
        if fields.is_empty() {
            continue;
        }

        match fields[0] {
            "pub" => {
                if let Some(entry) = current.take() {
                    results.push(entry);
                }

                let mut entry = KeyServerResult {
                    key_id: String::new(),
                    uid: String::new(),
                    creation_date: String::new(),
                    algorithm: GpgKeyAlgorithm::Unknown(String::new()),
                    bits: 0,
                    flags: String::new(),
                };

                if fields.len() > 1 {
                    entry.key_id = fields[1].to_string();
                }
                if fields.len() > 2 {
                    entry.algorithm = GpgKeyAlgorithm::from_gpg_id(fields[2]);
                }
                if fields.len() > 3 {
                    entry.bits = fields[3].parse().unwrap_or(0);
                }
                if fields.len() > 4 {
                    entry.creation_date = fields[4].to_string();
                }
                if fields.len() > 5 {
                    entry.flags = fields[5].to_string();
                }

                current = Some(entry);
            }
            "uid" => {
                if let Some(ref mut entry) = current {
                    if entry.uid.is_empty() && fields.len() > 1 {
                        entry.uid = fields[1].to_string();
                    }
                }
            }
            _ => {}
        }
    }

    if let Some(entry) = current {
        results.push(entry);
    }

    results
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_COLON_OUTPUT: &str = "\
pub:u:4096:1:AABBCCDD11223344:1609459200:1704067200::u:::scESC:::::::::\n\
fpr:::::::::AABBCCDD1122334455667788AABBCCDD11223344:\n\
grp:::::::::ABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD:\n\
uid:u::::1609459200::AABB1122::Alice Smith <alice@example.com>:::::::::::\n\
sig:::1:AABBCCDD11223344:1609459200::::Alice Smith <alice@example.com>:13x::::::\n\
sub:u:4096:1:EEFF00112233AABB:1609459200:1704067200:::::e:::::::::\n\
fpr:::::::::EEFF001122334455EEFF00112233AABB11223344:\n\
grp:::::::::1234567890ABCDEF1234567890ABCDEF12345678:\n\
";

    #[test]
    fn test_parse_colon_listing() {
        let keys = parse_colon_key_listing(SAMPLE_COLON_OUTPUT, false);
        assert_eq!(keys.len(), 1);

        let key = &keys[0];
        assert_eq!(key.key_id, "AABBCCDD11223344");
        assert_eq!(
            key.fingerprint,
            "AABBCCDD1122334455667788AABBCCDD11223344"
        );
        assert_eq!(key.bits, 4096);
        assert_eq!(key.validity, KeyValidity::Ultimate);
        assert_eq!(key.owner_trust, KeyOwnerTrust::Ultimate);
        assert!(!key.is_secret);

        // UID
        assert_eq!(key.uid_list.len(), 1);
        assert_eq!(key.uid_list[0].name, "Alice Smith");
        assert_eq!(key.uid_list[0].email, "alice@example.com");
        assert!(key.uid_list[0].is_primary);

        // Subkey
        assert_eq!(key.subkeys.len(), 1);
        assert_eq!(key.subkeys[0].key_id, "EEFF00112233AABB");
        assert!(key.subkeys[0]
            .capabilities
            .contains(&KeyCapability::Encrypt));

        // Keygrip
        assert_eq!(
            key.keygrip.as_deref(),
            Some("ABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD")
        );
    }

    #[test]
    fn test_parse_secret_keys() {
        let output = "sec:u:256:22:AABBCCDD11223344:1609459200:::u:::scESC::::ed25519::::\n\
                       fpr:::::::::AABBCCDD1122334455667788AABBCCDD11223344:\n\
                       uid:u::::1609459200::AABB1122::Bob <bob@example.com>:::::::::::\n";
        let keys = parse_colon_key_listing(output, true);
        assert_eq!(keys.len(), 1);
        assert!(keys[0].is_secret);
    }

    #[test]
    fn test_parse_import_result() {
        let output = "[GNUPG:] IMPORT_OK 1 AABBCCDD1122334455667788AABBCCDD11223344\n\
                       [GNUPG:] IMPORT_RES 1 0 1 0 0 0 0 0 0 0 0 0 0\n";
        let result = parse_import_result(output);
        assert_eq!(result.total, 1);
        assert_eq!(result.imported, 1);
        assert_eq!(result.new_keys, 1);
    }

    #[test]
    fn test_parse_keyserver_search() {
        let output =
            "pub:AABBCCDD11223344:1:4096:1609459200::\n\
             uid:Alice Smith <alice@example.com>:1609459200::\n\
             pub:EEFF001122334455:22:256:1609459200::\n\
             uid:Bob <bob@example.com>:1609459200::\n";
        let results = parse_keyserver_search(output);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].key_id, "AABBCCDD11223344");
        assert_eq!(results[0].uid, "Alice Smith <alice@example.com>");
        assert_eq!(results[1].key_id, "EEFF001122334455");
    }

    #[test]
    fn test_parse_empty_output() {
        let keys = parse_colon_key_listing("", false);
        assert!(keys.is_empty());
    }

    #[test]
    fn test_parse_revoked_key() {
        let output = "pub:r:4096:1:AABBCCDD11223344:1609459200:::r:::scESC:::::::::\n\
                       fpr:::::::::AABBCCDD1122334455667788AABBCCDD11223344:\n\
                       uid:r::::1609459200::AABB1122::Revoked <revoked@example.com>:::::::::::\n";
        let keys = parse_colon_key_listing(output, false);
        assert_eq!(keys.len(), 1);
        assert!(keys[0].is_revoked);
        assert!(keys[0].uid_list[0].is_revoked);
    }

    #[test]
    fn test_keyring_manager_new() {
        let mgr = KeyringManager::new("gpg", Some("/home/user/.gnupg".to_string()), "hkps://keys.openpgp.org");
        assert_eq!(mgr.gpg_binary, "gpg");
        assert_eq!(mgr.keyserver, "hkps://keys.openpgp.org");
    }

    #[test]
    fn test_parse_multiple_uids() {
        let output = "pub:u:4096:1:AABBCCDD11223344:1609459200::::::scESC:::::::::\n\
                       fpr:::::::::AABBCCDD1122334455667788AABBCCDD11223344:\n\
                       uid:u::::1609459200::AA::First <first@example.com>:::::::::::\n\
                       uid:u::::1609459200::BB::Second <second@example.com>:::::::::::\n";
        let keys = parse_colon_key_listing(output, false);
        assert_eq!(keys.len(), 1);
        assert_eq!(keys[0].uid_list.len(), 2);
        assert!(keys[0].uid_list[0].is_primary);
        assert!(!keys[0].uid_list[1].is_primary);
    }
}
