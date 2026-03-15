import React, { useState, useEffect, useCallback } from "react";
import {
  RefreshCw, Loader2, AlertCircle, Monitor, Cpu,
  HardDrive, Wifi, MemoryStick, Server,
} from "lucide-react";
import type { WinmgmtContext } from "../WinmgmtWrapper";
import type { SystemInfo } from "../../../types/windows/winmgmt";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

interface SystemInfoPanelProps {
  ctx: WinmgmtContext;
}

const SystemInfoPanel: React.FC<SystemInfoPanelProps> = ({ ctx }) => {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchInfo = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await ctx.cmd<SystemInfo>("winmgmt_system_info");
      setInfo(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [ctx]);

  useEffect(() => {
    fetchInfo();
  }, [fetchInfo]);

  if (loading && !info) {
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
          onClick={fetchInfo}
          disabled={loading}
          className="p-1.5 rounded-md hover:bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)]"
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
        <span className="text-xs text-[var(--color-textMuted)]">
          System Information
        </span>
      </div>

      {error && (
        <div className="px-3 py-2 text-xs text-[var(--color-error)] bg-[color-mix(in_srgb,var(--color-error)_8%,transparent)] flex items-center gap-1.5">
          <AlertCircle size={12} />
          {error}
        </div>
      )}

      {info && (
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {/* Computer System */}
          <Section
            icon={<Server size={14} className="text-blue-400" />}
            title="Computer System"
          >
            <InfoGrid>
              <InfoItem label="Name" value={info.computerSystem.name} />
              <InfoItem
                label="Domain"
                value={info.computerSystem.domain}
              />
              <InfoItem
                label="Manufacturer"
                value={info.computerSystem.manufacturer}
              />
              <InfoItem label="Model" value={info.computerSystem.model} />
              <InfoItem
                label="System Type"
                value={info.computerSystem.systemType}
              />
              <InfoItem
                label="Total Memory"
                value={formatBytes(info.computerSystem.totalPhysicalMemory)}
              />
              <InfoItem
                label="Processors"
                value={`${info.computerSystem.numberOfProcessors} physical / ${info.computerSystem.numberOfLogicalProcessors} logical`}
              />
              <InfoItem
                label="Domain Role"
                value={info.computerSystem.domainRole}
              />
              {info.computerSystem.dnsHostName && (
                <InfoItem
                  label="DNS Hostname"
                  value={info.computerSystem.dnsHostName}
                />
              )}
              {info.computerSystem.userName && (
                <InfoItem
                  label="Current User"
                  value={info.computerSystem.userName}
                />
              )}
            </InfoGrid>
          </Section>

          {/* OS */}
          <Section
            icon={<Monitor size={14} className="text-green-400" />}
            title="Operating System"
          >
            <InfoGrid>
              <InfoItem label="OS" value={info.operatingSystem.caption} />
              <InfoItem
                label="Version"
                value={`${info.operatingSystem.version} (Build ${info.operatingSystem.buildNumber})`}
              />
              <InfoItem
                label="Architecture"
                value={info.operatingSystem.osArchitecture}
              />
              {info.operatingSystem.installDate && (
                <InfoItem
                  label="Installed"
                  value={info.operatingSystem.installDate}
                />
              )}
              {info.operatingSystem.lastBootUpTime && (
                <InfoItem
                  label="Last Boot"
                  value={info.operatingSystem.lastBootUpTime}
                />
              )}
              <InfoItem
                label="Windows Dir"
                value={info.operatingSystem.windowsDirectory}
                mono
              />
              <InfoItem
                label="Processes"
                value={String(info.operatingSystem.numberOfProcesses)}
              />
              <InfoItem
                label="Users"
                value={String(info.operatingSystem.numberOfUsers)}
              />
            </InfoGrid>
          </Section>

          {/* BIOS */}
          <Section
            icon={<Cpu size={14} className="text-orange-400" />}
            title="BIOS"
          >
            <InfoGrid>
              <InfoItem
                label="Manufacturer"
                value={info.bios.manufacturer}
              />
              <InfoItem label="Name" value={info.bios.name} />
              <InfoItem label="Version" value={info.bios.version} />
              <InfoItem
                label="Serial Number"
                value={info.bios.serialNumber}
              />
              {info.bios.smbiosBiosVersion && (
                <InfoItem
                  label="SMBIOS Version"
                  value={info.bios.smbiosBiosVersion}
                />
              )}
            </InfoGrid>
          </Section>

          {/* Processors */}
          <Section
            icon={<Cpu size={14} className="text-blue-400" />}
            title={`Processors (${info.processors.length})`}
          >
            {info.processors.map((proc, i) => (
              <div
                key={proc.deviceId}
                className={`${i > 0 ? "mt-3 pt-3 border-t border-[var(--color-border)]" : ""}`}
              >
                <h4 className="text-xs font-medium text-[var(--color-text)] mb-2">
                  {proc.name}
                </h4>
                <InfoGrid>
                  <InfoItem
                    label="Cores"
                    value={`${proc.numberOfCores} physical / ${proc.numberOfLogicalProcessors} logical`}
                  />
                  <InfoItem
                    label="Speed"
                    value={`${proc.currentClockSpeed} MHz (max ${proc.maxClockSpeed} MHz)`}
                  />
                  {proc.l2CacheSize && (
                    <InfoItem
                      label="L2 Cache"
                      value={`${proc.l2CacheSize} KB`}
                    />
                  )}
                  {proc.l3CacheSize && (
                    <InfoItem
                      label="L3 Cache"
                      value={`${proc.l3CacheSize} KB`}
                    />
                  )}
                  {proc.loadPercentage != null && (
                    <InfoItem
                      label="Load"
                      value={`${proc.loadPercentage}%`}
                    />
                  )}
                </InfoGrid>
              </div>
            ))}
          </Section>

          {/* Disks */}
          <Section
            icon={<HardDrive size={14} className="text-yellow-400" />}
            title={`Logical Disks (${info.logicalDisks.length})`}
          >
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[var(--color-textMuted)]">
                  <th className="pb-1 font-medium">Drive</th>
                  <th className="pb-1 font-medium">Label</th>
                  <th className="pb-1 font-medium">FS</th>
                  <th className="pb-1 font-medium">Size</th>
                  <th className="pb-1 font-medium">Free</th>
                  <th className="pb-1 font-medium">Used</th>
                </tr>
              </thead>
              <tbody>
                {info.logicalDisks.map((disk) => (
                  <tr
                    key={disk.deviceId}
                    className="border-t border-[var(--color-border)]"
                  >
                    <td className="py-1 text-[var(--color-text)] font-mono">
                      {disk.deviceId}
                    </td>
                    <td className="py-1 text-[var(--color-textSecondary)]">
                      {disk.volumeName || "—"}
                    </td>
                    <td className="py-1 text-[var(--color-textSecondary)]">
                      {disk.fileSystem || "—"}
                    </td>
                    <td className="py-1 text-[var(--color-textSecondary)] font-mono">
                      {formatBytes(disk.size)}
                    </td>
                    <td className="py-1 text-[var(--color-textSecondary)] font-mono">
                      {formatBytes(disk.freeSpace)}
                    </td>
                    <td className="py-1">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-[var(--color-background)] rounded-full overflow-hidden max-w-[80px]">
                          <div
                            className={`h-full rounded-full ${disk.usedPercent > 90 ? "bg-red-400" : "bg-blue-400"}`}
                            style={{
                              width: `${Math.min(disk.usedPercent, 100)}%`,
                            }}
                          />
                        </div>
                        <span className="text-[var(--color-textMuted)] text-[10px]">
                          {disk.usedPercent.toFixed(0)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          {/* Network Adapters */}
          <Section
            icon={<Wifi size={14} className="text-cyan-400" />}
            title={`Network Adapters (${info.networkAdapters.length})`}
          >
            {info.networkAdapters.map((nic, i) => (
              <div
                key={nic.interfaceIndex}
                className={`${i > 0 ? "mt-3 pt-3 border-t border-[var(--color-border)]" : ""}`}
              >
                <h4 className="text-xs font-medium text-[var(--color-text)] mb-2">
                  {nic.netConnectionId || nic.description}
                </h4>
                <InfoGrid>
                  {nic.macAddress && (
                    <InfoItem label="MAC" value={nic.macAddress} mono />
                  )}
                  {nic.ipAddresses.length > 0 && (
                    <InfoItem
                      label="IP"
                      value={nic.ipAddresses.join(", ")}
                      mono
                    />
                  )}
                  {nic.defaultIpGateway.length > 0 && (
                    <InfoItem
                      label="Gateway"
                      value={nic.defaultIpGateway.join(", ")}
                      mono
                    />
                  )}
                  {nic.dnsServers.length > 0 && (
                    <InfoItem
                      label="DNS"
                      value={nic.dnsServers.join(", ")}
                      mono
                    />
                  )}
                  <InfoItem
                    label="DHCP"
                    value={nic.dhcpEnabled ? "Enabled" : "Disabled"}
                  />
                  {nic.speed != null && (
                    <InfoItem
                      label="Speed"
                      value={`${(nic.speed / 1_000_000).toFixed(0)} Mbps`}
                    />
                  )}
                </InfoGrid>
              </div>
            ))}
          </Section>

          {/* Physical Memory */}
          {info.physicalMemory.length > 0 && (
            <Section
              icon={<MemoryStick size={14} className="text-purple-400" />}
              title={`Memory Modules (${info.physicalMemory.length})`}
            >
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[var(--color-textMuted)]">
                    <th className="pb-1 font-medium">Slot</th>
                    <th className="pb-1 font-medium">Size</th>
                    <th className="pb-1 font-medium">Type</th>
                    <th className="pb-1 font-medium">Speed</th>
                    <th className="pb-1 font-medium">Manufacturer</th>
                  </tr>
                </thead>
                <tbody>
                  {info.physicalMemory.map((mem, i) => (
                    <tr
                      key={i}
                      className="border-t border-[var(--color-border)]"
                    >
                      <td className="py-1 text-[var(--color-text)]">
                        {mem.deviceLocator}
                      </td>
                      <td className="py-1 text-[var(--color-textSecondary)] font-mono">
                        {formatBytes(mem.capacity)}
                      </td>
                      <td className="py-1 text-[var(--color-textSecondary)]">
                        {mem.memoryType || mem.formFactor || "—"}
                      </td>
                      <td className="py-1 text-[var(--color-textSecondary)]">
                        {mem.speed ? `${mem.speed} MHz` : "—"}
                      </td>
                      <td className="py-1 text-[var(--color-textSecondary)]">
                        {mem.manufacturer || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}
        </div>
      )}
    </div>
  );
};

const Section: React.FC<{
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}> = ({ icon, title, children }) => (
  <div className="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] p-3">
    <h3 className="text-xs font-medium text-[var(--color-textSecondary)] mb-3 flex items-center gap-1.5">
      {icon}
      {title}
    </h3>
    {children}
  </div>
);

const InfoGrid: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5">
    {children}
  </div>
);

const InfoItem: React.FC<{
  label: string;
  value: string;
  mono?: boolean;
}> = ({ label, value, mono }) => (
  <div className="flex text-xs gap-2">
    <span className="text-[var(--color-textMuted)] shrink-0 w-28">
      {label}
    </span>
    <span
      className={`text-[var(--color-text)] break-all ${mono ? "font-mono text-[10px]" : ""}`}
    >
      {value}
    </span>
  </div>
);

export default SystemInfoPanel;
