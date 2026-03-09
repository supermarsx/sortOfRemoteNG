// ── sorng-pfsense/src/service.rs ────────────────────────────────────────────
//! Aggregate pfSense service – holds connections and delegates to domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::PfsenseClient;
use crate::error::{PfsenseError, PfsenseResult};
use crate::types::*;

use crate::backups::BackupManager;
use crate::certificates::CertificateManager;
use crate::dhcp::DhcpManager;
use crate::diagnostics::DiagnosticsManager;
use crate::dns::DnsManager;
use crate::firewall::FirewallManager;
use crate::interfaces::InterfaceManager;
use crate::nat::NatManager;
use crate::routing::RoutingManager;
use crate::services::ServiceManager;
use crate::system::SystemManager;
use crate::users::UserManager;
use crate::vpn::VpnManager;

/// Shared Tauri state handle.
pub type PfsenseServiceState = Arc<Mutex<PfsenseServiceWrapper>>;

/// Main pfSense service managing connections.
pub struct PfsenseServiceWrapper {
    connections: HashMap<String, PfsenseClient>,
}

impl Default for PfsenseServiceWrapper {
    fn default() -> Self {
        Self::new()
    }
}

impl PfsenseServiceWrapper {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    // ── Connection lifecycle ─────────────────────────────────────

    pub async fn connect(
        &mut self,
        id: String,
        config: PfsenseConnectionConfig,
    ) -> PfsenseResult<PfsenseConnectionSummary> {
        let client = PfsenseClient::new(config)?;
        let summary = client.ping().await?;
        self.connections.insert(id, client);
        Ok(summary)
    }

    pub fn disconnect(&mut self, id: &str) -> PfsenseResult<()> {
        self.connections
            .remove(id)
            .map(|_| ())
            .ok_or_else(|| PfsenseError::not_connected(format!("No connection '{id}'")))
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> PfsenseResult<&PfsenseClient> {
        self.connections
            .get(id)
            .ok_or_else(|| PfsenseError::not_connected(format!("No connection '{id}'")))
    }

    pub async fn ping(&self, id: &str) -> PfsenseResult<PfsenseConnectionSummary> {
        self.client(id)?.ping().await
    }

    // ── Interfaces ───────────────────────────────────────────────

    pub async fn list_interfaces(&self, id: &str) -> PfsenseResult<Vec<NetworkInterface>> {
        InterfaceManager::list(self.client(id)?).await
    }

    pub async fn get_interface(&self, id: &str, name: &str) -> PfsenseResult<NetworkInterface> {
        InterfaceManager::get(self.client(id)?, name).await
    }

    pub async fn create_interface(
        &self,
        id: &str,
        iface: &InterfaceConfig,
    ) -> PfsenseResult<NetworkInterface> {
        InterfaceManager::create(self.client(id)?, iface).await
    }

    pub async fn update_interface(
        &self,
        id: &str,
        name: &str,
        iface: &InterfaceConfig,
    ) -> PfsenseResult<NetworkInterface> {
        InterfaceManager::update(self.client(id)?, name, iface).await
    }

    pub async fn delete_interface(&self, id: &str, name: &str) -> PfsenseResult<()> {
        InterfaceManager::delete(self.client(id)?, name).await
    }

    pub async fn apply_interfaces(&self, id: &str) -> PfsenseResult<serde_json::Value> {
        InterfaceManager::apply(self.client(id)?).await
    }

    pub async fn get_interface_stats(&self, id: &str, name: &str) -> PfsenseResult<IfStats> {
        InterfaceManager::get_stats(self.client(id)?, name).await
    }

    pub async fn list_interface_stats(&self, id: &str) -> PfsenseResult<Vec<IfStats>> {
        InterfaceManager::list_stats(self.client(id)?).await
    }

    // ── Firewall ─────────────────────────────────────────────────

    pub async fn list_firewall_rules(&self, id: &str) -> PfsenseResult<Vec<FirewallRule>> {
        FirewallManager::list_rules(self.client(id)?).await
    }

    pub async fn get_firewall_rule(&self, id: &str, rule_id: &str) -> PfsenseResult<FirewallRule> {
        FirewallManager::get_rule(self.client(id)?, rule_id).await
    }

    pub async fn create_firewall_rule(
        &self,
        id: &str,
        rule: &FirewallRule,
    ) -> PfsenseResult<FirewallRule> {
        FirewallManager::create_rule(self.client(id)?, rule).await
    }

    pub async fn update_firewall_rule(
        &self,
        id: &str,
        rule_id: &str,
        rule: &FirewallRule,
    ) -> PfsenseResult<FirewallRule> {
        FirewallManager::update_rule(self.client(id)?, rule_id, rule).await
    }

    pub async fn delete_firewall_rule(&self, id: &str, rule_id: &str) -> PfsenseResult<()> {
        FirewallManager::delete_rule(self.client(id)?, rule_id).await
    }

    pub async fn apply_firewall_rules(&self, id: &str) -> PfsenseResult<serde_json::Value> {
        FirewallManager::apply_rules(self.client(id)?).await
    }

    pub async fn list_firewall_aliases(&self, id: &str) -> PfsenseResult<Vec<FirewallAlias>> {
        FirewallManager::list_aliases(self.client(id)?).await
    }

    pub async fn get_firewall_alias(&self, id: &str, name: &str) -> PfsenseResult<FirewallAlias> {
        FirewallManager::get_alias(self.client(id)?, name).await
    }

    pub async fn create_firewall_alias(
        &self,
        id: &str,
        alias: &FirewallAlias,
    ) -> PfsenseResult<FirewallAlias> {
        FirewallManager::create_alias(self.client(id)?, alias).await
    }

    pub async fn update_firewall_alias(
        &self,
        id: &str,
        name: &str,
        alias: &FirewallAlias,
    ) -> PfsenseResult<FirewallAlias> {
        FirewallManager::update_alias(self.client(id)?, name, alias).await
    }

    pub async fn delete_firewall_alias(&self, id: &str, name: &str) -> PfsenseResult<()> {
        FirewallManager::delete_alias(self.client(id)?, name).await
    }

    pub async fn get_firewall_states(&self, id: &str) -> PfsenseResult<Vec<FirewallState>> {
        FirewallManager::get_states(self.client(id)?).await
    }

    pub async fn get_firewall_state_count(&self, id: &str) -> PfsenseResult<u64> {
        FirewallManager::get_state_count(self.client(id)?).await
    }

    pub async fn flush_firewall_states(&self, id: &str) -> PfsenseResult<()> {
        FirewallManager::flush_states(self.client(id)?).await
    }

    // ── NAT ──────────────────────────────────────────────────────

    pub async fn list_nat_port_forwards(&self, id: &str) -> PfsenseResult<Vec<NatPortForward>> {
        NatManager::list_port_forwards(self.client(id)?).await
    }

    pub async fn get_nat_port_forward(
        &self,
        id: &str,
        fwd_id: &str,
    ) -> PfsenseResult<NatPortForward> {
        NatManager::get_port_forward(self.client(id)?, fwd_id).await
    }

    pub async fn create_nat_port_forward(
        &self,
        id: &str,
        rule: &NatPortForward,
    ) -> PfsenseResult<NatPortForward> {
        NatManager::create_port_forward(self.client(id)?, rule).await
    }

    pub async fn update_nat_port_forward(
        &self,
        id: &str,
        fwd_id: &str,
        rule: &NatPortForward,
    ) -> PfsenseResult<NatPortForward> {
        NatManager::update_port_forward(self.client(id)?, fwd_id, rule).await
    }

    pub async fn delete_nat_port_forward(&self, id: &str, fwd_id: &str) -> PfsenseResult<()> {
        NatManager::delete_port_forward(self.client(id)?, fwd_id).await
    }

    pub async fn list_nat_outbound(&self, id: &str) -> PfsenseResult<Vec<NatOutbound>> {
        NatManager::list_outbound(self.client(id)?).await
    }

    pub async fn create_nat_outbound(
        &self,
        id: &str,
        rule: &NatOutbound,
    ) -> PfsenseResult<NatOutbound> {
        NatManager::create_outbound(self.client(id)?, rule).await
    }

    pub async fn update_nat_outbound(
        &self,
        id: &str,
        out_id: &str,
        rule: &NatOutbound,
    ) -> PfsenseResult<NatOutbound> {
        NatManager::update_outbound(self.client(id)?, out_id, rule).await
    }

    pub async fn delete_nat_outbound(&self, id: &str, out_id: &str) -> PfsenseResult<()> {
        NatManager::delete_outbound(self.client(id)?, out_id).await
    }

    pub async fn list_nat_1to1(&self, id: &str) -> PfsenseResult<Vec<Nat1to1>> {
        NatManager::list_1to1(self.client(id)?).await
    }

    pub async fn create_nat_1to1(&self, id: &str, rule: &Nat1to1) -> PfsenseResult<Nat1to1> {
        NatManager::create_1to1(self.client(id)?, rule).await
    }

    pub async fn update_nat_1to1(
        &self,
        id: &str,
        rule_id: &str,
        rule: &Nat1to1,
    ) -> PfsenseResult<Nat1to1> {
        NatManager::update_1to1(self.client(id)?, rule_id, rule).await
    }

    pub async fn delete_nat_1to1(&self, id: &str, rule_id: &str) -> PfsenseResult<()> {
        NatManager::delete_1to1(self.client(id)?, rule_id).await
    }

    pub async fn apply_nat(&self, id: &str) -> PfsenseResult<serde_json::Value> {
        NatManager::apply(self.client(id)?).await
    }

    // ── DHCP ─────────────────────────────────────────────────────

    pub async fn get_dhcp_config(&self, id: &str, interface: &str) -> PfsenseResult<DhcpConfig> {
        DhcpManager::get_config(self.client(id)?, interface).await
    }

    pub async fn update_dhcp_config(
        &self,
        id: &str,
        interface: &str,
        config: &DhcpConfig,
    ) -> PfsenseResult<DhcpConfig> {
        DhcpManager::update_config(self.client(id)?, interface, config).await
    }

    pub async fn list_dhcp_leases(&self, id: &str) -> PfsenseResult<Vec<DhcpLease>> {
        DhcpManager::list_leases(self.client(id)?).await
    }

    pub async fn list_dhcp_static_mappings(
        &self,
        id: &str,
        interface: &str,
    ) -> PfsenseResult<Vec<DhcpStaticMapping>> {
        DhcpManager::list_static_mappings(self.client(id)?, interface).await
    }

    pub async fn create_dhcp_static_mapping(
        &self,
        id: &str,
        interface: &str,
        mapping: &DhcpStaticMapping,
    ) -> PfsenseResult<DhcpStaticMapping> {
        DhcpManager::create_static_mapping(self.client(id)?, interface, mapping).await
    }

    pub async fn update_dhcp_static_mapping(
        &self,
        id: &str,
        interface: &str,
        mapping_id: &str,
        mapping: &DhcpStaticMapping,
    ) -> PfsenseResult<DhcpStaticMapping> {
        DhcpManager::update_static_mapping(self.client(id)?, interface, mapping_id, mapping).await
    }

    pub async fn delete_dhcp_static_mapping(
        &self,
        id: &str,
        interface: &str,
        mapping_id: &str,
    ) -> PfsenseResult<()> {
        DhcpManager::delete_static_mapping(self.client(id)?, interface, mapping_id).await
    }

    pub async fn get_dhcp_relay(&self, id: &str) -> PfsenseResult<DhcpRelay> {
        DhcpManager::get_relay(self.client(id)?).await
    }

    pub async fn update_dhcp_relay(&self, id: &str, relay: &DhcpRelay) -> PfsenseResult<DhcpRelay> {
        DhcpManager::update_relay(self.client(id)?, relay).await
    }

    // ── DNS ──────────────────────────────────────────────────────

    pub async fn get_dns_resolver_config(&self, id: &str) -> PfsenseResult<DnsResolverConfig> {
        DnsManager::get_resolver_config(self.client(id)?).await
    }

    pub async fn update_dns_resolver_config(
        &self,
        id: &str,
        config: &DnsResolverConfig,
    ) -> PfsenseResult<DnsResolverConfig> {
        DnsManager::update_resolver_config(self.client(id)?, config).await
    }

    pub async fn get_dns_forwarder_config(&self, id: &str) -> PfsenseResult<DnsForwarderConfig> {
        DnsManager::get_forwarder_config(self.client(id)?).await
    }

    pub async fn update_dns_forwarder_config(
        &self,
        id: &str,
        config: &DnsForwarderConfig,
    ) -> PfsenseResult<DnsForwarderConfig> {
        DnsManager::update_forwarder_config(self.client(id)?, config).await
    }

    pub async fn list_dns_host_overrides(&self, id: &str) -> PfsenseResult<Vec<DnsHostOverride>> {
        DnsManager::list_host_overrides(self.client(id)?).await
    }

    pub async fn create_dns_host_override(
        &self,
        id: &str,
        entry: &DnsHostOverride,
    ) -> PfsenseResult<DnsHostOverride> {
        DnsManager::create_host_override(self.client(id)?, entry).await
    }

    pub async fn update_dns_host_override(
        &self,
        id: &str,
        override_id: &str,
        entry: &DnsHostOverride,
    ) -> PfsenseResult<DnsHostOverride> {
        DnsManager::update_host_override(self.client(id)?, override_id, entry).await
    }

    pub async fn delete_dns_host_override(&self, id: &str, override_id: &str) -> PfsenseResult<()> {
        DnsManager::delete_host_override(self.client(id)?, override_id).await
    }

    pub async fn list_dns_domain_overrides(
        &self,
        id: &str,
    ) -> PfsenseResult<Vec<DnsDomainOverride>> {
        DnsManager::list_domain_overrides(self.client(id)?).await
    }

    pub async fn create_dns_domain_override(
        &self,
        id: &str,
        entry: &DnsDomainOverride,
    ) -> PfsenseResult<DnsDomainOverride> {
        DnsManager::create_domain_override(self.client(id)?, entry).await
    }

    pub async fn update_dns_domain_override(
        &self,
        id: &str,
        override_id: &str,
        entry: &DnsDomainOverride,
    ) -> PfsenseResult<DnsDomainOverride> {
        DnsManager::update_domain_override(self.client(id)?, override_id, entry).await
    }

    pub async fn delete_dns_domain_override(
        &self,
        id: &str,
        override_id: &str,
    ) -> PfsenseResult<()> {
        DnsManager::delete_domain_override(self.client(id)?, override_id).await
    }

    pub async fn flush_dns_cache(&self, id: &str) -> PfsenseResult<serde_json::Value> {
        DnsManager::flush_cache(self.client(id)?).await
    }

    pub async fn get_dns_cache_stats(&self, id: &str) -> PfsenseResult<DnsCacheStats> {
        DnsManager::get_cache_stats(self.client(id)?).await
    }

    // ── VPN ──────────────────────────────────────────────────────

    pub async fn list_openvpn_servers(&self, id: &str) -> PfsenseResult<Vec<OpenVpnServer>> {
        VpnManager::list_openvpn_servers(self.client(id)?).await
    }

    pub async fn get_openvpn_server(&self, id: &str, vpnid: u32) -> PfsenseResult<OpenVpnServer> {
        VpnManager::get_openvpn_server(self.client(id)?, vpnid).await
    }

    pub async fn create_openvpn_server(
        &self,
        id: &str,
        server: &OpenVpnServer,
    ) -> PfsenseResult<OpenVpnServer> {
        VpnManager::create_openvpn_server(self.client(id)?, server).await
    }

    pub async fn delete_openvpn_server(&self, id: &str, vpnid: u32) -> PfsenseResult<()> {
        VpnManager::delete_openvpn_server(self.client(id)?, vpnid).await
    }

    pub async fn list_openvpn_clients(&self, id: &str) -> PfsenseResult<Vec<OpenVpnClient>> {
        VpnManager::list_openvpn_clients(self.client(id)?).await
    }

    pub async fn get_openvpn_client(&self, id: &str, vpnid: u32) -> PfsenseResult<OpenVpnClient> {
        VpnManager::get_openvpn_client(self.client(id)?, vpnid).await
    }

    pub async fn create_openvpn_client(
        &self,
        id: &str,
        vpn_client: &OpenVpnClient,
    ) -> PfsenseResult<OpenVpnClient> {
        VpnManager::create_openvpn_client(self.client(id)?, vpn_client).await
    }

    pub async fn delete_openvpn_client(&self, id: &str, vpnid: u32) -> PfsenseResult<()> {
        VpnManager::delete_openvpn_client(self.client(id)?, vpnid).await
    }

    pub async fn list_ipsec_tunnels(&self, id: &str) -> PfsenseResult<Vec<IpsecTunnel>> {
        VpnManager::list_ipsec_tunnels(self.client(id)?).await
    }

    pub async fn get_ipsec_tunnel(&self, id: &str, ikeid: u32) -> PfsenseResult<IpsecTunnel> {
        VpnManager::get_ipsec_tunnel(self.client(id)?, ikeid).await
    }

    pub async fn create_ipsec_tunnel(
        &self,
        id: &str,
        tunnel: &IpsecTunnel,
    ) -> PfsenseResult<IpsecTunnel> {
        VpnManager::create_ipsec_tunnel(self.client(id)?, tunnel).await
    }

    pub async fn delete_ipsec_tunnel(&self, id: &str, ikeid: u32) -> PfsenseResult<()> {
        VpnManager::delete_ipsec_tunnel(self.client(id)?, ikeid).await
    }

    pub async fn list_wireguard_tunnels(&self, id: &str) -> PfsenseResult<Vec<WireGuardTunnel>> {
        VpnManager::list_wireguard_tunnels(self.client(id)?).await
    }

    pub async fn get_wireguard_tunnel(
        &self,
        id: &str,
        tun_id: &str,
    ) -> PfsenseResult<WireGuardTunnel> {
        VpnManager::get_wireguard_tunnel(self.client(id)?, tun_id).await
    }

    pub async fn create_wireguard_tunnel(
        &self,
        id: &str,
        tunnel: &WireGuardTunnel,
    ) -> PfsenseResult<WireGuardTunnel> {
        VpnManager::create_wireguard_tunnel(self.client(id)?, tunnel).await
    }

    pub async fn delete_wireguard_tunnel(&self, id: &str, tun_id: &str) -> PfsenseResult<()> {
        VpnManager::delete_wireguard_tunnel(self.client(id)?, tun_id).await
    }

    pub async fn list_wireguard_peers(
        &self,
        id: &str,
        tunnel_id: &str,
    ) -> PfsenseResult<Vec<WireGuardPeer>> {
        VpnManager::list_wireguard_peers(self.client(id)?, tunnel_id).await
    }

    pub async fn create_wireguard_peer(
        &self,
        id: &str,
        peer: &WireGuardPeer,
    ) -> PfsenseResult<WireGuardPeer> {
        VpnManager::create_wireguard_peer(self.client(id)?, peer).await
    }

    pub async fn delete_wireguard_peer(&self, id: &str, peer_id: &str) -> PfsenseResult<()> {
        VpnManager::delete_wireguard_peer(self.client(id)?, peer_id).await
    }

    // ── Routing ──────────────────────────────────────────────────

    pub async fn list_routes(&self, id: &str) -> PfsenseResult<Vec<StaticRoute>> {
        RoutingManager::list_routes(self.client(id)?).await
    }

    pub async fn get_route(&self, id: &str, route_id: &str) -> PfsenseResult<StaticRoute> {
        RoutingManager::get_route(self.client(id)?, route_id).await
    }

    pub async fn create_route(&self, id: &str, route: &StaticRoute) -> PfsenseResult<StaticRoute> {
        RoutingManager::create_route(self.client(id)?, route).await
    }

    pub async fn update_route(
        &self,
        id: &str,
        route_id: &str,
        route: &StaticRoute,
    ) -> PfsenseResult<StaticRoute> {
        RoutingManager::update_route(self.client(id)?, route_id, route).await
    }

    pub async fn delete_route(&self, id: &str, route_id: &str) -> PfsenseResult<()> {
        RoutingManager::delete_route(self.client(id)?, route_id).await
    }

    pub async fn list_gateways(&self, id: &str) -> PfsenseResult<Vec<Gateway>> {
        RoutingManager::list_gateways(self.client(id)?).await
    }

    pub async fn get_gateway(&self, id: &str, name: &str) -> PfsenseResult<Gateway> {
        RoutingManager::get_gateway(self.client(id)?, name).await
    }

    pub async fn create_gateway(&self, id: &str, gw: &Gateway) -> PfsenseResult<Gateway> {
        RoutingManager::create_gateway(self.client(id)?, gw).await
    }

    pub async fn delete_gateway(&self, id: &str, name: &str) -> PfsenseResult<()> {
        RoutingManager::delete_gateway(self.client(id)?, name).await
    }

    pub async fn get_gateway_status(&self, id: &str) -> PfsenseResult<Vec<GatewayStatus>> {
        RoutingManager::get_gateway_status(self.client(id)?).await
    }

    pub async fn get_routing_table(&self, id: &str) -> PfsenseResult<Vec<RoutingTableEntry>> {
        RoutingManager::get_routing_table(self.client(id)?).await
    }

    // ── Services ─────────────────────────────────────────────────

    pub async fn list_services(&self, id: &str) -> PfsenseResult<Vec<PfsenseService>> {
        ServiceManager::list(self.client(id)?).await
    }

    pub async fn get_service_status(&self, id: &str, name: &str) -> PfsenseResult<ServiceStatus> {
        ServiceManager::get_status(self.client(id)?, name).await
    }

    pub async fn start_service(&self, id: &str, name: &str) -> PfsenseResult<serde_json::Value> {
        ServiceManager::start(self.client(id)?, name).await
    }

    pub async fn stop_service(&self, id: &str, name: &str) -> PfsenseResult<serde_json::Value> {
        ServiceManager::stop(self.client(id)?, name).await
    }

    pub async fn restart_service(&self, id: &str, name: &str) -> PfsenseResult<serde_json::Value> {
        ServiceManager::restart(self.client(id)?, name).await
    }

    // ── System ───────────────────────────────────────────────────

    pub async fn get_system_info(&self, id: &str) -> PfsenseResult<SystemInfo> {
        SystemManager::get_info(self.client(id)?).await
    }

    pub async fn get_system_updates(&self, id: &str) -> PfsenseResult<SystemUpdate> {
        SystemManager::get_updates(self.client(id)?).await
    }

    pub async fn get_general_config(&self, id: &str) -> PfsenseResult<GeneralConfig> {
        SystemManager::get_general_config(self.client(id)?).await
    }

    pub async fn update_general_config(
        &self,
        id: &str,
        config: &GeneralConfig,
    ) -> PfsenseResult<GeneralConfig> {
        SystemManager::update_general_config(self.client(id)?, config).await
    }

    pub async fn get_advanced_config(&self, id: &str) -> PfsenseResult<AdvancedConfig> {
        SystemManager::get_advanced_config(self.client(id)?).await
    }

    pub async fn update_advanced_config(
        &self,
        id: &str,
        config: &AdvancedConfig,
    ) -> PfsenseResult<AdvancedConfig> {
        SystemManager::update_advanced_config(self.client(id)?, config).await
    }

    pub async fn reboot(&self, id: &str) -> PfsenseResult<serde_json::Value> {
        SystemManager::reboot(self.client(id)?).await
    }

    pub async fn halt(&self, id: &str) -> PfsenseResult<serde_json::Value> {
        SystemManager::halt(self.client(id)?).await
    }

    // ── Certificates ─────────────────────────────────────────────

    pub async fn list_cas(&self, id: &str) -> PfsenseResult<Vec<CaCertificate>> {
        CertificateManager::list_cas(self.client(id)?).await
    }

    pub async fn get_ca(&self, id: &str, refid: &str) -> PfsenseResult<CaCertificate> {
        CertificateManager::get_ca(self.client(id)?, refid).await
    }

    pub async fn create_ca(
        &self,
        id: &str,
        req: &CertificateRequest,
    ) -> PfsenseResult<CaCertificate> {
        CertificateManager::create_ca(self.client(id)?, req).await
    }

    pub async fn delete_ca(&self, id: &str, refid: &str) -> PfsenseResult<()> {
        CertificateManager::delete_ca(self.client(id)?, refid).await
    }

    pub async fn list_certs(&self, id: &str) -> PfsenseResult<Vec<ServerCertificate>> {
        CertificateManager::list_certs(self.client(id)?).await
    }

    pub async fn get_cert(&self, id: &str, refid: &str) -> PfsenseResult<ServerCertificate> {
        CertificateManager::get_cert(self.client(id)?, refid).await
    }

    pub async fn create_cert(
        &self,
        id: &str,
        req: &CertificateRequest,
    ) -> PfsenseResult<ServerCertificate> {
        CertificateManager::create_cert(self.client(id)?, req).await
    }

    pub async fn delete_cert(&self, id: &str, refid: &str) -> PfsenseResult<()> {
        CertificateManager::delete_cert(self.client(id)?, refid).await
    }

    pub async fn export_cert(&self, id: &str, refid: &str) -> PfsenseResult<Vec<u8>> {
        CertificateManager::export_cert(self.client(id)?, refid).await
    }

    // ── Users ────────────────────────────────────────────────────

    pub async fn list_users(&self, id: &str) -> PfsenseResult<Vec<PfsenseUser>> {
        UserManager::list(self.client(id)?).await
    }

    pub async fn get_user(&self, id: &str, name: &str) -> PfsenseResult<PfsenseUser> {
        UserManager::get(self.client(id)?, name).await
    }

    pub async fn create_user(&self, id: &str, user: &PfsenseUser) -> PfsenseResult<PfsenseUser> {
        UserManager::create(self.client(id)?, user).await
    }

    pub async fn update_user(
        &self,
        id: &str,
        name: &str,
        user: &PfsenseUser,
    ) -> PfsenseResult<PfsenseUser> {
        UserManager::update(self.client(id)?, name, user).await
    }

    pub async fn delete_user(&self, id: &str, name: &str) -> PfsenseResult<()> {
        UserManager::delete(self.client(id)?, name).await
    }

    pub async fn list_groups(&self, id: &str) -> PfsenseResult<Vec<PfsenseGroup>> {
        UserManager::list_groups(self.client(id)?).await
    }

    pub async fn get_group(&self, id: &str, name: &str) -> PfsenseResult<PfsenseGroup> {
        UserManager::get_group(self.client(id)?, name).await
    }

    pub async fn create_group(
        &self,
        id: &str,
        group: &PfsenseGroup,
    ) -> PfsenseResult<PfsenseGroup> {
        UserManager::create_group(self.client(id)?, group).await
    }

    pub async fn delete_group(&self, id: &str, name: &str) -> PfsenseResult<()> {
        UserManager::delete_group(self.client(id)?, name).await
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

    pub async fn dns_lookup(
        &self,
        id: &str,
        host: &str,
        record_type: Option<&str>,
        server: Option<&str>,
    ) -> PfsenseResult<DnsLookupResult> {
        DiagnosticsManager::dns_lookup(self.client(id)?, host, record_type, server).await
    }

    pub async fn diag_ping(
        &self,
        id: &str,
        host: &str,
        count: Option<u32>,
        source: Option<&str>,
    ) -> PfsenseResult<PingResult> {
        DiagnosticsManager::ping(self.client(id)?, host, count, source).await
    }

    pub async fn traceroute(
        &self,
        id: &str,
        host: &str,
        max_hops: Option<u32>,
        source: Option<&str>,
    ) -> PfsenseResult<TraceResult> {
        DiagnosticsManager::traceroute(self.client(id)?, host, max_hops, source).await
    }

    pub async fn get_pfinfo(&self, id: &str) -> PfsenseResult<serde_json::Value> {
        DiagnosticsManager::get_pfinfo(self.client(id)?).await
    }

    pub async fn get_system_log(
        &self,
        id: &str,
        log_name: &str,
        count: Option<u32>,
    ) -> PfsenseResult<Vec<String>> {
        DiagnosticsManager::get_system_log(self.client(id)?, log_name, count).await
    }

    // ── Backups ──────────────────────────────────────────────────

    pub async fn list_backups(&self, id: &str) -> PfsenseResult<Vec<BackupEntry>> {
        BackupManager::list(self.client(id)?).await
    }

    pub async fn create_backup(
        &self,
        id: &str,
        config: &BackupConfig,
    ) -> PfsenseResult<BackupEntry> {
        BackupManager::create(self.client(id)?, config).await
    }

    pub async fn download_backup(&self, id: &str, backup_id: &str) -> PfsenseResult<Vec<u8>> {
        BackupManager::download(self.client(id)?, backup_id).await
    }

    pub async fn delete_backup(&self, id: &str, backup_id: &str) -> PfsenseResult<()> {
        BackupManager::delete(self.client(id)?, backup_id).await
    }

    pub async fn restore_backup(
        &self,
        id: &str,
        config_data: &[u8],
        decrypt_password: Option<&str>,
    ) -> PfsenseResult<serde_json::Value> {
        BackupManager::restore(self.client(id)?, config_data, decrypt_password).await
    }
}
