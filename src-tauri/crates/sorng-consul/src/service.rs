// ── sorng-consul/src/service.rs ──────────────────────────────────────────────
//! Aggregate Consul façade – single entry point that holds connections
//! and delegates to domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::ConsulClient;
use crate::error::{ConsulError, ConsulResult};
use crate::types::*;

use crate::acl::AclManager;
use crate::agent::AgentManager;
use crate::catalog::CatalogManager;
use crate::events::EventManager;
use crate::health::HealthManager;
use crate::kv::ConsulKvManager;
use crate::services::ServiceDiscovery;
use crate::sessions::SessionManager;

/// Shared Tauri state handle.
pub type ConsulServiceState = Arc<Mutex<ConsulServiceHolder>>;

/// Main Consul service managing connections.
pub struct ConsulServiceHolder {
    connections: HashMap<String, ConsulClient>,
}

impl Default for ConsulServiceHolder {
    fn default() -> Self {
        Self::new()
    }
}

impl ConsulServiceHolder {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    // ── Connection lifecycle ──────────────────────────────────────

    pub async fn connect(
        &mut self,
        id: String,
        config: ConsulConnectionConfig,
    ) -> ConsulResult<ConsulConnectionSummary> {
        let client = ConsulClient::new(config)?;
        let summary = client.ping().await?;
        self.connections.insert(id, client);
        Ok(summary)
    }

    pub fn disconnect(&mut self, id: &str) -> ConsulResult<()> {
        self.connections
            .remove(id)
            .map(|_| ())
            .ok_or_else(|| ConsulError::not_connected(format!("No connection '{id}'")))
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> ConsulResult<&ConsulClient> {
        self.connections
            .get(id)
            .ok_or_else(|| ConsulError::not_connected(format!("No connection '{id}'")))
    }

    // ── Dashboard ────────────────────────────────────────────────

    pub async fn get_dashboard(&self, id: &str) -> ConsulResult<ConsulDashboard> {
        let c = self.client(id)?;
        let info: ConsulAgentInfo = c.get("/v1/agent/self").await?;
        let members: Vec<AgentMember> = AgentManager::list_members(c).await?;
        let services_map: HashMap<String, Vec<String>> = c.catalog_services().await?;
        let nodes: Vec<ConsulNode> = CatalogManager::list_nodes(c).await?;
        let leader: String = c.get("/v1/status/leader").await?;

        let all_checks: Vec<ConsulHealthCheck> = HealthManager::list_checks_in_state(c, "any")
            .await
            .unwrap_or_default();
        let passing = all_checks.iter().filter(|c| c.status == "passing").count();
        let warning = all_checks.iter().filter(|c| c.status == "warning").count();
        let critical = all_checks.iter().filter(|c| c.status == "critical").count();

        let node_name = info
            .member
            .as_ref()
            .map(|m| m.name.clone())
            .unwrap_or_default();
        let dc = info
            .config
            .as_ref()
            .and_then(|c| c.get("Datacenter"))
            .and_then(|v| v.as_str())
            .unwrap_or("dc1")
            .to_string();
        let version = info
            .config
            .as_ref()
            .and_then(|c| c.get("Version"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();

        Ok(ConsulDashboard {
            datacenter: dc,
            node_name,
            version,
            leader,
            members,
            services: services_map.clone(),
            node_count: nodes.len(),
            service_count: services_map.len(),
            check_summary: CheckSummary {
                passing,
                warning,
                critical,
                total: all_checks.len(),
            },
        })
    }

    // ── KV ───────────────────────────────────────────────────────

    pub async fn kv_get(&self, id: &str, key: &str) -> ConsulResult<ConsulKeyValue> {
        ConsulKvManager::get_key(self.client(id)?, key).await
    }

    pub async fn kv_put(&self, id: &str, key: &str, value: &str) -> ConsulResult<bool> {
        ConsulKvManager::put_key(self.client(id)?, key, value).await
    }

    pub async fn kv_delete(&self, id: &str, key: &str) -> ConsulResult<bool> {
        ConsulKvManager::delete_key(self.client(id)?, key).await
    }

    pub async fn kv_list(&self, id: &str, prefix: &str) -> ConsulResult<Vec<String>> {
        ConsulKvManager::list_keys(self.client(id)?, prefix).await
    }

    pub async fn kv_get_tree(&self, id: &str, prefix: &str) -> ConsulResult<Vec<ConsulKeyValue>> {
        ConsulKvManager::get_tree(self.client(id)?, prefix).await
    }

    pub async fn kv_cas(
        &self,
        id: &str,
        key: &str,
        value: &str,
        modify_index: u64,
    ) -> ConsulResult<bool> {
        ConsulKvManager::cas_key(self.client(id)?, key, value, modify_index).await
    }

    pub async fn kv_lock(
        &self,
        id: &str,
        key: &str,
        session: &str,
        value: &str,
    ) -> ConsulResult<bool> {
        ConsulKvManager::lock_key(self.client(id)?, key, session, value).await
    }

    pub async fn kv_unlock(
        &self,
        id: &str,
        key: &str,
        session: &str,
        value: &str,
    ) -> ConsulResult<bool> {
        ConsulKvManager::unlock_key(self.client(id)?, key, session, value).await
    }

    pub async fn kv_metadata(&self, id: &str, key: &str) -> ConsulResult<ConsulKeyMetadata> {
        ConsulKvManager::get_key_metadata(self.client(id)?, key).await
    }

    // ── Services ─────────────────────────────────────────────────

    pub async fn list_services(&self, id: &str) -> ConsulResult<HashMap<String, Vec<String>>> {
        ServiceDiscovery::list_services(self.client(id)?).await
    }

    pub async fn get_service(&self, id: &str, name: &str) -> ConsulResult<Vec<ConsulServiceEntry>> {
        ServiceDiscovery::get_service(self.client(id)?, name).await
    }

    pub async fn register_service(&self, id: &str, reg: &ServiceRegistration) -> ConsulResult<()> {
        ServiceDiscovery::register_service(self.client(id)?, reg).await
    }

    pub async fn deregister_service(&self, id: &str, service_id: &str) -> ConsulResult<()> {
        ServiceDiscovery::deregister_service(self.client(id)?, service_id).await
    }

    pub async fn enable_maintenance(
        &self,
        id: &str,
        service_id: &str,
        reason: &str,
    ) -> ConsulResult<()> {
        ServiceDiscovery::enable_maintenance(self.client(id)?, service_id, reason).await
    }

    pub async fn disable_maintenance(&self, id: &str, service_id: &str) -> ConsulResult<()> {
        ServiceDiscovery::disable_maintenance(self.client(id)?, service_id).await
    }

    pub async fn list_service_instances(
        &self,
        id: &str,
        name: &str,
    ) -> ConsulResult<Vec<ConsulServiceEntry>> {
        ServiceDiscovery::list_service_instances(self.client(id)?, name).await
    }

    pub async fn get_service_health(
        &self,
        id: &str,
        name: &str,
    ) -> ConsulResult<Vec<ConsulServiceEntry>> {
        ServiceDiscovery::get_service_health(self.client(id)?, name).await
    }

    // ── Catalog ──────────────────────────────────────────────────

    pub async fn list_datacenters(&self, id: &str) -> ConsulResult<Vec<String>> {
        CatalogManager::list_datacenters(self.client(id)?).await
    }

    pub async fn list_nodes(&self, id: &str) -> ConsulResult<Vec<ConsulNode>> {
        CatalogManager::list_nodes(self.client(id)?).await
    }

    pub async fn get_node(&self, id: &str, node_name: &str) -> ConsulResult<CatalogNode> {
        CatalogManager::get_node(self.client(id)?, node_name).await
    }

    pub async fn list_catalog_services(
        &self,
        id: &str,
    ) -> ConsulResult<HashMap<String, Vec<String>>> {
        CatalogManager::list_catalog_services(self.client(id)?).await
    }

    pub async fn get_catalog_service(
        &self,
        id: &str,
        name: &str,
    ) -> ConsulResult<Vec<ConsulServiceEntry>> {
        CatalogManager::get_catalog_service(self.client(id)?, name).await
    }

    pub async fn register_entity(&self, id: &str, reg: &CatalogRegistration) -> ConsulResult<()> {
        CatalogManager::register_entity(self.client(id)?, reg).await
    }

    pub async fn deregister_entity(
        &self,
        id: &str,
        dereg: &CatalogDeregistration,
    ) -> ConsulResult<()> {
        CatalogManager::deregister_entity(self.client(id)?, dereg).await
    }

    // ── Health ───────────────────────────────────────────────────

    pub async fn node_health(&self, id: &str, node: &str) -> ConsulResult<Vec<ConsulHealthCheck>> {
        HealthManager::node_health(self.client(id)?, node).await
    }

    pub async fn service_health(
        &self,
        id: &str,
        service: &str,
    ) -> ConsulResult<Vec<ConsulServiceEntry>> {
        HealthManager::service_health(self.client(id)?, service).await
    }

    pub async fn check_health(&self, id: &str, check_id: &str) -> ConsulResult<ConsulHealthCheck> {
        HealthManager::check_health(self.client(id)?, check_id).await
    }

    pub async fn list_checks_for_service(
        &self,
        id: &str,
        service: &str,
    ) -> ConsulResult<Vec<ConsulHealthCheck>> {
        HealthManager::list_checks_for_service(self.client(id)?, service).await
    }

    pub async fn list_checks_in_state(
        &self,
        id: &str,
        state: &str,
    ) -> ConsulResult<Vec<ConsulHealthCheck>> {
        HealthManager::list_checks_in_state(self.client(id)?, state).await
    }

    // ── Agent ────────────────────────────────────────────────────

    pub async fn agent_info(&self, id: &str) -> ConsulResult<ConsulAgentInfo> {
        AgentManager::get_self(self.client(id)?).await
    }

    pub async fn agent_members(&self, id: &str) -> ConsulResult<Vec<AgentMember>> {
        AgentManager::list_members(self.client(id)?).await
    }

    pub async fn agent_services(&self, id: &str) -> ConsulResult<HashMap<String, ConsulService>> {
        AgentManager::list_agent_services(self.client(id)?).await
    }

    pub async fn agent_register_service(
        &self,
        id: &str,
        reg: &ServiceRegistration,
    ) -> ConsulResult<()> {
        AgentManager::register_agent_service(self.client(id)?, reg).await
    }

    pub async fn agent_deregister_service(&self, id: &str, service_id: &str) -> ConsulResult<()> {
        AgentManager::deregister_agent_service(self.client(id)?, service_id).await
    }

    pub async fn agent_checks(&self, id: &str) -> ConsulResult<HashMap<String, ConsulHealthCheck>> {
        AgentManager::list_agent_checks(self.client(id)?).await
    }

    pub async fn agent_register_check(
        &self,
        id: &str,
        reg: &CheckRegistration,
    ) -> ConsulResult<()> {
        AgentManager::register_check(self.client(id)?, reg).await
    }

    pub async fn agent_deregister_check(&self, id: &str, check_id: &str) -> ConsulResult<()> {
        AgentManager::deregister_check(self.client(id)?, check_id).await
    }

    pub async fn agent_join(&self, id: &str, address: &str) -> ConsulResult<()> {
        AgentManager::join(self.client(id)?, address).await
    }

    pub async fn agent_leave(&self, id: &str) -> ConsulResult<()> {
        AgentManager::leave(self.client(id)?).await
    }

    pub async fn agent_force_leave(&self, id: &str, node: &str) -> ConsulResult<()> {
        AgentManager::force_leave(self.client(id)?, node).await
    }

    pub async fn agent_reload(&self, id: &str) -> ConsulResult<()> {
        AgentManager::reload_config(self.client(id)?).await
    }

    pub async fn agent_metrics(&self, id: &str) -> ConsulResult<ConsulAgentMetrics> {
        AgentManager::get_metrics(self.client(id)?).await
    }

    // ── ACL ──────────────────────────────────────────────────────

    pub async fn acl_bootstrap(&self, id: &str) -> ConsulResult<ConsulAclToken> {
        AclManager::bootstrap_acl(self.client(id)?).await
    }

    pub async fn acl_list_tokens(&self, id: &str) -> ConsulResult<Vec<ConsulAclToken>> {
        AclManager::list_tokens(self.client(id)?).await
    }

    pub async fn acl_get_token(&self, id: &str, accessor_id: &str) -> ConsulResult<ConsulAclToken> {
        AclManager::get_token(self.client(id)?, accessor_id).await
    }

    pub async fn acl_create_token(
        &self,
        id: &str,
        req: &AclTokenCreateRequest,
    ) -> ConsulResult<ConsulAclToken> {
        AclManager::create_token(self.client(id)?, req).await
    }

    pub async fn acl_update_token(
        &self,
        id: &str,
        accessor_id: &str,
        req: &AclTokenCreateRequest,
    ) -> ConsulResult<ConsulAclToken> {
        AclManager::update_token(self.client(id)?, accessor_id, req).await
    }

    pub async fn acl_delete_token(&self, id: &str, accessor_id: &str) -> ConsulResult<()> {
        AclManager::delete_token(self.client(id)?, accessor_id).await
    }

    pub async fn acl_list_policies(&self, id: &str) -> ConsulResult<Vec<ConsulAclPolicy>> {
        AclManager::list_policies(self.client(id)?).await
    }

    pub async fn acl_get_policy(&self, id: &str, policy_id: &str) -> ConsulResult<ConsulAclPolicy> {
        AclManager::get_policy(self.client(id)?, policy_id).await
    }

    pub async fn acl_create_policy(
        &self,
        id: &str,
        req: &AclPolicyCreateRequest,
    ) -> ConsulResult<ConsulAclPolicy> {
        AclManager::create_policy(self.client(id)?, req).await
    }

    pub async fn acl_update_policy(
        &self,
        id: &str,
        policy_id: &str,
        req: &AclPolicyCreateRequest,
    ) -> ConsulResult<ConsulAclPolicy> {
        AclManager::update_policy(self.client(id)?, policy_id, req).await
    }

    pub async fn acl_delete_policy(&self, id: &str, policy_id: &str) -> ConsulResult<()> {
        AclManager::delete_policy(self.client(id)?, policy_id).await
    }

    pub async fn acl_list_roles(&self, id: &str) -> ConsulResult<Vec<ConsulAclRole>> {
        AclManager::list_roles(self.client(id)?).await
    }

    pub async fn acl_get_role(&self, id: &str, role_id: &str) -> ConsulResult<ConsulAclRole> {
        AclManager::get_role(self.client(id)?, role_id).await
    }

    pub async fn acl_create_role(
        &self,
        id: &str,
        req: &AclRoleCreateRequest,
    ) -> ConsulResult<ConsulAclRole> {
        AclManager::create_role(self.client(id)?, req).await
    }

    pub async fn acl_update_role(
        &self,
        id: &str,
        role_id: &str,
        req: &AclRoleCreateRequest,
    ) -> ConsulResult<ConsulAclRole> {
        AclManager::update_role(self.client(id)?, role_id, req).await
    }

    pub async fn acl_delete_role(&self, id: &str, role_id: &str) -> ConsulResult<()> {
        AclManager::delete_role(self.client(id)?, role_id).await
    }

    // ── Sessions ─────────────────────────────────────────────────

    pub async fn session_create(
        &self,
        id: &str,
        req: &SessionCreateRequest,
    ) -> ConsulResult<String> {
        SessionManager::create_session(self.client(id)?, req).await
    }

    pub async fn session_get(&self, id: &str, session_id: &str) -> ConsulResult<ConsulSession> {
        SessionManager::get_session(self.client(id)?, session_id).await
    }

    pub async fn session_list(&self, id: &str) -> ConsulResult<Vec<ConsulSession>> {
        SessionManager::list_sessions(self.client(id)?).await
    }

    pub async fn session_delete(&self, id: &str, session_id: &str) -> ConsulResult<()> {
        SessionManager::delete_session(self.client(id)?, session_id).await
    }

    pub async fn session_renew(&self, id: &str, session_id: &str) -> ConsulResult<ConsulSession> {
        SessionManager::renew_session(self.client(id)?, session_id).await
    }

    pub async fn session_list_node(
        &self,
        id: &str,
        node: &str,
    ) -> ConsulResult<Vec<ConsulSession>> {
        SessionManager::list_node_sessions(self.client(id)?, node).await
    }

    // ── Events ───────────────────────────────────────────────────

    pub async fn fire_event(&self, id: &str, req: &EventFireRequest) -> ConsulResult<ConsulEvent> {
        EventManager::fire_event(self.client(id)?, req).await
    }

    pub async fn list_events(&self, id: &str) -> ConsulResult<Vec<ConsulEvent>> {
        EventManager::list_events(self.client(id)?).await
    }

    pub async fn get_event(&self, id: &str, name: &str) -> ConsulResult<Vec<ConsulEvent>> {
        EventManager::get_event(self.client(id)?, name).await
    }
}
