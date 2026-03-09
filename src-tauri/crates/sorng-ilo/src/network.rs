//! Network adapter and iLO NIC management.

use crate::client::IloClient;
use crate::error::{IloError, IloResult};
use crate::types::*;

/// Network management operations.
pub struct NetworkManager<'a> {
    client: &'a IloClient,
}

impl<'a> NetworkManager<'a> {
    pub fn new(client: &'a IloClient) -> Self {
        Self { client }
    }

    /// Get server network adapters.
    pub async fn get_network_adapters(&self) -> IloResult<Vec<BmcNetworkAdapter>> {
        if let Ok(rf) = self.client.require_redfish() {
            let adapters: Vec<serde_json::Value> = rf.get_network_adapters().await?;
            let mut result = Vec::new();

            for nic in &adapters {
                result.push(BmcNetworkAdapter {
                    id: nic
                        .get("Id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    name: nic
                        .get("Name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("NIC")
                        .to_string(),
                    manufacturer: nic
                        .get("Manufacturer")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    model: nic
                        .get("Model")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    mac_address: nic
                        .pointer("/Controllers/0/MACAddresses/0")
                        .and_then(|v| v.as_str())
                        .or_else(|| nic.get("MACAddress").and_then(|v| v.as_str()))
                        .map(|s| s.to_string()),
                    status: component_health(
                        nic.get("Status")
                            .and_then(|s| s.get("Health"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("Unknown"),
                    ),
                });
            }
            return Ok(result);
        }

        if let Ok(ribcl) = self.client.require_ribcl() {
            let health = ribcl.get_embedded_health().await?;
            let mut result = Vec::new();

            if let Some(nic_arr) = health.get("NIC").and_then(|v| v.as_array()) {
                for (i, nic) in nic_arr.iter().enumerate() {
                    let mac = nic
                        .get("MAC_ADDRESS")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let status = nic
                        .get("STATUS")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Unknown");

                    result.push(BmcNetworkAdapter {
                        id: format!("{}", i + 1),
                        name: nic
                            .get("NETWORK_PORT")
                            .and_then(|v| v.as_str())
                            .unwrap_or("NIC")
                            .to_string(),
                        manufacturer: None,
                        model: nic
                            .get("PORT_DESCRIPTION")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        mac_address: mac,
                        status: component_health(status),
                    });
                }
            }
            return Ok(result);
        }

        Err(IloError::unsupported(
            "No protocol available for network adapters",
        ))
    }

    /// Get iLO dedicated network interface info.
    pub async fn get_ilo_network(&self) -> IloResult<serde_json::Value> {
        if let Ok(rf) = self.client.require_redfish() {
            let ifaces = rf.get_ilo_ethernet().await?;
            return Ok(serde_json::Value::Array(ifaces));
        }

        if let Ok(ribcl) = self.client.require_ribcl() {
            return ribcl.get_network_settings().await;
        }

        Err(IloError::unsupported(
            "No protocol available for iLO network info",
        ))
    }
}
