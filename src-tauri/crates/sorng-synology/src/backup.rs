//! Backup management — Hyper Backup tasks and Active Backup for Business.

use crate::client::SynoClient;
use crate::error::{SynologyError, SynologyResult};
use crate::types::*;
use crate::wire;
use serde::Deserialize;

const ACTIVE_BACKUP_DEVICE: &str = "SYNO.ActiveBackup.Device";

/// The `additional` parts a Hyper Backup task list must ask for; without them
/// DSM reports only the task identity.
const BACKUP_TASK_ADDITIONAL: &str =
    r#"["last_bkp_time","next_bkp_time","last_bkp_result","is_modified"]"#;

/// One `SYNO.Backup.Task list` row from `data.task_list`. `state`/`status`
/// mirror the `status` method; the backup times and result arrive only when
/// requested in `additional`. Times are DSM's local-time text, kept as sent.
#[derive(Deserialize)]
struct BackupTaskWire {
    task_id: u32,
    name: String,
    state: Option<String>,
    status: Option<String>,
    #[serde(default, deserialize_with = "wire::opt_string_or_number")]
    last_bkp_time: Option<String>,
    #[serde(default, deserialize_with = "wire::opt_string_or_number")]
    last_bkp_end_time: Option<String>,
    last_bkp_result: Option<String>,
    #[serde(default, deserialize_with = "wire::opt_string_or_number")]
    next_bkp_time: Option<String>,
    target_type: Option<String>,
}

impl From<BackupTaskWire> for BackupTaskInfo {
    fn from(task: BackupTaskWire) -> Self {
        Self {
            task_id: task.task_id,
            name: task.name,
            status: task.status.or(task.state).or(task.last_bkp_result),
            last_backup_time: task.last_bkp_end_time.or(task.last_bkp_time),
            next_backup_time: task.next_bkp_time,
            dest_type: task.target_type,
            dest_path: None,
            total_size: None,
            transferred_size: None,
            progress: None,
        }
    }
}

/// One `SYNO.ActiveBackup.Device list` row from `data.devices`
/// (pmilano1/synology-dsm-api activebackup/core/device.md).
#[derive(Deserialize)]
struct ActiveBackupDeviceWire {
    device_id: u32,
    host_name: String,
    host_ip: Option<String>,
    os_name: Option<String>,
    backup_type: Option<i64>,
}

impl From<ActiveBackupDeviceWire> for ActiveBackupDevice {
    fn from(device: ActiveBackupDeviceWire) -> Self {
        Self {
            device_id: device.device_id,
            device_name: device.host_name,
            // DSM's numeric backup type code, not a label.
            device_type: device.backup_type.map(|kind| kind.to_string()),
            // The device list reports no backup status, last backup or agent.
            status: None,
            last_backup: None,
            agent_version: None,
            ip_address: device.host_ip,
            os_name: device.os_name,
        }
    }
}

pub struct BackupManager;

impl BackupManager {
    // ─── Hyper Backup ────────────────────────────────────────────

    /// List Hyper Backup tasks with their last and next backup.
    pub async fn list_tasks(client: &SynoClient) -> SynologyResult<Vec<BackupTaskInfo>> {
        let v = client.best_version("SYNO.Backup.Task", 1).unwrap_or(1);
        let tasks: Vec<BackupTaskWire> = client
            .api_list(
                "SYNO.Backup.Task",
                v,
                "list",
                &[("additional", BACKUP_TASK_ADDITIONAL)],
                &["task_list"],
            )
            .await?;
        Ok(tasks.into_iter().map(BackupTaskInfo::from).collect())
    }

    /// Get Hyper Backup task details.
    pub async fn get_task(client: &SynoClient, task_id: &str) -> SynologyResult<BackupTaskInfo> {
        let v = client.best_version("SYNO.Backup.Task", 1).unwrap_or(1);
        client
            .api_call("SYNO.Backup.Task", v, "get", &[("task_id", task_id)])
            .await
    }

    /// Start a Hyper Backup task.
    pub async fn start_task(client: &SynoClient, task_id: &str) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Backup.Task", 1).unwrap_or(1);
        client
            .api_post_void("SYNO.Backup.Task", v, "backup", &[("task_id", task_id)])
            .await
    }

    /// Cancel a running Hyper Backup task.
    pub async fn cancel_task(client: &SynoClient, task_id: &str) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Backup.Task", 1).unwrap_or(1);
        client
            .api_post_void("SYNO.Backup.Task", v, "cancel", &[("task_id", task_id)])
            .await
    }

    /// List backup versions (restore points) for a task.
    pub async fn list_versions(
        client: &SynoClient,
        task_id: &str,
    ) -> SynologyResult<Vec<BackupVersion>> {
        let v = client.best_version("SYNO.Backup.Task", 1).unwrap_or(1);
        client
            .api_call(
                "SYNO.Backup.Task",
                v,
                "list_version",
                &[("task_id", task_id)],
            )
            .await
    }

    /// Delete a specific backup version.
    pub async fn delete_version(
        client: &SynoClient,
        task_id: &str,
        version_id: &str,
    ) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Backup.Task", 1).unwrap_or(1);
        client
            .api_post_void(
                "SYNO.Backup.Task",
                v,
                "delete_version",
                &[("task_id", task_id), ("version_id", version_id)],
            )
            .await
    }

    /// Get backup repository / target info.
    pub async fn get_repository(
        client: &SynoClient,
        task_id: &str,
    ) -> SynologyResult<serde_json::Value> {
        let v = client
            .best_version("SYNO.Backup.Repository", 1)
            .unwrap_or(1);
        client
            .api_call("SYNO.Backup.Repository", v, "get", &[("task_id", task_id)])
            .await
    }

    // ─── Active Backup for Business ─────────────────────────────

    /// List Active Backup devices/servers. Devices come from
    /// `SYNO.ActiveBackup.Device list`; `Overview` has no device list method.
    /// Without the package this is an error, not an empty device table.
    pub async fn list_active_backup_devices(
        client: &SynoClient,
    ) -> SynologyResult<Vec<ActiveBackupDevice>> {
        if !client.has_api(ACTIVE_BACKUP_DEVICE) {
            return Err(SynologyError::api_not_found(
                "Active Backup for Business is not installed",
            ));
        }
        let v = client.best_version(ACTIVE_BACKUP_DEVICE, 1).unwrap_or(1);
        let devices: Vec<ActiveBackupDeviceWire> = client
            .api_list(ACTIVE_BACKUP_DEVICE, v, "list", &[], &["devices"])
            .await?;
        Ok(devices.into_iter().map(ActiveBackupDevice::from).collect())
    }

    /// Get Active Backup overview / dashboard data.
    pub async fn get_active_backup_overview(
        client: &SynoClient,
    ) -> SynologyResult<serde_json::Value> {
        if !client.has_api("SYNO.ActiveBackup.Overview") {
            return Ok(serde_json::json!({}));
        }
        let v = client
            .best_version("SYNO.ActiveBackup.Overview", 1)
            .unwrap_or(1);
        client
            .api_call("SYNO.ActiveBackup.Overview", v, "get", &[])
            .await
    }

    /// Run Active Backup task for a device.
    pub async fn run_active_backup(client: &SynoClient, device_id: &str) -> SynologyResult<()> {
        if !client.has_api("SYNO.ActiveBackup.Device") {
            return Ok(());
        }
        let v = client
            .best_version("SYNO.ActiveBackup.Device", 1)
            .unwrap_or(1);
        client
            .api_post_void(
                "SYNO.ActiveBackup.Device",
                v,
                "backup",
                &[("device_id", device_id)],
            )
            .await
    }

    // ─── Snapshot Replication ────────────────────────────────────

    /// List snapshot replication tasks.
    pub async fn list_replication_tasks(client: &SynoClient) -> SynologyResult<serde_json::Value> {
        if !client.has_api("SYNO.Core.Share.Snapshot") {
            return Ok(serde_json::json!([]));
        }
        let v = client
            .best_version("SYNO.Core.Share.Snapshot", 1)
            .unwrap_or(1);
        client
            .api_call("SYNO.Core.Share.Snapshot", v, "list", &[])
            .await
    }
}
