use crate::service::HetznerServiceState;
use crate::types::*;
use tauri::State;

// ── Connection management ───────────────────────────────────────────────

#[tauri::command]
pub async fn hetzner_connect(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    config: HetznerConnectionConfig,
) -> Result<HetznerConnectionSummary, String> {
    state
        .lock()
        .await
        .connect(connection_id, config)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_disconnect(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
) -> Result<(), String> {
    state
        .lock()
        .await
        .disconnect(&connection_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_list_connections(
    state: State<'_, HetznerServiceState>,
) -> Result<Vec<String>, String> {
    Ok(state.lock().await.list_connections())
}

#[tauri::command]
pub async fn hetzner_ping(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
) -> Result<(), String> {
    state
        .lock()
        .await
        .ping(&connection_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_get_dashboard(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
) -> Result<HetznerDashboard, String> {
    state
        .lock()
        .await
        .get_dashboard(&connection_id)
        .await
        .map_err(|e| e.to_string())
}

// ── Servers ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn hetzner_list_servers(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
) -> Result<Vec<HetznerServer>, String> {
    state
        .lock()
        .await
        .list_servers(&connection_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_get_server(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
) -> Result<HetznerServer, String> {
    state
        .lock()
        .await
        .get_server(&connection_id, id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_create_server(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    request: CreateServerRequest,
) -> Result<(HetznerServer, HetznerAction), String> {
    state
        .lock()
        .await
        .create_server(&connection_id, request)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_delete_server(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
) -> Result<(), String> {
    state
        .lock()
        .await
        .delete_server(&connection_id, id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_start_server(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
) -> Result<HetznerAction, String> {
    state
        .lock()
        .await
        .start_server(&connection_id, id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_stop_server(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
) -> Result<HetznerAction, String> {
    state
        .lock()
        .await
        .stop_server(&connection_id, id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_reboot_server(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
) -> Result<HetznerAction, String> {
    state
        .lock()
        .await
        .reboot_server(&connection_id, id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_rebuild_server(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
    image: String,
) -> Result<HetznerAction, String> {
    state
        .lock()
        .await
        .rebuild_server(&connection_id, id, image)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_reset_server(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
) -> Result<HetznerAction, String> {
    state
        .lock()
        .await
        .reset_server(&connection_id, id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_change_server_type(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
    server_type: String,
    upgrade_disk: bool,
) -> Result<HetznerAction, String> {
    state
        .lock()
        .await
        .change_server_type(&connection_id, id, server_type, upgrade_disk)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_enable_rescue(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
    rescue_type: Option<String>,
    ssh_keys: Option<Vec<u64>>,
) -> Result<HetznerAction, String> {
    state
        .lock()
        .await
        .enable_rescue(&connection_id, id, rescue_type, ssh_keys)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_disable_rescue(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
) -> Result<HetznerAction, String> {
    state
        .lock()
        .await
        .disable_rescue(&connection_id, id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_create_server_image(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
    description: Option<String>,
    image_type: Option<String>,
    labels: Option<serde_json::Value>,
) -> Result<HetznerAction, String> {
    state
        .lock()
        .await
        .create_server_image(&connection_id, id, description, image_type, labels)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_enable_backup(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
) -> Result<HetznerAction, String> {
    state
        .lock()
        .await
        .enable_backup(&connection_id, id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_disable_backup(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
) -> Result<HetznerAction, String> {
    state
        .lock()
        .await
        .disable_backup(&connection_id, id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_get_server_metrics(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
    metric_type: String,
    start: String,
    end: String,
) -> Result<serde_json::Value, String> {
    state
        .lock()
        .await
        .get_server_metrics(&connection_id, id, metric_type, start, end)
        .await
        .map_err(|e| e.to_string())
}

// ── Networks ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn hetzner_list_networks(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
) -> Result<Vec<HetznerNetwork>, String> {
    state
        .lock()
        .await
        .list_networks(&connection_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_get_network(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
) -> Result<HetznerNetwork, String> {
    state
        .lock()
        .await
        .get_network(&connection_id, id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_create_network(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    request: CreateNetworkRequest,
) -> Result<HetznerNetwork, String> {
    state
        .lock()
        .await
        .create_network(&connection_id, request)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_update_network(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
    name: Option<String>,
    labels: Option<serde_json::Value>,
) -> Result<HetznerNetwork, String> {
    state
        .lock()
        .await
        .update_network(&connection_id, id, name, labels)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_delete_network(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
) -> Result<(), String> {
    state
        .lock()
        .await
        .delete_network(&connection_id, id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_add_subnet(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
    subnet: HetznerSubnet,
) -> Result<HetznerAction, String> {
    state
        .lock()
        .await
        .add_subnet(&connection_id, id, subnet)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_delete_subnet(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
    ip_range: String,
) -> Result<HetznerAction, String> {
    state
        .lock()
        .await
        .delete_subnet(&connection_id, id, ip_range)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_add_route(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
    route: HetznerRoute,
) -> Result<HetznerAction, String> {
    state
        .lock()
        .await
        .add_route(&connection_id, id, route)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_delete_route(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
    route: HetznerRoute,
) -> Result<HetznerAction, String> {
    state
        .lock()
        .await
        .delete_route(&connection_id, id, route)
        .await
        .map_err(|e| e.to_string())
}

// ── Firewalls ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn hetzner_list_firewalls(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
) -> Result<Vec<HetznerFirewall>, String> {
    state
        .lock()
        .await
        .list_firewalls(&connection_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_get_firewall(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
) -> Result<HetznerFirewall, String> {
    state
        .lock()
        .await
        .get_firewall(&connection_id, id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_create_firewall(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    request: CreateFirewallRequest,
) -> Result<HetznerFirewall, String> {
    state
        .lock()
        .await
        .create_firewall(&connection_id, request)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_update_firewall(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
    name: Option<String>,
    labels: Option<serde_json::Value>,
) -> Result<HetznerFirewall, String> {
    state
        .lock()
        .await
        .update_firewall(&connection_id, id, name, labels)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_delete_firewall(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
) -> Result<(), String> {
    state
        .lock()
        .await
        .delete_firewall(&connection_id, id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_set_firewall_rules(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
    rules: Vec<HetznerFirewallRule>,
) -> Result<Vec<HetznerAction>, String> {
    state
        .lock()
        .await
        .set_firewall_rules(&connection_id, id, rules)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_apply_firewall(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
    apply_to: Vec<HetznerFirewallAppliedTo>,
) -> Result<Vec<HetznerAction>, String> {
    state
        .lock()
        .await
        .apply_firewall(&connection_id, id, apply_to)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_remove_firewall(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
    remove_from: Vec<HetznerFirewallAppliedTo>,
) -> Result<Vec<HetznerAction>, String> {
    state
        .lock()
        .await
        .remove_firewall(&connection_id, id, remove_from)
        .await
        .map_err(|e| e.to_string())
}

// ── Floating IPs ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn hetzner_list_floating_ips(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
) -> Result<Vec<HetznerFloatingIp>, String> {
    state
        .lock()
        .await
        .list_floating_ips(&connection_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_get_floating_ip(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
) -> Result<HetznerFloatingIp, String> {
    state
        .lock()
        .await
        .get_floating_ip(&connection_id, id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_create_floating_ip(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    request: CreateFloatingIpRequest,
) -> Result<HetznerFloatingIp, String> {
    state
        .lock()
        .await
        .create_floating_ip(&connection_id, request)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_delete_floating_ip(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
) -> Result<(), String> {
    state
        .lock()
        .await
        .delete_floating_ip(&connection_id, id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_assign_floating_ip(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
    server: u64,
) -> Result<HetznerAction, String> {
    state
        .lock()
        .await
        .assign_floating_ip(&connection_id, id, server)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_unassign_floating_ip(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
) -> Result<HetznerAction, String> {
    state
        .lock()
        .await
        .unassign_floating_ip(&connection_id, id)
        .await
        .map_err(|e| e.to_string())
}

// ── Volumes ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn hetzner_list_volumes(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
) -> Result<Vec<HetznerVolume>, String> {
    state
        .lock()
        .await
        .list_volumes(&connection_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_get_volume(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
) -> Result<HetznerVolume, String> {
    state
        .lock()
        .await
        .get_volume(&connection_id, id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_create_volume(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    request: CreateVolumeRequest,
) -> Result<(HetznerVolume, HetznerAction), String> {
    state
        .lock()
        .await
        .create_volume(&connection_id, request)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_delete_volume(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
) -> Result<(), String> {
    state
        .lock()
        .await
        .delete_volume(&connection_id, id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_attach_volume(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
    server: u64,
    automount: Option<bool>,
) -> Result<HetznerAction, String> {
    state
        .lock()
        .await
        .attach_volume(&connection_id, id, server, automount)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_detach_volume(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
) -> Result<HetznerAction, String> {
    state
        .lock()
        .await
        .detach_volume(&connection_id, id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_resize_volume(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
    size: u64,
) -> Result<HetznerAction, String> {
    state
        .lock()
        .await
        .resize_volume(&connection_id, id, size)
        .await
        .map_err(|e| e.to_string())
}

// ── Load Balancers ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn hetzner_list_load_balancers(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
) -> Result<Vec<HetznerLoadBalancer>, String> {
    state
        .lock()
        .await
        .list_load_balancers(&connection_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_get_load_balancer(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
) -> Result<HetznerLoadBalancer, String> {
    state
        .lock()
        .await
        .get_load_balancer(&connection_id, id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_create_load_balancer(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    request: serde_json::Value,
) -> Result<HetznerLoadBalancer, String> {
    state
        .lock()
        .await
        .create_load_balancer(&connection_id, request)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_delete_load_balancer(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
) -> Result<(), String> {
    state
        .lock()
        .await
        .delete_load_balancer(&connection_id, id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_add_lb_service(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
    service: HetznerLbService,
) -> Result<HetznerAction, String> {
    state
        .lock()
        .await
        .add_lb_service(&connection_id, id, service)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_update_lb_service(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
    service: HetznerLbService,
) -> Result<HetznerAction, String> {
    state
        .lock()
        .await
        .update_lb_service(&connection_id, id, service)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_delete_lb_service(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
    listen_port: u16,
) -> Result<HetznerAction, String> {
    state
        .lock()
        .await
        .delete_lb_service(&connection_id, id, listen_port)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_add_lb_target(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
    target: HetznerLbTarget,
) -> Result<HetznerAction, String> {
    state
        .lock()
        .await
        .add_lb_target(&connection_id, id, target)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_remove_lb_target(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
    target: HetznerLbTarget,
) -> Result<HetznerAction, String> {
    state
        .lock()
        .await
        .remove_lb_target(&connection_id, id, target)
        .await
        .map_err(|e| e.to_string())
}

// ── Images ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn hetzner_list_images(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
) -> Result<Vec<HetznerImage>, String> {
    state
        .lock()
        .await
        .list_images(&connection_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_get_image(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
) -> Result<HetznerImage, String> {
    state
        .lock()
        .await
        .get_image(&connection_id, id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_update_image(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
    description: Option<String>,
    labels: Option<serde_json::Value>,
) -> Result<HetznerImage, String> {
    state
        .lock()
        .await
        .update_image(&connection_id, id, description, labels)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_delete_image(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
) -> Result<(), String> {
    state
        .lock()
        .await
        .delete_image(&connection_id, id)
        .await
        .map_err(|e| e.to_string())
}

// ── SSH Keys ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn hetzner_list_ssh_keys(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
) -> Result<Vec<HetznerSshKey>, String> {
    state
        .lock()
        .await
        .list_ssh_keys(&connection_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_get_ssh_key(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
) -> Result<HetznerSshKey, String> {
    state
        .lock()
        .await
        .get_ssh_key(&connection_id, id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_create_ssh_key(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    request: CreateSshKeyRequest,
) -> Result<HetznerSshKey, String> {
    state
        .lock()
        .await
        .create_ssh_key(&connection_id, request)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_update_ssh_key(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
    name: Option<String>,
    labels: Option<serde_json::Value>,
) -> Result<HetznerSshKey, String> {
    state
        .lock()
        .await
        .update_ssh_key(&connection_id, id, name, labels)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_delete_ssh_key(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
) -> Result<(), String> {
    state
        .lock()
        .await
        .delete_ssh_key(&connection_id, id)
        .await
        .map_err(|e| e.to_string())
}

// ── Certificates ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn hetzner_list_certificates(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
) -> Result<Vec<HetznerCertificate>, String> {
    state
        .lock()
        .await
        .list_certificates(&connection_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_get_certificate(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
) -> Result<HetznerCertificate, String> {
    state
        .lock()
        .await
        .get_certificate(&connection_id, id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_create_certificate(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    request: CreateCertificateRequest,
) -> Result<HetznerCertificate, String> {
    state
        .lock()
        .await
        .create_certificate(&connection_id, request)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_update_certificate(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
    name: Option<String>,
    labels: Option<serde_json::Value>,
) -> Result<HetznerCertificate, String> {
    state
        .lock()
        .await
        .update_certificate(&connection_id, id, name, labels)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_delete_certificate(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
) -> Result<(), String> {
    state
        .lock()
        .await
        .delete_certificate(&connection_id, id)
        .await
        .map_err(|e| e.to_string())
}

// ── Actions ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn hetzner_list_actions(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
) -> Result<Vec<HetznerAction>, String> {
    state
        .lock()
        .await
        .list_actions(&connection_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hetzner_get_action(
    state: State<'_, HetznerServiceState>,
    connection_id: String,
    id: u64,
) -> Result<HetznerAction, String> {
    state
        .lock()
        .await
        .get_action(&connection_id, id)
        .await
        .map_err(|e| e.to_string())
}
