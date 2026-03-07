// ── sorng-zabbix/src/hosts.rs ────────────────────────────────────────────────
//! Host management via Zabbix JSON-RPC API.

use crate::client::ZabbixClient;
use crate::error::ZabbixError;
use crate::types::*;
use serde_json::{json, Value};

pub struct HostManager;

impl HostManager {
    /// Retrieve hosts.  method: host.get
    pub async fn get(
        client: &ZabbixClient,
        params: Value,
    ) -> Result<Vec<ZabbixHost>, ZabbixError> {
        client.request_typed("host.get", params).await
    }

    /// Create a host.  method: host.create
    pub async fn create(
        client: &ZabbixClient,
        host: &ZabbixHost,
    ) -> Result<Value, ZabbixError> {
        client.request("host.create", host).await
    }

    /// Update a host.  method: host.update
    pub async fn update(
        client: &ZabbixClient,
        host: &ZabbixHost,
    ) -> Result<Value, ZabbixError> {
        client.request("host.update", host).await
    }

    /// Delete hosts by IDs.  method: host.delete
    pub async fn delete(
        client: &ZabbixClient,
        hostids: Vec<String>,
    ) -> Result<Value, ZabbixError> {
        client.request("host.delete", hostids).await
    }

    /// Mass-add groups/templates to hosts.  method: host.massadd
    pub async fn mass_add(
        client: &ZabbixClient,
        hosts: Vec<Value>,
        groups: Vec<Value>,
        templates: Vec<Value>,
    ) -> Result<Value, ZabbixError> {
        client
            .request(
                "host.massadd",
                json!({
                    "hosts": hosts,
                    "groups": groups,
                    "templates": templates,
                }),
            )
            .await
    }

    /// Mass-remove groups/templates from hosts.  method: host.massremove
    pub async fn mass_remove(
        client: &ZabbixClient,
        hostids: Vec<String>,
        groupids: Vec<String>,
        templateids: Vec<String>,
    ) -> Result<Value, ZabbixError> {
        client
            .request(
                "host.massremove",
                json!({
                    "hostids": hostids,
                    "groupids": groupids,
                    "templateids": templateids,
                }),
            )
            .await
    }

    /// Mass-update hosts.  method: host.massupdate
    pub async fn mass_update(
        client: &ZabbixClient,
        hosts: Vec<Value>,
        params: Value,
    ) -> Result<Value, ZabbixError> {
        let mut body = params;
        if let Some(obj) = body.as_object_mut() {
            obj.insert("hosts".into(), Value::Array(hosts));
        }
        client.request("host.massupdate", body).await
    }
}
