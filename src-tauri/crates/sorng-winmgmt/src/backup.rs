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
use log::{debug, info};
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
    pub async fn get_backup_status(transport: &mut WmiTransport) -> Result<BackupStatus, String> {
        debug!("Querying backup status via wbadmin");
        let cmd = "wbadmin get status 2>&1";
        let output = transport.exec_command(cmd).await?;
        Ok(Self::parse_backup_status(&output))
    }

    /// List recent backup versions via `wbadmin get versions`.
    pub async fn list_backup_versions(
        transport: &mut WmiTransport,
    ) -> Result<Vec<BackupVersion>, String> {
        debug!("Querying backup versions via wbadmin");
        let cmd = "wbadmin get versions 2>&1";
        let output = transport.exec_command(cmd).await?;
        Ok(Self::parse_backup_versions(&output))
    }

    /// Get backup configuration / policy via `wbadmin get policy` (Server editions).
    pub async fn get_backup_policy(transport: &mut WmiTransport) -> Result<BackupPolicy, String> {
        debug!("Querying backup policy via wbadmin");
        let cmd = "wbadmin get policy 2>&1";
        let output = transport.exec_command(cmd).await?;
        Ok(Self::parse_backup_policy(&output))
    }

    /// List items (volumes/files) included in the backup configuration.
    pub async fn get_backup_items(transport: &mut WmiTransport) -> Result<Vec<BackupItem>, String> {
        debug!("Querying backup items via wbadmin");
        let cmd = "wbadmin get items 2>&1";
        let output = transport.exec_command(cmd).await?;
        Ok(Self::parse_backup_items(&output))
    }

    /// Start an ad-hoc backup of the specified volumes.
    pub async fn start_backup(
        transport: &mut WmiTransport,
        params: &StartBackupParams,
    ) -> Result<BackupJobInfo, String> {
        info!("Starting backup: {:?}", params);
        let mut cmd = String::from("wbadmin start backup");

        if !params.include_volumes.is_empty() {
            cmd.push_str(&format!(" -include:{}", params.include_volumes.join(",")));
        }
        if let Some(ref target) = params.backup_target {
            cmd.push_str(&format!(" -backupTarget:{}", target));
        }
        if params.all_critical {
            cmd.push_str(" -allCritical");
        }
        if params.system_state {
            cmd.push_str(" -systemState");
        }
        if params.vss_full {
            cmd.push_str(" -vssFull");
        } else if params.vss_copy {
            cmd.push_str(" -vssCopy");
        }
        cmd.push_str(" -quiet");
        cmd.push_str(" 2>&1");

        let output = transport.exec_command(&cmd).await?;
        Ok(Self::parse_backup_job(&output))
    }

    /// Start a system state restore from a backup version.
    pub async fn start_restore(
        transport: &mut WmiTransport,
        params: &StartRestoreParams,
    ) -> Result<BackupJobInfo, String> {
        info!("Starting restore: {:?}", params);
        let mut cmd = String::from("wbadmin start recovery");

        cmd.push_str(&format!(" -version:{}", params.version_id));

        match &params.recovery_type {
            RecoveryType::Volume { source, target } => {
                cmd.push_str(&format!(
                    " -itemType:Volume -items:{} -recoveryTarget:{}",
                    source, target
                ));
            }
            RecoveryType::File {
                source_path,
                target_path,
                recursive,
            } => {
                cmd.push_str(&format!(
                    " -itemType:File -items:{} -recoveryTarget:{}",
                    source_path, target_path
                ));
                if *recursive {
                    cmd.push_str(" -recursive");
                }
            }
            RecoveryType::SystemState => {
                cmd.push_str(" -itemType:SystemState");
            }
        }
        cmd.push_str(" -quiet");
        cmd.push_str(" 2>&1");

        let output = transport.exec_command(&cmd).await?;
        Ok(Self::parse_backup_job(&output))
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

    fn parse_backup_status(output: &str) -> BackupStatus {
        let running = output.contains("currently running") || output.contains("in progress");
        let last_success = Self::extract_line_value(output, "Last successful");
        let last_failure = Self::extract_line_value(output, "Last failed");
        let next_scheduled = Self::extract_line_value(output, "Next scheduled");
        let current_operation = if running {
            Self::extract_line_value(output, "Operation")
        } else {
            None
        };
        let progress_percent = Self::extract_percent(output);

        BackupStatus {
            is_running: running,
            current_operation,
            progress_percent,
            last_successful_backup: last_success,
            last_failed_backup: last_failure,
            next_scheduled_backup: next_scheduled,
            raw_output: output.to_string(),
        }
    }

    fn parse_backup_versions(output: &str) -> Vec<BackupVersion> {
        let mut versions = Vec::new();
        let mut current: Option<BackupVersion> = None;

        for line in output.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("Version identifier:") || trimmed.starts_with("Backup time:") {
                if let Some(v) = current.take() {
                    versions.push(v);
                }
                current = Some(BackupVersion {
                    version_id: Self::after_colon(trimmed).to_string(),
                    backup_time: None,
                    backup_location: None,
                    version_info: None,
                    can_recover: true,
                });
            } else if let Some(ref mut v) = current {
                if trimmed.starts_with("Backup time:") || trimmed.starts_with("Backup Time:") {
                    v.backup_time = Some(Self::after_colon(trimmed).to_string());
                } else if trimmed.starts_with("Backup location:")
                    || trimmed.starts_with("Backup Location:")
                {
                    v.backup_location = Some(Self::after_colon(trimmed).to_string());
                } else if trimmed.starts_with("Version:") {
                    v.version_info = Some(Self::after_colon(trimmed).to_string());
                } else if trimmed.contains("can recover:") {
                    v.can_recover = !trimmed.to_lowercase().contains("no");
                }
            }
        }
        if let Some(v) = current {
            versions.push(v);
        }
        versions
    }

    fn parse_backup_policy(output: &str) -> BackupPolicy {
        let schedule = Self::extract_line_value(output, "Schedule");
        let target = Self::extract_line_value(output, "Backup target");
        let volumes: Vec<String> = output
            .lines()
            .filter(|l| l.trim().starts_with("Volume"))
            .map(|l| Self::after_colon(l.trim()).to_string())
            .collect();
        let system_state = output.to_lowercase().contains("system state");
        let bare_metal = output.to_lowercase().contains("bare metal");
        let configured = !output.to_lowercase().contains("no backup policy");

        BackupPolicy {
            configured,
            schedule,
            backup_target: target,
            included_volumes: volumes,
            system_state_backup: system_state,
            bare_metal_recovery: bare_metal,
            raw_output: output.to_string(),
        }
    }

    fn parse_backup_items(output: &str) -> Vec<BackupItem> {
        let mut items = Vec::new();
        for line in output.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with("wbadmin") || trimmed.starts_with("--") {
                continue;
            }
            // Try to detect volume or file items
            if trimmed.contains(':') {
                let name = trimmed.to_string();
                let item_type = if trimmed.contains("\\\\?\\Volume")
                    || (trimmed.len() >= 2 && trimmed.chars().nth(1) == Some(':'))
                {
                    BackupItemType::Volume
                } else if trimmed.to_lowercase().contains("system state") {
                    BackupItemType::SystemState
                } else {
                    BackupItemType::File
                };
                items.push(BackupItem {
                    name,
                    item_type,
                    size: None,
                });
            }
        }
        items
    }

    fn parse_backup_job(output: &str) -> BackupJobInfo {
        let success = output.to_lowercase().contains("completed successfully")
            || output
                .to_lowercase()
                .contains("the backup operation completed");
        let error = if output.to_lowercase().contains("error")
            || output.to_lowercase().contains("failed")
        {
            Some(
                output
                    .lines()
                    .find(|l| {
                        let lower = l.to_lowercase();
                        lower.contains("error") || lower.contains("failed")
                    })
                    .unwrap_or("Unknown error")
                    .to_string(),
            )
        } else {
            None
        };
        BackupJobInfo {
            success,
            error,
            raw_output: output.to_string(),
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────────

    fn extract_line_value(output: &str, prefix: &str) -> Option<String> {
        output.lines().find_map(|l| {
            let trimmed = l.trim();
            if trimmed.to_lowercase().contains(&prefix.to_lowercase()) && trimmed.contains(':') {
                let after = Self::after_colon(trimmed).trim().to_string();
                if after.is_empty() {
                    None
                } else {
                    Some(after)
                }
            } else {
                None
            }
        })
    }

    fn extract_percent(output: &str) -> Option<f64> {
        output.lines().find_map(|l| {
            if let Some(pos) = l.find('%') {
                // Walk backward to find the number
                let before = &l[..pos];
                let num_str: String = before
                    .chars()
                    .rev()
                    .take_while(|c| c.is_ascii_digit() || *c == '.')
                    .collect::<String>()
                    .chars()
                    .rev()
                    .collect();
                num_str.parse::<f64>().ok()
            } else {
                None
            }
        })
    }

    fn after_colon(s: &str) -> &str {
        match s.find(':') {
            Some(i) => s[i + 1..].trim(),
            None => s.trim(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_backup_status_idle() {
        let output = "No backup is currently running.\nLast successful backup: 03/01/2026 02:00\nNext scheduled backup: 03/02/2026 02:00\n";
        let status = BackupManager::parse_backup_status(output);
        assert!(!status.is_running);
        assert_eq!(
            status.last_successful_backup.as_deref(),
            Some("03/01/2026 02:00")
        );
        assert_eq!(
            status.next_scheduled_backup.as_deref(),
            Some("03/02/2026 02:00")
        );
    }

    #[test]
    fn parse_backup_status_running() {
        let output = "A backup is currently running.\nOperation: Volume backup\nProgress: 45%\n";
        let status = BackupManager::parse_backup_status(output);
        assert!(status.is_running);
        assert_eq!(status.progress_percent, Some(45.0));
    }

    #[test]
    fn parse_backup_versions_multiple() {
        let output = "\
Version identifier: 03/01/2026-09:00
Backup time: 03/01/2026 02:00
Backup location: E:\\WindowsImageBackup

Version identifier: 02/28/2026-09:00
Backup time: 02/28/2026 02:00
Backup location: E:\\WindowsImageBackup
";
        let versions = BackupManager::parse_backup_versions(output);
        assert_eq!(versions.len(), 2);
        assert_eq!(versions[0].version_id, "03/01/2026-09:00");
    }

    #[test]
    fn parse_backup_policy_configured() {
        let output = "\
Schedule: Daily at 02:00
Backup target: E:\\
Volume: C:
Volume: D:
System state: Included
";
        let policy = BackupManager::parse_backup_policy(output);
        assert!(policy.configured);
        assert!(policy.system_state_backup);
        assert_eq!(policy.included_volumes.len(), 2);
    }

    #[test]
    fn parse_backup_policy_unconfigured() {
        let output = "No backup policy is configured.\n";
        let policy = BackupManager::parse_backup_policy(output);
        assert!(!policy.configured);
    }

    #[test]
    fn parse_backup_job_success() {
        let output = "The backup operation completed successfully.\n";
        let job = BackupManager::parse_backup_job(output);
        assert!(job.success);
        assert!(job.error.is_none());
    }

    #[test]
    fn parse_backup_job_failure() {
        let output = "ERROR - The backup operation has failed.\nDisk is full.\n";
        let job = BackupManager::parse_backup_job(output);
        assert!(!job.success);
        assert!(job.error.is_some());
    }
}
