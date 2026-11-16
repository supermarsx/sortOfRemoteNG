import React from "react";
import { Plug, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Connection } from "../../../types/connection/connection";
import type { LiveSessionDescriptor } from "../../../services/session/reconcileWorkspace";
import { resolveOrphanConnection } from "../../../services/session/orphanSessions";

export interface OrphanedLiveSessionsProps {
  orphans: readonly LiveSessionDescriptor[];
  connections: readonly Connection[];
  error?: string | null;
  onAdopt: (descriptor: LiveSessionDescriptor, connection: Connection) => void;
  onClose: (descriptor: LiveSessionDescriptor) => void | Promise<void>;
}

/**
 * Live backend sessions no tab owns. Adopt is offered only when a saved
 * connection resolves unambiguously; Close is always offered. Renders nothing
 * when there are no orphans.
 */
export const OrphanedLiveSessions: React.FC<OrphanedLiveSessionsProps> = ({
  orphans,
  connections,
  error,
  onAdopt,
  onClose,
}) => {
  const { t } = useTranslation();
  if (orphans.length === 0) return null;

  return (
    <section
      className="border-b border-[var(--color-border)] px-3 py-2 text-xs"
      aria-label={t("session.orphans.title", "Orphaned (live)")}
      data-testid="orphaned-live-sessions"
    >
      <h3 className="font-semibold text-[var(--color-textSecondary)]">
        {t("session.orphans.title", "Orphaned (live)")}
        <span className="ml-2 font-normal text-[var(--color-textMuted)]">
          {t(
            "session.orphans.description",
            "Running sessions with no open tab. Adopt one to reopen it, or close it.",
          )}
        </span>
      </h3>
      {error && (
        <p className="mt-1 text-error" role="alert">
          {error}
        </p>
      )}
      <ul className="mt-1 space-y-1">
        {orphans.map((orphan) => {
          const connection = resolveOrphanConnection(orphan, connections);
          const label = orphan.title ?? orphan.host ?? orphan.backendSessionId;
          return (
            <li
              key={`${orphan.protocol}:${orphan.backendSessionId}`}
              className="flex items-center gap-2"
              data-testid="orphaned-live-row"
            >
              <span className="rounded border border-[var(--color-border)] px-1 uppercase">
                {orphan.protocol}
              </span>
              <span className="min-w-0 flex-1 truncate" title={label}>
                {label}
              </span>
              {orphan.orphan?.reapInSecs != null && (
                <span className="text-[var(--color-textMuted)]">
                  {String(
                    t("session.orphans.reapIn", "closes in {{seconds}}s"),
                  ).replace("{{seconds}}", String(orphan.orphan.reapInSecs))}
                </span>
              )}
              {connection && (
                <button
                  type="button"
                  className="sor-icon-btn-xs"
                  onClick={() => onAdopt(orphan, connection)}
                  aria-label={t("session.orphans.adopt", "Adopt")}
                  title={t("session.orphans.adopt", "Adopt")}
                  data-testid="orphaned-live-adopt"
                >
                  <Plug size={12} aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                className="sor-icon-btn-xs text-error hover:text-error"
                onClick={() => void onClose(orphan)}
                aria-label={t("session.orphans.close", "Close")}
                title={t("session.orphans.close", "Close")}
                data-testid="orphaned-live-close"
              >
                <X size={12} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default OrphanedLiveSessions;
