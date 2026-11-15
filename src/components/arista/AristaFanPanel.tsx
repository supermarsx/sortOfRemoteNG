import React from "react";
import { useTranslation } from "react-i18next";
import { useAristaFans } from "../../hooks/arista/useAristaFans";
import type { AristaConfig, AristaFan } from "../../types/hardware/arista";

export interface AristaFanPanelProps {
  config: AristaConfig;
  /** Poll interval in ms (default 10000, 0 disables). */
  pollMs?: number;
}

const OK_STATUSES = new Set(["ok", "coolingok", "good", "normal"]);

function statusTone(status: string | null): "ok" | "bad" | "unknown" {
  if (!status) return "unknown";
  return OK_STATUSES.has(status.toLowerCase()) ? "ok" : "bad";
}

function speedPct(fan: AristaFan): number | null {
  if (fan.actualSpeedPct !== null) return fan.actualSpeedPct;
  if (fan.rpm !== null && fan.maxRpm) return (fan.rpm / fan.maxRpm) * 100;
  return null;
}

const AristaFanPanel: React.FC<AristaFanPanelProps> = ({
  config,
  pollMs = 10000,
}) => {
  const { t } = useTranslation();
  const { report, loading, error, refresh } = useAristaFans(config, {
    pollMs,
  });

  return (
    <div className="p-4 space-y-3" data-testid="arista-fan-panel">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          {t("arista.title", "Arista fan speeds")}
        </h2>
        <button
          type="button"
          className="px-3 py-1 rounded border"
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading
            ? t("arista.refreshing", "Refreshing...")
            : t("arista.refresh", "Refresh")}
        </button>
      </div>

      {error && (
        <div role="alert" className="text-red-500">
          {error}
        </div>
      )}

      {report && (
        <div className="text-sm opacity-80" data-testid="arista-summary">
          {t("arista.systemStatus", "System status")}:{" "}
          {report.systemStatus ?? t("arista.unknown", "unknown")}
          {report.airflow ? ` | ${report.airflow}` : ""}
          {report.ambientC !== null ? ` | ${report.ambientC} C` : ""}
        </div>
      )}

      {report && report.fans.length === 0 && !error && (
        <div>{t("arista.noFans", "No fans reported by this switch.")}</div>
      )}

      {report && report.fans.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th>{t("arista.slot", "Slot")}</th>
              <th>{t("arista.fan", "Fan")}</th>
              <th>{t("arista.status", "Status")}</th>
              <th>{t("arista.speed", "Speed")}</th>
              <th>{t("arista.rpm", "RPM")}</th>
            </tr>
          </thead>
          <tbody>
            {report.fans.map((fan, i) => {
              const pct = speedPct(fan);
              const tone = statusTone(fan.status);
              return (
                <tr
                  key={`${fan.trayKind}-${fan.trayLabel}-${fan.fanLabel}-${i}`}
                >
                  <td>{fan.trayLabel}</td>
                  <td>{fan.fanLabel}</td>
                  <td>
                    <span
                      data-testid="arista-fan-status"
                      data-tone={tone}
                      className={
                        tone === "ok"
                          ? "text-green-500"
                          : tone === "bad"
                            ? "text-red-500"
                            : "opacity-60"
                      }
                    >
                      {fan.status ?? t("arista.unknown", "unknown")}
                    </span>
                  </td>
                  <td>
                    {pct === null ? (
                      "-"
                    ) : (
                      <>
                        <div
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round(pct)}
                          className="w-32 h-2 bg-gray-300 rounded"
                        >
                          <div
                            className="h-2 bg-blue-500 rounded"
                            style={{
                              width: `${Math.max(0, Math.min(100, pct))}%`,
                            }}
                          />
                        </div>
                        <span>{Math.round(pct)}%</span>
                      </>
                    )}
                  </td>
                  <td>{fan.rpm ?? "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default AristaFanPanel;
