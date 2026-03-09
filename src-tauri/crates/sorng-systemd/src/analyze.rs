//! systemd-analyze — boot analysis, blame, critical-chain.

use crate::client;
use crate::error::SystemdError;
use crate::types::*;

/// Get boot time summary.
pub async fn boot_time(host: &SystemdHost) -> Result<BootTiming, SystemdError> {
    let stdout = client::exec_ok(host, "systemd-analyze", &["time"]).await?;
    parse_boot_timing(&stdout)
}

/// Get blame listing (units sorted by startup time).
pub async fn blame(host: &SystemdHost) -> Result<Vec<BlameEntry>, SystemdError> {
    let stdout = client::exec_ok(host, "systemd-analyze", &["blame", "--no-pager"]).await?;
    Ok(parse_blame(&stdout))
}

/// Get critical chain.
pub async fn critical_chain(
    host: &SystemdHost,
    unit: Option<&str>,
) -> Result<Vec<CriticalChainEntry>, SystemdError> {
    let mut args = vec!["critical-chain", "--no-pager"];
    if let Some(u) = unit {
        args.push(u);
    }
    let stdout = client::exec_ok(host, "systemd-analyze", &args).await?;
    Ok(parse_critical_chain(&stdout))
}

/// Verify a unit file.
pub async fn verify(host: &SystemdHost, unit: &str) -> Result<Vec<String>, SystemdError> {
    let (stdout, stderr, _) = client::exec(host, "systemd-analyze", &["verify", unit]).await?;
    let mut issues: Vec<String> = stderr.lines().map(|l| l.to_string()).collect();
    issues.extend(stdout.lines().map(|l| l.to_string()));
    Ok(issues.into_iter().filter(|l| !l.is_empty()).collect())
}

fn parse_boot_timing(_output: &str) -> Result<BootTiming, SystemdError> {
    // Example: "Startup finished in 2.5s (kernel) + 3.2s (userspace) = 5.7s"
    Ok(BootTiming {
        firmware_ms: None,
        loader_ms: None,
        kernel_ms: 0,
        initrd_ms: None,
        userspace_ms: 0,
        total_ms: 0,
    })
}

fn parse_blame(output: &str) -> Vec<BlameEntry> {
    let mut entries = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.splitn(2, char::is_whitespace).collect();
        if parts.len() == 2 {
            let time_str = parts[0];
            let ms = parse_time_to_ms(time_str);
            entries.push(BlameEntry {
                unit: parts[1].trim().to_string(),
                time_ms: ms,
            });
        }
    }
    entries
}

fn parse_critical_chain(_output: &str) -> Vec<CriticalChainEntry> {
    // TODO: parse critical-chain tree output
    Vec::new()
}

fn parse_time_to_ms(s: &str) -> u64 {
    if let Some(stripped) = s.strip_suffix("ms") {
        stripped.parse().unwrap_or(0)
    } else if let Some(stripped) = s.strip_suffix('s') {
        (stripped.parse::<f64>().unwrap_or(0.0) * 1000.0) as u64
    } else if let Some(stripped) = s.strip_suffix("min") {
        (stripped.parse::<f64>().unwrap_or(0.0) * 60_000.0) as u64
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_time() {
        assert_eq!(parse_time_to_ms("350ms"), 350);
        assert_eq!(parse_time_to_ms("2.5s"), 2500);
        assert_eq!(parse_time_to_ms("1min"), 60000);
    }

    #[test]
    fn test_parse_blame() {
        let output = "  2.500s NetworkManager.service\n  1.200s systemd-udev-settle.service\n";
        let entries = parse_blame(output);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].unit, "NetworkManager.service");
        assert_eq!(entries[0].time_ms, 2500);
    }
}
