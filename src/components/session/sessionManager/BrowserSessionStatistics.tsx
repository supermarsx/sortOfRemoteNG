import React, { useEffect, useMemo, useRef } from "react";
import { Activity, BarChart3, Globe, ShieldCheck } from "lucide-react";
import { EmptyState } from "../../ui/display";
import {
  nativeProxyCounters,
  type NativeBrowserDiagnostics,
} from "../../../types/network/nativeBrowserDiagnostics";
import {
  BROWSER_SESSION_STATUS_META,
  BROWSER_STATUS_ORDER,
  UNKNOWN_VALUE,
  formatAbsoluteTime,
  formatCount,
  formatDuration,
  formatRelativeTime,
  humanizeToken,
  type BrowserSessionListRow,
} from "./browserSessionList";
import { BrowserSessionStatusPill } from "./BrowserSessionStatusPill";

export interface BrowserSessionStatisticsProps {
  rows: BrowserSessionListRow[];
  diagnostics?: NativeBrowserDiagnostics;
  diagnosticsError: string;
  diagnosticsLoading: boolean;
  /** Session whose card should be brought into view (from a list row). */
  focusSessionId?: string | null;
  now?: number;
}

/** Label/value pair rendered inside a definition list. */
const Field: React.FC<{
  label: string;
  value?: React.ReactNode;
  mono?: boolean;
  title?: string;
}> = ({ label, value, mono, title }) => {
  const missing = value == null || value === "" || value === UNKNOWN_VALUE;
  return (
    <div className="contents">
      <dt className="text-[var(--color-textSecondary)]">{label}</dt>
      <dd
        className={`min-w-0 break-all ${mono ? "font-mono" : ""} ${missing ? "text-[var(--color-textMuted)]" : "text-[var(--color-text)]"}`}
        title={title}
      >
        {missing ? UNKNOWN_VALUE : value}
      </dd>
    </div>
  );
};

const FieldList: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <dl className="grid grid-cols-[minmax(7.5rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
    {children}
  </dl>
);

const SectionHeading: React.FC<{
  level: "h3" | "h5";
  id?: string;
  children: React.ReactNode;
}> = ({ level: Level, id, children }) => (
  <Level
    id={id}
    className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-textSecondary)]"
  >
    {children}
  </Level>
);

const StatTile: React.FC<{ label: string; value: string; hint?: string }> = ({
  label,
  value,
  hint,
}) => (
  <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)]/40 px-3 py-2.5">
    <dt className="text-[11px] text-[var(--color-textSecondary)]">{label}</dt>
    <dd className="mt-1 text-lg font-semibold tabular-nums text-[var(--color-text)]">
      {value}
    </dd>
    {hint && (
      <dd className="mt-0.5 text-[10px] text-[var(--color-textMuted)]">
        {hint}
      </dd>
    )}
  </div>
);

const CounterGrid: React.FC<{
  values: Partial<Record<(typeof nativeProxyCounters)[number][0], number>>;
  label: string;
}> = ({ values, label }) => (
  <dl
    aria-label={label}
    className="grid grid-cols-1 gap-1.5 text-xs min-[420px]:grid-cols-2 lg:grid-cols-3"
  >
    {nativeProxyCounters.map(([field, counterLabel]) => (
      <div
        key={field}
        className="flex items-baseline justify-between gap-3 rounded border border-[var(--color-border)]/60 bg-[var(--color-surface)] px-2.5 py-1.5"
      >
        <dt className="min-w-0 text-[var(--color-textSecondary)]">
          {counterLabel}
        </dt>
        <dd className="font-mono tabular-nums text-[var(--color-text)]">
          {values[field] == null ? UNKNOWN_VALUE : formatCount(values[field]!)}
        </dd>
      </div>
    ))}
  </dl>
);

function sessionDomId(id: string): string {
  return `browser-session-stats-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

/** Detailed live diagnostics for browser sessions, grouped per session. */
export const BrowserSessionStatistics: React.FC<
  BrowserSessionStatisticsProps
> = ({
  rows,
  diagnostics,
  diagnosticsError,
  diagnosticsLoading,
  focusSessionId,
  now = Date.now(),
}) => {
  const focusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!focusSessionId) return;
    focusRef.current?.scrollIntoView?.({ block: "nearest" });
    focusRef.current?.focus({ preventScroll: true });
  }, [focusSessionId]);

  const overview = useMemo(() => {
    const statusCounts = new Map<string, number>();
    for (const row of rows) {
      statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + 1);
    }
    const relayed = rows.filter((row) => row.native?.proxy);
    const totals: Partial<
      Record<(typeof nativeProxyCounters)[number][0], number>
    > = {};
    if (relayed.length > 0) {
      for (const [field] of nativeProxyCounters) {
        totals[field] = relayed.reduce(
          (sum, row) => sum + (row.native!.proxy![field] ?? 0),
          0,
        );
      }
    }
    return {
      statusCounts,
      observed: rows.filter((row) => row.native).length,
      relayed: relayed.length,
      listening: relayed.filter(
        (row) => row.native!.proxy!.state === "listening",
      ).length,
      totals,
    };
  }, [rows]);

  const observedRows = rows.filter((row) => row.native);
  const tabOnlyRows = rows.filter((row) => !row.native);

  return (
    <section
      aria-labelledby="browser-session-statistics-heading"
      className="mx-auto w-full max-w-5xl space-y-4"
      data-testid="browser-session-statistics"
    >
      <header className="space-y-1">
        <h2
          id="browser-session-statistics-heading"
          className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]"
        >
          <BarChart3 size={15} aria-hidden="true" className="text-info" />
          Browser session statistics
        </h2>
        <p className="text-xs text-[var(--color-textMuted)]">
          Live sessions owned by this window only. Closed or revoked sessions
          are omitted; historical failures are in Browser sessions → Startup
          journal. URLs and credentials are never included here.
        </p>
      </header>

      {diagnosticsError && (
        <p
          role="alert"
          className="rounded border border-error/40 bg-error/10 px-3 py-2 text-xs text-error"
        >
          {diagnosticsError}
        </p>
      )}

      <section
        aria-labelledby="browser-stats-overview"
        className="sor-surface-card space-y-3 p-4"
      >
        <SectionHeading level="h3" id="browser-stats-overview">
          Overview
        </SectionHeading>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile
            label="Open browser tabs"
            value={formatCount(rows.length)}
          />
          <StatTile
            label="Natively observed"
            value={
              diagnosticsLoading && !diagnostics
                ? UNKNOWN_VALUE
                : formatCount(overview.observed)
            }
            hint={
              diagnostics && !diagnostics.available
                ? "Unavailable in this build"
                : undefined
            }
          />
          <StatTile
            label="Relays listening"
            value={`${formatCount(overview.listening)} / ${formatCount(overview.relayed)}`}
            hint="Sessions with a relay snapshot"
          />
          <StatTile
            label="Need attention"
            value={formatCount(
              (overview.statusCounts.get("failed") ?? 0) +
                (overview.statusCounts.get("error") ?? 0),
            )}
            hint="Failed or errored sessions"
          />
        </dl>
        {rows.length > 0 && (
          <ul
            aria-label="Sessions by status"
            className="flex flex-wrap gap-1.5"
          >
            {BROWSER_STATUS_ORDER.filter((status) =>
              overview.statusCounts.has(status),
            ).map((status) => (
              <li
                key={status}
                className="inline-flex items-center gap-1.5 text-xs text-[var(--color-textSecondary)]"
              >
                <BrowserSessionStatusPill status={status} />
                <span className="tabular-nums">
                  {formatCount(overview.statusCounts.get(status) ?? 0)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="browser-stats-relay-totals"
        className="sor-surface-card space-y-3 p-4"
      >
        <div className="space-y-1">
          <SectionHeading level="h3" id="browser-stats-relay-totals">
            Private relay totals
          </SectionHeading>
          <p className="text-xs text-[var(--color-textMuted)]">
            Summed across {formatCount(overview.relayed)} session
            {overview.relayed === 1 ? "" : "s"} with a relay snapshot. These are
            private relay counters, including diagnostic probes—not HTTP page
            requests or status codes.
          </p>
        </div>
        {overview.relayed > 0 ? (
          <CounterGrid values={overview.totals} label="Private relay totals" />
        ) : (
          <p className="text-xs text-[var(--color-textMuted)]">
            No relay snapshots reported; no zero activity is inferred.
          </p>
        )}
      </section>

      <section aria-labelledby="browser-stats-sessions" className="space-y-3">
        <SectionHeading level="h3" id="browser-stats-sessions">
          Sessions
        </SectionHeading>
        {diagnosticsLoading && !diagnostics ? (
          <p className="text-xs text-[var(--color-textSecondary)]">
            Reading native browser diagnostics…
          </p>
        ) : diagnostics && !diagnostics.available ? (
          <p className="text-xs text-[var(--color-textMuted)]">
            Native browser diagnostics are unavailable in this build.
          </p>
        ) : null}
        {rows.length === 0 ? (
          <div className="sor-surface-card">
            <EmptyState
              icon={Globe}
              message="No observable native browser sessions in this window."
              hint="Open an HTTP or HTTPS connection to see its statistics here."
            />
          </div>
        ) : (
          <ul className="space-y-3">
            {[...observedRows, ...tabOnlyRows].map((row) => {
              const native = row.native;
              const focused = focusSessionId === row.id;
              const uptime = row.startedAt
                ? (now - row.startedAt.getTime()) / 1000
                : undefined;
              return (
                <li key={row.id}>
                  <article
                    id={sessionDomId(row.id)}
                    ref={focused ? focusRef : undefined}
                    tabIndex={focused ? -1 : undefined}
                    aria-labelledby={`${sessionDomId(row.id)}-title`}
                    data-testid={`browser-session-stats-${row.id}`}
                    className={`sor-surface-card space-y-4 p-4 outline-none ${focused ? "ring-2 ring-[var(--color-primary)]" : ""}`}
                  >
                    <header className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <Globe
                          size={16}
                          aria-hidden="true"
                          className="shrink-0 text-info"
                        />
                        <div className="min-w-0">
                          <h4
                            id={`${sessionDomId(row.id)}-title`}
                            className="truncate text-sm font-medium text-[var(--color-text)]"
                            title={row.title}
                          >
                            {row.title}
                          </h4>
                          <p
                            className="truncate font-mono text-[10px] text-[var(--color-textMuted)]"
                            title={row.subtitle}
                          >
                            {row.subtitle}
                          </p>
                        </div>
                      </div>
                      <BrowserSessionStatusPill status={row.status} />
                    </header>

                    <div className="grid gap-4 md:grid-cols-2">
                      <section className="space-y-2">
                        <SectionHeading level="h5">Lifecycle</SectionHeading>
                        <FieldList>
                          <Field
                            label="Browser state"
                            value={
                              native
                                ? native.phase
                                  ? humanizeToken(native.phase)
                                  : "Snapshot unavailable"
                                : `${BROWSER_SESSION_STATUS_META[row.status].label} (tab)`
                            }
                          />
                          {row.failureReason && (
                            <Field
                              label="Failure reason"
                              value={
                                <span className="text-error">
                                  {row.failureReason}
                                </span>
                              }
                            />
                          )}
                          <Field
                            label="Started"
                            value={
                              row.startedAt
                                ? formatRelativeTime(row.startedAt, now)
                                : undefined
                            }
                            title={formatAbsoluteTime(row.startedAt)}
                          />
                          <Field
                            label="Open for"
                            value={
                              uptime != null
                                ? formatDuration(uptime)
                                : undefined
                            }
                          />
                          <Field
                            label="Last activity"
                            value={
                              row.lastActivity
                                ? formatRelativeTime(row.lastActivity, now)
                                : undefined
                            }
                            title={formatAbsoluteTime(row.lastActivity)}
                          />
                        </FieldList>
                      </section>
                      <section className="space-y-2">
                        <SectionHeading level="h5">Identity</SectionHeading>
                        <FieldList>
                          <Field label="Session" value={row.id} mono />
                          <Field
                            label="Connection"
                            value={
                              native?.identity.connectionId ?? row.connectionId
                            }
                            mono
                          />
                          <Field
                            label="Attempt"
                            value={native?.identity.attemptId}
                            mono
                          />
                        </FieldList>
                      </section>
                    </div>

                    <section className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <SectionHeading level="h5">
                          Private relay
                        </SectionHeading>
                        <span className="inline-flex items-center gap-1 text-xs text-[var(--color-textSecondary)]">
                          {native?.proxy ? (
                            <ShieldCheck size={12} aria-hidden="true" />
                          ) : (
                            <Activity size={12} aria-hidden="true" />
                          )}
                          Relay state:{" "}
                          <span
                            className={
                              native?.proxy
                                ? "text-[var(--color-text)]"
                                : "text-[var(--color-textMuted)]"
                            }
                          >
                            {native?.proxy
                              ? humanizeToken(native.proxy.state)
                              : native
                                ? "Snapshot unavailable"
                                : "Not observed"}
                          </span>
                        </span>
                      </div>
                      {native?.proxy ? (
                        <CounterGrid
                          values={native.proxy}
                          label={`Relay counters for ${row.title}`}
                        />
                      ) : (
                        <p className="text-xs text-[var(--color-textMuted)]">
                          {native
                            ? "Relay snapshot unavailable; no zero activity is inferred. Refresh to retry."
                            : "No native observation for this tab yet; no zero activity is inferred."}
                        </p>
                      )}
                    </section>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </section>
  );
};
