//! X2Go server-side command protocol — building and parsing SSH-executed commands.
//!
//! X2Go relies on a set of server-side Perl scripts (x2gostartagent, x2goresume-session,
//! x2gosuspend-session, x2goterminate-session, x2golistsessions, etc.) invoked over SSH.

use serde::{Deserialize, Serialize};

use crate::x2go::types::*;

// ── Server-side commands ────────────────────────────────────────────────────

/// Build the x2golistsessions command.
pub fn build_list_sessions_cmd(server_path: Option<&str>) -> String {
    let prefix = server_path.unwrap_or("");
    format!("{}x2golistsessions", prefix)
}

/// Build the x2gostartagent command.
pub fn build_start_agent_cmd(
    config: &X2goConfig,
    server_path: Option<&str>,
) -> String {
    let prefix = server_path.unwrap_or("");
    let (width, height) = match &config.display {
        X2goDisplayMode::Window { width, height } => (*width, *height),
        X2goDisplayMode::Fullscreen => (0, 0), // X2Go uses "fullscreen" flag
        X2goDisplayMode::SingleApplication { .. } => (800, 600),
    };

    let depth = config.color_depth.unwrap_or(24);
    let link = config
        .compression
        .as_ref()
        .map(|c| c.to_speed_string())
        .unwrap_or("256");
    let session_type = config.session_type.to_x2go_string();
    let clipboard = config.clipboard.to_x2go_string();
    let sound = config.audio.system.to_x2go_string();
    let kb_layout = &config.keyboard.layout;
    let kb_type = &config.keyboard.model;

    let mut cmd = format!(
        "{prefix}x2gostartagent {width}x{height} {depth} {link} {session_type} \
        {clipboard} {sound} {kb_layout} {kb_type}",
        prefix = prefix,
        width = width,
        height = height,
        depth = depth,
        link = link,
        session_type = session_type,
        clipboard = clipboard,
        sound = sound,
        kb_layout = kb_layout,
        kb_type = kb_type,
    );

    if let Some(ref custom_cmd) = config.command {
        cmd.push_str(&format!(" cmd={}", custom_cmd));
    }

    if config.rootless {
        cmd.push_str(" -rootless");
    }

    if let Some(dpi) = config.dpi {
        cmd.push_str(&format!(" dpi={}", dpi));
    }

    cmd
}

/// Build the x2goresume-session command.
pub fn build_resume_session_cmd(
    session_id: &str,
    config: &X2goConfig,
    server_path: Option<&str>,
) -> String {
    let prefix = server_path.unwrap_or("");
    let (width, height) = match &config.display {
        X2goDisplayMode::Window { width, height } => (*width, *height),
        X2goDisplayMode::Fullscreen => (0, 0),
        X2goDisplayMode::SingleApplication { .. } => (800, 600),
    };
    let depth = config.color_depth.unwrap_or(24);
    let link = config
        .compression
        .as_ref()
        .map(|c| c.to_speed_string())
        .unwrap_or("256");
    let clipboard = config.clipboard.to_x2go_string();
    let sound = config.audio.system.to_x2go_string();
    let kb_layout = &config.keyboard.layout;
    let kb_type = &config.keyboard.model;

    format!(
        "{prefix}x2goresume-session {session_id} {width}x{height} {depth} {link} \
        {clipboard} {sound} {kb_layout} {kb_type}",
        prefix = prefix,
        session_id = session_id,
        width = width,
        height = height,
        depth = depth,
        link = link,
        clipboard = clipboard,
        sound = sound,
        kb_layout = kb_layout,
        kb_type = kb_type,
    )
}

/// Build the x2gosuspend-session command.
pub fn build_suspend_session_cmd(session_id: &str, server_path: Option<&str>) -> String {
    let prefix = server_path.unwrap_or("");
    format!("{}x2gosuspend-session {}", prefix, session_id)
}

/// Build the x2goterminate-session command.
pub fn build_terminate_session_cmd(session_id: &str, server_path: Option<&str>) -> String {
    let prefix = server_path.unwrap_or("");
    format!("{}x2goterminate-session {}", prefix, session_id)
}

/// Build the x2golistdesktops command (published applications).
pub fn build_list_desktops_cmd(server_path: Option<&str>) -> String {
    let prefix = server_path.unwrap_or("");
    format!("{}x2golistdesktops", prefix)
}

/// Build the x2gogetapps command (list published apps).
pub fn build_get_apps_cmd(server_path: Option<&str>) -> String {
    let prefix = server_path.unwrap_or("");
    format!("{}x2gogetapps", prefix)
}

/// Build the x2gomountdirs command for file sharing.
pub fn build_mount_dirs_cmd(session_id: &str, server_path: Option<&str>) -> String {
    let prefix = server_path.unwrap_or("");
    format!("{}x2gomountdirs {}", prefix, session_id)
}

/// Build the x2goumount-session command.
pub fn build_umount_session_cmd(session_id: &str, server_path: Option<&str>) -> String {
    let prefix = server_path.unwrap_or("");
    format!("{}x2goumount-session {}", prefix, session_id)
}

/// Build the x2goversion command to check server version.
pub fn build_version_cmd(server_path: Option<&str>) -> String {
    let prefix = server_path.unwrap_or("");
    format!("{}x2goversion", prefix)
}

/// Build the x2gofeaturelist command to check server features.
pub fn build_feature_list_cmd(server_path: Option<&str>) -> String {
    let prefix = server_path.unwrap_or("");
    format!("{}x2gofeaturelist", prefix)
}

// ── Response parsing ────────────────────────────────────────────────────────

/// Parsed x2gostartagent response.
#[derive(Debug, Clone)]
pub struct AgentStartResponse {
    pub session_id: String,
    pub display: u32,
    pub gr_port: u16,
    pub snd_port: u16,
    pub fs_port: u16,
    pub agent_pid: u32,
}

/// Parse the output of x2gostartagent.
/// Format: session_id\nDisplay\ngr_port\nsnd_port\nfs_port\nagent_pid
pub fn parse_agent_start(output: &str) -> Option<AgentStartResponse> {
    let lines: Vec<&str> = output.lines().collect();
    if lines.len() < 6 {
        return None;
    }

    Some(AgentStartResponse {
        session_id: lines[0].trim().to_string(),
        display: lines[1].trim().parse().ok()?,
        gr_port: lines[2].trim().parse().ok()?,
        snd_port: lines[3].trim().parse().ok()?,
        fs_port: lines[4].trim().parse().ok()?,
        agent_pid: lines[5].trim().parse().ok()?,
    })
}

/// Parsed server version.
#[derive(Debug, Clone)]
pub struct X2goServerVersion {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
    pub full: String,
}

/// Parse x2goversion output.
pub fn parse_version(output: &str) -> Option<X2goServerVersion> {
    let trimmed = output.trim();
    let parts: Vec<&str> = trimmed.split('.').collect();
    if parts.len() < 3 {
        return None;
    }
    Some(X2goServerVersion {
        major: parts[0].parse().ok()?,
        minor: parts[1].parse().ok()?,
        patch: parts[2].split(|c: char| !c.is_ascii_digit()).next()?.parse().ok()?,
        full: trimmed.to_string(),
    })
}

/// Parse x2gofeaturelist output (newline-separated feature names).
pub fn parse_feature_list(output: &str) -> Vec<String> {
    output
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect()
}

/// Parsed published application entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublishedApplication {
    pub name: String,
    pub exec: String,
    pub icon: Option<String>,
    pub comment: Option<String>,
    pub category: Option<String>,
}

/// Parse x2gogetapps output (desktop-file-like entries separated by blank lines).
pub fn parse_published_apps(output: &str) -> Vec<PublishedApplication> {
    let mut apps = Vec::new();
    let mut current_name = String::new();
    let mut current_exec = String::new();
    let mut current_icon = None;
    let mut current_comment = None;
    let mut current_category = None;
    let mut in_entry = false;

    for line in output.lines() {
        let line = line.trim();

        if line.is_empty() {
            if in_entry && !current_name.is_empty() && !current_exec.is_empty() {
                apps.push(PublishedApplication {
                    name: current_name.clone(),
                    exec: current_exec.clone(),
                    icon: current_icon.clone(),
                    comment: current_comment.clone(),
                    category: current_category.clone(),
                });
            }
            current_name.clear();
            current_exec.clear();
            current_icon = None;
            current_comment = None;
            current_category = None;
            in_entry = false;
            continue;
        }

        if let Some(val) = line.strip_prefix("Name=") {
            current_name = val.to_string();
            in_entry = true;
        } else if let Some(val) = line.strip_prefix("Exec=") {
            current_exec = val.to_string();
        } else if let Some(val) = line.strip_prefix("Icon=") {
            current_icon = Some(val.to_string());
        } else if let Some(val) = line.strip_prefix("Comment=") {
            current_comment = Some(val.to_string());
        } else if let Some(val) = line.strip_prefix("Categories=") {
            current_category = Some(val.to_string());
        }
    }

    // Flush last entry
    if in_entry && !current_name.is_empty() && !current_exec.is_empty() {
        apps.push(PublishedApplication {
            name: current_name,
            exec: current_exec,
            icon: current_icon,
            comment: current_comment,
            category: current_category,
        });
    }

    apps
}

// ── NX proxy ────────────────────────────────────────────────────────────────

/// Build nxproxy command line for X2Go session.
pub fn build_nxproxy_cmd(
    session_id: &str,
    config: &X2goConfig,
    gr_port: u16,
    nxproxy_path: Option<&str>,
) -> String {
    let proxy = nxproxy_path.unwrap_or("nxproxy");
    let link = config
        .compression
        .as_ref()
        .map(|c| c.to_speed_string())
        .unwrap_or("256");

    format!(
        "{} -S nx,options=nx/nx,session={},link={},listen={}:127.0.0.1",
        proxy, session_id, link, gr_port
    )
}

/// Find nxproxy binary on the system.
pub fn find_nxproxy() -> Option<String> {
    let candidates = ["nxproxy", "x2gonxproxy"];
    for name in &candidates {
        if let Ok(path) = which::which(name) {
            return Some(path.to_string_lossy().to_string());
        }
    }

    // Platform-specific search paths
    #[cfg(target_os = "linux")]
    {
        let linux_paths = [
            "/usr/lib/nx/bin/nxproxy",
            "/usr/lib/x2go/bin/nxproxy",
            "/usr/local/lib/nx/bin/nxproxy",
        ];
        for p in &linux_paths {
            if std::path::Path::new(p).exists() {
                return Some(p.to_string());
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        let win_paths = [
            r"C:\Program Files\x2goclient\nxproxy.exe",
            r"C:\Program Files (x86)\x2goclient\nxproxy.exe",
        ];
        for p in &win_paths {
            if std::path::Path::new(p).exists() {
                return Some(p.to_string());
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        let mac_paths = [
            "/Applications/x2goclient.app/Contents/exe/nxproxy",
            "/opt/X2Go/bin/nxproxy",
        ];
        for p in &mac_paths {
            if std::path::Path::new(p).exists() {
                return Some(p.to_string());
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_sessions_cmd() {
        let cmd = build_list_sessions_cmd(None);
        assert_eq!(cmd, "x2golistsessions");

        let cmd2 = build_list_sessions_cmd(Some("/usr/bin/"));
        assert_eq!(cmd2, "/usr/bin/x2golistsessions");
    }

    #[test]
    fn start_agent_cmd() {
        let config = X2goConfig {
            host: "server".into(),
            username: "user".into(),
            display: X2goDisplayMode::Window { width: 1920, height: 1080 },
            session_type: X2goSessionType::Xfce,
            ..Default::default()
        };
        let cmd = build_start_agent_cmd(&config, None);
        assert!(cmd.starts_with("x2gostartagent 1920x1080"));
        assert!(cmd.contains("24")); // depth
        assert!(cmd.contains("X")); // Xfce session type
        assert!(cmd.contains("pulse")); // audio
    }

    #[test]
    fn resume_session_cmd() {
        let config = X2goConfig::default();
        let cmd = build_resume_session_cmd("user-50-12345_stDKDE_dp24", &config, None);
        assert!(cmd.starts_with("x2goresume-session user-50-12345_stDKDE_dp24"));
    }

    #[test]
    fn suspend_terminate_cmds() {
        assert_eq!(
            build_suspend_session_cmd("sess-1", None),
            "x2gosuspend-session sess-1"
        );
        assert_eq!(
            build_terminate_session_cmd("sess-1", None),
            "x2goterminate-session sess-1"
        );
    }

    #[test]
    fn parse_agent_start_output() {
        let output = "user-50-1234567890_stDKDE_dp24\n50\n5100\n5200\n5300\n1234\n";
        let resp = parse_agent_start(output).unwrap();
        assert_eq!(resp.session_id, "user-50-1234567890_stDKDE_dp24");
        assert_eq!(resp.display, 50);
        assert_eq!(resp.gr_port, 5100);
        assert_eq!(resp.snd_port, 5200);
        assert_eq!(resp.fs_port, 5300);
        assert_eq!(resp.agent_pid, 1234);
    }

    #[test]
    fn parse_server_version() {
        let v = parse_version("4.1.0.3\n").unwrap();
        assert_eq!(v.major, 4);
        assert_eq!(v.minor, 1);
        assert_eq!(v.patch, 0);
    }

    #[test]
    fn parse_features() {
        let output = "resumesession\nlistdesktops\nmountdirs\nfoldersharing\n";
        let features = parse_feature_list(output);
        assert_eq!(features.len(), 4);
        assert_eq!(features[0], "resumesession");
    }

    #[test]
    fn parse_apps_output() {
        let output = "\
Name=Firefox
Exec=firefox
Icon=firefox
Comment=Web Browser
Categories=Network;WebBrowser

Name=Terminal
Exec=xfce4-terminal
Icon=terminal

";
        let apps = parse_published_apps(output);
        assert_eq!(apps.len(), 2);
        assert_eq!(apps[0].name, "Firefox");
        assert_eq!(apps[0].exec, "firefox");
        assert_eq!(apps[1].name, "Terminal");
        assert!(apps[1].comment.is_none());
    }

    #[test]
    fn nxproxy_cmd() {
        let cfg = X2goConfig::default();
        let cmd = build_nxproxy_cmd("sess-1", &cfg, 5100, None);
        assert!(cmd.starts_with("nxproxy -S"));
        assert!(cmd.contains("sess-1"));
        assert!(cmd.contains("5100"));
    }
}
