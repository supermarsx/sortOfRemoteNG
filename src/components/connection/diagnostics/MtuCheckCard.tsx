import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DiagnosticResults } from "../../../types/diagnostics";

const MtuCheckCard = ({
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
        {t("diagnostics.mtuCheck", "MTU Check")}
      </div>
      {results.mtuCheck ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--color-textSecondary)]">
              Path MTU
            </span>
            <span className="text-xs font-medium text-[var(--color-text)]">
              {results.mtuCheck.path_mtu
                ? `${results.mtuCheck.path_mtu}`
                : "Unknown"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--color-textSecondary)]">
              Recommended
            </span>
            <span className="text-xs font-medium text-[var(--color-text)]">
              {results.mtuCheck.recommended_mtu}
            </span>
          </div>
          {results.mtuCheck.fragmentation_needed && (
            <div className="text-[10px] text-yellow-500">
              ⚠{" "}
              {t(
                "diagnostics.fragmentationNeeded",
                "Fragmentation detected",
              )}
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

export default MtuCheckCard;
