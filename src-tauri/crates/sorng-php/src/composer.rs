// ── sorng-php – Composer (PHP dependency manager) ────────────────────────────

use crate::client::{shell_escape, PhpClient};
use crate::error::{PhpError, PhpResult};
use crate::types::*;

pub struct ComposerManager;

impl ComposerManager {
    /// Get Composer version and paths.
    pub async fn get_info(client: &PhpClient) -> PhpResult<ComposerInfo> {
        let ver_out = client
            .exec_ssh(&format!("{} --version 2>&1", client.composer_bin()))
            .await?;

        let version = ver_out
            .stdout
            .lines()
            .find(|l| l.contains("Composer"))
            .and_then(|l| {
                l.split_whitespace()
                    .find(|w| w.chars().next().is_some_and(|c| c.is_ascii_digit()))
            })
            .unwrap_or("unknown")
            .to_string();

        let home_out = client
            .exec_ssh(&format!(
                "{} config --global home 2>/dev/null || true",
                client.composer_bin()
            ))
            .await?;
        let home_dir = home_out.stdout.trim();
        let home_dir = if home_dir.is_empty() {
            None
        } else {
            Some(home_dir.to_string())
        };

        Ok(ComposerInfo {
            version,
            home_dir,
            cache_dir: None,
            global_dir: None,
            php_version: None,
        })
    }

    /// Check if Composer is installed on the remote host.
    pub async fn is_installed(client: &PhpClient) -> PhpResult<bool> {
        client.command_exists(client.composer_bin()).await
    }

    /// List globally installed Composer packages.
    pub async fn list_global_packages(client: &PhpClient) -> PhpResult<Vec<ComposerGlobalPackage>> {
        let cmd = format!(
            "{} global show --format=json 2>/dev/null",
            client.composer_bin()
        );
        let out = client.exec_ssh(&cmd).await?;

        if out.stdout.trim().is_empty() {
            return Ok(Vec::new());
        }

        let parsed: serde_json::Value = serde_json::from_str(out.stdout.trim())
            .map_err(|e| PhpError::parse(format!("Failed to parse composer global show: {e}")))?;

        let mut packages = Vec::new();
        if let Some(installed) = parsed.get("installed").and_then(|v| v.as_array()) {
            for pkg in installed {
                let name = pkg
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let version = pkg
                    .get("version")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let description = pkg
                    .get("description")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                packages.push(ComposerGlobalPackage {
                    name,
                    version,
                    description,
                });
            }
        }

        Ok(packages)
    }

    /// Install a global Composer package.
    pub async fn install_global_package(
        client: &PhpClient,
        package: &str,
        version: Option<&str>,
    ) -> PhpResult<ComposerRunResult> {
        let pkg_spec = match version {
            Some(v) => format!("{}:{}", package, v),
            None => package.to_string(),
        };
        let cmd = format!(
            "{} global require {} 2>&1",
            client.composer_bin(),
            shell_escape(&pkg_spec),
        );
        let out = client.exec_ssh(&cmd).await?;
        Ok(ComposerRunResult {
            success: out.exit_code == 0,
            stdout: out.stdout,
            stderr: out.stderr,
            exit_code: out.exit_code,
        })
    }

    /// Remove a globally installed Composer package.
    pub async fn remove_global_package(
        client: &PhpClient,
        package: &str,
    ) -> PhpResult<ComposerRunResult> {
        let cmd = format!(
            "{} global remove {} 2>&1",
            client.composer_bin(),
            shell_escape(package),
        );
        let out = client.exec_ssh(&cmd).await?;
        Ok(ComposerRunResult {
            success: out.exit_code == 0,
            stdout: out.stdout,
            stderr: out.stderr,
            exit_code: out.exit_code,
        })
    }

    /// Get Composer project info by reading composer.json and composer.lock.
    pub async fn get_project(client: &PhpClient, project_path: &str) -> PhpResult<ComposerProject> {
        let json_path = format!("{}/composer.json", project_path);
        let json_content = client.read_remote_file(&json_path).await.map_err(|_| {
            PhpError::composer(format!("composer.json not found at {}", project_path))
        })?;

        let parsed: serde_json::Value = serde_json::from_str(&json_content)
            .map_err(|e| PhpError::parse(format!("Failed to parse composer.json: {e}")))?;

        let name = parsed
            .get("name")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let description = parsed
            .get("description")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let php_requirement = parsed
            .get("require")
            .and_then(|r| r.get("php"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let stability = parsed
            .get("minimum-stability")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        // Try reading composer.lock for installed packages
        let lock_path = format!("{}/composer.lock", project_path);
        let lock_content = client.read_remote_file(&lock_path).await.ok();

        let mut packages = Vec::new();
        let mut dev_packages = Vec::new();
        let mut lock_hash = None;

        if let Some(lock_str) = &lock_content {
            if let Ok(lock_val) = serde_json::from_str::<serde_json::Value>(lock_str) {
                lock_hash = lock_val
                    .get("content-hash")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                if let Some(pkgs) = lock_val.get("packages").and_then(|v| v.as_array()) {
                    for pkg in pkgs {
                        packages.push(parse_composer_package(pkg));
                    }
                }
                if let Some(pkgs) = lock_val.get("packages-dev").and_then(|v| v.as_array()) {
                    for pkg in pkgs {
                        dev_packages.push(parse_composer_package(pkg));
                    }
                }
            }
        }

        Ok(ComposerProject {
            name,
            description,
            packages,
            dev_packages,
            php_requirement,
            stability,
            lock_hash,
        })
    }

    /// Run `composer install` in a project directory.
    pub async fn install(
        client: &PhpClient,
        req: &ComposerInstallRequest,
    ) -> PhpResult<ComposerRunResult> {
        let mut cmd = format!(
            "cd {} && {} install",
            shell_escape(&req.project_path),
            client.composer_bin(),
        );
        if req.no_dev {
            cmd.push_str(" --no-dev");
        }
        if req.optimize_autoloader {
            cmd.push_str(" --optimize-autoloader");
        }
        if req.no_scripts {
            cmd.push_str(" --no-scripts");
        }
        cmd.push_str(" --no-interaction 2>&1");

        let out = client.exec_ssh(&cmd).await?;
        Ok(ComposerRunResult {
            success: out.exit_code == 0,
            stdout: out.stdout,
            stderr: out.stderr,
            exit_code: out.exit_code,
        })
    }

    /// Run `composer update` with optional package list and flags.
    pub async fn update(
        client: &PhpClient,
        req: &ComposerUpdateRequest,
    ) -> PhpResult<ComposerRunResult> {
        let mut cmd = format!(
            "cd {} && {} update",
            shell_escape(&req.project_path),
            client.composer_bin(),
        );
        if let Some(ref pkgs) = req.packages {
            for pkg in pkgs {
                cmd.push(' ');
                cmd.push_str(&shell_escape(pkg));
            }
        }
        if req.no_dev {
            cmd.push_str(" --no-dev");
        }
        if req.with_dependencies {
            cmd.push_str(" --with-dependencies");
        }
        cmd.push_str(" --no-interaction 2>&1");

        let out = client.exec_ssh(&cmd).await?;
        Ok(ComposerRunResult {
            success: out.exit_code == 0,
            stdout: out.stdout,
            stderr: out.stderr,
            exit_code: out.exit_code,
        })
    }

    /// Run `composer require` to add a dependency.
    pub async fn require_package(
        client: &PhpClient,
        req: &RequirePackageRequest,
    ) -> PhpResult<ComposerRunResult> {
        let pkg_spec = match &req.version {
            Some(v) => format!("{}:{}", req.package, v),
            None => req.package.clone(),
        };
        let mut cmd = format!(
            "cd {} && {} require {}",
            shell_escape(&req.project_path),
            client.composer_bin(),
            shell_escape(&pkg_spec),
        );
        if req.dev {
            cmd.push_str(" --dev");
        }
        cmd.push_str(" --no-interaction 2>&1");

        let out = client.exec_ssh(&cmd).await?;
        Ok(ComposerRunResult {
            success: out.exit_code == 0,
            stdout: out.stdout,
            stderr: out.stderr,
            exit_code: out.exit_code,
        })
    }

    /// Run `composer remove` to remove a dependency.
    pub async fn remove_package(
        client: &PhpClient,
        req: &RemovePackageRequest,
    ) -> PhpResult<ComposerRunResult> {
        let mut cmd = format!(
            "cd {} && {} remove {}",
            shell_escape(&req.project_path),
            client.composer_bin(),
            shell_escape(&req.package),
        );
        if req.dev {
            cmd.push_str(" --dev");
        }
        cmd.push_str(" --no-interaction 2>&1");

        let out = client.exec_ssh(&cmd).await?;
        Ok(ComposerRunResult {
            success: out.exit_code == 0,
            stdout: out.stdout,
            stderr: out.stderr,
            exit_code: out.exit_code,
        })
    }

    /// Run `composer dump-autoload` with optional optimization.
    pub async fn dump_autoload(
        client: &PhpClient,
        project_path: &str,
        optimize: bool,
    ) -> PhpResult<ComposerRunResult> {
        let mut cmd = format!(
            "cd {} && {} dump-autoload",
            shell_escape(project_path),
            client.composer_bin(),
        );
        if optimize {
            cmd.push_str(" --optimize");
        }
        cmd.push_str(" 2>&1");

        let out = client.exec_ssh(&cmd).await?;
        Ok(ComposerRunResult {
            success: out.exit_code == 0,
            stdout: out.stdout,
            stderr: out.stderr,
            exit_code: out.exit_code,
        })
    }

    /// Run `composer validate` to check composer.json.
    pub async fn validate(client: &PhpClient, project_path: &str) -> PhpResult<ComposerRunResult> {
        let cmd = format!(
            "cd {} && {} validate 2>&1",
            shell_escape(project_path),
            client.composer_bin(),
        );
        let out = client.exec_ssh(&cmd).await?;
        Ok(ComposerRunResult {
            success: out.exit_code == 0,
            stdout: out.stdout,
            stderr: out.stderr,
            exit_code: out.exit_code,
        })
    }

    /// List outdated packages via `composer outdated --format=json`.
    pub async fn outdated(
        client: &PhpClient,
        project_path: &str,
    ) -> PhpResult<Vec<ComposerPackage>> {
        let cmd = format!(
            "cd {} && {} outdated --format=json 2>/dev/null",
            shell_escape(project_path),
            client.composer_bin(),
        );
        let out = client.exec_ssh(&cmd).await?;

        if out.stdout.trim().is_empty() {
            return Ok(Vec::new());
        }

        let parsed: serde_json::Value = serde_json::from_str(out.stdout.trim())
            .map_err(|e| PhpError::parse(format!("Failed to parse composer outdated: {e}")))?;

        let mut packages = Vec::new();
        if let Some(installed) = parsed.get("installed").and_then(|v| v.as_array()) {
            for pkg in installed {
                packages.push(parse_composer_package(pkg));
            }
        }

        Ok(packages)
    }

    /// Clear Composer cache.
    pub async fn clear_cache(client: &PhpClient) -> PhpResult<()> {
        let cmd = format!("{} clear-cache 2>&1", client.composer_bin());
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(PhpError::composer(format!(
                "Failed to clear cache: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    /// Update Composer itself via `composer self-update`.
    pub async fn self_update(client: &PhpClient) -> PhpResult<ComposerRunResult> {
        let cmd = format!("{} self-update 2>&1", client.composer_bin());
        let out = client.exec_ssh(&cmd).await?;
        Ok(ComposerRunResult {
            success: out.exit_code == 0,
            stdout: out.stdout,
            stderr: out.stderr,
            exit_code: out.exit_code,
        })
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn parse_composer_package(val: &serde_json::Value) -> ComposerPackage {
    ComposerPackage {
        name: val
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        version: val
            .get("version")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        description: val
            .get("description")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        package_type: val
            .get("type")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        homepage: val
            .get("homepage")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        license: val.get("license").and_then(|v| {
            v.as_array().map(|a| {
                a.iter()
                    .filter_map(|l| l.as_str().map(|s| s.to_string()))
                    .collect()
            })
        }),
        authors: val.get("authors").and_then(|v| {
            v.as_array().map(|a| {
                a.iter()
                    .map(|author| ComposerAuthor {
                        name: author
                            .get("name")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        email: author
                            .get("email")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        homepage: author
                            .get("homepage")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        role: author
                            .get("role")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                    })
                    .collect()
            })
        }),
    }
}
