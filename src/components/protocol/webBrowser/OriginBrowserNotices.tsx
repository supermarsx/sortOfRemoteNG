import React from "react";
import { AlertTriangle, RotateCcw, X } from "lucide-react";
import type { useOriginBrowserNotices } from "../../../hooks/protocol/useOriginBrowserNotices";

/** In-flow toast rail: native child windows would paint over floating DOM toasts. */
export default function OriginBrowserNotices({
  notices,
}: {
  notices: ReturnType<typeof useOriginBrowserNotices>;
}) {
  if (!notices.notices.length && !notices.listenerFailed) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Browser notifications"
      className="flex shrink-0 min-w-0 flex-wrap justify-end gap-2 px-3 py-2"
    >
      {notices.listenerFailed && (
        <p className="sor-alert-warning text-sm">
          Browser notifications are unavailable for this attempt.
        </p>
      )}
      {notices.notices.map((notice) => (
        <div
          key={notice.id}
          className="sor-alert-warning flex min-w-0 max-w-xl items-start gap-2 rounded-lg shadow-sm text-sm text-[var(--color-text)]"
          aria-busy={notice.reloading}
        >
          <AlertTriangle
            size={16}
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-warning"
          />
          <div className="min-w-0 flex-1 space-y-2">
            <p>
              {notice.kind === "document-load-timeout"
                ? "The page took too long to load. Loading was stopped."
                : "Cookie retention failed. Sign-in won't be retained. Reopen the website to retry."}
            </p>
            {notice.reloadFailed && (
              <p>
                Reload was not accepted. Review the browser status and try
                again.
              </p>
            )}
            {notice.kind === "document-load-timeout" && (
              <button
                type="button"
                className="sor-btn sor-btn-secondary text-xs"
                disabled={!notices.canReload || notice.reloading}
                onClick={() => void notices.reload(notice.id)}
              >
                <RotateCcw size={14} aria-hidden="true" />
                {notice.reloading ? "Reloading…" : "Reload page"}
              </button>
            )}
          </div>
          <button
            type="button"
            className="sor-btn sor-icon-btn-sm shrink-0"
            aria-label="Dismiss browser notification"
            onClick={() => notices.dismiss(notice.id)}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
