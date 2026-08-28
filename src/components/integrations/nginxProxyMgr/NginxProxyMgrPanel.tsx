// Nginx Proxy Manager integration panel (t65-e4).
//
// Connect form (API URL, email + password OR bearer token, accept self-signed
// certificate, timeout) → `npm_connect` through `useNginxProxyMgr`; persisted
// non-secret settings via `useIntegrationConfigStore`, the password / token
// in the OS vault. Once connected: status bar (version / user / token expiry /
// refresh token), tabs Proxy Hosts / Redirections / Streams / Certificates and
// an "Open web UI (auto-login)" action (see `./webUiLaunch.ts`).

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  KeyRound,
  Loader2,
  Plug,
  RefreshCw,
  Unplug,
  Waypoints,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNginxProxyMgr } from "../../../hooks/integration/useNginxProxyMgr";
import {
  useIntegrationConfigStore,
  type IntegrationInstance,
} from "../../../hooks/integrations/useIntegrationConfigStore";
import { useInsecureTlsAck } from "../../../hooks/security/useInsecureTlsAck";
import { generateId } from "../../../utils/core/id";
import type { IntegrationPanelProps } from "../../../types/integrations/registry";
import type {
  NpmAuthMode,
  NpmConnectionConfig,
} from "../../../types/nginxProxyMgr";
import { InsecureTlsWarningModal } from "../../security/InsecureTlsWarningModal";
import { launchNpmWebUi } from "./webUiLaunch";
import { Labeled, npmBtn, npmCard, npmField } from "./shared";
import NpmProxyHostsTab from "./NpmProxyHostsTab";
import NpmRedirectionsTab from "./NpmRedirectionsTab";
import NpmStreamsTab from "./NpmStreamsTab";
import NpmCertificatesTab from "./NpmCertificatesTab";

export const NPM_INTEGRATION_KEY = "nginxProxyMgr";

type TabKey = "proxy-hosts" | "redirections" | "streams" | "certificates";

interface FormState {
  name: string;
  apiUrl: string;
  authMode: NpmAuthMode;
  email: string;
  password: string;
  token: string;
  skipTlsVerify: boolean;
  timeoutSecs: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  apiUrl: "http://localhost:81",
  authMode: "password",
  email: "",
  password: "",
  token: "",
  skipTlsVerify: false,
  timeoutSecs: "",
};

/** `IntegrationPanelHost` derives `authMode` "bearer" / "basic" / "password"
 *  from launch settings; the panel's own persisted value is "password"/"token". */
function normalizeAuthMode(raw: string | undefined): NpmAuthMode {
  return raw === "bearer" || raw === "token" ? "token" : "password";
}

function formFromInstance(inst: IntegrationInstance): FormState {
  const f = inst.fields ?? {};
  return {
    ...EMPTY_FORM,
    name: inst.name ?? "",
    apiUrl: f.apiUrl || f.baseUrl || f.url || inst.host || EMPTY_FORM.apiUrl,
    authMode: normalizeAuthMode(f.authMode),
    email: f.email || f.username || "",
    skipTlsVerify:
      f.skipTlsVerify === "true" ||
      f.tlsSkipVerify === "true" ||
      f.tlsVerify === "false",
    timeoutSecs: f.timeoutSecs || f.timeout || "",
  };
}

const NginxProxyMgrPanel: React.FC<IntegrationPanelProps> = ({
  onClose,
  instanceId,
}) => {
  const { t } = useTranslation();
  const mgr = useNginxProxyMgr();
  const store = useIntegrationConfigStore();
  const { instancesFor, createInstance, updateInstance, readSecret } = store;
  const readNamedSecret = store.readNamedSecret;

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [boundInstanceId, setBoundInstanceId] = useState<string | undefined>(
    instanceId,
  );
  const [activeTab, setActiveTab] = useState<TabKey>("proxy-hosts");
  const [tlsPromptOpen, setTlsPromptOpen] = useState(false);
  const [webUiError, setWebUiError] = useState<string | null>(null);

  const effectiveTlsSkip =
    form.skipTlsVerify && /^https:\/\//i.test(form.apiUrl.trim());
  const {
    needsAck: needsTlsAck,
    acknowledge: acknowledgeTls,
    reset: resetTlsAck,
  } = useInsecureTlsAck({
    configId:
      boundInstanceId ?? instanceId ?? `nginxProxyMgr:${form.apiUrl.trim()}`,
    insecure: effectiveTlsSkip,
  });

  // Hydrate from a persisted instance (non-secret fields + vault secret).
  useEffect(() => {
    if (!instanceId || store.isLoading) return;
    const inst = instancesFor(NPM_INTEGRATION_KEY).find(
      (i) => i.id === instanceId,
    );
    if (!inst) return;
    const hydrated = formFromInstance(inst);
    setForm(hydrated);
    setBoundInstanceId(inst.id);
    void (async () => {
      const named = await readNamedSecret(
        inst,
        hydrated.authMode === "token" ? "authToken" : "password",
      );
      const secret = named ?? (await readSecret(inst));
      if (!secret) return;
      setForm((f) =>
        f.authMode === "token"
          ? { ...f, token: secret }
          : { ...f, password: secret },
      );
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-deps
  }, [instanceId, store.isLoading]);

  const set = useCallback(
    <K extends keyof FormState>(k: K, v: FormState[K]) =>
      setForm((f) => ({ ...f, [k]: v })),
    [],
  );

  const persistInstance = useCallback(
    async (f: FormState): Promise<string> => {
      const secret = f.authMode === "token" ? f.token : f.password;
      const input = {
        integrationKey: NPM_INTEGRATION_KEY,
        name: f.name.trim() || f.apiUrl.trim(),
        host: f.apiUrl.trim() || undefined,
        fields: {
          apiUrl: f.apiUrl.trim(),
          email: f.authMode === "password" ? f.email.trim() : "",
          authMode: f.authMode,
          skipTlsVerify: String(f.skipTlsVerify),
          timeoutSecs: f.timeoutSecs.trim(),
        },
        secret: secret || undefined,
        secrets:
          f.authMode === "token"
            ? { authToken: f.token || undefined, password: undefined }
            : { password: f.password || undefined, authToken: undefined },
      };
      if (boundInstanceId) {
        await updateInstance(boundInstanceId, input);
        return boundInstanceId;
      }
      const created = await createInstance(input);
      setBoundInstanceId(created.id);
      return created.id;
    },
    [boundInstanceId, createInstance, updateInstance],
  );

  const buildConfig = useCallback(
    (acknowledged: boolean): NpmConnectionConfig => {
      const timeout = form.timeoutSecs.trim();
      const base: NpmConnectionConfig = {
        api_url: form.apiUrl.trim(),
        skip_tls_verify: form.skipTlsVerify,
        acknowledge_invalid_cert_risk: effectiveTlsSkip && acknowledged,
        timeout_secs: timeout ? Number(timeout) : undefined,
      };
      return form.authMode === "token"
        ? { ...base, token: form.token }
        : { ...base, email: form.email.trim(), password: form.password };
    },
    [form, effectiveTlsSkip],
  );

  const connectOnce = useCallback(
    async (acknowledged: boolean) => {
      let id = boundInstanceId ?? instanceId ?? generateId();
      // Persist first so a failed connect still keeps the config; a locked
      // vault must not block connecting with the in-memory form values.
      try {
        id = await persistInstance(form);
      } catch {
        // reference-only persistence already handled inside the store
      }
      try {
        await mgr.connect(id, buildConfig(acknowledged));
      } finally {
        resetTlsAck();
      }
    },
    [
      boundInstanceId,
      instanceId,
      persistInstance,
      form,
      mgr,
      buildConfig,
      resetTlsAck,
    ],
  );

  const doConnect = useCallback(() => {
    if (needsTlsAck) {
      setTlsPromptOpen(true);
      return;
    }
    void connectOnce(false);
  }, [connectOnce, needsTlsAck]);

  const canConnect =
    !mgr.isConnecting &&
    form.apiUrl.trim().length > 0 &&
    (form.authMode === "token"
      ? form.token.length > 0
      : form.email.trim().length > 0 && form.password.length > 0);

  const openWebUi = useCallback(() => {
    setWebUiError(null);
    try {
      launchNpmWebUi({
        baseUrl: mgr.webUiUrl ?? form.apiUrl,
        authMode: form.authMode,
        email: form.authMode === "password" ? form.email : undefined,
        password: form.authMode === "password" ? form.password : undefined,
        skipTlsVerify: form.skipTlsVerify,
        name: form.name.trim() || undefined,
      });
    } catch (e) {
      setWebUiError(e instanceof Error ? e.message : String(e));
    }
  }, [mgr.webUiUrl, form]);

  const tabs = useMemo(
    () =>
      [
        {
          key: "proxy-hosts" as const,
          label: t("integrations.nginxProxyMgr.tabs.proxyHosts", "Proxy Hosts"),
        },
        {
          key: "redirections" as const,
          label: t(
            "integrations.nginxProxyMgr.tabs.redirections",
            "Redirections",
          ),
        },
        {
          key: "streams" as const,
          label: t("integrations.nginxProxyMgr.tabs.streams", "Streams"),
        },
        {
          key: "certificates" as const,
          label: t(
            "integrations.nginxProxyMgr.tabs.certificates",
            "Certificates",
          ),
        },
      ] satisfies { key: TabKey; label: string }[],
    [t],
  );

  return (
    <div
      className="flex h-full flex-col bg-[var(--color-surface)]"
      data-testid="npm-panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-3">
        <div className="flex items-center gap-2">
          <Waypoints className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-base font-semibold text-[var(--color-text)]">
              {t("integrations.nginxProxyMgr.title", "Nginx Proxy Manager")}
            </h2>
            <p className="text-xs text-[var(--color-textSecondary)]">
              {t(
                "integrations.nginxProxyMgr.subtitle",
                "Manage proxy hosts, redirections, streams and certificates",
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {mgr.isConnected && (
            <>
              <button
                type="button"
                className={npmBtn}
                onClick={openWebUi}
                data-testid="npm-open-web-ui"
                title={
                  form.authMode === "password"
                    ? t(
                        "integrations.nginxProxyMgr.openWebUiAutoLoginHint",
                        "Opens the NPM admin UI in a web session and signs in with the saved email and password",
                      )
                    : t(
                        "integrations.nginxProxyMgr.openWebUiTokenHint",
                        "Opens the NPM admin UI in a web session (token mode: sign in manually)",
                      )
                }
              >
                <ExternalLink className="h-3 w-3" />
                {form.authMode === "password"
                  ? t(
                      "integrations.nginxProxyMgr.openWebUiAutoLogin",
                      "Open web UI (auto-login)",
                    )
                  : t("integrations.nginxProxyMgr.openWebUi", "Open web UI")}
              </button>
              <button
                type="button"
                className={npmBtn}
                onClick={() => void mgr.disconnect()}
                data-testid="npm-disconnect-btn"
              >
                <Unplug className="h-3 w-3" />
                {t("integrations.nginxProxyMgr.disconnect", "Disconnect")}
              </button>
            </>
          )}
          <button
            type="button"
            className={npmBtn}
            onClick={onClose}
            aria-label={t("integrations.nginxProxyMgr.close", "Close")}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-4">
        {(mgr.error || webUiError) && (
          <div
            className="mb-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-500"
            role="alert"
            data-testid="npm-error"
          >
            {webUiError ?? mgr.error}
          </div>
        )}

        {!mgr.isConnected ? (
          <form
            className={npmCard}
            data-testid="npm-connection-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (canConnect) doConnect();
            }}
          >
            <InsecureTlsWarningModal
              key={tlsPromptOpen ? "open" : "closed"}
              isOpen={tlsPromptOpen}
              kind="integration"
              endpoint={form.apiUrl.trim() || "Nginx Proxy Manager endpoint"}
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
              <Labeled
                label={t("integrations.nginxProxyMgr.apiUrl", "API URL")}
                htmlFor="npm-api-url"
              >
                <input
                  id="npm-api-url"
                  className={npmField}
                  value={form.apiUrl}
                  onChange={(e) => set("apiUrl", e.target.value)}
                  placeholder="http://npm.example.com:81"
                  data-testid="npm-api-url"
                />
              </Labeled>
              <Labeled
                label={t(
                  "integrations.nginxProxyMgr.instanceName",
                  "Saved name",
                )}
                htmlFor="npm-name"
              >
                <input
                  id="npm-name"
                  className={npmField}
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  data-testid="npm-name"
                />
              </Labeled>
              <fieldset className="sm:col-span-2">
                <legend className="mb-1 text-xs text-[var(--color-textSecondary)]">
                  {t("integrations.nginxProxyMgr.authMode", "Authentication")}
                </legend>
                <div className="flex gap-4 text-xs text-[var(--color-text)]">
                  <label className="inline-flex items-center gap-1">
                    <input
                      type="radio"
                      name="npm-auth-mode"
                      checked={form.authMode === "password"}
                      onChange={() => set("authMode", "password")}
                      data-testid="npm-auth-mode-password"
                    />
                    {t(
                      "integrations.nginxProxyMgr.authModePassword",
                      "Email and password",
                    )}
                  </label>
                  <label className="inline-flex items-center gap-1">
                    <input
                      type="radio"
                      name="npm-auth-mode"
                      checked={form.authMode === "token"}
                      onChange={() => set("authMode", "token")}
                      data-testid="npm-auth-mode-token"
                    />
                    {t(
                      "integrations.nginxProxyMgr.authModeToken",
                      "Bearer token",
                    )}
                  </label>
                </div>
              </fieldset>
              {form.authMode === "password" ? (
                <>
                  <Labeled
                    label={t("integrations.nginxProxyMgr.email", "Email")}
                    htmlFor="npm-email"
                  >
                    <input
                      id="npm-email"
                      className={npmField}
                      type="email"
                      autoComplete="username"
                      value={form.email}
                      onChange={(e) => set("email", e.target.value)}
                      placeholder="admin@example.com"
                      data-testid="npm-email"
                    />
                  </Labeled>
                  <Labeled
                    label={t("integrations.nginxProxyMgr.password", "Password")}
                    htmlFor="npm-password"
                  >
                    <input
                      id="npm-password"
                      className={npmField}
                      type="password"
                      autoComplete="current-password"
                      value={form.password}
                      onChange={(e) => set("password", e.target.value)}
                      data-testid="npm-password"
                    />
                  </Labeled>
                </>
              ) : (
                <Labeled
                  label={t("integrations.nginxProxyMgr.token", "Bearer token")}
                  htmlFor="npm-token"
                >
                  <input
                    id="npm-token"
                    className={npmField}
                    type="password"
                    autoComplete="off"
                    value={form.token}
                    onChange={(e) => set("token", e.target.value)}
                    data-testid="npm-token"
                  />
                </Labeled>
              )}
              <Labeled
                label={t(
                  "integrations.nginxProxyMgr.timeout",
                  "Timeout (seconds)",
                )}
                htmlFor="npm-timeout"
              >
                <input
                  id="npm-timeout"
                  className={npmField}
                  inputMode="numeric"
                  value={form.timeoutSecs}
                  onChange={(e) => set("timeoutSecs", e.target.value)}
                  placeholder="30"
                  data-testid="npm-timeout"
                />
              </Labeled>
              <label className="inline-flex items-center gap-2 self-end text-xs text-[var(--color-text)]">
                <input
                  type="checkbox"
                  checked={form.skipTlsVerify}
                  onChange={(e) => set("skipTlsVerify", e.target.checked)}
                  data-testid="npm-tls-skip"
                />
                {t(
                  "integrations.nginxProxyMgr.skipTlsVerify",
                  "Accept self-signed certificate (https only)",
                )}
              </label>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="submit"
                className={npmBtn}
                disabled={!canConnect}
                data-testid="npm-connect-btn"
              >
                {mgr.isConnecting ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Plug className="h-3 w-3" />
                )}
                {t("integrations.nginxProxyMgr.connect", "Connect")}
              </button>
              {effectiveTlsSkip && (
                <span className="text-xs text-amber-500">
                  {t(
                    "integrations.nginxProxyMgr.tlsSkipWarning",
                    "Certificate verification is disabled for this endpoint.",
                  )}
                </span>
              )}
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            {/* Status bar */}
            <div
              className={`${npmCard} flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-text)]`}
              data-testid="npm-status"
            >
              <span>
                {t("integrations.nginxProxyMgr.statusVersion", "Version")}:{" "}
                <strong>{mgr.summary?.version ?? "—"}</strong>
              </span>
              <span>
                {t("integrations.nginxProxyMgr.statusUser", "User")}:{" "}
                <strong>{mgr.summary?.user ?? "—"}</strong>
              </span>
              <span>
                {t("integrations.nginxProxyMgr.statusAuthMode", "Auth")}:{" "}
                <strong>{mgr.summary?.auth_mode ?? form.authMode}</strong>
              </span>
              <span>
                {t(
                  "integrations.nginxProxyMgr.statusTokenExpires",
                  "Token expires",
                )}
                : <strong>{mgr.summary?.token_expires_at ?? "—"}</strong>
              </span>
              <button
                type="button"
                className={npmBtn}
                disabled={mgr.busy}
                onClick={() => void mgr.refreshToken().catch(() => {})}
                data-testid="npm-refresh-token-btn"
              >
                <KeyRound className="h-3 w-3" />
                {t("integrations.nginxProxyMgr.refreshToken", "Refresh token")}
              </button>
              <button
                type="button"
                className={npmBtn}
                disabled={mgr.busy}
                onClick={() => void mgr.refreshAll().catch(() => {})}
                data-testid="npm-refresh-all-btn"
              >
                <RefreshCw className="h-3 w-3" />
                {t("integrations.nginxProxyMgr.refreshAll", "Refresh all")}
              </button>
            </div>

            {/* Tabs */}
            <div
              className="flex gap-1 border-b border-[var(--color-border)]"
              role="tablist"
            >
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.key}
                  data-testid={`npm-tab-${tab.key}`}
                  className={
                    "px-3 py-1.5 text-xs " +
                    (activeTab === tab.key
                      ? "border-b-2 border-primary text-[var(--color-text)]"
                      : "text-[var(--color-textSecondary)]")
                  }
                  onClick={() => setActiveTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className={npmCard}>
              {activeTab === "proxy-hosts" && <NpmProxyHostsTab mgr={mgr} />}
              {activeTab === "redirections" && <NpmRedirectionsTab mgr={mgr} />}
              {activeTab === "streams" && <NpmStreamsTab mgr={mgr} />}
              {activeTab === "certificates" && <NpmCertificatesTab mgr={mgr} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default NginxProxyMgrPanel;
