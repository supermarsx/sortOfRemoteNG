//! IP whitelist (ignoreip) management — add, remove, list whitelisted IPs.

use crate::client;
use crate::error::Fail2banError;
use crate::types::Fail2banHost;
use log::info;

/// Get the list of whitelisted IPs for a jail.
pub async fn list_ignored(
    host: &Fail2banHost,
    jail_name: &str,
) -> Result<Vec<String>, Fail2banError> {
    client::validate_safe_name(jail_name, "jail name")?;
    let (output, _stderr, _code) = client::exec(host, &["get", jail_name, "ignoreip"]).await?;

    // Output varies:
    // "These IPs are currently set to be ignored:\n|- 127.0.0.1\n`- ::1"
    // or "No IP address/network is ignored"

    if output.contains("No IP") {
        return Ok(Vec::new());
    }

    Ok(output
        .lines()
        .filter_map(|l| {
            let trimmed = l.trim();
            let stripped = trimmed
                .trim_start_matches("|-")
                .trim_start_matches("`-")
                .trim();
            if stripped.is_empty()
                || stripped.starts_with("These IPs")
                || stripped.starts_with("No IP")
            {
                None
            } else {
                Some(stripped.to_string())
            }
        })
        .collect())
}

/// Add an IP address or CIDR to a jail's ignore list.
pub async fn add_ignored(
    host: &Fail2banHost,
    jail_name: &str,
    ip: &str,
) -> Result<(), Fail2banError> {
    client::validate_safe_name(jail_name, "jail name")?;
    client::validate_ip_or_host(ip)?;

    // Check if already ignored
    let current = list_ignored(host, jail_name).await?;
    if current.iter().any(|existing| existing == ip) {
        info!("IP {} is already in ignore list for jail {}", ip, jail_name);
        return Ok(());
    }

    client::exec_ok(host, &["set", jail_name, "addignoreip", ip]).await?;
    info!(
        "Added {} to ignore list for jail {} on {}",
        ip, jail_name, host.name
    );
    Ok(())
}

/// Remove an IP address or CIDR from a jail's ignore list.
pub async fn remove_ignored(
    host: &Fail2banHost,
    jail_name: &str,
    ip: &str,
) -> Result<(), Fail2banError> {
    client::validate_safe_name(jail_name, "jail name")?;
    client::validate_ip_or_host(ip)?;
    client::exec_ok(host, &["set", jail_name, "delignoreip", ip]).await?;
    info!(
        "Removed {} from ignore list for jail {} on {}",
        ip, jail_name, host.name
    );
    Ok(())
}

/// Replace the entire ignore list for a jail.
pub async fn set_ignored(
    host: &Fail2banHost,
    jail_name: &str,
    ips: &[String],
) -> Result<(), Fail2banError> {
    // Validate all first
    for ip in ips {
        client::validate_ip_or_host(ip)?;
    }

    // Get current list
    let current = list_ignored(host, jail_name).await?;

    // Remove all existing
    for ip in &current {
        if let Err(e) = client::exec_ok(host, &["set", jail_name, "delignoreip", ip]).await {
            log::warn!("Failed to remove {} from ignore list: {}", ip, e);
        }
    }

    // Add all new
    for ip in ips {
        client::exec_ok(host, &["set", jail_name, "addignoreip", ip]).await?;
    }

    info!(
        "Set ignore list for jail {} on {} to {} IPs",
        jail_name,
        host.name,
        ips.len()
    );
    Ok(())
}

/// Add an IP to the ignore list of all active jails.
pub async fn add_ignored_all_jails(
    host: &Fail2banHost,
    ip: &str,
) -> Result<Vec<String>, Fail2banError> {
    client::validate_ip_or_host(ip)?;

    let jails = crate::jails::list_jails(host).await?;
    let mut affected = Vec::new();

    for jail_name in &jails {
        match add_ignored(host, jail_name, ip).await {
            Ok(()) => affected.push(jail_name.clone()),
            Err(e) => {
                log::warn!(
                    "Failed to add {} to ignore list for jail {}: {}",
                    ip,
                    jail_name,
                    e
                );
            }
        }
    }

    info!(
        "Added {} to ignore list of {} jails on {}",
        ip,
        affected.len(),
        host.name
    );
    Ok(affected)
}

/// Remove an IP from the ignore list of all jails.
pub async fn remove_ignored_all_jails(
    host: &Fail2banHost,
    ip: &str,
) -> Result<Vec<String>, Fail2banError> {
    client::validate_ip_or_host(ip)?;
    let jails = crate::jails::list_jails(host).await?;
    let mut affected = Vec::new();

    for jail_name in &jails {
        match remove_ignored(host, jail_name, ip).await {
            Ok(()) => affected.push(jail_name.clone()),
            Err(e) => {
                log::warn!(
                    "Failed to remove {} from ignore list for jail {}: {}",
                    ip,
                    jail_name,
                    e
                );
            }
        }
    }

    Ok(affected)
}

/// Check if an IP is in a jail's ignore list.
pub async fn is_ignored(
    host: &Fail2banHost,
    jail_name: &str,
    ip: &str,
) -> Result<bool, Fail2banError> {
    client::validate_safe_name(jail_name, "jail name")?;
    client::validate_ip_or_host(ip)?;
    let list = list_ignored(host, jail_name).await?;
    Ok(list.iter().any(|existing| existing == ip))
}

/// Find which jails have a specific IP in their ignore list.
pub async fn find_ip_in_ignores(
    host: &Fail2banHost,
    ip: &str,
) -> Result<Vec<String>, Fail2banError> {
    client::validate_ip_or_host(ip)?;
    let jails = crate::jails::list_jails(host).await?;
    let mut found_in = Vec::new();

    for jail_name in &jails {
        if is_ignored(host, jail_name, ip).await.unwrap_or(false) {
            found_in.push(jail_name.clone());
        }
    }

    Ok(found_in)
}
