import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type {
  DockerSystemInfo,
  ContainerSummary,
  ContainerInspect,
  ContainerStats,
  ImageSummary,
  VolumeInfo,
  NetworkInfo,
  ComposeProject,
  CreateVolumeConfig,
  CreateNetworkConfig,
  ComposeUpConfig,
  ComposeDownConfig,
} from '../../types/protocols/docker';

export type DockerConnectionState = 'disconnected' | 'connecting' | 'connected';
export type DockerTab = 'dashboard' | 'containers' | 'images' | 'volumes' | 'networks' | 'compose';

export function useDocker(connectionId: string, isOpen: boolean) {
  const [connectionState, setConnectionState] = useState<DockerConnectionState>('disconnected');
  const [activeTab, setActiveTab] = useState<DockerTab>('dashboard');
  const [systemInfo, setSystemInfo] = useState<DockerSystemInfo | null>(null);
  const [containers, setContainers] = useState<ContainerSummary[]>([]);
  const [images, setImages] = useState<ImageSummary[]>([]);
  const [volumes, setVolumes] = useState<VolumeInfo[]>([]);
  const [networks, setNetworks] = useState<NetworkInfo[]>([]);
  const [composeProjects, setComposeProjects] = useState<ComposeProject[]>([]);
  const [selectedContainerId, setSelectedContainerId] = useState<string | null>(null);
  const [containerInspect, setContainerInspect] = useState<ContainerInspect | null>(null);
  const [containerLogs, setContainerLogs] = useState('');
  const [containerStats, setContainerStats] = useState<ContainerStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const call = useCallback(async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<T>(cmd, { connectionId, ...args });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  // ── Data refresh helpers ──────────────────────────────────────────────────

  const refreshSystemInfo = useCallback(async () => {
    const info = await call<DockerSystemInfo>('docker_system_info');
    setSystemInfo(info);
    return info;
  }, [call]);

  const refreshContainers = useCallback(async () => {
    const list = await call<ContainerSummary[]>('docker_list_containers', { all: true });
    setContainers(list);
    return list;
  }, [call]);

  const refreshImages = useCallback(async () => {
    const list = await call<ImageSummary[]>('docker_list_images');
    setImages(list);
    return list;
  }, [call]);

  const refreshVolumes = useCallback(async () => {
    const list = await call<VolumeInfo[]>('docker_list_volumes');
    setVolumes(list);
    return list;
  }, [call]);

  const refreshNetworks = useCallback(async () => {
    const list = await call<NetworkInfo[]>('docker_list_networks');
    setNetworks(list);
    return list;
  }, [call]);

  const refreshCompose = useCallback(async () => {
    const list = await call<ComposeProject[]>('docker_compose_list_projects');
    setComposeProjects(list);
    return list;
  }, [call]);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        refreshSystemInfo(),
        refreshContainers(),
        refreshImages(),
        refreshVolumes(),
        refreshNetworks(),
      ]);
    } catch {
      // individual errors already captured by call()
    } finally {
      setRefreshing(false);
    }
  }, [refreshSystemInfo, refreshContainers, refreshImages, refreshVolumes, refreshNetworks]);

  // ── Connection lifecycle ──────────────────────────────────────────────────

  const connect = useCallback(async () => {
    setConnectionState('connecting');
    try {
      await call<void>('docker_connect');
      setConnectionState('connected');
      await refreshAll();
    } catch {
      setConnectionState('disconnected');
    }
  }, [call, refreshAll]);

  const disconnect = useCallback(async () => {
    try {
      await call<void>('docker_disconnect');
    } finally {
      setConnectionState('disconnected');
      setSystemInfo(null);
      setContainers([]);
      setImages([]);
      setVolumes([]);
      setNetworks([]);
      setComposeProjects([]);
      setSelectedContainerId(null);
      setContainerInspect(null);
      setContainerLogs('');
      setContainerStats(null);
    }
  }, [call]);

  // ── Container actions ─────────────────────────────────────────────────────

  const inspectContainer = useCallback(async (containerId: string) => {
    const data = await call<ContainerInspect>('docker_inspect_container', { containerId });
    setContainerInspect(data);
    return data;
  }, [call]);

  const getContainerLogs = useCallback(async (containerId: string) => {
    const logs = await call<string>('docker_container_logs', {
      containerId,
      options: { stdout: true, stderr: true, tail: '500', timestamps: true },
    });
    setContainerLogs(logs);
    return logs;
  }, [call]);

  const clearContainerLogs = useCallback(() => {
    setContainerLogs('');
  }, []);

  const getContainerStats = useCallback(async (containerId: string) => {
    const stats = await call<ContainerStats>('docker_container_stats', { containerId });
    setContainerStats(stats);
    return stats;
  }, [call]);

  const startContainer = useCallback(async (containerId: string) => {
    await call<void>('docker_start_container', { containerId });
    await refreshContainers();
  }, [call, refreshContainers]);

  const stopContainer = useCallback(async (containerId: string) => {
    await call<void>('docker_stop_container', { containerId });
    await refreshContainers();
  }, [call, refreshContainers]);

  const restartContainer = useCallback(async (containerId: string) => {
    await call<void>('docker_restart_container', { containerId });
    await refreshContainers();
  }, [call, refreshContainers]);

  const pauseContainer = useCallback(async (containerId: string) => {
    await call<void>('docker_pause_container', { containerId });
    await refreshContainers();
  }, [call, refreshContainers]);

  const unpauseContainer = useCallback(async (containerId: string) => {
    await call<void>('docker_unpause_container', { containerId });
    await refreshContainers();
  }, [call, refreshContainers]);

  const removeContainer = useCallback(async (containerId: string, force = false) => {
    await call<void>('docker_remove_container', { containerId, force });
    if (selectedContainerId === containerId) {
      setSelectedContainerId(null);
      setContainerInspect(null);
      setContainerLogs('');
      setContainerStats(null);
    }
    await refreshContainers();
  }, [call, refreshContainers, selectedContainerId]);

  // ── Image actions ─────────────────────────────────────────────────────────

  const removeImage = useCallback(async (imageId: string, force = false) => {
    await call<void>('docker_remove_image', { imageId, force });
    await refreshImages();
  }, [call, refreshImages]);

  const pullImage = useCallback(async (image: string) => {
    await call<void>('docker_pull_image', { image });
    await refreshImages();
  }, [call, refreshImages]);

  // ── Volume actions ────────────────────────────────────────────────────────

  const createVolume = useCallback(async (config: CreateVolumeConfig) => {
    await call<void>('docker_create_volume', { config });
    await refreshVolumes();
  }, [call, refreshVolumes]);

  const removeVolume = useCallback(async (name: string) => {
    await call<void>('docker_remove_volume', { name });
    await refreshVolumes();
  }, [call, refreshVolumes]);

  // ── Network actions ───────────────────────────────────────────────────────

  const createNetwork = useCallback(async (config: CreateNetworkConfig) => {
    await call<void>('docker_create_network', { config });
    await refreshNetworks();
  }, [call, refreshNetworks]);

  const removeNetwork = useCallback(async (networkId: string) => {
    await call<void>('docker_remove_network', { networkId });
    await refreshNetworks();
  }, [call, refreshNetworks]);

  // ── Prune ─────────────────────────────────────────────────────────────────

  const pruneContainers = useCallback(async () => {
    await call<void>('docker_prune_containers');
    await refreshContainers();
  }, [call, refreshContainers]);

  const pruneImages = useCallback(async () => {
    await call<void>('docker_prune_images');
    await refreshImages();
  }, [call, refreshImages]);

  // ── Compose actions ───────────────────────────────────────────────────────

  const composeUp = useCallback(async (config: ComposeUpConfig) => {
    await call<void>('docker_compose_up', { config });
    await refreshCompose();
  }, [call, refreshCompose]);

  const composeDown = useCallback(async (config: ComposeDownConfig) => {
    await call<void>('docker_compose_down', { config });
    await refreshCompose();
  }, [call, refreshCompose]);

  // ── Polling ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    if (connectionState === 'connected' && isOpen) {
      pollRef.current = setInterval(() => {
        refreshContainers().catch(() => {});
        refreshImages().catch(() => {});
        refreshVolumes().catch(() => {});
        refreshNetworks().catch(() => {});
      }, 10_000);
    }

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [connectionState, isOpen, refreshContainers, refreshImages, refreshVolumes, refreshNetworks]);

  return {
    // state
    connectionState,
    activeTab,
    setActiveTab,
    systemInfo,
    containers,
    images,
    volumes,
    networks,
    composeProjects,
    selectedContainerId,
    setSelectedContainerId,
    containerInspect,
    containerLogs,
    containerStats,
    loading,
    error,
    refreshing,
    searchQuery,
    setSearchQuery,

    // connection
    connect,
    disconnect,

    // refresh
    refreshAll,
    refreshSystemInfo,
    refreshContainers,
    refreshImages,
    refreshVolumes,
    refreshNetworks,
    refreshCompose,

    // container actions
    inspectContainer,
    getContainerLogs,
    clearContainerLogs,
    getContainerStats,
    startContainer,
    stopContainer,
    restartContainer,
    pauseContainer,
    unpauseContainer,
    removeContainer,

    // image actions
    removeImage,
    pullImage,

    // volume actions
    createVolume,
    removeVolume,

    // network actions
    createNetwork,
    removeNetwork,

    // prune
    pruneContainers,
    pruneImages,

    // compose
    composeUp,
    composeDown,
  };
}
