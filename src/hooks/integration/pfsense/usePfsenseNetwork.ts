// pfSense — "Network & Firewall" invoke slice + hook (t42-pfsense-c1).
//
// `pfsenseNetworkApi` is a thin 1:1 wrapper over the 49 `pfsense_*` Network &
// Firewall commands (Interfaces 9, Firewall 13, NAT 13, Routing 6, VPN 8).
// Every command's first arg is the live connection `id`. Non-obvious camelCase
// arg names (Tauri camelCases command params): `ruleId`, `fwdId`, `outId`,
// `routeId`, `tunnelId`, `vpnid` (already lowercase), `iface`.
//
// Payload/return STRUCT fields are snake_case on the wire — see `network.ts`.

import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type {
  FirewallAlias,
  FirewallRule,
  FirewallState,
  Gateway,
  GatewayStatus,
  IfStats,
  InterfaceConfig,
  IpsecTunnel,
  Nat1to1,
  NatOutbound,
  NatPortForward,
  NetworkInterface,
  OpenVpnClient,
  OpenVpnServer,
  RoutingTableEntry,
  StaticRoute,
  WireGuardPeer,
  WireGuardTunnel,
} from "../../../types/pfsense/network";

/** Opaque JSON returned by the `apply_*` / `flush_*` commands. */
type ApplyResult = unknown;

export const pfsenseNetworkApi = {
  // ── Interfaces (9) ─────────────────────────────────────────────
  listInterfaces: (id: string) =>
    invoke<NetworkInterface[]>("pfsense_list_interfaces", { id }),
  getInterface: (id: string, name: string) =>
    invoke<NetworkInterface>("pfsense_get_interface", { id, name }),
  createInterface: (id: string, iface: InterfaceConfig) =>
    invoke<NetworkInterface>("pfsense_create_interface", { id, iface }),
  updateInterface: (id: string, name: string, iface: InterfaceConfig) =>
    invoke<NetworkInterface>("pfsense_update_interface", { id, name, iface }),
  deleteInterface: (id: string, name: string) =>
    invoke<void>("pfsense_delete_interface", { id, name }),
  applyInterfaces: (id: string) =>
    invoke<ApplyResult>("pfsense_apply_interfaces", { id }),
  listInterfaceStats: (id: string) =>
    invoke<IfStats[]>("pfsense_list_interface_stats", { id }),
  applyInterfaceChanges: (id: string) =>
    invoke<ApplyResult>("pfsense_apply_interface_changes", { id }),
  getInterfaceStats: (id: string) =>
    invoke<IfStats[]>("pfsense_get_interface_stats", { id }),

  // ── Firewall (13) ──────────────────────────────────────────────
  listFirewallRules: (id: string) =>
    invoke<FirewallRule[]>("pfsense_list_firewall_rules", { id }),
  getFirewallRule: (id: string, ruleId: string) =>
    invoke<FirewallRule>("pfsense_get_firewall_rule", { id, ruleId }),
  createFirewallRule: (id: string, rule: FirewallRule) =>
    invoke<FirewallRule>("pfsense_create_firewall_rule", { id, rule }),
  updateFirewallRule: (id: string, ruleId: string, rule: FirewallRule) =>
    invoke<FirewallRule>("pfsense_update_firewall_rule", { id, ruleId, rule }),
  deleteFirewallRule: (id: string, ruleId: string) =>
    invoke<void>("pfsense_delete_firewall_rule", { id, ruleId }),
  applyFirewallRules: (id: string) =>
    invoke<ApplyResult>("pfsense_apply_firewall_rules", { id }),
  listFirewallAliases: (id: string) =>
    invoke<FirewallAlias[]>("pfsense_list_firewall_aliases", { id }),
  getFirewallAlias: (id: string, name: string) =>
    invoke<FirewallAlias>("pfsense_get_firewall_alias", { id, name }),
  createFirewallAlias: (id: string, alias: FirewallAlias) =>
    invoke<FirewallAlias>("pfsense_create_firewall_alias", { id, alias }),
  updateFirewallAlias: (id: string, name: string, alias: FirewallAlias) =>
    invoke<FirewallAlias>("pfsense_update_firewall_alias", { id, name, alias }),
  deleteFirewallAlias: (id: string, name: string) =>
    invoke<void>("pfsense_delete_firewall_alias", { id, name }),
  getFirewallStates: (id: string) =>
    invoke<FirewallState[]>("pfsense_get_firewall_states", { id }),
  flushFirewallStates: (id: string) =>
    invoke<void>("pfsense_flush_firewall_states", { id }),

  // ── NAT (13) ───────────────────────────────────────────────────
  listNatPortForwards: (id: string) =>
    invoke<NatPortForward[]>("pfsense_list_nat_port_forwards", { id }),
  createNatPortForward: (id: string, rule: NatPortForward) =>
    invoke<NatPortForward>("pfsense_create_nat_port_forward", { id, rule }),
  updateNatPortForward: (id: string, fwdId: string, rule: NatPortForward) =>
    invoke<NatPortForward>("pfsense_update_nat_port_forward", {
      id,
      fwdId,
      rule,
    }),
  deleteNatPortForward: (id: string, fwdId: string) =>
    invoke<void>("pfsense_delete_nat_port_forward", { id, fwdId }),
  listNatOutbound: (id: string) =>
    invoke<NatOutbound[]>("pfsense_list_nat_outbound", { id }),
  createNatOutbound: (id: string, rule: NatOutbound) =>
    invoke<NatOutbound>("pfsense_create_nat_outbound", { id, rule }),
  updateNatOutbound: (id: string, outId: string, rule: NatOutbound) =>
    invoke<NatOutbound>("pfsense_update_nat_outbound", { id, outId, rule }),
  deleteNatOutbound: (id: string, outId: string) =>
    invoke<void>("pfsense_delete_nat_outbound", { id, outId }),
  listNat1to1: (id: string) =>
    invoke<Nat1to1[]>("pfsense_list_nat_1to1", { id }),
  createNat1to1: (id: string, rule: Nat1to1) =>
    invoke<Nat1to1>("pfsense_create_nat_1to1", { id, rule }),
  updateNat1to1: (id: string, ruleId: string, rule: Nat1to1) =>
    invoke<Nat1to1>("pfsense_update_nat_1to1", { id, ruleId, rule }),
  deleteNat1to1: (id: string, ruleId: string) =>
    invoke<void>("pfsense_delete_nat_1to1", { id, ruleId }),
  applyNat: (id: string) => invoke<ApplyResult>("pfsense_apply_nat", { id }),

  // ── Routing (6) ────────────────────────────────────────────────
  listRoutes: (id: string) =>
    invoke<StaticRoute[]>("pfsense_list_routes", { id }),
  createRoute: (id: string, route: StaticRoute) =>
    invoke<StaticRoute>("pfsense_create_route", { id, route }),
  deleteRoute: (id: string, routeId: string) =>
    invoke<void>("pfsense_delete_route", { id, routeId }),
  listGateways: (id: string) =>
    invoke<Gateway[]>("pfsense_list_gateways", { id }),
  getGatewayStatus: (id: string) =>
    invoke<GatewayStatus[]>("pfsense_get_gateway_status", { id }),
  getRoutingTable: (id: string) =>
    invoke<RoutingTableEntry[]>("pfsense_get_routing_table", { id }),

  // ── VPN (8) ────────────────────────────────────────────────────
  listOpenvpnServers: (id: string) =>
    invoke<OpenVpnServer[]>("pfsense_list_openvpn_servers", { id }),
  getOpenvpnServer: (id: string, vpnid: number) =>
    invoke<OpenVpnServer>("pfsense_get_openvpn_server", { id, vpnid }),
  createOpenvpnServer: (id: string, server: OpenVpnServer) =>
    invoke<OpenVpnServer>("pfsense_create_openvpn_server", { id, server }),
  deleteOpenvpnServer: (id: string, vpnid: number) =>
    invoke<void>("pfsense_delete_openvpn_server", { id, vpnid }),
  listOpenvpnClients: (id: string) =>
    invoke<OpenVpnClient[]>("pfsense_list_openvpn_clients", { id }),
  listIpsecTunnels: (id: string) =>
    invoke<IpsecTunnel[]>("pfsense_list_ipsec_tunnels", { id }),
  listWireguardTunnels: (id: string) =>
    invoke<WireGuardTunnel[]>("pfsense_list_wireguard_tunnels", { id }),
  listWireguardPeers: (id: string, tunnelId: string) =>
    invoke<WireGuardPeer[]>("pfsense_list_wireguard_peers", { id, tunnelId }),
};

export type PfsenseNetworkApi = typeof pfsenseNetworkApi;

/**
 * Convenience hook for the Network & Firewall tab. Exposes the invoke slice
 * plus shared `isLoading`/`error` state and a `run` helper that binds the live
 * `connectionId`, wraps a call, and funnels failures into `error`
 * (`typeof e === 'string' ? e : (e as Error).message`).
 */
export function usePfsenseNetwork(connectionId: string) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async <T>(fn: (id: string) => Promise<T>): Promise<T | undefined> => {
      setIsLoading(true);
      setError(null);
      try {
        return await fn(connectionId);
      } catch (e) {
        const msg = typeof e === "string" ? e : (e as Error).message;
        setError(msg);
        return undefined;
      } finally {
        setIsLoading(false);
      }
    },
    [connectionId],
  );

  return {
    api: pfsenseNetworkApi,
    connectionId,
    isLoading,
    error,
    setError,
    run,
  };
}

export type UsePfsenseNetwork = ReturnType<typeof usePfsenseNetwork>;
