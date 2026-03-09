// ── amavis config management ─────────────────────────────────────────────────

use crate::client::{shell_escape, AmavisClient};
use crate::error::{AmavisError, AmavisResult};
use crate::types::*;

/// Default path for the main amavisd.conf configuration file.
const DEFAULT_CONFIG_PATH: &str = "/etc/amavis/conf.d/50-user";
const DEFAULT_MAIN_CONFIG: &str = "/etc/amavisd/amavisd.conf";
const SNIPPETS_DIR: &str = "/etc/amavis/conf.d";

pub struct AmavisConfigManager;

impl AmavisConfigManager {
    /// Retrieve the main amavisd.conf configuration, parsing key directives.
    pub async fn get_main_config(client: &AmavisClient) -> AmavisResult<AmavisMainConfig> {
        // Try several common paths
        let paths = [
            DEFAULT_MAIN_CONFIG,
            "/etc/amavisd.conf",
            DEFAULT_CONFIG_PATH,
        ];
        let mut config_path = DEFAULT_MAIN_CONFIG.to_string();
        let mut content = String::new();
        for path in &paths {
            match client.read_file(path).await {
                Ok(c) => {
                    config_path = path.to_string();
                    content = c;
                    break;
                }
                Err(_) => continue,
            }
        }
        if content.is_empty() {
            return Err(AmavisError::config("Could not find amavisd.conf"));
        }

        Ok(AmavisMainConfig {
            config_file_path: config_path,
            daemon_user: extract_perl_var(&content, "$daemon_user"),
            daemon_group: extract_perl_var(&content, "$daemon_group"),
            max_servers: extract_perl_var(&content, "$max_servers")
                .and_then(|v| v.parse::<u32>().ok()),
            child_timeout: extract_perl_var(&content, "$child_timeout")
                .and_then(|v| v.parse::<u32>().ok()),
            log_level: extract_perl_var(&content, "$log_level").and_then(|v| v.parse::<u32>().ok()),
            syslog_facility: extract_perl_var(&content, "$syslog_facility"),
            myhostname: extract_perl_var(&content, "$myhostname"),
            mydomain: extract_perl_var(&content, "$mydomain"),
            virus_admin: extract_perl_var(&content, "$virus_admin"),
            spam_admin: extract_perl_var(&content, "$spam_admin"),
            sa_tag_level_deflt: extract_perl_var(&content, "$sa_tag_level_deflt")
                .and_then(|v| v.parse::<f64>().ok()),
            sa_tag2_level_deflt: extract_perl_var(&content, "$sa_tag2_level_deflt")
                .and_then(|v| v.parse::<f64>().ok()),
            sa_kill_level_deflt: extract_perl_var(&content, "$sa_kill_level_deflt")
                .and_then(|v| v.parse::<f64>().ok()),
            sa_dsn_cutoff_level: extract_perl_var(&content, "$sa_dsn_cutoff_level")
                .and_then(|v| v.parse::<f64>().ok()),
            final_virus_destiny: extract_perl_var(&content, "$final_virus_destiny"),
            final_banned_destiny: extract_perl_var(&content, "$final_banned_destiny"),
            final_spam_destiny: extract_perl_var(&content, "$final_spam_destiny"),
            final_bad_header_destiny: extract_perl_var(&content, "$final_bad_header_destiny"),
        })
    }

    /// Update the main configuration by writing key-value pairs back.
    pub async fn update_main_config(
        client: &AmavisClient,
        config: &AmavisMainConfig,
    ) -> AmavisResult<()> {
        let mut content = client.read_file(&config.config_file_path).await?;

        if let Some(ref v) = config.daemon_user {
            content = set_perl_var(&content, "$daemon_user", v);
        }
        if let Some(ref v) = config.daemon_group {
            content = set_perl_var(&content, "$daemon_group", v);
        }
        if let Some(v) = config.max_servers {
            content = set_perl_var(&content, "$max_servers", &v.to_string());
        }
        if let Some(v) = config.child_timeout {
            content = set_perl_var(&content, "$child_timeout", &v.to_string());
        }
        if let Some(v) = config.log_level {
            content = set_perl_var(&content, "$log_level", &v.to_string());
        }
        if let Some(ref v) = config.syslog_facility {
            content = set_perl_var(&content, "$syslog_facility", v);
        }
        if let Some(ref v) = config.myhostname {
            content = set_perl_var(&content, "$myhostname", v);
        }
        if let Some(ref v) = config.mydomain {
            content = set_perl_var(&content, "$mydomain", v);
        }
        if let Some(ref v) = config.virus_admin {
            content = set_perl_var(&content, "$virus_admin", v);
        }
        if let Some(ref v) = config.spam_admin {
            content = set_perl_var(&content, "$spam_admin", v);
        }
        if let Some(v) = config.sa_tag_level_deflt {
            content = set_perl_var(&content, "$sa_tag_level_deflt", &v.to_string());
        }
        if let Some(v) = config.sa_tag2_level_deflt {
            content = set_perl_var(&content, "$sa_tag2_level_deflt", &v.to_string());
        }
        if let Some(v) = config.sa_kill_level_deflt {
            content = set_perl_var(&content, "$sa_kill_level_deflt", &v.to_string());
        }
        if let Some(v) = config.sa_dsn_cutoff_level {
            content = set_perl_var(&content, "$sa_dsn_cutoff_level", &v.to_string());
        }
        if let Some(ref v) = config.final_virus_destiny {
            content = set_perl_var(&content, "$final_virus_destiny", v);
        }
        if let Some(ref v) = config.final_banned_destiny {
            content = set_perl_var(&content, "$final_banned_destiny", v);
        }
        if let Some(ref v) = config.final_spam_destiny {
            content = set_perl_var(&content, "$final_spam_destiny", v);
        }
        if let Some(ref v) = config.final_bad_header_destiny {
            content = set_perl_var(&content, "$final_bad_header_destiny", v);
        }

        client.write_file(&config.config_file_path, &content).await
    }

    /// List configuration snippets in /etc/amavis/conf.d/.
    pub async fn list_snippets(client: &AmavisClient) -> AmavisResult<Vec<AmavisConfigSnippet>> {
        let out = client
            .ssh_exec(&format!(
                "ls -1 {} 2>/dev/null || echo ''",
                shell_escape(SNIPPETS_DIR)
            ))
            .await?;
        let mut snippets = Vec::new();
        for line in out.stdout.lines() {
            let name = line.trim().to_string();
            if name.is_empty() {
                continue;
            }
            let path = format!("{}/{}", SNIPPETS_DIR, name);
            let content = client.read_file(&path).await.unwrap_or_default();
            let enabled = !name.starts_with('.');
            snippets.push(AmavisConfigSnippet {
                name,
                path,
                content,
                enabled,
            });
        }
        Ok(snippets)
    }

    /// Get a single snippet by name.
    pub async fn get_snippet(
        client: &AmavisClient,
        name: &str,
    ) -> AmavisResult<AmavisConfigSnippet> {
        let path = format!("{}/{}", SNIPPETS_DIR, name);
        let content = client
            .read_file(&path)
            .await
            .map_err(|_| AmavisError::not_found(format!("Snippet not found: {}", name)))?;
        let enabled = !name.starts_with('.');
        Ok(AmavisConfigSnippet {
            name: name.to_string(),
            path,
            content,
            enabled,
        })
    }

    /// Create a new configuration snippet.
    pub async fn create_snippet(
        client: &AmavisClient,
        name: &str,
        content: &str,
    ) -> AmavisResult<AmavisConfigSnippet> {
        let path = format!("{}/{}", SNIPPETS_DIR, name);
        if client.file_exists(&path).await.unwrap_or(false) {
            return Err(AmavisError::config(format!(
                "Snippet already exists: {}",
                name
            )));
        }
        client.write_file(&path, content).await?;
        Ok(AmavisConfigSnippet {
            name: name.to_string(),
            path,
            content: content.to_string(),
            enabled: !name.starts_with('.'),
        })
    }

    /// Update an existing snippet's content.
    pub async fn update_snippet(
        client: &AmavisClient,
        name: &str,
        content: &str,
    ) -> AmavisResult<AmavisConfigSnippet> {
        let path = format!("{}/{}", SNIPPETS_DIR, name);
        if !client.file_exists(&path).await.unwrap_or(false) {
            return Err(AmavisError::not_found(format!(
                "Snippet not found: {}",
                name
            )));
        }
        client.write_file(&path, content).await?;
        Ok(AmavisConfigSnippet {
            name: name.to_string(),
            path,
            content: content.to_string(),
            enabled: !name.starts_with('.'),
        })
    }

    /// Delete a snippet.
    pub async fn delete_snippet(client: &AmavisClient, name: &str) -> AmavisResult<()> {
        let path = format!("{}/{}", SNIPPETS_DIR, name);
        let out = client
            .ssh_exec(&format!("sudo rm -f {}", shell_escape(&path)))
            .await?;
        if out.exit_code != 0 {
            return Err(AmavisError::command(format!(
                "Failed to delete snippet {}: {}",
                name, out.stderr
            )));
        }
        Ok(())
    }

    /// Enable a disabled snippet (remove leading dot).
    pub async fn enable_snippet(client: &AmavisClient, name: &str) -> AmavisResult<()> {
        if !name.starts_with('.') {
            return Ok(()); // already enabled
        }
        let old_path = format!("{}/{}", SNIPPETS_DIR, name);
        let new_name = &name[1..];
        let new_path = format!("{}/{}", SNIPPETS_DIR, new_name);
        let out = client
            .ssh_exec(&format!(
                "sudo mv {} {}",
                shell_escape(&old_path),
                shell_escape(&new_path)
            ))
            .await?;
        if out.exit_code != 0 {
            return Err(AmavisError::command(format!(
                "Failed to enable snippet: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    /// Disable a snippet (prepend a dot to the filename).
    pub async fn disable_snippet(client: &AmavisClient, name: &str) -> AmavisResult<()> {
        if name.starts_with('.') {
            return Ok(()); // already disabled
        }
        let old_path = format!("{}/{}", SNIPPETS_DIR, name);
        let new_name = format!(".{}", name);
        let new_path = format!("{}/{}", SNIPPETS_DIR, new_name);
        let out = client
            .ssh_exec(&format!(
                "sudo mv {} {}",
                shell_escape(&old_path),
                shell_escape(&new_path)
            ))
            .await?;
        if out.exit_code != 0 {
            return Err(AmavisError::command(format!(
                "Failed to disable snippet: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    /// Test the amavis configuration for syntax errors.
    pub async fn test_config(client: &AmavisClient) -> AmavisResult<String> {
        let out = client
            .ssh_exec("amavisd-new -c /etc/amavisd/amavisd.conf debug-sa 2>&1 | head -5; amavisd-new configtest 2>&1 || amavisd configtest 2>&1")
            .await?;
        if out.exit_code != 0 && !out.stdout.contains("no error") {
            return Err(AmavisError::config(format!(
                "Config test failed: {}",
                out.stdout
            )));
        }
        Ok(out.stdout)
    }
}

// ── Perl config parsing helpers ──────────────────────────────────────────────

/// Extract a Perl scalar variable value from amavisd config content.
/// Matches patterns like: `$var_name = 'value';` or `$var_name = value;`
fn extract_perl_var(content: &str, var_name: &str) -> Option<String> {
    let escaped = var_name.replace('$', "\\$");
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') {
            continue;
        }
        // Check if this line sets the variable
        let pattern = escaped.to_string();
        if let Some(pos) = trimmed.find(&pattern.replace("\\$", "$")) {
            let after = &trimmed[pos + var_name.len()..];
            let after = after.trim();
            if !after.starts_with('=') {
                continue;
            }
            let value_part = after[1..].trim();
            // Remove trailing semicolon
            let value_part = value_part.trim_end_matches(';').trim();
            // Remove surrounding quotes
            let value = if (value_part.starts_with('\'') && value_part.ends_with('\''))
                || (value_part.starts_with('"') && value_part.ends_with('"'))
            {
                value_part[1..value_part.len() - 1].to_string()
            } else {
                value_part.to_string()
            };
            return Some(value);
        }
    }
    None
}

/// Set or update a Perl scalar variable in config content.
fn set_perl_var(content: &str, var_name: &str, value: &str) -> String {
    let mut found = false;
    let mut result = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with('#') && trimmed.contains(var_name) && trimmed.contains('=') {
            // Determine if the value is numeric
            let is_numeric = value.parse::<f64>().is_ok();
            let formatted = if is_numeric {
                format!("{} = {};", var_name, value)
            } else {
                format!("{} = '{}';", var_name, value.replace('\'', "\\'"))
            };
            result.push(formatted);
            found = true;
        } else {
            result.push(line.to_string());
        }
    }
    if !found {
        let is_numeric = value.parse::<f64>().is_ok();
        let line = if is_numeric {
            format!("{} = {};", var_name, value)
        } else {
            format!("{} = '{}';", var_name, value.replace('\'', "\\'"))
        };
        result.push(line);
    }
    result.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_perl_var_quoted() {
        let content = "$myhostname = 'mail.example.com';";
        assert_eq!(
            extract_perl_var(content, "$myhostname"),
            Some("mail.example.com".to_string())
        );
    }

    #[test]
    fn test_extract_perl_var_numeric() {
        let content = "$max_servers = 4;";
        assert_eq!(
            extract_perl_var(content, "$max_servers"),
            Some("4".to_string())
        );
    }

    #[test]
    fn test_extract_perl_var_float() {
        let content = "$sa_kill_level_deflt = 6.9;";
        assert_eq!(
            extract_perl_var(content, "$sa_kill_level_deflt"),
            Some("6.9".to_string())
        );
    }

    #[test]
    fn test_extract_perl_var_comment_skipped() {
        let content = "# $myhostname = 'old.example.com';\n$myhostname = 'new.example.com';";
        assert_eq!(
            extract_perl_var(content, "$myhostname"),
            Some("new.example.com".to_string())
        );
    }

    #[test]
    fn test_set_perl_var_existing() {
        let content = "$max_servers = 4;";
        let result = set_perl_var(content, "$max_servers", "8");
        assert!(result.contains("$max_servers = 8;"));
    }

    #[test]
    fn test_set_perl_var_new() {
        let content = "$max_servers = 4;";
        let result = set_perl_var(content, "$myhostname", "mail.example.com");
        assert!(result.contains("$myhostname = 'mail.example.com';"));
    }
}
