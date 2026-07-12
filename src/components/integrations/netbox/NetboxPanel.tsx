import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Network, Loader2, Plug, PlugZap, RefreshCw, Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { IntegrationPanelProps } from "../../../types/integrations/registry";
import type { NetboxConnectionConfig } from "../../../types/netbox";
import { useNetboxConnection } from "../../../hooks/integration/netbox";
import { useIntegrationConfigStore } from "../../../hooks/integrations/useIntegrationConfigStore";
import { generateId } from "../../../utils/core/id";
import { netboxTabs } from "./registry";

const INTEGRATION_KEY = "netbox";

/** Local connect-form state. Non-secret fields are kept as strings for inputs;
 *  the API token is the only secret and is stored in the OS vault on save. */
interface FormState {
  name: string;
  host: string;
  port: string;
  useTls: boolean;
  acceptInvalidCerts: boolean;
  apiToken: string;
  timeoutSecs: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  host: "",
  port: "",
  useTls: true,
  acceptInvalidCerts: false,
  apiToken: "",
  timeoutSecs: "",
};

function toConfig(form: FormState): NetboxConnectionConfig {
  const port = form.port.trim() ? Number(form.port.trim()) : null;
  const timeoutSecs = form.timeoutSecs.trim()
    ? Number(form.timeoutSecs.trim())
    : null;
  return {
    host: form.host.trim(),
    port: Number.isFinite(port as number) ? (port as number) : null,
    useTls: form.useTls,
    acceptInvalidCerts: form.acceptInvalidCerts,
    apiToken: form.apiToken,
    timeoutSecs: Number.isFinite(timeoutSecs as number)
      ? (timeoutSecs as number)
      : null,
  };
}

/**
 * NetBox integration panel — the shell (crate lead t42-netbox-L). Owns the
 * connect/config form (from `NetboxConnectionConfig`) and a registry-driven
 * sub-tab bar (`netboxTabs`). Category execs plug their DCIM / IPAM /
 * Virtualization / Tenancy tabs into the registry; this shell renders and routes
 * them but never changes per category.
 */
const NetboxPanel: React.FC<IntegrationPanelProps> = ({
  onClose,
  instanceId,
}) => {
  const { t } = useTranslation();
  const {
    connectionId,
    summary,
    isConnecting,
    error,
    isConnected,
    connect,
    disconnect,
    refresh,
  } = useNetboxConnection();
  const { instances, createInstance, updateInstance, readSecret } =
    useIntegrationConfigStore();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<string | null>(
    netboxTabs[0]?.categoryKey ?? null,
  );

  // Prefill from a saved instance, including the secret from the vault.
  useEffect(() => {
    if (!instanceId) return;
    const inst = instances.find((i) => i.id === instanceId);
    if (!inst) return;
    let cancelled = false;
    (async () => {
      const token = (await readSecret(inst)) ?? "";
      if (cancelled) return;
      const f = inst.fields ?? {};
      setForm({
        name: inst.name ?? "",
        host: inst.host ?? "",
        port: f.port ?? "",
        useTls: f.useTls ? f.useTls === "true" : true,
        acceptInvalidCerts: f.acceptInvalidCerts === "true",
        apiToken: token,
        timeoutSecs: f.timeoutSecs ?? "",
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
    if (!form.host.trim())
      return t("integrations.netbox.errors.hostRequired", "Host is required");
    if (!form.apiToken.trim())
      return t(
        "integrations.netbox.errors.tokenRequired",
        "API token is required",
      );
    return null;
  }, [form.host, form.apiToken, t]);

  const handleConnect = useCallback(async () => {
    const v = validate();
    if (v) {
      setFormError(v);
      return;
    }
    setFormError(null);
    const id = instanceId ?? generateId();
    await connect(id, toConfig(form));
  }, [validate, instanceId, connect, form]);

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
        port: form.port.trim(),
        useTls: String(form.useTls),
        acceptInvalidCerts: String(form.acceptInvalidCerts),
        timeoutSecs: form.timeoutSecs.trim(),
      };
      const name =
        form.name.trim() ||
        form.host.trim() ||
        t("integrations.netbox.title", "NetBox");
      if (instanceId) {
        await updateInstance(instanceId, {
          name,
          host: form.host.trim(),
          fields,
          secret: form.apiToken,
        });
      } else {
        await createInstance({
          integrationKey: INTEGRATION_KEY,
          name,
          host: form.host.trim(),
          fields,
          secret: form.apiToken,
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
    const tab = netboxTabs.find((x) => x.categoryKey === activeTab);
    return tab ? React.lazy(tab.importTab) : null;
  }, [activeTab]);

  return (
    <div className="flex h-full flex-col bg-[var(--color-surface)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-3">
        <div className="flex items-center gap-2">
          <Network className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-base font-semibold text-[var(--color-text)]">
              {t("integrations.netbox.title", "NetBox")}
            </h2>
            <p className="text-xs text-[var(--color-textSecondary)]">
              {t("integrations.netbox.subtitle", "DCIM & IPAM management")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isConnected ? (
            <>
              <span className="flex items-center gap-1 text-xs text-[var(--color-success,#22c55e)]">
                <PlugZap size={14} />
                {t("integrations.netbox.connected", "Connected")}
              </span>
              <button
                onClick={refresh}
                className="app-bar-button flex items-center gap-1 px-2 py-1 text-xs"
                title={t("integrations.netbox.refresh", "Refresh")}
              >
                <RefreshCw size={12} />
              </button>
              <button
                onClick={disconnect}
                className="app-bar-button flex items-center gap-1 px-2 py-1 text-xs"
              >
                {t("integrations.netbox.disconnect", "Disconnect")}
              </button>
            </>
          ) : (
            <span className="flex items-center gap-1 text-xs text-[var(--color-textMuted)]">
              <Plug size={14} />
              {t("integrations.netbox.disconnected", "Disconnected")}
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
                {t("integrations.netbox.form.instanceName", "Instance name")}
              </span>
              <input
                className="netbox-input rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1.5 text-sm text-[var(--color-text)]"
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
                placeholder={t(
                  "integrations.netbox.form.instanceNamePlaceholder",
                  "Production NetBox",
                )}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[var(--color-textSecondary)]">
                {t("integrations.netbox.form.host", "Host")}
              </span>
              <input
                className="netbox-input rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1.5 text-sm text-[var(--color-text)]"
                value={form.host}
                onChange={(e) => setField("host", e.target.value)}
                placeholder={t(
                  "integrations.netbox.form.hostPlaceholder",
                  "netbox.example.com",
                )}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-[var(--color-textSecondary)]">
                  {t("integrations.netbox.form.port", "Port")}
                </span>
                <input
                  className="netbox-input rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1.5 text-sm text-[var(--color-text)]"
                  value={form.port}
                  onChange={(e) => setField("port", e.target.value)}
                  inputMode="numeric"
                  placeholder="443"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-[var(--color-textSecondary)]">
                  {t("integrations.netbox.form.timeoutSecs", "Timeout (s)")}
                </span>
                <input
                  className="netbox-input rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1.5 text-sm text-[var(--color-text)]"
                  value={form.timeoutSecs}
                  onChange={(e) => setField("timeoutSecs", e.target.value)}
                  inputMode="numeric"
                  placeholder="30"
                />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[var(--color-textSecondary)]">
                {t("integrations.netbox.form.apiToken", "API Token")}
              </span>
              <input
                type="password"
                className="netbox-input rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1.5 text-sm text-[var(--color-text)]"
                value={form.apiToken}
                onChange={(e) => setField("apiToken", e.target.value)}
                placeholder={t(
                  "integrations.netbox.form.apiTokenPlaceholder",
                  "Your NetBox API token",
                )}
                autoComplete="off"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
              <input
                type="checkbox"
                checked={form.useTls}
                onChange={(e) => setField("useTls", e.target.checked)}
              />
              {t("integrations.netbox.form.useTls", "Use TLS (HTTPS)")}
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
              <input
                type="checkbox"
                checked={form.acceptInvalidCerts}
                onChange={(e) =>
                  setField("acceptInvalidCerts", e.target.checked)
                }
              />
              {t(
                "integrations.netbox.form.acceptInvalidCerts",
                "Accept invalid certificates",
              )}
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
                {t("integrations.netbox.connect", "Connect")}
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="app-bar-button flex items-center gap-1 px-3 py-1.5 text-sm disabled:opacity-60"
                title={t("integrations.netbox.save", "Save instance")}
              >
                {isSaving ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Save size={14} />
                )}
                {t("integrations.netbox.save", "Save")}
              </button>
              <button
                onClick={onClose}
                className="app-bar-button px-3 py-1.5 text-sm"
              >
                {t("integrations.netbox.cancel", "Cancel")}
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
                {t("integrations.netbox.status.host", "Host")}: {summary.host}
              </span>
              {summary.version != null && (
                <span>
                  {t("integrations.netbox.status.version", "Version")}:{" "}
                  {summary.version}
                </span>
              )}
              {summary.siteCount != null && (
                <span>
                  {t("integrations.netbox.status.sites", "Sites")}:{" "}
                  {summary.siteCount}
                </span>
              )}
              {summary.deviceCount != null && (
                <span>
                  {t("integrations.netbox.status.devices", "Devices")}:{" "}
                  {summary.deviceCount}
                </span>
              )}
              {summary.prefixCount != null && (
                <span>
                  {t("integrations.netbox.status.prefixes", "Prefixes")}:{" "}
                  {summary.prefixCount}
                </span>
              )}
            </div>
          )}

          {netboxTabs.length > 0 ? (
            <>
              <div className="flex items-center gap-1 border-b border-[var(--color-border)] px-4">
                {netboxTabs.map((tab) => {
                  const TabIcon = tab.icon;
                  const active = tab.categoryKey === activeTab;
                  return (
                    <button
                      key={tab.categoryKey}
                      onClick={() => setActiveTab(tab.categoryKey)}
                      className={`flex items-center gap-1 border-b-2 px-3 py-2 text-sm ${
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
                {ActiveTab && connectionId ? (
                  <Suspense
                    fallback={
                      <div className="flex h-full items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                      </div>
                    }
                  >
                    <ActiveTab
                      connectionId={connectionId}
                      summary={summary}
                    />
                  </Suspense>
                ) : null}
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-10 text-center text-sm text-[var(--color-textSecondary)]">
              {t(
                "integrations.netbox.noTabs",
                "Connected. Management sections will appear here.",
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NetboxPanel;
