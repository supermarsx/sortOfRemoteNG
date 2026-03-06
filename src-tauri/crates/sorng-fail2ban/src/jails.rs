//! Jail management — list, status, start, stop, enable, disable.

use crate::client;
use crate::error::Fail2banError;
use crate::types::{Fail2banHost, Jail, JailStatus};
use log::{info, warn};

/// List all jail names.
pub async fn list_jails(host: &Fail2banHost) -> Result<Vec<String>, Fail2banError> {
    let stdout = client::exec_ok(host, &["status"]).await?;
    parse_jail_list(&stdout)
}

/// Get detailed status of a specific jail.
pub async fn jail_status(
    host: &Fail2banHost,
    jail_name: &str,
) -> Result<Jail, Fail2banError> {
    let stdout = client::exec_ok(host, &["status", jail_name]).await?;
    parse_jail_status(jail_name, &stdout)
}

/// Get status of all jails.
pub async fn all_jail_statuses(host: &Fail2banHost) -> Result<Vec<Jail>, Fail2banError> {
    let names = list_jails(host).await?;
    let mut jails = Vec::new();
    for name in &names {
        match jail_status(host, name).await {
            Ok(jail) => jails.push(jail),
            Err(e) => {
                warn!("Failed to get status for jail {name}: {e}");
                jails.push(Jail {
                    name: name.clone(),
                    status: JailStatus::Unknown,
                    enabled: false,
                    logpath: Vec::new(),
                    filter: String::new(),
                    actions: Vec::new(),
                    maxretry: 0,
                    findtime: 0,
                    bantime: 0,
                    currently_banned: 0,
                    total_banned: 0,
                    currently_failed: 0,
                    total_failed: 0,
                    banned_ips: Vec::new(),
                    port: None,
                    protocol: None,
                    backend: None,
                    datepattern: None,
                    ignoreip: Vec::new(),
                    bantime_increment: false,
                    bantime_factor: None,
                    bantime_maxtime: None,
                });
            }
        }
    }
    Ok(jails)
}

/// Start a jail.
pub async fn start_jail(host: &Fail2banHost, jail_name: &str) -> Result<(), Fail2banError> {
    client::exec_ok(host, &["start", jail_name]).await?;
    info!("Started jail: {jail_name}");
    Ok(())
}

/// Stop a jail.
pub async fn stop_jail(host: &Fail2banHost, jail_name: &str) -> Result<(), Fail2banError> {
    client::exec_ok(host, &["stop", jail_name]).await?;
    info!("Stopped jail: {jail_name}");
    Ok(())
}

/// Restart a jail (stop + start).
pub async fn restart_jail(
    host: &Fail2banHost,
    jail_name: &str,
) -> Result<(), Fail2banError> {
    // Some fail2ban versions support direct restart, try that first
    match client::exec(host, &["restart", jail_name]).await {
        Ok((_, _, 0)) => {
            info!("Restarted jail: {jail_name}");
            Ok(())
        }
        _ => {
            // Fallback: stop then start
            let _ = stop_jail(host, jail_name).await;
            start_jail(host, jail_name).await
        }
    }
}

/// Get a specific jail setting.
pub async fn get_jail_setting(
    host: &Fail2banHost,
    jail_name: &str,
    setting: &str,
) -> Result<String, Fail2banError> {
    client::exec_ok(host, &["get", jail_name, setting]).await
        .map(|s| s.trim().to_string())
}

/// Set a specific jail setting (runtime change, not persisted to config).
pub async fn set_jail_setting(
    host: &Fail2banHost,
    jail_name: &str,
    setting: &str,
    value: &str,
) -> Result<(), Fail2banError> {
    client::exec_ok(host, &["set", jail_name, setting, value]).await?;
    info!("Set {jail_name}.{setting} = {value}");
    Ok(())
}

/// Set the ban time for a jail.
pub async fn set_bantime(
    host: &Fail2banHost,
    jail_name: &str,
    seconds: i64,
) -> Result<(), Fail2banError> {
    set_jail_setting(host, jail_name, "bantime", &seconds.to_string()).await
}

/// Set the find time for a jail.
pub async fn set_findtime(
    host: &Fail2banHost,
    jail_name: &str,
    seconds: u64,
) -> Result<(), Fail2banError> {
    set_jail_setting(host, jail_name, "findtime", &seconds.to_string()).await
}

/// Set the max retry count for a jail.
pub async fn set_maxretry(
    host: &Fail2banHost,
    jail_name: &str,
    count: u32,
) -> Result<(), Fail2banError> {
    set_jail_setting(host, jail_name, "maxretry", &count.to_string()).await
}

// ─── Parsers ────────────────────────────────────────────────────────

/// Parse jail list from `fail2ban-client status` output.
///
/// Example:
/// ```text
/// Status
/// |- Number of jail:      3
/// `- Jail list:   sshd, apache-auth, postfix
/// ```
fn parse_jail_list(output: &str) -> Result<Vec<String>, Fail2banError> {
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("`- Jail list:") || trimmed.starts_with("|- Jail list:") {
            let list_part = trimmed
                .split(':')
                .nth(1)
                .unwrap_or("")
                .trim();
            if list_part.is_empty() {
                return Ok(Vec::new());
            }
            return Ok(list_part
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect());
        }
    }
    Ok(Vec::new())
}

/// Parse jail status from `fail2ban-client status <jail>` output.
///
/// Example:
/// ```text
/// Status for the jail: sshd
/// |- Filter
/// |  |- Currently failed: 3
/// |  |- Total failed:     12
/// |  `- File list:        /var/log/auth.log
/// `- Actions
///    |- Currently banned: 1
///    |- Total banned:     5
///    `- Banned IP list:   192.168.1.100
/// ```
fn parse_jail_status(name: &str, output: &str) -> Result<Jail, Fail2banError> {
    let mut currently_failed: u64 = 0;
    let mut total_failed: u64 = 0;
    let mut logfiles = Vec::new();
    let mut currently_banned: u64 = 0;
    let mut total_banned: u64 = 0;
    let mut banned_ips = Vec::new();

    for line in output.lines() {
        let trimmed = line.trim().trim_start_matches("|- ").trim_start_matches("`- ");

        if let Some(val) = extract_value(trimmed, "Currently failed:") {
            currently_failed = val.parse().unwrap_or(0);
        } else if let Some(val) = extract_value(trimmed, "Total failed:") {
            total_failed = val.parse().unwrap_or(0);
        } else if let Some(val) = extract_value(trimmed, "File list:") {
            logfiles = val
                .split_whitespace()
                .map(|s| s.to_string())
                .collect();
        } else if let Some(val) = extract_value(trimmed, "Currently banned:") {
            currently_banned = val.parse().unwrap_or(0);
        } else if let Some(val) = extract_value(trimmed, "Total banned:") {
            total_banned = val.parse().unwrap_or(0);
        } else if let Some(val) = extract_value(trimmed, "Banned IP list:") {
            banned_ips = val
                .split_whitespace()
                .map(|s| s.to_string())
                .filter(|s| !s.is_empty())
                .collect();
        }
    }

    Ok(Jail {
        name: name.to_string(),
        status: JailStatus::Active,
        enabled: true,
        logpath: logfiles,
        filter: name.to_string(), // default: filter name = jail name
        actions: Vec::new(),
        maxretry: 0,
        findtime: 0,
        bantime: 0,
        currently_banned,
        total_banned,
        currently_failed,
        total_failed,
        banned_ips,
        port: None,
        protocol: None,
        backend: None,
        datepattern: None,
        ignoreip: Vec::new(),
        bantime_increment: false,
        bantime_factor: None,
        bantime_maxtime: None,
    })
}

fn extract_value<'a>(line: &'a str, prefix: &str) -> Option<&'a str> {
    if line.starts_with(prefix) {
        Some(line[prefix.len()..].trim())
    } else {
        None
    }
}
