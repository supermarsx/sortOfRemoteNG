//! VM lifecycle management — create, start, stop, restart, pause, resume,
//! save, delete, configure, export, import, live-migrate.

use crate::error::HyperVResult;
use crate::powershell::{PsExecutor, PsScripts};
use crate::types::*;
use log::{debug, info};

/// Manager for Hyper-V virtual machine lifecycle operations.
pub struct VmManager;

impl VmManager {
    // ── Query / List ─────────────────────────────────────────────────

    /// List all VMs with full detail.
    pub async fn list_vms(ps: &PsExecutor) -> HyperVResult<Vec<VmInfo>> {
        let script = r#"
Get-VM | ForEach-Object {
    $vm = $_
    $nets = @(Get-VMNetworkAdapter -VM $vm | Select-Object Name,SwitchName,MacAddress,DynamicMacAddressEnabled,
        @{N='VlanId';E={(Get-VMNetworkAdapterVlan -VMNetworkAdapter $_).AccessVlanId}},
        @{N='VlanEnabled';E={$null -ne (Get-VMNetworkAdapterVlan -VMNetworkAdapter $_ | Where-Object {$_.OperationMode -ne 'Untagged'})}},
        @{N='IpAddresses';E={$_.IPAddresses}},
        @{N='Status';E={$_.Status}},
        @{N='BandwidthWeight';E={$_.BandwidthSetting.MinimumBandwidthWeight}},
        @{N='DhcpGuard';E={$_.DhcpGuard}},
        @{N='RouterGuard';E={$_.RouterGuard}},
        @{N='MacAddressSpoofing';E={$_.MacAddressSpoofing -eq 'On'}},
        @{N='PortMirroringMode';E={$_.PortMirroringMode.ToString()}} )
    $hdds = @(Get-VMHardDiskDrive -VM $vm | Select-Object ControllerType,ControllerNumber,ControllerLocation,Path,
        @{N='VhdType';E={(Get-VHD $_.Path -ErrorAction SilentlyContinue).VhdType}},
        @{N='FileSize';E={(Get-VHD $_.Path -ErrorAction SilentlyContinue).FileSize}},
        @{N='MaxSize';E={(Get-VHD $_.Path -ErrorAction SilentlyContinue).Size}} )
    $dvds = @(Get-VMDvdDrive -VM $vm | Select-Object ControllerNumber,ControllerLocation,Path)
    [PSCustomObject]@{
        Id                       = $vm.Id.ToString()
        Name                     = $vm.Name
        State                    = $vm.State.ToString()
        Status                   = $vm.Status
        Generation               = $vm.Generation
        Version                  = $vm.Version
        Path                     = $vm.Path
        ProcessorCount           = $vm.ProcessorCount
        MemoryAssigned           = $vm.MemoryAssigned
        MemoryStartup            = $vm.MemoryStartup
        MemoryMinimum            = $vm.MemoryMinimum
        MemoryMaximum            = $vm.MemoryMaximum
        DynamicMemoryEnabled     = $vm.DynamicMemoryEnabled
        Uptime                   = $vm.Uptime.ToString()
        UptimeSeconds            = [int64]$vm.Uptime.TotalSeconds
        IntegrationServicesVersion = if($vm.IntegrationServicesVersion){$vm.IntegrationServicesVersion.ToString()}else{''}
        IntegrationServicesState = if($vm.IntegrationServicesState){$vm.IntegrationServicesState}else{''}
        AutomaticStartAction     = $vm.AutomaticStartAction.ToString()
        AutomaticStartDelay      = $vm.AutomaticStartDelay
        AutomaticStopAction      = $vm.AutomaticStopAction.ToString()
        CheckpointType           = $vm.CheckpointType.ToString()
        HasCheckpoints           = ($vm | Get-VMSnapshot -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0
        ParentCheckpointId       = if($vm.ParentCheckpointId){$vm.ParentCheckpointId.ToString()}else{$null}
        ParentCheckpointName     = if($vm.ParentCheckpointName){$vm.ParentCheckpointName}else{$null}
        Notes                    = $vm.Notes
        CreationTime             = if($vm.CreationTime){$vm.CreationTime.ToUniversalTime().ToString('o')}else{$null}
        ReplicationState         = $vm.ReplicationState.ToString()
        ReplicationMode          = $vm.ReplicationMode.ToString()
        SecureBootEnabled        = (Get-VMFirmware -VM $vm -ErrorAction SilentlyContinue).SecureBoot -eq 'On'
        NetworkAdapters          = $nets
        HardDrives               = $hdds
        DvdDrives                = $dvds
    }
} | ConvertTo-Json -Depth 5 -Compress
"#;
        ps.run_json_array(script).await
    }

    /// List VMs with minimal info (fast).
    pub async fn list_vms_summary(ps: &PsExecutor) -> HyperVResult<Vec<VmSummary>> {
        let script = r#"
@(Get-VM | Select-Object @{N='Id';E={$_.Id.ToString()}},Name,
    @{N='State';E={$_.State.ToString()}},Status,ProcessorCount,MemoryAssigned,
    @{N='Uptime';E={$_.Uptime.ToString()}},Generation,
    @{N='HasCheckpoints';E={($_ | Get-VMSnapshot -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0}},
    @{N='ReplicationState';E={$_.ReplicationState.ToString()}}
) | ConvertTo-Json -Depth 3 -Compress
"#;
        ps.run_json_array(script).await
    }

    /// Get a single VM by name.
    pub async fn get_vm(ps: &PsExecutor, name: &str) -> HyperVResult<VmInfo> {
        let escaped = PsScripts::escape(name);
        let script = format!(
            r#"
$vm = Get-VM -Name '{name}' -ErrorAction Stop
$nets = @(Get-VMNetworkAdapter -VM $vm | Select-Object Name,SwitchName,MacAddress,DynamicMacAddressEnabled,
    @{{N='VlanId';E={{(Get-VMNetworkAdapterVlan -VMNetworkAdapter $_).AccessVlanId}}}},
    @{{N='VlanEnabled';E={{$null -ne (Get-VMNetworkAdapterVlan -VMNetworkAdapter $_ | Where-Object {{$_.OperationMode -ne 'Untagged'}})}}}},
    @{{N='IpAddresses';E={{$_.IPAddresses}}}},
    @{{N='Status';E={{$_.Status}}}},
    @{{N='BandwidthWeight';E={{$_.BandwidthSetting.MinimumBandwidthWeight}}}},
    @{{N='DhcpGuard';E={{$_.DhcpGuard}}}},
    @{{N='RouterGuard';E={{$_.RouterGuard}}}},
    @{{N='MacAddressSpoofing';E={{$_.MacAddressSpoofing -eq 'On'}}}},
    @{{N='PortMirroringMode';E={{$_.PortMirroringMode.ToString()}}}} )
$hdds = @(Get-VMHardDiskDrive -VM $vm | Select-Object ControllerType,ControllerNumber,ControllerLocation,Path,
    @{{N='VhdType';E={{(Get-VHD $_.Path -ErrorAction SilentlyContinue).VhdType}}}},
    @{{N='FileSize';E={{(Get-VHD $_.Path -ErrorAction SilentlyContinue).FileSize}}}},
    @{{N='MaxSize';E={{(Get-VHD $_.Path -ErrorAction SilentlyContinue).Size}}}} )
$dvds = @(Get-VMDvdDrive -VM $vm | Select-Object ControllerNumber,ControllerLocation,Path)
[PSCustomObject]@{{
    Id                       = $vm.Id.ToString()
    Name                     = $vm.Name
    State                    = $vm.State.ToString()
    Status                   = $vm.Status
    Generation               = $vm.Generation
    Version                  = $vm.Version
    Path                     = $vm.Path
    ProcessorCount           = $vm.ProcessorCount
    MemoryAssigned           = $vm.MemoryAssigned
    MemoryStartup            = $vm.MemoryStartup
    MemoryMinimum            = $vm.MemoryMinimum
    MemoryMaximum            = $vm.MemoryMaximum
    DynamicMemoryEnabled     = $vm.DynamicMemoryEnabled
    Uptime                   = $vm.Uptime.ToString()
    UptimeSeconds            = [int64]$vm.Uptime.TotalSeconds
    IntegrationServicesVersion = if($vm.IntegrationServicesVersion){{$vm.IntegrationServicesVersion.ToString()}}else{{''}}
    IntegrationServicesState = if($vm.IntegrationServicesState){{$vm.IntegrationServicesState}}else{{''}}
    AutomaticStartAction     = $vm.AutomaticStartAction.ToString()
    AutomaticStartDelay      = $vm.AutomaticStartDelay
    AutomaticStopAction      = $vm.AutomaticStopAction.ToString()
    CheckpointType           = $vm.CheckpointType.ToString()
    HasCheckpoints           = ($vm | Get-VMSnapshot -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0
    ParentCheckpointId       = if($vm.ParentCheckpointId){{$vm.ParentCheckpointId.ToString()}}else{{$null}}
    ParentCheckpointName     = if($vm.ParentCheckpointName){{$vm.ParentCheckpointName}}else{{$null}}
    Notes                    = $vm.Notes
    CreationTime             = if($vm.CreationTime){{$vm.CreationTime.ToUniversalTime().ToString('o')}}else{{$null}}
    ReplicationState         = $vm.ReplicationState.ToString()
    ReplicationMode          = $vm.ReplicationMode.ToString()
    SecureBootEnabled        = (Get-VMFirmware -VM $vm -ErrorAction SilentlyContinue).SecureBoot -eq 'On'
    NetworkAdapters          = $nets
    HardDrives               = $hdds
    DvdDrives                = $dvds
}} | ConvertTo-Json -Depth 5 -Compress
"#,
            name = escaped
        );
        ps.run_json_as(&script).await
    }

    /// Get a single VM by GUID.
    pub async fn get_vm_by_id(ps: &PsExecutor, id: &str) -> HyperVResult<VmInfo> {
        let escaped = PsScripts::escape(id);
        let script = format!(
            "$vm = Get-VM -Id '{}' -ErrorAction Stop; $vm | Select-Object * | ConvertTo-Json -Depth 4 -Compress",
            escaped
        );
        ps.run_json_as(&script).await
    }

    // ── Create ───────────────────────────────────────────────────────

    /// Create a new virtual machine.
    pub async fn create_vm(ps: &PsExecutor, config: &VmCreateConfig) -> HyperVResult<VmInfo> {
        let name = PsScripts::escape(&config.name);
        let gen = match config.generation {
            VmGeneration::Gen1 => 1,
            VmGeneration::Gen2 => 2,
        };
        let mem_bytes = config.memory_startup_mb * 1024 * 1024;

        let mut parts: Vec<String> = vec![
            format!("$vm = New-VM -Name '{}' -Generation {} -MemoryStartupBytes {}", name, gen, mem_bytes),
        ];

        if let Some(ref p) = config.path {
            parts[0].push_str(&format!(" -Path '{}'", PsScripts::escape(p)));
        }

        if let Some(ref vhd) = config.vhd_path {
            parts[0].push_str(&format!(" -VHDPath '{}'", PsScripts::escape(vhd)));
        } else if let Some(gb) = config.new_vhd_size_gb {
            let bytes = gb * 1024 * 1024 * 1024;
            let vhd_path = if let Some(ref p) = config.path {
                format!("{}\\{}\\Virtual Hard Disks\\{}.vhdx", p, config.name, config.name)
            } else {
                format!("{}.vhdx", config.name)
            };
            parts[0].push_str(&format!(" -NewVHDPath '{}' -NewVHDSizeBytes {}", PsScripts::escape(&vhd_path), bytes));
        } else {
            parts[0].push_str(" -NoVHD");
        }

        if let Some(ref sw) = config.switch_name {
            parts[0].push_str(&format!(" -SwitchName '{}'", PsScripts::escape(sw)));
        }

        // Configure processors
        if config.processor_count != 1 {
            parts.push(format!(
                "Set-VMProcessor -VM $vm -Count {}",
                config.processor_count
            ));
        }

        // Dynamic memory
        if let Some(ref dm) = config.dynamic_memory {
            if dm.enabled {
                parts.push(format!(
                    "Set-VMMemory -VM $vm -DynamicMemoryEnabled $true -MinimumBytes {} -MaximumBytes {} -StartupBytes {} -Buffer {} -Priority {}",
                    dm.minimum_mb * 1024 * 1024,
                    dm.maximum_mb * 1024 * 1024,
                    dm.startup_mb * 1024 * 1024,
                    dm.buffer_percentage,
                    dm.priority,
                ));
            }
        }

        // ISO
        if let Some(ref iso) = config.iso_path {
            parts.push(format!(
                "Add-VMDvdDrive -VM $vm -Path '{}'",
                PsScripts::escape(iso)
            ));
        }

        // Auto-start / stop
        parts.push(format!(
            "Set-VM -VM $vm -AutomaticStartAction {} -AutomaticStartDelay {} -AutomaticStopAction {}",
            auto_start_to_ps(&config.auto_start_action),
            config.auto_start_delay,
            auto_stop_to_ps(&config.auto_stop_action),
        ));

        // Checkpoint type
        parts.push(format!(
            "Set-VM -VM $vm -CheckpointType {}",
            checkpoint_type_to_ps(&config.checkpoint_type),
        ));

        // Notes
        if let Some(ref n) = config.notes {
            parts.push(format!(
                "Set-VM -VM $vm -Notes '{}'",
                PsScripts::escape(n)
            ));
        }

        // Gen2 firmware settings
        if gen == 2 {
            if !config.secure_boot {
                parts.push("Set-VMFirmware -VM $vm -EnableSecureBoot Off".to_string());
            }
            if config.enable_tpm {
                parts.push("Set-VMKeyProtector -VM $vm -NewLocalKeyProtector; Enable-VMTPM -VM $vm".to_string());
            }
        }

        // Return the created VM
        parts.push("Get-VM -Name $vm.Name | Select-Object * | ConvertTo-Json -Depth 4 -Compress".to_string());

        let script = parts.join("; ");
        info!("Creating VM '{}'", config.name);
        ps.run_json_as(&script).await
    }

    // ── Lifecycle ────────────────────────────────────────────────────

    /// Start a VM.
    pub async fn start_vm(ps: &PsExecutor, name: &str) -> HyperVResult<()> {
        info!("Starting VM '{}'", name);
        ps.run_void(&format!("Start-VM -Name '{}'", PsScripts::escape(name)))
            .await
    }

    /// Stop a VM (graceful shutdown via integration services).
    pub async fn stop_vm(ps: &PsExecutor, name: &str, force: bool) -> HyperVResult<()> {
        info!("Stopping VM '{}' (force={})", name, force);
        let flag = if force { " -Force -TurnOff" } else { "" };
        ps.run_void(&format!(
            "Stop-VM -Name '{}'{}",
            PsScripts::escape(name),
            flag
        ))
        .await
    }

    /// Restart a VM.
    pub async fn restart_vm(ps: &PsExecutor, name: &str, force: bool) -> HyperVResult<()> {
        info!("Restarting VM '{}' (force={})", name, force);
        let flag = if force { " -Force" } else { "" };
        ps.run_void(&format!(
            "Restart-VM -Name '{}'{}",
            PsScripts::escape(name),
            flag
        ))
        .await
    }

    /// Pause a running VM.
    pub async fn pause_vm(ps: &PsExecutor, name: &str) -> HyperVResult<()> {
        info!("Pausing VM '{}'", name);
        ps.run_void(&format!("Suspend-VM -Name '{}'", PsScripts::escape(name)))
            .await
    }

    /// Resume a paused VM.
    pub async fn resume_vm(ps: &PsExecutor, name: &str) -> HyperVResult<()> {
        info!("Resuming VM '{}'", name);
        ps.run_void(&format!("Resume-VM -Name '{}'", PsScripts::escape(name)))
            .await
    }

    /// Save a VM state to disk.
    pub async fn save_vm(ps: &PsExecutor, name: &str) -> HyperVResult<()> {
        info!("Saving VM '{}'", name);
        ps.run_void(&format!("Save-VM -Name '{}'", PsScripts::escape(name)))
            .await
    }

    /// Delete (remove) a VM.
    pub async fn remove_vm(ps: &PsExecutor, name: &str, delete_files: bool) -> HyperVResult<()> {
        info!("Removing VM '{}' (delete_files={})", name, delete_files);
        let mut script = format!("$vm = Get-VM -Name '{}'; ", PsScripts::escape(name));
        if delete_files {
            // Collect paths before deletion
            script.push_str(
                r#"$paths = @($vm.Path); $vm | Get-VMHardDiskDrive | ForEach-Object { $paths += $_.Path }; "#,
            );
        }
        script.push_str("Stop-VM -VM $vm -Force -TurnOff -ErrorAction SilentlyContinue; Remove-VM -VM $vm -Force; ");
        if delete_files {
            script.push_str("$paths | ForEach-Object { Remove-Item -Path $_ -Recurse -Force -ErrorAction SilentlyContinue }");
        }
        ps.run_void(&script).await
    }

    // ── Configuration ────────────────────────────────────────────────

    /// Update VM settings.
    pub async fn update_vm(
        ps: &PsExecutor,
        name: &str,
        config: &VmUpdateConfig,
    ) -> HyperVResult<VmInfo> {
        let escaped = PsScripts::escape(name);
        let mut parts: Vec<String> = vec![format!("$vm = Get-VM -Name '{}'", escaped)];

        let mut set_args: Vec<String> = vec!["-VM $vm".to_string()];

        if let Some(ref n) = config.name {
            set_args.push(format!("-NewVMName '{}'", PsScripts::escape(n)));
        }
        if let Some(ref notes) = config.notes {
            set_args.push(format!("-Notes '{}'", PsScripts::escape(notes)));
        }
        if let Some(ref a) = config.auto_start_action {
            set_args.push(format!("-AutomaticStartAction {}", auto_start_to_ps(a)));
        }
        if let Some(d) = config.auto_start_delay {
            set_args.push(format!("-AutomaticStartDelay {}", d));
        }
        if let Some(ref a) = config.auto_stop_action {
            set_args.push(format!("-AutomaticStopAction {}", auto_stop_to_ps(a)));
        }
        if let Some(ref ct) = config.checkpoint_type {
            set_args.push(format!("-CheckpointType {}", checkpoint_type_to_ps(ct)));
        }
        if let Some(lock) = config.lock_on_disconnect {
            set_args.push(format!(
                "-LockOnDisconnect {}",
                if lock { "On" } else { "Off" }
            ));
        }

        if set_args.len() > 1 {
            parts.push(format!("Set-VM {}", set_args.join(" ")));
        }

        if let Some(cpu) = config.processor_count {
            parts.push(format!("Set-VMProcessor -VM $vm -Count {}", cpu));
        }

        if let Some(mem) = config.memory_startup_mb {
            parts.push(format!(
                "Set-VMMemory -VM $vm -StartupBytes {}",
                mem * 1024 * 1024
            ));
        }

        if let Some(ref dm) = config.dynamic_memory {
            if dm.enabled {
                parts.push(format!(
                    "Set-VMMemory -VM $vm -DynamicMemoryEnabled $true -MinimumBytes {} -MaximumBytes {} -StartupBytes {} -Buffer {} -Priority {}",
                    dm.minimum_mb * 1024 * 1024,
                    dm.maximum_mb * 1024 * 1024,
                    dm.startup_mb * 1024 * 1024,
                    dm.buffer_percentage,
                    dm.priority,
                ));
            } else {
                parts.push("Set-VMMemory -VM $vm -DynamicMemoryEnabled $false".to_string());
            }
        }

        if let Some(sb) = config.secure_boot {
            parts.push(format!(
                "Set-VMFirmware -VM $vm -EnableSecureBoot {} -ErrorAction SilentlyContinue",
                if sb { "On" } else { "Off" }
            ));
        }

        if let Some(tpm) = config.enable_tpm {
            if tpm {
                parts.push(
                    "Set-VMKeyProtector -VM $vm -NewLocalKeyProtector -ErrorAction SilentlyContinue; Enable-VMTPM -VM $vm -ErrorAction SilentlyContinue"
                        .to_string(),
                );
            } else {
                parts.push("Disable-VMTPM -VM $vm -ErrorAction SilentlyContinue".to_string());
            }
        }

        let result_name = config.name.as_deref().unwrap_or(name);
        parts.push(format!(
            "Get-VM -Name '{}' | Select-Object * | ConvertTo-Json -Depth 4 -Compress",
            PsScripts::escape(result_name)
        ));

        let script = parts.join("; ");
        info!("Updating VM '{}'", name);
        ps.run_json_as(&script).await
    }

    /// Rename a VM.
    pub async fn rename_vm(ps: &PsExecutor, name: &str, new_name: &str) -> HyperVResult<()> {
        info!("Renaming VM '{}' -> '{}'", name, new_name);
        ps.run_void(&format!(
            "Rename-VM -Name '{}' -NewName '{}'",
            PsScripts::escape(name),
            PsScripts::escape(new_name),
        ))
        .await
    }

    // ── Export / Import ──────────────────────────────────────────────

    /// Export a VM.
    pub async fn export_vm(
        ps: &PsExecutor,
        name: &str,
        config: &VmExportConfig,
    ) -> HyperVResult<()> {
        info!("Exporting VM '{}' to '{}'", name, config.path);
        let mut cmd = format!(
            "Export-VM -Name '{}' -Path '{}'",
            PsScripts::escape(name),
            PsScripts::escape(&config.path),
        );
        if !config.include_snapshots {
            cmd.push_str(" -CaptureLiveState CaptureSavedState");
        }
        ps.run_void(&cmd).await
    }

    /// Import a VM.
    pub async fn import_vm(ps: &PsExecutor, config: &VmImportConfig) -> HyperVResult<VmInfo> {
        info!("Importing VM from '{}'", config.path);
        let mut cmd = format!(
            "Import-VM -Path '{}'",
            PsScripts::escape(&config.path),
        );
        if config.copy {
            cmd.push_str(" -Copy");
        }
        if config.generate_new_id {
            cmd.push_str(" -GenerateNewId");
        }
        if let Some(ref vhd) = config.vhd_destination_path {
            cmd.push_str(&format!(" -VhdDestinationPath '{}'", PsScripts::escape(vhd)));
        }
        if let Some(ref vmp) = config.virtual_machine_path {
            cmd.push_str(&format!(" -VirtualMachinePath '{}'", PsScripts::escape(vmp)));
        }
        cmd.push_str(" | Select-Object * | ConvertTo-Json -Depth 4 -Compress");
        ps.run_json_as(&cmd).await
    }

    // ── Live Migration ───────────────────────────────────────────────

    /// Live-migrate a VM to another host.
    pub async fn live_migrate(
        ps: &PsExecutor,
        name: &str,
        config: &LiveMigrationConfig,
    ) -> HyperVResult<()> {
        info!(
            "Live-migrating VM '{}' to '{}'",
            name, config.destination_host
        );
        let mut cmd = format!(
            "Move-VM -Name '{}' -DestinationHost '{}'",
            PsScripts::escape(name),
            PsScripts::escape(&config.destination_host),
        );
        if config.include_storage {
            if let Some(ref p) = config.destination_storage_path {
                cmd.push_str(&format!(
                    " -IncludeStorage -DestinationStoragePath '{}'",
                    PsScripts::escape(p)
                ));
            }
        }
        ps.run_void(&cmd).await
    }

    // ── Integration Services ─────────────────────────────────────────

    /// List integration services for a VM.
    pub async fn get_integration_services(
        ps: &PsExecutor,
        name: &str,
    ) -> HyperVResult<Vec<IntegrationServiceInfo>> {
        let script = format!(
            r#"@(Get-VMIntegrationService -VMName '{}' | Select-Object Name,Enabled,
                @{{N='PrimaryStatusOk';E={{$_.PrimaryOperationalStatus -eq 'Ok'}}}},
                @{{N='SecondaryStatus';E={{$_.SecondaryOperationalStatus}}}}
            ) | ConvertTo-Json -Depth 3 -Compress"#,
            PsScripts::escape(name)
        );
        ps.run_json_array(&script).await
    }

    /// Enable or disable an integration service.
    pub async fn set_integration_service(
        ps: &PsExecutor,
        name: &str,
        service_name: &str,
        enabled: bool,
    ) -> HyperVResult<()> {
        debug!(
            "{}abling integration service '{}' on VM '{}'",
            if enabled { "En" } else { "Dis" },
            service_name,
            name
        );
        let verb = if enabled { "Enable" } else { "Disable" };
        ps.run_void(&format!(
            "{}-VMIntegrationService -VMName '{}' -Name '{}'",
            verb,
            PsScripts::escape(name),
            PsScripts::escape(service_name),
        ))
        .await
    }

    // ── DVD Drive Management ─────────────────────────────────────────

    /// Add a DVD drive to a VM.
    pub async fn add_dvd_drive(
        ps: &PsExecutor,
        name: &str,
        iso_path: Option<&str>,
    ) -> HyperVResult<()> {
        let mut cmd = format!("Add-VMDvdDrive -VMName '{}'", PsScripts::escape(name));
        if let Some(iso) = iso_path {
            cmd.push_str(&format!(" -Path '{}'", PsScripts::escape(iso)));
        }
        ps.run_void(&cmd).await
    }

    /// Set the ISO image on an existing DVD drive.
    pub async fn set_dvd_drive(
        ps: &PsExecutor,
        name: &str,
        controller_number: u32,
        controller_location: u32,
        iso_path: Option<&str>,
    ) -> HyperVResult<()> {
        let path_arg = match iso_path {
            Some(p) => format!("-Path '{}'", PsScripts::escape(p)),
            None => "-Path $null".to_string(),
        };
        ps.run_void(&format!(
            "Set-VMDvdDrive -VMName '{}' -ControllerNumber {} -ControllerLocation {} {}",
            PsScripts::escape(name),
            controller_number,
            controller_location,
            path_arg,
        ))
        .await
    }

    /// Remove a DVD drive from a VM.
    pub async fn remove_dvd_drive(
        ps: &PsExecutor,
        name: &str,
        controller_number: u32,
        controller_location: u32,
    ) -> HyperVResult<()> {
        ps.run_void(&format!(
            "Remove-VMDvdDrive -VMName '{}' -ControllerNumber {} -ControllerLocation {}",
            PsScripts::escape(name),
            controller_number,
            controller_location,
        ))
        .await
    }

    // ── Hard Drive Attachment ────────────────────────────────────────

    /// Attach a VHD to a VM.
    pub async fn add_hard_drive(
        ps: &PsExecutor,
        name: &str,
        vhd_path: &str,
        controller_type: &str,
        controller_number: u32,
        controller_location: u32,
    ) -> HyperVResult<()> {
        ps.run_void(&format!(
            "Add-VMHardDiskDrive -VMName '{}' -Path '{}' -ControllerType {} -ControllerNumber {} -ControllerLocation {}",
            PsScripts::escape(name),
            PsScripts::escape(vhd_path),
            controller_type,
            controller_number,
            controller_location,
        ))
        .await
    }

    /// Remove a hard drive from a VM.
    pub async fn remove_hard_drive(
        ps: &PsExecutor,
        name: &str,
        controller_type: &str,
        controller_number: u32,
        controller_location: u32,
    ) -> HyperVResult<()> {
        ps.run_void(&format!(
            "Remove-VMHardDiskDrive -VMName '{}' -ControllerType {} -ControllerNumber {} -ControllerLocation {}",
            PsScripts::escape(name),
            controller_type,
            controller_number,
            controller_location,
        ))
        .await
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────

fn auto_start_to_ps(a: &AutoStartAction) -> &'static str {
    match a {
        AutoStartAction::Nothing => "Nothing",
        AutoStartAction::StartIfRunning => "StartIfRunning",
        AutoStartAction::Start => "Start",
    }
}

fn auto_stop_to_ps(a: &AutoStopAction) -> &'static str {
    match a {
        AutoStopAction::TurnOff => "TurnOff",
        AutoStopAction::Save => "Save",
        AutoStopAction::Shutdown => "ShutDown",
    }
}

fn checkpoint_type_to_ps(c: &CheckpointType) -> &'static str {
    match c {
        CheckpointType::Disabled => "Disabled",
        CheckpointType::Production => "Production",
        CheckpointType::ProductionOnly => "ProductionOnly",
        CheckpointType::Standard => "Standard",
    }
}
