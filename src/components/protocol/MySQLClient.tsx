import {
  Activity,
  Columns3,
  Database,
  Download,
  LoaderCircle,
  Play,
  RefreshCw,
  Search,
  Table2,
  Unplug,
} from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMySQLClient } from "../../hooks/protocol/useMySQLClient";
import type { ConnectionSession } from "../../types/connection/connection";
import type {
  MysqlColumnInfo,
  MysqlExplainRow,
  MysqlQueryResult,
  MysqlRow,
} from "../../types/mysql";
import { mysqlDialectLabel } from "../../utils/services/mysqlService";

interface MySQLClientProps {
  session: ConnectionSession;
}

export const formatMysqlCell = (value: unknown): string => {
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

/** CSV cell with the formula-injection guard for spreadsheet consumers. */
export const csvCell = (raw: string): string => {
  let value = raw;
  if (/^[=+\-@\t\r]/.test(value)) value = `'${value}`;
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
};

export const resultsToCsv = (result: MysqlQueryResult): string => {
  const header = result.columns.map((column) => csvCell(column.name)).join(",");
  const lines = result.rows.map((row) =>
    row.map((cell) => csvCell(formatMysqlCell(cell))).join(","),
  );
  return [header, ...lines].join("\n");
};

export const resultsToJson = (result: MysqlQueryResult): string =>
  JSON.stringify(
    result.rows.map((row) =>
      Object.fromEntries(
        result.columns.map((column, index) => [column.name, row[index]]),
      ),
    ),
    null,
    2,
  );

const downloadText = (name: string, mime: string, text: string) => {
  if (typeof URL.createObjectURL !== "function") return;
  const blob = new Blob(["﻿" + text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
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
  label,
}: {
  columns: MysqlColumnInfo[];
  rows: MysqlRow[];
  label: string;
}) => {
  const ordered = [...columns].sort((a, b) => a.ordinal - b.ordinal);
  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-auto">
      <table className="sor-data-table w-max min-w-full" aria-label={label}>
        <thead className="sticky top-0 z-10 bg-[var(--color-surface)]">
          <tr>
            {ordered.map((column) => (
              <th
                key={`${column.ordinal}:${column.name}`}
                className="sor-th whitespace-nowrap border-r border-[var(--color-border)] last:border-r-0"
                title={column.data_type}
              >
                <span>{column.name}</span>
                <span className="ml-2 text-[10px] font-normal text-[var(--color-textMuted)]">
                  {column.data_type}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              data-testid="mysql-result-row"
              className="border-t border-[var(--color-border)] hover:bg-[var(--color-surfaceHover)]"
            >
              {ordered.map((column, columnIndex) => {
                const value = formatMysqlCell(row[columnIndex]);
                return (
                  <td
                    key={`${rowIndex}:${column.ordinal}:${column.name}`}
                    data-testid="mysql-result-cell"
                    className="max-w-96 whitespace-pre-wrap break-words border-r border-[var(--color-border)] px-3 py-2 align-top font-mono text-xs text-[var(--color-text)] last:border-r-0"
                    title={value}
                  >
                    {row[columnIndex] === null ? (
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

const EXPLAIN_COLUMNS: (keyof MysqlExplainRow)[] = [
  "id",
  "select_type",
  "table",
  "partitions",
  "access_type",
  "possible_keys",
  "key",
  "key_len",
  "ref_col",
  "rows",
  "filtered",
  "extra",
];

export function MySQLClient({ session }: MySQLClientProps) {
  const { t } = useTranslation();
  const client = useMySQLClient(session);
  const [catalogTab, setCatalogTab] = useState<"objects" | "columns">(
    "objects",
  );
  const connected = client.status === "connected";
  const dialectLabel = mysqlDialectLabel(client.dialect);
  const statusLabel = t(`mysqlClient.status.${client.status}`, client.status);

  const executeCurrent = () => {
    void client.executeSql(client.mode).catch(() => undefined);
  };

  const onEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      executeCurrent();
    }
  };

  const exportResults = (format: "csv" | "json") => {
    if (!client.results) return;
    const stamp = Date.now();
    if (format === "csv") {
      downloadText(
        `mysql-results-${stamp}.csv`,
        "text/csv;charset=utf-8",
        resultsToCsv(client.results),
      );
    } else {
      downloadText(
        `mysql-results-${stamp}.json`,
        "application/json;charset=utf-8",
        resultsToJson(client.results),
      );
    }
  };

  const results = client.results;

  return (
    <section
      data-testid="mysql-client"
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--color-background)]"
      aria-label={`${dialectLabel} ${t("mysqlClient.clientFor", "client for")} ${session.hostname}`}
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Database className="shrink-0 text-primary" size={20} />
          <div className="min-w-0">
            <h2 className="truncate font-medium text-[var(--color-text)]">
              {dialectLabel} — {session.hostname}
            </h2>
            <p className="truncate text-xs text-[var(--color-textSecondary)]">
              {client.selectedDatabase ||
                client.sessionInfo?.database ||
                t("mysqlClient.noDatabase", "no default database")}
              {client.serverVersion ? ` · ${client.serverVersion}` : ""}
              {client.serverInfo?.tls_enabled || client.sessionInfo?.tls_enabled
                ? ` · ${t("mysqlClient.tls", "TLS")}`
                : ""}
            </p>
          </div>
          <span
            data-testid="mysql-dialect"
            className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-text)]"
            title={client.serverVersion ?? undefined}
          >
            {dialectLabel}
            {client.serverVersion ? ` ${client.serverVersion}` : ""}
          </span>
          <span
            data-testid="mysql-status"
            className={`rounded-full px-2 py-0.5 text-xs ${
              connected
                ? "bg-success/15 text-success"
                : client.status === "error"
                  ? "bg-error/15 text-error"
                  : "bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)]"
            }`}
          >
            {statusLabel}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="sor-icon-btn-sm"
            title={t("mysqlClient.refreshCatalog", "Refresh database catalog")}
            aria-label={t(
              "mysqlClient.refreshCatalog",
              "Refresh database catalog",
            )}
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
            data-testid="mysql-reconnect"
            className="rounded border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)]"
            onClick={() => void client.reconnect().catch(() => undefined)}
          >
            {t("mysqlClient.reconnect", "Reconnect")}
          </button>
          <button
            type="button"
            data-testid="mysql-disconnect"
            className="flex items-center gap-1.5 rounded border border-error/40 px-3 py-1.5 text-xs text-error hover:bg-error/10"
            disabled={!client.backendSessionId}
            onClick={() => void client.disconnect().catch(() => undefined)}
          >
            <Unplug size={14} />
            {t("mysqlClient.disconnect", "Disconnect")}
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
          aria-label={t("mysqlClient.catalog", "Schema browser")}
        >
          <div className="grid shrink-0 grid-cols-2 border-b border-[var(--color-border)]">
            <button
              type="button"
              className={`px-3 py-2 text-xs ${catalogTab === "objects" ? "border-b-2 border-primary text-primary" : "text-[var(--color-textSecondary)]"}`}
              onClick={() => setCatalogTab("objects")}
            >
              {t("mysqlClient.tabs.objects", "Objects")}
            </button>
            <button
              type="button"
              className={`px-3 py-2 text-xs ${catalogTab === "columns" ? "border-b-2 border-primary text-primary" : "text-[var(--color-textSecondary)]"}`}
              onClick={() => setCatalogTab("columns")}
            >
              {t("mysqlClient.tabs.columns", "Columns")}
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {catalogTab === "objects" ? (
              <>
                <SectionTitle icon={<Database size={14} />}>
                  {t("mysqlClient.databases", "Databases")}
                </SectionTitle>
                <div
                  data-testid="mysql-databases"
                  className="space-y-0.5 px-2 pb-2"
                >
                  {client.databases.map((database) => {
                    const current = database.name === client.selectedDatabase;
                    return (
                      <button
                        type="button"
                        key={database.name}
                        aria-label={`${t("mysqlClient.browseDatabase", "Browse database")} ${database.name}`}
                        className={`block w-full rounded px-2 py-1.5 text-left text-xs ${current ? "bg-primary/10 text-primary" : "text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)]"}`}
                        title={`${database.character_set || "—"} · ${database.collation || "—"}`}
                        onClick={() =>
                          void client
                            .loadTables(database.name)
                            .catch(() => undefined)
                        }
                      >
                        <div className="truncate font-medium">
                          {database.name}
                        </div>
                        <div className="truncate text-[10px] opacity-75">
                          {database.table_count ?? "—"}{" "}
                          {t("mysqlClient.tablesCount", "tables")}
                          {database.collation ? ` · ${database.collation}` : ""}
                        </div>
                      </button>
                    );
                  })}
                  {client.databases.length === 0 && (
                    <p className="px-2 py-1 text-[10px] text-[var(--color-textMuted)]">
                      {t("mysqlClient.noDatabases", "No databases visible")}
                    </p>
                  )}
                </div>

                <SectionTitle icon={<Table2 size={14} />}>
                  {t("mysqlClient.tables", "Tables")}
                  {client.selectedDatabase
                    ? ` · ${client.selectedDatabase}`
                    : ""}
                </SectionTitle>
                <div
                  data-testid="mysql-tables"
                  className="space-y-0.5 px-2 pb-3"
                >
                  {client.tables.map((table) => (
                    <div
                      key={table.name}
                      className="group flex min-w-0 items-center gap-1"
                    >
                      <button
                        type="button"
                        className={`min-w-0 flex-1 truncate rounded px-2 py-1 text-left text-xs ${client.selectedTable?.name === table.name ? "text-primary" : "text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"}`}
                        aria-label={`${t("mysqlClient.inspectTable", "Inspect table")} ${table.name}`}
                        title={`${table.engine || "—"} · ${table.row_count ?? "?"} ${t("mysqlClient.rows", "rows")} · ${formatBytes(table.data_length)}`}
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
                        aria-label={`${t("mysqlClient.queryTable", "Query table")} ${table.name}`}
                        onClick={() => client.setQueryForTable(table)}
                      >
                        SQL
                      </button>
                    </div>
                  ))}
                  {client.tables.length === 0 && (
                    <p className="px-2 py-1 text-[10px] text-[var(--color-textMuted)]">
                      {t("mysqlClient.noTables", "No tables or views")}
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div data-testid="mysql-columns">
                <SectionTitle icon={<Columns3 size={14} />}>
                  {t("mysqlClient.tableColumns", "Table columns")}
                </SectionTitle>
                {client.selectedTable ? (
                  <div className="px-3 pb-3">
                    <p className="mb-2 break-all text-xs font-medium text-[var(--color-text)]">
                      {client.selectedDatabase}.{client.selectedTable.name}
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
                              {column.is_primary_key ? " 🔑" : ""}
                            </span>
                            <span className="shrink-0 text-[10px] text-[var(--color-textMuted)]">
                              #{column.ordinal_position}
                            </span>
                          </div>
                          <div className="mt-1 break-all font-mono text-[10px] text-[var(--color-textSecondary)]">
                            {column.data_type}
                            {column.is_nullable
                              ? ` · ${t("mysqlClient.nullable", "nullable")}`
                              : ` · ${t("mysqlClient.required", "required")}`}
                            {column.is_auto_increment
                              ? ` · ${t("mysqlClient.autoIncrement", "auto increment")}`
                              : ""}
                            {column.column_default !== null &&
                            column.column_default !== undefined
                              ? ` · ${t("mysqlClient.default", "default")} ${column.column_default}`
                              : ""}
                          </div>
                        </div>
                      ))}
                    </div>
                    {client.indexes.length > 0 && (
                      <>
                        <SectionTitle icon={<Search size={12} />}>
                          {t("mysqlClient.indexes", "Indexes")}
                        </SectionTitle>
                        <ul className="space-y-1 text-[10px] text-[var(--color-textSecondary)]">
                          {client.indexes.map((index) => (
                            <li key={index.name} className="break-all">
                              <span className="font-medium text-[var(--color-text)]">
                                {index.name}
                              </span>{" "}
                              ({index.columns.join(", ")}) · {index.index_type}
                              {index.is_primary
                                ? ` · ${t("mysqlClient.primary", "primary")}`
                                : index.is_unique
                                  ? ` · ${t("mysqlClient.unique", "unique")}`
                                  : ""}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {client.foreignKeys.length > 0 && (
                      <>
                        <SectionTitle icon={<Table2 size={12} />}>
                          {t("mysqlClient.foreignKeys", "Foreign keys")}
                        </SectionTitle>
                        <ul className="space-y-1 text-[10px] text-[var(--color-textSecondary)]">
                          {client.foreignKeys.map((fk) => (
                            <li key={fk.name} className="break-all">
                              <span className="font-medium text-[var(--color-text)]">
                                {fk.column}
                              </span>{" "}
                              → {fk.referenced_table}.{fk.referenced_column}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                ) : (
                  <p className="px-3 text-xs text-[var(--color-textMuted)]">
                    {t(
                      "mysqlClient.selectTableHint",
                      "Select a table to inspect its columns, indexes, and foreign keys.",
                    )}
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
                htmlFor={`mysql-query-${session.id}`}
                className="text-sm font-medium text-[var(--color-text)]"
              >
                {t("mysqlClient.sqlEditor", "SQL editor")}
              </label>
              <div className="flex items-center gap-2">
                <span className="hidden text-[10px] text-[var(--color-textMuted)] sm:inline">
                  {t("mysqlClient.shortcutHint", "Ctrl/⌘ + Enter runs")}
                </span>
                <select
                  data-testid="mysql-mode"
                  aria-label={t("mysqlClient.executionMode", "Execution mode")}
                  className="rounded border border-[var(--color-border)] bg-[var(--color-input)] px-2 py-1 text-xs text-[var(--color-text)]"
                  value={client.mode}
                  onChange={(event) =>
                    client.setMode(
                      event.target.value === "statement"
                        ? "statement"
                        : "query",
                    )
                  }
                >
                  <option value="query">
                    {t("mysqlClient.mode.query", "Query (rows)")}
                  </option>
                  <option value="statement">
                    {t("mysqlClient.mode.statement", "Statement (affected)")}
                  </option>
                </select>
                <button
                  type="button"
                  data-testid="mysql-execute"
                  className="flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-xs text-white disabled:opacity-50"
                  disabled={
                    !connected || client.isExecuting || !client.query.trim()
                  }
                  onClick={executeCurrent}
                >
                  {client.isExecuting ? (
                    <LoaderCircle size={14} className="animate-spin" />
                  ) : (
                    <Play size={14} />
                  )}
                  {t("mysqlClient.run", "Run")}
                </button>
                <button
                  type="button"
                  data-testid="mysql-explain"
                  className="rounded border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text)] disabled:opacity-50"
                  disabled={
                    !connected || client.isExecuting || !client.query.trim()
                  }
                  title={t(
                    "mysqlClient.explainTitle",
                    "Show the EXPLAIN plan for the current statement",
                  )}
                  onClick={() =>
                    void client.explainQuery().catch(() => undefined)
                  }
                >
                  {t("mysqlClient.explain", "Explain")}
                </button>
                <button
                  type="button"
                  data-testid="mysql-processlist"
                  className="flex items-center gap-1 rounded border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text)] disabled:opacity-50"
                  disabled={!connected || client.isBusy}
                  onClick={() =>
                    void client.loadProcessList().catch(() => undefined)
                  }
                >
                  <Activity size={12} />
                  {t("mysqlClient.processes", "Processes")}
                </button>
              </div>
            </div>
            <textarea
              id={`mysql-query-${session.id}`}
              data-testid="mysql-query-editor"
              className="h-36 w-full resize-y rounded border border-[var(--color-border)] bg-[var(--color-input)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none focus:border-primary"
              value={client.query}
              spellCheck={false}
              onChange={(event) => client.setQuery(event.target.value)}
              onKeyDown={onEditorKeyDown}
            />
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {client.resultTab === "explain" && client.explainRows ? (
              <div
                data-testid="mysql-explain-results"
                className="min-h-0 flex-1 overflow-auto"
              >
                <table
                  className="sor-data-table w-max min-w-full"
                  aria-label={t("mysqlClient.explainPlan", "EXPLAIN plan")}
                >
                  <thead className="sticky top-0 z-10 bg-[var(--color-surface)]">
                    <tr>
                      {EXPLAIN_COLUMNS.map((key) => (
                        <th key={key} className="sor-th whitespace-nowrap">
                          {key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {client.explainRows.map((row, index) => (
                      <tr
                        key={index}
                        className="border-t border-[var(--color-border)]"
                      >
                        {EXPLAIN_COLUMNS.map((key) => (
                          <td
                            key={key}
                            className="px-3 py-2 font-mono text-xs text-[var(--color-text)]"
                          >
                            {formatMysqlCell(row[key] ?? null)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : client.resultTab === "processes" ? (
              <div
                data-testid="mysql-processes"
                className="min-h-0 flex-1 overflow-auto"
              >
                <table
                  className="sor-data-table w-max min-w-full"
                  aria-label={t("mysqlClient.processList", "Process list")}
                >
                  <thead className="sticky top-0 z-10 bg-[var(--color-surface)]">
                    <tr>
                      {[
                        "id",
                        "user",
                        "host",
                        "db",
                        "command",
                        "time",
                        "state",
                        "info",
                        "",
                      ].map((key) => (
                        <th key={key} className="sor-th whitespace-nowrap">
                          {key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {client.processes.map((process) => (
                      <tr
                        key={process.id}
                        className="border-t border-[var(--color-border)] font-mono text-xs text-[var(--color-text)]"
                      >
                        <td className="px-3 py-2">{process.id}</td>
                        <td className="px-3 py-2">{process.user}</td>
                        <td className="px-3 py-2">{process.host}</td>
                        <td className="px-3 py-2">{process.db ?? ""}</td>
                        <td className="px-3 py-2">{process.command}</td>
                        <td className="px-3 py-2">{process.time}</td>
                        <td className="px-3 py-2">{process.state ?? ""}</td>
                        <td className="max-w-96 truncate px-3 py-2">
                          {process.info ?? ""}
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            className="rounded border border-error/40 px-2 py-0.5 text-[10px] text-error"
                            aria-label={`${t("mysqlClient.killProcess", "Kill process")} ${process.id}`}
                            onClick={() =>
                              void client
                                .killProcess(process.id)
                                .catch(() => undefined)
                            }
                          >
                            {t("mysqlClient.kill", "Kill")}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : results ? (
              <div
                data-testid="mysql-results"
                className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
              >
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-textSecondary)]">
                  <span>
                    {results.rows.length} {t("mysqlClient.rows", "rows")}
                    {results.affected_rows > 0
                      ? ` · ${results.affected_rows} ${t("mysqlClient.affected", "affected")}`
                      : ""}
                    {results.last_insert_id
                      ? ` · ${t("mysqlClient.lastInsertId", "last insert id")} ${results.last_insert_id}`
                      : ""}
                    {results.warnings.length > 0
                      ? ` · ${results.warnings.length} ${t("mysqlClient.warnings", "warnings")}`
                      : ""}
                  </span>
                  <span className="flex items-center gap-2">
                    <span>{results.execution_time_ms} ms</span>
                    {results.rows.length > 0 && (
                      <>
                        <button
                          type="button"
                          data-testid="mysql-export-csv"
                          className="flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-text)]"
                          aria-label={t(
                            "mysqlClient.exportCsv",
                            "Export results as CSV",
                          )}
                          onClick={() => exportResults("csv")}
                        >
                          <Download size={12} /> CSV
                        </button>
                        <button
                          type="button"
                          data-testid="mysql-export-json"
                          className="flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-text)]"
                          aria-label={t(
                            "mysqlClient.exportJson",
                            "Export results as JSON",
                          )}
                          onClick={() => exportResults("json")}
                        >
                          <Download size={12} /> JSON
                        </button>
                      </>
                    )}
                  </span>
                </div>
                {results.warnings.length > 0 && (
                  <ul className="shrink-0 border-b border-warning/30 bg-warning/10 px-3 py-1 text-[10px] text-[var(--color-text)]">
                    {results.warnings.map((warning, index) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                )}
                {results.columns.length > 0 ? (
                  <>
                    <ResultGrid
                      columns={results.columns}
                      rows={client.visibleRows}
                      label={`${dialectLabel} ${t("mysqlClient.queryResults", "query results")}`}
                    />
                    {client.hasMoreRows && (
                      <div className="shrink-0 border-t border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-textSecondary)]">
                        {client.visibleRows.length} / {results.rows.length}{" "}
                        <button
                          type="button"
                          data-testid="mysql-load-more"
                          className="ml-2 rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-text)]"
                          onClick={client.showMoreRows}
                        >
                          {t("mysqlClient.showMore", "Show more rows")}
                        </button>
                        <span className="ml-2 text-[10px] text-[var(--color-textMuted)]">
                          {t(
                            "mysqlClient.limitHint",
                            "Add a LIMIT clause to keep large results responsive.",
                          )}
                        </span>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex flex-1 items-center justify-center p-6 text-sm text-[var(--color-textSecondary)]">
                    {t("mysqlClient.statementDone", "Statement completed")} ·{" "}
                    {results.affected_rows}{" "}
                    {t("mysqlClient.affected", "affected")}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-[var(--color-textSecondary)]">
                <div>
                  <Database size={40} className="mx-auto mb-3 opacity-50" />
                  <p>
                    {t(
                      "mysqlClient.emptyResults",
                      "Run a query to populate the result grid.",
                    )}
                  </p>
                  <p className="mt-1 text-xs text-[var(--color-textMuted)]">
                    {t(
                      "mysqlClient.emptyHint",
                      "Switch to Statement mode for INSERT, UPDATE, DELETE, and DDL.",
                    )}
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
