import React from "react";
import { AlertTriangle, RotateCcw, Square, X } from "lucide-react";
import type { useOriginBrowserNotices } from "../../../hooks/protocol/useOriginBrowserNotices";
import { nativeBrowserOcclusion } from "../../../hooks/protocol/useOriginBrowserOverlays";

/**
 * Floating toasts. They take no layout space (the native viewport never
 * resizes) and each toast opts into native occlusion, so the sampler cuts its
 * rectangle out of the native child window instead of it painting over them.
 * Render inside a fixed, pointer-events-none stack; see OriginConnectionBrowser.
 */
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
      className="flex min-w-0 flex-col items-end gap-2"
    >
      {notices.listenerFailed && (
        <p
          className="sor-alert-warning pointer-events-auto text-sm shadow-lg"
          {...nativeBrowserOcclusion()}
        >
          Browser notifications are unavailable for this attempt.
        </p>
      )}
      {notices.notices.map((notice) => (
        <div
          key={notice.id}
          className="sor-alert-warning pointer-events-auto flex min-w-0 max-w-xl items-start gap-2 rounded-lg shadow-lg text-sm text-[var(--color-text)]"
          aria-busy={notice.reloading || notice.stopping}
          {...nativeBrowserOcclusion()}
        >
          <AlertTriangle
            size={16}
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-warning"
          />
          <div className="min-w-0 flex-1 space-y-2">
            <p>
              {notice.kind === "document-slow-load"
                ? "This page is taking a long time to load. It is still loading; you can stop it or keep waiting."
                : "Cookie retention failed. Sign-in won't be retained. Reopen the website to retry."}
            </p>
            {notice.reloadFailed && (
              <p>
                Reload was not accepted. Review the browser status and try
                again.
              </p>
            )}
            {notice.stopFailed && (
              <p>
                Stop was not accepted. Review the browser status and try again.
              </p>
            )}
            {notice.kind === "document-slow-load" && (
              <div className="flex flex-wrap gap-2">
                {notices.canStop && (
                  <button
                    type="button"
                    className="sor-btn sor-btn-secondary text-xs"
                    disabled={notice.stopping}
                    onClick={() => void notices.stop(notice.id)}
                  >
                    <Square size={14} aria-hidden="true" />
                    {notice.stopping ? "Stopping…" : "Stop loading"}
                  </button>
                )}
                <button
                  type="button"
                  className="sor-btn sor-btn-secondary text-xs"
                  disabled={!notices.canReload || notice.reloading}
                  onClick={() => void notices.reload(notice.id)}
                >
                  <RotateCcw size={14} aria-hidden="true" />
                  {notice.reloading ? "Reloading…" : "Reload page"}
                </button>
              </div>
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
