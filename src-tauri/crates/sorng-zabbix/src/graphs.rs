// ── sorng-zabbix/src/graphs.rs ───────────────────────────────────────────────
//! Graph management via Zabbix JSON-RPC API.

use crate::client::ZabbixClient;
use crate::error::ZabbixError;
use crate::types::*;
use serde_json::Value;

pub struct GraphManager;

impl GraphManager {
    /// Retrieve graphs.  method: graph.get
    pub async fn get(
        client: &ZabbixClient,
        params: Value,
    ) -> Result<Vec<ZabbixGraph>, ZabbixError> {
        client.request_typed("graph.get", params).await
    }

    /// Create a graph.  method: graph.create
    pub async fn create(client: &ZabbixClient, graph: &ZabbixGraph) -> Result<Value, ZabbixError> {
        client.request("graph.create", graph).await
    }

    /// Update a graph.  method: graph.update
    pub async fn update(client: &ZabbixClient, graph: &ZabbixGraph) -> Result<Value, ZabbixError> {
        client.request("graph.update", graph).await
    }

    /// Delete graphs by IDs.  method: graph.delete
    pub async fn delete(
        client: &ZabbixClient,
        graphids: Vec<String>,
    ) -> Result<Value, ZabbixError> {
        client.request("graph.delete", graphids).await
    }
}
