// ── sorng-etcd/src/service.rs ────────────────────────────────────────────────
//! Aggregate etcd façade – single entry point that holds connections
//! and delegates to domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::auth::AuthManager;
use crate::client::EtcdClient;
use crate::cluster::ClusterManager;
use crate::error::{EtcdError, EtcdResult};
use crate::kv::KvManager;
use crate::lease::LeaseManager;
use crate::maintenance::MaintenanceManager;
use crate::types::*;

/// Shared Tauri state handle.
pub type EtcdServiceState = Arc<Mutex<EtcdService>>;

/// Main etcd service managing connections.
pub struct EtcdService {
    connections: HashMap<String, EtcdClient>,
}

impl EtcdService {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    // ── Connection lifecycle ─────────────────────────────────────────

    pub async fn connect(
        &mut self,
        id: String,
        config: EtcdConnectionConfig,
    ) -> EtcdResult<EtcdConnectionSummary> {
        let client = EtcdClient::new(config).await?;
        let summary = client.get_connection_summary(&id).await?;
        self.connections.insert(id, client);
        Ok(summary)
    }

    pub fn disconnect(&mut self, id: &str) -> EtcdResult<()> {
        self.connections
            .remove(id)
            .map(|_| ())
            .ok_or_else(|| EtcdError::not_connected(format!("No connection '{id}'")))
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> EtcdResult<&EtcdClient> {
        self.connections
            .get(id)
            .ok_or_else(|| EtcdError::not_connected(format!("No connection '{id}'")))
    }

    // ── Dashboard ────────────────────────────────────────────────────

    pub async fn get_dashboard(&self, id: &str) -> EtcdResult<EtcdDashboard> {
        let c = self.client(id)?;
        let status = c.get_status().await?;
        let members = ClusterManager::member_list(c).await.unwrap_or_default();
        let alarms = MaintenanceManager::alarm_list(c).await.unwrap_or_default();

        let leader_info = members.iter().find(|m| m.id == status.leader).cloned();

        Ok(EtcdDashboard {
            cluster_health: status.errors.is_empty(),
            member_count: members.len(),
            db_size: status.db_size,
            raft_index: status.raft_index,
            leader_info,
            alarm_count: alarms.len(),
        })
    }

    // ── KV ───────────────────────────────────────────────────────────

    pub async fn kv_get(&self, id: &str, key: &str) -> EtcdResult<Option<EtcdKeyValue>> {
        KvManager::get(self.client(id)?, key).await
    }

    pub async fn kv_put(
        &self,
        id: &str,
        key: &str,
        value: &str,
        lease: Option<i64>,
    ) -> EtcdResult<()> {
        KvManager::put(self.client(id)?, key, value, lease, None).await
    }

    pub async fn kv_delete(&self, id: &str, key: &str) -> EtcdResult<i64> {
        KvManager::delete(self.client(id)?, key, None).await
    }

    pub async fn kv_range(
        &self,
        id: &str,
        key: &str,
        range_end: Option<String>,
        limit: Option<i64>,
    ) -> EtcdResult<EtcdRangeResponse> {
        KvManager::range(
            self.client(id)?,
            key,
            range_end.as_deref(),
            limit,
            None,
            None,
            None,
        )
        .await
    }

    pub async fn kv_get_history(
        &self,
        id: &str,
        key: &str,
    ) -> EtcdResult<Vec<EtcdKeyValue>> {
        KvManager::get_history(self.client(id)?, key).await
    }

    pub async fn kv_compact(&self, id: &str, revision: i64) -> EtcdResult<()> {
        KvManager::compact(self.client(id)?, revision).await
    }

    // ── Leases ───────────────────────────────────────────────────────

    pub async fn lease_grant(&self, id: &str, ttl: i64) -> EtcdResult<EtcdLease> {
        LeaseManager::grant(self.client(id)?, ttl, None).await
    }

    pub async fn lease_revoke(&self, id: &str, lease_id: i64) -> EtcdResult<()> {
        LeaseManager::revoke(self.client(id)?, lease_id).await
    }

    pub async fn lease_list(&self, id: &str) -> EtcdResult<Vec<EtcdLease>> {
        LeaseManager::list(self.client(id)?).await
    }

    pub async fn lease_ttl(
        &self,
        id: &str,
        lease_id: i64,
    ) -> EtcdResult<EtcdLeaseTimeToLive> {
        LeaseManager::time_to_live(self.client(id)?, lease_id, true).await
    }

    pub async fn lease_keep_alive(&self, id: &str, lease_id: i64) -> EtcdResult<()> {
        LeaseManager::keep_alive(self.client(id)?, lease_id).await
    }

    // ── Cluster ──────────────────────────────────────────────────────

    pub async fn member_list(&self, id: &str) -> EtcdResult<Vec<EtcdMember>> {
        ClusterManager::member_list(self.client(id)?).await
    }

    pub async fn member_add(
        &self,
        id: &str,
        peer_urls: Vec<String>,
        is_learner: Option<bool>,
    ) -> EtcdResult<EtcdMember> {
        ClusterManager::member_add(self.client(id)?, peer_urls, is_learner).await
    }

    pub async fn member_remove(&self, id: &str, member_id: u64) -> EtcdResult<()> {
        ClusterManager::member_remove(self.client(id)?, member_id).await
    }

    pub async fn member_update(
        &self,
        id: &str,
        member_id: u64,
        peer_urls: Vec<String>,
    ) -> EtcdResult<()> {
        ClusterManager::member_update(self.client(id)?, member_id, peer_urls).await
    }

    pub async fn member_promote(&self, id: &str, member_id: u64) -> EtcdResult<()> {
        ClusterManager::member_promote(self.client(id)?, member_id).await
    }

    pub async fn cluster_health(&self, id: &str) -> EtcdResult<EtcdClusterHealth> {
        ClusterManager::cluster_health(self.client(id)?).await
    }

    pub async fn endpoint_status(
        &self,
        id: &str,
    ) -> EtcdResult<Vec<EtcdEndpointStatus>> {
        ClusterManager::endpoint_status(self.client(id)?).await
    }

    // ── Auth ─────────────────────────────────────────────────────────

    pub async fn auth_enable(&self, id: &str) -> EtcdResult<()> {
        AuthManager::auth_enable(self.client(id)?).await
    }

    pub async fn auth_disable(&self, id: &str) -> EtcdResult<()> {
        AuthManager::auth_disable(self.client(id)?).await
    }

    pub async fn user_list(&self, id: &str) -> EtcdResult<Vec<EtcdUser>> {
        AuthManager::user_list(self.client(id)?).await
    }

    pub async fn user_add(&self, id: &str, name: &str, password: &str) -> EtcdResult<()> {
        AuthManager::user_add(self.client(id)?, name, password).await
    }

    pub async fn user_delete(&self, id: &str, name: &str) -> EtcdResult<()> {
        AuthManager::user_delete(self.client(id)?, name).await
    }

    pub async fn user_get(&self, id: &str, name: &str) -> EtcdResult<EtcdUser> {
        AuthManager::user_get(self.client(id)?, name).await
    }

    pub async fn user_change_password(
        &self,
        id: &str,
        name: &str,
        password: &str,
    ) -> EtcdResult<()> {
        AuthManager::user_change_password(self.client(id)?, name, password).await
    }

    pub async fn user_grant_role(
        &self,
        id: &str,
        user: &str,
        role: &str,
    ) -> EtcdResult<()> {
        AuthManager::user_grant_role(self.client(id)?, user, role).await
    }

    pub async fn user_revoke_role(
        &self,
        id: &str,
        user: &str,
        role: &str,
    ) -> EtcdResult<()> {
        AuthManager::user_revoke_role(self.client(id)?, user, role).await
    }

    pub async fn role_list(&self, id: &str) -> EtcdResult<Vec<EtcdRole>> {
        AuthManager::role_list(self.client(id)?).await
    }

    pub async fn role_add(&self, id: &str, name: &str) -> EtcdResult<()> {
        AuthManager::role_add(self.client(id)?, name).await
    }

    pub async fn role_delete(&self, id: &str, name: &str) -> EtcdResult<()> {
        AuthManager::role_delete(self.client(id)?, name).await
    }

    pub async fn role_get(&self, id: &str, name: &str) -> EtcdResult<EtcdRole> {
        AuthManager::role_get(self.client(id)?, name).await
    }

    pub async fn role_grant_permission(
        &self,
        id: &str,
        name: &str,
        permission: &EtcdPermission,
    ) -> EtcdResult<()> {
        AuthManager::role_grant_permission(self.client(id)?, name, permission).await
    }

    pub async fn role_revoke_permission(
        &self,
        id: &str,
        name: &str,
        key: &str,
        range_end: &str,
    ) -> EtcdResult<()> {
        AuthManager::role_revoke_permission(self.client(id)?, name, key, range_end).await
    }

    // ── Maintenance ──────────────────────────────────────────────────

    pub async fn alarm_list(&self, id: &str) -> EtcdResult<Vec<EtcdAlarm>> {
        MaintenanceManager::alarm_list(self.client(id)?).await
    }

    pub async fn alarm_disarm(&self, id: &str, member_id: u64) -> EtcdResult<()> {
        MaintenanceManager::alarm_disarm(self.client(id)?, member_id, "NOSPACE").await
    }

    pub async fn defragment(
        &self,
        id: &str,
        endpoint: &str,
    ) -> EtcdResult<EtcdDefragResult> {
        MaintenanceManager::defragment(self.client(id)?, endpoint).await
    }

    pub async fn status(&self, id: &str) -> EtcdResult<EtcdStatusResponse> {
        MaintenanceManager::status(self.client(id)?).await
    }

    pub async fn move_leader(&self, id: &str, target_id: u64) -> EtcdResult<()> {
        MaintenanceManager::move_leader(self.client(id)?, target_id).await
    }
}
