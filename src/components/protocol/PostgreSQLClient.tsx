import {
  Columns3,
  Database,
  LoaderCircle,
  Play,
  RefreshCw,
  Table2,
  Unplug,
} from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { useState } from "react";
import { usePostgreSQLClient } from "../../hooks/protocol/usePostgreSQLClient";
import type { ConnectionSession } from "../../types/connection/connection";
import type {
  PostgreSQLColumnInfo,
  PostgreSQLRow,
} from "../../types/postgresql";

interface PostgreSQLClientProps {
  session: ConnectionSession;
}

const formatPostgreSQLCell = (value: unknown): string => {
  if (value === null) return "NULL";
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "[unserializable value]";
    }
  }
  return String(value);
};

const formatBytes = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = Math.max(0, value);
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
};

const SectionTitle = ({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) => (
  <div className="flex items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-textSecondary)]">
    {icon}
    <span>{children}</span>
  </div>
);

const ResultGrid = ({
  columns,
  rows,
}: {
  columns: PostgreSQLColumnInfo[];
  rows: PostgreSQLRow[];
}) => {
  const orderedColumns = [...columns].sort(
    (left, right) => left.ordinal - right.ordinal,
  );
  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-auto">
      <table
        className="sor-data-table w-max min-w-full"
        aria-label="PostgreSQL query results"
      >
        <thead className="sticky top-0 z-10 bg-[var(--color-surface)]">
          <tr>
            {orderedColumns.map((column) => (
              <th
                key={`${column.ordinal}:${column.name}`}
                className="sor-th whitespace-nowrap border-r border-[var(--color-border)] last:border-r-0"
                title={column.type_name}
              >
                <span>{column.name}</span>
                <span className="ml-2 text-[10px] font-normal text-[var(--color-textMuted)]">
                  {column.type_name}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              className="border-t border-[var(--color-border)] hover:bg-[var(--color-surfaceHover)]"
            >
              {orderedColumns.map((column) => {
                const value = formatPostgreSQLCell(row[column.name]);
                return (
                  <td
                    key={`${rowIndex}:${column.ordinal}:${column.name}`}
                    className="max-w-96 whitespace-pre-wrap break-words border-r border-[var(--color-border)] px-3 py-2 align-top font-mono text-xs text-[var(--color-text)] last:border-r-0"
                    title={value}
                  >
                    {value === "NULL" ? (
                      <span className="italic text-[var(--color-textMuted)]">
                        NULL
                      </span>
                    ) : (
                      value
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export function PostgreSQLClient({ session }: PostgreSQLClientProps) {
  const client = usePostgreSQLClient(session);
  const [catalogTab, setCatalogTab] = useState<"objects" | "columns">(
    "objects",
  );
  const connected = client.status === "connected";

  const executeQuery = () => {
    void client.executeSql("query").catch(() => undefined);
  };

  const onEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      executeQuery();
    }
  };

  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--color-background)]"
      aria-label={`PostgreSQL client for ${session.hostname}`}
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Database className="shrink-0 text-primary" size={20} />
          <div className="min-w-0">
            <h2 className="truncate font-medium text-[var(--color-text)]">
              PostgreSQL — {session.hostname}
            </h2>
            <p className="truncate text-xs text-[var(--color-textSecondary)]">
              {client.sessionInfo?.database || "postgres"}
              {client.sessionInfo?.server_version
                ? ` · ${client.sessionInfo.server_version}`
                : ""}
            </p>
          </div>
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${
              connected
                ? "bg-success/15 text-success"
                : client.status === "error"
                  ? "bg-error/15 text-error"
                  : "bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)]"
            }`}
          >
            {client.status}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="sor-icon-btn-sm"
            title="Refresh database catalog"
            aria-label="Refresh database catalog"
            disabled={!connected || client.isBusy}
            onClick={() => void client.refreshCatalog().catch(() => undefined)}
          >
            <RefreshCw
              size={16}
              className={client.isBusy ? "animate-spin" : ""}
            />
          </button>
          <button
            type="button"
            className="rounded border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)]"
            onClick={() => void client.reconnect().catch(() => undefined)}
          >
            Reconnect
          </button>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded border border-error/40 px-3 py-1.5 text-xs text-error hover:bg-error/10"
            disabled={!client.backendSessionId}
            onClick={() => void client.disconnect().catch(() => undefined)}
          >
            <Unplug size={14} />
            Disconnect
          </button>
        </div>
      </header>

      {client.error && (
        <div
          role="alert"
          className="shrink-0 border-b border-error/30 bg-error/10 px-4 py-2 text-sm text-error"
        >
          {client.error}
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <aside
          className="flex w-72 shrink-0 flex-col overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-surface)]"
          aria-label="PostgreSQL catalog"
        >
          <div className="grid shrink-0 grid-cols-2 border-b border-[var(--color-border)]">
            <button
              type="button"
              className={`px-3 py-2 text-xs ${catalogTab === "objects" ? "border-b-2 border-primary text-primary" : "text-[var(--color-textSecondary)]"}`}
              onClick={() => setCatalogTab("objects")}
            >
              Objects
            </button>
            <button
              type="button"
              className={`px-3 py-2 text-xs ${catalogTab === "columns" ? "border-b-2 border-primary text-primary" : "text-[var(--color-textSecondary)]"}`}
              onClick={() => setCatalogTab("columns")}
            >
              Columns
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {catalogTab === "objects" ? (
              <>
                <SectionTitle icon={<Database size={14} />}>
                  Databases
                </SectionTitle>
                <div className="space-y-0.5 px-2 pb-2">
                  {client.databases.map((database) => {
                    const current =
                      database.name === client.sessionInfo?.database;
                    return (
                      <div
                        key={database.name}
                        className={`rounded px-2 py-1.5 text-xs ${current ? "bg-primary/10 text-primary" : "text-[var(--color-textSecondary)]"}`}
                        title={`${database.owner || "unknown owner"} · ${formatBytes(database.size_bytes)}`}
                      >
                        <div className="truncate font-medium">
                          {database.name}
                        </div>
                        <div className="truncate text-[10px] opacity-75">
                          {database.owner || "—"} ·{" "}
                          {formatBytes(database.size_bytes)}
                          {current ? " · connected" : ""}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <SectionTitle icon={<Table2 size={14} />}>
                  Schemas and tables
                </SectionTitle>
                <div className="space-y-1 px-2 pb-3">
                  {client.schemas.map((schema) => (
                    <div key={schema.name}>
                      <button
                        type="button"
                        className={`w-full rounded px-2 py-1.5 text-left text-xs font-medium ${client.selectedSchema === schema.name ? "bg-[var(--color-surfaceHover)] text-[var(--color-text)]" : "text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)]"}`}
                        aria-label={`Browse schema ${schema.name}`}
                        onClick={() =>
                          void client
                            .loadTables(schema.name)
                            .catch(() => undefined)
                        }
                      >
                        {schema.name}
                      </button>
                      {client.selectedSchema === schema.name && (
                        <div className="ml-2 border-l border-[var(--color-border)] pl-2">
                          {client.tables.map((table) => (
                            <div
                              key={`${table.schema}.${table.name}`}
                              className="group flex min-w-0 items-center gap-1"
                            >
                              <button
                                type="button"
                                className={`min-w-0 flex-1 truncate rounded px-2 py-1 text-left text-xs ${client.selectedTable?.name === table.name ? "text-primary" : "text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"}`}
                                aria-label={`Inspect ${table.schema}.${table.name}`}
                                title={`${table.table_type} · ${table.total_size || "unknown size"}`}
                                onClick={() => {
                                  setCatalogTab("columns");
                                  void client
                                    .describeTable(table)
                                    .catch(() => undefined);
                                }}
                              >
                                {table.name}
                              </button>
                              <button
                                type="button"
                                className="invisible rounded px-1 py-0.5 text-[10px] text-primary group-hover:visible group-focus-within:visible"
                                aria-label={`Query ${table.schema}.${table.name}`}
                                onClick={() => client.setQueryForTable(table)}
                              >
                                SQL
                              </button>
                            </div>
                          ))}
                          {client.tables.length === 0 && (
                            <p className="px-2 py-1 text-[10px] text-[var(--color-textMuted)]">
                              No tables or views
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div>
                <SectionTitle icon={<Columns3 size={14} />}>
                  Table columns
                </SectionTitle>
                {client.selectedTable ? (
                  <div className="px-3 pb-3">
                    <p className="mb-2 break-all text-xs font-medium text-[var(--color-text)]">
                      {client.selectedTable.schema}.{client.selectedTable.name}
                    </p>
                    <div className="space-y-2">
                      {client.columns.map((column) => (
                        <div
                          key={`${column.ordinal_position}:${column.name}`}
                          className="rounded border border-[var(--color-border)] p-2 text-xs"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="break-all font-medium text-[var(--color-text)]">
                              {column.name}
                            </span>
                            <span className="shrink-0 text-[10px] text-[var(--color-textMuted)]">
                              #{column.ordinal_position}
                            </span>
                          </div>
                          <div className="mt-1 break-all font-mono text-[10px] text-[var(--color-textSecondary)]">
                            {column.data_type}
                            {column.is_nullable ? " · nullable" : " · required"}
                            {column.is_identity ? " · identity" : ""}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="px-3 text-xs text-[var(--color-textMuted)]">
                    Select a table to inspect its real column metadata.
                  </p>
                )}
              </div>
            )}
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <label
                htmlFor={`postgresql-query-${session.id}`}
                className="text-sm font-medium text-[var(--color-text)]"
              >
                SQL editor
              </label>
              <div className="flex items-center gap-2">
                <span className="hidden text-[10px] text-[var(--color-textMuted)] sm:inline">
                  Ctrl/⌘ + Enter runs a query
                </span>
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-xs text-white disabled:opacity-50"
                  disabled={
                    !connected || client.isExecuting || !client.query.trim()
                  }
                  onClick={executeQuery}
                >
                  {client.isExecuting ? (
                    <LoaderCircle size={14} className="animate-spin" />
                  ) : (
                    <Play size={14} />
                  )}
                  Run query
                </button>
                <button
                  type="button"
                  className="rounded border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text)] disabled:opacity-50"
                  disabled={
                    !connected || client.isExecuting || !client.query.trim()
                  }
                  title="Execute INSERT, UPDATE, DELETE, or DDL and return affected rows"
                  onClick={() =>
                    void client.executeSql("statement").catch(() => undefined)
                  }
                >
                  Run statement
                </button>
              </div>
            </div>
            <textarea
              id={`postgresql-query-${session.id}`}
              className="h-36 w-full resize-y rounded border border-[var(--color-border)] bg-[var(--color-input)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none focus:border-primary"
              value={client.query}
              spellCheck={false}
              onChange={(event) => client.setQuery(event.target.value)}
              onKeyDown={onEditorKeyDown}
            />
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {client.results ? (
              <>
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-textSecondary)]">
                  <span>
                    {client.results.rows.length} row
                    {client.results.rows.length === 1 ? "" : "s"}
                    {client.results.affected_rows > 0
                      ? ` · ${client.results.affected_rows} affected`
                      : ""}
                  </span>
                  <span>{client.results.execution_time_ms} ms</span>
                </div>
                {client.results.columns.length > 0 ? (
                  <ResultGrid
                    columns={client.results.columns}
                    rows={client.results.rows}
                  />
                ) : (
                  <div className="flex flex-1 items-center justify-center p-6 text-sm text-[var(--color-textSecondary)]">
                    Statement completed · {client.results.affected_rows} row
                    {client.results.affected_rows === 1 ? "" : "s"} affected
                  </div>
                )}
              </>
            ) : (
              <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-[var(--color-textSecondary)]">
                <div>
                  <Database size={40} className="mx-auto mb-3 opacity-50" />
                  <p>Run a query to populate the result grid.</p>
                  <p className="mt-1 text-xs text-[var(--color-textMuted)]">
                    Use Run statement for write and DDL commands.
                  </p>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </section>
  );
}
