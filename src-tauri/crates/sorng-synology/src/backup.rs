//! Backup management — Hyper Backup tasks and Active Backup for Business.

use crate::client::SynoClient;
use crate::error::SynologyResult;
use crate::types::*;

pub struct BackupManager;

impl BackupManager {
    // ─── Hyper Backup ────────────────────────────────────────────

    /// List Hyper Backup tasks.
    pub async fn list_tasks(client: &SynoClient) -> SynologyResult<Vec<BackupTaskInfo>> {
        let v = client.best_version("SYNO.Backup.Task", 1).unwrap_or(1);
        client.api_call("SYNO.Backup.Task", v, "list", &[]).await
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

    /// List Active Backup devices/servers.
    pub async fn list_active_backup_devices(
        client: &SynoClient,
    ) -> SynologyResult<Vec<ActiveBackupDevice>> {
        if !client.has_api("SYNO.ActiveBackup.Overview") {
            return Ok(vec![]);
        }
        let v = client
            .best_version("SYNO.ActiveBackup.Overview", 1)
            .unwrap_or(1);
        client
            .api_call("SYNO.ActiveBackup.Overview", v, "list_device", &[])
            .await
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
