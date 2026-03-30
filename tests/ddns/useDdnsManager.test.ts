import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useDdnsManager } from '../../src/hooks/ddns/useDdnsManager';
import { invoke } from '@tauri-apps/api/core';

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, f?: string) => f || k }),
}));

// ── Test data ──────────────────────────────────────────────────────

const mockProfiles = [
  {
    id: 'p1',
    name: 'Home',
    provider: 'cloudflare',
    enabled: true,
    domain: 'example.com',
    hostname: 'home',
    ip_version: 'ipv4',
    update_interval_secs: 300,
    tags: ['home'],
    notes: null,
  },
  {
    id: 'p2',
    name: 'Office',
    provider: 'duckdns',
    enabled: false,
    domain: 'office.duckdns.org',
    hostname: 'office',
    ip_version: 'ipv4',
    update_interval_secs: 600,
    tags: ['work'],
    notes: 'Office network',
  },
];

const mockUpdateResult = {
  profileId: 'p1',
  success: true,
  previousIp: '1.2.3.4',
  newIp: '5.6.7.8',
  message: 'Updated',
  timestamp: '2025-01-01T00:00:00Z',
};

const mockIpResult = {
  ipv4: '5.6.7.8',
  ipv6: null,
  source: 'httpbin',
};

const mockProviders = [
  { provider: 'cloudflare', name: 'Cloudflare', supports_ipv6: true, requires_zone: true },
  { provider: 'duckdns', name: 'DuckDNS', supports_ipv6: false, requires_zone: false },
];

// ── Tests ──────────────────────────────────────────────────────────

describe('useDdnsManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (invoke as Mock).mockResolvedValue(undefined);
  });

  it('initializes with empty state', () => {
    const { result } = renderHook(() => useDdnsManager());
    expect(result.current.profiles).toEqual([]);
    expect(result.current.selectedProfile).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('listProfiles fetches and sets profiles', async () => {
    (invoke as Mock).mockResolvedValueOnce(mockProfiles);
    const { result } = renderHook(() => useDdnsManager());

    await act(async () => {
      await result.current.listProfiles();
    });

    expect(invoke).toHaveBeenCalledWith('ddns_list_profiles');
    expect(result.current.profiles).toHaveLength(2);
    expect(result.current.profiles[0].name).toBe('Home');
  });

  it('getProfile sets selectedProfile', async () => {
    (invoke as Mock).mockResolvedValueOnce(mockProfiles[0]);
    const { result } = renderHook(() => useDdnsManager());

    await act(async () => {
      await result.current.getProfile('p1');
    });

    expect(invoke).toHaveBeenCalledWith('ddns_get_profile', { id: 'p1' });
    expect(result.current.selectedProfile).toEqual(mockProfiles[0]);
  });

  it('createProfile calls invoke and refreshes list', async () => {
    (invoke as Mock)
      .mockResolvedValueOnce({ ...mockProfiles[0], id: 'p3' }) // create
      .mockResolvedValueOnce([...mockProfiles, { ...mockProfiles[0], id: 'p3' }]); // listProfiles

    const { result } = renderHook(() => useDdnsManager());

    await act(async () => {
      await result.current.createProfile({
        name: 'New',
        provider: 'cloudflare' as any,
        auth: { type: 'token', token: 'abc' } as any,
        domain: 'example.com',
        hostname: 'new',
        ip_version: 'ipv4' as any,
        update_interval_secs: 300,
        provider_settings: {} as any,
        tags: [],
        notes: null,
      });
    });

    expect(invoke).toHaveBeenCalledWith('ddns_create_profile', expect.objectContaining({ name: 'New' }));
  });

  it('deleteProfile calls invoke and refreshes list', async () => {
    (invoke as Mock)
      .mockResolvedValueOnce(undefined) // delete
      .mockResolvedValueOnce([mockProfiles[1]]); // listProfiles

    const { result } = renderHook(() => useDdnsManager());

    await act(async () => {
      await result.current.deleteProfile('p1');
    });

    expect(invoke).toHaveBeenCalledWith('ddns_delete_profile', { id: 'p1' });
  });

  it('triggerUpdate calls invoke and appends to updateResults', async () => {
    (invoke as Mock).mockResolvedValueOnce(mockUpdateResult);
    const { result } = renderHook(() => useDdnsManager());

    await act(async () => {
      await result.current.triggerUpdate('p1');
    });

    expect(invoke).toHaveBeenCalledWith('ddns_trigger_update', { profileId: 'p1' });
    expect(result.current.updateResults).toHaveLength(1);
    expect(result.current.updateResults[0].newIp).toBe('5.6.7.8');
  });

  it('detectIp calls invoke and sets ipResult', async () => {
    (invoke as Mock).mockResolvedValueOnce(mockIpResult);
    const { result } = renderHook(() => useDdnsManager());

    await act(async () => {
      await result.current.detectIp();
    });

    expect(invoke).toHaveBeenCalledWith('ddns_detect_ip');
    expect(result.current.ipResult).toEqual(mockIpResult);
  });

  it('handles errors and sets error state', async () => {
    (invoke as Mock).mockRejectedValueOnce(new Error('Network error'));
    const { result } = renderHook(() => useDdnsManager());

    await act(async () => {
      await result.current.listProfiles();
    });

    expect(result.current.error).toBe('Network error');
    expect(result.current.profiles).toEqual([]);
  });

  it('loading state is set during operations', async () => {
    let resolveInvoke: (v: any) => void;
    (invoke as Mock).mockImplementationOnce(
      () => new Promise((res) => { resolveInvoke = res; }),
    );
    const { result } = renderHook(() => useDdnsManager());

    let promise: Promise<any>;
    act(() => {
      promise = result.current.listProfiles() as Promise<any>;
    });

    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveInvoke!(mockProfiles);
      await promise;
    });

    expect(result.current.loading).toBe(false);
  });

  it('listProviders fetches provider capabilities', async () => {
    (invoke as Mock).mockResolvedValueOnce(mockProviders);
    const { result } = renderHook(() => useDdnsManager());

    await act(async () => {
      await result.current.listProviders();
    });

    expect(invoke).toHaveBeenCalledWith('ddns_list_providers');
    expect(result.current.providers).toHaveLength(2);
  });

  it('startScheduler and stopScheduler call correct invoke commands', async () => {
    const { result } = renderHook(() => useDdnsManager());

    await act(async () => {
      await result.current.startScheduler();
    });
    expect(invoke).toHaveBeenCalledWith('ddns_start_scheduler');

    await act(async () => {
      await result.current.stopScheduler();
    });
    expect(invoke).toHaveBeenCalledWith('ddns_stop_scheduler');
  });

  it('getAuditLog fetches and sets audit entries', async () => {
    const mockAudit = [
      { id: 'a1', profileId: 'p1', action: 'update', timestamp: '2025-01-01' },
    ];
    (invoke as Mock).mockResolvedValueOnce(mockAudit);
    const { result } = renderHook(() => useDdnsManager());

    await act(async () => {
      await result.current.getAuditLog();
    });

    expect(invoke).toHaveBeenCalledWith('ddns_get_audit_log');
    expect(result.current.auditLog).toEqual(mockAudit);
  });

  it('clearAudit clears audit log state', async () => {
    // First load some audit data
    const mockAudit = [{ id: 'a1', action: 'update' }];
    (invoke as Mock)
      .mockResolvedValueOnce(mockAudit)  // getAuditLog
      .mockResolvedValueOnce(undefined); // clearAudit

    const { result } = renderHook(() => useDdnsManager());

    await act(async () => {
      await result.current.getAuditLog();
    });
    expect(result.current.auditLog).toHaveLength(1);

    await act(async () => {
      await result.current.clearAudit();
    });
    expect(invoke).toHaveBeenCalledWith('ddns_clear_audit');
    expect(result.current.auditLog).toEqual([]);
  });

  it('error state clears on next successful call', async () => {
    (invoke as Mock)
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(mockProfiles);

    const { result } = renderHook(() => useDdnsManager());

    await act(async () => {
      await result.current.listProfiles();
    });
    expect(result.current.error).toBe('fail');

    await act(async () => {
      await result.current.listProfiles();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.profiles).toHaveLength(2);
  });
});
