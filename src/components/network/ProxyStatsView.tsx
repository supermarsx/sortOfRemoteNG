import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Radio,
  ScrollText,
  ShieldCheck,
  Waypoints,
} from "lucide-react";
import type { useInternalProxyManager } from "../../hooks/network/useInternalProxyManager";
import { formatDateTime } from "../../hooks/network/useInternalProxyManager";
import {
  nativeProxyCounters,
  type NativeBrowserSessionDiagnostics,
} from "../../types/network/nativeBrowserDiagnostics";
import {
  formatCount,
  formatPercent,
  problemFields,
  problemTotal,
  relayStateTone,
  summarizeNativeProxy,
  trafficFields,
  type StatsTone,
} from "../../utils/network/proxyStatsFormat";

type Mgr = Pick<
  ReturnType<typeof useInternalProxyManager>,
  | "nativeDiagnostics"
  | "nativeDiagnosticsError"
  | "nativeDiagnosticsLoading"
  | "sessions"
  | "totalRequests"
  | "totalErrors"
  | "errorRate"
>;

const toneText: Record<StatsTone, string> = {
  ok: "text-success",
  warn: "text-warning",
  err: "text-error",
  muted: "text-[var(--color-textMuted)]",
};

const counterLabel = Object.fromEntries(nativeProxyCounters) as Record<
  string,
  string
>;

const Tile: React.FC<{
  icon: React.ElementType;
  label: string;
  value: string;
  hint?: string;
  tone?: StatsTone;
  testId?: string;
}> = ({ icon: Icon, label, value, hint, tone = "muted", testId }) => (
  <div className="sor-surface-card px-3 py-2.5" data-testid={testId}>
    <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-textSecondary)]">
      <Icon size={12} className={toneText[tone]} />
      <span>{label}</span>
    </div>
    <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--color-text)]">
      {value}
    </p>
    {hint && (
      <p className="text-[10px] text-[var(--color-textMuted)]">{hint}</p>
    )}
  </div>
);

const SessionRow: React.FC<{
  session: NativeBrowserSessionDiagnostics;
  t: (key: string, fallback: string, opts?: Record<string, unknown>) => string;
}> = ({ session, t }) => {
  const [open, setOpen] = useState(false);
  const proxy = session.proxy;
  const problems = proxy ? problemTotal(proxy) : 0;
  return (
    <li className="border border-[var(--color-border)] rounded-lg bg-[var(--color-surface)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-3 py-2 text-left text-xs hover:bg-[var(--color-surfaceHover)]/60 transition-colors"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="font-mono truncate flex-1 min-w-0">
          {session.identity.sessionId}
        </span>
        <span className="text-[var(--color-textSecondary)]">
          {session.phase ?? t("proxyStats.unavailable", "Snapshot unavailable")}
        </span>
        {proxy ? (
          <>
            <span className={toneText[relayStateTone(proxy.state)]}>
              {proxy.state}
            </span>
            <span className="tabular-nums text-[var(--color-textSecondary)]">
              {t("proxyStats.connectionsShort", "{{count}} conn", {
                count: formatCount(proxy.acceptedConnections),
              })}
            </span>
            {problems > 0 && (
              <span className="tabular-nums text-error">
                {t("proxyStats.problemsShort", "{{count}} problems", {
                  count: formatCount(problems),
                })}
              </span>
            )}
          </>
        ) : (
          <span className="text-[var(--color-textMuted)]">
            {t("proxyStats.noRelay", "Relay snapshot unavailable")}
          </span>
        )}
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-[var(--color-border)] space-y-3 text-xs">
          {session.failureReason && (
            <p className="text-error">
              {t("proxyStats.failure", "Failure reason")}:{" "}
              {session.failureReason}
            </p>
          )}
          {proxy ? (
            <>
              {(
                [
                  [t("proxyStats.groupTraffic", "Traffic"), trafficFields],
                  [t("proxyStats.groupProblems", "Problems"), problemFields],
                ] as const
              ).map(([title, fields]) => (
                <div key={title}>
                  <p className="text-[10px] uppercase tracking-wide text-[var(--color-textMuted)] mb-1">
                    {title}
                  </p>
                  <dl className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {fields.map((f) => (
                      <div
                        key={f}
                        className="rounded bg-[var(--color-surfaceHover)]/40 p-2"
                      >
                        <dt className="text-[var(--color-textSecondary)]">
                          {counterLabel[f]}
                        </dt>
                        <dd className="font-mono tabular-nums mt-0.5">
                          {formatCount(proxy[f])}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </>
          ) : (
            <p className="text-[var(--color-textMuted)]">
              {t(
                "proxyStats.noRelayDetail",
                "No relay snapshot was available; no zero activity is inferred. Refresh to retry.",
              )}
            </p>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[var(--color-textMuted)]">
            <dt>{t("proxyStats.connection", "Connection")}</dt>
            <dd className="font-mono break-all">
              {session.identity.connectionId}
            </dd>
            <dt>{t("proxyStats.attempt", "Attempt")}</dt>
            <dd className="font-mono break-all">
              {session.identity.attemptId}
            </dd>
          </dl>
        </div>
      )}
    </li>
  );
};

const LegacySection: React.FC<{
  mgr: Mgr;
  t: (key: string, fallback: string, opts?: Record<string, unknown>) => string;
}> = ({ mgr, t }) => {
  const hasLegacy = mgr.sessions.length > 0 || mgr.totalRequests > 0;
  if (!hasLegacy) return null;
  return (
    <details
      className="sor-surface-card px-3 py-2 text-xs"
      data-testid="proxy-stats-legacy"
    >
      <summary className="cursor-pointer select-none text-[var(--color-textSecondary)]">
        {t("proxyStats.legacyTitle", "Legacy HTTP proxy")} &middot;{" "}
        {t(
          "proxyStats.legacySummary",
          "{{sessions}} sessions, {{requests}} requests, {{errors}} errors",
          {
            sessions: mgr.sessions.length,
            requests: formatCount(mgr.totalRequests),
            errors: formatCount(mgr.totalErrors),
          },
        )}
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-[var(--color-textMuted)]">
          {t(
            "proxyStats.legacyNote",
            "Older iframe tabs use a per-session loopback mediator. These counters are separate from the native CEF relay above.",
          )}
        </p>
        <div className="grid grid-cols-3 gap-2">
          <Tile
            icon={Activity}
            label={t("proxyStats.legacySessions", "Sessions")}
            value={formatCount(mgr.sessions.length)}
          />
          <Tile
            icon={Waypoints}
            label={t("proxyStats.legacyRequests", "Total Requests")}
            value={formatCount(mgr.totalRequests)}
          />
          <Tile
            icon={AlertCircle}
            label={t("proxyStats.legacyErrors", "Total Errors")}
            value={formatCount(mgr.totalErrors)}
            hint={
              mgr.totalRequests > 0
                ? t("proxyStats.errorRate", "{{rate}}% error rate", {
                    rate: mgr.errorRate,
                  })
                : undefined
            }
            tone={mgr.totalErrors > 0 ? "err" : "muted"}
          />
        </div>
        <div className="border border-[var(--color-border)] rounded-lg p-3 space-y-1.5 text-[var(--color-textSecondary)]">
          <h5 className="font-medium">
            {t("proxyStats.legacyAbout", "About the legacy HTTP proxy")}
          </h5>
          <p>
            Legacy HTTP/HTTPS iframe tabs open a per-session mediator on a
            random loopback port (
            <code className="text-info">127.0.0.1:&lt;port&gt;</code>
            ). It forwards every request to the upstream target, injecting Basic
            Auth credentials when configured.
          </p>
          <p>
            Upstream failures (connection refused, DNS failure, TLS handshake
            error, timeout, 5xx) return themed HTML pages. A{" "}
            <code className="text-info">401</code> Basic challenge is replaced
            by a themed inline login form.
          </p>
        </div>
        {mgr.sessions.length > 0 && (
          <table className="sor-data-table w-full">
            <thead>
              <tr className="text-left text-[var(--color-textSecondary)]">
                <th className="px-2 py-1">
                  {t("proxyStats.target", "Target")}
                </th>
                <th className="px-2 py-1">
                  {t("proxyStats.requests", "Requests")}
                </th>
                <th className="px-2 py-1">
                  {t("proxyStats.errors", "Errors")}
                </th>
                <th className="px-2 py-1">
                  {t("proxyStats.started", "Started")}
                </th>
              </tr>
            </thead>
            <tbody>
              {mgr.sessions.map((s) => (
                <tr
                  key={s.session_id}
                  className="border-t border-[var(--color-border)]/50"
                >
                  <td
                    className="px-2 py-1 truncate max-w-xs"
                    title={s.target_url}
                  >
                    {s.target_url}
                  </td>
                  <td className="px-2 py-1 font-mono tabular-nums">
                    {formatCount(s.request_count)}
                  </td>
                  <td className="px-2 py-1 font-mono tabular-nums">
                    {formatCount(s.error_count)}{" "}
                    <span className="text-[var(--color-textMuted)]">
                      {formatPercent(s.error_count, s.request_count) ?? ""}
                    </span>
                  </td>
                  <td className="px-2 py-1 whitespace-nowrap text-[var(--color-textMuted)]">
                    {formatDateTime(s.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </details>
  );
};

export const ProxyStatsView: React.FC<{
  mgr: Mgr;
  /** Opens the proxy log view (request log / structured proxy events). */
  onOpenProxyLog?: () => void;
}> = ({ mgr, onOpenProxyLog }) => {
  const { t: i18nT } = useTranslation();
  const t = (key: string, fallback: string, opts?: Record<string, unknown>) => {
    const out = i18nT(key, { defaultValue: fallback, ...opts }) as string;
    // Uninitialised i18n (isolated renders) leaves placeholders in place.
    return out.replace(/\{\{(\w+)\}\}/g, (m, k: string) =>
      opts && k in opts ? String(opts[k]) : m,
    );
  };
  const data = mgr.nativeDiagnostics;
  const sessions = data?.available ? data.sessions : [];
  const totals = summarizeNativeProxy(sessions);
  const failing = formatPercent(totals.problems, totals.acceptedConnections);

  return (
    <div className="space-y-4" data-testid="proxy-stats">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">
            {t("proxyStats.title", "Proxy statistics")}
          </h3>
          <p className="text-xs text-[var(--color-textMuted)]">
            {t(
              "proxyStats.subtitle",
              "Live relay counters for native CEF browser sessions in this window. Not HTTP page requests or website health.",
            )}
          </p>
        </div>
        {onOpenProxyLog && (
          <button
            type="button"
            onClick={onOpenProxyLog}
            className="sor-btn sor-btn-secondary sor-btn-xs"
          >
            <ScrollText size={12} /> {t("proxyStats.openLog", "Open proxy log")}
          </button>
        )}
      </div>

      {mgr.nativeDiagnosticsError ? (
        <p role="alert" className="text-xs text-error">
          {mgr.nativeDiagnosticsError}
        </p>
      ) : mgr.nativeDiagnosticsLoading && !data ? (
        <p className="text-xs">
          {t("proxyStats.loading", "Reading native browser diagnostics…")}
        </p>
      ) : !data?.available ? (
        <p className="text-xs text-[var(--color-textMuted)]">
          {t(
            "proxyStats.unsupported",
            "Native browser diagnostics are unavailable in this build.",
          )}
        </p>
      ) : sessions.length === 0 ? (
        <p className="text-xs text-[var(--color-textMuted)]">
          {t(
            "proxyStats.empty",
            "No observable native browser sessions in this window.",
          )}
        </p>
      ) : (
        <>
          <div
            className="grid grid-cols-2 lg:grid-cols-4 gap-3"
            data-testid="proxy-stats-summary"
          >
            <Tile
              icon={Radio}
              label={t("proxyStats.tileRelays", "Relays listening")}
              value={`${totals.listening}/${totals.sessions}`}
              hint={
                totals.faulted > 0
                  ? t("proxyStats.faulted", "{{count}} faulted", {
                      count: totals.faulted,
                    })
                  : undefined
              }
              tone={totals.faulted > 0 ? "err" : "ok"}
            />
            <Tile
              icon={Waypoints}
              label={counterLabel.acceptedConnections}
              value={formatCount(totals.acceptedConnections)}
              tone="muted"
            />
            <Tile
              icon={ShieldCheck}
              label={counterLabel.authenticatedRequests}
              value={formatCount(totals.authenticatedRequests)}
              hint={t("proxyStats.challenges", "{{count}} challenges", {
                count: formatCount(totals.authenticationChallenges),
              })}
              tone="ok"
            />
            <Tile
              icon={AlertCircle}
              label={t("proxyStats.tileProblems", "Problems")}
              value={formatCount(totals.problems)}
              hint={
                failing
                  ? t("proxyStats.ofConnections", "{{pct}} of connections", {
                      pct: failing,
                    })
                  : undefined
              }
              tone={totals.problems > 0 ? "warn" : "muted"}
              testId="proxy-stats-problems"
            />
          </div>
          {totals.observed < totals.sessions && (
            <p className="text-[10px] text-[var(--color-textMuted)]">
              {t(
                "proxyStats.partial",
                "Totals cover {{observed}} of {{total}} sessions; the rest had no relay snapshot.",
                { observed: totals.observed, total: totals.sessions },
              )}
            </p>
          )}
          <section aria-label={t("proxyStats.sessions", "CEF sessions")}>
            <h4 className="text-xs font-medium text-[var(--color-textSecondary)] mb-2">
              {t("proxyStats.sessions", "CEF sessions")}
            </h4>
            <ul className="space-y-1.5">
              {sessions.map((s) => (
                <SessionRow key={s.identity.attemptId} session={s} t={t} />
              ))}
            </ul>
          </section>
        </>
      )}

      <LegacySection mgr={mgr} t={t} />
    </div>
  );
};
