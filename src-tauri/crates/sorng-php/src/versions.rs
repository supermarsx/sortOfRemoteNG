// ── sorng-php – PHP version management ───────────────────────────────────────
//! Manages PHP version discovery, inspection, and switching on remote servers.

use crate::client::PhpClient;
use crate::error::{PhpError, PhpResult};
use crate::types::*;

pub struct VersionManager;

impl VersionManager {
    /// List all installed PHP versions by scanning `/usr/bin/php*` and parsing
    /// each binary's version output.
    pub async fn list(client: &PhpClient) -> PhpResult<Vec<PhpVersion>> {
        let cmd = "ls -1 /usr/bin/php[0-9]* 2>/dev/null | sort -V";
        let out = client.exec_ssh(cmd).await?;

        let default_version = Self::get_default(client).await.ok();

        let mut versions = Vec::new();
        for line in out.stdout.lines() {
            let binary = line.trim();
            if binary.is_empty() {
                continue;
            }

            let ver_cmd = format!("{} -v 2>/dev/null", binary);
            let ver_out = match client.exec_ssh(&ver_cmd).await {
                Ok(o) => o,
                Err(_) => continue,
            };

            if let Some(pv) = parse_version_output(&ver_out.stdout, binary) {
                let is_default = default_version
                    .as_ref()
                    .map(|d| d.version == pv.version)
                    .unwrap_or(false);

                let short = format!("{}.{}", pv.major, pv.minor);
                let sapis = Self::discover_sapis(client, &short).await;

                versions.push(PhpVersion {
                    is_default,
                    sapis,
                    ..pv
                });
            }
        }

        Ok(versions)
    }

    /// Get the default system PHP version (the one `php -v` resolves to).
    pub async fn get_default(client: &PhpClient) -> PhpResult<PhpVersion> {
        let bin = client.php_bin();
        let cmd = format!("{} -v 2>/dev/null", bin);
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(PhpError::command_failed(format!(
                "php -v exited with code {}",
                out.exit_code
            )));
        }

        let real_path_cmd = format!("readlink -f $(which {}) 2>/dev/null || which {}", bin, bin);
        let path_out = client.exec_ssh(&real_path_cmd).await?;
        let binary_path = path_out.stdout.trim().to_string();

        let mut pv = parse_version_output(&out.stdout, &binary_path)
            .ok_or_else(|| PhpError::parse("failed to parse default PHP version output"))?;
        pv.is_default = true;

        let short = format!("{}.{}", pv.major, pv.minor);
        pv.sapis = Self::discover_sapis(client, &short).await;

        Ok(pv)
    }

    /// Get detailed phpinfo for a specific PHP version.
    pub async fn get_detail(client: &PhpClient, version: &str) -> PhpResult<PhpVersionDetail> {
        Self::ensure_installed(client, version).await?;

        let cmd = format!("php{} -i 2>/dev/null", version);
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(PhpError::version_not_found(version));
        }

        let info = &out.stdout;

        let compiler = extract_phpinfo_value(info, "Compiler");
        let zend_version = extract_phpinfo_value(info, "Zend Engine");
        let architecture = extract_phpinfo_value(info, "System").map(|sys| {
            if sys.contains("x86_64") || sys.contains("amd64") {
                "x86_64".to_string()
            } else if sys.contains("aarch64") || sys.contains("arm64") {
                "aarch64".to_string()
            } else {
                sys
            }
        });
        let thread_safety = extract_phpinfo_value(info, "Thread Safety")
            .map(|v| v == "enabled")
            .unwrap_or(false);
        let debug_build = extract_phpinfo_value(info, "Debug Build")
            .map(|v| v == "yes")
            .unwrap_or(false);
        let ini_path = extract_phpinfo_value(info, "Loaded Configuration File");
        let scan_dir = extract_phpinfo_value(info, "Scan this dir for additional .ini files");
        let configure_options = extract_phpinfo_value(info, "Configure Command")
            .map(|c| {
                c.split('\'')
                    .filter(|s| s.starts_with("--"))
                    .map(|s| s.to_string())
                    .collect()
            })
            .unwrap_or_default();

        // Extensions
        let ext_cmd = format!("php{} -m 2>/dev/null", version);
        let ext_out = client.exec_ssh(&ext_cmd).await?;
        let (loaded_extensions, zend_extensions) = parse_module_list(&ext_out.stdout);

        let opcache_enabled = loaded_extensions
            .iter()
            .any(|e| e.eq_ignore_ascii_case("Zend OPcache"))
            || zend_extensions
                .iter()
                .any(|e| e.eq_ignore_ascii_case("Zend OPcache"));

        Ok(PhpVersionDetail {
            version: version.to_string(),
            compiler,
            zend_version,
            architecture,
            thread_safety,
            debug_build,
            opcache_enabled,
            loaded_extensions,
            ini_path,
            scan_dir,
            zend_extensions,
            configure_options,
        })
    }

    /// Set the default system PHP version via `update-alternatives`.
    pub async fn set_default(client: &PhpClient, version: &str) -> PhpResult<()> {
        Self::ensure_installed(client, version).await?;

        let cmd = format!("sudo update-alternatives --set php /usr/bin/php{}", version);
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(PhpError::command_failed(format!(
                "update-alternatives failed: {}",
                out.stderr.trim()
            )));
        }
        Ok(())
    }

    /// List available SAPIs for a specific PHP version.
    pub async fn list_sapis(client: &PhpClient, version: &str) -> PhpResult<Vec<PhpSapi>> {
        Self::ensure_installed(client, version).await?;

        let sapi_names = ["cli", "fpm", "cgi", "apache2"];
        let mut sapis = Vec::new();

        for sapi_name in &sapi_names {
            let (binary, check_cmd) = match *sapi_name {
                "cli" => (
                    format!("/usr/bin/php{}", version),
                    format!("test -f /usr/bin/php{} && echo yes || echo no", version),
                ),
                "fpm" => (
                    format!("/usr/sbin/php-fpm{}", version),
                    format!(
                        "test -f /usr/sbin/php-fpm{} && echo yes || echo no",
                        version
                    ),
                ),
                "cgi" => (
                    format!("/usr/bin/php-cgi{}", version),
                    format!("test -f /usr/bin/php-cgi{} && echo yes || echo no", version),
                ),
                "apache2" => (
                    format!("/usr/lib/apache2/modules/libphp{}.so", version),
                    format!(
                        "test -f /usr/lib/apache2/modules/libphp{}.so && echo yes || echo no",
                        version
                    ),
                ),
                _ => continue,
            };

            let check = client.exec_ssh(&check_cmd).await?;
            if check.stdout.trim() == "yes" {
                let config_file = Self::get_config_path(client, version, sapi_name).await.ok();
                sapis.push(PhpSapi {
                    name: sapi_name.to_string(),
                    version: version.to_string(),
                    binary_path: Some(binary),
                    config_file,
                });
            }
        }

        Ok(sapis)
    }

    /// Get the `php.ini` path for a specific version and SAPI.
    pub async fn get_config_path(
        client: &PhpClient,
        version: &str,
        sapi: &str,
    ) -> PhpResult<String> {
        let path = format!("{}/{}/{}/php.ini", client.config_dir(), version, sapi);
        let exists = client.file_exists(&path).await?;
        if exists {
            Ok(path)
        } else {
            Err(PhpError::config_not_found(&path))
        }
    }

    /// Get the extension directory path for a PHP version.
    pub async fn get_extension_dir(client: &PhpClient, version: &str) -> PhpResult<String> {
        Self::ensure_installed(client, version).await?;

        let cmd = format!(
            "php{} -r 'echo ini_get(\"extension_dir\");' 2>/dev/null",
            version
        );
        let out = client.exec_ssh(&cmd).await?;
        let dir = out.stdout.trim().to_string();
        if dir.is_empty() {
            return Err(PhpError::parse(format!(
                "could not determine extension dir for PHP {}",
                version
            )));
        }
        Ok(dir)
    }

    /// Check whether a specific PHP version is installed.
    pub async fn check_version_installed(client: &PhpClient, version: &str) -> PhpResult<bool> {
        let cmd = format!("test -f /usr/bin/php{} && echo yes || echo no", version);
        let out = client.exec_ssh(&cmd).await?;
        Ok(out.stdout.trim() == "yes")
    }

    // ── private helpers ──────────────────────────────────────────────

    async fn ensure_installed(client: &PhpClient, version: &str) -> PhpResult<()> {
        if !Self::check_version_installed(client, version).await? {
            return Err(PhpError::version_not_found(version));
        }
        Ok(())
    }

    async fn discover_sapis(client: &PhpClient, version: &str) -> Vec<String> {
        let mut sapis = Vec::new();
        let checks = [
            ("cli", format!("/usr/bin/php{}", version)),
            ("fpm", format!("/usr/sbin/php-fpm{}", version)),
            ("cgi", format!("/usr/bin/php-cgi{}", version)),
            (
                "apache2",
                format!("/usr/lib/apache2/modules/libphp{}.so", version),
            ),
        ];
        for (name, path) in &checks {
            let cmd = format!("test -f {} && echo yes || echo no", path);
            if let Ok(out) = client.exec_ssh(&cmd).await {
                if out.stdout.trim() == "yes" {
                    sapis.push(name.to_string());
                }
            }
        }
        sapis
    }
}

// ── Free-standing parsing helpers ────────────────────────────────────────────

fn parse_version_output(output: &str, binary_path: &str) -> Option<PhpVersion> {
    // Typical first line: "PHP 8.3.12 (cli) (built: ...)"
    let first = output.lines().next()?;
    let version_str = first.strip_prefix("PHP ")?.split_whitespace().next()?;

    let parts: Vec<&str> = version_str.split('.').collect();
    if parts.len() < 3 {
        return None;
    }
    let major: u32 = parts[0].parse().ok()?;
    let minor: u32 = parts[1].parse().ok()?;
    let patch: u32 = parts[2].split('-').next()?.parse().ok()?;

    Some(PhpVersion {
        version: format!("{}.{}.{}", major, minor, patch),
        major,
        minor,
        patch,
        sapis: Vec::new(),
        binary_path: binary_path.to_string(),
        config_file: None,
        extension_dir: None,
        is_default: false,
    })
}

fn extract_phpinfo_value(info: &str, key: &str) -> Option<String> {
    for line in info.lines() {
        if let Some(rest) = line.strip_prefix(key) {
            let rest = rest.trim_start();
            if let Some(value) = rest.strip_prefix("=>") {
                let value = value.trim();
                // phpinfo sometimes has "local => master" format; take the first value
                if let Some(local) = value.split("=>").next() {
                    let v = local.trim().to_string();
                    if !v.is_empty() && v != "no value" {
                        return Some(v);
                    }
                }
            }
        }
    }
    None
}

fn parse_module_list(output: &str) -> (Vec<String>, Vec<String>) {
    let mut extensions = Vec::new();
    let mut zend_extensions = Vec::new();
    let mut in_zend = false;

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed == "[Zend Modules]" {
            in_zend = true;
            continue;
        }
        if trimmed == "[PHP Modules]" {
            in_zend = false;
            continue;
        }
        if trimmed.starts_with('[') {
            continue;
        }
        if in_zend {
            zend_extensions.push(trimmed.to_string());
        } else {
            extensions.push(trimmed.to_string());
        }
    }

    (extensions, zend_extensions)
}
