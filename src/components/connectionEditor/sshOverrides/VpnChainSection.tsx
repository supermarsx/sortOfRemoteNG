import { useState, useEffect, useMemo, useCallback } from "react";
import { Connection, TunnelChainLayer, TunnelType } from "../../../types/connection/connection";
import { Select } from "../../ui/forms";
import { InfoTooltip } from "../../ui/InfoTooltip";
import { ProxyOpenVPNManager, ConnectionChain } from "../../../utils/network/proxyOpenVPNManager";
import { proxyCollectionManager } from "../../../utils/connection/proxyCollectionManager";
import { useVpnManager, NormalizedVpnConnection } from "../../../hooks/network/useVpnManager";
import { SavedProxyChain } from "../../../types/settings/settings";
import { SavedTunnelChain } from "../../../types/settings/vpnSettings";
import { Shield, Trash2, Unlink } from "lucide-react";

/* ═══════════════════════════════════════════════════════════════
   Props — this section reads/writes connection-level fields
   (security.tunnelChain, proxyChainId, connectionChainId, tunnelChainId)
   rather than SSH config overrides, so it receives formData directly.
   ═══════════════════════════════════════════════════════════════ */

interface VpnChainSectionProps {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
}

/* ═══════════════════════════════════════════════════════════════
   Tunnel-type display labels
   ═══════════════════════════════════════════════════════════════ */

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

/* ═══════════════════════════════════════════════════════════════
   Chain Preview sub-component
   ═══════════════════════════════════════════════════════════════ */

function ChainPreview({
  layers,
  onClear,
  linkedChainName,
  onDetach,
}: {
  layers: TunnelChainLayer[];
  onClear: () => void;
  linkedChainName?: string;
  onDetach?: () => void;
}) {
  if (layers.length === 0) {
    return (
      <div className="text-xs text-[var(--color-textSecondary)] italic">
        No tunnel chain configured
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-[var(--color-textSecondary)]">
          Active Chain ({layers.length} layer{layers.length !== 1 ? "s" : ""})
          {linkedChainName && (
            <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-primary)]/15 text-[var(--color-primary)]">
              linked: {linkedChainName}
            </span>
          )}
        </span>
        <div className="flex items-center gap-2">
          {onDetach && (
            <button
              type="button"
              onClick={onDetach}
              className="text-xs text-[var(--color-warning)] hover:text-[var(--color-warningHover)] transition-colors flex items-center gap-1"
              title="Detach from template — copies layers inline for per-connection customization"
            >
              <Unlink className="w-3 h-3" />
              Detach
            </button>
          )}
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-[var(--color-danger)] hover:text-[var(--color-dangerHover)] transition-colors flex items-center gap-1"
          >
            <Trash2 className="w-3 h-3" />
            Clear
          </button>
        </div>
      </div>
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
                &rarr;
              </span>
            )}
          </div>
        ))}
        <div className="flex items-center gap-1">
          <span className="text-[var(--color-textSecondary)] text-xs">&rarr;</span>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[var(--color-success)]/15 text-[var(--color-success)] border border-[var(--color-success)]/30">
            Target
          </span>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   VpnChainSection component
   ═══════════════════════════════════════════════════════════════ */

const VpnChainSection: React.FC<VpnChainSectionProps> = ({
  formData,
  setFormData,
}) => {
  const proxyManager = ProxyOpenVPNManager.getInstance();

  // ── VPN connections via useVpnManager ──────────────────────────
  const vpnMgr = useVpnManager(true);

  // ── Connection chains (from backend) ──────────────────────────
  const [connectionChains, setConnectionChains] = useState<ConnectionChain[]>([]);

  // ── Proxy chains (from ProxyCollectionManager) ────────────────
  const [proxyChains, setProxyChains] = useState<SavedProxyChain[]>([]);

  // ── Tunnel chain templates (from ProxyCollectionManager) ─────
  const [tunnelChainTemplates, setTunnelChainTemplates] = useState<SavedTunnelChain[]>([]);

  // ── Load chains on mount ──────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const chains = await proxyManager.listConnectionChains();
        if (!cancelled) setConnectionChains(chains);
      } catch {
        // Ignore — chains may not be available yet
      }

      try {
        const saved = proxyCollectionManager.getChains();
        if (!cancelled) setProxyChains(saved);
      } catch {
        // Ignore
      }

      try {
        const tunnelChains = proxyCollectionManager.getTunnelChains();
        if (!cancelled) setTunnelChainTemplates(tunnelChains);
      } catch {
        // Ignore
      }
    }

    load();

    const unsubscribe = proxyCollectionManager.subscribe(() => {
      setProxyChains(proxyCollectionManager.getChains());
      setTunnelChainTemplates(proxyCollectionManager.getTunnelChains());
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [proxyManager]);

  // ── Current values ────────────────────────────────────────────

  const inlineTunnelChain = useMemo(
    () => formData.security?.tunnelChain ?? [],
    [formData.security?.tunnelChain]
  );
  const selectedTunnelChainId = formData.tunnelChainId ?? "";
  const selectedProxyChainId = formData.proxyChainId ?? "";
  const selectedConnectionChainId = formData.connectionChainId ?? "";

  // Resolve the display layers — from referenced chain or inline
  const referencedChain = selectedTunnelChainId
    ? tunnelChainTemplates.find(t => t.id === selectedTunnelChainId)
    : null;
  const displayLayers = referencedChain?.layers ?? inlineTunnelChain;

  // Find VPN layer in the display layers (if any)
  const vpnLayerIndex = displayLayers.findIndex(
    (l) => l.type === "openvpn" || l.type === "wireguard" || l.type === "tailscale" || l.type === "zerotier"
  );
  const selectedVpnId = vpnLayerIndex >= 0 ? (displayLayers[vpnLayerIndex].name ?? "") : "";

  // ── Update helpers ────────────────────────────────────────────

  const updateTunnelChain = useCallback(
    (newChain: TunnelChainLayer[]) => {
      setFormData((prev) => ({
        ...prev,
        security: {
          ...prev.security,
          tunnelChain: newChain.length > 0 ? newChain : undefined,
        },
      }));
    },
    [setFormData]
  );

  const handleVpnChange = useCallback(
    (vpnId: string) => {
      // Remove any existing VPN layers
      const withoutVpn = inlineTunnelChain.filter(
        (l) =>
          l.type !== "openvpn" &&
          l.type !== "wireguard" &&
          l.type !== "tailscale" &&
          l.type !== "zerotier"
      );

      if (!vpnId) {
        updateTunnelChain(withoutVpn);
        return;
      }

      // Find the selected VPN connection
      const vpn = vpnMgr.connections.find((c) => c.id === vpnId);
      if (!vpn) return;

      const newLayer: TunnelChainLayer = {
        id: crypto.randomUUID(),
        type: vpn.vpnType as TunnelType,
        enabled: true,
        name: vpn.name,
      };

      // Insert VPN as the outermost layer (first position)
      updateTunnelChain([newLayer, ...withoutVpn]);
    },
    [inlineTunnelChain, vpnMgr.connections, updateTunnelChain]
  );

  const handleProxyChainChange = useCallback(
    (value: string) => {
      setFormData((prev) => ({
        ...prev,
        proxyChainId: value || undefined,
      }));
    },
    [setFormData]
  );

  const handleConnectionChainChange = useCallback(
    (value: string) => {
      setFormData((prev) => ({
        ...prev,
        connectionChainId: value || undefined,
      }));
    },
    [setFormData]
  );

  const handleTunnelChainRefChange = useCallback(
    (chainId: string) => {
      setFormData((prev) => ({
        ...prev,
        tunnelChainId: chainId || undefined,
        // Clear inline tunnel chain when selecting a reference
        security: chainId
          ? { ...prev.security, tunnelChain: undefined }
          : prev.security,
      }));
    },
    [setFormData]
  );

  const clearTunnelChain = useCallback(() => {
    setFormData((prev) => ({
      ...prev,
      tunnelChainId: undefined,
      security: { ...prev.security, tunnelChain: undefined },
    }));
  }, [setFormData]);

  const handleDetach = useCallback(() => {
    if (!referencedChain) return;
    // Copy layers inline and remove the reference
    setFormData((prev) => ({
      ...prev,
      tunnelChainId: undefined,
      security: {
        ...prev.security,
        tunnelChain: referencedChain.layers.map(l => ({ ...l })),
      },
    }));
  }, [referencedChain, setFormData]);

  // ── Dropdown options ──────────────────────────────────────────

  const vpnOptions = useMemo(
    () => [
      { value: "", label: "None" },
      ...vpnMgr.connections.map((c) => ({
        value: c.id,
        label: `${c.name} (${c.vpnType})`,
      })),
    ],
    [vpnMgr.connections]
  );

  const proxyChainOptions = useMemo(
    () => [
      { value: "", label: "None" },
      ...proxyChains.map((c) => ({
        value: c.id,
        label: c.name,
      })),
    ],
    [proxyChains]
  );

  const connectionChainOptions = useMemo(
    () => [
      { value: "", label: "None" },
      ...connectionChains.map((c) => ({
        value: c.id,
        label: c.name,
      })),
    ],
    [connectionChains]
  );

  const tunnelChainOptions = useMemo(
    () => [
      { value: "", label: "None" },
      ...tunnelChainTemplates.map((c) => ({
        value: c.id,
        label: `${c.name} (${c.layers.length} layer${c.layers.length !== 1 ? "s" : ""})`,
      })),
    ],
    [tunnelChainTemplates]
  );

  // Check if anything is configured
  const hasConfiguration =
    displayLayers.length > 0 || !!selectedProxyChainId || !!selectedConnectionChainId || !!selectedTunnelChainId;

  return (
    <div className="space-y-3">
      <h4 className="sor-form-section-heading">
        <span className="flex items-center gap-1.5">
          <Shield className="w-3.5 h-3.5" />
          VPN &amp; Chain
        </span>
        <InfoTooltip text="Associate VPN connections, proxy chains, and connection chains with this connection. VPN connections add a tunnel layer that wraps the SSH traffic. Proxy chains and connection chains define multi-hop routing paths." />
        {hasConfiguration && (
          <span className="ml-2 px-1.5 py-0.5 text-[10px] bg-[var(--color-accent)]/15 text-[var(--color-accent)] rounded">
            configured
          </span>
        )}
      </h4>

      {/* ── VPN Connection ── */}
      <div className="space-y-1">
        <label className="text-xs text-[var(--color-textSecondary)] flex items-center gap-1">
          VPN Connection
          <InfoTooltip text="Select a VPN connection to route traffic through. This adds a VPN tunnel layer as the outermost hop in the tunnel chain." />
        </label>
        <Select
          value={selectedVpnId}
          onChange={handleVpnChange}
          options={vpnOptions}
          className="sor-form-input"
        />
        {vpnMgr.isLoading && (
          <span className="text-xs text-[var(--color-textSecondary)]">
            Loading VPN connections...
          </span>
        )}
      </div>

      {/* ── Proxy Chain ── */}
      <div className="space-y-1">
        <label className="text-xs text-[var(--color-textSecondary)] flex items-center gap-1">
          Proxy Chain
          <InfoTooltip text="Select a saved proxy chain to apply to this connection. Proxy chains define an ordered sequence of proxy servers that traffic passes through." />
        </label>
        <Select
          value={selectedProxyChainId}
          onChange={handleProxyChainChange}
          options={proxyChainOptions}
          className="sor-form-input"
        />
      </div>

      {/* ── Connection Chain ── */}
      <div className="space-y-1">
        <label className="text-xs text-[var(--color-textSecondary)] flex items-center gap-1">
          Connection Chain
          <InfoTooltip text="Select a saved connection chain. Connection chains define multi-hop VPN/proxy/SSH tunnel paths that are established in sequence before connecting to the target." />
        </label>
        <Select
          value={selectedConnectionChainId}
          onChange={handleConnectionChainChange}
          options={connectionChainOptions}
          className="sor-form-input"
        />
      </div>

      {/* ── Tunnel Chain (by reference) ── */}
      {tunnelChainTemplates.length > 0 && (
        <div className="space-y-1">
          <label className="text-xs text-[var(--color-textSecondary)] flex items-center gap-1">
            Tunnel Chain
            <InfoTooltip text="Link a saved tunnel chain to this connection. Changes to the chain will automatically apply. Use 'Detach' to copy layers inline for per-connection customization." />
          </label>
          <Select
            value={selectedTunnelChainId}
            onChange={handleTunnelChainRefChange}
            options={tunnelChainOptions}
            className="sor-form-input"
          />
        </div>
      )}

      {/* ── Chain Preview ── */}
      <div className="mt-2 pt-2 border-t border-[var(--color-border)]/50">
        <ChainPreview
          layers={displayLayers}
          onClear={clearTunnelChain}
          linkedChainName={referencedChain?.name}
          onDetach={referencedChain ? handleDetach : undefined}
        />
      </div>
    </div>
  );
};

export default VpnChainSection;
