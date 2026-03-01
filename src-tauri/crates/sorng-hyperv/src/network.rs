//! Hyper-V virtual networking — virtual switches, VM network adapters,
//! VLAN configuration, bandwidth management, MAC address management.

use crate::error::HyperVResult;
use crate::powershell::{PsExecutor, PsScripts};
use crate::types::*;
use log::info;

/// Manager for Hyper-V virtual networking operations.
pub struct NetworkManager;

impl NetworkManager {
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  Virtual Switches
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /// List all virtual switches.
    pub async fn list_switches(ps: &PsExecutor) -> HyperVResult<Vec<VirtualSwitchInfo>> {
        let script = r#"@(Get-VMSwitch | Select-Object @{N='Id';E={$_.Id.ToString()}},Name,
            @{N='SwitchType';E={$_.SwitchType.ToString()}},
            @{N='NetAdapterName';E={if($_.NetAdapterInterfaceDescription){(Get-NetAdapter -InterfaceDescription $_.NetAdapterInterfaceDescription -ErrorAction SilentlyContinue).Name}else{$null}}},
            AllowManagementOS,EmbeddedTeamingEnabled,IovEnabled,
            @{N='BandwidthMode';E={$_.BandwidthReservationMode.ToString()}},
            @{N='Notes';E={$_.Notes}}
        ) | ConvertTo-Json -Depth 3 -Compress"#;
        ps.run_json_array(script).await
    }

    /// Get a virtual switch by name.
    pub async fn get_switch(ps: &PsExecutor, name: &str) -> HyperVResult<VirtualSwitchInfo> {
        let script = format!(
            r#"Get-VMSwitch -Name '{}' | Select-Object @{{N='Id';E={{$_.Id.ToString()}}}},Name,
                @{{N='SwitchType';E={{$_.SwitchType.ToString()}}}},
                @{{N='NetAdapterName';E={{if($_.NetAdapterInterfaceDescription){{(Get-NetAdapter -InterfaceDescription $_.NetAdapterInterfaceDescription -ErrorAction SilentlyContinue).Name}}else{{$null}}}}}},
                AllowManagementOS,EmbeddedTeamingEnabled,IovEnabled,
                @{{N='BandwidthMode';E={{$_.BandwidthReservationMode.ToString()}}}},
                @{{N='Notes';E={{$_.Notes}}}}
            | ConvertTo-Json -Depth 3 -Compress"#,
            PsScripts::escape(name)
        );
        ps.run_json_as(&script).await
    }

    /// Create a new virtual switch.
    pub async fn create_switch(
        ps: &PsExecutor,
        config: &CreateSwitchConfig,
    ) -> HyperVResult<VirtualSwitchInfo> {
        let name = PsScripts::escape(&config.name);
        let switch_type = match config.switch_type {
            SwitchType::Internal => "Internal",
            SwitchType::External => "External",
            SwitchType::Private => "Private",
        };

        let mut cmd = format!(
            "New-VMSwitch -Name '{}' -SwitchType {}",
            name, switch_type
        );

        // External switches need a net adapter
        if config.switch_type == SwitchType::External {
            if let Some(ref adapter) = config.net_adapter_name {
                // Override SwitchType with -NetAdapterName
                cmd = format!(
                    "New-VMSwitch -Name '{}' -NetAdapterName '{}' -AllowManagementOS ${}",
                    name,
                    PsScripts::escape(adapter),
                    if config.allow_management_os { "true" } else { "false" },
                );
                if config.enable_embedded_teaming {
                    cmd.push_str(" -EnableEmbeddedTeaming $true");
                }
            }
        }

        if config.enable_iov {
            cmd.push_str(" -EnableIov $true");
        }

        if let Some(ref notes) = config.notes {
            cmd.push_str(&format!(" -Notes '{}'", PsScripts::escape(notes)));
        }

        info!("Creating virtual switch '{}'", config.name);
        cmd.push_str(&format!(
            "; Get-VMSwitch -Name '{}' | Select-Object @{{N='Id';E={{$_.Id.ToString()}}}},Name,@{{N='SwitchType';E={{$_.SwitchType.ToString()}}}},@{{N='NetAdapterName';E={{$null}}}},AllowManagementOS,EmbeddedTeamingEnabled,IovEnabled,@{{N='BandwidthMode';E={{$_.BandwidthReservationMode.ToString()}}}},@{{N='Notes';E={{$_.Notes}}}} | ConvertTo-Json -Depth 3 -Compress",
            name
        ));
        ps.run_json_as(&cmd).await
    }

    /// Remove a virtual switch.
    pub async fn remove_switch(ps: &PsExecutor, name: &str) -> HyperVResult<()> {
        info!("Removing virtual switch '{}'", name);
        ps.run_void(&format!(
            "Remove-VMSwitch -Name '{}' -Force",
            PsScripts::escape(name)
        ))
        .await
    }

    /// Rename a virtual switch.
    pub async fn rename_switch(
        ps: &PsExecutor,
        name: &str,
        new_name: &str,
    ) -> HyperVResult<()> {
        info!("Renaming virtual switch '{}' -> '{}'", name, new_name);
        ps.run_void(&format!(
            "Rename-VMSwitch -Name '{}' -NewName '{}'",
            PsScripts::escape(name),
            PsScripts::escape(new_name),
        ))
        .await
    }

    /// List physical network adapters (for creating External switches).
    pub async fn list_physical_adapters(
        ps: &PsExecutor,
    ) -> HyperVResult<Vec<PhysicalAdapterInfo>> {
        let script = r#"@(Get-NetAdapter -Physical | Where-Object { $_.Status -eq 'Up' -or $_.Status -eq 'Disconnected' } | Select-Object Name,InterfaceDescription,
            @{N='MacAddress';E={$_.MacAddress}},
            @{N='Status';E={$_.Status}},
            @{N='LinkSpeed';E={$_.LinkSpeed}}
            | ForEach-Object {
                [PSCustomObject]@{
                    Name        = $_.Name
                    Description = $_.InterfaceDescription
                    MacAddress  = $_.MacAddress
                    Status      = $_.Status
                    LinkSpeed   = $_.LinkSpeed
                }
            }
        ) | ConvertTo-Json -Depth 3 -Compress"#;
        ps.run_json_array(script).await
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  VM Network Adapters
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /// List network adapters for a VM.
    pub async fn list_vm_adapters(
        ps: &PsExecutor,
        vm_name: &str,
    ) -> HyperVResult<Vec<VmNetworkAdapterInfo>> {
        let script = format!(
            r#"@(Get-VMNetworkAdapter -VMName '{}' | Select-Object Name,SwitchName,MacAddress,DynamicMacAddressEnabled,
                @{{N='VlanId';E={{(Get-VMNetworkAdapterVlan -VMNetworkAdapter $_).AccessVlanId}}}},
                @{{N='VlanEnabled';E={{(Get-VMNetworkAdapterVlan -VMNetworkAdapter $_).OperationMode -ne 'Untagged'}}}},
                @{{N='IpAddresses';E={{$_.IPAddresses}}}},
                @{{N='Status';E={{$_.Status}}}},
                @{{N='BandwidthWeight';E={{$_.BandwidthSetting.MinimumBandwidthWeight}}}},
                @{{N='DhcpGuard';E={{$_.DhcpGuard -eq 'On'}}}},
                @{{N='RouterGuard';E={{$_.RouterGuard -eq 'On'}}}},
                @{{N='MacAddressSpoofing';E={{$_.MacAddressSpoofing -eq 'On'}}}},
                @{{N='PortMirroringMode';E={{$_.PortMirroringMode.ToString()}}}}
            ) | ConvertTo-Json -Depth 3 -Compress"#,
            PsScripts::escape(vm_name)
        );
        ps.run_json_array(&script).await
    }

    /// Add a network adapter to a VM.
    pub async fn add_vm_adapter(
        ps: &PsExecutor,
        vm_name: &str,
        config: &AddNetworkAdapterConfig,
    ) -> HyperVResult<()> {
        let mut cmd = format!(
            "Add-VMNetworkAdapter -VMName '{}' -Name '{}'",
            PsScripts::escape(vm_name),
            PsScripts::escape(&config.name),
        );

        if let Some(ref sw) = config.switch_name {
            cmd.push_str(&format!(" -SwitchName '{}'", PsScripts::escape(sw)));
        }
        if let Some(ref mac) = config.static_mac_address {
            cmd.push_str(&format!(
                " -StaticMacAddress '{}'",
                PsScripts::escape(mac)
            ));
        }
        if config.dhcp_guard {
            cmd.push_str(" -DhcpGuard On");
        }
        if config.router_guard {
            cmd.push_str(" -RouterGuard On");
        }
        if config.mac_address_spoofing {
            cmd.push_str(" -MacAddressSpoofing On");
        }

        info!("Adding network adapter to VM '{}'", vm_name);
        ps.run_void(&cmd).await?;

        // Set VLAN if requested
        if let Some(vlan) = config.vlan_id {
            if vlan > 0 {
                ps.run_void(&format!(
                    "Set-VMNetworkAdapterVlan -VMName '{}' -VMNetworkAdapterName '{}' -Access -VlanId {}",
                    PsScripts::escape(vm_name),
                    PsScripts::escape(&config.name),
                    vlan,
                ))
                .await?;
            }
        }

        // Set bandwidth weight if requested
        if let Some(bw) = config.bandwidth_weight {
            if bw > 0 {
                ps.run_void(&format!(
                    "Set-VMNetworkAdapter -VMName '{}' -Name '{}' -MinimumBandwidthWeight {}",
                    PsScripts::escape(vm_name),
                    PsScripts::escape(&config.name),
                    bw,
                ))
                .await?;
            }
        }

        Ok(())
    }

    /// Remove a network adapter from a VM.
    pub async fn remove_vm_adapter(
        ps: &PsExecutor,
        vm_name: &str,
        adapter_name: &str,
    ) -> HyperVResult<()> {
        info!(
            "Removing network adapter '{}' from VM '{}'",
            adapter_name, vm_name
        );
        ps.run_void(&format!(
            "Remove-VMNetworkAdapter -VMName '{}' -Name '{}'",
            PsScripts::escape(vm_name),
            PsScripts::escape(adapter_name),
        ))
        .await
    }

    /// Connect a VM adapter to a switch.
    pub async fn connect_adapter(
        ps: &PsExecutor,
        vm_name: &str,
        adapter_name: &str,
        switch_name: &str,
    ) -> HyperVResult<()> {
        info!(
            "Connecting adapter '{}' on VM '{}' to switch '{}'",
            adapter_name, vm_name, switch_name
        );
        ps.run_void(&format!(
            "Connect-VMNetworkAdapter -VMName '{}' -Name '{}' -SwitchName '{}'",
            PsScripts::escape(vm_name),
            PsScripts::escape(adapter_name),
            PsScripts::escape(switch_name),
        ))
        .await
    }

    /// Disconnect a VM adapter from its switch.
    pub async fn disconnect_adapter(
        ps: &PsExecutor,
        vm_name: &str,
        adapter_name: &str,
    ) -> HyperVResult<()> {
        info!(
            "Disconnecting adapter '{}' on VM '{}'",
            adapter_name, vm_name
        );
        ps.run_void(&format!(
            "Disconnect-VMNetworkAdapter -VMName '{}' -Name '{}'",
            PsScripts::escape(vm_name),
            PsScripts::escape(adapter_name),
        ))
        .await
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  VLAN Management
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /// Set VLAN for a VM adapter (access mode).
    pub async fn set_adapter_vlan(
        ps: &PsExecutor,
        vm_name: &str,
        adapter_name: &str,
        vlan_id: u32,
    ) -> HyperVResult<()> {
        info!(
            "Setting VLAN {} on adapter '{}' of VM '{}'",
            vlan_id, adapter_name, vm_name
        );
        ps.run_void(&format!(
            "Set-VMNetworkAdapterVlan -VMName '{}' -VMNetworkAdapterName '{}' -Access -VlanId {}",
            PsScripts::escape(vm_name),
            PsScripts::escape(adapter_name),
            vlan_id,
        ))
        .await
    }

    /// Set trunk mode VLAN for a VM adapter.
    pub async fn set_adapter_vlan_trunk(
        ps: &PsExecutor,
        vm_name: &str,
        adapter_name: &str,
        native_vlan_id: u32,
        allowed_vlan_list: &str,
    ) -> HyperVResult<()> {
        info!(
            "Setting trunk VLAN (native={}) on adapter '{}' of VM '{}'",
            native_vlan_id, adapter_name, vm_name
        );
        ps.run_void(&format!(
            "Set-VMNetworkAdapterVlan -VMName '{}' -VMNetworkAdapterName '{}' -Trunk -NativeVlanId {} -AllowedVlanIdList '{}'",
            PsScripts::escape(vm_name),
            PsScripts::escape(adapter_name),
            native_vlan_id,
            PsScripts::escape(allowed_vlan_list),
        ))
        .await
    }

    /// Remove VLAN configuration (set untagged).
    pub async fn remove_adapter_vlan(
        ps: &PsExecutor,
        vm_name: &str,
        adapter_name: &str,
    ) -> HyperVResult<()> {
        info!(
            "Removing VLAN from adapter '{}' of VM '{}'",
            adapter_name, vm_name
        );
        ps.run_void(&format!(
            "Set-VMNetworkAdapterVlan -VMName '{}' -VMNetworkAdapterName '{}' -Untagged",
            PsScripts::escape(vm_name),
            PsScripts::escape(adapter_name),
        ))
        .await
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  Advanced Adapter Settings
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /// Set MAC address spoofing.
    pub async fn set_mac_spoofing(
        ps: &PsExecutor,
        vm_name: &str,
        adapter_name: &str,
        enabled: bool,
    ) -> HyperVResult<()> {
        ps.run_void(&format!(
            "Set-VMNetworkAdapter -VMName '{}' -Name '{}' -MacAddressSpoofing {}",
            PsScripts::escape(vm_name),
            PsScripts::escape(adapter_name),
            if enabled { "On" } else { "Off" },
        ))
        .await
    }

    /// Set DHCP guard.
    pub async fn set_dhcp_guard(
        ps: &PsExecutor,
        vm_name: &str,
        adapter_name: &str,
        enabled: bool,
    ) -> HyperVResult<()> {
        ps.run_void(&format!(
            "Set-VMNetworkAdapter -VMName '{}' -Name '{}' -DhcpGuard {}",
            PsScripts::escape(vm_name),
            PsScripts::escape(adapter_name),
            if enabled { "On" } else { "Off" },
        ))
        .await
    }

    /// Set router guard.
    pub async fn set_router_guard(
        ps: &PsExecutor,
        vm_name: &str,
        adapter_name: &str,
        enabled: bool,
    ) -> HyperVResult<()> {
        ps.run_void(&format!(
            "Set-VMNetworkAdapter -VMName '{}' -Name '{}' -RouterGuard {}",
            PsScripts::escape(vm_name),
            PsScripts::escape(adapter_name),
            if enabled { "On" } else { "Off" },
        ))
        .await
    }

    /// Set port mirroring mode.
    pub async fn set_port_mirroring(
        ps: &PsExecutor,
        vm_name: &str,
        adapter_name: &str,
        mode: &str, // "None", "Source", "Destination"
    ) -> HyperVResult<()> {
        ps.run_void(&format!(
            "Set-VMNetworkAdapter -VMName '{}' -Name '{}' -PortMirroring {}",
            PsScripts::escape(vm_name),
            PsScripts::escape(adapter_name),
            PsScripts::escape(mode),
        ))
        .await
    }

    /// Set bandwidth weight for a VM adapter.
    pub async fn set_bandwidth_weight(
        ps: &PsExecutor,
        vm_name: &str,
        adapter_name: &str,
        weight: u32,
    ) -> HyperVResult<()> {
        ps.run_void(&format!(
            "Set-VMNetworkAdapter -VMName '{}' -Name '{}' -MinimumBandwidthWeight {}",
            PsScripts::escape(vm_name),
            PsScripts::escape(adapter_name),
            weight,
        ))
        .await
    }
}
