//! # opkssh Binary Management
//!
//! Detect, validate, and download the opkssh binary.

use crate::types::*;
use log::{debug, info, warn};
use std::path::PathBuf;
use tokio::process::Command;

/// Known download URLs for opkssh releases.
const RELEASE_BASE: &str = "https://github.com/openpubkey/opkssh/releases/latest/download";

/// Get the expected binary name for the current platform.
pub fn binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "opkssh.exe"
    } else {
        "opkssh"
    }
}

/// Get the download URL for the current platform.
pub fn download_url() -> String {
    let file = if cfg!(target_os = "windows") {
        "opkssh-windows-amd64.exe"
    } else if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            "opkssh-osx-arm64"
        } else {
            "opkssh-osx-amd64"
        }
    } else {
        // Linux
        if cfg!(target_arch = "aarch64") {
            "opkssh-linux-arm64"
        } else {
            "opkssh-linux-amd64"
        }
    };
    format!("{}/{}", RELEASE_BASE, file)
}

/// Platform string for status reporting.
pub fn platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

/// Architecture string for status reporting.
pub fn arch() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "amd64"
    }
}

/// Search for the opkssh binary in PATH and common locations.
pub async fn find_binary() -> Option<PathBuf> {
    // Try `which`/`where` first
    let cmd = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };

    if let Ok(output) = Command::new(cmd).arg(binary_name()).output().await {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                let p = PathBuf::from(path.lines().next().unwrap_or(&path));
                if p.exists() {
                    return Some(p);
                }
            }
        }
    }

    // Check common installation paths
    let common_paths: Vec<PathBuf> = if cfg!(target_os = "windows") {
        vec![
            dirs::home_dir()
                .map(|h| h.join("opkssh.exe"))
                .unwrap_or_default(),
            PathBuf::from(r"C:\Program Files\opkssh\opkssh.exe"),
            PathBuf::from(r"C:\ProgramData\chocolatey\bin\opkssh.exe"),
        ]
    } else if cfg!(target_os = "macos") {
        vec![
            PathBuf::from("/usr/local/bin/opkssh"),
            PathBuf::from("/opt/homebrew/bin/opkssh"),
            dirs::home_dir()
                .map(|h| h.join("opkssh"))
                .unwrap_or_default(),
        ]
    } else {
        vec![
            PathBuf::from("/usr/local/bin/opkssh"),
            PathBuf::from("/usr/bin/opkssh"),
            dirs::home_dir()
                .map(|h| h.join("opkssh"))
                .unwrap_or_default(),
        ]
    };

    for p in common_paths {
        if p.exists() {
            return Some(p);
        }
    }

    None
}

/// Get the version of an opkssh binary.
pub async fn get_version(binary_path: &PathBuf) -> Option<String> {
    match Command::new(binary_path).arg("--version").output().await {
        Ok(output) => {
            let combined = format!(
                "{}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            // opkssh typically prints something like "opkssh v0.13.0"
            let version = combined
                .lines()
                .find(|l| l.contains("opkssh") || l.starts_with('v') || l.contains('.'))
                .map(|l| l.trim().to_string())
                .or_else(|| {
                    let trimmed = combined.trim();
                    if !trimmed.is_empty() {
                        Some(trimmed.to_string())
                    } else {
                        None
                    }
                });
            debug!("opkssh version output: {:?}", version);
            version
        }
        Err(e) => {
            warn!("Failed to get opkssh version: {}", e);
            None
        }
    }
}

/// Check the full binary status.
pub async fn check_status() -> OpksshBinaryStatus {
    let path = find_binary().await;
    let (installed, version, path_str) = if let Some(ref p) = path {
        let ver = get_version(p).await;
        (true, ver, Some(p.to_string_lossy().to_string()))
    } else {
        (false, None, None)
    };

    OpksshBinaryStatus {
        installed,
        path: path_str,
        version,
        platform: platform().to_string(),
        arch: arch().to_string(),
        download_url: Some(download_url()),
    }
}

/// Run an arbitrary opkssh command and return the raw output.
pub async fn run_command(binary_path: &PathBuf, args: &[&str]) -> Result<CommandOutput, String> {
    let start = std::time::Instant::now();
    info!("Running opkssh: {:?} {:?}", binary_path, args);

    let output = Command::new(binary_path)
        .args(args)
        .output()
        .await
        .map_err(|e| format!("Failed to execute opkssh: {}", e))?;

    let duration_ms = start.elapsed().as_millis() as u64;

    Ok(CommandOutput {
        exit_code: output.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        duration_ms,
    })
}
