import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  RefreshCw, Loader2, AlertCircle, Cpu, HardDrive,
  Wifi, MemoryStick, Activity, Pause, Play,
} from "lucide-react";
import type { WinmgmtContext } from "../WinmgmtWrapper";
import type {
  SystemPerformanceSnapshot,
  CpuPerformance,
  MemoryPerformance,
  DiskPerformance,
  NetworkPerformance,
} from "../../../types/windows/winmgmt";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
}

interface PerformancePanelProps {
  ctx: WinmgmtContext;
}

const PerformancePanel: React.FC<PerformancePanelProps> = ({ ctx }) => {
  const [snapshot, setSnapshot] = useState<SystemPerformanceSnapshot | null>(
    null,
  );
  const [history, setHistory] = useState<SystemPerformanceSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSnapshot = useCallback(async () => {
    try {
      const snap = await ctx.cmd<SystemPerformanceSnapshot>(
        "winmgmt_perf_snapshot",
      );
      setSnapshot(snap);
      setHistory((prev) => [...prev.slice(-59), snap]);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, [ctx]);

  // Initial fetch
  useEffect(() => {
    setLoading(true);
    fetchSnapshot().finally(() => setLoading(false));
  }, [fetchSnapshot]);

  // Auto-refresh interval
  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchSnapshot, 5000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, fetchSnapshot]);

  if (loading && !snapshot) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2
          size={24}
          className="animate-spin text-[var(--color-textMuted)]"
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <button
          onClick={fetchSnapshot}
          className="p-1.5 rounded-md hover:bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)]"
          title="Refresh now"
        >
          <RefreshCw size={14} />
        </button>
        <button
          onClick={() => setAutoRefresh(!autoRefresh)}
          className={`p-1.5 rounded-md hover:bg-[var(--color-surfaceHover)] ${autoRefresh ? "text-green-400" : "text-[var(--color-textMuted)]"}`}
          title={autoRefresh ? "Pause auto-refresh" : "Resume auto-refresh"}
        >
          {autoRefresh ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <span className="text-xs text-[var(--color-textMuted)]">
          {autoRefresh ? "Live (5s)" : "Paused"}
        </span>
        {snapshot && (
          <span className="text-xs text-[var(--color-textMuted)] ml-auto">
            Uptime: {formatUptime(snapshot.system.systemUpTime)}
          </span>
        )}
      </div>

      {error && (
        <div className="px-3 py-2 text-xs text-[var(--color-error)] bg-[color-mix(in_srgb,var(--color-error)_8%,transparent)] flex items-center gap-1.5">
          <AlertCircle size={12} />
          {error}
        </div>
      )}

      {snapshot && (
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {/* CPU & Memory Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricCard
              icon={<Cpu size={16} className="text-blue-400" />}
              label="CPU Usage"
              value={`${snapshot.cpu.totalUsagePercent.toFixed(1)}%`}
              bar={snapshot.cpu.totalUsagePercent}
              barColor="bg-blue-400"
            />
            <MetricCard
              icon={<MemoryStick size={16} className="text-purple-400" />}
              label="Memory"
              value={`${snapshot.memory.usedPercent.toFixed(1)}%`}
              sub={`${formatBytes(snapshot.memory.availableBytes)} available`}
              bar={snapshot.memory.usedPercent}
              barColor="bg-purple-400"
            />
            <MetricCard
              icon={<Activity size={16} className="text-green-400" />}
              label="Processes"
              value={String(snapshot.system.processes)}
              sub={`${snapshot.system.threads} threads`}
            />
            <MetricCard
              icon={<Activity size={16} className="text-orange-400" />}
              label="Handles"
              value={String(snapshot.system.handleCount ?? 0)}
              sub={`${snapshot.cpu.contextSwitchesPerSec}/s ctx switches`}
            />
          </div>

          {/* Per-core CPU */}
          {snapshot.cpu.perCoreUsage.length > 0 && (
            <div className="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] p-3">
              <h3 className="text-xs font-medium text-[var(--color-textSecondary)] mb-2 flex items-center gap-1.5">
                <Cpu size={12} />
                CPU Cores
              </h3>
              <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
                {snapshot.cpu.perCoreUsage.map((usage, i) => (
                  <div key={i} className="text-center">
                    <div className="text-[10px] text-[var(--color-textMuted)] mb-0.5">
                      Core {i}
                    </div>
                    <div className="h-12 w-full bg-[var(--color-background)] rounded overflow-hidden relative">
                      <div
                        className="absolute bottom-0 w-full bg-blue-400/60 transition-all duration-500"
                        style={{ height: `${usage}%` }}
                      />
                    </div>
                    <div className="text-[10px] text-[var(--color-textSecondary)] mt-0.5">
                      {usage.toFixed(0)}%
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Disks */}
          {snapshot.disks.length > 0 && (
            <div className="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] p-3">
              <h3 className="text-xs font-medium text-[var(--color-textSecondary)] mb-2 flex items-center gap-1.5">
                <HardDrive size={12} />
                Disks
              </h3>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[var(--color-textMuted)]">
                    <th className="pb-1 font-medium">Disk</th>
                    <th className="pb-1 font-medium">Read</th>
                    <th className="pb-1 font-medium">Write</th>
                    <th className="pb-1 font-medium">Queue</th>
                    <th className="pb-1 font-medium">Active</th>
                    <th className="pb-1 font-medium">Space</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.disks.map((disk) => (
                    <tr
                      key={disk.name}
                      className="border-t border-[var(--color-border)]"
                    >
                      <td className="py-1 text-[var(--color-text)]">
                        {disk.name}
                      </td>
                      <td className="py-1 text-[var(--color-textSecondary)] font-mono">
                        {formatBytes(disk.readBytesPerSec)}/s
                      </td>
                      <td className="py-1 text-[var(--color-textSecondary)] font-mono">
                        {formatBytes(disk.writeBytesPerSec)}/s
                      </td>
                      <td className="py-1 text-[var(--color-textSecondary)]">
                        {disk.avgDiskQueueLength.toFixed(1)}
                      </td>
                      <td className="py-1 text-[var(--color-textSecondary)]">
                        {disk.percentDiskTime.toFixed(0)}%
                      </td>
                      <td className="py-1 text-[var(--color-textSecondary)]">
                        {disk.freeSpaceBytes != null && disk.totalSizeBytes
                          ? `${formatBytes(disk.freeSpaceBytes)} free / ${formatBytes(disk.totalSizeBytes)}`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Network */}
          {snapshot.network.length > 0 && (
            <div className="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] p-3">
              <h3 className="text-xs font-medium text-[var(--color-textSecondary)] mb-2 flex items-center gap-1.5">
                <Wifi size={12} />
                Network
              </h3>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[var(--color-textMuted)]">
                    <th className="pb-1 font-medium">Adapter</th>
                    <th className="pb-1 font-medium">Received</th>
                    <th className="pb-1 font-medium">Sent</th>
                    <th className="pb-1 font-medium">Bandwidth</th>
                    <th className="pb-1 font-medium">Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.network.map((nic) => (
                    <tr
                      key={nic.name}
                      className="border-t border-[var(--color-border)]"
                    >
                      <td className="py-1 text-[var(--color-text)] truncate max-w-[150px]">
                        {nic.name}
                      </td>
                      <td className="py-1 text-[var(--color-textSecondary)] font-mono">
                        {formatBytes(nic.bytesReceivedPerSec)}/s
                      </td>
                      <td className="py-1 text-[var(--color-textSecondary)] font-mono">
                        {formatBytes(nic.bytesSentPerSec)}/s
                      </td>
                      <td className="py-1 text-[var(--color-textSecondary)]">
                        {nic.currentBandwidth > 0
                          ? formatBytes(nic.currentBandwidth / 8) + "/s"
                          : "—"}
                      </td>
                      <td className="py-1 text-[var(--color-textSecondary)]">
                        {nic.packetsReceivedErrors + nic.packetsOutboundErrors}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const MetricCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  bar?: number;
  barColor?: string;
}> = ({ icon, label, value, sub, bar, barColor }) => (
  <div className="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] p-3">
    <div className="flex items-center gap-2 mb-2">
      {icon}
      <span className="text-xs text-[var(--color-textSecondary)]">{label}</span>
    </div>
    <div className="text-lg font-semibold text-[var(--color-text)]">
      {value}
    </div>
    {sub && (
      <div className="text-[10px] text-[var(--color-textMuted)] mt-0.5">
        {sub}
      </div>
    )}
    {bar != null && (
      <div className="mt-2 h-1.5 bg-[var(--color-background)] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor || "bg-[var(--color-accent)]"}`}
          style={{ width: `${Math.min(bar, 100)}%` }}
        />
      </div>
    )}
  </div>
);

export default PerformancePanel;
