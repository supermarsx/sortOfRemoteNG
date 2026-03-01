//! Hyper-V metrics and resource metering — VM resource usage, host capacity,
//! integration services health, performance counters.

use crate::error::HyperVResult;
use crate::powershell::{PsExecutor, PsScripts};
use crate::types::*;
use log::info;

/// Manager for Hyper-V metrics and monitoring.
pub struct MetricsManager;

impl MetricsManager {
    // ── VM Metrics ───────────────────────────────────────────────────

    /// Get resource metrics for a single VM.
    pub async fn get_vm_metrics(ps: &PsExecutor, vm_name: &str) -> HyperVResult<VmMetrics> {
        let script = format!(
            r#"$vm = Get-VM -Name '{}' -ErrorAction Stop
$cpu = ($vm | Measure-VMResourcePool -ErrorAction SilentlyContinue | Select-Object -First 1 AvgCPU).AvgCPU
if ($null -eq $cpu) {{ $cpu = $vm.CPUUsage }}
$mem = $vm.MemoryAssigned / 1MB
$memDemand = $vm.MemoryDemand / 1MB
$memStatus = $vm.MemoryStatus
$memPressure = if($vm.MemoryDemand -gt 0 -and $vm.MemoryAssigned -gt 0) {{ [math]::Round(($vm.MemoryDemand / $vm.MemoryAssigned) * 100, 2) }} else {{ 0 }}
$disks = Get-VHD -VMId $vm.Id -ErrorAction SilentlyContinue
$totalDiskSize = ($disks | Measure-Object FileSize -Sum).Sum
[PSCustomObject]@{{
    VmName                = $vm.Name
    VmId                  = $vm.Id.ToString()
    CpuUsage              = [double]$cpu
    MemoryAssignedMb      = [uint64]$mem
    MemoryDemandMb        = [uint64]$memDemand
    MemoryStatus          = if($memStatus){{$memStatus.ToString()}}else{{'Unknown'}}
    AvgMemoryPressure     = [double]$memPressure
    DiskReadBytesPerSec   = 0
    DiskWriteBytesPerSec  = 0
    NetworkInBytesPerSec  = 0
    NetworkOutBytesPerSec = 0
    TotalDiskSize         = if($totalDiskSize){{[uint64]$totalDiskSize}}else{{0}}
    Timestamp             = (Get-Date).ToUniversalTime().ToString('o')
}} | ConvertTo-Json -Depth 3 -Compress"#,
            PsScripts::escape(vm_name)
        );
        ps.run_json_as(&script).await
    }

    /// Get resource metrics for all running VMs.
    pub async fn get_all_vm_metrics(ps: &PsExecutor) -> HyperVResult<Vec<VmMetrics>> {
        let script = r#"
@(Get-VM | Where-Object { $_.State -eq 'Running' } | ForEach-Object {
    $vm = $_
    $disks = Get-VHD -VMId $vm.Id -ErrorAction SilentlyContinue
    $totalDiskSize = ($disks | Measure-Object FileSize -Sum).Sum
    [PSCustomObject]@{
        VmName                = $vm.Name
        VmId                  = $vm.Id.ToString()
        CpuUsage              = [double]$vm.CPUUsage
        MemoryAssignedMb      = [uint64]($vm.MemoryAssigned / 1MB)
        MemoryDemandMb        = [uint64]($vm.MemoryDemand / 1MB)
        MemoryStatus          = if($vm.MemoryStatus){$vm.MemoryStatus.ToString()}else{'Unknown'}
        AvgMemoryPressure     = if($vm.MemoryDemand -gt 0 -and $vm.MemoryAssigned -gt 0) { [math]::Round(($vm.MemoryDemand / $vm.MemoryAssigned) * 100, 2) } else { 0 }
        DiskReadBytesPerSec   = 0
        DiskWriteBytesPerSec  = 0
        NetworkInBytesPerSec  = 0
        NetworkOutBytesPerSec = 0
        TotalDiskSize         = if($totalDiskSize){[uint64]$totalDiskSize}else{0}
        Timestamp             = (Get-Date).ToUniversalTime().ToString('o')
    }
}) | ConvertTo-Json -Depth 3 -Compress
"#;
        ps.run_json_array(script).await
    }

    // ── Resource Metering ────────────────────────────────────────────

    /// Enable resource metering on a VM.
    pub async fn enable_metering(ps: &PsExecutor, vm_name: &str) -> HyperVResult<()> {
        info!("Enabling resource metering on VM '{}'", vm_name);
        ps.run_void(&format!(
            "Enable-VMResourceMetering -VMName '{}'",
            PsScripts::escape(vm_name)
        ))
        .await
    }

    /// Disable resource metering on a VM.
    pub async fn disable_metering(ps: &PsExecutor, vm_name: &str) -> HyperVResult<()> {
        info!("Disabling resource metering on VM '{}'", vm_name);
        ps.run_void(&format!(
            "Disable-VMResourceMetering -VMName '{}'",
            PsScripts::escape(vm_name)
        ))
        .await
    }

    /// Reset resource metering counters for a VM.
    pub async fn reset_metering(ps: &PsExecutor, vm_name: &str) -> HyperVResult<()> {
        info!("Resetting resource metering on VM '{}'", vm_name);
        ps.run_void(&format!(
            "Reset-VMResourceMetering -VMName '{}'",
            PsScripts::escape(vm_name)
        ))
        .await
    }

    /// Get detailed resource metering data for a VM.
    pub async fn get_metering_report(
        ps: &PsExecutor,
        vm_name: &str,
    ) -> HyperVResult<serde_json::Value> {
        let script = format!(
            r#"$m = Measure-VM -Name '{}' -ErrorAction Stop
[PSCustomObject]@{{
    VmName           = $m.VMName
    AvgCPU           = $m.AvgCPU
    AvgMemory        = $m.AvgRAM
    MaxMemory        = $m.MaxRAM
    MinMemory        = $m.MinRAM
    TotalDisk        = $m.TotalDisk
    AggregatedAvgCPU        = $m.AggregatedAverageProcessorUtilization
    AggregatedAvgMemory     = $m.AggregatedAverageMemoryUtilization
    AggregatedMaxMemory     = $m.AggregatedMaximumMemoryUtilization
    AggregatedDiskAllocation = $m.AggregatedDiskDataRead + $m.AggregatedDiskDataWritten
    MeteringDuration = $m.MeteringDuration.ToString()
    NetworkInbound   = ($m.NetworkMeteredTrafficReport | Where-Object {{ $_.Direction -eq 'Inbound' }} | Measure-Object TotalTraffic -Sum).Sum
    NetworkOutbound  = ($m.NetworkMeteredTrafficReport | Where-Object {{ $_.Direction -eq 'Outbound' }} | Measure-Object TotalTraffic -Sum).Sum
}} | ConvertTo-Json -Depth 3 -Compress"#,
            PsScripts::escape(vm_name)
        );
        ps.run_json(&script).await
    }

    // ── Host Info ────────────────────────────────────────────────────

    /// Get Hyper-V host capacity and configuration.
    pub async fn get_host_info(ps: &PsExecutor) -> HyperVResult<HostInfo> {
        let script = r#"
$h = Get-VMHost
$os = Get-CimInstance Win32_OperatingSystem
$runVMs = @(Get-VM | Where-Object { $_.State -eq 'Running' }).Count
$totalVMs = @(Get-VM).Count
$ver = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -ErrorAction SilentlyContinue).CurrentBuild
[PSCustomObject]@{
    Hostname              = $env:COMPUTERNAME
    LogicalProcessorCount = $h.LogicalProcessorCount
    TotalMemory           = [uint64]$os.TotalVisibleMemorySize * 1024
    AvailableMemory       = [uint64]$os.FreePhysicalMemory * 1024
    VmCount               = $totalVMs
    RunningVmCount        = $runVMs
    HypervVersion         = $ver
    NumaSpanningEnabled   = $h.NumaSpanningEnabled
    LiveMigrationEnabled  = $h.VirtualMachineMigrationEnabled
    MaxLiveMigrations     = $h.MaximumVirtualMachineMigrations
    MaxStorageMigrations  = $h.MaximumStorageMigrations
    VirtualHardDiskPath   = $h.VirtualHardDiskPath
    VirtualMachinePath    = $h.VirtualMachinePath
} | ConvertTo-Json -Depth 3 -Compress
"#;
        ps.run_json_as(script).await
    }

    // ── Integration Services ─────────────────────────────────────────

    /// Get integration services status for a VM.
    pub async fn get_integration_services(
        ps: &PsExecutor,
        vm_name: &str,
    ) -> HyperVResult<Vec<IntegrationServiceInfo>> {
        let script = format!(
            r#"@(Get-VMIntegrationService -VMName '{}' | Select-Object Name,Enabled,
                @{{N='PrimaryStatusOk';E={{$_.PrimaryOperationalStatus -eq 'Ok'}}}},
                @{{N='SecondaryStatus';E={{if($_.SecondaryOperationalStatus){{$_.SecondaryOperationalStatus.ToString()}}else{{''}}}}}}
            ) | ConvertTo-Json -Depth 3 -Compress"#,
            PsScripts::escape(vm_name)
        );
        ps.run_json_array(&script).await
    }

    // ── Hyper-V Event Logs ───────────────────────────────────────────

    /// Get recent Hyper-V event log entries.
    pub async fn get_hyperv_events(
        ps: &PsExecutor,
        max_events: u32,
        log_name: Option<&str>,
    ) -> HyperVResult<serde_json::Value> {
        let log = log_name.unwrap_or("Microsoft-Windows-Hyper-V-VMMS-Admin");
        let script = format!(
            r#"@(Get-WinEvent -LogName '{}' -MaxEvents {} -ErrorAction SilentlyContinue | Select-Object TimeCreated,Id,LevelDisplayName,Message,
                @{{N='TimeString';E={{$_.TimeCreated.ToUniversalTime().ToString('o')}}}}
            ) | ConvertTo-Json -Depth 3 -Compress"#,
            PsScripts::escape(log),
            max_events,
        );
        ps.run_json(&script).await
    }

    // ── Host Settings ────────────────────────────────────────────────

    /// Set default paths on the Hyper-V host.
    pub async fn set_host_paths(
        ps: &PsExecutor,
        vm_path: Option<&str>,
        vhd_path: Option<&str>,
    ) -> HyperVResult<()> {
        let mut parts: Vec<String> = vec![];
        if let Some(p) = vm_path {
            parts.push(format!(
                "-VirtualMachinePath '{}'",
                PsScripts::escape(p)
            ));
        }
        if let Some(p) = vhd_path {
            parts.push(format!(
                "-VirtualHardDiskPath '{}'",
                PsScripts::escape(p)
            ));
        }
        if parts.is_empty() {
            return Ok(());
        }
        info!("Setting host paths");
        ps.run_void(&format!("Set-VMHost {}", parts.join(" ")))
            .await
    }

    /// Set live migration settings on the host.
    pub async fn set_live_migration(
        ps: &PsExecutor,
        enabled: bool,
        max_migrations: Option<u32>,
        max_storage_migrations: Option<u32>,
    ) -> HyperVResult<()> {
        let mut cmd = format!(
            "Set-VMHost -VirtualMachineMigrationEnabled ${}",
            if enabled { "true" } else { "false" }
        );
        if let Some(m) = max_migrations {
            cmd.push_str(&format!(" -MaximumVirtualMachineMigrations {}", m));
        }
        if let Some(s) = max_storage_migrations {
            cmd.push_str(&format!(" -MaximumStorageMigrations {}", s));
        }
        info!("Setting live migration: enabled={}", enabled);
        ps.run_void(&cmd).await
    }

    /// Set NUMA spanning.
    pub async fn set_numa_spanning(ps: &PsExecutor, enabled: bool) -> HyperVResult<()> {
        info!("Setting NUMA spanning: {}", enabled);
        ps.run_void(&format!(
            "Set-VMHost -NumaSpanningEnabled ${}",
            if enabled { "true" } else { "false" }
        ))
        .await
    }
}
