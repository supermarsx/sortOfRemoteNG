//! Timer unit management.

use chrono::{DateTime, NaiveDateTime, Utc};

use crate::client;
use crate::error::SystemdError;
use crate::types::*;

/// List all active timers.
pub async fn list_timers(host: &SystemdHost) -> Result<Vec<SystemdTimer>, SystemdError> {
    let stdout = client::exec_ok(
        host,
        "systemctl",
        &[
            "list-timers",
            "--all",
            "--no-pager",
            "--plain",
            "--no-legend",
        ],
    )
    .await?;
    Ok(parse_timers(&stdout))
}

fn parse_timers(output: &str) -> Vec<SystemdTimer> {
    // list-timers --plain --no-legend columns:
    // NEXT  LEFT  LAST  PASSED  UNIT  ACTIVATES
    let mut entries = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 2 {
            continue;
        }

        let activates = parts[parts.len() - 1].to_string();
        let name = parts[parts.len() - 2].to_string();

        // Extract timestamps by finding YYYY-MM-DD date tokens
        let timing = &parts[..parts.len() - 2];
        let date_positions: Vec<usize> = timing
            .iter()
            .enumerate()
            .filter(|(_, p)| {
                p.len() == 10
                    && p.as_bytes().get(4) == Some(&b'-')
                    && p.as_bytes().get(7) == Some(&b'-')
            })
            .map(|(i, _)| i)
            .collect();

        let next_trigger = date_positions.first().and_then(|&pos| {
            if pos + 1 < timing.len() {
                let ts = format!("{} {}", timing[pos], timing[pos + 1]);
                parse_systemd_timestamp_simple(&ts)
            } else {
                None
            }
        });

        let last_trigger = date_positions.get(1).and_then(|&pos| {
            if pos + 1 < timing.len() {
                let ts = format!("{} {}", timing[pos], timing[pos + 1]);
                parse_systemd_timestamp_simple(&ts)
            } else {
                None
            }
        });

        entries.push(SystemdTimer {
            name,
            activates,
            next_trigger,
            last_trigger,
            enabled: true,
            active: true,
            calendar: None,
            on_boot_sec: None,
            on_unit_active_sec: None,
            accuracy_sec: None,
            persistent: false,
            wake_system: false,
            remain_after_elapse: true,
        });
    }
    entries
}

fn parse_systemd_timestamp_simple(s: &str) -> Option<DateTime<Utc>> {
    let naive = NaiveDateTime::parse_from_str(s.trim(), "%Y-%m-%d %H:%M:%S").ok()?;
    Some(naive.and_utc())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_timers() {
        let output = "Mon 2024-01-01 00:00:00 UTC 2h left Sun 2023-12-31 00:00:00 UTC 22h ago logrotate.timer logrotate.service\n";
        let timers = parse_timers(output);
        assert_eq!(timers.len(), 1);
        assert_eq!(timers[0].name, "logrotate.timer");
        assert_eq!(timers[0].activates, "logrotate.service");
        assert!(timers[0].next_trigger.is_some());
        assert!(timers[0].last_trigger.is_some());
    }

    #[test]
    fn test_parse_timers_na() {
        let output = "n/a n/a n/a n/a snapd.timer snap.service\n";
        let timers = parse_timers(output);
        assert_eq!(timers.len(), 1);
        assert_eq!(timers[0].name, "snapd.timer");
        assert!(timers[0].next_trigger.is_none());
        assert!(timers[0].last_trigger.is_none());
    }
}
