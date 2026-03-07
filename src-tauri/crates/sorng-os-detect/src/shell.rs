//! Shell detection — default shell, available shells, version detection.

use crate::client;
use crate::error::OsDetectError;
use crate::types::*;

/// Detect the default shell for the current user.
pub async fn detect_default_shell(host: &OsDetectHost) -> Result<ShellInfo, OsDetectError> {
    // Try $SHELL environment variable
    let shell_env = client::shell_exec(host, "echo $SHELL").await;
    let shell_path = shell_env.trim();

    if !shell_path.is_empty() && shell_path.starts_with('/') {
        let name = shell_path.rsplit('/').next().unwrap_or(shell_path).to_string();
        let version = detect_shell_version(host, shell_path).await.ok();
        return Ok(ShellInfo {
            name,
            path: shell_path.to_string(),
            version,
        });
    }

    // Fallback: parse /etc/passwd for current user
    let passwd = client::shell_exec(
        host,
        "getent passwd $(whoami) 2>/dev/null || grep \"^$(whoami):\" /etc/passwd 2>/dev/null",
    ).await;
    if !passwd.is_empty() {
        // Format: user:x:uid:gid:info:home:shell
        let fields: Vec<&str> = passwd.trim().split(':').collect();
        if let Some(shell_path) = fields.last() {
            let shell_path = shell_path.trim();
            let name = shell_path.rsplit('/').next().unwrap_or(shell_path).to_string();
            let version = detect_shell_version(host, shell_path).await.ok();
            return Ok(ShellInfo {
                name,
                path: shell_path.to_string(),
                version,
            });
        }
    }

    // Windows fallback
    let comspec = client::shell_exec(host, "echo %COMSPEC%").await;
    if comspec.to_lowercase().contains("cmd.exe") {
        return Ok(ShellInfo {
            name: "cmd.exe".to_string(),
            path: comspec.trim().to_string(),
            version: None,
        });
    }

    // PowerShell check
    let ps = client::exec_soft(host, "pwsh", &["--version"]).await;
    if !ps.is_empty() {
        return Ok(ShellInfo {
            name: "pwsh".to_string(),
            path: "pwsh".to_string(),
            version: Some(ps.trim().to_string()),
        });
    }

    Err(OsDetectError::ParseError("Could not detect default shell".to_string()))
}

/// List all available shells from /etc/shells.
pub async fn detect_available_shells(host: &OsDetectHost) -> Result<Vec<ShellInfo>, OsDetectError> {
    let etc_shells = client::shell_exec(host, "cat /etc/shells 2>/dev/null").await;
    let mut shells = Vec::new();

    for line in etc_shells.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') { continue; }

        let path = line.to_string();
        let name = path.rsplit('/').next().unwrap_or(&path).to_string();
        let version = detect_shell_version(host, &path).await.ok();
        shells.push(ShellInfo { name, path, version });
    }

    // If /etc/shells was empty (e.g. macOS minimal, containers), try common shells
    if shells.is_empty() {
        let common = ["/bin/sh", "/bin/bash", "/bin/zsh", "/usr/bin/fish", "/bin/dash"];
        for path in &common {
            let exists = client::shell_exec(host, &format!("test -x {path} && echo yes")).await;
            if exists.trim() == "yes" {
                let name = path.rsplit('/').next().unwrap_or(path).to_string();
                let version = detect_shell_version(host, path).await.ok();
                shells.push(ShellInfo {
                    name,
                    path: path.to_string(),
                    version,
                });
            }
        }
    }

    Ok(shells)
}

/// Detect the version of a specific shell.
pub async fn detect_shell_version(host: &OsDetectHost, shell_path: &str) -> Result<String, OsDetectError> {
    let name = shell_path.rsplit('/').next().unwrap_or(shell_path);

    let output = match name {
        "bash" => client::exec_soft(host, shell_path, &["--version"]).await,
        "zsh" => client::exec_soft(host, shell_path, &["--version"]).await,
        "fish" => client::exec_soft(host, shell_path, &["--version"]).await,
        "dash" => {
            // dash doesn't reliably support --version; try dpkg
            let dpkg = client::shell_exec(host, "dpkg -l dash 2>/dev/null | grep '^ii'").await;
            if !dpkg.is_empty() {
                let parts: Vec<&str> = dpkg.split_whitespace().collect();
                return Ok(parts.get(2).unwrap_or(&"unknown").to_string());
            }
            return Ok("unknown".to_string());
        }
        "ksh" | "mksh" => client::exec_soft(host, shell_path, &["--version"]).await,
        "tcsh" | "csh" => client::exec_soft(host, shell_path, &["--version"]).await,
        "pwsh" | "powershell" => client::exec_soft(host, shell_path, &["--version"]).await,
        "nu" | "nushell" => client::exec_soft(host, shell_path, &["--version"]).await,
        _ => client::exec_soft(host, shell_path, &["--version"]).await,
    };

    let version = output.lines().next().unwrap_or("").trim().to_string();
    if version.is_empty() {
        Err(OsDetectError::ParseError(format!("Could not detect version for {name}")))
    } else {
        Ok(version)
    }
}
