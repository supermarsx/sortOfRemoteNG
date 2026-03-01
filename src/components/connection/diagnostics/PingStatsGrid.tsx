import { useTranslation } from "react-i18next";
import { DiagnosticResults } from "../../../types/diagnostics";

const PingStatsGrid = ({
  pingSuccessRate,
  avgPingTime,
  jitter,
  results,
}: {
  pingSuccessRate: number;
  avgPingTime: number;
  jitter: number;
  results: DiagnosticResults;
}) => {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
      {[
        {
          value: `${pingSuccessRate.toFixed(0)}%`,
          label: t("diagnostics.successRate", "Success Rate"),
        },
        {
          value: avgPingTime > 0 ? `${avgPingTime.toFixed(0)}ms` : "-",
          label: t("diagnostics.avgLatency", "Avg Latency"),
        },
        {
          value: jitter > 0 ? `±${jitter.toFixed(0)}ms` : "-",
          label: t("diagnostics.jitter", "Jitter"),
        },
        {
          value: String(results.pings.filter((p) => p.success).length),
          label: t("diagnostics.successful", "Successful"),
          color: "text-green-500",
        },
        {
          value: String(results.pings.filter((p) => !p.success).length),
          label: t("diagnostics.failed", "Failed"),
          color: "text-red-500",
        },
      ].map((stat) => (
        <div
          key={stat.label}
          className="text-center p-2.5 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]"
        >
          <div
            className={`text-xl font-bold ${stat.color || "text-[var(--color-text)]"}`}
          >
            {stat.value}
          </div>
          <div className="text-[10px] text-[var(--color-textMuted)] uppercase">
            {stat.label}
          </div>
        </div>
      ))}
    </div>
  );
};

export default PingStatsGrid;
