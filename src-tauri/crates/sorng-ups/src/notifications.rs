// ── sorng-ups – Notification management ──────────────────────────────────────
//! Configure upsmon NOTIFYFLAG, NOTIFYMSG, and NOTIFYCMD directives.

use crate::client::UpsClient;
use crate::error::UpsResult;
use crate::types::*;

const UPSMON_CONF: &str = "/etc/nut/upsmon.conf";

/// Known NUT notification event types.
const NOTIFY_TYPES: &[&str] = &[
    "ONLINE", "ONBATT", "LOWBATT", "FSD", "COMMOK", "COMMBAD", "SHUTDOWN", "REPLBATT", "NOCOMM",
    "NOPARENT",
];

pub struct NotificationManager;

impl NotificationManager {
    /// List all configured notifications from upsmon.conf.
    pub async fn list(client: &UpsClient) -> UpsResult<Vec<UpsNotification>> {
        let raw = client
            .read_remote_file(UPSMON_CONF)
            .await
            .unwrap_or_default();
        let mut notifications = Vec::new();

        for event_type in NOTIFY_TYPES {
            let message = Self::find_notifymsg(&raw, event_type);
            let flags = Self::find_notifyflag(&raw, event_type);
            notifications.push(UpsNotification {
                id: event_type.to_lowercase(),
                event_type: event_type.to_string(),
                message,
                exec_cmd: Self::find_notifycmd(&raw),
                flags: Some(flags),
            });
        }
        Ok(notifications)
    }

    /// Get flags for a specific event type.
    pub async fn get_flags(client: &UpsClient, event_type: &str) -> UpsResult<NotifyFlags> {
        let raw = client
            .read_remote_file(UPSMON_CONF)
            .await
            .unwrap_or_default();
        Ok(Self::find_notifyflag(&raw, event_type))
    }

    /// Set NOTIFYFLAG for a specific event type.
    pub async fn set_flags(
        client: &UpsClient,
        event_type: &str,
        flags: &NotifyFlags,
    ) -> UpsResult<()> {
        let raw = client
            .read_remote_file(UPSMON_CONF)
            .await
            .unwrap_or_default();
        let flag_str = Self::flags_to_string(flags);
        let directive = format!("NOTIFYFLAG {} {}", event_type, flag_str);

        let new_content =
            Self::replace_or_append_directive(&raw, "NOTIFYFLAG", event_type, &directive);
        client.write_remote_file(UPSMON_CONF, &new_content).await
    }

    /// Get the NOTIFYMSG for a specific event type.
    pub async fn get_message(client: &UpsClient, event_type: &str) -> UpsResult<String> {
        let raw = client
            .read_remote_file(UPSMON_CONF)
            .await
            .unwrap_or_default();
        Ok(Self::find_notifymsg(&raw, event_type).unwrap_or_default())
    }

    /// Set NOTIFYMSG for a specific event type.
    pub async fn set_message(client: &UpsClient, event_type: &str, message: &str) -> UpsResult<()> {
        let raw = client
            .read_remote_file(UPSMON_CONF)
            .await
            .unwrap_or_default();
        let directive = format!("NOTIFYMSG {} \"{}\"", event_type, message);
        let new_content =
            Self::replace_or_append_directive(&raw, "NOTIFYMSG", event_type, &directive);
        client.write_remote_file(UPSMON_CONF, &new_content).await
    }

    /// Get the global NOTIFYCMD.
    pub async fn get_notify_cmd(client: &UpsClient) -> UpsResult<String> {
        let raw = client
            .read_remote_file(UPSMON_CONF)
            .await
            .unwrap_or_default();
        Ok(Self::find_notifycmd(&raw).unwrap_or_default())
    }

    /// Set the global NOTIFYCMD.
    pub async fn set_notify_cmd(client: &UpsClient, cmd: &str) -> UpsResult<()> {
        let raw = client
            .read_remote_file(UPSMON_CONF)
            .await
            .unwrap_or_default();
        let directive = format!("NOTIFYCMD {}", cmd);
        let mut found = false;
        let new_content: String = raw
            .lines()
            .map(|line| {
                if line.trim_start().starts_with("NOTIFYCMD ") {
                    found = true;
                    directive.clone()
                } else {
                    line.to_string()
                }
            })
            .collect::<Vec<_>>()
            .join("\n");
        let final_content = if found {
            new_content
        } else {
            format!("{}\n{}\n", new_content, directive)
        };
        client.write_remote_file(UPSMON_CONF, &final_content).await
    }

    /// Test a notification by running NOTIFYCMD with a test message.
    pub async fn test_notification(client: &UpsClient, event_type: &str) -> UpsResult<()> {
        let notify_cmd = Self::get_notify_cmd(client).await?;
        if notify_cmd.is_empty() {
            return Err(crate::error::UpsError::config("No NOTIFYCMD configured"));
        }
        let cmd = format!("NOTIFYTYPE={} {} 2>&1 || true", event_type, notify_cmd);
        client.exec_ssh(&cmd).await?;
        Ok(())
    }

    // ── Internal parsing helpers ─────────────────────────────────

    fn find_notifymsg(raw: &str, event_type: &str) -> Option<String> {
        let prefix = format!("NOTIFYMSG {}", event_type);
        for line in raw.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with(&prefix) {
                let rest = trimmed[prefix.len()..].trim();
                return Some(rest.trim_matches('"').to_string());
            }
        }
        None
    }

    fn find_notifyflag(raw: &str, event_type: &str) -> NotifyFlags {
        let prefix = format!("NOTIFYFLAG {}", event_type);
        for line in raw.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with(&prefix) {
                let rest = trimmed[prefix.len()..].trim();
                return Self::parse_flags(rest);
            }
        }
        NotifyFlags {
            syslog: false,
            wall: false,
            exec: false,
            ignore: false,
        }
    }

    fn find_notifycmd(raw: &str) -> Option<String> {
        for line in raw.lines() {
            let trimmed = line.trim();
            if let Some(stripped) = trimmed.strip_prefix("NOTIFYCMD ") {
                return Some(stripped.trim().to_string());
            }
        }
        None
    }

    fn parse_flags(s: &str) -> NotifyFlags {
        let parts: Vec<&str> = s.split('+').map(|p| p.trim()).collect();
        NotifyFlags {
            syslog: parts.iter().any(|p| p.eq_ignore_ascii_case("SYSLOG")),
            wall: parts.iter().any(|p| p.eq_ignore_ascii_case("WALL")),
            exec: parts.iter().any(|p| p.eq_ignore_ascii_case("EXEC")),
            ignore: parts.iter().any(|p| p.eq_ignore_ascii_case("IGNORE")),
        }
    }

    fn flags_to_string(flags: &NotifyFlags) -> String {
        let mut parts = Vec::new();
        if flags.syslog {
            parts.push("SYSLOG");
        }
        if flags.wall {
            parts.push("WALL");
        }
        if flags.exec {
            parts.push("EXEC");
        }
        if flags.ignore {
            parts.push("IGNORE");
        }
        if parts.is_empty() {
            "IGNORE".to_string()
        } else {
            parts.join("+")
        }
    }

    fn replace_or_append_directive(
        raw: &str,
        directive: &str,
        event_type: &str,
        new_line: &str,
    ) -> String {
        let prefix = format!("{} {}", directive, event_type);
        let mut found = false;
        let new_content: String = raw
            .lines()
            .map(|line| {
                if line.trim_start().starts_with(&prefix) {
                    found = true;
                    new_line.to_string()
                } else {
                    line.to_string()
                }
            })
            .collect::<Vec<_>>()
            .join("\n");
        if found {
            new_content
        } else {
            format!("{}\n{}\n", new_content, new_line)
        }
    }
}
