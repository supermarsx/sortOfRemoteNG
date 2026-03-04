//! Network management — NICs, ports, iDRAC network config.

use crate::client::IdracClient;
use crate::error::{IdracError, IdracResult};
use crate::types::*;
use crate::wsman::dcim_classes;

/// Network adapter and port management.
pub struct NetworkManager<'a> {
    client: &'a IdracClient,
}

impl<'a> NetworkManager<'a> {
    pub fn new(client: &'a IdracClient) -> Self {
        Self { client }
    }

    /// List network adapters.
    pub async fn list_adapters(&self) -> IdracResult<Vec<NetworkAdapter>> {
        if let Ok(rf) = self.client.require_redfish() {
            let col: serde_json::Value = rf
                .get("/redfish/v1/Systems/System.Embedded.1/NetworkAdapters?$expand=*($levels=1)")
                .await
                .or_else(|_| -> IdracResult<serde_json::Value> {
                    // iDRAC 8 may use EthernetInterfaces
                    Err(IdracError::not_found("Trying alternate path"))
                })?;

            let members = col.get("Members").and_then(|v| v.as_array()).cloned().unwrap_or_default();

            return Ok(members
                .iter()
                .map(|a| NetworkAdapter {
                    id: a.get("Id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    name: a.get("Name").and_then(|v| v.as_str()).unwrap_or("NIC").to_string(),
                    manufacturer: a.get("Manufacturer").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    model: a.get("Model").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    serial_number: a.get("SerialNumber").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    part_number: a.get("PartNumber").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    firmware_version: a.get("Controllers")
                        .and_then(|v| v.as_array())
                        .and_then(|a| a.first())
                        .and_then(|c| c.get("FirmwarePackageVersion"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    status: ComponentHealth {
                        health: a.pointer("/Status/Health").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        health_rollup: a.pointer("/Status/HealthRollup").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        state: a.pointer("/Status/State").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    },
                    port_count: a.get("Controllers")
                        .and_then(|v| v.as_array())
                        .and_then(|a| a.first())
                        .and_then(|c| c.get("Links"))
                        .and_then(|l| l.get("NetworkPorts"))
                        .and_then(|v| v.as_array())
                        .map(|a| a.len() as u32),
                })
                .collect());
        }

        if let Ok(ws) = self.client.require_wsman() {
            let views = ws.enumerate(dcim_classes::NIC_VIEW).await?;

            // Group by adapter (use first segment of FQDD)
            let mut adapters = std::collections::HashMap::<String, NetworkAdapter>::new();
            for v in &views {
                let fqdd = v.properties.get("FQDD").and_then(|val| val.as_str()).unwrap_or("");
                let adapter_id = fqdd.split('-').next().unwrap_or(fqdd).to_string();

                adapters.entry(adapter_id.clone()).or_insert_with(|| {
                    let get = |k: &str| v.properties.get(k).and_then(|val| val.as_str()).map(|s| s.to_string());
                    NetworkAdapter {
                        id: adapter_id.clone(),
                        name: get("ProductName").unwrap_or_else(|| "NIC".to_string()),
                        manufacturer: get("Manufacturer"),
                        model: get("ProductName"),
                        serial_number: get("SerialNumber"),
                        part_number: get("PartNumber"),
                        firmware_version: get("FamilyVersion"),
                        status: ComponentHealth {
                            health: get("PrimaryStatus"),
                            health_rollup: None,
                            state: None,
                        },
                        port_count: None,
                    }
                });
            }

            return Ok(adapters.into_values().collect());
        }

        Err(IdracError::unsupported("NIC listing requires Redfish or WSMAN"))
    }

    /// List network ports (Ethernet interfaces).
    pub async fn list_ports(&self) -> IdracResult<Vec<NetworkPort>> {
        if let Ok(rf) = self.client.require_redfish() {
            let col: serde_json::Value = rf
                .get("/redfish/v1/Systems/System.Embedded.1/EthernetInterfaces?$expand=*($levels=1)")
                .await?;

            let members = col.get("Members").and_then(|v| v.as_array()).cloned().unwrap_or_default();

            return Ok(members
                .iter()
                .map(|p| NetworkPort {
                    id: p.get("Id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    name: p.get("Name").and_then(|v| v.as_str()).unwrap_or("Port").to_string(),
                    mac_address: p.get("MACAddress").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    permanent_mac_address: p.get("PermanentMACAddress").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    link_status: p.get("LinkStatus").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    speed_mbps: p.get("SpeedMbps").and_then(|v| v.as_u64()).map(|n| n as u32),
                    auto_neg: p.get("AutoNeg").and_then(|v| v.as_bool()),
                    full_duplex: p.get("FullDuplex").and_then(|v| v.as_bool()),
                    mtu_size: p.get("MTUSize").and_then(|v| v.as_u64()).map(|n| n as u32),
                    ipv4_addresses: p.get("IPv4Addresses").and_then(|v| v.as_array())
                        .map(|a| a.iter().filter_map(|addr| addr.get("Address").and_then(|v| v.as_str()).map(|s| s.to_string())).collect())
                        .unwrap_or_default(),
                    ipv6_addresses: p.get("IPv6Addresses").and_then(|v| v.as_array())
                        .map(|a| a.iter().filter_map(|addr| addr.get("Address").and_then(|v| v.as_str()).map(|s| s.to_string())).collect())
                        .unwrap_or_default(),
                    vlan_id: p.get("VLAN").and_then(|v| v.get("VLANId")).and_then(|v| v.as_u64()).map(|n| n as u32),
                    vlan_enabled: p.get("VLAN").and_then(|v| v.get("VLANEnable")).and_then(|v| v.as_bool()),
                    status: ComponentHealth {
                        health: p.pointer("/Status/Health").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        health_rollup: None,
                        state: p.pointer("/Status/State").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    },
                })
                .collect());
        }

        if let Ok(ws) = self.client.require_wsman() {
            let views = ws.enumerate(dcim_classes::NIC_VIEW).await?;
            return Ok(views
                .iter()
                .map(|v| {
                    let get = |k: &str| v.properties.get(k).and_then(|val| val.as_str()).map(|s| s.to_string());
                    let get_u32 = |k: &str| v.properties.get(k).and_then(|val| val.as_u64()).map(|n| n as u32);
                    NetworkPort {
                        id: get("FQDD").unwrap_or_default(),
                        name: get("DeviceDescription").unwrap_or_else(|| "Port".to_string()),
                        mac_address: get("CurrentMACAddress"),
                        permanent_mac_address: get("PermanentMACAddress"),
                        link_status: get("LinkStatus"),
                        speed_mbps: get_u32("LinkSpeed"),
                        auto_neg: v.properties.get("AutoNegotiation").and_then(|val| val.as_str()).map(|s| s == "1" || s.eq_ignore_ascii_case("true")),
                        full_duplex: v.properties.get("LinkDuplex").and_then(|val| val.as_str()).map(|s| s.contains("Full")),
                        mtu_size: get_u32("MTUSize"),
                        ipv4_addresses: Vec::new(),
                        ipv6_addresses: Vec::new(),
                        vlan_id: get_u32("VLanId"),
                        vlan_enabled: v.properties.get("VLanMode").and_then(|val| val.as_str()).map(|s| s != "0"),
                        status: ComponentHealth {
                            health: get("PrimaryStatus"),
                            health_rollup: None,
                            state: None,
                        },
                    }
                })
                .collect());
        }

        Err(IdracError::unsupported("Port listing requires Redfish or WSMAN"))
    }

    /// Get iDRAC network configuration.
    pub async fn get_idrac_network_config(&self) -> IdracResult<IdracNetworkConfig> {
        if let Ok(rf) = self.client.require_redfish() {
            let iface: serde_json::Value = rf
                .get("/redfish/v1/Managers/iDRAC.Embedded.1/EthernetInterfaces/NIC.1")
                .await?;

            return Ok(IdracNetworkConfig {
                mac_address: iface.get("MACAddress").and_then(|v| v.as_str()).map(|s| s.to_string()),
                ipv4_address: iface.get("IPv4Addresses").and_then(|v| v.as_array()).and_then(|a| a.first()).and_then(|addr| addr.get("Address")).and_then(|v| v.as_str()).map(|s| s.to_string()),
                ipv4_subnet: iface.get("IPv4Addresses").and_then(|v| v.as_array()).and_then(|a| a.first()).and_then(|addr| addr.get("SubnetMask")).and_then(|v| v.as_str()).map(|s| s.to_string()),
                ipv4_gateway: iface.get("IPv4Addresses").and_then(|v| v.as_array()).and_then(|a| a.first()).and_then(|addr| addr.get("Gateway")).and_then(|v| v.as_str()).map(|s| s.to_string()),
                ipv4_dhcp_enabled: iface.get("DHCPv4").and_then(|v| v.get("DHCPEnabled")).and_then(|v| v.as_bool()),
                ipv6_address: iface.get("IPv6Addresses").and_then(|v| v.as_array()).and_then(|a| a.first()).and_then(|addr| addr.get("Address")).and_then(|v| v.as_str()).map(|s| s.to_string()),
                ipv6_prefix_length: iface.get("IPv6Addresses").and_then(|v| v.as_array()).and_then(|a| a.first()).and_then(|addr| addr.get("PrefixLength")).and_then(|v| v.as_u64()).map(|n| n as u32),
                ipv6_gateway: iface.get("IPv6DefaultGateway").and_then(|v| v.as_str()).map(|s| s.to_string()),
                dns_servers: iface.get("NameServers").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect()).unwrap_or_default(),
                hostname: iface.get("HostName").and_then(|v| v.as_str()).map(|s| s.to_string()),
                domain_name: iface.get("FQDN").and_then(|v| v.as_str()).map(|s| s.to_string()),
                speed_mbps: iface.get("SpeedMbps").and_then(|v| v.as_u64()).map(|n| n as u32),
                auto_negotiation: iface.get("AutoNeg").and_then(|v| v.as_bool()),
                vlan_id: iface.get("VLAN").and_then(|v| v.get("VLANId")).and_then(|v| v.as_u64()).map(|n| n as u32),
                vlan_enabled: iface.get("VLAN").and_then(|v| v.get("VLANEnable")).and_then(|v| v.as_bool()),
            });
        }

        Err(IdracError::unsupported("iDRAC network config requires Redfish"))
    }

    /// Update iDRAC network configuration.
    pub async fn update_idrac_network_config(
        &self,
        ipv4_address: Option<&str>,
        ipv4_subnet: Option<&str>,
        ipv4_gateway: Option<&str>,
        dhcp_enabled: Option<bool>,
    ) -> IdracResult<()> {
        let rf = self.client.require_redfish()?;

        let mut body = serde_json::Map::new();

        if let Some(dhcp) = dhcp_enabled {
            body.insert(
                "DHCPv4".to_string(),
                serde_json::json!({ "DHCPEnabled": dhcp }),
            );
        }

        if ipv4_address.is_some() || ipv4_subnet.is_some() || ipv4_gateway.is_some() {
            let mut addr = serde_json::Map::new();
            if let Some(ip) = ipv4_address {
                addr.insert("Address".to_string(), serde_json::Value::String(ip.to_string()));
            }
            if let Some(sub) = ipv4_subnet {
                addr.insert("SubnetMask".to_string(), serde_json::Value::String(sub.to_string()));
            }
            if let Some(gw) = ipv4_gateway {
                addr.insert("Gateway".to_string(), serde_json::Value::String(gw.to_string()));
            }
            body.insert(
                "IPv4Addresses".to_string(),
                serde_json::json!([addr]),
            );
        }

        rf.patch_json(
            "/redfish/v1/Managers/iDRAC.Embedded.1/EthernetInterfaces/NIC.1",
            &serde_json::Value::Object(body),
        )
        .await
    }
}
