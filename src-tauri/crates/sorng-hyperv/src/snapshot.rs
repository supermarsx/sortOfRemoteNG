//! Hyper-V checkpoint (snapshot) management — create, restore, remove,
//! rename, export, list, get tree.

use crate::error::HyperVResult;
use crate::powershell::{PsExecutor, PsScripts};
use crate::types::*;
use log::info;

/// Manager for Hyper-V checkpoint (snapshot) operations.
pub struct SnapshotManager;

impl SnapshotManager {
    // ── List / Query ─────────────────────────────────────────────────

    /// List all checkpoints for a VM.
    pub async fn list_checkpoints(
        ps: &PsExecutor,
        vm_name: &str,
    ) -> HyperVResult<Vec<CheckpointInfo>> {
        let script = format!(
            r#"@(Get-VMSnapshot -VMName '{}' | Select-Object @{{N='Id';E={{$_.Id.ToString()}}}},Name,VMName,
                @{{N='VmId';E={{$_.VMId.ToString()}}}},
                @{{N='ParentCheckpointId';E={{if($_.ParentSnapshotId){{$_.ParentSnapshotId.ToString()}}else{{$null}}}}}},
                @{{N='ParentCheckpointName';E={{$_.ParentSnapshotName}}}},
                @{{N='CheckpointType';E={{$_.SnapshotType.ToString()}}}},
                @{{N='CreationTime';E={{$_.CreationTime.ToUniversalTime().ToString('o')}}}},
                @{{N='Path';E={{$_.Path}}}},
                @{{N='SnapshotFileSize';E={{(Get-Item $_.Path -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum}}}}
            ) | ConvertTo-Json -Depth 3 -Compress"#,
            PsScripts::escape(vm_name)
        );
        ps.run_json_array(&script).await
    }

    /// Get a specific checkpoint by name.
    pub async fn get_checkpoint(
        ps: &PsExecutor,
        vm_name: &str,
        checkpoint_name: &str,
    ) -> HyperVResult<CheckpointInfo> {
        let script = format!(
            r#"Get-VMSnapshot -VMName '{}' -Name '{}' | Select-Object @{{N='Id';E={{$_.Id.ToString()}}}},Name,VMName,
                @{{N='VmId';E={{$_.VMId.ToString()}}}},
                @{{N='ParentCheckpointId';E={{if($_.ParentSnapshotId){{$_.ParentSnapshotId.ToString()}}else{{$null}}}}}},
                @{{N='ParentCheckpointName';E={{$_.ParentSnapshotName}}}},
                @{{N='CheckpointType';E={{$_.SnapshotType.ToString()}}}},
                @{{N='CreationTime';E={{$_.CreationTime.ToUniversalTime().ToString('o')}}}},
                @{{N='Path';E={{$_.Path}}}},
                @{{N='SnapshotFileSize';E={{0}}}}
            | ConvertTo-Json -Depth 3 -Compress"#,
            PsScripts::escape(vm_name),
            PsScripts::escape(checkpoint_name),
        );
        ps.run_json_as(&script).await
    }

    // ── Create ───────────────────────────────────────────────────────

    /// Create a checkpoint for a VM.
    pub async fn create_checkpoint(
        ps: &PsExecutor,
        vm_name: &str,
        config: &CreateCheckpointConfig,
    ) -> HyperVResult<CheckpointInfo> {
        let escaped = PsScripts::escape(vm_name);
        let mut cmd = format!("Checkpoint-VM -Name '{}'", escaped);

        if let Some(ref n) = config.name {
            cmd.push_str(&format!(" -SnapshotName '{}'", PsScripts::escape(n)));
        }

        // Set checkpoint type if specified
        if let Some(ref ct) = config.checkpoint_type {
            let ct_str = match ct {
                CheckpointType::Standard => "Standard",
                CheckpointType::Production => "Production",
                CheckpointType::ProductionOnly => "ProductionOnly",
                CheckpointType::Disabled => "Disabled",
            };
            // Must set on VM first
            cmd = format!(
                "Set-VM -Name '{}' -CheckpointType {}; {}",
                escaped, ct_str, cmd
            );
        }

        cmd.push_str(" -Passthru");
        cmd.push_str(&format!(
            " | Select-Object @{{N='Id';E={{$_.Id.ToString()}}}},Name,VMName,@{{N='VmId';E={{$_.VMId.ToString()}}}},@{{N='ParentCheckpointId';E={{if($_.ParentSnapshotId){{$_.ParentSnapshotId.ToString()}}else{{$null}}}}}},@{{N='ParentCheckpointName';E={{$_.ParentSnapshotName}}}},@{{N='CheckpointType';E={{$_.SnapshotType.ToString()}}}},@{{N='CreationTime';E={{$_.CreationTime.ToUniversalTime().ToString('o')}}}},@{{N='Path';E={{$_.Path}}}},@{{N='SnapshotFileSize';E={{0}}}} | ConvertTo-Json -Depth 3 -Compress"
        ));

        let cp_name = config.name.as_deref().unwrap_or("(auto)");
        info!("Creating checkpoint '{}' for VM '{}'", cp_name, vm_name);
        ps.run_json_as(&cmd).await
    }

    // ── Restore ──────────────────────────────────────────────────────

    /// Restore (apply) a checkpoint.
    pub async fn restore_checkpoint(
        ps: &PsExecutor,
        vm_name: &str,
        checkpoint_name: &str,
    ) -> HyperVResult<()> {
        info!(
            "Restoring checkpoint '{}' on VM '{}'",
            checkpoint_name, vm_name
        );
        ps.run_void(&format!(
            "Restore-VMSnapshot -VMName '{}' -Name '{}' -Confirm:$false",
            PsScripts::escape(vm_name),
            PsScripts::escape(checkpoint_name),
        ))
        .await
    }

    /// Restore checkpoint by ID.
    pub async fn restore_checkpoint_by_id(
        ps: &PsExecutor,
        vm_name: &str,
        checkpoint_id: &str,
    ) -> HyperVResult<()> {
        info!(
            "Restoring checkpoint id '{}' on VM '{}'",
            checkpoint_id, vm_name
        );
        ps.run_void(&format!(
            "Get-VMSnapshot -VMName '{}' | Where-Object {{ $_.Id.ToString() -eq '{}' }} | Restore-VMSnapshot -Confirm:$false",
            PsScripts::escape(vm_name),
            PsScripts::escape(checkpoint_id),
        ))
        .await
    }

    // ── Remove ───────────────────────────────────────────────────────

    /// Remove a single checkpoint.
    pub async fn remove_checkpoint(
        ps: &PsExecutor,
        vm_name: &str,
        checkpoint_name: &str,
    ) -> HyperVResult<()> {
        info!(
            "Removing checkpoint '{}' from VM '{}'",
            checkpoint_name, vm_name
        );
        ps.run_void(&format!(
            "Remove-VMSnapshot -VMName '{}' -Name '{}' -Confirm:$false",
            PsScripts::escape(vm_name),
            PsScripts::escape(checkpoint_name),
        ))
        .await
    }

    /// Remove a checkpoint and all child checkpoints.
    pub async fn remove_checkpoint_tree(
        ps: &PsExecutor,
        vm_name: &str,
        checkpoint_name: &str,
    ) -> HyperVResult<()> {
        info!(
            "Removing checkpoint tree '{}' from VM '{}'",
            checkpoint_name, vm_name
        );
        ps.run_void(&format!(
            "Remove-VMSnapshot -VMName '{}' -Name '{}' -IncludeAllChildSnapshots -Confirm:$false",
            PsScripts::escape(vm_name),
            PsScripts::escape(checkpoint_name),
        ))
        .await
    }

    /// Remove ALL checkpoints for a VM.
    pub async fn remove_all_checkpoints(
        ps: &PsExecutor,
        vm_name: &str,
    ) -> HyperVResult<u32> {
        info!("Removing all checkpoints from VM '{}'", vm_name);
        let script = format!(
            "$snaps = @(Get-VMSnapshot -VMName '{}'); $count = $snaps.Count; $snaps | Remove-VMSnapshot -Confirm:$false; [PSCustomObject]@{{ Count = $count }} | ConvertTo-Json -Compress",
            PsScripts::escape(vm_name),
        );
        let output = ps.run_ok(&script).await?;
        let val = output.parse_json()?;
        Ok(val.get("Count").and_then(|v| v.as_u64()).unwrap_or(0) as u32)
    }

    // ── Rename ───────────────────────────────────────────────────────

    /// Rename a checkpoint.
    pub async fn rename_checkpoint(
        ps: &PsExecutor,
        vm_name: &str,
        old_name: &str,
        new_name: &str,
    ) -> HyperVResult<()> {
        info!(
            "Renaming checkpoint '{}' -> '{}' on VM '{}'",
            old_name, new_name, vm_name
        );
        ps.run_void(&format!(
            "Rename-VMSnapshot -VMName '{}' -Name '{}' -NewName '{}'",
            PsScripts::escape(vm_name),
            PsScripts::escape(old_name),
            PsScripts::escape(new_name),
        ))
        .await
    }

    // ── Export Checkpoint ────────────────────────────────────────────

    /// Export a single checkpoint.
    pub async fn export_checkpoint(
        ps: &PsExecutor,
        vm_name: &str,
        checkpoint_name: &str,
        destination_path: &str,
    ) -> HyperVResult<()> {
        info!(
            "Exporting checkpoint '{}' of VM '{}' to '{}'",
            checkpoint_name, vm_name, destination_path
        );
        ps.run_void(&format!(
            "Export-VMSnapshot -VMName '{}' -Name '{}' -Path '{}'",
            PsScripts::escape(vm_name),
            PsScripts::escape(checkpoint_name),
            PsScripts::escape(destination_path),
        ))
        .await
    }
}
