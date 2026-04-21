//! Platform-specific utilities for VPN/proxy services.
//!
//! Provides cross-platform temp directory resolution, binary path discovery,
//! and shell command construction.

use std::path::PathBuf;
use std::process::Command;

/// Returns the platform-appropriate temporary directory.
///
/// On Windows this returns `%TEMP%`, on Linux/macOS `/tmp` or `$TMPDIR`.
pub fn temp_dir() -> PathBuf {
    std::env::temp_dir()
}

/// Resolves a binary by name, checking PATH first, then well-known install locations.
///
/// Returns the full path to the binary, or a descriptive error with install instructions.
pub fn resolve_binary(name: &str) -> Result<PathBuf, String> {
    // 1. Check PATH via `which`
    if let Ok(path) = which::which(name) {
        return Ok(path);
    }

    // 2. Check platform-specific well-known locations
    #[cfg(windows)]
    {
        if let Some(path) = resolve_windows_binary(name) {
            return Ok(path);
        }
    }

    // 3. Return descriptive error
    let install_hint = install_hint_for(name);
    Err(format!(
        "'{}' not found in PATH. {}",
        name, install_hint
    ))
}

/// Returns a user-facing install hint for a given binary name.
fn install_hint_for(name: &str) -> &'static str {
    match name {
        "openvpn" | "openvpn.exe" => {
            "Install OpenVPN from https://openvpn.net/community-downloads/"
        }
        "tailscale" | "tailscale.exe" => "Install Tailscale from https://tailscale.com/download",
        "zerotier-cli" | "zerotier-cli.bat" => {
            "Install ZeroTier from https://www.zerotier.com/download"
        }
        "wireguard" | "wireguard.exe" | "wg-quick" | "wg" => {
            "Install WireGuard from https://www.wireguard.com/install/"
        }
        "ss-local" | "ss-local.exe" => {
            "Install shadowsocks-rust from https://github.com/shadowsocks/shadowsocks-rust"
        }
        "iodine" => "Install iodine DNS tunnel tool (Linux/macOS only)",
        "hping3" => "Install hping3 (Linux/macOS only)",
        "pptp" | "pptpclient" => "Install pptp-linux (apt install pptp-linux)",
        "pppd" => "Install pppd (apt install ppp)",
        "sstpc" => "Install sstp-client (apt install sstp-client)",
        "xl2tpd" => "Install xl2tpd (apt install xl2tpd)",
        "ipsec" | "swanctl" => "Install strongSwan (apt install strongswan)",
        "certutil" | "certutil.exe" => "certutil should be available on Windows by default",
        _ => "Please install the required tool and ensure it is in your PATH",
    }
}

/// Resolve well-known Windows install paths for VPN/proxy binaries.
#[cfg(windows)]
fn resolve_windows_binary(name: &str) -> Option<PathBuf> {
    let program_files = std::env::var("ProgramFiles").unwrap_or_default();
    let program_files_x86 = std::env::var("ProgramFiles(x86)").unwrap_or_default();
    let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".to_string());

    let candidates: Vec<PathBuf> = match name {
        "tailscale" | "tailscale.exe" => vec![
            PathBuf::from(&program_files).join("Tailscale").join("tailscale.exe"),
        ],
        "zerotier-cli" | "zerotier-cli.bat" => vec![
            PathBuf::from(&program_files)
                .join("ZeroTier")
                .join("One")
                .join("zerotier-cli.bat"),
            PathBuf::from(&program_files_x86)
                .join("ZeroTier")
                .join("One")
                .join("zerotier-cli.bat"),
        ],
        "openvpn" | "openvpn.exe" => vec![
            PathBuf::from(&program_files).join("OpenVPN").join("bin").join("openvpn.exe"),
            PathBuf::from(&program_files_x86).join("OpenVPN").join("bin").join("openvpn.exe"),
        ],
        "wireguard" | "wireguard.exe" => vec![
            PathBuf::from(&program_files).join("WireGuard").join("wireguard.exe"),
        ],
        "wg" | "wg.exe" => vec![
            PathBuf::from(&program_files).join("WireGuard").join("wg.exe"),
        ],
        "ss-local" | "ss-local.exe" => vec![
            PathBuf::from(&program_files).join("Shadowsocks").join("ss-local.exe"),
        ],
        "certutil" | "certutil.exe" => vec![
            PathBuf::from(&system_root).join("System32").join("certutil.exe"),
        ],
        "rasdial" | "rasdial.exe" => vec![
            PathBuf::from(&system_root).join("System32").join("rasdial.exe"),
        ],
        "powershell" | "powershell.exe" => vec![
            PathBuf::from(&system_root)
                .join("System32")
                .join("WindowsPowerShell")
                .join("v1.0")
                .join("powershell.exe"),
        ],
        "netsh" | "netsh.exe" => vec![
            PathBuf::from(&system_root).join("System32").join("netsh.exe"),
        ],
        _ => vec![],
    };

    candidates.into_iter().find(|p| p.exists())
}

/// Construct a cross-platform shell command.
///
/// On Windows, wraps with `cmd /C`. On Unix, wraps with `sh -c`.
pub fn shell_command(cmd: &str) -> Command {
    #[cfg(windows)]
    {
        let mut c = Command::new("cmd");
        c.args(["/C", cmd]);
        c
    }
    #[cfg(not(windows))]
    {
        let mut c = Command::new("sh");
        c.args(["-c", cmd]);
        c
    }
}

/// Build a `Command` for a resolved binary.
///
/// Resolves the binary path first, then constructs the command.
pub fn binary_command(name: &str) -> Result<Command, String> {
    let path = resolve_binary(name)?;
    Ok(Command::new(path))
}

/// Returns the platform-specific PowerShell executable path.
///
/// On Windows, returns `powershell.exe`. On other platforms, returns an error.
#[cfg(windows)]
pub fn powershell_command() -> Result<Command, String> {
    let path = resolve_binary("powershell")?;
    Ok(Command::new(path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn temp_dir_returns_valid_path() {
        let dir = temp_dir();
        assert!(dir.exists(), "temp_dir should return an existing directory");
    }

    #[test]
    fn install_hint_returns_nonempty() {
        let hint = install_hint_for("openvpn");
        assert!(!hint.is_empty());
        assert!(hint.contains("openvpn.net"));
    }

    #[test]
    fn resolve_nonexistent_binary_returns_error() {
        let result = resolve_binary("this_binary_definitely_does_not_exist_12345");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("not found in PATH"));
    }

    #[test]
    fn shell_command_constructs_valid_command() {
        let cmd = shell_command("echo hello");
        let program = cmd.get_program().to_string_lossy().to_string();
        #[cfg(windows)]
        assert!(program.contains("cmd"));
        #[cfg(not(windows))]
        assert!(program.contains("sh"));
    }
}
