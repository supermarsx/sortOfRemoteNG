// ── sorng-netbox/src/ipam.rs ─────────────────────────────────────────────────
//! IPAM management via NetBox REST API.

use crate::client::NetboxClient;
use crate::error::NetboxResult;
use crate::types::*;

pub struct IpamManager;

impl IpamManager {
    // ── IP Addresses ─────────────────────────────────────────────────

    pub async fn list_addresses(
        client: &NetboxClient,
        params: &[(&str, &str)],
    ) -> NetboxResult<PaginatedResponse<IpAddress>> {
        client.api_get_paginated("ipam/ip-addresses", params).await
    }

    pub async fn get_address(client: &NetboxClient, id: i64) -> NetboxResult<IpAddress> {
        client.api_get(&format!("ipam/ip-addresses/{id}")).await
    }

    pub async fn create_address(
        client: &NetboxClient,
        data: &serde_json::Value,
    ) -> NetboxResult<IpAddress> {
        client.api_post("ipam/ip-addresses", data).await
    }

    pub async fn update_address(
        client: &NetboxClient,
        id: i64,
        data: &serde_json::Value,
    ) -> NetboxResult<IpAddress> {
        client
            .api_put(&format!("ipam/ip-addresses/{id}"), data)
            .await
    }

    pub async fn delete_address(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("ipam/ip-addresses/{id}")).await
    }

    // ── Prefixes ─────────────────────────────────────────────────────

    pub async fn list_prefixes(
        client: &NetboxClient,
        params: &[(&str, &str)],
    ) -> NetboxResult<PaginatedResponse<Prefix>> {
        client.api_get_paginated("ipam/prefixes", params).await
    }

    pub async fn get_prefix(client: &NetboxClient, id: i64) -> NetboxResult<Prefix> {
        client.api_get(&format!("ipam/prefixes/{id}")).await
    }

    pub async fn create_prefix(
        client: &NetboxClient,
        data: &serde_json::Value,
    ) -> NetboxResult<Prefix> {
        client.api_post("ipam/prefixes", data).await
    }

    pub async fn update_prefix(
        client: &NetboxClient,
        id: i64,
        data: &serde_json::Value,
    ) -> NetboxResult<Prefix> {
        client.api_put(&format!("ipam/prefixes/{id}"), data).await
    }

    pub async fn delete_prefix(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("ipam/prefixes/{id}")).await
    }

    pub async fn get_available_ips(
        client: &NetboxClient,
        prefix_id: i64,
    ) -> NetboxResult<Vec<IpAddress>> {
        client
            .api_get(&format!("ipam/prefixes/{prefix_id}/available-ips"))
            .await
    }

    pub async fn create_available_ip(
        client: &NetboxClient,
        prefix_id: i64,
        data: &serde_json::Value,
    ) -> NetboxResult<IpAddress> {
        client
            .api_post(&format!("ipam/prefixes/{prefix_id}/available-ips"), data)
            .await
    }

    pub async fn get_available_prefixes(
        client: &NetboxClient,
        prefix_id: i64,
    ) -> NetboxResult<Vec<Prefix>> {
        client
            .api_get(&format!("ipam/prefixes/{prefix_id}/available-prefixes"))
            .await
    }

    // ── VRFs ─────────────────────────────────────────────────────────

    pub async fn list_vrfs(client: &NetboxClient) -> NetboxResult<PaginatedResponse<Vrf>> {
        client.api_get_paginated("ipam/vrfs", &[]).await
    }

    pub async fn get_vrf(client: &NetboxClient, id: i64) -> NetboxResult<Vrf> {
        client.api_get(&format!("ipam/vrfs/{id}")).await
    }

    pub async fn create_vrf(client: &NetboxClient, data: &serde_json::Value) -> NetboxResult<Vrf> {
        client.api_post("ipam/vrfs", data).await
    }

    pub async fn update_vrf(
        client: &NetboxClient,
        id: i64,
        data: &serde_json::Value,
    ) -> NetboxResult<Vrf> {
        client.api_put(&format!("ipam/vrfs/{id}"), data).await
    }

    pub async fn delete_vrf(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("ipam/vrfs/{id}")).await
    }

    // ── Aggregates ───────────────────────────────────────────────────

    pub async fn list_aggregates(
        client: &NetboxClient,
    ) -> NetboxResult<PaginatedResponse<Aggregate>> {
        client.api_get_paginated("ipam/aggregates", &[]).await
    }

    pub async fn get_aggregate(client: &NetboxClient, id: i64) -> NetboxResult<Aggregate> {
        client.api_get(&format!("ipam/aggregates/{id}")).await
    }

    // ── RIRs ─────────────────────────────────────────────────────────

    pub async fn list_rirs(client: &NetboxClient) -> NetboxResult<PaginatedResponse<Rir>> {
        client.api_get_paginated("ipam/rirs", &[]).await
    }

    pub async fn get_rir(client: &NetboxClient, id: i64) -> NetboxResult<Rir> {
        client.api_get(&format!("ipam/rirs/{id}")).await
    }

    // ── Roles ────────────────────────────────────────────────────────

    pub async fn list_roles(client: &NetboxClient) -> NetboxResult<PaginatedResponse<IpamRole>> {
        client.api_get_paginated("ipam/roles", &[]).await
    }

    pub async fn get_role(client: &NetboxClient, id: i64) -> NetboxResult<IpamRole> {
        client.api_get(&format!("ipam/roles/{id}")).await
    }

    // ── Services ─────────────────────────────────────────────────────

    pub async fn list_services(
        client: &NetboxClient,
        params: &[(&str, &str)],
    ) -> NetboxResult<PaginatedResponse<Service>> {
        client.api_get_paginated("ipam/services", params).await
    }
}
