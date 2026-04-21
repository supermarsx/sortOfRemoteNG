import React from "react";
import { useTranslation } from "react-i18next";
import { HardDrive, Database, Disc, Box, Loader2 } from "lucide-react";
import type { SubProps } from "./types";

/** Format bytes to human-readable. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let u = -1;
  let b = bytes;
  do {
    b /= 1024;
    u++;
  } while (b >= 1024 && u < units.length - 1);
  return `${b.toFixed(1)} ${units[u]}`;
}

const StorageView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();

  if (mgr.loading && mgr.storageControllers.length === 0) {
    return (
      <div className="flex items-center justify-center flex-1">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--color-textSecondary)]" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* Controllers */}
      {mgr.storageControllers.length > 0 && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Database className="w-4 h-4 text-warning" />
            <h3 className="text-xs font-semibold text-[var(--color-text)]">
              {t("idrac.storage.controllers", "RAID Controllers")}
            </h3>
          </div>
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-[var(--color-textSecondary)] border-b border-[var(--color-border)]">
                <th className="text-left py-1">Name</th>
                <th className="text-left py-1">Model</th>
                <th className="text-left py-1">Firmware</th>
                <th className="text-left py-1">RAID Levels</th>
                <th className="text-right py-1">Cache</th>
                <th className="text-center py-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {mgr.storageControllers.map((c) => (
                <tr key={c.id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="py-1 text-[var(--color-text)]">{c.name}</td>
                  <td className="py-1 text-[var(--color-textSecondary)]">{c.model ?? "—"}</td>
                  <td className="py-1 text-[var(--color-textSecondary)]">{c.firmwareVersion ?? "—"}</td>
                  <td className="py-1 text-[var(--color-textSecondary)]">
                    {c.supportedRaidLevels.length > 0 ? c.supportedRaidLevels.join(", ") : "—"}
                  </td>
                  <td className="py-1 text-right text-[var(--color-text)]">
                    {c.cacheSizeMib != null ? `${c.cacheSizeMib} MiB` : "—"}
                  </td>
                  <td className="py-1 text-center">
                    <span className={c.status.health?.toLowerCase() === "ok" ? "text-success" : "text-warning"}>
                      {c.status.health ?? "N/A"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Virtual Disks */}
      {mgr.virtualDisks.length > 0 && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-4">
          <div className="flex items-center gap-2 mb-3">
            <HardDrive className="w-4 h-4 text-primary" />
            <h3 className="text-xs font-semibold text-[var(--color-text)]">
              {t("idrac.storage.virtual_disks", "Virtual Disks")}
            </h3>
          </div>
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-[var(--color-textSecondary)] border-b border-[var(--color-border)]">
                <th className="text-left py-1">Name</th>
                <th className="text-left py-1">RAID</th>
                <th className="text-right py-1">Size</th>
                <th className="text-left py-1">Media</th>
                <th className="text-right py-1"># Disks</th>
                <th className="text-center py-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {mgr.virtualDisks.map((vd) => (
                <tr key={vd.id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="py-1 text-[var(--color-text)]">{vd.name}</td>
                  <td className="py-1 text-[var(--color-text)]">{vd.raidLevel}</td>
                  <td className="py-1 text-right text-[var(--color-text)]">{formatBytes(vd.capacityBytes)}</td>
                  <td className="py-1 text-[var(--color-textSecondary)]">{vd.mediaType ?? "—"}</td>
                  <td className="py-1 text-right text-[var(--color-text)]">{vd.physicalDiskIds.length}</td>
                  <td className="py-1 text-center">
                    <span className={vd.status.health?.toLowerCase() === "ok" ? "text-success" : "text-warning"}>
                      {vd.status.health ?? "N/A"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Physical Disks */}
      {mgr.physicalDisks.length > 0 && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Disc className="w-4 h-4 text-success" />
            <h3 className="text-xs font-semibold text-[var(--color-text)]">
              {t("idrac.storage.physical_disks", "Physical Disks")}
            </h3>
          </div>
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-[var(--color-textSecondary)] border-b border-[var(--color-border)]">
                <th className="text-left py-1">Slot</th>
                <th className="text-left py-1">Model</th>
                <th className="text-right py-1">Size</th>
                <th className="text-left py-1">Type</th>
                <th className="text-left py-1">Protocol</th>
                <th className="text-right py-1">Life %</th>
                <th className="text-center py-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {mgr.physicalDisks.map((pd) => (
                <tr key={pd.id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="py-1 text-[var(--color-text)]">{pd.slot ?? pd.name}</td>
                  <td className="py-1 text-[var(--color-textSecondary)]">{pd.model ?? "—"}</td>
                  <td className="py-1 text-right text-[var(--color-text)]">{formatBytes(pd.capacityBytes)}</td>
                  <td className="py-1 text-[var(--color-text)]">{pd.mediaType}</td>
                  <td className="py-1 text-[var(--color-textSecondary)]">{pd.protocol ?? "—"}</td>
                  <td className="py-1 text-right text-[var(--color-text)]">
                    {pd.predictedMediaLifeLeftPercent != null ? `${pd.predictedMediaLifeLeftPercent}%` : "—"}
                  </td>
                  <td className="py-1 text-center">
                    <span className={pd.status.health?.toLowerCase() === "ok" ? "text-success" : "text-warning"}>
                      {pd.status.health ?? "N/A"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Enclosures */}
      {mgr.enclosures.length > 0 && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Box className="w-4 h-4 text-primary" />
            <h3 className="text-xs font-semibold text-[var(--color-text)]">
              {t("idrac.storage.enclosures", "Enclosures")}
            </h3>
          </div>
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-[var(--color-textSecondary)] border-b border-[var(--color-border)]">
                <th className="text-left py-1">Name</th>
                <th className="text-left py-1">Connector</th>
                <th className="text-right py-1">Slots</th>
                <th className="text-center py-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {mgr.enclosures.map((e) => (
                <tr key={e.id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="py-1 text-[var(--color-text)]">{e.name}</td>
                  <td className="py-1 text-[var(--color-textSecondary)]">{e.connector ?? "—"}</td>
                  <td className="py-1 text-right text-[var(--color-text)]">{e.slotCount ?? "—"}</td>
                  <td className="py-1 text-center">
                    <span className={e.status.health?.toLowerCase() === "ok" ? "text-success" : "text-warning"}>
                      {e.status.health ?? "N/A"}
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

export default StorageView;
