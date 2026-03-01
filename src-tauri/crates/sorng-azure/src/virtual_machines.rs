//! Azure Virtual Machines – list, get, start, stop, restart, deallocate, delete,
//! resize, instance view, available sizes.

use log::debug;

use crate::client::AzureClient;
use crate::types::{
    ArmList, AzureError, AzureErrorKind, AzureResult, NetworkInterface, NicProperties,
    VirtualMachine, VmInstanceView, VmSize, VmSummary,
};

/// List all VMs in the subscription.
pub async fn list_vms(client: &AzureClient) -> AzureResult<Vec<VirtualMachine>> {
    let api = client.config().api_version_compute.clone();
    let url = client.subscription_url(&format!(
        "/providers/Microsoft.Compute/virtualMachines?api-version={}&$expand=instanceView",
        api
    ))?;
    debug!("list_vms → {}", url);
    client.get_all_pages(&url).await
}

/// List VMs in a specific resource group.
pub async fn list_vms_in_rg(
    client: &AzureClient,
    resource_group: &str,
) -> AzureResult<Vec<VirtualMachine>> {
    let api = client.config().api_version_compute.clone();
    let url = client.resource_group_url(
        resource_group,
        &format!(
            "/providers/Microsoft.Compute/virtualMachines?api-version={}&$expand=instanceView",
            api
        ),
    )?;
    debug!("list_vms_in_rg({}) → {}", resource_group, url);
    client.get_all_pages(&url).await
}

/// Get a single VM by name.
pub async fn get_vm(
    client: &AzureClient,
    resource_group: &str,
    vm_name: &str,
) -> AzureResult<VirtualMachine> {
    let api = &client.config().api_version_compute;
    let url = client.resource_group_url(
        resource_group,
        &format!(
            "/providers/Microsoft.Compute/virtualMachines/{}?api-version={}&$expand=instanceView",
            vm_name, api
        ),
    )?;
    debug!("get_vm({}/{}) → {}", resource_group, vm_name, url);
    client.get_json(&url).await
}

/// Get the instance view (detailed runtime status) of a VM.
pub async fn get_instance_view(
    client: &AzureClient,
    resource_group: &str,
    vm_name: &str,
) -> AzureResult<VmInstanceView> {
    let api = &client.config().api_version_compute;
    let url = client.resource_group_url(
        resource_group,
        &format!(
            "/providers/Microsoft.Compute/virtualMachines/{}/instanceView?api-version={}",
            vm_name, api
        ),
    )?;
    debug!("get_instance_view({}/{}) → {}", resource_group, vm_name, url);
    client.get_json(&url).await
}

/// Start a (deallocated/stopped) VM.
pub async fn start_vm(
    client: &AzureClient,
    resource_group: &str,
    vm_name: &str,
) -> AzureResult<()> {
    let api = &client.config().api_version_compute;
    let url = client.resource_group_url(
        resource_group,
        &format!(
            "/providers/Microsoft.Compute/virtualMachines/{}/start?api-version={}",
            vm_name, api
        ),
    )?;
    debug!("start_vm({}/{}) → {}", resource_group, vm_name, url);
    client.post_action(&url).await?;
    Ok(())
}

/// Power off a VM (still billed).
pub async fn stop_vm(
    client: &AzureClient,
    resource_group: &str,
    vm_name: &str,
) -> AzureResult<()> {
    let api = &client.config().api_version_compute;
    let url = client.resource_group_url(
        resource_group,
        &format!(
            "/providers/Microsoft.Compute/virtualMachines/{}/powerOff?api-version={}",
            vm_name, api
        ),
    )?;
    debug!("stop_vm({}/{}) → {}", resource_group, vm_name, url);
    client.post_action(&url).await?;
    Ok(())
}

/// Restart a running VM.
pub async fn restart_vm(
    client: &AzureClient,
    resource_group: &str,
    vm_name: &str,
) -> AzureResult<()> {
    let api = &client.config().api_version_compute;
    let url = client.resource_group_url(
        resource_group,
        &format!(
            "/providers/Microsoft.Compute/virtualMachines/{}/restart?api-version={}",
            vm_name, api
        ),
    )?;
    debug!("restart_vm({}/{}) → {}", resource_group, vm_name, url);
    client.post_action(&url).await?;
    Ok(())
}

/// Deallocate a VM (stops billing for compute).
pub async fn deallocate_vm(
    client: &AzureClient,
    resource_group: &str,
    vm_name: &str,
) -> AzureResult<()> {
    let api = &client.config().api_version_compute;
    let url = client.resource_group_url(
        resource_group,
        &format!(
            "/providers/Microsoft.Compute/virtualMachines/{}/deallocate?api-version={}",
            vm_name, api
        ),
    )?;
    debug!("deallocate_vm({}/{}) → {}", resource_group, vm_name, url);
    client.post_action(&url).await?;
    Ok(())
}

/// Delete a VM.
pub async fn delete_vm(
    client: &AzureClient,
    resource_group: &str,
    vm_name: &str,
) -> AzureResult<()> {
    let api = &client.config().api_version_compute;
    let url = client.resource_group_url(
        resource_group,
        &format!(
            "/providers/Microsoft.Compute/virtualMachines/{}?api-version={}",
            vm_name, api
        ),
    )?;
    debug!("delete_vm({}/{}) → {}", resource_group, vm_name, url);
    client.delete(&url).await
}

/// Resize a VM by updating its hardware profile.
pub async fn resize_vm(
    client: &AzureClient,
    resource_group: &str,
    vm_name: &str,
    new_size: &str,
) -> AzureResult<VirtualMachine> {
    let api = &client.config().api_version_compute;
    let url = client.resource_group_url(
        resource_group,
        &format!(
            "/providers/Microsoft.Compute/virtualMachines/{}?api-version={}",
            vm_name, api
        ),
    )?;
    debug!("resize_vm({}/{}) → {} → {}", resource_group, vm_name, new_size, url);

    let body = serde_json::json!({
        "properties": {
            "hardwareProfile": {
                "vmSize": new_size
            }
        }
    });
    client.patch_json(&url, &body).await
}

/// List available VM sizes for a VM (for resize).
pub async fn list_available_sizes(
    client: &AzureClient,
    resource_group: &str,
    vm_name: &str,
) -> AzureResult<Vec<VmSize>> {
    let api = &client.config().api_version_compute;
    let url = client.resource_group_url(
        resource_group,
        &format!(
            "/providers/Microsoft.Compute/virtualMachines/{}/vmSizes?api-version={}",
            vm_name, api
        ),
    )?;
    debug!("list_available_sizes({}/{}) → {}", resource_group, vm_name, url);
    let list: ArmList<VmSize> = client.get_json(&url).await?;
    Ok(list.value)
}

/// List all VM sizes in a region.
pub async fn list_sizes_in_location(
    client: &AzureClient,
    location: &str,
) -> AzureResult<Vec<VmSize>> {
    let api = &client.config().api_version_compute;
    let url = client.subscription_url(&format!(
        "/providers/Microsoft.Compute/locations/{}/vmSizes?api-version={}",
        location, api
    ))?;
    debug!("list_sizes_in_location({}) → {}", location, url);
    let list: ArmList<VmSize> = client.get_json(&url).await?;
    Ok(list.value)
}

/// Extract power state from instance-view statuses.
pub fn extract_power_state(vm: &VirtualMachine) -> String {
    vm.properties
        .instance_view
        .as_ref()
        .map(|iv| {
            iv.statuses
                .iter()
                .find(|s| s.code.starts_with("PowerState/"))
                .and_then(|s| s.code.split('/').nth(1))
                .unwrap_or("Unknown")
                .to_string()
        })
        .unwrap_or_else(|| "Unknown".into())
}

/// Extract OS type from storage profile.
pub fn extract_os_type(vm: &VirtualMachine) -> String {
    vm.properties
        .storage_profile
        .as_ref()
        .and_then(|sp| sp.os_disk.as_ref())
        .and_then(|od| od.os_type.clone())
        .unwrap_or_else(|| "Unknown".into())
}

/// Extract resource group name from the VM resource ID.
pub fn extract_resource_group(vm: &VirtualMachine) -> String {
    vm.id
        .split('/')
        .collect::<Vec<_>>()
        .windows(2)
        .find(|w| w[0].eq_ignore_ascii_case("resourceGroups"))
        .map(|w| w[1].to_string())
        .unwrap_or_else(|| "unknown".into())
}

/// Resolve NIC IP addresses for a VM. Fetches each NIC and extracts IPs.
pub async fn resolve_vm_ips(
    client: &AzureClient,
    vm: &VirtualMachine,
) -> AzureResult<(Option<String>, Option<String>)> {
    let api = &client.config().api_version_network;
    let nic_refs = &vm.properties.network_profile.as_ref()
        .map(|np| &np.network_interfaces)
        .unwrap_or(&Vec::new())
        .clone();

    if nic_refs.is_empty() {
        return Ok((None, None));
    }

    // Fetch the first NIC
    let nic_id = &nic_refs[0].id;
    if nic_id.is_empty() {
        return Ok((None, None));
    }

    let url = format!(
        "{}{}?api-version={}",
        crate::types::ARM_BASE,
        nic_id,
        api
    );
    let nic: NetworkInterface = client.get_json(&url).await?;
    let (private_ip, public_ip_ref) = extract_nic_ips(&nic.properties);

    // If there's a public IP reference, resolve it
    let public_ip = if let Some(pip_id) = public_ip_ref {
        let pip_url = format!(
            "{}{}?api-version={}",
            crate::types::ARM_BASE,
            pip_id,
            api
        );
        let pip: crate::types::PublicIpAddress = client.get_json(&pip_url).await?;
        pip.properties.and_then(|p| p.ip_address)
    } else {
        None
    };

    Ok((private_ip, public_ip))
}

fn extract_nic_ips(props: &Option<NicProperties>) -> (Option<String>, Option<String>) {
    match props {
        Some(p) => {
            let ip_cfg = p.ip_configurations.first();
            let private = ip_cfg
                .and_then(|c| c.properties.as_ref())
                .and_then(|p| p.private_ip_address.clone());
            let public_ref = ip_cfg
                .and_then(|c| c.properties.as_ref())
                .and_then(|p| p.public_ip_address.as_ref())
                .map(|r| r.id.clone())
                .filter(|s| !s.is_empty());
            (private, public_ref)
        }
        None => (None, None),
    }
}

/// Convert a full VM to a simplified summary.
pub fn vm_to_summary(vm: &VirtualMachine) -> VmSummary {
    VmSummary {
        id: vm.id.clone(),
        name: vm.name.clone(),
        resource_group: extract_resource_group(vm),
        location: vm.location.clone(),
        size: vm
            .properties
            .hardware_profile
            .as_ref()
            .and_then(|h| h.vm_size.clone())
            .unwrap_or_default(),
        os_type: extract_os_type(vm),
        power_state: extract_power_state(vm),
        provisioning_state: vm
            .properties
            .provisioning_state
            .clone()
            .unwrap_or_default(),
        private_ip: None,
        public_ip: None,
        tags: vm.tags.clone(),
    }
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::*;

    fn make_vm(power_code: &str, os_type: &str, rg_in_id: &str) -> VirtualMachine {
        VirtualMachine {
            id: format!(
                "/subscriptions/sub1/resourceGroups/{}/providers/Microsoft.Compute/virtualMachines/vm1",
                rg_in_id
            ),
            name: "vm1".into(),
            location: "eastus".into(),
            tags: std::collections::HashMap::new(),
            properties: VmProperties {
                vm_id: Some("abc-123".into()),
                provisioning_state: Some("Succeeded".into()),
                hardware_profile: Some(HardwareProfile {
                    vm_size: Some("Standard_B2s".into()),
                }),
                storage_profile: Some(StorageProfile {
                    os_disk: Some(OsDisk {
                        os_type: Some(os_type.into()),
                        ..Default::default()
                    }),
                    ..Default::default()
                }),
                os_profile: None,
                network_profile: None,
                instance_view: Some(VmInstanceView {
                    statuses: vec![
                        InstanceViewStatus {
                            code: "ProvisioningState/succeeded".into(),
                            ..Default::default()
                        },
                        InstanceViewStatus {
                            code: format!("PowerState/{}", power_code),
                            ..Default::default()
                        },
                    ],
                    vm_agent: None,
                }),
            },
        }
    }

    #[test]
    fn extract_power_state_running() {
        let vm = make_vm("running", "Linux", "rg1");
        assert_eq!(extract_power_state(&vm), "running");
    }

    #[test]
    fn extract_power_state_deallocated() {
        let vm = make_vm("deallocated", "Windows", "rg1");
        assert_eq!(extract_power_state(&vm), "deallocated");
    }

    #[test]
    fn extract_power_state_unknown_when_no_instance_view() {
        let vm = VirtualMachine::default();
        assert_eq!(extract_power_state(&vm), "Unknown");
    }

    #[test]
    fn extract_os_type_linux() {
        let vm = make_vm("running", "Linux", "rg1");
        assert_eq!(extract_os_type(&vm), "Linux");
    }

    #[test]
    fn extract_os_type_unknown_when_missing() {
        let vm = VirtualMachine::default();
        assert_eq!(extract_os_type(&vm), "Unknown");
    }

    #[test]
    fn extract_resource_group_from_id() {
        let vm = make_vm("running", "Linux", "my-rg-2");
        assert_eq!(extract_resource_group(&vm), "my-rg-2");
    }

    #[test]
    fn extract_resource_group_unknown_for_empty_id() {
        let vm = VirtualMachine::default();
        assert_eq!(extract_resource_group(&vm), "unknown");
    }

    #[test]
    fn vm_to_summary_converts_correctly() {
        let vm = make_vm("running", "Linux", "prod-rg");
        let s = vm_to_summary(&vm);
        assert_eq!(s.name, "vm1");
        assert_eq!(s.resource_group, "prod-rg");
        assert_eq!(s.size, "Standard_B2s");
        assert_eq!(s.os_type, "Linux");
        assert_eq!(s.power_state, "running");
        assert_eq!(s.provisioning_state, "Succeeded");
    }

    #[test]
    fn url_patterns() {
        let mut c = AzureClient::new();
        c.set_credentials(AzureCredentials {
            subscription_id: "s1".into(),
            ..Default::default()
        });
        let url = c
            .resource_group_url("rg", "/providers/Microsoft.Compute/virtualMachines/vm1?api-version=2024-03-01")
            .unwrap();
        assert!(url.contains("/resourceGroups/rg/"));
        assert!(url.contains("/virtualMachines/vm1"));
    }

    #[test]
    fn nic_ip_extraction_empty() {
        let (priv_ip, pub_ref) = extract_nic_ips(&None);
        assert!(priv_ip.is_none());
        assert!(pub_ref.is_none());
    }

    #[test]
    fn nic_ip_extraction_with_data() {
        let props = Some(NicProperties {
            ip_configurations: vec![IpConfiguration {
                id: "cfg1".into(),
                name: "ipconfig1".into(),
                properties: Some(IpConfigProperties {
                    private_ip_address: Some("10.0.0.4".into()),
                    private_ip_allocation_method: None,
                    public_ip_address: Some(PublicIpRef {
                        id: "/sub/pip/myPip".into(),
                    }),
                    subnet: None,
                }),
            }],
            mac_address: None,
            provisioning_state: None,
        });
        let (priv_ip, pub_ref) = extract_nic_ips(&props);
        assert_eq!(priv_ip, Some("10.0.0.4".into()));
        assert_eq!(pub_ref, Some("/sub/pip/myPip".into()));
    }
}
