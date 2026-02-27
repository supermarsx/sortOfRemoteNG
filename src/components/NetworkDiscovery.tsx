import React, { useState, useRef } from "react";
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
import { useTranslation } from "react-i18next";
import { DiscoveredHost, DiscoveredService } from "../types/connection";
import { NetworkDiscoveryConfig } from "../types/settings";
import { useConnections } from "../contexts/useConnections";
import { generateId } from "../utils/id";
import { discoveredHostsToCsv } from "../utils/discoveredHostsCsv";
import { invoke } from "@tauri-apps/api/core";

interface NetworkDiscoveryProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NetworkDiscovery: React.FC<NetworkDiscoveryProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const { dispatch } = useConnections();
  const [config, setConfig] = useState<NetworkDiscoveryConfig>({
    enabled: true,
    ipRange: "192.168.1.0/24",
    portRanges: ["22", "80", "443", "3389", "5900"],
    protocols: ["ssh", "http", "https", "rdp", "vnc"],
    timeout: 5000,
    maxConcurrent: 50,
    maxPortConcurrent: 100,
    customPorts: {
      ssh: [22],
      http: [80, 8080, 8000],
      https: [443, 8443],
      rdp: [3389],
      vnc: [5900, 5901, 5902],
      mysql: [3306],
      ftp: [21],
      telnet: [23],
    },
    probeStrategies: {
      default: ["websocket"],
      http: ["websocket", "http"],
      https: ["websocket", "http"],
    },
    cacheTTL: 300000,
    hostnameTtl: 300000,
    macTtl: 300000,
  });
  const [discoveredHosts, setDiscoveredHosts] = useState<DiscoveredHost[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [selectedHosts, setSelectedHosts] = useState<Set<string>>(new Set());
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [filterText, setFilterText] = useState("");
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleScan = async () => {
    setIsScanning(true);
    setScanProgress(0);
    setDiscoveredHosts([]);

    try {
      // Use Tauri IPC to scan network
      const ips: string[] = await invoke('scan_network', { subnet: config.ipRange });
      
      // Convert IP addresses to DiscoveredHost format
      const hosts: DiscoveredHost[] = ips.map(ip => ({
        ip,
        openPorts: [],
        services: [],
        responseTime: 0,
      }));

      setDiscoveredHosts(hosts);
      setScanProgress(100);
    } catch (error) {
      console.error("Network scan failed:", error);
    } finally {
      setIsScanning(false);
    }
  };

  const handleCreateConnections = () => {
    selectedHosts.forEach((hostIp) => {
      const host = discoveredHosts.find((h) => h.ip === hostIp);
      if (!host) return;

      host.services.forEach((service) => {
        const connection = {
          id: generateId(),
          name: `${host.hostname || host.ip} (${service.service})`,
          protocol: service.protocol as any,
          hostname: host.ip,
          port: service.port,
          isGroup: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          description: `Auto-discovered ${service.service} service${service.version ? ` (${service.version})` : ""}`,
          tags: ["auto-discovered"],
        };

        dispatch({ type: "ADD_CONNECTION", payload: connection });
      });
    });

    setSelectedHosts(new Set());
    onClose();
  };

  const getServiceIcon = (service: string) => {
    switch (service.toLowerCase()) {
      case "ssh":
        return Monitor;
      case "http":
      case "https":
        return Globe;
      case "rdp":
        return Monitor;
      case "vnc":
        return Monitor;
      case "mysql":
        return Database;
      case "ftp":
      case "sftp":
        return HardDrive;
      default:
        return Wifi;
    }
  };

  const toggleHostSelection = (hostIp: string) => {
    const newSelection = new Set(selectedHosts);
    if (newSelection.has(hostIp)) {
      newSelection.delete(hostIp);
    } else {
      newSelection.add(hostIp);
    }
    setSelectedHosts(newSelection);
  };

  const filteredHosts = discoveredHosts.filter((host) => {
    const query = filterText.toLowerCase();
    return (
      host.ip.toLowerCase().includes(query) ||
      (host.hostname?.toLowerCase()?.includes(query) ?? false)
    );
  });

  const handleExportCSV = () => {
    const csv = discoveredHostsToCsv(filteredHosts);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "discovered_hosts.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[var(--color-surface)] rounded-xl shadow-xl w-full max-w-6xl mx-4 max-h-[90vh] overflow-hidden border border-[var(--color-border)]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-purple-500/20 rounded-lg">
              <Radar size={18} className="text-purple-500" />
            </div>
            <h2 className="text-lg font-semibold text-[var(--color-text)]">
              {t("networkDiscovery.title")}
            </h2>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="px-3 py-1.5 bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded-lg transition-colors flex items-center space-x-2 text-sm"
            >
              <Settings size={14} />
              <span>{t("networkDiscovery.advanced")}</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-[var(--color-surfaceHover)] rounded-lg transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
          {/* Scan Configuration */}
          <div className="mb-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                  {t("networkDiscovery.ipRange")}
                </label>
                <input
                  type="text"
                  value={config.ipRange}
                  onChange={(e) =>
                    setConfig({ ...config, ipRange: e.target.value })
                  }
                  className="w-full px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
                  placeholder={t("networkDiscovery.ipRangePlaceholder")}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                  {t("networkDiscovery.timeout")}
                </label>
                <input
                  type="number"
                  value={config.timeout}
                  onChange={(e) =>
                    setConfig({ ...config, timeout: parseInt(e.target.value) })
                  }
                  className="w-full px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
                  min="1000"
                  max="30000"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                  {t("networkDiscovery.maxConcurrent")}
                </label>
                <input
                  type="number"
                  value={config.maxConcurrent}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      maxConcurrent: parseInt(e.target.value),
                    })
                  }
                  className="w-full px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
                  min="1"
                  max="100"
                />
              </div>
            </div>

            {showAdvanced && (
              <div className="bg-[var(--color-border)] rounded-lg p-4 mb-4">
                <h3 className="text-lg font-medium text-[var(--color-text)] mb-4">
                  {t("networkDiscovery.advancedConfig")}
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                      {t("networkDiscovery.portRanges")}
                    </label>
                    <input
                      type="text"
                      value={config.portRanges.join(", ")}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          portRanges: e.target.value
                            .split(",")
                            .map((p) => p.trim()),
                        })
                      }
                      className="w-full px-3 py-2 bg-gray-600 border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
                      placeholder={t("networkDiscovery.portRangesPlaceholder")}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                      {t("networkDiscovery.protocols")}
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {[
                        "ssh",
                        "http",
                        "https",
                        "rdp",
                        "vnc",
                        "mysql",
                        "ftp",
                        "telnet",
                      ].map((protocol) => (
                        <label
                          key={protocol}
                          className="flex items-center space-x-2"
                        >
                          <input
                            type="checkbox"
                            checked={config.protocols.includes(protocol)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setConfig({
                                  ...config,
                                  protocols: [...config.protocols, protocol],
                                });
                              } else {
                                setConfig({
                                  ...config,
                                  protocols: config.protocols.filter(
                                    (p) => p !== protocol,
                                  ),
                                });
                              }
                            }}
                            className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600"
                          />
                          <span className="text-[var(--color-textSecondary)] text-sm">
                            {protocol.toUpperCase()}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center space-x-4">
              <button
                onClick={handleScan}
                disabled={isScanning}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-[var(--color-text)] rounded-md transition-colors flex items-center space-x-2"
              >
                <Search size={16} />
                <span>{isScanning ? t("networkDiscovery.scanning") : t("networkDiscovery.scan")}</span>
              </button>

              {selectedHosts.size > 0 && (
                <button
                  onClick={handleCreateConnections}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-[var(--color-text)] rounded-md transition-colors flex items-center space-x-2"
                >
                  <Plus size={16} />
                  <span>
                    {t("networkDiscovery.createConnections", {
                      count: selectedHosts.size,
                    })}
                  </span>
                </button>
              )}
            </div>

            {isScanning && (
              <div className="mt-4">
                <div className="w-full bg-[var(--color-border)] rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${scanProgress}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Discovered Hosts */}
          {discoveredHosts.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-[var(--color-text)]">
                  {t("networkDiscovery.discoveredHosts", {
                    count: filteredHosts.length,
                  })}
                </h3>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={filterText}
                    onChange={(e) => setFilterText(e.target.value)}
                    placeholder={t("networkDiscovery.filterPlaceholder")}
                    className="px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
                  />
                  <button
                    onClick={handleExportCSV}
                    className="px-3 py-2 bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded-md transition-colors flex items-center space-x-2"
                  >
                    <Download size={14} />
                    <span>{t("networkDiscovery.exportCsv")}</span>
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                {filteredHosts.map((host) => (
                  <div
                    key={host.ip}
                    className={`bg-[var(--color-border)] rounded-lg p-4 border-2 transition-colors cursor-pointer ${
                      selectedHosts.has(host.ip)
                        ? "border-blue-500 bg-blue-900/20"
                        : "border-[var(--color-border)] hover:border-[var(--color-border)]"
                    }`}
                    onClick={() => toggleHostSelection(host.ip)}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center space-x-3">
                        <input
                          type="checkbox"
                          checked={selectedHosts.has(host.ip)}
                          onChange={() => toggleHostSelection(host.ip)}
                          className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600"
                        />
                        <div>
                          <h4 className="text-[var(--color-text)] font-medium">
                            {host.hostname || host.ip}
                          </h4>
                          {host.hostname && (
                            <p className="text-[var(--color-textSecondary)] text-sm">{host.ip}</p>
                          )}
                        </div>
                      </div>

                      <div className="text-right">
                        <p className="text-[var(--color-textSecondary)] text-sm">
                          {t("networkDiscovery.responseTime", {
                            ms: host.responseTime,
                          })}
                        </p>
                        {host.macAddress && (
                          <p className="text-gray-500 text-xs">
                            {t("networkDiscovery.macAddress", {
                              mac: host.macAddress,
                            })}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {host.services.map((service, index) => {
                        const ServiceIcon = getServiceIcon(service.service);
                        return (
                          <div
                            key={index}
                            className="bg-gray-600 rounded-lg p-3 flex items-center space-x-3"
                          >
                            <ServiceIcon size={20} className="text-blue-400" />
                            <div className="flex-1 min-w-0">
                              <p className="text-[var(--color-text)] font-medium">
                                {service.service.toUpperCase()}
                              </p>
                              <p className="text-[var(--color-textSecondary)] text-sm">
                                {t("networkDiscovery.port", {
                                  port: service.port,
                                })}
                              </p>
                              {service.version && (
                                <p className="text-gray-500 text-xs truncate">
                                  {service.version}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!isScanning && discoveredHosts.length === 0 && (
            <div className="text-center py-12">
              <Search size={48} className="mx-auto text-gray-500 mb-4" />
              <p className="text-[var(--color-textSecondary)]">{t("networkDiscovery.noHosts")}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
