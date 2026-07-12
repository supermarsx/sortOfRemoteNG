// OsticketPanel — the osTicket integration panel SHELL (t42 §4b, crate lead
// t42-osticket-L). Owns the connect/config form + connection lifecycle and a
// registry-driven sub-tab bar. The command surface itself (ticketing and
// administration) is bound by the per-category tab modules, which register
// themselves in `./registry.ts`; this shell never changes per-category.

import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { LifeBuoy, Loader2, Plug, PlugZap, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { IntegrationPanelProps } from "../../../types/integrations/registry";
import type { OsticketConnectionConfig } from "../../../types/osticket";
import { useOsticketConnection } from "../../../hooks/integration/osticket/useOsticketConnection";
import { useIntegrationConfigStore } from "../../../hooks/integrations/useIntegrationConfigStore";
import { osticketCategoryTabs } from "./registry";

const DEFAULT_TIMEOUT_SECONDS = 30;

const emptyForm = {
  name: "",
  host: "",
  apiKey: "",
  skipTlsVerify: false,
};

type FormState = typeof emptyForm;

const OsticketPanel: React.FC<IntegrationPanelProps> = ({
  isOpen,
  instanceId,
}) => {
  const { t } = useTranslation();
  const {
    isLoading: storeLoading,
    instancesFor,
    createInstance,
    updateInstance,
    readSecret,
  } = useIntegrationConfigStore();
  const {
    connectionId,
    status,
    connecting,
    error,
    connect,
    disconnect,
    setError,
  } = useOsticketConnection();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [activeTab, setActiveTab] = useState<string | null>(
    osticketCategoryTabs[0]?.categoryKey ?? null,
  );

  // Prefill the form from a persisted instance when opened against one.
  useEffect(() => {
    if (!instanceId || storeLoading) return;
    const instance = instancesFor("osticket").find((i) => i.id === instanceId);
    if (!instance) return;
    let cancelled = false;
    (async () => {
      const secret = await readSecret(instance);
      if (cancelled) return;
      const fields = instance.fields ?? {};
      setForm({
        name: instance.name,
        host: instance.host ?? "",
        apiKey: secret ?? "",
        skipTlsVerify: fields.skipTlsVerify === "true",
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

  const buildConfig = useCallback((): OsticketConnectionConfig => {
    const name = form.name.trim() || form.host.trim() || "osTicket";
    return {
      name,
      host: form.host.trim(),
      api_key: form.apiKey,
      timeout_seconds: DEFAULT_TIMEOUT_SECONDS,
      skip_tls_verify: form.skipTlsVerify,
    };
  }, [form]);

  const handleConnect = useCallback(async () => {
    setError(null);
    try {
      const config = buildConfig();
      const fields = { skipTlsVerify: String(config.skip_tls_verify) };

      // Persist host + API key (encrypted) and use the instance id as the stable
      // connection id, so reconnecting a saved instance reuses its id.
      let id = instanceId ?? null;
      if (id) {
        await updateInstance(id, {
          integrationKey: "osticket",
          name: config.name,
          host: config.host,
          fields,
          secret: config.api_key,
        });
      } else {
        const created = await createInstance({
          integrationKey: "osticket",
          name: config.name,
          host: config.host,
          fields,
          secret: config.api_key,
        });
        id = created.id;
      }

      await connect(id, config);
      setActiveTab(osticketCategoryTabs[0]?.categoryKey ?? null);
    } catch {
      // `connect` already surfaced the error via the hook; persistence failures
      // fall through here too and leave the form editable.
    }
  }, [
    buildConfig,
    instanceId,
    createInstance,
    updateInstance,
    connect,
    setError,
  ]);

  const ActiveTab = useMemo(() => {
    if (!connectionId || !activeTab) return null;
    const tab = osticketCategoryTabs.find((tt) => tt.categoryKey === activeTab);
    if (!tab) return null;
    return React.lazy(tab.importTab);
  }, [connectionId, activeTab]);

  if (!isOpen) return null;

  const connected = Boolean(connectionId);

  return (
    <div className="flex h-full flex-col bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--color-text)]">
          <LifeBuoy className="h-5 w-5 text-primary" />
          {t("integrations.osticket.title", "osTicket")}
          {connected && (
            <span className="text-xs font-normal text-[var(--color-textSecondary)]">
              {form.host}
              {status?.version ? ` · ${status.version}` : ""}
            </span>
          )}
        </h2>
        {connected && (
          <button
            onClick={disconnect}
            className="app-bar-button flex items-center gap-1 px-2 py-1 text-xs"
            title={t("integrations.osticket.disconnect", "Disconnect")}
          >
            <PlugZap size={14} />
            {t("integrations.osticket.disconnect", "Disconnect")}
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
                "integrations.osticket.connectHint",
                "Connect to an osTicket helpdesk via its API. Create an API key in Admin Panel → Manage → API Keys.",
              )}
            </p>

            <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
              {t("integrations.osticket.fields.name", "Name")}
              <input
                className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
                placeholder="support-desk"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
              {t("integrations.osticket.fields.host", "Host")}
              <input
                className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                value={form.host}
                onChange={(e) => setField("host", e.target.value)}
                placeholder="https://helpdesk.example.com"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
              {t("integrations.osticket.fields.apiKey", "API key")}
              <input
                type="password"
                className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                value={form.apiKey}
                onChange={(e) => setField("apiKey", e.target.value)}
                autoComplete="off"
              />
            </label>

            <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
              <input
                type="checkbox"
                checked={form.skipTlsVerify}
                onChange={(e) => setField("skipTlsVerify", e.target.checked)}
              />
              {t(
                "integrations.osticket.fields.skipTlsVerify",
                "Skip TLS certificate verification",
              )}
            </label>

            <button
              onClick={handleConnect}
              disabled={connecting || !form.host.trim() || !form.apiKey}
              className="mt-2 flex items-center justify-center gap-2 rounded bg-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {connecting ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Plug size={16} />
              )}
              {t("integrations.osticket.connect", "Connect")}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {osticketCategoryTabs.length > 0 ? (
            <>
              <div className="flex gap-1 border-b border-[var(--color-border)] px-2">
                {osticketCategoryTabs.map((tab) => (
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
                      `integrations.osticket.tabs.${tab.categoryKey}`,
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
                  "integrations.osticket.noTabs",
                  "Connected. Management sections load here once registered.",
                )}
              </p>
              <p className="text-xs">
                {form.host}
                {status?.version ? ` · ${status.version}` : ""}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default OsticketPanel;
