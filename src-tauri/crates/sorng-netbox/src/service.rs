// ── sorng-netbox/src/service.rs ──────────────────────────────────────────────
//! Aggregate NetBox service – holds connections and delegates to domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::NetboxClient;
use crate::error::{NetboxError, NetboxResult};
use crate::types::*;

use crate::cables::CableManager;
use crate::circuits::CircuitManager;
use crate::contacts::ContactManager;
use crate::devices::DeviceManager;
use crate::interfaces::InterfaceManager;
use crate::ipam::IpamManager;
use crate::racks::RackManager;
use crate::sites::SiteManager;
use crate::tenants::TenantManager;
use crate::vlans::VlanManager;
use crate::virtualization::VirtualizationManager;

/// Shared Tauri state handle.
pub type NetboxServiceState = Arc<Mutex<NetboxService>>;

/// Main NetBox service managing connections.
pub struct NetboxService {
    connections: HashMap<String, NetboxClient>,
}

impl NetboxService {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    // ── Connection lifecycle ─────────────────────────────────────

    pub async fn connect(&mut self, id: String, config: NetboxConnectionConfig) -> NetboxResult<String> {
        let client = NetboxClient::new(config)?;
        let _summary = client.ping().await?;
        self.connections.insert(id.clone(), client);
        Ok(id)
    }

    pub fn disconnect(&mut self, id: &str) -> NetboxResult<()> {
        self.connections
            .remove(id)
            .map(|_| ())
            .ok_or_else(|| NetboxError::not_connected(format!("No connection '{id}'")))
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> NetboxResult<&NetboxClient> {
        self.connections
            .get(id)
            .ok_or_else(|| NetboxError::not_connected(format!("No connection '{id}'")))
    }

    pub async fn ping(&self, id: &str) -> NetboxResult<NetboxConnectionSummary> {
        self.client(id)?.ping().await
    }

    // ── Sites ────────────────────────────────────────────────────

    pub async fn list_sites(&self, id: &str, params: &[(&str, &str)]) -> NetboxResult<PaginatedResponse<Site>> {
        SiteManager::list(self.client(id)?, params).await
    }

    pub async fn get_site(&self, id: &str, site_id: i64) -> NetboxResult<Site> {
        SiteManager::get(self.client(id)?, site_id).await
    }

    pub async fn create_site(&self, id: &str, data: &serde_json::Value) -> NetboxResult<Site> {
        SiteManager::create(self.client(id)?, data).await
    }

    pub async fn update_site(&self, id: &str, site_id: i64, data: &serde_json::Value) -> NetboxResult<Site> {
        SiteManager::update(self.client(id)?, site_id, data).await
    }

    pub async fn partial_update_site(&self, id: &str, site_id: i64, data: &serde_json::Value) -> NetboxResult<Site> {
        SiteManager::partial_update(self.client(id)?, site_id, data).await
    }

    pub async fn delete_site(&self, id: &str, site_id: i64) -> NetboxResult<()> {
        SiteManager::delete(self.client(id)?, site_id).await
    }

    pub async fn list_sites_by_region(&self, id: &str, region: &str) -> NetboxResult<PaginatedResponse<Site>> {
        SiteManager::list_by_region(self.client(id)?, region).await
    }

    pub async fn list_sites_by_group(&self, id: &str, group: &str) -> NetboxResult<PaginatedResponse<Site>> {
        SiteManager::list_by_group(self.client(id)?, group).await
    }

    // ── Racks ────────────────────────────────────────────────────

    pub async fn list_racks(&self, id: &str, site_id: Option<i64>) -> NetboxResult<PaginatedResponse<Rack>> {
        RackManager::list(self.client(id)?, site_id).await
    }

    pub async fn get_rack(&self, id: &str, rack_id: i64) -> NetboxResult<Rack> {
        RackManager::get(self.client(id)?, rack_id).await
    }

    pub async fn create_rack(&self, id: &str, data: &serde_json::Value) -> NetboxResult<Rack> {
        RackManager::create(self.client(id)?, data).await
    }

    pub async fn update_rack(&self, id: &str, rack_id: i64, data: &serde_json::Value) -> NetboxResult<Rack> {
        RackManager::update(self.client(id)?, rack_id, data).await
    }

    pub async fn partial_update_rack(&self, id: &str, rack_id: i64, data: &serde_json::Value) -> NetboxResult<Rack> {
        RackManager::partial_update(self.client(id)?, rack_id, data).await
    }

    pub async fn delete_rack(&self, id: &str, rack_id: i64) -> NetboxResult<()> {
        RackManager::delete(self.client(id)?, rack_id).await
    }

    pub async fn get_rack_elevation(&self, id: &str, rack_id: i64) -> NetboxResult<Vec<RackUnit>> {
        RackManager::get_elevation(self.client(id)?, rack_id).await
    }

    pub async fn list_rack_reservations(&self, id: &str, rack_id: i64) -> NetboxResult<PaginatedResponse<RackReservation>> {
        RackManager::list_reservations(self.client(id)?, rack_id).await
    }

    // ── Devices ──────────────────────────────────────────────────

    pub async fn list_devices(&self, id: &str, params: &[(&str, &str)]) -> NetboxResult<PaginatedResponse<Device>> {
        DeviceManager::list(self.client(id)?, params).await
    }

    pub async fn get_device(&self, id: &str, device_id: i64) -> NetboxResult<Device> {
        DeviceManager::get(self.client(id)?, device_id).await
    }

    pub async fn create_device(&self, id: &str, data: &serde_json::Value) -> NetboxResult<Device> {
        DeviceManager::create(self.client(id)?, data).await
    }

    pub async fn update_device(&self, id: &str, device_id: i64, data: &serde_json::Value) -> NetboxResult<Device> {
        DeviceManager::update(self.client(id)?, device_id, data).await
    }

    pub async fn partial_update_device(&self, id: &str, device_id: i64, data: &serde_json::Value) -> NetboxResult<Device> {
        DeviceManager::partial_update(self.client(id)?, device_id, data).await
    }

    pub async fn delete_device(&self, id: &str, device_id: i64) -> NetboxResult<()> {
        DeviceManager::delete(self.client(id)?, device_id).await
    }

    pub async fn list_devices_by_site(&self, id: &str, site_id: i64) -> NetboxResult<PaginatedResponse<Device>> {
        DeviceManager::list_by_site(self.client(id)?, site_id).await
    }

    pub async fn list_devices_by_rack(&self, id: &str, rack_id: i64) -> NetboxResult<PaginatedResponse<Device>> {
        DeviceManager::list_by_rack(self.client(id)?, rack_id).await
    }

    pub async fn list_device_types(&self, id: &str) -> NetboxResult<PaginatedResponse<DeviceType>> {
        DeviceManager::list_device_types(self.client(id)?).await
    }

    pub async fn get_device_type(&self, id: &str, type_id: i64) -> NetboxResult<DeviceType> {
        DeviceManager::get_device_type(self.client(id)?, type_id).await
    }

    pub async fn list_manufacturers(&self, id: &str) -> NetboxResult<PaginatedResponse<Manufacturer>> {
        DeviceManager::list_manufacturers(self.client(id)?).await
    }

    pub async fn get_manufacturer(&self, id: &str, mfg_id: i64) -> NetboxResult<Manufacturer> {
        DeviceManager::get_manufacturer(self.client(id)?, mfg_id).await
    }

    pub async fn list_platforms(&self, id: &str) -> NetboxResult<PaginatedResponse<Platform>> {
        DeviceManager::list_platforms(self.client(id)?).await
    }

    pub async fn get_platform(&self, id: &str, platform_id: i64) -> NetboxResult<Platform> {
        DeviceManager::get_platform(self.client(id)?, platform_id).await
    }

    pub async fn list_device_roles(&self, id: &str) -> NetboxResult<PaginatedResponse<DeviceRole>> {
        DeviceManager::list_device_roles(self.client(id)?).await
    }

    pub async fn get_device_role(&self, id: &str, role_id: i64) -> NetboxResult<DeviceRole> {
        DeviceManager::get_device_role(self.client(id)?, role_id).await
    }

    pub async fn render_device_config(&self, id: &str, device_id: i64) -> NetboxResult<serde_json::Value> {
        DeviceManager::render_config(self.client(id)?, device_id).await
    }

    // ── Interfaces ───────────────────────────────────────────────

    pub async fn list_interfaces(&self, id: &str, device_id: Option<i64>) -> NetboxResult<PaginatedResponse<Interface>> {
        InterfaceManager::list(self.client(id)?, device_id).await
    }

    pub async fn get_interface(&self, id: &str, iface_id: i64) -> NetboxResult<Interface> {
        InterfaceManager::get(self.client(id)?, iface_id).await
    }

    pub async fn create_interface(&self, id: &str, data: &serde_json::Value) -> NetboxResult<Interface> {
        InterfaceManager::create(self.client(id)?, data).await
    }

    pub async fn update_interface(&self, id: &str, iface_id: i64, data: &serde_json::Value) -> NetboxResult<Interface> {
        InterfaceManager::update(self.client(id)?, iface_id, data).await
    }

    pub async fn partial_update_interface(&self, id: &str, iface_id: i64, data: &serde_json::Value) -> NetboxResult<Interface> {
        InterfaceManager::partial_update(self.client(id)?, iface_id, data).await
    }

    pub async fn delete_interface(&self, id: &str, iface_id: i64) -> NetboxResult<()> {
        InterfaceManager::delete(self.client(id)?, iface_id).await
    }

    pub async fn list_interface_connections(&self, id: &str) -> NetboxResult<PaginatedResponse<InterfaceConnection>> {
        InterfaceManager::list_connections(self.client(id)?).await
    }

    // ── IPAM ─────────────────────────────────────────────────────

    pub async fn list_ip_addresses(&self, id: &str, params: &[(&str, &str)]) -> NetboxResult<PaginatedResponse<IpAddress>> {
        IpamManager::list_addresses(self.client(id)?, params).await
    }

    pub async fn get_ip_address(&self, id: &str, addr_id: i64) -> NetboxResult<IpAddress> {
        IpamManager::get_address(self.client(id)?, addr_id).await
    }

    pub async fn create_ip_address(&self, id: &str, data: &serde_json::Value) -> NetboxResult<IpAddress> {
        IpamManager::create_address(self.client(id)?, data).await
    }

    pub async fn update_ip_address(&self, id: &str, addr_id: i64, data: &serde_json::Value) -> NetboxResult<IpAddress> {
        IpamManager::update_address(self.client(id)?, addr_id, data).await
    }

    pub async fn delete_ip_address(&self, id: &str, addr_id: i64) -> NetboxResult<()> {
        IpamManager::delete_address(self.client(id)?, addr_id).await
    }

    pub async fn list_prefixes(&self, id: &str, params: &[(&str, &str)]) -> NetboxResult<PaginatedResponse<Prefix>> {
        IpamManager::list_prefixes(self.client(id)?, params).await
    }

    pub async fn get_prefix(&self, id: &str, prefix_id: i64) -> NetboxResult<Prefix> {
        IpamManager::get_prefix(self.client(id)?, prefix_id).await
    }

    pub async fn create_prefix(&self, id: &str, data: &serde_json::Value) -> NetboxResult<Prefix> {
        IpamManager::create_prefix(self.client(id)?, data).await
    }

    pub async fn update_prefix(&self, id: &str, prefix_id: i64, data: &serde_json::Value) -> NetboxResult<Prefix> {
        IpamManager::update_prefix(self.client(id)?, prefix_id, data).await
    }

    pub async fn delete_prefix(&self, id: &str, prefix_id: i64) -> NetboxResult<()> {
        IpamManager::delete_prefix(self.client(id)?, prefix_id).await
    }

    pub async fn get_available_ips(&self, id: &str, prefix_id: i64) -> NetboxResult<Vec<IpAddress>> {
        IpamManager::get_available_ips(self.client(id)?, prefix_id).await
    }

    pub async fn create_available_ip(&self, id: &str, prefix_id: i64, data: &serde_json::Value) -> NetboxResult<IpAddress> {
        IpamManager::create_available_ip(self.client(id)?, prefix_id, data).await
    }

    pub async fn get_available_prefixes(&self, id: &str, prefix_id: i64) -> NetboxResult<Vec<Prefix>> {
        IpamManager::get_available_prefixes(self.client(id)?, prefix_id).await
    }

    pub async fn list_vrfs(&self, id: &str) -> NetboxResult<PaginatedResponse<Vrf>> {
        IpamManager::list_vrfs(self.client(id)?).await
    }

    pub async fn get_vrf(&self, id: &str, vrf_id: i64) -> NetboxResult<Vrf> {
        IpamManager::get_vrf(self.client(id)?, vrf_id).await
    }

    pub async fn create_vrf(&self, id: &str, data: &serde_json::Value) -> NetboxResult<Vrf> {
        IpamManager::create_vrf(self.client(id)?, data).await
    }

    pub async fn update_vrf(&self, id: &str, vrf_id: i64, data: &serde_json::Value) -> NetboxResult<Vrf> {
        IpamManager::update_vrf(self.client(id)?, vrf_id, data).await
    }

    pub async fn delete_vrf(&self, id: &str, vrf_id: i64) -> NetboxResult<()> {
        IpamManager::delete_vrf(self.client(id)?, vrf_id).await
    }

    pub async fn list_aggregates(&self, id: &str) -> NetboxResult<PaginatedResponse<Aggregate>> {
        IpamManager::list_aggregates(self.client(id)?).await
    }

    pub async fn get_aggregate(&self, id: &str, agg_id: i64) -> NetboxResult<Aggregate> {
        IpamManager::get_aggregate(self.client(id)?, agg_id).await
    }

    pub async fn list_rirs(&self, id: &str) -> NetboxResult<PaginatedResponse<Rir>> {
        IpamManager::list_rirs(self.client(id)?).await
    }

    pub async fn get_rir(&self, id: &str, rir_id: i64) -> NetboxResult<Rir> {
        IpamManager::get_rir(self.client(id)?, rir_id).await
    }

    pub async fn list_ipam_roles(&self, id: &str) -> NetboxResult<PaginatedResponse<IpamRole>> {
        IpamManager::list_roles(self.client(id)?).await
    }

    pub async fn get_ipam_role(&self, id: &str, role_id: i64) -> NetboxResult<IpamRole> {
        IpamManager::get_role(self.client(id)?, role_id).await
    }

    pub async fn list_services(&self, id: &str, params: &[(&str, &str)]) -> NetboxResult<PaginatedResponse<Service>> {
        IpamManager::list_services(self.client(id)?, params).await
    }

    // ── VLANs ────────────────────────────────────────────────────

    pub async fn list_vlans(&self, id: &str, params: &[(&str, &str)]) -> NetboxResult<PaginatedResponse<Vlan>> {
        VlanManager::list(self.client(id)?, params).await
    }

    pub async fn get_vlan(&self, id: &str, vlan_id: i64) -> NetboxResult<Vlan> {
        VlanManager::get(self.client(id)?, vlan_id).await
    }

    pub async fn create_vlan(&self, id: &str, data: &serde_json::Value) -> NetboxResult<Vlan> {
        VlanManager::create(self.client(id)?, data).await
    }

    pub async fn update_vlan(&self, id: &str, vlan_id: i64, data: &serde_json::Value) -> NetboxResult<Vlan> {
        VlanManager::update(self.client(id)?, vlan_id, data).await
    }

    pub async fn partial_update_vlan(&self, id: &str, vlan_id: i64, data: &serde_json::Value) -> NetboxResult<Vlan> {
        VlanManager::partial_update(self.client(id)?, vlan_id, data).await
    }

    pub async fn delete_vlan(&self, id: &str, vlan_id: i64) -> NetboxResult<()> {
        VlanManager::delete(self.client(id)?, vlan_id).await
    }

    pub async fn list_vlans_by_site(&self, id: &str, site_id: i64) -> NetboxResult<PaginatedResponse<Vlan>> {
        VlanManager::list_by_site(self.client(id)?, site_id).await
    }

    pub async fn list_vlans_by_group(&self, id: &str, group_id: i64) -> NetboxResult<PaginatedResponse<Vlan>> {
        VlanManager::list_by_group(self.client(id)?, group_id).await
    }

    pub async fn list_vlan_groups(&self, id: &str) -> NetboxResult<PaginatedResponse<VlanGroup>> {
        VlanManager::list_groups(self.client(id)?).await
    }

    pub async fn get_vlan_group(&self, id: &str, group_id: i64) -> NetboxResult<VlanGroup> {
        VlanManager::get_group(self.client(id)?, group_id).await
    }

    pub async fn create_vlan_group(&self, id: &str, data: &serde_json::Value) -> NetboxResult<VlanGroup> {
        VlanManager::create_group(self.client(id)?, data).await
    }

    pub async fn update_vlan_group(&self, id: &str, group_id: i64, data: &serde_json::Value) -> NetboxResult<VlanGroup> {
        VlanManager::update_group(self.client(id)?, group_id, data).await
    }

    pub async fn delete_vlan_group(&self, id: &str, group_id: i64) -> NetboxResult<()> {
        VlanManager::delete_group(self.client(id)?, group_id).await
    }

    // ── Circuits ─────────────────────────────────────────────────

    pub async fn list_circuits(&self, id: &str, params: &[(&str, &str)]) -> NetboxResult<PaginatedResponse<Circuit>> {
        CircuitManager::list(self.client(id)?, params).await
    }

    pub async fn get_circuit(&self, id: &str, circuit_id: i64) -> NetboxResult<Circuit> {
        CircuitManager::get(self.client(id)?, circuit_id).await
    }

    pub async fn create_circuit(&self, id: &str, data: &serde_json::Value) -> NetboxResult<Circuit> {
        CircuitManager::create(self.client(id)?, data).await
    }

    pub async fn update_circuit(&self, id: &str, circuit_id: i64, data: &serde_json::Value) -> NetboxResult<Circuit> {
        CircuitManager::update(self.client(id)?, circuit_id, data).await
    }

    pub async fn delete_circuit(&self, id: &str, circuit_id: i64) -> NetboxResult<()> {
        CircuitManager::delete(self.client(id)?, circuit_id).await
    }

    pub async fn list_circuit_providers(&self, id: &str) -> NetboxResult<PaginatedResponse<CircuitProvider>> {
        CircuitManager::list_providers(self.client(id)?).await
    }

    pub async fn get_circuit_provider(&self, id: &str, provider_id: i64) -> NetboxResult<CircuitProvider> {
        CircuitManager::get_provider(self.client(id)?, provider_id).await
    }

    pub async fn create_circuit_provider(&self, id: &str, data: &serde_json::Value) -> NetboxResult<CircuitProvider> {
        CircuitManager::create_provider(self.client(id)?, data).await
    }

    pub async fn update_circuit_provider(&self, id: &str, provider_id: i64, data: &serde_json::Value) -> NetboxResult<CircuitProvider> {
        CircuitManager::update_provider(self.client(id)?, provider_id, data).await
    }

    pub async fn delete_circuit_provider(&self, id: &str, provider_id: i64) -> NetboxResult<()> {
        CircuitManager::delete_provider(self.client(id)?, provider_id).await
    }

    pub async fn list_circuit_types(&self, id: &str) -> NetboxResult<PaginatedResponse<CircuitType>> {
        CircuitManager::list_circuit_types(self.client(id)?).await
    }

    pub async fn get_circuit_type(&self, id: &str, type_id: i64) -> NetboxResult<CircuitType> {
        CircuitManager::get_circuit_type(self.client(id)?, type_id).await
    }

    pub async fn list_circuit_terminations(&self, id: &str, circuit_id: i64) -> NetboxResult<PaginatedResponse<CircuitTermination>> {
        CircuitManager::list_terminations(self.client(id)?, circuit_id).await
    }

    // ── Cables ───────────────────────────────────────────────────

    pub async fn list_cables(&self, id: &str, params: &[(&str, &str)]) -> NetboxResult<PaginatedResponse<Cable>> {
        CableManager::list(self.client(id)?, params).await
    }

    pub async fn get_cable(&self, id: &str, cable_id: i64) -> NetboxResult<Cable> {
        CableManager::get(self.client(id)?, cable_id).await
    }

    pub async fn create_cable(&self, id: &str, data: &serde_json::Value) -> NetboxResult<Cable> {
        CableManager::create(self.client(id)?, data).await
    }

    pub async fn update_cable(&self, id: &str, cable_id: i64, data: &serde_json::Value) -> NetboxResult<Cable> {
        CableManager::update(self.client(id)?, cable_id, data).await
    }

    pub async fn delete_cable(&self, id: &str, cable_id: i64) -> NetboxResult<()> {
        CableManager::delete(self.client(id)?, cable_id).await
    }

    pub async fn trace_cable(&self, id: &str, cable_id: i64) -> NetboxResult<Vec<CableTrace>> {
        CableManager::trace(self.client(id)?, cable_id).await
    }

    // ── Tenants ──────────────────────────────────────────────────

    pub async fn list_tenants(&self, id: &str, params: &[(&str, &str)]) -> NetboxResult<PaginatedResponse<Tenant>> {
        TenantManager::list(self.client(id)?, params).await
    }

    pub async fn get_tenant(&self, id: &str, tenant_id: i64) -> NetboxResult<Tenant> {
        TenantManager::get(self.client(id)?, tenant_id).await
    }

    pub async fn create_tenant(&self, id: &str, data: &serde_json::Value) -> NetboxResult<Tenant> {
        TenantManager::create(self.client(id)?, data).await
    }

    pub async fn update_tenant(&self, id: &str, tenant_id: i64, data: &serde_json::Value) -> NetboxResult<Tenant> {
        TenantManager::update(self.client(id)?, tenant_id, data).await
    }

    pub async fn partial_update_tenant(&self, id: &str, tenant_id: i64, data: &serde_json::Value) -> NetboxResult<Tenant> {
        TenantManager::partial_update(self.client(id)?, tenant_id, data).await
    }

    pub async fn delete_tenant(&self, id: &str, tenant_id: i64) -> NetboxResult<()> {
        TenantManager::delete(self.client(id)?, tenant_id).await
    }

    pub async fn list_tenant_groups(&self, id: &str) -> NetboxResult<PaginatedResponse<TenantGroup>> {
        TenantManager::list_groups(self.client(id)?).await
    }

    pub async fn get_tenant_group(&self, id: &str, group_id: i64) -> NetboxResult<TenantGroup> {
        TenantManager::get_group(self.client(id)?, group_id).await
    }

    pub async fn create_tenant_group(&self, id: &str, data: &serde_json::Value) -> NetboxResult<TenantGroup> {
        TenantManager::create_group(self.client(id)?, data).await
    }

    pub async fn update_tenant_group(&self, id: &str, group_id: i64, data: &serde_json::Value) -> NetboxResult<TenantGroup> {
        TenantManager::update_group(self.client(id)?, group_id, data).await
    }

    pub async fn delete_tenant_group(&self, id: &str, group_id: i64) -> NetboxResult<()> {
        TenantManager::delete_group(self.client(id)?, group_id).await
    }

    // ── Contacts ─────────────────────────────────────────────────

    pub async fn list_contacts(&self, id: &str, params: &[(&str, &str)]) -> NetboxResult<PaginatedResponse<Contact>> {
        ContactManager::list(self.client(id)?, params).await
    }

    pub async fn get_contact(&self, id: &str, contact_id: i64) -> NetboxResult<Contact> {
        ContactManager::get(self.client(id)?, contact_id).await
    }

    pub async fn create_contact(&self, id: &str, data: &serde_json::Value) -> NetboxResult<Contact> {
        ContactManager::create(self.client(id)?, data).await
    }

    pub async fn update_contact(&self, id: &str, contact_id: i64, data: &serde_json::Value) -> NetboxResult<Contact> {
        ContactManager::update(self.client(id)?, contact_id, data).await
    }

    pub async fn partial_update_contact(&self, id: &str, contact_id: i64, data: &serde_json::Value) -> NetboxResult<Contact> {
        ContactManager::partial_update(self.client(id)?, contact_id, data).await
    }

    pub async fn delete_contact(&self, id: &str, contact_id: i64) -> NetboxResult<()> {
        ContactManager::delete(self.client(id)?, contact_id).await
    }

    pub async fn list_contact_groups(&self, id: &str) -> NetboxResult<PaginatedResponse<ContactGroup>> {
        ContactManager::list_groups(self.client(id)?).await
    }

    pub async fn get_contact_group(&self, id: &str, group_id: i64) -> NetboxResult<ContactGroup> {
        ContactManager::get_group(self.client(id)?, group_id).await
    }

    pub async fn create_contact_group(&self, id: &str, data: &serde_json::Value) -> NetboxResult<ContactGroup> {
        ContactManager::create_group(self.client(id)?, data).await
    }

    pub async fn update_contact_group(&self, id: &str, group_id: i64, data: &serde_json::Value) -> NetboxResult<ContactGroup> {
        ContactManager::update_group(self.client(id)?, group_id, data).await
    }

    pub async fn delete_contact_group(&self, id: &str, group_id: i64) -> NetboxResult<()> {
        ContactManager::delete_group(self.client(id)?, group_id).await
    }

    pub async fn list_contact_roles(&self, id: &str) -> NetboxResult<PaginatedResponse<ContactRole>> {
        ContactManager::list_roles(self.client(id)?).await
    }

    pub async fn list_contact_assignments(&self, id: &str) -> NetboxResult<PaginatedResponse<ContactAssignment>> {
        ContactManager::list_assignments(self.client(id)?).await
    }

    // ── Virtualization ───────────────────────────────────────────

    pub async fn list_vms(&self, id: &str, params: &[(&str, &str)]) -> NetboxResult<PaginatedResponse<VirtualMachine>> {
        VirtualizationManager::list_vms(self.client(id)?, params).await
    }

    pub async fn get_vm(&self, id: &str, vm_id: i64) -> NetboxResult<VirtualMachine> {
        VirtualizationManager::get_vm(self.client(id)?, vm_id).await
    }

    pub async fn create_vm(&self, id: &str, data: &serde_json::Value) -> NetboxResult<VirtualMachine> {
        VirtualizationManager::create_vm(self.client(id)?, data).await
    }

    pub async fn update_vm(&self, id: &str, vm_id: i64, data: &serde_json::Value) -> NetboxResult<VirtualMachine> {
        VirtualizationManager::update_vm(self.client(id)?, vm_id, data).await
    }

    pub async fn delete_vm(&self, id: &str, vm_id: i64) -> NetboxResult<()> {
        VirtualizationManager::delete_vm(self.client(id)?, vm_id).await
    }

    pub async fn list_vm_interfaces(&self, id: &str, vm_id: i64) -> NetboxResult<PaginatedResponse<VmInterface>> {
        VirtualizationManager::list_vm_interfaces(self.client(id)?, vm_id).await
    }

    pub async fn create_vm_interface(&self, id: &str, data: &serde_json::Value) -> NetboxResult<VmInterface> {
        VirtualizationManager::create_vm_interface(self.client(id)?, data).await
    }

    pub async fn update_vm_interface(&self, id: &str, iface_id: i64, data: &serde_json::Value) -> NetboxResult<VmInterface> {
        VirtualizationManager::update_vm_interface(self.client(id)?, iface_id, data).await
    }

    pub async fn delete_vm_interface(&self, id: &str, iface_id: i64) -> NetboxResult<()> {
        VirtualizationManager::delete_vm_interface(self.client(id)?, iface_id).await
    }

    pub async fn list_clusters(&self, id: &str) -> NetboxResult<PaginatedResponse<Cluster>> {
        VirtualizationManager::list_clusters(self.client(id)?).await
    }

    pub async fn get_cluster(&self, id: &str, cluster_id: i64) -> NetboxResult<Cluster> {
        VirtualizationManager::get_cluster(self.client(id)?, cluster_id).await
    }

    pub async fn create_cluster(&self, id: &str, data: &serde_json::Value) -> NetboxResult<Cluster> {
        VirtualizationManager::create_cluster(self.client(id)?, data).await
    }

    pub async fn update_cluster(&self, id: &str, cluster_id: i64, data: &serde_json::Value) -> NetboxResult<Cluster> {
        VirtualizationManager::update_cluster(self.client(id)?, cluster_id, data).await
    }

    pub async fn delete_cluster(&self, id: &str, cluster_id: i64) -> NetboxResult<()> {
        VirtualizationManager::delete_cluster(self.client(id)?, cluster_id).await
    }

    pub async fn list_cluster_types(&self, id: &str) -> NetboxResult<PaginatedResponse<ClusterType>> {
        VirtualizationManager::list_cluster_types(self.client(id)?).await
    }

    pub async fn get_cluster_type(&self, id: &str, type_id: i64) -> NetboxResult<ClusterType> {
        VirtualizationManager::get_cluster_type(self.client(id)?, type_id).await
    }

    pub async fn create_cluster_type(&self, id: &str, data: &serde_json::Value) -> NetboxResult<ClusterType> {
        VirtualizationManager::create_cluster_type(self.client(id)?, data).await
    }

    pub async fn list_cluster_groups(&self, id: &str) -> NetboxResult<PaginatedResponse<ClusterGroup>> {
        VirtualizationManager::list_cluster_groups(self.client(id)?).await
    }
}
