import React from "react";
import { useTranslation } from "react-i18next";
import { HardDrive, Activity, Search } from "lucide-react";
import type { SubProps } from "./types";

const formatBytes = (bytes: number) => {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

const StorageView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();

  return (
    <div className="p-6 space-y-6 overflow-y-auto flex-1">
      <h3 className="text-sm font-semibold text-[var(--color-text)] flex items-center gap-2">
        <HardDrive className="w-4 h-4 text-amber-500" />
        {t("synology.storage.title", "Storage Management")}
      </h3>

      {/* Volumes */}
      <section>
        <h4 className="text-xs font-semibold text-[var(--color-text)] mb-2">
          {t("synology.storage.volumes", "Volumes")} ({mgr.volumes.length})
        </h4>
        {mgr.volumes.length > 0 ? (
          <div className="space-y-2">
            {mgr.volumes.map((vol) => {
              const total = vol.size?.total ?? 0;
              const used = vol.size?.used ?? 0;
              const pct = total > 0 ? Math.round((used / total) * 100) : 0;
              return (
                <div
                  key={vol.id ?? vol.display_name}
                  className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-[var(--color-text)]">
                      {vol.display_name ?? vol.id}
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${
                        vol.status === "normal"
                          ? "bg-green-500/15 text-green-400"
                          : vol.status === "crashed"
                            ? "bg-red-500/15 text-red-400"
                            : "bg-yellow-500/15 text-yellow-400"
                      }`}
                    >
                      {vol.status}
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-[var(--color-bg)] overflow-hidden mb-1">
                    <div
                      className={`h-full rounded-full transition-all ${
                        pct > 90
                          ? "bg-red-500"
                          : pct > 70
                            ? "bg-yellow-500"
                            : "bg-teal-500"
                      }`}
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-[var(--color-text-secondary)]">
                    <span>
                      {formatBytes(used)} / {formatBytes(total)}
                    </span>
                    <span>{pct}% used</span>
                  </div>
                  {vol.fs_type && (
                    <div className="text-[10px] text-[var(--color-text-secondary)] mt-1">
                      FS: {vol.fs_type}
                      {vol.pool_path ? ` | Pool: ${vol.pool_path}` : ""}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-8 text-sm text-[var(--color-text-secondary)]">
            {t("synology.storage.noVolumes", "No volumes found")}
          </div>
        )}
      </section>

      {/* Disks */}
      <section>
        <h4 className="text-xs font-semibold text-[var(--color-text)] mb-2">
          {t("synology.storage.disks", "Physical Disks")} ({mgr.disks.length})
        </h4>
        {mgr.disks.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[var(--color-text-secondary)] border-b border-[var(--color-border)]">
                  <th className="pb-2 pr-3">ID</th>
                  <th className="pb-2 pr-3">Model</th>
                  <th className="pb-2 pr-3">Size</th>
                  <th className="pb-2 pr-3">Temp</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2 pr-3">SMART</th>
                </tr>
              </thead>
              <tbody>
                {mgr.disks.map((disk) => (
                  <tr
                    key={disk.id ?? disk.name}
                    className="border-b border-[var(--color-border)]/50"
                  >
                    <td className="py-2 pr-3 font-medium text-[var(--color-text)]">
                      {disk.id ?? disk.name}
                    </td>
                    <td className="py-2 pr-3 text-[var(--color-text-secondary)]">
                      {disk.model ?? "—"}
                    </td>
                    <td className="py-2 pr-3 text-[var(--color-text-secondary)]">
                      {disk.size_total ? formatBytes(disk.size_total) : "—"}
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className={
                          (disk.temp ?? 0) > 50
                            ? "text-red-400"
                            : (disk.temp ?? 0) > 40
                              ? "text-yellow-400"
                              : "text-green-400"
                        }
                      >
                        {disk.temp ?? "—"}°C
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded ${
                          disk.status === "normal"
                            ? "bg-green-500/15 text-green-400"
                            : "bg-red-500/15 text-red-400"
                        }`}
                      >
                        {disk.status}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      <button
                        onClick={() => mgr.loadSmartInfo(disk.id ?? disk.name ?? "")}
                        className="flex items-center gap-1 px-2 py-1 rounded bg-[var(--color-bg)] border border-[var(--color-border)] text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
                      >
                        <Search className="w-3 h-3" />
                        SMART
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8 text-sm text-[var(--color-text-secondary)]">
            {t("synology.storage.noDisks", "No disks found")}
          </div>
        )}
      </section>

      {/* SMART dialog */}
      {mgr.selectedDiskSmart && (
        <section>
          <h4 className="text-xs font-semibold text-[var(--color-text)] mb-2 flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-blue-500" />
            {t("synology.storage.smartInfo", "S.M.A.R.T. Information")}
          </h4>
          <div className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-[var(--color-text-secondary)]">
                  Overall:{" "}
                </span>
                <span className="text-[var(--color-text)] font-medium">
                  {mgr.selectedDiskSmart.overall_status ?? "—"}
                </span>
              </div>
              <div>
                <span className="text-[var(--color-text-secondary)]">
                  Temperature:{" "}
                </span>
                <span className="text-[var(--color-text)] font-medium">
                  {mgr.selectedDiskSmart.temperature ?? "—"}°C
                </span>
              </div>
              <div>
                <span className="text-[var(--color-text-secondary)]">
                  Power On Hours:{" "}
                </span>
                <span className="text-[var(--color-text)] font-medium">
                  {mgr.selectedDiskSmart.power_on_hours ?? "—"}
                </span>
              </div>
              <div>
                <span className="text-[var(--color-text-secondary)]">
                  Bad Sectors:{" "}
                </span>
                <span className="text-[var(--color-text)] font-medium">
                  {mgr.selectedDiskSmart.bad_sectors ?? "—"}
                </span>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
};

export default StorageView;
