import { CheckCircle, XCircle, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DiagnosticResults } from "../../../types/diagnostics";

const IcmpStatusCard = ({
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
        {t("diagnostics.icmpStatus", "ICMP Status")}
      </div>
      {results.icmpBlockade ? (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {results.icmpBlockade.likely_blocked ? (
              <XCircle size={12} className="text-yellow-500" />
            ) : results.icmpBlockade.icmp_allowed ? (
              <CheckCircle size={12} className="text-green-500" />
            ) : (
              <XCircle size={12} className="text-red-500" />
            )}
            <span
              className={`text-xs ${
                results.icmpBlockade.likely_blocked
                  ? "text-yellow-500"
                  : results.icmpBlockade.icmp_allowed
                    ? "text-green-500"
                    : "text-red-500"
              }`}
            >
              {results.icmpBlockade.likely_blocked
                ? t("diagnostics.icmpBlocked", "ICMP Blocked")
                : results.icmpBlockade.icmp_allowed
                  ? t("diagnostics.icmpAllowed", "ICMP Allowed")
                  : t("diagnostics.unreachable", "Unreachable")}
            </span>
          </div>
          <div
            className="text-[10px] text-[var(--color-textMuted)] truncate"
            title={results.icmpBlockade.diagnosis}
          >
            {results.icmpBlockade.diagnosis}
          </div>
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

export default IcmpStatusCard;
