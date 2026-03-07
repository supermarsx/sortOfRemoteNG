//! Lifecycle Controller — jobs, SCP export/import, LC wipe.

use crate::client::IdracClient;
use crate::error::{IdracError, IdracResult};
use crate::types::*;
use crate::wsman::dcim_classes;

/// Lifecycle Controller management.
pub struct LifecycleManager<'a> {
    client: &'a IdracClient,
}

impl<'a> LifecycleManager<'a> {
    pub fn new(client: &'a IdracClient) -> Self {
        Self { client }
    }

    /// List lifecycle controller jobs.
    pub async fn list_jobs(&self) -> IdracResult<Vec<LifecycleJob>> {
        if let Ok(rf) = self.client.require_redfish() {
            // Dell OEM jobs endpoint
            let col: serde_json::Value = match rf
                .get("/redfish/v1/Managers/iDRAC.Embedded.1/Oem/Dell/Jobs?$expand=*($levels=1)")
                .await
            {
                Ok(v) => v,
                Err(_) => rf
                    .get("/redfish/v1/TaskService/Tasks?$expand=*($levels=1)")
                    .await
                    .map_err(|_| IdracError::not_found("Jobs endpoint not available"))?,
            };

            let members = col.get("Members").and_then(|v| v.as_array()).cloned().unwrap_or_default();

            return Ok(members
                .iter()
                .map(|j| LifecycleJob {
                    id: j.get("Id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    name: j.get("Name").and_then(|v| v.as_str()).unwrap_or("Job").to_string(),
                    job_type: j.get("JobType").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    job_state: j.get("JobState").or_else(|| j.get("TaskState")).and_then(|v| v.as_str()).map(|s| s.to_string()),
                    message: j.get("Message").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    message_id: j.get("MessageId").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    percent_complete: j.get("PercentComplete").and_then(|v| v.as_u64()).map(|n| n as u32),
                    start_time: j.get("StartTime").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    end_time: j.get("EndTime").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    target_uri: j.get("TargetSettingsURI").and_then(|v| v.as_str()).map(|s| s.to_string()),
                })
                .collect());
        }

        if let Ok(ws) = self.client.require_wsman() {
            let views = ws.enumerate(dcim_classes::LIFECYCLE_JOB).await?;
            return Ok(views
                .iter()
                .map(|v| {
                    let get = |k: &str| v.properties.get(k).and_then(|val| val.as_str()).map(|s| s.to_string());
                    let get_u32 = |k: &str| v.properties.get(k).and_then(|val| val.as_u64()).map(|n| n as u32);
                    LifecycleJob {
                        id: get("InstanceID").unwrap_or_default(),
                        name: get("Name").unwrap_or_else(|| "Job".to_string()),
                        job_type: get("JobType"),
                        job_state: get("JobStatus"),
                        message: get("Message"),
                        message_id: get("MessageID"),
                        percent_complete: get_u32("PercentComplete"),
                        start_time: get("StartTime"),
                        end_time: get("CompletionTime"),
                        target_uri: None,
                    }
                })
                .collect());
        }

        Err(IdracError::unsupported("Job listing requires Redfish or WSMAN"))
    }

    /// Get a specific job by ID.
    pub async fn get_job(&self, job_id: &str) -> IdracResult<LifecycleJob> {
        if let Ok(rf) = self.client.require_redfish() {
            let j: serde_json::Value = match rf
                .get(&format!("/redfish/v1/Managers/iDRAC.Embedded.1/Oem/Dell/Jobs/{}", job_id))
                .await
            {
                Ok(v) => v,
                Err(_) => rf
                    .get(&format!("/redfish/v1/TaskService/Tasks/{}", job_id))
                    .await
                    .map_err(|_| IdracError::not_found(format!("Job not found: {}", job_id)))?,
            };

            return Ok(LifecycleJob {
                id: j.get("Id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                name: j.get("Name").and_then(|v| v.as_str()).unwrap_or("Job").to_string(),
                job_type: j.get("JobType").and_then(|v| v.as_str()).map(|s| s.to_string()),
                job_state: j.get("JobState").or_else(|| j.get("TaskState")).and_then(|v| v.as_str()).map(|s| s.to_string()),
                message: j.get("Message").and_then(|v| v.as_str()).map(|s| s.to_string()),
                message_id: j.get("MessageId").and_then(|v| v.as_str()).map(|s| s.to_string()),
                percent_complete: j.get("PercentComplete").and_then(|v| v.as_u64()).map(|n| n as u32),
                start_time: j.get("StartTime").and_then(|v| v.as_str()).map(|s| s.to_string()),
                end_time: j.get("EndTime").and_then(|v| v.as_str()).map(|s| s.to_string()),
                target_uri: j.get("TargetSettingsURI").and_then(|v| v.as_str()).map(|s| s.to_string()),
            });
        }

        Err(IdracError::unsupported("Job query requires Redfish"))
    }

    /// Delete a specific job.
    pub async fn delete_job(&self, job_id: &str) -> IdracResult<()> {
        let rf = self.client.require_redfish()?;
        rf.delete(&format!(
            "/redfish/v1/Managers/iDRAC.Embedded.1/Oem/Dell/Jobs/{}",
            job_id
        ))
        .await
    }

    /// Delete all jobs (job queue purge).
    pub async fn purge_job_queue(&self) -> IdracResult<()> {
        if let Ok(rf) = self.client.require_redfish() {
            let body = serde_json::json!({
                "JobID": "JID_CLEARALL"
            });
            rf.post_action(
                "/redfish/v1/Dell/Managers/iDRAC.Embedded.1/DellJobService/Actions/DellJobService.DeleteJobQueue",
                &body,
            )
            .await?;
            return Ok(());
        }

        Err(IdracError::unsupported("Job queue purge requires Redfish"))
    }

    /// Export Server Configuration Profile (SCP) — returns job ID.
    pub async fn export_scp(&self, params: ScpExportParams) -> IdracResult<String> {
        let rf = self.client.require_redfish()?;

        let body = serde_json::json!({
            "ShareParameters": {
                "Target": params.target.as_deref().unwrap_or("ALL"),
            },
            "ExportFormat": params.format.as_deref().unwrap_or("XML"),
            "ExportUse": params.export_use.as_deref().unwrap_or("Default"),
            "IncludeInExport": params.include_in_export.as_deref().unwrap_or("Default"),
        });

        let job_uri = rf
            .post_action(
                "/redfish/v1/Managers/iDRAC.Embedded.1/Actions/Oem/EID_674_Manager.ExportSystemConfiguration",
                &body,
            )
            .await?;

        Ok(job_uri.unwrap_or_else(|| "Pending".to_string()))
    }

    /// Import Server Configuration Profile (SCP) — returns job ID.
    pub async fn import_scp(&self, params: ScpImportParams) -> IdracResult<String> {
        let rf = self.client.require_redfish()?;

        let mut body = serde_json::json!({
            "ShutdownType": params.shutdown_type.as_deref().unwrap_or("Graceful"),
            "HostPowerState": params.host_power_state.as_deref().unwrap_or("On"),
        });

        if let Some(ref content) = params.import_buffer {
            body["ImportBuffer"] = serde_json::Value::String(content.clone());
        }

        if let Some(ref target) = params.target {
            body["ShareParameters"] = serde_json::json!({ "Target": target });
        }

        let job_uri = rf
            .post_action(
                "/redfish/v1/Managers/iDRAC.Embedded.1/Actions/Oem/EID_674_Manager.ImportSystemConfiguration",
                &body,
            )
            .await?;

        Ok(job_uri.unwrap_or_else(|| "Pending".to_string()))
    }

    /// Get Lifecycle Controller status.
    pub async fn get_lc_status(&self) -> IdracResult<String> {
        if let Ok(rf) = self.client.require_redfish() {
            let mgr: serde_json::Value = rf
                .get("/redfish/v1/Managers/iDRAC.Embedded.1")
                .await?;

            let status = mgr
                .pointer("/Oem/Dell/DellAttributes/LifecycleController.Embedded.1/LCAttributes.1#LCReady")
                .or_else(|| mgr.pointer("/Status/State"))
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown");

            return Ok(status.to_string());
        }

        if let Ok(ws) = self.client.require_wsman() {
            let result = ws
                .invoke(
                    "DCIM_LCService",
                    "GetRemoteServicesAPIStatus",
                    &[
                        ("CreationClassName", "DCIM_LCService"),
                        ("SystemCreationClassName", "DCIM_ComputerSystem"),
                        ("Name", "DCIM:LCService"),
                        ("SystemName", "DCIM:ComputerSystem"),
                    ],
                    &[],
                )
                .await?;

            let status = result
                .get("LCStatus")
                .map(|v| v.as_str())
                .unwrap_or("Unknown");

            return Ok(status.to_string());
        }

        Err(IdracError::unsupported("LC status requires Redfish or WSMAN"))
    }

    /// Wait for a job to complete (polls periodically).
    pub async fn wait_for_job(
        &self,
        job_id: &str,
        timeout_secs: u64,
        poll_interval_secs: u64,
    ) -> IdracResult<LifecycleJob> {
        let start = std::time::Instant::now();
        let timeout = std::time::Duration::from_secs(timeout_secs);
        let interval = std::time::Duration::from_secs(poll_interval_secs);

        loop {
            let job = self.get_job(job_id).await?;
            let state = job.job_state.as_deref().unwrap_or("");

            match state {
                "Completed" | "CompletedWithErrors" => return Ok(job),
                "Failed" => {
                    return Err(IdracError::job(format!(
                        "Job {} failed: {}",
                        job_id,
                        job.message.as_deref().unwrap_or("Unknown error")
                    )));
                }
                _ => {}
            }

            if start.elapsed() >= timeout {
                return Err(IdracError::timeout(format!(
                    "Job {} timed out after {}s (state: {})",
                    job_id, timeout_secs, state
                )));
            }

            tokio::time::sleep(interval).await;
        }
    }

    /// Wipe the Lifecycle Controller log.
    pub async fn wipe_lifecycle_log(&self) -> IdracResult<()> {
        if let Ok(rf) = self.client.require_redfish() {
            rf.post_action(
                "/redfish/v1/Managers/iDRAC.Embedded.1/Actions/Oem/DellManager.LCWipe",
                &serde_json::json!({}),
            )
            .await?;
            return Ok(());
        }

        Err(IdracError::unsupported("LC wipe requires Redfish"))
    }
}
