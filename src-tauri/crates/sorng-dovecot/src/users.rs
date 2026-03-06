// ── dovecot user management ──────────────────────────────────────────────────

use crate::client::{shell_escape, DovecotClient};
use crate::error::{DovecotError, DovecotResult};
use crate::types::*;
use std::collections::HashMap;

pub struct UserManager;

impl UserManager {
    /// List all users via `doveadm user '*'`.
    pub async fn list(client: &DovecotClient) -> DovecotResult<Vec<DovecotUser>> {
        let out = client.doveadm("user '*'").await?;
        let mut users = Vec::new();
        for line in out.stdout.lines() {
            let username = line.trim();
            if username.is_empty() {
                continue;
            }
            let user = Self::get(client, username).await.unwrap_or_else(|_| DovecotUser {
                username: username.to_string(),
                uid: None,
                gid: None,
                home: None,
                mail_location: None,
                quota_rule: None,
                password_hash: None,
                extra_fields: HashMap::new(),
            });
            users.push(user);
        }
        Ok(users)
    }

    /// Get user info via `doveadm user`.
    pub async fn get(client: &DovecotClient, username: &str) -> DovecotResult<DovecotUser> {
        let out = client
            .doveadm(&format!("user {}", shell_escape(username)))
            .await?;
        if out.exit_code != 0 {
            return Err(DovecotError::user_not_found(username));
        }
        let mut uid = None;
        let mut gid = None;
        let mut home = None;
        let mut mail_location = None;
        let mut quota_rule = None;
        let mut extra_fields = HashMap::new();

        for line in out.stdout.lines() {
            let line = line.trim();
            if let Some((key, value)) = line.split_once(':') {
                let key = key.trim();
                let value = value.trim().to_string();
                match key {
                    "uid" => uid = value.parse().ok(),
                    "gid" => gid = value.parse().ok(),
                    "home" => home = Some(value),
                    "mail" => mail_location = Some(value),
                    "quota_rule" => quota_rule = Some(value),
                    _ => {
                        extra_fields.insert(key.to_string(), value);
                    }
                }
            }
        }

        Ok(DovecotUser {
            username: username.to_string(),
            uid,
            gid,
            home,
            mail_location,
            quota_rule,
            password_hash: None,
            extra_fields,
        })
    }

    /// Create a new user via passwd-file manipulation.
    pub async fn create(
        client: &DovecotClient,
        req: &CreateUserRequest,
    ) -> DovecotResult<DovecotUser> {
        // Build passwd-file entry: user:{password}:uid:gid::home:extra_fields
        let password_hash = req.password.as_deref().unwrap_or("{PLAIN}changeme");
        let uid_str = req.uid.map(|u| u.to_string()).unwrap_or_default();
        let gid_str = req.gid.map(|g| g.to_string()).unwrap_or_default();
        let home_str = req.home.as_deref().unwrap_or("");
        let mut extra_parts = Vec::new();
        if let Some(ref ml) = req.mail_location {
            extra_parts.push(format!("userdb_mail={}", ml));
        }
        if let Some(ref qr) = req.quota_rule {
            extra_parts.push(format!("userdb_quota_rule={}", qr));
        }
        if let Some(ref ef) = req.extra_fields {
            for (k, v) in ef {
                extra_parts.push(format!("userdb_{}={}", k, v));
            }
        }

        let entry = format!(
            "{}:{}:{}:{}::{}:{}",
            req.username,
            password_hash,
            uid_str,
            gid_str,
            home_str,
            extra_parts.join(" ")
        );

        let passwd_file = format!("{}/users", client.config_dir());
        let cmd = format!(
            "echo {} | sudo tee -a {} > /dev/null",
            shell_escape(&entry),
            shell_escape(&passwd_file)
        );
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(DovecotError::internal(format!(
                "Failed to create user '{}': {}",
                req.username, out.stderr
            )));
        }

        Self::get(client, &req.username).await
    }

    /// Update an existing user's fields in the passwd file.
    pub async fn update(
        client: &DovecotClient,
        username: &str,
        req: &UpdateUserRequest,
    ) -> DovecotResult<DovecotUser> {
        // Read current user, delete, re-create with updated fields
        let current = Self::get(client, username).await?;

        let password_hash = req
            .password
            .as_deref()
            .unwrap_or(current.password_hash.as_deref().unwrap_or("{PLAIN}changeme"));
        let uid_str = req
            .uid
            .or(current.uid)
            .map(|u| u.to_string())
            .unwrap_or_default();
        let gid_str = req
            .gid
            .or(current.gid)
            .map(|g| g.to_string())
            .unwrap_or_default();
        let home_str = req
            .home
            .as_deref()
            .or(current.home.as_deref())
            .unwrap_or("");
        let mail_loc = req
            .mail_location
            .as_deref()
            .or(current.mail_location.as_deref());
        let quota = req
            .quota_rule
            .as_deref()
            .or(current.quota_rule.as_deref());

        let mut extra_parts = Vec::new();
        if let Some(ml) = mail_loc {
            extra_parts.push(format!("userdb_mail={}", ml));
        }
        if let Some(qr) = quota {
            extra_parts.push(format!("userdb_quota_rule={}", qr));
        }
        if let Some(ref ef) = req.extra_fields {
            for (k, v) in ef {
                extra_parts.push(format!("userdb_{}={}", k, v));
            }
        }

        let entry = format!(
            "{}:{}:{}:{}::{}:{}",
            username,
            password_hash,
            uid_str,
            gid_str,
            home_str,
            extra_parts.join(" ")
        );

        // Remove old entry and add new one
        let passwd_file = format!("{}/users", client.config_dir());
        let cmd = format!(
            "sudo sed -i '/^{}:/d' {} && echo {} | sudo tee -a {} > /dev/null",
            username,
            shell_escape(&passwd_file),
            shell_escape(&entry),
            shell_escape(&passwd_file)
        );
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(DovecotError::internal(format!(
                "Failed to update user '{}': {}",
                username, out.stderr
            )));
        }

        Self::get(client, username).await
    }

    /// Delete a user from the passwd file.
    pub async fn delete(client: &DovecotClient, username: &str) -> DovecotResult<()> {
        let passwd_file = format!("{}/users", client.config_dir());
        let cmd = format!(
            "sudo sed -i '/^{}:/d' {}",
            username,
            shell_escape(&passwd_file)
        );
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(DovecotError::user_not_found(username));
        }
        Ok(())
    }

    /// Test authentication for a user via `doveadm auth test`.
    pub async fn auth_test(
        client: &DovecotClient,
        username: &str,
        password: &str,
    ) -> DovecotResult<bool> {
        let out = client
            .doveadm(&format!(
                "auth test {} {}",
                shell_escape(username),
                shell_escape(password)
            ))
            .await?;
        Ok(out.exit_code == 0)
    }

    /// Kick a connected user via `doveadm kick`.
    pub async fn kick(client: &DovecotClient, username: &str) -> DovecotResult<()> {
        let out = client
            .doveadm(&format!("kick {}", shell_escape(username)))
            .await?;
        if out.exit_code != 0 {
            return Err(DovecotError::user_not_found(username));
        }
        Ok(())
    }

    /// List connected users/processes via `doveadm who`.
    pub async fn who(client: &DovecotClient) -> DovecotResult<Vec<DovecotProcess>> {
        let out = client.doveadm("who").await?;
        let mut processes = Vec::new();
        for line in out.stdout.lines().skip(1) {
            // Skip header line
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 4 {
                continue;
            }
            processes.push(DovecotProcess {
                pid: parts.get(2).and_then(|p| p.parse().ok()).unwrap_or(0),
                service: parts.get(1).unwrap_or(&"").to_string(),
                user: Some(parts.get(0).unwrap_or(&"").to_string()),
                ip: parts.get(3).map(|s| s.to_string()),
                state: None,
                uptime_secs: None,
            });
        }
        Ok(processes)
    }
}
