//! # opkssh OIDC Login
//!
//! Handle the `opkssh login` flow, which opens a browser for OIDC authentication
//! and generates an SSH key containing the PK Token.

use crate::types::*;
use chrono::{Duration, Utc};
use log::{info, warn};
use std::path::PathBuf;
use tokio::process::Command;

/// Build the command-line arguments for `opkssh login`.
pub fn build_login_args(opts: &OpksshLoginOptions) -> Vec<String> {
    let mut args = vec!["login".to_string()];

    // Provider flag: --provider="issuer,client_id[,client_secret][,scopes]"
    if let Some(ref provider) = opts.provider {
        // Simple alias like "google", "azure", etc.
        if opts.issuer.is_none() && opts.client_id.is_none() {
            args.push(provider.clone());
        }
    }

    if let Some(ref issuer) = opts.issuer {
        let mut provider_str = issuer.clone();
        if let Some(ref cid) = opts.client_id {
            provider_str = format!("{},{}", provider_str, cid);
            if let Some(ref secret) = opts.client_secret {
                provider_str = format!("{},{}", provider_str, secret);
            } else if opts.scopes.is_some() {
                // Need empty secret placeholder to set scopes
                provider_str = format!("{},", provider_str);
            }
            if let Some(ref scopes) = opts.scopes {
                provider_str = format!("{},{}", provider_str, scopes);
            }
        }
        args.push(format!("--provider={}", provider_str));
    }

    if let Some(ref key_name) = opts.key_file_name {
        args.push(format!("--key-file-name={}", key_name));
    }

    if opts.create_config {
        args.push("--create-config".to_string());
    }

    if let Some(ref uri) = opts.remote_redirect_uri {
        args.push(format!("--remote-redirect-uri={}", uri));
    }

    args
}

/// Execute `opkssh login` and parse the result.
pub async fn execute_login(
    binary_path: &PathBuf,
    opts: &OpksshLoginOptions,
) -> Result<OpksshLoginResult, String> {
    let args = build_login_args(opts);
    let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

    info!("Executing opkssh login with args: {:?}", args_refs);

    let start = std::time::Instant::now();
    let output = Command::new(binary_path)
        .args(&args_refs)
        .output()
        .await
        .map_err(|e| format!("Failed to execute opkssh login: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let raw_output = format!("{}\n{}", stdout, stderr);
    let _duration = start.elapsed();

    if !output.status.success() {
        return Ok(OpksshLoginResult {
            success: false,
            key_path: None,
            identity: None,
            provider: opts.provider.clone(),
            expires_at: None,
            message: format!("Login failed: {}", stderr.trim()),
            raw_output,
        });
    }

    // Parse the output to extract key path and identity
    let key_path = parse_key_path(&raw_output, opts);
    let identity = parse_identity(&raw_output);
    // Default: keys expire after 24 hours
    let expires_at = Some(Utc::now() + Duration::hours(24));

    Ok(OpksshLoginResult {
        success: true,
        key_path,
        identity,
        provider: opts.provider.clone(),
        expires_at,
        message: "Login successful".to_string(),
        raw_output,
    })
}

/// Parse key path from login output.
fn parse_key_path(output: &str, opts: &OpksshLoginOptions) -> Option<String> {
    // Look for path mentions in output
    for line in output.lines() {
        let lower = line.to_lowercase();
        if lower.contains("id_ecdsa") || lower.contains("key") && lower.contains("written") {
            // Try to extract a file path
            if let Some(path) = extract_path_from_line(line) {
                return Some(path);
            }
        }
    }

    // Fall back to default path
    let key_name = opts
        .key_file_name
        .as_deref()
        .unwrap_or("id_ecdsa");

    dirs::home_dir().map(|h| {
        h.join(".ssh")
            .join(key_name)
            .to_string_lossy()
            .to_string()
    })
}

/// Extract a file path from a log line.
fn extract_path_from_line(line: &str) -> Option<String> {
    // Look for paths like /home/user/.ssh/id_ecdsa or C:\Users\...
    let tokens: Vec<&str> = line.split_whitespace().collect();
    for token in tokens {
        let cleaned = token.trim_matches(|c: char| c == '\'' || c == '"' || c == '`');
        if cleaned.contains(".ssh") || cleaned.contains("id_ecdsa") || cleaned.contains("id_") {
            return Some(cleaned.to_string());
        }
    }
    None
}

/// Parse identity (email) from login output.
fn parse_identity(output: &str) -> Option<String> {
    for line in output.lines() {
        let lower = line.to_lowercase();
        if lower.contains("authenticated") || lower.contains("identity") || lower.contains("email") {
            // Look for something that looks like an email
            for token in line.split_whitespace() {
                let cleaned = token.trim_matches(|c: char| !c.is_alphanumeric() && c != '@' && c != '.' && c != '-' && c != '_');
                if cleaned.contains('@') && cleaned.contains('.') {
                    return Some(cleaned.to_string());
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_login_args_simple_alias() {
        let opts = OpksshLoginOptions {
            provider: Some("google".into()),
            ..Default::default()
        };
        let args = build_login_args(&opts);
        assert_eq!(args, vec!["login", "google"]);
    }

    #[test]
    fn test_build_login_args_custom_provider() {
        let opts = OpksshLoginOptions {
            issuer: Some("https://auth.example.com".into()),
            client_id: Some("my-client".into()),
            scopes: Some("openid profile email".into()),
            ..Default::default()
        };
        let args = build_login_args(&opts);
        assert!(args.contains(&"--provider=https://auth.example.com,my-client,,openid profile email".to_string()));
    }

    #[test]
    fn test_build_login_args_key_file() {
        let opts = OpksshLoginOptions {
            provider: Some("google".into()),
            key_file_name: Some("my_key".into()),
            ..Default::default()
        };
        let args = build_login_args(&opts);
        assert!(args.contains(&"login".to_string()));
        assert!(args.contains(&"--key-file-name=my_key".to_string()));
    }

    #[test]
    fn test_build_login_args_create_config() {
        let opts = OpksshLoginOptions {
            create_config: true,
            ..Default::default()
        };
        let args = build_login_args(&opts);
        assert!(args.contains(&"--create-config".to_string()));
    }
}
