import React from "react";
import { useTranslation } from "react-i18next";
import type { ServerStatsSnapshot } from "../../../types/monitoring/serverStats";

interface DetailTabsProps {
  snapshot: ServerStatsSnapshot;
  activeTab: "cpu" | "memory" | "disk" | "system" | "firewall" | "ports";
  searchFilter: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold text-[var(--color-text)] mb-2">{title}</h3>
      {children}
    </div>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between text-xs py-1 border-b border-[var(--color-border)]">
      <span className="text-[var(--color-text-secondary)]">{label}</span>
      <span className="text-[var(--color-text)] font-mono">{value}</span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/*  CPU detail                                                           */
/* ────────────────────────────────────────────────────────────────────── */

function CpuDetail({ snapshot }: { snapshot: ServerStatsSnapshot }) {
  const { t } = useTranslation();
  const { cpu } = snapshot;
  return (
    <Section title={t("serverStats.cpuDetails", "CPU Details")}>
      <KV label={t("serverStats.model", "Model")} value={cpu.model} />
      <KV label={t("serverStats.cores", "Cores")} value={cpu.coreCount} />
      <KV label={t("serverStats.usage", "Usage")} value={`${cpu.usagePercent.toFixed(1)}%`} />
      <KV label={t("serverStats.load1", "Load 1m")} value={cpu.loadAvg1.toFixed(2)} />
      <KV label={t("serverStats.load5", "Load 5m")} value={cpu.loadAvg5.toFixed(2)} />
      <KV label={t("serverStats.load15", "Load 15m")} value={cpu.loadAvg15.toFixed(2)} />
    </Section>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/*  Memory detail                                                        */
/* ────────────────────────────────────────────────────────────────────── */

function MemoryDetail({ snapshot }: { snapshot: ServerStatsSnapshot }) {
  const { t } = useTranslation();
  const { memory } = snapshot;
  return (
    <Section title={t("serverStats.memoryDetails", "Memory Details")}>
      <KV label={t("serverStats.total", "Total")} value={formatBytes(memory.totalBytes)} />
      <KV label={t("serverStats.used", "Used")} value={formatBytes(memory.usedBytes)} />
      <KV label={t("serverStats.free", "Free")} value={formatBytes(memory.freeBytes)} />
      <KV label={t("serverStats.available", "Available")} value={formatBytes(memory.availableBytes)} />
      <KV label={t("serverStats.usage", "Usage")} value={`${memory.usagePercent.toFixed(1)}%`} />
      <KV label={t("serverStats.swapTotal", "Swap Total")} value={formatBytes(memory.swapTotalBytes)} />
      <KV label={t("serverStats.swapUsed", "Swap Used")} value={formatBytes(memory.swapUsedBytes)} />
      <KV label={t("serverStats.swapUsage", "Swap Usage")} value={`${memory.swapUsagePercent.toFixed(1)}%`} />
    </Section>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/*  Disk detail                                                          */
/* ────────────────────────────────────────────────────────────────────── */

function DiskDetail({ snapshot }: { snapshot: ServerStatsSnapshot }) {
  const { t } = useTranslation();
  const { disk } = snapshot;
  return (
    <Section title={t("serverStats.diskDetails", "Disk Details")}>
      {disk.partitions.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-[var(--color-text-secondary)]">
                <th className="py-1 pr-2">{t("serverStats.mount", "Mount")}</th>
                <th className="py-1 pr-2">{t("serverStats.filesystem", "FS")}</th>
                <th className="py-1 pr-2">{t("serverStats.type", "Type")}</th>
                <th className="py-1 pr-2 text-right">{t("serverStats.total", "Total")}</th>
                <th className="py-1 pr-2 text-right">{t("serverStats.used", "Used")}</th>
                <th className="py-1 pr-2 text-right">{t("serverStats.available", "Avail")}</th>
                <th className="py-1 text-right">{t("serverStats.usage", "Use%")}</th>
              </tr>
            </thead>
            <tbody>
              {disk.partitions.map((p) => (
                <tr key={p.mountPoint} className="border-b border-[var(--color-border)]">
                  <td className="py-1 pr-2 font-mono text-[var(--color-text)]">{p.mountPoint}</td>
                  <td className="py-1 pr-2 text-[var(--color-text-secondary)]">{p.filesystem}</td>
                  <td className="py-1 pr-2 text-[var(--color-text-secondary)]">{p.fsType}</td>
                  <td className="py-1 pr-2 text-right text-[var(--color-text)]">{formatBytes(p.totalBytes)}</td>
                  <td className="py-1 pr-2 text-right text-[var(--color-text)]">{formatBytes(p.usedBytes)}</td>
                  <td className="py-1 pr-2 text-right text-[var(--color-text)]">{formatBytes(p.availableBytes)}</td>
                  <td className={`py-1 text-right font-semibold ${p.usagePercent >= 90 ? "text-red-500" : p.usagePercent >= 70 ? "text-amber-500" : "text-[var(--color-text)]"}`}>
                    {p.usagePercent}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-xs text-[var(--color-text-secondary)]">{t("serverStats.noDiskData", "No disk data available")}</div>
      )}
      {disk.io && (
        <div className="mt-3">
          <h4 className="text-xs font-semibold text-[var(--color-text)] mb-1">{t("serverStats.diskIo", "Disk I/O (since boot)")}</h4>
          <KV label={t("serverStats.readTotal", "Read")} value={formatBytes(disk.io.readBytes)} />
          <KV label={t("serverStats.writeTotal", "Write")} value={formatBytes(disk.io.writeBytes)} />
        </div>
      )}
    </Section>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/*  System detail                                                        */
/* ────────────────────────────────────────────────────────────────────── */

function SystemDetail({ snapshot }: { snapshot: ServerStatsSnapshot }) {
  const { t } = useTranslation();
  const { system } = snapshot;
  return (
    <Section title={t("serverStats.systemDetails", "System Details")}>
      <KV label={t("serverStats.hostname", "Hostname")} value={system.hostname} />
      <KV label={t("serverStats.os", "OS")} value={system.osName} />
      <KV label={t("serverStats.osVersion", "Version")} value={system.osVersion} />
      <KV label={t("serverStats.kernel", "Kernel")} value={system.kernelVersion} />
      <KV label={t("serverStats.arch", "Architecture")} value={system.architecture} />
      <KV label={t("serverStats.uptime", "Uptime")} value={system.uptime} />
      <KV label={t("serverStats.uptimeSeconds", "Uptime (s)")} value={Math.round(system.uptimeSeconds).toLocaleString()} />
      <KV label={t("serverStats.serverTime", "Server Time")} value={system.serverTime} />
      <KV label={t("serverStats.loggedInUsers", "Logged-in Users")} value={system.loggedInUsers} />
    </Section>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/*  Firewall detail                                                      */
/* ────────────────────────────────────────────────────────────────────── */

function FirewallDetail({ snapshot, searchFilter }: { snapshot: ServerStatsSnapshot; searchFilter: string }) {
  const { t } = useTranslation();
  const { firewall } = snapshot;

  const filteredRules = searchFilter
    ? firewall.rules.filter((r) => {
        const lower = searchFilter.toLowerCase();
        return (
          r.chain.toLowerCase().includes(lower) ||
          r.target.toLowerCase().includes(lower) ||
          r.protocol.toLowerCase().includes(lower) ||
          r.source.toLowerCase().includes(lower) ||
          r.destination.toLowerCase().includes(lower) ||
          r.options.toLowerCase().includes(lower)
        );
      })
    : firewall.rules;

  return (
    <Section title={t("serverStats.firewallConfig", "Firewall Configuration")}>
      <KV label={t("serverStats.backend", "Backend")} value={firewall.backend} />
      <KV label={t("serverStats.status", "Status")} value={firewall.active ? t("serverStats.active", "Active") : t("serverStats.inactive", "Inactive")} />

      {filteredRules.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-[var(--color-text-secondary)]">
                <th className="py-1 pr-2">#</th>
                <th className="py-1 pr-2">{t("serverStats.chain", "Chain")}</th>
                <th className="py-1 pr-2">{t("serverStats.target", "Target")}</th>
                <th className="py-1 pr-2">{t("serverStats.protocol", "Proto")}</th>
                <th className="py-1 pr-2">{t("serverStats.source", "Source")}</th>
                <th className="py-1 pr-2">{t("serverStats.destination", "Dest")}</th>
                <th className="py-1">{t("serverStats.options", "Options")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredRules.map((r, i) => (
                <tr key={i} className="border-b border-[var(--color-border)]">
                  <td className="py-1 pr-2 text-[var(--color-text-secondary)]">{r.ruleNumber}</td>
                  <td className="py-1 pr-2 text-[var(--color-text)]">{r.chain}</td>
                  <td className={`py-1 pr-2 font-semibold ${r.target === "DROP" || r.target === "REJECT" || r.target === "DENY" ? "text-red-500" : "text-green-500"}`}>
                    {r.target}
                  </td>
                  <td className="py-1 pr-2 text-[var(--color-text)]">{r.protocol}</td>
                  <td className="py-1 pr-2 font-mono text-[var(--color-text-secondary)]">{r.source}</td>
                  <td className="py-1 pr-2 font-mono text-[var(--color-text-secondary)]">{r.destination}</td>
                  <td className="py-1 text-[var(--color-text-secondary)]">{r.options}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {firewall.rawOutput && (
        <details className="mt-3">
          <summary className="text-xs cursor-pointer text-cyan-500 hover:underline">
            {t("serverStats.showRaw", "Show raw output")}
          </summary>
          <pre className="mt-1 p-2 text-xs bg-black/20 rounded overflow-auto max-h-60 text-[var(--color-text-secondary)] font-mono whitespace-pre-wrap">
            {firewall.rawOutput}
          </pre>
        </details>
      )}
    </Section>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/*  Ports detail                                                         */
/* ────────────────────────────────────────────────────────────────────── */

function PortsDetail({ snapshot, searchFilter }: { snapshot: ServerStatsSnapshot; searchFilter: string }) {
  const { t } = useTranslation();
  const { ports } = snapshot;

  const filteredPorts = searchFilter
    ? ports.listeningPorts.filter((p) => {
        const lower = searchFilter.toLowerCase();
        return (
          p.protocol.toLowerCase().includes(lower) ||
          p.localAddress.includes(lower) ||
          String(p.localPort).includes(lower) ||
          p.processName.toLowerCase().includes(lower) ||
          p.state.toLowerCase().includes(lower)
        );
      })
    : ports.listeningPorts;

  return (
    <Section title={t("serverStats.portMonitor", "Port Monitor")}>
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div className="text-center p-2 rounded bg-[var(--color-surface)] border border-[var(--color-border)]">
          <div className="text-lg font-bold text-[var(--color-text)]">{ports.listeningPorts.length}</div>
          <div className="text-xs text-[var(--color-text-secondary)]">{t("serverStats.listening", "Listening")}</div>
        </div>
        <div className="text-center p-2 rounded bg-[var(--color-surface)] border border-[var(--color-border)]">
          <div className="text-lg font-bold text-[var(--color-text)]">{ports.establishedConnections}</div>
          <div className="text-xs text-[var(--color-text-secondary)]">{t("serverStats.established", "Established")}</div>
        </div>
        <div className="text-center p-2 rounded bg-[var(--color-surface)] border border-[var(--color-border)]">
          <div className="text-lg font-bold text-[var(--color-text)]">{ports.timeWaitConnections}</div>
          <div className="text-xs text-[var(--color-text-secondary)]">{t("serverStats.timeWait", "TIME_WAIT")}</div>
        </div>
      </div>

      {filteredPorts.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-[var(--color-text-secondary)]">
                <th className="py-1 pr-2">{t("serverStats.protocol", "Proto")}</th>
                <th className="py-1 pr-2">{t("serverStats.address", "Address")}</th>
                <th className="py-1 pr-2">{t("serverStats.port", "Port")}</th>
                <th className="py-1 pr-2">{t("serverStats.process", "Process")}</th>
                <th className="py-1 pr-2">{t("serverStats.pid", "PID")}</th>
                <th className="py-1">{t("serverStats.state", "State")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredPorts.map((p, i) => (
                <tr key={i} className="border-b border-[var(--color-border)]">
                  <td className="py-1 pr-2 text-[var(--color-text)]">{p.protocol}</td>
                  <td className="py-1 pr-2 font-mono text-[var(--color-text-secondary)]">{p.localAddress}</td>
                  <td className="py-1 pr-2 font-mono text-cyan-500 font-semibold">{p.localPort}</td>
                  <td className="py-1 pr-2 text-[var(--color-text)]">{p.processName || "–"}</td>
                  <td className="py-1 pr-2 text-[var(--color-text-secondary)]">{p.pid || "–"}</td>
                  <td className="py-1 text-green-500">{p.state}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-xs text-[var(--color-text-secondary)]">
          {t("serverStats.noPortData", "No listening ports found")}
        </div>
      )}
    </Section>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/*  Exported wrapper                                                     */
/* ────────────────────────────────────────────────────────────────────── */

export const DetailTabs: React.FC<DetailTabsProps> = ({ snapshot, activeTab, searchFilter }) => {
  switch (activeTab) {
    case "cpu":
      return <CpuDetail snapshot={snapshot} />;
    case "memory":
      return <MemoryDetail snapshot={snapshot} />;
    case "disk":
      return <DiskDetail snapshot={snapshot} />;
    case "system":
      return <SystemDetail snapshot={snapshot} />;
    case "firewall":
      return <FirewallDetail snapshot={snapshot} searchFilter={searchFilter} />;
    case "ports":
      return <PortsDetail snapshot={snapshot} searchFilter={searchFilter} />;
    default:
      return null;
  }
};
