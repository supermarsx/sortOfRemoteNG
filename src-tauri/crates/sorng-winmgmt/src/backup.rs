//! Remote Windows Backup management via WMI & `wbadmin`.
//!
//! Provides operations for querying Windows backup status, listing shadow
//! copies, enumerating backup jobs, and triggering backup/restore operations
//! on remote Windows hosts through WMI-over-WinRM.
//!
//! Supported WMI classes:
//! - `Win32_ShadowCopy` – Volume Shadow Copy snapshots
//! - `Win32_ShadowStorage` – Shadow-copy storage associations
//! - `Win32_Volume` – Volume details for backup targets
//! - Remote `wbadmin` execution for Windows Server Backup operations

use crate::transport::WmiTransport;
use crate::types::*;
use crate::wql::WqlBuilder;
use log::info;
use std::collections::HashMap;

/// Manages remote Windows Backup operations via WMI.
pub struct BackupManager;

impl BackupManager {
    // ─── Shadow Copies ───────────────────────────────────────────────

    /// List all volume shadow copies on the remote host.
    pub async fn list_shadow_copies(
        transport: &mut WmiTransport,
    ) -> Result<Vec<ShadowCopy>, String> {
        let query = WqlBuilder::select("Win32_ShadowCopy").build();
        let rows = transport.wql_query(&query).await?;
        Ok(rows.iter().map(Self::row_to_shadow_copy).collect())
    }

    /// Get a single shadow copy by its ID.
    pub async fn get_shadow_copy(
        transport: &mut WmiTransport,
        shadow_id: &str,
    ) -> Result<ShadowCopy, String> {
        let query = WqlBuilder::select("Win32_ShadowCopy")
            .where_eq("ID", shadow_id)
            .build();
        let rows = transport.wql_query(&query).await?;
        let row = rows
            .first()
            .ok_or_else(|| format!("Shadow copy '{}' not found", shadow_id))?;
        Ok(Self::row_to_shadow_copy(row))
    }

    /// List shadow copies for a specific volume (e.g. "C:\\").
    pub async fn shadow_copies_by_volume(
        transport: &mut WmiTransport,
        volume_name: &str,
    ) -> Result<Vec<ShadowCopy>, String> {
        let query = WqlBuilder::select("Win32_ShadowCopy")
            .where_like("VolumeName", &format!("%{}%", volume_name))
            .build();
        let rows = transport.wql_query(&query).await?;
        Ok(rows.iter().map(Self::row_to_shadow_copy).collect())
    }

    /// Create a new shadow copy for the given volume.
    pub async fn create_shadow_copy(
        transport: &mut WmiTransport,
        volume: &str,
    ) -> Result<String, String> {
        info!("Creating shadow copy for volume: {}", volume);
        let cmd = format!(
            "powershell -Command \"(Get-WmiObject -List Win32_ShadowCopy).Create('{}', 'ClientAccessible').ShadowID\"",
            volume.replace('\'', "''")
        );
        let result = transport.exec_command(&cmd).await?;
        let shadow_id = result.trim().to_string();
        if shadow_id.is_empty() {
            return Err("Failed to create shadow copy – no ID returned".to_string());
        }
        Ok(shadow_id)
    }

    /// Delete a shadow copy by its ID.
    pub async fn delete_shadow_copy(
        transport: &mut WmiTransport,
        shadow_id: &str,
    ) -> Result<(), String> {
        info!("Deleting shadow copy: {}", shadow_id);
        let cmd = format!(
            "powershell -Command \"Get-WmiObject Win32_ShadowCopy | Where-Object {{ $_.ID -eq '{}' }} | ForEach-Object {{ $_.Delete() }}\"",
            shadow_id.replace('\'', "''")
        );
        transport.exec_command(&cmd).await?;
        Ok(())
    }

    // ─── Shadow Storage ──────────────────────────────────────────────

    /// List shadow storage associations (used vs. allocated space).
    pub async fn list_shadow_storage(
        transport: &mut WmiTransport,
    ) -> Result<Vec<ShadowStorage>, String> {
        let query = WqlBuilder::select("Win32_ShadowStorage").build();
        let rows = transport.wql_query(&query).await?;
        Ok(rows.iter().map(Self::row_to_shadow_storage).collect())
    }

    // ─── Windows Server Backup (wbadmin) ─────────────────────────────

    /// Get the overall backup status / summary via `wbadmin get status`.
    pub async fn get_backup_status(_transport: &mut WmiTransport) -> Result<BackupStatus, String> {
        Err("Remote backup status is unavailable because Win32_Process.Create does not capture stdout".to_string())
    }

    /// List recent backup versions via `wbadmin get versions`.
    pub async fn list_backup_versions(
        _transport: &mut WmiTransport,
    ) -> Result<Vec<BackupVersion>, String> {
        Err("Remote backup version listing is unavailable because Win32_Process.Create does not capture stdout".to_string())
    }

    /// Get backup configuration / policy via `wbadmin get policy` (Server editions).
    pub async fn get_backup_policy(_transport: &mut WmiTransport) -> Result<BackupPolicy, String> {
        Err("Remote backup policy is unavailable because Win32_Process.Create does not capture stdout".to_string())
    }

    /// List items (volumes/files) included in the backup configuration.
    pub async fn get_backup_items(
        _transport: &mut WmiTransport,
    ) -> Result<Vec<BackupItem>, String> {
        Err("Remote backup items are unavailable because Win32_Process.Create does not capture stdout".to_string())
    }

    /// Start an ad-hoc backup of the specified volumes.
    pub async fn start_backup(
        _transport: &mut WmiTransport,
        _params: &StartBackupParams,
    ) -> Result<BackupJobInfo, String> {
        Err("Remote backup launch is unavailable until a bounded, authenticated output channel is implemented".to_string())
    }

    /// Start a system state restore from a backup version.
    pub async fn start_restore(
        _transport: &mut WmiTransport,
        _params: &StartRestoreParams,
    ) -> Result<BackupJobInfo, String> {
        Err("Remote restore is unavailable until a bounded, authenticated output channel and explicit confirmation contract are implemented".to_string())
    }

    // ─── Backup-related System Volumes ───────────────────────────────

    /// List volumes available for backup targeting.
    pub async fn list_volumes(transport: &mut WmiTransport) -> Result<Vec<BackupVolume>, String> {
        let query = WqlBuilder::select("Win32_Volume")
            .fields(&[
                "Name",
                "DriveLetter",
                "Label",
                "Capacity",
                "FreeSpace",
                "FileSystem",
                "DriveType",
                "DeviceID",
            ])
            .build();
        let rows = transport.wql_query(&query).await?;
        Ok(rows.iter().map(Self::row_to_volume).collect())
    }

    // ─── Parsers ─────────────────────────────────────────────────────

    fn row_to_shadow_copy(row: &HashMap<String, String>) -> ShadowCopy {
        ShadowCopy {
            id: row.get("ID").cloned().unwrap_or_default(),
            shadow_id: row.get("DeviceObject").cloned().unwrap_or_default(),
            volume_name: row.get("VolumeName").cloned().unwrap_or_default(),
            install_date: row.get("InstallDate").cloned(),
            state: row
                .get("State")
                .map(|s| ShadowCopyState::from_wmi(s))
                .unwrap_or(ShadowCopyState::Unknown),
            provider_id: row.get("ProviderID").cloned(),
            count: row.get("Count").and_then(|v| v.parse().ok()).unwrap_or(0),
            client_accessible: row
                .get("ClientAccessible")
                .map(|s| s.eq_ignore_ascii_case("true"))
                .unwrap_or(false),
            persistent: row
                .get("Persistent")
                .map(|s| s.eq_ignore_ascii_case("true"))
                .unwrap_or(false),
            no_auto_release: row
                .get("NoAutoRelease")
                .map(|s| s.eq_ignore_ascii_case("true"))
                .unwrap_or(false),
            no_writers: row
                .get("NoWriters")
                .map(|s| s.eq_ignore_ascii_case("true"))
                .unwrap_or(false),
            originating_machine: row.get("OriginatingMachine").cloned(),
            service_machine: row.get("ServiceMachine").cloned(),
            exposed_name: row.get("ExposedName").cloned(),
            exposed_path: row.get("ExposedPath").cloned(),
        }
    }

    fn row_to_shadow_storage(row: &HashMap<String, String>) -> ShadowStorage {
        ShadowStorage {
            volume: row.get("Volume").cloned().unwrap_or_default(),
            diff_volume: row.get("DiffVolume").cloned().unwrap_or_default(),
            used_space: row
                .get("UsedSpace")
                .and_then(|v| v.parse().ok())
                .unwrap_or(0),
            allocated_space: row
                .get("AllocatedSpace")
                .and_then(|v| v.parse().ok())
                .unwrap_or(0),
            max_space: row
                .get("MaxSpace")
                .and_then(|v| v.parse().ok())
                .unwrap_or(0),
        }
    }

    fn row_to_volume(row: &HashMap<String, String>) -> BackupVolume {
        BackupVolume {
            name: row.get("Name").cloned().unwrap_or_default(),
            drive_letter: row.get("DriveLetter").cloned(),
            label: row.get("Label").cloned(),
            capacity: row
                .get("Capacity")
                .and_then(|v| v.parse().ok())
                .unwrap_or(0),
            free_space: row
                .get("FreeSpace")
                .and_then(|v| v.parse().ok())
                .unwrap_or(0),
            file_system: row.get("FileSystem").cloned(),
            drive_type: row
                .get("DriveType")
                .and_then(|v| v.parse().ok())
                .unwrap_or(0),
            device_id: row.get("DeviceID").cloned().unwrap_or_default(),
        }
    }
}
