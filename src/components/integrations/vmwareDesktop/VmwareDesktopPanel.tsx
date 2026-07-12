import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  MonitorPlay,
  Loader2,
  Plug,
  PlugZap,
  ShieldAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { IntegrationDescriptor } from "../../../types/integrations/registry";
import type { IntegrationPanelProps } from "../../../types/integrations/registry";
import type { VmwDesktopTabProps } from "../../../types/vmwareDesktop";
import { useVmwDesktopConnection } from "../../../hooks/integration/vmwareDesktop";
import {
  useIntegrationConfigStore,
  type IntegrationInstance,
} from "../../../hooks/integrations/useIntegrationConfigStore";
import { vmwDesktopTabs } from "./registry";

const INTEGRATION_KEY = "vmwareDesktop";

/** Editable form state — mirrors the vmrest connect args. Ports/timeout kept as
 *  strings for controlled inputs; parsed at connect time. */
interface FormState {
  name: string;
  vmrestHost: string;
  vmrestPort: string;
  vmrestUsername: string;
  vmrestPassword: string;
  vmrestSkipTlsVerify: boolean;
  autoStartVmrest: boolean;
  vmrunPath: string;
  timeoutSecs: string;
}

const EMPTY_FORM: FormState = {
  name: "VMware Workstation",
  vmrestHost: "127.0.0.1",
  vmrestPort: "8697",
  vmrestUsername: "",
  vmrestPassword: "",
  vmrestSkipTlsVerify: false,
  autoStartVmrest: false,
  vmrunPath: "",
  timeoutSecs: "60",
};

/** Hydrate the form from a persisted instance's non-secret fields. The password
 *  is loaded separately (out of the OS vault) and set once resolved. */
function formFromInstance(instance: IntegrationInstance): FormState {
  const f = instance.fields ?? {};
  return {
    name: instance.name,
    vmrestHost: instance.host ?? EMPTY_FORM.vmrestHost,
    vmrestPort: f.vmrestPort ?? EMPTY_FORM.vmrestPort,
    vmrestUsername: f.vmrestUsername ?? "",
    vmrestPassword: "",
    vmrestSkipTlsVerify: f.vmrestSkipTlsVerify === "true",
    autoStartVmrest: f.autoStartVmrest === "true",
    vmrunPath: f.vmrunPath ?? "",
    timeoutSecs: f.timeoutSecs ?? EMPTY_FORM.timeoutSecs,
  };
}

/**
 * VMware Workstation integration panel shell (t42, vmware-desktop LEAD).
 *
 * Owns the connect/config form (vmrest host/port/user/pw + skip-TLS toggle) — it
 * persists non-secret config via `useIntegrationConfigStore` and the password via
 * the OS vault, then drives the connection lifecycle. Once connected it renders a
 * sub-tab bar sourced from `./registry.ts`; category execs (`vms`, `host`) append
 * their tabs there. This shell never changes per command-category.
 */
const VmwareDesktopPanel: React.FC<IntegrationPanelProps> = ({
  onClose,
  instanceId,
}) => {
  const { t } = useTranslation();
  const {
    connected,
    isConnecting,
    error,
    summary,
    disconnect,
    connect,
  } = useVmwDesktopConnection();
  const { instancesFor, createInstance, updateInstance, readSecret } =
    useIntegrationConfigStore();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [boundInstanceId, setBoundInstanceId] = useState<string | undefined>(
    instanceId,
  );
  const [activeTab, setActiveTab] = useState<string | null>(
    vmwDesktopTabs[0]?.categoryKey ?? null,
  );

  // Hydrate the form when bound to a persisted instance.
  useEffect(() => {
    if (!instanceId) return;
    const instance = instancesFor(INTEGRATION_KEY).find(
      (i) => i.id === instanceId,
    );
    if (!instance) return;
    setForm(formFromInstance(instance));
    setBoundInstanceId(instance.id);
    void (async () => {
      const secret = await readSecret(instance);
      if (secret) setForm((f) => ({ ...f, vmrestPassword: secret }));
    })();
  }, [instanceId, instancesFor, readSecret]);

  const setField = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) =>
      setForm((f) => ({ ...f, [key]: value })),
    [],
  );

  const nonSecretFields = useCallback(
    (f: FormState): Record<string, string> => ({
      vmrestPort: f.vmrestPort.trim(),
      vmrestUsername: f.vmrestUsername.trim(),
      vmrestSkipTlsVerify: String(f.vmrestSkipTlsVerify),
      autoStartVmrest: String(f.autoStartVmrest),
      vmrunPath: f.vmrunPath.trim(),
      timeoutSecs: f.timeoutSecs.trim(),
    }),
    [],
  );

  const persistInstance = useCallback(
    async (f: FormState): Promise<string> => {
      const input = {
        integrationKey: INTEGRATION_KEY,
        name: f.name.trim() || EMPTY_FORM.name,
        host: f.vmrestHost.trim() || undefined,
        fields: nonSecretFields(f),
        secret: f.vmrestPassword ? f.vmrestPassword : undefined,
      };
      if (boundInstanceId) {
        await updateInstance(boundInstanceId, input);
        return boundInstanceId;
      }
      const created = await createInstance(input);
      setBoundInstanceId(created.id);
      return created.id;
    },
    [boundInstanceId, createInstance, updateInstance, nonSecretFields],
  );

  const handleConnect = useCallback(async () => {
    // Persist first so a failed connect still keeps the config; ignore persist
    // errors (e.g. locked vault) — connect can still proceed with the in-memory
    // form values.
    try {
      await persistInstance(form);
    } catch {
      // reference-only persistence already handled inside the store
    }
    await connect({
      vmrunPath: form.vmrunPath.trim() || null,
      vmrestHost: form.vmrestHost.trim() || null,
      vmrestPort: form.vmrestPort.trim()
        ? Number(form.vmrestPort.trim())
        : null,
      vmrestUsername: form.vmrestUsername.trim() || null,
      vmrestPassword: form.vmrestPassword || null,
      vmrestSkipTlsVerify: form.vmrestSkipTlsVerify,
      autoStartVmrest: form.autoStartVmrest,
      timeoutSecs: form.timeoutSecs.trim()
        ? Number(form.timeoutSecs.trim())
        : undefined,
    }).catch(() => {
      // error surfaced via the hook's `error` state
    });
  }, [connect, form, persistInstance]);

  const tabProps: VmwDesktopTabProps = useMemo(
    () => ({ connected, summary }),
    [connected, summary],
  );

  const ActiveTabComponent = useMemo(() => {
    const entry = vmwDesktopTabs.find((tabDesc) => tabDesc.categoryKey === activeTab);
    return entry ? React.lazy(entry.importTab) : null;
  }, [activeTab]);

  return (
    <div className="flex h-full flex-col bg-[var(--color-surface)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-3">
        <div className="flex items-center gap-2">
          <MonitorPlay className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-base font-semibold text-[var(--color-text)]">
              {t("integrations.vmwareDesktop.title", "VMware Workstation")}
            </h2>
            <p className="text-xs text-[var(--color-textSecondary)]">
              {t(
                "integrations.vmwareDesktop.subtitle",
                "Manage local VMware Workstation / Player VMs via vmrest",
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
              connected
                ? "bg-green-500/15 text-green-500"
                : "bg-[var(--color-border)] text-[var(--color-textSecondary)]"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                connected ? "bg-green-500" : "bg-[var(--color-textMuted)]"
              }`}
            />
            {connected
              ? t("integrations.vmwareDesktop.connected", "Connected")
              : t("integrations.vmwareDesktop.disconnected", "Disconnected")}
          </span>
          <button
            onClick={onClose}
            className="app-bar-button px-2 py-1 text-sm"
          >
            {t("integrations.vmwareDesktop.close", "Close")}
          </button>
        </div>
      </div>

      {/* Connect / config form */}
      <div className="border-b border-[var(--color-border)] px-6 py-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
            {t("integrations.vmwareDesktop.form.name", "Instance name")}
            <input
              type="text"
              value={form.name}
              onChange={(e) => setField("name", e.target.value)}
              className="rounded border border-[var(--color-border)] bg-[var(--color-inputBackground)] px-2 py-1 text-sm text-[var(--color-text)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
            {t("integrations.vmwareDesktop.form.host", "vmrest host")}
            <input
              type="text"
              value={form.vmrestHost}
              placeholder="127.0.0.1"
              onChange={(e) => setField("vmrestHost", e.target.value)}
              className="rounded border border-[var(--color-border)] bg-[var(--color-inputBackground)] px-2 py-1 text-sm text-[var(--color-text)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
            {t("integrations.vmwareDesktop.form.port", "vmrest port")}
            <input
              type="number"
              value={form.vmrestPort}
              placeholder="8697"
              onChange={(e) => setField("vmrestPort", e.target.value)}
              className="rounded border border-[var(--color-border)] bg-[var(--color-inputBackground)] px-2 py-1 text-sm text-[var(--color-text)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
            {t("integrations.vmwareDesktop.form.username", "Username")}
            <input
              type="text"
              autoComplete="off"
              value={form.vmrestUsername}
              onChange={(e) => setField("vmrestUsername", e.target.value)}
              className="rounded border border-[var(--color-border)] bg-[var(--color-inputBackground)] px-2 py-1 text-sm text-[var(--color-text)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
            {t("integrations.vmwareDesktop.form.password", "Password")}
            <input
              type="password"
              autoComplete="new-password"
              value={form.vmrestPassword}
              onChange={(e) => setField("vmrestPassword", e.target.value)}
              className="rounded border border-[var(--color-border)] bg-[var(--color-inputBackground)] px-2 py-1 text-sm text-[var(--color-text)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
            {t("integrations.vmwareDesktop.form.vmrunPath", "vmrun path (optional)")}
            <input
              type="text"
              value={form.vmrunPath}
              onChange={(e) => setField("vmrunPath", e.target.value)}
              className="rounded border border-[var(--color-border)] bg-[var(--color-inputBackground)] px-2 py-1 text-sm text-[var(--color-text)]"
            />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
            <input
              type="checkbox"
              checked={form.vmrestSkipTlsVerify}
              onChange={(e) =>
                setField("vmrestSkipTlsVerify", e.target.checked)
              }
            />
            <span className="inline-flex items-center gap-1">
              <ShieldAlert className="h-3.5 w-3.5" />
              {t(
                "integrations.vmwareDesktop.form.skipTlsVerify",
                "Skip TLS verification (vmrest HTTPS)",
              )}
            </span>
          </label>
          <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
            <input
              type="checkbox"
              checked={form.autoStartVmrest}
              onChange={(e) => setField("autoStartVmrest", e.target.checked)}
            />
            {t(
              "integrations.vmwareDesktop.form.autoStart",
              "Auto-start vmrest if not running",
            )}
          </label>
          <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
            {t("integrations.vmwareDesktop.form.timeout", "Timeout (s)")}
            <input
              type="number"
              value={form.timeoutSecs}
              onChange={(e) => setField("timeoutSecs", e.target.value)}
              className="w-20 rounded border border-[var(--color-border)] bg-[var(--color-inputBackground)] px-2 py-1 text-sm text-[var(--color-text)]"
            />
          </label>
        </div>

        <div className="mt-4 flex items-center gap-2">
          {connected ? (
            <button
              onClick={() => void disconnect()}
              className="app-bar-button inline-flex items-center gap-1 px-3 py-1.5 text-sm"
            >
              <PlugZap className="h-4 w-4" />
              {t("integrations.vmwareDesktop.disconnect", "Disconnect")}
            </button>
          ) : (
            <button
              onClick={() => void handleConnect()}
              disabled={isConnecting}
              className="app-bar-button inline-flex items-center gap-1 px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {isConnecting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plug className="h-4 w-4" />
              )}
              {t("integrations.vmwareDesktop.connect", "Connect")}
            </button>
          )}
          {summary?.productVersion && (
            <span className="text-xs text-[var(--color-textSecondary)]">
              {summary.product} {summary.productVersion} · {summary.vmCount}{" "}
              {t("integrations.vmwareDesktop.vms.countLabel", "VMs")}
            </span>
          )}
        </div>

        {error && (
          <p className="mt-2 text-xs text-red-500" role="alert">
            {error}
          </p>
        )}
      </div>

      {/* Sub-tab bar (registry-driven — category execs append their tabs) */}
      {vmwDesktopTabs.length > 0 && (
        <div className="flex items-center gap-1 border-b border-[var(--color-border)] px-4">
          {vmwDesktopTabs.map((tabDesc) => (
            <button
              key={tabDesc.categoryKey}
              onClick={() => setActiveTab(tabDesc.categoryKey)}
              className={`border-b-2 px-3 py-2 text-sm ${
                activeTab === tabDesc.categoryKey
                  ? "border-primary text-[var(--color-text)]"
                  : "border-transparent text-[var(--color-textSecondary)]"
              }`}
            >
              {t(tabDesc.labelKey, tabDesc.labelDefault)}
            </button>
          ))}
        </div>
      )}

      {/* Active tab body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {vmwDesktopTabs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-10 text-center">
            <MonitorPlay className="h-10 w-10 text-[var(--color-textMuted)]" />
            <p className="text-sm text-[var(--color-text)]">
              {connected
                ? t(
                    "integrations.vmwareDesktop.noTabs",
                    "Connected. Management views are being added.",
                  )
                : t(
                    "integrations.vmwareDesktop.notConnected",
                    "Connect to a VMware Workstation host to manage VMs.",
                  )}
            </p>
          </div>
        ) : (
          ActiveTabComponent && (
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              }
            >
              <ActiveTabComponent {...tabProps} />
            </Suspense>
          )
        )}
      </div>
    </div>
  );
};

export default VmwareDesktopPanel;

/** Registry descriptor — appended to `registry.infra.ts` by the Wave 1 integrator. */
export const vmwareDesktopDescriptor: IntegrationDescriptor = {
  key: INTEGRATION_KEY,
  label: "VMware Workstation",
  category: "infra",
  icon: MonitorPlay,
  importPanel: () => import("./VmwareDesktopPanel"),
};
