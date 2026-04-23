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

fn parse_boot_timing(output: &str) -> Result<BootTiming, SystemdError> {
    // Example: "Startup finished in 2.5s (kernel) + 3.2s (userspace) = 5.7s"
    let line = output
        .lines()
        .find(|l| l.contains("Startup finished"))
        .ok_or_else(|| SystemdError::ParseError("No boot timing found".to_string()))?;

    let mut timing = BootTiming {
        firmware_ms: None,
        loader_ms: None,
        kernel_ms: 0,
        initrd_ms: None,
        userspace_ms: 0,
        total_ms: 0,
    };

    let after_in = line.split("in ").nth(1).unwrap_or("");
    let (segments_str, total_str) = if let Some(eq_pos) = after_in.rfind('=') {
        (&after_in[..eq_pos], after_in[eq_pos + 1..].trim())
    } else {
        (after_in, "")
    };

    timing.total_ms = parse_time_to_ms(total_str);

    for segment in segments_str.split('+') {
        let segment = segment.trim();
        if segment.is_empty() {
            continue;
        }
        let parts: Vec<&str> = segment.split_whitespace().collect();
        if parts.is_empty() {
            continue;
        }
        let time_ms = parse_time_to_ms(parts[0]);
        let phase = parts
            .get(1)
            .map(|s| s.trim_matches(|c: char| c == '(' || c == ')'));
        match phase {
            Some("firmware") => timing.firmware_ms = Some(time_ms),
            Some("loader") => timing.loader_ms = Some(time_ms),
            Some("kernel") => timing.kernel_ms = time_ms,
            Some("initrd") => timing.initrd_ms = Some(time_ms),
            Some("userspace") => timing.userspace_ms = time_ms,
            _ => {}
        }
    }

    Ok(timing)
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

fn parse_critical_chain(output: &str) -> Vec<CriticalChainEntry> {
    let mut entries = Vec::new();
    for line in output.lines() {
        let raw = line.trim_end();
        if raw.is_empty() || raw.starts_with("The time") {
            continue;
        }
        // Replace tree-drawing characters with spaces to measure indent
        let stripped = raw.replace(['└', '─', '│'], " ");
        let indent = stripped.len() - stripped.trim_start().len();
        let depth = (indent / 2) as u32;

        let content = stripped.trim();
        if content.is_empty() {
            continue;
        }

        let parts: Vec<&str> = content.split_whitespace().collect();
        if parts.is_empty() {
            continue;
        }

        let unit = parts[0].to_string();
        let mut time_after_ms = 0u64;
        let mut time_active_ms = 0u64;

        for part in &parts[1..] {
            if let Some(t) = part.strip_prefix('@') {
                time_after_ms = parse_time_to_ms(t);
            } else if let Some(t) = part.strip_prefix('+') {
                time_active_ms = parse_time_to_ms(t);
            }
        }

        entries.push(CriticalChainEntry {
            unit,
            time_after_ms,
            time_active_ms,
            depth,
        });
    }
    entries
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

    #[test]
    fn test_parse_boot_timing() {
        let output = "Startup finished in 2.5s (kernel) + 3.2s (userspace) = 5.7s\n";
        let timing = parse_boot_timing(output).unwrap();
        assert_eq!(timing.kernel_ms, 2500);
        assert_eq!(timing.userspace_ms, 3200);
        assert_eq!(timing.total_ms, 5700);
        assert!(timing.firmware_ms.is_none());
    }

    #[test]
    fn test_parse_boot_timing_full() {
        let output =
            "Startup finished in 5.1s (firmware) + 2.4s (loader) + 1.2s (kernel) + 3.4s (initrd) + 4.5s (userspace) = 16.6s\n";
        let timing = parse_boot_timing(output).unwrap();
        assert_eq!(timing.firmware_ms, Some(5100));
        assert_eq!(timing.loader_ms, Some(2400));
        assert_eq!(timing.kernel_ms, 1200);
        assert_eq!(timing.initrd_ms, Some(3400));
        assert_eq!(timing.userspace_ms, 4500);
        assert_eq!(timing.total_ms, 16600);
    }

    #[test]
    fn test_parse_critical_chain() {
        let output = "The time when unit became active or started initializing is printed after the \"@\" character.\n\
            graphical.target @5.391s\n\
            └─multi-user.target @5.391s\n\
              └─docker.service @3.256s +2.135s\n";
        let entries = parse_critical_chain(output);
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].unit, "graphical.target");
        assert_eq!(entries[0].time_after_ms, 5391);
        assert_eq!(entries[0].depth, 0);
        assert_eq!(entries[2].unit, "docker.service");
        assert_eq!(entries[2].time_active_ms, 2135);
    }
}
