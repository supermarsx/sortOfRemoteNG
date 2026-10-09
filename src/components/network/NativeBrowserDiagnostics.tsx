import React from "react";
import type { useInternalProxyManager } from "../../hooks/network/useInternalProxyManager";
import { nativeProxyCounters } from "../../types/network/nativeBrowserDiagnostics";

type Manager = Pick<
  ReturnType<typeof useInternalProxyManager>,
  "nativeDiagnostics" | "nativeDiagnosticsError" | "nativeDiagnosticsLoading"
>;

/** Live observations only. The Session Manager owns the separate journal view. */
export const NativeBrowserDiagnostics: React.FC<{
  mgr: Manager;
  mode?: "proxy" | "sessions";
}> = ({ mgr, mode = "proxy" }) => {
  const data = mgr.nativeDiagnostics;
  const heading =
    mode === "sessions"
      ? "Native browser sessions"
      : "Native CEF proxy diagnostics";
  return (
    <section aria-label={heading} className="sor-surface-card p-4 space-y-3">
      <h3 className="text-sm font-medium">{heading}</h3>
      <p className="text-xs text-[var(--color-textSecondary)]">
        Live sessions owned by this window only. Closed or revoked sessions are
        omitted; historical failures are in Browser sessions → Startup journal.
        URLs and credentials are never included here.
      </p>
      {mode === "proxy" && (
        <p className="text-xs text-[var(--color-textSecondary)]">
          These are private relay counters, including diagnostic probes—not HTTP
          page requests or status codes. HTTPS tunnels do not provide a per-URL
          request log. Counters are best-effort snapshots, not website health
          checks.
        </p>
      )}
      {mgr.nativeDiagnosticsError ? (
        <p role="alert" className="text-xs text-error">
          {mgr.nativeDiagnosticsError}
        </p>
      ) : mgr.nativeDiagnosticsLoading ? (
        <p className="text-xs">Reading native browser diagnostics…</p>
      ) : !data?.available ? (
        <p className="text-xs text-[var(--color-textMuted)]">
          Native browser diagnostics are unavailable in this build.
        </p>
      ) : data.sessions.length === 0 ? (
        <p className="text-xs text-[var(--color-textMuted)]">
          No observable native browser sessions in this window.
        </p>
      ) : (
        <ul className="space-y-3">
          {data.sessions.map((session) => (
            <li
              key={session.identity.attemptId}
              className="border-t border-[var(--color-border)] pt-3 space-y-2"
            >
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt>Session</dt>
                <dd className="font-mono break-all">
                  {session.identity.sessionId}
                </dd>
                <dt>Connection</dt>
                <dd className="font-mono break-all">
                  {session.identity.connectionId}
                </dd>
                <dt>Attempt</dt>
                <dd className="font-mono break-all">
                  {session.identity.attemptId}
                </dd>
                <dt>Browser state</dt>
                <dd>{session.phase ?? "Snapshot unavailable"}</dd>
                {session.failureReason && (
                  <>
                    <dt>Failure reason</dt>
                    <dd>{session.failureReason}</dd>
                  </>
                )}
                <dt>Relay state</dt>
                <dd>{session.proxy?.state ?? "Snapshot unavailable"}</dd>
              </dl>
              {session.proxy ? (
                <dl className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                  {nativeProxyCounters.map(([field, label]) => (
                    <div
                      key={field}
                      className="rounded bg-[var(--color-surface)] p-2"
                    >
                      <dt className="text-[var(--color-textSecondary)]">
                        {label}
                      </dt>
                      <dd className="font-mono mt-1">
                        {session.proxy![field]}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-xs text-[var(--color-textMuted)]">
                  Relay snapshot unavailable; no zero activity is inferred.
                  Refresh to retry.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
