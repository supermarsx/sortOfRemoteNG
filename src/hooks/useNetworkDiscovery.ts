import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { DiscoveredHost } from '../types/connection';
import { NetworkDiscoveryConfig } from '../types/settings';
import { useConnections } from '../contexts/useConnections';
import { generateId } from '../utils/id';
import { discoveredHostsToCsv } from '../utils/discoveredHostsCsv';
import { invoke } from '@tauri-apps/api/core';

interface UseNetworkDiscoveryParams {
  onClose: () => void;
}

export function useNetworkDiscovery({ onClose }: UseNetworkDiscoveryParams) {
  const { t } = useTranslation();
  const { dispatch } = useConnections();
  const [config, setConfig] = useState<NetworkDiscoveryConfig>({
    enabled: true,
    ipRange: '192.168.1.0/24',
    portRanges: ['22', '80', '443', '3389', '5900'],
    protocols: ['ssh', 'http', 'https', 'rdp', 'vnc'],
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
      default: ['websocket'],
      http: ['websocket', 'http'],
      https: ['websocket', 'http'],
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
  const [filterText, setFilterText] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleScan = async () => {
    setIsScanning(true);
    setScanProgress(0);
    setDiscoveredHosts([]);
    try {
      const ips: string[] = await invoke('scan_network', {
        subnet: config.ipRange,
      });
      const hosts: DiscoveredHost[] = ips.map((ip) => ({
        ip,
        openPorts: [],
        services: [],
        responseTime: 0,
      }));
      setDiscoveredHosts(hosts);
      setScanProgress(100);
    } catch (error) {
      console.error('Network scan failed:', error);
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
          description: `Auto-discovered ${service.service} service${service.version ? ` (${service.version})` : ''}`,
          tags: ['auto-discovered'],
        };
        dispatch({ type: 'ADD_CONNECTION', payload: connection });
      });
    });
    setSelectedHosts(new Set());
    onClose();
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
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'discovered_hosts.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return {
    t,
    config,
    setConfig,
    discoveredHosts,
    isScanning,
    scanProgress,
    selectedHosts,
    showAdvanced,
    setShowAdvanced,
    filterText,
    setFilterText,
    handleScan,
    handleCreateConnections,
    toggleHostSelection,
    filteredHosts,
    handleExportCSV,
  };
}
