// ── sorng-php – PHP module / extension management ────────────────────────────
//! Enable, disable, install, and query PHP modules and PECL packages on a
//! remote host.

use crate::client::{PhpClient, shell_escape};
use crate::error::{PhpError, PhpResult};
use crate::types::*;

/// Manages PHP modules and extensions.
pub struct ModuleManager;

impl ModuleManager {
    /// List all PHP modules by running `php{version} -m` and categorising
    /// each as core, dynamic, or Zend.
    pub async fn list_modules(
        client: &PhpClient,
        version: &str,
    ) -> PhpResult<Vec<PhpModule>> {
        let cmd = format!("{} -m", client.versioned_php_bin(version));
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(PhpError::command_failed(format!(
                "php -m failed: {}",
                out.stderr
            )));
        }

        let mut modules = Vec::new();
        let mut current_type = PhpModuleType::Dynamic;

        for line in out.stdout.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if trimmed.starts_with('[') && trimmed.ends_with(']') {
                let section = &trimmed[1..trimmed.len() - 1];
                current_type = match section {
                    "PHP Modules" => PhpModuleType::Dynamic,
                    "Zend Modules" => PhpModuleType::Zend,
                    _ => PhpModuleType::Builtin,
                };
                continue;
            }
            modules.push(PhpModule {
                name: trimmed.to_string(),
                version: None,
                module_type: current_type.clone(),
                enabled: true,
                ini_file: None,
                description: None,
                php_version: version.to_string(),
            });
        }
        Ok(modules)
    }

    /// Get info about a specific module.
    pub async fn get_module(
        client: &PhpClient,
        version: &str,
        name: &str,
    ) -> PhpResult<PhpModule> {
        let modules = Self::list_modules(client, version).await?;
        modules
            .into_iter()
            .find(|m| m.name.eq_ignore_ascii_case(name))
            .ok_or_else(|| PhpError::module_not_found(name))
    }

    /// Enable a module using `phpenmod` or by creating a symlink in the
    /// mods-available / conf.d directories.
    pub async fn enable_module(
        client: &PhpClient,
        req: &EnableModuleRequest,
    ) -> PhpResult<()> {
        let sapi_flag = req
            .sapi
            .as_deref()
            .map_or(String::new(), |s| format!(" -s {}", shell_escape(s)));

        let cmd = format!(
            "sudo phpenmod -v {}{} {}",
            shell_escape(&req.version),
            sapi_flag,
            shell_escape(&req.module_name)
        );
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(PhpError::command_failed(format!(
                "phpenmod failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    /// Disable a module using `phpdismod` or by removing the symlink.
    pub async fn disable_module(
        client: &PhpClient,
        req: &DisableModuleRequest,
    ) -> PhpResult<()> {
        let sapi_flag = req
            .sapi
            .as_deref()
            .map_or(String::new(), |s| format!(" -s {}", shell_escape(s)));

        let cmd = format!(
            "sudo phpdismod -v {}{} {}",
            shell_escape(&req.version),
            sapi_flag,
            shell_escape(&req.module_name)
        );
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(PhpError::command_failed(format!(
                "phpdismod failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    /// Install a PHP module via apt (`apt-get install php{version}-{module}`)
    /// or PECL, depending on the request's `method` field.
    pub async fn install_module(
        client: &PhpClient,
        req: &InstallModuleRequest,
    ) -> PhpResult<()> {
        let method = req.method.as_deref().unwrap_or("apt");
        let cmd = match method {
            "pecl" => format!("sudo pecl install {}", shell_escape(&req.module_name)),
            _ => format!(
                "sudo apt-get install -y {}",
                shell_escape(&format!("php{}-{}", req.version, req.module_name))
            ),
        };
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(PhpError::command_failed(format!(
                "Module install failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    /// Uninstall a module.
    pub async fn uninstall_module(
        client: &PhpClient,
        version: &str,
        module_name: &str,
    ) -> PhpResult<()> {
        let pkg = format!("php{}-{}", version, module_name);
        let cmd = format!("sudo apt-get remove -y {}", shell_escape(&pkg));
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(PhpError::command_failed(format!(
                "Module uninstall failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    /// Check if a module is currently loaded.
    pub async fn is_module_loaded(
        client: &PhpClient,
        version: &str,
        name: &str,
    ) -> PhpResult<bool> {
        let modules = Self::list_modules(client, version).await?;
        Ok(modules.iter().any(|m| m.name.eq_ignore_ascii_case(name)))
    }

    /// List available (installable) modules from the package manager.
    pub async fn list_available_modules(
        client: &PhpClient,
        version: &str,
    ) -> PhpResult<Vec<String>> {
        let cmd = format!(
            "apt-cache search {} | grep -i {} | awk '{{print $1}}'",
            shell_escape(&format!("php{}-", version)),
            shell_escape(&format!("^php{}-", version))
        );
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(PhpError::command_failed(format!(
                "Failed to list available modules: {}",
                out.stderr
            )));
        }
        Ok(out
            .stdout
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| l.to_string())
            .collect())
    }

    /// List installed PECL packages.
    pub async fn list_pecl_packages(client: &PhpClient) -> PhpResult<Vec<PeclPackage>> {
        let cmd = "pecl list 2>/dev/null";
        let out = client.exec_ssh(cmd).await?;
        if out.exit_code != 0 {
            return Err(PhpError::command_failed(format!(
                "pecl list failed: {}",
                out.stderr
            )));
        }

        let mut packages = Vec::new();
        for line in out.stdout.lines().skip(3) {
            // PECL list columns: Package  Version  State
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 {
                packages.push(PeclPackage {
                    name: parts[0].to_string(),
                    version: Some(parts[1].to_string()),
                    state: parts.get(2).map(|s| s.to_string()),
                    description: None,
                });
            }
        }
        Ok(packages)
    }

    /// Install a PECL package, optionally pinning a specific version.
    pub async fn install_pecl_package(
        client: &PhpClient,
        name: &str,
        version: Option<&str>,
    ) -> PhpResult<()> {
        let pkg = match version {
            Some(v) => format!("{}-{}", name, v),
            None => name.to_string(),
        };
        let cmd = format!("sudo pecl install {}", shell_escape(&pkg));
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(PhpError::command_failed(format!(
                "pecl install failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    /// Uninstall a PECL package.
    pub async fn uninstall_pecl_package(
        client: &PhpClient,
        name: &str,
    ) -> PhpResult<()> {
        let cmd = format!("sudo pecl uninstall {}", shell_escape(name));
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(PhpError::command_failed(format!(
                "pecl uninstall failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }
}
