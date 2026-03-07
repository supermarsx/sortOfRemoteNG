// ── sorng-zabbix/src/host_groups.rs ──────────────────────────────────────────
//! Host group management via Zabbix JSON-RPC API.

use crate::client::ZabbixClient;
use crate::error::ZabbixError;
use crate::types::*;
use serde_json::{json, Value};

pub struct HostGroupManager;

impl HostGroupManager {
    /// Retrieve host groups.  method: hostgroup.get
    pub async fn get(
        client: &ZabbixClient,
        params: Value,
    ) -> Result<Vec<ZabbixHostGroup>, ZabbixError> {
        client.request_typed("hostgroup.get", params).await
    }

    /// Create a host group.  method: hostgroup.create
    pub async fn create(
        client: &ZabbixClient,
        group: &ZabbixHostGroup,
    ) -> Result<Value, ZabbixError> {
        client.request("hostgroup.create", group).await
    }

    /// Update a host group.  method: hostgroup.update
    pub async fn update(
        client: &ZabbixClient,
        group: &ZabbixHostGroup,
    ) -> Result<Value, ZabbixError> {
        client.request("hostgroup.update", group).await
    }

    /// Delete host groups by IDs.  method: hostgroup.delete
    pub async fn delete(
        client: &ZabbixClient,
        ids: Vec<String>,
    ) -> Result<Value, ZabbixError> {
        client.request("hostgroup.delete", ids).await
    }

    /// Mass-add hosts to groups.  method: hostgroup.massadd
    pub async fn mass_add(
        client: &ZabbixClient,
        groups: Vec<Value>,
        hosts: Vec<Value>,
    ) -> Result<Value, ZabbixError> {
        client
            .request(
                "hostgroup.massadd",
                json!({
                    "groups": groups,
                    "hosts": hosts,
                }),
            )
            .await
    }

    /// Mass-remove hosts from groups.  method: hostgroup.massremove
    pub async fn mass_remove(
        client: &ZabbixClient,
        groupids: Vec<String>,
        hostids: Vec<String>,
    ) -> Result<Value, ZabbixError> {
        client
            .request(
                "hostgroup.massremove",
                json!({
                    "groupids": groupids,
                    "hostids": hostids,
                }),
            )
            .await
    }
}
