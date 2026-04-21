// ── dovecot sieve script management ──────────────────────────────────────────

use crate::client::{shell_escape, DovecotClient};
use crate::error::{DovecotError, DovecotResult};
use crate::types::*;

pub struct SieveManager;

impl SieveManager {
    /// List all sieve scripts for a user via `doveadm sieve list`.
    pub async fn list(
        client: &DovecotClient,
        user: &str,
    ) -> DovecotResult<Vec<DovecotSieveScript>> {
        let out = client
            .doveadm(&format!("sieve list -u {}", shell_escape(user)))
            .await?;
        let mut scripts = Vec::new();
        for line in out.stdout.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let active = line.contains("ACTIVE");
            let name = line.split_whitespace().next().unwrap_or("").to_string();
            if name.is_empty() {
                continue;
            }
            scripts.push(DovecotSieveScript {
                name,
                active,
                content: None,
                size_bytes: None,
                last_modified: None,
            });
        }
        Ok(scripts)
    }

    /// Get a specific sieve script's content via `doveadm sieve get`.
    pub async fn get(
        client: &DovecotClient,
        user: &str,
        name: &str,
    ) -> DovecotResult<DovecotSieveScript> {
        let out = client
            .doveadm(&format!(
                "sieve get -u {} {}",
                shell_escape(user),
                shell_escape(name)
            ))
            .await?;
        if out.exit_code != 0 {
            return Err(DovecotError::sieve(format!("Script not found: {}", name)));
        }

        // Check if this script is active
        let list = Self::list(client, user).await?;
        let active = list.iter().any(|s| s.name == name && s.active);
        let content = out.stdout.clone();
        let size_bytes = content.len() as u64;

        Ok(DovecotSieveScript {
            name: name.to_string(),
            active,
            content: Some(content),
            size_bytes: Some(size_bytes),
            last_modified: None,
        })
    }

    /// Create a new sieve script via `doveadm sieve put`.
    pub async fn create(
        client: &DovecotClient,
        user: &str,
        req: &CreateSieveRequest,
    ) -> DovecotResult<DovecotSieveScript> {
        let escaped_content = req.content.replace('\'', "'\\''");
        let cmd = format!(
            "printf '%s' '{}' | {} sieve put -u {} {}",
            escaped_content,
            client.doveadm_bin(),
            shell_escape(user),
            shell_escape(&req.name)
        );
        let out = client.exec_ssh(&format!("sudo {}", cmd)).await?;
        if out.exit_code != 0 {
            return Err(DovecotError::sieve(format!(
                "Failed to create sieve script '{}': {}",
                req.name, out.stderr
            )));
        }

        if req.activate.unwrap_or(false) {
            Self::activate(client, user, &req.name).await?;
        }

        Self::get(client, user, &req.name).await
    }

    /// Update a sieve script's content via `doveadm sieve put`.
    pub async fn update(
        client: &DovecotClient,
        user: &str,
        name: &str,
        req: &UpdateSieveRequest,
    ) -> DovecotResult<DovecotSieveScript> {
        if let Some(ref content) = req.content {
            let escaped_content = content.replace('\'', "'\\''");
            let cmd = format!(
                "printf '%s' '{}' | {} sieve put -u {} {}",
                escaped_content,
                client.doveadm_bin(),
                shell_escape(user),
                shell_escape(name)
            );
            let out = client.exec_ssh(&format!("sudo {}", cmd)).await?;
            if out.exit_code != 0 {
                return Err(DovecotError::sieve(format!(
                    "Failed to update sieve script '{}': {}",
                    name, out.stderr
                )));
            }
        }

        if let Some(true) = req.activate {
            Self::activate(client, user, name).await?;
        }

        Self::get(client, user, name).await
    }

    /// Delete a sieve script via `doveadm sieve delete`.
    pub async fn delete(client: &DovecotClient, user: &str, name: &str) -> DovecotResult<()> {
        let out = client
            .doveadm(&format!(
                "sieve delete -u {} {}",
                shell_escape(user),
                shell_escape(name)
            ))
            .await?;
        if out.exit_code != 0 {
            return Err(DovecotError::sieve(format!(
                "Failed to delete sieve script '{}': {}",
                name, out.stderr
            )));
        }
        Ok(())
    }

    /// Activate a sieve script via `doveadm sieve activate`.
    pub async fn activate(client: &DovecotClient, user: &str, name: &str) -> DovecotResult<()> {
        let out = client
            .doveadm(&format!(
                "sieve activate -u {} {}",
                shell_escape(user),
                shell_escape(name)
            ))
            .await?;
        if out.exit_code != 0 {
            return Err(DovecotError::sieve(format!(
                "Failed to activate sieve script '{}': {}",
                name, out.stderr
            )));
        }
        Ok(())
    }

    /// Deactivate all sieve scripts for a user via `doveadm sieve deactivate`.
    pub async fn deactivate(client: &DovecotClient, user: &str) -> DovecotResult<()> {
        let out = client
            .doveadm(&format!("sieve deactivate -u {}", shell_escape(user)))
            .await?;
        if out.exit_code != 0 {
            return Err(DovecotError::sieve(format!(
                "Failed to deactivate sieve for '{}': {}",
                user, out.stderr
            )));
        }
        Ok(())
    }

    /// Compile/verify a sieve script via `sievec`.
    pub async fn compile(
        client: &DovecotClient,
        user: &str,
        name: &str,
    ) -> DovecotResult<ConfigTestResult> {
        // First get the script content, then compile with sievec
        let script = Self::get(client, user, name).await?;
        let content = script.content.unwrap_or_default();

        // Write to a temp file, compile, and check
        let tmp_path = format!("/tmp/dovecot_sieve_check_{}.sieve", name);
        client.write_remote_file(&tmp_path, &content).await?;

        let out = client
            .exec_ssh(&format!(
                "sievec {} 2>&1; echo EXIT:$?",
                shell_escape(&tmp_path)
            ))
            .await;

        // Clean up temp file
        let _ = client
            .exec_ssh(&format!(
                "rm -f {} {}.svbin",
                shell_escape(&tmp_path),
                shell_escape(&tmp_path)
            ))
            .await;

        match out {
            Ok(o) => {
                let success = o.stdout.contains("EXIT:0");
                let output = o
                    .stdout
                    .replace("EXIT:0", "")
                    .replace("EXIT:1", "")
                    .trim()
                    .to_string();
                let errors = if !success {
                    output.lines().map(|l| l.to_string()).collect()
                } else {
                    vec![]
                };
                Ok(ConfigTestResult {
                    success,
                    output,
                    errors,
                })
            }
            Err(_) => Ok(ConfigTestResult {
                success: false,
                output: String::new(),
                errors: vec!["Failed to execute sievec".into()],
            }),
        }
    }
}
