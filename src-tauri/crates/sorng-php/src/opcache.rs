// ── sorng-php – PHP OPcache management ───────────────────────────────────────
//! Query, reset, and configure PHP OPcache on a remote host.

use crate::client::PhpClient;
use crate::error::{PhpError, PhpResult};
use crate::types::*;

/// Manages PHP OPcache.
pub struct OpcacheManager;

impl OpcacheManager {
    /// Get OPcache status by running `opcache_get_status()` via CLI.
    pub async fn get_status(
        client: &PhpClient,
        version: &str,
    ) -> PhpResult<OpcacheStatus> {
        let cmd = format!(
            "{} -r \"echo json_encode(opcache_get_status());\"",
            client.versioned_php_bin(version)
        );
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(PhpError::command_failed(format!(
                "opcache_get_status failed: {}",
                out.stderr
            )));
        }
        let stdout = out.stdout.trim();
        if stdout == "false" || stdout.is_empty() {
            return Err(PhpError::opcache_not_enabled());
        }
        serde_json::from_str(stdout)
            .map_err(|e| PhpError::parse(format!("Failed to parse OPcache status: {e}")))
    }

    /// Get OPcache configuration via `opcache_get_configuration()`.
    pub async fn get_config(
        client: &PhpClient,
        version: &str,
    ) -> PhpResult<OpcacheConfig> {
        let cmd = format!(
            "{} -r \"echo json_encode(opcache_get_configuration());\"",
            client.versioned_php_bin(version)
        );
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(PhpError::command_failed(format!(
                "opcache_get_configuration failed: {}",
                out.stderr
            )));
        }
        let stdout = out.stdout.trim();
        if stdout == "false" || stdout.is_empty() {
            return Err(PhpError::opcache_not_enabled());
        }
        serde_json::from_str(stdout)
            .map_err(|e| PhpError::parse(format!("Failed to parse OPcache config: {e}")))
    }

    /// Reset OPcache by calling `opcache_reset()`.
    pub async fn reset(client: &PhpClient, version: &str) -> PhpResult<()> {
        let cmd = format!(
            "{} -r \"opcache_reset();\"",
            client.versioned_php_bin(version)
        );
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(PhpError::command_failed(format!(
                "opcache_reset failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    /// List all scripts cached by OPcache.
    pub async fn list_cached_scripts(
        client: &PhpClient,
        version: &str,
    ) -> PhpResult<Vec<CachedScript>> {
        let cmd = format!(
            "{} -r \"\\$s = opcache_get_status(true); echo json_encode(\\$s['scripts'] ?? []);\"",
            client.versioned_php_bin(version)
        );
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(PhpError::command_failed(format!(
                "list cached scripts failed: {}",
                out.stderr
            )));
        }
        let stdout = out.stdout.trim();
        if stdout == "false" || stdout.is_empty() {
            return Err(PhpError::opcache_not_enabled());
        }
        // OPcache returns scripts as an object keyed by path; normalise to vec.
        let raw: serde_json::Value = serde_json::from_str(stdout)
            .map_err(|e| PhpError::parse(format!("Failed to parse cached scripts: {e}")))?;
        let scripts: Vec<CachedScript> = match raw {
            serde_json::Value::Object(map) => map
                .values()
                .filter_map(|v| serde_json::from_value(v.clone()).ok())
                .collect(),
            serde_json::Value::Array(arr) => arr
                .into_iter()
                .filter_map(|v| serde_json::from_value(v).ok())
                .collect(),
            _ => Vec::new(),
        };
        Ok(scripts)
    }

    /// Invalidate a specific cached script.
    pub async fn invalidate_script(
        client: &PhpClient,
        version: &str,
        path: &str,
    ) -> PhpResult<()> {
        let escaped_path = path.replace('\'', "\\'");
        let cmd = format!(
            "{} -r \"opcache_invalidate('{}', true);\"",
            client.versioned_php_bin(version),
            escaped_path
        );
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(PhpError::command_failed(format!(
                "opcache_invalidate failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    /// Check whether OPcache is enabled for the given PHP version.
    pub async fn is_enabled(
        client: &PhpClient,
        version: &str,
    ) -> PhpResult<bool> {
        let cmd = format!(
            "{} -r \"echo opcache_get_status() === false ? 'no' : 'yes';\"",
            client.versioned_php_bin(version)
        );
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Ok(false);
        }
        Ok(out.stdout.trim() == "yes")
    }

    /// Update OPcache configuration by writing directives to opcache.ini.
    pub async fn update_config(
        client: &PhpClient,
        version: &str,
        config: &OpcacheConfig,
    ) -> PhpResult<()> {
        let ini_path = format!(
            "{}/{}/mods-available/opcache.ini",
            client.config_dir(),
            version
        );

        let mut directives = Vec::new();
        directives.push("zend_extension=opcache".to_string());
        if let Some(v) = config.enable {
            directives.push(format!("opcache.enable={}", if v { 1 } else { 0 }));
        }
        if let Some(v) = config.memory_consumption {
            directives.push(format!("opcache.memory_consumption={v}"));
        }
        if let Some(v) = config.interned_strings_buffer {
            directives.push(format!("opcache.interned_strings_buffer={v}"));
        }
        if let Some(v) = config.max_accelerated_files {
            directives.push(format!("opcache.max_accelerated_files={v}"));
        }
        if let Some(v) = config.validate_timestamps {
            directives.push(format!(
                "opcache.validate_timestamps={}",
                if v { 1 } else { 0 }
            ));
        }
        if let Some(v) = config.revalidate_freq {
            directives.push(format!("opcache.revalidate_freq={v}"));
        }
        if let Some(v) = config.save_comments {
            directives.push(format!(
                "opcache.save_comments={}",
                if v { 1 } else { 0 }
            ));
        }
        if let Some(v) = config.enable_file_override {
            directives.push(format!(
                "opcache.enable_file_override={}",
                if v { 1 } else { 0 }
            ));
        }
        if let Some(v) = config.max_file_size {
            directives.push(format!("opcache.max_file_size={v}"));
        }
        if let Some(v) = config.consistency_checks {
            directives.push(format!(
                "opcache.consistency_checks={}",
                if v { 1 } else { 0 }
            ));
        }
        if let Some(v) = config.force_restart_timeout {
            directives.push(format!("opcache.force_restart_timeout={v}"));
        }
        if let Some(v) = config.log_verbosity_level {
            directives.push(format!("opcache.log_verbosity_level={v}"));
        }
        if let Some(ref v) = config.preferred_memory_model {
            directives.push(format!("opcache.preferred_memory_model={v}"));
        }
        if let Some(ref v) = config.jit {
            directives.push(format!("opcache.jit={v}"));
        }
        if let Some(ref v) = config.jit_buffer_size {
            directives.push(format!("opcache.jit_buffer_size={v}"));
        }

        let content = directives.join("\n") + "\n";
        client.write_remote_file(&ini_path, &content).await?;
        Ok(())
    }
}
