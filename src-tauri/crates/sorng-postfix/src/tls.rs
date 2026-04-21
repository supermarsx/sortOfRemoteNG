// ── postfix TLS management ───────────────────────────────────────────────────

use crate::client::{shell_escape, PostfixClient};
use crate::error::{PostfixError, PostfixResult};
use crate::types::*;
use std::collections::HashMap;

pub struct PostfixTlsManager;

impl PostfixTlsManager {
    /// Get all TLS-related main.cf parameters.
    pub async fn get_tls_config(client: &PostfixClient) -> PostfixResult<HashMap<String, String>> {
        let out = client.exec_ssh("postconf | grep -i tls").await?;
        let mut config = HashMap::new();
        for line in out.stdout.lines() {
            if let Some((key, value)) = line.split_once('=') {
                config.insert(key.trim().to_string(), value.trim().to_string());
            }
        }
        Ok(config)
    }

    /// Set a TLS-related main.cf parameter.
    pub async fn set_tls_param(
        client: &PostfixClient,
        name: &str,
        value: &str,
    ) -> PostfixResult<()> {
        // Verify it's a TLS parameter for safety
        let lower = name.to_lowercase();
        if !lower.contains("tls") && !lower.contains("ssl") {
            return Err(PostfixError::config_syntax(&format!(
                "Parameter '{}' does not appear to be a TLS parameter",
                name
            )));
        }
        client.postconf_set(name, value).await
    }

    /// List TLS policy table entries.
    pub async fn list_policies(client: &PostfixClient) -> PostfixResult<Vec<PostfixTlsPolicy>> {
        let tls_policy_path = format!("{}/tls_policy", client.config_dir());
        let content = client
            .read_remote_file(&tls_policy_path)
            .await
            .unwrap_or_default();
        let mut policies = Vec::new();
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            if let Some(policy) = parse_tls_policy_line(trimmed) {
                policies.push(policy);
            }
        }
        Ok(policies)
    }

    /// Set or update a TLS policy for a domain.
    pub async fn set_policy(
        client: &PostfixClient,
        domain: &str,
        policy: &PostfixTlsPolicy,
    ) -> PostfixResult<()> {
        let tls_policy_path = format!("{}/tls_policy", client.config_dir());
        let content = client
            .read_remote_file(&tls_policy_path)
            .await
            .unwrap_or_default();
        let policy_line = build_tls_policy_line(policy);
        let mut new_lines = Vec::new();
        let mut replaced = false;
        for line in content.lines() {
            let trimmed = line.trim();
            if !trimmed.is_empty()
                && !trimmed.starts_with('#')
                && trimmed.split_whitespace().next() == Some(domain)
            {
                new_lines.push(policy_line.clone());
                replaced = true;
            } else {
                new_lines.push(line.to_string());
            }
        }
        if !replaced {
            new_lines.push(policy_line);
        }
        let new_content = new_lines.join("\n") + "\n";
        client
            .write_remote_file(&tls_policy_path, &new_content)
            .await?;
        client.postmap(&tls_policy_path).await
    }

    /// Delete a TLS policy for a domain.
    pub async fn delete_policy(client: &PostfixClient, domain: &str) -> PostfixResult<()> {
        let tls_policy_path = format!("{}/tls_policy", client.config_dir());
        let content = client.read_remote_file(&tls_policy_path).await?;
        let new_lines: Vec<&str> = content
            .lines()
            .filter(|line| {
                let trimmed = line.trim();
                trimmed.is_empty()
                    || trimmed.starts_with('#')
                    || trimmed.split_whitespace().next() != Some(domain)
            })
            .collect();
        let new_content = new_lines.join("\n") + "\n";
        client
            .write_remote_file(&tls_policy_path, &new_content)
            .await?;
        client.postmap(&tls_policy_path).await
    }

    /// Inspect a certificate file on the remote host.
    pub async fn check_certificate(
        client: &PostfixClient,
        cert_path: &str,
    ) -> PostfixResult<CertificateInfo> {
        let out = client
            .exec_ssh(&format!(
                "openssl x509 -in {} -noout -subject -issuer -dates -fingerprint -serial 2>&1",
                shell_escape(cert_path)
            ))
            .await?;
        if out.exit_code != 0 {
            return Err(PostfixError::io(format!(
                "Failed to read certificate {}: {}",
                cert_path, out.stderr
            )));
        }
        let mut subject = String::new();
        let mut issuer = String::new();
        let mut not_before = String::new();
        let mut not_after = String::new();
        let mut fingerprint = String::new();
        let mut serial = String::new();
        for line in out.stdout.lines() {
            let trimmed = line.trim();
            if let Some(val) = trimmed.strip_prefix("subject=") {
                subject = val.trim().to_string();
            } else if let Some(val) = trimmed.strip_prefix("issuer=") {
                issuer = val.trim().to_string();
            } else if let Some(val) = trimmed.strip_prefix("notBefore=") {
                not_before = val.trim().to_string();
            } else if let Some(val) = trimmed.strip_prefix("notAfter=") {
                not_after = val.trim().to_string();
            } else if trimmed.contains("Fingerprint=") {
                fingerprint = trimmed
                    .split_once('=')
                    .map(|(_, v)| v.trim().to_string())
                    .unwrap_or_default();
            } else if let Some(val) = trimmed.strip_prefix("serial=") {
                serial = val.trim().to_string();
            }
        }
        Ok(CertificateInfo {
            subject,
            issuer,
            not_before,
            not_after,
            fingerprint,
            serial,
        })
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn parse_tls_policy_line(line: &str) -> Option<PostfixTlsPolicy> {
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 2 {
        return None;
    }
    let domain = parts[0].to_string();
    let policy_str = parts[1];
    let policy = match policy_str {
        "none" => TlsPolicy::None,
        "may" => TlsPolicy::May,
        "encrypt" => TlsPolicy::Encrypt,
        "dane" => TlsPolicy::Dane,
        "verify" => TlsPolicy::Verify,
        "secure" => TlsPolicy::Secure,
        _ => TlsPolicy::May,
    };
    let match_type = parts.get(2).map(|s| s.to_string());
    let params = if parts.len() > 3 {
        Some(parts[3..].join(" "))
    } else {
        None
    };
    Some(PostfixTlsPolicy {
        domain,
        policy,
        match_type,
        params,
    })
}

fn build_tls_policy_line(policy: &PostfixTlsPolicy) -> String {
    let mut line = format!("{}\t{}", policy.domain, policy.policy);
    if let Some(ref mt) = policy.match_type {
        line.push('\t');
        line.push_str(mt);
    }
    if let Some(ref p) = policy.params {
        line.push('\t');
        line.push_str(p);
    }
    line
}
