// ─── LXD / Incus – Service facade ───────────────────────────────────────────
//!
//! Thread-safe service that holds a persistent [`LxdClient`] behind
//! `Arc<Mutex<…>>`.  This is the single entry-point used by Tauri commands.

use crate::client::LxdClient;
use crate::types::*;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Clone)]
pub struct LxdService {
    client: Arc<Mutex<Option<LxdClient>>>,
}

impl LxdService {
    pub fn new() -> Self {
        Self {
            client: Arc::new(Mutex::new(None)),
        }
    }

    // ─── Connection management ───────────────────────────────────────────

    pub async fn connect(&self, config: LxdConnectionConfig) -> LxdResult<LxdConnectionSummary> {
        let c = LxdClient::new(config.clone())?;
        // Verify connectivity by fetching server info
        let info = crate::server::get_server(&c).await?;
        let summary = LxdConnectionSummary {
            url: config.url.clone(),
            project: config.project.clone(),
            server_version: info
                .environment
                .as_ref()
                .and_then(|e| e.server_version.clone()),
            api_extensions: info.api_extensions.clone(),
        };
        *self.client.lock().await = Some(c);
        Ok(summary)
    }

    pub async fn disconnect(&self) {
        *self.client.lock().await = None;
    }

    pub async fn is_connected(&self) -> bool {
        self.client.lock().await.is_some()
    }

    /// Get a cloned client (reqwest::Client is Arc-based, cheap to clone).
    async fn client(&self) -> LxdResult<LxdClient> {
        let guard = self.client.lock().await;
        let c = guard
            .as_ref()
            .ok_or_else(|| LxdError::connection("not connected to an LXD server".into()))?;
        Ok(LxdClient {
            http: c.http.clone(),
            config: c.config.clone(),
        })
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Server & Cluster
    // ═══════════════════════════════════════════════════════════════════════

    pub async fn get_server(&self) -> LxdResult<LxdServer> {
        let c = self.client().await?;
        crate::server::get_server(&c).await
    }

    pub async fn get_server_resources(&self) -> LxdResult<ServerResources> {
        let c = self.client().await?;
        crate::server::get_server_resources(&c).await
    }

    pub async fn update_server_config(
        &self,
        config: std::collections::HashMap<String, String>,
    ) -> LxdResult<()> {
        let c = self.client().await?;
        crate::server::update_server_config(&c, &config).await
    }

    pub async fn get_cluster(&self) -> LxdResult<LxdCluster> {
        let c = self.client().await?;
        crate::server::get_cluster(&c).await
    }

    pub async fn list_cluster_members(&self) -> LxdResult<Vec<LxdClusterMember>> {
        let c = self.client().await?;
        crate::server::list_cluster_members(&c).await
    }

    pub async fn get_cluster_member(&self, name: String) -> LxdResult<LxdClusterMember> {
        let c = self.client().await?;
        crate::server::get_cluster_member(&c, &name).await
    }

    pub async fn evacuate_cluster_member(&self, name: String) -> LxdResult<LxdOperation> {
        let c = self.client().await?;
        crate::server::evacuate_cluster_member(&c, &name).await
    }

    pub async fn restore_cluster_member(&self, name: String) -> LxdResult<LxdOperation> {
        let c = self.client().await?;
        crate::server::restore_cluster_member(&c, &name).await
    }

    pub async fn remove_cluster_member(&self, name: String, force: bool) -> LxdResult<()> {
        let c = self.client().await?;
        crate::server::remove_cluster_member(&c, &name, force).await
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Instances
    // ═══════════════════════════════════════════════════════════════════════

    pub async fn list_instances(&self) -> LxdResult<Vec<Instance>> {
        let c = self.client().await?;
        crate::instances::list_instances(&c).await
    }

    pub async fn list_containers(&self) -> LxdResult<Vec<Instance>> {
        let c = self.client().await?;
        crate::instances::list_containers(&c).await
    }

    pub async fn list_virtual_machines(&self) -> LxdResult<Vec<Instance>> {
        let c = self.client().await?;
        crate::instances::list_virtual_machines(&c).await
    }

    pub async fn get_instance(&self, name: String) -> LxdResult<Instance> {
        let c = self.client().await?;
        crate::instances::get_instance(&c, &name).await
    }

    pub async fn get_instance_state(&self, name: String) -> LxdResult<InstanceState> {
        let c = self.client().await?;
        crate::instances::get_instance_state(&c, &name).await
    }

    pub async fn create_instance(&self, req: CreateInstanceRequest) -> LxdResult<LxdOperation> {
        let c = self.client().await?;
        crate::instances::create_instance(&c, &req).await
    }

    pub async fn update_instance(&self, req: UpdateInstanceRequest) -> LxdResult<()> {
        let c = self.client().await?;
        crate::instances::update_instance(&c, &req).await
    }

    pub async fn patch_instance(&self, name: String, patch: serde_json::Value) -> LxdResult<()> {
        let c = self.client().await?;
        crate::instances::patch_instance(&c, &name, &patch).await
    }

    pub async fn delete_instance(&self, name: String) -> LxdResult<LxdOperation> {
        let c = self.client().await?;
        crate::instances::delete_instance(&c, &name).await
    }

    pub async fn rename_instance(&self, name: String, new_name: String) -> LxdResult<LxdOperation> {
        let c = self.client().await?;
        crate::instances::rename_instance(&c, &name, &new_name).await
    }

    pub async fn start_instance(&self, name: String, stateful: bool) -> LxdResult<LxdOperation> {
        let c = self.client().await?;
        crate::instances::start_instance(&c, &name, stateful).await
    }

    pub async fn stop_instance(&self, name: String, force: bool, stateful: bool, timeout: Option<i32>) -> LxdResult<LxdOperation> {
        let c = self.client().await?;
        crate::instances::stop_instance(&c, &name, force, stateful, timeout).await
    }

    pub async fn restart_instance(&self, name: String, force: bool, timeout: Option<i32>) -> LxdResult<LxdOperation> {
        let c = self.client().await?;
        crate::instances::restart_instance(&c, &name, force, timeout).await
    }

    pub async fn freeze_instance(&self, name: String) -> LxdResult<LxdOperation> {
        let c = self.client().await?;
        crate::instances::freeze_instance(&c, &name).await
    }

    pub async fn unfreeze_instance(&self, name: String) -> LxdResult<LxdOperation> {
        let c = self.client().await?;
        crate::instances::unfreeze_instance(&c, &name).await
    }

    pub async fn exec_instance(&self, name: String, req: InstanceExecRequest) -> LxdResult<LxdOperation> {
        let c = self.client().await?;
        crate::instances::exec_instance(&c, &name, &req).await
    }

    pub async fn console_instance(&self, name: String, req: InstanceConsoleRequest) -> LxdResult<LxdOperation> {
        let c = self.client().await?;
        crate::instances::console_instance(&c, &name, &req).await
    }

    pub async fn clear_console_log(&self, name: String) -> LxdResult<()> {
        let c = self.client().await?;
        crate::instances::clear_console_log(&c, &name).await
    }

    pub async fn list_instance_logs(&self, name: String) -> LxdResult<Vec<String>> {
        let c = self.client().await?;
        crate::instances::list_instance_logs(&c, &name).await
    }

    pub async fn get_instance_log(&self, name: String, filename: String) -> LxdResult<String> {
        let c = self.client().await?;
        crate::instances::get_instance_log(&c, &name, &filename).await
    }

    pub async fn get_instance_file(&self, name: String, path: String) -> LxdResult<String> {
        let c = self.client().await?;
        crate::instances::get_instance_file(&c, &name, &path).await
    }

    pub async fn push_instance_file(&self, name: String, path: String, content: String, uid: Option<u32>, gid: Option<u32>, mode: Option<String>) -> LxdResult<()> {
        let c = self.client().await?;
        crate::instances::push_instance_file(&c, &name, &path, &content, uid, gid, mode.as_deref()).await
    }

    pub async fn delete_instance_file(&self, name: String, path: String) -> LxdResult<()> {
        let c = self.client().await?;
        crate::instances::delete_instance_file(&c, &name, &path).await
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Snapshots
    // ═══════════════════════════════════════════════════════════════════════

    pub async fn list_snapshots(&self, instance: String) -> LxdResult<Vec<InstanceSnapshot>> {
        let c = self.client().await?;
        crate::snapshots::list_snapshots(&c, &instance).await
    }

    pub async fn get_snapshot(&self, instance: String, snapshot: String) -> LxdResult<InstanceSnapshot> {
        let c = self.client().await?;
        crate::snapshots::get_snapshot(&c, &instance, &snapshot).await
    }

    pub async fn create_snapshot(&self, req: CreateSnapshotRequest) -> LxdResult<LxdOperation> {
        let c = self.client().await?;
        crate::snapshots::create_snapshot(&c, &req).await
    }

    pub async fn delete_snapshot(&self, instance: String, snapshot: String) -> LxdResult<LxdOperation> {
        let c = self.client().await?;
        crate::snapshots::delete_snapshot(&c, &instance, &snapshot).await
    }

    pub async fn rename_snapshot(&self, instance: String, old_name: String, new_name: String) -> LxdResult<LxdOperation> {
        let c = self.client().await?;
        crate::snapshots::rename_snapshot(&c, &instance, &old_name, &new_name).await
    }

    pub async fn restore_snapshot(&self, req: RestoreSnapshotRequest) -> LxdResult<()> {
        let c = self.client().await?;
        crate::snapshots::restore_snapshot(&c, &req).await
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Backups
    // ═══════════════════════════════════════════════════════════════════════

    pub async fn list_backups(&self, instance: String) -> LxdResult<Vec<InstanceBackup>> {
        let c = self.client().await?;
        crate::backups::list_backups(&c, &instance).await
    }

    pub async fn get_backup(&self, instance: String, backup: String) -> LxdResult<InstanceBackup> {
        let c = self.client().await?;
        crate::backups::get_backup(&c, &instance, &backup).await
    }

    pub async fn create_backup(&self, req: CreateBackupRequest) -> LxdResult<LxdOperation> {
        let c = self.client().await?;
        crate::backups::create_backup(&c, &req).await
    }

    pub async fn delete_backup(&self, instance: String, backup: String) -> LxdResult<LxdOperation> {
        let c = self.client().await?;
        crate::backups::delete_backup(&c, &instance, &backup).await
    }

    pub async fn rename_backup(&self, instance: String, old_name: String, new_name: String) -> LxdResult<LxdOperation> {
        let c = self.client().await?;
        crate::backups::rename_backup(&c, &instance, &old_name, &new_name).await
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Images
    // ═══════════════════════════════════════════════════════════════════════

    pub async fn list_images(&self) -> LxdResult<Vec<LxdImage>> {
        let c = self.client().await?;
        crate::images::list_images(&c).await
    }

    pub async fn get_image(&self, fingerprint: String) -> LxdResult<LxdImage> {
        let c = self.client().await?;
        crate::images::get_image(&c, &fingerprint).await
    }

    pub async fn get_image_alias(&self, alias: String) -> LxdResult<serde_json::Value> {
        let c = self.client().await?;
        crate::images::get_image_alias(&c, &alias).await
    }

    pub async fn create_image_alias(&self, req: CreateImageAliasRequest) -> LxdResult<()> {
        let c = self.client().await?;
        crate::images::create_image_alias(&c, &req).await
    }

    pub async fn delete_image_alias(&self, alias: String) -> LxdResult<()> {
        let c = self.client().await?;
        crate::images::delete_image_alias(&c, &alias).await
    }

    pub async fn delete_image(&self, fingerprint: String) -> LxdResult<LxdOperation> {
        let c = self.client().await?;
        crate::images::delete_image(&c, &fingerprint).await
    }

    pub async fn update_image(&self, fingerprint: String, properties: std::collections::HashMap<String, String>, public: Option<bool>, auto_update: Option<bool>) -> LxdResult<()> {
        let c = self.client().await?;
        crate::images::update_image(&c, &fingerprint, &properties, public, auto_update).await
    }

    pub async fn copy_image_from_remote(&self, server: String, protocol: String, alias: Option<String>, fingerprint: Option<String>, auto_update: bool, public: bool) -> LxdResult<LxdOperation> {
        let c = self.client().await?;
        crate::images::copy_image_from_remote(&c, &server, &protocol, alias.as_deref(), fingerprint.as_deref(), auto_update, public).await
    }

    pub async fn refresh_image(&self, fingerprint: String) -> LxdResult<LxdOperation> {
        let c = self.client().await?;
        crate::images::refresh_image(&c, &fingerprint).await
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Profiles
    // ═══════════════════════════════════════════════════════════════════════

    pub async fn list_profiles(&self) -> LxdResult<Vec<LxdProfile>> {
        let c = self.client().await?;
        crate::profiles::list_profiles(&c).await
    }

    pub async fn get_profile(&self, name: String) -> LxdResult<LxdProfile> {
        let c = self.client().await?;
        crate::profiles::get_profile(&c, &name).await
    }

    pub async fn create_profile(&self, req: CreateProfileRequest) -> LxdResult<()> {
        let c = self.client().await?;
        crate::profiles::create_profile(&c, &req).await
    }

    pub async fn update_profile(&self, req: UpdateProfileRequest) -> LxdResult<()> {
        let c = self.client().await?;
        crate::profiles::update_profile(&c, &req).await
    }

    pub async fn patch_profile(&self, name: String, patch: serde_json::Value) -> LxdResult<()> {
        let c = self.client().await?;
        crate::profiles::patch_profile(&c, &name, &patch).await
    }

    pub async fn delete_profile(&self, name: String) -> LxdResult<()> {
        let c = self.client().await?;
        crate::profiles::delete_profile(&c, &name).await
    }

    pub async fn rename_profile(&self, name: String, new_name: String) -> LxdResult<()> {
        let c = self.client().await?;
        crate::profiles::rename_profile(&c, &name, &new_name).await
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Networks
    // ═══════════════════════════════════════════════════════════════════════

    pub async fn list_networks(&self) -> LxdResult<Vec<LxdNetwork>> {
        let c = self.client().await?;
        crate::networks::list_networks(&c).await
    }

    pub async fn get_network(&self, name: String) -> LxdResult<LxdNetwork> {
        let c = self.client().await?;
        crate::networks::get_network(&c, &name).await
    }

    pub async fn create_network(&self, req: CreateNetworkRequest) -> LxdResult<()> {
        let c = self.client().await?;
        crate::networks::create_network(&c, &req).await
    }

    pub async fn update_network(&self, name: String, config: std::collections::HashMap<String, String>, description: Option<String>) -> LxdResult<()> {
        let c = self.client().await?;
        crate::networks::update_network(&c, &name, &config, description.as_deref()).await
    }

    pub async fn patch_network(&self, name: String, patch: serde_json::Value) -> LxdResult<()> {
        let c = self.client().await?;
        crate::networks::patch_network(&c, &name, &patch).await
    }

    pub async fn delete_network(&self, name: String) -> LxdResult<()> {
        let c = self.client().await?;
        crate::networks::delete_network(&c, &name).await
    }

    pub async fn rename_network(&self, name: String, new_name: String) -> LxdResult<()> {
        let c = self.client().await?;
        crate::networks::rename_network(&c, &name, &new_name).await
    }

    pub async fn get_network_state(&self, name: String) -> LxdResult<LxdNetworkState> {
        let c = self.client().await?;
        crate::networks::get_network_state(&c, &name).await
    }

    pub async fn list_network_leases(&self, name: String) -> LxdResult<Vec<serde_json::Value>> {
        let c = self.client().await?;
        crate::networks::list_network_leases(&c, &name).await
    }

    // Network ACLs
    pub async fn list_network_acls(&self) -> LxdResult<Vec<LxdNetworkAcl>> {
        let c = self.client().await?;
        crate::networks::list_network_acls(&c).await
    }

    pub async fn get_network_acl(&self, name: String) -> LxdResult<LxdNetworkAcl> {
        let c = self.client().await?;
        crate::networks::get_network_acl(&c, &name).await
    }

    pub async fn create_network_acl(&self, req: CreateNetworkAclRequest) -> LxdResult<()> {
        let c = self.client().await?;
        crate::networks::create_network_acl(&c, &req).await
    }

    pub async fn update_network_acl(&self, name: String, body: serde_json::Value) -> LxdResult<()> {
        let c = self.client().await?;
        crate::networks::update_network_acl(&c, &name, &body).await
    }

    pub async fn delete_network_acl(&self, name: String) -> LxdResult<()> {
        let c = self.client().await?;
        crate::networks::delete_network_acl(&c, &name).await
    }

    // Network Forwards
    pub async fn list_network_forwards(&self, network: String) -> LxdResult<Vec<LxdNetworkForward>> {
        let c = self.client().await?;
        crate::networks::list_network_forwards(&c, &network).await
    }

    pub async fn get_network_forward(&self, network: String, listen_address: String) -> LxdResult<LxdNetworkForward> {
        let c = self.client().await?;
        crate::networks::get_network_forward(&c, &network, &listen_address).await
    }

    pub async fn create_network_forward(&self, req: CreateNetworkForwardRequest) -> LxdResult<()> {
        let c = self.client().await?;
        crate::networks::create_network_forward(&c, &req).await
    }

    pub async fn delete_network_forward(&self, network: String, listen_address: String) -> LxdResult<()> {
        let c = self.client().await?;
        crate::networks::delete_network_forward(&c, &network, &listen_address).await
    }

    // Network Zones
    pub async fn list_network_zones(&self) -> LxdResult<Vec<LxdNetworkZone>> {
        let c = self.client().await?;
        crate::networks::list_network_zones(&c).await
    }

    pub async fn get_network_zone(&self, name: String) -> LxdResult<LxdNetworkZone> {
        let c = self.client().await?;
        crate::networks::get_network_zone(&c, &name).await
    }

    pub async fn delete_network_zone(&self, name: String) -> LxdResult<()> {
        let c = self.client().await?;
        crate::networks::delete_network_zone(&c, &name).await
    }

    // Network Load Balancers
    pub async fn list_network_load_balancers(&self, network: String) -> LxdResult<Vec<LxdNetworkLoadBalancer>> {
        let c = self.client().await?;
        crate::networks::list_network_load_balancers(&c, &network).await
    }

    pub async fn get_network_load_balancer(&self, network: String, listen_address: String) -> LxdResult<LxdNetworkLoadBalancer> {
        let c = self.client().await?;
        crate::networks::get_network_load_balancer(&c, &network, &listen_address).await
    }

    pub async fn delete_network_load_balancer(&self, network: String, listen_address: String) -> LxdResult<()> {
        let c = self.client().await?;
        crate::networks::delete_network_load_balancer(&c, &network, &listen_address).await
    }

    // Network Peers
    pub async fn list_network_peers(&self, network: String) -> LxdResult<Vec<LxdNetworkPeer>> {
        let c = self.client().await?;
        crate::networks::list_network_peers(&c, &network).await
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Storage
    // ═══════════════════════════════════════════════════════════════════════

    pub async fn list_storage_pools(&self) -> LxdResult<Vec<StoragePool>> {
        let c = self.client().await?;
        crate::storage::list_storage_pools(&c).await
    }

    pub async fn get_storage_pool(&self, name: String) -> LxdResult<StoragePool> {
        let c = self.client().await?;
        crate::storage::get_storage_pool(&c, &name).await
    }

    pub async fn create_storage_pool(&self, req: CreateStoragePoolRequest) -> LxdResult<()> {
        let c = self.client().await?;
        crate::storage::create_storage_pool(&c, &req).await
    }

    pub async fn update_storage_pool(&self, name: String, config: std::collections::HashMap<String, String>, description: Option<String>) -> LxdResult<()> {
        let c = self.client().await?;
        crate::storage::update_storage_pool(&c, &name, &config, description.as_deref()).await
    }

    pub async fn delete_storage_pool(&self, name: String) -> LxdResult<()> {
        let c = self.client().await?;
        crate::storage::delete_storage_pool(&c, &name).await
    }

    pub async fn get_storage_pool_resources(&self, name: String) -> LxdResult<StoragePoolResources> {
        let c = self.client().await?;
        crate::storage::get_storage_pool_resources(&c, &name).await
    }

    pub async fn list_storage_volumes(&self, pool: String) -> LxdResult<Vec<StorageVolume>> {
        let c = self.client().await?;
        crate::storage::list_storage_volumes(&c, &pool).await
    }

    pub async fn list_custom_volumes(&self, pool: String) -> LxdResult<Vec<StorageVolume>> {
        let c = self.client().await?;
        crate::storage::list_custom_volumes(&c, &pool).await
    }

    pub async fn get_storage_volume(&self, pool: String, vol_type: String, name: String) -> LxdResult<StorageVolume> {
        let c = self.client().await?;
        crate::storage::get_storage_volume(&c, &pool, &vol_type, &name).await
    }

    pub async fn create_storage_volume(&self, req: CreateStorageVolumeRequest) -> LxdResult<()> {
        let c = self.client().await?;
        crate::storage::create_storage_volume(&c, &req).await
    }

    pub async fn update_storage_volume(&self, pool: String, name: String, patch: serde_json::Value) -> LxdResult<()> {
        let c = self.client().await?;
        crate::storage::update_storage_volume(&c, &pool, &name, &patch).await
    }

    pub async fn delete_storage_volume(&self, pool: String, name: String) -> LxdResult<()> {
        let c = self.client().await?;
        crate::storage::delete_storage_volume(&c, &pool, &name).await
    }

    pub async fn rename_storage_volume(&self, pool: String, name: String, new_name: String) -> LxdResult<LxdOperation> {
        let c = self.client().await?;
        crate::storage::rename_storage_volume(&c, &pool, &name, &new_name).await
    }

    pub async fn list_volume_snapshots(&self, pool: String, volume: String) -> LxdResult<Vec<StorageVolumeSnapshot>> {
        let c = self.client().await?;
        crate::storage::list_volume_snapshots(&c, &pool, &volume).await
    }

    pub async fn create_volume_snapshot(&self, pool: String, volume: String, snapshot_name: String, expires_at: Option<chrono::DateTime<chrono::Utc>>) -> LxdResult<LxdOperation> {
        let c = self.client().await?;
        crate::storage::create_volume_snapshot(&c, &pool, &volume, &snapshot_name, expires_at.as_ref()).await
    }

    pub async fn delete_volume_snapshot(&self, pool: String, volume: String, snapshot: String) -> LxdResult<LxdOperation> {
        let c = self.client().await?;
        crate::storage::delete_volume_snapshot(&c, &pool, &volume, &snapshot).await
    }

    pub async fn list_storage_buckets(&self, pool: String) -> LxdResult<Vec<StorageBucket>> {
        let c = self.client().await?;
        crate::storage::list_storage_buckets(&c, &pool).await
    }

    pub async fn get_storage_bucket(&self, pool: String, name: String) -> LxdResult<StorageBucket> {
        let c = self.client().await?;
        crate::storage::get_storage_bucket(&c, &pool, &name).await
    }

    pub async fn create_storage_bucket(&self, req: CreateStorageBucketRequest) -> LxdResult<()> {
        let c = self.client().await?;
        crate::storage::create_storage_bucket(&c, &req).await
    }

    pub async fn delete_storage_bucket(&self, pool: String, name: String) -> LxdResult<()> {
        let c = self.client().await?;
        crate::storage::delete_storage_bucket(&c, &pool, &name).await
    }

    pub async fn list_bucket_keys(&self, pool: String, bucket: String) -> LxdResult<Vec<StorageBucketKey>> {
        let c = self.client().await?;
        crate::storage::list_bucket_keys(&c, &pool, &bucket).await
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Projects
    // ═══════════════════════════════════════════════════════════════════════

    pub async fn list_projects(&self) -> LxdResult<Vec<LxdProject>> {
        let c = self.client().await?;
        crate::projects::list_projects(&c).await
    }

    pub async fn get_project(&self, name: String) -> LxdResult<LxdProject> {
        let c = self.client().await?;
        crate::projects::get_project(&c, &name).await
    }

    pub async fn create_project(&self, req: CreateProjectRequest) -> LxdResult<()> {
        let c = self.client().await?;
        crate::projects::create_project(&c, &req).await
    }

    pub async fn update_project(&self, name: String, body: serde_json::Value) -> LxdResult<()> {
        let c = self.client().await?;
        crate::projects::update_project(&c, &name, &body).await
    }

    pub async fn patch_project(&self, name: String, patch: serde_json::Value) -> LxdResult<()> {
        let c = self.client().await?;
        crate::projects::patch_project(&c, &name, &patch).await
    }

    pub async fn delete_project(&self, name: String) -> LxdResult<()> {
        let c = self.client().await?;
        crate::projects::delete_project(&c, &name).await
    }

    pub async fn rename_project(&self, name: String, new_name: String) -> LxdResult<()> {
        let c = self.client().await?;
        crate::projects::rename_project(&c, &name, &new_name).await
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Certificates
    // ═══════════════════════════════════════════════════════════════════════

    pub async fn list_certificates(&self) -> LxdResult<Vec<LxdCertificate>> {
        let c = self.client().await?;
        crate::operations::list_certificates(&c).await
    }

    pub async fn get_certificate(&self, fingerprint: String) -> LxdResult<LxdCertificate> {
        let c = self.client().await?;
        crate::operations::get_certificate(&c, &fingerprint).await
    }

    pub async fn add_certificate(&self, req: AddCertificateRequest) -> LxdResult<()> {
        let c = self.client().await?;
        crate::operations::add_certificate(&c, &req).await
    }

    pub async fn delete_certificate(&self, fingerprint: String) -> LxdResult<()> {
        let c = self.client().await?;
        crate::operations::delete_certificate(&c, &fingerprint).await
    }

    pub async fn update_certificate(&self, fingerprint: String, patch: serde_json::Value) -> LxdResult<()> {
        let c = self.client().await?;
        crate::operations::update_certificate(&c, &fingerprint, &patch).await
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Operations
    // ═══════════════════════════════════════════════════════════════════════

    pub async fn list_operations(&self) -> LxdResult<Vec<LxdOperation>> {
        let c = self.client().await?;
        crate::operations::list_operations(&c).await
    }

    pub async fn get_operation(&self, id: String) -> LxdResult<LxdOperation> {
        let c = self.client().await?;
        crate::operations::get_operation(&c, &id).await
    }

    pub async fn cancel_operation(&self, id: String) -> LxdResult<()> {
        let c = self.client().await?;
        crate::operations::cancel_operation(&c, &id).await
    }

    pub async fn wait_operation(&self, id: String, timeout: Option<u64>) -> LxdResult<LxdOperation> {
        let c = self.client().await?;
        crate::operations::wait_operation(&c, &id, timeout).await
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Warnings
    // ═══════════════════════════════════════════════════════════════════════

    pub async fn list_warnings(&self) -> LxdResult<Vec<LxdWarning>> {
        let c = self.client().await?;
        crate::operations::list_warnings(&c).await
    }

    pub async fn get_warning(&self, uuid: String) -> LxdResult<LxdWarning> {
        let c = self.client().await?;
        crate::operations::get_warning(&c, &uuid).await
    }

    pub async fn acknowledge_warning(&self, uuid: String) -> LxdResult<()> {
        let c = self.client().await?;
        crate::operations::acknowledge_warning(&c, &uuid).await
    }

    pub async fn delete_warning(&self, uuid: String) -> LxdResult<()> {
        let c = self.client().await?;
        crate::operations::delete_warning(&c, &uuid).await
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Migration / Copy / Publish
    // ═══════════════════════════════════════════════════════════════════════

    pub async fn migrate_instance(&self, req: MigrateInstanceRequest) -> LxdResult<LxdOperation> {
        let c = self.client().await?;
        crate::migration::migrate_instance(&c, &req).await
    }

    pub async fn copy_instance(&self, source_name: String, new_name: String, instance_only: bool, stateful: bool) -> LxdResult<LxdOperation> {
        let c = self.client().await?;
        crate::migration::copy_instance(&c, &source_name, &new_name, instance_only, stateful).await
    }

    pub async fn publish_instance(&self, instance: String, alias: Option<String>, public: bool, properties: Option<std::collections::HashMap<String, String>>) -> LxdResult<LxdOperation> {
        let c = self.client().await?;
        crate::migration::publish_instance(&c, &instance, alias.as_deref(), public, properties.as_ref()).await
    }
}
