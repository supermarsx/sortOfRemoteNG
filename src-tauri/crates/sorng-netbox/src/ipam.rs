// ── sorng-netbox – IPAM module ───────────────────────────────────────────────
//! IP addresses, prefixes, VLANs, VRFs, aggregates, RIRs, ranges, ASNs.

use crate::client::NetboxClient;
use crate::error::{NetboxError, NetboxResult};
use crate::types::*;

pub struct IpamManager;

impl IpamManager {
    // ── IP Addresses ─────────────────────────────────────────────────

    pub async fn list_ip_addresses(client: &NetboxClient) -> NetboxResult<Vec<IpAddress>> {
        client.api_get_list("/ipam/ip-addresses/").await
    }

    pub async fn get_ip_address(client: &NetboxClient, id: i64) -> NetboxResult<IpAddress> {
        let body = client.api_get(&format!("/ipam/ip-addresses/{id}/")).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("get_ip_address: {e}")))
    }

    pub async fn create_ip_address(client: &NetboxClient, data: &serde_json::Value) -> NetboxResult<IpAddress> {
        let body = client.api_post("/ipam/ip-addresses/", &data.to_string()).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("create_ip_address: {e}")))
    }

    pub async fn update_ip_address(client: &NetboxClient, id: i64, data: &serde_json::Value) -> NetboxResult<IpAddress> {
        let body = client.api_patch(&format!("/ipam/ip-addresses/{id}/"), &data.to_string()).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("update_ip_address: {e}")))
    }

    pub async fn delete_ip_address(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("/ipam/ip-addresses/{id}/")).await?;
        Ok(())
    }

    // ── Prefixes ─────────────────────────────────────────────────────

    pub async fn list_prefixes(client: &NetboxClient) -> NetboxResult<Vec<Prefix>> {
        client.api_get_list("/ipam/prefixes/").await
    }

    pub async fn get_prefix(client: &NetboxClient, id: i64) -> NetboxResult<Prefix> {
        let body = client.api_get(&format!("/ipam/prefixes/{id}/")).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("get_prefix: {e}")))
    }

    pub async fn create_prefix(client: &NetboxClient, data: &serde_json::Value) -> NetboxResult<Prefix> {
        let body = client.api_post("/ipam/prefixes/", &data.to_string()).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("create_prefix: {e}")))
    }

    pub async fn update_prefix(client: &NetboxClient, id: i64, data: &serde_json::Value) -> NetboxResult<Prefix> {
        let body = client.api_patch(&format!("/ipam/prefixes/{id}/"), &data.to_string()).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("update_prefix: {e}")))
    }

    pub async fn delete_prefix(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("/ipam/prefixes/{id}/")).await?;
        Ok(())
    }

    pub async fn get_available_ips(client: &NetboxClient, prefix_id: i64) -> NetboxResult<Vec<AvailableIp>> {
        let body = client.api_get(&format!("/ipam/prefixes/{prefix_id}/available-ips/")).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("get_available_ips: {e}")))
    }

    pub async fn get_available_prefixes(client: &NetboxClient, prefix_id: i64) -> NetboxResult<Vec<AvailablePrefix>> {
        let body = client.api_get(&format!("/ipam/prefixes/{prefix_id}/available-prefixes/")).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("get_available_prefixes: {e}")))
    }

    // ── VLANs ────────────────────────────────────────────────────────

    pub async fn list_vlans(client: &NetboxClient) -> NetboxResult<Vec<Vlan>> {
        client.api_get_list("/ipam/vlans/").await
    }

    pub async fn get_vlan(client: &NetboxClient, id: i64) -> NetboxResult<Vlan> {
        let body = client.api_get(&format!("/ipam/vlans/{id}/")).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("get_vlan: {e}")))
    }

    pub async fn create_vlan(client: &NetboxClient, data: &serde_json::Value) -> NetboxResult<Vlan> {
        let body = client.api_post("/ipam/vlans/", &data.to_string()).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("create_vlan: {e}")))
    }

    pub async fn update_vlan(client: &NetboxClient, id: i64, data: &serde_json::Value) -> NetboxResult<Vlan> {
        let body = client.api_patch(&format!("/ipam/vlans/{id}/"), &data.to_string()).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("update_vlan: {e}")))
    }

    pub async fn delete_vlan(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("/ipam/vlans/{id}/")).await?;
        Ok(())
    }

    // ── VRFs ─────────────────────────────────────────────────────────

    pub async fn list_vrfs(client: &NetboxClient) -> NetboxResult<Vec<Vrf>> {
        client.api_get_list("/ipam/vrfs/").await
    }

    pub async fn get_vrf(client: &NetboxClient, id: i64) -> NetboxResult<Vrf> {
        let body = client.api_get(&format!("/ipam/vrfs/{id}/")).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("get_vrf: {e}")))
    }

    pub async fn create_vrf(client: &NetboxClient, data: &serde_json::Value) -> NetboxResult<Vrf> {
        let body = client.api_post("/ipam/vrfs/", &data.to_string()).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("create_vrf: {e}")))
    }

    pub async fn update_vrf(client: &NetboxClient, id: i64, data: &serde_json::Value) -> NetboxResult<Vrf> {
        let body = client.api_patch(&format!("/ipam/vrfs/{id}/"), &data.to_string()).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("update_vrf: {e}")))
    }

    pub async fn delete_vrf(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("/ipam/vrfs/{id}/")).await?;
        Ok(())
    }

    // ── Aggregates ───────────────────────────────────────────────────

    pub async fn list_aggregates(client: &NetboxClient) -> NetboxResult<Vec<Aggregate>> {
        client.api_get_list("/ipam/aggregates/").await
    }

    // ── RIRs ─────────────────────────────────────────────────────────

    pub async fn list_rirs(client: &NetboxClient) -> NetboxResult<Vec<Rir>> {
        client.api_get_list("/ipam/rirs/").await
    }

    // ── IP Ranges ────────────────────────────────────────────────────

    pub async fn list_ip_ranges(client: &NetboxClient) -> NetboxResult<Vec<IpRange>> {
        client.api_get_list("/ipam/ip-ranges/").await
    }

    // ── ASNs ─────────────────────────────────────────────────────────

    pub async fn list_asns(client: &NetboxClient) -> NetboxResult<Vec<AsnInfo>> {
        client.api_get_list("/ipam/asns/").await
    }

    // ── Prefix utilization ───────────────────────────────────────────

    pub async fn get_prefix_utilization(client: &NetboxClient, prefix_id: i64) -> NetboxResult<serde_json::Value> {
        let body = client.api_get(&format!("/ipam/prefixes/{prefix_id}/")).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("get_prefix_utilization: {e}")))
    }
}
