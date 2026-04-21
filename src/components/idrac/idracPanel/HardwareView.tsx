import React from "react";
import { useTranslation } from "react-i18next";
import { Cpu, MemoryStick, CircuitBoard, Loader2 } from "lucide-react";
import type { SubProps } from "./types";

const HardwareView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();

  if (mgr.loading && mgr.processors.length === 0) {
    return (
      <div className="flex items-center justify-center flex-1">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--color-textSecondary)]" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* Processors */}
      {mgr.processors.length > 0 && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Cpu className="w-4 h-4 text-primary" />
            <h3 className="text-xs font-semibold text-[var(--color-text)]">
              {t("idrac.hardware.processors", "Processors")}
            </h3>
          </div>
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-[var(--color-textSecondary)] border-b border-[var(--color-border)]">
                <th className="text-left py-1">Socket</th>
                <th className="text-left py-1">Model</th>
                <th className="text-right py-1">Cores</th>
                <th className="text-right py-1">Threads</th>
                <th className="text-right py-1">Speed</th>
                <th className="text-center py-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {mgr.processors.map((p) => (
                <tr key={p.id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="py-1 text-[var(--color-text)]">{p.socket}</td>
                  <td className="py-1 text-[var(--color-text)]">{p.model}</td>
                  <td className="py-1 text-right text-[var(--color-text)]">{p.totalCores}</td>
                  <td className="py-1 text-right text-[var(--color-text)]">{p.totalThreads}</td>
                  <td className="py-1 text-right text-[var(--color-text)]">
                    {p.currentSpeedMhz ? `${p.currentSpeedMhz} MHz` : p.maxSpeedMhz ? `${p.maxSpeedMhz} MHz` : "—"}
                  </td>
                  <td className="py-1 text-center">
                    <span className={p.status.health?.toLowerCase() === "ok" ? "text-success" : "text-warning"}>
                      {p.status.health ?? "N/A"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Memory */}
      {mgr.memory.length > 0 && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-4">
          <div className="flex items-center gap-2 mb-3">
            <MemoryStick className="w-4 h-4 text-success" />
            <h3 className="text-xs font-semibold text-[var(--color-text)]">
              {t("idrac.hardware.memory", "Memory DIMMs")}
            </h3>
          </div>
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-[var(--color-textSecondary)] border-b border-[var(--color-border)]">
                <th className="text-left py-1">Slot</th>
                <th className="text-left py-1">Manufacturer</th>
                <th className="text-right py-1">Size</th>
                <th className="text-right py-1">Speed</th>
                <th className="text-left py-1">Type</th>
                <th className="text-center py-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {mgr.memory.map((m) => (
                <tr key={m.id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="py-1 text-[var(--color-text)]">{m.deviceLocator}</td>
                  <td className="py-1 text-[var(--color-textSecondary)]">{m.manufacturer}</td>
                  <td className="py-1 text-right text-[var(--color-text)]">
                    {m.capacityMib >= 1024 ? `${(m.capacityMib / 1024).toFixed(0)} GiB` : `${m.capacityMib} MiB`}
                  </td>
                  <td className="py-1 text-right text-[var(--color-text)]">
                    {m.speedMhz ? `${m.speedMhz} MHz` : "—"}
                  </td>
                  <td className="py-1 text-[var(--color-textSecondary)]">{m.memoryType}</td>
                  <td className="py-1 text-center">
                    <span className={m.status.health?.toLowerCase() === "ok" ? "text-success" : "text-warning"}>
                      {m.status.health ?? "N/A"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* PCIe Devices */}
      {mgr.pcieDevices.length > 0 && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-4">
          <div className="flex items-center gap-2 mb-3">
            <CircuitBoard className="w-4 h-4 text-primary" />
            <h3 className="text-xs font-semibold text-[var(--color-text)]">
              {t("idrac.hardware.pcie", "PCIe Devices")}
            </h3>
          </div>
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-[var(--color-textSecondary)] border-b border-[var(--color-border)]">
                <th className="text-left py-1">Name</th>
                <th className="text-left py-1">Manufacturer</th>
                <th className="text-left py-1">Class</th>
                <th className="text-left py-1">Slot</th>
                <th className="text-center py-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {mgr.pcieDevices.map((d) => (
                <tr key={d.id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="py-1 text-[var(--color-text)]">{d.name}</td>
                  <td className="py-1 text-[var(--color-textSecondary)]">{d.manufacturer ?? "—"}</td>
                  <td className="py-1 text-[var(--color-textSecondary)]">{d.deviceClass ?? "—"}</td>
                  <td className="py-1 text-[var(--color-textSecondary)]">{d.slotType ?? "—"}</td>
                  <td className="py-1 text-center">
                    <span className={d.status.health?.toLowerCase() === "ok" ? "text-success" : "text-warning"}>
                      {d.status.health ?? "N/A"}
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

export default HardwareView;
