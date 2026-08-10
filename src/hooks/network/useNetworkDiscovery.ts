import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { DiscoveredHost } from '../../types/connection/connection';
import { NetworkDiscoveryConfig } from '../../types/settings/settings';
import { useConnections } from '../../contexts/useConnections';
import { generateId } from '../../utils/core/id';
import { discoveredHostsToCsv } from '../../utils/discovery/discoveredHostsCsv';
import { NetworkScanner } from '../../utils/network/networkScanner';
import { invoke } from '@tauri-apps/api/core';

interface UseNetworkDiscoveryParams {
  onClose: () => void;
}

const cloneDiscoveredHost = (host: DiscoveredHost): DiscoveredHost => ({
  ...host,
  openPorts: [...host.openPorts],
  services: host.services.map((service) => ({ ...service })),
});

const mergeDiscoveredHosts = (
  serviceHosts: DiscoveredHost[],
  pingHosts: string[],
): DiscoveredHost[] => {
  const merged = new Map(
    serviceHosts.map((host) => [host.ip, cloneDiscoveredHost(host)]),
  );
  for (const ip of pingHosts) {
    if (typeof ip !== 'string' || merged.has(ip)) continue;
    merged.set(ip, {
      ip,
      openPorts: [],
      services: [],
      responseTime: 0,
    });
  }
  return Array.from(merged.values()).sort((a, b) =>
    a.ip.localeCompare(b.ip, undefined, { numeric: true }),
  );
};

const scanPingHosts = async (
  subnet: string,
  maxConcurrent: number,
  signal: AbortSignal,
): Promise<string[]> => {
  if (signal.aborted) return [];
  const abortedToken = Symbol('network-discovery-ping-aborted');
  let abortHandler: (() => void) | undefined;
  const aborted = new Promise<typeof abortedToken>((resolve) => {
    abortHandler = () => resolve(abortedToken);
    signal.addEventListener('abort', abortHandler, { once: true });
  });
  const invoked = invoke<unknown>('scan_network', { subnet, maxConcurrent })
    .then((value) =>
      Array.isArray(value)
        ? value.filter((ip): ip is string => typeof ip === 'string')
        : [],
    )
    .catch(() => []);
  const result = await Promise.race([invoked, aborted]);
  if (abortHandler) {
    signal.removeEventListener('abort', abortHandler);
  }
  return result === abortedToken || signal.aborted ? [] : result;
};

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
      vnc: ['rfb'],
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
  const scannerRef = useRef<NetworkScanner | null>(null);
  const scanner = scannerRef.current ?? new NetworkScanner();
  scannerRef.current = scanner;

  useEffect(
    () => () => {
      abortControllerRef.current?.abort();
    },
    [],
  );

  const handleScan = async () => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsScanning(true);
    setScanProgress(0);
    setDiscoveredHosts([]);
    try {
      const [serviceHosts, pingHosts] = await Promise.all([
        scanner.scanNetwork(
          config,
          (progress) => {
            if (
              abortControllerRef.current === controller &&
              !controller.signal.aborted
            ) {
              setScanProgress(progress);
            }
          },
          controller.signal,
        ),
        scanPingHosts(
          config.ipRange,
          config.maxConcurrent,
          controller.signal,
        ),
      ]);
      if (
        abortControllerRef.current === controller &&
        !controller.signal.aborted
      ) {
        setDiscoveredHosts(mergeDiscoveredHosts(serviceHosts, pingHosts));
        setScanProgress(100);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error('Network scan failed:', error);
      }
    } finally {
      if (abortControllerRef.current === controller) {
        setIsScanning(false);
        abortControllerRef.current = null;
      }
    }
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
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
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
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
    handleStop,
    handleCreateConnections,
    toggleHostSelection,
    filteredHosts,
    handleExportCSV,
  };
}
