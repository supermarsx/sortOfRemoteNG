// Portainer integration panel (t64-e4).
//
// Binds the 14 `portainer_*` commands through `usePortainer()`. Connect form
// (base URL, password / API-key auth modes, "Accept self-signed certificate"
// with the shared insecure-TLS acknowledgement flow, timeout), saved-instance
// load/save via `useIntegrationConfigStore` (secrets → OS vault, never in
// `fields`), status bar, tabs Environments / Containers / Stacks, and the
// "Open web UI (auto-login)" action (see `webUiLaunch.ts`).

import React, { useCallback, useEffect, useState } from "react";
import {
  Boxes,
  Container,
  ExternalLink,
  Layers,
  Loader2,
  Plug,
  Server,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  usePortainer,
  type PortainerManager,
} from "../../../hooks/integration/usePortainer";
import { useIntegrationConfigStore } from "../../../hooks/integrations/useIntegrationConfigStore";
import { useInsecureTlsAck } from "../../../hooks/security/useInsecureTlsAck";
import { generateId } from "../../../utils/core/id";
import type { IntegrationPanelProps } from "../../../types/integrations/registry";
import type { PortainerAuthMode } from "../../../types/portainer";
import { InsecureTlsWarningModal } from "../../security/InsecureTlsWarningModal";
import { btn, card, field, Labeled } from "./shared";
import { PortainerEndpointsTab } from "./PortainerEndpointsTab";
import { PortainerContainersTab } from "./PortainerContainersTab";
import { PortainerStacksTab } from "./PortainerStacksTab";
import { launchPortainerWebUi } from "./webUiLaunch";

type TabKey = "endpoints" | "containers" | "stacks";

// ─── Connect form state ──────────────────────────────────────────────────────

export interface PortainerFormState {
  name: string;
  baseUrl: string;
  authMode: PortainerAuthMode;
  username: string;
  password: string;
  apiKey: string;
  skipTlsVerify: boolean;
  timeoutSecs: string;
}

export const emptyPortainerForm: PortainerFormState = {
  name: "",
  baseUrl: "",
  authMode: "password",
  username: "",
  password: "",
  apiKey: "",
  skipTlsVerify: false,
  timeoutSecs: "",
};

const isHttps = (url: string) => /^https:\/\//i.test(url.trim());

const ConnectForm: React.FC<{
  mgr: PortainerManager;
  instanceId?: string;
  form: PortainerFormState;
  setForm: React.Dispatch<React.SetStateAction<PortainerFormState>>;
}> = ({ mgr, instanceId, form, setForm }) => {
  const { t } = useTranslation();
  const store = useIntegrationConfigStore();
  const [savedId, setSavedId] = useState<string | undefined>(instanceId);
  const [tlsPromptOpen, setTlsPromptOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const effectiveTlsSkip = form.skipTlsVerify && isHttps(form.baseUrl);
  const {
    needsAck: needsTlsAck,
    acknowledge: acknowledgeTls,
    reset: resetTlsAck,
  } = useInsecureTlsAck({
    configId: savedId ?? instanceId ?? `portainer:${form.baseUrl.trim()}`,
    insecure: effectiveTlsSkip,
  });

  // Prefill from a persisted instance (non-secret fields + vault secrets).
  useEffect(() => {
    if (!instanceId || store.isLoading) return;
    const inst = store.instances.find((i) => i.id === instanceId);
    if (!inst) return;
    const f = inst.fields ?? {};
    const authMode: PortainerAuthMode =
      f.authMode === "apiKey" ? "apiKey" : "password";
    const skip =
      f.skipTlsVerify === "true" ||
      f.tlsSkipVerify === "true" ||
      f.tlsVerify === "false";
    setForm((prev) => ({
      ...prev,
      name: inst.name,
      baseUrl: f.baseUrl ?? f.url ?? inst.host ?? "",
      username: f.username ?? "",
      authMode,
      skipTlsVerify: skip,
      timeoutSecs: f.timeoutSecs ?? f.timeout ?? "",
    }));
    void (async () => {
      const named = await store.readNamedSecret(
        inst,
        authMode === "apiKey" ? "apiKey" : "password",
      );
      const secret = named ?? (await store.readSecret(inst));
      if (!secret) return;
      setForm((prev) =>
        authMode === "apiKey"
          ? { ...prev, apiKey: secret }
          : { ...prev, password: secret },
      );
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-deps
  }, [instanceId, store.isLoading]);

  const set = <K extends keyof PortainerFormState>(
    k: K,
    v: PortainerFormState[K],
  ) => setForm((f) => ({ ...f, [k]: v }));

  const connectOnce = useCallback(
    async (acknowledged: boolean) => {
      const id = savedId ?? instanceId ?? generateId();
      const timeout = form.timeoutSecs.trim()
        ? Number(form.timeoutSecs)
        : undefined;
      try {
        await mgr.connect(id, {
          baseUrl: form.baseUrl.trim(),
          ...(form.authMode === "apiKey"
            ? { apiKey: form.apiKey }
            : { username: form.username.trim(), password: form.password }),
          skipTlsVerify: form.skipTlsVerify,
          acknowledge_invalid_cert_risk: effectiveTlsSkip && acknowledged,
          timeoutSecs: Number.isFinite(timeout) ? timeout : undefined,
        });
      } finally {
        resetTlsAck();
      }
    },
    [mgr, form, savedId, instanceId, effectiveTlsSkip, resetTlsAck],
  );

  const doConnect = useCallback(() => {
    if (needsTlsAck) {
      setTlsPromptOpen(true);
      return;
    }
    void connectOnce(false);
  }, [connectOnce, needsTlsAck]);

  const doSave = useCallback(async () => {
    setSaveError(null);
    const fields: Record<string, string> = {
      baseUrl: form.baseUrl.trim(),
      authMode: form.authMode,
      tlsVerify: String(!form.skipTlsVerify),
      skipTlsVerify: String(form.skipTlsVerify),
      timeoutSecs: form.timeoutSecs.trim(),
    };
    if (form.authMode === "password" && form.username.trim()) {
      fields.username = form.username.trim();
    }
    const secretValue =
      form.authMode === "apiKey" ? form.apiKey : form.password;
    const secrets: Record<string, string> = {};
    if (secretValue) {
      secrets[form.authMode === "apiKey" ? "apiKey" : "password"] = secretValue;
    }
    const name = form.name.trim() || form.baseUrl.trim();
    const input = {
      integrationKey: "portainer",
      name,
      host: form.baseUrl.trim(),
      fields,
      ...(secretValue ? { secret: secretValue, secrets } : {}),
    };
    try {
      if (savedId) {
        await store.updateInstance(savedId, input);
      } else {
        const created = await store.createInstance(input);
        setSavedId(created.id);
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  }, [store, form, savedId]);

  const credentialsReady =
    form.authMode === "apiKey"
      ? form.apiKey.length > 0
      : form.username.trim().length > 0 && form.password.length > 0;

  return (
    <div className={card} data-testid="portainer-connection-form">
      <InsecureTlsWarningModal
        key={tlsPromptOpen ? "open" : "closed"}
        isOpen={tlsPromptOpen}
        kind="integration"
        endpoint={form.baseUrl.trim() || "Portainer endpoint"}
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Labeled label={t("integrations.portainer.baseUrl", "Base URL")}>
          <input
            className={field}
            value={form.baseUrl}
            onChange={(e) => set("baseUrl", e.target.value)}
            placeholder="https://portainer.example.com:9443"
            data-testid="portainer-base-url"
          />
        </Labeled>
        <Labeled label={t("integrations.portainer.instanceName", "Saved name")}>
          <input
            className={field}
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder={form.baseUrl}
            data-testid="portainer-instance-name"
          />
        </Labeled>
      </div>

      <div
        className="mt-3 flex flex-wrap items-center gap-4 text-xs text-[var(--color-textSecondary)]"
        role="radiogroup"
        aria-label={t("integrations.portainer.authMode", "Authentication")}
      >
        <span>{t("integrations.portainer.authMode", "Authentication")}:</span>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name="portainer-auth-mode"
            checked={form.authMode === "password"}
            onChange={() => set("authMode", "password")}
            data-testid="portainer-auth-mode-password"
          />
          {t("integrations.portainer.authPassword", "Username + password")}
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name="portainer-auth-mode"
            checked={form.authMode === "apiKey"}
            onChange={() => set("authMode", "apiKey")}
            data-testid="portainer-auth-mode-apikey"
          />
          {t("integrations.portainer.authApiKey", "API access token")}
        </label>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {form.authMode === "password" ? (
          <>
            <Labeled label={t("integrations.portainer.username", "Username")}>
              <input
                className={field}
                value={form.username}
                onChange={(e) => set("username", e.target.value)}
                autoComplete="off"
                data-testid="portainer-username"
              />
            </Labeled>
            <Labeled label={t("integrations.portainer.password", "Password")}>
              <input
                className={field}
                type="password"
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
                autoComplete="off"
                data-testid="portainer-password"
              />
            </Labeled>
          </>
        ) : (
          <Labeled
            label={t("integrations.portainer.apiKey", "API access token")}
          >
            <input
              className={field}
              type="password"
              value={form.apiKey}
              onChange={(e) => set("apiKey", e.target.value)}
              placeholder="ptr_…"
              autoComplete="off"
              data-testid="portainer-api-key"
            />
          </Labeled>
        )}
        <Labeled
          label={t("integrations.portainer.timeout", "Timeout (seconds)")}
        >
          <input
            className={field}
            value={form.timeoutSecs}
            onChange={(e) => set("timeoutSecs", e.target.value)}
            inputMode="numeric"
            data-testid="portainer-timeout"
          />
        </Labeled>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
          <input
            type="checkbox"
            checked={form.skipTlsVerify}
            onChange={(e) => set("skipTlsVerify", e.target.checked)}
            data-testid="portainer-tls-skip"
          />
          {t(
            "integrations.portainer.skipTlsVerify",
            "Accept self-signed certificate",
          )}
        </label>
        <span className="text-[10px] text-[var(--color-textMuted)]">
          {t(
            "integrations.portainer.tlsHint",
            "A fresh Portainer install on :9443 uses a self-signed certificate. Trust it in Trust Center, or enable this toggle (revocable in Trust Center).",
          )}
        </span>
      </div>

      {saveError && (
        <div className="mt-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-500">
          {saveError}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className={btn}
          onClick={doConnect}
          disabled={
            mgr.isConnecting || !form.baseUrl.trim() || !credentialsReady
          }
          data-testid="portainer-connect-btn"
        >
          {mgr.isConnecting ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Plug size={12} />
          )}
          {t("integrations.portainer.connect", "Connect")}
        </button>
        <button
          className={btn}
          onClick={() => void doSave()}
          disabled={!form.baseUrl.trim()}
          data-testid="portainer-save-btn"
        >
          {t("integrations.portainer.save", "Save instance")}
        </button>
      </div>
    </div>
  );
};

// ─── Panel shell ─────────────────────────────────────────────────────────────

const TABS: {
  key: TabKey;
  labelKey: string;
  labelDefault: string;
  icon: React.ComponentType<{ size?: number | string }>;
}[] = [
  {
    key: "endpoints",
    labelKey: "integrations.portainer.tabEndpoints",
    labelDefault: "Environments",
    icon: Server,
  },
  {
    key: "containers",
    labelKey: "integrations.portainer.tabContainers",
    labelDefault: "Containers",
    icon: Boxes,
  },
  {
    key: "stacks",
    labelKey: "integrations.portainer.tabStacks",
    labelDefault: "Stacks",
    icon: Layers,
  },
];

const ROLE_LABELS: Record<number, string> = {
  1: "administrator",
  2: "user",
};

const PortainerPanel: React.FC<IntegrationPanelProps> = ({
  isOpen,
  instanceId,
}) => {
  const { t } = useTranslation();
  const mgr = usePortainer();
  const [tab, setTab] = useState<TabKey>("endpoints");
  const [form, setForm] = useState<PortainerFormState>(emptyPortainerForm);
  const [endpointId, setEndpointId] = useState<number | null>(null);
  const [webUiNotice, setWebUiNotice] = useState<string | null>(null);

  const openWebUi = useCallback(() => {
    setWebUiNotice(null);
    const authMode = mgr.summary?.authMode ?? form.authMode;
    try {
      const connection = launchPortainerWebUi({
        baseUrl: mgr.webUiUrl ?? form.baseUrl,
        authMode,
        username: form.username,
        password: form.password,
        skipTlsVerify: form.skipTlsVerify,
        name: form.name.trim() || undefined,
      });
      if (!connection.httpAutoLogin) {
        setWebUiNotice(
          t(
            "integrations.portainer.webUiNoAutoLogin",
            "Opened without auto-login: an API access token cannot sign in to the web UI. Use username + password mode for auto-login.",
          ),
        );
      }
    } catch (e) {
      setWebUiNotice(e instanceof Error ? e.message : String(e));
    }
  }, [mgr.summary, mgr.webUiUrl, form, t]);

  if (!isOpen) return null;

  const cid = mgr.connectionId;
  const connected = mgr.isConnected && cid;

  return (
    <div
      className="flex h-full flex-col overflow-y-auto bg-[var(--color-surface)] p-4"
      data-testid="portainer-panel"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--color-text)]">
          <Container className="h-5 w-5 text-primary" />
          {t("integrations.portainer.title", "Portainer")}
        </h2>
        <div
          className="flex flex-wrap items-center gap-2 text-xs"
          data-testid="portainer-status"
        >
          <span
            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 ${
              mgr.isConnected
                ? "bg-green-500/15 text-green-500"
                : "bg-[var(--color-border)] text-[var(--color-textSecondary)]"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${mgr.isConnected ? "bg-green-500" : "bg-[var(--color-textMuted)]"}`}
            />
            {mgr.isConnected
              ? t("integrations.portainer.connected", "Connected")
              : t("integrations.portainer.disconnected", "Disconnected")}
          </span>
          {mgr.summary?.version && (
            <span className="text-[var(--color-textMuted)]">
              v{mgr.summary.version}
            </span>
          )}
          {mgr.summary?.instanceId && (
            <span
              className="font-mono text-[var(--color-textMuted)]"
              title={t("integrations.portainer.instanceId", "Instance ID")}
            >
              {mgr.summary.instanceId}
            </span>
          )}
          {mgr.summary?.user && (
            <span className="text-[var(--color-textMuted)]">
              {mgr.summary.user}
              {mgr.summary.role != null &&
                ` (${ROLE_LABELS[mgr.summary.role] ?? mgr.summary.role})`}
            </span>
          )}
          {mgr.summary && (
            <span className="text-[var(--color-textMuted)]">
              {mgr.summary.authMode === "apiKey"
                ? t("integrations.portainer.authApiKey", "API access token")
                : t(
                    "integrations.portainer.authPassword",
                    "Username + password",
                  )}
            </span>
          )}
          {connected && (
            <>
              <button
                className={btn}
                onClick={openWebUi}
                title={t(
                  "integrations.portainer.openWebUiTitle",
                  "Open Portainer's web UI in a new session tab and sign in automatically",
                )}
                data-testid="portainer-open-web-ui"
              >
                <ExternalLink size={12} />
                {t(
                  "integrations.portainer.openWebUi",
                  "Open web UI (auto-login)",
                )}
              </button>
              <button
                className={btn}
                onClick={() => void mgr.disconnect()}
                data-testid="portainer-disconnect-btn"
              >
                {t("integrations.portainer.disconnect", "Disconnect")}
              </button>
            </>
          )}
        </div>
      </div>

      {mgr.error && (
        <div
          className="mb-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-500"
          data-testid="portainer-error"
        >
          {mgr.error}
          {mgr.error.startsWith("tls_untrusted") && (
            <div className="mt-1 text-[var(--color-textSecondary)]">
              {t(
                "integrations.portainer.tlsUntrustedHint",
                'The server\'s certificate is not trusted. Trust it in Trust Center, or enable "Accept self-signed certificate" and connect again.',
              )}
            </div>
          )}
        </div>
      )}

      {webUiNotice && (
        <div
          className="mb-3 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-500"
          data-testid="portainer-web-ui-notice"
        >
          {webUiNotice}
        </div>
      )}

      {!connected ? (
        <ConnectForm
          mgr={mgr}
          instanceId={instanceId}
          form={form}
          setForm={setForm}
        />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-1 border-b border-[var(--color-border)]">
            {TABS.map(({ key, labelKey, labelDefault, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`inline-flex items-center gap-1 border-b-2 px-3 py-1.5 text-xs ${
                  tab === key
                    ? "border-primary text-[var(--color-text)]"
                    : "border-transparent text-[var(--color-textSecondary)]"
                }`}
                data-testid={`portainer-tab-${key}`}
              >
                <Icon size={12} />
                {t(labelKey, labelDefault)}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1">
            {tab === "endpoints" && (
              <PortainerEndpointsTab
                mgr={mgr}
                onSelectEndpoint={(id) => {
                  setEndpointId(id);
                  setTab("containers");
                }}
              />
            )}
            {tab === "containers" && (
              <PortainerContainersTab
                mgr={mgr}
                endpointId={endpointId}
                onEndpointChange={setEndpointId}
              />
            )}
            {tab === "stacks" && <PortainerStacksTab mgr={mgr} />}
          </div>
        </>
      )}
    </div>
  );
};

export default PortainerPanel;
