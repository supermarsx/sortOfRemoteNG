// ── sorng-zabbix/src/service.rs ──────────────────────────────────────────────
//! Aggregate Zabbix service – holds connections and delegates to domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::actions;
use crate::alerts;
use crate::client::ZabbixClient;
use crate::discovery;
use crate::error::ZabbixError;
use crate::graphs;
use crate::host_groups;
use crate::hosts;
use crate::items;
use crate::maintenance;
use crate::media_types;
use crate::proxies;
use crate::templates;
use crate::triggers;
use crate::types::*;
use crate::users;

use serde_json::{json, Value};

/// Shared Tauri state handle.
pub type ZabbixServiceState = Arc<Mutex<ZabbixService>>;

/// Main Zabbix service managing connections.
pub struct ZabbixService {
    connections: HashMap<String, ZabbixClient>,
}

impl Default for ZabbixService {
    fn default() -> Self {
        Self::new()
    }
}

impl ZabbixService {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    // ── Connection lifecycle ─────────────────────────────────────

    pub async fn connect(
        &mut self,
        id: String,
        config: ZabbixConnectionConfig,
    ) -> Result<ZabbixConnectionSummary, ZabbixError> {
        let client = ZabbixClient::new(&config).await?;
        let summary = client.summary(&id);
        self.connections.insert(id, client);
        Ok(summary)
    }

    pub fn disconnect(&mut self, id: &str) -> Result<(), ZabbixError> {
        self.connections
            .remove(id)
            .map(|_| ())
            .ok_or_else(|| ZabbixError::ConnectionFailed(format!("no connection '{id}'")))
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> Result<&ZabbixClient, ZabbixError> {
        self.connections
            .get(id)
            .ok_or_else(|| ZabbixError::ConnectionFailed(format!("no connection '{id}'")))
    }

    pub async fn get_dashboard(&self, id: &str) -> Result<ZabbixDashboard, ZabbixError> {
        self.client(id)?.get_dashboard().await
    }

    // ── Hosts ────────────────────────────────────────────────────

    pub async fn list_hosts(
        &self,
        id: &str,
        params: Value,
    ) -> Result<Vec<ZabbixHost>, ZabbixError> {
        hosts::HostManager::get(self.client(id)?, params).await
    }

    pub async fn get_host(&self, id: &str, hostid: &str) -> Result<ZabbixHost, ZabbixError> {
        let results: Vec<ZabbixHost> = hosts::HostManager::get(
            self.client(id)?,
            json!({"hostids": [hostid], "selectGroups": "extend", "selectInterfaces": "extend"}),
        )
        .await?;
        results
            .into_iter()
            .next()
            .ok_or_else(|| ZabbixError::HostNotFound(hostid.to_string()))
    }

    pub async fn create_host(&self, id: &str, host: ZabbixHost) -> Result<Value, ZabbixError> {
        hosts::HostManager::create(self.client(id)?, &host).await
    }

    pub async fn update_host(&self, id: &str, host: ZabbixHost) -> Result<Value, ZabbixError> {
        hosts::HostManager::update(self.client(id)?, &host).await
    }

    pub async fn delete_hosts(&self, id: &str, hostids: Vec<String>) -> Result<Value, ZabbixError> {
        hosts::HostManager::delete(self.client(id)?, hostids).await
    }

    // ── Templates ────────────────────────────────────────────────

    pub async fn list_templates(
        &self,
        id: &str,
        params: Value,
    ) -> Result<Vec<ZabbixTemplate>, ZabbixError> {
        templates::TemplateManager::get(self.client(id)?, params).await
    }

    pub async fn get_template(
        &self,
        id: &str,
        templateid: &str,
    ) -> Result<ZabbixTemplate, ZabbixError> {
        let results: Vec<ZabbixTemplate> =
            templates::TemplateManager::get(self.client(id)?, json!({"templateids": [templateid]}))
                .await?;
        results
            .into_iter()
            .next()
            .ok_or_else(|| ZabbixError::TemplateNotFound(templateid.to_string()))
    }

    pub async fn create_template(
        &self,
        id: &str,
        template: ZabbixTemplate,
    ) -> Result<Value, ZabbixError> {
        templates::TemplateManager::create(self.client(id)?, &template).await
    }

    pub async fn delete_templates(
        &self,
        id: &str,
        templateids: Vec<String>,
    ) -> Result<Value, ZabbixError> {
        templates::TemplateManager::delete(self.client(id)?, templateids).await
    }

    // ── Items ────────────────────────────────────────────────────

    pub async fn list_items(
        &self,
        id: &str,
        params: Value,
    ) -> Result<Vec<ZabbixItem>, ZabbixError> {
        items::ItemManager::get(self.client(id)?, params).await
    }

    pub async fn get_item(&self, id: &str, itemid: &str) -> Result<ZabbixItem, ZabbixError> {
        let results: Vec<ZabbixItem> =
            items::ItemManager::get(self.client(id)?, json!({"itemids": [itemid]})).await?;
        results
            .into_iter()
            .next()
            .ok_or_else(|| ZabbixError::ItemError(format!("item not found: {itemid}")))
    }

    pub async fn create_item(&self, id: &str, item: ZabbixItem) -> Result<Value, ZabbixError> {
        items::ItemManager::create(self.client(id)?, &item).await
    }

    pub async fn delete_items(&self, id: &str, itemids: Vec<String>) -> Result<Value, ZabbixError> {
        items::ItemManager::delete(self.client(id)?, itemids).await
    }

    // ── Triggers ─────────────────────────────────────────────────

    pub async fn list_triggers(
        &self,
        id: &str,
        params: Value,
    ) -> Result<Vec<ZabbixTrigger>, ZabbixError> {
        triggers::TriggerManager::get(self.client(id)?, params).await
    }

    pub async fn get_trigger(
        &self,
        id: &str,
        triggerid: &str,
    ) -> Result<ZabbixTrigger, ZabbixError> {
        let results: Vec<ZabbixTrigger> = triggers::TriggerManager::get(
            self.client(id)?,
            json!({"triggerids": [triggerid], "selectHosts": "extend"}),
        )
        .await?;
        results
            .into_iter()
            .next()
            .ok_or_else(|| ZabbixError::TriggerError(format!("trigger not found: {triggerid}")))
    }

    pub async fn create_trigger(
        &self,
        id: &str,
        trigger: ZabbixTrigger,
    ) -> Result<Value, ZabbixError> {
        triggers::TriggerManager::create(self.client(id)?, &trigger).await
    }

    pub async fn delete_triggers(
        &self,
        id: &str,
        triggerids: Vec<String>,
    ) -> Result<Value, ZabbixError> {
        triggers::TriggerManager::delete(self.client(id)?, triggerids).await
    }

    // ── Actions ──────────────────────────────────────────────────

    pub async fn list_actions(
        &self,
        id: &str,
        params: Value,
    ) -> Result<Vec<ZabbixAction>, ZabbixError> {
        actions::ActionManager::get(self.client(id)?, params).await
    }

    pub async fn get_action(&self, id: &str, actionid: &str) -> Result<ZabbixAction, ZabbixError> {
        let results: Vec<ZabbixAction> = actions::ActionManager::get(
            self.client(id)?,
            json!({"actionids": [actionid], "selectOperations": "extend"}),
        )
        .await?;
        results
            .into_iter()
            .next()
            .ok_or_else(|| ZabbixError::NotFound {
                resource: "action".into(),
                id: actionid.to_string(),
            })
    }

    pub async fn create_action(
        &self,
        id: &str,
        action: ZabbixAction,
    ) -> Result<Value, ZabbixError> {
        actions::ActionManager::create(self.client(id)?, &action).await
    }

    pub async fn delete_actions(
        &self,
        id: &str,
        actionids: Vec<String>,
    ) -> Result<Value, ZabbixError> {
        actions::ActionManager::delete(self.client(id)?, actionids).await
    }

    // ── Alerts ───────────────────────────────────────────────────

    pub async fn list_alerts(
        &self,
        id: &str,
        params: Value,
    ) -> Result<Vec<ZabbixAlert>, ZabbixError> {
        alerts::AlertManager::get(self.client(id)?, params).await
    }

    // ── Graphs ───────────────────────────────────────────────────

    pub async fn list_graphs(
        &self,
        id: &str,
        params: Value,
    ) -> Result<Vec<ZabbixGraph>, ZabbixError> {
        graphs::GraphManager::get(self.client(id)?, params).await
    }

    pub async fn create_graph(&self, id: &str, graph: ZabbixGraph) -> Result<Value, ZabbixError> {
        graphs::GraphManager::create(self.client(id)?, &graph).await
    }

    pub async fn delete_graphs(
        &self,
        id: &str,
        graphids: Vec<String>,
    ) -> Result<Value, ZabbixError> {
        graphs::GraphManager::delete(self.client(id)?, graphids).await
    }

    // ── Discovery ────────────────────────────────────────────────

    pub async fn list_discovery_rules(
        &self,
        id: &str,
        params: Value,
    ) -> Result<Vec<ZabbixDiscoveryRule>, ZabbixError> {
        discovery::DiscoveryManager::drule_get(self.client(id)?, params).await
    }

    pub async fn create_discovery_rule(
        &self,
        id: &str,
        rule: ZabbixDiscoveryRule,
    ) -> Result<Value, ZabbixError> {
        discovery::DiscoveryManager::drule_create(self.client(id)?, &rule).await
    }

    pub async fn delete_discovery_rules(
        &self,
        id: &str,
        ids: Vec<String>,
    ) -> Result<Value, ZabbixError> {
        discovery::DiscoveryManager::drule_delete(self.client(id)?, ids).await
    }

    // ── Maintenance ──────────────────────────────────────────────

    pub async fn list_maintenance(
        &self,
        id: &str,
        params: Value,
    ) -> Result<Vec<ZabbixMaintenance>, ZabbixError> {
        maintenance::MaintenanceManager::get(self.client(id)?, params).await
    }

    pub async fn create_maintenance(
        &self,
        id: &str,
        maint: ZabbixMaintenance,
    ) -> Result<Value, ZabbixError> {
        maintenance::MaintenanceManager::create(self.client(id)?, &maint).await
    }

    pub async fn update_maintenance(
        &self,
        id: &str,
        maint: ZabbixMaintenance,
    ) -> Result<Value, ZabbixError> {
        maintenance::MaintenanceManager::update(self.client(id)?, &maint).await
    }

    pub async fn delete_maintenance(
        &self,
        id: &str,
        ids: Vec<String>,
    ) -> Result<Value, ZabbixError> {
        maintenance::MaintenanceManager::delete(self.client(id)?, ids).await
    }

    // ── Users ────────────────────────────────────────────────────

    pub async fn list_users(
        &self,
        id: &str,
        params: Value,
    ) -> Result<Vec<ZabbixUser>, ZabbixError> {
        users::UserManager::get(self.client(id)?, params).await
    }

    pub async fn get_user(&self, id: &str, userid: &str) -> Result<ZabbixUser, ZabbixError> {
        let results: Vec<ZabbixUser> =
            users::UserManager::get(self.client(id)?, json!({"userids": [userid]})).await?;
        results
            .into_iter()
            .next()
            .ok_or_else(|| ZabbixError::NotFound {
                resource: "user".into(),
                id: userid.to_string(),
            })
    }

    pub async fn create_user(&self, id: &str, user: ZabbixUser) -> Result<Value, ZabbixError> {
        users::UserManager::create(self.client(id)?, &user).await
    }

    pub async fn update_user(&self, id: &str, user: ZabbixUser) -> Result<Value, ZabbixError> {
        users::UserManager::update(self.client(id)?, &user).await
    }

    pub async fn delete_users(&self, id: &str, userids: Vec<String>) -> Result<Value, ZabbixError> {
        users::UserManager::delete(self.client(id)?, userids).await
    }

    // ── Media Types ──────────────────────────────────────────────

    pub async fn list_media_types(
        &self,
        id: &str,
        params: Value,
    ) -> Result<Vec<ZabbixMediaType>, ZabbixError> {
        media_types::MediaTypeManager::get(self.client(id)?, params).await
    }

    pub async fn create_media_type(
        &self,
        id: &str,
        media_type: ZabbixMediaType,
    ) -> Result<Value, ZabbixError> {
        media_types::MediaTypeManager::create(self.client(id)?, &media_type).await
    }

    pub async fn delete_media_types(
        &self,
        id: &str,
        ids: Vec<String>,
    ) -> Result<Value, ZabbixError> {
        media_types::MediaTypeManager::delete(self.client(id)?, ids).await
    }

    // ── Host Groups ──────────────────────────────────────────────

    pub async fn list_host_groups(
        &self,
        id: &str,
        params: Value,
    ) -> Result<Vec<ZabbixHostGroup>, ZabbixError> {
        host_groups::HostGroupManager::get(self.client(id)?, params).await
    }

    pub async fn create_host_group(
        &self,
        id: &str,
        group: ZabbixHostGroup,
    ) -> Result<Value, ZabbixError> {
        host_groups::HostGroupManager::create(self.client(id)?, &group).await
    }

    pub async fn delete_host_groups(
        &self,
        id: &str,
        ids: Vec<String>,
    ) -> Result<Value, ZabbixError> {
        host_groups::HostGroupManager::delete(self.client(id)?, ids).await
    }

    // ── Proxies ──────────────────────────────────────────────────

    pub async fn list_proxies(
        &self,
        id: &str,
        params: Value,
    ) -> Result<Vec<ZabbixProxy>, ZabbixError> {
        proxies::ProxyManager::get(self.client(id)?, params).await
    }

    pub async fn get_proxy(&self, id: &str, proxyid: &str) -> Result<ZabbixProxy, ZabbixError> {
        let results: Vec<ZabbixProxy> =
            proxies::ProxyManager::get(self.client(id)?, json!({"proxyids": [proxyid]})).await?;
        results
            .into_iter()
            .next()
            .ok_or_else(|| ZabbixError::NotFound {
                resource: "proxy".into(),
                id: proxyid.to_string(),
            })
    }

    pub async fn create_proxy(&self, id: &str, proxy: ZabbixProxy) -> Result<Value, ZabbixError> {
        proxies::ProxyManager::create(self.client(id)?, &proxy).await
    }

    pub async fn delete_proxies(&self, id: &str, ids: Vec<String>) -> Result<Value, ZabbixError> {
        proxies::ProxyManager::delete(self.client(id)?, ids).await
    }

    // ── Problems ─────────────────────────────────────────────────

    pub async fn list_problems(
        &self,
        id: &str,
        params: Value,
    ) -> Result<Vec<ZabbixProblem>, ZabbixError> {
        self.client(id)?.request_typed("problem.get", params).await
    }

    pub async fn acknowledge_problem(
        &self,
        id: &str,
        eventids: Vec<String>,
        message: Option<String>,
    ) -> Result<Value, ZabbixError> {
        let mut params = json!({
            "eventids": eventids,
            "action": 6,
        });
        if let Some(msg) = message {
            params["message"] = Value::String(msg);
        }
        self.client(id)?.request("event.acknowledge", params).await
    }
}
