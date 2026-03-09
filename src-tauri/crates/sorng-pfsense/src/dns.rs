use crate::client::PfsenseClient;
use crate::error::PfsenseResult;
use crate::types::*;

pub struct DnsManager;

impl DnsManager {
    pub async fn get_resolver_config(client: &PfsenseClient) -> PfsenseResult<DnsResolverConfig> {
        let resp: ApiResponse<DnsResolverConfig> = client.api_get("services/unbound").await?;
        Ok(resp.data)
    }

    pub async fn update_resolver_config(
        client: &PfsenseClient,
        config: &DnsResolverConfig,
    ) -> PfsenseResult<DnsResolverConfig> {
        let resp: ApiResponse<DnsResolverConfig> =
            client.api_put("services/unbound", config).await?;
        Ok(resp.data)
    }

    pub async fn get_forwarder_config(client: &PfsenseClient) -> PfsenseResult<DnsForwarderConfig> {
        let resp: ApiResponse<DnsForwarderConfig> = client.api_get("services/dnsmasq").await?;
        Ok(resp.data)
    }

    pub async fn update_forwarder_config(
        client: &PfsenseClient,
        config: &DnsForwarderConfig,
    ) -> PfsenseResult<DnsForwarderConfig> {
        let resp: ApiResponse<DnsForwarderConfig> =
            client.api_put("services/dnsmasq", config).await?;
        Ok(resp.data)
    }

    pub async fn list_host_overrides(
        client: &PfsenseClient,
    ) -> PfsenseResult<Vec<DnsHostOverride>> {
        let resp: ApiListResponse<DnsHostOverride> =
            client.api_get("services/unbound/host_override").await?;
        Ok(resp.data)
    }

    pub async fn get_host_override(
        client: &PfsenseClient,
        id: &str,
    ) -> PfsenseResult<DnsHostOverride> {
        let resp: ApiResponse<DnsHostOverride> = client
            .api_get(&format!("services/unbound/host_override/{id}"))
            .await?;
        Ok(resp.data)
    }

    pub async fn create_host_override(
        client: &PfsenseClient,
        entry: &DnsHostOverride,
    ) -> PfsenseResult<DnsHostOverride> {
        let resp: ApiResponse<DnsHostOverride> = client
            .api_post("services/unbound/host_override", entry)
            .await?;
        Ok(resp.data)
    }

    pub async fn update_host_override(
        client: &PfsenseClient,
        id: &str,
        entry: &DnsHostOverride,
    ) -> PfsenseResult<DnsHostOverride> {
        let resp: ApiResponse<DnsHostOverride> = client
            .api_put(&format!("services/unbound/host_override/{id}"), entry)
            .await?;
        Ok(resp.data)
    }

    pub async fn delete_host_override(client: &PfsenseClient, id: &str) -> PfsenseResult<()> {
        client
            .api_delete_void(&format!("services/unbound/host_override/{id}"))
            .await
    }

    pub async fn list_domain_overrides(
        client: &PfsenseClient,
    ) -> PfsenseResult<Vec<DnsDomainOverride>> {
        let resp: ApiListResponse<DnsDomainOverride> =
            client.api_get("services/unbound/domain_override").await?;
        Ok(resp.data)
    }

    pub async fn get_domain_override(
        client: &PfsenseClient,
        id: &str,
    ) -> PfsenseResult<DnsDomainOverride> {
        let resp: ApiResponse<DnsDomainOverride> = client
            .api_get(&format!("services/unbound/domain_override/{id}"))
            .await?;
        Ok(resp.data)
    }

    pub async fn create_domain_override(
        client: &PfsenseClient,
        entry: &DnsDomainOverride,
    ) -> PfsenseResult<DnsDomainOverride> {
        let resp: ApiResponse<DnsDomainOverride> = client
            .api_post("services/unbound/domain_override", entry)
            .await?;
        Ok(resp.data)
    }

    pub async fn update_domain_override(
        client: &PfsenseClient,
        id: &str,
        entry: &DnsDomainOverride,
    ) -> PfsenseResult<DnsDomainOverride> {
        let resp: ApiResponse<DnsDomainOverride> = client
            .api_put(&format!("services/unbound/domain_override/{id}"), entry)
            .await?;
        Ok(resp.data)
    }

    pub async fn delete_domain_override(client: &PfsenseClient, id: &str) -> PfsenseResult<()> {
        client
            .api_delete_void(&format!("services/unbound/domain_override/{id}"))
            .await
    }

    pub async fn flush_cache(client: &PfsenseClient) -> PfsenseResult<serde_json::Value> {
        client
            .api_post("services/unbound/flush_cache", &serde_json::json!({}))
            .await
    }

    pub async fn get_cache_stats(client: &PfsenseClient) -> PfsenseResult<DnsCacheStats> {
        let resp: ApiResponse<DnsCacheStats> =
            client.api_get("services/unbound/cache_stats").await?;
        Ok(resp.data)
    }

    pub async fn apply(client: &PfsenseClient) -> PfsenseResult<serde_json::Value> {
        client
            .api_post("services/unbound/apply", &serde_json::json!({}))
            .await
    }
}
