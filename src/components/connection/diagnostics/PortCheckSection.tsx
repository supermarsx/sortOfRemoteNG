import StatusIcon from "./StatusIcon";
import { Network, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Connection } from "../../../types/connection";
import { DiagnosticsMgr } from "../../../hooks/connection/useConnectionDiagnostics";

const PortCheckSection = ({
  mgr,
  connection,
}: {
  mgr: DiagnosticsMgr;
  connection: Connection;
}) => {
  const { t } = useTranslation();
  const { results, isRunning } = mgr;

  return (
    <div className="bg-[var(--color-surfaceHover)]/50 border border-[var(--color-border)] rounded-lg p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-textSecondary)] mb-3 flex items-center gap-2">
        <Network size={12} />
        {t("diagnostics.portCheck", "Port Check")}
      </h3>

      {results.portCheck ? (
        <div
          className={`p-4 rounded-lg ${
            results.portCheck.open
              ? "bg-green-500/10 border border-green-500/30"
              : "bg-red-500/10 border border-red-500/30"
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-base font-medium text-[var(--color-text)]">
                {t("diagnostics.port", "Port")} {results.portCheck.port} (
                {connection.protocol.toUpperCase()})
              </div>
              <div className="text-sm text-[var(--color-textSecondary)]">
                {results.portCheck.open
                  ? t(
                      "diagnostics.portOpen",
                      "Port is open and accepting connections",
                    )
                  : t(
                      "diagnostics.portClosed",
                      "Port is closed or filtered",
                    )}
              </div>
            </div>
            <StatusIcon
              status={results.portCheck.open ? "success" : "failed"}
            />
          </div>
          {results.portCheck.banner && (
            <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
              <div className="text-[10px] uppercase text-[var(--color-textMuted)] mb-1">
                Banner / Fingerprint
              </div>
              <code className="text-xs font-mono bg-[var(--color-surface)] px-2 py-1 rounded text-[var(--color-text)] block truncate">
                {results.portCheck.banner}
              </code>
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-center p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
          <Loader2
            size={20}
            className="text-[var(--color-textMuted)] animate-spin"
          />
        </div>
      )}
    </div>
  );
};

export default PortCheckSection;
