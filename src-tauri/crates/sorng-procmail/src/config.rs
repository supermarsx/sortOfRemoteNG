// ── procmail config management ───────────────────────────────────────────────
//! High-level operations on the full procmailrc file: parse, validate,
//! backup, restore, and raw content access.

use crate::client::ProcmailClient;
use crate::error::ProcmailResult;
use crate::includes::IncludeManager;
use crate::recipes::RecipeManager;
use crate::types::*;
use crate::variables::VariableManager;

pub struct ProcmailConfigManager;

impl ProcmailConfigManager {
    /// Get the fully-parsed procmailrc as a `ProcmailConfig`.
    pub async fn get_full(client: &ProcmailClient, user: &str) -> ProcmailResult<ProcmailConfig> {
        let raw_content = client.get_procmailrc(user).await?;
        let recipes = RecipeManager::list(client, user).await?;
        let variables = VariableManager::list(client, user).await?;
        let includes = IncludeManager::list(client, user).await?;

        Ok(ProcmailConfig {
            recipes,
            variables,
            includes,
            raw_content,
        })
    }

    /// Overwrite the user's procmailrc with the provided `ProcmailConfig`.
    pub async fn set_full(
        client: &ProcmailClient,
        user: &str,
        config: &ProcmailConfig,
    ) -> ProcmailResult<()> {
        // Rebuild procmailrc from structured data
        let mut content = String::new();

        // Variables first
        for var in &config.variables {
            if let Some(ref comment) = var.comment {
                content.push_str(&format!("# {}\n", comment));
            }
            content.push_str(&format!("{}={}\n", var.name, var.value));
        }
        if !config.variables.is_empty() {
            content.push('\n');
        }

        // Includes next
        for inc in &config.includes {
            if let Some(ref comment) = inc.comment {
                content.push_str(&format!("# {}\n", comment));
            }
            if inc.enabled {
                content.push_str(&format!("INCLUDERC={}\n", inc.path));
            } else {
                content.push_str(&format!("#INCLUDERC={}\n", inc.path));
            }
        }
        if !config.includes.is_empty() {
            content.push('\n');
        }

        // Recipes
        for recipe in &config.recipes {
            content.push_str(&format!("# SORNG-ID: {}\n", recipe.id));
            content.push_str(&recipe.raw);
            if !recipe.raw.ends_with('\n') {
                content.push('\n');
            }
            content.push('\n');
        }

        client.write_procmailrc(user, &content).await
    }

    /// Create a backup of the user's procmailrc, returns the backup content.
    pub async fn backup(client: &ProcmailClient, user: &str) -> ProcmailResult<String> {
        let content = client.get_procmailrc(user).await?;
        let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
        let rc_path = if user.is_empty() {
            client.procmailrc_path().to_string()
        } else {
            client.user_rc_path(user)
        };
        let backup_path = format!("{}.bak.{}", rc_path, timestamp);
        client.write_remote_file(&backup_path, &content).await?;
        Ok(content)
    }

    /// Restore the user's procmailrc from backup content.
    pub async fn restore(
        client: &ProcmailClient,
        user: &str,
        backup_content: &str,
    ) -> ProcmailResult<()> {
        client.write_procmailrc(user, backup_content).await
    }

    /// Validate procmailrc content by running a dry-run via `procmail`.
    pub async fn validate(
        client: &ProcmailClient,
        user: &str,
        content: &str,
    ) -> ProcmailResult<RecipeTestResult> {
        // Write content to a temporary file and test it
        let tmp_path = "/tmp/.sorng-procmail-validate.rc";
        client.write_remote_file(tmp_path, content).await?;

        let cmd = format!(
            "echo 'From: test@test.com\nSubject: test\n\ntest' | VERBOSE=yes {} -m {} 2>&1; echo EXIT:$?",
            client.procmail_bin(),
            crate::client::shell_escape(tmp_path),
        );
        let out = client.exec_ssh(&cmd).await?;
        let log_output = format!("{}\n{}", out.stdout, out.stderr);

        // Clean up temp file
        let _ = client
            .exec_ssh(&format!("rm -f {}", crate::client::shell_escape(tmp_path)))
            .await;

        let success = !log_output.contains("Error") && !log_output.contains("syntax error");
        let _ = user; // validated for the user context

        Ok(RecipeTestResult {
            matched: success,
            matching_recipe_id: None,
            delivery_target: None,
            log_output,
        })
    }

    /// Get raw procmailrc content as a string.
    pub async fn get_raw(client: &ProcmailClient, user: &str) -> ProcmailResult<String> {
        client.get_procmailrc(user).await
    }

    /// Set raw procmailrc content from a string.
    pub async fn set_raw(client: &ProcmailClient, user: &str, content: &str) -> ProcmailResult<()> {
        client.write_procmailrc(user, content).await
    }
}
