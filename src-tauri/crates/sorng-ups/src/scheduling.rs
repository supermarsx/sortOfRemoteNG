//! Power schedule management – create, update, delete, run schedules.

use crate::client::UpsClient;
use crate::error::{UpsError, UpsResult};
use crate::types::*;

pub struct ScheduleManager;

impl ScheduleManager {
    /// List all power schedules.
    pub async fn list(client: &UpsClient) -> UpsResult<Vec<PowerSchedule>> {
        let content = client
            .read_remote_file("/etc/nut/schedules.json")
            .await
            .unwrap_or_else(|_| "[]".to_string());
        serde_json::from_str(&content).map_err(|e| UpsError::parse(e.to_string()))
    }

    /// Get a single schedule by ID.
    pub async fn get(client: &UpsClient, id: &str) -> UpsResult<PowerSchedule> {
        let schedules = Self::list(client).await?;
        schedules
            .into_iter()
            .find(|s| s.id == id)
            .ok_or_else(|| UpsError::schedule(format!("Schedule '{}' not found", id)))
    }

    /// Create a new power schedule.
    pub async fn create(client: &UpsClient, req: &CreateScheduleRequest) -> UpsResult<PowerSchedule> {
        let mut schedules = Self::list(client).await?;
        let schedule = PowerSchedule {
            id: uuid::Uuid::new_v4().to_string(),
            name: req.name.clone(),
            enabled: true,
            device: req.device.clone(),
            action: req.action.clone(),
            cron_expression: req.cron_expression.clone(),
            description: req.description.clone(),
        };
        schedules.push(schedule.clone());
        Self::save(client, &schedules).await?;
        Ok(schedule)
    }

    /// Update an existing schedule.
    pub async fn update(client: &UpsClient, id: &str, req: &UpdateScheduleRequest) -> UpsResult<PowerSchedule> {
        let mut schedules = Self::list(client).await?;
        let sched = schedules
            .iter_mut()
            .find(|s| s.id == id)
            .ok_or_else(|| UpsError::schedule(format!("Schedule '{}' not found", id)))?;

        if let Some(ref name) = req.name {
            sched.name = name.clone();
        }
        if let Some(enabled) = req.enabled {
            sched.enabled = enabled;
        }
        if let Some(ref action) = req.action {
            sched.action = action.clone();
        }
        if let Some(ref cron) = req.cron_expression {
            sched.cron_expression = cron.clone();
        }
        if let Some(ref desc) = req.description {
            sched.description = Some(desc.clone());
        }

        let updated = sched.clone();
        Self::save(client, &schedules).await?;
        Ok(updated)
    }

    /// Delete a schedule.
    pub async fn delete(client: &UpsClient, id: &str) -> UpsResult<()> {
        let mut schedules = Self::list(client).await?;
        let len_before = schedules.len();
        schedules.retain(|s| s.id != id);
        if schedules.len() == len_before {
            return Err(UpsError::schedule(format!("Schedule '{}' not found", id)));
        }
        Self::save(client, &schedules).await
    }

    /// Enable a schedule.
    pub async fn enable(client: &UpsClient, id: &str) -> UpsResult<PowerSchedule> {
        let req = UpdateScheduleRequest {
            name: None,
            enabled: Some(true),
            action: None,
            cron_expression: None,
            description: None,
        };
        Self::update(client, id, &req).await
    }

    /// Disable a schedule.
    pub async fn disable(client: &UpsClient, id: &str) -> UpsResult<PowerSchedule> {
        let req = UpdateScheduleRequest {
            name: None,
            enabled: Some(false),
            action: None,
            cron_expression: None,
            description: None,
        };
        Self::update(client, id, &req).await
    }

    /// Run a schedule action immediately.
    pub async fn run_now(client: &UpsClient, id: &str) -> UpsResult<CommandResult> {
        let schedule = Self::get(client, id).await?;
        let msg = match schedule.action {
            ScheduleAction::Shutdown => {
                client.upscmd(&schedule.device, "shutdown.return").await?;
                "Shutdown executed"
            }
            ScheduleAction::Restart => {
                client.upscmd(&schedule.device, "shutdown.reboot").await?;
                "Restart executed"
            }
            ScheduleAction::SelfTest => {
                client.upscmd(&schedule.device, "test.battery.start.quick").await?;
                "Self-test executed"
            }
            ScheduleAction::Calibrate => {
                client.upscmd(&schedule.device, "calibrate.start").await?;
                "Calibration executed"
            }
            ScheduleAction::OutletOn => {
                client.upscmd(&schedule.device, "load.on").await?;
                "Outlet on executed"
            }
            ScheduleAction::OutletOff => {
                client.upscmd(&schedule.device, "load.off").await?;
                "Outlet off executed"
            }
        };
        Ok(CommandResult {
            success: true,
            message: msg.to_string(),
        })
    }

    /// List schedule execution history.
    pub async fn list_history(client: &UpsClient, _schedule_id: Option<&str>) -> UpsResult<Vec<ScheduleHistoryEntry>> {
        let content = client
            .read_remote_file("/etc/nut/schedule_history.json")
            .await
            .unwrap_or_else(|_| "[]".to_string());
        serde_json::from_str(&content).map_err(|e| UpsError::parse(e.to_string()))
    }

    // ── Internal ─────────────────────────────────────────────────────

    async fn save(client: &UpsClient, schedules: &[PowerSchedule]) -> UpsResult<()> {
        let json = serde_json::to_string_pretty(schedules)
            .map_err(|e| UpsError::internal(e.to_string()))?;
        client.write_remote_file("/etc/nut/schedules.json", &json).await
    }
}
