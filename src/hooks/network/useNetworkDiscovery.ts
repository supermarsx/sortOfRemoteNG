import { useEffect, useState, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  DiscoveredHost,
  DiscoveredService,
} from "../../types/connection/connection";
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
import { useDiscoveryTargets } from "./useDiscoveryTargets";
import { useDiscoveryScanHistory } from "./useDiscoveryScanHistory";
import type { SavedDiscoveryScan } from "../../utils/discovery/scanHistory";
import {
  discoveryEndpoints,
  discoveryServiceKey,
  type DiscoveryEndpoint,
} from "../../utils/discovery/discoverySelection";

interface UseNetworkDiscoveryParams {
  onClose: () => void;
  native?: boolean;
  allowCreateConnections?: boolean;
}

const cloneDiscoveredHost = (host: DiscoveredHost): DiscoveredHost => ({
  ...host,
  openPorts: [...host.openPorts],
  services: host.services.map((service) => ({ ...service })),
  ...(host.discoveryProbes
    ? { discoveryProbes: host.discoveryProbes.map((probe) => ({ ...probe })) }
    : {}),
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
  const targets = useDiscoveryTargets(native);
  const scanHistory = useDiscoveryScanHistory();
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
    adaptiveConcurrency: true,
    nativeBatchProbes: true,
    absoluteMaxProbes: 256,
    maxCpuPercent: 80,
    maxNetworkUtilizationPercent: 75,
    workerLaunchIntervalMs: 25,
    probeLaunchIntervalMs: 0,
    resolveHostnames: true,
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
  const [isPaused, setIsPaused] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [scanOutcome, setScanOutcome] = useState<
    "idle" | "running" | "complete" | "stopped" | "failed"
  >("idle");
  const [saveStatus, setSaveStatus] = useState<
    "unsaved" | "saving" | "saved" | "error"
  >("unsaved");
  const [saveError, setSaveError] = useState<string | null>(null);
  // Private terminal copy: edits to targets, filters or live hosts cannot change it.
  const snapshotRef = useRef<{
    scan: SavedDiscoveryScan;
    saving: boolean;
    saved: boolean;
  } | null>(null);
  useEffect(() => {
    const snapshot = snapshotRef.current;
    if (
      snapshot?.saved &&
      !scanHistory.loading &&
      !scanHistory.scans.some((scan) => scan.id === snapshot.scan.id)
    ) {
      // Deleting history removes only the saved copy, not the current results.
      // Keep the save badge honest and allow an explicit save again.
      snapshot.saved = false;
      setSaveStatus("unsaved");
      setSaveError(null);
    }
  }, [scanHistory.scans, scanHistory.loading]);
  const [selectedServices, setSelectedServices] = useState<Set<string>>(
    new Set(),
  );
  const endpoints = useMemo(
    () => discoveryEndpoints(discoveredHosts),
    [discoveredHosts],
  );
  const endpointByKey = useMemo(
    () => new Map(endpoints.map((endpoint) => [endpoint.key, endpoint])),
    [endpoints],
  );
  // Compatibility: hosts with at least one selected service; not creation scope.
  const selectedHosts = useMemo(
    () =>
      new Set(
        endpoints
          .filter(({ key }) => selectedServices.has(key))
          .map(({ host }) => host.ip),
      ),
    [endpoints, selectedServices],
  );
  const [filterText, setFilterText] = useState("");
  const abortControllerRef = useRef<AbortController | null>(null);
  const scannerRef = useRef<NetworkScanner | null>(null);
  const latestStatusRef = useRef<DiscoveryScanStatus | null>(null);
  const liveHostsRef = useRef(new Map<string, DiscoveredHost>());
  const liveHostsDirty = useRef(false);
  const scanner = scannerRef.current ?? new NetworkScanner(native);
  scannerRef.current = scanner;

  useEffect(
    () => () => {
      const active = abortControllerRef.current;
      abortControllerRef.current = null;
      snapshotRef.current = null;
      active?.abort();
    },
    [],
  );

  useEffect(() => {
    if (!isScanning || startedAt === null) return;
    // Coalesce concurrent native progress events instead of rerendering the
    // complete results/configuration tree once for every socket callback.
    const timer = setInterval(() => {
      if (!abortControllerRef.current) return;
      setElapsedMs(Date.now() - startedAt);
      if (liveHostsDirty.current) {
        setDiscoveredHosts([...liveHostsRef.current.values()]);
        liveHostsDirty.current = false;
      }
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
    if (abortControllerRef.current || snapshotRef.current?.saving) return;
    snapshotRef.current = null;
    setSaveStatus("unsaved");
    setSaveError(null);
    targets.remember(config.ipRange);
    const scanConfig = structuredClone(config);
    const scanId = generateId();
    let finalOutcome: SavedDiscoveryScan["outcome"] = "complete";
    let finalHosts: DiscoveredHost[] = [];
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsScanning(true);
    setScanOutcome("running");
    const scanStartedAt = Date.now();
    setStartedAt(scanStartedAt);
    setElapsedMs(0);
    setIsStopping(false);
    setIsPaused(false);
    liveHostsRef.current.clear();
    liveHostsDirty.current = false;
    setScanStatus(null);
    latestStatusRef.current = null;
    setScanProgress(0);
    setScanError(null);
    setSelectedServices(new Set());
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
              (host) => {
                if (
                  abortControllerRef.current === controller &&
                  !controller.signal.aborted
                ) {
                  liveHostsRef.current.set(host.ip, cloneDiscoveredHost(host));
                  liveHostsDirty.current = true;
                }
              },
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
      // Native discovery returns only observations accepted before cancellation.
      // The legacy browser scanner can settle late with stale results.
      if (native || !controller.signal.aborted)
        finalHosts = mergeDiscoveredHosts(serviceHosts, pingHosts);
      if (
        abortControllerRef.current === controller &&
        !controller.signal.aborted
      ) {
        setDiscoveredHosts(finalHosts);
        setScanProgress(100);
        setScanOutcome("complete");
      }
    } catch (error) {
      if (
        abortControllerRef.current === controller &&
        !controller.signal.aborted
      ) {
        finalOutcome = "failed";
        setScanOutcome("failed");
        setScanError(error instanceof Error ? error.message : String(error));
        controller.abort();
        console.error("Network scan failed:", error);
      }
    } finally {
      if (abortControllerRef.current === controller) {
        if (controller.signal.aborted && finalOutcome !== "failed")
          finalOutcome = "stopped";
        if (finalOutcome !== "complete") {
          // A stopped run returns its already observed hosts after draining.
          // Keep them even if its last UI snapshot had been coalesced.
          finalHosts = mergeDiscoveredHosts(
            [...liveHostsRef.current.values(), ...finalHosts],
            [],
          );
          setDiscoveredHosts(finalHosts);
        }
        liveHostsDirty.current = false;
        setIsScanning(false);
        setIsPaused(false);
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
        snapshotRef.current = {
          scan: structuredClone({
            id: scanId,
            config: scanConfig,
            startedAt: scanStartedAt,
            elapsedMs: Date.now() - scanStartedAt,
            outcome: finalOutcome,
            hosts: finalHosts,
          }),
          saving: false,
          saved: false,
        };
      }
    }
  };

  const handleSaveToHistory = async () => {
    const snapshot = snapshotRef.current;
    if (
      abortControllerRef.current ||
      !snapshot ||
      snapshot.saving ||
      snapshot.saved
    )
      return;
    snapshot.saving = true;
    setSaveStatus("saving");
    setSaveError(null);
    try {
      // Retry the same ID and contents, never a fresh snapshot of editable state.
      await scanHistory.saveScan(structuredClone(snapshot.scan));
      snapshot.saved = true;
      if (snapshotRef.current === snapshot) setSaveStatus("saved");
    } catch (cause) {
      if (snapshotRef.current === snapshot) {
        setSaveStatus("error");
        setSaveError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      snapshot.saving = false;
    }
  };

  const handleDiscardResults = () => {
    if (abortControllerRef.current || snapshotRef.current?.saving) return;
    snapshotRef.current = null;
    liveHostsRef.current.clear();
    liveHostsDirty.current = false;
    latestStatusRef.current = null;
    setDiscoveredHosts([]);
    setSelectedServices(new Set());
    setFilterText("");
    setScanStatus(null);
    setScanProgress(0);
    setScanError(null);
    setStartedAt(null);
    setElapsedMs(0);
    setScanOutcome("idle");
    setSaveStatus("unsaved");
    setSaveError(null);
  };

  const handleStop = () => {
    if (abortControllerRef.current) setIsStopping(true);
    abortControllerRef.current?.abort();
  };

  const handlePauseResume = () => {
    if (!abortControllerRef.current || isStopping) return;
    if (isPaused) scanner.resume();
    else scanner.pause();
    setIsPaused(!isPaused);
  };

  const createEndpointConnection = ({ host, service }: DiscoveryEndpoint) => {
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
  };

  const handleCreateConnections = () => {
    if (!allowCreateConnections) return;
    const selected = endpoints.filter(({ key }) => selectedServices.has(key));
    if (selected.length === 0) return;
    selected.forEach(createEndpointConnection);
    setSelectedServices(new Set());
    onClose();
  };

  const handleCreateServiceConnection = (
    host: DiscoveredHost,
    service: DiscoveredService,
  ) => {
    if (!allowCreateConnections) return;
    const key = discoveryServiceKey(host.ip, service);
    const endpoint = endpointByKey.get(key);
    if (!endpoint) return;
    createEndpointConnection(endpoint);
    setSelectedServices((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    onClose();
  };

  const toggleServiceSelection = (
    hostIp: string,
    service: DiscoveredService,
  ) => {
    const key = discoveryServiceKey(hostIp, service);
    if (!endpointByKey.has(key)) return;
    setSelectedServices((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleHostSelection = (hostIp: string) => {
    const keys = endpoints
      .filter(({ host }) => host.ip === hostIp)
      .map(({ key }) => key);
    if (keys.length === 0) return;
    setSelectedServices((current) => {
      const next = new Set(current);
      const allSelected = keys.every((key) => next.has(key));
      for (const key of keys) {
        if (allSelected) next.delete(key);
        else next.add(key);
      }
      return next;
    });
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
    targets,
    scanHistory,
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
    isPaused,
    elapsedMs,
    scanOutcome,
    saveStatus,
    saveError,
    canSaveToHistory:
      !isScanning &&
      (scanOutcome === "complete" ||
        scanOutcome === "stopped" ||
        scanOutcome === "failed") &&
      saveStatus !== "saving" &&
      saveStatus !== "saved",
    canDiscardResults:
      !isScanning && startedAt !== null && saveStatus !== "saving",
    hasScanned: startedAt !== null,
    native,
    selectedHosts,
    selectedServices,
    filterText,
    setFilterText,
    handleScan,
    handleStop,
    handlePauseResume,
    handleSaveToHistory,
    handleDiscardResults,
    handleCreateConnections,
    handleCreateServiceConnection,
    toggleServiceSelection,
    toggleHostSelection,
    filteredHosts,
    handleExportCSV,
  };
}
