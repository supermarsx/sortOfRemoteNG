// ─── LXD / Incus – Tauri command wrappers ───────────────────────────────────
//!
//! Every public function here is a `#[tauri::command]` callable from the
//! frontend via `invoke("lxd_*", { … })`.

use crate::service::LxdService;
use crate::types::*;

fn err_str(e: LxdError) -> String {
    e.message
}

// ═══════════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn lxd_connect(
    svc: tauri::State<'_, LxdService>,
    config: LxdConnectionConfig,
) -> Result<LxdConnectionSummary, String> {
    svc.connect(config).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_disconnect(svc: tauri::State<'_, LxdService>) -> Result<(), String> {
    svc.disconnect().await;
    Ok(())
}

#[tauri::command]
pub async fn lxd_is_connected(svc: tauri::State<'_, LxdService>) -> Result<bool, String> {
    Ok(svc.is_connected().await)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Server & Cluster
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn lxd_get_server(svc: tauri::State<'_, LxdService>) -> Result<LxdServer, String> {
    svc.get_server().await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_get_server_resources(
    svc: tauri::State<'_, LxdService>,
) -> Result<ServerResources, String> {
    svc.get_server_resources().await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_update_server_config(
    svc: tauri::State<'_, LxdService>,
    config: std::collections::HashMap<String, String>,
) -> Result<(), String> {
    svc.update_server_config(config).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_get_cluster(svc: tauri::State<'_, LxdService>) -> Result<LxdCluster, String> {
    svc.get_cluster().await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_list_cluster_members(
    svc: tauri::State<'_, LxdService>,
) -> Result<Vec<LxdClusterMember>, String> {
    svc.list_cluster_members().await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_get_cluster_member(
    svc: tauri::State<'_, LxdService>,
    name: String,
) -> Result<LxdClusterMember, String> {
    svc.get_cluster_member(name).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_evacuate_cluster_member(
    svc: tauri::State<'_, LxdService>,
    name: String,
) -> Result<LxdOperation, String> {
    svc.evacuate_cluster_member(name).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_restore_cluster_member(
    svc: tauri::State<'_, LxdService>,
    name: String,
) -> Result<LxdOperation, String> {
    svc.restore_cluster_member(name).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_remove_cluster_member(
    svc: tauri::State<'_, LxdService>,
    name: String,
    force: bool,
) -> Result<(), String> {
    svc.remove_cluster_member(name, force)
        .await
        .map_err(err_str)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Instances
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn lxd_list_instances(
    svc: tauri::State<'_, LxdService>,
) -> Result<Vec<Instance>, String> {
    svc.list_instances().await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_list_containers(
    svc: tauri::State<'_, LxdService>,
) -> Result<Vec<Instance>, String> {
    svc.list_containers().await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_list_virtual_machines(
    svc: tauri::State<'_, LxdService>,
) -> Result<Vec<Instance>, String> {
    svc.list_virtual_machines().await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_get_instance(
    svc: tauri::State<'_, LxdService>,
    name: String,
) -> Result<Instance, String> {
    svc.get_instance(name).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_get_instance_state(
    svc: tauri::State<'_, LxdService>,
    name: String,
) -> Result<InstanceState, String> {
    svc.get_instance_state(name).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_create_instance(
    svc: tauri::State<'_, LxdService>,
    req: CreateInstanceRequest,
) -> Result<LxdOperation, String> {
    svc.create_instance(req).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_update_instance(
    svc: tauri::State<'_, LxdService>,
    req: UpdateInstanceRequest,
) -> Result<(), String> {
    svc.update_instance(req).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_patch_instance(
    svc: tauri::State<'_, LxdService>,
    name: String,
    patch: serde_json::Value,
) -> Result<(), String> {
    svc.patch_instance(name, patch).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_delete_instance(
    svc: tauri::State<'_, LxdService>,
    name: String,
) -> Result<LxdOperation, String> {
    svc.delete_instance(name).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_rename_instance(
    svc: tauri::State<'_, LxdService>,
    name: String,
    new_name: String,
) -> Result<LxdOperation, String> {
    svc.rename_instance(name, new_name).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_start_instance(
    svc: tauri::State<'_, LxdService>,
    name: String,
    stateful: bool,
) -> Result<LxdOperation, String> {
    svc.start_instance(name, stateful).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_stop_instance(
    svc: tauri::State<'_, LxdService>,
    name: String,
    force: bool,
    stateful: bool,
    timeout: Option<i32>,
) -> Result<LxdOperation, String> {
    svc.stop_instance(name, force, stateful, timeout)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn lxd_restart_instance(
    svc: tauri::State<'_, LxdService>,
    name: String,
    force: bool,
    timeout: Option<i32>,
) -> Result<LxdOperation, String> {
    svc.restart_instance(name, force, timeout)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn lxd_freeze_instance(
    svc: tauri::State<'_, LxdService>,
    name: String,
) -> Result<LxdOperation, String> {
    svc.freeze_instance(name).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_unfreeze_instance(
    svc: tauri::State<'_, LxdService>,
    name: String,
) -> Result<LxdOperation, String> {
    svc.unfreeze_instance(name).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_exec_instance(
    svc: tauri::State<'_, LxdService>,
    name: String,
    req: InstanceExecRequest,
) -> Result<LxdOperation, String> {
    svc.exec_instance(name, req).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_console_instance(
    svc: tauri::State<'_, LxdService>,
    name: String,
    req: InstanceConsoleRequest,
) -> Result<LxdOperation, String> {
    svc.console_instance(name, req).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_clear_console_log(
    svc: tauri::State<'_, LxdService>,
    name: String,
) -> Result<(), String> {
    svc.clear_console_log(name).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_list_instance_logs(
    svc: tauri::State<'_, LxdService>,
    name: String,
) -> Result<Vec<String>, String> {
    svc.list_instance_logs(name).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_get_instance_log(
    svc: tauri::State<'_, LxdService>,
    name: String,
    filename: String,
) -> Result<String, String> {
    svc.get_instance_log(name, filename).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_get_instance_file(
    svc: tauri::State<'_, LxdService>,
    name: String,
    path: String,
) -> Result<String, String> {
    svc.get_instance_file(name, path).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_push_instance_file(
    svc: tauri::State<'_, LxdService>,
    name: String,
    path: String,
    content: String,
    uid: Option<u32>,
    gid: Option<u32>,
    mode: Option<String>,
) -> Result<(), String> {
    svc.push_instance_file(name, path, content, uid, gid, mode)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn lxd_delete_instance_file(
    svc: tauri::State<'_, LxdService>,
    name: String,
    path: String,
) -> Result<(), String> {
    svc.delete_instance_file(name, path).await.map_err(err_str)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Snapshots
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn lxd_list_snapshots(
    svc: tauri::State<'_, LxdService>,
    instance: String,
) -> Result<Vec<InstanceSnapshot>, String> {
    svc.list_snapshots(instance).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_get_snapshot(
    svc: tauri::State<'_, LxdService>,
    instance: String,
    snapshot: String,
) -> Result<InstanceSnapshot, String> {
    svc.get_snapshot(instance, snapshot).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_create_snapshot(
    svc: tauri::State<'_, LxdService>,
    req: CreateSnapshotRequest,
) -> Result<LxdOperation, String> {
    svc.create_snapshot(req).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_delete_snapshot(
    svc: tauri::State<'_, LxdService>,
    instance: String,
    snapshot: String,
) -> Result<LxdOperation, String> {
    svc.delete_snapshot(instance, snapshot)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn lxd_rename_snapshot(
    svc: tauri::State<'_, LxdService>,
    instance: String,
    old_name: String,
    new_name: String,
) -> Result<LxdOperation, String> {
    svc.rename_snapshot(instance, old_name, new_name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn lxd_restore_snapshot(
    svc: tauri::State<'_, LxdService>,
    req: RestoreSnapshotRequest,
) -> Result<(), String> {
    svc.restore_snapshot(req).await.map_err(err_str)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Backups
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn lxd_list_backups(
    svc: tauri::State<'_, LxdService>,
    instance: String,
) -> Result<Vec<InstanceBackup>, String> {
    svc.list_backups(instance).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_get_backup(
    svc: tauri::State<'_, LxdService>,
    instance: String,
    backup: String,
) -> Result<InstanceBackup, String> {
    svc.get_backup(instance, backup).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_create_backup(
    svc: tauri::State<'_, LxdService>,
    req: CreateBackupRequest,
) -> Result<LxdOperation, String> {
    svc.create_backup(req).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_delete_backup(
    svc: tauri::State<'_, LxdService>,
    instance: String,
    backup: String,
) -> Result<LxdOperation, String> {
    svc.delete_backup(instance, backup).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_rename_backup(
    svc: tauri::State<'_, LxdService>,
    instance: String,
    old_name: String,
    new_name: String,
) -> Result<LxdOperation, String> {
    svc.rename_backup(instance, old_name, new_name)
        .await
        .map_err(err_str)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Images
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn lxd_list_images(svc: tauri::State<'_, LxdService>) -> Result<Vec<LxdImage>, String> {
    svc.list_images().await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_get_image(
    svc: tauri::State<'_, LxdService>,
    fingerprint: String,
) -> Result<LxdImage, String> {
    svc.get_image(fingerprint).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_get_image_alias(
    svc: tauri::State<'_, LxdService>,
    alias: String,
) -> Result<serde_json::Value, String> {
    svc.get_image_alias(alias).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_create_image_alias(
    svc: tauri::State<'_, LxdService>,
    req: CreateImageAliasRequest,
) -> Result<(), String> {
    svc.create_image_alias(req).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_delete_image_alias(
    svc: tauri::State<'_, LxdService>,
    alias: String,
) -> Result<(), String> {
    svc.delete_image_alias(alias).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_delete_image(
    svc: tauri::State<'_, LxdService>,
    fingerprint: String,
) -> Result<LxdOperation, String> {
    svc.delete_image(fingerprint).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_update_image(
    svc: tauri::State<'_, LxdService>,
    fingerprint: String,
    properties: std::collections::HashMap<String, String>,
    public: Option<bool>,
    auto_update: Option<bool>,
) -> Result<(), String> {
    svc.update_image(fingerprint, properties, public, auto_update)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn lxd_copy_image_from_remote(
    svc: tauri::State<'_, LxdService>,
    server: String,
    protocol: String,
    alias: Option<String>,
    fingerprint: Option<String>,
    auto_update: bool,
    public: bool,
) -> Result<LxdOperation, String> {
    svc.copy_image_from_remote(server, protocol, alias, fingerprint, auto_update, public)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn lxd_refresh_image(
    svc: tauri::State<'_, LxdService>,
    fingerprint: String,
) -> Result<LxdOperation, String> {
    svc.refresh_image(fingerprint).await.map_err(err_str)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Profiles
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn lxd_list_profiles(
    svc: tauri::State<'_, LxdService>,
) -> Result<Vec<LxdProfile>, String> {
    svc.list_profiles().await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_get_profile(
    svc: tauri::State<'_, LxdService>,
    name: String,
) -> Result<LxdProfile, String> {
    svc.get_profile(name).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_create_profile(
    svc: tauri::State<'_, LxdService>,
    req: CreateProfileRequest,
) -> Result<(), String> {
    svc.create_profile(req).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_update_profile(
    svc: tauri::State<'_, LxdService>,
    req: UpdateProfileRequest,
) -> Result<(), String> {
    svc.update_profile(req).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_patch_profile(
    svc: tauri::State<'_, LxdService>,
    name: String,
    patch: serde_json::Value,
) -> Result<(), String> {
    svc.patch_profile(name, patch).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_delete_profile(
    svc: tauri::State<'_, LxdService>,
    name: String,
) -> Result<(), String> {
    svc.delete_profile(name).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_rename_profile(
    svc: tauri::State<'_, LxdService>,
    name: String,
    new_name: String,
) -> Result<(), String> {
    svc.rename_profile(name, new_name).await.map_err(err_str)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Networks
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn lxd_list_networks(
    svc: tauri::State<'_, LxdService>,
) -> Result<Vec<LxdNetwork>, String> {
    svc.list_networks().await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_get_network(
    svc: tauri::State<'_, LxdService>,
    name: String,
) -> Result<LxdNetwork, String> {
    svc.get_network(name).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_create_network(
    svc: tauri::State<'_, LxdService>,
    req: CreateNetworkRequest,
) -> Result<(), String> {
    svc.create_network(req).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_update_network(
    svc: tauri::State<'_, LxdService>,
    name: String,
    config: std::collections::HashMap<String, String>,
    description: Option<String>,
) -> Result<(), String> {
    svc.update_network(name, config, description)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn lxd_patch_network(
    svc: tauri::State<'_, LxdService>,
    name: String,
    patch: serde_json::Value,
) -> Result<(), String> {
    svc.patch_network(name, patch).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_delete_network(
    svc: tauri::State<'_, LxdService>,
    name: String,
) -> Result<(), String> {
    svc.delete_network(name).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_rename_network(
    svc: tauri::State<'_, LxdService>,
    name: String,
    new_name: String,
) -> Result<(), String> {
    svc.rename_network(name, new_name).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_get_network_state(
    svc: tauri::State<'_, LxdService>,
    name: String,
) -> Result<LxdNetworkState, String> {
    svc.get_network_state(name).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_list_network_leases(
    svc: tauri::State<'_, LxdService>,
    name: String,
) -> Result<Vec<serde_json::Value>, String> {
    svc.list_network_leases(name).await.map_err(err_str)
}

// Network ACLs

#[tauri::command]
pub async fn lxd_list_network_acls(
    svc: tauri::State<'_, LxdService>,
) -> Result<Vec<LxdNetworkAcl>, String> {
    svc.list_network_acls().await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_get_network_acl(
    svc: tauri::State<'_, LxdService>,
    name: String,
) -> Result<LxdNetworkAcl, String> {
    svc.get_network_acl(name).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_create_network_acl(
    svc: tauri::State<'_, LxdService>,
    req: CreateNetworkAclRequest,
) -> Result<(), String> {
    svc.create_network_acl(req).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_update_network_acl(
    svc: tauri::State<'_, LxdService>,
    name: String,
    body: serde_json::Value,
) -> Result<(), String> {
    svc.update_network_acl(name, body).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_delete_network_acl(
    svc: tauri::State<'_, LxdService>,
    name: String,
) -> Result<(), String> {
    svc.delete_network_acl(name).await.map_err(err_str)
}

// Network Forwards

#[tauri::command]
pub async fn lxd_list_network_forwards(
    svc: tauri::State<'_, LxdService>,
    network: String,
) -> Result<Vec<LxdNetworkForward>, String> {
    svc.list_network_forwards(network).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_get_network_forward(
    svc: tauri::State<'_, LxdService>,
    network: String,
    listen_address: String,
) -> Result<LxdNetworkForward, String> {
    svc.get_network_forward(network, listen_address)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn lxd_create_network_forward(
    svc: tauri::State<'_, LxdService>,
    req: CreateNetworkForwardRequest,
) -> Result<(), String> {
    svc.create_network_forward(req).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_delete_network_forward(
    svc: tauri::State<'_, LxdService>,
    network: String,
    listen_address: String,
) -> Result<(), String> {
    svc.delete_network_forward(network, listen_address)
        .await
        .map_err(err_str)
}

// Network Zones

#[tauri::command]
pub async fn lxd_list_network_zones(
    svc: tauri::State<'_, LxdService>,
) -> Result<Vec<LxdNetworkZone>, String> {
    svc.list_network_zones().await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_get_network_zone(
    svc: tauri::State<'_, LxdService>,
    name: String,
) -> Result<LxdNetworkZone, String> {
    svc.get_network_zone(name).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_delete_network_zone(
    svc: tauri::State<'_, LxdService>,
    name: String,
) -> Result<(), String> {
    svc.delete_network_zone(name).await.map_err(err_str)
}

// Network Load Balancers

#[tauri::command]
pub async fn lxd_list_network_load_balancers(
    svc: tauri::State<'_, LxdService>,
    network: String,
) -> Result<Vec<LxdNetworkLoadBalancer>, String> {
    svc.list_network_load_balancers(network)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn lxd_get_network_load_balancer(
    svc: tauri::State<'_, LxdService>,
    network: String,
    listen_address: String,
) -> Result<LxdNetworkLoadBalancer, String> {
    svc.get_network_load_balancer(network, listen_address)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn lxd_delete_network_load_balancer(
    svc: tauri::State<'_, LxdService>,
    network: String,
    listen_address: String,
) -> Result<(), String> {
    svc.delete_network_load_balancer(network, listen_address)
        .await
        .map_err(err_str)
}

// Network Peers

#[tauri::command]
pub async fn lxd_list_network_peers(
    svc: tauri::State<'_, LxdService>,
    network: String,
) -> Result<Vec<LxdNetworkPeer>, String> {
    svc.list_network_peers(network).await.map_err(err_str)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Storage
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn lxd_list_storage_pools(
    svc: tauri::State<'_, LxdService>,
) -> Result<Vec<StoragePool>, String> {
    svc.list_storage_pools().await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_get_storage_pool(
    svc: tauri::State<'_, LxdService>,
    name: String,
) -> Result<StoragePool, String> {
    svc.get_storage_pool(name).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_create_storage_pool(
    svc: tauri::State<'_, LxdService>,
    req: CreateStoragePoolRequest,
) -> Result<(), String> {
    svc.create_storage_pool(req).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_update_storage_pool(
    svc: tauri::State<'_, LxdService>,
    name: String,
    config: std::collections::HashMap<String, String>,
    description: Option<String>,
) -> Result<(), String> {
    svc.update_storage_pool(name, config, description)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn lxd_delete_storage_pool(
    svc: tauri::State<'_, LxdService>,
    name: String,
) -> Result<(), String> {
    svc.delete_storage_pool(name).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_get_storage_pool_resources(
    svc: tauri::State<'_, LxdService>,
    name: String,
) -> Result<StoragePoolResources, String> {
    svc.get_storage_pool_resources(name).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_list_storage_volumes(
    svc: tauri::State<'_, LxdService>,
    pool: String,
) -> Result<Vec<StorageVolume>, String> {
    svc.list_storage_volumes(pool).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_list_custom_volumes(
    svc: tauri::State<'_, LxdService>,
    pool: String,
) -> Result<Vec<StorageVolume>, String> {
    svc.list_custom_volumes(pool).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_get_storage_volume(
    svc: tauri::State<'_, LxdService>,
    pool: String,
    vol_type: String,
    name: String,
) -> Result<StorageVolume, String> {
    svc.get_storage_volume(pool, vol_type, name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn lxd_create_storage_volume(
    svc: tauri::State<'_, LxdService>,
    req: CreateStorageVolumeRequest,
) -> Result<(), String> {
    svc.create_storage_volume(req).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_update_storage_volume(
    svc: tauri::State<'_, LxdService>,
    pool: String,
    name: String,
    patch: serde_json::Value,
) -> Result<(), String> {
    svc.update_storage_volume(pool, name, patch)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn lxd_delete_storage_volume(
    svc: tauri::State<'_, LxdService>,
    pool: String,
    name: String,
) -> Result<(), String> {
    svc.delete_storage_volume(pool, name).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_rename_storage_volume(
    svc: tauri::State<'_, LxdService>,
    pool: String,
    name: String,
    new_name: String,
) -> Result<LxdOperation, String> {
    svc.rename_storage_volume(pool, name, new_name)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn lxd_list_volume_snapshots(
    svc: tauri::State<'_, LxdService>,
    pool: String,
    volume: String,
) -> Result<Vec<StorageVolumeSnapshot>, String> {
    svc.list_volume_snapshots(pool, volume)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn lxd_create_volume_snapshot(
    svc: tauri::State<'_, LxdService>,
    pool: String,
    volume: String,
    snapshot_name: String,
    expires_at: Option<chrono::DateTime<chrono::Utc>>,
) -> Result<LxdOperation, String> {
    svc.create_volume_snapshot(pool, volume, snapshot_name, expires_at)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn lxd_delete_volume_snapshot(
    svc: tauri::State<'_, LxdService>,
    pool: String,
    volume: String,
    snapshot: String,
) -> Result<LxdOperation, String> {
    svc.delete_volume_snapshot(pool, volume, snapshot)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn lxd_list_storage_buckets(
    svc: tauri::State<'_, LxdService>,
    pool: String,
) -> Result<Vec<StorageBucket>, String> {
    svc.list_storage_buckets(pool).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_get_storage_bucket(
    svc: tauri::State<'_, LxdService>,
    pool: String,
    name: String,
) -> Result<StorageBucket, String> {
    svc.get_storage_bucket(pool, name).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_create_storage_bucket(
    svc: tauri::State<'_, LxdService>,
    req: CreateStorageBucketRequest,
) -> Result<(), String> {
    svc.create_storage_bucket(req).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_delete_storage_bucket(
    svc: tauri::State<'_, LxdService>,
    pool: String,
    name: String,
) -> Result<(), String> {
    svc.delete_storage_bucket(pool, name).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_list_bucket_keys(
    svc: tauri::State<'_, LxdService>,
    pool: String,
    bucket: String,
) -> Result<Vec<StorageBucketKey>, String> {
    svc.list_bucket_keys(pool, bucket).await.map_err(err_str)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Projects
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn lxd_list_projects(
    svc: tauri::State<'_, LxdService>,
) -> Result<Vec<LxdProject>, String> {
    svc.list_projects().await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_get_project(
    svc: tauri::State<'_, LxdService>,
    name: String,
) -> Result<LxdProject, String> {
    svc.get_project(name).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_create_project(
    svc: tauri::State<'_, LxdService>,
    req: CreateProjectRequest,
) -> Result<(), String> {
    svc.create_project(req).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_update_project(
    svc: tauri::State<'_, LxdService>,
    name: String,
    body: serde_json::Value,
) -> Result<(), String> {
    svc.update_project(name, body).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_patch_project(
    svc: tauri::State<'_, LxdService>,
    name: String,
    patch: serde_json::Value,
) -> Result<(), String> {
    svc.patch_project(name, patch).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_delete_project(
    svc: tauri::State<'_, LxdService>,
    name: String,
) -> Result<(), String> {
    svc.delete_project(name).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_rename_project(
    svc: tauri::State<'_, LxdService>,
    name: String,
    new_name: String,
) -> Result<(), String> {
    svc.rename_project(name, new_name).await.map_err(err_str)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Certificates
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn lxd_list_certificates(
    svc: tauri::State<'_, LxdService>,
) -> Result<Vec<LxdCertificate>, String> {
    svc.list_certificates().await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_get_certificate(
    svc: tauri::State<'_, LxdService>,
    fingerprint: String,
) -> Result<LxdCertificate, String> {
    svc.get_certificate(fingerprint).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_add_certificate(
    svc: tauri::State<'_, LxdService>,
    req: AddCertificateRequest,
) -> Result<(), String> {
    svc.add_certificate(req).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_delete_certificate(
    svc: tauri::State<'_, LxdService>,
    fingerprint: String,
) -> Result<(), String> {
    svc.delete_certificate(fingerprint).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_update_certificate(
    svc: tauri::State<'_, LxdService>,
    fingerprint: String,
    patch: serde_json::Value,
) -> Result<(), String> {
    svc.update_certificate(fingerprint, patch)
        .await
        .map_err(err_str)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Operations
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn lxd_list_operations(
    svc: tauri::State<'_, LxdService>,
) -> Result<Vec<LxdOperation>, String> {
    svc.list_operations().await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_get_operation(
    svc: tauri::State<'_, LxdService>,
    id: String,
) -> Result<LxdOperation, String> {
    svc.get_operation(id).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_cancel_operation(
    svc: tauri::State<'_, LxdService>,
    id: String,
) -> Result<(), String> {
    svc.cancel_operation(id).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_wait_operation(
    svc: tauri::State<'_, LxdService>,
    id: String,
    timeout: Option<u64>,
) -> Result<LxdOperation, String> {
    svc.wait_operation(id, timeout).await.map_err(err_str)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Warnings
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn lxd_list_warnings(
    svc: tauri::State<'_, LxdService>,
) -> Result<Vec<LxdWarning>, String> {
    svc.list_warnings().await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_get_warning(
    svc: tauri::State<'_, LxdService>,
    uuid: String,
) -> Result<LxdWarning, String> {
    svc.get_warning(uuid).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_acknowledge_warning(
    svc: tauri::State<'_, LxdService>,
    uuid: String,
) -> Result<(), String> {
    svc.acknowledge_warning(uuid).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_delete_warning(
    svc: tauri::State<'_, LxdService>,
    uuid: String,
) -> Result<(), String> {
    svc.delete_warning(uuid).await.map_err(err_str)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Migration / Copy / Publish
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn lxd_migrate_instance(
    svc: tauri::State<'_, LxdService>,
    req: MigrateInstanceRequest,
) -> Result<LxdOperation, String> {
    svc.migrate_instance(req).await.map_err(err_str)
}

#[tauri::command]
pub async fn lxd_copy_instance(
    svc: tauri::State<'_, LxdService>,
    source_name: String,
    new_name: String,
    instance_only: bool,
    stateful: bool,
) -> Result<LxdOperation, String> {
    svc.copy_instance(source_name, new_name, instance_only, stateful)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn lxd_publish_instance(
    svc: tauri::State<'_, LxdService>,
    instance: String,
    alias: Option<String>,
    public: bool,
    properties: Option<std::collections::HashMap<String, String>>,
) -> Result<LxdOperation, String> {
    svc.publish_instance(instance, alias, public, properties)
        .await
        .map_err(err_str)
}
