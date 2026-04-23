import { useState, useEffect } from "react";
import { Mgr } from "./types";
import type { Connection, TunnelType } from "../../../types/connection/connection";
import { Select } from "../../ui/forms";
import { proxyCollectionManager } from "../../../utils/connection/proxyCollectionManager";
import type { SavedTunnelChain } from "../../../types/settings/vpnSettings";
import { getTypeLabel } from "./tunnelChainShared.helpers";

const tunnelTypeLabels: Record<TunnelType, string> = {
  proxy: "Proxy",
  "ssh-tunnel": "SSH Tunnel",
  "ssh-jump": "SSH Jump Host",
  "ssh-proxycmd": "SSH ProxyCommand",
  "ssh-stdio": "SSH Stdio",
  openvpn: "OpenVPN",
  wireguard: "WireGuard",
  shadowsocks: "Shadowsocks",
  tor: "Tor",
  i2p: "I2P",
  stunnel: "STunnel",
  chisel: "Chisel",
  ngrok: "ngrok",
  cloudflared: "Cloudflare Tunnel",
  tailscale: "Tailscale",
  zerotier: "ZeroTier",
};

function TunnelChainPreview({
  connection,
  onClear,
}: {
  connection: Connection;
  onClear: () => void;
}) {
  // Show preview from referenced chain or inline chain
  const chainId = connection.tunnelChainId;
  const referencedChain = chainId ? proxyCollectionManager.getTunnelChain(chainId) : null;
  const layers = referencedChain?.layers ?? connection.security?.tunnelChain;
  const hasChain = layers && layers.length > 0;

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between mb-1">
        <label className="block text-xs text-[var(--color-textSecondary)]">
          Tunnel Chain
          {referencedChain && (
            <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-primary)]/15 text-[var(--color-primary)]">
              linked: {referencedChain.name}
            </span>
          )}
        </label>
        {(hasChain || chainId) && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-[var(--color-danger)] hover:text-[var(--color-dangerHover)] transition-colors"
          >
            Clear
          </button>
        )}
      </div>
      {hasChain ? (
        <div className="flex items-center gap-1 flex-wrap">
          {layers.map((layer, idx) => (
            <div key={layer.id} className="flex items-center gap-1">
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                  layer.enabled
                    ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)] border border-[var(--color-accent)]/30"
                    : "bg-[var(--color-textSecondary)]/10 text-[var(--color-textSecondary)] border border-[var(--color-border)] line-through"
                }`}
              >
                {layer.name || tunnelTypeLabels[layer.type] || layer.type}
              </span>
              {idx < layers.length - 1 && (
                <span className="text-[var(--color-textSecondary)] text-xs">
                  →
                </span>
              )}
            </div>
          ))}
          <div className="flex items-center gap-1">
            <span className="text-[var(--color-textSecondary)] text-xs">→</span>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[var(--color-success)]/15 text-[var(--color-success)] border border-[var(--color-success)]/30">
              Target
            </span>
          </div>
        </div>
      ) : (
        <div className="text-xs text-[var(--color-textSecondary)] italic">
          No tunnel chain configured
        </div>
      )}
    </div>
  );
}

function AssociationsTab({ mgr }: { mgr: Mgr }) {
  const [savedTunnelChains, setSavedTunnelChains] = useState<SavedTunnelChain[]>([]);

  useEffect(() => {
    setSavedTunnelChains(proxyCollectionManager.getTunnelChains());
    const unsubscribe = proxyCollectionManager.subscribe(() => {
      setSavedTunnelChains(proxyCollectionManager.getTunnelChains());
    });
    return () => { unsubscribe(); };
  }, []);

  const handleClearTunnelChain = (connectionId: string) => {
    // Clear both reference and inline chain
    mgr.updateTunnelChainRef(connectionId, "");
    mgr.clearTunnelChain(connectionId);
  };

  return (
    <div className="space-y-4">
      <div className="text-sm text-[var(--color-textSecondary)]">
        Associate chains with individual connections. These choices will be used
        when launching sessions.
      </div>
      <div className="space-y-3">
        {mgr.connectionOptions.map((connection) => (
          <div
            key={connection.id}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)]/40 p-3"
          >
            <div className="text-sm font-medium text-[var(--color-text)] mb-2">
              {connection.name}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
                  Connection Chain
                </label>
                <Select value={connection.connectionChainId || ""} onChange={(v: string) =>
                    mgr.updateConnectionChain(connection.id, v)} options={[{ value: '', label: 'None' }, ...mgr.connectionChains.map((chain) => ({ value: chain.id, label: chain.name }))]} className="sor-form-input" />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
                  Proxy Chain
                </label>
                <Select value={connection.proxyChainId || ""} onChange={(v: string) =>
                    mgr.updateProxyChain(connection.id, v)} options={[{ value: '', label: 'None' }, ...mgr.proxyChains.map((chain) => ({ value: chain.id, label: chain.name }))]} className="sor-form-input" />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
                  Tunnel Chain
                </label>
                <Select
                  value={connection.tunnelChainId || ""}
                  onChange={(v: string) => {
                    mgr.updateTunnelChainRef(connection.id, v);
                  }}
                  options={[
                    { value: '', label: 'None' },
                    ...savedTunnelChains.map(c => ({
                      value: c.id,
                      label: `${c.name} (${c.layers.length} layer${c.layers.length !== 1 ? 's' : ''})`,
                    })),
                  ]}
                  className="sor-form-input"
                />
              </div>
            </div>
            <TunnelChainPreview
              connection={connection}
              onClear={() => handleClearTunnelChain(connection.id)}
            />
          </div>
        ))}
        {mgr.connectionOptions.length === 0 && (
          <div className="text-sm text-[var(--color-textSecondary)]">
            No connections available.
          </div>
        )}
      </div>
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-backgroundSecondary)]/50 p-3">
        <div className="text-xs text-[var(--color-textSecondary)]">
          <strong>Tunnel Chains</strong> define an ordered sequence of tunnels
          (VPN, SSH jump hosts, proxies) that traffic traverses before reaching the
          target host. Each layer wraps the next, with the first layer being the
          outermost hop. Chains are linked by reference &mdash; updating a chain
          automatically applies to all connections using it.
        </div>
      </div>
    </div>
  );
}


export default AssociationsTab;
