import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import {
  Copy,
  Download,
  ExternalLink,
  History,
  ScrollText,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  recordLegacyProxyLog,
  recordProxyDiagnostics,
  type LegacyLogRow,
} from "../../../utils/browser/proxyLogRecorder";
import { EmptyState } from "../../ui/display";
import { createVisibleInterval } from "../../../utils/perf/visibility";
import type { NativeBrowserDiagnostics } from "../../../types/network/nativeBrowserDiagnostics";
import {
  BROWSER_HISTORY_OPEN_EVENT,
  BROWSER_LOG_TYPES,
  PROXY_LOG_KINDS,
  browserHistoryStore,
  browserLogStore,
  browserLogToText,
  logProxyEvent,
  proxyLogStore,
  proxyLogToText,
  redactText,
  type BrowserHistoryEntry,
  type BrowserHistoryOpenDetail,
  type BrowserLogEntry,
  type BrowserLogLevel,
  type ProxyLogEntry,
  type ProxyLogKind,
  type ProxyLogSource,
} from "../../../utils/browser/browserEventLog";

/** Fill {{name}} placeholders; works whether or not i18next interpolated. */
function fmt(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (m, k: string) =>
    k in vars ? String(vars[k]) : m,
  );
}

const LEVELS: BrowserLogLevel[] = ["info", "warn", "error"];
const LEVEL_CLASS: Record<BrowserLogLevel, string> = {
  info: "text-[var(--color-textSecondary)]",
  warn: "text-warning",
  error: "text-error",
};

function timeLabel(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour12: false });
}
function dateTimeLabel(at: number): string {
  return new Date(at).toLocaleString();
}

/* ------------------------------------------------------------------ */
/*  Shared chrome                                                      */
/* ------------------------------------------------------------------ */

function exportText(filename: string, text: string) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  } catch {
    /* Export is best effort. */
  }
}

const SearchBox: React.FC<{
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
  testId: string;
}> = ({ value, onChange, label, placeholder, testId }) => (
  <label className="relative block min-w-48 flex-1">
    <span className="sr-only">{label}</span>
    <Search
      size={14}
      className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-textMuted)]"
      aria-hidden="true"
    />
    <input
      type="search"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="sor-form-input sor-form-input-icon-left w-full"
      data-testid={testId}
    />
  </label>
);

const FilterSelect: React.FC<{
  value: string;
  onChange: (value: string) => void;
  label: string;
  options: { value: string; label: string }[];
  testId: string;
}> = ({ value, onChange, label, options, testId }) => (
  <label className="flex items-center gap-1 text-xs text-[var(--color-textSecondary)]">
    <span className="sr-only">{label}</span>
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={label}
      className="sor-form-input text-xs"
      data-testid={testId}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </label>
);

const ToolbarButton: React.FC<{
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  testId: string;
}> = ({ icon: Icon, label, onClick, disabled, testId }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="sor-option-chip text-xs disabled:opacity-40"
    data-testid={testId}
  >
    <Icon size={12} aria-hidden="true" />
    {label}
  </button>
);

const Footer: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    className="flex-shrink-0 border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-textSecondary)]"
    aria-live="polite"
  >
    {children}
  </div>
);

const THEAD =
  "sticky top-0 z-10 bg-[var(--color-backgroundSecondary)] text-[var(--color-textSecondary)]";
const TH = "px-3 py-2 font-medium";
const ROW =
  "bg-[var(--color-background)]/40 hover:bg-[var(--color-surfaceHover)]/50";

function useStore<T>(store: {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => T;
}): T {
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}

function matches(text: string, query: string) {
  return !query || text.toLocaleLowerCase().includes(query);
}

/* ------------------------------------------------------------------ */
/*  Logs                                                               */
/* ------------------------------------------------------------------ */

export const BrowserEventLogView: React.FC = () => {
  const { t } = useTranslation();
  const entries = useStore(browserLogStore);
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState("all");
  const [type, setType] = useState("all");
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return entries
      .filter(
        (e) =>
          (level === "all" || e.level === level) &&
          (type === "all" || e.type === type) &&
          matches(`${e.message} ${e.url ?? ""} ${e.type}`, query),
      )
      .reverse();
  }, [entries, level, search, type]);
  const text = useCallback(
    () => browserLogToText([...visible].reverse()),
    [visible],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-4 py-2.5">
        <SearchBox
          value={search}
          onChange={setSearch}
          label={t("browserLogs.logs.searchLabel", "Search browser log")}
          placeholder={t(
            "browserLogs.logs.searchPlaceholder",
            "Search messages and pages…",
          )}
          testId="browser-log-search"
        />
        <FilterSelect
          value={level}
          onChange={setLevel}
          label={t("browserLogs.filter.level", "Filter by level")}
          testId="browser-log-level"
          options={[
            {
              value: "all",
              label: t("browserLogs.filter.allLevels", "All levels"),
            },
            ...LEVELS.map((v) => ({
              value: v,
              label: t(`browserLogs.level.${v}`, v),
            })),
          ]}
        />
        <FilterSelect
          value={type}
          onChange={setType}
          label={t("browserLogs.filter.type", "Filter by type")}
          testId="browser-log-type"
          options={[
            {
              value: "all",
              label: t("browserLogs.filter.allTypes", "All types"),
            },
            ...BROWSER_LOG_TYPES.map((v) => ({
              value: v,
              label: t(`browserLogs.type.${v}`, v),
            })),
          ]}
        />
        <ToolbarButton
          icon={Copy}
          label={t("browserLogs.copy", "Copy")}
          disabled={!visible.length}
          testId="browser-log-copy"
          onClick={() => void navigator.clipboard?.writeText(text())}
        />
        <ToolbarButton
          icon={Download}
          label={t("browserLogs.export", "Export")}
          disabled={!visible.length}
          testId="browser-log-export"
          onClick={() => exportText("browser-log.txt", text())}
        />
        <ToolbarButton
          icon={Trash2}
          label={t("browserLogs.clear", "Clear")}
          disabled={!entries.length}
          testId="browser-log-clear"
          onClick={() => browserLogStore.clear()}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain p-3">
        <div className="min-h-full w-max min-w-full rounded-lg border border-[var(--color-border)]">
          <table
            className="w-full min-w-[640px] border-collapse text-left text-xs"
            data-testid="browser-log-table"
          >
            <caption className="sr-only">
              {t("browserLogs.logs.caption", "Browser event log")}
            </caption>
            <thead className={THEAD}>
              <tr>
                <th scope="col" className={TH}>
                  {t("browserLogs.col.time", "Time")}
                </th>
                <th scope="col" className={TH}>
                  {t("browserLogs.col.level", "Level")}
                </th>
                <th scope="col" className={TH}>
                  {t("browserLogs.col.type", "Type")}
                </th>
                <th scope="col" className={TH}>
                  {t("browserLogs.col.message", "Message")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {visible.map((e: BrowserLogEntry) => (
                <tr key={e.id} className={ROW} data-testid="browser-log-row">
                  <td
                    className="whitespace-nowrap px-3 py-2 text-[var(--color-textSecondary)]"
                    title={dateTimeLabel(e.at)}
                  >
                    {timeLabel(e.at)}
                  </td>
                  <td
                    className={`px-3 py-2 font-medium ${LEVEL_CLASS[e.level]}`}
                  >
                    {t(`browserLogs.level.${e.level}`, e.level)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {t(`browserLogs.type.${e.type}`, e.type)}
                  </td>
                  <td className="max-w-xl px-3 py-2">
                    <div className="truncate" title={e.message}>
                      {e.message}
                    </div>
                    {e.url && (
                      <div
                        className="truncate font-mono text-[10px] text-[var(--color-textMuted)]"
                        title={e.url}
                      >
                        {e.url}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length === 0 && (
            <div className="flex items-center justify-center py-14">
              <EmptyState
                icon={ScrollText}
                message={
                  entries.length === 0
                    ? t("browserLogs.logs.empty", "No browser events yet")
                    : t("browserLogs.logs.noMatch", "No matching events")
                }
                hint={
                  entries.length === 0
                    ? t(
                        "browserLogs.logs.emptyHint",
                        "Navigation, load failures and certificate events appear here.",
                      )
                    : t(
                        "browserLogs.adjustFilters",
                        "Adjust the filters to see more.",
                      )
                }
              />
            </div>
          )}
        </div>
      </div>
      <Footer>
        {fmt(
          t(
            "browserLogs.footer",
            "{{shown}} of {{total}} entries (last {{cap}} kept)",
          ),
          {
            shown: visible.length,
            total: entries.length,
            cap: browserLogStore.capacity,
          },
        )}
      </Footer>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Proxy log                                                          */
/* ------------------------------------------------------------------ */

export const BrowserProxyLogView: React.FC<{
  diagnostics?: NativeBrowserDiagnostics;
  isActive: boolean;
}> = ({ diagnostics, isActive }) => {
  const { t } = useTranslation();
  const entries = useStore(proxyLogStore);
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState("all");
  const [kind, setKind] = useState("all");
  const [source, setSource] = useState<"cef" | "legacy" | "all">("cef");

  useEffect(() => {
    recordProxyDiagnostics(diagnostics);
  }, [diagnostics]);

  useEffect(() => {
    if (!isActive || source === "cef") return;
    let cancelled = false;
    const load = () => {
      try {
        void Promise.resolve(invoke<LegacyLogRow[]>("get_proxy_request_log"))
          .then((rows) => {
            if (!cancelled && Array.isArray(rows)) recordLegacyProxyLog(rows);
          })
          .catch(() => {});
      } catch {
        /* IPC unavailable. */
      }
    };
    load();
    // Paused while hidden (one catch-up on return) instead of a bare timer.
    const stop = createVisibleInterval(load, 5000);
    return () => {
      cancelled = true;
      stop();
    };
  }, [isActive, source]);

  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return entries
      .filter(
        (e) =>
          (source === "all" || e.source === source) &&
          (level === "all" || e.level === level) &&
          (kind === "all" || e.kind === kind) &&
          matches(
            `${e.message} ${e.url ?? ""} ${e.method ?? ""} ${e.status ?? ""}`,
            query,
          ),
      )
      .reverse();
  }, [entries, kind, level, search, source]);
  const text = useCallback(
    () => proxyLogToText([...visible].reverse()),
    [visible],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-4 py-2.5">
        <SearchBox
          value={search}
          onChange={setSearch}
          label={t("browserLogs.proxy.searchLabel", "Search proxy log")}
          placeholder={t(
            "browserLogs.proxy.searchPlaceholder",
            "Search events, URLs or status…",
          )}
          testId="proxy-log-search"
        />
        <FilterSelect
          value={source}
          onChange={(v) => setSource(v as ProxyLogSource | "all")}
          label={t("browserLogs.proxy.source", "Filter by source")}
          testId="proxy-log-source"
          options={[
            {
              value: "cef",
              label: t("browserLogs.proxy.sourceCef", "Browser relay (CEF)"),
            },
            {
              value: "legacy",
              label: t("browserLogs.proxy.sourceLegacy", "Legacy proxy"),
            },
            {
              value: "all",
              label: t("browserLogs.proxy.sourceAll", "All sources"),
            },
          ]}
        />
        <FilterSelect
          value={level}
          onChange={setLevel}
          label={t("browserLogs.filter.level", "Filter by level")}
          testId="proxy-log-level"
          options={[
            {
              value: "all",
              label: t("browserLogs.filter.allLevels", "All levels"),
            },
            ...LEVELS.map((v) => ({
              value: v,
              label: t(`browserLogs.level.${v}`, v),
            })),
          ]}
        />
        <FilterSelect
          value={kind}
          onChange={setKind}
          label={t("browserLogs.filter.type", "Filter by type")}
          testId="proxy-log-kind"
          options={[
            {
              value: "all",
              label: t("browserLogs.filter.allTypes", "All types"),
            },
            ...PROXY_LOG_KINDS.map((v) => ({
              value: v,
              label: t(`browserLogs.proxyKind.${v}`, v),
            })),
          ]}
        />
        <ToolbarButton
          icon={Copy}
          label={t("browserLogs.copy", "Copy")}
          disabled={!visible.length}
          testId="proxy-log-copy"
          onClick={() => void navigator.clipboard?.writeText(text())}
        />
        <ToolbarButton
          icon={Download}
          label={t("browserLogs.export", "Export")}
          disabled={!visible.length}
          testId="proxy-log-export"
          onClick={() => exportText("browser-proxy-log.txt", text())}
        />
        <ToolbarButton
          icon={Trash2}
          label={t("browserLogs.clear", "Clear")}
          disabled={!entries.length}
          testId="proxy-log-clear"
          onClick={() => proxyLogStore.clear()}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain p-3">
        <div className="min-h-full w-max min-w-full rounded-lg border border-[var(--color-border)]">
          <table
            className="w-full min-w-[760px] border-collapse text-left text-xs"
            data-testid="proxy-log-table"
          >
            <caption className="sr-only">
              {t("browserLogs.proxy.caption", "Browser proxy log")}
            </caption>
            <thead className={THEAD}>
              <tr>
                <th scope="col" className={TH}>
                  {t("browserLogs.col.time", "Time")}
                </th>
                <th scope="col" className={TH}>
                  {t("browserLogs.col.level", "Level")}
                </th>
                <th scope="col" className={TH}>
                  {t("browserLogs.col.source", "Source")}
                </th>
                <th scope="col" className={TH}>
                  {t("browserLogs.col.type", "Type")}
                </th>
                <th scope="col" className={TH}>
                  {t("browserLogs.col.message", "Message")}
                </th>
                <th scope="col" className={TH}>
                  {t("browserLogs.col.detail", "Detail")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {visible.map((e: ProxyLogEntry) => (
                <tr key={e.id} className={ROW} data-testid="proxy-log-row">
                  <td
                    className="whitespace-nowrap px-3 py-2 text-[var(--color-textSecondary)]"
                    title={dateTimeLabel(e.at)}
                  >
                    {timeLabel(e.at)}
                  </td>
                  <td
                    className={`px-3 py-2 font-medium ${LEVEL_CLASS[e.level]}`}
                  >
                    {t(`browserLogs.level.${e.level}`, e.level)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {e.source === "cef"
                      ? t("browserLogs.proxy.badgeCef", "CEF")
                      : t("browserLogs.proxy.badgeLegacy", "Legacy")}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {t(`browserLogs.proxyKind.${e.kind}`, e.kind)}
                  </td>
                  <td className="max-w-md px-3 py-2">
                    <div className="truncate" title={e.message}>
                      {e.message}
                      {e.count && e.count > 1 ? ` (x${e.count})` : ""}
                    </div>
                    {e.url && (
                      <div
                        className="truncate font-mono text-[10px] text-[var(--color-textMuted)]"
                        title={e.url}
                      >
                        {e.method ? `${e.method} ` : ""}
                        {e.url}
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-[var(--color-textSecondary)]">
                    {[
                      e.status !== undefined ? `HTTP ${e.status}` : "",
                      e.bytes !== undefined ? `${e.bytes} B` : "",
                      e.latencyMs !== undefined ? `${e.latencyMs} ms` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length === 0 && (
            <div className="flex items-center justify-center py-14">
              <EmptyState
                icon={ScrollText}
                message={
                  entries.length === 0
                    ? t("browserLogs.proxy.empty", "No proxy events yet")
                    : t("browserLogs.proxy.noMatch", "No matching proxy events")
                }
                hint={
                  entries.length === 0
                    ? t(
                        "browserLogs.proxy.emptyHint",
                        "Relay connections, authentication, denials and upstream failures appear here while this view is open.",
                      )
                    : t(
                        "browserLogs.adjustFilters",
                        "Adjust the filters to see more.",
                      )
                }
              />
            </div>
          )}
        </div>
      </div>
      <Footer>
        {fmt(
          t(
            "browserLogs.footer",
            "{{shown}} of {{total}} entries (last {{cap}} kept)",
          ),
          {
            shown: visible.length,
            total: entries.length,
            cap: proxyLogStore.capacity,
          },
        )}
      </Footer>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  History                                                            */
/* ------------------------------------------------------------------ */

const RETENTION_CHOICES = [1, 7, 30, 90, 365, 0];

export const BrowserHistoryView: React.FC<{
  /** Session ids that currently have a live browser tab. */
  liveSessionIds: readonly string[];
  onFocusSession?: (sessionId: string) => void;
}> = ({ liveSessionIds, onFocusSession }) => {
  const { t } = useTranslation();
  const entries = useStore(browserHistoryStore);
  const settings = browserHistoryStore.getSettings();
  const [, force] = useState(0);
  const [search, setSearch] = useState("");
  const [connection, setConnection] = useState("all");

  const connections = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of entries)
      map.set(e.connectionId, e.connectionName || e.connectionId);
    return [...map.entries()];
  }, [entries]);

  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return entries
      .filter(
        (e) =>
          (connection === "all" || e.connectionId === connection) &&
          matches(`${e.title} ${e.url}`, query),
      )
      .reverse();
  }, [connection, entries, search]);

  const open = (entry: BrowserHistoryEntry) => {
    onFocusSession?.(entry.sessionId);
    window.dispatchEvent(
      new CustomEvent<BrowserHistoryOpenDetail>(BROWSER_HISTORY_OPEN_EVENT, {
        detail: { sessionId: entry.sessionId, url: entry.url },
      }),
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-4 py-2.5">
        <SearchBox
          value={search}
          onChange={setSearch}
          label={t(
            "browserLogs.history.searchLabel",
            "Search browsing history",
          )}
          placeholder={t(
            "browserLogs.history.searchPlaceholder",
            "Search title or address…",
          )}
          testId="browser-history-search"
        />
        <FilterSelect
          value={connection}
          onChange={setConnection}
          label={t("browserLogs.history.connection", "Filter by connection")}
          testId="browser-history-connection"
          options={[
            {
              value: "all",
              label: t("browserLogs.history.allConnections", "All connections"),
            },
            ...connections.map(([id, name]) => ({ value: id, label: name })),
          ]}
        />
        <label className="flex items-center gap-1.5 text-xs text-[var(--color-textSecondary)]">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) => {
              browserHistoryStore.setSettings({
                enabled: event.target.checked,
              });
              force((n) => n + 1);
            }}
            data-testid="browser-history-enabled"
          />
          {t("browserLogs.history.record", "Record history")}
        </label>
        <FilterSelect
          value={String(settings.retentionDays)}
          onChange={(v) => {
            browserHistoryStore.setSettings({ retentionDays: Number(v) });
            force((n) => n + 1);
          }}
          label={t("browserLogs.history.retention", "History retention")}
          testId="browser-history-retention"
          options={RETENTION_CHOICES.map((days) => ({
            value: String(days),
            label:
              days === 0
                ? t("browserLogs.history.keepForever", "Keep until cleared")
                : fmt(
                    t("browserLogs.history.keepDays", "Keep {{count}} days"),
                    {
                      count: days,
                    },
                  ),
          }))}
        />
        <ToolbarButton
          icon={Trash2}
          label={t("browserLogs.history.clearAll", "Clear all")}
          disabled={!entries.length}
          testId="browser-history-clear"
          onClick={() => browserHistoryStore.clear()}
        />
      </div>
      <p className="flex-shrink-0 px-4 pt-2 text-[11px] text-[var(--color-textMuted)]">
        {t(
          "browserLogs.history.privacyNote",
          "Only the address (without query or fragment) and title are kept on this device. Quick Connect tabs are private and never recorded.",
        )}
      </p>
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain p-3">
        <div className="min-h-full w-max min-w-full rounded-lg border border-[var(--color-border)]">
          <table
            className="w-full min-w-[640px] border-collapse text-left text-xs"
            data-testid="browser-history-table"
          >
            <caption className="sr-only">
              {t("browserLogs.history.caption", "Browsing history")}
            </caption>
            <thead className={THEAD}>
              <tr>
                <th scope="col" className={TH}>
                  {t("browserLogs.history.col.page", "Page")}
                </th>
                <th scope="col" className={TH}>
                  {t("browserLogs.history.col.connection", "Connection")}
                </th>
                <th scope="col" className={TH}>
                  {t("browserLogs.col.time", "Time")}
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  {t("browserLogs.history.col.actions", "Actions")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {visible.map((e) => {
                const live = liveSessionIds.includes(e.sessionId);
                return (
                  <tr
                    key={e.id}
                    className={ROW}
                    data-testid="browser-history-row"
                  >
                    <th scope="row" className="max-w-96 px-3 py-2 font-normal">
                      <div
                        className="truncate font-medium text-[var(--color-text)]"
                        title={e.title}
                      >
                        {e.title || e.url}
                      </div>
                      <div
                        className="truncate font-mono text-[10px] text-[var(--color-textMuted)]"
                        title={e.url}
                      >
                        {e.url}
                      </div>
                    </th>
                    <td className="whitespace-nowrap px-3 py-2 text-[var(--color-textSecondary)]">
                      {e.connectionName || e.connectionId}
                    </td>
                    <td
                      className="whitespace-nowrap px-3 py-2 text-[var(--color-textSecondary)]"
                      title={dateTimeLabel(e.at)}
                    >
                      {dateTimeLabel(e.at)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-0.5">
                        <button
                          type="button"
                          className="sor-icon-btn-xs disabled:opacity-40"
                          disabled={!live}
                          onClick={() => open(e)}
                          title={
                            live
                              ? t(
                                  "browserLogs.history.open",
                                  "Open in its browser tab",
                                )
                              : t(
                                  "browserLogs.history.openClosed",
                                  "The browser tab is closed",
                                )
                          }
                          aria-label={fmt(
                            t(
                              "browserLogs.history.openLabel",
                              "Open {{title}}",
                            ),
                            { title: e.title || e.url },
                          )}
                        >
                          <ExternalLink size={14} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="sor-icon-btn-xs"
                          onClick={() =>
                            void navigator.clipboard?.writeText(e.url)
                          }
                          title={t(
                            "browserLogs.history.copyUrl",
                            "Copy address",
                          )}
                          aria-label={fmt(
                            t(
                              "browserLogs.history.copyLabel",
                              "Copy address of {{title}}",
                            ),
                            { title: e.title || e.url },
                          )}
                        >
                          <Copy size={14} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="sor-icon-btn-xs text-error hover:text-error"
                          onClick={() => browserHistoryStore.remove(e.id)}
                          title={t(
                            "browserLogs.history.remove",
                            "Remove from history",
                          )}
                          aria-label={fmt(
                            t(
                              "browserLogs.history.removeLabel",
                              "Remove {{title}} from history",
                            ),
                            { title: e.title || e.url },
                          )}
                        >
                          <X size={14} aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {visible.length === 0 && (
            <div className="flex items-center justify-center py-14">
              <EmptyState
                icon={History}
                message={
                  entries.length === 0
                    ? t("browserLogs.history.empty", "No browsing history")
                    : t("browserLogs.history.noMatch", "No matching history")
                }
                hint={
                  !settings.enabled
                    ? t(
                        "browserLogs.history.disabled",
                        "History recording is turned off.",
                      )
                    : entries.length === 0
                      ? t(
                          "browserLogs.history.emptyHint",
                          "Pages you visit in browser connections appear here.",
                        )
                      : t(
                          "browserLogs.adjustFilters",
                          "Adjust the filters to see more.",
                        )
                }
              />
            </div>
          )}
        </div>
      </div>
      <Footer>
        {fmt(
          t(
            "browserLogs.history.footer",
            "{{shown}} of {{total}} history entries",
          ),
          {
            shown: visible.length,
            total: entries.length,
          },
        )}
      </Footer>
    </div>
  );
};
