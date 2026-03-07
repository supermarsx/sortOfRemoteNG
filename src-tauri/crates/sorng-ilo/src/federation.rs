//! iLO Federation — group management, peer discovery, multicast settings.

use crate::client::IloClient;
use crate::error::{IloError, IloResult};
use crate::types::*;

/// Federation management operations.
pub struct FederationManager<'a> {
    client: &'a IloClient,
}

impl<'a> FederationManager<'a> {
    pub fn new(client: &'a IloClient) -> Self {
        Self { client }
    }

    /// Get federation groups this iLO belongs to.
    pub async fn get_groups(&self) -> IloResult<Vec<IloFederationGroup>> {
        if let Ok(rf) = self.client.require_redfish() {
            let members: Vec<serde_json::Value> = rf.get_federation_groups().await?;
            let mut groups = Vec::new();

            for group in &members {
                    groups.push(IloFederationGroup {
                        name: group.get("Name")
                            .and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        key: None, // Never expose the key
                        privileges: group.get("Privileges")
                            .and_then(|v| v.as_object())
                            .map(|p| p.iter()
                                .filter(|(_, v)| v.as_bool().unwrap_or(false))
                                .map(|(k, _)| k.clone())
                                .collect())
                            .unwrap_or_default(),
                    });
            }
            return Ok(groups);
        }

        if let Ok(ribcl) = self.client.require_ribcl() {
            let data = ribcl.get_federation_groups().await?;
            let mut groups = Vec::new();

            if let Some(arr) = data.as_array() {
                for group in arr {
                    let name = group.get("GROUP_NAME")
                        .and_then(|v| v.as_str()).unwrap_or("");
                    if !name.is_empty() {
                        groups.push(IloFederationGroup {
                            name: name.to_string(),
                            key: None,
                            privileges: Vec::new(),
                        });
                    }
                }
            }
            return Ok(groups);
        }

        Err(IloError::unsupported("No protocol available for federation groups"))
    }

    /// Get discovered federation peers.
    pub async fn get_peers(&self) -> IloResult<Vec<IloFederationPeer>> {
        if let Ok(rf) = self.client.require_redfish() {
            let members: Vec<serde_json::Value> = rf.get_federation_peers().await?;
            let mut peers = Vec::new();

            for peer in &members {
                    peers.push(IloFederationPeer {
                        name: peer.get("ManagerIPAddress")
                            .or_else(|| peer.get("Name"))
                            .and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        ip_address: peer.get("ManagerIPAddress")
                            .and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        group: peer.get("GroupName")
                            .and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        ilo_generation: peer.pointer("/Oem/Hpe/iLOType")
                            .and_then(|v| v.as_str()).map(|s| s.to_string()),
                        firmware_version: peer.pointer("/Oem/Hpe/iLOFirmwareVersion")
                            .and_then(|v| v.as_str()).map(|s| s.to_string()),
                        server_name: peer.get("ServerName")
                            .and_then(|v| v.as_str()).map(|s| s.to_string()),
                    });
            }
            return Ok(peers);
        }

        if let Ok(ribcl) = self.client.require_ribcl() {
            let mc_data = ribcl.get_federation_multicast().await?;
            // RIBCL federation multicast returns limited peer info
            let _ = mc_data;
            return Ok(Vec::new());
        }

        Err(IloError::unsupported("No protocol available for federation peers"))
    }

    /// Add a federation group.
    pub async fn add_group(&self, name: &str, key: &str) -> IloResult<()> {
        let rf = self.client.require_redfish()?;
        let gen = self.client.generation;

        let path = if matches!(gen, IloGeneration::Ilo5 | IloGeneration::Ilo6 | IloGeneration::Ilo7) {
            "/redfish/v1/Managers/1/FederationGroups"
        } else {
            "/redfish/v1/Managers/1/FederationGroups"
        };

        let body = serde_json::json!({
            "Name": name,
            "Key": key,
        });

        rf.inner.post_json::<_, ()>(path, &body).await?;
        Ok(())
    }

    /// Remove a federation group.
    pub async fn remove_group(&self, name: &str) -> IloResult<()> {
        let rf = self.client.require_redfish()?;
        let path = format!("/redfish/v1/Managers/1/FederationGroups/{}", name);
        rf.inner.delete(&path).await?;
        Ok(())
    }
}
