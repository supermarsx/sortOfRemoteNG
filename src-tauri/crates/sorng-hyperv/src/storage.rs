//! Hyper-V virtual hard disk (VHD / VHDX / VHDSet) management —
//! create, resize, compact, convert, mount, dismount, merge, optimise,
//! inspect, and test.

use crate::error::HyperVResult;
use crate::powershell::{PsExecutor, PsScripts};
use crate::types::*;
use log::info;

/// Manager for VHD / VHDX storage operations.
pub struct StorageManager;

impl StorageManager {
    // ── Query / Inspect ─────────────────────────────────────────────

    /// Get detailed information about a VHD.
    pub async fn get_vhd(ps: &PsExecutor, path: &str) -> HyperVResult<VhdInfo> {
        let script = format!(
            r#"$v = Get-VHD -Path '{}'; [PSCustomObject]@{{
                Path              = $v.Path
                Format            = $v.VhdFormat.ToString()
                VhdType           = $v.VhdType.ToString()
                FileSize          = $v.FileSize
                MaxInternalSize   = $v.Size
                MinimumSize       = $v.MinimumSize
                BlockSize         = $v.BlockSize
                LogicalSectorSize = $v.LogicalSectorSize
                PhysicalSectorSize= $v.PhysicalSectorSize
                ParentPath        = $v.ParentPath
                FragmentationPercentage = $v.FragmentationPercentage
                AttachedTo        = $v.ComputerName
                IsAttached        = $v.Attached
                DiskIdentifier    = if($v.DiskIdentifier){{$v.DiskIdentifier.ToString()}}else{{''}}
            }} | ConvertTo-Json -Depth 3 -Compress"#,
            PsScripts::escape(path)
        );
        ps.run_json_as(&script).await
    }

    /// Test VHD integrity.
    pub async fn test_vhd(ps: &PsExecutor, path: &str) -> HyperVResult<bool> {
        let script = format!(
            "Test-VHD -Path '{}' | ConvertTo-Json -Compress",
            PsScripts::escape(path)
        );
        let output = ps.run_ok(&script).await?;
        // Test-VHD returns True/False
        Ok(output.stdout.trim().to_lowercase().contains("true"))
    }

    // ── Create ──────────────────────────────────────────────────────

    /// Create a new VHD / VHDX.
    pub async fn create_vhd(ps: &PsExecutor, config: &VhdCreateConfig) -> HyperVResult<VhdInfo> {
        let size_bytes = config.size_gb * 1024 * 1024 * 1024;

        let mut cmd;

        // Differencing disk?
        if let Some(ref parent) = config.parent_path {
            cmd = format!(
                "New-VHD -Path '{}' -ParentPath '{}' -Differencing",
                PsScripts::escape(&config.path),
                PsScripts::escape(parent),
            );
        } else {
            let type_flag = match config.vhd_type {
                VhdType::Fixed => "-Fixed",
                VhdType::Dynamic => "-Dynamic",
                VhdType::Differencing => "-Dynamic", // fallback
            };

            cmd = format!(
                "New-VHD -Path '{}' -SizeBytes {} {}",
                PsScripts::escape(&config.path),
                size_bytes,
                type_flag,
            );
        }

        // Block size
        if config.block_size_mb > 0 {
            cmd.push_str(&format!(
                " -BlockSizeBytes {}",
                (config.block_size_mb as u64) * 1024 * 1024
            ));
        }

        // Logical sector size
        if config.logical_sector_size == 4096 || config.logical_sector_size == 512 {
            cmd.push_str(&format!(
                " -LogicalSectorSizeBytes {}",
                config.logical_sector_size
            ));
        }

        // Physical sector size
        if config.physical_sector_size == 4096 || config.physical_sector_size == 512 {
            cmd.push_str(&format!(
                " -PhysicalSectorSizeBytes {}",
                config.physical_sector_size
            ));
        }

        info!("Creating VHD: {}", config.path);
        ps.run_void(&cmd).await?;

        // Return the info of the newly created VHD
        Self::get_vhd(ps, &config.path).await
    }

    // ── Resize ──────────────────────────────────────────────────────

    /// Resize a VHD.
    pub async fn resize_vhd(ps: &PsExecutor, config: &VhdResizeConfig) -> HyperVResult<VhdInfo> {
        let size_bytes = config.size_gb * 1024 * 1024 * 1024;
        info!("Resizing VHD '{}' to {} GB", config.path, config.size_gb);
        ps.run_void(&format!(
            "Resize-VHD -Path '{}' -SizeBytes {}",
            PsScripts::escape(&config.path),
            size_bytes,
        ))
        .await?;
        Self::get_vhd(ps, &config.path).await
    }

    // ── Convert ─────────────────────────────────────────────────────

    /// Convert a VHD from one format/type to another.
    pub async fn convert_vhd(
        ps: &PsExecutor,
        config: &VhdConvertConfig,
    ) -> HyperVResult<VhdInfo> {
        let format_str = match config.format {
            VhdFormat::VHD => "VHD",
            VhdFormat::VHDX => "VHDX",
            VhdFormat::VHDSet => "VHDSet",
        };
        let type_str = match config.vhd_type {
            VhdType::Fixed => "Fixed",
            VhdType::Dynamic => "Dynamic",
            VhdType::Differencing => "Differencing",
        };

        info!(
            "Converting VHD '{}' -> '{}' (format={}, type={})",
            config.source_path, config.destination_path, format_str, type_str
        );

        ps.run_void(&format!(
            "Convert-VHD -Path '{}' -DestinationPath '{}' -VHDType {}",
            PsScripts::escape(&config.source_path),
            PsScripts::escape(&config.destination_path),
            type_str,
        ))
        .await?;
        Self::get_vhd(ps, &config.destination_path).await
    }

    // ── Compact / Optimise ──────────────────────────────────────────

    /// Compact a dynamic VHD to reclaim unused space.
    pub async fn compact_vhd(ps: &PsExecutor, path: &str) -> HyperVResult<VhdInfo> {
        info!("Compacting VHD '{}'", path);
        ps.run_void(&format!(
            "Optimize-VHD -Path '{}' -Mode Full",
            PsScripts::escape(path)
        ))
        .await?;
        Self::get_vhd(ps, path).await
    }

    /// Quick-optimise a VHD (precompact only).
    pub async fn optimize_vhd(ps: &PsExecutor, path: &str) -> HyperVResult<VhdInfo> {
        info!("Optimizing VHD '{}'", path);
        ps.run_void(&format!(
            "Optimize-VHD -Path '{}' -Mode Quick",
            PsScripts::escape(path)
        ))
        .await?;
        Self::get_vhd(ps, path).await
    }

    // ── Merge ───────────────────────────────────────────────────────

    /// Merge a differencing disk into its parent.
    pub async fn merge_vhd(ps: &PsExecutor, path: &str) -> HyperVResult<()> {
        info!("Merging VHD '{}'", path);
        ps.run_void(&format!(
            "Merge-VHD -Path '{}'",
            PsScripts::escape(path)
        ))
        .await
    }

    /// Merge a differencing disk to a specific destination.
    pub async fn merge_vhd_to(
        ps: &PsExecutor,
        path: &str,
        destination_path: &str,
    ) -> HyperVResult<()> {
        info!("Merging VHD '{}' -> '{}'", path, destination_path);
        ps.run_void(&format!(
            "Merge-VHD -Path '{}' -DestinationPath '{}'",
            PsScripts::escape(path),
            PsScripts::escape(destination_path),
        ))
        .await
    }

    // ── Mount / Dismount ────────────────────────────────────────────

    /// Mount a VHD to the host OS.
    pub async fn mount_vhd(
        ps: &PsExecutor,
        path: &str,
        read_only: bool,
    ) -> HyperVResult<String> {
        info!("Mounting VHD '{}' (read_only={})", path, read_only);
        let ro = if read_only { " -ReadOnly" } else { "" };
        let script = format!(
            "$disk = Mount-VHD -Path '{}'{} -Passthru; $disk | Get-Disk | Get-Partition | Where-Object {{ $_.DriveLetter }} | Select-Object -First 1 @{{N='DriveLetter';E={{$_.DriveLetter}}}} | ConvertTo-Json -Compress",
            PsScripts::escape(path),
            ro,
        );
        let output = ps.run_ok(&script).await?;
        let val = output.parse_json()?;
        let letter = val
            .get("DriveLetter")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        Ok(letter)
    }

    /// Dismount a VHD from the host OS.
    pub async fn dismount_vhd(ps: &PsExecutor, path: &str) -> HyperVResult<()> {
        info!("Dismounting VHD '{}'", path);
        ps.run_void(&format!(
            "Dismount-VHD -Path '{}'",
            PsScripts::escape(path)
        ))
        .await
    }

    // ── Set / Get VHD on VM ─────────────────────────────────────────

    /// Set the VHD path on an existing VM hard drive controller slot.
    pub async fn set_vm_hard_drive_path(
        ps: &PsExecutor,
        vm_name: &str,
        controller_type: &str,
        controller_number: u32,
        controller_location: u32,
        vhd_path: &str,
    ) -> HyperVResult<()> {
        ps.run_void(&format!(
            "Set-VMHardDiskDrive -VMName '{}' -ControllerType {} -ControllerNumber {} -ControllerLocation {} -Path '{}'",
            PsScripts::escape(vm_name),
            controller_type,
            controller_number,
            controller_location,
            PsScripts::escape(vhd_path),
        ))
        .await
    }

    /// List all VHDs attached to a VM.
    pub async fn list_vm_hard_drives(
        ps: &PsExecutor,
        vm_name: &str,
    ) -> HyperVResult<Vec<VmHardDriveInfo>> {
        let script = format!(
            r#"@(Get-VMHardDiskDrive -VMName '{}' | Select-Object
                @{{N='ControllerType';E={{$_.ControllerType.ToString()}}}},
                ControllerNumber,ControllerLocation,Path,
                @{{N='VhdType';E={{(Get-VHD $_.Path -ErrorAction SilentlyContinue).VhdType}}}},
                @{{N='FileSize';E={{(Get-VHD $_.Path -ErrorAction SilentlyContinue).FileSize}}}},
                @{{N='MaxSize';E={{(Get-VHD $_.Path -ErrorAction SilentlyContinue).Size}}}}
            ) | ConvertTo-Json -Depth 3 -Compress"#,
            PsScripts::escape(vm_name),
        );
        ps.run_json_array(&script).await
    }

    // ── Delete ──────────────────────────────────────────────────────

    /// Delete a VHD file from disk.
    pub async fn delete_vhd(ps: &PsExecutor, path: &str) -> HyperVResult<()> {
        info!("Deleting VHD file '{}'", path);
        ps.run_void(&format!(
            "Remove-Item -Path '{}' -Force",
            PsScripts::escape(path)
        ))
        .await
    }

    // ── Set parent (re-parent differencing) ─────────────────────────

    /// Change the parent of a differencing VHD.
    pub async fn set_vhd_parent(
        ps: &PsExecutor,
        path: &str,
        parent_path: &str,
    ) -> HyperVResult<()> {
        info!("Re-parenting VHD '{}' -> '{}'", path, parent_path);
        ps.run_void(&format!(
            "Set-VHD -Path '{}' -ParentPath '{}'",
            PsScripts::escape(path),
            PsScripts::escape(parent_path),
        ))
        .await
    }
}
