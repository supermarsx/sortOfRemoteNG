import React from "react";
import { useTranslation } from "react-i18next";
import { Thermometer, Wind, Loader2 } from "lucide-react";
import type { SubProps } from "./types";

const ThermalView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  const td = mgr.thermalData;
  const ts = mgr.thermalSummary;

  if (mgr.loading && !td) {
    return (
      <div className="flex items-center justify-center flex-1">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--color-textSecondary)]" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* Summary */}
      {ts && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-4">
          <h3 className="text-xs font-semibold text-[var(--color-text)] mb-3">
            {t("idrac.thermal.summary", "Thermal Summary")}
          </h3>
          <div className="grid grid-cols-4 gap-4">
            <div>
              <p className="text-[10px] text-[var(--color-textSecondary)]">Inlet</p>
              <p className="text-sm font-semibold text-[var(--color-text)]">
                {ts.inletTempCelsius != null ? `${ts.inletTempCelsius} °C` : "N/A"}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-[var(--color-textSecondary)]">Exhaust</p>
              <p className="text-sm font-semibold text-[var(--color-text)]">
                {ts.exhaustTempCelsius != null ? `${ts.exhaustTempCelsius} °C` : "N/A"}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-[var(--color-textSecondary)]">Fans</p>
              <p className="text-sm font-semibold text-success">
                {ts.fansOk}/{ts.fanCount} OK
              </p>
            </div>
            <div>
              <p className="text-[10px] text-[var(--color-textSecondary)]">Sensors</p>
              <p className="text-sm font-semibold text-success">
                {ts.sensorsOk}/{ts.sensorCount} OK
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Temperature Sensors */}
      {td && td.temperatures.length > 0 && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Thermometer className="w-4 h-4 text-error" />
            <h3 className="text-xs font-semibold text-[var(--color-text)]">
              {t("idrac.thermal.temperatures", "Temperature Sensors")}
            </h3>
          </div>
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-[var(--color-textSecondary)] border-b border-[var(--color-border)]">
                <th className="text-left py-1">Sensor</th>
                <th className="text-left py-1">Context</th>
                <th className="text-right py-1">Reading</th>
                <th className="text-right py-1">Warning</th>
                <th className="text-right py-1">Critical</th>
                <th className="text-center py-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {td.temperatures.map((s) => (
                <tr key={s.id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="py-1 text-[var(--color-text)]">{s.name}</td>
                  <td className="py-1 text-[var(--color-textSecondary)]">{s.physicalContext ?? "—"}</td>
                  <td className="py-1 text-right font-medium text-[var(--color-text)]">
                    {s.readingCelsius != null ? `${s.readingCelsius} °C` : "—"}
                  </td>
                  <td className="py-1 text-right text-[var(--color-textSecondary)]">
                    {s.upperThresholdCritical != null ? `${s.upperThresholdCritical} °C` : "—"}
                  </td>
                  <td className="py-1 text-right text-[var(--color-textSecondary)]">
                    {s.upperThresholdFatal != null ? `${s.upperThresholdFatal} °C` : "—"}
                  </td>
                  <td className="py-1 text-center">
                    <span className={s.status.health?.toLowerCase() === "ok" ? "text-success" : "text-warning"}>
                      {s.status.health ?? "N/A"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Fans */}
      {td && td.fans.length > 0 && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Wind className="w-4 h-4 text-primary" />
            <h3 className="text-xs font-semibold text-[var(--color-text)]">
              {t("idrac.thermal.fans", "Fans")}
            </h3>
          </div>
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-[var(--color-textSecondary)] border-b border-[var(--color-border)]">
                <th className="text-left py-1">Fan</th>
                <th className="text-right py-1">RPM</th>
                <th className="text-right py-1">%</th>
                <th className="text-center py-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {td.fans.map((f) => (
                <tr key={f.id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="py-1 text-[var(--color-text)]">{f.name}</td>
                  <td className="py-1 text-right text-[var(--color-text)]">
                    {f.readingRpm ?? "—"}
                  </td>
                  <td className="py-1 text-right text-[var(--color-text)]">
                    {f.readingPercent != null ? `${f.readingPercent}%` : "—"}
                  </td>
                  <td className="py-1 text-center">
                    <span className={f.status.health?.toLowerCase() === "ok" ? "text-success" : "text-warning"}>
                      {f.status.health ?? "N/A"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default ThermalView;
