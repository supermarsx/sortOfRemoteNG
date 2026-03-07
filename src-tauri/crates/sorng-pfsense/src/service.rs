//! Aggregate pfSense/OPNsense façade – single entry point that holds connections
//! and delegates to domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::PfsenseClient;
use crate::error::{PfsenseError, PfsenseResult};
use crate::types::*;

use crate::interfaces::InterfaceManager;
use crate::firewall::FirewallManager;
use crate::nat::NatManager;
use crate::dhcp::DhcpManager;
use crate::dns::DnsManager;
use crate::vpn::VpnManager;
use crate::routing::RoutingManager;
use crate::certificates::CertificateManager;
use crate::users::UserManager;
use crate::diagnostics::DiagnosticsManager;
use crate::packages::PackageManager;
use crate::backup::BackupManager;
use crate::status::StatusManager;

/// Shared Tauri state handle.
pub type PfsenseServiceState = Arc<Mutex<PfsenseService>>;

/// Main pfSense service managing connections.
pub struct PfsenseService {
    connections: HashMap<String, PfsenseClient>,
}

impl PfsenseService {
    pub fn new() -> Self {
        Self { connections: HashMap::new() }
    }

    // ── Connection lifecycle ──────────────────────────────────────

    pub async fn connect(&mut self, id: String, config: PfsenseConnectionConfig) -> PfsenseResult<PfsenseConnectionSummary> {
        if self.connections.contains_key(&id) {
            return Err(PfsenseError::already_connected(format!("Connection '{id}' already exists")));
        }
        let client = PfsenseClient::new(config)?;
        let status = StatusManager::get_system_status(&client).await.unwrap_or(SystemStatus {
            version: String::new(),
            platform: String::new(),
            cpu_type: String::new(),
            cpu_count: 0,
            uptime: String::new(),
            memory_total: 0,
            memory_used: 0,
            swap_total: 0,
            swap_used: 0,
            disk_usage: 0.0,
            cpu_usage: 0.0,
            load_average: Vec::new(),
            temperature: 0.0,
        });
        let summary = PfsenseConnectionSummary {
            host: client.config.host.clone(),
            version: status.version,
            hostname: String::new(),
            platform: status.platform,
            appliance_type: client.config.appliance_type.clone(),
        };
        self.connections.insert(id, client);
        Ok(summary)
    }

    pub fn disconnect(&mut self, id: &str) -> PfsenseResult<()> {
        self.connections.remove(id)
            .map(|_| ())
            .ok_or_else(|| PfsenseError::not_connected(format!("No connection '{id}'")))
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> PfsenseResult<&PfsenseClient> {
        self.connections.get(id)
            .ok_or_else(|| PfsenseError::not_connected(format!("No connection '{id}'")))
    }

    // ── Interfaces ───────────────────────────────────────────────

    pub async fn list_interfaces(&self, id: &str) -> PfsenseResult<Vec<PfsenseInterface>> {
        InterfaceManager::list(self.client(id)?).await
    }

    pub async fn get_interface(&self, id: &str, name: &str) -> PfsenseResult<PfsenseInterface> {
        InterfaceManager::get(self.client(id)?, name).await
    }

    pub async fn get_interface_stats(&self, id: &str, name: &str) -> PfsenseResult<InterfaceStats> {
        InterfaceManager::get_stats(self.client(id)?, name).await
    }

    pub async fn create_vlan(&self, id: &str, req: &CreateVlanRequest) -> PfsenseResult<VlanConfig> {
        InterfaceManager::create_vlan(self.client(id)?, req).await
    }

    pub async fn delete_vlan(&self, id: &str, vlan_id: &str) -> PfsenseResult<()> {
        InterfaceManager::delete_vlan(self.client(id)?, vlan_id).await
    }

    pub async fn list_vlans(&self, id: &str) -> PfsenseResult<Vec<VlanConfig>> {
        InterfaceManager::list_vlans(self.client(id)?).await
    }

    pub async fn assign_interface(&self, id: &str, req: &AssignInterfaceRequest) -> PfsenseResult<PfsenseInterface> {
        InterfaceManager::assign_interface(self.client(id)?, req).await
    }

    pub async fn enable_interface(&self, id: &str, name: &str) -> PfsenseResult<()> {
        InterfaceManager::enable_interface(self.client(id)?, name).await
    }

    pub async fn disable_interface(&self, id: &str, name: &str) -> PfsenseResult<()> {
        InterfaceManager::disable_interface(self.client(id)?, name).await
    }

    pub async fn get_interface_config(&self, id: &str, name: &str) -> PfsenseResult<serde_json::Value> {
        InterfaceManager::get_interface_config(self.client(id)?, name).await
    }

    pub async fn apply_interface_changes(&self, id: &str) -> PfsenseResult<()> {
        InterfaceManager::apply_changes(self.client(id)?).await
    }

    // ── Firewall ─────────────────────────────────────────────────

    pub async fn list_firewall_rules(&self, id: &str, interface: Option<&str>) -> PfsenseResult<Vec<FirewallRule>> {
        FirewallManager::list_rules(self.client(id)?, interface).await
    }

    pub async fn get_firewall_rule(&self, id: &str, rule_id: &str) -> PfsenseResult<FirewallRule> {
        FirewallManager::get_rule(self.client(id)?, rule_id).await
    }

    pub async fn create_firewall_rule(&self, id: &str, req: &CreateFirewallRuleRequest) -> PfsenseResult<FirewallRule> {
        FirewallManager::create_rule(self.client(id)?, req).await
    }

    pub async fn update_firewall_rule(&self, id: &str, rule_id: &str, req: &UpdateFirewallRuleRequest) -> PfsenseResult<FirewallRule> {
        FirewallManager::update_rule(self.client(id)?, rule_id, req).await
    }

    pub async fn delete_firewall_rule(&self, id: &str, rule_id: &str) -> PfsenseResult<()> {
        FirewallManager::delete_rule(self.client(id)?, rule_id).await
    }

    pub async fn move_firewall_rule(&self, id: &str, rule_id: &str, position: u32) -> PfsenseResult<()> {
        FirewallManager::move_rule(self.client(id)?, rule_id, position).await
    }

    pub async fn toggle_firewall_rule(&self, id: &str, rule_id: &str, enabled: bool) -> PfsenseResult<()> {
        FirewallManager::toggle_rule(self.client(id)?, rule_id, enabled).await
    }

    pub async fn list_aliases(&self, id: &str) -> PfsenseResult<Vec<FirewallAlias>> {
        FirewallManager::list_aliases(self.client(id)?).await
    }

    pub async fn get_alias(&self, id: &str, name: &str) -> PfsenseResult<FirewallAlias> {
        FirewallManager::get_alias(self.client(id)?, name).await
    }

    pub async fn create_alias(&self, id: &str, req: &CreateAliasRequest) -> PfsenseResult<FirewallAlias> {
        FirewallManager::create_alias(self.client(id)?, req).await
    }

    pub async fn update_alias(&self, id: &str, name: &str, req: &CreateAliasRequest) -> PfsenseResult<FirewallAlias> {
        FirewallManager::update_alias(self.client(id)?, name, req).await
    }

    pub async fn delete_alias(&self, id: &str, name: &str) -> PfsenseResult<()> {
        FirewallManager::delete_alias(self.client(id)?, name).await
    }

    pub async fn get_states_count(&self, id: &str) -> PfsenseResult<u64> {
        FirewallManager::get_states_count(self.client(id)?).await
    }

    pub async fn clear_states(&self, id: &str) -> PfsenseResult<()> {
        FirewallManager::clear_states(self.client(id)?).await
    }

    pub async fn get_rule_stats(&self, id: &str, rule_id: &str) -> PfsenseResult<FirewallRule> {
        FirewallManager::get_rule_stats(self.client(id)?, rule_id).await
    }

    pub async fn list_schedules(&self, id: &str) -> PfsenseResult<Vec<FirewallSchedule>> {
        FirewallManager::list_schedules(self.client(id)?).await
    }

    // ── NAT ──────────────────────────────────────────────────────

    pub async fn list_port_forwards(&self, id: &str) -> PfsenseResult<Vec<NatRule>> {
        NatManager::list_port_forwards(self.client(id)?).await
    }

    pub async fn create_port_forward(&self, id: &str, req: &CreateNatRuleRequest) -> PfsenseResult<NatRule> {
        NatManager::create_port_forward(self.client(id)?, req).await
    }

    pub async fn update_port_forward(&self, id: &str, rule_id: &str, req: &CreateNatRuleRequest) -> PfsenseResult<NatRule> {
        NatManager::update_port_forward(self.client(id)?, rule_id, req).await
    }

    pub async fn delete_port_forward(&self, id: &str, rule_id: &str) -> PfsenseResult<()> {
        NatManager::delete_port_forward(self.client(id)?, rule_id).await
    }

    pub async fn list_outbound_rules(&self, id: &str) -> PfsenseResult<Vec<OutboundNatRule>> {
        NatManager::list_outbound_rules(self.client(id)?).await
    }

    pub async fn get_outbound_mode(&self, id: &str) -> PfsenseResult<OutboundNatMode> {
        NatManager::get_outbound_mode(self.client(id)?).await
    }

    pub async fn set_outbound_mode(&self, id: &str, mode: &OutboundNatMode) -> PfsenseResult<()> {
        NatManager::set_outbound_mode(self.client(id)?, mode).await
    }

    pub async fn create_outbound_rule(&self, id: &str, req: &serde_json::Value) -> PfsenseResult<OutboundNatRule> {
        NatManager::create_outbound_rule(self.client(id)?, req).await
    }

    pub async fn list_one_to_one(&self, id: &str) -> PfsenseResult<Vec<serde_json::Value>> {
        NatManager::list_one_to_one(self.client(id)?).await
    }

    pub async fn create_one_to_one(&self, id: &str, req: &serde_json::Value) -> PfsenseResult<serde_json::Value> {
        NatManager::create_one_to_one(self.client(id)?, req).await
    }

    pub async fn delete_one_to_one(&self, id: &str, rule_id: &str) -> PfsenseResult<()> {
        NatManager::delete_one_to_one(self.client(id)?, rule_id).await
    }

    // ── DHCP ─────────────────────────────────────────────────────

    pub async fn get_dhcp_config(&self, id: &str, interface: &str) -> PfsenseResult<DhcpServerConfig> {
        DhcpManager::get_config(self.client(id)?, interface).await
    }

    pub async fn update_dhcp_config(&self, id: &str, req: &UpdateDhcpConfigRequest) -> PfsenseResult<()> {
        DhcpManager::update_config(self.client(id)?, req).await
    }

    pub async fn list_dhcp_leases(&self, id: &str) -> PfsenseResult<Vec<DhcpLease>> {
        DhcpManager::list_leases(self.client(id)?).await
    }

    pub async fn list_static_mappings(&self, id: &str, interface: &str) -> PfsenseResult<Vec<DhcpStaticMapping>> {
        DhcpManager::list_static_mappings(self.client(id)?, interface).await
    }

    pub async fn create_static_mapping(&self, id: &str, interface: &str, mapping: &DhcpStaticMapping) -> PfsenseResult<DhcpStaticMapping> {
        DhcpManager::create_static_mapping(self.client(id)?, interface, mapping).await
    }

    pub async fn delete_static_mapping(&self, id: &str, interface: &str, mapping_id: &str) -> PfsenseResult<()> {
        DhcpManager::delete_static_mapping(self.client(id)?, interface, mapping_id).await
    }

    pub async fn get_dhcp_pool_stats(&self, id: &str, interface: &str) -> PfsenseResult<DhcpPoolStats> {
        DhcpManager::get_pool_stats(self.client(id)?, interface).await
    }

    // ── DNS ──────────────────────────────────────────────────────

    pub async fn get_resolver_config(&self, id: &str) -> PfsenseResult<DnsResolverConfig> {
        DnsManager::get_resolver_config(self.client(id)?).await
    }

    pub async fn update_resolver_config(&self, id: &str, config: &DnsResolverConfig) -> PfsenseResult<()> {
        DnsManager::update_resolver_config(self.client(id)?, config).await
    }

    pub async fn get_forwarder_config(&self, id: &str) -> PfsenseResult<DnsForwarderConfig> {
        DnsManager::get_forwarder_config(self.client(id)?).await
    }

    pub async fn update_forwarder_config(&self, id: &str, config: &DnsForwarderConfig) -> PfsenseResult<()> {
        DnsManager::update_forwarder_config(self.client(id)?, config).await
    }

    pub async fn list_host_overrides(&self, id: &str) -> PfsenseResult<Vec<DnsHostOverride>> {
        DnsManager::list_host_overrides(self.client(id)?).await
    }

    pub async fn create_host_override(&self, id: &str, ovr: &DnsHostOverride) -> PfsenseResult<DnsHostOverride> {
        DnsManager::create_host_override(self.client(id)?, ovr).await
    }

    pub async fn delete_host_override(&self, id: &str, override_id: &str) -> PfsenseResult<()> {
        DnsManager::delete_host_override(self.client(id)?, override_id).await
    }

    pub async fn list_domain_overrides(&self, id: &str) -> PfsenseResult<Vec<DnsDomainOverride>> {
        DnsManager::list_domain_overrides(self.client(id)?).await
    }

    pub async fn create_domain_override(&self, id: &str, ovr: &DnsDomainOverride) -> PfsenseResult<DnsDomainOverride> {
        DnsManager::create_domain_override(self.client(id)?, ovr).await
    }

    pub async fn delete_domain_override(&self, id: &str, override_id: &str) -> PfsenseResult<()> {
        DnsManager::delete_domain_override(self.client(id)?, override_id).await
    }

    pub async fn flush_dns_cache(&self, id: &str) -> PfsenseResult<()> {
        DnsManager::flush_dns_cache(self.client(id)?).await
    }

    pub async fn get_dyndns_config(&self, id: &str) -> PfsenseResult<Vec<DynDnsConfig>> {
        DnsManager::get_dyndns_config(self.client(id)?).await
    }

    pub async fn update_dyndns_config(&self, id: &str, config: &DynDnsConfig) -> PfsenseResult<()> {
        DnsManager::update_dyndns_config(self.client(id)?, config).await
    }

    // ── VPN ──────────────────────────────────────────────────────

    pub async fn list_ipsec_tunnels(&self, id: &str) -> PfsenseResult<Vec<IpsecTunnel>> {
        VpnManager::list_ipsec_tunnels(self.client(id)?).await
    }

    pub async fn get_ipsec_tunnel(&self, id: &str, ikeid: &str) -> PfsenseResult<IpsecTunnel> {
        VpnManager::get_ipsec_tunnel(self.client(id)?, ikeid).await
    }

    pub async fn create_ipsec_tunnel(&self, id: &str, tunnel: &IpsecTunnel) -> PfsenseResult<IpsecTunnel> {
        VpnManager::create_ipsec_tunnel(self.client(id)?, tunnel).await
    }

    pub async fn delete_ipsec_tunnel(&self, id: &str, ikeid: &str) -> PfsenseResult<()> {
        VpnManager::delete_ipsec_tunnel(self.client(id)?, ikeid).await
    }

    pub async fn get_ipsec_status(&self, id: &str) -> PfsenseResult<serde_json::Value> {
        VpnManager::get_ipsec_status(self.client(id)?).await
    }

    pub async fn list_openvpn_servers(&self, id: &str) -> PfsenseResult<Vec<OpenVpnServer>> {
        VpnManager::list_openvpn_servers(self.client(id)?).await
    }

    pub async fn get_openvpn_server(&self, id: &str, vpnid: &str) -> PfsenseResult<OpenVpnServer> {
        VpnManager::get_openvpn_server(self.client(id)?, vpnid).await
    }

    pub async fn list_openvpn_clients(&self, id: &str) -> PfsenseResult<Vec<OpenVpnClient>> {
        VpnManager::list_openvpn_clients(self.client(id)?).await
    }

    pub async fn get_openvpn_client_status(&self, id: &str, vpnid: &str) -> PfsenseResult<OpenVpnClient> {
        VpnManager::get_openvpn_client_status(self.client(id)?, vpnid).await
    }

    pub async fn list_wireguard_tunnels(&self, id: &str) -> PfsenseResult<Vec<WireGuardTunnel>> {
        VpnManager::list_wireguard_tunnels(self.client(id)?).await
    }

    pub async fn create_wireguard_tunnel(&self, id: &str, tunnel: &WireGuardTunnel) -> PfsenseResult<WireGuardTunnel> {
        VpnManager::create_wireguard_tunnel(self.client(id)?, tunnel).await
    }

    pub async fn delete_wireguard_tunnel(&self, id: &str, name: &str) -> PfsenseResult<()> {
        VpnManager::delete_wireguard_tunnel(self.client(id)?, name).await
    }

    pub async fn add_wireguard_peer(&self, id: &str, tunnel_name: &str, peer: &WireGuardPeer) -> PfsenseResult<WireGuardPeer> {
        VpnManager::add_wireguard_peer(self.client(id)?, tunnel_name, peer).await
    }

    pub async fn remove_wireguard_peer(&self, id: &str, tunnel_name: &str, peer_id: &str) -> PfsenseResult<()> {
        VpnManager::remove_wireguard_peer(self.client(id)?, tunnel_name, peer_id).await
    }

    // ── Routing ──────────────────────────────────────────────────

    pub async fn list_routes(&self, id: &str) -> PfsenseResult<Vec<StaticRoute>> {
        RoutingManager::list_routes(self.client(id)?).await
    }

    pub async fn create_route(&self, id: &str, route: &StaticRoute) -> PfsenseResult<StaticRoute> {
        RoutingManager::create_route(self.client(id)?, route).await
    }

    pub async fn delete_route(&self, id: &str, route_id: &str) -> PfsenseResult<()> {
        RoutingManager::delete_route(self.client(id)?, route_id).await
    }

    pub async fn list_gateways(&self, id: &str) -> PfsenseResult<Vec<Gateway>> {
        RoutingManager::list_gateways(self.client(id)?).await
    }

    pub async fn get_gateway_status(&self, id: &str) -> PfsenseResult<Vec<GatewayStatus>> {
        RoutingManager::get_gateway_status(self.client(id)?).await
    }

    pub async fn create_gateway_group(&self, id: &str, group: &GatewayGroup) -> PfsenseResult<GatewayGroup> {
        RoutingManager::create_gateway_group(self.client(id)?, group).await
    }

    pub async fn list_gateway_groups(&self, id: &str) -> PfsenseResult<Vec<GatewayGroup>> {
        RoutingManager::list_gateway_groups(self.client(id)?).await
    }

    pub async fn get_routing_table(&self, id: &str) -> PfsenseResult<Vec<SystemRoute>> {
        RoutingManager::get_routing_table(self.client(id)?).await
    }

    // ── Certificates ─────────────────────────────────────────────

    pub async fn list_certs(&self, id: &str) -> PfsenseResult<Vec<PfsenseCertificate>> {
        CertificateManager::list_certs(self.client(id)?).await
    }

    pub async fn get_cert(&self, id: &str, refid: &str) -> PfsenseResult<PfsenseCertificate> {
        CertificateManager::get_cert(self.client(id)?, refid).await
    }

    pub async fn create_cert(&self, id: &str, req: &CreateCertRequest) -> PfsenseResult<PfsenseCertificate> {
        CertificateManager::create_cert(self.client(id)?, req).await
    }

    pub async fn import_cert(&self, id: &str, req: &ImportCertRequest) -> PfsenseResult<PfsenseCertificate> {
        CertificateManager::import_cert(self.client(id)?, req).await
    }

    pub async fn delete_cert(&self, id: &str, refid: &str) -> PfsenseResult<()> {
        CertificateManager::delete_cert(self.client(id)?, refid).await
    }

    pub async fn list_cas(&self, id: &str) -> PfsenseResult<Vec<CertificateAuthority>> {
        CertificateManager::list_cas(self.client(id)?).await
    }

    pub async fn get_ca(&self, id: &str, refid: &str) -> PfsenseResult<CertificateAuthority> {
        CertificateManager::get_ca(self.client(id)?, refid).await
    }

    pub async fn import_ca(&self, id: &str, descr: &str, crt: &str, prv: &str) -> PfsenseResult<CertificateAuthority> {
        CertificateManager::import_ca(self.client(id)?, descr, crt, prv).await
    }

    pub async fn delete_ca(&self, id: &str, refid: &str) -> PfsenseResult<()> {
        CertificateManager::delete_ca(self.client(id)?, refid).await
    }

    pub async fn create_csr(&self, id: &str, req: &CreateCertRequest) -> PfsenseResult<String> {
        CertificateManager::create_csr(self.client(id)?, req).await
    }

    pub async fn sign_csr(&self, id: &str, ca_refid: &str, csr: &str, lifetime: u32) -> PfsenseResult<PfsenseCertificate> {
        CertificateManager::sign_csr(self.client(id)?, ca_refid, csr, lifetime).await
    }

    // ── Users ────────────────────────────────────────────────────

    pub async fn list_users(&self, id: &str) -> PfsenseResult<Vec<PfsenseUser>> {
        UserManager::list_users(self.client(id)?).await
    }

    pub async fn get_user(&self, id: &str, uid: &str) -> PfsenseResult<PfsenseUser> {
        UserManager::get_user(self.client(id)?, uid).await
    }

    pub async fn create_user(&self, id: &str, req: &CreateUserRequest) -> PfsenseResult<PfsenseUser> {
        UserManager::create_user(self.client(id)?, req).await
    }

    pub async fn update_user(&self, id: &str, uid: &str, req: &UpdateUserRequest) -> PfsenseResult<PfsenseUser> {
        UserManager::update_user(self.client(id)?, uid, req).await
    }

    pub async fn delete_user(&self, id: &str, uid: &str) -> PfsenseResult<()> {
        UserManager::delete_user(self.client(id)?, uid).await
    }

    pub async fn list_groups(&self, id: &str) -> PfsenseResult<Vec<PfsenseGroup>> {
        UserManager::list_groups(self.client(id)?).await
    }

    pub async fn get_group(&self, id: &str, name: &str) -> PfsenseResult<PfsenseGroup> {
        UserManager::get_group(self.client(id)?, name).await
    }

    pub async fn create_group(&self, id: &str, group: &PfsenseGroup) -> PfsenseResult<PfsenseGroup> {
        UserManager::create_group(self.client(id)?, group).await
    }

    pub async fn delete_group(&self, id: &str, name: &str) -> PfsenseResult<()> {
        UserManager::delete_group(self.client(id)?, name).await
    }

    pub async fn add_user_to_group(&self, id: &str, uid: &str, group_name: &str) -> PfsenseResult<()> {
        UserManager::add_user_to_group(self.client(id)?, uid, group_name).await
    }

    pub async fn remove_user_from_group(&self, id: &str, uid: &str, group_name: &str) -> PfsenseResult<()> {
        UserManager::remove_user_from_group(self.client(id)?, uid, group_name).await
    }

    pub async fn list_privileges(&self, id: &str) -> PfsenseResult<Vec<UserPrivilege>> {
        UserManager::list_privileges(self.client(id)?).await
    }

    // ── Diagnostics ──────────────────────────────────────────────

    pub async fn get_arp_table(&self, id: &str) -> PfsenseResult<Vec<ArpEntry>> {
        DiagnosticsManager::get_arp_table(self.client(id)?).await
    }

    pub async fn get_ndp_table(&self, id: &str) -> PfsenseResult<Vec<NdpEntry>> {
        DiagnosticsManager::get_ndp_table(self.client(id)?).await
    }

    pub async fn get_system_routes(&self, id: &str) -> PfsenseResult<Vec<SystemRoute>> {
        DiagnosticsManager::get_system_routes(self.client(id)?).await
    }

    pub async fn get_pf_states(&self, id: &str) -> PfsenseResult<Vec<PfState>> {
        DiagnosticsManager::get_pf_states(self.client(id)?).await
    }

    pub async fn dns_lookup(&self, id: &str, host: &str, server: Option<&str>) -> PfsenseResult<DnsLookupResult> {
        DiagnosticsManager::dns_lookup(self.client(id)?, host, server).await
    }

    pub async fn ping(&self, id: &str, host: &str, count: u32) -> PfsenseResult<PingResult> {
        DiagnosticsManager::ping(self.client(id)?, host, count).await
    }

    pub async fn traceroute(&self, id: &str, host: &str) -> PfsenseResult<TracerouteResult> {
        DiagnosticsManager::traceroute(self.client(id)?, host).await
    }

    pub async fn get_packet_capture(&self, id: &str, interface: &str, count: u32, filter: Option<&str>) -> PfsenseResult<String> {
        DiagnosticsManager::get_packet_capture(self.client(id)?, interface, count, filter).await
    }

    pub async fn get_pf_info(&self, id: &str) -> PfsenseResult<PfInfo> {
        DiagnosticsManager::get_pf_info(self.client(id)?).await
    }

    pub async fn get_mbuf_stats(&self, id: &str) -> PfsenseResult<serde_json::Value> {
        DiagnosticsManager::get_mbuf_stats(self.client(id)?).await
    }

    pub async fn get_memory_stats(&self, id: &str) -> PfsenseResult<serde_json::Value> {
        DiagnosticsManager::get_memory_stats(self.client(id)?).await
    }

    pub async fn test_port(&self, id: &str, host: &str, port: u16) -> PfsenseResult<bool> {
        DiagnosticsManager::test_port(self.client(id)?, host, port).await
    }

    // ── Packages ─────────────────────────────────────────────────

    pub async fn list_installed_packages(&self, id: &str) -> PfsenseResult<Vec<PfsensePackage>> {
        PackageManager::list_installed(self.client(id)?).await
    }

    pub async fn list_available_packages(&self, id: &str) -> PfsenseResult<Vec<PfsensePackage>> {
        PackageManager::list_available(self.client(id)?).await
    }

    pub async fn install_package(&self, id: &str, name: &str) -> PfsenseResult<()> {
        PackageManager::install(self.client(id)?, name).await
    }

    pub async fn uninstall_package(&self, id: &str, name: &str) -> PfsenseResult<()> {
        PackageManager::uninstall(self.client(id)?, name).await
    }

    pub async fn update_package(&self, id: &str, name: &str) -> PfsenseResult<()> {
        PackageManager::update(self.client(id)?, name).await
    }

    pub async fn check_package_updates(&self, id: &str) -> PfsenseResult<Vec<PfsensePackage>> {
        PackageManager::check_updates(self.client(id)?).await
    }

    pub async fn get_package_info(&self, id: &str, name: &str) -> PfsenseResult<PfsensePackage> {
        PackageManager::get_package_info(self.client(id)?, name).await
    }

    // ── Backup ───────────────────────────────────────────────────

    pub async fn create_backup(&self, id: &str, config: &BackupConfig) -> PfsenseResult<BackupEntry> {
        BackupManager::create_backup(self.client(id)?, config).await
    }

    pub async fn restore_backup(&self, id: &str, config: &RestoreConfig) -> PfsenseResult<()> {
        BackupManager::restore_backup(self.client(id)?, config).await
    }

    pub async fn list_backups(&self, id: &str) -> PfsenseResult<Vec<BackupEntry>> {
        BackupManager::list_backups(self.client(id)?).await
    }

    pub async fn download_backup(&self, id: &str, filename: &str) -> PfsenseResult<String> {
        BackupManager::download_backup(self.client(id)?, filename).await
    }

    pub async fn delete_backup(&self, id: &str, filename: &str) -> PfsenseResult<()> {
        BackupManager::delete_backup(self.client(id)?, filename).await
    }

    pub async fn get_backup_history(&self, id: &str) -> PfsenseResult<Vec<BackupEntry>> {
        BackupManager::get_backup_history(self.client(id)?).await
    }

    // ── Status ───────────────────────────────────────────────────

    pub async fn get_system_status(&self, id: &str) -> PfsenseResult<SystemStatus> {
        StatusManager::get_system_status(self.client(id)?).await
    }

    pub async fn list_services(&self, id: &str) -> PfsenseResult<Vec<ServiceStatus>> {
        StatusManager::list_services(self.client(id)?).await
    }

    pub async fn get_service_status(&self, id: &str, name: &str) -> PfsenseResult<ServiceStatus> {
        StatusManager::get_service_status(self.client(id)?, name).await
    }

    pub async fn start_service(&self, id: &str, name: &str) -> PfsenseResult<()> {
        StatusManager::start_service(self.client(id)?, name).await
    }

    pub async fn stop_service(&self, id: &str, name: &str) -> PfsenseResult<()> {
        StatusManager::stop_service(self.client(id)?, name).await
    }

    pub async fn restart_service(&self, id: &str, name: &str) -> PfsenseResult<()> {
        StatusManager::restart_service(self.client(id)?, name).await
    }

    pub async fn get_traffic_graph(&self, id: &str, interface: &str) -> PfsenseResult<TrafficGraph> {
        StatusManager::get_traffic_graph(self.client(id)?, interface).await
    }

    pub async fn get_cpu_usage(&self, id: &str) -> PfsenseResult<f64> {
        StatusManager::get_cpu_usage(self.client(id)?).await
    }

    pub async fn get_memory_usage(&self, id: &str) -> PfsenseResult<(u64, u64)> {
        StatusManager::get_memory_usage(self.client(id)?).await
    }

    pub async fn get_disk_usage(&self, id: &str) -> PfsenseResult<f64> {
        StatusManager::get_disk_usage(self.client(id)?).await
    }

    pub async fn get_status_pf_info(&self, id: &str) -> PfsenseResult<PfInfo> {
        StatusManager::get_pf_info(self.client(id)?).await
    }
}
