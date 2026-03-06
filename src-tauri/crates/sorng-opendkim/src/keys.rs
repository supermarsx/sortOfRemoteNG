// ── OpenDKIM key management ──────────────────────────────────────────────────

use crate::client::{shell_escape, OpendkimClient};
use crate::error::{OpendkimError, OpendkimResult};
use crate::types::*;

pub struct KeyManager;

impl KeyManager {
    /// List all DKIM keys found in the key directory.
    /// Scans domain subdirectories for private key files.
    pub async fn list(client: &OpendkimClient) -> OpendkimResult<Vec<DkimKey>> {
        let key_dir = client.key_dir();
        let domains = client.list_remote_dir(key_dir).await?;
        let mut keys = Vec::new();
        for domain in &domains {
            let domain_dir = format!("{}/{}", key_dir, domain);
            let files = client.list_remote_dir(&domain_dir).await.unwrap_or_default();
            for file in &files {
                if !file.ends_with(".private") {
                    continue;
                }
                let selector = file.trim_end_matches(".private");
                let private_key_path = format!("{}/{}", domain_dir, file);
                let public_key_path = format!("{}/{}.txt", domain_dir, selector);
                let pub_exists = client.file_exists(&public_key_path).await.unwrap_or(false);
                let dns_record = if pub_exists {
                    client
                        .read_remote_file(&public_key_path)
                        .await
                        .ok()
                        .map(|c| c.trim().to_string())
                } else {
                    None
                };
                // Determine key type by inspecting the private key header
                let key_header = client
                    .exec_ssh(&format!("head -1 {}", shell_escape(&private_key_path)))
                    .await
                    .ok()
                    .map(|o| o.stdout.trim().to_string())
                    .unwrap_or_default();
                let key_type = if key_header.contains("ED25519") {
                    "ed25519".to_string()
                } else {
                    "rsa".to_string()
                };
                // Determine RSA key bits
                let bits = if key_type == "rsa" {
                    client
                        .exec_ssh(&format!(
                            "openssl rsa -in {} -text -noout 2>/dev/null | head -1",
                            shell_escape(&private_key_path)
                        ))
                        .await
                        .ok()
                        .and_then(|o| {
                            o.stdout
                                .trim()
                                .split_whitespace()
                                .find_map(|w| w.trim_end_matches('-').parse::<u32>().ok())
                        })
                } else {
                    None
                };
                keys.push(DkimKey {
                    selector: selector.to_string(),
                    domain: domain.clone(),
                    key_type,
                    bits,
                    private_key_path,
                    public_key_path: if pub_exists {
                        Some(public_key_path)
                    } else {
                        None
                    },
                    dns_record,
                    created_at: None,
                    expires_at: None,
                });
            }
        }
        Ok(keys)
    }

    /// Get a specific DKIM key by selector and domain.
    pub async fn get(
        client: &OpendkimClient,
        selector: &str,
        domain: &str,
    ) -> OpendkimResult<DkimKey> {
        let all = Self::list(client).await?;
        all.into_iter()
            .find(|k| k.selector == selector && k.domain == domain)
            .ok_or_else(|| OpendkimError::key_not_found(selector, domain))
    }

    /// Generate a new DKIM key pair using opendkim-genkey.
    pub async fn generate(
        client: &OpendkimClient,
        req: &CreateKeyRequest,
    ) -> OpendkimResult<DkimKey> {
        let key_type = req.key_type.as_deref().unwrap_or("rsa");
        let bits = req.bits.unwrap_or(2048);
        let domain_dir = format!("{}/{}", client.key_dir(), req.domain);
        client.create_dir(&domain_dir).await?;
        let mut cmd = format!(
            "sudo opendkim-genkey -s {} -d {} -D {}",
            shell_escape(&req.selector),
            shell_escape(&req.domain),
            shell_escape(&domain_dir),
        );
        if key_type == "rsa" {
            cmd.push_str(&format!(" -b {}", bits));
        }
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(OpendkimError::io(format!(
                "opendkim-genkey failed: {}",
                out.stderr
            )));
        }
        // Fix ownership so opendkim can read the key
        client
            .exec_ssh(&format!(
                "sudo chown opendkim:opendkim {}/*",
                shell_escape(&domain_dir)
            ))
            .await?;
        Self::get(client, &req.selector, &req.domain).await
    }

    /// Rotate a DKIM key: generate a new key with a new selector, then
    /// optionally remove the old one after the caller updates DNS.
    pub async fn rotate(
        client: &OpendkimClient,
        req: &RotateKeyRequest,
    ) -> OpendkimResult<DkimKey> {
        // Ensure the old key exists
        Self::get(client, &req.selector, &req.domain).await?;
        let create = CreateKeyRequest {
            selector: req.new_selector.clone(),
            domain: req.domain.clone(),
            key_type: req.key_type.clone(),
            bits: req.bits,
        };
        let new_key = Self::generate(client, &create).await?;
        Ok(new_key)
    }

    /// Delete a DKIM key pair (private + public/txt files).
    pub async fn delete(
        client: &OpendkimClient,
        selector: &str,
        domain: &str,
    ) -> OpendkimResult<()> {
        let domain_dir = format!("{}/{}", client.key_dir(), domain);
        let private_path = format!("{}/{}.private", domain_dir, selector);
        let txt_path = format!("{}/{}.txt", domain_dir, selector);
        client.remove_file(&private_path).await?;
        let _ = client.remove_file(&txt_path).await;
        Ok(())
    }

    /// Get the DNS TXT record for a DKIM key.
    pub async fn get_dns_record(
        client: &OpendkimClient,
        selector: &str,
        domain: &str,
    ) -> OpendkimResult<DnsRecord> {
        let txt_path = format!("{}/{}/{}.txt", client.key_dir(), domain, selector);
        let content = client.read_remote_file(&txt_path).await.map_err(|_| {
            OpendkimError::key_not_found(selector, domain)
        })?;
        // opendkim-genkey produces a file like:
        //   selector._domainkey IN TXT ( "v=DKIM1; k=rsa; p=MIG..." )
        let value = content
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|l| l.trim().trim_matches('"'))
            .collect::<Vec<_>>()
            .join("");
        Ok(DnsRecord {
            selector: selector.to_string(),
            domain: domain.to_string(),
            record_type: "TXT".to_string(),
            value,
            ttl: Some(3600),
        })
    }

    /// Verify that the DNS record for a DKIM key is published
    /// using opendkim-testkey.
    pub async fn verify_dns(
        client: &OpendkimClient,
        selector: &str,
        domain: &str,
    ) -> OpendkimResult<bool> {
        let cmd = format!(
            "opendkim-testkey -d {} -s {} -vvv 2>&1",
            shell_escape(domain),
            shell_escape(selector),
        );
        let out = client.exec_ssh(&cmd).await?;
        // opendkim-testkey returns 0 on success; output contains "key OK" on match.
        let ok = out.exit_code == 0 && out.stdout.to_lowercase().contains("key ok");
        Ok(ok)
    }

    /// Export the public key as a base64-encoded string.
    pub async fn export_public_key(
        client: &OpendkimClient,
        selector: &str,
        domain: &str,
    ) -> OpendkimResult<String> {
        let txt_path = format!("{}/{}/{}.txt", client.key_dir(), domain, selector);
        let content = client.read_remote_file(&txt_path).await.map_err(|_| {
            OpendkimError::key_not_found(selector, domain)
        })?;
        // Extract the p= value from the TXT record content
        let mut p_value = String::new();
        let mut capture = false;
        for part in content.split('"') {
            let trimmed = part.trim();
            if trimmed.contains("p=") {
                if let Some(after_p) = trimmed.split("p=").nth(1) {
                    p_value.push_str(after_p.trim_end_matches(';').trim());
                    capture = true;
                }
            } else if capture && !trimmed.is_empty() && !trimmed.contains('(') && !trimmed.contains(')') {
                p_value.push_str(trimmed.trim_end_matches(';').trim());
            }
        }
        if p_value.is_empty() {
            return Err(OpendkimError::parse(format!(
                "could not extract public key from {}.txt for {}/{}",
                selector, domain, selector
            )));
        }
        Ok(p_value)
    }
}
