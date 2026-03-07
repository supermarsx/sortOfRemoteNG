//! Virtual networking — host virtual networks, NAT port-forwarding,
//! DHCP management, bridge configuration.

use crate::error::{VmwError, VmwErrorKind, VmwResult};
use crate::types::*;
use crate::vmrest::VmRestClient;
use serde_json::Value;

/// List all virtual networks.
pub async fn list_networks(rest: &VmRestClient) -> VmwResult<Vec<VirtualNetwork>> {
    let rn = rest.list_networks().await?;
    let mut networks = Vec::new();
    for n in rn.vmnets.unwrap_or_default() {
        let name = n.name.clone().unwrap_or_default();
        networks.push(VirtualNetwork {
            name: name.clone(),
            network_type: n.net_type.clone().unwrap_or_default(),
            subnet: n.subnet.clone(),
            subnet_mask: n.mask.clone(),
            dhcp_enabled: n.dhcp.as_ref().map(|v: &String| v.to_lowercase() == "true" || v == "1"),
            nat_enabled: Some(
                n.net_type
                    .as_deref()
                    .map(|t: &str| t.to_lowercase().contains("nat"))
                    .unwrap_or(false),
            ),
            host_only_adapter: None,
            mtu: None,
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
    let body = serde_json::json!({
        "name": req.name,
        "type": req.network_type,
        "subnet": req.subnet,
        "mask": req.subnet_mask,
    });
    rest.create_network(&body).await?;
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
    let body = serde_json::json!({
        "type": network_type,
        "subnet": subnet,
        "mask": mask,
    });
    rest.update_network(name, &body).await?;
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
    let pf: Value = rest.list_port_forwards(network).await?;
    let arr = pf.as_array().cloned().unwrap_or_default();
    Ok(arr
        .into_iter()
        .filter_map(|p| {
            Some(NatPortForward {
                network: network.to_string(),
                protocol: p.get("protocol")?.as_str()?.to_string(),
                host_port: p.get("port")?.as_u64()? as u16,
                guest_ip: p.get("guest_ip")?.as_str()?.to_string(),
                guest_port: p.get("guest_port")?.as_u64()? as u16,
                description: p.get("desc").and_then(|v| v.as_str()).map(|s| s.to_string()),
            })
        })
        .collect())
}

/// Add or update a port-forwarding rule.
pub async fn set_port_forward(
    rest: &VmRestClient,
    network: &str,
    req: AddPortForwardRequest,
) -> VmwResult<()> {
    let body = serde_json::json!({
        "guestIp": req.guest_ip,
        "guestPort": req.guest_port,
        "desc": req.description,
    });
    rest.set_port_forward(network, &req.protocol, req.host_port, &body)
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
    let mappings: Value = rest.get_mac_to_ip(network).await?;
    let mut leases = Vec::new();
    if let Some(arr) = mappings.as_array() {
        for m in arr {
            if let (Some(mac), Some(ip)) = (
                m.get("mac").and_then(|v| v.as_str()),
                m.get("ip").and_then(|v| v.as_str()),
            ) {
                leases.push(DhcpLease {
                    mac_address: mac.to_string(),
                    ip_address: ip.to_string(),
                    hostname: None,
                    expires: None,
                });
            }
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
