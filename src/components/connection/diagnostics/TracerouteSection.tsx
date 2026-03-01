import { Router, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DiagnosticsMgr } from "../../../hooks/connection/useConnectionDiagnostics";

const TracerouteSection = ({ mgr }: { mgr: DiagnosticsMgr }) => {
  const { t } = useTranslation();
  const { results, isRunning } = mgr;

  return (
    <div className="bg-[var(--color-surfaceHover)]/50 border border-[var(--color-border)] rounded-lg p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-textSecondary)] mb-3 flex items-center gap-2">
        <Router size={12} />
        {t("diagnostics.traceroute", "Traceroute")}
        {results.traceroute.length > 0 && (
          <span className="ml-auto text-[var(--color-textMuted)] font-normal normal-case">
            {results.traceroute.length}{" "}
            {results.traceroute.length === 1
              ? t("diagnostics.hop", "hop")
              : t("diagnostics.hops", "hops")}
          </span>
        )}
      </h3>

      {results.traceroute.length > 0 ? (
        <div className="space-y-0.5 max-h-52 overflow-y-auto font-mono text-xs">
          {results.traceroute.map((hop, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 p-2 rounded ${
                hop.timeout
                  ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
                  : "bg-[var(--color-surface)] text-[var(--color-text)]"
              }`}
            >
              <span className="w-5 text-[var(--color-textMuted)] text-right">
                {hop.hop}
              </span>
              <span className="flex-1 truncate">
                {hop.timeout
                  ? "* * *"
                  : `${hop.hostname || hop.ip || "Unknown"}`}
              </span>
              {hop.ip && hop.ip !== hop.hostname && (
                <span className="text-[var(--color-textMuted)]">
                  ({hop.ip})
                </span>
              )}
              <span className="w-14 text-right text-[var(--color-textSecondary)]">
                {hop.time_ms ? `${hop.time_ms}ms` : "-"}
              </span>
            </div>
          ))}
        </div>
      ) : isRunning ? (
        <div className="flex items-center justify-center p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
          <Loader2
            size={20}
            className="text-[var(--color-textMuted)] animate-spin"
          />
          <span className="ml-2 text-[var(--color-textSecondary)]">
            {t("diagnostics.runningTraceroute", "Running traceroute...")}
          </span>
        </div>
      ) : (
        <div className="text-center text-[var(--color-textSecondary)] py-4">
          {t(
            "diagnostics.tracerouteUnavailable",
            "Traceroute not available or no results",
          )}
        </div>
      )}
    </div>
  );
};

export default TracerouteSection;
