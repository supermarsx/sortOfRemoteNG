import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { useDocker } from '../../src/hooks/protocol/useDocker';

const mockInvoke = vi.mocked(invoke);

describe('useDocker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const renderDockerHook = (connectionId = 'conn-1', isOpen = true) =>
    renderHook(() => useDocker(connectionId, isOpen));

  // ── Initial state ───────────────────────────────────────────────────────

  it('starts in disconnected state with empty collections', () => {
    const { result } = renderDockerHook();
    expect(result.current.connectionState).toBe('disconnected');
    expect(result.current.containers).toEqual([]);
    expect(result.current.images).toEqual([]);
    expect(result.current.volumes).toEqual([]);
    expect(result.current.networks).toEqual([]);
    expect(result.current.composeProjects).toEqual([]);
    expect(result.current.systemInfo).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  // ── Connect / disconnect ───────────────────────────────────────────────

  it('connects successfully and refreshes all resources', async () => {
    const sysInfo = { containers: 5, images: 10 };
    const containers = [{ id: 'c1', names: ['/web'] }];
    const images = [{ id: 'img1', repoTags: ['nginx:latest'] }];
    const volumes = [{ name: 'vol1' }];
    const networks = [{ id: 'net1', name: 'bridge' }];

    mockInvoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case 'docker_connect': return undefined;
        case 'docker_system_info': return sysInfo;
        case 'docker_list_containers': return containers;
        case 'docker_list_images': return images;
        case 'docker_list_volumes': return volumes;
        case 'docker_list_networks': return networks;
        default: return undefined;
      }
    });

    const { result } = renderDockerHook();

    await act(async () => { await result.current.connect(); });

    expect(result.current.connectionState).toBe('connected');
    expect(result.current.systemInfo).toEqual(sysInfo);
    expect(result.current.containers).toEqual(containers);
    expect(result.current.images).toEqual(images);
    expect(result.current.volumes).toEqual(volumes);
    expect(result.current.networks).toEqual(networks);
  });

  it('transitions to connecting then back to disconnected on connect failure', async () => {
    mockInvoke.mockRejectedValue(new Error('Daemon unreachable'));

    const { result } = renderDockerHook();

    await act(async () => {
      try { await result.current.connect(); } catch { /* expected */ }
    });

    expect(result.current.connectionState).toBe('disconnected');
    expect(result.current.error).toBe('Daemon unreachable');
  });

  it('disconnect resets all state', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const { result } = renderDockerHook();

    // Connect first
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'docker_system_info') return { containers: 1 };
      if (cmd === 'docker_list_containers') return [{ id: 'c1' }];
      return undefined;
    });
    await act(async () => { await result.current.connect(); });
    expect(result.current.connectionState).toBe('connected');

    // Disconnect
    mockInvoke.mockResolvedValue(undefined);
    await act(async () => { await result.current.disconnect(); });

    expect(result.current.connectionState).toBe('disconnected');
    expect(result.current.containers).toEqual([]);
    expect(result.current.systemInfo).toBeNull();
    expect(result.current.selectedContainerId).toBeNull();
    expect(result.current.containerInspect).toBeNull();
    expect(result.current.containerLogs).toBe('');
    expect(result.current.containerStats).toBeNull();
  });

  // ── Container operations ───────────────────────────────────────────────

  it('startContainer invokes command and refreshes containers', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const { result } = renderDockerHook();

    await act(async () => { await result.current.startContainer('c1'); });

    expect(mockInvoke).toHaveBeenCalledWith('docker_start_container', expect.objectContaining({ containerId: 'c1' }));
    expect(mockInvoke).toHaveBeenCalledWith('docker_list_containers', expect.any(Object));
  });

  it('stopContainer invokes command and refreshes containers', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const { result } = renderDockerHook();

    await act(async () => { await result.current.stopContainer('c1'); });

    expect(mockInvoke).toHaveBeenCalledWith('docker_stop_container', expect.objectContaining({ containerId: 'c1' }));
  });

  it('restartContainer invokes command and refreshes containers', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const { result } = renderDockerHook();

    await act(async () => { await result.current.restartContainer('c1'); });

    expect(mockInvoke).toHaveBeenCalledWith('docker_restart_container', expect.objectContaining({ containerId: 'c1' }));
  });

  it('pauseContainer and unpauseContainer invoke correct commands', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const { result } = renderDockerHook();

    await act(async () => { await result.current.pauseContainer('c1'); });
    expect(mockInvoke).toHaveBeenCalledWith('docker_pause_container', expect.objectContaining({ containerId: 'c1' }));

    await act(async () => { await result.current.unpauseContainer('c1'); });
    expect(mockInvoke).toHaveBeenCalledWith('docker_unpause_container', expect.objectContaining({ containerId: 'c1' }));
  });

  it('removeContainer clears selection when removing the selected container', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const { result } = renderDockerHook();

    act(() => { result.current.setSelectedContainerId('c1'); });
    expect(result.current.selectedContainerId).toBe('c1');

    await act(async () => { await result.current.removeContainer('c1'); });

    expect(result.current.selectedContainerId).toBeNull();
    expect(mockInvoke).toHaveBeenCalledWith('docker_remove_container', expect.objectContaining({ containerId: 'c1', force: false }));
  });

  it('removeContainer with force=true passes the flag', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const { result } = renderDockerHook();

    await act(async () => { await result.current.removeContainer('c2', true); });

    expect(mockInvoke).toHaveBeenCalledWith('docker_remove_container', expect.objectContaining({ containerId: 'c2', force: true }));
  });

  it('inspectContainer sets containerInspect state', async () => {
    const inspectData = { id: 'c1', state: { running: true } };
    mockInvoke.mockResolvedValue(inspectData);
    const { result } = renderDockerHook();

    await act(async () => { await result.current.inspectContainer('c1'); });

    expect(result.current.containerInspect).toEqual(inspectData);
  });

  it('getContainerLogs stores logs', async () => {
    mockInvoke.mockResolvedValue('2024-01-01 Starting server...');
    const { result } = renderDockerHook();

    await act(async () => { await result.current.getContainerLogs('c1'); });

    expect(result.current.containerLogs).toBe('2024-01-01 Starting server...');
  });

  it('getContainerStats stores stats', async () => {
    const stats = { cpuPercent: 25, memoryUsage: 1024 };
    mockInvoke.mockResolvedValue(stats);
    const { result } = renderDockerHook();

    await act(async () => { await result.current.getContainerStats('c1'); });

    expect(result.current.containerStats).toEqual(stats);
  });

  // ── Image actions ──────────────────────────────────────────────────────

  it('pullImage invokes command and refreshes images', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const { result } = renderDockerHook();

    await act(async () => { await result.current.pullImage('nginx:latest'); });

    expect(mockInvoke).toHaveBeenCalledWith('docker_pull_image', expect.objectContaining({ image: 'nginx:latest' }));
  });

  it('removeImage invokes command with force flag', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const { result } = renderDockerHook();

    await act(async () => { await result.current.removeImage('img1', true); });

    expect(mockInvoke).toHaveBeenCalledWith('docker_remove_image', expect.objectContaining({ imageId: 'img1', force: true }));
  });

  // ── Volume actions ─────────────────────────────────────────────────────

  it('createVolume and removeVolume invoke correct commands', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const { result } = renderDockerHook();

    await act(async () => { await result.current.createVolume({ name: 'data-vol' } as any); });
    expect(mockInvoke).toHaveBeenCalledWith('docker_create_volume', expect.objectContaining({ config: { name: 'data-vol' } }));

    await act(async () => { await result.current.removeVolume('data-vol'); });
    expect(mockInvoke).toHaveBeenCalledWith('docker_remove_volume', expect.objectContaining({ name: 'data-vol' }));
  });

  // ── Network actions ────────────────────────────────────────────────────

  it('createNetwork and removeNetwork invoke correct commands', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const { result } = renderDockerHook();

    const cfg = { name: 'my-net', driver: 'bridge' };
    await act(async () => { await result.current.createNetwork(cfg as any); });
    expect(mockInvoke).toHaveBeenCalledWith('docker_create_network', expect.objectContaining({ config: cfg }));

    await act(async () => { await result.current.removeNetwork('net1'); });
    expect(mockInvoke).toHaveBeenCalledWith('docker_remove_network', expect.objectContaining({ networkId: 'net1' }));
  });

  // ── Error handling ─────────────────────────────────────────────────────

  it('sets error state when a command fails', async () => {
    mockInvoke.mockRejectedValue(new Error('Timeout'));
    const { result } = renderDockerHook();

    await act(async () => {
      try { await result.current.refreshContainers(); } catch { /* expected */ }
    });

    expect(result.current.error).toBe('Timeout');
  });

  it('sets error from string rejection', async () => {
    mockInvoke.mockRejectedValue('Permission denied');
    const { result } = renderDockerHook();

    await act(async () => {
      try { await result.current.refreshImages(); } catch { /* expected */ }
    });

    expect(result.current.error).toBe('Permission denied');
  });

  // ── Polling ────────────────────────────────────────────────────────────

  it('starts polling when connected and isOpen', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'docker_system_info') return { containers: 0 };
      return [];
    });

    const { result } = renderDockerHook('conn-1', true);

    await act(async () => { await result.current.connect(); });
    expect(result.current.connectionState).toBe('connected');

    mockInvoke.mockClear();

    await act(async () => { vi.advanceTimersByTime(10_000); });

    // Polling should have called refresh commands
    const calledCmds = mockInvoke.mock.calls.map(c => c[0]);
    expect(calledCmds).toContain('docker_list_containers');
    expect(calledCmds).toContain('docker_list_images');
  });

  it('does not poll when isOpen is false', () => {
    mockInvoke.mockClear();
    renderDockerHook('conn-1', false);

    vi.advanceTimersByTime(15_000);

    // No polling calls should have been made (only initial render, no connect)
    const pollingCmds = mockInvoke.mock.calls.filter(c =>
      ['docker_list_containers', 'docker_list_images', 'docker_list_volumes', 'docker_list_networks'].includes(c[0] as string)
    );
    expect(pollingCmds).toHaveLength(0);
  });

  // ── Prune ──────────────────────────────────────────────────────────────

  it('pruneContainers invokes prune and refreshes', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const { result } = renderDockerHook();

    await act(async () => { await result.current.pruneContainers(); });

    expect(mockInvoke).toHaveBeenCalledWith('docker_prune_containers', expect.any(Object));
  });

  it('pruneImages invokes prune and refreshes', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const { result } = renderDockerHook();

    await act(async () => { await result.current.pruneImages(); });

    expect(mockInvoke).toHaveBeenCalledWith('docker_prune_images', expect.any(Object));
  });

  // ── Tab/search state ───────────────────────────────────────────────────

  it('setActiveTab and setSearchQuery update state', () => {
    const { result } = renderDockerHook();

    act(() => { result.current.setActiveTab('images'); });
    expect(result.current.activeTab).toBe('images');

    act(() => { result.current.setSearchQuery('nginx'); });
    expect(result.current.searchQuery).toBe('nginx');
  });

  // ── Compose actions ────────────────────────────────────────────────────

  it('composeUp and composeDown invoke correct commands', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const { result } = renderDockerHook();

    const upCfg = { projectDir: '/app', files: ['docker-compose.yml'] };
    await act(async () => { await result.current.composeUp(upCfg as any); });
    expect(mockInvoke).toHaveBeenCalledWith('docker_compose_up', expect.objectContaining({ config: upCfg }));

    const downCfg = { projectDir: '/app' };
    await act(async () => { await result.current.composeDown(downCfg as any); });
    expect(mockInvoke).toHaveBeenCalledWith('docker_compose_down', expect.objectContaining({ config: downCfg }));
  });
});
