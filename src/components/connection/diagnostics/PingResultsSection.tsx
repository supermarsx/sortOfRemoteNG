import PingGraph from "./PingGraph";
import PingStatsGrid from "./PingStatsGrid";
import { Activity } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DiagnosticsMgr } from "../../../hooks/connection/useConnectionDiagnostics";

const PingResultsSection = ({ mgr }: { mgr: DiagnosticsMgr }) => {
  const { t } = useTranslation();
  const {
    results,
    avgPingTime,
    pingSuccessRate,
    jitter,
    maxPing,
    minPing,
  } = mgr;

  return (
    <div className="bg-[var(--color-surfaceHover)]/50 border border-[var(--color-border)] rounded-lg p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-textSecondary)] mb-3 flex items-center gap-2">
        <Activity size={12} />
        {t("diagnostics.pingResults", "Ping Results")}
        {results.pings.length > 0 && (
          <span className="ml-auto text-[var(--color-textMuted)] font-normal normal-case">
            {results.pings.filter((p) => p.success).length}/
            {results.pings.length} OK
          </span>
        )}
      </h3>

      {results.pings.length >= 2 && (
        <>
          <PingGraph
            results={results}
            avgPingTime={avgPingTime}
            maxPing={maxPing}
            minPing={minPing}
          />
          <PingStatsGrid
            pingSuccessRate={pingSuccessRate}
            avgPingTime={avgPingTime}
            jitter={jitter}
            results={results}
          />
        </>
      )}

      <div className="flex gap-1.5">
        {results.pings.map((ping, i) => (
          <div
            key={i}
            className={`flex-1 p-2 rounded text-center text-xs font-medium ${
              ping.success
                ? "bg-green-500/15 text-green-600 dark:text-green-400 border border-green-500/30"
                : "bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30"
            }`}
          >
            {ping.success && ping.time_ms
              ? `${ping.time_ms}ms`
              : "Timeout"}
          </div>
        ))}
        {Array(Math.max(0, 10 - results.pings.length))
          .fill(0)
          .map((_, i) => (
            <div
              key={`empty-${i}`}
              className="flex-1 p-2 rounded text-center text-xs bg-[var(--color-surface)] text-[var(--color-textMuted)] border border-[var(--color-border)]"
            >
              -
            </div>
          ))}
      </div>
    </div>
  );
};

export default PingResultsSection;
