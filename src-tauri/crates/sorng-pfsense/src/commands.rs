// ── sorng-pfsense/src/commands.rs ───────────────────────────────────────────
// Tauri commands – thin wrappers around `PfsenseServiceWrapper`.

use tauri::State;

use super::service::PfsenseServiceState;
use super::types::*;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ── Connection ────────────────────────────────────────────────────

#[tauri::command]
pub async fn pfsense_connect(
    state: State<'_, PfsenseServiceState>,
    id: String,
    config: PfsenseConnectionConfig,
) -> CmdResult<PfsenseConnectionSummary> {
    state
        .lock()
        .await
        .connect(id, config)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_disconnect(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.disconnect(&id).map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_list_connections(
    state: State<'_, PfsenseServiceState>,
) -> CmdResult<Vec<String>> {
    Ok(state.lock().await.list_connections())
}

#[tauri::command]
pub async fn pfsense_ping(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<PfsenseConnectionSummary> {
    state.lock().await.ping(&id).await.map_err(map_err)
}

// ── Interfaces ────────────────────────────────────────────────────

#[tauri::command]
pub async fn pfsense_list_interfaces(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<Vec<NetworkInterface>> {
    state
        .lock()
        .await
        .list_interfaces(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_get_interface(
    state: State<'_, PfsenseServiceState>,
    id: String,
    name: String,
) -> CmdResult<NetworkInterface> {
    state
        .lock()
        .await
        .get_interface(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_create_interface(
    state: State<'_, PfsenseServiceState>,
    id: String,
    iface: InterfaceConfig,
) -> CmdResult<NetworkInterface> {
    state
        .lock()
        .await
        .create_interface(&id, &iface)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_update_interface(
    state: State<'_, PfsenseServiceState>,
    id: String,
    name: String,
    iface: InterfaceConfig,
) -> CmdResult<NetworkInterface> {
    state
        .lock()
        .await
        .update_interface(&id, &name, &iface)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_delete_interface(
    state: State<'_, PfsenseServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_interface(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_apply_interfaces(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .apply_interfaces(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_list_interface_stats(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<Vec<IfStats>> {
    state
        .lock()
        .await
        .list_interface_stats(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_apply_interface_changes(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .apply_interfaces(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_get_interface_stats(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<Vec<IfStats>> {
    state
        .lock()
        .await
        .list_interface_stats(&id)
        .await
        .map_err(map_err)
}

// ── Firewall ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn pfsense_list_firewall_rules(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<Vec<FirewallRule>> {
    state
        .lock()
        .await
        .list_firewall_rules(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_get_firewall_rule(
    state: State<'_, PfsenseServiceState>,
    id: String,
    rule_id: String,
) -> CmdResult<FirewallRule> {
    state
        .lock()
        .await
        .get_firewall_rule(&id, &rule_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_create_firewall_rule(
    state: State<'_, PfsenseServiceState>,
    id: String,
    rule: FirewallRule,
) -> CmdResult<FirewallRule> {
    state
        .lock()
        .await
        .create_firewall_rule(&id, &rule)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_update_firewall_rule(
    state: State<'_, PfsenseServiceState>,
    id: String,
    rule_id: String,
    rule: FirewallRule,
) -> CmdResult<FirewallRule> {
    state
        .lock()
        .await
        .update_firewall_rule(&id, &rule_id, &rule)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_delete_firewall_rule(
    state: State<'_, PfsenseServiceState>,
    id: String,
    rule_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_firewall_rule(&id, &rule_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_apply_firewall_rules(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .apply_firewall_rules(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_list_firewall_aliases(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<Vec<FirewallAlias>> {
    state
        .lock()
        .await
        .list_firewall_aliases(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_get_firewall_alias(
    state: State<'_, PfsenseServiceState>,
    id: String,
    name: String,
) -> CmdResult<FirewallAlias> {
    state
        .lock()
        .await
        .get_firewall_alias(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_create_firewall_alias(
    state: State<'_, PfsenseServiceState>,
    id: String,
    alias: FirewallAlias,
) -> CmdResult<FirewallAlias> {
    state
        .lock()
        .await
        .create_firewall_alias(&id, &alias)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_update_firewall_alias(
    state: State<'_, PfsenseServiceState>,
    id: String,
    name: String,
    alias: FirewallAlias,
) -> CmdResult<FirewallAlias> {
    state
        .lock()
        .await
        .update_firewall_alias(&id, &name, &alias)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_delete_firewall_alias(
    state: State<'_, PfsenseServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_firewall_alias(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_get_firewall_states(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<Vec<FirewallState>> {
    state
        .lock()
        .await
        .get_firewall_states(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_flush_firewall_states(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .flush_firewall_states(&id)
        .await
        .map_err(map_err)
}

// ── NAT ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn pfsense_list_nat_port_forwards(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<Vec<NatPortForward>> {
    state
        .lock()
        .await
        .list_nat_port_forwards(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_create_nat_port_forward(
    state: State<'_, PfsenseServiceState>,
    id: String,
    rule: NatPortForward,
) -> CmdResult<NatPortForward> {
    state
        .lock()
        .await
        .create_nat_port_forward(&id, &rule)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_update_nat_port_forward(
    state: State<'_, PfsenseServiceState>,
    id: String,
    fwd_id: String,
    rule: NatPortForward,
) -> CmdResult<NatPortForward> {
    state
        .lock()
        .await
        .update_nat_port_forward(&id, &fwd_id, &rule)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_delete_nat_port_forward(
    state: State<'_, PfsenseServiceState>,
    id: String,
    fwd_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_nat_port_forward(&id, &fwd_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_list_nat_outbound(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<Vec<NatOutbound>> {
    state
        .lock()
        .await
        .list_nat_outbound(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_create_nat_outbound(
    state: State<'_, PfsenseServiceState>,
    id: String,
    rule: NatOutbound,
) -> CmdResult<NatOutbound> {
    state
        .lock()
        .await
        .create_nat_outbound(&id, &rule)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_update_nat_outbound(
    state: State<'_, PfsenseServiceState>,
    id: String,
    out_id: String,
    rule: NatOutbound,
) -> CmdResult<NatOutbound> {
    state
        .lock()
        .await
        .update_nat_outbound(&id, &out_id, &rule)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_delete_nat_outbound(
    state: State<'_, PfsenseServiceState>,
    id: String,
    out_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_nat_outbound(&id, &out_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_list_nat_1to1(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<Vec<Nat1to1>> {
    state.lock().await.list_nat_1to1(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_create_nat_1to1(
    state: State<'_, PfsenseServiceState>,
    id: String,
    rule: Nat1to1,
) -> CmdResult<Nat1to1> {
    state
        .lock()
        .await
        .create_nat_1to1(&id, &rule)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_update_nat_1to1(
    state: State<'_, PfsenseServiceState>,
    id: String,
    rule_id: String,
    rule: Nat1to1,
) -> CmdResult<Nat1to1> {
    state
        .lock()
        .await
        .update_nat_1to1(&id, &rule_id, &rule)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_delete_nat_1to1(
    state: State<'_, PfsenseServiceState>,
    id: String,
    rule_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_nat_1to1(&id, &rule_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_apply_nat(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<serde_json::Value> {
    state.lock().await.apply_nat(&id).await.map_err(map_err)
}

// ── DHCP ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn pfsense_get_dhcp_config(
    state: State<'_, PfsenseServiceState>,
    id: String,
    interface: String,
) -> CmdResult<DhcpConfig> {
    state
        .lock()
        .await
        .get_dhcp_config(&id, &interface)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_update_dhcp_config(
    state: State<'_, PfsenseServiceState>,
    id: String,
    interface: String,
    config: DhcpConfig,
) -> CmdResult<DhcpConfig> {
    state
        .lock()
        .await
        .update_dhcp_config(&id, &interface, &config)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_list_dhcp_leases(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<Vec<DhcpLease>> {
    state
        .lock()
        .await
        .list_dhcp_leases(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_list_dhcp_static_mappings(
    state: State<'_, PfsenseServiceState>,
    id: String,
    interface: String,
) -> CmdResult<Vec<DhcpStaticMapping>> {
    state
        .lock()
        .await
        .list_dhcp_static_mappings(&id, &interface)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_create_dhcp_static_mapping(
    state: State<'_, PfsenseServiceState>,
    id: String,
    interface: String,
    mapping: DhcpStaticMapping,
) -> CmdResult<DhcpStaticMapping> {
    state
        .lock()
        .await
        .create_dhcp_static_mapping(&id, &interface, &mapping)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_update_dhcp_static_mapping(
    state: State<'_, PfsenseServiceState>,
    id: String,
    interface: String,
    mapping_id: String,
    mapping: DhcpStaticMapping,
) -> CmdResult<DhcpStaticMapping> {
    state
        .lock()
        .await
        .update_dhcp_static_mapping(&id, &interface, &mapping_id, &mapping)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_delete_dhcp_static_mapping(
    state: State<'_, PfsenseServiceState>,
    id: String,
    interface: String,
    mapping_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_dhcp_static_mapping(&id, &interface, &mapping_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_get_dhcp_relay(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<DhcpRelay> {
    state
        .lock()
        .await
        .get_dhcp_relay(&id)
        .await
        .map_err(map_err)
}

// ── DNS ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn pfsense_get_dns_resolver_config(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<DnsResolverConfig> {
    state
        .lock()
        .await
        .get_dns_resolver_config(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_update_dns_resolver_config(
    state: State<'_, PfsenseServiceState>,
    id: String,
    config: DnsResolverConfig,
) -> CmdResult<DnsResolverConfig> {
    state
        .lock()
        .await
        .update_dns_resolver_config(&id, &config)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_list_dns_host_overrides(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<Vec<DnsHostOverride>> {
    state
        .lock()
        .await
        .list_dns_host_overrides(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_create_dns_host_override(
    state: State<'_, PfsenseServiceState>,
    id: String,
    entry: DnsHostOverride,
) -> CmdResult<DnsHostOverride> {
    state
        .lock()
        .await
        .create_dns_host_override(&id, &entry)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_delete_dns_host_override(
    state: State<'_, PfsenseServiceState>,
    id: String,
    override_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_dns_host_override(&id, &override_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_list_dns_domain_overrides(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<Vec<DnsDomainOverride>> {
    state
        .lock()
        .await
        .list_dns_domain_overrides(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_flush_dns_cache(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .flush_dns_cache(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_get_dns_cache_stats(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<DnsCacheStats> {
    state
        .lock()
        .await
        .get_dns_cache_stats(&id)
        .await
        .map_err(map_err)
}

// ── VPN ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn pfsense_list_openvpn_servers(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<Vec<OpenVpnServer>> {
    state
        .lock()
        .await
        .list_openvpn_servers(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_get_openvpn_server(
    state: State<'_, PfsenseServiceState>,
    id: String,
    vpnid: u32,
) -> CmdResult<OpenVpnServer> {
    state
        .lock()
        .await
        .get_openvpn_server(&id, vpnid)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_create_openvpn_server(
    state: State<'_, PfsenseServiceState>,
    id: String,
    server: OpenVpnServer,
) -> CmdResult<OpenVpnServer> {
    state
        .lock()
        .await
        .create_openvpn_server(&id, &server)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_delete_openvpn_server(
    state: State<'_, PfsenseServiceState>,
    id: String,
    vpnid: u32,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_openvpn_server(&id, vpnid)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_list_openvpn_clients(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<Vec<OpenVpnClient>> {
    state
        .lock()
        .await
        .list_openvpn_clients(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_list_ipsec_tunnels(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<Vec<IpsecTunnel>> {
    state
        .lock()
        .await
        .list_ipsec_tunnels(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_list_wireguard_tunnels(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<Vec<WireGuardTunnel>> {
    state
        .lock()
        .await
        .list_wireguard_tunnels(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_list_wireguard_peers(
    state: State<'_, PfsenseServiceState>,
    id: String,
    tunnel_id: String,
) -> CmdResult<Vec<WireGuardPeer>> {
    state
        .lock()
        .await
        .list_wireguard_peers(&id, &tunnel_id)
        .await
        .map_err(map_err)
}

// ── Routing ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn pfsense_list_routes(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<Vec<StaticRoute>> {
    state.lock().await.list_routes(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_create_route(
    state: State<'_, PfsenseServiceState>,
    id: String,
    route: StaticRoute,
) -> CmdResult<StaticRoute> {
    state
        .lock()
        .await
        .create_route(&id, &route)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_delete_route(
    state: State<'_, PfsenseServiceState>,
    id: String,
    route_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_route(&id, &route_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_list_gateways(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<Vec<Gateway>> {
    state.lock().await.list_gateways(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_get_gateway_status(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<Vec<GatewayStatus>> {
    state
        .lock()
        .await
        .get_gateway_status(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_get_routing_table(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<Vec<RoutingTableEntry>> {
    state
        .lock()
        .await
        .get_routing_table(&id)
        .await
        .map_err(map_err)
}

// ── Services ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn pfsense_list_services(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<Vec<PfsenseService>> {
    state.lock().await.list_services(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_get_service_status(
    state: State<'_, PfsenseServiceState>,
    id: String,
    name: String,
) -> CmdResult<ServiceStatus> {
    state
        .lock()
        .await
        .get_service_status(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_start_service(
    state: State<'_, PfsenseServiceState>,
    id: String,
    name: String,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .start_service(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_stop_service(
    state: State<'_, PfsenseServiceState>,
    id: String,
    name: String,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .stop_service(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_restart_service(
    state: State<'_, PfsenseServiceState>,
    id: String,
    name: String,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .restart_service(&id, &name)
        .await
        .map_err(map_err)
}

// ── System ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn pfsense_get_system_info(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<SystemInfo> {
    state
        .lock()
        .await
        .get_system_info(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_get_system_updates(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<SystemUpdate> {
    state
        .lock()
        .await
        .get_system_updates(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_get_general_config(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<GeneralConfig> {
    state
        .lock()
        .await
        .get_general_config(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_update_general_config(
    state: State<'_, PfsenseServiceState>,
    id: String,
    config: GeneralConfig,
) -> CmdResult<GeneralConfig> {
    state
        .lock()
        .await
        .update_general_config(&id, &config)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_reboot(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<serde_json::Value> {
    state.lock().await.reboot(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_halt(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<serde_json::Value> {
    state.lock().await.halt(&id).await.map_err(map_err)
}

// ── Certificates ──────────────────────────────────────────────────

#[tauri::command]
pub async fn pfsense_list_cas(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<Vec<CaCertificate>> {
    state.lock().await.list_cas(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_list_certs(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<Vec<ServerCertificate>> {
    state.lock().await.list_certs(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_create_cert(
    state: State<'_, PfsenseServiceState>,
    id: String,
    req: CertificateRequest,
) -> CmdResult<ServerCertificate> {
    state
        .lock()
        .await
        .create_cert(&id, &req)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_delete_cert(
    state: State<'_, PfsenseServiceState>,
    id: String,
    refid: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_cert(&id, &refid)
        .await
        .map_err(map_err)
}

// ── Users ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn pfsense_list_users(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<Vec<PfsenseUser>> {
    state.lock().await.list_users(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_get_user(
    state: State<'_, PfsenseServiceState>,
    id: String,
    name: String,
) -> CmdResult<PfsenseUser> {
    state
        .lock()
        .await
        .get_user(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_create_user(
    state: State<'_, PfsenseServiceState>,
    id: String,
    user: PfsenseUser,
) -> CmdResult<PfsenseUser> {
    state
        .lock()
        .await
        .create_user(&id, &user)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_delete_user(
    state: State<'_, PfsenseServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_user(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_list_groups(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<Vec<PfsenseGroup>> {
    state.lock().await.list_groups(&id).await.map_err(map_err)
}

// ── Diagnostics ───────────────────────────────────────────────────

#[tauri::command]
pub async fn pfsense_get_arp_table(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<Vec<ArpEntry>> {
    state.lock().await.get_arp_table(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_get_ndp_table(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<Vec<NdpEntry>> {
    state.lock().await.get_ndp_table(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_dns_lookup(
    state: State<'_, PfsenseServiceState>,
    id: String,
    host: String,
    record_type: Option<String>,
    server: Option<String>,
) -> CmdResult<DnsLookupResult> {
    state
        .lock()
        .await
        .dns_lookup(&id, &host, record_type.as_deref(), server.as_deref())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_diag_ping(
    state: State<'_, PfsenseServiceState>,
    id: String,
    host: String,
    count: Option<u32>,
    source: Option<String>,
) -> CmdResult<PingResult> {
    state
        .lock()
        .await
        .diag_ping(&id, &host, count, source.as_deref())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_traceroute(
    state: State<'_, PfsenseServiceState>,
    id: String,
    host: String,
    max_hops: Option<u32>,
    source: Option<String>,
) -> CmdResult<TraceResult> {
    state
        .lock()
        .await
        .traceroute(&id, &host, max_hops, source.as_deref())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_get_pfinfo(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<serde_json::Value> {
    state.lock().await.get_pfinfo(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_get_system_log(
    state: State<'_, PfsenseServiceState>,
    id: String,
    log_name: String,
    count: Option<u32>,
) -> CmdResult<Vec<String>> {
    state
        .lock()
        .await
        .get_system_log(&id, &log_name, count)
        .await
        .map_err(map_err)
}

// ── Backups ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn pfsense_list_backups(
    state: State<'_, PfsenseServiceState>,
    id: String,
) -> CmdResult<Vec<BackupEntry>> {
    state.lock().await.list_backups(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_create_backup(
    state: State<'_, PfsenseServiceState>,
    id: String,
    config: BackupConfig,
) -> CmdResult<BackupEntry> {
    state
        .lock()
        .await
        .create_backup(&id, &config)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pfsense_delete_backup(
    state: State<'_, PfsenseServiceState>,
    id: String,
    backup_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_backup(&id, &backup_id)
        .await
        .map_err(map_err)
}
