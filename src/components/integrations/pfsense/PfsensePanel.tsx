import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ExternalLink,
  Loader2,
  Plug,
  PlugZap,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";

import type {
  PfsenseConnectionConfig,
  PfsenseConnectionSummary,
} from "../../../types/pfsense";
import { getGlobalHttpProxyUrl } from "../../../hooks/integration/httpProxy";
import { useIntegrationConfigStore } from "../../../hooks/integrations/useIntegrationConfigStore";
import { useIntegrationConnectionLifecycle } from "../../../hooks/integrations/IntegrationSessionLifecycle";
import { useInsecureTlsAck } from "../../../hooks/security/useInsecureTlsAck";
import { InsecureTlsWarningModal } from "../../security/InsecureTlsWarningModal";
import { startPfsenseApiProxy, stopPfsenseApiProxy } from "./apiProxy";
import { pfsenseCategoryTabs } from "./registry";
import { launchPfsenseWebUi } from "./webUiLaunch";

const pfsenseConnectionApi = {
  connect: (id: string, config: PfsenseConnectionConfig) =>
    invoke<PfsenseConnectionSummary>("pfsense_connect", { id, config }),
  disconnect: (id: string) => invoke<void>("pfsense_disconnect", { id }),
};

interface LegacyPfsenseSecret {
  apiKey?: string;
  apiSecret?: string;
}

const DEFAULT_TIMEOUT_SECS = 30;
const INPUT_CLASS =
  "rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]";
const CHECKBOX_CLASS =
  "h-4 w-4 rounded border-[var(--color-border)] accent-[var(--color-primary)]";

interface PfsensePanelProps {
  isOpen: boolean;
  onClose: () => void;
  instanceId?: string;
}

const emptyForm = {
  name: "",
  host: "",
  apiEnabled: true,
  apiPort: "443",
  apiKey: "",
  apiSecret: "",
  apiUseTls: true,
  apiAcceptInvalidCerts: false,
  webEnabled: true,
  webPort: "443",
  webUsername: "",
  webPassword: "",
  webUseTls: true,
  webAcceptInvalidCerts: false,
  webAutoLogin: true,
};

type FormState = typeof emptyForm;
type PfsenseSecretField = "apiKey" | "apiSecret" | "webPassword";
type PfsenseSecretState =
  "untouched" | "absent" | "loaded" | "failed" | "legacy" | "edited";

const freshSecretStates = (): Record<
  PfsenseSecretField,
  PfsenseSecretState
> => ({
  apiKey: "untouched",
  apiSecret: "untouched",
  webPassword: "untouched",
});

function parsePort(value: string, fallback: number): number {
  const port = Number.parseInt(value, 10);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback;
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "password";
  placeholder?: string;
  numeric?: boolean;
  autoComplete?: string;
}

const Field: React.FC<FieldProps> = ({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  numeric,
  autoComplete,
}) => (
  <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
    {label}
    <input
      type={type}
      className={INPUT_CLASS}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      inputMode={numeric ? "numeric" : undefined}
      autoComplete={autoComplete}
    />
  </label>
);

const PfsensePanel: React.FC<PfsensePanelProps> = ({ isOpen, instanceId }) => {
  const { trackConnect, trackDisconnect } = useIntegrationConnectionLifecycle();
  const { t } = useTranslation();
  const {
    isLoading: storeLoading,
    instancesFor,
    createInstance,
    updateInstance,
    readSecretState,
    readNamedSecretState,
    clearPrimarySecret,
  } = useIntegrationConfigStore();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [persistedInstanceId, setPersistedInstanceId] = useState<string | null>(
    instanceId ?? null,
  );
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [summary, setSummary] = useState<PfsenseConnectionSummary | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [launchingWeb, setLaunchingWeb] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secretStates, setSecretStates] = useState(freshSecretStates);
  const [legacyPrimaryMigration, setLegacyPrimaryMigration] = useState(false);
  const [tlsPromptOpen, setTlsPromptOpen] = useState(false);
  const apiProxySessionIdRef = useRef("");
  const [activeTab, setActiveTab] = useState<string | null>(
    pfsenseCategoryTabs[0]?.categoryKey ?? null,
  );

  const effectiveApiTlsSkip =
    form.apiEnabled && form.apiUseTls && form.apiAcceptInvalidCerts;
  const {
    needsAck: needsTlsAck,
    acknowledge: acknowledgeTls,
    reset: resetTlsAck,
  } = useInsecureTlsAck({
    configId:
      persistedInstanceId ??
      `pfsense-api:${form.host.trim()}:${form.apiPort.trim()}`,
    insecure: effectiveApiTlsSkip,
  });

  useEffect(() => setPersistedInstanceId(instanceId ?? null), [instanceId]);

  // Read named secrets first. The old primary vault blob remains a read-only
  // migration fallback and is replaced with named entries on the next save.
  useEffect(() => {
    if (!instanceId || storeLoading) return;
    const instance = instancesFor("pfsense").find(
      (item) => item.id === instanceId,
    );
    if (!instance) return;
    let cancelled = false;
    setSecretStates(freshSecretStates());
    setLegacyPrimaryMigration(false);
    void (async () => {
      const [
        namedApiKey,
        namedApiSecret,
        namedWebPassword,
        genericPassword,
        legacyRaw,
      ] = await Promise.all([
        readNamedSecretState(instance, "apiKey"),
        readNamedSecretState(instance, "apiSecret"),
        readNamedSecretState(instance, "webPassword"),
        readNamedSecretState(instance, "password"),
        readSecretState(instance),
      ]);
      let legacy: LegacyPfsenseSecret = {};
      if (legacyRaw.status === "loaded" && legacyRaw.value) {
        try {
          legacy = JSON.parse(legacyRaw.value) as LegacyPfsenseSecret;
        } catch {
          legacy = { apiSecret: legacyRaw.value };
        }
      }
      if (cancelled) return;

      const resolveApiSecret = (
        named: typeof namedApiKey,
        legacyValue: string | undefined,
      ): { value: string; state: PfsenseSecretState } => {
        if (named.status === "loaded") {
          return { value: named.value, state: "loaded" };
        }
        if (named.status === "failed") return { value: "", state: "failed" };
        if (legacyValue) return { value: legacyValue, state: "legacy" };
        if (legacyRaw.status === "failed") {
          return { value: "", state: "failed" };
        }
        return { value: "", state: "absent" };
      };
      const resolvedApiKey = resolveApiSecret(namedApiKey, legacy.apiKey);
      const resolvedApiSecret = resolveApiSecret(
        namedApiSecret,
        legacy.apiSecret,
      );
      const resolvedWebPassword =
        namedWebPassword.status === "loaded"
          ? { value: namedWebPassword.value, state: "loaded" as const }
          : namedWebPassword.status === "failed"
            ? { value: "", state: "failed" as const }
            : genericPassword.status === "loaded"
              ? { value: genericPassword.value, state: "loaded" as const }
              : genericPassword.status === "failed"
                ? { value: "", state: "failed" as const }
                : { value: "", state: "absent" as const };

      setSecretStates({
        apiKey: resolvedApiKey.state,
        apiSecret: resolvedApiSecret.state,
        webPassword: resolvedWebPassword.state,
      });
      const canRetireLegacyPrimary =
        legacyRaw.status === "loaded" &&
        Boolean(legacyRaw.value) &&
        (!legacy.apiKey || namedApiKey.status !== "failed") &&
        (!legacy.apiSecret || namedApiSecret.status !== "failed");
      setLegacyPrimaryMigration(canRetireLegacyPrimary);
      if (
        namedApiKey.status === "failed" ||
        namedApiSecret.status === "failed" ||
        namedWebPassword.status === "failed" ||
        genericPassword.status === "failed" ||
        legacyRaw.status === "failed"
      ) {
        setError(
          "Some saved credentials could not be read from the vault. They will be preserved unless you explicitly replace or clear them.",
        );
      }
      const fields = instance.fields ?? {};
      const legacyPort = fields.port ?? "443";
      const legacyTls = fields.useTls !== "false";
      const legacyInvalidCerts = fields.acceptInvalidCerts === "true";
      setForm({
        name: instance.name,
        host: instance.host ?? "",
        apiEnabled: fields.apiEnabled !== "false",
        apiPort: fields.apiPort ?? legacyPort,
        apiKey: resolvedApiKey.value,
        apiSecret: resolvedApiSecret.value,
        apiUseTls:
          fields.apiUseTls === undefined
            ? legacyTls
            : fields.apiUseTls !== "false",
        apiAcceptInvalidCerts:
          fields.apiAcceptInvalidCerts === undefined
            ? legacyInvalidCerts
            : fields.apiAcceptInvalidCerts === "true",
        webEnabled: fields.webEnabled !== "false",
        webPort: fields.webPort ?? legacyPort,
        webUsername: fields.webUsername ?? fields.username ?? "",
        webPassword: resolvedWebPassword.value,
        webUseTls:
          fields.webUseTls === undefined
            ? legacyTls
            : fields.webUseTls !== "false",
        webAcceptInvalidCerts:
          fields.webAcceptInvalidCerts === undefined
            ? legacyInvalidCerts
            : fields.webAcceptInvalidCerts === "true",
        webAutoLogin: fields.webAutoLogin !== "false",
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [
    instanceId,
    instancesFor,
    readNamedSecretState,
    readSecretState,
    storeLoading,
  ]);

  const setField = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) => {
      setForm((previous) => ({ ...previous, [key]: value }));
    },
    [],
  );

  const setSecretField = useCallback(
    (key: PfsenseSecretField, value: string) => {
      setForm((previous) => ({ ...previous, [key]: value }));
      setSecretStates((previous) => ({ ...previous, [key]: "edited" }));
    },
    [],
  );

  const buildApiConfig = useCallback(
    (internalProxyUrl: string): PfsenseConnectionConfig => ({
      host: form.host.trim(),
      port: parsePort(form.apiPort, form.apiUseTls ? 443 : 80),
      useTls: form.apiUseTls,
      acceptInvalidCerts: form.apiAcceptInvalidCerts,
      timeoutSecs: DEFAULT_TIMEOUT_SECS,
      internalProxyUrl,
    }),
    [form],
  );

  const persistForm = useCallback(async (): Promise<string> => {
    const host = form.host.trim();
    if (!host) throw new Error("pfSense host is required");
    if (!form.apiEnabled && !form.webEnabled) {
      throw new Error("Enable API management, WebGUI access, or both");
    }
    const apiPort = parsePort(form.apiPort, form.apiUseTls ? 443 : 80);
    const fields = {
      apiEnabled: String(form.apiEnabled),
      apiPort: String(apiPort),
      apiUseTls: String(form.apiUseTls),
      apiAcceptInvalidCerts: String(form.apiAcceptInvalidCerts),
      webEnabled: String(form.webEnabled),
      webPort: String(parsePort(form.webPort, form.webUseTls ? 443 : 80)),
      webUsername: form.webUsername.trim(),
      webUseTls: String(form.webUseTls),
      webAcceptInvalidCerts: String(form.webAcceptInvalidCerts),
      webAutoLogin: String(form.webAutoLogin),
      timeoutSecs: String(DEFAULT_TIMEOUT_SECS),
      // Legacy aliases keep existing editor/import readers lossless.
      port: String(apiPort),
      useTls: String(form.apiUseTls),
      acceptInvalidCerts: String(form.apiAcceptInvalidCerts),
      tlsVerify: String(!form.apiAcceptInvalidCerts),
    };
    const secrets: Partial<Record<PfsenseSecretField, string | undefined>> = {};
    for (const key of ["apiKey", "apiSecret", "webPassword"] as const) {
      if (secretStates[key] === "edited" || secretStates[key] === "legacy") {
        secrets[key] = form[key] || undefined;
      }
    }
    const input = {
      integrationKey: "pfsense",
      name: form.name.trim() || host,
      host,
      fields,
      ...(Object.keys(secrets).length > 0 ? { secrets } : {}),
    };

    let id = persistedInstanceId;
    if (id) {
      await updateInstance(id, input);
    } else {
      const created = await createInstance(input);
      id = created.id;
      setPersistedInstanceId(id);
    }
    if (!id) throw new Error("Unable to allocate a pfSense instance");
    setSecretStates((previous) => {
      const next = { ...previous };
      for (const key of Object.keys(secrets) as PfsenseSecretField[]) {
        next[key] = form[key] ? "loaded" : "absent";
      }
      return next;
    });
    if (legacyPrimaryMigration) {
      await clearPrimarySecret(id);
      setLegacyPrimaryMigration(false);
    }
    return id;
  }, [
    clearPrimarySecret,
    createInstance,
    form,
    legacyPrimaryMigration,
    persistedInstanceId,
    secretStates,
    updateInstance,
  ]);

  const stopCurrentApiProxy = useCallback(async () => {
    const sessionId = apiProxySessionIdRef.current;
    apiProxySessionIdRef.current = "";
    if (sessionId) {
      await stopPfsenseApiProxy(sessionId).catch(() => undefined);
    }
  }, []);

  const disconnectById = useCallback(
    async (id: string) => {
      try {
        await pfsenseConnectionApi.disconnect(id);
      } finally {
        await stopCurrentApiProxy();
        setConnectionId(null);
        setSummary(null);
      }
    },
    [stopCurrentApiProxy],
  );

  const connectOnce = useCallback(
    async (acknowledged: boolean) => {
      setConnecting(true);
      setError(null);
      try {
        if (!form.apiEnabled) throw new Error("Enable API management first");
        if (!form.apiKey || !form.apiSecret) {
          throw new Error("pfSense API key and API secret are required");
        }
        const id = await persistForm();
        let acknowledgementAvailable = effectiveApiTlsSkip && acknowledged;
        await trackConnect(
          `pfsense:${id}`,
          async () => {
            setConnecting(true);
            setError(null);
            await stopCurrentApiProxy();
            let proxySessionId = "";
            try {
              const proxy = await startPfsenseApiProxy({
                host: form.host,
                port: parsePort(form.apiPort, form.apiUseTls ? 443 : 80),
                useTls: form.apiUseTls,
                acceptInvalidCerts: form.apiAcceptInvalidCerts,
                apiKey: form.apiKey,
                apiSecret: form.apiSecret,
                connectionId: `pfsense-api:${id}`,
                upstreamProxyUrl: getGlobalHttpProxyUrl(),
              });
              proxySessionId = proxy.session_id;
              apiProxySessionIdRef.current = proxySessionId;
              const result = await pfsenseConnectionApi.connect(id, {
                ...buildApiConfig(proxy.protectedProxyUrl),
                acknowledgeInvalidCertRisk: acknowledgementAvailable,
              });
              acknowledgementAvailable = false;
              setConnectionId(id);
              setSummary(result);
              setActiveTab(pfsenseCategoryTabs[0]?.categoryKey ?? null);
              return result;
            } catch (connectError) {
              if (proxySessionId) {
                await stopPfsenseApiProxy(proxySessionId).catch(
                  () => undefined,
                );
              }
              apiProxySessionIdRef.current = "";
              setConnectionId(null);
              setSummary(null);
              throw connectError;
            } finally {
              setConnecting(false);
            }
          },
          () => disconnectById(id),
        );
      } catch (connectError) {
        setError(
          typeof connectError === "string"
            ? connectError
            : (connectError as Error).message,
        );
        setConnecting(false);
      } finally {
        resetTlsAck();
      }
    },
    [
      buildApiConfig,
      disconnectById,
      effectiveApiTlsSkip,
      form,
      persistForm,
      resetTlsAck,
      stopCurrentApiProxy,
      trackConnect,
    ],
  );

  const handleConnect = useCallback(() => {
    if (needsTlsAck) {
      setTlsPromptOpen(true);
    } else {
      void connectOnce(false);
    }
  }, [connectOnce, needsTlsAck]);

  const handleDisconnect = useCallback(async () => {
    if (!connectionId) return;
    try {
      await trackDisconnect(`pfsense:${connectionId}`, () =>
        disconnectById(connectionId),
      );
    } catch {
      // Backend/proxy teardown is best effort and disconnectById clears UI state.
    }
  }, [connectionId, disconnectById, trackDisconnect]);

  const handleOpenWebUi = useCallback(async () => {
    setLaunchingWeb(true);
    setError(null);
    try {
      if (!form.webEnabled) throw new Error("Enable WebGUI access first");
      if (
        form.webAutoLogin &&
        (!form.webUsername.trim() || !form.webPassword)
      ) {
        throw new Error(
          "Automated WebGUI login requires a username and password",
        );
      }
      const id = await persistForm();
      launchPfsenseWebUi({
        host: form.host,
        port: parsePort(form.webPort, form.webUseTls ? 443 : 80),
        useTls: form.webUseTls,
        username: form.webUsername,
        password: form.webPassword,
        autoLogin: form.webAutoLogin,
        acceptInvalidCerts: form.webAcceptInvalidCerts,
        name: form.name,
        id: `pfsense-webui-${id}-${Date.now().toString(36)}`,
      });
    } catch (webError) {
      setError(
        typeof webError === "string" ? webError : (webError as Error).message,
      );
    } finally {
      setLaunchingWeb(false);
    }
  }, [form, persistForm]);

  const ActiveTab = useMemo(() => {
    if (!connectionId || !activeTab) return null;
    const tab = pfsenseCategoryTabs.find(
      (item) => item.categoryKey === activeTab,
    );
    return tab ? React.lazy(tab.importTab) : null;
  }, [activeTab, connectionId]);

  if (!isOpen) return null;

  const connected = Boolean(connectionId);
  const apiReady = Boolean(form.host.trim() && form.apiKey && form.apiSecret);
  const webReady =
    !form.webAutoLogin || Boolean(form.webUsername.trim() && form.webPassword);

  return (
    <div className="flex h-full flex-col bg-[var(--color-surface)]">
      <InsecureTlsWarningModal
        key={tlsPromptOpen ? "open" : "closed"}
        isOpen={tlsPromptOpen}
        kind="integration"
        endpoint={`${form.apiUseTls ? "https" : "http"}://${form.host.trim() || "pfSense endpoint"}:${form.apiPort.trim() || (form.apiUseTls ? "443" : "80")}`}
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
        <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--color-text)]">
          <ShieldCheck className="h-5 w-5 text-primary" />
          {t("integrations.pfsense.title", "pfSense")}
          {summary && (
            <span className="text-xs font-normal text-[var(--color-textSecondary)]">
              {summary.hostname} · {summary.version}
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          {form.webEnabled && connected && (
            <button
              type="button"
              onClick={() => void handleOpenWebUi()}
              disabled={launchingWeb || !webReady}
              className="app-bar-button flex items-center gap-1 px-2 py-1 text-xs disabled:opacity-50"
            >
              {launchingWeb ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <ExternalLink size={14} />
              )}
              Open WebGUI
            </button>
          )}
          {connected && (
            <button
              type="button"
              onClick={handleDisconnect}
              className="app-bar-button flex items-center gap-1 px-2 py-1 text-xs"
            >
              <PlugZap size={14} />
              Disconnect API
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="border-b border-[var(--color-border)] bg-[var(--color-dangerBg,#3a1a1a)] px-4 py-2 text-xs text-[var(--color-danger,#f87171)]">
          {error}
        </div>
      )}

      {!connected ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="mx-auto flex max-w-2xl flex-col gap-4">
            <p className="text-xs text-[var(--color-textSecondary)]">
              Use the REST API, the browser WebGUI, or both. Each path is routed
              through the app&apos;s protected internal proxy.
            </p>
            <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
              <Field
                label="Name"
                value={form.name}
                onChange={(value) => setField("name", value)}
                placeholder="fw-edge"
              />
              <Field
                label="Host"
                value={form.host}
                onChange={(value) => setField("host", value)}
                placeholder="192.168.1.1"
              />
            </div>

            <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-4">
              <label className="flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
                <input
                  aria-label="Use REST API management"
                  className={CHECKBOX_CLASS}
                  type="checkbox"
                  checked={form.apiEnabled}
                  onChange={(event) =>
                    setField("apiEnabled", event.target.checked)
                  }
                />
                Use REST API management
              </label>
              {form.apiEnabled && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field
                    label="API port"
                    value={form.apiPort}
                    onChange={(value) => setField("apiPort", value)}
                    numeric
                  />
                  <label className="flex items-center gap-2 self-end pb-1 text-xs text-[var(--color-textSecondary)]">
                    <input
                      className={CHECKBOX_CLASS}
                      type="checkbox"
                      checked={form.apiUseTls}
                      onChange={(event) =>
                        setField("apiUseTls", event.target.checked)
                      }
                    />
                    Use HTTPS for API
                  </label>
                  <Field
                    label="API key"
                    value={form.apiKey}
                    onChange={(value) => setSecretField("apiKey", value)}
                    type="password"
                    autoComplete="off"
                  />
                  <Field
                    label="API secret"
                    value={form.apiSecret}
                    onChange={(value) => setSecretField("apiSecret", value)}
                    type="password"
                    autoComplete="off"
                  />
                  <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)] sm:col-span-2">
                    <input
                      className={CHECKBOX_CLASS}
                      type="checkbox"
                      checked={form.apiAcceptInvalidCerts}
                      disabled={!form.apiUseTls}
                      onChange={(event) =>
                        setField("apiAcceptInvalidCerts", event.target.checked)
                      }
                    />
                    Accept a self-signed API certificate for this connection
                  </label>
                </div>
              )}
            </section>

            <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-4">
              <label className="flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
                <input
                  aria-label="Use browser WebGUI"
                  className={CHECKBOX_CLASS}
                  type="checkbox"
                  checked={form.webEnabled}
                  onChange={(event) =>
                    setField("webEnabled", event.target.checked)
                  }
                />
                Use browser WebGUI
              </label>
              {form.webEnabled && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field
                    label="WebGUI port"
                    value={form.webPort}
                    onChange={(value) => setField("webPort", value)}
                    numeric
                  />
                  <label className="flex items-center gap-2 self-end pb-1 text-xs text-[var(--color-textSecondary)]">
                    <input
                      className={CHECKBOX_CLASS}
                      type="checkbox"
                      checked={form.webUseTls}
                      onChange={(event) =>
                        setField("webUseTls", event.target.checked)
                      }
                    />
                    Use HTTPS for WebGUI
                  </label>
                  <Field
                    label="WebGUI username"
                    value={form.webUsername}
                    onChange={(value) => setField("webUsername", value)}
                    autoComplete="username"
                  />
                  <Field
                    label="WebGUI password"
                    value={form.webPassword}
                    onChange={(value) => setSecretField("webPassword", value)}
                    type="password"
                    autoComplete="current-password"
                  />
                  <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
                    <input
                      className={CHECKBOX_CLASS}
                      type="checkbox"
                      checked={form.webAutoLogin}
                      onChange={(event) =>
                        setField("webAutoLogin", event.target.checked)
                      }
                    />
                    Automatically submit the pfSense login form
                  </label>
                  <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
                    <input
                      className={CHECKBOX_CLASS}
                      type="checkbox"
                      checked={form.webAcceptInvalidCerts}
                      disabled={!form.webUseTls}
                      onChange={(event) =>
                        setField("webAcceptInvalidCerts", event.target.checked)
                      }
                    />
                    Accept a self-signed WebGUI certificate
                  </label>
                </div>
              )}
            </section>

            <div className="flex flex-wrap justify-end gap-2">
              {form.webEnabled && (
                <button
                  type="button"
                  onClick={() => void handleOpenWebUi()}
                  disabled={launchingWeb || !form.host.trim() || !webReady}
                  className="flex items-center justify-center gap-2 rounded border border-primary px-3 py-2 text-sm font-medium text-primary disabled:opacity-50"
                >
                  {launchingWeb ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <ExternalLink size={16} />
                  )}
                  Open WebGUI
                </button>
              )}
              {form.apiEnabled && (
                <button
                  type="button"
                  onClick={handleConnect}
                  disabled={connecting || !apiReady}
                  className="flex items-center justify-center gap-2 rounded bg-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {connecting ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Plug size={16} />
                  )}
                  Connect API
                </button>
              )}
            </div>
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
                    type="button"
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
                API connected. Management sections load here once registered.
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
