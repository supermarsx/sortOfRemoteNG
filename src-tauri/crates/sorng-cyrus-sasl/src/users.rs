// ── Cyrus SASL user management ───────────────────────────────────────────────

use crate::client::{shell_escape, CyrusSaslClient};
use crate::error::{CyrusSaslError, CyrusSaslResult};
use crate::types::*;

pub struct SaslUserManager;

impl SaslUserManager {
    /// List all SASL users from the sasldb.
    pub async fn list(client: &CyrusSaslClient) -> CyrusSaslResult<Vec<SaslUser>> {
        let out = client
            .exec_ssh(&format!(
                "sudo {} 2>/dev/null",
                client.sasldblistusers_bin()
            ))
            .await?;

        let users = parse_user_list(&out.stdout);
        Ok(users)
    }

    /// Get a single user by username and realm.
    pub async fn get(
        client: &CyrusSaslClient,
        username: &str,
        realm: &str,
    ) -> CyrusSaslResult<SaslUser> {
        let all = Self::list(client).await?;
        all.into_iter()
            .find(|u| u.username == username && u.realm == realm)
            .ok_or_else(|| CyrusSaslError::user_not_found(username, realm))
    }

    /// Create a new SASL user.
    pub async fn create(
        client: &CyrusSaslClient,
        req: &CreateSaslUserRequest,
    ) -> CyrusSaslResult<()> {
        let realm = req.realm.as_deref().unwrap_or("");
        let mut cmd = format!(
            "echo {} | sudo {} -p -c -u {}",
            shell_escape(&req.password),
            client.saslpasswd_bin(),
            shell_escape(&req.username)
        );
        if !realm.is_empty() {
            cmd.push_str(&format!(" -r {}", shell_escape(realm)));
        }

        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(CyrusSaslError::process_error(format!(
                "Failed to create user {}: {}",
                req.username, out.stderr
            )));
        }
        Ok(())
    }

    /// Update an existing user's password.
    pub async fn update(
        client: &CyrusSaslClient,
        username: &str,
        realm: &str,
        req: &UpdateSaslUserRequest,
    ) -> CyrusSaslResult<()> {
        // Verify user exists
        Self::get(client, username, realm).await?;

        let mut cmd = format!(
            "echo {} | sudo {} -p -u {}",
            shell_escape(&req.password),
            client.saslpasswd_bin(),
            shell_escape(username)
        );
        if !realm.is_empty() {
            cmd.push_str(&format!(" -r {}", shell_escape(realm)));
        }

        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(CyrusSaslError::process_error(format!(
                "Failed to update user {}: {}",
                username, out.stderr
            )));
        }
        Ok(())
    }

    /// Delete a SASL user.
    pub async fn delete(
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
                "Failed to delete user {}: {}",
                username, out.stderr
            )));
        }
        Ok(())
    }

    /// Test authentication for a user using testsaslauthd.
    pub async fn test_auth(
        client: &CyrusSaslClient,
        username: &str,
        realm: &str,
        password: &str,
    ) -> CyrusSaslResult<SaslTestResult> {
        let mut cmd = format!(
            "testsaslauthd -u {} -p {}",
            shell_escape(username),
            shell_escape(password)
        );
        if !realm.is_empty() {
            cmd.push_str(&format!(" -r {}", shell_escape(realm)));
        }

        let out = client.exec_ssh(&cmd).await?;
        let success = out.exit_code == 0 && out.stdout.contains("OK");
        let message = if success {
            format!("Authentication succeeded for {}", username)
        } else {
            format!(
                "Authentication failed for {}: {}",
                username,
                out.stdout.trim()
            )
        };

        Ok(SaslTestResult {
            success,
            mechanism_used: Some("saslauthd".to_string()),
            message,
        })
    }

    /// List all unique realms from the sasldb.
    pub async fn list_realms(client: &CyrusSaslClient) -> CyrusSaslResult<Vec<String>> {
        let users = Self::list(client).await?;
        let mut realms: Vec<String> = users.into_iter().map(|u| u.realm).collect();
        realms.sort();
        realms.dedup();
        Ok(realms)
    }
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

fn parse_user_list(raw: &str) -> Vec<SaslUser> {
    // sasldblistusers2 output format:
    //   user@realm: userPassword
    //   user@realm: cmusaslsecretOTP
    let mut users = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Parse "user@realm: property"
        if let Some(colon_pos) = trimmed.find(':') {
            let user_part = trimmed[..colon_pos].trim();
            let property = trimmed[colon_pos + 1..].trim();

            let (username, realm) = if let Some(at_pos) = user_part.find('@') {
                (
                    user_part[..at_pos].to_string(),
                    user_part[at_pos + 1..].to_string(),
                )
            } else {
                (user_part.to_string(), String::new())
            };

            let key = format!("{}@{}", username, realm);
            let has_password = property.contains("userPassword");

            if seen.insert(key) {
                users.push(SaslUser {
                    username,
                    realm,
                    password_exists: has_password,
                });
            } else if has_password {
                // Update existing entry if we now see a password property
                if let Some(u) = users.iter_mut().find(|u| {
                    u.username == user_part.split('@').next().unwrap_or("")
                        && u.realm == user_part.split('@').nth(1).unwrap_or("")
                }) {
                    u.password_exists = true;
                }
            }
        }
    }

    users
}
