// ── sorng-ups – Event log management ─────────────────────────────────────────
//! Parse UPS events from syslog / NUT log files.

use crate::client::{shell_escape, UpsClient};
use crate::error::UpsResult;
use crate::types::*;

pub struct EventManager;

impl EventManager {
    /// List recent UPS events from syslog, optionally filtered by device.
    pub async fn list(
        client: &UpsClient,
        device: Option<&str>,
        limit: Option<usize>,
    ) -> UpsResult<Vec<UpsEvent>> {
        let limit_val = limit.unwrap_or(100);
        let grep = match device {
            Some(d) => format!(
                "grep -i 'ups\\|nut\\|upsmon' /var/log/syslog 2>/dev/null | grep -i {} | tail -n {}",
                shell_escape(d),
                limit_val,
            ),
            None => format!(
                "grep -i 'ups\\|nut\\|upsmon' /var/log/syslog 2>/dev/null | tail -n {}",
                limit_val,
            ),
        };
        let out = client.exec_ssh(&grep).await?;
        Ok(Self::parse_syslog_events(&out.stdout))
    }

    /// Events from the last N hours.
    pub async fn get_recent(
        client: &UpsClient,
        device: Option<&str>,
        hours: u64,
    ) -> UpsResult<Vec<UpsEvent>> {
        let since = format!(
            "journalctl -u nut-server -u nut-monitor --since '{} hours ago' --no-pager 2>/dev/null || \
             grep -i 'ups\\|nut' /var/log/syslog 2>/dev/null | tail -n 200",
            hours
        );
        let out = client.exec_ssh(&since).await?;
        let mut events = Self::parse_syslog_events(&out.stdout);
        if let Some(d) = device {
            events.retain(|e| {
                e.device.as_deref().map(|dev| dev.contains(d)).unwrap_or(false)
                    || e.message.contains(d)
            });
        }
        Ok(events)
    }

    /// Filter events by type.
    pub async fn get_by_type(
        client: &UpsClient,
        device: Option<&str>,
        event_type: &UpsEventType,
    ) -> UpsResult<Vec<UpsEvent>> {
        let all = Self::list(client, device, Some(500)).await?;
        let type_str = format!("{:?}", event_type).to_lowercase();
        Ok(all
            .into_iter()
            .filter(|e| format!("{:?}", e.event_type).to_lowercase() == type_str)
            .collect())
    }

    /// Clear / rotate the UPS log.
    pub async fn clear_log(client: &UpsClient, _device: Option<&str>) -> UpsResult<()> {
        client
            .exec_ssh("sudo truncate -s 0 /var/log/nut/ups.log 2>/dev/null; echo ok")
            .await?;
        Ok(())
    }

    // ── Parsing ─────────────────────────────────────────────────

    fn parse_syslog_events(raw: &str) -> Vec<UpsEvent> {
        let mut events = Vec::new();
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let event_type = Self::classify_event(line);
            let severity = match &event_type {
                UpsEventType::OnBattery | UpsEventType::LowBattery | UpsEventType::Overload => {
                    Some("warning".to_string())
                }
                UpsEventType::Shutdown | UpsEventType::CommLost | UpsEventType::BatteryReplace => {
                    Some("critical".to_string())
                }
                UpsEventType::TestFailed => Some("error".to_string()),
                _ => Some("info".to_string()),
            };

            // Try to extract timestamp (first 15 chars of syslog)
            let (timestamp, message) = if line.len() > 16 && line.as_bytes()[3] == b' ' {
                (Some(line[..15].to_string()), line[16..].to_string())
            } else {
                (None, line.to_string())
            };

            events.push(UpsEvent {
                timestamp,
                device: None,
                event_type,
                message,
                severity,
            });
        }
        events
    }

    fn classify_event(line: &str) -> UpsEventType {
        let lower = line.to_lowercase();
        if lower.contains("on battery") || lower.contains("ob ") {
            UpsEventType::OnBattery
        } else if lower.contains("on line") || lower.contains("ol ") {
            UpsEventType::OnLine
        } else if lower.contains("low battery") || lower.contains("lowbatt") {
            UpsEventType::LowBattery
        } else if lower.contains("replace batt") || lower.contains("replbatt") {
            UpsEventType::BatteryReplace
        } else if lower.contains("overload") {
            UpsEventType::Overload
        } else if lower.contains("trim") {
            UpsEventType::Trim
        } else if lower.contains("boost") {
            UpsEventType::Boost
        } else if lower.contains("bypass") {
            UpsEventType::Bypass
        } else if lower.contains("ups off") || lower.contains("off ") {
            UpsEventType::Off
        } else if lower.contains("shutdown") || lower.contains("fsd") {
            UpsEventType::Shutdown
        } else if lower.contains("test start") {
            UpsEventType::TestStarted
        } else if lower.contains("test complete") || lower.contains("test done") {
            UpsEventType::TestCompleted
        } else if lower.contains("test fail") {
            UpsEventType::TestFailed
        } else if lower.contains("comm lost") || lower.contains("commlost") || lower.contains("data stale") {
            UpsEventType::CommLost
        } else if lower.contains("comm ok") || lower.contains("commok") {
            UpsEventType::CommOk
        } else {
            UpsEventType::Other
        }
    }
}
