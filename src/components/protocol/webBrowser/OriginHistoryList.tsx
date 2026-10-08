import React from "react";
import type { OriginPageMenuController } from "../../../hooks/protocol/useOriginPageMenu";

export default function OriginHistoryList({
  controller: c,
  direction,
  onJump,
}: {
  controller: OriginPageMenuController;
  direction?: "back" | "forward";
  onJump: (index: number) => void;
}) {
  const current = c.history?.currentIndex ?? -1;
  let entries =
    c.history?.entries.filter(
      (e) =>
        !direction ||
        (direction === "back" ? e.index < current : e.index > current),
    ) ?? [];
  if (direction === "back") entries = [...entries].reverse();
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 px-3 pt-2">
        <span className="text-xs text-[var(--color-textSecondary)]">
          {direction ? `Jump ${direction} to a page` : "This native tab only"}
        </span>
        <button
          type="button"
          className="sor-btn sor-btn-secondary text-xs"
          disabled={c.loading || c.busy}
          onClick={() => void c.refreshHistory()}
        >
          Refresh history
        </button>
      </div>
      {c.loading ? (
        <p role="status" className="px-3 py-2 text-sm">
          Loading history…
        </p>
      ) : (
        !entries.length && (
          <p role="status" className="px-3 py-2 text-sm">
            No history entries available.
          </p>
        )
      )}
      {c.error && (
        <p role="alert" className="px-3 text-sm">
          {c.error}
        </p>
      )}
      <div className="max-h-[45vh] overflow-y-auto">
        {entries.map((entry) => (
          <button
            key={entry.index}
            type="button"
            className="sor-menu-item w-full gap-2 text-left"
            disabled={c.busy || entry.index === current}
            aria-current={entry.index === current ? "page" : undefined}
            onClick={() => onJump(entry.index)}
          >
            <span className="shrink-0 tabular-nums text-xs">
              {entry.index === current
                ? "Current"
                : Math.abs(entry.index - current)}
            </span>
            <span className="min-w-0">
              <span className="block truncate">
                {entry.title || entry.url || "Untitled page"}
              </span>
              {entry.title && (
                <span
                  dir="ltr"
                  className="block truncate text-xs text-[var(--color-textSecondary)]"
                >
                  {entry.url}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
