import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback || key }),
}));

import { useDocker } from '../../src/hooks/protocol/useDocker';

const mockInvoke = vi.mocked(invoke);

function setupInvokeMock() {
  mockInvoke.mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case 'docker_connect': return undefined;
      case 'docker_disconnect': return undefined;
      case 'docker_system_info': return { containers: 5, images: 3 };
      case 'docker_list_containers': return [{ id: 'c1', name: 'web', state: 'running' }];
      case 'docker_list_images': return [{ id: 'i1', tag: 'nginx:latest' }];
      case 'docker_list_volumes': return [{ name: 'vol1' }];
      case 'docker_list_networks': return [{ id: 'n1', name: 'bridge' }];
      case 'docker_compose_list_projects': return [];
      case 'docker_inspect_container': return { id: 'c1', state: { running: true } };
      case 'docker_container_logs': return 'log line 1\nlog line 2';
      case 'docker_container_stats': return { cpu: 0.5, memory: 128 };
      case 'docker_start_container': return undefined;
      case 'docker_stop_container': return undefined;
      case 'docker_restart_container': return undefined;
      case 'docker_pause_container': return undefined;
      case 'docker_unpause_container': return undefined;
      case 'docker_remove_container': return undefined;
      case 'docker_remove_image': return undefined;
      case 'docker_pull_image': return undefined;
      case 'docker_create_volume': return undefined;
      case 'docker_remove_volume': return undefined;
      case 'docker_create_network': return undefined;
      case 'docker_remove_network': return undefined;
      case 'docker_compose_up': return undefined;
      case 'docker_compose_down': return undefined;
      case 'docker_prune_containers': return undefined;
      case 'docker_prune_images': return undefined;
      default: return undefined;
    }
  });
}

describe('useDocker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setupInvokeMock();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('has correct initial state', () => {
    const { result } = renderHook(() => useDocker('conn-1', false));
    expect(result.current.connectionState).toBe('disconnected');
    expect(result.current.containers).toEqual([]);
    expect(result.current.images).toEqual([]);
    expect(result.current.volumes).toEqual([]);
    expect(result.current.networks).toEqual([]);
    expect(result.current.composeProjects).toEqual([]);
    expect(result.current.systemInfo).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.refreshing).toBe(false);
    expect(result.current.searchQuery).toBe('');
    expect(result.current.activeTab).toBe('dashboard');
    expect(result.current.selectedContainerId).toBeNull();
    expect(result.current.containerInspect).toBeNull();
    expect(result.current.containerLogs).toBe('');
    expect(result.current.containerStats).toBeNull();
  });

  it('connects successfully: disconnected → connecting → connected', async () => {
    const { result } = renderHook(() => useDocker('conn-1', false));

    await act(async () => {
      await result.current.connect();
    });

    expect(result.current.connectionState).toBe('connected');
    expect(mockInvoke).toHaveBeenCalledWith('docker_connect', expect.objectContaining({ connectionId: 'conn-1' }));
    expect(mockInvoke).toHaveBeenCalledWith('docker_system_info', expect.objectContaining({ connectionId: 'conn-1' }));
    expect(mockInvoke).toHaveBeenCalledWith('docker_list_containers', expect.objectContaining({ connectionId: 'conn-1', all: true }));
  });

  it('populates data after connect', async () => {
    const { result } = renderHook(() => useDocker('conn-1', false));

    await act(async () => {
      await result.current.connect();
    });

    expect(result.current.systemInfo).toEqual({ containers: 5, images: 3 });
    expect(result.current.containers).toEqual([{ id: 'c1', name: 'web', state: 'running' }]);
    expect(result.current.images).toEqual([{ id: 'i1', tag: 'nginx:latest' }]);
    expect(result.current.volumes).toEqual([{ name: 'vol1' }]);
    expect(result.current.networks).toEqual([{ id: 'n1', name: 'bridge' }]);
  });

  it('connect failure reverts to disconnected and sets error', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'docker_connect') throw new Error('Connection refused');
      return undefined;
    });

    const { result } = renderHook(() => useDocker('conn-1', false));

    await act(async () => {
      try { await result.current.connect(); } catch { /* expected */ }
    });

    expect(result.current.connectionState).toBe('disconnected');
    expect(result.current.error).toBe('Connection refused');
  });

  it('disconnect clears all state', async () => {
    const { result } = renderHook(() => useDocker('conn-1', false));

    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.connectionState).toBe('connected');

    await act(async () => {
      await result.current.disconnect();
    });

    expect(result.current.connectionState).toBe('disconnected');
    expect(result.current.systemInfo).toBeNull();
    expect(result.current.containers).toEqual([]);
    expect(result.current.images).toEqual([]);
    expect(result.current.volumes).toEqual([]);
    expect(result.current.networks).toEqual([]);
    expect(result.current.composeProjects).toEqual([]);
    expect(mockInvoke).toHaveBeenCalledWith('docker_disconnect', expect.objectContaining({ connectionId: 'conn-1' }));
  });

  it('refreshAll calls all five refresh functions', async () => {
    const { result } = renderHook(() => useDocker('conn-1', false));

    await act(async () => {
      await result.current.refreshAll();
    });

    expect(mockInvoke).toHaveBeenCalledWith('docker_system_info', expect.any(Object));
    expect(mockInvoke).toHaveBeenCalledWith('docker_list_containers', expect.any(Object));
    expect(mockInvoke).toHaveBeenCalledWith('docker_list_images', expect.any(Object));
    expect(mockInvoke).toHaveBeenCalledWith('docker_list_volumes', expect.any(Object));
    expect(mockInvoke).toHaveBeenCalledWith('docker_list_networks', expect.any(Object));
  });

  it('inspectContainer calls correct command and stores result', async () => {
    const { result } = renderHook(() => useDocker('conn-1', false));

    await act(async () => {
      await result.current.inspectContainer('c1');
    });

    expect(mockInvoke).toHaveBeenCalledWith('docker_inspect_container', { connectionId: 'conn-1', containerId: 'c1' });
    expect(result.current.containerInspect).toEqual({ id: 'c1', state: { running: true } });
  });

  it('getContainerLogs stores logs', async () => {
    const { result } = renderHook(() => useDocker('conn-1', false));

    await act(async () => {
      await result.current.getContainerLogs('c1');
    });

    expect(mockInvoke).toHaveBeenCalledWith('docker_container_logs', expect.objectContaining({ containerId: 'c1' }));
    expect(result.current.containerLogs).toBe('log line 1\nlog line 2');
  });

  it('getContainerStats stores stats', async () => {
    const { result } = renderHook(() => useDocker('conn-1', false));

    await act(async () => {
      await result.current.getContainerStats('c1');
    });

    expect(mockInvoke).toHaveBeenCalledWith('docker_container_stats', { connectionId: 'conn-1', containerId: 'c1' });
    expect(result.current.containerStats).toEqual({ cpu: 0.5, memory: 128 });
  });

  it('startContainer invokes command and refreshes containers', async () => {
    const { result } = renderHook(() => useDocker('conn-1', false));

    await act(async () => {
      await result.current.startContainer('c1');
    });

    expect(mockInvoke).toHaveBeenCalledWith('docker_start_container', { connectionId: 'conn-1', containerId: 'c1' });
    expect(mockInvoke).toHaveBeenCalledWith('docker_list_containers', expect.any(Object));
  });

  it('stopContainer invokes command and refreshes containers', async () => {
    const { result } = renderHook(() => useDocker('conn-1', false));

    await act(async () => {
      await result.current.stopContainer('c1');
    });

    expect(mockInvoke).toHaveBeenCalledWith('docker_stop_container', { connectionId: 'conn-1', containerId: 'c1' });
  });

  it('restartContainer invokes command and refreshes containers', async () => {
    const { result } = renderHook(() => useDocker('conn-1', false));

    await act(async () => {
      await result.current.restartContainer('c1');
    });

    expect(mockInvoke).toHaveBeenCalledWith('docker_restart_container', { connectionId: 'conn-1', containerId: 'c1' });
  });

  it('removeContainer clears selected if removing selected container', async () => {
    const { result } = renderHook(() => useDocker('conn-1', false));

    act(() => {
      result.current.setSelectedContainerId('c1');
    });

    await act(async () => {
      await result.current.removeContainer('c1');
    });

    expect(mockInvoke).toHaveBeenCalledWith('docker_remove_container', expect.objectContaining({ containerId: 'c1' }));
    expect(result.current.selectedContainerId).toBeNull();
  });

  it('removeImage invokes command and refreshes images', async () => {
    const { result } = renderHook(() => useDocker('conn-1', false));

    await act(async () => {
      await result.current.removeImage('i1');
    });

    expect(mockInvoke).toHaveBeenCalledWith('docker_remove_image', expect.objectContaining({ imageId: 'i1' }));
    expect(mockInvoke).toHaveBeenCalledWith('docker_list_images', expect.any(Object));
  });

  it('pullImage invokes command and refreshes images', async () => {
    const { result } = renderHook(() => useDocker('conn-1', false));

    await act(async () => {
      await result.current.pullImage('nginx:latest');
    });

    expect(mockInvoke).toHaveBeenCalledWith('docker_pull_image', expect.objectContaining({ image: 'nginx:latest' }));
  });

  it('createVolume invokes command and refreshes volumes', async () => {
    const { result } = renderHook(() => useDocker('conn-1', false));

    await act(async () => {
      await result.current.createVolume({ name: 'testvol' } as any);
    });

    expect(mockInvoke).toHaveBeenCalledWith('docker_create_volume', expect.objectContaining({ config: { name: 'testvol' } }));
    expect(mockInvoke).toHaveBeenCalledWith('docker_list_volumes', expect.any(Object));
  });

  it('removeVolume invokes command and refreshes volumes', async () => {
    const { result } = renderHook(() => useDocker('conn-1', false));

    await act(async () => {
      await result.current.removeVolume('testvol');
    });

    expect(mockInvoke).toHaveBeenCalledWith('docker_remove_volume', expect.objectContaining({ name: 'testvol' }));
  });

  it('createNetwork invokes command and refreshes networks', async () => {
    const { result } = renderHook(() => useDocker('conn-1', false));

    await act(async () => {
      await result.current.createNetwork({ name: 'testnet', driver: 'bridge' } as any);
    });

    expect(mockInvoke).toHaveBeenCalledWith('docker_create_network', expect.objectContaining({ config: { name: 'testnet', driver: 'bridge' } }));
    expect(mockInvoke).toHaveBeenCalledWith('docker_list_networks', expect.any(Object));
  });

  it('removeNetwork invokes command and refreshes networks', async () => {
    const { result } = renderHook(() => useDocker('conn-1', false));

    await act(async () => {
      await result.current.removeNetwork('n1');
    });

    expect(mockInvoke).toHaveBeenCalledWith('docker_remove_network', expect.objectContaining({ networkId: 'n1' }));
  });

  it('invoke failure sets error message', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('Docker daemon not running'));

    const { result } = renderHook(() => useDocker('conn-1', false));

    await act(async () => {
      try { await result.current.refreshSystemInfo(); } catch { /* expected */ }
    });

    expect(result.current.error).toBe('Docker daemon not running');
  });

  it('sets activeTab', () => {
    const { result } = renderHook(() => useDocker('conn-1', false));

    act(() => {
      result.current.setActiveTab('containers');
    });

    expect(result.current.activeTab).toBe('containers');
  });

  it('sets searchQuery', () => {
    const { result } = renderHook(() => useDocker('conn-1', false));

    act(() => {
      result.current.setSearchQuery('nginx');
    });

    expect(result.current.searchQuery).toBe('nginx');
  });

  it('polling starts when connected and isOpen, stops on unmount', async () => {
    const { result, unmount } = renderHook(() => useDocker('conn-1', true));

    await act(async () => {
      await result.current.connect();
    });

    mockInvoke.mockClear();

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });

    // Polling should have called container/image/volume/network refreshes
    expect(mockInvoke).toHaveBeenCalledWith('docker_list_containers', expect.any(Object));
    expect(mockInvoke).toHaveBeenCalledWith('docker_list_images', expect.any(Object));

    mockInvoke.mockClear();
    unmount();

    vi.advanceTimersByTime(10_000);
    // After unmount no new calls should happen
    expect(mockInvoke).not.toHaveBeenCalledWith('docker_list_containers', expect.any(Object));
  });

  it('does not poll when isOpen is false', async () => {
    const { result } = renderHook(() => useDocker('conn-1', false));

    await act(async () => {
      await result.current.connect();
    });

    mockInvoke.mockClear();

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });

    // Should NOT have polling calls since isOpen=false
    const pollingCalls = mockInvoke.mock.calls.filter(
      ([cmd]) => cmd === 'docker_list_containers'
    );
    expect(pollingCalls).toHaveLength(0);
  });

  it('composeUp invokes command and refreshes compose', async () => {
    const { result } = renderHook(() => useDocker('conn-1', false));

    await act(async () => {
      await result.current.composeUp({ projectName: 'myproject' } as any);
    });

    expect(mockInvoke).toHaveBeenCalledWith('docker_compose_up', expect.objectContaining({ config: { projectName: 'myproject' } }));
  });

  it('composeDown invokes command and refreshes compose', async () => {
    const { result } = renderHook(() => useDocker('conn-1', false));

    await act(async () => {
      await result.current.composeDown({ projectName: 'myproject' } as any);
    });

    expect(mockInvoke).toHaveBeenCalledWith('docker_compose_down', expect.objectContaining({ config: { projectName: 'myproject' } }));
  });
});
