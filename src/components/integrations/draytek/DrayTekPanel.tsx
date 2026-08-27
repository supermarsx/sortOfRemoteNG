// DrayTekPanel — the DrayTek Vigor integration panel SHELL (t68 D3/D4).
// Mirrors `PfsensePanel.tsx` 1:1: owns the connect/config form (host/port/
// username/password/TLS), the insecure-TLS runtime acknowledgement, the
// integration connection lifecycle, the OS-vault secret slot, and a
// registry-driven sub-tab bar (Status / Actions from `./registry.ts`).
//
// Vendor-generic by design (`vendor: "draytek"` today) so UniFi / MikroTik can
// slot in behind the same shell later.

import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Router, Loader2, Plug, PlugZap, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import type {
  DraytekConnectionConfig,
  DraytekConnectionSummary,
} from "../../../types/draytek";
import { withGlobalHttpProxy } from "../../../hooks/integration/httpProxy";
import { draytekApi } from "../../../hooks/integration/draytek/useDraytek";
import { useIntegrationConfigStore } from "../../../hooks/integrations/useIntegrationConfigStore";
import { useIntegrationConnectionLifecycle } from "../../../hooks/integrations/IntegrationSessionLifecycle";
import { useInsecureTlsAck } from "../../../hooks/security/useInsecureTlsAck";
import { InsecureTlsWarningModal } from "../../security/InsecureTlsWarningModal";
import { draytekCategoryTabs, type DraytekDeviceContext } from "./registry";

/** The secret blob stored in the OS vault packs both login credentials (the
 *  store has one secret slot per instance) — D4. */
interface DraytekSecret {
  username: string;
  password: string;
}

const DEFAULT_TIMEOUT_SECS = 30;
const DEFAULT_VENDOR = "draytek";
const INTEGRATION_KEY = "draytek";

interface DrayTekPanelProps {
  isOpen: boolean;
  onClose: () => void;
  instanceId?: string;
}

const emptyForm = {
  name: "",
  host: "",
  port: "443",
  username: "admin",
  password: "",
  useTls: true,
  acceptInvalidCerts: false,
};

type FormState = typeof emptyForm;

const inputClass =
  "rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]";
const labelClass =
  "flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]";

const DrayTekPanel: React.FC<DrayTekPanelProps> = ({ isOpen, instanceId }) => {
  const { trackConnect, trackDisconnect } = useIntegrationConnectionLifecycle();
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
  const [summary, setSummary] = useState<DraytekConnectionSummary | null>(null);
  const [device, setDevice] = useState<DraytekDeviceContext | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tlsPromptOpen, setTlsPromptOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string | null>(
    draytekCategoryTabs[0]?.categoryKey ?? null,
  );
  const effectiveTlsSkip = form.useTls && form.acceptInvalidCerts;
  const {
    needsAck: needsTlsAck,
    acknowledge: acknowledgeTls,
    reset: resetTlsAck,
  } = useInsecureTlsAck({
    configId:
      instanceId ??
      `${INTEGRATION_KEY}:${form.host.trim()}:${form.port.trim()}`,
    insecure: effectiveTlsSkip,
  });

  // Prefill the form from a persisted instance when opened against one.
  useEffect(() => {
    if (!instanceId || storeLoading) return;
    const instance = instancesFor(INTEGRATION_KEY).find(
      (i) => i.id === instanceId,
    );
    if (!instance) return;
    let cancelled = false;
    (async () => {
      const secretRaw = await readSecret(instance);
      let secret: DraytekSecret = { username: "", password: "" };
      if (secretRaw) {
        try {
          secret = JSON.parse(secretRaw) as DraytekSecret;
        } catch {
          // Legacy / opaque secret — treat the whole string as the password.
          secret = { username: "", password: secretRaw };
        }
      }
      if (cancelled) return;
      const fields = instance.fields ?? {};
      setForm({
        name: instance.name,
        host: instance.host ?? "",
        port: fields.port ?? "443",
        username: secret.username || fields.username || "admin",
        password: secret.password,
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

  const buildConfig = useCallback((): DraytekConnectionConfig => {
    const port = Number.parseInt(form.port, 10);
    return {
      host: form.host.trim(),
      port: Number.isFinite(port) ? port : form.useTls ? 443 : 80,
      username: form.username,
      password: form.password,
      use_tls: form.useTls,
      accept_invalid_certs: form.acceptInvalidCerts,
      timeout_secs: DEFAULT_TIMEOUT_SECS,
      vendor: DEFAULT_VENDOR,
    };
  }, [form]);

  const disconnectById = useCallback(async (id: string): Promise<void> => {
    try {
      await draytekApi.disconnect(id);
    } finally {
      setConnectionId(null);
      setSummary(null);
      setDevice(null);
    }
  }, []);

  const connectOnce = useCallback(
    async (acknowledged: boolean) => {
      setConnecting(true);
      setError(null);
      try {
        const config = buildConfig();
        let acknowledgementAvailable = effectiveTlsSkip && acknowledged;
        const secret = JSON.stringify({
          username: form.username,
          password: form.password,
        } satisfies DraytekSecret);
        const fields = {
          port: String(config.port),
          useTls: String(config.use_tls),
          acceptInvalidCerts: String(config.accept_invalid_certs),
          vendor: config.vendor,
        };
        const name = form.name.trim() || form.host.trim() || "DrayTek";

        // Persist host + creds (encrypted) and use the instance id as the stable
        // connection id, so reconnecting a saved instance reuses its id.
        let id = instanceId ?? null;
        if (id) {
          await updateInstance(id, {
            integrationKey: INTEGRATION_KEY,
            name,
            host: config.host,
            fields,
            secret,
          });
        } else {
          const created = await createInstance({
            integrationKey: INTEGRATION_KEY,
            name,
            host: config.host,
            fields,
            secret,
          });
          id = created.id;
        }

        if (!id) throw new Error("Unable to allocate a DrayTek instance");
        await trackConnect(
          `${INTEGRATION_KEY}:${id}`,
          async () => {
            setConnecting(true);
            setError(null);
            try {
              const attemptConfig: DraytekConnectionConfig = {
                ...config,
                acknowledge_invalid_cert_risk: acknowledgementAvailable,
              };
              acknowledgementAvailable = false;
              const result = await draytekApi.connect(
                id,
                withGlobalHttpProxy(attemptConfig, "snake"),
              );
              setConnectionId(id);
              setSummary(result);
              setDevice({
                host: config.host,
                port: config.port,
                useTls: config.use_tls,
                username: config.username,
                password: config.password,
                vendor: config.vendor,
              });
              setActiveTab(draytekCategoryTabs[0]?.categoryKey ?? null);
              return result;
            } catch (e) {
              const msg = typeof e === "string" ? e : (e as Error).message;
              setError(msg);
              setConnectionId(null);
              setSummary(null);
              setDevice(null);
              throw e;
            } finally {
              setConnecting(false);
            }
          },
          () => disconnectById(id),
        );
      } catch (e) {
        const msg = typeof e === "string" ? e : (e as Error).message;
        setError(msg);
        setConnecting(false);
      } finally {
        resetTlsAck();
      }
    },
    [
      buildConfig,
      createInstance,
      disconnectById,
      effectiveTlsSkip,
      form,
      instanceId,
      resetTlsAck,
      trackConnect,
      updateInstance,
    ],
  );

  const handleConnect = useCallback(() => {
    if (needsTlsAck) {
      setTlsPromptOpen(true);
      return;
    }
    void connectOnce(false);
  }, [connectOnce, needsTlsAck]);

  const handleDisconnect = useCallback(async () => {
    if (!connectionId) return;
    try {
      await trackDisconnect(`${INTEGRATION_KEY}:${connectionId}`, () =>
        disconnectById(connectionId),
      );
    } catch {
      // Best-effort: drop local state even if the backend session is already gone.
    }
  }, [connectionId, disconnectById, trackDisconnect]);

  const ActiveTab = useMemo(() => {
    if (!connectionId || !activeTab) return null;
    const tab = draytekCategoryTabs.find((tt) => tt.categoryKey === activeTab);
    if (!tab) return null;
    return React.lazy(tab.importTab);
  }, [connectionId, activeTab]);

  if (!isOpen) return null;

  const connected = Boolean(connectionId);
  const summaryLine = summary
    ? [summary.hostname, summary.model, summary.firmware]
        .filter((part): part is string => Boolean(part))
        .join(" · ")
    : "";

  return (
    <div
      className="flex h-full flex-col bg-[var(--color-surface)]"
      data-testid="draytek-panel"
    >
      <InsecureTlsWarningModal
        key={tlsPromptOpen ? "open" : "closed"}
        isOpen={tlsPromptOpen}
        kind="integration"
        endpoint={`${form.useTls ? "https" : "http"}://${form.host.trim() || "DrayTek router"}:${form.port.trim() || (form.useTls ? "443" : "80")}`}
        connectionName={form.name.trim() || undefined}
        onAcknowledge={() => {
          acknowledgeTls();
          setTlsPromptOpen(false);
          void connectOnce(true);
        }}
        onCancel={() => {
          setTlsPromptOpen(false);
          resetTlsAck();
        }}
      />
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
        <h2
          className="flex items-center gap-2 text-base font-semibold text-[var(--color-text)]"
          data-testid="draytek-panel-title"
        >
          <Router className="h-5 w-5 text-primary" />
          {t("integrations.draytek.title", "DrayTek Vigor")}
          {summaryLine && (
            <span
              className="text-xs font-normal text-[var(--color-textSecondary)]"
              data-testid="draytek-summary"
            >
              {summaryLine}
            </span>
          )}
        </h2>
        {connected && (
          <button
            onClick={handleDisconnect}
            data-testid="draytek-disconnect"
            className="app-bar-button flex items-center gap-1 px-2 py-1 text-xs"
            title={t("integrations.draytek.disconnect", "Disconnect")}
          >
            <PlugZap size={14} />
            {t("integrations.draytek.disconnect", "Disconnect")}
          </button>
        )}
      </div>

      {error && (
        <div
          className="border-b border-[var(--color-border)] bg-[var(--color-dangerBg,#3a1a1a)] px-4 py-2 text-xs text-[var(--color-danger,#f87171)]"
          data-testid="draytek-error"
        >
          {error}
        </div>
      )}

      {!connected ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="mx-auto flex max-w-md flex-col gap-3">
            <p className="text-xs text-[var(--color-textSecondary)]">
              {t(
                "integrations.draytek.connectHint",
                "Log in to a DrayTek Vigor router or VigorAP through its DrayOS web admin.",
              )}
            </p>

            <label className={labelClass}>
              {t("integrations.draytek.fields.name", "Name")}
              <input
                className={inputClass}
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
                placeholder="vigor-office"
                data-testid="draytek-name"
              />
            </label>

            <div className="flex gap-2">
              <label className={`${labelClass} flex-1`}>
                {t("integrations.draytek.fields.host", "Host")}
                <input
                  className={inputClass}
                  value={form.host}
                  onChange={(e) => setField("host", e.target.value)}
                  placeholder="192.168.1.1"
                  data-testid="draytek-host"
                />
              </label>
              <label className={`${labelClass} w-24`}>
                {t("integrations.draytek.fields.port", "Port")}
                <input
                  className={inputClass}
                  value={form.port}
                  onChange={(e) => setField("port", e.target.value)}
                  inputMode="numeric"
                  data-testid="draytek-port"
                />
              </label>
            </div>

            <label className={labelClass}>
              {t("integrations.draytek.fields.username", "Username")}
              <input
                className={inputClass}
                value={form.username}
                onChange={(e) => setField("username", e.target.value)}
                autoComplete="off"
                data-testid="draytek-username"
              />
            </label>

            <label className={labelClass}>
              {t("integrations.draytek.fields.password", "Password")}
              <input
                type="password"
                className={inputClass}
                value={form.password}
                onChange={(e) => setField("password", e.target.value)}
                autoComplete="off"
                data-testid="draytek-password"
              />
            </label>

            <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
              <input
                type="checkbox"
                checked={form.useTls}
                onChange={(e) => setField("useTls", e.target.checked)}
                data-testid="draytek-use-tls"
              />
              {t("integrations.draytek.fields.useTls", "Use TLS (HTTPS)")}
            </label>

            <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
              <input
                type="checkbox"
                checked={form.acceptInvalidCerts}
                onChange={(e) =>
                  setField("acceptInvalidCerts", e.target.checked)
                }
                data-testid="draytek-accept-invalid-certs"
              />
              {t(
                "integrations.draytek.fields.acceptInvalidCerts",
                "Accept self-signed certificates",
              )}
            </label>

            <button
              onClick={handleConnect}
              data-testid="draytek-connect"
              disabled={connecting || !form.host.trim()}
              className="mt-2 flex items-center justify-center gap-2 rounded bg-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {connecting ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Plug size={16} />
              )}
              {t("integrations.draytek.connect", "Connect")}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {draytekCategoryTabs.length > 0 ? (
            <>
              <div className="flex gap-1 border-b border-[var(--color-border)] px-2">
                {draytekCategoryTabs.map((tab) => (
                  <button
                    key={tab.categoryKey}
                    onClick={() => setActiveTab(tab.categoryKey)}
                    data-testid={`draytek-tab-${tab.categoryKey}`}
                    className={`px-3 py-2 text-sm ${
                      activeTab === tab.categoryKey
                        ? "border-b-2 border-primary text-[var(--color-text)]"
                        : "text-[var(--color-textSecondary)]"
                    }`}
                  >
                    {t(
                      `integrations.draytek.tabs.${tab.categoryKey}`,
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
                  {ActiveTab && connectionId && device && (
                    <ActiveTab connectionId={connectionId} device={device} />
                  )}
                </Suspense>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center text-[var(--color-textSecondary)]">
              <RefreshCw className="h-8 w-8 opacity-50" />
              <p className="text-sm">
                {t(
                  "integrations.draytek.noTabs",
                  "Connected. Management sections load here once registered.",
                )}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DrayTekPanel;
