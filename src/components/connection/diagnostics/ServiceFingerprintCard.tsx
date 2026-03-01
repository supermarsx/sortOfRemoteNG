import { Loader2, Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DiagnosticResults } from "../../../types/diagnostics";

const ServiceFingerprintCard = ({
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
        {t("diagnostics.serviceFingerprint", "Service Fingerprint")}
      </div>
      {results.serviceFingerprint ? (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Server size={12} className="text-[var(--color-accent)]" />
            <span className="text-xs font-medium text-[var(--color-text)]">
              {results.serviceFingerprint.protocol_detected ||
                results.serviceFingerprint.service}
            </span>
          </div>
          {results.serviceFingerprint.version && (
            <div
              className="text-[10px] text-[var(--color-textSecondary)] truncate"
              title={results.serviceFingerprint.version}
            >
              {results.serviceFingerprint.version}
            </div>
          )}
          {results.serviceFingerprint.response_preview && (
            <code className="text-[9px] font-mono text-[var(--color-textMuted)] block truncate bg-[var(--color-surfaceHover)] px-1 py-0.5 rounded">
              {results.serviceFingerprint.response_preview}
            </code>
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

export default ServiceFingerprintCard;
