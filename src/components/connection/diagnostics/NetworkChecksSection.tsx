import StatusIcon from "./StatusIcon";
import { Globe, Network } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DiagnosticsMgr } from "../../../hooks/connection/useConnectionDiagnostics";

const NetworkChecksSection = ({ mgr }: { mgr: DiagnosticsMgr }) => {
  const { t } = useTranslation();
  const { results } = mgr;

  return (
    <div className="bg-[var(--color-surfaceHover)]/50 border border-[var(--color-border)] rounded-lg p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-textSecondary)] mb-3 flex items-center gap-2">
        <Globe size={12} />
        {t("diagnostics.networkChecks", "Network Checks")}
      </h3>
      <div className="grid grid-cols-3 gap-3">
        {(
          [
            ["internetCheck", "Internet"],
            ["gatewayCheck", "Gateway"],
            ["subnetCheck", "Target Host"],
          ] as const
        ).map(([key, label]) => (
          <div
            key={key}
            className="flex items-center gap-3 p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]"
          >
            <StatusIcon status={results[key]} />
            <div>
              <div className="text-xs font-medium text-[var(--color-text)]">
                {t(`diagnostics.${key}`, label)}
              </div>
              <div className="text-[10px] text-[var(--color-textMuted)] capitalize">
                {results[key]}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default NetworkChecksSection;
