// CpanelPanel — the cPanel/WHM integration panel SHELL (t42 §4b, crate lead
// t42-cpanel-L). Owns the connect/config form + connection lifecycle and a
// registry-driven sub-tab bar. The command surface itself (WHM server-admin and
// cPanel account-level) is bound by the per-category tab modules, which register
// themselves in `./registry.ts`; this shell never changes per-category.

import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Server, Loader2, Plug, PlugZap, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { IntegrationPanelProps } from "../../../types/integrations/registry";
import type {
  CpanelAuthMode,
  CpanelConnectionConfig,
} from "../../../types/cpanel";
import { useCpanelConnection } from "../../../hooks/integration/cpanel/useCpanelConnection";
import { useIntegrationConfigStore } from "../../../hooks/integrations/useIntegrationConfigStore";
import { cpanelCategoryTabs } from "./registry";

/** The secret blob stored in the OS vault packs both possible credentials (the
 *  store has one secret slot per instance); only the one matching `auth_mode` is
 *  sent to the backend at connect time. */
interface CpanelSecret {
  password: string;
  apiToken: string;
}

const DEFAULT_WHM_PORT = 2087;
const DEFAULT_CPANEL_PORT = 2083;
const DEFAULT_TIMEOUT_SECS = 30;

const AUTH_MODES: { value: CpanelAuthMode; label: string; defaultLabel: string }[] =
  [
    {
      value: "password",
      label: "integrations.cpanel.authModes.password",
      defaultLabel: "Username + password",
    },
    {
      value: "api_token",
      label: "integrations.cpanel.authModes.apiToken",
      defaultLabel: "WHM API token",
    },
    {
      value: "user_api_token",
      label: "integrations.cpanel.authModes.userApiToken",
      defaultLabel: "cPanel user API token",
    },
  ];

const emptyForm = {
  name: "",
  host: "",
  whmPort: String(DEFAULT_WHM_PORT),
  cpanelPort: String(DEFAULT_CPANEL_PORT),
  authMode: "password" as CpanelAuthMode,
  username: "",
  password: "",
  apiToken: "",
  useTls: true,
  acceptInvalidCerts: false,
};

type FormState = typeof emptyForm;

const CpanelPanel: React.FC<IntegrationPanelProps> = ({ isOpen, instanceId }) => {
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
  } = useCpanelConnection();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [activeTab, setActiveTab] = useState<string | null>(
    cpanelCategoryTabs[0]?.categoryKey ?? null,
  );

  // Prefill the form from a persisted instance when opened against one.
  useEffect(() => {
    if (!instanceId || storeLoading) return;
    const instance = instancesFor("cpanel").find((i) => i.id === instanceId);
    if (!instance) return;
    let cancelled = false;
    (async () => {
      const secretRaw = await readSecret(instance);
      let secret: CpanelSecret = { password: "", apiToken: "" };
      if (secretRaw) {
        try {
          secret = JSON.parse(secretRaw) as CpanelSecret;
        } catch {
          // Legacy / opaque secret — treat the whole string as the password.
          secret = { password: secretRaw, apiToken: "" };
        }
      }
      if (cancelled) return;
      const fields = instance.fields ?? {};
      setForm({
        name: instance.name,
        host: instance.host ?? "",
        whmPort: fields.whmPort ?? String(DEFAULT_WHM_PORT),
        cpanelPort: fields.cpanelPort ?? String(DEFAULT_CPANEL_PORT),
        authMode: (fields.authMode as CpanelAuthMode) ?? "password",
        username: fields.username ?? "",
        password: secret.password,
        apiToken: secret.apiToken,
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

  const buildConfig = useCallback((): CpanelConnectionConfig => {
    const whmPort = Number.parseInt(form.whmPort, 10);
    const cpanelPort = Number.parseInt(form.cpanelPort, 10);
    const usingPassword = form.authMode === "password";
    return {
      host: form.host.trim(),
      whm_port: Number.isFinite(whmPort) ? whmPort : DEFAULT_WHM_PORT,
      cpanel_port: Number.isFinite(cpanelPort)
        ? cpanelPort
        : DEFAULT_CPANEL_PORT,
      use_tls: form.useTls,
      accept_invalid_certs: form.acceptInvalidCerts,
      auth_mode: form.authMode,
      username: form.username.trim(),
      password: usingPassword ? form.password : undefined,
      api_token: usingPassword ? undefined : form.apiToken,
      timeout_secs: DEFAULT_TIMEOUT_SECS,
    };
  }, [form]);

  const handleConnect = useCallback(async () => {
    setError(null);
    try {
      const config = buildConfig();
      const secret = JSON.stringify({
        password: form.password,
        apiToken: form.apiToken,
      } satisfies CpanelSecret);
      const fields = {
        whmPort: String(config.whm_port),
        cpanelPort: String(config.cpanel_port),
        authMode: config.auth_mode,
        username: config.username,
        useTls: String(config.use_tls),
        acceptInvalidCerts: String(config.accept_invalid_certs),
      };
      const name = form.name.trim() || form.host.trim() || "cPanel/WHM";

      // Persist host + creds (encrypted) and use the instance id as the stable
      // connection id, so reconnecting a saved instance reuses its id.
      let id = instanceId ?? null;
      if (id) {
        await updateInstance(id, {
          integrationKey: "cpanel",
          name,
          host: config.host,
          fields,
          secret,
        });
      } else {
        const created = await createInstance({
          integrationKey: "cpanel",
          name,
          host: config.host,
          fields,
          secret,
        });
        id = created.id;
      }

      await connect(id, config);
      setActiveTab(cpanelCategoryTabs[0]?.categoryKey ?? null);
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
    const tab = cpanelCategoryTabs.find((tt) => tt.categoryKey === activeTab);
    if (!tab) return null;
    return React.lazy(tab.importTab);
  }, [connectionId, activeTab]);

  if (!isOpen) return null;

  const connected = Boolean(connectionId);
  const usingPassword = form.authMode === "password";

  return (
    <div className="flex h-full flex-col bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--color-text)]">
          <Server className="h-5 w-5 text-primary" />
          {t("integrations.cpanel.title", "cPanel/WHM")}
          {summary && (
            <span className="text-xs font-normal text-[var(--color-textSecondary)]">
              {summary.hostname ?? summary.host}
              {summary.version ? ` · ${summary.version}` : ""}
            </span>
          )}
        </h2>
        {connected && (
          <button
            onClick={disconnect}
            className="app-bar-button flex items-center gap-1 px-2 py-1 text-xs"
            title={t("integrations.cpanel.disconnect", "Disconnect")}
          >
            <PlugZap size={14} />
            {t("integrations.cpanel.disconnect", "Disconnect")}
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
                "integrations.cpanel.connectHint",
                "Connect to a cPanel/WHM server via its WHM & UAPI endpoints.",
              )}
            </p>

            <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
              {t("integrations.cpanel.fields.name", "Name")}
              <input
                className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
                placeholder="web-host-01"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
              {t("integrations.cpanel.fields.host", "Host")}
              <input
                className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                value={form.host}
                onChange={(e) => setField("host", e.target.value)}
                placeholder="server.example.com"
              />
            </label>

            <div className="flex gap-2">
              <label className="flex flex-1 flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
                {t("integrations.cpanel.fields.whmPort", "WHM port")}
                <input
                  className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                  value={form.whmPort}
                  onChange={(e) => setField("whmPort", e.target.value)}
                  inputMode="numeric"
                />
              </label>
              <label className="flex flex-1 flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
                {t("integrations.cpanel.fields.cpanelPort", "cPanel port")}
                <input
                  className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                  value={form.cpanelPort}
                  onChange={(e) => setField("cpanelPort", e.target.value)}
                  inputMode="numeric"
                />
              </label>
            </div>

            <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
              {t("integrations.cpanel.fields.authMode", "Authentication")}
              <select
                className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                value={form.authMode}
                onChange={(e) =>
                  setField("authMode", e.target.value as CpanelAuthMode)
                }
              >
                {AUTH_MODES.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {t(mode.label, mode.defaultLabel)}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
              {t("integrations.cpanel.fields.username", "Username")}
              <input
                className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                value={form.username}
                onChange={(e) => setField("username", e.target.value)}
                autoComplete="off"
                placeholder="root"
              />
            </label>

            {usingPassword ? (
              <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
                {t("integrations.cpanel.fields.password", "Password")}
                <input
                  type="password"
                  className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                  value={form.password}
                  onChange={(e) => setField("password", e.target.value)}
                  autoComplete="off"
                />
              </label>
            ) : (
              <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
                {t("integrations.cpanel.fields.apiToken", "API token")}
                <input
                  type="password"
                  className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                  value={form.apiToken}
                  onChange={(e) => setField("apiToken", e.target.value)}
                  autoComplete="off"
                />
              </label>
            )}

            <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
              <input
                type="checkbox"
                checked={form.useTls}
                onChange={(e) => setField("useTls", e.target.checked)}
              />
              {t("integrations.cpanel.fields.useTls", "Use TLS (HTTPS)")}
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
                "integrations.cpanel.fields.acceptInvalidCerts",
                "Accept self-signed certificates",
              )}
            </label>

            <button
              onClick={handleConnect}
              disabled={connecting || !form.host.trim() || !form.username.trim()}
              className="mt-2 flex items-center justify-center gap-2 rounded bg-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {connecting ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Plug size={16} />
              )}
              {t("integrations.cpanel.connect", "Connect")}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {cpanelCategoryTabs.length > 0 ? (
            <>
              <div className="flex gap-1 border-b border-[var(--color-border)] px-2">
                {cpanelCategoryTabs.map((tab) => (
                  <button
                    key={tab.categoryKey}
                    onClick={() => setActiveTab(tab.categoryKey)}
                    className={`px-3 py-2 text-sm ${
                      activeTab === tab.categoryKey
                        ? "border-b-2 border-primary text-[var(--color-text)]"
                        : "text-[var(--color-textSecondary)]"
                    }`}
                  >
                    {t(`integrations.cpanel.tabs.${tab.categoryKey}`, tab.label)}
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
                  "integrations.cpanel.noTabs",
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

export default CpanelPanel;
