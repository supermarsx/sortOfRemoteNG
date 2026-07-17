// Grafana integration panel (t42-grafana).
//
// Full panel for the sorng-grafana crate — binds every one of the 46 Grafana
// commands registered in the Tauri handler (`sorng-commands-ops/src/ops_handler.rs`)
// through `useGrafana()` / `grafanaApi`. Connect form maps to `grafana_connect`
// (host + API key OR user/password + org id); sub-tabs cover dashboards,
// datasources, folders, organizations, users, teams, alert rules, annotations,
// playlists and snapshots.
//
// NOTE: the crate's `commands.rs` defines 10 additional functions (ping,
// save_dashboard, list_dashboard_versions, get_dashboard_tags, switch_org,
// get_current_user, set_user_admin, list_alert_notifications, list_panel_plugins,
// get_panel_plugin) that are NOT registered in the handler. They are a backend
// wiring gap (t42 plan R4) and are deliberately not surfaced here — calling them
// would fail at runtime.

import React, { useCallback, useEffect, useState } from "react";
import {
  BarChart3,
  Bell,
  Building2,
  Database,
  FileStack,
  Folder as FolderIcon,
  Camera,
  LayoutDashboard,
  Loader2,
  Plug,
  RefreshCw,
  Search,
  Tag,
  Trash2,
  Users,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useGrafana, type GrafanaManager } from "../../hooks/integration/useGrafana";
import { useIntegrationConfigStore } from "../../hooks/integrations/useIntegrationConfigStore";
import { generateId } from "../../utils/core/id";
import type {
  IntegrationDescriptor,
  IntegrationPanelProps,
} from "../../types/integrations/registry";
import type {
  AlertRule,
  Annotation,
  Dashboard,
  Datasource,
  Folder,
  GrafanaUser,
  Organization,
  Playlist,
  Snapshot,
  Team,
  TeamMember,
} from "../../types/grafana";

// ─── Shared UI helpers ───────────────────────────────────────────────────────

const field =
  "w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm text-[var(--color-text)]";
const btn =
  "app-bar-button inline-flex items-center gap-1 rounded px-2 py-1 text-xs disabled:opacity-50";
const card =
  "rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-3";

function Labeled({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
      <span>{label}</span>
      {children}
    </label>
  );
}

/** Collapsible raw-JSON viewer used by the "view / detail" actions. */
const JsonView: React.FC<{ value: unknown }> = ({ value }) =>
  value == null ? null : (
    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-[var(--color-surface)] p-2 font-mono text-[10px] text-[var(--color-textSecondary)]">
      {JSON.stringify(value, null, 2)}
    </pre>
  );

type TabKey =
  | "dashboards"
  | "datasources"
  | "folders"
  | "orgs"
  | "users"
  | "teams"
  | "alerts"
  | "annotations"
  | "playlists"
  | "snapshots";

// ─── Connect form ────────────────────────────────────────────────────────────

interface ConnectState {
  host: string;
  port: string;
  useTls: boolean;
  acceptInvalidCerts: boolean;
  authMode: "apiKey" | "basic";
  apiKey: string;
  username: string;
  password: string;
  orgId: string;
  timeoutSecs: string;
  name: string;
}

const emptyConnect: ConnectState = {
  host: "",
  port: "3000",
  useTls: false,
  acceptInvalidCerts: false,
  authMode: "apiKey",
  apiKey: "",
  username: "",
  password: "",
  orgId: "",
  timeoutSecs: "30",
  name: "",
};

const ConnectForm: React.FC<{ mgr: GrafanaManager; instanceId?: string }> = ({
  mgr,
  instanceId,
}) => {
  const { t } = useTranslation();
  const store = useIntegrationConfigStore();
  const [form, setForm] = useState<ConnectState>(emptyConnect);
  const [savedId, setSavedId] = useState<string | undefined>(instanceId);

  // Prefill from a persisted instance (host/fields + vault secret).
  useEffect(() => {
    if (!instanceId || store.isLoading) return;
    const inst = store.instances.find((i) => i.id === instanceId);
    if (!inst) return;
    setForm((f) => ({
      ...f,
      name: inst.name,
      host: inst.host ?? "",
      port: inst.fields?.port ?? "3000",
      useTls: inst.fields?.useTls === "true",
      acceptInvalidCerts: inst.fields?.acceptInvalidCerts === "true",
      authMode: (inst.fields?.authMode as ConnectState["authMode"]) ?? "apiKey",
      username: inst.fields?.username ?? "",
      orgId: inst.fields?.orgId ?? "",
      timeoutSecs: inst.fields?.timeoutSecs ?? "30",
    }));
    store.readSecret(inst).then((secret) => {
      if (!secret) return;
      setForm((f) =>
        f.authMode === "basic"
          ? { ...f, password: secret }
          : { ...f, apiKey: secret },
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, store.isLoading]);

  const set = <K extends keyof ConnectState>(k: K, v: ConnectState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const doConnect = useCallback(async () => {
    const id = savedId ?? instanceId ?? generateId();
    await mgr.connect(id, {
      host: form.host.trim(),
      port: form.port ? Number(form.port) : undefined,
      use_tls: form.useTls,
      accept_invalid_certs: form.acceptInvalidCerts,
      api_key: form.authMode === "apiKey" ? form.apiKey : undefined,
      username: form.authMode === "basic" ? form.username : undefined,
      password: form.authMode === "basic" ? form.password : undefined,
      org_id: form.orgId ? Number(form.orgId) : undefined,
      timeout_secs: form.timeoutSecs ? Number(form.timeoutSecs) : undefined,
    });
  }, [mgr, form, savedId, instanceId]);

  const doSave = useCallback(async () => {
    const fields: Record<string, string> = {
      port: form.port,
      useTls: String(form.useTls),
      acceptInvalidCerts: String(form.acceptInvalidCerts),
      authMode: form.authMode,
      username: form.username,
      orgId: form.orgId,
      timeoutSecs: form.timeoutSecs,
    };
    const secret =
      form.authMode === "basic"
        ? form.password || undefined
        : form.apiKey || undefined;
    if (savedId) {
      await store.updateInstance(savedId, {
        name: form.name || form.host,
        host: form.host,
        fields,
        secret,
      });
    } else {
      const created = await store.createInstance({
        integrationKey: "grafana",
        name: form.name || form.host,
        host: form.host,
        fields,
        secret,
      });
      setSavedId(created.id);
    }
  }, [store, form, savedId]);

  return (
    <div className={card}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Labeled label={t("integrations.grafana.host", "Host")}>
          <input
            className={field}
            value={form.host}
            onChange={(e) => set("host", e.target.value)}
            placeholder="grafana.lab.local"
          />
        </Labeled>
        <Labeled label={t("integrations.grafana.port", "Port")}>
          <input
            className={field}
            value={form.port}
            onChange={(e) => set("port", e.target.value)}
            inputMode="numeric"
          />
        </Labeled>
        <Labeled label={t("integrations.grafana.authMode", "Authentication")}>
          <select
            className={field}
            value={form.authMode}
            onChange={(e) =>
              set("authMode", e.target.value as ConnectState["authMode"])
            }
          >
            <option value="apiKey">
              {t("integrations.grafana.authApiKey", "API key / token")}
            </option>
            <option value="basic">
              {t("integrations.grafana.authBasic", "Basic (user / password)")}
            </option>
          </select>
        </Labeled>
        <Labeled label={t("integrations.grafana.orgId", "Organization ID")}>
          <input
            className={field}
            value={form.orgId}
            onChange={(e) => set("orgId", e.target.value)}
            inputMode="numeric"
            placeholder={t("integrations.grafana.orgIdHint", "optional")}
          />
        </Labeled>
        {form.authMode === "apiKey" && (
          <Labeled label={t("integrations.grafana.apiKey", "API key")}>
            <input
              className={field}
              type="password"
              value={form.apiKey}
              onChange={(e) => set("apiKey", e.target.value)}
            />
          </Labeled>
        )}
        {form.authMode === "basic" && (
          <>
            <Labeled label={t("integrations.grafana.username", "Username")}>
              <input
                className={field}
                value={form.username}
                onChange={(e) => set("username", e.target.value)}
              />
            </Labeled>
            <Labeled label={t("integrations.grafana.password", "Password")}>
              <input
                className={field}
                type="password"
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
              />
            </Labeled>
          </>
        )}
        <Labeled label={t("integrations.grafana.timeout", "Timeout (seconds)")}>
          <input
            className={field}
            value={form.timeoutSecs}
            onChange={(e) => set("timeoutSecs", e.target.value)}
            inputMode="numeric"
          />
        </Labeled>
        <Labeled label={t("integrations.grafana.instanceName", "Saved name")}>
          <input
            className={field}
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder={form.host}
          />
        </Labeled>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
          <input
            type="checkbox"
            checked={form.useTls}
            onChange={(e) => set("useTls", e.target.checked)}
          />
          {t("integrations.grafana.useTls", "Use HTTPS")}
        </label>
        <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
          <input
            type="checkbox"
            checked={form.acceptInvalidCerts}
            onChange={(e) => set("acceptInvalidCerts", e.target.checked)}
          />
          {t(
            "integrations.grafana.acceptInvalidCerts",
            "Accept self-signed certificates",
          )}
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className={btn}
          onClick={doConnect}
          disabled={mgr.isConnecting || !form.host}
        >
          {mgr.isConnecting ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Plug size={12} />
          )}
          {t("integrations.grafana.connect", "Connect")}
        </button>
        <button className={btn} onClick={doSave} disabled={!form.host}>
          {t("integrations.grafana.save", "Save instance")}
        </button>
      </div>
    </div>
  );
};

// ─── Dashboards tab ──────────────────────────────────────────────────────────

const DashboardsTab: React.FC<{ mgr: GrafanaManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Dashboard[]>([]);
  const [detail, setDetail] = useState<unknown>(null);

  const search = useCallback(async () => {
    try {
      setRows(
        await mgr.run(() =>
          mgr.api.searchDashboards(cid, {
            query: query || undefined,
            limit: 100,
          }),
        ),
      );
    } catch {
      /* surfaced via mgr.error */
    }
  }, [mgr, cid, query]);

  useEffect(() => {
    void search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid]);

  const view = useCallback(
    async (uid: string) => {
      try {
        setDetail(await mgr.run(() => mgr.api.getDashboard(cid, uid)));
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid],
  );

  const viewHome = useCallback(async () => {
    try {
      setDetail(await mgr.run(() => mgr.api.getHomeDashboard(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  const remove = useCallback(
    async (uid: string) => {
      if (!window.confirm(t("integrations.grafana.deleteDashboardConfirm", "Delete this dashboard?"))) return;
      try {
        await mgr.run(() => mgr.api.deleteDashboard(cid, uid));
        await search();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, search, t],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={field}
          style={{ width: 240 }}
          placeholder={t("integrations.grafana.searchPlaceholder", "Search dashboards")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void search()}
        />
        <button className={btn} onClick={search} disabled={mgr.isLoading}>
          <Search size={12} />
          {t("integrations.grafana.search", "Search")}
        </button>
        <button className={btn} onClick={viewHome} disabled={mgr.isLoading}>
          {t("integrations.grafana.homeDashboard", "Home dashboard")}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.grafana.title", "Title")}</th>
              <th className="px-2 py-1">{t("integrations.grafana.folder", "Folder")}</th>
              <th className="px-2 py-1">{t("integrations.grafana.tags", "Tags")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.uid ?? d.id} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-text)]">{d.title}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{d.folderTitle ?? "—"}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{(d.tags ?? []).join(", ")}</td>
                <td className="px-2 py-1">
                  <div className="flex justify-end gap-1">
                    <button className={btn} onClick={() => d.uid && void view(d.uid)} disabled={!d.uid}>
                      {t("integrations.grafana.view", "View")}
                    </button>
                    <button className={btn} onClick={() => d.uid && void remove(d.uid)} disabled={!d.uid}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={4}>
                  {t("integrations.grafana.noDashboards", "No dashboards")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <JsonView value={detail} />
    </div>
  );
};

// ─── Datasources tab ─────────────────────────────────────────────────────────

const DatasourcesTab: React.FC<{ mgr: GrafanaManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Datasource[]>([]);
  const [detail, setDetail] = useState<unknown>(null);
  const [form, setForm] = useState({ name: "", type: "prometheus", url: "", access: "proxy" });

  const refresh = useCallback(async () => {
    try {
      setRows(await mgr.run(() => mgr.api.listDatasources(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(async () => {
    if (!form.name || !form.type) return;
    try {
      await mgr.run(() =>
        mgr.api.createDatasource(cid, {
          name: form.name,
          type: form.type,
          url: form.url || undefined,
          access: form.access || undefined,
        }),
      );
      setForm({ name: "", type: "prometheus", url: "", access: "proxy" });
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, form, refresh]);

  const test = useCallback(
    async (dsId: number) => {
      try {
        const ok = await mgr.run(() => mgr.api.testDatasource(cid, dsId));
        window.alert(
          ok
            ? t("integrations.grafana.testOk", "Datasource OK")
            : t("integrations.grafana.testFail", "Datasource test failed"),
        );
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, t],
  );

  const view = useCallback(
    async (dsId: number) => {
      try {
        setDetail(await mgr.run(() => mgr.api.getDatasource(cid, dsId)));
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid],
  );

  const remove = useCallback(
    async (dsId: number) => {
      if (!window.confirm(t("integrations.grafana.deleteDatasourceConfirm", "Delete this datasource?"))) return;
      try {
        await mgr.run(() => mgr.api.deleteDatasource(cid, dsId));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh, t],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.grafana.createDatasource", "Create datasource")}
        </h4>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <Labeled label={t("integrations.grafana.name", "Name")}>
            <input className={field} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Labeled>
          <Labeled label={t("integrations.grafana.type", "Type")}>
            <input className={field} value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} />
          </Labeled>
          <Labeled label={t("integrations.grafana.url", "URL")}>
            <input className={field} value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} />
          </Labeled>
          <Labeled label={t("integrations.grafana.access", "Access")}>
            <input className={field} value={form.access} onChange={(e) => setForm((f) => ({ ...f, access: e.target.value }))} />
          </Labeled>
        </div>
        <button className={`${btn} mt-2`} onClick={create} disabled={mgr.isLoading || !form.name}>
          {t("integrations.grafana.create", "Create")}
        </button>
      </div>
      <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
        <RefreshCw size={12} />
        {t("integrations.grafana.refresh", "Refresh")}
      </button>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.grafana.name", "Name")}</th>
              <th className="px-2 py-1">{t("integrations.grafana.type", "Type")}</th>
              <th className="px-2 py-1">{t("integrations.grafana.url", "URL")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((ds) => (
              <tr key={ds.id} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-text)]">{ds.name}{ds.isDefault ? " ★" : ""}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{ds.type}</td>
                <td className="px-2 py-1 font-mono text-[var(--color-textSecondary)]">{ds.url}</td>
                <td className="px-2 py-1">
                  <div className="flex justify-end gap-1">
                    <button className={btn} onClick={() => ds.id != null && void test(ds.id)} disabled={ds.id == null}>
                      {t("integrations.grafana.test", "Test")}
                    </button>
                    <button className={btn} onClick={() => ds.id != null && void view(ds.id)} disabled={ds.id == null}>
                      {t("integrations.grafana.view", "View")}
                    </button>
                    <button className={btn} onClick={() => ds.id != null && void remove(ds.id)} disabled={ds.id == null}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={4}>
                  {t("integrations.grafana.noDatasources", "No datasources")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <JsonView value={detail} />
    </div>
  );
};

// ─── Folders tab ─────────────────────────────────────────────────────────────

const FoldersTab: React.FC<{ mgr: GrafanaManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Folder[]>([]);
  const [detail, setDetail] = useState<unknown>(null);
  const [title, setTitle] = useState("");

  const refresh = useCallback(async () => {
    try {
      setRows(await mgr.run(() => mgr.api.listFolders(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(async () => {
    if (!title) return;
    try {
      await mgr.run(() => mgr.api.createFolder(cid, title));
      setTitle("");
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, title, refresh]);

  const view = useCallback(
    async (uid: string) => {
      try {
        setDetail(await mgr.run(() => mgr.api.getFolder(cid, uid)));
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid],
  );

  const remove = useCallback(
    async (uid: string) => {
      if (!window.confirm(t("integrations.grafana.deleteFolderConfirm", "Delete this folder?"))) return;
      try {
        await mgr.run(() => mgr.api.deleteFolder(cid, uid));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh, t],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={field}
          style={{ width: 240 }}
          placeholder={t("integrations.grafana.newFolderTitle", "New folder title")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button className={btn} onClick={create} disabled={mgr.isLoading || !title}>
          {t("integrations.grafana.createFolder", "Create folder")}
        </button>
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.grafana.refresh", "Refresh")}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.grafana.title", "Title")}</th>
              <th className="px-2 py-1">{t("integrations.grafana.uid", "UID")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.uid ?? f.id} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-text)]">{f.title}</td>
                <td className="px-2 py-1 font-mono text-[var(--color-textSecondary)]">{f.uid}</td>
                <td className="px-2 py-1">
                  <div className="flex justify-end gap-1">
                    <button className={btn} onClick={() => f.uid && void view(f.uid)} disabled={!f.uid}>
                      {t("integrations.grafana.view", "View")}
                    </button>
                    <button className={btn} onClick={() => f.uid && void remove(f.uid)} disabled={!f.uid}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={3}>
                  {t("integrations.grafana.noFolders", "No folders")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <JsonView value={detail} />
    </div>
  );
};

// ─── Organizations tab ───────────────────────────────────────────────────────

const OrgsTab: React.FC<{ mgr: GrafanaManager; cid: string }> = ({ mgr, cid }) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Organization[]>([]);
  const [current, setCurrent] = useState<Organization | null>(null);
  const [detail, setDetail] = useState<unknown>(null);
  const [name, setName] = useState("");

  const refresh = useCallback(async () => {
    const safe = async <T,>(p: Promise<T>, set: (v: T) => void) => {
      try {
        set(await p);
      } catch {
        /* surfaced */
      }
    };
    await mgr.run(async () => {
      await Promise.all([
        safe(mgr.api.listOrgs(cid), setRows),
        safe(mgr.api.getCurrentOrg(cid), setCurrent),
      ]);
    });
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(async () => {
    if (!name) return;
    try {
      await mgr.run(() => mgr.api.createOrg(cid, name));
      setName("");
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, name, refresh]);

  const view = useCallback(
    async (orgId: number) => {
      try {
        setDetail(await mgr.run(() => mgr.api.getOrg(cid, orgId)));
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid],
  );

  const remove = useCallback(
    async (orgId: number) => {
      if (!window.confirm(t("integrations.grafana.deleteOrgConfirm", "Delete this organization?"))) return;
      try {
        await mgr.run(() => mgr.api.deleteOrg(cid, orgId));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh, t],
  );

  return (
    <div className="flex flex-col gap-3">
      {current && (
        <div className={card}>
          <span className="text-xs text-[var(--color-textMuted)]">
            {t("integrations.grafana.currentOrg", "Current organization")}:
          </span>{" "}
          <span className="text-xs font-semibold text-[var(--color-text)]">
            {current.name} (#{current.id})
          </span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={field}
          style={{ width: 240 }}
          placeholder={t("integrations.grafana.newOrgName", "New organization name")}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className={btn} onClick={create} disabled={mgr.isLoading || !name}>
          {t("integrations.grafana.createOrg", "Create organization")}
        </button>
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.grafana.refresh", "Refresh")}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.grafana.id", "ID")}</th>
              <th className="px-2 py-1">{t("integrations.grafana.name", "Name")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{o.id}</td>
                <td className="px-2 py-1 text-[var(--color-text)]">{o.name}</td>
                <td className="px-2 py-1">
                  <div className="flex justify-end gap-1">
                    <button className={btn} onClick={() => o.id != null && void view(o.id)} disabled={o.id == null}>
                      {t("integrations.grafana.view", "View")}
                    </button>
                    <button className={btn} onClick={() => o.id != null && void remove(o.id)} disabled={o.id == null}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={3}>
                  {t("integrations.grafana.noOrgs", "No organizations")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <JsonView value={detail} />
    </div>
  );
};

// ─── Users tab ───────────────────────────────────────────────────────────────

const UsersTab: React.FC<{ mgr: GrafanaManager; cid: string }> = ({ mgr, cid }) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<GrafanaUser[]>([]);
  const [detail, setDetail] = useState<unknown>(null);
  const [form, setForm] = useState({ login: "", email: "", name: "", password: "" });

  const refresh = useCallback(async () => {
    try {
      setRows(await mgr.run(() => mgr.api.listUsers(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(async () => {
    if (!form.login || !form.password) return;
    try {
      await mgr.run(() =>
        mgr.api.createUser(
          cid,
          form.login,
          form.password,
          form.name || undefined,
          form.email || undefined,
        ),
      );
      setForm({ login: "", email: "", name: "", password: "" });
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, form, refresh]);

  const view = useCallback(
    async (userId: number) => {
      try {
        setDetail(await mgr.run(() => mgr.api.getUser(cid, userId)));
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid],
  );

  const remove = useCallback(
    async (userId: number) => {
      if (!window.confirm(t("integrations.grafana.deleteUserConfirm", "Delete this user?"))) return;
      try {
        await mgr.run(() => mgr.api.deleteUser(cid, userId));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh, t],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.grafana.createUser", "Create user")}
        </h4>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <Labeled label={t("integrations.grafana.login", "Login")}>
            <input className={field} value={form.login} onChange={(e) => setForm((f) => ({ ...f, login: e.target.value }))} />
          </Labeled>
          <Labeled label={t("integrations.grafana.email", "Email")}>
            <input className={field} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </Labeled>
          <Labeled label={t("integrations.grafana.name", "Name")}>
            <input className={field} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Labeled>
          <Labeled label={t("integrations.grafana.password", "Password")}>
            <input className={field} type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
          </Labeled>
        </div>
        <button className={`${btn} mt-2`} onClick={create} disabled={mgr.isLoading || !form.login || !form.password}>
          {t("integrations.grafana.create", "Create")}
        </button>
      </div>
      <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
        <RefreshCw size={12} />
        {t("integrations.grafana.refresh", "Refresh")}
      </button>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.grafana.login", "Login")}</th>
              <th className="px-2 py-1">{t("integrations.grafana.email", "Email")}</th>
              <th className="px-2 py-1">{t("integrations.grafana.name", "Name")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-text)]">
                  {u.login}
                  {u.isGrafanaAdmin ? " ⚙" : ""}
                </td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{u.email}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{u.name}</td>
                <td className="px-2 py-1">
                  <div className="flex justify-end gap-1">
                    <button className={btn} onClick={() => u.id != null && void view(u.id)} disabled={u.id == null}>
                      {t("integrations.grafana.view", "View")}
                    </button>
                    <button className={btn} onClick={() => u.id != null && void remove(u.id)} disabled={u.id == null}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={4}>
                  {t("integrations.grafana.noUsers", "No users")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <JsonView value={detail} />
    </div>
  );
};

// ─── Teams tab ───────────────────────────────────────────────────────────────

const TeamsTab: React.FC<{ mgr: GrafanaManager; cid: string }> = ({ mgr, cid }) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Team[]>([]);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState({ name: "", email: "" });
  const [selected, setSelected] = useState<number | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [memberUserId, setMemberUserId] = useState("");

  const refresh = useCallback(async () => {
    try {
      setRows(await mgr.run(() => mgr.api.listTeams(cid, query || undefined)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, query]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid]);

  const create = useCallback(async () => {
    if (!form.name) return;
    try {
      await mgr.run(() => mgr.api.createTeam(cid, form.name, form.email || undefined));
      setForm({ name: "", email: "" });
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, form, refresh]);

  const remove = useCallback(
    async (teamId: number) => {
      if (!window.confirm(t("integrations.grafana.deleteTeamConfirm", "Delete this team?"))) return;
      try {
        await mgr.run(() => mgr.api.deleteTeam(cid, teamId));
        if (selected === teamId) setSelected(null);
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh, selected, t],
  );

  const loadMembers = useCallback(
    async (teamId: number) => {
      setSelected(teamId);
      try {
        setMembers(await mgr.run(() => mgr.api.listTeamMembers(cid, teamId)));
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid],
  );

  const addMember = useCallback(async () => {
    if (selected == null || !memberUserId) return;
    try {
      await mgr.run(() => mgr.api.addTeamMember(cid, selected, Number(memberUserId)));
      setMemberUserId("");
      await loadMembers(selected);
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, selected, memberUserId, loadMembers]);

  const removeMember = useCallback(
    async (userId: number) => {
      if (selected == null) return;
      try {
        await mgr.run(() => mgr.api.removeTeamMember(cid, selected, userId));
        await loadMembers(selected);
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, selected, loadMembers],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={field}
          style={{ width: 200 }}
          placeholder={t("integrations.grafana.searchTeams", "Search teams")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void refresh()}
        />
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <Search size={12} />
          {t("integrations.grafana.search", "Search")}
        </button>
      </div>
      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.grafana.createTeam", "Create team")}
        </h4>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Labeled label={t("integrations.grafana.name", "Name")}>
            <input className={field} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Labeled>
          <Labeled label={t("integrations.grafana.email", "Email")}>
            <input className={field} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </Labeled>
        </div>
        <button className={`${btn} mt-2`} onClick={create} disabled={mgr.isLoading || !form.name}>
          {t("integrations.grafana.create", "Create")}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.grafana.name", "Name")}</th>
              <th className="px-2 py-1">{t("integrations.grafana.email", "Email")}</th>
              <th className="px-2 py-1">{t("integrations.grafana.members", "Members")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((tm) => (
              <tr key={tm.id} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-text)]">{tm.name}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{tm.email}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{tm.memberCount ?? 0}</td>
                <td className="px-2 py-1">
                  <div className="flex justify-end gap-1">
                    <button className={btn} onClick={() => tm.id != null && void loadMembers(tm.id)} disabled={tm.id == null}>
                      {t("integrations.grafana.members", "Members")}
                    </button>
                    <button className={btn} onClick={() => tm.id != null && void remove(tm.id)} disabled={tm.id == null}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={4}>
                  {t("integrations.grafana.noTeams", "No teams")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected != null && (
        <div className={card}>
          <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
            {t("integrations.grafana.teamMembers", "Team members")} (#{selected})
          </h4>
          <div className="mb-2 flex items-center gap-2">
            <input
              className={field}
              style={{ width: 160 }}
              inputMode="numeric"
              placeholder={t("integrations.grafana.userId", "User ID")}
              value={memberUserId}
              onChange={(e) => setMemberUserId(e.target.value)}
            />
            <button className={btn} onClick={addMember} disabled={mgr.isLoading || !memberUserId}>
              {t("integrations.grafana.addMember", "Add member")}
            </button>
          </div>
          <div className="flex flex-col gap-1">
            {members.map((m) => (
              <div key={m.userId} className="flex items-center justify-between text-xs">
                <span className="text-[var(--color-textSecondary)]">
                  {m.login ?? m.email ?? m.userId} · #{m.userId}
                </span>
                <button className={btn} onClick={() => m.userId != null && void removeMember(m.userId)} disabled={m.userId == null}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            {members.length === 0 && (
              <span className="text-xs text-[var(--color-textMuted)]">
                {t("integrations.grafana.noMembers", "No members")}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Alerts tab ──────────────────────────────────────────────────────────────

const AlertsTab: React.FC<{ mgr: GrafanaManager; cid: string }> = ({ mgr, cid }) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<AlertRule[]>([]);
  const [detail, setDetail] = useState<unknown>(null);
  const [filters, setFilters] = useState({ folderUid: "", ruleGroup: "" });
  const [json, setJson] = useState("");

  const refresh = useCallback(async () => {
    try {
      setRows(
        await mgr.run(() =>
          mgr.api.listAlertRules(
            cid,
            filters.folderUid || undefined,
            filters.ruleGroup || undefined,
          ),
        ),
      );
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, filters]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid]);

  const view = useCallback(
    async (uid: string) => {
      try {
        setDetail(await mgr.run(() => mgr.api.getAlertRule(cid, uid)));
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid],
  );

  const create = useCallback(async () => {
    let rule: AlertRule;
    try {
      rule = JSON.parse(json) as AlertRule;
    } catch {
      window.alert(t("integrations.grafana.invalidJson", "Invalid JSON"));
      return;
    }
    try {
      await mgr.run(() => mgr.api.createAlertRule(cid, rule));
      setJson("");
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, json, refresh, t]);

  const pause = useCallback(
    async (uid: string, paused: boolean) => {
      try {
        await mgr.run(() => mgr.api.pauseAlertRule(cid, uid, paused));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh],
  );

  const remove = useCallback(
    async (uid: string) => {
      if (!window.confirm(t("integrations.grafana.deleteAlertConfirm", "Delete this alert rule?"))) return;
      try {
        await mgr.run(() => mgr.api.deleteAlertRule(cid, uid));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh, t],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={field}
          style={{ width: 160 }}
          placeholder={t("integrations.grafana.folderUid", "Folder UID")}
          value={filters.folderUid}
          onChange={(e) => setFilters((f) => ({ ...f, folderUid: e.target.value }))}
        />
        <input
          className={field}
          style={{ width: 160 }}
          placeholder={t("integrations.grafana.ruleGroup", "Rule group")}
          value={filters.ruleGroup}
          onChange={(e) => setFilters((f) => ({ ...f, ruleGroup: e.target.value }))}
        />
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.grafana.refresh", "Refresh")}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.grafana.title", "Title")}</th>
              <th className="px-2 py-1">{t("integrations.grafana.ruleGroup", "Rule group")}</th>
              <th className="px-2 py-1">{t("integrations.grafana.state", "State")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.uid} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-text)]">{r.title}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{r.ruleGroup}</td>
                <td className="px-2 py-1">
                  <span className={r.isPaused ? "text-yellow-500" : "text-green-500"}>
                    {r.isPaused
                      ? t("integrations.grafana.paused", "Paused")
                      : t("integrations.grafana.active", "Active")}
                  </span>
                </td>
                <td className="px-2 py-1">
                  <div className="flex justify-end gap-1">
                    <button className={btn} onClick={() => r.uid && void view(r.uid)} disabled={!r.uid}>
                      {t("integrations.grafana.view", "View")}
                    </button>
                    <button className={btn} onClick={() => r.uid && void pause(r.uid, !r.isPaused)} disabled={!r.uid}>
                      {r.isPaused
                        ? t("integrations.grafana.resume", "Resume")
                        : t("integrations.grafana.pause", "Pause")}
                    </button>
                    <button className={btn} onClick={() => r.uid && void remove(r.uid)} disabled={!r.uid}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={4}>
                  {t("integrations.grafana.noAlertRules", "No alert rules")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.grafana.createAlertRule", "Create alert rule (JSON)")}
        </h4>
        <textarea
          className={`${field} font-mono`}
          rows={4}
          value={json}
          onChange={(e) => setJson(e.target.value)}
          placeholder='{"title":"...","folderUID":"...","ruleGroup":"...","condition":"A","data":[]}'
        />
        <button className={`${btn} mt-2`} onClick={create} disabled={mgr.isLoading || !json}>
          {t("integrations.grafana.create", "Create")}
        </button>
      </div>
      <JsonView value={detail} />
    </div>
  );
};

// ─── Annotations tab ─────────────────────────────────────────────────────────

const AnnotationsTab: React.FC<{ mgr: GrafanaManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Annotation[]>([]);
  const [form, setForm] = useState({ text: "", dashboardUID: "", panelId: "", tags: "" });

  const refresh = useCallback(async () => {
    try {
      setRows(await mgr.run(() => mgr.api.listAnnotations(cid, undefined, undefined, undefined, undefined, undefined, 100)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(async () => {
    if (!form.text) return;
    try {
      await mgr.run(() =>
        mgr.api.createAnnotation(cid, {
          text: form.text,
          dashboardUID: form.dashboardUID || undefined,
          panelId: form.panelId ? Number(form.panelId) : undefined,
          tags: form.tags
            ? form.tags.split(",").map((s) => s.trim()).filter(Boolean)
            : undefined,
        }),
      );
      setForm({ text: "", dashboardUID: "", panelId: "", tags: "" });
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, form, refresh]);

  const remove = useCallback(
    async (annId: number) => {
      try {
        await mgr.run(() => mgr.api.deleteAnnotation(cid, annId));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.grafana.createAnnotation", "Create annotation")}
        </h4>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Labeled label={t("integrations.grafana.text", "Text")}>
            <input className={field} value={form.text} onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))} />
          </Labeled>
          <Labeled label={t("integrations.grafana.dashboardUid", "Dashboard UID")}>
            <input className={field} value={form.dashboardUID} onChange={(e) => setForm((f) => ({ ...f, dashboardUID: e.target.value }))} />
          </Labeled>
          <Labeled label={t("integrations.grafana.panelId", "Panel ID")}>
            <input className={field} inputMode="numeric" value={form.panelId} onChange={(e) => setForm((f) => ({ ...f, panelId: e.target.value }))} />
          </Labeled>
          <Labeled label={t("integrations.grafana.tagsCsv", "Tags (comma-separated)")}>
            <input className={field} value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} />
          </Labeled>
        </div>
        <button className={`${btn} mt-2`} onClick={create} disabled={mgr.isLoading || !form.text}>
          {t("integrations.grafana.create", "Create")}
        </button>
      </div>
      <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
        <RefreshCw size={12} />
        {t("integrations.grafana.refresh", "Refresh")}
      </button>
      <div className="flex flex-col gap-1">
        {rows.map((a) => (
          <div key={a.id} className="flex items-center justify-between text-xs">
            <span className="text-[var(--color-textSecondary)]">
              {a.text} · {(a.tags ?? []).join(", ")}
            </span>
            <button className={btn} onClick={() => a.id != null && void remove(a.id)} disabled={a.id == null}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        {rows.length === 0 && (
          <span className="text-xs text-[var(--color-textMuted)]">
            {t("integrations.grafana.noAnnotations", "No annotations")}
          </span>
        )}
      </div>
    </div>
  );
};

// ─── Playlists tab ───────────────────────────────────────────────────────────

const PlaylistsTab: React.FC<{ mgr: GrafanaManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Playlist[]>([]);
  const [detail, setDetail] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    try {
      setRows(await mgr.run(() => mgr.api.listPlaylists(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const view = useCallback(
    async (playlistId: number) => {
      try {
        setDetail(await mgr.run(() => mgr.api.getPlaylist(cid, playlistId)));
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid],
  );

  const remove = useCallback(
    async (playlistId: number) => {
      if (!window.confirm(t("integrations.grafana.deletePlaylistConfirm", "Delete this playlist?"))) return;
      try {
        await mgr.run(() => mgr.api.deletePlaylist(cid, playlistId));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh, t],
  );

  return (
    <div className="flex flex-col gap-3">
      <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
        <RefreshCw size={12} />
        {t("integrations.grafana.refresh", "Refresh")}
      </button>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.grafana.name", "Name")}</th>
              <th className="px-2 py-1">{t("integrations.grafana.interval", "Interval")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-text)]">{p.name}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{p.interval}</td>
                <td className="px-2 py-1">
                  <div className="flex justify-end gap-1">
                    <button className={btn} onClick={() => p.id != null && void view(p.id)} disabled={p.id == null}>
                      {t("integrations.grafana.view", "View")}
                    </button>
                    <button className={btn} onClick={() => p.id != null && void remove(p.id)} disabled={p.id == null}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={3}>
                  {t("integrations.grafana.noPlaylists", "No playlists")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <JsonView value={detail} />
    </div>
  );
};

// ─── Snapshots tab ───────────────────────────────────────────────────────────

const SnapshotsTab: React.FC<{ mgr: GrafanaManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Snapshot[]>([]);
  const [form, setForm] = useState({ name: "", dashboard: "" });

  const refresh = useCallback(async () => {
    try {
      setRows(await mgr.run(() => mgr.api.listSnapshots(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(async () => {
    let dashboard: unknown;
    try {
      dashboard = JSON.parse(form.dashboard);
    } catch {
      window.alert(t("integrations.grafana.invalidJson", "Invalid JSON"));
      return;
    }
    try {
      await mgr.run(() => mgr.api.createSnapshot(cid, dashboard, form.name || undefined));
      setForm({ name: "", dashboard: "" });
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, form, refresh, t]);

  const remove = useCallback(
    async (key: string) => {
      if (!window.confirm(t("integrations.grafana.deleteSnapshotConfirm", "Delete this snapshot?"))) return;
      try {
        await mgr.run(() => mgr.api.deleteSnapshot(cid, key));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh, t],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.grafana.createSnapshot", "Create snapshot")}
        </h4>
        <Labeled label={t("integrations.grafana.name", "Name")}>
          <input className={field} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </Labeled>
        <div className="mt-2">
          <Labeled label={t("integrations.grafana.dashboardJson", "Dashboard model (JSON)")}>
            <textarea
              className={`${field} font-mono`}
              rows={4}
              value={form.dashboard}
              onChange={(e) => setForm((f) => ({ ...f, dashboard: e.target.value }))}
              placeholder='{"title":"...","panels":[]}'
            />
          </Labeled>
        </div>
        <button className={`${btn} mt-2`} onClick={create} disabled={mgr.isLoading || !form.dashboard}>
          {t("integrations.grafana.create", "Create")}
        </button>
      </div>
      <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
        <RefreshCw size={12} />
        {t("integrations.grafana.refresh", "Refresh")}
      </button>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.grafana.name", "Name")}</th>
              <th className="px-2 py-1">{t("integrations.grafana.key", "Key")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.key ?? s.id} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-text)]">{s.name}</td>
                <td className="px-2 py-1 font-mono text-[var(--color-textSecondary)]">{s.key}</td>
                <td className="px-2 py-1">
                  <button className={`${btn} float-right`} onClick={() => s.key && void remove(s.key)} disabled={!s.key}>
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={3}>
                  {t("integrations.grafana.noSnapshots", "No snapshots")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
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
  { key: "dashboards", labelKey: "integrations.grafana.tabDashboards", labelDefault: "Dashboards", icon: LayoutDashboard },
  { key: "datasources", labelKey: "integrations.grafana.tabDatasources", labelDefault: "Datasources", icon: Database },
  { key: "folders", labelKey: "integrations.grafana.tabFolders", labelDefault: "Folders", icon: FolderIcon },
  { key: "orgs", labelKey: "integrations.grafana.tabOrgs", labelDefault: "Organizations", icon: Building2 },
  { key: "users", labelKey: "integrations.grafana.tabUsers", labelDefault: "Users", icon: Users },
  { key: "teams", labelKey: "integrations.grafana.tabTeams", labelDefault: "Teams", icon: Users },
  { key: "alerts", labelKey: "integrations.grafana.tabAlerts", labelDefault: "Alerts", icon: Bell },
  { key: "annotations", labelKey: "integrations.grafana.tabAnnotations", labelDefault: "Annotations", icon: Tag },
  { key: "playlists", labelKey: "integrations.grafana.tabPlaylists", labelDefault: "Playlists", icon: FileStack },
  { key: "snapshots", labelKey: "integrations.grafana.tabSnapshots", labelDefault: "Snapshots", icon: Camera },
];

const GrafanaPanel: React.FC<IntegrationPanelProps> = ({ isOpen, instanceId }) => {
  const { t } = useTranslation();
  const mgr = useGrafana();
  const [tab, setTab] = useState<TabKey>("dashboards");

  if (!isOpen) return null;

  const cid = mgr.connectionId;

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[var(--color-surface)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--color-text)]">
          <BarChart3 className="h-5 w-5 text-primary" />
          {t("integrations.grafana.title", "Grafana")}
        </h2>
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 ${
              mgr.isConnected
                ? "bg-green-500/15 text-green-500"
                : "bg-[var(--color-border)] text-[var(--color-textSecondary)]"
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${mgr.isConnected ? "bg-green-500" : "bg-[var(--color-textMuted)]"}`} />
            {mgr.isConnected
              ? mgr.summary?.host ?? t("integrations.grafana.connected", "Connected")
              : t("integrations.grafana.disconnected", "Disconnected")}
          </span>
          {mgr.summary?.version && (
            <span className="text-[var(--color-textMuted)]">v{mgr.summary.version}</span>
          )}
          {mgr.isConnected && (
            <button className={btn} onClick={() => void mgr.disconnect()}>
              {t("integrations.grafana.disconnect", "Disconnect")}
            </button>
          )}
        </div>
      </div>

      {mgr.error && (
        <div className="mb-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-500">
          {mgr.error}
        </div>
      )}

      {!mgr.isConnected || !cid ? (
        <ConnectForm mgr={mgr} instanceId={instanceId} />
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
              >
                <Icon size={12} />
                {t(labelKey, labelDefault)}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1">
            {tab === "dashboards" && <DashboardsTab mgr={mgr} cid={cid} />}
            {tab === "datasources" && <DatasourcesTab mgr={mgr} cid={cid} />}
            {tab === "folders" && <FoldersTab mgr={mgr} cid={cid} />}
            {tab === "orgs" && <OrgsTab mgr={mgr} cid={cid} />}
            {tab === "users" && <UsersTab mgr={mgr} cid={cid} />}
            {tab === "teams" && <TeamsTab mgr={mgr} cid={cid} />}
            {tab === "alerts" && <AlertsTab mgr={mgr} cid={cid} />}
            {tab === "annotations" && <AnnotationsTab mgr={mgr} cid={cid} />}
            {tab === "playlists" && <PlaylistsTab mgr={mgr} cid={cid} />}
            {tab === "snapshots" && <SnapshotsTab mgr={mgr} cid={cid} />}
          </div>
        </>
      )}
    </div>
  );
};

export default GrafanaPanel;

/** Registry descriptor for the Grafana integration (category: app-service).
 *  The Wave-3 app-service integrator appends this to `registry.appservice.ts`. */
export const grafanaDescriptor: IntegrationDescriptor = {
  key: "grafana",
  label: "Grafana",
  category: "monitoring",
  icon: BarChart3,
  importPanel: () => import("./GrafanaPanel"),
};
