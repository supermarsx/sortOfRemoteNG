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
  profile_id: 'p1',
  profile_name: 'Home',
  provider: 'cloudflare',
  status: 'Success',
  ip_sent: '5.6.7.8',
  ip_previous: '1.2.3.4',
  hostname: 'home',
  fqdn: 'home.example.com',
  provider_response: 'Updated',
  timestamp: '2025-01-01T00:00:00Z',
};

const mockIpResult = {
  ipv4: '1.2.3.4',
  ipv6: '::1',
  source: 'external',
  detected_at: '2025-01-01T00:00:00Z',
};

const mockProviderCapabilities = [
  { provider: 'cloudflare', supports_ipv6: true, supports_proxied: true, requires_zone_id: true },
  { provider: 'duckdns', supports_ipv6: false, supports_proxied: false, requires_zone_id: false },
];

const mockAuditEntries = [
  { id: 'a1', profile_id: 'p1', action: 'update', details: 'IP updated', timestamp: '2025-01-01T00:00:00Z' },
  { id: 'a2', profile_id: 'p2', action: 'create', details: 'Profile created', timestamp: '2025-01-02T00:00:00Z' },
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
    expect(result.current.selectedProfile?.name).toBe('Home');
  });

  it('createProfile calls invoke and refreshes list', async () => {
    (invoke as Mock)
      .mockResolvedValueOnce({ ...mockProfiles[0], id: 'p-new' }) // create
      .mockResolvedValueOnce(mockProfiles); // listProfiles refresh
    const { result } = renderHook(() => useDdnsManager());
    await act(async () => {
      await result.current.createProfile({
        name: 'New',
        provider: 'cloudflare' as any,
        auth: { type: 'token', value: 'abc' } as any,
        domain: 'test.com',
        hostname: 'new',
        ip_version: 'ipv4' as any,
        update_interval_secs: 300,
        provider_settings: {} as any,
        tags: [],
        notes: null,
      });
    });
    expect(invoke).toHaveBeenCalledWith(
      'ddns_create_profile',
      expect.objectContaining({ name: 'New' }),
    );
  });

  it('deleteProfile calls invoke and refreshes list', async () => {
    (invoke as Mock)
      .mockResolvedValueOnce(undefined) // delete
      .mockResolvedValueOnce([]); // listProfiles refresh
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
    expect(result.current.updateResults[0].status).toBe('Success');
  });

  it('detectIp calls invoke and sets ipResult', async () => {
    (invoke as Mock).mockResolvedValueOnce(mockIpResult);
    const { result } = renderHook(() => useDdnsManager());
    await act(async () => {
      await result.current.detectIp();
    });
    expect(invoke).toHaveBeenCalledWith('ddns_detect_ip');
    expect(result.current.ipResult?.ipv4).toBe('1.2.3.4');
  });

  it('handles errors and sets error state', async () => {
    (invoke as Mock).mockRejectedValueOnce(new Error('Network failure'));
    const { result } = renderHook(() => useDdnsManager());
    await act(async () => {
      await result.current.listProfiles();
    });
    expect(result.current.error).toBe('Network failure');
    expect(result.current.profiles).toEqual([]);
  });

  it('loading state is set during operations', async () => {
    (invoke as Mock).mockResolvedValueOnce(mockProfiles);
    const { result } = renderHook(() => useDdnsManager());
    await act(async () => {
      await result.current.listProfiles();
    });
    // After completion loading should be false
    expect(result.current.loading).toBe(false);
    // Profiles should be loaded
    expect(result.current.profiles).toHaveLength(2);
  });

  it('listProviders fetches provider capabilities', async () => {
    (invoke as Mock).mockImplementation(async (cmd: string) => {
      if (cmd === 'ddns_list_providers') return mockProviderCapabilities;
      return undefined;
    });
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
    (invoke as Mock).mockImplementation(async (cmd: string) => {
      if (cmd === 'ddns_get_audit_log') return mockAuditEntries;
      return undefined;
    });
    const { result } = renderHook(() => useDdnsManager());
    await act(async () => {
      await result.current.getAuditLog();
    });
    expect(invoke).toHaveBeenCalledWith('ddns_get_audit_log');
    expect(result.current.auditLog).toHaveLength(2);
  });

  it('clearAudit clears audit log state', async () => {
    (invoke as Mock).mockImplementation(async (cmd: string) => {
      if (cmd === 'ddns_get_audit_log') return mockAuditEntries;
      return undefined;
    });
    const { result } = renderHook(() => useDdnsManager());
    await act(async () => {
      await result.current.getAuditLog();
    });
    expect(result.current.auditLog).toHaveLength(2);
    await act(async () => {
      await result.current.clearAudit();
    });
    expect(result.current.auditLog).toHaveLength(0);
  });

  it('error state clears on next successful call', async () => {
    (invoke as Mock).mockRejectedValueOnce(new Error('fail'));
    const { result } = renderHook(() => useDdnsManager());
    await act(async () => {
      await result.current.listProfiles();
    });
    expect(result.current.error).toBe('fail');
    (invoke as Mock).mockImplementation(async () => mockProfiles);
    await act(async () => {
      await result.current.listProfiles();
    });
    expect(result.current.error).toBeNull();
  });

  it('enableProfile and disableProfile call correct invoke commands', async () => {
    (invoke as Mock).mockImplementation(async (cmd: string) => {
      if (cmd === 'ddns_list_profiles') return mockProfiles;
      return undefined;
    });
    const { result } = renderHook(() => useDdnsManager());
    await act(async () => {
      await result.current.enableProfile('p1');
    });
    expect(invoke).toHaveBeenCalledWith('ddns_enable_profile', { id: 'p1' });
    await act(async () => {
      await result.current.disableProfile('p2');
    });
    expect(invoke).toHaveBeenCalledWith('ddns_disable_profile', { id: 'p2' });
  });

  it('getCurrentIps fetches and sets current IP addresses', async () => {
    (invoke as Mock).mockImplementation(async (cmd: string) => {
      if (cmd === 'ddns_get_current_ips') return ['1.2.3.4', null];
      return undefined;
    });
    const { result } = renderHook(() => useDdnsManager());
    await act(async () => {
      await result.current.getCurrentIps();
    });
    expect(invoke).toHaveBeenCalledWith('ddns_get_current_ips');
    expect(result.current.currentIps).toEqual(['1.2.3.4', null]);
  });
});
