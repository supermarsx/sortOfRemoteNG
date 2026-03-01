import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DiagnosticResults } from "../../../types/diagnostics";

const TcpTimingCard = ({
  results,
  isRunning,
}: {
  results: DiagnosticResults;
  isRunning: boolean;
}) => {
  const { t } = useTranslation();

  return (
    <div className="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
      <div className="text-[10px] uppercase text-[var(--color-textMuted)] mb-1.5">
        {t("diagnostics.tcpTiming", "TCP Timing")}
      </div>
      {results.tcpTiming ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--color-textSecondary)]">
              Connect
            </span>
            <span
              className={`text-xs font-medium ${
                results.tcpTiming.slow_connection
                  ? "text-yellow-500"
                  : "text-green-500"
              }`}
            >
              {results.tcpTiming.connect_time_ms}ms
            </span>
          </div>
          {results.tcpTiming.slow_connection && (
            <div className="text-[10px] text-yellow-500">
              ⚠ {t("diagnostics.slowConnection", "Slow connection detected")}
            </div>
          )}
          {!results.tcpTiming.success && results.tcpTiming.error && (
            <div
              className="text-[10px] text-red-500 truncate"
              title={results.tcpTiming.error}
            >
              {results.tcpTiming.error}
            </div>
          )}
        </div>
      ) : isRunning ? (
        <Loader2
          size={14}
          className="text-[var(--color-textMuted)] animate-spin"
        />
      ) : (
        <span className="text-xs text-[var(--color-textMuted)]">-</span>
      )}
    </div>
  );
};

export default TcpTimingCard;
