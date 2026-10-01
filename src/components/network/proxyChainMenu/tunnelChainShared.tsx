import React from "react";
import { AlertCircle, Copy, Edit2, Trash2, Zap, ZapOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TunnelChainLayer } from "../../../types/connection/connection";
import type { SavedTunnelChain } from "../../../types/settings/vpnSettings";
import type { TunnelChainManager } from "../../../hooks/network/useTunnelChainManager";
import {
  getVpnProviderLabel,
  normalizeExecutableVpnType,
  resolveTunnelLayerVpnProfileId,
  type VpnProfileCatalogSnapshot,
} from "../../../utils/network/vpnProviderCatalog";
import { getTypeIcon, getTypeLabel } from "./tunnelChainShared.helpers";
import { SshSourceFields } from "./SshSourceFields";
import { Select } from "../../ui/forms";

// ── Per-layer config forms ──────────────────────────────────────

export function ProxyLayerConfig({
  layer,
  onUpdate,
}: {
  layer: TunnelChainLayer;
  onUpdate: (u: Partial<TunnelChainLayer>) => void;
}) {
  const proxy = layer.proxy ?? {
    proxyType: "socks5" as const,
    host: "",
    port: 1080,
  };
  const up = (updates: Partial<typeof proxy>) =>
    onUpdate({ proxy: { ...proxy, ...updates } });

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
      <Select
        label="Proxy type"
        variant="form"
        value={proxy.proxyType}
        onChange={(value) => up({ proxyType: value as typeof proxy.proxyType })}
        options={[
          { value: "socks5", label: "SOCKS5" },
          { value: "socks4", label: "SOCKS4" },
          { value: "http", label: "HTTP" },
          { value: "https", label: "HTTPS" },
          { value: "http-connect", label: "HTTP CONNECT" },
        ]}
      />
      <input
        type="text"
        aria-label="Proxy host"
        placeholder="Host"
        value={proxy.host}
        onChange={(e) => up({ host: e.target.value })}
        className="sor-form-input min-w-0 text-sm"
      />
      <input
        type="number"
        aria-label="Proxy port"
        placeholder="Port"
        value={proxy.port}
        onChange={(e) => up({ port: parseInt(e.target.value) || 0 })}
        className="sor-form-input min-w-0 text-sm"
      />
    </div>
  );
}

export function SshJumpLayerConfig({
  layer,
  onUpdate,
}: {
  layer: TunnelChainLayer;
  onUpdate: (u: Partial<TunnelChainLayer>) => void;
}) {
  const ssh = layer.sshTunnel ?? {
    forwardType: "local" as const,
    host: "",
    port: 22,
    username: "",
  };
  return (
    <SshSourceFields
      value={ssh}
      onChange={(value) => onUpdate({ sshTunnel: value })}
    />
  );
}

export function VpnLayerConfig({
  layer,
  onUpdate,
  vpnProfileCatalog,
}: {
  layer: TunnelChainLayer;
  onUpdate: (u: Partial<TunnelChainLayer>) => void;
  vpnProfileCatalog?: Readonly<VpnProfileCatalogSnapshot>;
}) {
  const provider = normalizeExecutableVpnType(layer.type);
  if (!provider) return null;

  const currentId = resolveTunnelLayerVpnProfileId(layer) ?? "";
  const profiles =
    vpnProfileCatalog?.profiles.filter(
      (profile) => profile.vpnType === provider,
    ) ?? [];
  const providerStatus = vpnProfileCatalog?.providerStatus[provider];
  const providerDisabledReason =
    providerStatus === "unsupported"
      ? (vpnProfileCatalog?.providerErrors?.[provider] ??
        vpnProfileCatalog?.runtimeCapabilities?.[provider]?.reason ??
        `${getVpnProviderLabel(provider)} is not executable on this platform.`)
      : undefined;
  const currentProfile = profiles.find((profile) => profile.id === currentId);
  const currentDisabledReason =
    currentProfile?.connectDisabledReason ?? providerDisabledReason;
  const currentLabel =
    currentId && !currentProfile
      ? providerStatus === "loaded"
        ? `Unavailable profile (${currentId})`
        : providerStatus === "error"
          ? `Unverified profile (${currentId})`
          : `Checking profile (${currentId})`
      : undefined;

  const updateProfile = (configId: string) => {
    const mesh = layer.mesh
      ? { ...layer.mesh, networkId: undefined, authKey: undefined }
      : undefined;
    onUpdate({
      vpn: {
        ...layer.vpn,
        // An explicit empty value suppresses the legacy layer-ID fallback.
        configId,
        configFile: undefined,
      },
      ...(mesh ? { mesh } : {}),
    });
  };

  return (
    <div className="mt-3 space-y-2">
      <Select
        label={`${getVpnProviderLabel(provider)} profile`}
        variant="form"
        searchable
        value={currentId}
        onChange={updateProfile}
        options={[
          {
            value: "",
            label: `Select ${getVpnProviderLabel(provider)} profile…`,
          },
          ...(currentLabel ? [{ value: currentId, label: currentLabel }] : []),
          ...profiles.map((profile) => {
            const disabledReason =
              profile.connectDisabledReason ?? providerDisabledReason;
            return {
              value: profile.id,
              label: `${profile.name} (${profile.status})${disabledReason ? " — unavailable" : ""}`,
              disabled: Boolean(disabledReason),
              description: disabledReason,
            };
          }),
        ]}
      />
      {currentDisabledReason && (
        <p className="text-xs text-warning" role="status">
          {currentDisabledReason}
        </p>
      )}
      {providerStatus === "error" && (
        <p className="text-xs text-warning">
          The provider store could not be loaded. Existing references remain
          unverified and are not classified as deleted.
        </p>
      )}
    </div>
  );
}

export function MeshLayerConfig({
  layer,
  onUpdate,
  vpnProfileCatalog,
}: {
  layer: TunnelChainLayer;
  onUpdate: (u: Partial<TunnelChainLayer>) => void;
  vpnProfileCatalog?: Readonly<VpnProfileCatalogSnapshot>;
}) {
  return (
    <VpnLayerConfig
      layer={layer}
      onUpdate={onUpdate}
      vpnProfileCatalog={vpnProfileCatalog}
    />
  );
}

export function TunnelLayerConfig({
  layer,
  onUpdate,
}: {
  layer: TunnelChainLayer;
  onUpdate: (u: Partial<TunnelChainLayer>) => void;
}) {
  const tunnel = layer.tunnel ?? {};
  const up = (updates: Partial<typeof tunnel>) =>
    onUpdate({ tunnel: { ...tunnel, ...updates } });

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
      <input
        type="text"
        aria-label="Server URL"
        placeholder="Server URL"
        value={tunnel.serverUrl ?? ""}
        onChange={(e) => up({ serverUrl: e.target.value })}
        className="sor-form-input min-w-0 text-sm"
      />
      <input
        type="password"
        aria-label="Auth Token"
        autoComplete="new-password"
        placeholder="Auth Token"
        value={tunnel.authToken ?? ""}
        onChange={(e) => up({ authToken: e.target.value })}
        className="sor-form-input min-w-0 text-sm"
      />
    </div>
  );
}

export function LayerConfigForm({
  layer,
  onUpdate,
  vpnProfileCatalog,
}: {
  layer: TunnelChainLayer;
  onUpdate: (u: Partial<TunnelChainLayer>) => void;
  vpnProfileCatalog?: Readonly<VpnProfileCatalogSnapshot>;
}) {
  switch (layer.type) {
    case "proxy":
    case "shadowsocks":
    case "tor":
      return <ProxyLayerConfig layer={layer} onUpdate={onUpdate} />;
    case "ssh-jump":
    case "ssh-tunnel":
    case "ssh-proxycmd":
    case "ssh-stdio":
      return <SshJumpLayerConfig layer={layer} onUpdate={onUpdate} />;
    case "openvpn":
    case "wireguard":
    case "pptp":
    case "l2tp":
    case "ikev2":
    case "ipsec":
    case "sstp":
      return (
        <VpnLayerConfig
          layer={layer}
          onUpdate={onUpdate}
          vpnProfileCatalog={vpnProfileCatalog}
        />
      );
    case "tailscale":
    case "zerotier":
      return (
        <MeshLayerConfig
          layer={layer}
          onUpdate={onUpdate}
          vpnProfileCatalog={vpnProfileCatalog}
        />
      );
    case "stunnel":
    case "chisel":
    case "ngrok":
    case "cloudflared":
      return <TunnelLayerConfig layer={layer} onUpdate={onUpdate} />;
    default:
      return (
        <div className="mt-2 text-xs text-[var(--color-textMuted)]">
          No configuration options for {getTypeLabel(layer.type)}
        </div>
      );
  }
}

// ── Chain preview ───────────────────────────────────────────────

export function ChainPreviewInline({ layers }: { layers: TunnelChainLayer[] }) {
  const enabled = layers.filter((l) => l.enabled);
  if (enabled.length === 0) return null;

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {enabled.map((layer, idx) => (
        <React.Fragment key={layer.id}>
          <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)]">
            {getTypeIcon(layer.type)}
            {layer.name || getTypeLabel(layer.type)}
          </span>
          {idx < enabled.length - 1 && (
            <span className="text-[var(--color-textMuted)] text-xs">
              &rarr;
            </span>
          )}
        </React.Fragment>
      ))}
      <span className="text-[var(--color-textMuted)] text-xs">
        &rarr; Target
      </span>
    </div>
  );
}

// ── Chain status badge ──────────────────────────────────────────

export function ChainStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();

  switch (status) {
    case "connected":
      return (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-success)]/15 text-[var(--color-success)]">
          {t("proxyChainMenu.shared.status.connected", "Connected")}
        </span>
      );
    case "connecting":
      return (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-warning)]/15 text-[var(--color-warning)]">
          {t("proxyChainMenu.shared.status.connecting", "Connecting...")}
        </span>
      );
    case "disconnecting":
      return (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-warning)]/15 text-[var(--color-warning)]">
          {t("proxyChainMenu.shared.status.disconnecting", "Disconnecting...")}
        </span>
      );
    case "error":
      return (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-danger)]/15 text-[var(--color-danger)] inline-flex items-center gap-1">
          <AlertCircle size={10} />{" "}
          {t("proxyChainMenu.shared.status.error", "Error")}
        </span>
      );
    default:
      return null;
  }
}

// ── Tunnel chain row ────────────────────────────────────────────

export function TunnelChainRow({
  chain,
  tunnelMgr,
}: {
  chain: SavedTunnelChain;
  tunnelMgr: TunnelChainManager;
}) {
  const { t } = useTranslation();

  const activeStatus = tunnelMgr.activeStatuses.get(chain.id);
  const isConnected = activeStatus?.status === "connected";
  const isConnecting = activeStatus?.status === "connecting";
  // The guard is resolved here, never by the caller: a consumer that forgot to
  // pass it would silently reintroduce a clickable Connect on an unconnectable
  // chain.
  const connectBlockReason = tunnelMgr.getConnectBlockReason(chain, t);

  const layerCount = chain.layers.length;

  return (
    <div className="sor-selection-row">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium text-[var(--color-text)] truncate">
            {chain.name}
          </div>
          <span className="sor-badge sor-badge-purple shrink-0">
            {layerCount === 1
              ? t("proxyChainMenu.shared.layerCountOne", "{{count}} layer", {
                  count: layerCount,
                })
              : t("proxyChainMenu.shared.layerCountOther", "{{count}} layers", {
                  count: layerCount,
                })}
          </span>
          {activeStatus && <ChainStatusBadge status={activeStatus.status} />}
        </div>
        {chain.description && (
          <div className="text-xs text-[var(--color-textMuted)] mt-1 truncate">
            {chain.description}
          </div>
        )}
        <div className="mt-1.5">
          <ChainPreviewInline layers={chain.layers} />
        </div>
        {chain.tags && chain.tags.length > 0 && (
          <div className="flex gap-1 mt-2">
            {chain.tags.map((tag) => (
              <span key={tag} className="sor-badge sor-badge-blue">
                {tag}
              </span>
            ))}
          </div>
        )}
        {activeStatus?.error && (
          <div className="text-xs text-[var(--color-danger)] mt-1 truncate">
            {activeStatus.error}
          </div>
        )}
        {connectBlockReason && !activeStatus?.error && (
          <div className="text-xs text-[var(--color-textMuted)] mt-1 truncate">
            {connectBlockReason}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {isConnected ? (
          <button
            onClick={() => tunnelMgr.handleDisconnectChain(chain.id)}
            disabled={tunnelMgr.isLoading}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] transition-colors disabled:opacity-50"
          >
            <ZapOff size={12} />{" "}
            {t("proxyChainMenu.common.disconnect", "Disconnect")}
          </button>
        ) : (
          <button
            onClick={() => tunnelMgr.handleConnectChain(chain.id)}
            disabled={
              tunnelMgr.isLoading || isConnecting || Boolean(connectBlockReason)
            }
            title={
              connectBlockReason ??
              t("proxyChainMenu.shared.connectChain", "Connect chain")
            }
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-[var(--color-success)]/15 hover:bg-[var(--color-success)]/25 text-[var(--color-success)] transition-colors disabled:opacity-50"
          >
            <Zap size={12} /> {t("proxyChainMenu.common.connect", "Connect")}
          </button>
        )}
        <button
          onClick={() => tunnelMgr.handleDuplicateChain(chain.id)}
          className="sor-icon-btn"
          title={t("proxyChainMenu.common.duplicate", "Duplicate")}
        >
          <Copy size={14} />
        </button>
        <button
          onClick={() => tunnelMgr.handleEditChain(chain)}
          className="sor-icon-btn"
          title={t("proxyChainMenu.common.edit", "Edit")}
        >
          <Edit2 size={14} />
        </button>
        <button
          onClick={() => tunnelMgr.handleDeleteChain(chain.id)}
          className="sor-icon-btn-danger"
          title={t("proxyChainMenu.common.delete", "Delete")}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
