//! NX proxy process management — launch, monitor, terminate nxproxy / nxcomp.

use crate::nx::protocol::NxProxyParams;
use crate::nx::types::*;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// State of the nxproxy child process.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProxyState {
    /// Not started yet.
    Idle,
    /// Process is starting.
    Starting,
    /// Running and forwarding data.
    Running,
    /// Process exited normally.
    Stopped,
    /// Process exited with error.
    Failed,
}

/// Tracked nxproxy process.
#[derive(Debug)]
pub struct NxProxyProcess {
    pub state: ProxyState,
    pub pid: Option<u32>,
    pub display: Option<u32>,
    pub cookie: Option<String>,
    pub exit_code: Option<i32>,
    pub error_message: Option<String>,
    pub started_at: Option<String>,
    pub bytes_in: u64,
    pub bytes_out: u64,
}

impl Default for NxProxyProcess {
    fn default() -> Self {
        Self::new()
    }
}

impl NxProxyProcess {
    pub fn new() -> Self {
        Self {
            state: ProxyState::Idle,
            pid: None,
            display: None,
            cookie: None,
            exit_code: None,
            error_message: None,
            started_at: None,
            bytes_in: 0,
            bytes_out: 0,
        }
    }
}

/// Locate the nxproxy binary on the system.
pub fn find_nxproxy(custom_path: Option<&str>) -> Result<PathBuf, NxError> {
    if let Some(p) = custom_path {
        let path = PathBuf::from(p);
        if path.exists() {
            return Ok(path);
        }
        return Err(NxError::proxy(format!("nxproxy not found at: {}", p)));
    }

    // Check common locations
    let candidates = [
        "/usr/bin/nxproxy",
        "/usr/local/bin/nxproxy",
        "/opt/NX/bin/nxproxy",
        "/usr/NX/bin/nxproxy",
        "C:\\Program Files\\NoMachine\\bin\\nxproxy.exe",
        "C:\\Program Files (x86)\\NoMachine\\bin\\nxproxy.exe",
    ];

    for candidate in &candidates {
        let path = PathBuf::from(candidate);
        if path.exists() {
            return Ok(path);
        }
    }

    // Try PATH
    if let Ok(path) = which::which("nxproxy") {
        return Ok(path);
    }

    Err(NxError::proxy(
        "nxproxy binary not found in PATH or common locations",
    ))
}

/// Build the full nxproxy command-line for a session.
pub fn build_proxy_command(
    proxy_path: &Path,
    params: &NxProxyParams,
    extra_args: &[String],
) -> (String, Vec<String>) {
    let program = proxy_path.display().to_string();
    let mut args = params.to_args();
    args.extend(extra_args.iter().cloned());
    (program, args)
}

/// Environment variables required by nxproxy.
pub fn proxy_environment(nx_root: Option<&str>, display: u32) -> Vec<(String, String)> {
    let mut env = Vec::new();

    if let Some(root) = nx_root {
        env.push(("NX_ROOT".to_string(), root.to_string()));
    } else {
        // Default NX_ROOT to ~/.nx
        if let Some(home) = dirs_home() {
            env.push(("NX_ROOT".to_string(), format!("{}/.nx", home)));
        }
    }

    env.push(("DISPLAY".to_string(), format!(":{}", display)));

    env
}

/// Get the user's home directory.
fn dirs_home() -> Option<String> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()
}

/// Validate nxproxy version.
pub fn parse_proxy_version(output: &str) -> Option<String> {
    // nxproxy typically outputs "NXPROXY - Version 3.5.99.26"
    for line in output.lines() {
        if line.contains("Version") {
            if let Some(idx) = line.find("Version") {
                let version = line[idx + 8..].trim();
                return Some(version.to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proxy_process_new() {
        let proc = NxProxyProcess::new();
        assert_eq!(proc.state, ProxyState::Idle);
        assert!(proc.pid.is_none());
    }

    #[test]
    fn parse_version() {
        let output = "NXPROXY - Version 3.5.99.26\nCopyright (c) 2001, 2015 NoMachine.";
        let version = parse_proxy_version(output);
        assert_eq!(version, Some("3.5.99.26".to_string()));
    }

    #[test]
    fn parse_version_missing() {
        assert_eq!(parse_proxy_version("no version here"), None);
    }

    #[test]
    fn build_command() {
        let params = NxProxyParams {
            session_id: "TEST".into(),
            cookie: "abc".into(),
            proxy_host: "localhost".into(),
            proxy_port: 4000,
            display: 1001,
            link: "adsl".into(),
            cache_size: "8M".into(),
            geometry: "1024x768".into(),
            compression: "adaptive".into(),
            keyboard_layout: "us".into(),
        };
        let path = PathBuf::from("/usr/bin/nxproxy");
        let (prog, args) = build_proxy_command(&path, &params, &["--extra".into()]);
        assert_eq!(prog, "/usr/bin/nxproxy");
        assert!(args.len() >= 3);
        assert_eq!(args.last().unwrap(), "--extra");
    }

    #[test]
    fn proxy_environment_vars() {
        let env = proxy_environment(Some("/tmp/nx"), 1001);
        assert!(env.iter().any(|(k, v)| k == "NX_ROOT" && v == "/tmp/nx"));
        assert!(env.iter().any(|(k, v)| k == "DISPLAY" && v == ":1001"));
    }
}
