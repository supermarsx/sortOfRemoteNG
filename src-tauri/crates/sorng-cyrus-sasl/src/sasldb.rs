// ── Cyrus SASL sasldb management ─────────────────────────────────────────────

use crate::client::{shell_escape, CyrusSaslClient};
use crate::error::{CyrusSaslError, CyrusSaslResult};
use crate::types::*;

pub struct SaslDbManager;

impl SaslDbManager {
    /// List all entries in the sasldb.
    pub async fn list_entries(client: &CyrusSaslClient) -> CyrusSaslResult<Vec<SaslDbEntry>> {
        let out = client
            .exec_ssh(&format!(
                "sudo {} 2>/dev/null",
                client.sasldblistusers_bin()
            ))
            .await?;
        let entries = parse_db_entries(&out.stdout);
        Ok(entries)
    }

    /// Get all sasldb entries for a specific user@realm.
    pub async fn get_entry(
        client: &CyrusSaslClient,
        username: &str,
        realm: &str,
    ) -> CyrusSaslResult<Vec<SaslDbEntry>> {
        let all = Self::list_entries(client).await?;
        let filtered: Vec<SaslDbEntry> = all
            .into_iter()
            .filter(|e| e.username == username && e.realm == realm)
            .collect();
        if filtered.is_empty() {
            return Err(CyrusSaslError::user_not_found(username, realm));
        }
        Ok(filtered)
    }

    /// Set a user's password in the sasldb.
    pub async fn set_password(
        client: &CyrusSaslClient,
        username: &str,
        realm: &str,
        password: &str,
    ) -> CyrusSaslResult<()> {
        let mut cmd = format!(
            "echo {} | sudo {} -p -u {}",
            shell_escape(password),
            client.saslpasswd_bin(),
            shell_escape(username)
        );
        if !realm.is_empty() {
            cmd.push_str(&format!(" -r {}", shell_escape(realm)));
        }

        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(CyrusSaslError::process_error(format!(
                "Failed to set password for {}@{}: {}",
                username, realm, out.stderr
            )));
        }
        Ok(())
    }

    /// Delete a user entry from the sasldb.
    pub async fn delete_entry(
        client: &CyrusSaslClient,
        username: &str,
        realm: &str,
    ) -> CyrusSaslResult<()> {
        let mut cmd = format!(
            "sudo {} -d -u {}",
            client.saslpasswd_bin(),
            shell_escape(username)
        );
        if !realm.is_empty() {
            cmd.push_str(&format!(" -r {}", shell_escape(realm)));
        }

        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(CyrusSaslError::process_error(format!(
                "Failed to delete entry {}@{}: {}",
                username, realm, out.stderr
            )));
        }
        Ok(())
    }

    /// Dump the entire sasldb as raw text output.
    pub async fn dump(client: &CyrusSaslClient) -> CyrusSaslResult<String> {
        let out = client
            .exec_ssh(&format!(
                "sudo {} 2>/dev/null",
                client.sasldblistusers_bin()
            ))
            .await?;
        Ok(out.stdout)
    }

    /// Import sasldb data from a text dump.
    /// Each line should be in the format: username password [realm]
    pub async fn import(client: &CyrusSaslClient, data: &str) -> CyrusSaslResult<()> {
        let mut errors = Vec::new();

        for line in data.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }

            let parts: Vec<&str> = trimmed.split_whitespace().collect();
            if parts.len() < 2 {
                errors.push(format!(
                    "Invalid line (need username password [realm]): {}",
                    trimmed
                ));
                continue;
            }

            let username = parts[0];
            let password = parts[1];
            let realm = if parts.len() > 2 { parts[2] } else { "" };

            let mut cmd = format!(
                "echo {} | sudo {} -p -c -u {}",
                shell_escape(password),
                client.saslpasswd_bin(),
                shell_escape(username)
            );
            if !realm.is_empty() {
                cmd.push_str(&format!(" -r {}", shell_escape(realm)));
            }

            match client.exec_ssh(&cmd).await {
                Ok(out) if out.exit_code != 0 => {
                    errors.push(format!("Failed to import {}: {}", username, out.stderr));
                }
                Err(e) => {
                    errors.push(format!("Failed to import {}: {}", username, e));
                }
                _ => {}
            }
        }

        if !errors.is_empty() {
            return Err(CyrusSaslError::process_error(format!(
                "Import completed with errors:\n{}",
                errors.join("\n")
            )));
        }

        Ok(())
    }
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

fn parse_db_entries(raw: &str) -> Vec<SaslDbEntry> {
    let mut entries = Vec::new();

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // sasldblistusers2 output format:
        //   user@realm: userPassword
        //   user@realm: cmusaslsecretOTP
        //   user@realm: cmusaslsecretDIGEST-MD5
        if let Some(colon_pos) = trimmed.find(':') {
            let user_part = trimmed[..colon_pos].trim();
            let property = trimmed[colon_pos + 1..].trim().to_string();

            let (username, realm) = if let Some(at_pos) = user_part.find('@') {
                (
                    user_part[..at_pos].to_string(),
                    user_part[at_pos + 1..].to_string(),
                )
            } else {
                (user_part.to_string(), String::new())
            };

            entries.push(SaslDbEntry {
                username,
                realm,
                property: property.clone(),
                value: property,
            });
        }
    }

    entries
}
