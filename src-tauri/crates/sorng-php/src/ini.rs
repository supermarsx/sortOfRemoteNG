// ── sorng-php – php.ini configuration management ─────────────────────────────
//! Read, parse, modify, back up, and validate php.ini files on a remote host.

use crate::client::{PhpClient, shell_escape};
use crate::error::{PhpError, PhpResult};
use crate::types::*;

/// Manages php.ini configuration files.
pub struct IniManager;

impl IniManager {
    /// Read and parse a php.ini file for the given version/SAPI.
    pub async fn get_ini_file(
        client: &PhpClient,
        version: &str,
        sapi: &str,
    ) -> PhpResult<PhpIniFile> {
        let path = ini_path(client.config_dir(), version, sapi);
        let raw_content = client.read_remote_file(&path).await.map_err(|_| {
            PhpError::config_not_found(&path)
        })?;
        let directives = parse_ini_content(&raw_content);
        Ok(PhpIniFile {
            path,
            sapi: sapi.to_string(),
            version: version.to_string(),
            directives,
            raw_content,
        })
    }

    /// List all directives for a version/SAPI.
    ///
    /// Attempts to run `php{version} -r "phpinfo(INFO_ALL);"` and parse the
    /// output. Falls back to reading the ini file directly.
    pub async fn list_directives(
        client: &PhpClient,
        version: &str,
        sapi: &str,
    ) -> PhpResult<Vec<PhpIniDirective>> {
        let cmd = format!(
            "{} -r {}",
            client.versioned_php_bin(version),
            shell_escape("phpinfo(INFO_ALL);")
        );
        match client.exec_ssh(&cmd).await {
            Ok(out) if out.exit_code == 0 && !out.stdout.is_empty() => {
                Ok(parse_phpinfo_directives(&out.stdout))
            }
            _ => {
                let ini = Self::get_ini_file(client, version, sapi).await?;
                Ok(ini.directives)
            }
        }
    }

    /// Get a single directive value.
    pub async fn get_directive(
        client: &PhpClient,
        version: &str,
        sapi: &str,
        key: &str,
    ) -> PhpResult<PhpIniDirective> {
        let directives = Self::list_directives(client, version, sapi).await?;
        directives
            .into_iter()
            .find(|d| d.key == key)
            .ok_or_else(|| PhpError::parse(format!("Directive not found: {key}")))
    }

    /// Set a directive in the appropriate ini file.
    ///
    /// If the directive already exists it is updated in-place; otherwise it is
    /// appended at the end of the file.
    pub async fn set_directive(
        client: &PhpClient,
        req: &SetIniDirectiveRequest,
    ) -> PhpResult<()> {
        let path = req
            .file_path
            .clone()
            .unwrap_or_else(|| ini_path(client.config_dir(), &req.version, &req.sapi));

        let content = client.read_remote_file(&path).await.unwrap_or_default();
        let new_line = format!("{} = {}", req.key, req.value);
        let mut found = false;
        let updated: Vec<String> = content
            .lines()
            .map(|line| {
                let trimmed = line.trim();
                if !trimmed.starts_with(';')
                    && !trimmed.starts_with('#')
                    && trimmed.split('=').next().map(|k| k.trim()) == Some(&req.key)
                {
                    found = true;
                    new_line.clone()
                } else {
                    line.to_string()
                }
            })
            .collect();

        let final_content = if found {
            updated.join("\n")
        } else {
            let mut c = content;
            if !c.ends_with('\n') && !c.is_empty() {
                c.push('\n');
            }
            c.push_str(&new_line);
            c.push('\n');
            c
        };

        client.write_remote_file(&path, &final_content).await
    }

    /// Comment out / remove a directive from the ini file.
    pub async fn remove_directive(
        client: &PhpClient,
        version: &str,
        sapi: &str,
        key: &str,
    ) -> PhpResult<()> {
        let path = ini_path(client.config_dir(), version, sapi);
        let content = client.read_remote_file(&path).await?;

        let updated: String = content
            .lines()
            .map(|line| {
                let trimmed = line.trim();
                if !trimmed.starts_with(';')
                    && !trimmed.starts_with('#')
                    && trimmed.split('=').next().map(|k| k.trim()) == Some(key)
                {
                    format!(";{}", line)
                } else {
                    line.to_string()
                }
            })
            .collect::<Vec<_>>()
            .join("\n");

        client.write_remote_file(&path, &updated).await
    }

    /// Get the additional .ini scan directory and list files in it.
    pub async fn get_scan_dir(
        client: &PhpClient,
        version: &str,
        sapi: &str,
    ) -> PhpResult<PhpIniScanDir> {
        let scan_path = format!("{}/{}/{}/conf.d", client.config_dir(), version, sapi);
        let files = client.list_dir(&scan_path).await.unwrap_or_default();
        Ok(PhpIniScanDir {
            path: scan_path,
            version: version.to_string(),
            sapi: sapi.to_string(),
            files,
        })
    }

    /// List all loaded ini files by parsing `php{version} --ini` output.
    pub async fn list_loaded_ini_files(
        client: &PhpClient,
        version: &str,
    ) -> PhpResult<Vec<String>> {
        let cmd = format!("{} --ini", client.versioned_php_bin(version));
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(PhpError::command_failed(format!(
                "php --ini failed: {}",
                out.stderr
            )));
        }
        let files: Vec<String> = out
            .stdout
            .lines()
            .filter_map(|line| {
                let trimmed = line.trim();
                if trimmed.starts_with('/') || trimmed.contains(".ini") {
                    // Lines like "/etc/php/8.3/cli/php.ini" or
                    // "/etc/php/8.3/cli/conf.d/10-opcache.ini,"
                    let cleaned = trimmed.trim_end_matches(',').trim().to_string();
                    if cleaned.ends_with(".ini") {
                        return Some(cleaned);
                    }
                }
                None
            })
            .collect();
        Ok(files)
    }

    /// Create a backup of the php.ini file.
    pub async fn backup_ini(
        client: &PhpClient,
        version: &str,
        sapi: &str,
    ) -> PhpResult<IniBackup> {
        let path = ini_path(client.config_dir(), version, sapi);
        let backup_path = client.backup_file(&path).await?;
        Ok(IniBackup {
            path: path.clone(),
            backup_path,
            timestamp: chrono::Utc::now().to_rfc3339(),
            version: version.to_string(),
            sapi: sapi.to_string(),
        })
    }

    /// Restore a php.ini from backup.
    pub async fn restore_ini(
        client: &PhpClient,
        backup_path: &str,
        target_path: &str,
    ) -> PhpResult<()> {
        let cmd = format!(
            "sudo cp {} {}",
            shell_escape(backup_path),
            shell_escape(target_path)
        );
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(PhpError::command_failed(format!(
                "Failed to restore ini: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    /// Validate PHP configuration by running `php{version} -t` and checking
    /// for errors.
    pub async fn validate_ini(client: &PhpClient, version: &str) -> PhpResult<bool> {
        let cmd = format!("{} -t 2>&1", client.versioned_php_bin(version));
        let out = client.exec_ssh(&cmd).await?;
        Ok(out.exit_code == 0 && !out.stdout.to_lowercase().contains("error"))
    }
}

// ── Helper functions ─────────────────────────────────────────────────────────

/// Parse raw ini file content into a list of directives.
fn parse_ini_content(content: &str) -> Vec<PhpIniDirective> {
    let mut directives = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with(';') || trimmed.starts_with('#') {
            continue;
        }
        // Section headers like [PHP]
        if trimmed.starts_with('[') {
            continue;
        }
        if let Some((key, value)) = trimmed.split_once('=') {
            directives.push(PhpIniDirective {
                key: key.trim().to_string(),
                local_value: value.trim().to_string(),
                master_value: None,
                access: None,
                source_file: None,
            });
        }
    }
    directives
}

/// Construct the standard php.ini path.
fn ini_path(config_dir: &str, version: &str, sapi: &str) -> String {
    format!("{}/{}/{}/php.ini", config_dir, version, sapi)
}

/// Parse `phpinfo(INFO_ALL)` output for directive key/value pairs.
fn parse_phpinfo_directives(output: &str) -> Vec<PhpIniDirective> {
    let mut directives = Vec::new();
    for line in output.lines() {
        // phpinfo tables often have "directive => local => master" format
        let parts: Vec<&str> = line.split("=>").collect();
        if parts.len() >= 2 {
            let key = parts[0].trim().to_string();
            let local_value = parts[1].trim().to_string();
            let master_value = parts.get(2).map(|v| v.trim().to_string());
            if !key.is_empty() && key != "Directive" {
                directives.push(PhpIniDirective {
                    key,
                    local_value,
                    master_value,
                    access: None,
                    source_file: None,
                });
            }
        }
    }
    directives
}
