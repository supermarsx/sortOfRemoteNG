// ── sorng-zabbix/src/alerts.rs ───────────────────────────────────────────────
//! Alert viewing via Zabbix JSON-RPC API.

use crate::client::ZabbixClient;
use crate::error::ZabbixError;
use crate::types::*;
use serde_json::Value;

pub struct AlertManager;

impl AlertManager {
    /// Retrieve alerts.  method: alert.get
    pub async fn get(
        client: &ZabbixClient,
        params: Value,
    ) -> Result<Vec<ZabbixAlert>, ZabbixError> {
        client.request_typed("alert.get", params).await
    }
}
