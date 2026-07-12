// Microsoft SQL Server integration panel (t42-mssql).
//
// Full management surface for the sorng-mssql crate — binds ALL 31 `mssql_*`
// commands through `useMssql()` / `mssqlApi`. `mssql_connect` returns a session
// id which the hook threads to every subsequent command. Connect form maps to
// `mssql_connect` (SQL / Windows / Azure AD auth, optional SSH tunnel + TLS);
// sub-tabs cover query, schema/DDL, data & import/export, administration and
// the session registry.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Database,
  Play,
  FileCode,
  Table as TableIcon,
  RefreshCw,
  Loader2,
  Plug,
  Trash2,
  ShieldCheck,
  Activity,
  Server,
  Download,
  Upload,
  Layers,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMssql, type MssqlManager } from "../../hooks/integration/useMssql";
import { useIntegrationConfigStore } from "../../hooks/integrations/useIntegrationConfigStore";
import type {
  IntegrationDescriptor,
  IntegrationPanelProps,
} from "../../types/integrations/registry";
import {
  defaultExportOptions,
  type ColumnDef,
  type DatabaseInfo,
  type ForeignKeyInfo,
  type IndexInfo,
  type MssqlAuthMethod,
  type MssqlConnectionConfig,
  type QueryResult,
  type SchemaInfo,
  type ServerProperty,
  type SessionInfo,
  type SpWhoResult,
  type SqlLogin,
  type StoredProcInfo,
  type TableInfo,
  type TriggerInfo,
  type ViewInfo,
} from "../../types/mssql";

// ─── Small shared UI helpers ────────────────────────────────────────────────

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

function cell(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Renders a `QueryResult` as a scrollable table. */
const ResultGrid: React.FC<{ result: QueryResult | null }> = ({ result }) => {
  const { t } = useTranslation();
  if (!result) return null;
  if (result.columns.length === 0) {
    return (
      <p className="text-xs text-[var(--color-textSecondary)]">
        {t("integrations.mssql.affectedRows", "Rows affected")}:{" "}
        {result.affected_rows} · {result.execution_time_ms} ms
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[10px] uppercase tracking-wide text-[var(--color-textMuted)]">
        {result.rows.length} {t("integrations.mssql.rows", "rows")} ·{" "}
        {result.execution_time_ms} ms
      </div>
      <div className="max-h-80 overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-[var(--color-surfaceHover)] text-[var(--color-textMuted)]">
            <tr>
              {result.columns.map((c) => (
                <th key={c.ordinal} className="px-2 py-1 whitespace-nowrap">
                  {c.name}
                  <span className="ml-1 text-[9px] text-[var(--color-textMuted)]">
                    {c.type_name}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, i) => (
              <tr key={i} className="border-t border-[var(--color-border)]">
                {result.columns.map((c) => (
                  <td
                    key={c.ordinal}
                    className="px-2 py-1 text-[var(--color-text)] whitespace-nowrap"
                  >
                    {cell(row[c.name])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

type TabKey = "query" | "schema" | "data" | "admin" | "sessions";
type AuthKind = "SqlAuth" | "WindowsAuth" | "AzureAd";

// ─── Connect form ───────────────────────────────────────────────────────────

interface ConnectState {
  host: string;
  port: string;
  authKind: AuthKind;
  username: string;
  password: string;
  database: string;
  instanceName: string;
  applicationName: string;
  timeoutSecs: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
  useSshTunnel: boolean;
  sshHost: string;
  sshPort: string;
  sshUsername: string;
  sshPassword: string;
  sshKeyPath: string;
  name: string;
}

const emptyConnect: ConnectState = {
  host: "",
  port: "1433",
  authKind: "SqlAuth",
  username: "",
  password: "",
  database: "",
  instanceName: "",
  applicationName: "",
  timeoutSecs: "15",
  encrypt: true,
  trustServerCertificate: true,
  useSshTunnel: false,
  sshHost: "",
  sshPort: "22",
  sshUsername: "",
  sshPassword: "",
  sshKeyPath: "",
  name: "",
};

function buildAuth(form: ConnectState): MssqlAuthMethod {
  if (form.authKind === "WindowsAuth") return "WindowsAuth";
  const creds = { username: form.username, password: form.password };
  return form.authKind === "AzureAd"
    ? { AzureAd: creds }
    : { SqlAuth: creds };
}

function buildConfig(form: ConnectState): MssqlConnectionConfig {
  return {
    host: form.host.trim(),
    port: Number(form.port) || 1433,
    auth: buildAuth(form),
    database: form.database.trim() || null,
    instance_name: form.instanceName.trim() || null,
    application_name: form.applicationName.trim() || null,
    connection_timeout_secs: form.timeoutSecs ? Number(form.timeoutSecs) : null,
    encrypt: form.encrypt,
    tls: {
      trust_server_certificate: form.trustServerCertificate,
      ca_cert_path: null,
    },
    ssh_tunnel: form.useSshTunnel
      ? {
          host: form.sshHost.trim(),
          port: Number(form.sshPort) || 22,
          username: form.sshUsername.trim(),
          password: form.sshPassword || null,
          private_key_path: form.sshKeyPath.trim() || null,
          passphrase: null,
        }
      : null,
  };
}

const ConnectForm: React.FC<{
  mgr: MssqlManager;
  instanceId?: string;
}> = ({ mgr, instanceId }) => {
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
      port: inst.fields?.port ?? "1433",
      authKind: (inst.fields?.authKind as AuthKind) ?? "SqlAuth",
      username: inst.fields?.username ?? "",
      database: inst.fields?.database ?? "",
      instanceName: inst.fields?.instanceName ?? "",
      applicationName: inst.fields?.applicationName ?? "",
      timeoutSecs: inst.fields?.timeoutSecs ?? "15",
      encrypt: inst.fields?.encrypt !== "false",
      trustServerCertificate: inst.fields?.trustServerCertificate !== "false",
    }));
    store.readSecret(inst).then((secret) => {
      if (secret) setForm((f) => ({ ...f, password: secret }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, store.isLoading]);

  const set = <K extends keyof ConnectState>(k: K, v: ConnectState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const needsCreds = form.authKind !== "WindowsAuth";

  const doConnect = useCallback(async () => {
    try {
      await mgr.connect(buildConfig(form));
    } catch {
      // surfaced via mgr.error
    }
  }, [mgr, form]);

  const doSave = useCallback(async () => {
    const fields: Record<string, string> = {
      port: form.port,
      authKind: form.authKind,
      username: form.username,
      database: form.database,
      instanceName: form.instanceName,
      applicationName: form.applicationName,
      timeoutSecs: form.timeoutSecs,
      encrypt: String(form.encrypt),
      trustServerCertificate: String(form.trustServerCertificate),
    };
    if (savedId) {
      await store.updateInstance(savedId, {
        name: form.name || form.host,
        host: form.host,
        fields,
        secret: form.password || undefined,
      });
    } else {
      const created = await store.createInstance({
        integrationKey: "mssql",
        name: form.name || form.host,
        host: form.host,
        fields,
        secret: form.password || undefined,
      });
      setSavedId(created.id);
    }
  }, [store, form, savedId]);

  return (
    <div className={card}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Labeled label={t("integrations.mssql.host", "Server host")}>
          <input
            className={field}
            value={form.host}
            onChange={(e) => set("host", e.target.value)}
            placeholder="sql.lab.local"
          />
        </Labeled>
        <Labeled label={t("integrations.mssql.port", "Port")}>
          <input
            className={field}
            value={form.port}
            onChange={(e) => set("port", e.target.value)}
            inputMode="numeric"
          />
        </Labeled>
        <Labeled label={t("integrations.mssql.authMethod", "Authentication")}>
          <select
            className={field}
            value={form.authKind}
            onChange={(e) => set("authKind", e.target.value as AuthKind)}
          >
            <option value="SqlAuth">
              {t("integrations.mssql.sqlAuth", "SQL Server login")}
            </option>
            <option value="WindowsAuth">
              {t("integrations.mssql.windowsAuth", "Windows (integrated)")}
            </option>
            <option value="AzureAd">
              {t("integrations.mssql.azureAd", "Azure AD password")}
            </option>
          </select>
        </Labeled>
        <Labeled label={t("integrations.mssql.database", "Database (optional)")}>
          <input
            className={field}
            value={form.database}
            onChange={(e) => set("database", e.target.value)}
            placeholder="master"
          />
        </Labeled>
        {needsCreds && (
          <>
            <Labeled label={t("integrations.mssql.username", "Username")}>
              <input
                className={field}
                value={form.username}
                onChange={(e) => set("username", e.target.value)}
                placeholder="sa"
              />
            </Labeled>
            <Labeled label={t("integrations.mssql.password", "Password")}>
              <input
                className={field}
                type="password"
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
              />
            </Labeled>
          </>
        )}
        <Labeled
          label={t("integrations.mssql.instanceName", "Named instance (optional)")}
        >
          <input
            className={field}
            value={form.instanceName}
            onChange={(e) => set("instanceName", e.target.value)}
            placeholder="SQLEXPRESS"
          />
        </Labeled>
        <Labeled
          label={t("integrations.mssql.appName", "Application name (optional)")}
        >
          <input
            className={field}
            value={form.applicationName}
            onChange={(e) => set("applicationName", e.target.value)}
          />
        </Labeled>
        <Labeled label={t("integrations.mssql.timeout", "Timeout (seconds)")}>
          <input
            className={field}
            value={form.timeoutSecs}
            onChange={(e) => set("timeoutSecs", e.target.value)}
            inputMode="numeric"
          />
        </Labeled>
        <Labeled label={t("integrations.mssql.savedName", "Saved name")}>
          <input
            className={field}
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder={form.host}
          />
        </Labeled>
      </div>

      <div className="mt-3 flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
          <input
            type="checkbox"
            checked={form.encrypt}
            onChange={(e) => set("encrypt", e.target.checked)}
          />
          {t("integrations.mssql.encrypt", "Encrypt connection")}
        </label>
        <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
          <input
            type="checkbox"
            checked={form.trustServerCertificate}
            onChange={(e) => set("trustServerCertificate", e.target.checked)}
          />
          {t(
            "integrations.mssql.trustCert",
            "Trust server certificate (self-signed)",
          )}
        </label>
        <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
          <input
            type="checkbox"
            checked={form.useSshTunnel}
            onChange={(e) => set("useSshTunnel", e.target.checked)}
          />
          {t("integrations.mssql.useSshTunnel", "Connect through SSH tunnel")}
        </label>
      </div>

      {form.useSshTunnel && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Labeled label={t("integrations.mssql.sshHost", "SSH host")}>
            <input
              className={field}
              value={form.sshHost}
              onChange={(e) => set("sshHost", e.target.value)}
            />
          </Labeled>
          <Labeled label={t("integrations.mssql.sshPort", "SSH port")}>
            <input
              className={field}
              value={form.sshPort}
              onChange={(e) => set("sshPort", e.target.value)}
              inputMode="numeric"
            />
          </Labeled>
          <Labeled label={t("integrations.mssql.sshUsername", "SSH username")}>
            <input
              className={field}
              value={form.sshUsername}
              onChange={(e) => set("sshUsername", e.target.value)}
            />
          </Labeled>
          <Labeled label={t("integrations.mssql.sshPassword", "SSH password")}>
            <input
              className={field}
              type="password"
              value={form.sshPassword}
              onChange={(e) => set("sshPassword", e.target.value)}
            />
          </Labeled>
          <Labeled
            label={t("integrations.mssql.sshKeyPath", "SSH private key path")}
          >
            <input
              className={field}
              value={form.sshKeyPath}
              onChange={(e) => set("sshKeyPath", e.target.value)}
              placeholder="~/.ssh/id_ed25519"
            />
          </Labeled>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className={btn}
          onClick={doConnect}
          disabled={
            mgr.isLoading || !form.host || (needsCreds && !form.username)
          }
        >
          {mgr.isLoading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Plug size={12} />
          )}
          {t("integrations.mssql.connect", "Connect")}
        </button>
        <button className={btn} onClick={doSave} disabled={!form.host}>
          {t("integrations.mssql.save", "Save instance")}
        </button>
      </div>
    </div>
  );
};

// ─── Query tab (execute_query / execute_statement / import_sql) ──────────────

const QueryTab: React.FC<{ mgr: MssqlManager }> = ({ mgr }) => {
  const { t } = useTranslation();
  const sid = mgr.sessionId;
  const [sql, setSql] = useState("SELECT @@VERSION;");
  const [result, setResult] = useState<QueryResult | null>(null);

  const runQuery = useCallback(
    async (fn: (id: string, sql: string) => Promise<QueryResult>) => {
      if (!sid) return;
      try {
        setResult(await mgr.run(() => fn(sid, sql)));
      } catch {
        setResult(null);
      }
    },
    [mgr, sid, sql],
  );

  const importSql = useCallback(async () => {
    if (!sid || !sql.trim()) return;
    try {
      const n = await mgr.run(() => mgr.api.importSql(sid, sql));
      window.alert(
        `${t("integrations.mssql.statementsRun", "Statements executed")}: ${n}`,
      );
    } catch {
      /* surfaced */
    }
  }, [mgr, sid, sql, t]);

  return (
    <div className="flex flex-col gap-3">
      <textarea
        className={`${field} font-mono`}
        rows={6}
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        placeholder="SELECT * FROM sys.databases;"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          className={btn}
          onClick={() => runQuery(mgr.api.executeQuery)}
          disabled={mgr.isLoading || !sql.trim()}
        >
          <Play size={12} />
          {t("integrations.mssql.runQuery", "Run query")}
        </button>
        <button
          className={btn}
          onClick={() => runQuery(mgr.api.executeStatement)}
          disabled={mgr.isLoading || !sql.trim()}
        >
          <FileCode size={12} />
          {t("integrations.mssql.runStatement", "Run statement")}
        </button>
        <button
          className={btn}
          onClick={importSql}
          disabled={mgr.isLoading || !sql.trim()}
        >
          <Upload size={12} />
          {t("integrations.mssql.importSql", "Import as SQL script")}
        </button>
      </div>
      <ResultGrid result={result} />
    </div>
  );
};

// ─── Schema tab (databases, schemas, tables, describe, indexes, fks, views,
//     stored procs, triggers) + DDL (create/drop db, drop/truncate table) ─────

const SchemaTab: React.FC<{ mgr: MssqlManager }> = ({ mgr }) => {
  const { t } = useTranslation();
  const sid = mgr.sessionId;
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [schemas, setSchemas] = useState<SchemaInfo[]>([]);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [views, setViews] = useState<ViewInfo[]>([]);
  const [procs, setProcs] = useState<StoredProcInfo[]>([]);
  const [triggers, setTriggers] = useState<TriggerInfo[]>([]);
  const [schema, setSchema] = useState("dbo");
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [columns, setColumns] = useState<ColumnDef[]>([]);
  const [indexes, setIndexes] = useState<IndexInfo[]>([]);
  const [fks, setFks] = useState<ForeignKeyInfo[]>([]);

  const loadDatabases = useCallback(async () => {
    if (!sid) return;
    try {
      setDatabases(await mgr.run(() => mgr.api.listDatabases(sid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, sid]);

  const loadSchemaObjects = useCallback(async () => {
    if (!sid) return;
    const safe = async <T,>(p: Promise<T>, set: (v: T) => void) => {
      try {
        set(await p);
      } catch {
        /* surfaced */
      }
    };
    await mgr.run(async () => {
      await Promise.all([
        safe(mgr.api.listSchemas(sid), setSchemas),
        safe(mgr.api.listTables(sid, schema), setTables),
        safe(mgr.api.listViews(sid, schema), setViews),
        safe(mgr.api.listStoredProcs(sid, schema), setProcs),
        safe(mgr.api.listTriggers(sid, schema), setTriggers),
      ]);
    });
  }, [mgr, sid, schema]);

  useEffect(() => {
    void loadDatabases();
  }, [loadDatabases]);

  const inspect = useCallback(
    async (table: string) => {
      if (!sid) return;
      setSelectedTable(table);
      const safe = async <T,>(p: Promise<T>, set: (v: T) => void) => {
        try {
          set(await p);
        } catch {
          /* surfaced */
        }
      };
      await mgr.run(async () => {
        await Promise.all([
          safe(mgr.api.describeTable(sid, schema, table), setColumns),
          safe(mgr.api.listIndexes(sid, schema, table), setIndexes),
          safe(mgr.api.listForeignKeys(sid, schema, table), setFks),
        ]);
      });
    },
    [mgr, sid, schema],
  );

  const createDatabase = useCallback(async () => {
    if (!sid) return;
    const name = window.prompt(
      t("integrations.mssql.createDbPrompt", "New database name"),
    );
    if (!name) return;
    await mgr.run(() => mgr.api.createDatabase(sid, name)).catch(() => {});
    await loadDatabases();
  }, [mgr, sid, t, loadDatabases]);

  const dropDatabase = useCallback(
    async (name: string) => {
      if (!sid) return;
      if (
        !window.confirm(
          t("integrations.mssql.dropDbConfirm", "Drop database {{name}}?").replace(
            "{{name}}",
            name,
          ),
        )
      )
        return;
      await mgr.run(() => mgr.api.dropDatabase(sid, name)).catch(() => {});
      await loadDatabases();
    },
    [mgr, sid, t, loadDatabases],
  );

  const dropTable = useCallback(
    async (table: string) => {
      if (!sid) return;
      if (
        !window.confirm(
          t("integrations.mssql.dropTableConfirm", "Drop table {{t}}?").replace(
            "{{t}}",
            table,
          ),
        )
      )
        return;
      await mgr.run(() => mgr.api.dropTable(sid, schema, table)).catch(() => {});
      await loadSchemaObjects();
    },
    [mgr, sid, schema, t, loadSchemaObjects],
  );

  const truncateTable = useCallback(
    async (table: string) => {
      if (!sid) return;
      if (
        !window.confirm(
          t(
            "integrations.mssql.truncateConfirm",
            "Truncate (delete all rows of) {{t}}?",
          ).replace("{{t}}", table),
        )
      )
        return;
      await mgr
        .run(() => mgr.api.truncateTable(sid, schema, table))
        .catch(() => {});
    },
    [mgr, sid, schema, t],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={loadDatabases} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.mssql.databases", "Databases")}
        </button>
        <button className={btn} onClick={createDatabase}>
          {t("integrations.mssql.createDb", "Create database")}
        </button>
        <span className="ml-2 text-xs text-[var(--color-textSecondary)]">
          {t("integrations.mssql.schema", "Schema")}
        </span>
        <input
          className={field}
          style={{ width: 120 }}
          value={schema}
          onChange={(e) => setSchema(e.target.value)}
        />
        <button className={btn} onClick={loadSchemaObjects} disabled={mgr.isLoading}>
          <Layers size={12} />
          {t("integrations.mssql.loadObjects", "Load objects")}
        </button>
      </div>

      <section className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.mssql.databases", "Databases")}
        </h4>
        <div className="flex flex-col gap-1">
          {databases.map((d) => (
            <div
              key={d.name}
              className="flex items-center justify-between text-xs text-[var(--color-textSecondary)]"
            >
              <span>
                {d.name}
                {d.size_mb != null ? ` · ${d.size_mb} MB` : ""}
                {d.state ? ` · ${d.state}` : ""}
              </span>
              <button
                className={btn}
                title={t("integrations.mssql.dropDb", "Drop database")}
                onClick={() => void dropDatabase(d.name)}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {databases.length === 0 && (
            <span className="text-xs text-[var(--color-textMuted)]">—</span>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <section className={card}>
          <h4 className="mb-2 flex items-center gap-1 text-xs font-semibold text-[var(--color-text)]">
            <TableIcon size={12} /> {t("integrations.mssql.tables", "Tables")} (
            {schema})
          </h4>
          <div className="flex flex-col gap-1">
            {tables.map((tb) => (
              <div
                key={tb.name}
                className="flex items-center justify-between text-xs"
              >
                <button
                  className={`text-left ${
                    selectedTable === tb.name
                      ? "text-[var(--color-text)]"
                      : "text-[var(--color-textSecondary)]"
                  }`}
                  onClick={() => void inspect(tb.name)}
                >
                  {tb.name}
                  {tb.row_count != null ? ` · ${tb.row_count} rows` : ""}
                </button>
                <div className="flex gap-1">
                  <button
                    className={btn}
                    title={t("integrations.mssql.truncate", "Truncate")}
                    onClick={() => void truncateTable(tb.name)}
                  >
                    T
                  </button>
                  <button
                    className={btn}
                    title={t("integrations.mssql.dropTable", "Drop table")}
                    onClick={() => void dropTable(tb.name)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
            {tables.length === 0 && (
              <span className="text-xs text-[var(--color-textMuted)]">—</span>
            )}
          </div>
        </section>

        <section className={card}>
          <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
            {t("integrations.mssql.schemas", "Schemas")} ·{" "}
            {t("integrations.mssql.views", "Views")} ·{" "}
            {t("integrations.mssql.procs", "Procedures")} ·{" "}
            {t("integrations.mssql.triggers", "Triggers")}
          </h4>
          <div className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
            <div>
              {t("integrations.mssql.schemas", "Schemas")}:{" "}
              {schemas.map((s) => s.name).join(", ") || "—"}
            </div>
            <div>
              {t("integrations.mssql.views", "Views")}:{" "}
              {views.map((v) => v.name).join(", ") || "—"}
            </div>
            <div>
              {t("integrations.mssql.procs", "Procedures")}:{" "}
              {procs.map((p) => p.name).join(", ") || "—"}
            </div>
            <div>
              {t("integrations.mssql.triggers", "Triggers")}:{" "}
              {triggers.map((tr) => tr.name).join(", ") || "—"}
            </div>
          </div>
        </section>
      </div>

      {selectedTable && (
        <section className={card}>
          <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
            {schema}.{selectedTable}
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[var(--color-textMuted)]">
                <tr>
                  <th className="px-2 py-1">
                    {t("integrations.mssql.column", "Column")}
                  </th>
                  <th className="px-2 py-1">
                    {t("integrations.mssql.type", "Type")}
                  </th>
                  <th className="px-2 py-1">
                    {t("integrations.mssql.nullable", "Nullable")}
                  </th>
                  <th className="px-2 py-1">
                    {t("integrations.mssql.default", "Default")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {columns.map((c) => (
                  <tr
                    key={c.ordinal_position}
                    className="border-t border-[var(--color-border)]"
                  >
                    <td className="px-2 py-1 text-[var(--color-text)]">
                      {c.name}
                      {c.is_identity ? " ⚿" : ""}
                    </td>
                    <td className="px-2 py-1">{c.data_type}</td>
                    <td className="px-2 py-1">{c.is_nullable ? "✓" : ""}</td>
                    <td className="px-2 py-1">{c.default_value ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 text-xs text-[var(--color-textSecondary)]">
            <div>
              {t("integrations.mssql.indexes", "Indexes")}:{" "}
              {indexes.map((i) => i.name).join(", ") || "—"}
            </div>
            <div>
              {t("integrations.mssql.foreignKeys", "Foreign keys")}:{" "}
              {fks
                .map((f) => `${f.name}→${f.referenced_table}`)
                .join(", ") || "—"}
            </div>
          </div>
        </section>
      )}
    </div>
  );
};

// ─── Data tab (get_table_data + insert/update/delete rows + export/import csv) ─

const DataTab: React.FC<{ mgr: MssqlManager }> = ({ mgr }) => {
  const { t } = useTranslation();
  const sid = mgr.sessionId;
  const [schema, setSchema] = useState("dbo");
  const [table, setTable] = useState("");
  const [limit, setLimit] = useState("100");
  const [offset, setOffset] = useState("0");
  const [result, setResult] = useState<QueryResult | null>(null);

  const load = useCallback(async () => {
    if (!sid || !table.trim()) return;
    try {
      setResult(
        await mgr.run(() =>
          mgr.api.getTableData(
            sid,
            schema,
            table.trim(),
            limit ? Number(limit) : undefined,
            offset ? Number(offset) : undefined,
          ),
        ),
      );
    } catch {
      setResult(null);
    }
  }, [mgr, sid, schema, table, limit, offset]);

  const insertRow = useCallback(async () => {
    if (!sid || !table.trim()) return;
    const cols = window.prompt(
      t("integrations.mssql.insertColsPrompt", "Columns (comma-separated)"),
    );
    if (!cols) return;
    const vals = window.prompt(
      t("integrations.mssql.insertValsPrompt", "Values (comma-separated)"),
    );
    if (vals == null) return;
    const columns = cols.split(",").map((s) => s.trim());
    const values = vals.split(",").map((s) => s.trim());
    await mgr
      .run(() => mgr.api.insertRow(sid, schema, table.trim(), columns, values))
      .catch(() => {});
    await load();
  }, [mgr, sid, schema, table, t, load]);

  const updateRows = useCallback(async () => {
    if (!sid || !table.trim()) return;
    const cols = window.prompt(
      t("integrations.mssql.updateColsPrompt", "Columns to set (comma-separated)"),
    );
    if (!cols) return;
    const vals = window.prompt(
      t("integrations.mssql.updateValsPrompt", "New values (comma-separated)"),
    );
    if (vals == null) return;
    const where = window.prompt(
      t("integrations.mssql.wherePrompt", "WHERE clause (no 'WHERE')"),
    );
    if (!where) return;
    const columns = cols.split(",").map((s) => s.trim());
    const values = vals.split(",").map((s) => s.trim());
    const n = await mgr
      .run(() =>
        mgr.api.updateRows(sid, schema, table.trim(), columns, values, where),
      )
      .catch(() => null);
    if (n != null)
      window.alert(`${t("integrations.mssql.rowsAffected", "Rows affected")}: ${n}`);
    await load();
  }, [mgr, sid, schema, table, t, load]);

  const deleteRows = useCallback(async () => {
    if (!sid || !table.trim()) return;
    const where = window.prompt(
      t("integrations.mssql.deleteWherePrompt", "WHERE clause for DELETE (no 'WHERE')"),
    );
    if (!where) return;
    if (
      !window.confirm(
        t("integrations.mssql.deleteConfirm", "Delete rows matching: {{w}}?").replace(
          "{{w}}",
          where,
        ),
      )
    )
      return;
    const n = await mgr
      .run(() => mgr.api.deleteRows(sid, schema, table.trim(), where))
      .catch(() => null);
    if (n != null)
      window.alert(`${t("integrations.mssql.rowsDeleted", "Rows deleted")}: ${n}`);
    await load();
  }, [mgr, sid, schema, table, t, load]);

  const exportTable = useCallback(async () => {
    if (!sid || !table.trim()) return;
    const out = await mgr
      .run(() =>
        mgr.api.exportTable(sid, schema, table.trim(), defaultExportOptions()),
      )
      .catch(() => null);
    if (out)
      window.alert(
        `${t("integrations.mssql.exportedTo", "Exported to")}: ${out}`,
      );
  }, [mgr, sid, schema, table, t]);

  const importCsv = useCallback(async () => {
    if (!sid || !table.trim()) return;
    const content = window.prompt(
      t("integrations.mssql.csvPrompt", "Paste CSV content"),
    );
    if (!content) return;
    const n = await mgr
      .run(() => mgr.api.importCsv(sid, schema, table.trim(), content, true))
      .catch(() => null);
    if (n != null)
      window.alert(`${t("integrations.mssql.rowsImported", "Rows imported")}: ${n}`);
    await load();
  }, [mgr, sid, schema, table, t, load]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <Labeled label={t("integrations.mssql.schema", "Schema")}>
          <input
            className={field}
            style={{ width: 100 }}
            value={schema}
            onChange={(e) => setSchema(e.target.value)}
          />
        </Labeled>
        <Labeled label={t("integrations.mssql.table", "Table")}>
          <input
            className={field}
            style={{ width: 160 }}
            value={table}
            onChange={(e) => setTable(e.target.value)}
          />
        </Labeled>
        <Labeled label={t("integrations.mssql.limit", "Limit")}>
          <input
            className={field}
            style={{ width: 80 }}
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            inputMode="numeric"
          />
        </Labeled>
        <Labeled label={t("integrations.mssql.offset", "Offset")}>
          <input
            className={field}
            style={{ width: 80 }}
            value={offset}
            onChange={(e) => setOffset(e.target.value)}
            inputMode="numeric"
          />
        </Labeled>
        <button
          className={btn}
          onClick={load}
          disabled={mgr.isLoading || !table.trim()}
        >
          <RefreshCw size={12} />
          {t("integrations.mssql.loadData", "Load data")}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className={btn} onClick={insertRow} disabled={!table.trim()}>
          {t("integrations.mssql.insertRow", "Insert row")}
        </button>
        <button className={btn} onClick={updateRows} disabled={!table.trim()}>
          {t("integrations.mssql.updateRows", "Update rows")}
        </button>
        <button className={btn} onClick={deleteRows} disabled={!table.trim()}>
          {t("integrations.mssql.deleteRows", "Delete rows")}
        </button>
        <button className={btn} onClick={exportTable} disabled={!table.trim()}>
          <Download size={12} />
          {t("integrations.mssql.exportTable", "Export table")}
        </button>
        <button className={btn} onClick={importCsv} disabled={!table.trim()}>
          <Upload size={12} />
          {t("integrations.mssql.importCsv", "Import CSV")}
        </button>
      </div>
      <ResultGrid result={result} />
    </div>
  );
};

// ─── Admin tab (server_properties, show_processes, kill_process, list_logins) ─

const AdminTab: React.FC<{ mgr: MssqlManager }> = ({ mgr }) => {
  const { t } = useTranslation();
  const sid = mgr.sessionId;
  const [props, setProps] = useState<ServerProperty[]>([]);
  const [processes, setProcesses] = useState<SpWhoResult[]>([]);
  const [logins, setLogins] = useState<SqlLogin[]>([]);

  const refresh = useCallback(async () => {
    if (!sid) return;
    const safe = async <T,>(p: Promise<T>, set: (v: T) => void) => {
      try {
        set(await p);
      } catch {
        /* surfaced */
      }
    };
    await mgr.run(async () => {
      await Promise.all([
        safe(mgr.api.serverProperties(sid), setProps),
        safe(mgr.api.showProcesses(sid), setProcesses),
        safe(mgr.api.listLogins(sid), setLogins),
      ]);
    });
  }, [mgr, sid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const kill = useCallback(
    async (spid: number) => {
      if (!sid) return;
      if (
        !window.confirm(
          t("integrations.mssql.killConfirm", "Kill process {{spid}}?").replace(
            "{{spid}}",
            String(spid),
          ),
        )
      )
        return;
      await mgr.run(() => mgr.api.killProcess(sid, spid)).catch(() => {});
      await refresh();
    },
    [mgr, sid, t, refresh],
  );

  return (
    <div className="flex flex-col gap-3">
      <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
        <RefreshCw size={12} />
        {t("integrations.mssql.refresh", "Refresh")}
      </button>

      <section className={card}>
        <h4 className="mb-2 flex items-center gap-1 text-xs font-semibold text-[var(--color-text)]">
          <Server size={12} />{" "}
          {t("integrations.mssql.serverProperties", "Server properties")}
        </h4>
        <div className="grid grid-cols-1 gap-1 text-xs text-[var(--color-textSecondary)] sm:grid-cols-2">
          {props.map((p) => (
            <div key={p.name}>
              <span className="text-[var(--color-textMuted)]">{p.name}:</span>{" "}
              {p.value ?? "—"}
            </div>
          ))}
          {props.length === 0 && <span>—</span>}
        </div>
      </section>

      <section className={card}>
        <h4 className="mb-2 flex items-center gap-1 text-xs font-semibold text-[var(--color-text)]">
          <Activity size={12} />{" "}
          {t("integrations.mssql.processes", "Active processes")}
        </h4>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[var(--color-textMuted)]">
              <tr>
                <th className="px-2 py-1">SPID</th>
                <th className="px-2 py-1">
                  {t("integrations.mssql.login", "Login")}
                </th>
                <th className="px-2 py-1">
                  {t("integrations.mssql.dbName", "Database")}
                </th>
                <th className="px-2 py-1">
                  {t("integrations.mssql.command", "Command")}
                </th>
                <th className="px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {processes.map((p) => (
                <tr
                  key={p.spid}
                  className="border-t border-[var(--color-border)]"
                >
                  <td className="px-2 py-1 text-[var(--color-text)]">{p.spid}</td>
                  <td className="px-2 py-1">{p.login_name ?? "—"}</td>
                  <td className="px-2 py-1">{p.database_name ?? "—"}</td>
                  <td className="px-2 py-1">{p.command ?? "—"}</td>
                  <td className="px-2 py-1">
                    <button
                      className={btn}
                      title={t("integrations.mssql.kill", "Kill")}
                      onClick={() => void kill(p.spid)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
              {processes.length === 0 && (
                <tr>
                  <td
                    className="px-2 py-2 text-[var(--color-textMuted)]"
                    colSpan={5}
                  >
                    —
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className={card}>
        <h4 className="mb-2 flex items-center gap-1 text-xs font-semibold text-[var(--color-text)]">
          <ShieldCheck size={12} /> {t("integrations.mssql.logins", "Logins")}
        </h4>
        <div className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
          {logins.map((l) => (
            <div key={l.name}>
              {l.name} · {l.login_type}
              {l.is_disabled ? ` · ${t("integrations.mssql.disabled", "disabled")}` : ""}
            </div>
          ))}
          {logins.length === 0 && <span>—</span>}
        </div>
      </section>
    </div>
  );
};

// ─── Sessions tab (list_sessions, get_session, disconnect_all) ───────────────

const SessionsTab: React.FC<{ mgr: MssqlManager }> = ({ mgr }) => {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);

  const refresh = useCallback(async () => {
    try {
      setSessions(await mgr.run(() => mgr.api.listSessions()));
    } catch {
      /* surfaced */
    }
  }, [mgr]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const statusText = (s: SessionInfo): string =>
    typeof s.status === "string"
      ? s.status
      : `Error: ${s.status.Error}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.mssql.refresh", "Refresh")}
        </button>
        <button
          className={btn}
          onClick={async () => {
            await mgr.run(() => mgr.api.disconnectAll()).catch(() => {});
            await refresh();
          }}
        >
          {t("integrations.mssql.disconnectAll", "Disconnect all")}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">
                {t("integrations.mssql.session", "Session")}
              </th>
              <th className="px-2 py-1">
                {t("integrations.mssql.host", "Host")}
              </th>
              <th className="px-2 py-1">
                {t("integrations.mssql.status", "Status")}
              </th>
              <th className="px-2 py-1">
                {t("integrations.mssql.queries", "Queries")}
              </th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-text)]">
                  {s.id === mgr.sessionId ? "● " : ""}
                  {s.id}
                </td>
                <td className="px-2 py-1">
                  {s.host}:{s.port}
                  {s.via_ssh_tunnel ? " (ssh)" : ""}
                </td>
                <td className="px-2 py-1">{statusText(s)}</td>
                <td className="px-2 py-1">{s.queries_executed}</td>
                <td className="px-2 py-1">
                  <button
                    className={btn}
                    onClick={async () => {
                      const info = await mgr.api
                        .getSession(s.id)
                        .catch(() => null);
                      if (info) window.alert(JSON.stringify(info, null, 2));
                    }}
                  >
                    {t("integrations.mssql.details", "Details")}
                  </button>
                </td>
              </tr>
            ))}
            {sessions.length === 0 && (
              <tr>
                <td
                  className="px-2 py-2 text-[var(--color-textMuted)]"
                  colSpan={5}
                >
                  {t("integrations.mssql.noSessions", "No active sessions")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ─── Panel shell ────────────────────────────────────────────────────────────

const TABS: {
  key: TabKey;
  labelKey: string;
  labelDefault: string;
  icon: React.ComponentType<{ size?: number | string }>;
}[] = [
  { key: "query", labelKey: "integrations.mssql.tabQuery", labelDefault: "Query", icon: Play },
  { key: "schema", labelKey: "integrations.mssql.tabSchema", labelDefault: "Schema", icon: Layers },
  { key: "data", labelKey: "integrations.mssql.tabData", labelDefault: "Data", icon: TableIcon },
  { key: "admin", labelKey: "integrations.mssql.tabAdmin", labelDefault: "Admin", icon: ShieldCheck },
  { key: "sessions", labelKey: "integrations.mssql.tabSessions", labelDefault: "Sessions", icon: Server },
];

const MssqlPanel: React.FC<IntegrationPanelProps> = ({ isOpen, instanceId }) => {
  const { t } = useTranslation();
  const mgr = useMssql();
  const [tab, setTab] = useState<TabKey>("query");

  // Adopt any pre-existing backend session on mount.
  useEffect(() => {
    void mgr.refreshConnection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const headerLabel = useMemo(() => {
    if (!mgr.isConnected) return t("integrations.mssql.disconnected", "Disconnected");
    return mgr.session?.host ?? t("integrations.mssql.connected", "Connected");
  }, [mgr.isConnected, mgr.session, t]);

  if (!isOpen) return null;

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[var(--color-surface)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--color-text)]">
          <Database className="h-5 w-5 text-primary" />
          {t("integrations.mssql.title", "SQL Server")}
        </h2>
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 ${
              mgr.isConnected
                ? "bg-green-500/15 text-green-500"
                : "bg-[var(--color-border)] text-[var(--color-textSecondary)]"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                mgr.isConnected ? "bg-green-500" : "bg-[var(--color-textMuted)]"
              }`}
            />
            {headerLabel}
          </span>
          {mgr.isConnected && (
            <button className={btn} onClick={() => void mgr.disconnect()}>
              {t("integrations.mssql.disconnect", "Disconnect")}
            </button>
          )}
        </div>
      </div>

      {mgr.error && (
        <div className="mb-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-500">
          {mgr.error}
        </div>
      )}

      {!mgr.isConnected ? (
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
            {tab === "query" && <QueryTab mgr={mgr} />}
            {tab === "schema" && <SchemaTab mgr={mgr} />}
            {tab === "data" && <DataTab mgr={mgr} />}
            {tab === "admin" && <AdminTab mgr={mgr} />}
            {tab === "sessions" && <SessionsTab mgr={mgr} />}
          </div>
        </>
      )}
    </div>
  );
};

export default MssqlPanel;

/** Registry descriptor for the SQL Server integration (category: database).
 *  The Wave-2 database integrator appends this to `registry.database.ts`. */
export const mssqlDescriptor: IntegrationDescriptor = {
  key: "mssql",
  label: "SQL Server",
  category: "database",
  icon: Database,
  importPanel: () => import("./MssqlPanel"),
};
