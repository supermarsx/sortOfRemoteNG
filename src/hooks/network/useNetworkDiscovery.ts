import { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { DiscoveredHost } from "../../types/connection/connection";
import { NetworkDiscoveryConfig } from "../../types/settings/settings";
import { useConnections } from "../../contexts/useConnections";
import { generateId } from "../../utils/core/id";
import { discoveredHostsToCsv } from "../../utils/discovery/discoveredHostsCsv";
import {
  NetworkScanner,
  type DiscoveryScanStatus,
} from "../../utils/network/networkScanner";
import {
  DEFAULT_DISCOVERY_PROTOCOLS,
  defaultDiscoveryPorts,
} from "../../utils/discovery/discoveryPresets";
import { normalizeImportedProtocol } from "../../utils/connection/normalizeImportedProtocol";
import { invoke } from "@tauri-apps/api/core";

interface UseNetworkDiscoveryParams {
  onClose: () => void;
  native?: boolean;
  allowCreateConnections?: boolean;
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
    if (typeof ip !== "string" || merged.has(ip)) continue;
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
  const abortedToken = Symbol("network-discovery-ping-aborted");
  let abortHandler: (() => void) | undefined;
  const aborted = new Promise<typeof abortedToken>((resolve) => {
    abortHandler = () => resolve(abortedToken);
    signal.addEventListener("abort", abortHandler, { once: true });
  });
  const invoked = invoke<unknown>("scan_network", { subnet, maxConcurrent })
    .then((value) =>
      Array.isArray(value)
        ? value.filter((ip): ip is string => typeof ip === "string")
        : [],
    )
    .catch(() => []);
  const result = await Promise.race([invoked, aborted]);
  if (abortHandler) {
    signal.removeEventListener("abort", abortHandler);
  }
  return result === abortedToken || signal.aborted ? [] : result;
};

export function useNetworkDiscovery({
  onClose,
  native = false,
  allowCreateConnections = true,
}: UseNetworkDiscoveryParams) {
  const { t } = useTranslation();
  const { dispatch } = useConnections();
  const [config, setConfig] = useState<NetworkDiscoveryConfig>({
    enabled: true,
    ipRange: native ? "" : "192.168.1.0/24",
    portRanges: [],
    protocols: [...DEFAULT_DISCOVERY_PROTOCOLS],
    timeout: 5000,
    maxConcurrent: 50,
    maxPortConcurrent: 100,
    customPorts: defaultDiscoveryPorts(),
    identifyServices: true,
    pingMethod: "none",
    pingTimeout: 1000,
    pingPort: 443,
    scanUnresponsiveHosts: true,
    probeStrategies: {
      default: ["websocket"],
      http: ["websocket", "http"],
      https: ["websocket", "http"],
      vnc: ["rfb"],
    },
    cacheTTL: 300000,
    hostnameTtl: 300000,
    macTtl: 300000,
  });
  const [discoveredHosts, setDiscoveredHosts] = useState<DiscoveredHost[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanStatus, setScanStatus] = useState<DiscoveryScanStatus | null>(
    null,
  );
  const [isStopping, setIsStopping] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [scanOutcome, setScanOutcome] = useState<
    "idle" | "running" | "complete" | "stopped" | "failed"
  >("idle");
  const [selectedHosts, setSelectedHosts] = useState<Set<string>>(new Set());
  const [filterText, setFilterText] = useState("");
  const abortControllerRef = useRef<AbortController | null>(null);
  const scannerRef = useRef<NetworkScanner | null>(null);
  const latestStatusRef = useRef<DiscoveryScanStatus | null>(null);
  const scanner = scannerRef.current ?? new NetworkScanner(native);
  scannerRef.current = scanner;

  useEffect(
    () => () => {
      const active = abortControllerRef.current;
      abortControllerRef.current = null;
      active?.abort();
    },
    [],
  );

  useEffect(() => {
    if (!isScanning || startedAt === null) return;
    // Coalesce concurrent native progress events instead of rerendering the
    // complete results/configuration tree once for every socket callback.
    const timer = setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
      const status = latestStatusRef.current;
      if (status) {
        setScanStatus(status);
        setScanProgress(
          status.totalProbes
            ? (status.completedProbes / status.totalProbes) * 100
            : 0,
        );
      }
    }, 250);
    return () => clearInterval(timer);
  }, [isScanning, startedAt]);

  const handleScan = async () => {
    if (abortControllerRef.current) return;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsScanning(true);
    setScanOutcome("running");
    const scanStartedAt = Date.now();
    setStartedAt(scanStartedAt);
    setElapsedMs(0);
    setIsStopping(false);
    setScanStatus(null);
    latestStatusRef.current = null;
    setScanProgress(0);
    setScanError(null);
    setSelectedHosts(new Set());
    setDiscoveredHosts([]);
    try {
      const reportProgress = (progress: number) => {
        if (
          abortControllerRef.current === controller &&
          !controller.signal.aborted
        ) {
          if (!native) setScanProgress(progress);
        }
      };
      const reportStatus = (status: DiscoveryScanStatus) => {
        if (abortControllerRef.current === controller) {
          latestStatusRef.current = status;
          if (status.phase === "preparing" || status.phase === "complete")
            setScanStatus(status);
        }
      };
      const [serviceHosts, pingHosts] = await Promise.all([
        native
          ? scanner.scanNetwork(
              config,
              reportProgress,
              controller.signal,
              reportStatus,
            )
          : scanner.scanNetwork(config, reportProgress, controller.signal),
        native
          ? Promise.resolve([])
          : scanPingHosts(
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
        setScanOutcome("complete");
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setScanOutcome("failed");
        setScanError(error instanceof Error ? error.message : String(error));
        controller.abort();
        console.error("Network scan failed:", error);
      }
    } finally {
      if (abortControllerRef.current === controller) {
        setIsScanning(false);
        if (latestStatusRef.current) {
          setScanStatus(latestStatusRef.current);
          const { completedProbes, totalProbes } = latestStatusRef.current;
          setScanProgress(
            totalProbes ? (completedProbes / totalProbes) * 100 : 0,
          );
        }
        setElapsedMs(Date.now() - scanStartedAt);
        setIsStopping(false);
        if (controller.signal.aborted)
          setScanOutcome((outcome) =>
            outcome === "failed" ? outcome : "stopped",
          );
        abortControllerRef.current = null;
      }
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) setIsStopping(true);
    abortControllerRef.current?.abort();
  };

  const handleCreateConnections = () => {
    if (!allowCreateConnections) return;
    selectedHosts.forEach((hostIp) => {
      const host = discoveredHosts.find((h) => h.ip === hostIp);
      if (!host) return;
      host.services.forEach((service) => {
        // Port evidence decides the protocol; unknown services become `raw`,
        // never RDP.
        const normalized = normalizeImportedProtocol({
          raw: service.protocol,
          port: service.port,
        });
        const connection = {
          id: generateId(),
          name: `${host.hostname || host.ip} (${service.product || service.service})`,
          protocol: normalized.protocol,
          hostname: host.ip,
          port: service.port,
          isGroup: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          description: `Auto-discovered ${service.service} service${service.product ? ` — ${service.product}` : ""}${service.version ? ` (${service.version})` : ""}${service.detection === "port-hint" ? "; port-based hint, type not confirmed" : ""}`,
          tags: ["auto-discovered"],
        };
        dispatch({ type: "ADD_CONNECTION", payload: connection });
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
      (host.hostname?.toLowerCase()?.includes(query) ?? false) ||
      host.services.some((service) =>
        [
          service.service,
          service.protocol,
          service.product,
          service.version,
          service.port.toString(),
        ].some((value) => value?.toLowerCase().includes(query)),
      )
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

  return {
    t,
    config,
    setConfig,
    discoveredHosts,
    isScanning,
    scanError,
    allowCreateConnections,
    scanProgress,
    scanStatus,
    isStopping,
    elapsedMs,
    scanOutcome,
    hasScanned: startedAt !== null,
    native,
    selectedHosts,
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
