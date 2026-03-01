import StatusIcon from "./StatusIcon";
import { Loader2, Tags, Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DiagnosticsMgr } from "../../../hooks/connection/useConnectionDiagnostics";

const DnsIpSection = ({ mgr }: { mgr: DiagnosticsMgr }) => {
  const { t } = useTranslation();
  const { results, isRunning } = mgr;

  return (
    <div className="bg-[var(--color-surfaceHover)]/50 border border-[var(--color-border)] rounded-lg p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-textSecondary)] mb-3 flex items-center gap-2">
        <Tags size={12} />
        {t("diagnostics.dnsIp", "DNS & IP Info")}
      </h3>

      {results.dnsResult ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
            <div className="text-[10px] uppercase text-[var(--color-textMuted)] mb-1">
              DNS Resolution
            </div>
            <div className="flex items-center gap-2">
              <StatusIcon
                status={results.dnsResult.success ? "success" : "failed"}
              />
              <span className="text-xs text-[var(--color-text)]">
                {results.dnsResult.success
                  ? results.dnsResult.resolved_ips.join(", ")
                  : results.dnsResult.error || "Failed"}
              </span>
            </div>
            {results.dnsResult.reverse_dns && (
              <div
                className="text-[10px] text-[var(--color-textMuted)] mt-1 truncate"
                title={results.dnsResult.reverse_dns}
              >
                rDNS: {results.dnsResult.reverse_dns}
              </div>
            )}
            <div className="text-[10px] text-[var(--color-textMuted)] mt-1">
              {results.dnsResult.resolution_time_ms}ms
            </div>
          </div>

          {results.ipClassification && (
            <div className="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
              <div className="text-[10px] uppercase text-[var(--color-textMuted)] mb-1">
                IP Classification
              </div>
              <div className="text-xs text-[var(--color-text)] font-medium">
                {results.ipClassification.ip_type}
                {results.ipClassification.ip_class &&
                  ` (${results.ipClassification.ip_class})`}
              </div>
              <div className="text-[10px] text-[var(--color-textMuted)] mt-1">
                {results.ipClassification.ip}
                {results.ipClassification.is_ipv6 && " (IPv6)"}
              </div>
              {results.ipClassification.network_info && (
                <div
                  className="text-[10px] text-[var(--color-textMuted)] truncate"
                  title={results.ipClassification.network_info}
                >
                  {results.ipClassification.network_info}
                </div>
              )}
            </div>
          )}
        </div>
      ) : isRunning ? (
        <div className="flex items-center justify-center p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
          <Loader2
            size={20}
            className="text-[var(--color-textMuted)] animate-spin"
          />
        </div>
      ) : (
        <div className="text-center text-[var(--color-textSecondary)] py-4">
          {t(
            "diagnostics.dnsUnavailable",
            "DNS information not available",
          )}
        </div>
      )}
    </div>
  );
};

export default DnsIpSection;
