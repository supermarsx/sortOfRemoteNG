import React from "react";
import type { TimersTabProps } from "./types";

export const TimersTab: React.FC<TimersTabProps> = ({ timers }) => (
  <div className="flex-1 overflow-y-auto p-6">
    <h3 className="text-lg font-semibold text-white">
      Active Timers ({timers.length})
    </h3>
    <p className="mt-1 text-sm text-text-muted">
      Interval, cron, and scheduled timers across all sessions.
    </p>

    {timers.length === 0 ? (
      <div className="mt-8 text-center text-text-secondary">
        <p className="text-3xl">⏱️</p>
        <p className="mt-2 text-sm">
          No active timers. Connect an SSH session with interval/cron scripts to
          see timers here.
        </p>
      </div>
    ) : (
      <div className="mt-4 space-y-2">
        {timers.map((t, i) => (
          <div
            key={i}
            className="flex items-center justify-between rounded-lg border border-theme-border bg-surface px-4 py-3"
          >
            <div>
              <span className="font-medium text-white">{t.scriptName}</span>
              <div className="mt-1 flex gap-2 text-xs text-text-muted">
                <span>Session: {t.sessionId}</span>
                <span>·</span>
                <span>Trigger: {t.triggerType}</span>
                {t.intervalMs && <span>· Every {t.intervalMs}ms</span>}
              </div>
            </div>
            <div className="text-right text-xs text-text-muted">
              {t.nextRunAt && (
                <div>
                  Next: {new Date(t.nextRunAt).toLocaleTimeString()}
                </div>
              )}
              <span
                className={
                  t.paused ? "text-warning" : "text-success"
                }
              >
                {t.paused ? "⏸ Paused" : "▶ Running"}
              </span>
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
);
