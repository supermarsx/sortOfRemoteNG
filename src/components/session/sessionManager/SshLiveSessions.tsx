import React, { useEffect, useMemo, useState } from "react";
import {
  Copy,
  Crosshair,
  PlugZap,
  RefreshCw,
  StopCircle,
  Terminal,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../ui/display";
import type { UnifiedSessionRow } from "../../../hooks/session/useUnifiedSessionManager";
import {
  UNKNOWN_VALUE,
  formatAbsoluteTime,
  formatCount,
  formatDuration,
  formatRelativeTime,
} from "./browserSessionList";

export interface SshLiveSessionsProps {
  /** Unified rows whose source is "ssh" (native sessions, already enriched). */
  rows: readonly UnifiedSessionRow[];
  searchTerm: string;
  isActive: boolean;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  /** Switch to the open tab that owns this SSH session. */
  onFocusSession?: (frontendSessionId: string) => void;
  onDisconnect?: (row: UnifiedSessionRow) => boolean | void | Promise<unknown>;
  onReattach?: (nativeId: string, connectionId?: string) => void;
  /** Clock override (tests). When set the internal ticker is disabled. */
  now?: number;
}

type LiveState = "connected" | "detached" | "disconnected";

function liveState(row: UnifiedSessionRow): LiveState {
  if (row.status === "disconnected") return "disconnected";
  if (row.status === "detached") return "detached";
  return "connected";
}

const STATE_TONE: Record<LiveState, string> = {
  connected: "border-success/30 bg-success/15 text-success",
  detached: "border-warning/30 bg-warning/15 text-warning",
  disconnected:
    "border-[var(--color-border)] bg-[var(--color-textMuted)]/10 text-[var(--color-textMuted)]",
};

function formatBytes(value?: number): string {
  if (value == null || !Number.isFinite(value) || value < 0)
    return UNKNOWN_VALUE;
  if (value < 1024) return `${formatCount(value)} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unit]}`;
}

/** Live list of native SSH sessions, mirroring the browser "Live sessions" view. */
export const SshLiveSessions: React.FC<SshLiveSessionsProps> = ({
  rows,
  searchTerm,
  isActive,
  isRefreshing = false,
  onRefresh,
  onFocusSession,
  onDisconnect,
  onReattach,
  now: nowOverride,
}) => {
  const { t } = useTranslation();
  const tt = (
    key: string,
    fallback: string,
    vars: Record<string, string | number>,
  ) =>
    String(t(key, fallback)).replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
      String(vars[name] ?? ""),
    );
  const [tick, setTick] = useState(() => Date.now());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Keep connected durations ticking while the view is on screen.
  useEffect(() => {
    if (!isActive || nowOverride !== undefined) return;
    const timer = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isActive, nowOverride]);
  const now = nowOverride ?? tick;

  const visible = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase();
    return rows
      .filter(
        (row) =>
          !query ||
          [
            row.title,
            row.subtitle,
            row.hostname,
            row.username,
            row.nativeId,
            liveState(row),
          ]
            .filter(Boolean)
            .join(" ")
            .toLocaleLowerCase()
            .includes(query),
      )
      .sort(
        (a, b) =>
          (b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0) ||
          a.nativeId.localeCompare(b.nativeId),
      );
  }, [rows, searchTerm]);

  const stateLabel = (state: LiveState) =>
    t(
      `session.sshLive.state.${state}`,
      {
        connected: "Connected",
        detached: "Detached",
        disconnected: "Disconnected",
      }[state],
    );

  const copyDetails = async (row: UnifiedSessionRow) => {
    const lines = [
      `${t("session.sshLive.copy.session", "Session")}: ${row.title}`,
      `${t("session.sshLive.copy.target", "Target")}: ${row.subtitle}`,
      `${t("session.sshLive.copy.state", "State")}: ${stateLabel(liveState(row))}`,
      `${t("session.sshLive.copy.started", "Started")}: ${formatAbsoluteTime(row.startedAt)}`,
      `${t("session.sshLive.copy.lastActivity", "Last activity")}: ${formatAbsoluteTime(row.lastActivity)}`,
      `${t("session.sshLive.copy.id", "Session ID")}: ${row.nativeId}`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopiedId(row.nativeId);
    } catch {
      setCopiedId(null);
    }
  };

  return (
    <div data-testid="ssh-live-sessions">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-textSecondary)]">
        <span aria-live="polite" data-testid="ssh-live-count">
          {visible.length === rows.length
            ? tt("session.sshLive.count", "{{count}} SSH session(s)", {
                count: rows.length,
              })
            : tt(
                "session.sshLive.countFiltered",
                "{{shown}} of {{total}} SSH sessions",
                { shown: visible.length, total: rows.length },
              )}
        </span>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={!isActive || isRefreshing}
            className="sor-option-chip text-xs disabled:opacity-40"
            data-testid="ssh-live-refresh"
          >
            <RefreshCw size={14} aria-hidden="true" />
            {t("session.sshLive.refresh", "Refresh sessions")}
          </button>
        )}
      </div>
      {visible.length > 0 && (
        <table
          className="w-full min-w-[860px] border-collapse text-left text-xs"
          data-testid="ssh-live-table"
        >
          <caption className="sr-only">
            {t("session.sshLive.caption", "Live SSH sessions")}
          </caption>
          <thead className="sticky top-0 z-10 bg-[var(--color-backgroundSecondary)] text-[var(--color-textSecondary)]">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("session.sshLive.columns.target", "Host / user")}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("session.sshLive.columns.state", "State")}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("session.sshLive.columns.duration", "Connected for")}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("session.sshLive.columns.lastActivity", "Last activity")}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("session.sshLive.columns.data", "Data transferred")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t("session.sshLive.columns.actions", "Actions")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {visible.map((row) => {
              const state = liveState(row);
              const frontendId = row.frontendSession?.id;
              const startedMs = row.startedAt?.getTime();
              const durationSeconds =
                state !== "disconnected" && startedMs !== undefined
                  ? Math.max(0, (now - startedMs) / 1000)
                  : undefined;
              return (
                <tr
                  key={row.uid}
                  className="bg-[var(--color-background)]/40 hover:bg-[var(--color-surfaceHover)]/50"
                  data-testid={`ssh-live-row-${row.nativeId}`}
                >
                  <th scope="row" className="max-w-80 px-3 py-2.5 font-normal">
                    <div className="flex min-w-0 items-center gap-2">
                      <Terminal
                        size={14}
                        className="flex-shrink-0 text-info"
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <div
                          className="truncate font-medium text-[var(--color-text)]"
                          title={row.title}
                        >
                          {row.title}
                        </div>
                        <div
                          className="truncate font-mono text-[10px] text-[var(--color-textMuted)]"
                          title={row.subtitle}
                        >
                          {row.subtitle}
                        </div>
                      </div>
                    </div>
                  </th>
                  <td className="px-3 py-2.5">
                    <span
                      className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${STATE_TONE[state]}`}
                    >
                      {stateLabel(state)}
                    </span>
                  </td>
                  <td
                    className="whitespace-nowrap px-3 py-2.5 text-[var(--color-textSecondary)]"
                    title={formatAbsoluteTime(row.startedAt)}
                    data-testid={`ssh-live-duration-${row.nativeId}`}
                  >
                    {formatDuration(durationSeconds)}
                  </td>
                  <td
                    className="whitespace-nowrap px-3 py-2.5 text-[var(--color-textSecondary)]"
                    title={formatAbsoluteTime(row.lastActivity)}
                  >
                    {formatRelativeTime(row.lastActivity, now)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-[var(--color-textSecondary)]">
                    {formatBytes(row.metrics?.dataTransferred)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-0.5">
                      {frontendId && onFocusSession && state !== "detached" && (
                        <button
                          type="button"
                          onClick={() => onFocusSession(frontendId)}
                          className="sor-icon-btn-xs"
                          title={t("session.sshLive.focus", "Switch to tab")}
                          aria-label={tt(
                            "session.sshLive.focusLabel",
                            "Switch to {{name}}",
                            { name: row.title },
                          )}
                        >
                          <Crosshair size={14} aria-hidden="true" />
                        </button>
                      )}
                      {state === "detached" && onReattach && (
                        <button
                          type="button"
                          onClick={() =>
                            onReattach(row.nativeId, row.connectionId)
                          }
                          disabled={Boolean(row.reattachUnavailable)}
                          className="sor-icon-btn-xs"
                          title={
                            row.reattachUnavailable ??
                            t(
                              "session.sshLive.reattach",
                              "Reattach SSH session",
                            )
                          }
                          aria-label={tt(
                            "session.sshLive.reattachLabel",
                            "Reattach {{name}}",
                            { name: row.title },
                          )}
                        >
                          <PlugZap size={14} aria-hidden="true" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void copyDetails(row)}
                        className="sor-icon-btn-xs"
                        title={
                          copiedId === row.nativeId
                            ? t("session.sshLive.copied", "Copied")
                            : t("session.sshLive.copy.action", "Copy details")
                        }
                        aria-label={tt(
                          "session.sshLive.copyLabel",
                          "Copy details for {{name}}",
                          { name: row.title },
                        )}
                      >
                        <Copy size={14} aria-hidden="true" />
                      </button>
                      {onDisconnect && state !== "disconnected" && (
                        <button
                          type="button"
                          onClick={() => void onDisconnect(row)}
                          className="sor-icon-btn-xs text-error hover:text-error"
                          title={t(
                            "session.sshLive.disconnect",
                            "Disconnect SSH session",
                          )}
                          aria-label={tt(
                            "session.sshLive.disconnectLabel",
                            "Disconnect {{name}}",
                            { name: row.title },
                          )}
                        >
                          <StopCircle size={14} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {visible.length === 0 && (
        <div className="flex items-center justify-center py-14">
          <EmptyState
            icon={Terminal}
            message={
              rows.length === 0
                ? t("session.sshLive.empty", "No live SSH sessions")
                : t("session.sshLive.noMatch", "No matching SSH sessions")
            }
            hint={
              rows.length === 0
                ? t(
                    "session.sshLive.emptyHint",
                    "Open an SSH connection to see it here.",
                  )
                : t(
                    "session.sshLive.noMatchHint",
                    "Adjust the search to see more sessions.",
                  )
            }
          />
        </div>
      )}
    </div>
  );
};

export default SshLiveSessions;
