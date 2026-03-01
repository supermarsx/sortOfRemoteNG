//! Hyper-V Replica management — enable / disable / suspend / resume
//! replication, planned & unplanned failover, reverse replication,
//! initial replication, test failover.

use crate::error::HyperVResult;
use crate::powershell::{PsExecutor, PsScripts};
use crate::types::*;
use log::info;

/// Manager for Hyper-V Replica operations.
pub struct ReplicationManager;

impl ReplicationManager {
    // ── Query ────────────────────────────────────────────────────────

    /// Get replication status for a VM.
    pub async fn get_replication(
        ps: &PsExecutor,
        vm_name: &str,
    ) -> HyperVResult<VmReplicationInfo> {
        let script = format!(
            r#"$r = Get-VMReplication -VMName '{}' -ErrorAction Stop
$disks = @($r.ReplicatedDisks | ForEach-Object {{ $_.Path }})
$excluded = @($r.ExcludedDisks | ForEach-Object {{ $_.Path }})
[PSCustomObject]@{{
    VmName               = $r.VMName
    VmId                 = $r.VMId.ToString()
    Mode                 = $r.Mode.ToString()
    State                = $r.State.ToString()
    Health               = $r.Health.ToString()
    PrimaryServer        = $r.PrimaryServer
    ReplicaServer        = $r.ReplicaServer
    FrequencySeconds     = $r.FrequencySec
    AuthType             = $r.AuthenticationType.ToString()
    LastReplicationTime  = if($r.LastReplicationTime){{$r.LastReplicationTime.ToUniversalTime().ToString('o')}}else{{$null}}
    LastReplicationType  = $r.LastReplicationType.ToString()
    AvgReplicationSize   = $r.AverageReplicationSize
    MaxReplicationSize   = $r.MaximumReplicationSize
    RecoveryPointCount   = $r.NumberOfRecoveryPoints
    MissedReplicationCount = ($r.MissedReplicationCount)
    IncludedDisks        = $disks
    ExcludedDisks        = $excluded
}} | ConvertTo-Json -Depth 3 -Compress"#,
            PsScripts::escape(vm_name)
        );
        ps.run_json_as(&script).await
    }

    /// List all VMs with replication enabled.
    pub async fn list_replicated_vms(
        ps: &PsExecutor,
    ) -> HyperVResult<Vec<VmReplicationInfo>> {
        let script = r#"
@(Get-VMReplication | ForEach-Object {
    $r = $_
    [PSCustomObject]@{
        VmName               = $r.VMName
        VmId                 = $r.VMId.ToString()
        Mode                 = $r.Mode.ToString()
        State                = $r.State.ToString()
        Health               = $r.Health.ToString()
        PrimaryServer        = $r.PrimaryServer
        ReplicaServer        = $r.ReplicaServer
        FrequencySeconds     = $r.FrequencySec
        AuthType             = $r.AuthenticationType.ToString()
        LastReplicationTime  = if($r.LastReplicationTime){$r.LastReplicationTime.ToUniversalTime().ToString('o')}else{$null}
        LastReplicationType  = $r.LastReplicationType.ToString()
        AvgReplicationSize   = $r.AverageReplicationSize
        MaxReplicationSize   = $r.MaximumReplicationSize
        RecoveryPointCount   = $r.NumberOfRecoveryPoints
        MissedReplicationCount = $r.MissedReplicationCount
        IncludedDisks        = @()
        ExcludedDisks        = @()
    }
}) | ConvertTo-Json -Depth 3 -Compress
"#;
        ps.run_json_array(script).await
    }

    // ── Enable / Disable ─────────────────────────────────────────────

    /// Enable replication for a VM.
    pub async fn enable_replication(
        ps: &PsExecutor,
        vm_name: &str,
        config: &EnableReplicationConfig,
    ) -> HyperVResult<()> {
        let freq = match config.frequency {
            ReplicationFrequency::Seconds30 => 30,
            ReplicationFrequency::Minutes5 => 300,
            ReplicationFrequency::Minutes15 => 900,
        };
        let auth = match config.auth_type {
            ReplicationAuthType::Kerberos => "Kerberos",
            ReplicationAuthType::Certificate => "Certificate",
        };

        let mut cmd = format!(
            "Enable-VMReplication -VMName '{}' -ReplicaServerName '{}' -ReplicaServerPort {} -AuthenticationType {} -ReplicationFrequencySec {} -RecoveryHistory {}",
            PsScripts::escape(vm_name),
            PsScripts::escape(&config.replica_server),
            config.replica_server_port,
            auth,
            freq,
            config.recovery_history,
        );

        if let Some(ref thumbprint) = config.certificate_thumbprint {
            cmd.push_str(&format!(
                " -CertificateThumbprint '{}'",
                PsScripts::escape(thumbprint)
            ));
        }

        if config.compression_enabled {
            cmd.push_str(" -CompressionEnabled $true");
        }

        if config.enable_vss {
            cmd.push_str(&format!(
                " -VSSSnapshotFrequencyHour {}",
                config.vss_frequency_hours
            ));
        }

        if config.auto_resynchronize {
            cmd.push_str(" -AutoResynchronizeEnabled $true");
        }

        if !config.included_disks.is_empty() {
            let disks: Vec<String> = config
                .included_disks
                .iter()
                .map(|d| format!("'{}'", PsScripts::escape(d)))
                .collect();
            cmd.push_str(&format!(" -IncludedVhdPath @({})", disks.join(",")));
        }

        info!("Enabling replication for VM '{}' -> '{}'", vm_name, config.replica_server);
        ps.run_void(&cmd).await
    }

    /// Disable replication for a VM.
    pub async fn disable_replication(ps: &PsExecutor, vm_name: &str) -> HyperVResult<()> {
        info!("Disabling replication for VM '{}'", vm_name);
        ps.run_void(&format!(
            "Remove-VMReplication -VMName '{}' -Confirm:$false",
            PsScripts::escape(vm_name)
        ))
        .await
    }

    // ── Start Initial Replication ────────────────────────────────────

    /// Start the initial replication over the network.
    pub async fn start_initial_replication(
        ps: &PsExecutor,
        vm_name: &str,
    ) -> HyperVResult<()> {
        info!("Starting initial replication for VM '{}'", vm_name);
        ps.run_void(&format!(
            "Start-VMInitialReplication -VMName '{}'",
            PsScripts::escape(vm_name)
        ))
        .await
    }

    /// Start initial replication using export to path (offline).
    pub async fn start_initial_replication_export(
        ps: &PsExecutor,
        vm_name: &str,
        export_path: &str,
    ) -> HyperVResult<()> {
        info!(
            "Starting initial replication (export) for VM '{}' to '{}'",
            vm_name, export_path
        );
        ps.run_void(&format!(
            "Start-VMInitialReplication -VMName '{}' -DestinationPath '{}'",
            PsScripts::escape(vm_name),
            PsScripts::escape(export_path),
        ))
        .await
    }

    // ── Suspend / Resume ─────────────────────────────────────────────

    /// Suspend (pause) replication.
    pub async fn suspend_replication(ps: &PsExecutor, vm_name: &str) -> HyperVResult<()> {
        info!("Suspending replication for VM '{}'", vm_name);
        ps.run_void(&format!(
            "Suspend-VMReplication -VMName '{}'",
            PsScripts::escape(vm_name)
        ))
        .await
    }

    /// Resume replication after suspend.
    pub async fn resume_replication(ps: &PsExecutor, vm_name: &str) -> HyperVResult<()> {
        info!("Resuming replication for VM '{}'", vm_name);
        ps.run_void(&format!(
            "Resume-VMReplication -VMName '{}'",
            PsScripts::escape(vm_name)
        ))
        .await
    }

    // ── Resynchronise ────────────────────────────────────────────────

    /// Force a resynchronisation of the replica.
    pub async fn resynchronize(ps: &PsExecutor, vm_name: &str) -> HyperVResult<()> {
        info!("Resynchronizing replication for VM '{}'", vm_name);
        ps.run_void(&format!(
            "Resume-VMReplication -VMName '{}' -Resynchronize",
            PsScripts::escape(vm_name)
        ))
        .await
    }

    // ── Failover ─────────────────────────────────────────────────────

    /// Planned failover (requires source VM to be off / saved).
    pub async fn planned_failover(ps: &PsExecutor, vm_name: &str) -> HyperVResult<()> {
        info!("Starting planned failover for VM '{}'", vm_name);
        ps.run_void(&format!(
            "Start-VMFailover -VMName '{}' -Prepare; Start-VMFailover -VMName '{}' -Confirm:$false",
            PsScripts::escape(vm_name),
            PsScripts::escape(vm_name),
        ))
        .await
    }

    /// Unplanned failover (disaster recovery).
    pub async fn unplanned_failover(ps: &PsExecutor, vm_name: &str) -> HyperVResult<()> {
        info!("Starting unplanned failover for VM '{}'", vm_name);
        ps.run_void(&format!(
            "Start-VMFailover -VMName '{}' -Confirm:$false",
            PsScripts::escape(vm_name)
        ))
        .await
    }

    /// Complete a failover operation.
    pub async fn complete_failover(ps: &PsExecutor, vm_name: &str) -> HyperVResult<()> {
        info!("Completing failover for VM '{}'", vm_name);
        ps.run_void(&format!(
            "Complete-VMFailover -VMName '{}' -Confirm:$false",
            PsScripts::escape(vm_name)
        ))
        .await
    }

    /// Cancel an in-progress failover.
    pub async fn cancel_failover(ps: &PsExecutor, vm_name: &str) -> HyperVResult<()> {
        info!("Cancelling failover for VM '{}'", vm_name);
        ps.run_void(&format!(
            "Stop-VMFailover -VMName '{}'",
            PsScripts::escape(vm_name)
        ))
        .await
    }

    // ── Reverse Replication ──────────────────────────────────────────

    /// Reverse replication direction (after failover).
    pub async fn reverse_replication(ps: &PsExecutor, vm_name: &str) -> HyperVResult<()> {
        info!("Reversing replication for VM '{}'", vm_name);
        ps.run_void(&format!(
            "Set-VMReplication -VMName '{}' -Reverse -Confirm:$false",
            PsScripts::escape(vm_name)
        ))
        .await
    }

    // ── Test Failover ────────────────────────────────────────────────

    /// Start a test failover (creates a test VM, does not affect production).
    pub async fn start_test_failover(
        ps: &PsExecutor,
        vm_name: &str,
        switch_name: Option<&str>,
    ) -> HyperVResult<String> {
        info!("Starting test failover for VM '{}'", vm_name);
        let mut cmd = format!(
            "Start-VMFailover -VMName '{}' -AsTest",
            PsScripts::escape(vm_name)
        );
        if let Some(sw) = switch_name {
            cmd.push_str(&format!(
                " -VMNetworkAdapterName '{}' -SwitchName '{}'",
                "Network Adapter",
                PsScripts::escape(sw)
            ));
        }
        cmd.push_str(" -Confirm:$false");
        cmd.push_str("; (Get-VM | Where-Object { $_.Name -like '*test*' } | Select-Object -Last 1 Name).Name | ConvertTo-Json -Compress");
        let output = ps.run_ok(&cmd).await?;
        Ok(output.stdout.trim().trim_matches('"').to_string())
    }

    /// Stop (clean up) a test failover.
    pub async fn stop_test_failover(ps: &PsExecutor, vm_name: &str) -> HyperVResult<()> {
        info!("Stopping test failover for VM '{}'", vm_name);
        ps.run_void(&format!(
            "Stop-VMFailover -VMName '{}'",
            PsScripts::escape(vm_name)
        ))
        .await
    }

    // ── Replica Server Configuration ─────────────────────────────────

    /// Configure this host as a Replica server.
    pub async fn configure_replica_server(
        ps: &PsExecutor,
        enabled: bool,
        allowed_server: Option<&str>,
        port: u16,
        auth_type: &ReplicationAuthType,
    ) -> HyperVResult<()> {
        if !enabled {
            info!("Disabling Replica server role");
            return ps
                .run_void("Set-VMReplicationServer -ReplicaServerEnabled $false")
                .await;
        }

        let auth = match auth_type {
            ReplicationAuthType::Kerberos => "Kerberos",
            ReplicationAuthType::Certificate => "Certificate",
        };

        let mut cmd = format!(
            "Set-VMReplicationServer -ReplicaServerEnabled $true -AllowedAuthenticationType {} -DefaultStorageLocation 'C:\\Hyper-V\\Replica' -KerberosAuthenticationPort {}",
            auth, port,
        );

        if let Some(server) = allowed_server {
            cmd.push_str(&format!(
                "; New-VMReplicationAuthorizationEntry -AllowedPrimaryServer '{}' -ReplicaStorageLocation 'C:\\Hyper-V\\Replica\\{}' -TrustGroup 'default'",
                PsScripts::escape(server),
                PsScripts::escape(server),
            ));
        }

        info!("Configuring Replica server (port={})", port);
        ps.run_void(&cmd).await
    }

    /// Get Replica server configuration.
    pub async fn get_replica_server_config(
        ps: &PsExecutor,
    ) -> HyperVResult<serde_json::Value> {
        let script = r#"
$rs = Get-VMReplicationServer -ErrorAction SilentlyContinue
if ($rs) {
    [PSCustomObject]@{
        Enabled               = $rs.ReplicationEnabled
        AllowedAuthType       = $rs.AllowedAuthenticationType.ToString()
        KerberosPort          = $rs.KerberosAuthenticationPort
        CertificatePort       = $rs.CertificateAuthenticationPort
        DefaultStorageLocation = $rs.DefaultStorageLocation
    } | ConvertTo-Json -Depth 3 -Compress
} else {
    'null'
}
"#;
        ps.run_json(script).await
    }
}
