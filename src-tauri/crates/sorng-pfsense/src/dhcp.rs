//! DHCP server management for pfSense/OPNsense.

use crate::client::PfsenseClient;
use crate::error::{PfsenseError, PfsenseResult};
use crate::types::*;

pub struct DhcpManager;

impl DhcpManager {
    pub async fn get_config(client: &PfsenseClient, interface: &str) -> PfsenseResult<DhcpServerConfig> {
        let resp = client.api_get(&format!("/services/dhcpd/{interface}")).await?;
        let data = resp.get("data").cloned().unwrap_or(resp);
        let range = data.get("range").cloned().unwrap_or_default();
        Ok(DhcpServerConfig {
            interface: interface.to_string(),
            enable: data.get("enable").and_then(|v| v.as_bool()).unwrap_or(false),
            range_from: range.get("from").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            range_to: range.get("to").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            dns_servers: data.get("dnsserver")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default(),
            gateway: data.get("gateway").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            domain: data.get("domain").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            default_lease_time: data.get("defaultleasetime").and_then(|v| v.as_u64()).unwrap_or(7200),
            max_lease_time: data.get("maxleasetime").and_then(|v| v.as_u64()).unwrap_or(86400),
            static_mappings: data.get("staticmap")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|v| serde_json::from_value(v.clone()).ok()).collect())
                .unwrap_or_default(),
            wins_servers: data.get("winsserver")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default(),
            ntp_servers: data.get("ntpserver")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default(),
        })
    }

    pub async fn update_config(client: &PfsenseClient, req: &UpdateDhcpConfigRequest) -> PfsenseResult<()> {
        let body = serde_json::to_value(req)
            .map_err(|e| PfsenseError::parse(e.to_string()))?;
        client.api_put(&format!("/services/dhcpd/{}", req.interface), &body).await?;
        Ok(())
    }

    pub async fn list_leases(client: &PfsenseClient) -> PfsenseResult<Vec<DhcpLease>> {
        let resp = client.api_get("/services/dhcpd/lease").await?;
        let leases = resp.get("data")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default();
        leases.into_iter()
            .map(|v| serde_json::from_value(v).map_err(|e| PfsenseError::parse(e.to_string())))
            .collect()
    }

    pub async fn list_static_mappings(client: &PfsenseClient, interface: &str) -> PfsenseResult<Vec<DhcpStaticMapping>> {
        let config = Self::get_config(client, interface).await?;
        Ok(config.static_mappings)
    }

    pub async fn create_static_mapping(
        client: &PfsenseClient,
        interface: &str,
        mapping: &DhcpStaticMapping,
    ) -> PfsenseResult<DhcpStaticMapping> {
        let body = serde_json::to_value(mapping)
            .map_err(|e| PfsenseError::parse(e.to_string()))?;
        let resp = client.api_post(
            &format!("/services/dhcpd/{interface}/static_mapping"),
            &body,
        ).await?;
        serde_json::from_value(resp.get("data").cloned().unwrap_or(resp))
            .map_err(|e| PfsenseError::parse(e.to_string()))
    }

    pub async fn delete_static_mapping(
        client: &PfsenseClient,
        interface: &str,
        mapping_id: &str,
    ) -> PfsenseResult<()> {
        client.api_delete(&format!(
            "/services/dhcpd/{interface}/static_mapping/{mapping_id}"
        )).await
    }

    pub async fn get_pool_stats(client: &PfsenseClient, interface: &str) -> PfsenseResult<DhcpPoolStats> {
        let config = Self::get_config(client, interface).await?;
        let leases = Self::list_leases(client).await?;
        let active = leases.iter()
            .filter(|l| l.binding_state == "active")
            .count() as u64;
        let total = Self::ip_range_size(&config.range_from, &config.range_to);
        Ok(DhcpPoolStats {
            interface: interface.to_string(),
            total,
            active,
            available: total.saturating_sub(active),
            range_from: config.range_from,
            range_to: config.range_to,
        })
    }

    fn ip_range_size(from: &str, to: &str) -> u64 {
        let parse = |s: &str| -> u32 {
            s.split('.')
                .filter_map(|p| p.parse::<u32>().ok())
                .enumerate()
                .fold(0u32, |acc, (i, v)| acc | (v << (8 * (3 - i))))
        };
        let f = parse(from);
        let t = parse(to);
        if t >= f { (t - f + 1) as u64 } else { 0 }
    }
}
