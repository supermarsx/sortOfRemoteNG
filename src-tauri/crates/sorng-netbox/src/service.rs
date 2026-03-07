// ── sorng-netbox/src/service.rs ──────────────────────────────────────────────
//! Aggregate NetBox façade – single entry point that holds connections
//! and delegates to domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::circuits::CircuitManager;
use crate::client::NetboxClient;
use crate::contacts::ContactManager;
use crate::dcim::DcimManager;
use crate::error::{NetboxError, NetboxResult};
use crate::ipam::IpamManager;
use crate::power::PowerManager;
use crate::status::StatusManager;
use crate::tenancy::TenancyManager;
use crate::types::*;
use crate::users::UserManager;
use crate::virtualization::VirtualizationManager;
use crate::vpn::VpnManager;
use crate::wireless::WirelessManager;

/// Shared Tauri state handle.
pub type NetboxServiceState = Arc<Mutex<NetboxService>>;

/// Main NetBox service managing connections.
pub struct NetboxService {
    connections: HashMap<String, NetboxClient>,
}

impl NetboxService {
    pub fn new() -> Self {
        Self { connections: HashMap::new() }
    }

    // ── Connection lifecycle ──────────────────────────────────────

    pub async fn connect(&mut self, id: String, config: NetboxConnectionConfig) -> NetboxResult<NetboxConnectionSummary> {
        if self.connections.contains_key(&id) {
            return Err(NetboxError::already_connected(format!("Connection '{id}' already exists")));
        }
        let client = NetboxClient::new(config)?;
        let status = StatusManager::get_status(&client).await?;
        let summary = NetboxConnectionSummary {
            host: client.config.host.clone(),
            version: status.django_version.clone(),
            python_version: status.python_version,
            installed_plugins: status.installed_plugins.iter().map(|p| format!("{}@{}", p.name, p.version)).collect(),
            users_count: status.rq_workers_running,
            django_version: status.django_version,
        };
        self.connections.insert(id, client);
        Ok(summary)
    }

    pub fn disconnect(&mut self, id: &str) -> NetboxResult<()> {
        self.connections.remove(id)
            .map(|_| ())
            .ok_or_else(|| NetboxError::not_connected(format!("No connection '{id}'")))
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> NetboxResult<&NetboxClient> {
        self.connections.get(id)
            .ok_or_else(|| NetboxError::not_connected(format!("No connection '{id}'")))
    }

    // ── DCIM: Sites ──────────────────────────────────────────────────

    pub async fn list_sites(&self, id: &str) -> NetboxResult<Vec<Site>> {
        DcimManager::list_sites(self.client(id)?).await
    }
    pub async fn get_site(&self, id: &str, site_id: i64) -> NetboxResult<Site> {
        DcimManager::get_site(self.client(id)?, site_id).await
    }
    pub async fn create_site(&self, id: &str, data: &serde_json::Value) -> NetboxResult<Site> {
        DcimManager::create_site(self.client(id)?, data).await
    }
    pub async fn update_site(&self, id: &str, site_id: i64, data: &serde_json::Value) -> NetboxResult<Site> {
        DcimManager::update_site(self.client(id)?, site_id, data).await
    }
    pub async fn delete_site(&self, id: &str, site_id: i64) -> NetboxResult<()> {
        DcimManager::delete_site(self.client(id)?, site_id).await
    }

    // ── DCIM: Racks ──────────────────────────────────────────────────

    pub async fn list_racks(&self, id: &str) -> NetboxResult<Vec<Rack>> {
        DcimManager::list_racks(self.client(id)?).await
    }
    pub async fn get_rack(&self, id: &str, rack_id: i64) -> NetboxResult<Rack> {
        DcimManager::get_rack(self.client(id)?, rack_id).await
    }
    pub async fn create_rack(&self, id: &str, data: &serde_json::Value) -> NetboxResult<Rack> {
        DcimManager::create_rack(self.client(id)?, data).await
    }
    pub async fn update_rack(&self, id: &str, rack_id: i64, data: &serde_json::Value) -> NetboxResult<Rack> {
        DcimManager::update_rack(self.client(id)?, rack_id, data).await
    }
    pub async fn delete_rack(&self, id: &str, rack_id: i64) -> NetboxResult<()> {
        DcimManager::delete_rack(self.client(id)?, rack_id).await
    }

    // ── DCIM: Devices ────────────────────────────────────────────────

    pub async fn list_devices(&self, id: &str) -> NetboxResult<Vec<Device>> {
        DcimManager::list_devices(self.client(id)?).await
    }
    pub async fn get_device(&self, id: &str, device_id: i64) -> NetboxResult<Device> {
        DcimManager::get_device(self.client(id)?, device_id).await
    }
    pub async fn create_device(&self, id: &str, data: &serde_json::Value) -> NetboxResult<Device> {
        DcimManager::create_device(self.client(id)?, data).await
    }
    pub async fn update_device(&self, id: &str, device_id: i64, data: &serde_json::Value) -> NetboxResult<Device> {
        DcimManager::update_device(self.client(id)?, device_id, data).await
    }
    pub async fn delete_device(&self, id: &str, device_id: i64) -> NetboxResult<()> {
        DcimManager::delete_device(self.client(id)?, device_id).await
    }
    pub async fn list_device_types(&self, id: &str) -> NetboxResult<Vec<DeviceType>> {
        DcimManager::list_device_types(self.client(id)?).await
    }
    pub async fn get_device_type(&self, id: &str, type_id: i64) -> NetboxResult<DeviceType> {
        DcimManager::get_device_type(self.client(id)?, type_id).await
    }
    pub async fn list_manufacturers(&self, id: &str) -> NetboxResult<Vec<Manufacturer>> {
        DcimManager::list_manufacturers(self.client(id)?).await
    }
    pub async fn list_device_roles(&self, id: &str) -> NetboxResult<Vec<DeviceRole>> {
        DcimManager::list_device_roles(self.client(id)?).await
    }
    pub async fn list_platforms(&self, id: &str) -> NetboxResult<Vec<Platform>> {
        DcimManager::list_platforms(self.client(id)?).await
    }

    // ── DCIM: Interfaces ─────────────────────────────────────────────

    pub async fn list_interfaces(&self, id: &str) -> NetboxResult<Vec<DeviceInterface>> {
        DcimManager::list_interfaces(self.client(id)?).await
    }
    pub async fn get_interface(&self, id: &str, iface_id: i64) -> NetboxResult<DeviceInterface> {
        DcimManager::get_interface(self.client(id)?, iface_id).await
    }
    pub async fn create_interface(&self, id: &str, data: &serde_json::Value) -> NetboxResult<DeviceInterface> {
        DcimManager::create_interface(self.client(id)?, data).await
    }
    pub async fn update_interface(&self, id: &str, iface_id: i64, data: &serde_json::Value) -> NetboxResult<DeviceInterface> {
        DcimManager::update_interface(self.client(id)?, iface_id, data).await
    }
    pub async fn delete_interface(&self, id: &str, iface_id: i64) -> NetboxResult<()> {
        DcimManager::delete_interface(self.client(id)?, iface_id).await
    }

    // ── DCIM: Cables ─────────────────────────────────────────────────

    pub async fn list_cables(&self, id: &str) -> NetboxResult<Vec<Cable>> {
        DcimManager::list_cables(self.client(id)?).await
    }
    pub async fn create_cable(&self, id: &str, data: &serde_json::Value) -> NetboxResult<Cable> {
        DcimManager::create_cable(self.client(id)?, data).await
    }
    pub async fn delete_cable(&self, id: &str, cable_id: i64) -> NetboxResult<()> {
        DcimManager::delete_cable(self.client(id)?, cable_id).await
    }

    // ── DCIM: Locations / Regions / Ports ────────────────────────────

    pub async fn list_locations(&self, id: &str) -> NetboxResult<Vec<Location>> {
        DcimManager::list_locations(self.client(id)?).await
    }
    pub async fn list_regions(&self, id: &str) -> NetboxResult<Vec<Region>> {
        DcimManager::list_regions(self.client(id)?).await
    }
    pub async fn list_console_ports(&self, id: &str) -> NetboxResult<Vec<ConsolePort>> {
        DcimManager::list_console_ports(self.client(id)?).await
    }
    pub async fn list_power_ports(&self, id: &str) -> NetboxResult<Vec<PowerPort>> {
        DcimManager::list_power_ports(self.client(id)?).await
    }
    pub async fn get_device_inventory(&self, id: &str, device_id: i64) -> NetboxResult<serde_json::Value> {
        DcimManager::get_device_inventory(self.client(id)?, device_id).await
    }

    // ── IPAM ─────────────────────────────────────────────────────────

    pub async fn list_ip_addresses(&self, id: &str) -> NetboxResult<Vec<IpAddress>> {
        IpamManager::list_ip_addresses(self.client(id)?).await
    }
    pub async fn get_ip_address(&self, id: &str, ip_id: i64) -> NetboxResult<IpAddress> {
        IpamManager::get_ip_address(self.client(id)?, ip_id).await
    }
    pub async fn create_ip_address(&self, id: &str, data: &serde_json::Value) -> NetboxResult<IpAddress> {
        IpamManager::create_ip_address(self.client(id)?, data).await
    }
    pub async fn update_ip_address(&self, id: &str, ip_id: i64, data: &serde_json::Value) -> NetboxResult<IpAddress> {
        IpamManager::update_ip_address(self.client(id)?, ip_id, data).await
    }
    pub async fn delete_ip_address(&self, id: &str, ip_id: i64) -> NetboxResult<()> {
        IpamManager::delete_ip_address(self.client(id)?, ip_id).await
    }
    pub async fn list_prefixes(&self, id: &str) -> NetboxResult<Vec<Prefix>> {
        IpamManager::list_prefixes(self.client(id)?).await
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
    pub async fn get_available_ips(&self, id: &str, prefix_id: i64) -> NetboxResult<Vec<AvailableIp>> {
        IpamManager::get_available_ips(self.client(id)?, prefix_id).await
    }
    pub async fn get_available_prefixes(&self, id: &str, prefix_id: i64) -> NetboxResult<Vec<AvailablePrefix>> {
        IpamManager::get_available_prefixes(self.client(id)?, prefix_id).await
    }
    pub async fn list_vlans(&self, id: &str) -> NetboxResult<Vec<Vlan>> {
        IpamManager::list_vlans(self.client(id)?).await
    }
    pub async fn get_vlan(&self, id: &str, vlan_id: i64) -> NetboxResult<Vlan> {
        IpamManager::get_vlan(self.client(id)?, vlan_id).await
    }
    pub async fn create_vlan(&self, id: &str, data: &serde_json::Value) -> NetboxResult<Vlan> {
        IpamManager::create_vlan(self.client(id)?, data).await
    }
    pub async fn update_vlan(&self, id: &str, vlan_id: i64, data: &serde_json::Value) -> NetboxResult<Vlan> {
        IpamManager::update_vlan(self.client(id)?, vlan_id, data).await
    }
    pub async fn delete_vlan(&self, id: &str, vlan_id: i64) -> NetboxResult<()> {
        IpamManager::delete_vlan(self.client(id)?, vlan_id).await
    }
    pub async fn list_vrfs(&self, id: &str) -> NetboxResult<Vec<Vrf>> {
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
    pub async fn list_aggregates(&self, id: &str) -> NetboxResult<Vec<Aggregate>> {
        IpamManager::list_aggregates(self.client(id)?).await
    }
    pub async fn list_rirs(&self, id: &str) -> NetboxResult<Vec<Rir>> {
        IpamManager::list_rirs(self.client(id)?).await
    }
    pub async fn list_ip_ranges(&self, id: &str) -> NetboxResult<Vec<IpRange>> {
        IpamManager::list_ip_ranges(self.client(id)?).await
    }
    pub async fn list_asns(&self, id: &str) -> NetboxResult<Vec<AsnInfo>> {
        IpamManager::list_asns(self.client(id)?).await
    }
    pub async fn get_prefix_utilization(&self, id: &str, prefix_id: i64) -> NetboxResult<serde_json::Value> {
        IpamManager::get_prefix_utilization(self.client(id)?, prefix_id).await
    }

    // ── Circuits ─────────────────────────────────────────────────────

    pub async fn list_circuits(&self, id: &str) -> NetboxResult<Vec<Circuit>> {
        CircuitManager::list_circuits(self.client(id)?).await
    }
    pub async fn get_circuit(&self, id: &str, circuit_id: i64) -> NetboxResult<Circuit> {
        CircuitManager::get_circuit(self.client(id)?, circuit_id).await
    }
    pub async fn create_circuit(&self, id: &str, data: &serde_json::Value) -> NetboxResult<Circuit> {
        CircuitManager::create_circuit(self.client(id)?, data).await
    }
    pub async fn update_circuit(&self, id: &str, circuit_id: i64, data: &serde_json::Value) -> NetboxResult<Circuit> {
        CircuitManager::update_circuit(self.client(id)?, circuit_id, data).await
    }
    pub async fn delete_circuit(&self, id: &str, circuit_id: i64) -> NetboxResult<()> {
        CircuitManager::delete_circuit(self.client(id)?, circuit_id).await
    }
    pub async fn list_providers(&self, id: &str) -> NetboxResult<Vec<Provider>> {
        CircuitManager::list_providers(self.client(id)?).await
    }
    pub async fn get_provider(&self, id: &str, provider_id: i64) -> NetboxResult<Provider> {
        CircuitManager::get_provider(self.client(id)?, provider_id).await
    }
    pub async fn create_provider(&self, id: &str, data: &serde_json::Value) -> NetboxResult<Provider> {
        CircuitManager::create_provider(self.client(id)?, data).await
    }
    pub async fn update_provider(&self, id: &str, provider_id: i64, data: &serde_json::Value) -> NetboxResult<Provider> {
        CircuitManager::update_provider(self.client(id)?, provider_id, data).await
    }
    pub async fn delete_provider(&self, id: &str, provider_id: i64) -> NetboxResult<()> {
        CircuitManager::delete_provider(self.client(id)?, provider_id).await
    }
    pub async fn list_circuit_types(&self, id: &str) -> NetboxResult<Vec<CircuitType>> {
        CircuitManager::list_circuit_types(self.client(id)?).await
    }
    pub async fn list_circuit_terminations(&self, id: &str) -> NetboxResult<Vec<CircuitTermination>> {
        CircuitManager::list_circuit_terminations(self.client(id)?).await
    }

    // ── Virtualization ───────────────────────────────────────────────

    pub async fn list_clusters(&self, id: &str) -> NetboxResult<Vec<Cluster>> {
        VirtualizationManager::list_clusters(self.client(id)?).await
    }
    pub async fn get_cluster(&self, id: &str, cluster_id: i64) -> NetboxResult<Cluster> {
        VirtualizationManager::get_cluster(self.client(id)?, cluster_id).await
    }
    pub async fn create_cluster(&self, id: &str, data: &serde_json::Value) -> NetboxResult<Cluster> {
        VirtualizationManager::create_cluster(self.client(id)?, data).await
    }
    pub async fn delete_cluster(&self, id: &str, cluster_id: i64) -> NetboxResult<()> {
        VirtualizationManager::delete_cluster(self.client(id)?, cluster_id).await
    }
    pub async fn list_cluster_types(&self, id: &str) -> NetboxResult<Vec<ClusterType>> {
        VirtualizationManager::list_cluster_types(self.client(id)?).await
    }
    pub async fn list_cluster_groups(&self, id: &str) -> NetboxResult<Vec<ClusterGroup>> {
        VirtualizationManager::list_cluster_groups(self.client(id)?).await
    }
    pub async fn list_vms(&self, id: &str) -> NetboxResult<Vec<VirtualMachine>> {
        VirtualizationManager::list_vms(self.client(id)?).await
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
    pub async fn list_vm_interfaces(&self, id: &str) -> NetboxResult<Vec<VMInterface>> {
        VirtualizationManager::list_vm_interfaces(self.client(id)?).await
    }
    pub async fn create_vm_interface(&self, id: &str, data: &serde_json::Value) -> NetboxResult<VMInterface> {
        VirtualizationManager::create_vm_interface(self.client(id)?, data).await
    }
    pub async fn delete_vm_interface(&self, id: &str, iface_id: i64) -> NetboxResult<()> {
        VirtualizationManager::delete_vm_interface(self.client(id)?, iface_id).await
    }

    // ── Tenancy ──────────────────────────────────────────────────────

    pub async fn list_tenants(&self, id: &str) -> NetboxResult<Vec<Tenant>> {
        TenancyManager::list_tenants(self.client(id)?).await
    }
    pub async fn get_tenant(&self, id: &str, tenant_id: i64) -> NetboxResult<Tenant> {
        TenancyManager::get_tenant(self.client(id)?, tenant_id).await
    }
    pub async fn create_tenant(&self, id: &str, data: &serde_json::Value) -> NetboxResult<Tenant> {
        TenancyManager::create_tenant(self.client(id)?, data).await
    }
    pub async fn update_tenant(&self, id: &str, tenant_id: i64, data: &serde_json::Value) -> NetboxResult<Tenant> {
        TenancyManager::update_tenant(self.client(id)?, tenant_id, data).await
    }
    pub async fn delete_tenant(&self, id: &str, tenant_id: i64) -> NetboxResult<()> {
        TenancyManager::delete_tenant(self.client(id)?, tenant_id).await
    }
    pub async fn list_tenant_groups(&self, id: &str) -> NetboxResult<Vec<TenantGroup>> {
        TenancyManager::list_tenant_groups(self.client(id)?).await
    }
    pub async fn list_contact_assignments(&self, id: &str) -> NetboxResult<Vec<ContactAssignment>> {
        TenancyManager::list_contact_assignments(self.client(id)?).await
    }

    // ── Contacts ─────────────────────────────────────────────────────

    pub async fn list_contacts(&self, id: &str) -> NetboxResult<Vec<Contact>> {
        ContactManager::list_contacts(self.client(id)?).await
    }
    pub async fn get_contact(&self, id: &str, contact_id: i64) -> NetboxResult<Contact> {
        ContactManager::get_contact(self.client(id)?, contact_id).await
    }
    pub async fn create_contact(&self, id: &str, data: &serde_json::Value) -> NetboxResult<Contact> {
        ContactManager::create_contact(self.client(id)?, data).await
    }
    pub async fn update_contact(&self, id: &str, contact_id: i64, data: &serde_json::Value) -> NetboxResult<Contact> {
        ContactManager::update_contact(self.client(id)?, contact_id, data).await
    }
    pub async fn delete_contact(&self, id: &str, contact_id: i64) -> NetboxResult<()> {
        ContactManager::delete_contact(self.client(id)?, contact_id).await
    }
    pub async fn list_contact_groups(&self, id: &str) -> NetboxResult<Vec<ContactGroup>> {
        ContactManager::list_contact_groups(self.client(id)?).await
    }
    pub async fn list_contact_roles(&self, id: &str) -> NetboxResult<Vec<ContactRole>> {
        ContactManager::list_contact_roles(self.client(id)?).await
    }
    pub async fn list_contacts_assignments(&self, id: &str) -> NetboxResult<Vec<ContactAssignment>> {
        ContactManager::list_contact_assignments(self.client(id)?).await
    }
    pub async fn create_contact_assignment(&self, id: &str, data: &serde_json::Value) -> NetboxResult<ContactAssignment> {
        ContactManager::create_contact_assignment(self.client(id)?, data).await
    }

    // ── Wireless ─────────────────────────────────────────────────────

    pub async fn list_wireless_lans(&self, id: &str) -> NetboxResult<Vec<WirelessLan>> {
        WirelessManager::list_wireless_lans(self.client(id)?).await
    }
    pub async fn get_wireless_lan(&self, id: &str, wlan_id: i64) -> NetboxResult<WirelessLan> {
        WirelessManager::get_wireless_lan(self.client(id)?, wlan_id).await
    }
    pub async fn create_wireless_lan(&self, id: &str, data: &serde_json::Value) -> NetboxResult<WirelessLan> {
        WirelessManager::create_wireless_lan(self.client(id)?, data).await
    }
    pub async fn delete_wireless_lan(&self, id: &str, wlan_id: i64) -> NetboxResult<()> {
        WirelessManager::delete_wireless_lan(self.client(id)?, wlan_id).await
    }
    pub async fn list_wireless_lan_groups(&self, id: &str) -> NetboxResult<Vec<WirelessLanGroup>> {
        WirelessManager::list_wireless_lan_groups(self.client(id)?).await
    }
    pub async fn list_wireless_links(&self, id: &str) -> NetboxResult<Vec<WirelessLink>> {
        WirelessManager::list_wireless_links(self.client(id)?).await
    }
    pub async fn create_wireless_link(&self, id: &str, data: &serde_json::Value) -> NetboxResult<WirelessLink> {
        WirelessManager::create_wireless_link(self.client(id)?, data).await
    }

    // ── VPN ──────────────────────────────────────────────────────────

    pub async fn list_tunnels(&self, id: &str) -> NetboxResult<Vec<Tunnel>> {
        VpnManager::list_tunnels(self.client(id)?).await
    }
    pub async fn get_tunnel(&self, id: &str, tunnel_id: i64) -> NetboxResult<Tunnel> {
        VpnManager::get_tunnel(self.client(id)?, tunnel_id).await
    }
    pub async fn create_tunnel(&self, id: &str, data: &serde_json::Value) -> NetboxResult<Tunnel> {
        VpnManager::create_tunnel(self.client(id)?, data).await
    }
    pub async fn delete_tunnel(&self, id: &str, tunnel_id: i64) -> NetboxResult<()> {
        VpnManager::delete_tunnel(self.client(id)?, tunnel_id).await
    }
    pub async fn list_tunnel_groups(&self, id: &str) -> NetboxResult<Vec<TunnelGroup>> {
        VpnManager::list_tunnel_groups(self.client(id)?).await
    }
    pub async fn list_tunnel_terminations(&self, id: &str) -> NetboxResult<Vec<TunnelTermination>> {
        VpnManager::list_tunnel_terminations(self.client(id)?).await
    }
    pub async fn list_ike_policies(&self, id: &str) -> NetboxResult<Vec<IKEPolicy>> {
        VpnManager::list_ike_policies(self.client(id)?).await
    }
    pub async fn list_ipsec_policies(&self, id: &str) -> NetboxResult<Vec<IPSecPolicy>> {
        VpnManager::list_ipsec_policies(self.client(id)?).await
    }
    pub async fn list_l2vpns(&self, id: &str) -> NetboxResult<Vec<L2VPN>> {
        VpnManager::list_l2vpns(self.client(id)?).await
    }
    pub async fn list_l2vpn_terminations(&self, id: &str) -> NetboxResult<Vec<L2VPNTermination>> {
        VpnManager::list_l2vpn_terminations(self.client(id)?).await
    }

    // ── Power ────────────────────────────────────────────────────────

    pub async fn list_power_feeds(&self, id: &str) -> NetboxResult<Vec<PowerFeed>> {
        PowerManager::list_power_feeds(self.client(id)?).await
    }
    pub async fn get_power_feed(&self, id: &str, feed_id: i64) -> NetboxResult<PowerFeed> {
        PowerManager::get_power_feed(self.client(id)?, feed_id).await
    }
    pub async fn create_power_feed(&self, id: &str, data: &serde_json::Value) -> NetboxResult<PowerFeed> {
        PowerManager::create_power_feed(self.client(id)?, data).await
    }
    pub async fn update_power_feed(&self, id: &str, feed_id: i64, data: &serde_json::Value) -> NetboxResult<PowerFeed> {
        PowerManager::update_power_feed(self.client(id)?, feed_id, data).await
    }
    pub async fn delete_power_feed(&self, id: &str, feed_id: i64) -> NetboxResult<()> {
        PowerManager::delete_power_feed(self.client(id)?, feed_id).await
    }
    pub async fn list_power_panels(&self, id: &str) -> NetboxResult<Vec<PowerPanel>> {
        PowerManager::list_power_panels(self.client(id)?).await
    }
    pub async fn create_power_panel(&self, id: &str, data: &serde_json::Value) -> NetboxResult<PowerPanel> {
        PowerManager::create_power_panel(self.client(id)?, data).await
    }
    pub async fn delete_power_panel(&self, id: &str, panel_id: i64) -> NetboxResult<()> {
        PowerManager::delete_power_panel(self.client(id)?, panel_id).await
    }

    // ── Users ────────────────────────────────────────────────────────

    pub async fn list_users(&self, id: &str) -> NetboxResult<Vec<NetboxUser>> {
        UserManager::list_users(self.client(id)?).await
    }
    pub async fn get_user(&self, id: &str, user_id: i64) -> NetboxResult<NetboxUser> {
        UserManager::get_user(self.client(id)?, user_id).await
    }
    pub async fn list_groups(&self, id: &str) -> NetboxResult<Vec<NetboxGroup>> {
        UserManager::list_groups(self.client(id)?).await
    }
    pub async fn list_tokens(&self, id: &str) -> NetboxResult<Vec<NetboxToken>> {
        UserManager::list_tokens(self.client(id)?).await
    }
    pub async fn create_token(&self, id: &str, data: &serde_json::Value) -> NetboxResult<NetboxToken> {
        UserManager::create_token(self.client(id)?, data).await
    }
    pub async fn delete_token(&self, id: &str, token_id: i64) -> NetboxResult<()> {
        UserManager::delete_token(self.client(id)?, token_id).await
    }
    pub async fn list_permissions(&self, id: &str) -> NetboxResult<Vec<ObjectPermission>> {
        UserManager::list_permissions(self.client(id)?).await
    }
    pub async fn list_object_changes(&self, id: &str) -> NetboxResult<Vec<ObjectChange>> {
        UserManager::list_object_changes(self.client(id)?).await
    }

    // ── Status ───────────────────────────────────────────────────────

    pub async fn get_status(&self, id: &str) -> NetboxResult<NetboxStatus> {
        StatusManager::get_status(self.client(id)?).await
    }
    pub async fn get_object_counts(&self, id: &str) -> NetboxResult<serde_json::Value> {
        StatusManager::get_object_counts(self.client(id)?).await
    }
    pub async fn list_content_types(&self, id: &str) -> NetboxResult<Vec<ContentType>> {
        StatusManager::list_content_types(self.client(id)?).await
    }
    pub async fn list_recent_changes(&self, id: &str) -> NetboxResult<Vec<ObjectChange>> {
        StatusManager::list_recent_changes(self.client(id)?).await
    }
}
