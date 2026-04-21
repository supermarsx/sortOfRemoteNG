// ── sorng-zabbix/src/templates.rs ────────────────────────────────────────────
//! Template management via Zabbix JSON-RPC API.

use crate::client::ZabbixClient;
use crate::error::ZabbixError;
use crate::types::*;
use serde_json::{json, Value};

pub struct TemplateManager;

impl TemplateManager {
    /// Retrieve templates.  method: template.get
    pub async fn get(
        client: &ZabbixClient,
        params: Value,
    ) -> Result<Vec<ZabbixTemplate>, ZabbixError> {
        client.request_typed("template.get", params).await
    }

    /// Create a template.  method: template.create
    pub async fn create(
        client: &ZabbixClient,
        template: &ZabbixTemplate,
    ) -> Result<Value, ZabbixError> {
        client.request("template.create", template).await
    }

    /// Update a template.  method: template.update
    pub async fn update(
        client: &ZabbixClient,
        template: &ZabbixTemplate,
    ) -> Result<Value, ZabbixError> {
        client.request("template.update", template).await
    }

    /// Delete templates by IDs.  method: template.delete
    pub async fn delete(
        client: &ZabbixClient,
        templateids: Vec<String>,
    ) -> Result<Value, ZabbixError> {
        client.request("template.delete", templateids).await
    }

    /// Mass-add groups/hosts to templates.  method: template.massadd
    pub async fn mass_add(
        client: &ZabbixClient,
        templates: Vec<Value>,
        groups: Vec<Value>,
        hosts: Vec<Value>,
    ) -> Result<Value, ZabbixError> {
        client
            .request(
                "template.massadd",
                json!({
                    "templates": templates,
                    "groups": groups,
                    "hosts": hosts,
                }),
            )
            .await
    }

    /// Mass-remove groups/hosts from templates.  method: template.massremove
    pub async fn mass_remove(
        client: &ZabbixClient,
        templateids: Vec<String>,
        groupids: Vec<String>,
        hostids: Vec<String>,
    ) -> Result<Value, ZabbixError> {
        client
            .request(
                "template.massremove",
                json!({
                    "templateids": templateids,
                    "groupids": groupids,
                    "hostids": hostids,
                }),
            )
            .await
    }
}
