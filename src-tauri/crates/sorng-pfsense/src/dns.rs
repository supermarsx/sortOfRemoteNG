//! DNS resolver/forwarder management for pfSense/OPNsense.

use crate::client::PfsenseClient;
use crate::error::{PfsenseError, PfsenseResult};
use crate::types::*;

pub struct DnsManager;

impl DnsManager {
    pub async fn get_resolver_config(client: &PfsenseClient) -> PfsenseResult<DnsResolverConfig> {
        let resp = client.api_get("/services/unbound").await?;
        let data = resp.get("data").cloned().unwrap_or(resp);
        Ok(DnsResolverConfig {
            enable: data.get("enable").and_then(|v| v.as_bool()).unwrap_or(false),
            forwarding: data.get("forwarding").and_then(|v| v.as_bool()).unwrap_or(false),
            dnssec: data.get("dnssec").and_then(|v| v.as_bool()).unwrap_or(false),
            host_overrides: data.get("hosts")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|v| serde_json::from_value(v.clone()).ok()).collect())
                .unwrap_or_default(),
            domain_overrides: data.get("domainoverrides")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|v| serde_json::from_value(v.clone()).ok()).collect())
                .unwrap_or_default(),
        })
    }

    pub async fn update_resolver_config(client: &PfsenseClient, config: &DnsResolverConfig) -> PfsenseResult<()> {
        let body = serde_json::to_value(config)
            .map_err(|e| PfsenseError::parse(e.to_string()))?;
        client.api_put("/services/unbound", &body).await?;
        Ok(())
    }

    pub async fn get_forwarder_config(client: &PfsenseClient) -> PfsenseResult<DnsForwarderConfig> {
        let resp = client.api_get("/services/dnsmasq").await?;
        let data = resp.get("data").cloned().unwrap_or(resp);
        Ok(DnsForwarderConfig {
            enable: data.get("enable").and_then(|v| v.as_bool()).unwrap_or(false),
            host_overrides: data.get("hosts")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|v| serde_json::from_value(v.clone()).ok()).collect())
                .unwrap_or_default(),
            domain_overrides: data.get("domainoverrides")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|v| serde_json::from_value(v.clone()).ok()).collect())
                .unwrap_or_default(),
        })
    }

    pub async fn update_forwarder_config(client: &PfsenseClient, config: &DnsForwarderConfig) -> PfsenseResult<()> {
        let body = serde_json::to_value(config)
            .map_err(|e| PfsenseError::parse(e.to_string()))?;
        client.api_put("/services/dnsmasq", &body).await?;
        Ok(())
    }

    pub async fn list_host_overrides(client: &PfsenseClient) -> PfsenseResult<Vec<DnsHostOverride>> {
        let resp = client.api_get("/services/unbound/host_override").await?;
        let overrides = resp.get("data")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default();
        overrides.into_iter()
            .map(|v| serde_json::from_value(v).map_err(|e| PfsenseError::parse(e.to_string())))
            .collect()
    }

    pub async fn create_host_override(client: &PfsenseClient, ovr: &DnsHostOverride) -> PfsenseResult<DnsHostOverride> {
        let body = serde_json::to_value(ovr)
            .map_err(|e| PfsenseError::parse(e.to_string()))?;
        let resp = client.api_post("/services/unbound/host_override", &body).await?;
        serde_json::from_value(resp.get("data").cloned().unwrap_or(resp))
            .map_err(|e| PfsenseError::parse(e.to_string()))
    }

    pub async fn delete_host_override(client: &PfsenseClient, override_id: &str) -> PfsenseResult<()> {
        client.api_delete(&format!("/services/unbound/host_override/{override_id}")).await
    }

    pub async fn list_domain_overrides(client: &PfsenseClient) -> PfsenseResult<Vec<DnsDomainOverride>> {
        let resp = client.api_get("/services/unbound/domain_override").await?;
        let overrides = resp.get("data")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default();
        overrides.into_iter()
            .map(|v| serde_json::from_value(v).map_err(|e| PfsenseError::parse(e.to_string())))
            .collect()
    }

    pub async fn create_domain_override(client: &PfsenseClient, ovr: &DnsDomainOverride) -> PfsenseResult<DnsDomainOverride> {
        let body = serde_json::to_value(ovr)
            .map_err(|e| PfsenseError::parse(e.to_string()))?;
        let resp = client.api_post("/services/unbound/domain_override", &body).await?;
        serde_json::from_value(resp.get("data").cloned().unwrap_or(resp))
            .map_err(|e| PfsenseError::parse(e.to_string()))
    }

    pub async fn delete_domain_override(client: &PfsenseClient, override_id: &str) -> PfsenseResult<()> {
        client.api_delete(&format!("/services/unbound/domain_override/{override_id}")).await
    }

    pub async fn flush_dns_cache(client: &PfsenseClient) -> PfsenseResult<()> {
        let output = client.exec_ssh("pfSsh.php playback svc restart unbound").await?;
        if output.exit_code != 0 {
            return Err(PfsenseError::dns(format!("Failed to flush DNS cache: {}", output.stderr)));
        }
        Ok(())
    }

    pub async fn get_dyndns_config(client: &PfsenseClient) -> PfsenseResult<Vec<DynDnsConfig>> {
        let resp = client.api_get("/services/dyndns").await?;
        let configs = resp.get("data")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default();
        configs.into_iter()
            .map(|v| serde_json::from_value(v).map_err(|e| PfsenseError::parse(e.to_string())))
            .collect()
    }

    pub async fn update_dyndns_config(client: &PfsenseClient, config: &DynDnsConfig) -> PfsenseResult<()> {
        let body = serde_json::to_value(config)
            .map_err(|e| PfsenseError::parse(e.to_string()))?;
        client.api_put("/services/dyndns", &body).await?;
        Ok(())
    }
}
