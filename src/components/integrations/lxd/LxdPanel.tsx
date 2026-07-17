// LxdPanel — shell for the LXD / Incus integration (t42 lead, §4b).
//
// Owns: the connect/config form (multi-credential: mTLS cert+key +/- trust
// token, OR an OIDC token) backed by `useIntegrationConfigStore`, the connection
// lifecycle (`useLxdConnection`), and a registry-driven sub-tab bar. Each
// command-category slice (instances / images / networking / storage) plugs in by
// appending to `./registry`; this shell renders + lazy-loads them and never
// changes per-category.

import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Server, Plug, PlugZap, Loader2, Save, Boxes } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  IntegrationDescriptor,
  IntegrationPanelProps,
} from "../../../types/integrations/registry";
import {
  defaultLxdConnectionConfig,
  type LxdConnectionConfig,
} from "../../../types/lxd";
import { useLxdConnection } from "../../../hooks/integration/lxd/useLxdConnection";
import { useIntegrationConfigStore } from "../../../hooks/integrations/useIntegrationConfigStore";
import { lxdCategories, type LxdCategoryDescriptor } from "./registry";

type AuthMethod = "tls" | "oidc";

/** The non-secret fields we persist under the instance's `fields` map. */
interface LxdPersistedFields {
  project: string;
  skipTlsVerify: string; // "true" | "false"
  timeoutSecs: string;
  clientCertPem: string; // certificate is public, not a secret
  authMethod: AuthMethod;
}

/** The secret bundle we stash in the OS vault as one JSON blob. */
interface LxdSecretBundle {
  clientKeyPem?: string;
  trustPassword?: string;
  oidcToken?: string;
}

function inferAuthMethod(cfg: LxdConnectionConfig): AuthMethod {
  return cfg.oidcToken ? "oidc" : "tls";
}

const inputClass =
  "w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm text-[var(--color-text)] focus:border-primary focus:outline-none";
const labelClass =
  "mb-1 block text-xs font-medium text-[var(--color-textSecondary)]";

/**
 * The LXD panel. `instanceId` (from the hub) binds to a saved config; without
 * one, the form starts from defaults for a new instance.
 */
export const LxdPanel: React.FC<IntegrationPanelProps> = ({ instanceId }) => {
  const { t } = useTranslation();
  const { instances, createInstance, updateInstance, readSecret } =
    useIntegrationConfigStore();
  const conn = useLxdConnection();

  const [config, setConfig] = useState<LxdConnectionConfig>(() =>
    defaultLxdConnectionConfig(),
  );
  const [name, setName] = useState("");
  const [authMethod, setAuthMethod] = useState<AuthMethod>("tls");
  const [activeTab, setActiveTab] = useState<string | null>(
    lxdCategories[0]?.categoryKey ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Hydrate the form from a saved instance (non-secret fields + vault secret).
  useEffect(() => {
    if (!instanceId) return;
    const inst = instances.find((i) => i.id === instanceId);
    if (!inst) return;
    const fields = (inst.fields ?? {}) as Partial<LxdPersistedFields>;
    let cancelled = false;
    (async () => {
      const secretRaw = await readSecret(inst);
      let secret: LxdSecretBundle = {};
      if (secretRaw) {
        try {
          secret = JSON.parse(secretRaw) as LxdSecretBundle;
        } catch {
          secret = {};
        }
      }
      if (cancelled) return;
      const method = (fields.authMethod as AuthMethod) ?? "tls";
      setName(inst.name);
      setAuthMethod(method);
      setConfig({
        url: inst.host ?? "https://127.0.0.1:8443",
        clientCertPem: fields.clientCertPem || undefined,
        clientKeyPem: secret.clientKeyPem,
        trustPassword: secret.trustPassword,
        oidcToken: secret.oidcToken,
        skipTlsVerify: fields.skipTlsVerify !== "false",
        project: fields.project || "default",
        timeoutSecs: Number(fields.timeoutSecs) || 30,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [instanceId, instances, readSecret]);

  const set = useCallback(
    <K extends keyof LxdConnectionConfig>(
      key: K,
      value: LxdConnectionConfig[K],
    ) => {
      setConfig((c) => ({ ...c, [key]: value }));
      setSaved(false);
    },
    [],
  );

  const validate = useCallback((): string | null => {
    if (!config.url.trim())
      return t("integrations.lxd.errors.urlRequired", "Server URL is required");
    if (authMethod === "tls" && !config.clientCertPem && !config.trustPassword)
      return t(
        "integrations.lxd.errors.credRequired",
        "Provide a client certificate/key or an OIDC token",
      );
    if (authMethod === "oidc" && !config.oidcToken)
      return t(
        "integrations.lxd.errors.credRequired",
        "Provide a client certificate/key or an OIDC token",
      );
    return null;
  }, [config, authMethod, t]);

  /** Assemble the config actually sent to `lxd_connect`, honoring auth method. */
  const effectiveConfig = useMemo((): LxdConnectionConfig => {
    if (authMethod === "oidc") {
      return {
        ...config,
        clientCertPem: undefined,
        clientKeyPem: undefined,
        trustPassword: undefined,
      };
    }
    return { ...config, oidcToken: undefined };
  }, [config, authMethod]);

  const handleConnect = useCallback(async () => {
    const err = validate();
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    await conn.connect(effectiveConfig);
  }, [validate, conn, effectiveConfig]);

  const handleSave = useCallback(async () => {
    const err = validate();
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      const fields: LxdPersistedFields = {
        project: config.project,
        skipTlsVerify: String(config.skipTlsVerify),
        timeoutSecs: String(config.timeoutSecs),
        clientCertPem: config.clientCertPem ?? "",
        authMethod,
      };
      const secret: LxdSecretBundle = {
        clientKeyPem: authMethod === "tls" ? config.clientKeyPem : undefined,
        trustPassword: authMethod === "tls" ? config.trustPassword : undefined,
        oidcToken: authMethod === "oidc" ? config.oidcToken : undefined,
      };
      const input = {
        integrationKey: "lxd",
        name: name.trim() || config.url,
        host: config.url,
        fields: fields as unknown as Record<string, string>,
        secret: JSON.stringify(secret),
      };
      if (instanceId && instances.some((i) => i.id === instanceId)) {
        await updateInstance(instanceId, input);
      } else {
        await createInstance(input);
      }
      setSaved(true);
    } catch (e) {
      const msg = typeof e === "string" ? e : (e as Error).message;
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  }, [
    validate,
    config,
    name,
    authMethod,
    instanceId,
    instances,
    createInstance,
    updateInstance,
  ]);

  return (
    <div className="flex h-full flex-col bg-[var(--color-surface)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <Boxes className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text)]">
              {t("integrations.lxd.title", "LXD / Incus")}
            </h2>
            <p className="text-xs text-[var(--color-textSecondary)]">
              {t(
                "integrations.lxd.subtitle",
                "Manage LXD and Incus containers, VMs, and infrastructure",
              )}
            </p>
          </div>
        </div>
        <span
          className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
            conn.connected
              ? "bg-green-500/15 text-green-500"
              : "bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)]"
          }`}
        >
          <Server size={12} />
          {conn.connected
            ? t("integrations.lxd.connected", "Connected")
            : t("integrations.lxd.disconnected", "Not connected")}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Connect / config form */}
        <div className="border-b border-[var(--color-border)] p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass}>
                {t("integrations.lxd.form.name", "Instance name")}
              </label>
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t(
                  "integrations.lxd.form.namePlaceholder",
                  "My LXD server",
                )}
              />
            </div>
            <div>
              <label className={labelClass}>
                {t("integrations.lxd.form.url", "Server URL")}
              </label>
              <input
                className={inputClass}
                value={config.url}
                onChange={(e) => set("url", e.target.value)}
                placeholder={t(
                  "integrations.lxd.form.urlPlaceholder",
                  "https://10.0.0.1:8443",
                )}
              />
            </div>
          </div>

          {/* Auth method toggle */}
          <div className="mt-3">
            <label className={labelClass}>
              {t("integrations.lxd.form.authMethod", "Authentication")}
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setAuthMethod("tls");
                  setSaved(false);
                }}
                className={`rounded border px-3 py-1 text-xs ${
                  authMethod === "tls"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-[var(--color-border)] text-[var(--color-textSecondary)]"
                }`}
              >
                {t("integrations.lxd.form.authTls", "Client certificate (mTLS)")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthMethod("oidc");
                  setSaved(false);
                }}
                className={`rounded border px-3 py-1 text-xs ${
                  authMethod === "oidc"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-[var(--color-border)] text-[var(--color-textSecondary)]"
                }`}
              >
                {t("integrations.lxd.form.authOidc", "OIDC token")}
              </button>
            </div>
          </div>

          {authMethod === "tls" ? (
            <div className="mt-3 grid grid-cols-1 gap-3">
              <div>
                <label className={labelClass}>
                  {t(
                    "integrations.lxd.form.clientCertPem",
                    "Client certificate (PEM)",
                  )}
                </label>
                <textarea
                  className={`${inputClass} font-mono`}
                  rows={3}
                  value={config.clientCertPem ?? ""}
                  onChange={(e) =>
                    set("clientCertPem", e.target.value || undefined)
                  }
                  placeholder="-----BEGIN CERTIFICATE-----"
                />
              </div>
              <div>
                <label className={labelClass}>
                  {t("integrations.lxd.form.clientKeyPem", "Client key (PEM)")}
                </label>
                <textarea
                  className={`${inputClass} font-mono`}
                  rows={3}
                  value={config.clientKeyPem ?? ""}
                  onChange={(e) =>
                    set("clientKeyPem", e.target.value || undefined)
                  }
                  placeholder="-----BEGIN PRIVATE KEY-----"
                />
              </div>
              <div>
                <label className={labelClass}>
                  {t(
                    "integrations.lxd.form.trustPassword",
                    "Trust token / password",
                  )}
                </label>
                <input
                  type="password"
                  className={inputClass}
                  value={config.trustPassword ?? ""}
                  onChange={(e) =>
                    set("trustPassword", e.target.value || undefined)
                  }
                />
              </div>
            </div>
          ) : (
            <div className="mt-3">
              <label className={labelClass}>
                {t("integrations.lxd.form.oidcToken", "OIDC access token")}
              </label>
              <textarea
                className={`${inputClass} font-mono`}
                rows={3}
                value={config.oidcToken ?? ""}
                onChange={(e) => set("oidcToken", e.target.value || undefined)}
              />
            </div>
          )}

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className={labelClass}>
                {t("integrations.lxd.form.project", "Project")}
              </label>
              <input
                className={inputClass}
                value={config.project}
                onChange={(e) => set("project", e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass}>
                {t("integrations.lxd.form.timeoutSecs", "Timeout (seconds)")}
              </label>
              <input
                type="number"
                className={inputClass}
                value={config.timeoutSecs}
                onChange={(e) => set("timeoutSecs", Number(e.target.value) || 30)}
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
                <input
                  type="checkbox"
                  checked={config.skipTlsVerify}
                  onChange={(e) => set("skipTlsVerify", e.target.checked)}
                />
                {t("integrations.lxd.form.skipTlsVerify", "Skip TLS verification")}
              </label>
            </div>
          </div>

          {(formError || conn.error) && (
            <p className="mt-3 text-xs text-red-500">
              {formError || conn.error}
            </p>
          )}

          <div className="mt-4 flex items-center gap-2">
            {conn.connected ? (
              <button
                onClick={() => conn.disconnect()}
                disabled={conn.isLoading}
                className="app-bar-button flex items-center gap-1 px-3 py-1.5 text-sm"
              >
                <PlugZap size={14} />
                {t("integrations.lxd.disconnect", "Disconnect")}
              </button>
            ) : (
              <button
                onClick={handleConnect}
                disabled={conn.isLoading}
                className="flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-sm text-white disabled:opacity-60"
              >
                {conn.isLoading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Plug size={14} />
                )}
                {t("integrations.lxd.connect", "Connect")}
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className="app-bar-button flex items-center gap-1 px-3 py-1.5 text-sm"
            >
              <Save size={14} />
              {saved
                ? t("integrations.lxd.form.saved", "Saved")
                : t("integrations.lxd.form.save", "Save")}
            </button>
          </div>
        </div>

        {/* Registry-driven sub-tab bar + active tab */}
        <LxdTabBar
          categories={lxdCategories}
          activeTab={activeTab}
          onSelect={setActiveTab}
          connected={conn.connected}
          instanceId={instanceId}
        />
      </div>
    </div>
  );
};

interface LxdTabBarProps {
  categories: LxdCategoryDescriptor[];
  activeTab: string | null;
  onSelect: (key: string) => void;
  connected: boolean;
  instanceId?: string;
}

/** Renders the sub-tab bar from the per-crate registry and lazy-loads the active
 *  tab. When the registry is empty (lead-only state), shows a hint. */
const LxdTabBar: React.FC<LxdTabBarProps> = ({
  categories,
  activeTab,
  onSelect,
  connected,
  instanceId,
}) => {
  const { t } = useTranslation();

  const active = useMemo(
    () =>
      categories.find((c) => c.categoryKey === activeTab) ?? categories[0],
    [categories, activeTab],
  );

  const LazyTab = useMemo(
    () => (active ? React.lazy(active.importTab) : null),
    [active],
  );

  if (categories.length === 0) {
    return (
      <div className="p-6 text-center text-xs text-[var(--color-textSecondary)]">
        {t(
          "integrations.lxd.noTabs",
          "Management views load here once connected.",
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex gap-1 border-b border-[var(--color-border)] px-2">
        {categories.map((c) => (
          <button
            key={c.categoryKey}
            onClick={() => onSelect(c.categoryKey)}
            className={`px-3 py-2 text-xs font-medium ${
              active?.categoryKey === c.categoryKey
                ? "border-b-2 border-primary text-[var(--color-text)]"
                : "text-[var(--color-textSecondary)]"
            }`}
          >
            {t(c.labelKey, c.labelDefault)}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {LazyTab && (
          <Suspense
            fallback={
              <div className="flex items-center justify-center p-6">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            }
          >
            <LazyTab connected={connected} instanceId={instanceId} />
          </Suspense>
        )}
      </div>
    </div>
  );
};

/** Registry descriptor — appended to `registry.infra.ts` by the wave integrator. */
export const lxdDescriptor: IntegrationDescriptor = {
  key: "lxd",
  label: "LXD / Incus",
  category: "virtualization",
  icon: Boxes,
  importPanel: () => import("./LxdPanel"),
};

export default LxdPanel;
