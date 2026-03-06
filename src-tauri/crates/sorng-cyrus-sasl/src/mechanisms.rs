// ── Cyrus SASL mechanism management ──────────────────────────────────────────

use crate::client::{shell_escape, CyrusSaslClient};
use crate::error::{CyrusSaslError, CyrusSaslResult};
use crate::types::*;

pub struct MechanismManager;

impl MechanismManager {
    /// List all SASL mechanisms known to the system (enabled & disabled).
    pub async fn list(client: &CyrusSaslClient) -> CyrusSaslResult<Vec<SaslMechanism>> {
        let out = client
            .exec_ssh("pluginviewer --saslmechlist -c 2>/dev/null || pluginviewer 2>/dev/null || echo ''")
            .await?;
        let mechanisms = parse_mechanism_list(&out.stdout);
        Ok(mechanisms)
    }

    /// Get a single mechanism by name.
    pub async fn get(client: &CyrusSaslClient, name: &str) -> CyrusSaslResult<SaslMechanism> {
        let all = Self::list(client).await?;
        all.into_iter()
            .find(|m| m.name.eq_ignore_ascii_case(name))
            .ok_or_else(|| CyrusSaslError::mechanism_not_found(name))
    }

    /// List only mechanisms that have plugins available on disk.
    pub async fn list_available(client: &CyrusSaslClient) -> CyrusSaslResult<Vec<SaslMechanism>> {
        let out = client
            .exec_ssh("pluginviewer --saslmechlist -c 2>/dev/null || echo ''")
            .await?;
        let mechanisms = parse_mechanism_list(&out.stdout);
        Ok(mechanisms.into_iter().filter(|m| m.enabled).collect())
    }

    /// List names of mechanisms currently enabled in the global mech_list.
    pub async fn list_enabled(client: &CyrusSaslClient) -> CyrusSaslResult<Vec<String>> {
        let config_dir = client.config_dir();
        let out = client
            .exec_ssh(&format!(
                "grep -h 'mech_list' {}/*.conf 2>/dev/null | head -1",
                shell_escape(config_dir)
            ))
            .await?;
        let line = out.stdout.trim();
        if line.is_empty() {
            // No explicit mech_list → use available mechanisms
            let mechs = client.list_mechanisms().await?;
            return Ok(mechs);
        }
        let mechs: Vec<String> = line
            .split(':')
            .last()
            .unwrap_or("")
            .split_whitespace()
            .map(String::from)
            .collect();
        Ok(mechs)
    }

    /// Enable a mechanism by adding it to the global mech_list.
    pub async fn enable(client: &CyrusSaslClient, name: &str) -> CyrusSaslResult<()> {
        let mut enabled = Self::list_enabled(client).await?;
        let upper = name.to_uppercase();
        if enabled.iter().any(|m| m.eq_ignore_ascii_case(&upper)) {
            return Ok(());
        }
        enabled.push(upper);
        let mech_line = format!("mech_list: {}", enabled.join(" "));
        let config_path = format!("{}/sasl-mech.conf", client.config_dir());

        let existing = client.read_remote_file(&config_path).await.unwrap_or_default();
        let new_content = if existing.contains("mech_list:") {
            existing
                .lines()
                .map(|l| {
                    if l.trim().starts_with("mech_list") {
                        mech_line.as_str()
                    } else {
                        l
                    }
                })
                .collect::<Vec<_>>()
                .join("\n")
        } else {
            format!("{}\n{}\n", existing.trim_end(), mech_line)
        };
        client.write_remote_file(&config_path, &new_content).await?;
        Ok(())
    }

    /// Disable a mechanism by removing it from the global mech_list.
    pub async fn disable(client: &CyrusSaslClient, name: &str) -> CyrusSaslResult<()> {
        let enabled = Self::list_enabled(client).await?;
        let filtered: Vec<String> = enabled
            .into_iter()
            .filter(|m| !m.eq_ignore_ascii_case(name))
            .collect();
        if filtered.is_empty() {
            return Err(CyrusSaslError::new(
                crate::error::CyrusSaslErrorKind::InternalError,
                "Cannot disable all mechanisms",
            ));
        }
        let mech_line = format!("mech_list: {}", filtered.join(" "));
        let config_path = format!("{}/sasl-mech.conf", client.config_dir());

        let existing = client.read_remote_file(&config_path).await.unwrap_or_default();
        let new_content = if existing.contains("mech_list:") {
            existing
                .lines()
                .map(|l| {
                    if l.trim().starts_with("mech_list") {
                        mech_line.as_str()
                    } else {
                        l
                    }
                })
                .collect::<Vec<_>>()
                .join("\n")
        } else {
            format!("{}\n{}\n", existing.trim_end(), mech_line)
        };
        client.write_remote_file(&config_path, &new_content).await?;
        Ok(())
    }
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

fn parse_mechanism_list(raw: &str) -> Vec<SaslMechanism> {
    // pluginviewer output looks like:
    //   Plugin "PLAIN" [loaded], ...
    //   Plugin "DIGEST-MD5" [loaded], ...
    // Or a simpler list: PLAIN DIGEST-MD5 CRAM-MD5 ...
    let mut mechanisms = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Try to parse pluginviewer-style output
        if trimmed.starts_with("Plugin") || trimmed.contains("[loaded]") {
            if let Some(name) = extract_plugin_name(trimmed) {
                if seen.insert(name.clone()) {
                    let enabled = trimmed.contains("[loaded]");
                    let description = describe_mechanism(&name);
                    let security_flags = mechanism_security_flags(&name);
                    let features = mechanism_features(&name);
                    mechanisms.push(SaslMechanism {
                        name,
                        enabled,
                        description,
                        security_flags,
                        features,
                    });
                }
            }
        } else {
            // Fallback: treat each whitespace-separated token as a mechanism name
            for token in trimmed.split_whitespace() {
                let name = token.trim_end_matches(',').to_uppercase();
                if !name.is_empty()
                    && name.chars().all(|c| c.is_ascii_uppercase() || c == '-' || c == '_')
                    && seen.insert(name.clone())
                {
                    let description = describe_mechanism(&name);
                    let security_flags = mechanism_security_flags(&name);
                    let features = mechanism_features(&name);
                    mechanisms.push(SaslMechanism {
                        name,
                        enabled: true,
                        description,
                        security_flags,
                        features,
                    });
                }
            }
        }
    }

    mechanisms
}

fn extract_plugin_name(line: &str) -> Option<String> {
    // Plugin "NAME" ...
    let start = line.find('"')? + 1;
    let end = line[start..].find('"')? + start;
    Some(line[start..end].to_string())
}

fn describe_mechanism(name: &str) -> String {
    match name {
        "PLAIN" => "Simple plaintext password authentication".to_string(),
        "LOGIN" => "Non-standard plaintext LOGIN mechanism".to_string(),
        "DIGEST-MD5" => "HTTP Digest-compatible challenge-response mechanism".to_string(),
        "CRAM-MD5" => "Challenge-Response Authentication Mechanism using MD5".to_string(),
        "SCRAM-SHA-1" => "Salted Challenge Response (SHA-1)".to_string(),
        "SCRAM-SHA-256" => "Salted Challenge Response (SHA-256)".to_string(),
        "GSSAPI" => "Kerberos V5 (GSSAPI) authentication".to_string(),
        "EXTERNAL" => "External authentication (e.g. TLS client cert)".to_string(),
        "ANONYMOUS" => "Anonymous access mechanism".to_string(),
        "OTP" => "One-Time Password mechanism (RFC 2289)".to_string(),
        "NTLM" => "Windows NTLM authentication".to_string(),
        "PASSDSS-3DES-1" => "DSA Signed Ephemeral Diffie-Hellman".to_string(),
        _ => format!("SASL mechanism: {name}"),
    }
}

fn mechanism_security_flags(name: &str) -> Vec<String> {
    match name {
        "PLAIN" | "LOGIN" => vec!["noplaintext".to_string()],
        "DIGEST-MD5" | "CRAM-MD5" => {
            vec!["noplaintext".to_string(), "noanonymous".to_string()]
        }
        "SCRAM-SHA-1" | "SCRAM-SHA-256" => vec![
            "noplaintext".to_string(),
            "noanonymous".to_string(),
            "mutual_auth".to_string(),
        ],
        "GSSAPI" => vec![
            "noplaintext".to_string(),
            "noanonymous".to_string(),
            "mutual_auth".to_string(),
            "encryption".to_string(),
        ],
        "EXTERNAL" => vec!["noplaintext".to_string(), "noanonymous".to_string()],
        "ANONYMOUS" => vec![],
        _ => vec![],
    }
}

fn mechanism_features(name: &str) -> Vec<String> {
    match name {
        "PLAIN" | "LOGIN" => vec!["simple".to_string()],
        "DIGEST-MD5" => vec![
            "challenge_response".to_string(),
            "integrity".to_string(),
            "confidentiality".to_string(),
        ],
        "CRAM-MD5" => vec!["challenge_response".to_string()],
        "SCRAM-SHA-1" | "SCRAM-SHA-256" => vec![
            "channel_binding".to_string(),
            "stored_key".to_string(),
            "salted".to_string(),
        ],
        "GSSAPI" => vec![
            "mutual_auth".to_string(),
            "delegation".to_string(),
            "encryption".to_string(),
        ],
        "EXTERNAL" => vec!["external_auth".to_string()],
        "ANONYMOUS" => vec!["anonymous".to_string()],
        "OTP" => vec!["one_time".to_string()],
        _ => vec![],
    }
}
