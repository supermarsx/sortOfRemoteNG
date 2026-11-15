import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Search,
  Server,
} from "lucide-react";
import EmptyState from "../../ui/display/EmptyState";
import { Sparkline } from "./Sparkline";
import { StatusBadge } from "./StatusBadge";
import {
  serverStatsHistory,
  type MetricKey,
  type ServerStatsEntry,
} from "../../../utils/ssh/serverStatsHistory";
import {
  MISSING,
  formatCount,
  formatLoad,
  formatPercent,
  formatRate,
  formatUptime,
  usageTone,
} from "../../../utils/ssh/serverStatsFormat";
import {
  buildRows,
  filterRows,
  groupRows,
  sortRows,
  type AggregateRow,
  type ConnectionLike,
  type GroupBy,
  type SessionLike,
  type SortDir,
  type SortKey,
} from "../../../utils/ssh/serverStatsTable";

interface ColumnDef {
  key: SortKey;
  label: string;
  i18n: string;
  metric?: MetricKey;
  format: (e: ServerStatsEntry | null) => string;
  /** Percent columns share a fixed 0..100 spark domain. */
  percent?: boolean;
  align?: "left" | "right";
}

const pct0 = (v: number) => formatPercent(v, 0);

const COLUMNS: ColumnDef[] = [
  {
    key: "cpu",
    label: "CPU",
    i18n: "serverStats.cpu",
    metric: "cpu",
    percent: true,
    format: (e) => formatPercent(e?.latest.cpu, 1),
  },
  {
    key: "mem",
    label: "Memory",
    i18n: "serverStats.memory",
    metric: "mem",
    percent: true,
    format: (e) => formatPercent(e?.latest.mem, 1),
  },
  {
    key: "disk",
    label: "Disk",
    i18n: "serverStats.disk",
    metric: "disk",
    percent: true,
    format: (e) => formatPercent(e?.latest.disk, 0),
  },
  {
    key: "load1",
    label: "Load",
    i18n: "serverStats.loadAvg",
    metric: "load1",
    format: (e) => formatLoad(e?.latest.load1),
  },
  {
    key: "conns",
    label: "Connections",
    i18n: "serverStats.connections",
    metric: "conns",
    format: (e) => formatCount(e?.latest.conns),
  },
  {
    key: "diskIo",
    label: "Disk I/O",
    i18n: "serverStats.diskIoRate",
    metric: "diskRead",
    format: (e) => {
      const a = e?.latest.diskRead;
      const b = e?.latest.diskWrite;
      return a == null && b == null ? MISSING : formatRate((a ?? 0) + (b ?? 0));
    },
  },
  {
    key: "uptime",
    label: "Uptime",
    i18n: "serverStats.uptime",
    format: (e) => formatUptime(e?.uptimeSeconds),
  },
];

const SPARK_FORMAT: Record<string, (v: number) => string> = {
  cpu: pct0,
  mem: pct0,
  disk: pct0,
  load1: formatLoad,
  conns: formatCount,
  diskRead: formatRate,
};

const TONE_TEXT = {
  ok: "text-[var(--color-text)]",
  warn: "text-warning",
  crit: "text-error",
  none: "text-[var(--color-textSecondary)]",
} as const;

interface RowProps {
  row: AggregateRow;
  onOpen: (sessionId: string) => void;
  labels: Record<string, string>;
}

const Row = React.memo(
  ({ row, onOpen, labels }: RowProps) => {
    const e = row.entry;
    return (
      <tr
        className="border-t border-[var(--color-border)] hover:bg-[var(--color-surfaceHover)] cursor-pointer"
        onClick={() => onOpen(row.sessionId)}
        data-testid="aggregate-row"
        data-session-id={row.sessionId}
      >
        <th
          scope="row"
          className="px-3 py-2 text-left font-normal min-w-[160px]"
        >
          <button
            type="button"
            className="block text-left max-w-full focus-visible:outline focus-visible:outline-2 rounded"
            onClick={(ev) => {
              ev.stopPropagation();
              onOpen(row.sessionId);
            }}
            title={labels.open}
            aria-label={`${labels.open}: ${row.name}`}
          >
            <span className="block text-sm font-medium text-[var(--color-text)] truncate">
              {row.name}
            </span>
            <span className="block text-xs text-[var(--color-textSecondary)] truncate">
              {e?.hostname && e.hostname !== row.name
                ? e.hostname
                : row.host || MISSING}
            </span>
          </button>
        </th>
        <td
          className="px-3 py-2 whitespace-nowrap"
          title={e?.error ?? undefined}
        >
          <StatusBadge status={row.status} />
        </td>
        {COLUMNS.map((c) => {
          const tone = c.percent
            ? usageTone(e?.latest[c.metric as MetricKey])
            : "none";
          const text = c.format(e);
          return (
            <td key={c.key} className="px-3 py-2">
              <div className="flex items-center justify-end gap-2">
                <span
                  className={`text-xs tabular-nums ${tone === "none" ? "text-[var(--color-text)]" : TONE_TEXT[tone]}`}
                >
                  {text}
                </span>
                {c.metric && (
                  <Sparkline
                    values={e?.series[c.metric] ?? EMPTY}
                    label={`${row.name} ${labels[c.key]}`}
                    format={SPARK_FORMAT[c.metric]}
                    width={64}
                    height={20}
                    min={c.percent ? 0 : undefined}
                    max={c.percent ? 100 : undefined}
                  />
                )}
              </div>
            </td>
          );
        })}
      </tr>
    );
  },
  (a, b) =>
    a.row.entry === b.row.entry &&
    a.row.status === b.row.status &&
    a.row.name === b.row.name &&
    a.row.host === b.row.host &&
    a.onOpen === b.onOpen &&
    a.labels === b.labels,
);
Row.displayName = "AggregateRow";

const EMPTY: never[] = [];

interface AggregateViewProps {
  sessions: readonly SessionLike[];
  connections: readonly ConnectionLike[];
  onOpenSession: (sessionId: string) => void;
}

export const AggregateView: React.FC<AggregateViewProps> = ({
  sessions,
  connections,
  onOpenSession,
}) => {
  const { t } = useTranslation();
  const entries = useSyncExternalStore(
    serverStatsHistory.subscribe,
    serverStatsHistory.getSnapshot,
  );
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  // Re-derive staleness at a low cadence without re-rendering per sample.
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) setTick(Date.now());
    }, 15_000);
    return () => clearInterval(id);
  }, []);

  const rows = useMemo(
    () => buildRows(sessions, connections, entries, tick),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions, connections, entries, tick],
  );
  const visible = useMemo(
    () => sortRows(filterRows(rows, query), sortKey, sortDir),
    [rows, query, sortKey, sortDir],
  );
  const groups = useMemo(() => groupRows(visible, groupBy), [visible, groupBy]);

  const labels = useMemo(() => {
    const l: Record<string, string> = {
      open: t("serverStats.openDetails", "Open detailed stats"),
    };
    COLUMNS.forEach((c) => (l[c.key] = t(c.i18n, c.label)));
    return l;
  }, [t]);

  const toggleSort = useCallback(
    (key: SortKey) => {
      if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      else {
        setSortKey(key);
        setSortDir(key === "name" ? "asc" : "desc");
      }
    },
    [sortKey],
  );

  if (sessions.length === 0) {
    return (
      <EmptyState
        icon={Server}
        message={t("serverStats.noSessions", "No SSH sessions")}
        hint={t(
          "serverStats.noSessionsDesc",
          "Connect to an SSH server first, then collect server stats.",
        )}
      />
    );
  }

  const header = (key: SortKey, label: string, align: "left" | "right") => {
    const active = sortKey === key;
    const Icon = !active
      ? ChevronsUpDown
      : sortDir === "asc"
        ? ArrowUp
        : ArrowDown;
    return (
      <th
        key={key}
        scope="col"
        aria-sort={
          active ? (sortDir === "asc" ? "ascending" : "descending") : "none"
        }
        className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-textSecondary)] ${
          align === "right" ? "text-right" : "text-left"
        }`}
      >
        <button
          type="button"
          onClick={() => toggleSort(key)}
          className={`inline-flex items-center gap-1 hover:text-[var(--color-text)] ${
            active ? "text-[var(--color-text)]" : ""
          }`}
        >
          {label}
          <Icon size={11} aria-hidden="true" />
        </button>
      </th>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-2 flex-1 min-w-[200px]">
          <Search
            size={12}
            className="text-[var(--color-textSecondary)]"
            aria-hidden="true"
          />
          <input
            type="search"
            className="sor-form-input-xs flex-1"
            placeholder={t(
              "serverStats.aggregateFilter",
              "Filter servers, folders, tags…",
            )}
            aria-label={t(
              "serverStats.aggregateFilter",
              "Filter servers, folders, tags…",
            )}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-[var(--color-textSecondary)]">
          {t("serverStats.groupBy", "Group by")}
          <select
            className="sor-form-input-xs"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupBy)}
          >
            <option value="none">{t("serverStats.groupNone", "None")}</option>
            <option value="folder">
              {t("serverStats.groupFolder", "Folder")}
            </option>
            <option value="tag">{t("serverStats.groupTag", "Tag")}</option>
          </select>
        </label>
        <span className="text-[var(--color-textSecondary)]" aria-live="polite">
          {t("serverStats.serverCount", "{{shown}} of {{total}} servers", {
            shown: visible.length,
            total: rows.length,
          })}
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]">
        <table
          className="w-full text-left border-collapse"
          aria-label={t("serverStats.aggregateTable", "Server stats overview")}
        >
          <thead className="bg-[var(--color-surfaceHover)]">
            <tr>
              {header("name", t("serverStats.server", "Server"), "left")}
              {header("status", t("serverStats.status", "Status"), "left")}
              {COLUMNS.map((c) => header(c.key, labels[c.key], "right"))}
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.key}>
              {g.key !== "all" && (
                <tr className="bg-[var(--color-surfaceHover)]/50">
                  <th
                    scope="rowgroup"
                    colSpan={COLUMNS.length + 2}
                    className="px-3 py-1 text-left text-xs font-semibold text-[var(--color-textSecondary)]"
                  >
                    {g.label ?? t("serverStats.ungrouped", "Ungrouped")} (
                    {g.rows.length})
                  </th>
                </tr>
              )}
              {g.rows.map((row) => (
                <Row
                  key={`${g.key}:${row.sessionId}`}
                  row={row}
                  onOpen={onOpenSession}
                  labels={labels}
                />
              ))}
            </tbody>
          ))}
          {visible.length === 0 && (
            <tbody>
              <tr>
                <td
                  colSpan={COLUMNS.length + 2}
                  className="px-3 py-6 text-center text-xs text-[var(--color-textSecondary)]"
                >
                  {t("serverStats.noMatches", "No servers match the filter")}
                </td>
              </tr>
            </tbody>
          )}
        </table>
      </div>
    </div>
  );
};
