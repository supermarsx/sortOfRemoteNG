use crate::types::{OsType, ShellType};

/// Detects the remote shell type and OS from available signals.
pub struct ShellDetector;

impl ShellDetector {
    /// Detect shell type from the SHELL environment variable or shell path.
    pub fn detect_shell(shell_env: Option<&str>, prompt: Option<&str>) -> ShellType {
        // First try SHELL env var
        if let Some(shell_path) = shell_env {
            let detected = ShellType::from_path(shell_path);
            if detected != ShellType::Unknown {
                return detected;
            }
        }

        // Try prompt analysis
        if let Some(p) = prompt {
            if p.contains("PS1") || p.contains("\\$") || p.ends_with("$ ") || p.ends_with("# ") {
                // Likely bash
                return ShellType::Bash;
            }
            if p.contains("%") {
                return ShellType::Zsh;
            }
            if p.contains(">") && p.contains("PS C:\\") {
                return ShellType::PowerShell;
            }
        }

        ShellType::Bash // Default assumption
    }

    /// Detect OS type from uname output or other signals.
    pub fn detect_os(uname_output: Option<&str>, env_vars: &[(String, String)]) -> OsType {
        // Check uname output first
        if let Some(uname) = uname_output {
            let lower = uname.to_lowercase();
            if lower.contains("linux") {
                return OsType::Linux;
            }
            if lower.contains("darwin") {
                return OsType::MacOs;
            }
            if lower.contains("freebsd") {
                return OsType::FreeBsd;
            }
            if lower.contains("openbsd") {
                return OsType::OpenBsd;
            }
            if lower.contains("netbsd") {
                return OsType::NetBsd;
            }
            if lower.contains("sunos") || lower.contains("solaris") {
                return OsType::Solaris;
            }
            if lower.contains("aix") {
                return OsType::Aix;
            }
            if lower.contains("mingw")
                || lower.contains("msys")
                || lower.contains("cygwin")
                || lower.contains("windows")
            {
                return OsType::Windows;
            }
        }

        // Fallback: check environment variables
        for (key, val) in env_vars {
            let k = key.to_uppercase();
            if k == "OSTYPE" {
                let v = val.to_lowercase();
                if v.contains("linux") {
                    return OsType::Linux;
                }
                if v.contains("darwin") {
                    return OsType::MacOs;
                }
                if v.contains("freebsd") {
                    return OsType::FreeBsd;
                }
                if v.contains("msys") || v.contains("cygwin") {
                    return OsType::Windows;
                }
            }
        }

        OsType::Linux // Default
    }

    /// Detect package manager based on OS and available commands.
    pub fn detect_package_manager(os: &OsType, installed_tools: &[String]) -> Option<String> {
        let tools: Vec<&str> = installed_tools.iter().map(|s| s.as_str()).collect();

        match os {
            OsType::Linux => {
                if tools.contains(&"apt") || tools.contains(&"apt-get") {
                    Some("apt".to_string())
                } else if tools.contains(&"dnf") {
                    Some("dnf".to_string())
                } else if tools.contains(&"yum") {
                    Some("yum".to_string())
                } else if tools.contains(&"pacman") {
                    Some("pacman".to_string())
                } else if tools.contains(&"zypper") {
                    Some("zypper".to_string())
                } else if tools.contains(&"apk") {
                    Some("apk".to_string())
                } else {
                    None
                }
            }
            OsType::MacOs => {
                if tools.contains(&"brew") {
                    Some("brew".to_string())
                } else {
                    None
                }
            }
            OsType::FreeBsd | OsType::OpenBsd | OsType::NetBsd => Some("pkg".to_string()),
            _ => None,
        }
    }
}
