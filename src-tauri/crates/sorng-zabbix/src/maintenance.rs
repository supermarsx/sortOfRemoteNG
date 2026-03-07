// ── sorng-zabbix/src/maintenance.rs ──────────────────────────────────────────
//! Maintenance window management via Zabbix JSON-RPC API.

use crate::client::ZabbixClient;
use crate::error::ZabbixError;
use crate::types::*;
use serde_json::Value;

pub struct MaintenanceManager;

impl MaintenanceManager {
    /// Retrieve maintenance windows.  method: maintenance.get
    pub async fn get(
        client: &ZabbixClient,
        params: Value,
    ) -> Result<Vec<ZabbixMaintenance>, ZabbixError> {
        client.request_typed("maintenance.get", params).await
    }

    /// Create a maintenance window.  method: maintenance.create
    pub async fn create(
        client: &ZabbixClient,
        maintenance: &ZabbixMaintenance,
    ) -> Result<Value, ZabbixError> {
        client.request("maintenance.create", maintenance).await
    }

    /// Update a maintenance window.  method: maintenance.update
    pub async fn update(
        client: &ZabbixClient,
        maintenance: &ZabbixMaintenance,
    ) -> Result<Value, ZabbixError> {
        client.request("maintenance.update", maintenance).await
    }

    /// Delete maintenance windows by IDs.  method: maintenance.delete
    pub async fn delete(
        client: &ZabbixClient,
        ids: Vec<String>,
    ) -> Result<Value, ZabbixError> {
        client.request("maintenance.delete", ids).await
    }
}
