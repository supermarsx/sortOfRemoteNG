//! # SNMP Device Discovery
//!
//! Scan subnets for SNMP-enabled devices using concurrent probes.

use crate::client::SnmpClient;
use crate::error::SnmpResult;
use crate::oid::well_known;
use crate::types::*;
use std::net::Ipv4Addr;
use tokio::sync::Semaphore;
use std::sync::Arc;

/// Run a discovery scan based on the provided configuration.
pub async fn discover(config: &DiscoveryConfig) -> SnmpResult<DiscoveryResult> {
    let start = std::time::Instant::now();
    let semaphore = Arc::new(Semaphore::new(config.concurrency as usize));

    // Expand subnets into individual IPs
    let mut all_ips = vec![];
    for subnet in &config.subnets {
        match expand_cidr(subnet) {
            Ok(ips) => all_ips.extend(ips),
            Err(e) => log::warn!("Failed to expand subnet '{}': {}", subnet, e),
        }
    }

    let total_probed = all_ips.len() as u32;
    let mut handles = vec![];

    for ip in all_ips {
        let sem = semaphore.clone();
        let config = config.clone();

        let handle = tokio::spawn(async move {
            let _permit = sem.acquire().await.unwrap();
            probe_host(&ip, &config).await
        });
        handles.push(handle);
    }

    let mut devices = vec![];
    let unreachable = vec![];

    for handle in handles {
        match handle.await {
            Ok(Some(device)) => devices.push(device),
            Ok(None) => {}
            Err(_) => {}
        }
    }

    let total_found = devices.len() as u32;

    Ok(DiscoveryResult {
        devices,
        total_probed,
        total_found,
        elapsed_ms: start.elapsed().as_millis() as u64,
        unreachable,
    })
}

/// Probe a single host to check if it responds to SNMP.
async fn probe_host(ip: &str, config: &DiscoveryConfig) -> Option<SnmpDevice> {
    let client = SnmpClient::new();

    // Try each version/community combination
    for version in &config.versions {
        let communities = if *version == SnmpVersion::V3 {
            vec!["".to_string()] // V3 doesn't use community strings
        } else {
            config.communities.clone()
        };

        for community in &communities {
            let target = SnmpTarget {
                host: ip.to_string(),
                port: config.port,
                version: *version,
                community: if community.is_empty() { None } else { Some(community.clone()) },
                v3_credentials: None,
                timeout_ms: config.timeout_ms,
                retries: 0,
            };

            // Try to get sysDescr as a probe
            match client.get_value(&target, well_known::SYS_DESCR).await {
                Ok(value) => {
                    let mut device = SnmpDevice {
                        host: ip.to_string(),
                        port: config.port,
                        version: *version,
                        sys_descr: Some(value.display_value()),
                        sys_object_id: None,
                        sys_uptime: None,
                        sys_contact: None,
                        sys_name: None,
                        sys_location: None,
                        sys_services: None,
                        if_number: None,
                        last_seen: Some(chrono::Utc::now().to_rfc3339()),
                        reachable: true,
                    };

                    // Fetch additional system info if configured
                    if config.fetch_info {
                        fetch_device_info(&client, &target, &mut device).await;
                    }

                    return Some(device);
                }
                Err(_) => continue,
            }
        }
    }

    None
}

/// Fetch additional system info for a discovered device.
async fn fetch_device_info(client: &SnmpClient, target: &SnmpTarget, device: &mut SnmpDevice) {
    let oids = vec![
        well_known::SYS_OBJECT_ID.to_string(),
        well_known::SYS_UPTIME.to_string(),
        well_known::SYS_CONTACT.to_string(),
        well_known::SYS_NAME.to_string(),
        well_known::SYS_LOCATION.to_string(),
        well_known::SYS_SERVICES.to_string(),
        well_known::IF_NUMBER.to_string(),
    ];

    if let Ok(response) = client.get(target, &oids).await {
        for vb in &response.varbinds {
            if vb.value.is_exception() {
                continue;
            }
            match vb.oid.as_str() {
                oid if oid == well_known::SYS_OBJECT_ID => {
                    device.sys_object_id = Some(vb.value.display_value());
                }
                oid if oid == well_known::SYS_UPTIME => {
                    device.sys_uptime = Some(vb.value.display_value());
                }
                oid if oid == well_known::SYS_CONTACT => {
                    device.sys_contact = Some(vb.value.display_value());
                }
                oid if oid == well_known::SYS_NAME => {
                    device.sys_name = Some(vb.value.display_value());
                }
                oid if oid == well_known::SYS_LOCATION => {
                    device.sys_location = Some(vb.value.display_value());
                }
                oid if oid == well_known::SYS_SERVICES => {
                    device.sys_services = vb.value.as_integer();
                }
                oid if oid == well_known::IF_NUMBER => {
                    device.if_number = vb.value.as_integer();
                }
                _ => {}
            }
        }
    }
}

/// Expand a CIDR notation subnet into a list of host IPs.
/// Only supports IPv4 /24, /16, or specific ranges.
fn expand_cidr(cidr: &str) -> Result<Vec<String>, String> {
    let parts: Vec<&str> = cidr.split('/').collect();
    if parts.len() != 2 {
        // Treat as single host
        return Ok(vec![cidr.to_string()]);
    }

    let base_ip: Ipv4Addr = parts[0].parse()
        .map_err(|e| format!("Invalid IP: {}", e))?;
    let prefix_len: u32 = parts[1].parse()
        .map_err(|e| format!("Invalid prefix length: {}", e))?;

    if prefix_len > 32 {
        return Err("Prefix length must be <= 32".to_string());
    }

    let base_u32 = u32::from(base_ip);
    let mask = if prefix_len == 0 { 0 } else { !((1u32 << (32 - prefix_len)) - 1) };
    let network = base_u32 & mask;
    let broadcast = network | !mask;

    // Skip network and broadcast addresses
    let start = network + 1;
    let end = broadcast; // exclusive of broadcast

    if end - start > 65536 {
        return Err("Subnet too large (max /16 = 65534 hosts)".to_string());
    }

    let mut ips = vec![];
    for addr in start..end {
        ips.push(Ipv4Addr::from(addr).to_string());
    }

    Ok(ips)
}
