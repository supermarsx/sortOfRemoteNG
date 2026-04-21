import { useState, useCallback, useEffect, useMemo } from "react";
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  ProxyOpenVPNManager,
  OpenVPNConnection,
  WireGuardConnection,
  ZeroTierConnection,
  TailscaleConnection,
} from "../../utils/network/proxyOpenVPNManager";

// ─── Types ─────────────────────────────────────────────────────────

export type VpnTypeFilter = "all" | "openvpn" | "wireguard" | "tailscale" | "zerotier";

export interface NormalizedVpnConnection {
  id: string;
  name: string;
  vpnType: "openvpn" | "wireguard" | "tailscale" | "zerotier";
  status: string;
  host?: string;
  port?: number;
  localIp?: string;
  createdAt: Date;
  connectedAt?: Date;
}

// ─── Hook ──────────────────────────────────────────────────────────

export function useVpnManager(isOpen: boolean) {
  const mgr = ProxyOpenVPNManager.getInstance();

  const [openvpnConnections, setOpenvpnConnections] = useState<OpenVPNConnection[]>([]);
  const [wireguardConnections, setWireguardConnections] = useState<WireGuardConnection[]>([]);
  const [tailscaleConnections, setTailscaleConnections] = useState<TailscaleConnection[]>([]);
  const [zerotierConnections, setZerotierConnections] = useState<ZeroTierConnection[]>([]);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<VpnTypeFilter>("all");

  // ── Load all connections ─────────────────────────────────────────

  const loadConnections = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [ovpn, wg, ts, zt] = await Promise.allSettled([
        mgr.listOpenVPNConnections(),
        mgr.listWireGuardConnections(),
        mgr.listTailscaleConnections(),
        mgr.listZeroTierConnections(),
      ]);

      setOpenvpnConnections(ovpn.status === "fulfilled" ? ovpn.value : []);
      setWireguardConnections(wg.status === "fulfilled" ? wg.value : []);
      setTailscaleConnections(ts.status === "fulfilled" ? ts.value : []);
      setZerotierConnections(zt.status === "fulfilled" ? zt.value : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load VPN connections");
    } finally {
      setIsLoading(false);
    }
  }, [mgr]);

  useEffect(() => {
    if (isOpen) {
      loadConnections();
    }
  }, [isOpen, loadConnections]);

  // ── Listen for backend status-changed events ────────────────────

  useEffect(() => {
    if (!isOpen) return;
    let unlisten: UnlistenFn | undefined;

    listen('vpn::status-changed', () => {
      loadConnections();
    }).then(fn => { unlisten = fn; });

    return () => { unlisten?.(); };
  }, [isOpen, loadConnections]);

  // ── Poll status at a regular interval ───────────────────────────

  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => {
      loadConnections();
    }, 10000); // 10 second default polling

    return () => clearInterval(interval);
  }, [isOpen, loadConnections]);

  // ── Normalize into a single list ─────────────────────────────────

  const allConnections = useMemo<NormalizedVpnConnection[]>(() => {
    const list: NormalizedVpnConnection[] = [];

    for (const c of openvpnConnections) {
      list.push({
        id: c.id,
        name: c.name,
        vpnType: "openvpn",
        status: c.status,
        host: c.config?.remoteHost,
        port: c.config?.remotePort,
        localIp: c.localIp,
        createdAt: c.createdAt,
        connectedAt: c.connectedAt,
      });
    }
    for (const c of wireguardConnections) {
      list.push({
        id: c.id,
        name: c.name,
        vpnType: "wireguard",
        status: c.status,
        host: c.config?.peer?.endpoint?.split(":")[0],
        port: c.config?.peer?.endpoint
          ? parseInt(c.config.peer.endpoint.split(":")[1], 10) || undefined
          : undefined,
        localIp: c.localIp,
        createdAt: c.createdAt,
        connectedAt: c.connectedAt,
      });
    }
    for (const c of tailscaleConnections) {
      list.push({
        id: c.id,
        name: c.name,
        vpnType: "tailscale",
        status: c.status,
        host: c.config?.loginServer,
        localIp: c.tailnetIp,
        createdAt: c.createdAt,
        connectedAt: c.connectedAt,
      });
    }
    for (const c of zerotierConnections) {
      list.push({
        id: c.id,
        name: c.name,
        vpnType: "zerotier",
        status: c.status,
        host: c.config?.networkId,
        localIp: undefined,
        createdAt: c.createdAt,
        connectedAt: c.connectedAt,
      });
    }

    return list;
  }, [openvpnConnections, wireguardConnections, tailscaleConnections, zerotierConnections]);

  // ── Filter connections ───────────────────────────────────────────

  const connections = useMemo(() => {
    let filtered = allConnections;

    if (typeFilter !== "all") {
      filtered = filtered.filter((c) => c.vpnType === typeFilter);
    }

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.name.toLowerCase().includes(term) ||
          c.host?.toLowerCase().includes(term) ||
          c.vpnType.toLowerCase().includes(term)
      );
    }

    return filtered;
  }, [allConnections, typeFilter, searchTerm]);

  // ── Actions ──────────────────────────────────────────────────────

  const connectVpn = useCallback(
    async (id: string, vpnType: string) => {
      try {
        setError(null);
        switch (vpnType) {
          case "openvpn":
            await mgr.connectOpenVPN(id);
            break;
          case "wireguard":
            await mgr.connectWireGuard(id);
            break;
          case "tailscale":
            await mgr.connectTailscale(id);
            break;
          case "zerotier":
            await mgr.connectZeroTier(id);
            break;
        }
        await loadConnections();
      } catch (err) {
        setError(err instanceof Error ? err.message : `Failed to connect ${vpnType}`);
      }
    },
    [mgr, loadConnections]
  );

  const disconnectVpn = useCallback(
    async (id: string, vpnType: string) => {
      try {
        setError(null);
        switch (vpnType) {
          case "openvpn":
            await mgr.disconnectOpenVPN(id);
            break;
          case "wireguard":
            await mgr.disconnectWireGuard(id);
            break;
          case "tailscale":
            await mgr.disconnectTailscale(id);
            break;
          case "zerotier":
            await mgr.disconnectZeroTier(id);
            break;
        }
        await loadConnections();
      } catch (err) {
        setError(err instanceof Error ? err.message : `Failed to disconnect ${vpnType}`);
      }
    },
    [mgr, loadConnections]
  );

  const deleteVpn = useCallback(
    async (id: string, vpnType: string) => {
      try {
        setError(null);
        switch (vpnType) {
          case "openvpn":
            await mgr.deleteOpenVPNConnection(id);
            break;
          case "wireguard":
            await mgr.deleteWireGuardConnection(id);
            break;
          case "tailscale":
            await mgr.deleteTailscaleConnection(id);
            break;
          case "zerotier":
            await mgr.deleteZeroTierConnection(id);
            break;
        }
        await loadConnections();
      } catch (err) {
        setError(err instanceof Error ? err.message : `Failed to delete ${vpnType} connection`);
      }
    },
    [mgr, loadConnections]
  );

  const importOvpn = useCallback(
    async (name: string, configContent: string) => {
      try {
        setError(null);
        await mgr.createOpenVPNConnection(name, {
          enabled: true,
          configFile: configContent,
        });
        await loadConnections();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to import OpenVPN config");
      }
    },
    [mgr, loadConnections]
  );

  const createVpn = useCallback(
    async (name: string, vpnType: string, config: Record<string, unknown>) => {
      try {
        setError(null);
        switch (vpnType) {
          case "openvpn":
            await mgr.createOpenVPNConnection(name, config as any);
            break;
          case "wireguard":
            await mgr.createWireGuardConnection(name, config as any);
            break;
          case "tailscale":
            await mgr.createTailscaleConnection(name, config as any);
            break;
          case "zerotier":
            await mgr.createZeroTierConnection(name, config as any);
            break;
          default:
            throw new Error(`Unsupported VPN type: ${vpnType}`);
        }
        await loadConnections();
      } catch (err) {
        setError(err instanceof Error ? err.message : `Failed to create ${vpnType} connection`);
        throw err;
      }
    },
    [mgr, loadConnections]
  );

  const updateVpn = useCallback(
    async (id: string, vpnType: string, name?: string, config?: Record<string, unknown>) => {
      try {
        setError(null);
        switch (vpnType) {
          case "openvpn":
            await mgr.updateOpenVPNConnection(id, name, config);
            break;
          case "wireguard":
            await mgr.updateWireGuardConnection(id, name, config);
            break;
          case "tailscale":
            await mgr.updateTailscaleConnection(id, name, config);
            break;
          case "zerotier":
            await mgr.updateZeroTierConnection(id, name, config);
            break;
          default:
            throw new Error(`Unsupported VPN type: ${vpnType}`);
        }
        await loadConnections();
      } catch (err) {
        setError(err instanceof Error ? err.message : `Failed to update ${vpnType} connection`);
        throw err;
      }
    },
    [mgr, loadConnections]
  );

  return {
    connections,
    isLoading,
    error,
    searchTerm,
    setSearchTerm,
    typeFilter,
    setTypeFilter,
    loadConnections,
    connectVpn,
    disconnectVpn,
    deleteVpn,
    importOvpn,
    createVpn,
    updateVpn,
  };
}
