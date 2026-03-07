// ── sorng-ups – Schedule management ───────────────────────────────────────────
//! Manage upssched-based scheduled actions (shutdown, test, etc.).

use crate::client::{shell_escape, UpsClient};
use crate::error::{UpsError, UpsResult};
use crate::types::*;

const UPSSCHED_CONF: &str = "/etc/nut/upssched.conf";

pub struct ScheduleManager;

impl ScheduleManager {
    /// List configured schedules by parsing upssched.conf and cron entries.
    pub async fn list(client: &UpsClient) -> UpsResult<Vec<UpsSchedule>> {
        let raw = client.read_remote_file(UPSSCHED_CONF).await.unwrap_or_default();
        Ok(Self::parse_schedules(&raw))
    }

    /// Get a schedule by ID.
    pub async fn get(client: &UpsClient, id: &str) -> UpsResult<UpsSchedule> {
        let schedules = Self::list(client).await?;
        schedules
            .into_iter()
            .find(|s| s.id == id)
            .ok_or_else(|| UpsError::schedule_not_found(id))
    }

    /// Create a new schedule entry (appends to crontab + upssched).
    pub async fn create(
        client: &UpsClient,
        schedule: &UpsSchedule,
    ) -> UpsResult<UpsSchedule> {
        let cron_entry = Self::to_cron_entry(schedule);
        let cmd = format!(
            "(crontab -l 2>/dev/null; echo {}) | crontab -",
            shell_escape(&cron_entry)
        );
        client.exec_ssh(&cmd).await?;
        Ok(schedule.clone())
    }

    /// Update a schedule by removing the old cron entry and adding a new one.
    pub async fn update(
        client: &UpsClient,
        id: &str,
        schedule: &UpsSchedule,
    ) -> UpsResult<UpsSchedule> {
        Self::delete(client, id).await?;
        Self::create(client, schedule).await
    }

    /// Delete a schedule (remove its cron entry by ID comment).
    pub async fn delete(client: &UpsClient, id: &str) -> UpsResult<()> {
        let cmd = format!(
            "crontab -l 2>/dev/null | grep -v {} | crontab -",
            shell_escape(&format!("# ups-schedule-{}", id)),
        );
        client.exec_ssh(&cmd).await?;
        Ok(())
    }

    /// Enable a schedule by uncommenting its cron line.
    pub async fn enable(client: &UpsClient, id: &str) -> UpsResult<()> {
        let cmd = format!(
            "crontab -l 2>/dev/null | sed 's/^#\\(.*# ups-schedule-{}\\)/\\1/' | crontab -",
            id,
        );
        client.exec_ssh(&cmd).await?;
        Ok(())
    }

    /// Disable a schedule by commenting out its cron line.
    pub async fn disable(client: &UpsClient, id: &str) -> UpsResult<()> {
        let cmd = format!(
            "crontab -l 2>/dev/null | sed 's/^\\([^#].*# ups-schedule-{}\\)/#\\1/' | crontab -",
            id,
        );
        client.exec_ssh(&cmd).await?;
        Ok(())
    }

    /// Read raw upssched.conf.
    pub async fn get_upssched_config(client: &UpsClient) -> UpsResult<String> {
        client.read_remote_file(UPSSCHED_CONF).await
    }

    /// Overwrite upssched.conf.
    pub async fn update_upssched_config(
        client: &UpsClient,
        content: &str,
    ) -> UpsResult<()> {
        client.write_remote_file(UPSSCHED_CONF, content).await
    }

    // ── Internal ────────────────────────────────────────────────

    fn parse_schedules(raw: &str) -> Vec<UpsSchedule> {
        let mut schedules = Vec::new();
        let mut idx = 0u32;
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            // AT <notifytype> <upsname> <command>
            if line.starts_with("AT ") {
                let parts: Vec<&str> = line.splitn(4, ' ').collect();
                if parts.len() >= 4 {
                    idx += 1;
                    schedules.push(UpsSchedule {
                        id: idx.to_string(),
                        name: format!("schedule-{}", idx),
                        action: UpsScheduleAction::Shutdown, // simplified
                        device: parts[2].to_string(),
                        time: String::new(),
                        days: Vec::new(),
                        enabled: true,
                        description: Some(line.to_string()),
                    });
                }
            }
        }
        schedules
    }

    fn to_cron_entry(schedule: &UpsSchedule) -> String {
        let action_cmd = match schedule.action {
            UpsScheduleAction::Shutdown => {
                format!("upscmd {} shutdown.return", schedule.device)
            }
            UpsScheduleAction::Restart => {
                format!("upscmd {} shutdown.reboot", schedule.device)
            }
            UpsScheduleAction::Test => {
                format!("upscmd {} test.battery.start.quick", schedule.device)
            }
            UpsScheduleAction::BeeperOn => {
                format!("upscmd {} beeper.enable", schedule.device)
            }
            UpsScheduleAction::BeeperOff => {
                format!("upscmd {} beeper.disable", schedule.device)
            }
            UpsScheduleAction::LoadOff => {
                format!("upscmd {} load.off", schedule.device)
            }
            UpsScheduleAction::LoadOn => {
                format!("upscmd {} load.on", schedule.device)
            }
        };
        format!(
            "{} {} # ups-schedule-{}",
            schedule.time, action_cmd, schedule.id
        )
    }
}
