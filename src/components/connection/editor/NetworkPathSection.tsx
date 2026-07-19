import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleOff,
  Plus,
  RotateCcw,
  Route,
  Trash2,
} from "lucide-react";
import type { Connection } from "../../../types/connection/connection";
import type {
  ProxyConfig,
  ProxyCollectionData,
} from "../../../types/settings/settings";
import { useConnections } from "../../../contexts/useConnections";
import {
  useVpnManager,
  type NormalizedVpnConnection,
} from "../../../hooks/network/useVpnManager";
import { proxyCollectionManager } from "../../../utils/connection/proxyCollectionManager";
import {
  ProxyOpenVPNManager,
  type ConnectionChain,
} from "../../../utils/network/proxyOpenVPNManager";
import type {
  NetworkPathCatalog,
  NetworkPathSourceKind,
} from "../../../utils/network/resolveNetworkPath";
import {
  normalizeExecutableVpnType,
  type ExecutableVpnType,
} from "../../../utils/network/vpnProviderCatalog";
import { Checkbox, NumberInput, Select, TextInput } from "../../ui/forms";
import RawSocketOptions from "../../connectionEditor/rawSocket/RawSocketOptions";
import RloginOptions from "../../connectionEditor/RloginOptions";
import { PowerShellRemotingEditor } from "../../connectionEditor/powerShellRemoting/PowerShellRemotingEditor";
import { normalizeRawSocketSettings } from "../../../types/protocols/rawSocket";
import { normalizeRloginSettings } from "../../../utils/rlogin/rloginSettings";
import { normalizePowerShellRemotingSettings } from "../../../utils/powershell/normalizePowerShellRemoting";
import {
  getNetworkPathEditorModel,
  getRawSocketNetworkRoutes,
  getRloginNetworkPathCapability,
  getRuntimeNetworkPathProtocol,
  getRuntimeNetworkPathProtocolLabel,
  resetNetworkPath,
  selectedInlineVpnId,
  setInlineVpn,
  setLegacyProxy,
  setNetworkPathReference,
  withCurrentOrphanOption,
} from "./networkPathModel";

interface NetworkPathSectionProps {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
}

export interface NetworkPathSectionViewProps extends NetworkPathSectionProps {
  catalog: NetworkPathCatalog;
  vpnConnections: readonly NormalizedVpnConnection[];
  loading?: boolean;
  vpnLoading?: boolean;
  collectionError?: string;
}

const EMPTY_COLLECTION: Pick<
  ProxyCollectionData,
  "profiles" | "chains" | "tunnelChains" | "tunnelProfiles"
> = {
  profiles: [],
  chains: [],
  tunnelChains: [],
  tunnelProfiles: [],
};

const PROXY_TYPES: Array<{ value: ProxyConfig["type"]; label: string }> = [
  { value: "http", label: "HTTP" },
  { value: "https", label: "HTTPS" },
  { value: "socks4", label: "SOCKS4" },
  { value: "socks5", label: "SOCKS5" },
  { value: "http-connect", label: "HTTP CONNECT" },
];

const SOURCE_LABELS: Record<NetworkPathSourceKind, string> = {
  "connection-chain": "Connection chain",
  "proxy-chain": "Proxy chain",
  "tunnel-chain": "Tunnel chain",
  "inline-tunnel": "Inline VPN / tunnel",
  "legacy-vpn": "Legacy OpenVPN",
  "legacy-proxy": "Per-connection proxy",
};

const labelClass =
  "mb-1.5 block text-xs font-medium text-[var(--color-textSecondary)]";
const cardClass =
  "min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/55 p-3";

const SelectionCard: React.FC<{
  label: string;
  hint: string;
  selected: boolean;
  onClear: () => void;
  children: React.ReactNode;
}> = ({ label, hint, selected, onClear, children }) => (
  <div className={cardClass}>
    <div className="mb-2 flex min-w-0 items-start justify-between gap-2">
      <div className="min-w-0">
        <h4 className="text-xs font-semibold text-[var(--color-text)]">
          {label}
        </h4>
        <p className="mt-0.5 text-[10px] leading-4 text-[var(--color-textMuted)]">
          {hint}
        </p>
      </div>
      {selected && (
        <button
          type="button"
          onClick={onClear}
          className="shrink-0 rounded px-1.5 py-1 text-[10px] text-[var(--color-textMuted)] hover:bg-[var(--color-surfaceHover)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={`Clear ${label}`}
        >
          Clear
        </button>
      )}
    </div>
    {children}
  </div>
);

export const NetworkPathSectionView: React.FC<NetworkPathSectionViewProps> = ({
  formData,
  setFormData,
  catalog,
  vpnConnections,
  loading = false,
  vpnLoading = false,
  collectionError,
}) => {
  const protocol = getRuntimeNetworkPathProtocol(formData);
  const model = useMemo(
    () => getNetworkPathEditorModel(formData, catalog, protocol),
    [catalog, formData, protocol],
  );
  const protocolLabel = getRuntimeNetworkPathProtocolLabel(protocol);

  const proxyCollection = catalog.proxyCollection ?? EMPTY_COLLECTION;
  const connectionChainOptions = withCurrentOrphanOption(
    [
      { value: "", label: "None" },
      ...(catalog.connectionChains ?? []).map((chain) => ({
        value: chain.id,
        label: `${chain.name} (${chain.layers.length} layer${chain.layers.length === 1 ? "" : "s"})`,
      })),
    ],
    formData.connectionChainId,
    "connection chain",
  );
  const proxyChainOptions = withCurrentOrphanOption(
    [
      { value: "", label: "None" },
      ...proxyCollection.chains.map((chain) => ({
        value: chain.id,
        label: `${chain.name} (${chain.layers.length} layer${chain.layers.length === 1 ? "" : "s"})`,
      })),
    ],
    formData.proxyChainId,
    "proxy chain",
  );
  const tunnelChainOptions = withCurrentOrphanOption(
    [
      { value: "", label: "None" },
      ...proxyCollection.tunnelChains.map((chain) => ({
        value: chain.id,
        label: `${chain.name} (${chain.layers.length} layer${chain.layers.length === 1 ? "" : "s"})`,
      })),
    ],
    formData.tunnelChainId,
    "tunnel chain",
  );
  const inlineVpnId = selectedInlineVpnId(formData);
  const inlineVpnType = selectedVpnType(formData);
  const providerStatus = inlineVpnType
    ? catalog.vpnProfiles?.providerStatus[inlineVpnType]
    : undefined;
  const availableVpnOptions = [
    { value: "", label: "None" },
    ...vpnConnections.map((vpn) => ({
      value: vpn.id,
      label: `${vpn.name} (${vpn.vpnType}; ${vpn.status})`,
    })),
  ];
  const vpnOptions =
    providerStatus === "loaded"
      ? withCurrentOrphanOption(
          availableVpnOptions,
          inlineVpnId,
          "VPN connection",
        )
      : withPendingVpnOption(availableVpnOptions, inlineVpnId, providerStatus);

  const updateReference = (
    field: "connectionChainId" | "proxyChainId" | "tunnelChainId",
    value: string,
  ) =>
    setFormData((previous) => setNetworkPathReference(previous, field, value));

  const handleVpnChange = (vpnId: string) => {
    const vpn = vpnConnections.find((candidate) => candidate.id === vpnId);
    if (vpnId && !vpn) return;
    setFormData((previous) => setInlineVpn(previous, vpn));
  };

  const legacyProxy = formData.security?.proxy;
  const updateProxy = (updates: Partial<ProxyConfig>) => {
    if (!legacyProxy) return;
    setFormData((previous) =>
      setLegacyProxy(previous, { ...legacyProxy, ...updates }),
    );
  };

  return (
    <div
      id="network-path-section"
      data-testid="network-path-section"
      data-editor-search-field="network-path"
      className="min-w-0 space-y-3"
    >
      <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-primary/25 bg-primary/5 p-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Route size={15} className="shrink-0 text-primary" aria-hidden />
            <p className="text-xs font-semibold text-[var(--color-text)]">
              Deterministic path policy
            </p>
          </div>
          <p className="mt-1 break-words text-[11px] leading-4 text-[var(--color-textMuted)]">
            Connection chain → Proxy chain → Tunnel source → Legacy VPN →
            Per-connection proxy. Sources compose in that order. A saved tunnel
            chain replaces inline VPN/tunnel layers automatically.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setFormData((previous) => resetNetworkPath(previous))}
          className="inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-md border border-[var(--color-border)] px-2 text-[11px] text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="Reset all network path settings"
        >
          <RotateCcw size={12} aria-hidden />
          Reset all
        </button>
      </div>

      {collectionError && (
        <div
          role="status"
          className="rounded-md border border-warning/35 bg-warning/10 px-3 py-2 text-[11px] text-[var(--color-textSecondary)]"
        >
          Some saved network-path collections are unavailable. Existing IDs
          remain visible so they can be cleared or replaced.
        </div>
      )}

      <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
        <SelectionCard
          label="Connection chain"
          hint="Backend-managed VPN/proxy connection layers. Composes first."
          selected={Boolean(formData.connectionChainId)}
          onClear={() => updateReference("connectionChainId", "")}
        >
          <Select
            id="network-path-connection-chain"
            data-testid="network-path-connection-chain"
            label="Connection chain"
            value={formData.connectionChainId ?? ""}
            onChange={(value) => updateReference("connectionChainId", value)}
            options={connectionChainOptions}
            variant="form-sm"
            searchable
            searchPlaceholder="Search connection chains…"
            disabled={loading}
            className="w-full min-w-0"
          />
        </SelectionCard>

        <SelectionCard
          label="Proxy chain"
          hint="Saved strict proxy/SSH-hop chain. Composes after connection layers."
          selected={Boolean(formData.proxyChainId)}
          onClear={() => updateReference("proxyChainId", "")}
        >
          <Select
            id="network-path-proxy-chain"
            data-testid="network-path-proxy-chain"
            label="Proxy chain"
            value={formData.proxyChainId ?? ""}
            onChange={(value) => updateReference("proxyChainId", value)}
            options={proxyChainOptions}
            variant="form-sm"
            searchable
            searchPlaceholder="Search proxy chains…"
            disabled={loading}
            className="w-full min-w-0"
          />
        </SelectionCard>

        <SelectionCard
          label="Tunnel chain"
          hint="Saved tunnel template. Selecting one removes the inline tunnel source."
          selected={Boolean(formData.tunnelChainId)}
          onClear={() => updateReference("tunnelChainId", "")}
        >
          <Select
            id="network-path-tunnel-chain"
            data-testid="network-path-tunnel-chain"
            label="Tunnel chain"
            value={formData.tunnelChainId ?? ""}
            onChange={(value) => updateReference("tunnelChainId", value)}
            options={tunnelChainOptions}
            variant="form-sm"
            searchable
            searchPlaceholder="Search tunnel chains…"
            disabled={loading}
            className="w-full min-w-0"
          />
        </SelectionCard>

        <SelectionCard
          label="Inline VPN"
          hint="A stable saved VPN ID. Selecting one replaces a saved tunnel-chain reference."
          selected={Boolean(inlineVpnId)}
          onClear={() => handleVpnChange("")}
        >
          <Select
            id="network-path-inline-vpn"
            data-testid="network-path-inline-vpn"
            label="Inline VPN"
            value={inlineVpnId}
            onChange={handleVpnChange}
            options={vpnOptions}
            variant="form-sm"
            searchable
            searchPlaceholder="Search VPN connections…"
            disabled={vpnLoading}
            className="w-full min-w-0"
          />
        </SelectionCard>
      </div>

      <section className={cardClass} aria-labelledby="legacy-proxy-heading">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h4
              id="legacy-proxy-heading"
              className="text-xs font-semibold text-[var(--color-text)]"
            >
              Per-connection proxy
            </h4>
            <p className="mt-0.5 text-[10px] leading-4 text-[var(--color-textMuted)]">
              Optional final proxy source. Credentials stay masked and are
              excluded from previews and diagnostics.
            </p>
          </div>
          {legacyProxy ? (
            <button
              type="button"
              onClick={() =>
                setFormData((previous) => setLegacyProxy(previous, undefined))
              }
              className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[11px] text-danger hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label="Remove per-connection proxy"
            >
              <Trash2 size={12} aria-hidden /> Remove
            </button>
          ) : (
            <button
              type="button"
              onClick={() =>
                setFormData((previous) =>
                  setLegacyProxy(previous, {
                    type: "socks5",
                    host: "",
                    port: 1080,
                    enabled: true,
                  }),
                )
              }
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Plus size={12} aria-hidden /> Add proxy
            </button>
          )}
        </div>

        {legacyProxy && (
          <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="min-w-0">
              <span className={labelClass}>Type</span>
              <Select
                id="network-path-legacy-proxy-type"
                label="Per-connection proxy type"
                value={legacyProxy.type}
                onChange={(value) =>
                  updateProxy({ type: value as ProxyConfig["type"] })
                }
                options={withCurrentOrphanOption(
                  PROXY_TYPES,
                  legacyProxy.type,
                  "proxy type",
                )}
                variant="form-sm"
                searchable
                className="w-full min-w-0"
              />
            </label>
            <label className="min-w-0">
              <span className={labelClass}>Host</span>
              <TextInput
                id="network-path-legacy-proxy-host"
                label="Per-connection proxy host"
                value={legacyProxy.host}
                onChange={(host) => updateProxy({ host })}
                variant="form-sm"
                className="w-full min-w-0"
                autoComplete="off"
              />
            </label>
            <label className="min-w-0">
              <span className={labelClass}>Port</span>
              <NumberInput
                id="network-path-legacy-proxy-port"
                label="Per-connection proxy port"
                value={legacyProxy.port}
                onChange={(port) => updateProxy({ port })}
                variant="form-sm"
                min={1}
                max={65535}
                className="w-full min-w-0"
              />
            </label>
            <label className="flex min-w-0 items-end gap-2 pb-2 text-xs text-[var(--color-textSecondary)]">
              <Checkbox
                checked={legacyProxy.enabled}
                onChange={(enabled) => updateProxy({ enabled })}
                variant="form"
                aria-label="Enable per-connection proxy"
              />
              Enabled
            </label>
            <label className="min-w-0">
              <span className={labelClass}>Username (optional)</span>
              <TextInput
                id="network-path-legacy-proxy-username"
                label="Per-connection proxy username"
                value={legacyProxy.username ?? ""}
                onChange={(username) => updateProxy({ username })}
                variant="form-sm"
                className="w-full min-w-0"
                autoComplete="off"
              />
            </label>
            <label className="min-w-0 sm:col-span-2 lg:col-span-3">
              <span className={labelClass}>Password (optional)</span>
              <input
                id="network-path-legacy-proxy-password"
                type="password"
                aria-label="Per-connection proxy password"
                value={legacyProxy.password ?? ""}
                onChange={(event) =>
                  updateProxy({ password: event.target.value || undefined })
                }
                autoComplete="new-password"
                className="sor-form-input-sm w-full min-w-0"
              />
            </label>
          </div>
        )}
      </section>

      <section className={cardClass} aria-labelledby="path-preview-heading">
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h4
              id="path-preview-heading"
              className="text-xs font-semibold text-[var(--color-text)]"
            >
              Resolved ordered path
            </h4>
            <p className="mt-0.5 text-[10px] text-[var(--color-textMuted)]">
              Outermost first; the target is reached after the final layer.
            </p>
          </div>
          <span
            className={`inline-flex w-fit shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium ${
              model.runtime.supported
                ? "border-success/30 bg-success/10 text-success"
                : "border-danger/30 bg-danger/10 text-danger"
            }`}
          >
            {model.runtime.supported ? (
              <CheckCircle2 size={11} aria-hidden />
            ) : (
              <CircleOff size={11} aria-hidden />
            )}
            {model.runtime.supported ? "Runtime supported" : "Connect blocked"}
          </span>
        </div>

        {model.summary.layers.length === 0 ? (
          <div className="mt-3 rounded-md border border-dashed border-[var(--color-border)] px-3 py-3 text-center text-xs text-[var(--color-textMuted)]">
            Direct → Target
          </div>
        ) : (
          <ol
            className="mt-3 space-y-2"
            aria-label="Resolved network path layers"
          >
            {model.summary.layers.map((layer) => (
              <li
                key={`${layer.order}-${layer.source.kind}-${layer.transport}`}
                className="flex min-w-0 items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surfaceHover)]/35 px-2.5 py-2"
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
                  {layer.order + 1}
                </span>
                <span className="min-w-0 flex-1 break-words text-xs font-medium text-[var(--color-text)]">
                  {layer.transport}
                </span>
                <span className="max-w-[45%] shrink truncate rounded-full bg-[var(--color-surfaceHover)] px-2 py-0.5 text-[10px] text-[var(--color-textMuted)]">
                  {SOURCE_LABELS[layer.source.kind]}
                </span>
              </li>
            ))}
            <li className="pl-7 text-[10px] font-medium text-success">
              → Target
            </li>
          </ol>
        )}

        <div
          aria-live="polite"
          className={`mt-3 rounded-md border px-3 py-2 text-[11px] leading-4 ${
            model.runtime.supported
              ? "border-success/25 bg-success/5 text-[var(--color-textSecondary)]"
              : "border-danger/35 bg-danger/10 text-danger"
          }`}
        >
          {model.runtime.message}
        </div>
      </section>

      {formData.protocol === "raw" && (
        <RawSocketOptions
          value={normalizeRawSocketSettings(formData.rawSocketSettings)}
          onChange={(rawSocketSettings) =>
            setFormData((previous) => ({
              ...previous,
              rawSocketSettings,
            }))
          }
          sections={["network-path"]}
          networkRoutes={getRawSocketNetworkRoutes(model)}
          targetHost={formData.hostname}
          targetPort={formData.port}
        />
      )}

      {formData.protocol === "rlogin" && (
        <RloginOptions
          settings={normalizeRloginSettings(formData.rloginSettings)}
          port={formData.port ?? 513}
          onSettingsChange={(rloginSettings) =>
            setFormData((previous) => ({ ...previous, rloginSettings }))
          }
          onPortChange={(port) =>
            setFormData((previous) => ({ ...previous, port }))
          }
          networkPath={getRloginNetworkPathCapability(model)}
          section="network-path"
        />
      )}

      {formData.protocol === "winrm" && (
        <PowerShellRemotingEditor
          targetHost={formData.hostname ?? ""}
          value={
            normalizePowerShellRemotingSettings(formData.powerShellRemoting)
              .settings
          }
          onChange={(powerShellRemoting) =>
            setFormData((previous) => ({
              ...previous,
              powerShellRemoting,
              username: powerShellRemoting.credential.username,
              domain: powerShellRemoting.credential.domain ?? undefined,
            }))
          }
          sections={["network-path"]}
          networkPathSummary={model.runtime.message}
        />
      )}

      <section className={cardClass} aria-labelledby="path-support-heading">
        <h4
          id="path-support-heading"
          className="text-xs font-semibold text-[var(--color-text)]"
        >
          {protocolLabel} support
        </h4>
        <p className="mt-1 text-[11px] leading-4 text-[var(--color-textMuted)]">
          {protocol === "rdp"
            ? "RDP supports a VPN prefix and socket paths whose final hop is an SSH bastion. A proxy-only path is blocked because it cannot create the required local forward."
            : protocol === "ssh"
              ? "SSH supports a VPN prefix, strict HTTP/HTTPS/SOCKS4/SOCKS5 proxy hops, and SSH jump or tunnel hops. Dynamic routing, ProxyCommand, stdio, and unsupported tunnel transports fail closed."
              : protocol === "powershell"
                ? "Direct PowerShell Remoting is available. Every configured shared route is blocked until the backend exposes a network-path adapter; the editor never bypasses it."
                : `${protocolLabel} supports direct connections now. Every configured VPN, proxy, tunnel, or jump-host layer is blocked until a compatible transport adapter is available.`}
        </p>
      </section>

      {model.validation.issues.length > 0 && (
        <section
          className={cardClass}
          aria-labelledby="path-diagnostics-heading"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-warning" aria-hidden />
            <h4
              id="path-diagnostics-heading"
              className="text-xs font-semibold text-[var(--color-text)]"
            >
              Diagnostics
            </h4>
          </div>
          <ul className="mt-2 space-y-1.5">
            {model.validation.issues.map((issue, index) => (
              <li
                key={`${issue.code}-${index}`}
                className={`break-words rounded-md border px-2.5 py-2 text-[11px] leading-4 ${
                  issue.severity === "error"
                    ? "border-danger/30 bg-danger/5 text-danger"
                    : "border-warning/30 bg-warning/5 text-[var(--color-textSecondary)]"
                }`}
              >
                <span className="font-semibold capitalize">
                  {issue.severity}:
                </span>{" "}
                {issue.message}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};

const NetworkPathSection: React.FC<NetworkPathSectionProps> = (props) => {
  const { state } = useConnections();
  const vpnManager = useVpnManager(true);
  const [proxyCollection, setProxyCollection] = useState(EMPTY_COLLECTION);
  const [connectionChains, setConnectionChains] = useState<ConnectionChain[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [collectionError, setCollectionError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    const snapshotCollection = () => {
      if (cancelled) return;
      setProxyCollection({
        profiles: proxyCollectionManager.getProfiles(),
        chains: proxyCollectionManager.getChains(),
        tunnelChains: proxyCollectionManager.getTunnelChains(),
        tunnelProfiles: proxyCollectionManager.getTunnelProfiles(),
      });
    };
    const unsubscribe = proxyCollectionManager.subscribe(snapshotCollection);

    void Promise.allSettled([
      proxyCollectionManager.initialize().then(snapshotCollection),
      ProxyOpenVPNManager.getInstance()
        .listConnectionChains()
        .then((chains) => {
          if (!cancelled) setConnectionChains(chains);
        }),
    ]).then((results) => {
      if (cancelled) return;
      if (results.some((result) => result.status === "rejected")) {
        setCollectionError("collection-unavailable");
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const catalog = useMemo<NetworkPathCatalog>(
    () => ({
      connections: state.connections,
      proxyCollection,
      connectionChains,
      vpnProfiles: vpnManager.profileCatalog,
    }),
    [
      connectionChains,
      proxyCollection,
      state.connections,
      vpnManager.profileCatalog,
    ],
  );

  return (
    <NetworkPathSectionView
      {...props}
      catalog={catalog}
      vpnConnections={vpnManager.connections}
      loading={loading}
      vpnLoading={vpnManager.isLoading && vpnManager.connections.length === 0}
      collectionError={collectionError || vpnManager.error || undefined}
    />
  );
};

export default NetworkPathSection;

function selectedVpnType(
  formData: Readonly<Partial<Connection>>,
): ExecutableVpnType | undefined {
  if (formData.tunnelChainId) return undefined;
  const inline = formData.security?.tunnelChain?.find((layer) =>
    normalizeExecutableVpnType(layer.type),
  );
  return (
    normalizeExecutableVpnType(inline?.type) ??
    (formData.security?.openvpn?.enabled ? "openvpn" : undefined)
  );
}

function withPendingVpnOption(
  options: Array<{ value: string; label: string }>,
  currentId: string,
  status: "error" | undefined,
): Array<{ value: string; label: string; title?: string }> {
  if (!currentId || options.some((option) => option.value === currentId)) {
    return options;
  }
  const unavailable = status === "error";
  return [
    ...options,
    {
      value: currentId,
      label: `${unavailable ? "Unverified" : "Checking"} VPN connection (${currentId})`,
      title: unavailable
        ? "The provider profile store could not be loaded. This association has not been classified as deleted."
        : "The provider profile store is still loading.",
    },
  ];
}
