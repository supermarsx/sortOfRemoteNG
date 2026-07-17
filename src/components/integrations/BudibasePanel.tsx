// Budibase integration panel (t42-budibase).
//
// Full panel for the sorng-budibase crate — binds every one of the 58 Budibase
// commands registered in the Tauri handler through `useBudibase()` / `budibaseApi`.
// Connect form maps to `budibase_connect` (host + API key); sub-tabs cover apps,
// tables, rows, views, users, queries, automations and datasources. Deep-shaped
// create/update payloads (rows, queries, automations, datasources) are entered as
// JSON so the full request surface stays reachable without bespoke sub-forms.

import React, { useCallback, useEffect, useState } from "react";
import {
  AppWindow,
  Boxes,
  Database,
  FileJson,
  Layers,
  Loader2,
  Play,
  Plug,
  RefreshCw,
  Rows3,
  Table2,
  Trash2,
  Users,
  Workflow,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useBudibase,
  type BudibaseManager,
} from "../../hooks/integration/useBudibase";
import { useIntegrationConfigStore } from "../../hooks/integrations/useIntegrationConfigStore";
import { generateId } from "../../utils/core/id";
import type {
  IntegrationDescriptor,
  IntegrationPanelProps,
} from "../../types/integrations/registry";
import type {
  BudibaseApp,
  BudibaseAutomation,
  BudibaseDatasource,
  BudibaseQuery,
  BudibaseRow,
  BudibaseTable,
  BudibaseUser,
  BudibaseView,
} from "../../types/budibase";

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

/** Parse a JSON textarea, returning `undefined` on empty and throwing on invalid. */
function parseJson<T>(raw: string, fallback?: T): T | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  return JSON.parse(trimmed) as T;
}

type TabKey =
  | "apps"
  | "tables"
  | "rows"
  | "views"
  | "users"
  | "queries"
  | "automations"
  | "datasources";

// ─── Connect form ────────────────────────────────────────────────────────────

interface ConnectState {
  host: string;
  apiKey: string;
  appId: string;
  timeoutSeconds: string;
  skipTlsVerify: boolean;
  name: string;
}

const emptyConnect: ConnectState = {
  host: "",
  apiKey: "",
  appId: "",
  timeoutSeconds: "",
  skipTlsVerify: false,
  name: "",
};

const ConnectForm: React.FC<{ mgr: BudibaseManager; instanceId?: string }> = ({
  mgr,
  instanceId,
}) => {
  const { t } = useTranslation();
  const store = useIntegrationConfigStore();
  const [form, setForm] = useState<ConnectState>(emptyConnect);
  const [savedId, setSavedId] = useState<string | undefined>(instanceId);

  // Prefill from a persisted instance (host/fields + vault secret = API key).
  useEffect(() => {
    if (!instanceId || store.isLoading) return;
    const inst = store.instances.find((i) => i.id === instanceId);
    if (!inst) return;
    setForm((f) => ({
      ...f,
      name: inst.name,
      host: inst.host ?? "",
      appId: inst.fields?.appId ?? "",
      timeoutSeconds: inst.fields?.timeoutSeconds ?? "",
      skipTlsVerify: inst.fields?.skipTlsVerify === "true",
    }));
    store.readSecret(inst).then((secret) => {
      if (secret) setForm((f) => ({ ...f, apiKey: secret }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, store.isLoading]);

  const set = <K extends keyof ConnectState>(k: K, v: ConnectState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const doConnect = useCallback(async () => {
    const id = savedId ?? instanceId ?? generateId();
    await mgr.connect(id, {
      name: form.name || form.host,
      host: form.host.trim(),
      apiKey: form.apiKey,
      appId: form.appId || undefined,
      timeoutSeconds: form.timeoutSeconds
        ? Number(form.timeoutSeconds)
        : undefined,
      skipTlsVerify: form.skipTlsVerify,
    });
  }, [mgr, form, savedId, instanceId]);

  const doSave = useCallback(async () => {
    const fields: Record<string, string> = {
      appId: form.appId,
      timeoutSeconds: form.timeoutSeconds,
      skipTlsVerify: String(form.skipTlsVerify),
    };
    if (savedId) {
      await store.updateInstance(savedId, {
        name: form.name || form.host,
        host: form.host,
        fields,
        secret: form.apiKey || undefined,
      });
    } else {
      const created = await store.createInstance({
        integrationKey: "budibase",
        name: form.name || form.host,
        host: form.host,
        fields,
        secret: form.apiKey || undefined,
      });
      setSavedId(created.id);
    }
  }, [store, form, savedId]);

  return (
    <div className={card}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Labeled label={t("integrations.budibase.host", "Host URL")}>
          <input
            className={field}
            value={form.host}
            onChange={(e) => set("host", e.target.value)}
            placeholder="https://budibase.example.com"
          />
        </Labeled>
        <Labeled label={t("integrations.budibase.apiKey", "API key")}>
          <input
            className={field}
            type="password"
            value={form.apiKey}
            onChange={(e) => set("apiKey", e.target.value)}
          />
        </Labeled>
        <Labeled label={t("integrations.budibase.appId", "Default app ID")}>
          <input
            className={field}
            value={form.appId}
            onChange={(e) => set("appId", e.target.value)}
            placeholder="app_..."
          />
        </Labeled>
        <Labeled
          label={t("integrations.budibase.timeout", "Timeout (seconds)")}
        >
          <input
            className={field}
            value={form.timeoutSeconds}
            onChange={(e) => set("timeoutSeconds", e.target.value)}
            inputMode="numeric"
          />
        </Labeled>
        <Labeled label={t("integrations.budibase.instanceName", "Saved name")}>
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
            checked={form.skipTlsVerify}
            onChange={(e) => set("skipTlsVerify", e.target.checked)}
          />
          {t(
            "integrations.budibase.skipTlsVerify",
            "Accept self-signed certificates",
          )}
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className={btn}
          onClick={doConnect}
          disabled={mgr.isConnecting || !form.host || !form.apiKey}
        >
          {mgr.isConnecting ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Plug size={12} />
          )}
          {t("integrations.budibase.connect", "Connect")}
        </button>
        <button className={btn} onClick={doSave} disabled={!form.host}>
          {t("integrations.budibase.save", "Save instance")}
        </button>
      </div>
    </div>
  );
};

// ─── Small reusable pieces ───────────────────────────────────────────────────

const Toolbar: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex flex-wrap items-center gap-2">{children}</div>
);

/** A JSON editor block used for the deeper create/update payloads. */
const JsonEditor: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}> = ({ label, value, onChange, rows = 6 }) => (
  <Labeled label={label}>
    <textarea
      className={`${field} font-mono`}
      rows={rows}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
    />
  </Labeled>
);

function useJsonError() {
  const [jsonError, setJsonError] = useState<string | null>(null);
  const guard = useCallback(async (fn: () => Promise<void>) => {
    setJsonError(null);
    try {
      await fn();
    } catch (e) {
      // Only intercept JSON syntax errors here; op errors go through mgr.error.
      if (e instanceof SyntaxError) setJsonError(e.message);
    }
  }, []);
  return { jsonError, guard };
}

// ─── Apps tab (8 cmds + set_app_context) ─────────────────────────────────────

const AppsTab: React.FC<{ mgr: BudibaseManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [apps, setApps] = useState<BudibaseApp[]>([]);
  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [selected, setSelected] = useState<BudibaseApp | null>(null);

  const refresh = useCallback(async () => {
    try {
      setApps(await mgr.run(() => mgr.api.listApps(cid)));
    } catch {
      /* surfaced via mgr.error */
    }
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const doSearch = useCallback(async () => {
    try {
      setApps(
        await mgr.run(() => mgr.api.searchApps(cid, search || undefined)),
      );
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, search]);

  const create = useCallback(async () => {
    if (!newName) return;
    try {
      await mgr.run(() =>
        mgr.api.createApp(cid, {
          name: newName,
          url: newUrl || undefined,
        }),
      );
      setNewName("");
      setNewUrl("");
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, newName, newUrl, refresh]);

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await mgr.run(fn);
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, refresh],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className={card}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Labeled label={t("integrations.budibase.appName", "App name")}>
            <input
              className={field}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </Labeled>
          <Labeled label={t("integrations.budibase.appUrl", "URL path")}>
            <input
              className={field}
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="/my-app"
            />
          </Labeled>
          <div className="flex items-end">
            <button className={btn} onClick={create} disabled={!newName}>
              {t("integrations.budibase.createApp", "Create app")}
            </button>
          </div>
        </div>
      </div>

      <Toolbar>
        <input
          className={field}
          style={{ width: 220 }}
          placeholder={t("integrations.budibase.searchApps", "Search apps by name")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className={btn} onClick={doSearch} disabled={mgr.isLoading}>
          {t("integrations.budibase.search", "Search")}
        </button>
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.budibase.refresh", "Refresh")}
        </button>
      </Toolbar>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.budibase.name", "Name")}</th>
              <th className="px-2 py-1">{t("integrations.budibase.status", "Status")}</th>
              <th className="px-2 py-1">{t("integrations.budibase.appId", "App ID")}</th>
              <th className="px-2 py-1">{t("integrations.budibase.actions", "Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {apps.map((a) => (
              <tr key={a._id ?? a.name} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-text)]">{a.name}</td>
                <td className="px-2 py-1">
                  <span className={a.deployed ? "text-green-500" : "text-[var(--color-textSecondary)]"}>
                    {a.status ?? (a.deployed ? "deployed" : "draft")}
                  </span>
                </td>
                <td className="px-2 py-1 font-mono text-[var(--color-textSecondary)]">{a._id}</td>
                <td className="px-2 py-1">
                  <div className="flex flex-wrap gap-1">
                    <button
                      className={btn}
                      onClick={() =>
                        act(async () => setSelected(await mgr.api.getApp(cid, a._id!)))
                      }
                      disabled={!a._id}
                    >
                      {t("integrations.budibase.view", "View")}
                    </button>
                    <button
                      className={btn}
                      onClick={() => act(() => mgr.api.publishApp(cid, a._id!))}
                      disabled={!a._id}
                    >
                      {t("integrations.budibase.publish", "Publish")}
                    </button>
                    <button
                      className={btn}
                      onClick={() => act(() => mgr.api.unpublishApp(cid, a._id!))}
                      disabled={!a._id}
                    >
                      {t("integrations.budibase.unpublish", "Unpublish")}
                    </button>
                    <button
                      className={btn}
                      onClick={() =>
                        act(() =>
                          mgr.api.updateApp(cid, a._id!, { name: a.name }),
                        )
                      }
                      disabled={!a._id}
                    >
                      {t("integrations.budibase.touch", "Touch")}
                    </button>
                    <button
                      className={btn}
                      onClick={() => mgr.api.setAppContext(cid, a._id ?? undefined)}
                    >
                      {t("integrations.budibase.setContext", "Set context")}
                    </button>
                    <button
                      className={btn}
                      onClick={() => {
                        if (window.confirm(t("integrations.budibase.deleteAppConfirm", "Delete this app?")))
                          void act(() => mgr.api.deleteApp(cid, a._id!));
                      }}
                      disabled={!a._id}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {apps.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={4}>
                  {t("integrations.budibase.noApps", "No apps")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-[var(--color-surface)] p-2 font-mono text-[10px] text-[var(--color-textSecondary)]">
          {JSON.stringify(selected, null, 2)}
        </pre>
      )}
    </div>
  );
};

// ─── Tables tab (6 cmds) ─────────────────────────────────────────────────────

const TablesTab: React.FC<{ mgr: BudibaseManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [tables, setTables] = useState<BudibaseTable[]>([]);
  const [detail, setDetail] = useState<unknown>(null);
  const [createJson, setCreateJson] = useState(
    '{\n  "name": "My Table",\n  "schema": {}\n}',
  );
  const [updateJson, setUpdateJson] = useState(
    '{\n  "_id": "",\n  "name": "",\n  "schema": {}\n}',
  );
  const { jsonError, guard } = useJsonError();

  const refresh = useCallback(async () => {
    try {
      setTables(await mgr.run(() => mgr.api.listTables(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = () =>
    guard(async () => {
      const req = parseJson<Parameters<typeof mgr.api.createTable>[1]>(createJson);
      if (!req) return;
      await mgr.run(() => mgr.api.createTable(cid, req));
      await refresh();
    });

  const update = () =>
    guard(async () => {
      const req = parseJson<Parameters<typeof mgr.api.updateTable>[2]>(updateJson);
      if (!req) return;
      await mgr.run(() => mgr.api.updateTable(cid, req._id, req));
      await refresh();
    });

  return (
    <div className="flex flex-col gap-3">
      <Toolbar>
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.budibase.refresh", "Refresh")}
        </button>
      </Toolbar>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.budibase.name", "Name")}</th>
              <th className="px-2 py-1">{t("integrations.budibase.tableId", "Table ID")}</th>
              <th className="px-2 py-1">{t("integrations.budibase.fields", "Fields")}</th>
              <th className="px-2 py-1">{t("integrations.budibase.actions", "Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {tables.map((tb) => (
              <tr key={tb._id ?? tb.name} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-text)]">{tb.name}</td>
                <td className="px-2 py-1 font-mono text-[var(--color-textSecondary)]">{tb._id}</td>
                <td className="px-2 py-1">{Object.keys(tb.schema ?? {}).length}</td>
                <td className="px-2 py-1">
                  <div className="flex flex-wrap gap-1">
                    <button
                      className={btn}
                      onClick={async () => {
                        try {
                          setDetail(await mgr.run(() => mgr.api.getTable(cid, tb._id!)));
                        } catch {
                          /* surfaced */
                        }
                      }}
                      disabled={!tb._id}
                    >
                      {t("integrations.budibase.view", "View")}
                    </button>
                    <button
                      className={btn}
                      onClick={async () => {
                        try {
                          setDetail(
                            await mgr.run(() => mgr.api.getTableSchema(cid, tb._id!)),
                          );
                        } catch {
                          /* surfaced */
                        }
                      }}
                      disabled={!tb._id}
                    >
                      {t("integrations.budibase.schema", "Schema")}
                    </button>
                    <button
                      className={btn}
                      onClick={() => {
                        if (window.confirm(t("integrations.budibase.deleteTableConfirm", "Delete this table?")))
                          mgr.run(() => mgr.api.deleteTable(cid, tb._id!, tb._rev ?? undefined)).then(refresh).catch(() => {});
                      }}
                      disabled={!tb._id}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {tables.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={4}>
                  {t("integrations.budibase.noTables", "No tables")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className={card}>
          <JsonEditor
            label={t("integrations.budibase.createTable", "Create table (JSON)")}
            value={createJson}
            onChange={setCreateJson}
          />
          <button className={`${btn} mt-2`} onClick={create} disabled={mgr.isLoading}>
            {t("integrations.budibase.createTable", "Create table")}
          </button>
        </div>
        <div className={card}>
          <JsonEditor
            label={t("integrations.budibase.updateTable", "Update table (JSON)")}
            value={updateJson}
            onChange={setUpdateJson}
          />
          <button className={`${btn} mt-2`} onClick={update} disabled={mgr.isLoading}>
            {t("integrations.budibase.updateTable", "Update table")}
          </button>
        </div>
      </div>

      {jsonError && (
        <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-500">
          JSON: {jsonError}
        </div>
      )}
      {detail != null && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-[var(--color-surface)] p-2 font-mono text-[10px] text-[var(--color-textSecondary)]">
          {JSON.stringify(detail, null, 2)}
        </pre>
      )}
    </div>
  );
};

// ─── Rows tab (8 cmds) ───────────────────────────────────────────────────────

const RowsTab: React.FC<{ mgr: BudibaseManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [tableId, setTableId] = useState("");
  const [rows, setRows] = useState<BudibaseRow[]>([]);
  const [rowJson, setRowJson] = useState('{\n  "name": "value"\n}');
  const [rowId, setRowId] = useState("");
  const [searchJson, setSearchJson] = useState(
    '{\n  "query": { "equal": {} },\n  "limit": 20\n}',
  );
  const [bulkJson, setBulkJson] = useState("[\n  {}\n]");
  const { jsonError, guard } = useJsonError();

  const list = () =>
    guard(async () => {
      if (!tableId) return;
      setRows(await mgr.run(() => mgr.api.listRows(cid, tableId)));
    });

  const search = () =>
    guard(async () => {
      if (!tableId) return;
      const req = parseJson<Parameters<typeof mgr.api.searchRows>[2]>(searchJson);
      if (!req) return;
      const res = await mgr.run(() => mgr.api.searchRows(cid, tableId, req));
      setRows(res.rows ?? []);
    });

  const create = () =>
    guard(async () => {
      if (!tableId) return;
      const row = parseJson<BudibaseRow>(rowJson);
      if (!row) return;
      await mgr.run(() => mgr.api.createRow(cid, tableId, row));
      await list();
    });

  const update = () =>
    guard(async () => {
      if (!tableId || !rowId) return;
      const row = parseJson<BudibaseRow>(rowJson);
      if (!row) return;
      await mgr.run(() => mgr.api.updateRow(cid, tableId, rowId, row));
      await list();
    });

  const getOne = () =>
    guard(async () => {
      if (!tableId || !rowId) return;
      const r = await mgr.run(() => mgr.api.getRow(cid, tableId, rowId));
      setRowJson(JSON.stringify(r, null, 2));
    });

  const remove = () =>
    guard(async () => {
      if (!tableId || !rowId) return;
      await mgr.run(() => mgr.api.deleteRow(cid, tableId, rowId));
      await list();
    });

  const bulkCreate = () =>
    guard(async () => {
      if (!tableId) return;
      const arr = parseJson<BudibaseRow[]>(bulkJson);
      if (!arr) return;
      await mgr.run(() => mgr.api.bulkCreateRows(cid, tableId, arr));
      await list();
    });

  const bulkDelete = () =>
    guard(async () => {
      if (!tableId) return;
      const arr = parseJson<BudibaseRow[]>(bulkJson);
      if (!arr) return;
      await mgr.run(() => mgr.api.bulkDeleteRows(cid, tableId, { rows: arr }));
      await list();
    });

  return (
    <div className="flex flex-col gap-3">
      <div className={card}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Labeled label={t("integrations.budibase.tableId", "Table ID")}>
            <input
              className={field}
              value={tableId}
              onChange={(e) => setTableId(e.target.value)}
              placeholder="ta_..."
            />
          </Labeled>
          <Labeled label={t("integrations.budibase.rowId", "Row ID")}>
            <input
              className={field}
              value={rowId}
              onChange={(e) => setRowId(e.target.value)}
              placeholder="ro_..."
            />
          </Labeled>
        </div>
        <Toolbar>
          <button className={`${btn} mt-2`} onClick={list} disabled={!tableId || mgr.isLoading}>
            {t("integrations.budibase.listRows", "List rows")}
          </button>
          <button className={`${btn} mt-2`} onClick={getOne} disabled={!tableId || !rowId}>
            {t("integrations.budibase.getRow", "Get row")}
          </button>
        </Toolbar>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className={card}>
          <JsonEditor
            label={t("integrations.budibase.rowPayload", "Row payload (JSON)")}
            value={rowJson}
            onChange={setRowJson}
          />
          <Toolbar>
            <button className={`${btn} mt-2`} onClick={create} disabled={!tableId}>
              {t("integrations.budibase.createRow", "Create")}
            </button>
            <button className={`${btn} mt-2`} onClick={update} disabled={!tableId || !rowId}>
              {t("integrations.budibase.updateRow", "Update")}
            </button>
            <button className={`${btn} mt-2`} onClick={remove} disabled={!tableId || !rowId}>
              {t("integrations.budibase.deleteRow", "Delete")}
            </button>
          </Toolbar>
        </div>
        <div className={card}>
          <JsonEditor
            label={t("integrations.budibase.searchQuery", "Search request (JSON)")}
            value={searchJson}
            onChange={setSearchJson}
          />
          <button className={`${btn} mt-2`} onClick={search} disabled={!tableId}>
            {t("integrations.budibase.searchRows", "Search rows")}
          </button>
        </div>
      </div>

      <div className={card}>
        <JsonEditor
          label={t("integrations.budibase.bulkRows", "Bulk rows (JSON array)")}
          value={bulkJson}
          onChange={setBulkJson}
          rows={4}
        />
        <Toolbar>
          <button className={`${btn} mt-2`} onClick={bulkCreate} disabled={!tableId}>
            {t("integrations.budibase.bulkCreate", "Bulk create")}
          </button>
          <button className={`${btn} mt-2`} onClick={bulkDelete} disabled={!tableId}>
            {t("integrations.budibase.bulkDelete", "Bulk delete")}
          </button>
        </Toolbar>
      </div>

      {jsonError && (
        <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-500">
          JSON: {jsonError}
        </div>
      )}
      <div className="text-xs text-[var(--color-textSecondary)]">
        {t("integrations.budibase.rowCount", "Rows")}: {rows.length}
      </div>
      {rows.length > 0 && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-[var(--color-surface)] p-2 font-mono text-[10px] text-[var(--color-textSecondary)]">
          {JSON.stringify(rows.slice(0, 50), null, 2)}
        </pre>
      )}
    </div>
  );
};

// ─── Views tab (6 cmds) ──────────────────────────────────────────────────────

const ViewsTab: React.FC<{ mgr: BudibaseManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [tableId, setTableId] = useState("");
  const [viewId, setViewId] = useState("");
  const [views, setViews] = useState<BudibaseView[]>([]);
  const [detail, setDetail] = useState<unknown>(null);
  const [createJson, setCreateJson] = useState(
    '{\n  "name": "My View",\n  "tableId": ""\n}',
  );
  const { jsonError, guard } = useJsonError();

  const list = () =>
    guard(async () => {
      if (!tableId) return;
      setViews(await mgr.run(() => mgr.api.listViews(cid, tableId)));
    });

  const create = () =>
    guard(async () => {
      const req = parseJson<Parameters<typeof mgr.api.createView>[1]>(createJson);
      if (!req) return;
      await mgr.run(() => mgr.api.createView(cid, req));
      if (tableId) await list();
    });

  const update = () =>
    guard(async () => {
      if (!viewId) return;
      const req = parseJson<Parameters<typeof mgr.api.updateView>[2]>(createJson);
      if (!req) return;
      await mgr.run(() => mgr.api.updateView(cid, viewId, req));
      if (tableId) await list();
    });

  return (
    <div className="flex flex-col gap-3">
      <div className={card}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Labeled label={t("integrations.budibase.tableId", "Table ID")}>
            <input className={field} value={tableId} onChange={(e) => setTableId(e.target.value)} />
          </Labeled>
          <Labeled label={t("integrations.budibase.viewId", "View ID")}>
            <input className={field} value={viewId} onChange={(e) => setViewId(e.target.value)} />
          </Labeled>
        </div>
        <Toolbar>
          <button className={`${btn} mt-2`} onClick={list} disabled={!tableId}>
            {t("integrations.budibase.listViews", "List views")}
          </button>
          <button
            className={`${btn} mt-2`}
            onClick={async () => {
              try {
                setDetail(await mgr.run(() => mgr.api.getView(cid, viewId)));
              } catch {
                /* surfaced */
              }
            }}
            disabled={!viewId}
          >
            {t("integrations.budibase.getView", "Get view")}
          </button>
          <button
            className={`${btn} mt-2`}
            onClick={async () => {
              try {
                setDetail(await mgr.run(() => mgr.api.queryView(cid, viewId)));
              } catch {
                /* surfaced */
              }
            }}
            disabled={!viewId}
          >
            {t("integrations.budibase.queryView", "Query view")}
          </button>
          <button
            className={`${btn} mt-2`}
            onClick={() => {
              if (window.confirm(t("integrations.budibase.deleteViewConfirm", "Delete this view?")))
                mgr.run(() => mgr.api.deleteView(cid, viewId)).then(() => { if (tableId) void list(); }).catch(() => {});
            }}
            disabled={!viewId}
          >
            <Trash2 size={12} />
          </button>
        </Toolbar>
      </div>

      <div className={card}>
        <JsonEditor
          label={t("integrations.budibase.viewPayload", "View payload (JSON)")}
          value={createJson}
          onChange={setCreateJson}
        />
        <Toolbar>
          <button className={`${btn} mt-2`} onClick={create}>
            {t("integrations.budibase.createView", "Create view")}
          </button>
          <button className={`${btn} mt-2`} onClick={update} disabled={!viewId}>
            {t("integrations.budibase.updateView", "Update view")}
          </button>
        </Toolbar>
      </div>

      {jsonError && (
        <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-500">
          JSON: {jsonError}
        </div>
      )}
      <div className="text-xs text-[var(--color-textSecondary)]">
        {views.map((v) => (
          <div key={v.id ?? v.name} className="font-mono">
            {v.name} · {v.id}
          </div>
        ))}
      </div>
      {detail != null && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-[var(--color-surface)] p-2 font-mono text-[10px] text-[var(--color-textSecondary)]">
          {JSON.stringify(detail, null, 2)}
        </pre>
      )}
    </div>
  );
};

// ─── Users tab (6 cmds) ──────────────────────────────────────────────────────

const UsersTab: React.FC<{ mgr: BudibaseManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [users, setUsers] = useState<BudibaseUser[]>([]);
  const [email, setEmail] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [detail, setDetail] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    try {
      setUsers(await mgr.run(() => mgr.api.listUsers(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const search = useCallback(async () => {
    try {
      const res = await mgr.run(() =>
        mgr.api.searchUsers(cid, email || undefined),
      );
      setUsers(res.data ?? []);
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, email]);

  const create = useCallback(async () => {
    if (!newEmail) return;
    try {
      await mgr.run(() =>
        mgr.api.createUser(cid, {
          email: newEmail,
          password: newPassword || undefined,
          roles: {},
        }),
      );
      setNewEmail("");
      setNewPassword("");
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, newEmail, newPassword, refresh]);

  return (
    <div className="flex flex-col gap-3">
      <div className={card}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Labeled label={t("integrations.budibase.newUserEmail", "New user email")}>
            <input className={field} value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
          </Labeled>
          <Labeled label={t("integrations.budibase.password", "Password")}>
            <input className={field} type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </Labeled>
          <div className="flex items-end">
            <button className={btn} onClick={create} disabled={!newEmail}>
              {t("integrations.budibase.createUser", "Create user")}
            </button>
          </div>
        </div>
      </div>

      <Toolbar>
        <input
          className={field}
          style={{ width: 220 }}
          placeholder={t("integrations.budibase.searchUsers", "Search by email")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button className={btn} onClick={search} disabled={mgr.isLoading}>
          {t("integrations.budibase.search", "Search")}
        </button>
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.budibase.refresh", "Refresh")}
        </button>
      </Toolbar>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.budibase.email", "Email")}</th>
              <th className="px-2 py-1">{t("integrations.budibase.status", "Status")}</th>
              <th className="px-2 py-1">{t("integrations.budibase.actions", "Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u._id ?? u.email} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-text)]">{u.email}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{u.status ?? "—"}</td>
                <td className="px-2 py-1">
                  <div className="flex flex-wrap gap-1">
                    <button
                      className={btn}
                      onClick={async () => {
                        try {
                          setDetail(await mgr.run(() => mgr.api.getUser(cid, u._id!)));
                        } catch {
                          /* surfaced */
                        }
                      }}
                      disabled={!u._id}
                    >
                      {t("integrations.budibase.view", "View")}
                    </button>
                    <button
                      className={btn}
                      onClick={() =>
                        mgr
                          .run(() =>
                            mgr.api.updateUser(cid, u._id!, {
                              _id: u._id!,
                              email: u.email,
                              roles: u.roles ?? {},
                            }),
                          )
                          .then(refresh)
                          .catch(() => {})
                      }
                      disabled={!u._id}
                    >
                      {t("integrations.budibase.touch", "Touch")}
                    </button>
                    <button
                      className={btn}
                      onClick={() => {
                        if (window.confirm(t("integrations.budibase.deleteUserConfirm", "Delete this user?")))
                          mgr.run(() => mgr.api.deleteUser(cid, u._id!)).then(refresh).catch(() => {});
                      }}
                      disabled={!u._id}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={3}>
                  {t("integrations.budibase.noUsers", "No users")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {detail != null && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-[var(--color-surface)] p-2 font-mono text-[10px] text-[var(--color-textSecondary)]">
          {JSON.stringify(detail, null, 2)}
        </pre>
      )}
    </div>
  );
};

// ─── Queries tab (6 cmds) ────────────────────────────────────────────────────

const QueriesTab: React.FC<{ mgr: BudibaseManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [queries, setQueries] = useState<BudibaseQuery[]>([]);
  const [queryId, setQueryId] = useState("");
  const [execJson, setExecJson] = useState('{\n  "parameters": {}\n}');
  const [defJson, setDefJson] = useState(
    '{\n  "name": "My Query",\n  "datasourceId": "",\n  "queryVerb": "read"\n}',
  );
  const [result, setResult] = useState<unknown>(null);
  const { jsonError, guard } = useJsonError();

  const refresh = useCallback(async () => {
    try {
      setQueries(await mgr.run(() => mgr.api.listQueries(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const execute = () =>
    guard(async () => {
      if (!queryId) return;
      const req = parseJson<Parameters<typeof mgr.api.executeQuery>[2]>(execJson) ?? {};
      setResult(await mgr.run(() => mgr.api.executeQuery(cid, queryId, req)));
    });

  const create = () =>
    guard(async () => {
      const q = parseJson<BudibaseQuery>(defJson);
      if (!q) return;
      await mgr.run(() => mgr.api.createQuery(cid, q));
      await refresh();
    });

  const update = () =>
    guard(async () => {
      if (!queryId) return;
      const q = parseJson<BudibaseQuery>(defJson);
      if (!q) return;
      await mgr.run(() => mgr.api.updateQuery(cid, queryId, q));
      await refresh();
    });

  return (
    <div className="flex flex-col gap-3">
      <Toolbar>
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.budibase.refresh", "Refresh")}
        </button>
      </Toolbar>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.budibase.name", "Name")}</th>
              <th className="px-2 py-1">{t("integrations.budibase.queryId", "Query ID")}</th>
              <th className="px-2 py-1">{t("integrations.budibase.actions", "Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {queries.map((q) => (
              <tr key={q._id ?? q.name} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-text)]">{q.name}</td>
                <td className="px-2 py-1 font-mono text-[var(--color-textSecondary)]">{q._id}</td>
                <td className="px-2 py-1">
                  <div className="flex flex-wrap gap-1">
                    <button className={btn} onClick={() => setQueryId(q._id ?? "")}>
                      {t("integrations.budibase.select", "Select")}
                    </button>
                    <button
                      className={btn}
                      onClick={async () => {
                        try {
                          setResult(await mgr.run(() => mgr.api.getQuery(cid, q._id!)));
                        } catch {
                          /* surfaced */
                        }
                      }}
                      disabled={!q._id}
                    >
                      {t("integrations.budibase.view", "View")}
                    </button>
                    <button
                      className={btn}
                      onClick={() => {
                        if (window.confirm(t("integrations.budibase.deleteQueryConfirm", "Delete this query?")))
                          mgr.run(() => mgr.api.deleteQuery(cid, q._id!)).then(refresh).catch(() => {});
                      }}
                      disabled={!q._id}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {queries.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={3}>
                  {t("integrations.budibase.noQueries", "No queries")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className={card}>
          <Labeled label={t("integrations.budibase.queryId", "Query ID")}>
            <input className={field} value={queryId} onChange={(e) => setQueryId(e.target.value)} />
          </Labeled>
          <JsonEditor
            label={t("integrations.budibase.execRequest", "Execute request (JSON)")}
            value={execJson}
            onChange={setExecJson}
            rows={4}
          />
          <button className={`${btn} mt-2`} onClick={execute} disabled={!queryId}>
            <Play size={12} />
            {t("integrations.budibase.executeQuery", "Execute query")}
          </button>
        </div>
        <div className={card}>
          <JsonEditor
            label={t("integrations.budibase.queryDef", "Query definition (JSON)")}
            value={defJson}
            onChange={setDefJson}
            rows={4}
          />
          <Toolbar>
            <button className={`${btn} mt-2`} onClick={create}>
              {t("integrations.budibase.createQuery", "Create")}
            </button>
            <button className={`${btn} mt-2`} onClick={update} disabled={!queryId}>
              {t("integrations.budibase.updateQuery", "Update")}
            </button>
          </Toolbar>
        </div>
      </div>

      {jsonError && (
        <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-500">
          JSON: {jsonError}
        </div>
      )}
      {result != null && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-[var(--color-surface)] p-2 font-mono text-[10px] text-[var(--color-textSecondary)]">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
};

// ─── Automations tab (7 cmds) ────────────────────────────────────────────────

const AutomationsTab: React.FC<{ mgr: BudibaseManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [autos, setAutos] = useState<BudibaseAutomation[]>([]);
  const [autoId, setAutoId] = useState("");
  const [triggerJson, setTriggerJson] = useState('{\n  "fields": {}\n}');
  const [defJson, setDefJson] = useState(
    '{\n  "name": "My Automation",\n  "definition": { "steps": [] }\n}',
  );
  const [logsJson, setLogsJson] = useState("{}");
  const [detail, setDetail] = useState<unknown>(null);
  const { jsonError, guard } = useJsonError();

  const refresh = useCallback(async () => {
    try {
      setAutos(await mgr.run(() => mgr.api.listAutomations(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = () =>
    guard(async () => {
      const req = parseJson<Parameters<typeof mgr.api.createAutomation>[1]>(defJson);
      if (!req) return;
      await mgr.run(() => mgr.api.createAutomation(cid, req));
      await refresh();
    });

  const update = () =>
    guard(async () => {
      if (!autoId) return;
      const req = parseJson<BudibaseAutomation>(defJson);
      if (!req) return;
      await mgr.run(() => mgr.api.updateAutomation(cid, autoId, req));
      await refresh();
    });

  const trigger = () =>
    guard(async () => {
      if (!autoId) return;
      const req = parseJson<Parameters<typeof mgr.api.triggerAutomation>[2]>(triggerJson) ?? {};
      setDetail(await mgr.run(() => mgr.api.triggerAutomation(cid, autoId, req)));
    });

  const logs = () =>
    guard(async () => {
      const req = parseJson<Parameters<typeof mgr.api.getAutomationLogs>[1]>(logsJson) ?? {};
      setDetail(await mgr.run(() => mgr.api.getAutomationLogs(cid, req)));
    });

  return (
    <div className="flex flex-col gap-3">
      <Toolbar>
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.budibase.refresh", "Refresh")}
        </button>
      </Toolbar>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.budibase.name", "Name")}</th>
              <th className="px-2 py-1">{t("integrations.budibase.automationId", "Automation ID")}</th>
              <th className="px-2 py-1">{t("integrations.budibase.disabled", "Disabled")}</th>
              <th className="px-2 py-1">{t("integrations.budibase.actions", "Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {autos.map((a) => (
              <tr key={a._id ?? a.name ?? ""} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-text)]">{a.name ?? "—"}</td>
                <td className="px-2 py-1 font-mono text-[var(--color-textSecondary)]">{a._id}</td>
                <td className="px-2 py-1">{a.disabled ? "yes" : "no"}</td>
                <td className="px-2 py-1">
                  <div className="flex flex-wrap gap-1">
                    <button className={btn} onClick={() => setAutoId(a._id ?? "")}>
                      {t("integrations.budibase.select", "Select")}
                    </button>
                    <button
                      className={btn}
                      onClick={async () => {
                        try {
                          setDetail(await mgr.run(() => mgr.api.getAutomation(cid, a._id!)));
                        } catch {
                          /* surfaced */
                        }
                      }}
                      disabled={!a._id}
                    >
                      {t("integrations.budibase.view", "View")}
                    </button>
                    <button
                      className={btn}
                      onClick={() => {
                        if (window.confirm(t("integrations.budibase.deleteAutomationConfirm", "Delete this automation?")))
                          mgr.run(() => mgr.api.deleteAutomation(cid, a._id!)).then(refresh).catch(() => {});
                      }}
                      disabled={!a._id}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {autos.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={4}>
                  {t("integrations.budibase.noAutomations", "No automations")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className={card}>
        <Labeled label={t("integrations.budibase.automationId", "Automation ID")}>
          <input className={field} value={autoId} onChange={(e) => setAutoId(e.target.value)} />
        </Labeled>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className={card}>
          <JsonEditor
            label={t("integrations.budibase.automationDef", "Definition (JSON)")}
            value={defJson}
            onChange={setDefJson}
            rows={4}
          />
          <Toolbar>
            <button className={`${btn} mt-2`} onClick={create}>
              {t("integrations.budibase.createAutomation", "Create")}
            </button>
            <button className={`${btn} mt-2`} onClick={update} disabled={!autoId}>
              {t("integrations.budibase.updateAutomation", "Update")}
            </button>
          </Toolbar>
        </div>
        <div className={card}>
          <JsonEditor
            label={t("integrations.budibase.triggerFields", "Trigger request (JSON)")}
            value={triggerJson}
            onChange={setTriggerJson}
            rows={4}
          />
          <button className={`${btn} mt-2`} onClick={trigger} disabled={!autoId}>
            <Play size={12} />
            {t("integrations.budibase.triggerAutomation", "Trigger")}
          </button>
        </div>
        <div className={card}>
          <JsonEditor
            label={t("integrations.budibase.logSearch", "Log search (JSON)")}
            value={logsJson}
            onChange={setLogsJson}
            rows={4}
          />
          <button className={`${btn} mt-2`} onClick={logs}>
            {t("integrations.budibase.getLogs", "Get logs")}
          </button>
        </div>
      </div>

      {jsonError && (
        <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-500">
          JSON: {jsonError}
        </div>
      )}
      {detail != null && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-[var(--color-surface)] p-2 font-mono text-[10px] text-[var(--color-textSecondary)]">
          {JSON.stringify(detail, null, 2)}
        </pre>
      )}
    </div>
  );
};

// ─── Datasources tab (6 cmds) ────────────────────────────────────────────────

const DatasourcesTab: React.FC<{ mgr: BudibaseManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [sources, setSources] = useState<BudibaseDatasource[]>([]);
  const [detail, setDetail] = useState<unknown>(null);
  const [createJson, setCreateJson] = useState(
    '{\n  "name": "My Datasource",\n  "source": "POSTGRES",\n  "config": {}\n}',
  );
  const [updateJson, setUpdateJson] = useState(
    '{\n  "_id": "",\n  "name": ""\n}',
  );
  const { jsonError, guard } = useJsonError();

  const refresh = useCallback(async () => {
    try {
      setSources(await mgr.run(() => mgr.api.listDatasources(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = () =>
    guard(async () => {
      const req = parseJson<Parameters<typeof mgr.api.createDatasource>[1]>(createJson);
      if (!req) return;
      await mgr.run(() => mgr.api.createDatasource(cid, req));
      await refresh();
    });

  const update = () =>
    guard(async () => {
      const req = parseJson<Parameters<typeof mgr.api.updateDatasource>[2]>(updateJson);
      if (!req) return;
      await mgr.run(() => mgr.api.updateDatasource(cid, req._id, req));
      await refresh();
    });

  return (
    <div className="flex flex-col gap-3">
      <Toolbar>
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.budibase.refresh", "Refresh")}
        </button>
      </Toolbar>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.budibase.name", "Name")}</th>
              <th className="px-2 py-1">{t("integrations.budibase.source", "Source")}</th>
              <th className="px-2 py-1">{t("integrations.budibase.datasourceId", "Datasource ID")}</th>
              <th className="px-2 py-1">{t("integrations.budibase.actions", "Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((ds) => (
              <tr key={ds._id ?? ds.name} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-text)]">{ds.name}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{ds.source}</td>
                <td className="px-2 py-1 font-mono text-[var(--color-textSecondary)]">{ds._id}</td>
                <td className="px-2 py-1">
                  <div className="flex flex-wrap gap-1">
                    <button
                      className={btn}
                      onClick={async () => {
                        try {
                          setDetail(await mgr.run(() => mgr.api.getDatasource(cid, ds._id!)));
                        } catch {
                          /* surfaced */
                        }
                      }}
                      disabled={!ds._id}
                    >
                      {t("integrations.budibase.view", "View")}
                    </button>
                    <button
                      className={btn}
                      onClick={async () => {
                        try {
                          setDetail(await mgr.run(() => mgr.api.testDatasource(cid, ds._id!)));
                        } catch {
                          /* surfaced */
                        }
                      }}
                      disabled={!ds._id}
                    >
                      {t("integrations.budibase.test", "Test")}
                    </button>
                    <button
                      className={btn}
                      onClick={() => {
                        if (window.confirm(t("integrations.budibase.deleteDatasourceConfirm", "Delete this datasource?")))
                          mgr.run(() => mgr.api.deleteDatasource(cid, ds._id!, ds._rev ?? undefined)).then(refresh).catch(() => {});
                      }}
                      disabled={!ds._id}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {sources.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={4}>
                  {t("integrations.budibase.noDatasources", "No datasources")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className={card}>
          <JsonEditor
            label={t("integrations.budibase.createDatasource", "Create datasource (JSON)")}
            value={createJson}
            onChange={setCreateJson}
          />
          <button className={`${btn} mt-2`} onClick={create}>
            {t("integrations.budibase.createDatasource", "Create datasource")}
          </button>
        </div>
        <div className={card}>
          <JsonEditor
            label={t("integrations.budibase.updateDatasource", "Update datasource (JSON)")}
            value={updateJson}
            onChange={setUpdateJson}
          />
          <button className={`${btn} mt-2`} onClick={update}>
            {t("integrations.budibase.updateDatasource", "Update datasource")}
          </button>
        </div>
      </div>

      {jsonError && (
        <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-500">
          JSON: {jsonError}
        </div>
      )}
      {detail != null && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-[var(--color-surface)] p-2 font-mono text-[10px] text-[var(--color-textSecondary)]">
          {JSON.stringify(detail, null, 2)}
        </pre>
      )}
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
  { key: "apps", labelKey: "integrations.budibase.tabApps", labelDefault: "Apps", icon: AppWindow },
  { key: "tables", labelKey: "integrations.budibase.tabTables", labelDefault: "Tables", icon: Table2 },
  { key: "rows", labelKey: "integrations.budibase.tabRows", labelDefault: "Rows", icon: Rows3 },
  { key: "views", labelKey: "integrations.budibase.tabViews", labelDefault: "Views", icon: Layers },
  { key: "users", labelKey: "integrations.budibase.tabUsers", labelDefault: "Users", icon: Users },
  { key: "queries", labelKey: "integrations.budibase.tabQueries", labelDefault: "Queries", icon: FileJson },
  { key: "automations", labelKey: "integrations.budibase.tabAutomations", labelDefault: "Automations", icon: Workflow },
  { key: "datasources", labelKey: "integrations.budibase.tabDatasources", labelDefault: "Datasources", icon: Database },
];

const BudibasePanel: React.FC<IntegrationPanelProps> = ({
  isOpen,
  instanceId,
}) => {
  const { t } = useTranslation();
  const mgr = useBudibase();
  const [tab, setTab] = useState<TabKey>("apps");

  if (!isOpen) return null;

  const cid = mgr.connectionId;

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[var(--color-surface)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--color-text)]">
          <Boxes className="h-5 w-5 text-primary" />
          {t("integrations.budibase.title", "Budibase")}
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
              ? mgr.status?.host ?? t("integrations.budibase.connected", "Connected")
              : t("integrations.budibase.disconnected", "Disconnected")}
          </span>
          {mgr.status?.version && (
            <span className="text-[var(--color-textMuted)]">v{mgr.status.version}</span>
          )}
          {mgr.isConnected && (
            <button className={btn} onClick={() => void mgr.disconnect()}>
              {t("integrations.budibase.disconnect", "Disconnect")}
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
            {tab === "apps" && <AppsTab mgr={mgr} cid={cid} />}
            {tab === "tables" && <TablesTab mgr={mgr} cid={cid} />}
            {tab === "rows" && <RowsTab mgr={mgr} cid={cid} />}
            {tab === "views" && <ViewsTab mgr={mgr} cid={cid} />}
            {tab === "users" && <UsersTab mgr={mgr} cid={cid} />}
            {tab === "queries" && <QueriesTab mgr={mgr} cid={cid} />}
            {tab === "automations" && <AutomationsTab mgr={mgr} cid={cid} />}
            {tab === "datasources" && <DatasourcesTab mgr={mgr} cid={cid} />}
          </div>
        </>
      )}
    </div>
  );
};

export default BudibasePanel;

/** Registry descriptor for the Budibase integration (category: app-service).
 *  The Wave-3 app-service integrator appends this to `registry.appservice.ts`. */
export const budibaseDescriptor: IntegrationDescriptor = {
  key: "budibase",
  label: "Budibase",
  category: "business-app",
  icon: Boxes,
  importPanel: () => import("./BudibasePanel"),
};
