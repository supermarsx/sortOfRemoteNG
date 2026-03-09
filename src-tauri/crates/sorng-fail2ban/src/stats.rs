//! Statistics aggregation — compute summaries across jails and hosts.

use crate::error::Fail2banError;
use crate::jails;
use crate::logs;
use crate::types::{BannedIpSummary, Fail2banHost, Fail2banStats, JailStats, LogAction};
use chrono::Utc;
use std::collections::HashMap;

/// Collect full statistics for a host by querying all jail statuses.
pub async fn host_stats(host: &Fail2banHost) -> Result<Fail2banStats, Fail2banError> {
    let jails_list = jails::list_jails(host).await?;
    let mut jail_stats = Vec::new();
    let mut total_banned: u64 = 0;
    let mut total_failed: u64 = 0;

    for jail_name in &jails_list {
        match jails::jail_status(host, jail_name).await {
            Ok(jail) => {
                let banned = jail.currently_banned;
                let failed = jail.currently_failed;
                total_banned += banned;
                total_failed += failed;

                jail_stats.push(JailStats {
                    jail: jail.name.clone(),
                    currently_banned: jail.currently_banned,
                    total_banned: jail.total_banned,
                    currently_failed: jail.currently_failed,
                    total_failed: jail.total_failed,
                });
            }
            Err(e) => {
                log::warn!("Failed to get status for jail {}: {}", jail_name, e);
            }
        }
    }

    Ok(Fail2banStats {
        server_version: None,
        total_jails: jails_list.len() as u64,
        active_jails: jail_stats.len() as u64,
        total_banned_now: total_banned,
        total_banned_ever: 0,
        total_failed_now: total_failed,
        total_failed_ever: 0,
        per_jail: jail_stats,
        top_banned_ips: Vec::new(),
        collected_at: Utc::now(),
    })
}

/// Get a summary of the most-banned IPs across all jails.
pub async fn top_banned_ips(
    host: &Fail2banHost,
    limit: usize,
) -> Result<Vec<BannedIpSummary>, Fail2banError> {
    let jails_list = jails::list_jails(host).await?;
    let mut ip_counts: HashMap<String, Vec<String>> = HashMap::new();

    for jail_name in &jails_list {
        if let Ok(jail) = jails::jail_status(host, jail_name).await {
            for ip in &jail.banned_ips {
                ip_counts
                    .entry(ip.clone())
                    .or_default()
                    .push(jail_name.clone());
            }
        }
    }

    let mut summaries: Vec<BannedIpSummary> = ip_counts
        .into_iter()
        .map(|(ip, jails)| {
            let total = jails.len() as u32;
            BannedIpSummary {
                ip,
                total_bans: total,
                jails,
                country: None,
                last_banned: None,
            }
        })
        .collect();

    summaries.sort_by(|a, b| b.total_bans.cmp(&a.total_bans));
    summaries.truncate(limit);

    Ok(summaries)
}

/// Analyse the log file for ban/unban frequency.
pub async fn log_stats(
    host: &Fail2banHost,
    log_path: Option<&str>,
) -> Result<LogStats, Fail2banError> {
    let entries = logs::read_log(host, log_path).await?;

    let mut total_bans: u64 = 0;
    let mut total_unbans: u64 = 0;
    let mut total_found: u64 = 0;
    let mut bans_per_jail: HashMap<String, u64> = HashMap::new();
    let mut bans_per_ip: HashMap<String, u64> = HashMap::new();

    for entry in &entries {
        match &entry.action {
            Some(LogAction::Ban) | Some(LogAction::Restore) => {
                total_bans += 1;
                if let Some(jail) = &entry.jail {
                    *bans_per_jail.entry(jail.clone()).or_default() += 1;
                }
                if let Some(ip) = &entry.ip {
                    *bans_per_ip.entry(ip.clone()).or_default() += 1;
                }
            }
            Some(LogAction::Unban) => total_unbans += 1,
            Some(LogAction::Found) => total_found += 1,
            _ => {}
        }
    }

    let mut top_banned_ips: Vec<(String, u64)> = bans_per_ip.into_iter().collect();
    top_banned_ips.sort_by(|a, b| b.1.cmp(&a.1));
    top_banned_ips.truncate(20);

    let mut bans_by_jail: Vec<(String, u64)> = bans_per_jail.into_iter().collect();
    bans_by_jail.sort_by(|a, b| b.1.cmp(&a.1));

    Ok(LogStats {
        total_entries: entries.len() as u64,
        total_bans,
        total_unbans,
        total_found,
        top_banned_ips,
        bans_by_jail,
    })
}

/// Get per-hour ban distribution from logs.
pub async fn ban_frequency(
    host: &Fail2banHost,
    log_path: Option<&str>,
) -> Result<Vec<HourlyBanCount>, Fail2banError> {
    let entries = logs::read_log(host, log_path).await?;
    let mut hourly: HashMap<String, u64> = HashMap::new();

    for entry in &entries {
        if matches!(
            &entry.action,
            Some(LogAction::Ban) | Some(LogAction::Restore)
        ) {
            if let Some(ts) = &entry.timestamp {
                // Extract "YYYY-MM-DD HH" from the DateTime
                let hour_key = ts.format("%Y-%m-%d %H").to_string();
                *hourly.entry(hour_key).or_default() += 1;
            }
        }
    }

    let mut result: Vec<HourlyBanCount> = hourly
        .into_iter()
        .map(|(hour, count)| HourlyBanCount {
            hour,
            ban_count: count,
        })
        .collect();

    result.sort_by(|a, b| a.hour.cmp(&b.hour));
    Ok(result)
}

// ─── Types ──────────────────────────────────────────────────────────

/// Aggregated log statistics.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LogStats {
    pub total_entries: u64,
    pub total_bans: u64,
    pub total_unbans: u64,
    pub total_found: u64,
    /// Top banned IPs (ip, count) sorted desc.
    pub top_banned_ips: Vec<(String, u64)>,
    /// Bans per jail (jail, count) sorted desc.
    pub bans_by_jail: Vec<(String, u64)>,
}

/// Hourly ban distribution.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct HourlyBanCount {
    /// Hour key in format "YYYY-MM-DD HH".
    pub hour: String,
    pub ban_count: u64,
}
