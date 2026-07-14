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
  ExchangeEnvironment,
  OnPremAuthMethod,
} from "../../../types/exchange";
import { useExchangeConnection } from "../../../hooks/integration/exchange";
import { useIntegrationConfigStore } from "../../../hooks/integrations/useIntegrationConfigStore";
import {
  EMPTY_EXCHANGE_CONNECTION_FORM,
  EXCHANGE_AUTH_METHODS,
  EXCHANGE_CLIENT_SECRET_KEY,
  EXCHANGE_INTEGRATION_KEY,
  EXCHANGE_ON_PREM_PASSWORD_KEY,
  EXCHANGE_ENVIRONMENTS,
  exchangeConfigFromForm,
  exchangeConnectionHost,
  exchangeFormFromConnectionSettings,
  exchangeFormFromInstance,
  exchangeFormProviderFields,
  exchangeProviderFieldsToInstanceFields,
  exchangeSecretsForVault,
  type ExchangeConnectionFormState,
} from "../../../utils/integrations/exchangeConnectionFields";
import { exchangeTabs } from "./registry";

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
  integrationSettings,
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
  const {
    instances,
    createInstance,
    updateInstance,
    readSecret,
    readNamedSecret,
  } = useIntegrationConfigStore();

  const [form, setForm] = useState<ExchangeConnectionFormState>(() =>
    exchangeFormFromConnectionSettings(integrationSettings),
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<string | null>(
    exchangeTabs[0]?.categoryKey ?? null,
  );

  // Connection-launched panels prefill once from non-secret connection metadata.
  useEffect(() => {
    if (instanceId) return;
    setForm(
      integrationSettings
        ? exchangeFormFromConnectionSettings(integrationSettings)
        : EMPTY_EXCHANGE_CONNECTION_FORM,
    );
  }, [instanceId, integrationSettings]);

  // Saved instances are authoritative when an instance id is supplied.
  useEffect(() => {
    if (!instanceId) return;
    let cancelled = false;
    const inst = instances.find((i) => i.id === instanceId);
    if (!inst) {
      setForm(
        integrationSettings
          ? exchangeFormFromConnectionSettings(integrationSettings)
          : EMPTY_EXCHANGE_CONNECTION_FORM,
      );
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      const legacySecret = (await readSecret(inst)) ?? "";
      const clientSecret =
        (await readNamedSecret(inst, EXCHANGE_CLIENT_SECRET_KEY)) ??
        (inst.fields?.environment !== "onPremises" ? legacySecret : "");
      const password =
        (await readNamedSecret(inst, EXCHANGE_ON_PREM_PASSWORD_KEY)) ??
        (inst.fields?.environment === "onPremises" ? legacySecret : "");
      if (cancelled) return;
      setForm(
        exchangeFormFromInstance(inst.name, inst.fields, {
          clientSecret,
          password,
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [instanceId, instances, integrationSettings, readSecret, readNamedSecret]);

  const setField = useCallback(
    <K extends keyof ExchangeConnectionFormState>(
      key: K,
      value: ExchangeConnectionFormState[K],
    ) => {
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
    await connect(exchangeConfigFromForm(form));
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
      const providerFields = exchangeFormProviderFields(form);
      const fields = exchangeProviderFieldsToInstanceFields(providerFields);
      const host = exchangeConnectionHost(providerFields);
      const name =
        form.name.trim() ||
        host ||
        t("integrations.exchange.title", "Exchange");
      const secrets = exchangeSecretsForVault(form);
      if (instanceId) {
        await updateInstance(instanceId, {
          name,
          host,
          fields,
          secrets,
        });
      } else {
        await createInstance({
          integrationKey: EXCHANGE_INTEGRATION_KEY,
          name,
          host,
          fields,
          secrets,
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
                data-testid="exchange-instance-name"
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
                data-testid="exchange-environment"
                className={inputClass}
                value={form.environment}
                onChange={(e) =>
                  setField("environment", e.target.value as ExchangeEnvironment)
                }
              >
                {EXCHANGE_ENVIRONMENTS.map((env) => (
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
                    data-testid="exchange-tenant-id"
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
                    data-testid="exchange-client-id"
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
                    data-testid="exchange-client-secret"
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
                    data-testid="exchange-organization"
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
                      data-testid="exchange-server"
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
                      data-testid="exchange-port"
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
                    data-testid="exchange-onprem-username"
                    className={inputClass}
                    value={form.onPremUsername}
                    onChange={(e) => setField("onPremUsername", e.target.value)}
                    placeholder="CONTOSO\\administrator"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-[var(--color-textSecondary)]">
                    {t("integrations.exchange.form.password", "Password")}
                  </span>
                  <input
                    data-testid="exchange-onprem-password"
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
                    data-testid="exchange-auth-method"
                    className={inputClass}
                    value={form.authMethod}
                    onChange={(e) =>
                      setField("authMethod", e.target.value as OnPremAuthMethod)
                    }
                  >
                    {EXCHANGE_AUTH_METHODS.map((m) => (
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
                    data-testid="exchange-use-ssl"
                    type="checkbox"
                    checked={form.useSsl}
                    onChange={(e) => setField("useSsl", e.target.checked)}
                  />
                  {t("integrations.exchange.form.useSsl", "Use SSL")}
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                  <input
                    data-testid="exchange-skip-cert-check"
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
                data-testid="exchange-timeout"
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
