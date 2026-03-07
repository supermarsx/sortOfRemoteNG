//! Init system detection — systemd, OpenRC, SysVInit, runit, launchd, etc.

use crate::client;
use crate::error::OsDetectError;
use crate::types::*;

/// Detect the init system running on the host.
pub async fn detect_init_system(host: &OsDetectHost) -> Result<InitSystem, OsDetectError> {
    // Check PID 1 comm (most reliable on Linux)
    let pid1 = client::shell_exec(host, "cat /proc/1/comm 2>/dev/null").await;
    match pid1.trim() {
        "systemd" => return Ok(InitSystem::Systemd),
        "init" => {
            // Could be SysVInit or OpenRC — disambiguate
            if client::has_command(host, "openrc").await
                || client::shell_exec(host, "test -d /etc/runlevels && echo yes").await.trim() == "yes"
            {
                return Ok(InitSystem::OpenRC);
            }
            // Check for runit
            if client::shell_exec(host, "test -d /etc/runit && echo yes").await.trim() == "yes" {
                return Ok(InitSystem::Runit);
            }
            return Ok(InitSystem::SysVInit);
        }
        "runit" | "runsvdir" => return Ok(InitSystem::Runit),
        "s6-svscan" => return Ok(InitSystem::S6),
        "launchd" => return Ok(InitSystem::Launchd),
        _ => {}
    }

    // macOS
    let uname = client::exec_soft(host, "uname", &["-s"]).await;
    if uname.trim() == "Darwin" {
        return Ok(InitSystem::Launchd);
    }

    // FreeBSD / OpenBSD / NetBSD
    let lower = uname.trim().to_lowercase();
    if lower.contains("bsd") {
        return Ok(InitSystem::BSDInit);
    }

    // Windows
    let win = client::exec_soft(host, "cmd.exe", &["/C", "echo windows"]).await;
    if win.trim() == "windows" {
        return Ok(InitSystem::WindowsSCM);
    }

    // Check for systemctl binary as last resort
    if client::has_command(host, "systemctl").await {
        return Ok(InitSystem::Systemd);
    }

    Ok(InitSystem::Unknown)
}

/// Detect the version of the service manager.
pub async fn detect_service_manager_version(host: &OsDetectHost) -> Result<Option<String>, OsDetectError> {
    // systemd
    let systemd_ver = client::exec_soft(host, "systemctl", &["--version"]).await;
    if !systemd_ver.is_empty() {
        // First line: "systemd 252 (252.22-1~deb12u1)"
        if let Some(first) = systemd_ver.lines().next() {
            return Ok(Some(first.trim().to_string()));
        }
    }

    // OpenRC
    let openrc_ver = client::exec_soft(host, "openrc", &["--version"]).await;
    if !openrc_ver.is_empty() {
        return Ok(Some(openrc_ver.trim().to_string()));
    }

    // launchd (macOS) - launchctl version
    let launchctl = client::exec_soft(host, "launchctl", &["version"]).await;
    if !launchctl.is_empty() {
        return Ok(Some(launchctl.trim().to_string()));
    }

    Ok(None)
}

/// List all services managed by the detected init system.
pub async fn list_init_services(host: &OsDetectHost) -> Result<Vec<AvailableService>, OsDetectError> {
    // Try systemd first
    let stdout = client::shell_exec(
        host,
        "systemctl list-units --all --type=service --no-pager --no-legend 2>/dev/null",
    ).await;
    if !stdout.is_empty() {
        return Ok(parse_systemd_services(&stdout));
    }

    // Try OpenRC
    let rc_status = client::exec_soft(host, "rc-status", &["-a"]).await;
    if !rc_status.is_empty() {
        return Ok(parse_openrc_services(&rc_status));
    }

    // Try SysVInit
    let chkconfig = client::exec_soft(host, "chkconfig", &["--list"]).await;
    if !chkconfig.is_empty() {
        return Ok(parse_chkconfig_services(&chkconfig));
    }

    // Try service --status-all (Debian SysVInit)
    let service_all = client::exec_soft(host, "service", &["--status-all"]).await;
    if !service_all.is_empty() {
        return Ok(parse_service_status_all(&service_all));
    }

    // macOS: launchctl list
    let launchctl = client::exec_soft(host, "launchctl", &["list"]).await;
    if !launchctl.is_empty() {
        return Ok(parse_launchctl_services(&launchctl));
    }

    Ok(Vec::new())
}

/// Detect the default boot target / runlevel.
pub async fn detect_default_target(host: &OsDetectHost) -> Result<Option<String>, OsDetectError> {
    // systemd
    let target = client::exec_soft(host, "systemctl", &["get-default"]).await;
    if !target.is_empty() {
        return Ok(Some(target.trim().to_string()));
    }

    // SysVInit runlevel
    let runlevel = client::exec_soft(host, "runlevel", &[]).await;
    if !runlevel.is_empty() {
        let parts: Vec<&str> = runlevel.trim().split_whitespace().collect();
        if let Some(level) = parts.last() {
            return Ok(Some(format!("runlevel {}", level)));
        }
    }

    // OpenRC default runlevel
    let rc_default = client::shell_exec(host, "cat /etc/inittab 2>/dev/null | grep ':initdefault:'").await;
    if !rc_default.is_empty() {
        if let Some(level) = rc_default.split(':').nth(1) {
            return Ok(Some(format!("runlevel {}", level)));
        }
    }

    Ok(None)
}

// ─── Parsers ────────────────────────────────────────────────────────

fn parse_systemd_services(stdout: &str) -> Vec<AvailableService> {
    stdout.lines().filter_map(|line| {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 4 {
            Some(AvailableService {
                name: parts[0].trim_end_matches(".service").to_string(),
                unit_type: Some("service".to_string()),
                state: parts[2].to_string(), // active/inactive/failed
                enabled: None,
            })
        } else {
            None
        }
    }).collect()
}

fn parse_openrc_services(stdout: &str) -> Vec<AvailableService> {
    let mut services = Vec::new();
    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() || line.ends_with(':') { continue; }
        // Format: "service_name   [ status ]"
        let parts: Vec<&str> = line.split('[').collect();
        if parts.len() == 2 {
            let name = parts[0].trim().to_string();
            let state = parts[1].trim().trim_end_matches(']').trim().to_string();
            services.push(AvailableService {
                name,
                unit_type: Some("openrc".to_string()),
                state,
                enabled: None,
            });
        }
    }
    services
}

fn parse_chkconfig_services(stdout: &str) -> Vec<AvailableService> {
    stdout.lines().filter_map(|line| {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.is_empty() { return None; }
        let name = parts[0].to_string();
        // Check if any runlevel shows "on"
        let enabled = parts.iter().any(|p| *p == "on" || p.ends_with(":on"));
        Some(AvailableService {
            name,
            unit_type: Some("sysvinit".to_string()),
            state: if enabled { "active".to_string() } else { "inactive".to_string() },
            enabled: Some(enabled),
        })
    }).collect()
}

fn parse_service_status_all(stdout: &str) -> Vec<AvailableService> {
    stdout.lines().filter_map(|line| {
        let line = line.trim();
        // Format: " [ + ]  service_name" or " [ - ]  service_name" or " [ ? ]  service_name"
        if line.len() < 7 { return None; }
        let state = if line.contains("[ + ]") { "active" }
            else if line.contains("[ - ]") { "inactive" }
            else { "unknown" };
        let name = line.split(']').last()?.trim().to_string();
        if name.is_empty() { return None; }
        Some(AvailableService {
            name,
            unit_type: Some("sysvinit".to_string()),
            state: state.to_string(),
            enabled: None,
        })
    }).collect()
}

fn parse_launchctl_services(stdout: &str) -> Vec<AvailableService> {
    stdout.lines().skip(1).filter_map(|line| {
        let parts: Vec<&str> = line.split_whitespace().collect();
        // Format: PID  Status  Label
        if parts.len() >= 3 {
            let pid = parts[0];
            let label = parts[2].to_string();
            let state = if pid == "-" { "inactive".to_string() } else { "active".to_string() };
            Some(AvailableService {
                name: label,
                unit_type: Some("launchd".to_string()),
                state,
                enabled: None,
            })
        } else {
            None
        }
    }).collect()
}
