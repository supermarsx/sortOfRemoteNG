// ── sorng-php – PHP session management ───────────────────────────────────────
//! Query, configure, and clean up PHP sessions on a remote host.

use crate::client::{shell_escape, PhpClient};
use crate::error::{PhpError, PhpResult};
use crate::types::*;

/// Manages PHP sessions.
pub struct SessionManager;

impl SessionManager {
    /// Get session configuration from php.ini `session.*` directives.
    pub async fn get_config(client: &PhpClient, version: &str) -> PhpResult<PhpSessionConfig> {
        let php = client.versioned_php_bin(version)?;
        let cmd = format!(
            "{php} -r \"echo json_encode([\
                'save_handler' => ini_get('session.save_handler'),\
                'save_path' => ini_get('session.save_path'),\
                'name' => ini_get('session.name'),\
                'gc_maxlifetime' => (int)ini_get('session.gc_maxlifetime'),\
                'gc_probability' => (int)ini_get('session.gc_probability'),\
                'gc_divisor' => (int)ini_get('session.gc_divisor'),\
                'cookie_lifetime' => (int)ini_get('session.cookie_lifetime'),\
                'cookie_path' => ini_get('session.cookie_path'),\
                'cookie_domain' => ini_get('session.cookie_domain') ?: null,\
                'cookie_secure' => (bool)ini_get('session.cookie_secure'),\
                'cookie_httponly' => (bool)ini_get('session.cookie_httponly'),\
                'cookie_samesite' => ini_get('session.cookie_samesite') ?: null,\
                'use_strict_mode' => (bool)ini_get('session.use_strict_mode'),\
                'use_cookies' => (bool)ini_get('session.use_cookies'),\
                'use_only_cookies' => (bool)ini_get('session.use_only_cookies'),\
                'use_trans_sid' => (bool)ini_get('session.use_trans_sid'),\
                'sid_length' => (int)ini_get('session.sid_length') ?: null,\
                'sid_bits_per_character' => (int)ini_get('session.sid_bits_per_character') ?: null,\
                'lazy_write' => (bool)ini_get('session.lazy_write'),\
            ]);\""
        );
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(PhpError::command_failed(format!(
                "Failed to read session config: {}",
                out.stderr
            )));
        }
        serde_json::from_str(out.stdout.trim())
            .map_err(|e| PhpError::parse(format!("Failed to parse session config: {e}")))
    }

    /// Update session configuration directives in php.ini.
    pub async fn update_config(
        client: &PhpClient,
        req: &UpdateSessionConfigRequest,
    ) -> PhpResult<()> {
        let ini_path = format!("{}/{}/cli/php.ini", client.config_dir(), req.version);
        let mut content = client.read_remote_file(&ini_path).await?;

        fn set_directive(content: &mut String, key: &str, value: &str) {
            let directive = format!("session.{key}");
            let new_line = format!("{directive} = {value}");
            if let Some(pos) = content.find(&format!("{directive} ")) {
                if let Some(end) = content[pos..].find('\n') {
                    content.replace_range(pos..pos + end, &new_line);
                    return;
                }
            }
            if let Some(pos) = content.find(&format!(";{directive} ")) {
                if let Some(end) = content[pos..].find('\n') {
                    content.replace_range(pos..pos + end, &new_line);
                    return;
                }
            }
            content.push('\n');
            content.push_str(&new_line);
        }

        if let Some(ref v) = req.save_handler {
            set_directive(&mut content, "save_handler", v);
        }
        if let Some(ref v) = req.save_path {
            set_directive(&mut content, "save_path", v);
        }
        if let Some(v) = req.gc_maxlifetime {
            set_directive(&mut content, "gc_maxlifetime", &v.to_string());
        }
        if let Some(v) = req.gc_probability {
            set_directive(&mut content, "gc_probability", &v.to_string());
        }
        if let Some(v) = req.gc_divisor {
            set_directive(&mut content, "gc_divisor", &v.to_string());
        }
        if let Some(v) = req.cookie_lifetime {
            set_directive(&mut content, "cookie_lifetime", &v.to_string());
        }
        if let Some(v) = req.cookie_secure {
            set_directive(&mut content, "cookie_secure", if v { "1" } else { "0" });
        }
        if let Some(v) = req.cookie_httponly {
            set_directive(&mut content, "cookie_httponly", if v { "1" } else { "0" });
        }
        if let Some(ref v) = req.cookie_samesite {
            set_directive(&mut content, "cookie_samesite", v);
        }
        if let Some(v) = req.use_strict_mode {
            set_directive(&mut content, "use_strict_mode", if v { "1" } else { "0" });
        }
        if let Some(v) = req.sid_length {
            set_directive(&mut content, "sid_length", &v.to_string());
        }

        client.write_remote_file(&ini_path, &content).await
    }

    /// Get session statistics: count, total size, oldest/newest timestamps.
    pub async fn get_stats(client: &PhpClient, version: &str) -> PhpResult<SessionStats> {
        let save_path = Self::get_save_path(client, version).await?;
        let handler = {
            let cmd = format!(
                "{} -r \"echo ini_get('session.save_handler');\"",
                client.versioned_php_bin(version)?
            );
            let out = client.exec_ssh(&cmd).await?;
            out.stdout.trim().to_string()
        };

        let cmd = format!(
            "find {} -maxdepth 1 -name 'sess_*' -printf '%T@ %s\\n'",
            shell_escape(&save_path)
        );
        let out = client.exec_ssh(&cmd).await?;
        let mut lines: Vec<&str> = out.stdout.lines().filter(|l| !l.is_empty()).collect();
        lines.sort_unstable_by(|left, right| {
            left.split_whitespace()
                .next()
                .partial_cmp(&right.split_whitespace().next())
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        let mut total_size: u64 = 0;
        let mut oldest: Option<String> = None;
        let mut newest: Option<String> = None;

        for (i, line) in lines.iter().enumerate() {
            let mut parts = line.splitn(2, ' ');
            let ts = parts.next().ok_or_else(|| {
                PhpError::parse(format!("Malformed session statistics line: {line:?}"))
            })?;
            let size_text = parts.next().ok_or_else(|| {
                PhpError::parse(format!("Malformed session statistics line: {line:?}"))
            })?;
            let size: u64 = size_text.parse().map_err(|error| {
                PhpError::parse(format!(
                    "Invalid session size {size_text:?} in line {line:?}: {error}"
                ))
            })?;
            total_size += size;

            let epoch = ts.split('.').next().unwrap_or("0");
            if i == 0 {
                oldest = Some(epoch.to_string());
            }
            if i == lines.len() - 1 {
                newest = Some(epoch.to_string());
            }
        }

        Ok(SessionStats {
            save_path,
            handler,
            active_sessions: lines.len() as u64,
            total_size_bytes: total_size,
            oldest_session: oldest,
            newest_session: newest,
        })
    }

    /// Clean up expired session files. Returns the count of removed files.
    pub async fn cleanup_sessions(
        client: &PhpClient,
        version: &str,
        max_age_secs: Option<u64>,
    ) -> PhpResult<u64> {
        let save_path = Self::get_save_path(client, version).await?;
        let max_age = max_age_secs.unwrap_or({
            // Default to gc_maxlifetime (1440 seconds) when not specified.
            1440
        });
        let cmd = format!(
            "find {} -maxdepth 1 -name 'sess_*' -mmin +{} -delete -print",
            shell_escape(&save_path),
            max_age / 60
        );
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(PhpError::command_failed(format!(
                "Session cleanup failed: {}",
                out.stderr
            )));
        }
        let count = out.stdout.lines().filter(|line| !line.is_empty()).count() as u64;
        Ok(count)
    }

    /// List session files in the save_path directory.
    pub async fn list_session_files(client: &PhpClient, version: &str) -> PhpResult<Vec<String>> {
        let save_path = Self::get_save_path(client, version).await?;
        let cmd = format!(
            "find {} -maxdepth 1 -name 'sess_*' -printf '%f\\n'",
            shell_escape(&save_path)
        );
        let out = client.exec_ssh(&cmd).await?;
        Ok(out
            .stdout
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| l.to_string())
            .collect())
    }

    /// Get the session save path for a PHP version.
    pub async fn get_save_path(client: &PhpClient, version: &str) -> PhpResult<String> {
        let cmd = format!(
            "{} -r \"echo ini_get('session.save_path');\"",
            client.versioned_php_bin(version)?
        );
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(PhpError::command_failed(format!(
                "Failed to get session save_path: {}",
                out.stderr
            )));
        }
        let path = out.stdout.trim().to_string();
        if path.is_empty() {
            Ok("/tmp".to_string())
        } else {
            Ok(path)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::test_support::FakeSshTransport;
    use std::sync::Arc;

    #[tokio::test]
    async fn session_update_stops_when_existing_ini_cannot_be_read() {
        let fake = Arc::new(FakeSshTransport::new(vec![Err(
            "Command failed with exit code 1: read-only filesystem".into(),
        )]));
        let client = PhpClient::with_test_transport(
            PhpConnectionConfig {
                host: "php.example.test".into(),
                port: Some(22),
                ssh_user: Some("admin".into()),
                ssh_password: None,
                ssh_key: None,
                php_bin: None,
                fpm_bin: None,
                composer_bin: None,
                config_dir: Some("/etc/php".into()),
                fpm_pool_dir: None,
                timeout_secs: Some(5),
            },
            fake.clone(),
        );
        let request = UpdateSessionConfigRequest {
            version: "8.3".into(),
            save_handler: Some("files".into()),
            save_path: None,
            gc_maxlifetime: None,
            gc_probability: None,
            gc_divisor: None,
            cookie_lifetime: None,
            cookie_secure: None,
            cookie_httponly: None,
            cookie_samesite: None,
            use_strict_mode: None,
            sid_length: None,
        };

        let error = SessionManager::update_config(&client, &request)
            .await
            .unwrap_err();
        assert!(error.message.contains("read-only filesystem"));
        assert_eq!(fake.commands().len(), 1);
    }
}
