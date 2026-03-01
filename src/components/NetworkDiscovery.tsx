import React from "react";
import {
  X,
  Search,
  Wifi,
  Monitor,
  Database,
  HardDrive,
  Globe,
  Plus,
  Settings,
  Download,
  Radar,
} from "lucide-react";
import { DiscoveredHost, DiscoveredService } from "../types/connection";
import { useNetworkDiscovery } from "../hooks/useNetworkDiscovery";
import { Modal } from "./ui/Modal";

interface NetworkDiscoveryProps {
  isOpen: boolean;
  onClose: () => void;
}

type Mgr = ReturnType<typeof useNetworkDiscovery>;

/* ── Helpers ─────────────────────────────────────────────────────── */

const getServiceIcon = (service: string) => {
  switch (service.toLowerCase()) {
    case "ssh": return Monitor;
    case "http": case "https": return Globe;
    case "rdp": return Monitor;
    case "vnc": return Monitor;
    case "mysql": return Database;
    case "ftp": case "sftp": return HardDrive;
    default: return Wifi;
  }
};

/* ── Sub-components ──────────────────────────────────────────────── */

const DiscoveryHeader: React.FC<{ mgr: Mgr; onClose: () => void }> = ({ mgr, onClose }) => (
  <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
    <div className="flex items-center space-x-3">
      <div className="p-2 bg-purple-500/20 rounded-lg">
        <Radar size={18} className="text-purple-500" />
      </div>
      <h2 className="text-lg font-semibold text-[var(--color-text)]">{mgr.t("networkDiscovery.title")}</h2>
    </div>
    <div className="flex items-center space-x-2">
      <button onClick={() => mgr.setShowAdvanced(!mgr.showAdvanced)} className="px-3 py-1.5 bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded-lg transition-colors flex items-center space-x-2 text-sm">
        <Settings size={14} />
        <span>{mgr.t("networkDiscovery.advanced")}</span>
      </button>
      <button onClick={onClose} className="p-2 hover:bg-[var(--color-surfaceHover)] rounded-lg transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]">
        <X size={18} />
      </button>
    </div>
  </div>
);

const ScanConfig: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
    <div>
      <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">{mgr.t("networkDiscovery.ipRange")}</label>
      <input type="text" value={mgr.config.ipRange} onChange={(e) => mgr.setConfig({ ...mgr.config, ipRange: e.target.value })} className="w-full px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)]" placeholder={mgr.t("networkDiscovery.ipRangePlaceholder")} />
    </div>
    <div>
      <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">{mgr.t("networkDiscovery.timeout")}</label>
      <input type="number" value={mgr.config.timeout} onChange={(e) => mgr.setConfig({ ...mgr.config, timeout: parseInt(e.target.value) })} className="w-full px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)]" min="1000" max="30000" />
    </div>
    <div>
      <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">{mgr.t("networkDiscovery.maxConcurrent")}</label>
      <input type="number" value={mgr.config.maxConcurrent} onChange={(e) => mgr.setConfig({ ...mgr.config, maxConcurrent: parseInt(e.target.value) })} className="w-full px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)]" min="1" max="100" />
    </div>
  </div>
);

const AdvancedConfig: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  if (!mgr.showAdvanced) return null;
  return (
    <div className="bg-[var(--color-border)] rounded-lg p-4 mb-4">
      <h3 className="text-lg font-medium text-[var(--color-text)] mb-4">{mgr.t("networkDiscovery.advancedConfig")}</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">{mgr.t("networkDiscovery.portRanges")}</label>
          <input type="text" value={mgr.config.portRanges.join(", ")} onChange={(e) => mgr.setConfig({ ...mgr.config, portRanges: e.target.value.split(",").map((p) => p.trim()) })} className="w-full px-3 py-2 bg-gray-600 border border-[var(--color-border)] rounded-md text-[var(--color-text)]" placeholder={mgr.t("networkDiscovery.portRangesPlaceholder")} />
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">{mgr.t("networkDiscovery.protocols")}</label>
          <div className="flex flex-wrap gap-2">
            {["ssh", "http", "https", "rdp", "vnc", "mysql", "ftp", "telnet"].map((protocol) => (
              <label key={protocol} className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={mgr.config.protocols.includes(protocol)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      mgr.setConfig({ ...mgr.config, protocols: [...mgr.config.protocols, protocol] });
                    } else {
                      mgr.setConfig({ ...mgr.config, protocols: mgr.config.protocols.filter((p) => p !== protocol) });
                    }
                  }}
                  className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600"
                />
                <span className="text-[var(--color-textSecondary)] text-sm">{protocol.toUpperCase()}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const ScanControls: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <>
    <div className="flex items-center space-x-4">
      <button onClick={mgr.handleScan} disabled={mgr.isScanning} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-[var(--color-text)] rounded-md transition-colors flex items-center space-x-2">
        <Search size={16} />
        <span>{mgr.isScanning ? mgr.t("networkDiscovery.scanning") : mgr.t("networkDiscovery.scan")}</span>
      </button>
      {mgr.selectedHosts.size > 0 && (
        <button onClick={mgr.handleCreateConnections} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-[var(--color-text)] rounded-md transition-colors flex items-center space-x-2">
          <Plus size={16} />
          <span>{mgr.t("networkDiscovery.createConnections", { count: mgr.selectedHosts.size })}</span>
        </button>
      )}
    </div>
    {mgr.isScanning && (
      <div className="mt-4">
        <div className="w-full bg-[var(--color-border)] rounded-full h-2">
          <div className="bg-blue-600 h-2 rounded-full transition-all duration-300" style={{ width: `${mgr.scanProgress}%` }} />
        </div>
      </div>
    )}
  </>
);

const HostCard: React.FC<{ mgr: Mgr; host: DiscoveredHost }> = ({ mgr, host }) => (
  <div
    className={`bg-[var(--color-border)] rounded-lg p-4 border-2 transition-colors cursor-pointer ${mgr.selectedHosts.has(host.ip) ? "border-blue-500 bg-blue-900/20" : "border-[var(--color-border)] hover:border-[var(--color-border)]"}`}
    onClick={() => mgr.toggleHostSelection(host.ip)}
  >
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center space-x-3">
        <input type="checkbox" checked={mgr.selectedHosts.has(host.ip)} onChange={() => mgr.toggleHostSelection(host.ip)} className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600" />
        <div>
          <h4 className="text-[var(--color-text)] font-medium">{host.hostname || host.ip}</h4>
          {host.hostname && <p className="text-[var(--color-textSecondary)] text-sm">{host.ip}</p>}
        </div>
      </div>
      <div className="text-right">
        <p className="text-[var(--color-textSecondary)] text-sm">{mgr.t("networkDiscovery.responseTime", { ms: host.responseTime })}</p>
        {host.macAddress && <p className="text-gray-500 text-xs">{mgr.t("networkDiscovery.macAddress", { mac: host.macAddress })}</p>}
      </div>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {host.services.map((service, index) => {
        const ServiceIcon = getServiceIcon(service.service);
        return (
          <div key={index} className="bg-gray-600 rounded-lg p-3 flex items-center space-x-3">
            <ServiceIcon size={20} className="text-blue-400" />
            <div className="flex-1 min-w-0">
              <p className="text-[var(--color-text)] font-medium">{service.service.toUpperCase()}</p>
              <p className="text-[var(--color-textSecondary)] text-sm">{mgr.t("networkDiscovery.port", { port: service.port })}</p>
              {service.version && <p className="text-gray-500 text-xs truncate">{service.version}</p>}
            </div>
          </div>
        );
      })}
    </div>
  </div>
);

const HostsList: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  if (mgr.discoveredHosts.length === 0) return null;
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium text-[var(--color-text)]">{mgr.t("networkDiscovery.discoveredHosts", { count: mgr.filteredHosts.length })}</h3>
        <div className="flex items-center space-x-2">
          <input type="text" value={mgr.filterText} onChange={(e) => mgr.setFilterText(e.target.value)} placeholder={mgr.t("networkDiscovery.filterPlaceholder")} className="px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)]" />
          <button onClick={mgr.handleExportCSV} className="px-3 py-2 bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded-md transition-colors flex items-center space-x-2">
            <Download size={14} />
            <span>{mgr.t("networkDiscovery.exportCsv")}</span>
          </button>
        </div>
      </div>
      <div className="space-y-4">
        {mgr.filteredHosts.map((host) => (
          <HostCard key={host.ip} mgr={mgr} host={host} />
        ))}
      </div>
    </div>
  );
};

const EmptyState: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  if (mgr.isScanning || mgr.discoveredHosts.length > 0) return null;
  return (
    <div className="text-center py-12">
      <Search size={48} className="mx-auto text-gray-500 mb-4" />
      <p className="text-[var(--color-textSecondary)]">{mgr.t("networkDiscovery.noHosts")}</p>
    </div>
  );
};

/* ── Root component ──────────────────────────────────────────────── */

export const NetworkDiscovery: React.FC<NetworkDiscoveryProps> = ({
  isOpen,
  onClose,
}) => {
  const mgr = useNetworkDiscovery({ onClose });

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      closeOnBackdrop
      closeOnEscape
      backdropClassName="bg-black/50"
      panelClassName="max-w-6xl mx-4 max-h-[90vh] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-xl"
    >
      <div className="overflow-hidden">
        <DiscoveryHeader mgr={mgr} onClose={onClose} />
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
          <div className="mb-6">
            <ScanConfig mgr={mgr} />
            <AdvancedConfig mgr={mgr} />
            <ScanControls mgr={mgr} />
          </div>
          <HostsList mgr={mgr} />
          <EmptyState mgr={mgr} />
        </div>
      </div>
    </Modal>
  );
};
