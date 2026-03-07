// ── sorng-netbox/src/commands.rs ─────────────────────────────────────────────
//! Tauri command wrappers for NetBox IPAM/DCIM management.

use tauri::State;

use crate::service::NetboxServiceState;
use crate::types::*;

type CmdResult<T> = Result<T, String>;
fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Convert owned key-value pairs to borrowed slices for the service layer.
fn to_params(v: &[(String, String)]) -> Vec<(&str, &str)> {
    v.iter().map(|(k, val)| (k.as_str(), val.as_str())).collect()
}

// ── Connection lifecycle ─────────────────────────────────────

#[tauri::command]
pub async fn netbox_connect(
    state: State<'_, NetboxServiceState>,
    id: String,
    config: NetboxConnectionConfig,
) -> CmdResult<String> {
    state.lock().await.connect(id, config).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_disconnect(
    state: State<'_, NetboxServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.disconnect(&id).map_err(map_err)
}

#[tauri::command]
pub async fn netbox_list_connections(
    state: State<'_, NetboxServiceState>,
) -> CmdResult<Vec<String>> {
    Ok(state.lock().await.list_connections())
}

#[tauri::command]
pub async fn netbox_ping(
    state: State<'_, NetboxServiceState>,
    id: String,
) -> CmdResult<NetboxConnectionSummary> {
    state.lock().await.ping(&id).await.map_err(map_err)
}

// ── Sites ────────────────────────────────────────────────────

#[tauri::command]
pub async fn netbox_list_sites(
    state: State<'_, NetboxServiceState>,
    id: String,
    params: Vec<(String, String)>,
) -> CmdResult<PaginatedResponse<Site>> {
    state.lock().await.list_sites(&id, &to_params(&params)).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_get_site(
    state: State<'_, NetboxServiceState>,
    id: String,
    site_id: i64,
) -> CmdResult<Site> {
    state.lock().await.get_site(&id, site_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_create_site(
    state: State<'_, NetboxServiceState>,
    id: String,
    data: serde_json::Value,
) -> CmdResult<Site> {
    state.lock().await.create_site(&id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_update_site(
    state: State<'_, NetboxServiceState>,
    id: String,
    site_id: i64,
    data: serde_json::Value,
) -> CmdResult<Site> {
    state.lock().await.update_site(&id, site_id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_partial_update_site(
    state: State<'_, NetboxServiceState>,
    id: String,
    site_id: i64,
    data: serde_json::Value,
) -> CmdResult<Site> {
    state.lock().await.partial_update_site(&id, site_id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_delete_site(
    state: State<'_, NetboxServiceState>,
    id: String,
    site_id: i64,
) -> CmdResult<()> {
    state.lock().await.delete_site(&id, site_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_list_sites_by_region(
    state: State<'_, NetboxServiceState>,
    id: String,
    region: String,
) -> CmdResult<PaginatedResponse<Site>> {
    state.lock().await.list_sites_by_region(&id, &region).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_list_sites_by_group(
    state: State<'_, NetboxServiceState>,
    id: String,
    group: String,
) -> CmdResult<PaginatedResponse<Site>> {
    state.lock().await.list_sites_by_group(&id, &group).await.map_err(map_err)
}

// ── Racks ────────────────────────────────────────────────────

#[tauri::command]
pub async fn netbox_list_racks(
    state: State<'_, NetboxServiceState>,
    id: String,
    site_id: Option<i64>,
) -> CmdResult<PaginatedResponse<Rack>> {
    state.lock().await.list_racks(&id, site_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_get_rack(
    state: State<'_, NetboxServiceState>,
    id: String,
    rack_id: i64,
) -> CmdResult<Rack> {
    state.lock().await.get_rack(&id, rack_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_create_rack(
    state: State<'_, NetboxServiceState>,
    id: String,
    data: serde_json::Value,
) -> CmdResult<Rack> {
    state.lock().await.create_rack(&id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_update_rack(
    state: State<'_, NetboxServiceState>,
    id: String,
    rack_id: i64,
    data: serde_json::Value,
) -> CmdResult<Rack> {
    state.lock().await.update_rack(&id, rack_id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_partial_update_rack(
    state: State<'_, NetboxServiceState>,
    id: String,
    rack_id: i64,
    data: serde_json::Value,
) -> CmdResult<Rack> {
    state.lock().await.partial_update_rack(&id, rack_id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_delete_rack(
    state: State<'_, NetboxServiceState>,
    id: String,
    rack_id: i64,
) -> CmdResult<()> {
    state.lock().await.delete_rack(&id, rack_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_get_rack_elevation(
    state: State<'_, NetboxServiceState>,
    id: String,
    rack_id: i64,
) -> CmdResult<Vec<RackUnit>> {
    state.lock().await.get_rack_elevation(&id, rack_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_list_rack_reservations(
    state: State<'_, NetboxServiceState>,
    id: String,
    rack_id: i64,
) -> CmdResult<PaginatedResponse<RackReservation>> {
    state.lock().await.list_rack_reservations(&id, rack_id).await.map_err(map_err)
}

// ── Devices ──────────────────────────────────────────────────

#[tauri::command]
pub async fn netbox_list_devices(
    state: State<'_, NetboxServiceState>,
    id: String,
    params: Vec<(String, String)>,
) -> CmdResult<PaginatedResponse<Device>> {
    state.lock().await.list_devices(&id, &to_params(&params)).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_get_device(
    state: State<'_, NetboxServiceState>,
    id: String,
    device_id: i64,
) -> CmdResult<Device> {
    state.lock().await.get_device(&id, device_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_create_device(
    state: State<'_, NetboxServiceState>,
    id: String,
    data: serde_json::Value,
) -> CmdResult<Device> {
    state.lock().await.create_device(&id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_update_device(
    state: State<'_, NetboxServiceState>,
    id: String,
    device_id: i64,
    data: serde_json::Value,
) -> CmdResult<Device> {
    state.lock().await.update_device(&id, device_id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_partial_update_device(
    state: State<'_, NetboxServiceState>,
    id: String,
    device_id: i64,
    data: serde_json::Value,
) -> CmdResult<Device> {
    state.lock().await.partial_update_device(&id, device_id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_delete_device(
    state: State<'_, NetboxServiceState>,
    id: String,
    device_id: i64,
) -> CmdResult<()> {
    state.lock().await.delete_device(&id, device_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_list_devices_by_site(
    state: State<'_, NetboxServiceState>,
    id: String,
    site_id: i64,
) -> CmdResult<PaginatedResponse<Device>> {
    state.lock().await.list_devices_by_site(&id, site_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_list_devices_by_rack(
    state: State<'_, NetboxServiceState>,
    id: String,
    rack_id: i64,
) -> CmdResult<PaginatedResponse<Device>> {
    state.lock().await.list_devices_by_rack(&id, rack_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_list_device_types(
    state: State<'_, NetboxServiceState>,
    id: String,
) -> CmdResult<PaginatedResponse<DeviceType>> {
    state.lock().await.list_device_types(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_get_device_type(
    state: State<'_, NetboxServiceState>,
    id: String,
    type_id: i64,
) -> CmdResult<DeviceType> {
    state.lock().await.get_device_type(&id, type_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_list_manufacturers(
    state: State<'_, NetboxServiceState>,
    id: String,
) -> CmdResult<PaginatedResponse<Manufacturer>> {
    state.lock().await.list_manufacturers(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_get_manufacturer(
    state: State<'_, NetboxServiceState>,
    id: String,
    mfg_id: i64,
) -> CmdResult<Manufacturer> {
    state.lock().await.get_manufacturer(&id, mfg_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_list_platforms(
    state: State<'_, NetboxServiceState>,
    id: String,
) -> CmdResult<PaginatedResponse<Platform>> {
    state.lock().await.list_platforms(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_get_platform(
    state: State<'_, NetboxServiceState>,
    id: String,
    platform_id: i64,
) -> CmdResult<Platform> {
    state.lock().await.get_platform(&id, platform_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_list_device_roles(
    state: State<'_, NetboxServiceState>,
    id: String,
) -> CmdResult<PaginatedResponse<DeviceRole>> {
    state.lock().await.list_device_roles(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_get_device_role(
    state: State<'_, NetboxServiceState>,
    id: String,
    role_id: i64,
) -> CmdResult<DeviceRole> {
    state.lock().await.get_device_role(&id, role_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_render_device_config(
    state: State<'_, NetboxServiceState>,
    id: String,
    device_id: i64,
) -> CmdResult<serde_json::Value> {
    state.lock().await.render_device_config(&id, device_id).await.map_err(map_err)
}

// ── Interfaces ───────────────────────────────────────────────

#[tauri::command]
pub async fn netbox_list_interfaces(
    state: State<'_, NetboxServiceState>,
    id: String,
    device_id: Option<i64>,
) -> CmdResult<PaginatedResponse<Interface>> {
    state.lock().await.list_interfaces(&id, device_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_get_interface(
    state: State<'_, NetboxServiceState>,
    id: String,
    iface_id: i64,
) -> CmdResult<Interface> {
    state.lock().await.get_interface(&id, iface_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_create_interface(
    state: State<'_, NetboxServiceState>,
    id: String,
    data: serde_json::Value,
) -> CmdResult<Interface> {
    state.lock().await.create_interface(&id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_update_interface(
    state: State<'_, NetboxServiceState>,
    id: String,
    iface_id: i64,
    data: serde_json::Value,
) -> CmdResult<Interface> {
    state.lock().await.update_interface(&id, iface_id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_partial_update_interface(
    state: State<'_, NetboxServiceState>,
    id: String,
    iface_id: i64,
    data: serde_json::Value,
) -> CmdResult<Interface> {
    state.lock().await.partial_update_interface(&id, iface_id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_delete_interface(
    state: State<'_, NetboxServiceState>,
    id: String,
    iface_id: i64,
) -> CmdResult<()> {
    state.lock().await.delete_interface(&id, iface_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_list_interface_connections(
    state: State<'_, NetboxServiceState>,
    id: String,
) -> CmdResult<PaginatedResponse<InterfaceConnection>> {
    state.lock().await.list_interface_connections(&id).await.map_err(map_err)
}

// ── IPAM ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn netbox_list_ip_addresses(
    state: State<'_, NetboxServiceState>,
    id: String,
    params: Vec<(String, String)>,
) -> CmdResult<PaginatedResponse<IpAddress>> {
    state.lock().await.list_ip_addresses(&id, &to_params(&params)).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_get_ip_address(
    state: State<'_, NetboxServiceState>,
    id: String,
    addr_id: i64,
) -> CmdResult<IpAddress> {
    state.lock().await.get_ip_address(&id, addr_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_create_ip_address(
    state: State<'_, NetboxServiceState>,
    id: String,
    data: serde_json::Value,
) -> CmdResult<IpAddress> {
    state.lock().await.create_ip_address(&id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_update_ip_address(
    state: State<'_, NetboxServiceState>,
    id: String,
    addr_id: i64,
    data: serde_json::Value,
) -> CmdResult<IpAddress> {
    state.lock().await.update_ip_address(&id, addr_id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_delete_ip_address(
    state: State<'_, NetboxServiceState>,
    id: String,
    addr_id: i64,
) -> CmdResult<()> {
    state.lock().await.delete_ip_address(&id, addr_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_list_prefixes(
    state: State<'_, NetboxServiceState>,
    id: String,
    params: Vec<(String, String)>,
) -> CmdResult<PaginatedResponse<Prefix>> {
    state.lock().await.list_prefixes(&id, &to_params(&params)).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_get_prefix(
    state: State<'_, NetboxServiceState>,
    id: String,
    prefix_id: i64,
) -> CmdResult<Prefix> {
    state.lock().await.get_prefix(&id, prefix_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_create_prefix(
    state: State<'_, NetboxServiceState>,
    id: String,
    data: serde_json::Value,
) -> CmdResult<Prefix> {
    state.lock().await.create_prefix(&id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_update_prefix(
    state: State<'_, NetboxServiceState>,
    id: String,
    prefix_id: i64,
    data: serde_json::Value,
) -> CmdResult<Prefix> {
    state.lock().await.update_prefix(&id, prefix_id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_delete_prefix(
    state: State<'_, NetboxServiceState>,
    id: String,
    prefix_id: i64,
) -> CmdResult<()> {
    state.lock().await.delete_prefix(&id, prefix_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_get_available_ips(
    state: State<'_, NetboxServiceState>,
    id: String,
    prefix_id: i64,
) -> CmdResult<Vec<IpAddress>> {
    state.lock().await.get_available_ips(&id, prefix_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_create_available_ip(
    state: State<'_, NetboxServiceState>,
    id: String,
    prefix_id: i64,
    data: serde_json::Value,
) -> CmdResult<IpAddress> {
    state.lock().await.create_available_ip(&id, prefix_id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_get_available_prefixes(
    state: State<'_, NetboxServiceState>,
    id: String,
    prefix_id: i64,
) -> CmdResult<Vec<Prefix>> {
    state.lock().await.get_available_prefixes(&id, prefix_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_list_vrfs(
    state: State<'_, NetboxServiceState>,
    id: String,
) -> CmdResult<PaginatedResponse<Vrf>> {
    state.lock().await.list_vrfs(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_get_vrf(
    state: State<'_, NetboxServiceState>,
    id: String,
    vrf_id: i64,
) -> CmdResult<Vrf> {
    state.lock().await.get_vrf(&id, vrf_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_create_vrf(
    state: State<'_, NetboxServiceState>,
    id: String,
    data: serde_json::Value,
) -> CmdResult<Vrf> {
    state.lock().await.create_vrf(&id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_update_vrf(
    state: State<'_, NetboxServiceState>,
    id: String,
    vrf_id: i64,
    data: serde_json::Value,
) -> CmdResult<Vrf> {
    state.lock().await.update_vrf(&id, vrf_id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_delete_vrf(
    state: State<'_, NetboxServiceState>,
    id: String,
    vrf_id: i64,
) -> CmdResult<()> {
    state.lock().await.delete_vrf(&id, vrf_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_list_aggregates(
    state: State<'_, NetboxServiceState>,
    id: String,
) -> CmdResult<PaginatedResponse<Aggregate>> {
    state.lock().await.list_aggregates(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_get_aggregate(
    state: State<'_, NetboxServiceState>,
    id: String,
    agg_id: i64,
) -> CmdResult<Aggregate> {
    state.lock().await.get_aggregate(&id, agg_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_list_rirs(
    state: State<'_, NetboxServiceState>,
    id: String,
) -> CmdResult<PaginatedResponse<Rir>> {
    state.lock().await.list_rirs(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_get_rir(
    state: State<'_, NetboxServiceState>,
    id: String,
    rir_id: i64,
) -> CmdResult<Rir> {
    state.lock().await.get_rir(&id, rir_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_list_ipam_roles(
    state: State<'_, NetboxServiceState>,
    id: String,
) -> CmdResult<PaginatedResponse<IpamRole>> {
    state.lock().await.list_ipam_roles(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_get_ipam_role(
    state: State<'_, NetboxServiceState>,
    id: String,
    role_id: i64,
) -> CmdResult<IpamRole> {
    state.lock().await.get_ipam_role(&id, role_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_list_services(
    state: State<'_, NetboxServiceState>,
    id: String,
    params: Vec<(String, String)>,
) -> CmdResult<PaginatedResponse<Service>> {
    state.lock().await.list_services(&id, &to_params(&params)).await.map_err(map_err)
}

// ── VLANs ────────────────────────────────────────────────────

#[tauri::command]
pub async fn netbox_list_vlans(
    state: State<'_, NetboxServiceState>,
    id: String,
    params: Vec<(String, String)>,
) -> CmdResult<PaginatedResponse<Vlan>> {
    state.lock().await.list_vlans(&id, &to_params(&params)).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_get_vlan(
    state: State<'_, NetboxServiceState>,
    id: String,
    vlan_id: i64,
) -> CmdResult<Vlan> {
    state.lock().await.get_vlan(&id, vlan_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_create_vlan(
    state: State<'_, NetboxServiceState>,
    id: String,
    data: serde_json::Value,
) -> CmdResult<Vlan> {
    state.lock().await.create_vlan(&id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_update_vlan(
    state: State<'_, NetboxServiceState>,
    id: String,
    vlan_id: i64,
    data: serde_json::Value,
) -> CmdResult<Vlan> {
    state.lock().await.update_vlan(&id, vlan_id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_partial_update_vlan(
    state: State<'_, NetboxServiceState>,
    id: String,
    vlan_id: i64,
    data: serde_json::Value,
) -> CmdResult<Vlan> {
    state.lock().await.partial_update_vlan(&id, vlan_id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_delete_vlan(
    state: State<'_, NetboxServiceState>,
    id: String,
    vlan_id: i64,
) -> CmdResult<()> {
    state.lock().await.delete_vlan(&id, vlan_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_list_vlans_by_site(
    state: State<'_, NetboxServiceState>,
    id: String,
    site_id: i64,
) -> CmdResult<PaginatedResponse<Vlan>> {
    state.lock().await.list_vlans_by_site(&id, site_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_list_vlans_by_group(
    state: State<'_, NetboxServiceState>,
    id: String,
    group_id: i64,
) -> CmdResult<PaginatedResponse<Vlan>> {
    state.lock().await.list_vlans_by_group(&id, group_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_list_vlan_groups(
    state: State<'_, NetboxServiceState>,
    id: String,
) -> CmdResult<PaginatedResponse<VlanGroup>> {
    state.lock().await.list_vlan_groups(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_get_vlan_group(
    state: State<'_, NetboxServiceState>,
    id: String,
    group_id: i64,
) -> CmdResult<VlanGroup> {
    state.lock().await.get_vlan_group(&id, group_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_create_vlan_group(
    state: State<'_, NetboxServiceState>,
    id: String,
    data: serde_json::Value,
) -> CmdResult<VlanGroup> {
    state.lock().await.create_vlan_group(&id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_update_vlan_group(
    state: State<'_, NetboxServiceState>,
    id: String,
    group_id: i64,
    data: serde_json::Value,
) -> CmdResult<VlanGroup> {
    state.lock().await.update_vlan_group(&id, group_id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_delete_vlan_group(
    state: State<'_, NetboxServiceState>,
    id: String,
    group_id: i64,
) -> CmdResult<()> {
    state.lock().await.delete_vlan_group(&id, group_id).await.map_err(map_err)
}

// ── Circuits ─────────────────────────────────────────────────

#[tauri::command]
pub async fn netbox_list_circuits(
    state: State<'_, NetboxServiceState>,
    id: String,
    params: Vec<(String, String)>,
) -> CmdResult<PaginatedResponse<Circuit>> {
    state.lock().await.list_circuits(&id, &to_params(&params)).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_get_circuit(
    state: State<'_, NetboxServiceState>,
    id: String,
    circuit_id: i64,
) -> CmdResult<Circuit> {
    state.lock().await.get_circuit(&id, circuit_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_create_circuit(
    state: State<'_, NetboxServiceState>,
    id: String,
    data: serde_json::Value,
) -> CmdResult<Circuit> {
    state.lock().await.create_circuit(&id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_update_circuit(
    state: State<'_, NetboxServiceState>,
    id: String,
    circuit_id: i64,
    data: serde_json::Value,
) -> CmdResult<Circuit> {
    state.lock().await.update_circuit(&id, circuit_id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_delete_circuit(
    state: State<'_, NetboxServiceState>,
    id: String,
    circuit_id: i64,
) -> CmdResult<()> {
    state.lock().await.delete_circuit(&id, circuit_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_list_circuit_providers(
    state: State<'_, NetboxServiceState>,
    id: String,
) -> CmdResult<PaginatedResponse<CircuitProvider>> {
    state.lock().await.list_circuit_providers(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_get_circuit_provider(
    state: State<'_, NetboxServiceState>,
    id: String,
    provider_id: i64,
) -> CmdResult<CircuitProvider> {
    state.lock().await.get_circuit_provider(&id, provider_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_create_circuit_provider(
    state: State<'_, NetboxServiceState>,
    id: String,
    data: serde_json::Value,
) -> CmdResult<CircuitProvider> {
    state.lock().await.create_circuit_provider(&id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_update_circuit_provider(
    state: State<'_, NetboxServiceState>,
    id: String,
    provider_id: i64,
    data: serde_json::Value,
) -> CmdResult<CircuitProvider> {
    state.lock().await.update_circuit_provider(&id, provider_id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_delete_circuit_provider(
    state: State<'_, NetboxServiceState>,
    id: String,
    provider_id: i64,
) -> CmdResult<()> {
    state.lock().await.delete_circuit_provider(&id, provider_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_list_circuit_types(
    state: State<'_, NetboxServiceState>,
    id: String,
) -> CmdResult<PaginatedResponse<CircuitType>> {
    state.lock().await.list_circuit_types(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_get_circuit_type(
    state: State<'_, NetboxServiceState>,
    id: String,
    type_id: i64,
) -> CmdResult<CircuitType> {
    state.lock().await.get_circuit_type(&id, type_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_list_circuit_terminations(
    state: State<'_, NetboxServiceState>,
    id: String,
    circuit_id: i64,
) -> CmdResult<PaginatedResponse<CircuitTermination>> {
    state.lock().await.list_circuit_terminations(&id, circuit_id).await.map_err(map_err)
}

// ── Cables ───────────────────────────────────────────────────

#[tauri::command]
pub async fn netbox_list_cables(
    state: State<'_, NetboxServiceState>,
    id: String,
    params: Vec<(String, String)>,
) -> CmdResult<PaginatedResponse<Cable>> {
    state.lock().await.list_cables(&id, &to_params(&params)).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_get_cable(
    state: State<'_, NetboxServiceState>,
    id: String,
    cable_id: i64,
) -> CmdResult<Cable> {
    state.lock().await.get_cable(&id, cable_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_create_cable(
    state: State<'_, NetboxServiceState>,
    id: String,
    data: serde_json::Value,
) -> CmdResult<Cable> {
    state.lock().await.create_cable(&id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_update_cable(
    state: State<'_, NetboxServiceState>,
    id: String,
    cable_id: i64,
    data: serde_json::Value,
) -> CmdResult<Cable> {
    state.lock().await.update_cable(&id, cable_id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_delete_cable(
    state: State<'_, NetboxServiceState>,
    id: String,
    cable_id: i64,
) -> CmdResult<()> {
    state.lock().await.delete_cable(&id, cable_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_trace_cable(
    state: State<'_, NetboxServiceState>,
    id: String,
    cable_id: i64,
) -> CmdResult<Vec<CableTrace>> {
    state.lock().await.trace_cable(&id, cable_id).await.map_err(map_err)
}

// ── Tenants ──────────────────────────────────────────────────

#[tauri::command]
pub async fn netbox_list_tenants(
    state: State<'_, NetboxServiceState>,
    id: String,
    params: Vec<(String, String)>,
) -> CmdResult<PaginatedResponse<Tenant>> {
    state.lock().await.list_tenants(&id, &to_params(&params)).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_get_tenant(
    state: State<'_, NetboxServiceState>,
    id: String,
    tenant_id: i64,
) -> CmdResult<Tenant> {
    state.lock().await.get_tenant(&id, tenant_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_create_tenant(
    state: State<'_, NetboxServiceState>,
    id: String,
    data: serde_json::Value,
) -> CmdResult<Tenant> {
    state.lock().await.create_tenant(&id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_update_tenant(
    state: State<'_, NetboxServiceState>,
    id: String,
    tenant_id: i64,
    data: serde_json::Value,
) -> CmdResult<Tenant> {
    state.lock().await.update_tenant(&id, tenant_id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_partial_update_tenant(
    state: State<'_, NetboxServiceState>,
    id: String,
    tenant_id: i64,
    data: serde_json::Value,
) -> CmdResult<Tenant> {
    state.lock().await.partial_update_tenant(&id, tenant_id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_delete_tenant(
    state: State<'_, NetboxServiceState>,
    id: String,
    tenant_id: i64,
) -> CmdResult<()> {
    state.lock().await.delete_tenant(&id, tenant_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_list_tenant_groups(
    state: State<'_, NetboxServiceState>,
    id: String,
) -> CmdResult<PaginatedResponse<TenantGroup>> {
    state.lock().await.list_tenant_groups(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_get_tenant_group(
    state: State<'_, NetboxServiceState>,
    id: String,
    group_id: i64,
) -> CmdResult<TenantGroup> {
    state.lock().await.get_tenant_group(&id, group_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_create_tenant_group(
    state: State<'_, NetboxServiceState>,
    id: String,
    data: serde_json::Value,
) -> CmdResult<TenantGroup> {
    state.lock().await.create_tenant_group(&id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_update_tenant_group(
    state: State<'_, NetboxServiceState>,
    id: String,
    group_id: i64,
    data: serde_json::Value,
) -> CmdResult<TenantGroup> {
    state.lock().await.update_tenant_group(&id, group_id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_delete_tenant_group(
    state: State<'_, NetboxServiceState>,
    id: String,
    group_id: i64,
) -> CmdResult<()> {
    state.lock().await.delete_tenant_group(&id, group_id).await.map_err(map_err)
}

// ── Contacts ─────────────────────────────────────────────────

#[tauri::command]
pub async fn netbox_list_contacts(
    state: State<'_, NetboxServiceState>,
    id: String,
    params: Vec<(String, String)>,
) -> CmdResult<PaginatedResponse<Contact>> {
    state.lock().await.list_contacts(&id, &to_params(&params)).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_get_contact(
    state: State<'_, NetboxServiceState>,
    id: String,
    contact_id: i64,
) -> CmdResult<Contact> {
    state.lock().await.get_contact(&id, contact_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_create_contact(
    state: State<'_, NetboxServiceState>,
    id: String,
    data: serde_json::Value,
) -> CmdResult<Contact> {
    state.lock().await.create_contact(&id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_update_contact(
    state: State<'_, NetboxServiceState>,
    id: String,
    contact_id: i64,
    data: serde_json::Value,
) -> CmdResult<Contact> {
    state.lock().await.update_contact(&id, contact_id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_partial_update_contact(
    state: State<'_, NetboxServiceState>,
    id: String,
    contact_id: i64,
    data: serde_json::Value,
) -> CmdResult<Contact> {
    state.lock().await.partial_update_contact(&id, contact_id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_delete_contact(
    state: State<'_, NetboxServiceState>,
    id: String,
    contact_id: i64,
) -> CmdResult<()> {
    state.lock().await.delete_contact(&id, contact_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_list_contact_groups(
    state: State<'_, NetboxServiceState>,
    id: String,
) -> CmdResult<PaginatedResponse<ContactGroup>> {
    state.lock().await.list_contact_groups(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_get_contact_group(
    state: State<'_, NetboxServiceState>,
    id: String,
    group_id: i64,
) -> CmdResult<ContactGroup> {
    state.lock().await.get_contact_group(&id, group_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_create_contact_group(
    state: State<'_, NetboxServiceState>,
    id: String,
    data: serde_json::Value,
) -> CmdResult<ContactGroup> {
    state.lock().await.create_contact_group(&id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_update_contact_group(
    state: State<'_, NetboxServiceState>,
    id: String,
    group_id: i64,
    data: serde_json::Value,
) -> CmdResult<ContactGroup> {
    state.lock().await.update_contact_group(&id, group_id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_delete_contact_group(
    state: State<'_, NetboxServiceState>,
    id: String,
    group_id: i64,
) -> CmdResult<()> {
    state.lock().await.delete_contact_group(&id, group_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_list_contact_roles(
    state: State<'_, NetboxServiceState>,
    id: String,
) -> CmdResult<PaginatedResponse<ContactRole>> {
    state.lock().await.list_contact_roles(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_list_contact_assignments(
    state: State<'_, NetboxServiceState>,
    id: String,
) -> CmdResult<PaginatedResponse<ContactAssignment>> {
    state.lock().await.list_contact_assignments(&id).await.map_err(map_err)
}

// ── Virtualization ───────────────────────────────────────────

#[tauri::command]
pub async fn netbox_list_vms(
    state: State<'_, NetboxServiceState>,
    id: String,
    params: Vec<(String, String)>,
) -> CmdResult<PaginatedResponse<VirtualMachine>> {
    state.lock().await.list_vms(&id, &to_params(&params)).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_get_vm(
    state: State<'_, NetboxServiceState>,
    id: String,
    vm_id: i64,
) -> CmdResult<VirtualMachine> {
    state.lock().await.get_vm(&id, vm_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_create_vm(
    state: State<'_, NetboxServiceState>,
    id: String,
    data: serde_json::Value,
) -> CmdResult<VirtualMachine> {
    state.lock().await.create_vm(&id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_update_vm(
    state: State<'_, NetboxServiceState>,
    id: String,
    vm_id: i64,
    data: serde_json::Value,
) -> CmdResult<VirtualMachine> {
    state.lock().await.update_vm(&id, vm_id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_delete_vm(
    state: State<'_, NetboxServiceState>,
    id: String,
    vm_id: i64,
) -> CmdResult<()> {
    state.lock().await.delete_vm(&id, vm_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_list_vm_interfaces(
    state: State<'_, NetboxServiceState>,
    id: String,
    vm_id: i64,
) -> CmdResult<PaginatedResponse<VmInterface>> {
    state.lock().await.list_vm_interfaces(&id, vm_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_create_vm_interface(
    state: State<'_, NetboxServiceState>,
    id: String,
    data: serde_json::Value,
) -> CmdResult<VmInterface> {
    state.lock().await.create_vm_interface(&id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_update_vm_interface(
    state: State<'_, NetboxServiceState>,
    id: String,
    iface_id: i64,
    data: serde_json::Value,
) -> CmdResult<VmInterface> {
    state.lock().await.update_vm_interface(&id, iface_id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_delete_vm_interface(
    state: State<'_, NetboxServiceState>,
    id: String,
    iface_id: i64,
) -> CmdResult<()> {
    state.lock().await.delete_vm_interface(&id, iface_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_list_clusters(
    state: State<'_, NetboxServiceState>,
    id: String,
) -> CmdResult<PaginatedResponse<Cluster>> {
    state.lock().await.list_clusters(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_get_cluster(
    state: State<'_, NetboxServiceState>,
    id: String,
    cluster_id: i64,
) -> CmdResult<Cluster> {
    state.lock().await.get_cluster(&id, cluster_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_create_cluster(
    state: State<'_, NetboxServiceState>,
    id: String,
    data: serde_json::Value,
) -> CmdResult<Cluster> {
    state.lock().await.create_cluster(&id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_update_cluster(
    state: State<'_, NetboxServiceState>,
    id: String,
    cluster_id: i64,
    data: serde_json::Value,
) -> CmdResult<Cluster> {
    state.lock().await.update_cluster(&id, cluster_id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_delete_cluster(
    state: State<'_, NetboxServiceState>,
    id: String,
    cluster_id: i64,
) -> CmdResult<()> {
    state.lock().await.delete_cluster(&id, cluster_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_list_cluster_types(
    state: State<'_, NetboxServiceState>,
    id: String,
) -> CmdResult<PaginatedResponse<ClusterType>> {
    state.lock().await.list_cluster_types(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_get_cluster_type(
    state: State<'_, NetboxServiceState>,
    id: String,
    type_id: i64,
) -> CmdResult<ClusterType> {
    state.lock().await.get_cluster_type(&id, type_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_create_cluster_type(
    state: State<'_, NetboxServiceState>,
    id: String,
    data: serde_json::Value,
) -> CmdResult<ClusterType> {
    state.lock().await.create_cluster_type(&id, &data).await.map_err(map_err)
}

#[tauri::command]
pub async fn netbox_list_cluster_groups(
    state: State<'_, NetboxServiceState>,
    id: String,
) -> CmdResult<PaginatedResponse<ClusterGroup>> {
    state.lock().await.list_cluster_groups(&id).await.map_err(map_err)
}
