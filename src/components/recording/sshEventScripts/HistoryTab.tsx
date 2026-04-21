import React, { useState, useEffect } from "react";
import type { HistoryTabProps } from "./types";

export const HistoryTab: React.FC<HistoryTabProps> = ({
  history,
  historyTotal,
  queryHistory,
  clearHistory,
}) => {
  const [page, setPage] = useState(0);
  const limit = 50;

  useEffect(() => {
    void queryHistory({ offset: page * limit, limit });
  }, [page, queryHistory, limit]);

  const statusColor = (s: string) => {
    switch (s) {
      case "success":
        return "text-success";
      case "failed":
        return "text-error";
      case "timeout":
        return "text-warning";
      case "cancelled":
        return "text-text-muted";
      case "running":
        return "text-primary";
      default:
        return "text-text-secondary";
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-[var(--color-text)]">
          Execution History ({historyTotal})
        </h3>
        <button
          onClick={() => void clearHistory()}
          className="rounded-lg border border-theme-border px-3 py-1.5 text-sm text-text-secondary hover:bg-surfaceHover"
        >
          Clear
        </button>
      </div>

      {history.length === 0 ? (
        <div className="mt-8 text-center text-text-secondary">
          <p className="text-3xl">📊</p>
          <p className="mt-2 text-sm">No execution history yet.</p>
        </div>
      ) : (
        <div className="mt-4">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-theme-border text-xs text-text-muted">
              <tr>
                <th className="pb-2">Script</th>
                <th className="pb-2">Trigger</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Duration</th>
                <th className="pb-2">Exit</th>
                <th className="pb-2">Started</th>
              </tr>
            </thead>
            <tbody>
              {history.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-theme-border hover:bg-surfaceHover/50"
                >
                  <td className="py-2 text-[var(--color-text)]">{r.scriptName}</td>
                  <td className="py-2 text-text-muted">{r.triggerType}</td>
                  <td className={`py-2 ${statusColor(r.status)}`}>
                    {r.status}
                  </td>
                  <td className="py-2 text-text-muted">{r.durationMs}ms</td>
                  <td className="py-2 text-text-muted">
                    {r.exitCode ?? "—"}
                  </td>
                  <td className="py-2 text-text-secondary">
                    {new Date(r.startedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          {historyTotal > limit && (
            <div className="mt-4 flex items-center gap-3 text-sm text-text-muted">
              <button
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
                className="rounded px-2 py-1 hover:bg-surfaceHover disabled:opacity-30"
              >
                ← Prev
              </button>
              <span>
                Page {page + 1} of {Math.ceil(historyTotal / limit)}
              </span>
              <button
                disabled={(page + 1) * limit >= historyTotal}
                onClick={() => setPage((p) => p + 1)}
                className="rounded px-2 py-1 hover:bg-surfaceHover disabled:opacity-30"
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
