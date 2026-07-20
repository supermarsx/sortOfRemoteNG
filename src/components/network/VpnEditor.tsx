import React from "react";
import {
  Shield,
  Globe,
  Wifi,
  FolderOpen,
  X,
  Plus,
  Loader2,
  AlertCircle,
  Save,
  Tag,
  type LucideIcon,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  useVpnEditor,
  type VpnEditorSecretField,
  type VpnEditorType,
} from "../../hooks/network/useVpnEditor";
import type { VpnSecretPresence } from "../../utils/network/vpnIpcAdapter";
import {
  EXECUTABLE_VPN_PROVIDERS,
  getVpnProviderLabel,
  type ExecutableVpnType,
} from "../../utils/network/vpnProviderCatalog";

type Mgr = ReturnType<typeof useVpnEditor>;

// ── CSS helpers ─────────────────────────────────────────────────

const inputCls =
  "w-full px-3 py-2 text-sm rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]";
const labelCls =
  "block text-xs font-medium text-[var(--color-textSecondary)] mb-1.5";
const sectionCls = "space-y-4";
const sectionHeadingCls =
  "text-sm font-medium text-[var(--color-text)] pb-2 border-b border-[var(--color-border)]";
const checkCls = "flex items-center gap-2 text-sm text-[var(--color-text)]";

// ── VPN type definitions ────────────────────────────────────────

const VPN_TYPE_ICONS: Record<ExecutableVpnType, LucideIcon> = {
  openvpn: Shield,
  wireguard: Globe,
  tailscale: Wifi,
  zerotier: Globe,
};

const VPN_TYPES = EXECUTABLE_VPN_PROVIDERS.map((provider) => ({
  value: provider.type,
  label: provider.label,
  icon: VPN_TYPE_ICONS[provider.type],
}));

// ── Shared sub-components ───────────────────────────────────────

function FormField({
  label,
  children,
  span,
}: {
  label: string;
  children: React.ReactNode;
  span?: number;
}) {
  return (
    <div className={span === 2 ? "col-span-2" : ""}>
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  );
}

function BrowseField({
  value,
  onChange,
  label,
  extensions,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  extensions?: string[];
}) {
  const handleBrowse = async () => {
    const selected = await open({
      multiple: false,
      filters: extensions ? [{ name: label, extensions }] : undefined,
    });
    if (selected) onChange(typeof selected === "string" ? selected : selected);
  };
  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={label}
        className={inputCls + " flex-1"}
      />
      <button
        onClick={handleBrowse}
        className="px-3 py-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] transition-colors"
        title="Browse"
      >
        <FolderOpen size={14} />
      </button>
    </div>
  );
}

function SecretStatus({
  mgr,
  field,
}: {
  mgr: Mgr;
  field: VpnEditorSecretField;
}) {
  const state = mgr.getSecretState(field);
  if (state.clearRequested) {
    return (
      <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-amber-400">
        <span>Stored secret will be cleared when this profile is updated.</span>
        <button
          type="button"
          onClick={() => mgr.undoClearSecret(field)}
          className="shrink-0 hover:text-amber-300"
        >
          Undo clear
        </button>
      </div>
    );
  }
  if (state.replacementEntered) {
    return (
      <p className="mt-1 text-[11px] text-sky-300">
        {state.stored
          ? "New value will replace the stored secret."
          : "New secret will be stored securely."}
      </p>
    );
  }
  if (!state.stored) return null;
  return (
    <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-emerald-400">
      <span>Stored securely. Leave blank to keep this secret.</span>
      <button
        type="button"
        onClick={() => mgr.clearSecret(field)}
        className="shrink-0 text-red-300 hover:text-red-200"
      >
        Clear stored secret
      </button>
    </div>
  );
}

// ── Section: Basic Info ─────────────────────────────────────────

const BasicInfoSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className={sectionCls}>
    <div className={sectionHeadingCls}>Basic Info</div>
    <div>
      <label className={labelCls}>Name *</label>
      <input
        type="text"
        value={mgr.name}
        onChange={(e) => mgr.setName(e.target.value)}
        placeholder="My VPN Connection"
        className={inputCls}
        autoFocus
      />
    </div>
    <div>
      <label className={labelCls}>Description</label>
      <textarea
        value={mgr.description}
        onChange={(e) => mgr.setDescription(e.target.value)}
        placeholder="Optional description..."
        rows={2}
        className={inputCls + " resize-none"}
      />
    </div>
  </div>
);

// ── Section: VPN Type ───────────────────────────────────────────

const VpnTypeSelector: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className={sectionCls}>
    <div className={sectionHeadingCls}>VPN Type</div>
    <div className="grid grid-cols-3 gap-2">
      {VPN_TYPES.map((type) => {
        const Icon = type.icon;
        const isSelected = mgr.vpnType === type.value;
        return (
          <button
            key={type.value}
            onClick={() => mgr.handleTypeChange(type.value)}
            className={`p-3 rounded-lg border text-center transition-all flex flex-col items-center gap-1.5 ${
              isSelected
                ? "border-primary bg-primary/20 text-primary"
                : "border-[var(--color-border)] bg-[var(--color-input)] text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)]"
            }`}
          >
            <Icon size={18} />
            <div className="text-xs font-medium">{type.label}</div>
          </button>
        );
      })}
    </div>
  </div>
);

// ── OpenVPN Config Form ─────────────────────────────────────────

const OpenVpnConfigForm: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { config, updateConfig } = mgr;
  const up = (k: string, v: any) => updateConfig({ [k]: v });
  const inlineState = mgr.getSecretState("inlineConfig");
  const hasConfigSource =
    [config.configFile, config.inlineConfig].some(
      (value) => typeof value === "string" && value.trim() !== "",
    ) ||
    (inlineState.stored && !inlineState.clearRequested);

  return (
    <div className="space-y-5">
      {hasConfigSource && (
        <div className="rounded-md border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-[var(--color-textSecondary)]">
          The selected OpenVPN configuration is authoritative for server,
          certificate, TLS, routing, and custom options. Only the authentication
          override below is applied separately.
        </div>
      )}
      {/* Server */}
      {!hasConfigSource && (
        <div className="space-y-3">
          <div className="text-xs font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider">
            Server
          </div>
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Remote Host" span={2}>
              <input
                type="text"
                value={config.remoteHost ?? ""}
                onChange={(e) => up("remoteHost", e.target.value)}
                placeholder="vpn.example.com"
                className={inputCls}
              />
            </FormField>
            <FormField label="Port">
              <input
                type="number"
                value={config.remotePort ?? 1194}
                onChange={(e) =>
                  up("remotePort", parseInt(e.target.value) || 1194)
                }
                className={inputCls}
              />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Protocol">
              <select
                value={config.protocol ?? "udp"}
                onChange={(e) => up("protocol", e.target.value)}
                className={inputCls}
              >
                <option value="udp">UDP</option>
                <option value="tcp">TCP</option>
              </select>
            </FormField>
            <FormField label="Cipher">
              <input
                type="text"
                value={config.cipher ?? ""}
                onChange={(e) => up("cipher", e.target.value)}
                placeholder="AES-256-GCM"
                className={inputCls}
              />
            </FormField>
          </div>
        </div>
      )}

      {/* Authentication */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider">
          Authentication
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Username">
            <input
              type="text"
              value={config.username ?? ""}
              onChange={(e) => up("username", e.target.value)}
              placeholder="vpn-user"
              className={inputCls}
            />
          </FormField>
          <FormField label="Password">
            <input
              type="password"
              value={config.password ?? ""}
              onChange={(e) => up("password", e.target.value)}
              placeholder={
                mgr.getSecretState("password").stored
                  ? "Stored secret — leave blank to keep"
                  : "Enter password"
              }
              className={inputCls}
            />
            <SecretStatus mgr={mgr} field="password" />
          </FormField>
        </div>
      </div>

      {/* Certificates & Keys */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider">
          Certificates & Keys
        </div>
        <FormField label="Config File (.ovpn)">
          <BrowseField
            value={config.configFile ?? ""}
            onChange={(v) =>
              updateConfig({
                configFile: v,
              })
            }
            label="OpenVPN Config"
            extensions={["ovpn", "conf"]}
          />
          {(config.inlineConfig || inlineState.stored) && (
            <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-[var(--color-textMuted)]">
              <p>
                Imported configuration is stored securely with this profile.
                Choose a file only to replace it.
              </p>
              <button
                type="button"
                onClick={() =>
                  inlineState.stored
                    ? mgr.clearSecret("inlineConfig")
                    : up("inlineConfig", undefined)
                }
                className="shrink-0 text-sky-300 hover:text-sky-200"
              >
                Switch to manual
              </button>
            </div>
          )}
        </FormField>
        <FormField label="Inline Configuration">
          <textarea
            value={config.inlineConfig ?? ""}
            onChange={(event) => up("inlineConfig", event.target.value)}
            placeholder={
              inlineState.stored
                ? "Stored inline configuration — leave blank to keep"
                : "Paste OpenVPN client configuration"
            }
            rows={4}
            className={inputCls + " resize-y font-mono"}
          />
          {config.configFile && (
            <p className="mt-1 text-[11px] text-[var(--color-textMuted)]">
              The selected config file takes precedence over inline content.
            </p>
          )}
          <SecretStatus mgr={mgr} field="inlineConfig" />
        </FormField>
        {!hasConfigSource && (
          <FormField label="CA Certificate">
            <BrowseField
              value={config.caCert ?? ""}
              onChange={(v) => up("caCert", v)}
              label="CA Certificate"
              extensions={["crt", "pem", "ca"]}
            />
          </FormField>
        )}
        {!hasConfigSource && (
          <FormField label="Client Certificate">
            <BrowseField
              value={config.clientCert ?? ""}
              onChange={(v) => up("clientCert", v)}
              label="Client Cert"
              extensions={["crt", "pem"]}
            />
          </FormField>
        )}
        {!hasConfigSource && (
          <FormField label="Client Key">
            <BrowseField
              value={config.clientKey ?? ""}
              onChange={(v) => up("clientKey", v)}
              label="Client Key"
              extensions={["key", "pem"]}
            />
            <SecretStatus mgr={mgr} field="clientKey" />
          </FormField>
        )}
        {hasConfigSource && mgr.getSecretState("clientKey").stored && (
          <FormField label="Client Key">
            <SecretStatus mgr={mgr} field="clientKey" />
          </FormField>
        )}
        <FormField label="Auth File">
          <BrowseField
            value={config.authFile ?? ""}
            onChange={(v) => up("authFile", v)}
            label="Auth File"
            extensions={["txt"]}
          />
        </FormField>
      </div>

      {/* Options */}
      {!hasConfigSource && (
        <div className="space-y-3">
          <div className="text-xs font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider">
            Options
          </div>
          <div className="grid grid-cols-3 gap-x-4 gap-y-2">
            <label className={checkCls}>
              <input
                type="checkbox"
                checked={config.tlsAuth ?? false}
                onChange={(e) =>
                  updateConfig({
                    tlsAuth: e.target.checked,
                    ...(e.target.checked
                      ? { tlsCrypt: false, tlsCryptFile: undefined }
                      : {}),
                  })
                }
              />
              TLS Auth
            </label>
            <label className={checkCls}>
              <input
                type="checkbox"
                checked={config.tlsCrypt ?? false}
                onChange={(e) =>
                  updateConfig({
                    tlsCrypt: e.target.checked,
                    ...(e.target.checked
                      ? { tlsAuth: false, tlsAuthFile: undefined }
                      : {}),
                  })
                }
              />
              TLS Crypt
            </label>
            <label className={checkCls}>
              <input
                type="checkbox"
                checked={config.compression ?? false}
                onChange={(e) => up("compression", e.target.checked)}
              />
              Compression
            </label>
            <label className={checkCls}>
              <input
                type="checkbox"
                checked={config.routeNoPull ?? false}
                onChange={(e) => up("routeNoPull", e.target.checked)}
              />
              Route No Pull
            </label>
            <label className={checkCls}>
              <input
                type="checkbox"
                checked={config.mtuDiscover ?? false}
                onChange={(e) => up("mtuDiscover", e.target.checked)}
              />
              MTU Discover
            </label>
          </div>
          {(config.tlsAuth || config.tlsCrypt) && (
            <div className="grid grid-cols-2 gap-3">
              {config.tlsAuth && (
                <FormField label="TLS Auth Key File">
                  <BrowseField
                    value={config.tlsAuthFile ?? ""}
                    onChange={(value) => up("tlsAuthFile", value)}
                    label="TLS Auth Key"
                    extensions={["key", "pem"]}
                  />
                  {!config.tlsAuthFile && (
                    <p className="mt-1 text-[11px] text-red-400">
                      A key file is required for manual TLS Auth.
                    </p>
                  )}
                </FormField>
              )}
              {config.tlsCrypt && (
                <FormField label="TLS Crypt Key File">
                  <BrowseField
                    value={config.tlsCryptFile ?? ""}
                    onChange={(value) => up("tlsCryptFile", value)}
                    label="TLS Crypt Key"
                    extensions={["key", "pem"]}
                  />
                  {!config.tlsCryptFile && (
                    <p className="mt-1 text-[11px] text-red-400">
                      A key file is required for manual TLS Crypt.
                    </p>
                  )}
                </FormField>
              )}
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            <FormField label="MSS Fix">
              <input
                type="number"
                value={config.mssFix ?? ""}
                onChange={(e) =>
                  up(
                    "mssFix",
                    e.target.value ? parseInt(e.target.value) : undefined,
                  )
                }
                placeholder="1450"
                className={inputCls}
              />
            </FormField>
            <FormField label="TUN MTU">
              <input
                type="number"
                value={config.tunMtu ?? ""}
                onChange={(e) =>
                  up(
                    "tunMtu",
                    e.target.value ? parseInt(e.target.value) : undefined,
                  )
                }
                placeholder="1500"
                className={inputCls}
              />
            </FormField>
            <FormField label="Fragment">
              <input
                type="number"
                value={config.fragment ?? ""}
                onChange={(e) =>
                  up(
                    "fragment",
                    e.target.value ? parseInt(e.target.value) : undefined,
                  )
                }
                placeholder=""
                className={inputCls}
              />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Keep-Alive Interval (s)">
              <input
                type="number"
                value={config.keepAliveInterval ?? ""}
                onChange={(e) =>
                  up(
                    "keepAliveInterval",
                    e.target.value ? parseInt(e.target.value) : undefined,
                  )
                }
                placeholder="10"
                className={inputCls}
              />
            </FormField>
            <FormField label="Keep-Alive Timeout (s)">
              <input
                type="number"
                value={config.keepAliveTimeout ?? ""}
                onChange={(e) =>
                  up(
                    "keepAliveTimeout",
                    e.target.value ? parseInt(e.target.value) : undefined,
                  )
                }
                placeholder="60"
                className={inputCls}
              />
            </FormField>
          </div>
        </div>
      )}

      {/* Custom Options */}
      {!hasConfigSource && (
        <div className="space-y-3">
          <div className="text-xs font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider">
            Custom Options
          </div>
          <textarea
            value={config.customOptions ?? ""}
            onChange={(e) => up("customOptions", e.target.value)}
            placeholder={
              "One option per line, e.g.:\n--ping-restart 30\n--persist-tun"
            }
            rows={4}
            className={inputCls + " resize-y font-mono"}
          />
        </div>
      )}
    </div>
  );
};

// ── WireGuard Config Form ───────────────────────────────────────

const WireGuardConfigForm: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { config, updateConfig } = mgr;
  const up = (k: string, v: any) => updateConfig({ [k]: v });
  const privateKeyState = mgr.getSecretState("privateKey");
  const keyless =
    !config.configFile &&
    !privateKeyState.stored &&
    !privateKeyState.replacementEntered;

  return (
    <div className="space-y-5">
      {keyless && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
          This WireGuard profile has no private key. It can be saved, but
          connecting remains disabled until a key or a config file is supplied.
        </div>
      )}
      {/* Config File */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider">
          Config File
        </div>
        <FormField label="WireGuard Config (.conf)">
          <BrowseField
            value={config.configFile ?? ""}
            onChange={(v) => up("configFile", v)}
            label="WireGuard Config"
            extensions={["conf"]}
          />
        </FormField>
      </div>

      {/* [Interface] */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider">
          [Interface]
        </div>
        <FormField label="Private Key">
          <input
            type="password"
            value={config.privateKey ?? ""}
            onChange={(e) => up("privateKey", e.target.value)}
            placeholder={
              privateKeyState.stored
                ? "Stored private key — leave blank to keep"
                : "Base64-encoded private key"
            }
            className={inputCls}
          />
          <SecretStatus mgr={mgr} field="privateKey" />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Address(es)">
            <input
              type="text"
              value={config.address ?? ""}
              onChange={(e) => up("address", e.target.value)}
              placeholder="10.0.0.2/32, fd00::2/128"
              className={inputCls}
            />
          </FormField>
          <FormField label="DNS">
            <input
              type="text"
              value={config.dns ?? ""}
              onChange={(e) => up("dns", e.target.value)}
              placeholder="1.1.1.1, 8.8.8.8"
              className={inputCls}
            />
          </FormField>
        </div>
        <FormField label="MTU">
          <input
            type="number"
            value={config.mtu ?? ""}
            onChange={(e) =>
              up("mtu", e.target.value ? parseInt(e.target.value) : undefined)
            }
            placeholder="1420"
            className={inputCls}
          />
        </FormField>
      </div>

      {/* [Peer] */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider">
          [Peer]
        </div>
        <FormField label="Public Key">
          <input
            type="text"
            value={config.publicKey ?? ""}
            onChange={(e) => up("publicKey", e.target.value)}
            placeholder="Base64-encoded public key"
            className={inputCls}
          />
        </FormField>
        <FormField label="Preshared Key">
          <input
            type="password"
            value={config.presharedKey ?? ""}
            onChange={(e) => up("presharedKey", e.target.value)}
            placeholder={
              mgr.getSecretState("presharedKey").stored
                ? "Stored preshared key — leave blank to keep"
                : "Optional preshared key"
            }
            className={inputCls}
          />
          <SecretStatus mgr={mgr} field="presharedKey" />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Endpoint">
            <input
              type="text"
              value={config.endpoint ?? ""}
              onChange={(e) => up("endpoint", e.target.value)}
              placeholder="vpn.example.com:51820"
              className={inputCls}
            />
          </FormField>
          <FormField label="Persistent Keepalive (s)">
            <input
              type="number"
              value={config.persistentKeepalive ?? ""}
              onChange={(e) =>
                up(
                  "persistentKeepalive",
                  e.target.value ? parseInt(e.target.value) : undefined,
                )
              }
              placeholder="25"
              className={inputCls}
            />
          </FormField>
        </div>
        <FormField label="Allowed IPs">
          <input
            type="text"
            value={config.allowedIPs ?? "0.0.0.0/0"}
            onChange={(e) => up("allowedIPs", e.target.value)}
            placeholder="0.0.0.0/0, ::/0"
            className={inputCls}
          />
        </FormField>
      </div>
    </div>
  );
};

// ── Tailscale Config Form ───────────────────────────────────────

const TailscaleConfigForm: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { config, updateConfig } = mgr;
  const up = (k: string, v: any) => updateConfig({ [k]: v });

  return (
    <div className="space-y-5">
      <FormField label="Auth Key">
        <input
          type="password"
          value={config.authKey ?? ""}
          onChange={(e) => up("authKey", e.target.value)}
          placeholder={
            mgr.getSecretState("authKey").stored
              ? "Stored auth key — leave blank to keep"
              : "tskey-auth-..."
          }
          className={inputCls}
        />
        <SecretStatus mgr={mgr} field="authKey" />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Login Server">
          <input
            type="text"
            value={config.loginServer ?? ""}
            onChange={(e) => up("loginServer", e.target.value)}
            placeholder="https://controlplane.tailscale.com"
            className={inputCls}
          />
        </FormField>
        <FormField label="Exit Node">
          <input
            type="text"
            value={config.exitNode ?? ""}
            onChange={(e) => up("exitNode", e.target.value)}
            placeholder="Node ID or IP"
            className={inputCls}
          />
        </FormField>
      </div>
      <FormField label="Advertise Routes">
        <input
          type="text"
          value={config.advertiseRoutes ?? ""}
          onChange={(e) => up("advertiseRoutes", e.target.value)}
          placeholder="10.0.0.0/24"
          className={inputCls}
        />
      </FormField>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <label className={checkCls}>
          <input
            type="checkbox"
            checked={config.acceptRoutes ?? false}
            onChange={(e) => up("acceptRoutes", e.target.checked)}
          />
          Accept Routes
        </label>
        <label className={checkCls}>
          <input
            type="checkbox"
            checked={config.ssh ?? false}
            onChange={(e) => up("ssh", e.target.checked)}
          />
          Tailscale SSH
        </label>
      </div>
    </div>
  );
};

// ── ZeroTier Config Form ────────────────────────────────────────

const ZeroTierConfigForm: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { config, updateConfig } = mgr;
  const up = (k: string, v: any) => updateConfig({ [k]: v });

  return (
    <div className="space-y-5">
      <FormField label="Network ID *">
        <input
          type="text"
          value={config.networkId ?? ""}
          onChange={(e) => up("networkId", e.target.value)}
          placeholder="16-character hex network ID"
          className={inputCls}
        />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Identity Public Key">
          <input
            type="text"
            value={config.identityPublic ?? ""}
            onChange={(event) => up("identityPublic", event.target.value)}
            placeholder="Optional public identity"
            className={inputCls}
          />
        </FormField>
        <FormField label="Identity Secret">
          <input
            type="password"
            value={config.identitySecret ?? ""}
            onChange={(event) => up("identitySecret", event.target.value)}
            placeholder={
              mgr.getSecretState("identitySecret").stored
                ? "Stored identity secret — leave blank to keep"
                : "Optional identity secret"
            }
            className={inputCls}
          />
          <SecretStatus mgr={mgr} field="identitySecret" />
        </FormField>
      </div>
      <FormField label="Auth Token Secret">
        <input
          type="password"
          value={config.authtokenSecret ?? ""}
          onChange={(event) => up("authtokenSecret", event.target.value)}
          placeholder={
            mgr.getSecretState("authtokenSecret").stored
              ? "Stored auth token — leave blank to keep"
              : "Optional local API auth token"
          }
          className={inputCls}
        />
        <SecretStatus mgr={mgr} field="authtokenSecret" />
      </FormField>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <label className={checkCls}>
          <input
            type="checkbox"
            checked={config.allowManaged ?? true}
            onChange={(e) => up("allowManaged", e.target.checked)}
          />
          Allow Managed
        </label>
        <label className={checkCls}>
          <input
            type="checkbox"
            checked={config.allowGlobal ?? false}
            onChange={(e) => up("allowGlobal", e.target.checked)}
          />
          Allow Global
        </label>
        <label className={checkCls}>
          <input
            type="checkbox"
            checked={config.allowDefault ?? false}
            onChange={(e) => up("allowDefault", e.target.checked)}
          />
          Allow Default Route
        </label>
        <label className={checkCls}>
          <input
            type="checkbox"
            checked={config.allowDNS ?? false}
            onChange={(e) => up("allowDNS", e.target.checked)}
          />
          Allow DNS
        </label>
      </div>
    </div>
  );
};

// ── PPTP Config Form ───────────────────────────────────────────

const PPTPConfigForm: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { config, updateConfig } = mgr;
  const up = (k: string, v: any) => updateConfig({ [k]: v });

  return (
    <div className="space-y-5">
      {/* Security Warning */}
      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-md p-3 mb-4">
        <p className="text-yellow-500 text-sm font-medium">Security Warning</p>
        <p className="text-yellow-500/80 text-xs mt-1">
          PPTP uses MS-CHAPv2 which is cryptographically broken. Use IKEv2 or
          WireGuard instead when possible.
        </p>
      </div>

      {/* Server */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider">
          Server
        </div>
        <FormField label="Server Address *">
          <input
            type="text"
            value={config.server ?? ""}
            onChange={(e) => up("server", e.target.value)}
            placeholder="vpn.example.com"
            className={inputCls}
          />
        </FormField>
      </div>

      {/* Authentication */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider">
          Authentication
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Username *">
            <input
              type="text"
              value={config.username ?? ""}
              onChange={(e) => up("username", e.target.value)}
              placeholder="vpn-user"
              className={inputCls}
            />
          </FormField>
          <FormField label="Password *">
            <input
              type="password"
              value={config.password ?? ""}
              onChange={(e) => up("password", e.target.value)}
              placeholder="••••••••"
              className={inputCls}
            />
          </FormField>
        </div>
        <FormField label="Domain">
          <input
            type="text"
            value={config.domain ?? ""}
            onChange={(e) => up("domain", e.target.value)}
            placeholder="WORKGROUP"
            className={inputCls}
          />
        </FormField>
      </div>

      {/* Options */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider">
          Options
        </div>
        <div className="grid grid-cols-3 gap-x-4 gap-y-2">
          <label className={checkCls}>
            <input
              type="checkbox"
              checked={config.requireMppe ?? false}
              onChange={(e) => up("requireMppe", e.target.checked)}
            />
            Require MPPE
          </label>
          <label className={checkCls}>
            <input
              type="checkbox"
              checked={config.mppeStateful ?? false}
              onChange={(e) => up("mppeStateful", e.target.checked)}
            />
            MPPE Stateful
          </label>
          <label className={checkCls}>
            <input
              type="checkbox"
              checked={config.refuseEap ?? false}
              onChange={(e) => up("refuseEap", e.target.checked)}
            />
            Refuse EAP
          </label>
          <label className={checkCls}>
            <input
              type="checkbox"
              checked={config.refusePap ?? false}
              onChange={(e) => up("refusePap", e.target.checked)}
            />
            Refuse PAP
          </label>
          <label className={checkCls}>
            <input
              type="checkbox"
              checked={config.refuseChap ?? false}
              onChange={(e) => up("refuseChap", e.target.checked)}
            />
            Refuse CHAP
          </label>
          <label className={checkCls}>
            <input
              type="checkbox"
              checked={config.refuseMsChap ?? false}
              onChange={(e) => up("refuseMsChap", e.target.checked)}
            />
            Refuse MS-CHAP
          </label>
          <label className={checkCls}>
            <input
              type="checkbox"
              checked={config.refuseMsChapV2 ?? false}
              onChange={(e) => up("refuseMsChapV2", e.target.checked)}
            />
            Refuse MS-CHAPv2
          </label>
          <label className={checkCls}>
            <input
              type="checkbox"
              checked={config.nobsdcomp ?? false}
              onChange={(e) => up("nobsdcomp", e.target.checked)}
            />
            No BSD Comp
          </label>
          <label className={checkCls}>
            <input
              type="checkbox"
              checked={config.nodeflate ?? false}
              onChange={(e) => up("nodeflate", e.target.checked)}
            />
            No Deflate
          </label>
          <label className={checkCls}>
            <input
              type="checkbox"
              checked={config.noVjComp ?? false}
              onChange={(e) => up("noVjComp", e.target.checked)}
            />
            No VJ Comp
          </label>
        </div>
      </div>

      {/* Custom Options */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider">
          Custom Options
        </div>
        <textarea
          value={config.customOptions ?? ""}
          onChange={(e) => up("customOptions", e.target.value)}
          placeholder="One option per line"
          rows={3}
          className={inputCls + " resize-y font-mono"}
        />
      </div>
    </div>
  );
};

// ── L2TP Config Form ───────────────────────────────────────────

const L2TPConfigForm: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { config, updateConfig } = mgr;
  const up = (k: string, v: any) => updateConfig({ [k]: v });

  return (
    <div className="space-y-5">
      {/* Server */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider">
          Server
        </div>
        <FormField label="Server Address *">
          <input
            type="text"
            value={config.server ?? ""}
            onChange={(e) => up("server", e.target.value)}
            placeholder="vpn.example.com"
            className={inputCls}
          />
        </FormField>
      </div>

      {/* Authentication */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider">
          Authentication
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Username *">
            <input
              type="text"
              value={config.username ?? ""}
              onChange={(e) => up("username", e.target.value)}
              placeholder="vpn-user"
              className={inputCls}
            />
          </FormField>
          <FormField label="Password *">
            <input
              type="password"
              value={config.password ?? ""}
              onChange={(e) => up("password", e.target.value)}
              placeholder="••••••••"
              className={inputCls}
            />
          </FormField>
        </div>
      </div>

      {/* PPP Settings */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider">
          PPP Settings
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="MRU">
            <input
              type="number"
              value={config.pppMru ?? ""}
              onChange={(e) =>
                up(
                  "pppMru",
                  e.target.value ? parseInt(e.target.value) : undefined,
                )
              }
              placeholder="1400"
              className={inputCls}
            />
          </FormField>
          <FormField label="MTU">
            <input
              type="number"
              value={config.pppMtu ?? ""}
              onChange={(e) =>
                up(
                  "pppMtu",
                  e.target.value ? parseInt(e.target.value) : undefined,
                )
              }
              placeholder="1400"
              className={inputCls}
            />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="LCP Echo Interval">
            <input
              type="number"
              value={config.lcpEchoInterval ?? ""}
              onChange={(e) =>
                up(
                  "lcpEchoInterval",
                  e.target.value ? parseInt(e.target.value) : undefined,
                )
              }
              placeholder="30"
              className={inputCls}
            />
          </FormField>
          <FormField label="LCP Echo Failure">
            <input
              type="number"
              value={config.lcpEchoFailure ?? ""}
              onChange={(e) =>
                up(
                  "lcpEchoFailure",
                  e.target.value ? parseInt(e.target.value) : undefined,
                )
              }
              placeholder="4"
              className={inputCls}
            />
          </FormField>
        </div>
        <div className="grid grid-cols-3 gap-x-4 gap-y-2">
          <label className={checkCls}>
            <input
              type="checkbox"
              checked={config.requireChap ?? false}
              onChange={(e) => up("requireChap", e.target.checked)}
            />
            Require CHAP
          </label>
          <label className={checkCls}>
            <input
              type="checkbox"
              checked={config.requireMsChapV2 ?? false}
              onChange={(e) => up("requireMsChapV2", e.target.checked)}
            />
            Require MS-CHAPv2
          </label>
          <label className={checkCls}>
            <input
              type="checkbox"
              checked={config.requireEap ?? false}
              onChange={(e) => up("requireEap", e.target.checked)}
            />
            Require EAP
          </label>
        </div>
      </div>

      {/* IPsec Settings */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider">
          IPsec Settings
        </div>
        <div className="grid grid-cols-3 gap-3">
          <FormField label="IKE">
            <input
              type="text"
              value={config.ipsecIke ?? ""}
              onChange={(e) => up("ipsecIke", e.target.value)}
              placeholder="aes256-sha1-modp1024"
              className={inputCls}
            />
          </FormField>
          <FormField label="ESP">
            <input
              type="text"
              value={config.ipsecEsp ?? ""}
              onChange={(e) => up("ipsecEsp", e.target.value)}
              placeholder="aes256-sha1"
              className={inputCls}
            />
          </FormField>
          <FormField label="PFS">
            <input
              type="text"
              value={config.ipsecPfs ?? ""}
              onChange={(e) => up("ipsecPfs", e.target.value)}
              placeholder="modp1024"
              className={inputCls}
            />
          </FormField>
        </div>
      </div>

      {/* Custom Options */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider">
          Custom Options
        </div>
        <textarea
          value={config.customOptions ?? ""}
          onChange={(e) => up("customOptions", e.target.value)}
          placeholder="One option per line"
          rows={3}
          className={inputCls + " resize-y font-mono"}
        />
      </div>
    </div>
  );
};

// ── IKEv2 Config Form ──────────────────────────────────────────

const IKEv2ConfigForm: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { config, updateConfig } = mgr;
  const up = (k: string, v: any) => updateConfig({ [k]: v });

  return (
    <div className="space-y-5">
      {/* Server */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider">
          Server
        </div>
        <FormField label="Server Address *">
          <input
            type="text"
            value={config.server ?? ""}
            onChange={(e) => up("server", e.target.value)}
            placeholder="vpn.example.com"
            className={inputCls}
          />
        </FormField>
      </div>

      {/* Authentication */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider">
          Authentication
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Username *">
            <input
              type="text"
              value={config.username ?? ""}
              onChange={(e) => up("username", e.target.value)}
              placeholder="vpn-user"
              className={inputCls}
            />
          </FormField>
          <FormField label="Password">
            <input
              type="password"
              value={config.password ?? ""}
              onChange={(e) => up("password", e.target.value)}
              placeholder="••••••••"
              className={inputCls}
            />
          </FormField>
        </div>
        <FormField label="EAP Method">
          <select
            value={config.eapMethod ?? ""}
            onChange={(e) => up("eapMethod", e.target.value || undefined)}
            className={inputCls}
          >
            <option value="">None</option>
            <option value="mschapv2">MS-CHAPv2</option>
            <option value="tls">TLS</option>
            <option value="peap">PEAP</option>
          </select>
        </FormField>
      </div>

      {/* Certificates & Keys */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider">
          Certificates & Keys
        </div>
        <FormField label="CA Certificate">
          <BrowseField
            value={config.caCertificate ?? ""}
            onChange={(v) => up("caCertificate", v)}
            label="CA Certificate"
            extensions={["crt", "pem", "ca"]}
          />
        </FormField>
        <FormField label="Client Certificate">
          <BrowseField
            value={config.certificate ?? ""}
            onChange={(v) => up("certificate", v)}
            label="Client Certificate"
            extensions={["crt", "pem", "p12"]}
          />
        </FormField>
        <FormField label="Private Key">
          <BrowseField
            value={config.privateKey ?? ""}
            onChange={(v) => up("privateKey", v)}
            label="Private Key"
            extensions={["key", "pem"]}
          />
        </FormField>
      </div>

      {/* Identity */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider">
          Identity
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Local ID">
            <input
              type="text"
              value={config.localId ?? ""}
              onChange={(e) => up("localId", e.target.value)}
              placeholder="client@example.com"
              className={inputCls}
            />
          </FormField>
          <FormField label="Remote ID">
            <input
              type="text"
              value={config.remoteId ?? ""}
              onChange={(e) => up("remoteId", e.target.value)}
              placeholder="vpn.example.com"
              className={inputCls}
            />
          </FormField>
        </div>
      </div>

      {/* Algorithms */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider">
          Algorithms
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Phase 1 Algorithms">
            <input
              type="text"
              value={config.phase1Algorithms ?? ""}
              onChange={(e) => up("phase1Algorithms", e.target.value)}
              placeholder="aes256-sha256-modp2048"
              className={inputCls}
            />
          </FormField>
          <FormField label="Phase 2 Algorithms">
            <input
              type="text"
              value={config.phase2Algorithms ?? ""}
              onChange={(e) => up("phase2Algorithms", e.target.value)}
              placeholder="aes256-sha256"
              className={inputCls}
            />
          </FormField>
        </div>
      </div>

      {/* Options */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider">
          Options
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          <label className={checkCls}>
            <input
              type="checkbox"
              checked={config.fragmentation ?? false}
              onChange={(e) => up("fragmentation", e.target.checked)}
            />
            IKE Fragmentation
          </label>
          <label className={checkCls}>
            <input
              type="checkbox"
              checked={config.mobike ?? false}
              onChange={(e) => up("mobike", e.target.checked)}
            />
            MOBIKE
          </label>
        </div>
      </div>

      {/* Custom Options */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider">
          Custom Options
        </div>
        <textarea
          value={config.customOptions ?? ""}
          onChange={(e) => up("customOptions", e.target.value)}
          placeholder="One option per line"
          rows={3}
          className={inputCls + " resize-y font-mono"}
        />
      </div>
    </div>
  );
};

// ── IPsec Config Form ──────────────────────────────────────────

const IPsecConfigForm: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { config, updateConfig } = mgr;
  const up = (k: string, v: any) => updateConfig({ [k]: v });

  return (
    <div className="space-y-5">
      {/* Server */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider">
          Server
        </div>
        <FormField label="Server Address *">
          <input
            type="text"
            value={config.server ?? ""}
            onChange={(e) => up("server", e.target.value)}
            placeholder="vpn.example.com"
            className={inputCls}
          />
        </FormField>
      </div>

      {/* Authentication */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider">
          Authentication
        </div>
        <FormField label="Auth Method">
          <select
            value={config.authMethod ?? "psk"}
            onChange={(e) => up("authMethod", e.target.value)}
            className={inputCls}
          >
            <option value="psk">Pre-Shared Key</option>
            <option value="certificate">Certificate</option>
            <option value="eap">EAP</option>
          </select>
        </FormField>
        {(config.authMethod === "psk" || !config.authMethod) && (
          <FormField label="Pre-Shared Key">
            <input
              type="password"
              value={config.psk ?? ""}
              onChange={(e) => up("psk", e.target.value)}
              placeholder="••••••••"
              className={inputCls}
            />
          </FormField>
        )}
      </div>

      {/* Certificates & Keys */}
      {(config.authMethod === "certificate" || config.authMethod === "eap") && (
        <div className="space-y-3">
          <div className="text-xs font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider">
            Certificates & Keys
          </div>
          <FormField label="CA Certificate">
            <BrowseField
              value={config.caCertificate ?? ""}
              onChange={(v) => up("caCertificate", v)}
              label="CA Certificate"
              extensions={["crt", "pem", "ca"]}
            />
          </FormField>
          <FormField label="Certificate">
            <BrowseField
              value={config.certificate ?? ""}
              onChange={(v) => up("certificate", v)}
              label="Certificate"
              extensions={["crt", "pem", "p12"]}
            />
          </FormField>
          <FormField label="Private Key">
            <BrowseField
              value={config.privateKey ?? ""}
              onChange={(v) => up("privateKey", v)}
              label="Private Key"
              extensions={["key", "pem"]}
            />
          </FormField>
        </div>
      )}

      {/* Proposals */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider">
          Proposals
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Phase 1 Proposals">
            <input
              type="text"
              value={config.phase1Proposals ?? ""}
              onChange={(e) => up("phase1Proposals", e.target.value)}
              placeholder="aes256-sha256-modp2048"
              className={inputCls}
            />
          </FormField>
          <FormField label="Phase 2 Proposals">
            <input
              type="text"
              value={config.phase2Proposals ?? ""}
              onChange={(e) => up("phase2Proposals", e.target.value)}
              placeholder="aes256-sha256"
              className={inputCls}
            />
          </FormField>
        </div>
      </div>

      {/* Timers */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider">
          Timers
        </div>
        <div className="grid grid-cols-3 gap-3">
          <FormField label="SA Lifetime (s)">
            <input
              type="number"
              value={config.saLifetime ?? ""}
              onChange={(e) =>
                up(
                  "saLifetime",
                  e.target.value ? parseInt(e.target.value) : undefined,
                )
              }
              placeholder="28800"
              className={inputCls}
            />
          </FormField>
          <FormField label="DPD Delay (s)">
            <input
              type="number"
              value={config.dpdDelay ?? ""}
              onChange={(e) =>
                up(
                  "dpdDelay",
                  e.target.value ? parseInt(e.target.value) : undefined,
                )
              }
              placeholder="30"
              className={inputCls}
            />
          </FormField>
          <FormField label="DPD Timeout (s)">
            <input
              type="number"
              value={config.dpdTimeout ?? ""}
              onChange={(e) =>
                up(
                  "dpdTimeout",
                  e.target.value ? parseInt(e.target.value) : undefined,
                )
              }
              placeholder="150"
              className={inputCls}
            />
          </FormField>
        </div>
      </div>

      {/* Options */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider">
          Options
        </div>
        <label className={checkCls}>
          <input
            type="checkbox"
            checked={config.tunnelMode ?? true}
            onChange={(e) => up("tunnelMode", e.target.checked)}
          />
          Tunnel Mode
        </label>
      </div>

      {/* Custom Options */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider">
          Custom Options
        </div>
        <textarea
          value={config.customOptions ?? ""}
          onChange={(e) => up("customOptions", e.target.value)}
          placeholder="One option per line"
          rows={3}
          className={inputCls + " resize-y font-mono"}
        />
      </div>
    </div>
  );
};

// ── SSTP Config Form ───────────────────────────────────────────

const SSTPConfigForm: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { config, updateConfig } = mgr;
  const up = (k: string, v: any) => updateConfig({ [k]: v });

  return (
    <div className="space-y-5">
      {/* Server */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider">
          Server
        </div>
        <FormField label="Server Address *">
          <input
            type="text"
            value={config.server ?? ""}
            onChange={(e) => up("server", e.target.value)}
            placeholder="vpn.example.com"
            className={inputCls}
          />
        </FormField>
      </div>

      {/* Authentication */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider">
          Authentication
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Username *">
            <input
              type="text"
              value={config.username ?? ""}
              onChange={(e) => up("username", e.target.value)}
              placeholder="vpn-user"
              className={inputCls}
            />
          </FormField>
          <FormField label="Password">
            <input
              type="password"
              value={config.password ?? ""}
              onChange={(e) => up("password", e.target.value)}
              placeholder="••••••••"
              className={inputCls}
            />
          </FormField>
        </div>
        <FormField label="Domain">
          <input
            type="text"
            value={config.domain ?? ""}
            onChange={(e) => up("domain", e.target.value)}
            placeholder="WORKGROUP"
            className={inputCls}
          />
        </FormField>
      </div>

      {/* Certificates */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider">
          Certificates
        </div>
        <FormField label="CA Certificate">
          <BrowseField
            value={config.caCertificate ?? ""}
            onChange={(v) => up("caCertificate", v)}
            label="CA Certificate"
            extensions={["crt", "pem", "ca"]}
          />
        </FormField>
        <FormField label="Client Certificate">
          <BrowseField
            value={config.certificate ?? ""}
            onChange={(v) => up("certificate", v)}
            label="Client Certificate"
            extensions={["crt", "pem", "p12"]}
          />
        </FormField>
        <label className={checkCls}>
          <input
            type="checkbox"
            checked={config.ignoreCertificate ?? false}
            onChange={(e) => up("ignoreCertificate", e.target.checked)}
          />
          Ignore Certificate Errors
        </label>
      </div>

      {/* Custom Options */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider">
          Custom Options
        </div>
        <textarea
          value={config.customOptions ?? ""}
          onChange={(e) => up("customOptions", e.target.value)}
          placeholder="One option per line"
          rows={3}
          className={inputCls + " resize-y font-mono"}
        />
      </div>
    </div>
  );
};

// ── Section: Configuration (renders per-type form) ──────────────

const ConfigurationSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const typeLabel = getVpnProviderLabel(mgr.vpnType);
  return (
    <div className={sectionCls}>
      <div className={sectionHeadingCls}>{typeLabel} Configuration</div>
      {mgr.unsupportedSettings.length > 0 && (
        <div
          role="alert"
          className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300"
        >
          <div className="flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                This legacy profile contains settings the managed {typeLabel}{" "}
                runtime cannot execute.
              </p>
              <p className="mt-1 text-[var(--color-textSecondary)]">
                {mgr.unsupportedSettings.join(", ")}. They remain unchanged
                until you explicitly remove them; saving and connecting stay
                blocked in the meantime.
              </p>
              <button
                type="button"
                onClick={mgr.removeUnsupportedSettings}
                className="mt-2 rounded border border-amber-500/40 px-2.5 py-1 font-medium text-amber-200 hover:bg-amber-500/15"
              >
                Remove unsupported settings
              </button>
            </div>
          </div>
        </div>
      )}
      {mgr.vpnType === "openvpn" && <OpenVpnConfigForm mgr={mgr} />}
      {mgr.vpnType === "wireguard" && <WireGuardConfigForm mgr={mgr} />}
      {mgr.vpnType === "tailscale" && <TailscaleConfigForm mgr={mgr} />}
      {mgr.vpnType === "zerotier" && <ZeroTierConfigForm mgr={mgr} />}
      {mgr.vpnType === "pptp" && <PPTPConfigForm mgr={mgr} />}
      {mgr.vpnType === "l2tp" && <L2TPConfigForm mgr={mgr} />}
      {mgr.vpnType === "ikev2" && <IKEv2ConfigForm mgr={mgr} />}
      {mgr.vpnType === "ipsec" && <IPsecConfigForm mgr={mgr} />}
      {mgr.vpnType === "sstp" && <SSTPConfigForm mgr={mgr} />}
    </div>
  );
};

// ── Section: Tags ───────────────────────────────────────────────

const TagsSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className={sectionCls}>
    <div className={sectionHeadingCls}>
      <span className="inline-flex items-center gap-1.5">
        <Tag size={14} />
        Tags
      </span>
    </div>
    {mgr.tags.length > 0 && (
      <div className="flex flex-wrap gap-2">
        {mgr.tags.map((tag) => (
          <span
            key={tag}
            className="px-2.5 py-1 rounded-full bg-primary/20 text-primary text-xs flex items-center gap-1"
          >
            {tag}
            <button
              onClick={() => mgr.handleRemoveTag(tag)}
              className="hover:text-[var(--color-text)] transition-colors"
            >
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
    )}
    <div className="flex gap-2">
      <input
        type="text"
        value={mgr.tagInput}
        onChange={(e) => mgr.setTagInput(e.target.value)}
        onKeyDown={mgr.handleTagKeyDown}
        placeholder="Add tag..."
        className={inputCls + " flex-1"}
      />
      <button
        onClick={mgr.handleAddTag}
        disabled={!mgr.tagInput.trim()}
        className="px-3 py-2 rounded-md bg-primary hover:bg-primary/90 disabled:bg-[var(--color-surfaceHover)] disabled:cursor-not-allowed text-[var(--color-text)] text-sm inline-flex items-center gap-1.5"
      >
        <Plus size={14} />
        Add
      </button>
    </div>
  </div>
);

// ── Main Component ──────────────────────────────────────────────

interface VpnEditorProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  editingConnection?: {
    id: string;
    vpnType: string;
    name: string;
    config: any;
    secretPresence?: VpnSecretPresence;
  } | null;
}

const VpnEditor: React.FC<VpnEditorProps> = ({
  isOpen,
  onClose,
  onSave,
  editingConnection,
}) => {
  const normalizedEditingConnection = React.useMemo(
    () =>
      editingConnection
        ? {
            id: editingConnection.id,
            vpnType: editingConnection.vpnType as VpnEditorType,
            name: editingConnection.name,
            config: editingConnection.config,
            secretPresence: editingConnection.secretPresence,
          }
        : null,
    [editingConnection],
  );
  const mgr = useVpnEditor(isOpen, normalizedEditingConnection, onSave);

  if (!isOpen) return null;

  return (
    <div className="h-full flex flex-col bg-[var(--color-surface)] overflow-hidden">
      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto w-full p-6 space-y-6">
          <BasicInfoSection mgr={mgr} />
          <VpnTypeSelector mgr={mgr} />
          <ConfigurationSection mgr={mgr} />
          <TagsSection mgr={mgr} />
        </div>
      </div>

      {/* Footer bar */}
      <div className="flex-shrink-0 px-6 py-3 border-t border-[var(--color-border)]">
        {mgr.error && (
          <div className="mb-3 px-3 py-2 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-center gap-2">
            <AlertCircle size={14} className="flex-shrink-0" />
            {mgr.error}
          </div>
        )}
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="sor-btn sor-btn-secondary">
            Cancel
          </button>
          <button
            onClick={mgr.handleSave}
            disabled={!mgr.canSave || mgr.isSaving}
            className="sor-btn sor-btn-primary"
          >
            {mgr.isSaving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Save size={14} />
            )}
            {mgr.editingId ? "Update VPN" : "Create VPN"}
          </button>
        </div>
      </div>
    </div>
  );
};

export { VpnEditor };
export default VpnEditor;
