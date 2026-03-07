// ── sorng-zabbix/src/discovery.rs ────────────────────────────────────────────
//! Network discovery via Zabbix JSON-RPC API.

use crate::client::ZabbixClient;
use crate::error::ZabbixError;
use crate::types::*;
use serde_json::Value;

pub struct DiscoveryManager;

impl DiscoveryManager {
    /// Retrieve discovery rules.  method: drule.get
    pub async fn drule_get(
        client: &ZabbixClient,
        params: Value,
    ) -> Result<Vec<ZabbixDiscoveryRule>, ZabbixError> {
        client.request_typed("drule.get", params).await
    }

    /// Create a discovery rule.  method: drule.create
    pub async fn drule_create(
        client: &ZabbixClient,
        rule: &ZabbixDiscoveryRule,
    ) -> Result<Value, ZabbixError> {
        client.request("drule.create", rule).await
    }

    /// Delete discovery rules by IDs.  method: drule.delete
    pub async fn drule_delete(
        client: &ZabbixClient,
        ids: Vec<String>,
    ) -> Result<Value, ZabbixError> {
        client.request("drule.delete", ids).await
    }

    /// Retrieve discovered hosts.  method: dhost.get
    pub async fn dhost_get(
        client: &ZabbixClient,
        params: Value,
    ) -> Result<Vec<ZabbixDhost>, ZabbixError> {
        client.request_typed("dhost.get", params).await
    }

    /// Retrieve discovered services.  method: dservice.get
    pub async fn dservice_get(
        client: &ZabbixClient,
        params: Value,
    ) -> Result<Vec<ZabbixDservice>, ZabbixError> {
        client.request_typed("dservice.get", params).await
    }
}
