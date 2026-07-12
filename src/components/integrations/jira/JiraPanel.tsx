// JiraPanel — the Jira integration panel SHELL (t42 §4b, crate lead t42-jira-L).
// Owns the connect/config form + connection lifecycle and a registry-driven
// sub-tab bar. The command surface itself (issues/comments/attachments/worklogs/
// users/fields and projects/boards/sprints/dashboards/filters) is bound by the
// per-category tab modules, which register themselves in `./registry.ts`; this
// shell never changes per-category.

import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { SquareKanban, Loader2, Plug, PlugZap, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { IntegrationPanelProps } from "../../../types/integrations/registry";
import type {
  JiraAuthMethod,
  JiraAuthMethodKind,
  JiraConnectionConfig,
} from "../../../types/jira";
import { useJiraConnection } from "../../../hooks/integration/jira/useJiraConnection";
import { useIntegrationConfigStore } from "../../../hooks/integrations/useIntegrationConfigStore";
import { jiraCategoryTabs } from "./registry";

/** The secret blob stored in the OS vault packs every possible auth secret (the
 *  store has one secret slot per instance); only the fields matching the chosen
 *  `authKind` are folded into the wire `auth` object at connect time. */
interface JiraSecret {
  password: string;
  token: string;
}

const DEFAULT_API_VERSION = "2";
const DEFAULT_TIMEOUT_SECONDS = 30;

const AUTH_METHODS: {
  value: JiraAuthMethodKind;
  label: string;
  defaultLabel: string;
}[] = [
  {
    value: "apiToken",
    label: "integrations.jira.authMethods.apiToken",
    defaultLabel: "Cloud — email + API token",
  },
  {
    value: "basic",
    label: "integrations.jira.authMethods.basic",
    defaultLabel: "Server/DC — username + password",
  },
  {
    value: "pat",
    label: "integrations.jira.authMethods.pat",
    defaultLabel: "Server/DC — personal access token",
  },
  {
    value: "bearer",
    label: "integrations.jira.authMethods.bearer",
    defaultLabel: "OAuth / bearer token",
  },
];

const emptyForm = {
  name: "",
  host: "",
  authKind: "apiToken" as JiraAuthMethodKind,
  /** Basic auth username. */
  username: "",
  /** Cloud API-token email. */
  email: "",
  /** Basic auth password (secret). */
  password: "",
  /** ApiToken / Bearer / Pat token (secret). */
  token: "",
  apiVersion: DEFAULT_API_VERSION,
  skipTlsVerify: false,
};

type FormState = typeof emptyForm;

/** Build serde's externally-tagged `auth` wire object from the flat form. */
function buildAuth(form: FormState): JiraAuthMethod {
  switch (form.authKind) {
    case "basic":
      return {
        Basic: { username: form.username.trim(), password: form.password },
      };
    case "apiToken":
      return { ApiToken: { email: form.email.trim(), token: form.token } };
    case "bearer":
      return { Bearer: { token: form.token } };
    case "pat":
      return { Pat: { token: form.token } };
  }
}

const JiraPanel: React.FC<IntegrationPanelProps> = ({ isOpen, instanceId }) => {
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
    status,
    connecting,
    error,
    connect,
    disconnect,
    setError,
  } = useJiraConnection();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [activeTab, setActiveTab] = useState<string | null>(
    jiraCategoryTabs[0]?.categoryKey ?? null,
  );

  // Prefill the form from a persisted instance when opened against one.
  useEffect(() => {
    if (!instanceId || storeLoading) return;
    const instance = instancesFor("jira").find((i) => i.id === instanceId);
    if (!instance) return;
    let cancelled = false;
    (async () => {
      const secretRaw = await readSecret(instance);
      let secret: JiraSecret = { password: "", token: "" };
      if (secretRaw) {
        try {
          secret = JSON.parse(secretRaw) as JiraSecret;
        } catch {
          // Legacy / opaque secret — treat the whole string as the token.
          secret = { password: "", token: secretRaw };
        }
      }
      if (cancelled) return;
      const fields = instance.fields ?? {};
      setForm({
        name: instance.name,
        host: instance.host ?? "",
        authKind: (fields.authKind as JiraAuthMethodKind) ?? "apiToken",
        username: fields.username ?? "",
        email: fields.email ?? "",
        password: secret.password,
        token: secret.token,
        apiVersion: fields.apiVersion ?? DEFAULT_API_VERSION,
        skipTlsVerify: fields.skipTlsVerify === "true",
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

  const buildConfig = useCallback((): JiraConnectionConfig => {
    const name = form.name.trim() || form.host.trim() || "Jira";
    return {
      name,
      host: form.host.trim(),
      auth: buildAuth(form),
      api_version: form.apiVersion.trim() || DEFAULT_API_VERSION,
      timeout_seconds: DEFAULT_TIMEOUT_SECONDS,
      skip_tls_verify: form.skipTlsVerify,
    };
  }, [form]);

  const handleConnect = useCallback(async () => {
    setError(null);
    try {
      const config = buildConfig();
      const secret = JSON.stringify({
        password: form.password,
        token: form.token,
      } satisfies JiraSecret);
      const fields = {
        authKind: form.authKind,
        username: form.username.trim(),
        email: form.email.trim(),
        apiVersion: config.api_version ?? DEFAULT_API_VERSION,
        skipTlsVerify: String(form.skipTlsVerify),
      };
      const name = config.name;

      // Persist host + creds (encrypted) and use the instance id as the stable
      // connection id, so reconnecting a saved instance reuses its id.
      let id = instanceId ?? null;
      if (id) {
        await updateInstance(id, {
          integrationKey: "jira",
          name,
          host: config.host,
          fields,
          secret,
        });
      } else {
        const created = await createInstance({
          integrationKey: "jira",
          name,
          host: config.host,
          fields,
          secret,
        });
        id = created.id;
      }

      await connect(id, config);
      setActiveTab(jiraCategoryTabs[0]?.categoryKey ?? null);
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
    const tab = jiraCategoryTabs.find((tt) => tt.categoryKey === activeTab);
    if (!tab) return null;
    return React.lazy(tab.importTab);
  }, [connectionId, activeTab]);

  if (!isOpen) return null;

  const connected = Boolean(connectionId);
  const usesUsername = form.authKind === "basic";
  const usesEmail = form.authKind === "apiToken";
  const usesPassword = form.authKind === "basic";
  const secretLabel = usesPassword
    ? t("integrations.jira.fields.password", "Password")
    : t("integrations.jira.fields.token", "Token");
  const canConnect =
    Boolean(form.host.trim()) &&
    (usesPassword ? Boolean(form.password) : Boolean(form.token)) &&
    (!usesUsername || Boolean(form.username.trim())) &&
    (!usesEmail || Boolean(form.email.trim()));

  return (
    <div className="flex h-full flex-col bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--color-text)]">
          <SquareKanban className="h-5 w-5 text-primary" />
          {t("integrations.jira.title", "Jira")}
          {status && (
            <span className="text-xs font-normal text-[var(--color-textSecondary)]">
              {status.server_title ?? form.host}
              {status.version ? ` · ${status.version}` : ""}
            </span>
          )}
        </h2>
        {connected && (
          <button
            onClick={disconnect}
            className="app-bar-button flex items-center gap-1 px-2 py-1 text-xs"
            title={t("integrations.jira.disconnect", "Disconnect")}
          >
            <PlugZap size={14} />
            {t("integrations.jira.disconnect", "Disconnect")}
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
                "integrations.jira.connectHint",
                "Connect to a Jira Cloud or Server/Data Center site via its REST API.",
              )}
            </p>

            <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
              {t("integrations.jira.fields.name", "Name")}
              <input
                className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
                placeholder="acme-jira"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
              {t("integrations.jira.fields.host", "Host URL")}
              <input
                className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                value={form.host}
                onChange={(e) => setField("host", e.target.value)}
                placeholder="https://acme.atlassian.net"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
              {t("integrations.jira.fields.authMethod", "Authentication")}
              <select
                className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                value={form.authKind}
                onChange={(e) =>
                  setField("authKind", e.target.value as JiraAuthMethodKind)
                }
              >
                {AUTH_METHODS.map((method) => (
                  <option key={method.value} value={method.value}>
                    {t(method.label, method.defaultLabel)}
                  </option>
                ))}
              </select>
            </label>

            {usesUsername && (
              <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
                {t("integrations.jira.fields.username", "Username")}
                <input
                  className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                  value={form.username}
                  onChange={(e) => setField("username", e.target.value)}
                  autoComplete="off"
                  placeholder="jsmith"
                />
              </label>
            )}

            {usesEmail && (
              <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
                {t("integrations.jira.fields.email", "Account email")}
                <input
                  className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                  value={form.email}
                  onChange={(e) => setField("email", e.target.value)}
                  autoComplete="off"
                  placeholder="jsmith@acme.com"
                />
              </label>
            )}

            <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
              {secretLabel}
              <input
                type="password"
                className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                value={usesPassword ? form.password : form.token}
                onChange={(e) =>
                  setField(
                    usesPassword ? "password" : "token",
                    e.target.value,
                  )
                }
                autoComplete="off"
              />
            </label>

            <div className="flex gap-2">
              <label className="flex flex-1 flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
                {t("integrations.jira.fields.apiVersion", "API version")}
                <select
                  className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                  value={form.apiVersion}
                  onChange={(e) => setField("apiVersion", e.target.value)}
                >
                  <option value="2">2 (Server/DC)</option>
                  <option value="3">3 (Cloud)</option>
                </select>
              </label>
            </div>

            <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
              <input
                type="checkbox"
                checked={form.skipTlsVerify}
                onChange={(e) => setField("skipTlsVerify", e.target.checked)}
              />
              {t(
                "integrations.jira.fields.skipTlsVerify",
                "Skip TLS certificate verification",
              )}
            </label>

            <button
              onClick={handleConnect}
              disabled={connecting || !canConnect}
              className="mt-2 flex items-center justify-center gap-2 rounded bg-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {connecting ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Plug size={16} />
              )}
              {t("integrations.jira.connect", "Connect")}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {jiraCategoryTabs.length > 0 ? (
            <>
              <div className="flex gap-1 border-b border-[var(--color-border)] px-2">
                {jiraCategoryTabs.map((tab) => (
                  <button
                    key={tab.categoryKey}
                    onClick={() => setActiveTab(tab.categoryKey)}
                    className={`px-3 py-2 text-sm ${
                      activeTab === tab.categoryKey
                        ? "border-b-2 border-primary text-[var(--color-text)]"
                        : "text-[var(--color-textSecondary)]"
                    }`}
                  >
                    {t(`integrations.jira.tabs.${tab.categoryKey}`, tab.label)}
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
                  "integrations.jira.noTabs",
                  "Connected. Management sections load here once registered.",
                )}
              </p>
              {status && (
                <p className="text-xs">
                  {status.server_title ?? form.host}
                  {status.version ? ` · ${status.version}` : ""}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default JiraPanel;
