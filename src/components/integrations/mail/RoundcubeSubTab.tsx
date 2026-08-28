// Roundcube administration sub-tab for the unified Mail Server panel.
//
// The connector talks to the administrative JSON API implemented by the
// `sorng-roundcube` backend. It is not a browser wrapper for the webmail UI.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Activity,
  Database,
  FileText,
  Folder,
  ListFilter,
  Loader2,
  Package,
  Plug,
  RefreshCw,
  RotateCw,
  Save,
  Settings,
  ShieldAlert,
  Trash2,
  UserRound,
  Users,
  Wrench,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  useRoundcube,
  type RoundcubeManager,
} from "../../../hooks/integration/mail/useRoundcube";
import { useIntegrationConfigStore } from "../../../hooks/integrations/useIntegrationConfigStore";
import type { IntegrationInstance } from "../../../hooks/integrations/useIntegrationConfigStore";
import type {
  RoundcubeCacheStats,
  RoundcubeDbStats,
  RoundcubeFilter,
  RoundcubeFolder,
  RoundcubeIdentity,
  RoundcubeLogEntry,
  RoundcubePlugin,
  RoundcubeQuota,
  RoundcubeSmtpConfig,
  RoundcubeSystemConfig,
  RoundcubeUser,
} from "../../../types/mail/roundcube";
import { generateId } from "../../../utils/core/id";
import type { MailSubTabProps } from "./registry";

const K = "integrations.mail.roundcube";
const INTEGRATION_KEY = "mail.roundcube";

const field =
  "w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm text-[var(--color-text)]";
const button =
  "app-bar-button inline-flex items-center gap-1 rounded px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50";
const card =
  "rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-3";

const messageOf = (error: unknown): string =>
  typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : String(error);

const Labeled: React.FC<{
  label: string;
  children: React.ReactNode;
}> = ({ label, children }) => (
  <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
    <span>{label}</span>
    {children}
  </label>
);

const Stat: React.FC<{ label: string; value: React.ReactNode }> = ({
  label,
  value,
}) => (
  <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1">
    <div className="text-[10px] uppercase text-[var(--color-textMuted)]">
      {label}
    </div>
    <div className="break-words text-sm text-[var(--color-text)]">
      {value ?? "—"}
    </div>
  </div>
);

function ErrorOverview({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  const lower = message.toLowerCase();
  let title = "Roundcube operation failed";
  let overview =
    "The backend returned an error. No successful result was applied.";
  let checks = [
    "Confirm the base URL points to the Roundcube administrative API.",
    "Confirm the authenticated account is allowed to use this operation.",
  ];

  if (/401|authentication|unauthori[sz]ed|credentials/.test(lower)) {
    title = "Authentication rejected";
    overview =
      "The endpoint responded, but it did not accept the supplied administrator credentials.";
    checks = [
      "Re-enter the administrator username and password.",
      "Confirm the account can obtain a bearer token from /login.",
    ];
  } else if (/403|forbidden|permission/.test(lower)) {
    title = "Administrator permission required";
    overview =
      "Authentication completed or reached the server, but this account cannot perform the requested action.";
    checks = [
      "Grant the account the required administrative API permission.",
      "Retry a read-only action to confirm the account's available scope.",
    ];
  } else if (/404|not found/.test(lower)) {
    title = "Administrative API route unavailable";
    overview =
      "The configured server does not expose one of the JSON routes required by this connector.";
    checks = [
      "Point the base URL at the API root (commonly ending in /api).",
      "Verify that /login and /system/info are installed and enabled.",
    ];
  } else if (/timeout|timed out|408/.test(lower)) {
    title = "Roundcube endpoint timed out";
    overview =
      "The server did not complete the request before the configured timeout.";
    checks = [
      "Verify routing, firewall, proxy, and DNS connectivity.",
      "Increase the timeout only after confirming the endpoint is reachable.",
    ];
  } else if (/certificate|tls|ssl|unknown issuer/.test(lower)) {
    title = "TLS certificate validation failed";
    overview =
      "The endpoint was reached, but its certificate could not be trusted.";
    checks = [
      "Install the correct CA chain or use a certificate matching the host.",
      "Use the insecure certificate bypass only for a controlled test system.",
    ];
  } else if (/parse|json|deserialize|expected/.test(lower)) {
    title = "Incompatible API response";
    overview =
      "The endpoint responded, but its payload did not match the administrative API contract expected by this connector.";
    checks = [
      "Confirm the API/plugin version is compatible with this client.",
      "Inspect the original error below for the response parsing detail.",
    ];
  }

  return (
    <div
      role="alert"
      className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-400"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{title}</p>
          <p className="mt-1 text-[var(--color-textSecondary)]">{overview}</p>
        </div>
        <button className={button} onClick={onDismiss}>
          Dismiss
        </button>
      </div>
      <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[var(--color-textSecondary)]">
        {checks.map((check) => (
          <li key={check}>{check}</li>
        ))}
      </ul>
      <details className="mt-2">
        <summary className="cursor-pointer">Technical detail</summary>
        <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[10px]">
          {message}
        </pre>
      </details>
    </div>
  );
}

interface ConnectFormState {
  baseUrl: string;
  username: string;
  password: string;
  timeoutSecs: string;
  tlsSkipVerify: boolean;
  name: string;
}

const emptyConnectForm: ConnectFormState = {
  baseUrl: "https://roundcube.example.com/api",
  username: "",
  password: "",
  timeoutSecs: "30",
  tlsSkipVerify: false,
  name: "",
};

const ConnectForm: React.FC<{
  manager: RoundcubeManager;
  instanceId?: string;
}> = ({ manager, instanceId }) => {
  const { t } = useTranslation();
  const store = useIntegrationConfigStore();
  const { readSecret } = store;
  const instances = store.instancesFor(INTEGRATION_KEY);
  const [form, setForm] = useState<ConnectFormState>(emptyConnectForm);
  const [savedId, setSavedId] = useState<string | undefined>(undefined);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const draftId = useRef(generateId());
  const hydration = useRef(0);
  const hydratedInstanceId = useRef<string | undefined>(undefined);
  const initialSelectionHandled = useRef(false);

  const populate = useCallback(
    async (instance: IntegrationInstance) => {
      const generation = hydration.current + 1;
      hydration.current = generation;
      hydratedInstanceId.current = instance.id;
      setSavedId(instance.id);
      setSaveError(null);
      setForm({
        baseUrl: instance.host ?? emptyConnectForm.baseUrl,
        username: instance.fields?.username ?? "",
        password: "",
        timeoutSecs: instance.fields?.timeoutSecs ?? "30",
        tlsSkipVerify: instance.fields?.tlsSkipVerify === "true",
        name: instance.name,
      });
      const password = await readSecret(instance);
      if (hydration.current === generation && password) {
        setForm((current) => ({ ...current, password }));
      }
    },
    [readSecret],
  );

  useEffect(() => {
    if (store.isLoading) return;
    const requested = instanceId
      ? instances.find((candidate) => candidate.id === instanceId)
      : undefined;
    if (requested) {
      if (hydratedInstanceId.current !== requested.id) {
        void populate(requested);
      }
      return;
    }
    if (
      instanceId &&
      (!initialSelectionHandled.current ||
        hydratedInstanceId.current !== undefined)
    ) {
      // MailServerPanel passes its own saved instance id to every sub-tab.
      // A non-Roundcube id is only parent context; it must never become the
      // native connection id or an update target for this integration.
      hydration.current += 1;
      hydratedInstanceId.current = undefined;
      initialSelectionHandled.current = true;
      draftId.current = generateId();
      setSavedId(undefined);
      setSaveError(null);
      setForm(emptyConnectForm);
      return;
    }
    if (!instanceId && !initialSelectionHandled.current) {
      initialSelectionHandled.current = true;
      if (instances.length > 0) void populate(instances[0]);
    }
  }, [instanceId, instances, populate, store.isLoading]);

  const set = <Key extends keyof ConnectFormState>(
    key: Key,
    value: ConnectFormState[Key],
  ) => setForm((current) => ({ ...current, [key]: value }));

  const validate = (): boolean => {
    try {
      const parsed = new URL(form.baseUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("unsupported scheme");
      }
    } catch {
      manager.setError(
        "Enter a complete HTTP or HTTPS administrative API base URL.",
      );
      return false;
    }
    if (!form.username.trim() || !form.password) {
      manager.setError("Administrator username and password are required.");
      return false;
    }
    return true;
  };

  const doConnect = useCallback(async () => {
    if (!validate()) return;
    const timeout = Number(form.timeoutSecs);
    await manager.connect(savedId ?? draftId.current, {
      base_url: form.baseUrl.trim().replace(/\/+$/, ""),
      username: form.username.trim(),
      password: form.password,
      timeout_secs:
        Number.isFinite(timeout) && timeout > 0 ? timeout : undefined,
      tls_skip_verify: form.tlsSkipVerify,
    });
    // `validate` is intentionally local to the current form snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-deps
  }, [form, manager, savedId]);

  const doSave = useCallback(async () => {
    setSaveError(null);
    setIsSaving(true);
    const fields = {
      username: form.username.trim(),
      timeoutSecs: form.timeoutSecs,
      tlsSkipVerify: String(form.tlsSkipVerify),
    };
    try {
      if (savedId) {
        await store.updateInstance(savedId, {
          name: form.name.trim() || form.baseUrl,
          host: form.baseUrl.trim(),
          fields,
          ...(form.password ? { secret: form.password } : {}),
        });
      } else {
        const created = await store.createInstance({
          id: draftId.current,
          integrationKey: INTEGRATION_KEY,
          name: form.name.trim() || form.baseUrl,
          host: form.baseUrl.trim(),
          fields,
          secret: form.password || undefined,
        });
        setSavedId(created.id);
        draftId.current = generateId();
      }
    } catch (error) {
      setSaveError(messageOf(error));
    } finally {
      setIsSaving(false);
    }
  }, [form, savedId, store]);

  const newInstance = () => {
    hydration.current += 1;
    hydratedInstanceId.current = undefined;
    initialSelectionHandled.current = true;
    draftId.current = generateId();
    setSavedId(undefined);
    setSaveError(null);
    setForm(emptyConnectForm);
  };

  const deleteInstance = useCallback(async () => {
    if (!savedId) return;
    if (
      !window.confirm(
        t(
          `${K}.deleteInstanceConfirm`,
          "Delete this saved Roundcube instance and its vaulted password?",
        ),
      )
    ) {
      return;
    }
    setIsSaving(true);
    try {
      await store.deleteInstance(savedId);
      newInstance();
    } catch (error) {
      setSaveError(messageOf(error));
    } finally {
      setIsSaving(false);
    }
  }, [savedId, store, t]);

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-[var(--color-textSecondary)]">
        <div className="flex gap-2">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <p>
            {t(
              `${K}.apiRequirement`,
              "Compatibility requirement: this connector needs the Roundcube administrative JSON API expected at /login, /system/info, and the management routes beneath the configured base URL. A deployment without those routes is not supported by this tab.",
            )}
          </p>
        </div>
      </div>

      <div className={card}>
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <Labeled label={t(`${K}.savedInstance`, "Saved instance")}>
            <select
              className={field}
              value={savedId ?? ""}
              onChange={(event) => {
                const instance = instances.find(
                  (candidate) => candidate.id === event.target.value,
                );
                if (instance) void populate(instance);
                else newInstance();
              }}
            >
              <option value="">New instance</option>
              {instances.map((instance) => (
                <option key={instance.id} value={instance.id}>
                  {instance.name}
                </option>
              ))}
            </select>
          </Labeled>
          <button className={button} onClick={newInstance}>
            New
          </button>
          {savedId && (
            <button
              className={button}
              onClick={() => void deleteInstance()}
              disabled={isSaving}
            >
              <Trash2 size={12} />
              Delete saved
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Labeled label={t(`${K}.baseUrl`, "Administrative API base URL")}>
            <input
              data-testid="roundcube-base-url"
              className={field}
              value={form.baseUrl}
              onChange={(event) => set("baseUrl", event.target.value)}
              placeholder="https://roundcube.example.com/api"
            />
          </Labeled>
          <Labeled label={t(`${K}.instanceName`, "Saved name")}>
            <input
              className={field}
              value={form.name}
              onChange={(event) => set("name", event.target.value)}
              placeholder="Production webmail"
            />
          </Labeled>
          <Labeled label={t(`${K}.username`, "Administrator username")}>
            <input
              data-testid="roundcube-username"
              className={field}
              autoComplete="username"
              value={form.username}
              onChange={(event) => set("username", event.target.value)}
            />
          </Labeled>
          <Labeled label={t(`${K}.password`, "Administrator password")}>
            <input
              data-testid="roundcube-password"
              className={field}
              type="password"
              autoComplete="current-password"
              value={form.password}
              onChange={(event) => set("password", event.target.value)}
            />
          </Labeled>
          <Labeled label={t(`${K}.timeout`, "Request timeout (seconds)")}>
            <input
              className={field}
              inputMode="numeric"
              value={form.timeoutSecs}
              onChange={(event) => set("timeoutSecs", event.target.value)}
            />
          </Labeled>
          <label className="flex items-center gap-2 self-end py-1 text-xs text-[var(--color-textSecondary)]">
            <input
              type="checkbox"
              checked={form.tlsSkipVerify}
              onChange={(event) => set("tlsSkipVerify", event.target.checked)}
            />
            {t(`${K}.skipTls`, "Insecure: accept an invalid TLS certificate")}
          </label>
        </div>

        {form.tlsSkipVerify && (
          <p className="mt-2 text-xs text-amber-500">
            Certificate and hostname verification will be disabled for this
            connection. Do not use this setting on an untrusted network.
          </p>
        )}
        {(saveError || store.error) && (
          <p className="mt-2 text-xs text-red-400">
            Could not persist this instance: {saveError ?? store.error}
          </p>
        )}
        <p className="mt-2 text-[10px] text-[var(--color-textMuted)]">
          The password is stored separately in the operating-system vault; it is
          never written into the integration configuration record.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className={button}
            onClick={() => void doConnect()}
            disabled={manager.isConnecting}
          >
            {manager.isConnecting ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Plug size={12} />
            )}
            {manager.isConnecting ? "Connecting…" : "Connect"}
          </button>
          <button
            className={button}
            onClick={() => void doSave()}
            disabled={isSaving || !form.baseUrl.trim()}
          >
            {isSaving ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Save size={12} />
            )}
            Save instance
          </button>
        </div>
      </div>
    </div>
  );
};

async function loadSettled(tasks: Array<() => Promise<void>>): Promise<void> {
  const results = await Promise.allSettled(tasks.map((task) => task()));
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failure) throw failure.reason;
}

const OverviewSection: React.FC<{
  manager: RoundcubeManager;
  connectionId: string;
}> = ({ manager, connectionId }) => {
  const { api, refreshSummary, run } = manager;
  const [system, setSystem] = useState<RoundcubeSystemConfig | null>(null);
  const [quota, setQuota] = useState<RoundcubeQuota | null>(null);
  const [cache, setCache] = useState<RoundcubeCacheStats | null>(null);
  const [database, setDatabase] = useState<RoundcubeDbStats | null>(null);

  const refresh = useCallback(async () => {
    try {
      await run(() =>
        loadSettled([
          async () => setSystem(await api.getSystemConfig(connectionId)),
          async () => setQuota(await api.getQuota(connectionId)),
          async () => setCache(await api.getCacheStats(connectionId)),
          async () => setDatabase(await api.getDbStats(connectionId)),
        ]),
      );
      await refreshSummary();
    } catch {
      // The successful cards stay visible; the failed route is explained above.
    }
  }, [api, connectionId, refreshSummary, run]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <button
          className={button}
          onClick={() => void refresh()}
          disabled={manager.isLoading}
        >
          <RefreshCw size={12} />
          Refresh overview
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="Product" value={system?.product_name} />
        <Stat label="Skin" value={system?.skin ?? manager.summary?.skin} />
        <Stat label="Users' messages" value={quota?.used_messages} />
        <Stat
          label="Quota used"
          value={
            quota?.used_bytes == null
              ? null
              : `${(quota.used_bytes / 1024 / 1024).toFixed(1)} MiB`
          }
        />
        <Stat label="Cache entries" value={cache?.total_entries} />
        <Stat label="Expired cache" value={cache?.expired_entries} />
        <Stat label="Database tables" value={database?.tables_count} />
        <Stat label="Active sessions" value={database?.sessions_count} />
      </div>
    </div>
  );
};

const UsersSection: React.FC<{
  manager: RoundcubeManager;
  connectionId: string;
}> = ({ manager, connectionId }) => {
  const { api, run } = manager;
  const [users, setUsers] = useState<RoundcubeUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<RoundcubeUser | null>(null);
  const [identities, setIdentities] = useState<RoundcubeIdentity[]>([]);
  const [userForm, setUserForm] = useState({
    username: "",
    mailHost: "",
    language: "",
  });
  const [identityForm, setIdentityForm] = useState({ name: "", email: "" });

  const refresh = useCallback(async () => {
    try {
      setUsers(await run(() => api.listUsers(connectionId)));
    } catch {
      // surfaced by manager
    }
  }, [api, connectionId, run]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createUser = useCallback(async () => {
    if (!userForm.username.trim()) return;
    try {
      await manager.run(() =>
        manager.api.createUser(connectionId, {
          username: userForm.username.trim(),
          mail_host: userForm.mailHost.trim() || null,
          language: userForm.language.trim() || null,
        }),
      );
      setUserForm({ username: "", mailHost: "", language: "" });
      await refresh();
    } catch {
      // surfaced by manager
    }
  }, [connectionId, manager, refresh, userForm]);

  const deleteUser = useCallback(
    async (user: RoundcubeUser) => {
      if (!window.confirm(`Delete Roundcube user "${user.username}"?`)) return;
      try {
        await manager.run(() => manager.api.deleteUser(connectionId, user.id));
        if (selectedUser?.id === user.id) {
          setSelectedUser(null);
          setIdentities([]);
        }
        await refresh();
      } catch {
        // surfaced by manager
      }
    },
    [connectionId, manager, refresh, selectedUser],
  );

  const inspectUser = useCallback(
    async (user: RoundcubeUser) => {
      setSelectedUser(user);
      try {
        setIdentities(
          await manager.run(() =>
            manager.api.listIdentities(connectionId, user.id),
          ),
        );
      } catch {
        setIdentities([]);
      }
    },
    [connectionId, manager],
  );

  const createIdentity = useCallback(async () => {
    if (
      !selectedUser ||
      !identityForm.name.trim() ||
      !identityForm.email.trim()
    ) {
      return;
    }
    try {
      await manager.run(() =>
        manager.api.createIdentity(connectionId, selectedUser.id, {
          name: identityForm.name.trim(),
          email: identityForm.email.trim(),
        }),
      );
      setIdentityForm({ name: "", email: "" });
      setIdentities(
        await manager.api.listIdentities(connectionId, selectedUser.id),
      );
    } catch {
      // surfaced by manager
    }
  }, [connectionId, identityForm, manager, selectedUser]);

  const deleteIdentity = useCallback(
    async (identity: RoundcubeIdentity) => {
      if (!selectedUser) return;
      if (!window.confirm(`Delete identity "${identity.email}"?`)) return;
      try {
        await manager.run(() =>
          manager.api.deleteIdentity(
            connectionId,
            selectedUser.id,
            identity.id,
          ),
        );
        setIdentities(
          await manager.api.listIdentities(connectionId, selectedUser.id),
        );
      } catch {
        // surfaced by manager
      }
    },
    [connectionId, manager, selectedUser],
  );

  const makeDefault = useCallback(
    async (identity: RoundcubeIdentity) => {
      if (!selectedUser) return;
      try {
        await manager.run(() =>
          manager.api.setDefaultIdentity(
            connectionId,
            selectedUser.id,
            identity.id,
          ),
        );
        setIdentities(
          await manager.api.listIdentities(connectionId, selectedUser.id),
        );
      } catch {
        // surfaced by manager
      }
    },
    [connectionId, manager, selectedUser],
  );

  return (
    <div className="grid min-h-0 gap-3 xl:grid-cols-2">
      <div className={card}>
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-xs font-semibold text-[var(--color-text)]">
            Users
          </h4>
          <button
            className={button}
            onClick={() => void refresh()}
            disabled={manager.isLoading}
          >
            <RefreshCw size={12} />
            Refresh
          </button>
        </div>
        <div className="mb-3 grid gap-2 sm:grid-cols-3">
          <input
            data-testid="roundcube-new-user"
            className={field}
            placeholder="username"
            value={userForm.username}
            onChange={(event) =>
              setUserForm((current) => ({
                ...current,
                username: event.target.value,
              }))
            }
          />
          <input
            className={field}
            placeholder="mail host (optional)"
            value={userForm.mailHost}
            onChange={(event) =>
              setUserForm((current) => ({
                ...current,
                mailHost: event.target.value,
              }))
            }
          />
          <div className="flex gap-1">
            <input
              className={field}
              placeholder="language"
              value={userForm.language}
              onChange={(event) =>
                setUserForm((current) => ({
                  ...current,
                  language: event.target.value,
                }))
              }
            />
            <button
              className={button}
              onClick={() => void createUser()}
              disabled={!userForm.username.trim() || manager.isLoading}
            >
              Add
            </button>
          </div>
        </div>
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-[var(--color-surfaceHover)] text-[var(--color-textMuted)]">
              <tr>
                <th className="px-2 py-1">Username</th>
                <th className="px-2 py-1">Mail host</th>
                <th className="px-2 py-1">Last login</th>
                <th className="px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr
                  key={user.id}
                  className="border-t border-[var(--color-border)]"
                >
                  <td className="px-2 py-1 font-medium text-[var(--color-text)]">
                    {user.username}
                  </td>
                  <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                    {user.mail_host ?? "—"}
                  </td>
                  <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                    {user.last_login ?? "—"}
                  </td>
                  <td className="px-2 py-1">
                    <div className="flex justify-end gap-1">
                      <button
                        className={button}
                        onClick={() => void inspectUser(user)}
                      >
                        Identities
                      </button>
                      <button
                        className={button}
                        aria-label={`Delete ${user.username}`}
                        onClick={() => void deleteUser(user)}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td
                    className="px-2 py-4 text-center text-[var(--color-textMuted)]"
                    colSpan={4}
                  >
                    No users returned by the API.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className={card}>
        <h4 className="mb-3 text-xs font-semibold text-[var(--color-text)]">
          {selectedUser
            ? `Identities for ${selectedUser.username}`
            : "Select a user to manage identities"}
        </h4>
        {selectedUser && (
          <>
            <div className="mb-3 flex gap-2">
              <input
                className={field}
                placeholder="Display name"
                value={identityForm.name}
                onChange={(event) =>
                  setIdentityForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
              <input
                className={field}
                placeholder="email@example.com"
                value={identityForm.email}
                onChange={(event) =>
                  setIdentityForm((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
              />
              <button
                className={button}
                onClick={() => void createIdentity()}
                disabled={
                  !identityForm.name.trim() ||
                  !identityForm.email.trim() ||
                  manager.isLoading
                }
              >
                Add
              </button>
            </div>
            <div className="space-y-1">
              {identities.map((identity) => (
                <div
                  key={identity.id}
                  className="flex items-center justify-between rounded border border-[var(--color-border)] px-2 py-1 text-xs"
                >
                  <span className="text-[var(--color-text)]">
                    {identity.name} &lt;{identity.email}&gt;
                    {identity.is_standard ? " (default)" : ""}
                  </span>
                  <div className="flex gap-1">
                    {!identity.is_standard && (
                      <button
                        className={button}
                        onClick={() => void makeDefault(identity)}
                      >
                        Make default
                      </button>
                    )}
                    <button
                      className={button}
                      aria-label={`Delete ${identity.email}`}
                      onClick={() => void deleteIdentity(identity)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const flattenFolders = (
  folders: RoundcubeFolder[],
  depth = 0,
): Array<{ folder: RoundcubeFolder; depth: number }> =>
  folders.flatMap((folder) => [
    { folder, depth },
    ...flattenFolders(folder.children ?? [], depth + 1),
  ]);

const FoldersSection: React.FC<{
  manager: RoundcubeManager;
  connectionId: string;
}> = ({ manager, connectionId }) => {
  const { api, run } = manager;
  const [folders, setFolders] = useState<RoundcubeFolder[]>([]);
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const rows = useMemo(() => flattenFolders(folders), [folders]);

  const refresh = useCallback(async () => {
    try {
      setFolders(await run(() => api.listFolders(connectionId)));
    } catch {
      // surfaced by manager
    }
  }, [api, connectionId, run]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(async () => {
    if (!name.trim()) return;
    try {
      await manager.run(() =>
        manager.api.createFolder(connectionId, {
          name: name.trim(),
          parent: parent.trim() || null,
        }),
      );
      setName("");
      setParent("");
      await refresh();
    } catch {
      // surfaced by manager
    }
  }, [connectionId, manager, name, parent, refresh]);

  const toggleSubscription = useCallback(
    async (folder: RoundcubeFolder) => {
      try {
        await manager.run(() =>
          folder.subscribed
            ? manager.api.unsubscribeFolder(connectionId, folder.name)
            : manager.api.subscribeFolder(connectionId, folder.name),
        );
        await refresh();
      } catch {
        // surfaced by manager
      }
    },
    [connectionId, manager, refresh],
  );

  const remove = useCallback(
    async (folder: RoundcubeFolder) => {
      if (!window.confirm(`Delete mail folder "${folder.name}"?`)) return;
      try {
        await manager.run(() =>
          manager.api.deleteFolder(connectionId, folder.name),
        );
        await refresh();
      } catch {
        // surfaced by manager
      }
    },
    [connectionId, manager, refresh],
  );

  const purge = useCallback(
    async (folder: RoundcubeFolder) => {
      if (
        !window.confirm(
          `Permanently purge every message from "${folder.name}"?`,
        )
      ) {
        return;
      }
      try {
        await manager.run(() =>
          manager.api.purgeFolder(connectionId, folder.name),
        );
        await refresh();
      } catch {
        // surfaced by manager
      }
    },
    [connectionId, manager, refresh],
  );

  return (
    <div className={card}>
      <div className="mb-3 flex flex-wrap gap-2">
        <input
          data-testid="roundcube-folder-name"
          className={field}
          style={{ width: 220 }}
          placeholder="New folder"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <input
          className={field}
          style={{ width: 220 }}
          placeholder="Parent (optional)"
          value={parent}
          onChange={(event) => setParent(event.target.value)}
        />
        <button
          className={button}
          onClick={() => void create()}
          disabled={!name.trim() || manager.isLoading}
        >
          Create
        </button>
        <button
          className={button}
          onClick={() => void refresh()}
          disabled={manager.isLoading}
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>
      <div className="space-y-1">
        {rows.map(({ folder, depth }) => (
          <div
            key={folder.name}
            className="flex items-center justify-between rounded border border-[var(--color-border)] px-2 py-1 text-xs"
          >
            <span
              className="text-[var(--color-text)]"
              style={{ paddingLeft: depth * 16 }}
            >
              {folder.name}
              <span className="ml-2 text-[var(--color-textMuted)]">
                {folder.exists ?? 0} messages · {folder.unseen ?? 0} unseen
              </span>
            </span>
            <div className="flex gap-1">
              <button
                className={button}
                onClick={() => void toggleSubscription(folder)}
              >
                {folder.subscribed ? "Unsubscribe" : "Subscribe"}
              </button>
              <button className={button} onClick={() => void purge(folder)}>
                Purge
              </button>
              <button
                className={button}
                aria-label={`Delete ${folder.name}`}
                onClick={() => void remove(folder)}
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="py-4 text-center text-xs text-[var(--color-textMuted)]">
            No folders returned by the API.
          </p>
        )}
      </div>
    </div>
  );
};

const FiltersSection: React.FC<{
  manager: RoundcubeManager;
  connectionId: string;
}> = ({ manager, connectionId }) => {
  const { api, run } = manager;
  const [filters, setFilters] = useState<RoundcubeFilter[]>([]);
  const [name, setName] = useState("");

  const refresh = useCallback(async () => {
    try {
      setFilters(await run(() => api.listFilters(connectionId)));
    } catch {
      // surfaced by manager
    }
  }, [api, connectionId, run]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(async () => {
    if (!name.trim()) return;
    try {
      await manager.run(() =>
        manager.api.createFilter(connectionId, {
          name: name.trim(),
          enabled: false,
          conditions: [],
          actions: [],
          join_type: "all",
        }),
      );
      setName("");
      await refresh();
    } catch {
      // surfaced by manager
    }
  }, [connectionId, manager, name, refresh]);

  const toggle = useCallback(
    async (filter: RoundcubeFilter) => {
      try {
        await manager.run(() =>
          filter.enabled
            ? manager.api.disableFilter(connectionId, filter.id)
            : manager.api.enableFilter(connectionId, filter.id),
        );
        await refresh();
      } catch {
        // surfaced by manager
      }
    },
    [connectionId, manager, refresh],
  );

  const remove = useCallback(
    async (filter: RoundcubeFilter) => {
      if (!window.confirm(`Delete filter "${filter.name}"?`)) return;
      try {
        await manager.run(() =>
          manager.api.deleteFilter(connectionId, filter.id),
        );
        await refresh();
      } catch {
        // surfaced by manager
      }
    },
    [connectionId, manager, refresh],
  );

  return (
    <div className={card}>
      <div className="mb-3 flex flex-wrap gap-2">
        <input
          className={field}
          style={{ width: 260 }}
          placeholder="New disabled filter"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button
          className={button}
          onClick={() => void create()}
          disabled={!name.trim() || manager.isLoading}
        >
          Create
        </button>
        <button
          className={button}
          onClick={() => void refresh()}
          disabled={manager.isLoading}
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>
      <div className="space-y-1">
        {filters.map((filter) => (
          <div
            key={filter.id}
            className="flex items-center justify-between rounded border border-[var(--color-border)] px-2 py-1 text-xs"
          >
            <span className="text-[var(--color-text)]">
              {filter.name}
              <span className="ml-2 text-[var(--color-textMuted)]">
                {filter.conditions.length} conditions · {filter.actions.length}{" "}
                actions
              </span>
            </span>
            <div className="flex gap-1">
              <button className={button} onClick={() => void toggle(filter)}>
                {filter.enabled ? "Disable" : "Enable"}
              </button>
              <button
                className={button}
                aria-label={`Delete ${filter.name}`}
                onClick={() => void remove(filter)}
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const PluginsSection: React.FC<{
  manager: RoundcubeManager;
  connectionId: string;
}> = ({ manager, connectionId }) => {
  const { api, run } = manager;
  const [plugins, setPlugins] = useState<RoundcubePlugin[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [settingsText, setSettingsText] = useState("{}");

  const refresh = useCallback(async () => {
    try {
      setPlugins(await run(() => api.listPlugins(connectionId)));
    } catch {
      // surfaced by manager
    }
  }, [api, connectionId, run]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = useCallback(
    async (plugin: RoundcubePlugin) => {
      try {
        await manager.run(() =>
          plugin.enabled
            ? manager.api.disablePlugin(connectionId, plugin.name)
            : manager.api.enablePlugin(connectionId, plugin.name),
        );
        await refresh();
      } catch {
        // surfaced by manager
      }
    },
    [connectionId, manager, refresh],
  );

  const inspect = useCallback(
    async (plugin: RoundcubePlugin) => {
      setSelected(plugin.name);
      try {
        const config = await manager.run(() =>
          manager.api.getPluginConfig(connectionId, plugin.name),
        );
        setSettingsText(JSON.stringify(config.settings, null, 2));
      } catch {
        setSettingsText("{}");
      }
    },
    [connectionId, manager],
  );

  const save = useCallback(async () => {
    if (!selected) return;
    try {
      const parsed: unknown = JSON.parse(settingsText);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Plugin settings must be a JSON object.");
      }
      await manager.run(() =>
        manager.api.updatePluginConfig(
          connectionId,
          selected,
          parsed as Record<string, unknown>,
        ),
      );
    } catch (error) {
      manager.setError(messageOf(error));
    }
  }, [connectionId, manager, selected, settingsText]);

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <div className={card}>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-xs font-semibold text-[var(--color-text)]">
            Installed plugins
          </h4>
          <button
            className={button}
            onClick={() => void refresh()}
            disabled={manager.isLoading}
          >
            <RefreshCw size={12} />
            Refresh
          </button>
        </div>
        <div className="space-y-1">
          {plugins.map((plugin) => (
            <div
              key={plugin.name}
              className="flex items-center justify-between rounded border border-[var(--color-border)] px-2 py-1 text-xs"
            >
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() => void inspect(plugin)}
              >
                <span className="text-[var(--color-text)]">{plugin.name}</span>
                <span className="ml-2 text-[var(--color-textMuted)]">
                  {plugin.version ?? ""}
                </span>
              </button>
              <button className={button} onClick={() => void toggle(plugin)}>
                {plugin.enabled ? "Disable" : "Enable"}
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className={card}>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-xs font-semibold text-[var(--color-text)]">
            {selected ? `${selected} settings` : "Select a plugin"}
          </h4>
          <button
            className={button}
            onClick={() => void save()}
            disabled={!selected || manager.isLoading}
          >
            <Save size={12} />
            Save JSON
          </button>
        </div>
        <textarea
          className={`${field} font-mono text-xs`}
          rows={16}
          value={settingsText}
          disabled={!selected}
          onChange={(event) => setSettingsText(event.target.value)}
        />
      </div>
    </div>
  );
};

const SettingsSection: React.FC<{
  manager: RoundcubeManager;
  connectionId: string;
}> = ({ manager, connectionId }) => {
  const { api, run } = manager;
  const [system, setSystem] = useState<RoundcubeSystemConfig | null>(null);
  const [smtp, setSmtp] = useState<RoundcubeSmtpConfig | null>(null);
  const [newSmtpPassword, setNewSmtpPassword] = useState("");

  const refresh = useCallback(async () => {
    try {
      await run(() =>
        loadSettled([
          async () => setSystem(await api.getSystemConfig(connectionId)),
          async () => {
            const value = await api.getSmtpConfig(connectionId);
            // Retain the returned value in memory so saving unrelated SMTP
            // fields does not blindly replace it with null. It is never
            // rendered into the form.
            setSmtp(value);
          },
        ]),
      );
      setNewSmtpPassword("");
    } catch {
      // surfaced by manager
    }
  }, [api, connectionId, run]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveSystem = useCallback(async () => {
    if (!system) return;
    try {
      setSystem(
        await manager.run(() =>
          manager.api.updateSystemConfig(connectionId, system),
        ),
      );
    } catch {
      // surfaced by manager
    }
  }, [connectionId, manager, system]);

  const saveSmtp = useCallback(async () => {
    if (!smtp) return;
    try {
      const updated = await manager.run(() =>
        manager.api.updateSmtpConfig(connectionId, {
          ...smtp,
          pass: newSmtpPassword || smtp.pass,
        }),
      );
      setSmtp(updated);
      setNewSmtpPassword("");
    } catch {
      // surfaced by manager
    }
  }, [connectionId, manager, newSmtpPassword, smtp]);

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <div className={card}>
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-xs font-semibold text-[var(--color-text)]">
            System configuration
          </h4>
          <button
            className={button}
            onClick={() => void saveSystem()}
            disabled={!system || manager.isLoading}
          >
            <Save size={12} />
            Save
          </button>
        </div>
        {system && (
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["product_name", "Product name"],
                ["skin", "Skin"],
                ["default_host", "Default IMAP host"],
                ["smtp_server", "SMTP server"],
                ["support_url", "Support URL"],
              ] as const
            ).map(([key, label]) => (
              <Labeled key={key} label={label}>
                <input
                  className={field}
                  value={system[key] ?? ""}
                  onChange={(event) =>
                    setSystem({ ...system, [key]: event.target.value || null })
                  }
                />
              </Labeled>
            ))}
            <Labeled label="Default IMAP port">
              <input
                className={field}
                inputMode="numeric"
                value={system.default_port ?? ""}
                onChange={(event) =>
                  setSystem({
                    ...system,
                    default_port: event.target.value
                      ? Number(event.target.value)
                      : null,
                  })
                }
              />
            </Labeled>
            <Labeled label="SMTP port">
              <input
                className={field}
                inputMode="numeric"
                value={system.smtp_port ?? ""}
                onChange={(event) =>
                  setSystem({
                    ...system,
                    smtp_port: event.target.value
                      ? Number(event.target.value)
                      : null,
                  })
                }
              />
            </Labeled>
          </div>
        )}
      </div>

      <div className={card}>
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-xs font-semibold text-[var(--color-text)]">
            SMTP transport
          </h4>
          <button
            className={button}
            onClick={() => void saveSmtp()}
            disabled={!smtp || manager.isLoading}
          >
            <Save size={12} />
            Save
          </button>
        </div>
        {smtp && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Labeled label="Server">
              <input
                className={field}
                value={smtp.server ?? ""}
                onChange={(event) =>
                  setSmtp({ ...smtp, server: event.target.value || null })
                }
              />
            </Labeled>
            <Labeled label="Port">
              <input
                className={field}
                inputMode="numeric"
                value={smtp.port ?? ""}
                onChange={(event) =>
                  setSmtp({
                    ...smtp,
                    port: event.target.value
                      ? Number(event.target.value)
                      : null,
                  })
                }
              />
            </Labeled>
            <Labeled label="Username">
              <input
                className={field}
                value={smtp.user ?? ""}
                onChange={(event) =>
                  setSmtp({ ...smtp, user: event.target.value || null })
                }
              />
            </Labeled>
            <Labeled label="Authentication type">
              <input
                className={field}
                value={smtp.auth_type ?? ""}
                onChange={(event) =>
                  setSmtp({ ...smtp, auth_type: event.target.value || null })
                }
              />
            </Labeled>
            <Labeled label="New SMTP password (optional)">
              <input
                className={field}
                type="password"
                value={newSmtpPassword}
                onChange={(event) => setNewSmtpPassword(event.target.value)}
              />
            </Labeled>
          </div>
        )}
        <p className="mt-2 text-[10px] text-[var(--color-textMuted)]">
          Existing SMTP passwords are intentionally not rendered. Leave the new
          password blank unless you intend to replace it.
        </p>
      </div>
    </div>
  );
};

const OperationsSection: React.FC<{
  manager: RoundcubeManager;
  connectionId: string;
}> = ({ manager, connectionId }) => {
  const { api, run } = manager;
  const [logs, setLogs] = useState<RoundcubeLogEntry[]>([]);
  const [level, setLevel] = useState("");
  const [limit, setLimit] = useState("100");
  const [testAddress, setTestAddress] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    try {
      const parsedLimit = Number(limit);
      setLogs(
        await run(() =>
          api.getLogs(
            connectionId,
            Number.isFinite(parsedLimit) && parsedLimit > 0
              ? parsedLimit
              : undefined,
            level.trim() || undefined,
          ),
        ),
      );
    } catch {
      // surfaced by manager
    }
  }, [api, connectionId, level, limit, run]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  const confirmedOperation = useCallback(
    async (label: string, operation: () => Promise<void>) => {
      if (!window.confirm(`${label}?`)) return;
      try {
        await manager.run(operation);
      } catch {
        // surfaced by manager
      }
    },
    [manager],
  );

  const testSmtp = useCallback(async () => {
    if (!testAddress.trim()) return;
    try {
      const ok = await manager.run(() =>
        manager.api.testSmtp(connectionId, testAddress.trim()),
      );
      setTestResult(
        ok
          ? "The Roundcube API reported a successful SMTP test."
          : "The Roundcube API completed the test but reported failure.",
      );
    } catch {
      setTestResult(null);
    }
  }, [connectionId, manager, testAddress]);

  return (
    <div className="grid gap-3 xl:grid-cols-[2fr_1fr]">
      <div className={card}>
        <div className="mb-3 flex flex-wrap gap-2">
          <select
            className={field}
            style={{ width: 150 }}
            value={level}
            onChange={(event) => setLevel(event.target.value)}
          >
            <option value="">All levels</option>
            <option value="error">Error</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
            <option value="debug">Debug</option>
          </select>
          <input
            className={field}
            style={{ width: 100 }}
            inputMode="numeric"
            aria-label="Log limit"
            value={limit}
            onChange={(event) => setLimit(event.target.value)}
          />
          <button
            className={button}
            onClick={() => void loadLogs()}
            disabled={manager.isLoading}
          >
            <RefreshCw size={12} />
            Load logs
          </button>
        </div>
        <div className="max-h-[28rem] overflow-auto rounded bg-[var(--color-surface)] font-mono text-[10px]">
          {logs.map((entry, index) => (
            <div
              key={`${entry.timestamp ?? "entry"}-${index}`}
              className="grid grid-cols-[9rem_5rem_1fr] gap-2 border-b border-[var(--color-border)] px-2 py-1"
            >
              <span className="text-[var(--color-textMuted)]">
                {entry.timestamp ?? "—"}
              </span>
              <span className="uppercase text-[var(--color-textSecondary)]">
                {entry.level ?? "—"}
              </span>
              <span className="whitespace-pre-wrap text-[var(--color-text)]">
                {entry.message ?? ""}
              </span>
            </div>
          ))}
          {logs.length === 0 && (
            <p className="p-3 text-center text-[var(--color-textMuted)]">
              No log entries returned.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className={card}>
          <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
            Connectivity test
          </h4>
          <div className="flex gap-2">
            <input
              data-testid="roundcube-test-email"
              className={field}
              placeholder="recipient@example.com"
              value={testAddress}
              onChange={(event) => setTestAddress(event.target.value)}
            />
            <button
              className={button}
              onClick={() => void testSmtp()}
              disabled={!testAddress.trim() || manager.isLoading}
            >
              Test SMTP
            </button>
          </div>
          {testResult && (
            <p className="mt-2 text-xs text-[var(--color-textSecondary)]">
              {testResult}
            </p>
          )}
        </div>

        <div className={card}>
          <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
            Maintenance
          </h4>
          <div className="flex flex-wrap gap-2">
            <button
              className={button}
              onClick={() =>
                void confirmedOperation("Clear Roundcube cache", () =>
                  manager.api.clearCache(connectionId),
                )
              }
            >
              Clear cache
            </button>
            <button
              className={button}
              onClick={() =>
                void confirmedOperation("Clear temporary files", () =>
                  manager.api.clearTempFiles(connectionId),
                )
              }
            >
              Clear temp files
            </button>
            <button
              className={button}
              onClick={() =>
                void confirmedOperation("Clear expired sessions", () =>
                  manager.api.clearExpiredSessions(connectionId),
                )
              }
            >
              Clear expired sessions
            </button>
            <button
              className={button}
              onClick={() =>
                void confirmedOperation("Optimize the Roundcube database", () =>
                  manager.api.optimizeDb(connectionId),
                )
              }
            >
              Optimize database
            </button>
            <button
              className={button}
              onClick={() =>
                void confirmedOperation("Vacuum the Roundcube database", () =>
                  manager.api.vacuumDb(connectionId),
                )
              }
            >
              Vacuum database
            </button>
          </div>
          <p className="mt-2 text-[10px] text-[var(--color-textMuted)]">
            Maintenance actions are sent directly to the configured API and are
            never simulated locally. Confirm each action after reviewing its
            impact on your deployment.
          </p>
        </div>
      </div>
    </div>
  );
};

type SectionKey =
  | "overview"
  | "users"
  | "folders"
  | "filters"
  | "plugins"
  | "settings"
  | "operations";

const sections: Array<{
  key: SectionKey;
  label: string;
  icon: React.ComponentType<{ size?: number | string }>;
}> = [
  { key: "overview", label: "Overview", icon: Activity },
  { key: "users", label: "Users & identities", icon: Users },
  { key: "folders", label: "Folders", icon: Folder },
  { key: "filters", label: "Filters", icon: ListFilter },
  { key: "plugins", label: "Plugins", icon: Package },
  { key: "settings", label: "Settings", icon: Settings },
  { key: "operations", label: "Logs & maintenance", icon: Wrench },
];

const RoundcubeSubTab: React.FC<MailSubTabProps> = ({ instanceId }) => {
  const { t } = useTranslation();
  const manager = useRoundcube();
  const [section, setSection] = useState<SectionKey>("overview");
  const connectionId = manager.connectionId;

  const status = manager.isConnecting
    ? t(`${K}.connecting`, "Connecting")
    : manager.isConnected
      ? t(`${K}.connected`, "Connected")
      : t(`${K}.disconnected`, "Disconnected");

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
          <UserRound className="h-4 w-4 text-primary" />
          {t(`${K}.title`, "Roundcube Webmail")}
        </h3>
        <div className="flex items-center gap-2 text-xs">
          <span
            data-testid="roundcube-status"
            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 ${
              manager.isConnecting
                ? "bg-blue-500/15 text-blue-400"
                : manager.isConnected
                  ? "bg-green-500/15 text-green-500"
                  : "bg-[var(--color-border)] text-[var(--color-textSecondary)]"
            }`}
          >
            {manager.isConnecting ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <span
                className={`h-2 w-2 rounded-full ${
                  manager.isConnected
                    ? "bg-green-500"
                    : "bg-[var(--color-textMuted)]"
                }`}
              />
            )}
            {status}
          </span>
          {manager.summary?.version && (
            <span className="text-[var(--color-textMuted)]">
              v{manager.summary.version}
            </span>
          )}
          {manager.isConnected && (
            <>
              <button
                className={button}
                onClick={() => void manager.reconnect()}
                disabled={manager.isConnecting}
              >
                <RotateCw size={12} />
                Reconnect
              </button>
              <button
                className={button}
                onClick={() => void manager.disconnect()}
              >
                Disconnect
              </button>
            </>
          )}
        </div>
      </div>

      {manager.error && (
        <ErrorOverview message={manager.error} onDismiss={manager.clearError} />
      )}

      {!manager.isConnected || !connectionId ? (
        <ConnectForm manager={manager} instanceId={instanceId} />
      ) : (
        <>
          <div className="flex flex-wrap gap-1 border-b border-[var(--color-border)]">
            {sections.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                className={`inline-flex items-center gap-1 border-b-2 px-3 py-1.5 text-xs ${
                  section === key
                    ? "border-primary text-[var(--color-text)]"
                    : "border-transparent text-[var(--color-textSecondary)]"
                }`}
                onClick={() => setSection(key)}
              >
                <Icon size={12} />
                {label}
              </button>
            ))}
          </div>
          {manager.isLoading && (
            <div className="flex items-center gap-2 text-xs text-[var(--color-textMuted)]">
              <Loader2 size={12} className="animate-spin" />
              Waiting for the Roundcube administrative API…
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {section === "overview" && (
              <OverviewSection manager={manager} connectionId={connectionId} />
            )}
            {section === "users" && (
              <UsersSection manager={manager} connectionId={connectionId} />
            )}
            {section === "folders" && (
              <FoldersSection manager={manager} connectionId={connectionId} />
            )}
            {section === "filters" && (
              <FiltersSection manager={manager} connectionId={connectionId} />
            )}
            {section === "plugins" && (
              <PluginsSection manager={manager} connectionId={connectionId} />
            )}
            {section === "settings" && (
              <SettingsSection manager={manager} connectionId={connectionId} />
            )}
            {section === "operations" && (
              <OperationsSection
                manager={manager}
                connectionId={connectionId}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default RoundcubeSubTab;
