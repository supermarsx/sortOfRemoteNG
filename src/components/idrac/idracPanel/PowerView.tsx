import React from "react";
import { useTranslation } from "react-i18next";
import {
  Power,
  Zap,
  Battery,
  Loader2,
  PowerOff,
  RotateCcw,
  AlertTriangle,
} from "lucide-react";
import type { SubProps } from "./types";
import type { PowerAction } from "../../../types/hardware/idrac";

const POWER_ACTIONS: { action: PowerAction; label: string; icon: React.FC<{ className?: string }>; variant: string }[] = [
  { action: "on", label: "Power On", icon: Power, variant: "text-success hover:bg-success/10" },
  { action: "gracefulShutdown", label: "Graceful Shutdown", icon: PowerOff, variant: "text-warning hover:bg-warning/10" },
  { action: "forceOff", label: "Force Off", icon: PowerOff, variant: "text-error hover:bg-error/10" },
  { action: "gracefulRestart", label: "Graceful Restart", icon: RotateCcw, variant: "text-primary hover:bg-primary/10" },
  { action: "forceRestart", label: "Force Restart", icon: RotateCcw, variant: "text-warning hover:bg-warning/10" },
  { action: "powerCycle", label: "Power Cycle", icon: Zap, variant: "text-accent hover:bg-accent/10" },
  { action: "nmi", label: "NMI (Diagnostic)", icon: AlertTriangle, variant: "text-error hover:bg-error/10" },
];

const PowerView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  const pm = mgr.powerMetrics;

  if (mgr.loading && !mgr.powerState) {
    return (
      <div className="flex items-center justify-center flex-1">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--color-text-secondary)]" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* Current state */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
        <div className="flex items-center gap-2 mb-3">
          <Power className="w-4 h-4 text-warning" />
          <h3 className="text-xs font-semibold text-[var(--color-text)]">
            {t("idrac.power.state", "Power State")}
          </h3>
          <span
            className={`ml-2 text-xs font-medium ${
              mgr.powerState === "On" ? "text-success" : "text-error"
            }`}
          >
            {mgr.powerState ?? "Unknown"}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          {POWER_ACTIONS.map((pa) => {
            const Icon = pa.icon;
            return (
              <button
                key={pa.action}
                onClick={() =>
                  mgr.requestConfirm(
                    "Power Action",
                    `Are you sure you want to execute "${pa.label}"?`,
                    () => mgr.executePowerAction(pa.action),
                  )
                }
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-[10px] font-medium transition-colors ${pa.variant}`}
              >
                <Icon className="w-3 h-3" />
                {pa.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Metrics */}
      {pm && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4 text-warning" />
            <h3 className="text-xs font-semibold text-[var(--color-text)]">
              {t("idrac.power.metrics", "Power Metrics")}
            </h3>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {[
              ["Current", pm.currentWatts, "W"],
              ["Min", pm.minWatts, "W"],
              ["Max", pm.maxWatts, "W"],
              ["Average", pm.averageWatts, "W"],
              [
                "Power Cap",
                pm.powerCapEnabled ? pm.powerCapWatts : null,
                pm.powerCapEnabled ? "W" : "Disabled",
              ],
            ].map(([label, value, unit]) => (
              <div key={label as string} className="space-y-0.5">
                <p className="text-[10px] text-[var(--color-text-secondary)]">
                  {label as string}
                </p>
                <p className="text-sm font-semibold text-[var(--color-text)]">
                  {value != null ? `${value} ${unit}` : (unit as string)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Power Supplies */}
      {mgr.powerSupplies.length > 0 && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Battery className="w-4 h-4 text-success" />
            <h3 className="text-xs font-semibold text-[var(--color-text)]">
              {t("idrac.power.psu", "Power Supplies")}
            </h3>
          </div>
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-[var(--color-text-secondary)] border-b border-[var(--color-border)]">
                <th className="text-left py-1">Name</th>
                <th className="text-left py-1">Model</th>
                <th className="text-right py-1">Capacity</th>
                <th className="text-right py-1">Output</th>
                <th className="text-right py-1">Input V</th>
                <th className="text-center py-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {mgr.powerSupplies.map((psu) => (
                <tr
                  key={psu.id}
                  className="border-b border-[var(--color-border)] last:border-0"
                >
                  <td className="py-1 text-[var(--color-text)]">{psu.name}</td>
                  <td className="py-1 text-[var(--color-text-secondary)]">
                    {psu.model ?? "—"}
                  </td>
                  <td className="py-1 text-right text-[var(--color-text)]">
                    {psu.capacityWatts != null ? `${psu.capacityWatts} W` : "—"}
                  </td>
                  <td className="py-1 text-right text-[var(--color-text)]">
                    {psu.outputWatts != null ? `${psu.outputWatts} W` : "—"}
                  </td>
                  <td className="py-1 text-right text-[var(--color-text)]">
                    {psu.inputVoltage != null ? `${psu.inputVoltage} V` : "—"}
                  </td>
                  <td className="py-1 text-center">
                    <span
                      className={`${
                        psu.status.health?.toLowerCase() === "ok"
                          ? "text-success"
                          : "text-warning"
                      }`}
                    >
                      {psu.status.health ?? "N/A"}
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

export default PowerView;
