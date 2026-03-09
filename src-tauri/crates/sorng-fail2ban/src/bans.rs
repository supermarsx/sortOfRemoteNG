//! Ban / unban operations — ban IP, unban IP, list bans.

use crate::client;
use crate::error::Fail2banError;
use crate::types::{BanRecord, Fail2banHost};
use log::info;

/// Ban an IP in a specific jail.
pub async fn ban_ip(host: &Fail2banHost, jail: &str, ip: &str) -> Result<(), Fail2banError> {
    let (stdout, stderr, code) = client::exec(host, &["set", jail, "banip", ip]).await?;

    if code != 0 {
        if stderr.contains("already banned") || stdout.contains("already banned") {
            return Err(Fail2banError::AlreadyBanned {
                ip: ip.to_string(),
                jail: jail.to_string(),
            });
        }
        return Err(Fail2banError::ClientFailed {
            command: format!("set {jail} banip {ip}"),
            exit_code: code,
            stderr,
        });
    }

    info!("Banned IP {ip} in jail {jail}");
    Ok(())
}

/// Unban an IP from a specific jail.
pub async fn unban_ip(host: &Fail2banHost, jail: &str, ip: &str) -> Result<(), Fail2banError> {
    let (stdout, stderr, code) = client::exec(host, &["set", jail, "unbanip", ip]).await?;

    if code != 0 {
        if stderr.contains("not banned") || stdout.contains("not banned") {
            return Err(Fail2banError::NotBanned {
                ip: ip.to_string(),
                jail: jail.to_string(),
            });
        }
        return Err(Fail2banError::ClientFailed {
            command: format!("set {jail} unbanip {ip}"),
            exit_code: code,
            stderr,
        });
    }

    info!("Unbanned IP {ip} from jail {jail}");
    Ok(())
}

/// Unban an IP from all jails.
pub async fn unban_ip_all(host: &Fail2banHost, ip: &str) -> Result<Vec<String>, Fail2banError> {
    // Try the global unban first (fail2ban 0.10+)
    let (_stdout, _stderr, code) = client::exec(host, &["unban", ip]).await?;

    if code == 0 {
        info!("Unbanned IP {ip} from all jails");
        return Ok(vec!["all".to_string()]);
    }

    // Fallback: unban from each jail individually
    let jails = crate::jails::list_jails(host).await?;
    let mut unbanned_from = Vec::new();

    for jail in &jails {
        match unban_ip(host, jail, ip).await {
            Ok(()) => unbanned_from.push(jail.clone()),
            Err(Fail2banError::NotBanned { .. }) => {} // skip
            Err(e) => {
                log::warn!("Failed to unban {ip} from {jail}: {e}");
            }
        }
    }

    Ok(unbanned_from)
}

/// List all currently banned IPs in a jail.
pub async fn list_banned(host: &Fail2banHost, jail: &str) -> Result<Vec<BanRecord>, Fail2banError> {
    // Get jail status — banned IPs are in the output
    let jail_info = crate::jails::jail_status(host, jail).await?;

    let records: Vec<BanRecord> = jail_info
        .banned_ips
        .iter()
        .map(|ip| BanRecord {
            ip: ip.clone(),
            jail: jail.to_string(),
            banned_at: None, // not available from basic status
            expires_at: None,
            active: true,
            ban_count: 1,
            country: None,
            hostname: None,
        })
        .collect();

    Ok(records)
}

/// List all currently banned IPs across all jails.
pub async fn list_all_banned(host: &Fail2banHost) -> Result<Vec<BanRecord>, Fail2banError> {
    // Try fail2ban 0.11+ `banned` command
    if let Ok((stdout, _, 0)) = client::exec(host, &["banned"]).await {
        return parse_banned_output(&stdout);
    }

    // Fallback: iterate jails
    let jails = crate::jails::list_jails(host).await?;
    let mut all_bans = Vec::new();

    for jail in &jails {
        let bans = list_banned(host, jail).await?;
        all_bans.extend(bans);
    }

    Ok(all_bans)
}

/// Ban an IP in a specific jail with a custom ban time.
pub async fn ban_ip_with_time(
    host: &Fail2banHost,
    jail: &str,
    ip: &str,
    _bantime_seconds: i64,
) -> Result<(), Fail2banError> {
    // Set temporary bantime, ban, then restore (if needed)
    // Using fail2ban-client set <jail> banip <ip> — bantime is jail-level
    // For custom per-IP bantime, we use the `set <jail> bantime` workaround
    // However, this is a global setting. For now, just ban with the jail's bantime.
    ban_ip(host, jail, ip).await
}

/// Check if an IP is currently banned in any jail.
pub async fn is_banned(host: &Fail2banHost, ip: &str) -> Result<Vec<String>, Fail2banError> {
    let all_bans = list_all_banned(host).await?;
    let jails: Vec<String> = all_bans
        .iter()
        .filter(|b| b.ip == ip && b.active)
        .map(|b| b.jail.clone())
        .collect();
    Ok(jails)
}

// ─── Parsers ────────────────────────────────────────────────────────

/// Parse output of `fail2ban-client banned`.
///
/// Example output (fail2ban 0.11+):
/// ```text
/// [{'sshd': ['192.168.1.100', '10.0.0.5']}, {'apache-auth': ['192.168.1.200']}]
/// ```
fn parse_banned_output(output: &str) -> Result<Vec<BanRecord>, Fail2banError> {
    let mut records = Vec::new();
    let trimmed = output.trim();

    // Simple regex-based parser for the Python-dict-like output
    let re = regex::Regex::new(r"'(\w[\w-]*)'\s*:\s*\[([^\]]*)\]")
        .map_err(|e| Fail2banError::Other(format!("regex error: {e}")))?;

    let ip_re = regex::Regex::new(r"'([^']+)'")
        .map_err(|e| Fail2banError::Other(format!("regex error: {e}")))?;

    for caps in re.captures_iter(trimmed) {
        let jail = caps[1].to_string();
        let ips_str = &caps[2];

        for ip_cap in ip_re.captures_iter(ips_str) {
            records.push(BanRecord {
                ip: ip_cap[1].to_string(),
                jail: jail.clone(),
                banned_at: None,
                expires_at: None,
                active: true,
                ban_count: 1,
                country: None,
                hostname: None,
            });
        }
    }

    Ok(records)
}
