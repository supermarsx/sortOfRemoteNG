import React, { useState, useCallback } from "react";
import {
  Wifi, WifiOff, Shield, Globe, Trash2, Play, Square, Plus,
  Search, RefreshCw, AlertCircle, CheckCircle2,
  Loader2, FileUp, ChevronDown, Edit2
} from "lucide-react";
import { useVpnManager, type VpnTypeFilter, type NormalizedVpnConnection } from "../../../hooks/network/useVpnManager";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { parseWireGuardConf } from '../../../utils/network/parseWireGuardConf';
import { ProxyOpenVPNManager } from '../../../utils/network/proxyOpenVPNManager';
import { setPendingVpnEdit } from '../../../utils/network/vpnEditorStore';

// ── Constants ───────────────────────────────────────────────────

const VPN_TYPE_LABELS: Record<VpnTypeFilter, string> = {
  all: "All",
  openvpn: "OpenVPN",
  wireguard: "WireGuard",
  tailscale: "Tailscale",
  zerotier: "ZeroTier",
};

const VPN_TYPE_ICONS: Record<string, React.ReactNode> = {
  openvpn: <Shield size={14} />,
  wireguard: <Globe size={14} />,
  tailscale: <Wifi size={14} />,
  zerotier: <Globe size={14} />,
};

// ── Status badge ────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const normalized = typeof status === "string" ? status.toLowerCase() : "unknown";

  if (normalized === "connected") {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-500/15 text-green-400">
        <CheckCircle2 size={10} /> Connected
      </span>
    );
  }
  if (normalized === "connecting") {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400">
        <Loader2 size={10} className="animate-spin" /> Connecting
      </span>
    );
  }
  if (normalized.includes("error")) {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-400">
        <AlertCircle size={10} /> Error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-[var(--color-surfaceHover)] text-[var(--color-textMuted)]">
      <WifiOff size={10} /> Disconnected
    </span>
  );
}

// ── Main component ──────────────────────────────────────────────

interface VpnConnectionsTabProps {
  isOpen: boolean;
  mgr: { handleNewVpn: () => void };
}

const VpnConnectionsTab: React.FC<VpnConnectionsTabProps> = ({ isOpen, mgr }) => {
  const vpn = useVpnManager(isOpen);
  const [importing, setImporting] = useState(false);
  const [showImportMenu, setShowImportMenu] = useState(false);

  const handleImportOvpn = useCallback(async () => {
    try {
      setImporting(true);
      const selected = await open({
        multiple: false,
        filters: [{ name: "OpenVPN Config", extensions: ["ovpn", "conf"] }],
      });
      if (!selected) return;
      const filePath = typeof selected === "string" ? selected : selected;
      const content = await readTextFile(filePath);
      const fileName = filePath.split(/[/\\]/).pop() ?? "Imported VPN";
      const name = fileName.replace(/\.(ovpn|conf)$/i, "");
      await vpn.importOvpn(name, content);
    } catch (err) {
      console.error("Failed to import .ovpn:", err);
    } finally {
      setImporting(false);
    }
  }, [vpn]);

  const handleImportWireGuard = useCallback(async () => {
    try {
      setImporting(true);
      setShowImportMenu(false);
      const selected = await open({
        multiple: false,
        filters: [{ name: "WireGuard Config", extensions: ["conf"] }],
      });
      if (!selected) return;
      const filePath = typeof selected === "string" ? selected : selected;
      const content = await readTextFile(filePath);
      const parsed = parseWireGuardConf(content);
      const fileName = filePath.split(/[/\\]/).pop() ?? "Imported WireGuard";
      const name = fileName.replace(/\.conf$/i, "");
      await vpn.createVpn(name, "wireguard", {
        enabled: true,
        ...parsed,
      } as any);
    } catch (err) {
      console.error("Failed to import WireGuard config:", err);
    } finally {
      setImporting(false);
    }
  }, [vpn]);

  const handleEditConnection = useCallback(async (conn: NormalizedVpnConnection) => {
    try {
      const proxyMgr = ProxyOpenVPNManager.getInstance();
      let fullConfig: Record<string, any> = {};

      switch (conn.vpnType) {
        case 'openvpn': {
          const full = await proxyMgr.getOpenVPNConnection(conn.id);
          fullConfig = full.config ?? {};
          break;
        }
        case 'wireguard': {
          const full = await proxyMgr.getWireGuardConnection(conn.id);
          fullConfig = full.config ?? {};
          break;
        }
        case 'tailscale': {
          const full = await proxyMgr.getTailscaleConnection(conn.id);
          fullConfig = full.config ?? {};
          break;
        }
        case 'zerotier': {
          const full = await proxyMgr.getZeroTierConnection(conn.id);
          fullConfig = full.config ?? {};
          break;
        }
      }

      setPendingVpnEdit({
        id: conn.id,
        vpnType: conn.vpnType,
        name: conn.name,
        config: fullConfig,
      });
      mgr.handleNewVpn();
    } catch (err) {
      console.error('Failed to load VPN connection for editing:', err);
    }
  }, [mgr]);

  const isConnected = (status: string) => status?.toLowerCase() === "connected";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-[var(--color-text)]">VPN Connections</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={mgr.handleNewVpn}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-[var(--color-primary)] hover:bg-[var(--color-primaryHover)] text-white transition-colors"
          >
            <Plus size={12} /> New VPN
          </button>
          <div className="relative">
            <button
              onClick={() => setShowImportMenu(!showImportMenu)}
              disabled={importing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] transition-colors"
            >
              {importing ? <Loader2 size={12} className="animate-spin" /> : <FileUp size={12} />}
              Import
              <ChevronDown size={10} />
            </button>
            {showImportMenu && (
              <div className="absolute right-0 top-full mt-1 w-48 z-50 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md shadow-lg py-1">
                <button
                  onClick={() => { setShowImportMenu(false); handleImportOvpn(); }}
                  className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)]"
                >
                  <Shield size={12} className="inline mr-2" /> OpenVPN (.ovpn)
                </button>
                <button
                  onClick={() => { handleImportWireGuard(); }}
                  className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)]"
                >
                  <Globe size={12} className="inline mr-2" /> WireGuard (.conf)
                </button>
              </div>
            )}
          </div>
          <button
            onClick={() => vpn.loadConnections()}
            className="p-1.5 rounded-md hover:bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)]"
            aria-label="Refresh"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-textMuted)]" />
          <input
            type="text"
            placeholder="Search VPN connections..."
            value={vpn.searchTerm}
            onChange={e => vpn.setSearchTerm(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
          />
        </div>
        <div className="flex items-center rounded-md border border-[var(--color-border)] overflow-hidden">
          {(Object.keys(VPN_TYPE_LABELS) as VpnTypeFilter[]).map(type => (
            <button
              key={type}
              onClick={() => vpn.setTypeFilter(type)}
              className={`px-2.5 py-1.5 text-xs transition-colors ${
                vpn.typeFilter === type
                  ? "bg-[var(--color-primary)] text-white"
                  : "bg-[var(--color-surface)] text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)]"
              }`}
            >
              {VPN_TYPE_LABELS[type]}
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {vpn.error && (
        <div className="p-3 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
          <AlertCircle size={14} />
          {vpn.error}
        </div>
      )}

      {/* Connection List */}
      {vpn.isLoading ? (
        <div className="flex items-center justify-center py-8 text-[var(--color-textMuted)]">
          <Loader2 size={16} className="animate-spin mr-2" />
          Loading VPN connections...
        </div>
      ) : vpn.connections.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-[var(--color-textMuted)]">
          <Shield size={32} className="mb-2 opacity-40" />
          <p className="text-sm">No VPN connections</p>
          <p className="text-xs mt-1">Click "New VPN" to create a connection or import an .ovpn file</p>
        </div>
      ) : (
        <div className="space-y-1">
          {vpn.connections.map(conn => (
            <div
              key={conn.id}
              className="flex items-center justify-between p-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surfaceHover)] transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="text-[var(--color-textSecondary)]">
                  {VPN_TYPE_ICONS[conn.vpnType] ?? <Globe size={14} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-[var(--color-text)] truncate">
                    {conn.name}
                  </div>
                  <div className="text-xs text-[var(--color-textMuted)] truncate">
                    {conn.host ? `${conn.host}${conn.port ? ":" + conn.port : ""}` : conn.vpnType}
                    {conn.localIp && ` \u2014 ${conn.localIp}`}
                  </div>
                </div>
                <StatusBadge status={conn.status} />
              </div>
              <div className="flex items-center gap-1 ml-3">
                {isConnected(conn.status) ? (
                  <button
                    onClick={() => vpn.disconnectVpn(conn.id, conn.vpnType)}
                    className="p-1.5 rounded-md hover:bg-red-500/15 text-[var(--color-textSecondary)] hover:text-red-400 transition-colors"
                    title="Disconnect"
                  >
                    <Square size={14} />
                  </button>
                ) : (
                  <button
                    onClick={() => vpn.connectVpn(conn.id, conn.vpnType)}
                    className="p-1.5 rounded-md hover:bg-green-500/15 text-[var(--color-textSecondary)] hover:text-green-400 transition-colors"
                    title="Connect"
                  >
                    <Play size={14} />
                  </button>
                )}
                <button
                  onClick={() => handleEditConnection(conn)}
                  className="p-1.5 rounded-md hover:bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
                  title="Edit"
                >
                  <Edit2 size={14} />
                </button>
                <button
                  onClick={() => vpn.deleteVpn(conn.id, conn.vpnType)}
                  className="p-1.5 rounded-md hover:bg-red-500/15 text-[var(--color-textSecondary)] hover:text-red-400 transition-colors"
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default VpnConnectionsTab;
