// PfsensePanel — the pfSense integration panel SHELL (t42 §4b, crate lead
// t42-pfsense-L). Owns the connect/config form + connection lifecycle and a
// registry-driven sub-tab bar. The command surface itself (interfaces/firewall/
// nat/… and dhcp/dns/services/…) is bound by the per-category tab modules, which
// register themselves in `./registry.ts`; this shell never changes per-category.

import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ShieldCheck, Loader2, Plug, PlugZap, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";

import type { IntegrationDescriptor } from "../../../types/integrations/registry";
import type {
  PfsenseConnectionConfig,
  PfsenseConnectionSummary,
} from "../../../types/pfsense";
import { withGlobalHttpProxy } from "../../../hooks/integration/httpProxy";
import { useIntegrationConfigStore } from "../../../hooks/integrations/useIntegrationConfigStore";
import { pfsenseCategoryTabs } from "./registry";

// ── Connection-lifecycle invoke wrappers (the shell's 4 commands) ────────────
// Kept in the shell because the connection is the shell's concern; the category
// tabs get only the resulting `connectionId`.
const pfsenseConnectionApi = {
  connect: (id: string, config: PfsenseConnectionConfig) =>
    invoke<PfsenseConnectionSummary>("pfsense_connect", { id, config }),
  disconnect: (id: string) => invoke<void>("pfsense_disconnect", { id }),
  ping: (id: string) =>
    invoke<PfsenseConnectionSummary>("pfsense_ping", { id }),
  listConnections: () => invoke<string[]>("pfsense_list_connections"),
};

/** The secret blob stored in the OS vault packs both pfSense API credentials
 *  (the store has one secret slot per instance). */
interface PfsenseSecret {
  apiKey: string;
  apiSecret: string;
}

const DEFAULT_TIMEOUT_SECS = 30;

interface PfsensePanelProps {
  isOpen: boolean;
  onClose: () => void;
  instanceId?: string;
}

const emptyForm = {
  name: "",
  host: "",
  port: "443",
  apiKey: "",
  apiSecret: "",
  useTls: true,
  acceptInvalidCerts: false,
};

type FormState = typeof emptyForm;

const PfsensePanel: React.FC<PfsensePanelProps> = ({ isOpen, instanceId }) => {
  const { t } = useTranslation();
  const {
    isLoading: storeLoading,
    instancesFor,
    createInstance,
    updateInstance,
    readSecret,
  } = useIntegrationConfigStore();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [summary, setSummary] = useState<PfsenseConnectionSummary | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string | null>(
    pfsenseCategoryTabs[0]?.categoryKey ?? null,
  );

  // Prefill the form from a persisted instance when opened against one.
  useEffect(() => {
    if (!instanceId || storeLoading) return;
    const instance = instancesFor("pfsense").find((i) => i.id === instanceId);
    if (!instance) return;
    let cancelled = false;
    (async () => {
      const secretRaw = await readSecret(instance);
      let secret: PfsenseSecret = { apiKey: "", apiSecret: "" };
      if (secretRaw) {
        try {
          secret = JSON.parse(secretRaw) as PfsenseSecret;
        } catch {
          // Legacy / opaque secret — treat the whole string as the api secret.
          secret = { apiKey: "", apiSecret: secretRaw };
        }
      }
      if (cancelled) return;
      const fields = instance.fields ?? {};
      setForm({
        name: instance.name,
        host: instance.host ?? "",
        port: fields.port ?? "443",
        apiKey: secret.apiKey,
        apiSecret: secret.apiSecret,
        useTls: fields.useTls !== "false",
        acceptInvalidCerts: fields.acceptInvalidCerts === "true",
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [instanceId, storeLoading, instancesFor, readSecret]);

  const setField = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const buildConfig = useCallback((): PfsenseConnectionConfig => {
    const port = Number.parseInt(form.port, 10);
    return {
      host: form.host.trim(),
      port: Number.isFinite(port) ? port : form.useTls ? 443 : 80,
      apiKey: form.apiKey,
      apiSecret: form.apiSecret,
      useTls: form.useTls,
      acceptInvalidCerts: form.acceptInvalidCerts,
      timeoutSecs: DEFAULT_TIMEOUT_SECS,
    };
  }, [form]);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const config = buildConfig();
      const secret = JSON.stringify({
        apiKey: form.apiKey,
        apiSecret: form.apiSecret,
      } satisfies PfsenseSecret);
      const fields = {
        port: String(config.port),
        useTls: String(config.useTls),
        acceptInvalidCerts: String(config.acceptInvalidCerts),
      };
      const name = form.name.trim() || form.host.trim() || "pfSense";

      // Persist host + creds (encrypted) and use the instance id as the stable
      // connection id, so reconnecting a saved instance reuses its id.
      let id = instanceId ?? null;
      if (id) {
        await updateInstance(id, {
          integrationKey: "pfsense",
          name,
          host: config.host,
          fields,
          secret,
        });
      } else {
        const created = await createInstance({
          integrationKey: "pfsense",
          name,
          host: config.host,
          fields,
          secret,
        });
        id = created.id;
      }

      const result = await pfsenseConnectionApi.connect(
        id,
        withGlobalHttpProxy(config, "camel"),
      );
      setConnectionId(id);
      setSummary(result);
      setActiveTab(pfsenseCategoryTabs[0]?.categoryKey ?? null);
    } catch (e) {
      const msg = typeof e === "string" ? e : (e as Error).message;
      setError(msg);
    } finally {
      setConnecting(false);
    }
  }, [buildConfig, form, instanceId, createInstance, updateInstance]);

  const handleDisconnect = useCallback(async () => {
    if (!connectionId) return;
    try {
      await pfsenseConnectionApi.disconnect(connectionId);
    } catch {
      // Best-effort: drop local state even if the backend session is already gone.
    } finally {
      setConnectionId(null);
      setSummary(null);
    }
  }, [connectionId]);

  const ActiveTab = useMemo(() => {
    if (!connectionId || !activeTab) return null;
    const tab = pfsenseCategoryTabs.find((tt) => tt.categoryKey === activeTab);
    if (!tab) return null;
    return React.lazy(tab.importTab);
  }, [connectionId, activeTab]);

  if (!isOpen) return null;

  const connected = Boolean(connectionId);

  return (
    <div className="flex h-full flex-col bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--color-text)]">
          <ShieldCheck className="h-5 w-5 text-primary" />
          {t("integrations.pfsense.title", "pfSense")}
          {summary && (
            <span className="text-xs font-normal text-[var(--color-textSecondary)]">
              {summary.hostname} · {summary.version}
            </span>
          )}
        </h2>
        {connected && (
          <button
            onClick={handleDisconnect}
            className="app-bar-button flex items-center gap-1 px-2 py-1 text-xs"
            title={t("integrations.pfsense.disconnect", "Disconnect")}
          >
            <PlugZap size={14} />
            {t("integrations.pfsense.disconnect", "Disconnect")}
          </button>
        )}
      </div>

      {error && (
        <div className="border-b border-[var(--color-border)] bg-[var(--color-dangerBg,#3a1a1a)] px-4 py-2 text-xs text-[var(--color-danger,#f87171)]">
          {error}
        </div>
      )}

      {!connected ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="mx-auto flex max-w-md flex-col gap-3">
            <p className="text-xs text-[var(--color-textSecondary)]">
              {t(
                "integrations.pfsense.connectHint",
                "Connect to a pfSense appliance via its REST API.",
              )}
            </p>

            <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
              {t("integrations.pfsense.fields.name", "Name")}
              <input
                className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
                placeholder="fw-edge"
              />
            </label>

            <div className="flex gap-2">
              <label className="flex flex-1 flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
                {t("integrations.pfsense.fields.host", "Host")}
                <input
                  className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                  value={form.host}
                  onChange={(e) => setField("host", e.target.value)}
                  placeholder="192.168.1.1"
                />
              </label>
              <label className="flex w-24 flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
                {t("integrations.pfsense.fields.port", "Port")}
                <input
                  className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                  value={form.port}
                  onChange={(e) => setField("port", e.target.value)}
                  inputMode="numeric"
                />
              </label>
            </div>

            <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
              {t("integrations.pfsense.fields.apiKey", "API key")}
              <input
                className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                value={form.apiKey}
                onChange={(e) => setField("apiKey", e.target.value)}
                autoComplete="off"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
              {t("integrations.pfsense.fields.apiSecret", "API secret")}
              <input
                type="password"
                className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                value={form.apiSecret}
                onChange={(e) => setField("apiSecret", e.target.value)}
                autoComplete="off"
              />
            </label>

            <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
              <input
                type="checkbox"
                checked={form.useTls}
                onChange={(e) => setField("useTls", e.target.checked)}
              />
              {t("integrations.pfsense.fields.useTls", "Use TLS (HTTPS)")}
            </label>

            <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
              <input
                type="checkbox"
                checked={form.acceptInvalidCerts}
                onChange={(e) =>
                  setField("acceptInvalidCerts", e.target.checked)
                }
              />
              {t(
                "integrations.pfsense.fields.acceptInvalidCerts",
                "Accept self-signed certificates",
              )}
            </label>

            <button
              onClick={handleConnect}
              disabled={connecting || !form.host.trim()}
              className="mt-2 flex items-center justify-center gap-2 rounded bg-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {connecting ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Plug size={16} />
              )}
              {t("integrations.pfsense.connect", "Connect")}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {pfsenseCategoryTabs.length > 0 ? (
            <>
              <div className="flex gap-1 border-b border-[var(--color-border)] px-2">
                {pfsenseCategoryTabs.map((tab) => (
                  <button
                    key={tab.categoryKey}
                    onClick={() => setActiveTab(tab.categoryKey)}
                    className={`px-3 py-2 text-sm ${
                      activeTab === tab.categoryKey
                        ? "border-b-2 border-primary text-[var(--color-text)]"
                        : "text-[var(--color-textSecondary)]"
                    }`}
                  >
                    {t(
                      `integrations.pfsense.tabs.${tab.categoryKey}`,
                      tab.label,
                    )}
                  </button>
                ))}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <Suspense
                  fallback={
                    <div className="flex h-full items-center justify-center">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                  }
                >
                  {ActiveTab && connectionId && (
                    <ActiveTab connectionId={connectionId} />
                  )}
                </Suspense>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center text-[var(--color-textSecondary)]">
              <RefreshCw className="h-8 w-8 opacity-50" />
              <p className="text-sm">
                {t(
                  "integrations.pfsense.noTabs",
                  "Connected. Management sections load here once registered.",
                )}
              </p>
              {summary && (
                <p className="text-xs">
                  {summary.hostname} · {summary.platform} · {summary.version}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PfsensePanel;

/** Descriptor registered into `registry.infra.ts` by the Wave-1 integrator.
 *  Do NOT edit `registry.infra.ts` here — just export this. */
export const pfsenseDescriptor: IntegrationDescriptor = {
  key: "pfsense",
  label: "pfSense",
  category: "infra",
  icon: ShieldCheck,
  importPanel: () => import("./PfsensePanel"),
};
