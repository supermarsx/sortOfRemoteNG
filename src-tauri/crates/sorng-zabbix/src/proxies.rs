// ── sorng-zabbix/src/proxies.rs ──────────────────────────────────────────────
//! Proxy management via Zabbix JSON-RPC API.

use crate::client::ZabbixClient;
use crate::error::ZabbixError;
use crate::types::*;
use serde_json::Value;

pub struct ProxyManager;

impl ProxyManager {
    /// Retrieve proxies.  method: proxy.get
    pub async fn get(
        client: &ZabbixClient,
        params: Value,
    ) -> Result<Vec<ZabbixProxy>, ZabbixError> {
        client.request_typed("proxy.get", params).await
    }

    /// Create a proxy.  method: proxy.create
    pub async fn create(client: &ZabbixClient, proxy: &ZabbixProxy) -> Result<Value, ZabbixError> {
        client.request("proxy.create", proxy).await
    }

    /// Update a proxy.  method: proxy.update
    pub async fn update(client: &ZabbixClient, proxy: &ZabbixProxy) -> Result<Value, ZabbixError> {
        client.request("proxy.update", proxy).await
    }

    /// Delete proxies by IDs.  method: proxy.delete
    pub async fn delete(client: &ZabbixClient, ids: Vec<String>) -> Result<Value, ZabbixError> {
        client.request("proxy.delete", ids).await
    }
}
