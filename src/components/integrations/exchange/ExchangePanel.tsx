import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Mail, Loader2, Plug, PlugZap, RefreshCw, Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { IntegrationPanelProps } from "../../../types/integrations/registry";
import type {
  ExchangeConnectionConfig,
  ExchangeEnvironment,
  OnPremAuthMethod,
} from "../../../types/exchange";
import { useExchangeConnection } from "../../../hooks/integration/exchange";
import { useIntegrationConfigStore } from "../../../hooks/integrations/useIntegrationConfigStore";
import { exchangeTabs } from "./registry";

const INTEGRATION_KEY = "exchange";

const ENVIRONMENTS: ExchangeEnvironment[] = ["online", "onPremises", "hybrid"];
const AUTH_METHODS: OnPremAuthMethod[] = [
  "kerberos",
  "negotiate",
  "basic",
  "ntlm",
];

/** Local connect-form state. Both credential variants live in one flat struct;
 *  `environment` selects which set is submitted. The single secret persisted to
 *  the OS vault is the active variant's secret (online `clientSecret`, else the
 *  on-prem `password`). */
interface FormState {
  name: string;
  environment: ExchangeEnvironment;
  timeoutSecs: string;
  // Exchange Online (OAuth2 / Graph)
  tenantId: string;
  clientId: string;
  clientSecret: string;
  onlineUsername: string;
  organization: string;
  // On-premises (PowerShell remoting)
  server: string;
  port: string;
  onPremUsername: string;
  password: string;
  useSsl: boolean;
  authMethod: OnPremAuthMethod;
  skipCertCheck: boolean;
}

const EMPTY_FORM: FormState = {
  name: "",
  environment: "online",
  timeoutSecs: "",
  tenantId: "",
  clientId: "",
  clientSecret: "",
  onlineUsername: "",
  organization: "",
  server: "",
  port: "",
  onPremUsername: "",
  password: "",
  useSsl: true,
  authMethod: "kerberos",
  skipCertCheck: false,
};

/** The active variant's secret — the one value stored in the OS vault. */
function activeSecret(form: FormState): string {
  return form.environment === "onPremises"
    ? form.password
    : form.clientSecret;
}

function toConfig(form: FormState): ExchangeConnectionConfig {
  const timeoutSecs = form.timeoutSecs.trim()
    ? Number(form.timeoutSecs.trim())
    : null;
  const config: ExchangeConnectionConfig = {
    environment: form.environment,
    timeoutSecs: Number.isFinite(timeoutSecs as number)
      ? (timeoutSecs as number)
      : null,
  };
  if (form.environment === "online" || form.environment === "hybrid") {
    config.online = {
      tenantId: form.tenantId.trim(),
      clientId: form.clientId.trim(),
      clientSecret: form.clientSecret || null,
      username: form.onlineUsername.trim() || null,
      organization: form.organization.trim() || null,
    };
  }
  if (form.environment === "onPremises" || form.environment === "hybrid") {
    const port = form.port.trim() ? Number(form.port.trim()) : 443;
    config.onPrem = {
      server: form.server.trim(),
      port: Number.isFinite(port) ? port : 443,
      username: form.onPremUsername.trim(),
      password: form.password,
      useSsl: form.useSsl,
      authMethod: form.authMethod,
      skipCertCheck: form.skipCertCheck,
    };
  }
  return config;
}

/**
 * Exchange integration panel — the shell (crate lead t42-exchange-L). Owns the
 * connect/config form (online vs on-prem credential variant → `exchange_set_config`
 * then `exchange_connect`) and a registry-driven sub-tab bar (`exchangeTabs`).
 * Category execs plug their Recipients / Mail Flow / Servers / Client Access /
 * Org-Security tabs into the registry; this shell renders and routes them but never
 * changes per category. Exchange is a SINGLETON service, so tabs receive only the
 * connection `summary` (no connectionId).
 */
const ExchangePanel: React.FC<IntegrationPanelProps> = ({
  onClose,
  instanceId,
}) => {
  const { t } = useTranslation();
  const {
    summary,
    isConnecting,
    error,
    isConnected,
    connect,
    disconnect,
    refresh,
  } = useExchangeConnection();
  const { instances, createInstance, updateInstance, readSecret } =
    useIntegrationConfigStore();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<string | null>(
    exchangeTabs[0]?.categoryKey ?? null,
  );

  // Prefill from a saved instance, including the secret from the vault.
  useEffect(() => {
    if (!instanceId) return;
    const inst = instances.find((i) => i.id === instanceId);
    if (!inst) return;
    let cancelled = false;
    (async () => {
      const secret = (await readSecret(inst)) ?? "";
      if (cancelled) return;
      const f = inst.fields ?? {};
      const environment = (f.environment as ExchangeEnvironment) || "online";
      setForm({
        name: inst.name ?? "",
        environment,
        timeoutSecs: f.timeoutSecs ?? "",
        tenantId: f.tenantId ?? "",
        clientId: f.clientId ?? "",
        clientSecret: environment === "onPremises" ? "" : secret,
        onlineUsername: f.onlineUsername ?? "",
        organization: f.organization ?? "",
        server: f.server ?? "",
        port: f.port ?? "",
        onPremUsername: f.onPremUsername ?? "",
        password: environment === "onPremises" ? secret : "",
        useSsl: f.useSsl ? f.useSsl === "true" : true,
        authMethod: (f.authMethod as OnPremAuthMethod) || "kerberos",
        skipCertCheck: f.skipCertCheck === "true",
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [instanceId, instances, readSecret]);

  const setField = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const validate = useCallback((): string | null => {
    if (form.environment === "online" || form.environment === "hybrid") {
      if (!form.tenantId.trim())
        return t(
          "integrations.exchange.errors.tenantRequired",
          "Tenant ID is required for Exchange Online",
        );
      if (!form.clientId.trim())
        return t(
          "integrations.exchange.errors.clientRequired",
          "Client ID is required for Exchange Online",
        );
    }
    if (form.environment === "onPremises" || form.environment === "hybrid") {
      if (!form.server.trim())
        return t(
          "integrations.exchange.errors.serverRequired",
          "Server is required for on-premises Exchange",
        );
      if (!form.onPremUsername.trim())
        return t(
          "integrations.exchange.errors.usernameRequired",
          "Username is required for on-premises Exchange",
        );
    }
    return null;
  }, [form, t]);

  const handleConnect = useCallback(async () => {
    const v = validate();
    if (v) {
      setFormError(v);
      return;
    }
    setFormError(null);
    await connect(toConfig(form));
  }, [validate, connect, form]);

  const handleSave = useCallback(async () => {
    const v = validate();
    if (v) {
      setFormError(v);
      return;
    }
    setFormError(null);
    setIsSaving(true);
    try {
      const fields: Record<string, string> = {
        environment: form.environment,
        timeoutSecs: form.timeoutSecs.trim(),
        tenantId: form.tenantId.trim(),
        clientId: form.clientId.trim(),
        onlineUsername: form.onlineUsername.trim(),
        organization: form.organization.trim(),
        server: form.server.trim(),
        port: form.port.trim(),
        onPremUsername: form.onPremUsername.trim(),
        useSsl: String(form.useSsl),
        authMethod: form.authMethod,
        skipCertCheck: String(form.skipCertCheck),
      };
      const host =
        form.environment === "onPremises"
          ? form.server.trim()
          : form.organization.trim() || form.tenantId.trim();
      const name =
        form.name.trim() ||
        host ||
        t("integrations.exchange.title", "Exchange");
      if (instanceId) {
        await updateInstance(instanceId, {
          name,
          host,
          fields,
          secret: activeSecret(form),
        });
      } else {
        await createInstance({
          integrationKey: INTEGRATION_KEY,
          name,
          host,
          fields,
          secret: activeSecret(form),
        });
      }
    } catch (e) {
      const msg = typeof e === "string" ? e : (e as Error).message;
      setFormError(msg);
    } finally {
      setIsSaving(false);
    }
  }, [validate, form, instanceId, updateInstance, createInstance, t]);

  const ActiveTab = useMemo(() => {
    const tab = exchangeTabs.find((x) => x.categoryKey === activeTab);
    return tab ? React.lazy(tab.importTab) : null;
  }, [activeTab]);

  const showOnline =
    form.environment === "online" || form.environment === "hybrid";
  const showOnPrem =
    form.environment === "onPremises" || form.environment === "hybrid";

  const inputClass =
    "exchange-input rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1.5 text-sm text-[var(--color-text)]";

  return (
    <div className="flex h-full flex-col bg-[var(--color-surface)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-3">
        <div className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-base font-semibold text-[var(--color-text)]">
              {t("integrations.exchange.title", "Exchange")}
            </h2>
            <p className="text-xs text-[var(--color-textSecondary)]">
              {t(
                "integrations.exchange.subtitle",
                "Mailbox, mail-flow & organization management",
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isConnected ? (
            <>
              <span className="flex items-center gap-1 text-xs text-[var(--color-success,#22c55e)]">
                <PlugZap size={14} />
                {t("integrations.exchange.connected", "Connected")}
              </span>
              <button
                onClick={refresh}
                className="app-bar-button flex items-center gap-1 px-2 py-1 text-xs"
                title={t("integrations.exchange.refresh", "Refresh")}
              >
                <RefreshCw size={12} />
              </button>
              <button
                onClick={disconnect}
                className="app-bar-button flex items-center gap-1 px-2 py-1 text-xs"
              >
                {t("integrations.exchange.disconnect", "Disconnect")}
              </button>
            </>
          ) : (
            <span className="flex items-center gap-1 text-xs text-[var(--color-textMuted)]">
              <Plug size={14} />
              {t("integrations.exchange.disconnected", "Disconnected")}
            </span>
          )}
        </div>
      </div>

      {!isConnected ? (
        /* Connect / config form */
        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto flex max-w-md flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[var(--color-textSecondary)]">
                {t("integrations.exchange.form.instanceName", "Instance name")}
              </span>
              <input
                className={inputClass}
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
                placeholder={t(
                  "integrations.exchange.form.instanceNamePlaceholder",
                  "Corporate Exchange",
                )}
              />
            </label>

            {/* Environment / credential-variant selector */}
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[var(--color-textSecondary)]">
                {t("integrations.exchange.form.environment", "Environment")}
              </span>
              <select
                className={inputClass}
                value={form.environment}
                onChange={(e) =>
                  setField(
                    "environment",
                    e.target.value as ExchangeEnvironment,
                  )
                }
              >
                {ENVIRONMENTS.map((env) => (
                  <option key={env} value={env}>
                    {t(
                      `integrations.exchange.environment.${env}`,
                      env === "online"
                        ? "Exchange Online (Microsoft 365)"
                        : env === "onPremises"
                          ? "Exchange Server (on-premises)"
                          : "Hybrid",
                    )}
                  </option>
                ))}
              </select>
            </label>

            {showOnline && (
              <fieldset className="flex flex-col gap-3 rounded border border-[var(--color-border)] p-3">
                <legend className="px-1 text-xs text-[var(--color-textSecondary)]">
                  {t(
                    "integrations.exchange.form.onlineSection",
                    "Exchange Online (OAuth2)",
                  )}
                </legend>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-[var(--color-textSecondary)]">
                    {t("integrations.exchange.form.tenantId", "Tenant ID")}
                  </span>
                  <input
                    className={inputClass}
                    value={form.tenantId}
                    onChange={(e) => setField("tenantId", e.target.value)}
                    placeholder="contoso.onmicrosoft.com"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-[var(--color-textSecondary)]">
                    {t("integrations.exchange.form.clientId", "Client ID")}
                  </span>
                  <input
                    className={inputClass}
                    value={form.clientId}
                    onChange={(e) => setField("clientId", e.target.value)}
                    placeholder="00000000-0000-0000-0000-000000000000"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-[var(--color-textSecondary)]">
                    {t(
                      "integrations.exchange.form.clientSecret",
                      "Client secret",
                    )}
                  </span>
                  <input
                    type="password"
                    className={inputClass}
                    value={form.clientSecret}
                    onChange={(e) => setField("clientSecret", e.target.value)}
                    autoComplete="off"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-[var(--color-textSecondary)]">
                    {t(
                      "integrations.exchange.form.organization",
                      "Organization (optional)",
                    )}
                  </span>
                  <input
                    className={inputClass}
                    value={form.organization}
                    onChange={(e) => setField("organization", e.target.value)}
                    placeholder="contoso.onmicrosoft.com"
                  />
                </label>
              </fieldset>
            )}

            {showOnPrem && (
              <fieldset className="flex flex-col gap-3 rounded border border-[var(--color-border)] p-3">
                <legend className="px-1 text-xs text-[var(--color-textSecondary)]">
                  {t(
                    "integrations.exchange.form.onPremSection",
                    "Exchange Server (PowerShell remoting)",
                  )}
                </legend>
                <div className="grid grid-cols-3 gap-3">
                  <label className="col-span-2 flex flex-col gap-1 text-sm">
                    <span className="text-[var(--color-textSecondary)]">
                      {t("integrations.exchange.form.server", "Server")}
                    </span>
                    <input
                      className={inputClass}
                      value={form.server}
                      onChange={(e) => setField("server", e.target.value)}
                      placeholder="mail01.contoso.local"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-[var(--color-textSecondary)]">
                      {t("integrations.exchange.form.port", "Port")}
                    </span>
                    <input
                      className={inputClass}
                      value={form.port}
                      onChange={(e) => setField("port", e.target.value)}
                      inputMode="numeric"
                      placeholder="443"
                    />
                  </label>
                </div>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-[var(--color-textSecondary)]">
                    {t("integrations.exchange.form.username", "Username")}
                  </span>
                  <input
                    className={inputClass}
                    value={form.onPremUsername}
                    onChange={(e) =>
                      setField("onPremUsername", e.target.value)
                    }
                    placeholder="CONTOSO\\administrator"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-[var(--color-textSecondary)]">
                    {t("integrations.exchange.form.password", "Password")}
                  </span>
                  <input
                    type="password"
                    className={inputClass}
                    value={form.password}
                    onChange={(e) => setField("password", e.target.value)}
                    autoComplete="off"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-[var(--color-textSecondary)]">
                    {t("integrations.exchange.form.authMethod", "Auth method")}
                  </span>
                  <select
                    className={inputClass}
                    value={form.authMethod}
                    onChange={(e) =>
                      setField(
                        "authMethod",
                        e.target.value as OnPremAuthMethod,
                      )
                    }
                  >
                    {AUTH_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {t(
                          `integrations.exchange.authMethod.${m}`,
                          m.charAt(0).toUpperCase() + m.slice(1),
                        )}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                  <input
                    type="checkbox"
                    checked={form.useSsl}
                    onChange={(e) => setField("useSsl", e.target.checked)}
                  />
                  {t("integrations.exchange.form.useSsl", "Use SSL")}
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                  <input
                    type="checkbox"
                    checked={form.skipCertCheck}
                    onChange={(e) =>
                      setField("skipCertCheck", e.target.checked)
                    }
                  />
                  {t(
                    "integrations.exchange.form.skipCertCheck",
                    "Skip certificate validation",
                  )}
                </label>
              </fieldset>
            )}

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[var(--color-textSecondary)]">
                {t("integrations.exchange.form.timeoutSecs", "Timeout (s)")}
              </span>
              <input
                className={inputClass}
                value={form.timeoutSecs}
                onChange={(e) => setField("timeoutSecs", e.target.value)}
                inputMode="numeric"
                placeholder="120"
              />
            </label>

            {(formError || error) && (
              <p className="text-xs text-[var(--color-error,#ef4444)]">
                {formError ?? error}
              </p>
            )}

            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={handleConnect}
                disabled={isConnecting}
                className="flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
              >
                {isConnecting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Plug size={14} />
                )}
                {t("integrations.exchange.connect", "Connect")}
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="app-bar-button flex items-center gap-1 px-3 py-1.5 text-sm disabled:opacity-60"
                title={t("integrations.exchange.save", "Save instance")}
              >
                {isSaving ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Save size={14} />
                )}
                {t("integrations.exchange.save", "Save")}
              </button>
              <button
                onClick={onClose}
                className="app-bar-button px-3 py-1.5 text-sm"
              >
                {t("integrations.exchange.cancel", "Cancel")}
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Connected: summary bar + registry-driven sub-tab bar */
        <div className="flex min-h-0 flex-1 flex-col">
          {summary && (
            <div className="flex flex-wrap items-center gap-4 border-b border-[var(--color-border)] px-6 py-2 text-xs text-[var(--color-textSecondary)]">
              <span>
                {t("integrations.exchange.status.environment", "Environment")}:{" "}
                {t(
                  `integrations.exchange.environment.${summary.environment}`,
                  summary.environment,
                )}
              </span>
              {summary.server && (
                <span>
                  {t("integrations.exchange.status.server", "Server")}:{" "}
                  {summary.server}
                </span>
              )}
              {summary.organization && (
                <span>
                  {t("integrations.exchange.status.organization", "Org")}:{" "}
                  {summary.organization}
                </span>
              )}
              {summary.connectedAs && (
                <span>
                  {t("integrations.exchange.status.connectedAs", "As")}:{" "}
                  {summary.connectedAs}
                </span>
              )}
              {summary.exchangeVersion && (
                <span>
                  {t("integrations.exchange.status.version", "Version")}:{" "}
                  {summary.exchangeVersion}
                </span>
              )}
            </div>
          )}

          {exchangeTabs.length > 0 ? (
            <>
              <div className="flex items-center gap-1 overflow-x-auto border-b border-[var(--color-border)] px-4">
                {exchangeTabs.map((tab) => {
                  const TabIcon = tab.icon;
                  const active = tab.categoryKey === activeTab;
                  return (
                    <button
                      key={tab.categoryKey}
                      onClick={() => setActiveTab(tab.categoryKey)}
                      className={`flex items-center gap-1 whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
                        active
                          ? "border-primary text-[var(--color-text)]"
                          : "border-transparent text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                      }`}
                    >
                      {TabIcon && <TabIcon size={14} />}
                      {t(tab.labelKey, tab.labelDefault)}
                    </button>
                  );
                })}
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                {ActiveTab ? (
                  <Suspense
                    fallback={
                      <div className="flex h-full items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                      </div>
                    }
                  >
                    <ActiveTab summary={summary} />
                  </Suspense>
                ) : null}
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-10 text-center text-sm text-[var(--color-textSecondary)]">
              {t(
                "integrations.exchange.noTabs",
                "Connected. Management sections will appear here.",
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ExchangePanel;
