//! cgroup resource control — CPU, memory, IO limits and monitoring.

use crate::client;
use crate::error::SystemdError;
use crate::types::*;

/// Get resource usage for top units (like systemd-cgtop).
pub async fn cgtop(
    host: &SystemdHost,
    count: Option<u32>,
) -> Result<Vec<CgroupStats>, SystemdError> {
    let _n = count.unwrap_or(20).to_string();
    let stdout = client::exec_ok(host, "systemd-cgtop", &["-b", "-n", "1", "--depth=1"]).await?;
    Ok(parse_cgtop(&stdout))
}

/// Set resource limits for a unit at runtime.
pub async fn set_property(
    host: &SystemdHost,
    unit: &str,
    property: &str,
    value: &str,
) -> Result<(), SystemdError> {
    client::exec_ok(
        host,
        "systemctl",
        &["set-property", unit, &format!("{property}={value}")],
    )
    .await?;
    Ok(())
}

fn parse_cgtop(output: &str) -> Vec<CgroupStats> {
    let mut entries = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("Control Group") {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        // Need at least: PATH TASKS CPU MEM IO_IN IO_OUT
        if parts.len() < 6 {
            continue;
        }
        let field_count = 5;
        let path_parts = &parts[..parts.len() - field_count];
        let unit = path_parts.join(" ");
        let fields = &parts[parts.len() - field_count..];

        entries.push(CgroupStats {
            unit,
            tasks: parse_dash_u32(fields[0]),
            cpu_percent: parse_dash_f64(fields[1]),
            memory_bytes: parse_memory_value(fields[2]),
            io_read_bytes: parse_memory_value(fields[3]),
            io_write_bytes: parse_memory_value(fields[4]),
        });
    }
    entries
}

fn parse_dash_u32(s: &str) -> u32 {
    if s == "-" {
        return 0;
    }
    s.parse().unwrap_or(0)
}

fn parse_dash_f64(s: &str) -> f64 {
    if s == "-" {
        return 0.0;
    }
    s.parse().unwrap_or(0.0)
}

fn parse_memory_value(s: &str) -> u64 {
    if s == "-" {
        return 0;
    }
    let s = s.trim();
    if let Some(v) = s.strip_suffix('G') {
        (v.parse::<f64>().unwrap_or(0.0) * 1_073_741_824.0) as u64
    } else if let Some(v) = s.strip_suffix('M') {
        (v.parse::<f64>().unwrap_or(0.0) * 1_048_576.0) as u64
    } else if let Some(v) = s.strip_suffix('K') {
        (v.parse::<f64>().unwrap_or(0.0) * 1024.0) as u64
    } else if let Some(v) = s.strip_suffix('B') {
        v.trim().parse().unwrap_or(0)
    } else {
        s.parse().unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_cgtop() {
        let output =
            "Control Group                            Tasks   %CPU   Memory  Input/s Output/s\n\
            /                                          123   12.3     1.2G       -       -\n\
            /system.slice                               45    5.6   456.7M       -       -\n";
        let entries = parse_cgtop(output);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].unit, "/");
        assert_eq!(entries[0].tasks, 123);
        assert!((entries[0].cpu_percent - 12.3).abs() < 0.01);
        assert_eq!(entries[1].unit, "/system.slice");
    }

    #[test]
    fn test_parse_memory_value() {
        assert_eq!(parse_memory_value("1.0G"), 1_073_741_824);
        assert_eq!(parse_memory_value("512.0M"), 536_870_912);
        assert_eq!(parse_memory_value("1024K"), 1_048_576);
        assert_eq!(parse_memory_value("-"), 0);
    }
}
