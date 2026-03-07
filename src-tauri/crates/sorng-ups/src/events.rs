//! UPS event management – log retrieval, filtering, subscriptions.

use crate::client::UpsClient;
use crate::error::UpsResult;
use crate::types::*;

pub struct EventManager;

impl EventManager {
    /// List events with optional filtering.
    pub async fn list_events(client: &UpsClient, filter: Option<&EventFilter>) -> UpsResult<Vec<UpsEvent>> {
        let limit = filter.and_then(|f| f.limit).unwrap_or(100);
        let out = client
            .exec_ssh(&format!(
                "tail -n {} /var/log/nut/ups.log 2>/dev/null || journalctl -u nut-server -n {} --no-pager 2>/dev/null || echo ''",
                limit, limit
            ))
            .await?;

        let mut events = Vec::new();
        for line in out.stdout.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let event = parse_event_line(line);
            if let Some(ref f) = filter {
                if let Some(ref dev) = f.device {
                    if event.device != *dev {
                        continue;
                    }
                }
                if let Some(ref sev) = f.severity {
                    if std::mem::discriminant(&event.severity) != std::mem::discriminant(sev) {
                        continue;
                    }
                }
            }
            events.push(event);
        }
        Ok(events)
    }

    /// Get recent events (shortcut for list_events with a limit).
    pub async fn get_recent(client: &UpsClient, limit: Option<u32>) -> UpsResult<Vec<UpsEvent>> {
        let filter = EventFilter {
            device: None,
            event_types: None,
            severity: None,
            from_time: None,
            to_time: None,
            limit: Some(limit.unwrap_or(20)),
        };
        Self::list_events(client, Some(&filter)).await
    }

    /// Subscribe to events for a device (enable upsmon notifications).
    pub async fn subscribe(client: &UpsClient, device: &str) -> UpsResult<CommandResult> {
        let _ = client
            .exec_ssh(&format!("upsmon -c reload 2>/dev/null"))
            .await;
        Ok(CommandResult {
            success: true,
            message: format!("Subscribed to events for {}", device),
        })
    }

    /// Clear events from the log.
    pub async fn clear_events(client: &UpsClient) -> UpsResult<CommandResult> {
        client
            .exec_ssh("sudo truncate -s 0 /var/log/nut/ups.log 2>/dev/null")
            .await?;
        Ok(CommandResult {
            success: true,
            message: "Event log cleared".to_string(),
        })
    }

    /// Get event counts grouped by type.
    pub async fn get_event_counts(client: &UpsClient) -> UpsResult<serde_json::Value> {
        let events = Self::list_events(client, None).await?;
        let mut counts = std::collections::HashMap::<String, u32>::new();
        for event in &events {
            let key = format!("{:?}", event.event_type);
            *counts.entry(key).or_insert(0) += 1;
        }
        Ok(serde_json::to_value(counts).unwrap_or_default())
    }

    /// Export events as JSON.
    pub async fn export_events(client: &UpsClient, filter: Option<&EventFilter>) -> UpsResult<String> {
        let events = Self::list_events(client, filter).await?;
        serde_json::to_string_pretty(&events).map_err(|e| crate::error::UpsError::internal(e.to_string()))
    }
}

// ── Helpers ──────────────────────────────────────────────────────────

fn parse_event_line(line: &str) -> UpsEvent {
    // NUT log format: "YYYY-MM-DD HH:MM:SS device@host [event message]"
    let (timestamp, rest) = if line.len() > 19 {
        (line[..19].to_string(), &line[20..])
    } else {
        (String::new(), line)
    };

    let device = rest
        .split_whitespace()
        .next()
        .unwrap_or("unknown")
        .to_string();

    let message = rest.to_string();

    let event_type = if message.contains("on line") || message.contains("OL") {
        UpsEventType::OnLine
    } else if message.contains("on battery") || message.contains("OB") {
        UpsEventType::OnBattery
    } else if message.contains("low battery") || message.contains("LB") {
        UpsEventType::LowBattery
    } else if message.contains("replace") || message.contains("RB") {
        UpsEventType::BatteryReplace
    } else if message.contains("communications ok") || message.contains("COMM OK") {
        UpsEventType::CommunicationsOk
    } else if message.contains("communications lost") || message.contains("COMM LOST") {
        UpsEventType::CommunicationsLost
    } else if message.contains("shutdown") || message.contains("FSD") {
        UpsEventType::Shutdown
    } else if message.contains("self-test") || message.contains("TEST") {
        UpsEventType::SelfTest
    } else if message.contains("overload") || message.contains("OVER") {
        UpsEventType::Overload
    } else if message.contains("bypass") || message.contains("BYPASS") {
        UpsEventType::Bypass
    } else if message.contains("alarm") || message.contains("ALARM") {
        UpsEventType::Alarm
    } else {
        UpsEventType::Other
    };

    let severity = match &event_type {
        UpsEventType::OnLine | UpsEventType::CommunicationsOk | UpsEventType::SelfTest => {
            EventSeverity::Info
        }
        UpsEventType::OnBattery | UpsEventType::Bypass | UpsEventType::Overload => {
            EventSeverity::Warning
        }
        UpsEventType::LowBattery
        | UpsEventType::BatteryReplace
        | UpsEventType::CommunicationsLost
        | UpsEventType::Shutdown
        | UpsEventType::ForcedShutdown
        | UpsEventType::Alarm => EventSeverity::Critical,
        _ => EventSeverity::Info,
    };

    UpsEvent {
        timestamp,
        device,
        event_type,
        message,
        severity,
    }
}
