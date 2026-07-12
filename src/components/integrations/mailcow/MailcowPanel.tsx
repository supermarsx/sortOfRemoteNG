// MailcowPanel — the mailcow integration panel SHELL (t42 §4b, crate lead
// t42-mailcow-L). Owns the connect/config form + connection lifecycle and a
// registry-driven sub-tab bar. The command surface itself (domains/mailboxes/
// aliases provisioning and queue/quarantine/server operations) is bound by the
// per-category tab modules, which register themselves in `./registry.ts`; this
// shell never changes per-category.

import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Mailbox, Loader2, Plug, PlugZap, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { IntegrationPanelProps } from "../../../types/integrations/registry";
import type { MailcowConnectionConfig } from "../../../types/mailcow";
import { useMailcowConnection } from "../../../hooks/integration/mailcow/useMailcowConnection";
import { useIntegrationConfigStore } from "../../../hooks/integrations/useIntegrationConfigStore";
import { mailcowCategoryTabs } from "./registry";

const INTEGRATION_KEY = "mailcow";
const DEFAULT_TIMEOUT_SECS = 30;

const emptyForm = {
  name: "",
  baseUrl: "",
  apiKey: "",
  timeoutSecs: String(DEFAULT_TIMEOUT_SECS),
  tlsSkipVerify: false,
};

type FormState = typeof emptyForm;

const MailcowPanel: React.FC<IntegrationPanelProps> = ({
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
    summary,
    connecting,
    error,
    connect,
    disconnect,
    setError,
  } = useMailcowConnection();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [activeTab, setActiveTab] = useState<string | null>(
    mailcowCategoryTabs[0]?.categoryKey ?? null,
  );

  // Prefill the form from a persisted instance when opened against one.
  useEffect(() => {
    if (!instanceId || storeLoading) return;
    const instance = instancesFor("mailcow").find((i) => i.id === instanceId);
    if (!instance) return;
    let cancelled = false;
    (async () => {
      const apiKey = (await readSecret(instance)) ?? "";
      if (cancelled) return;
      const fields = instance.fields ?? {};
      setForm({
        name: instance.name,
        baseUrl: instance.host ?? "",
        apiKey,
        timeoutSecs: fields.timeoutSecs ?? String(DEFAULT_TIMEOUT_SECS),
        tlsSkipVerify: fields.tlsSkipVerify === "true",
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

  const buildConfig = useCallback((): MailcowConnectionConfig => {
    const timeoutSecs = Number.parseInt(form.timeoutSecs, 10);
    return {
      base_url: form.baseUrl.trim().replace(/\/+$/, ""),
      api_key: form.apiKey,
      timeout_secs: Number.isFinite(timeoutSecs)
        ? timeoutSecs
        : DEFAULT_TIMEOUT_SECS,
      tls_skip_verify: form.tlsSkipVerify,
    };
  }, [form]);

  const handleConnect = useCallback(async () => {
    setError(null);
    try {
      const config = buildConfig();
      const fields = {
        timeoutSecs: String(config.timeout_secs ?? DEFAULT_TIMEOUT_SECS),
        tlsSkipVerify: String(config.tls_skip_verify ?? false),
      };
      const name = form.name.trim() || config.base_url || "mailcow";

      // Persist host + api_key (encrypted) and use the instance id as the stable
      // connection id, so reconnecting a saved instance reuses its id.
      let id = instanceId ?? null;
      if (id) {
        await updateInstance(id, {
          integrationKey: INTEGRATION_KEY,
          name,
          host: config.base_url,
          fields,
          secret: config.api_key,
        });
      } else {
        const created = await createInstance({
          integrationKey: INTEGRATION_KEY,
          name,
          host: config.base_url,
          fields,
          secret: config.api_key,
        });
        id = created.id;
      }

      await connect(id, config);
      setActiveTab(mailcowCategoryTabs[0]?.categoryKey ?? null);
    } catch {
      // `connect` already surfaced the error via the hook; persistence failures
      // fall through here too and leave the form editable.
    }
  }, [
    buildConfig,
    form,
    instanceId,
    createInstance,
    updateInstance,
    connect,
    setError,
  ]);

  const ActiveTab = useMemo(() => {
    if (!connectionId || !activeTab) return null;
    const tab = mailcowCategoryTabs.find((tt) => tt.categoryKey === activeTab);
    if (!tab) return null;
    return React.lazy(tab.importTab);
  }, [connectionId, activeTab]);

  if (!isOpen) return null;

  const connected = Boolean(connectionId);

  return (
    <div className="flex h-full flex-col bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--color-text)]">
          <Mailbox className="h-5 w-5 text-primary" />
          {t("integrations.mailcow.title", "mailcow")}
          {summary && (
            <span className="text-xs font-normal text-[var(--color-textSecondary)]">
              {summary.hostname ?? summary.host}
              {summary.version ? ` · ${summary.version}` : ""}
              {` · ${t("integrations.mailcow.containers", "{{count}} containers", {
                count: summary.containers_count,
              })}`}
            </span>
          )}
        </h2>
        {connected && (
          <button
            onClick={disconnect}
            className="app-bar-button flex items-center gap-1 px-2 py-1 text-xs"
            title={t("integrations.mailcow.disconnect", "Disconnect")}
          >
            <PlugZap size={14} />
            {t("integrations.mailcow.disconnect", "Disconnect")}
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
                "integrations.mailcow.connectHint",
                "Connect to a mailcow instance via its administration API. Generate a read-write API key under System → Configuration → Access → API.",
              )}
            </p>

            <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
              {t("integrations.mailcow.fields.name", "Name")}
              <input
                className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
                placeholder="mail-server-01"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
              {t("integrations.mailcow.fields.baseUrl", "Base URL")}
              <input
                className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                value={form.baseUrl}
                onChange={(e) => setField("baseUrl", e.target.value)}
                placeholder="https://mail.example.com"
                inputMode="url"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
              {t("integrations.mailcow.fields.apiKey", "API key")}
              <input
                type="password"
                className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                value={form.apiKey}
                onChange={(e) => setField("apiKey", e.target.value)}
                autoComplete="off"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
              {t("integrations.mailcow.fields.timeoutSecs", "Timeout (s)")}
              <input
                className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                value={form.timeoutSecs}
                onChange={(e) => setField("timeoutSecs", e.target.value)}
                inputMode="numeric"
              />
            </label>

            <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
              <input
                type="checkbox"
                checked={form.tlsSkipVerify}
                onChange={(e) => setField("tlsSkipVerify", e.target.checked)}
              />
              {t(
                "integrations.mailcow.fields.tlsSkipVerify",
                "Skip TLS certificate verification",
              )}
            </label>

            <button
              onClick={handleConnect}
              disabled={connecting || !form.baseUrl.trim() || !form.apiKey.trim()}
              className="mt-2 flex items-center justify-center gap-2 rounded bg-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {connecting ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Plug size={16} />
              )}
              {t("integrations.mailcow.connect", "Connect")}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {mailcowCategoryTabs.length > 0 ? (
            <>
              <div className="flex gap-1 border-b border-[var(--color-border)] px-2">
                {mailcowCategoryTabs.map((tab) => (
                  <button
                    key={tab.categoryKey}
                    onClick={() => setActiveTab(tab.categoryKey)}
                    className={`px-3 py-2 text-sm ${
                      activeTab === tab.categoryKey
                        ? "border-b-2 border-primary text-[var(--color-text)]"
                        : "text-[var(--color-textSecondary)]"
                    }`}
                  >
                    {t(`integrations.mailcow.tabs.${tab.categoryKey}`, tab.label)}
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
                  "integrations.mailcow.noTabs",
                  "Connected. Management sections load here once registered.",
                )}
              </p>
              {summary && (
                <p className="text-xs">
                  {summary.hostname ?? summary.host}
                  {summary.version ? ` · ${summary.version}` : ""}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MailcowPanel;
