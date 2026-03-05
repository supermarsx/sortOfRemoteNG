//! Virtual networking — host virtual networks, NAT port-forwarding,
//! DHCP management, bridge configuration.

use crate::error::{VmwError, VmwErrorKind, VmwResult};
use crate::types::*;
use crate::vmrest::VmRestClient;

/// List all virtual networks.
pub async fn list_networks(rest: &VmRestClient) -> VmwResult<Vec<VirtualNetwork>> {
    let rn = rest.list_networks().await?;
    let mut networks = Vec::new();
    for n in rn {
        networks.push(VirtualNetwork {
            name: n.name.clone(),
            network_type: n.net_type.clone().unwrap_or_default(),
            subnet: n.subnet.clone(),
            mask: n.mask.clone(),
            dhcp_enabled: n.dhcp.map(|v| v.to_lowercase() == "true" || v == "1"),
            nat_enabled: Some(
                n.net_type
                    .as_deref()
                    .map(|t| t.to_lowercase().contains("nat"))
                    .unwrap_or(false),
            ),
            host_adapter: None,
            vnet_name: Some(n.name.clone()),
        });
    }
    Ok(networks)
}

/// Get a specific network by name.
pub async fn get_network(rest: &VmRestClient, name: &str) -> VmwResult<VirtualNetwork> {
    let all = list_networks(rest).await?;
    all.into_iter()
        .find(|n| n.name == name)
        .ok_or_else(|| VmwError::new(VmwErrorKind::NetworkError, format!("Network {name} not found")))
}

/// Create a new virtual network.
pub async fn create_network(
    rest: &VmRestClient,
    req: CreateNetworkRequest,
) -> VmwResult<VirtualNetwork> {
    rest.create_network(&req.name, &req.network_type, req.subnet.as_deref(), req.mask.as_deref())
        .await?;
    get_network(rest, &req.name).await
}

/// Update a virtual network.
pub async fn update_network(
    rest: &VmRestClient,
    name: &str,
    network_type: &str,
    subnet: Option<&str>,
    mask: Option<&str>,
) -> VmwResult<VirtualNetwork> {
    rest.update_network(name, network_type, subnet, mask).await?;
    get_network(rest, name).await
}

/// Delete a virtual network.
pub async fn delete_network(rest: &VmRestClient, name: &str) -> VmwResult<()> {
    rest.delete_network(name).await?;
    Ok(())
}

/// List port-forwarding rules for a network.
pub async fn list_port_forwards(
    rest: &VmRestClient,
    network: &str,
) -> VmwResult<Vec<NatPortForward>> {
    let pf = rest.list_port_forwards(network).await?;
    Ok(pf
        .into_iter()
        .map(|p| NatPortForward {
            protocol: p.protocol.unwrap_or_default(),
            host_port: p.port.unwrap_or(0),
            guest_ip: p.guest_ip.clone().unwrap_or_default(),
            guest_port: p.guest_port.unwrap_or(0),
            description: p.desc.clone(),
        })
        .collect())
}

/// Add or update a port-forwarding rule.
pub async fn set_port_forward(
    rest: &VmRestClient,
    network: &str,
    req: AddPortForwardRequest,
) -> VmwResult<()> {
    rest.set_port_forward(
        network,
        &req.protocol,
        req.host_port,
        &req.guest_ip,
        req.guest_port,
        req.description.as_deref(),
    )
    .await?;
    Ok(())
}

/// Delete a port-forwarding rule.
pub async fn delete_port_forward(
    rest: &VmRestClient,
    network: &str,
    protocol: &str,
    host_port: u16,
) -> VmwResult<()> {
    rest.delete_port_forward(network, protocol, host_port)
        .await?;
    Ok(())
}

/// Get MAC-to-IP address mappings (DHCP leases) for a network.
pub async fn get_dhcp_leases(
    rest: &VmRestClient,
    network: &str,
) -> VmwResult<Vec<DhcpLease>> {
    let mappings = rest.get_mac_to_ip(network).await?;
    let mut leases = Vec::new();
    for m in mappings {
        if let (Some(mac), Some(ip)) = (m.mac, m.ip) {
            leases.push(DhcpLease {
                mac_address: mac,
                ip_address: ip,
                hostname: None,
                lease_start: None,
                lease_end: None,
            });
        }
    }
    Ok(leases)
}

/// Read platform-specific networking configuration files.
///
/// On Windows: `%PROGRAMDATA%\VMware\vmnetlib.dll` or virtual network editor
/// On macOS: `/Library/Preferences/VMware Fusion/networking`
/// On Linux: `/etc/vmware/networking`
pub fn read_networking_config() -> VmwResult<std::collections::HashMap<String, String>> {
    let config_path = if cfg!(target_os = "windows") {
        let pd = std::env::var("PROGRAMDATA").unwrap_or_else(|_| "C:\\ProgramData".to_string());
        format!("{pd}\\VMware\\vmnetlib.conf")
    } else if cfg!(target_os = "macos") {
        "/Library/Preferences/VMware Fusion/networking".to_string()
    } else {
        "/etc/vmware/networking".to_string()
    };

    let content = std::fs::read_to_string(&config_path).map_err(|e| {
        VmwError::new(
            VmwErrorKind::IoError,
            format!("Cannot read networking config {config_path}: {e}"),
        )
    })?;

    let mut map = std::collections::HashMap::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some(eq) = trimmed.find('=') {
            let key = trimmed[..eq].trim().to_string();
            let val = trimmed[eq + 1..].trim().to_string();
            map.insert(key, val);
        } else {
            // Space-delimited key value
            let parts: Vec<&str> = trimmed.splitn(2, char::is_whitespace).collect();
            if parts.len() == 2 {
                map.insert(parts[0].to_string(), parts[1].to_string());
            }
        }
    }
    Ok(map)
}
