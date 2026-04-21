import { describe, it, expect, beforeEach, vi, Mock, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSshScripts } from '../../src/hooks/recording/useSshScripts';
import { invoke } from '@tauri-apps/api/core';
import type {
  SshEventScript,
  ScriptChain,
  PendingExecution,
  SshScriptsSummary,
  ScriptStats,
  HistoryResponse,
  ScriptBundle,
  ImportResult,
} from '../../src/types/ssh/sshScripts';

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, f?: string) => f || k }),
}));

// ── Test data ──────────────────────────────────────────────────────

const mockScript: SshEventScript = {
  id: 'sc1',
  name: 'Startup Script',
  description: 'Run on login',
  enabled: true,
  content: 'echo hello',
  language: 'bash',
  executionMode: 'shell',
  trigger: { type: 'login', delayMs: 0 },
  conditions: [],
  variables: [],
  timeoutMs: 30000,
  onFailure: 'continue',
  maxRetries: 0,
  retryDelayMs: 1000,
  environment: {},
  tags: ['startup'],
  category: 'init',
  priority: 1,
  connectionIds: [],
  hostPatterns: [],
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  author: 'admin',
  version: 1,
};

const mockScript2: SshEventScript = {
  ...mockScript,
  id: 'sc2',
  name: 'Cleanup Script',
  description: 'Run on logout',
  trigger: { type: 'logout', runOnError: false },
  tags: ['cleanup'],
  category: 'maintenance',
};

const mockChain: ScriptChain = {
  id: 'ch1',
  name: 'Deploy Chain',
  description: 'Full deploy pipeline',
  enabled: true,
  steps: [{ scriptId: 'sc1', continueOnFailure: false, delayMs: 0, overrideVariables: {} }],
  abortOnFailure: false,
  tags: ['deploy'],
  category: 'devops',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
};

const mockSummary: SshScriptsSummary = {
  totalScripts: 2,
  enabledScripts: 2,
  disabledScripts: 0,
  totalChains: 1,
  categories: 3,
  tags: 3,
  triggerCounts: { login: 1, logout: 1 },
  activeSessions: 0,
};

const mockStats: Record<string, ScriptStats> = {
  sc1: { totalRuns: 5, successes: 4, failures: 1, timeouts: 0, averageDurationMs: 500, lastRunAt: '2025-01-10T00:00:00Z' },
};

// ── Helpers ────────────────────────────────────────────────────────

function setupInvokeMock() {
  (invoke as Mock).mockImplementation(async (cmd: string, args?: any) => {
    switch (cmd) {
      case 'ssh_scripts_list_scripts': return [mockScript, mockScript2];
      case 'ssh_scripts_list_chains': return [mockChain];
      case 'ssh_scripts_get_tags': return ['startup', 'cleanup', 'deploy'];
      case 'ssh_scripts_get_categories': return ['init', 'maintenance', 'devops'];
      case 'ssh_scripts_get_summary': return mockSummary;
      case 'ssh_scripts_get_all_stats': return mockStats;
      case 'ssh_scripts_create_script': return { ...mockScript, id: 'sc-new', ...args?.request };
      case 'ssh_scripts_update_script': return { ...mockScript, id: args?.scriptId, ...args?.request };
      case 'ssh_scripts_delete_script': return undefined;
      case 'ssh_scripts_duplicate_script': return { ...mockScript, id: 'sc-dup', name: 'Startup Script (Copy)' };
      case 'ssh_scripts_toggle_script': return undefined;
      case 'ssh_scripts_create_chain': return { ...mockChain, id: 'ch-new', ...args?.request };
      case 'ssh_scripts_update_chain': return { ...mockChain, id: args?.chainId, ...args?.request };
      case 'ssh_scripts_delete_chain': return undefined;
      case 'ssh_scripts_toggle_chain': return undefined;
      case 'ssh_scripts_run_script': return { executionId: 'exec1', scriptId: 'sc1', status: 'pending' } as unknown as PendingExecution;
      case 'ssh_scripts_run_chain': return [{ executionId: 'exec2', scriptId: 'sc1', status: 'pending' }] as unknown as PendingExecution[];
      case 'ssh_scripts_record_execution': return undefined;
      case 'ssh_scripts_query_history': return { records: [{ id: 'h1', scriptId: 'sc1' }], total: 1 } as HistoryResponse;
      case 'ssh_scripts_clear_history': return undefined;
      case 'ssh_scripts_pause_timer': return undefined;
      case 'ssh_scripts_resume_timer': return undefined;
      case 'ssh_scripts_bulk_enable': return args?.scriptIds?.length ?? 0;
      case 'ssh_scripts_bulk_delete': return args?.scriptIds?.length ?? 0;
      case 'ssh_scripts_export': return { scripts: [mockScript], chains: [mockChain], version: '1', exportedAt: '2025-01-01T00:00:00Z' } as ScriptBundle;
      case 'ssh_scripts_import': return { scriptsImported: 1, chainsImported: 1, scriptsSkipped: 0, chainsSkipped: 0 } as ImportResult;
      case 'ssh_scripts_notify_event': return [];
      case 'ssh_scripts_notify_output': return [];
      case 'ssh_scripts_scheduler_tick': return [];
      default: return undefined;
    }
  });
}

// ── Tests ──────────────────────────────────────────────────────────

describe('useSshScripts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setupInvokeMock();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads scripts, chains, tags, categories on mount', async () => {
    const { result } = renderHook(() => useSshScripts());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.scripts).toHaveLength(2);
    expect(result.current.chains).toHaveLength(1);
    expect(result.current.tags).toContain('startup');
    expect(result.current.categories).toContain('init');
  });

  it('summary and stats are loaded on mount', async () => {
    const { result } = renderHook(() => useSshScripts());
    await waitFor(() => expect(result.current.summary).not.toBeNull());
    expect(result.current.summary!.totalScripts).toBe(2);
    expect(result.current.stats['sc1']).toBeDefined();
  });

  it('createScript calls invoke and refreshes', async () => {
    const { result } = renderHook(() => useSshScripts());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const req = { name: 'New Script', content: 'echo new', trigger: { type: 'login', delayMs: 0 } };
    let created: any;
    await act(async () => {
      created = await result.current.createScript(req as any);
    });
    expect(invoke).toHaveBeenCalledWith('ssh_scripts_create_script', { request: req });
    expect(created.id).toBe('sc-new');
  });

  it('deleteScript calls invoke and clears selected if matching', async () => {
    const { result } = renderHook(() => useSshScripts());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.selectScript(mockScript));
    expect(result.current.selectedScript?.id).toBe('sc1');
    await act(async () => {
      await result.current.deleteScript('sc1');
    });
    expect(invoke).toHaveBeenCalledWith('ssh_scripts_delete_script', { scriptId: 'sc1' });
    expect(result.current.selectedScript).toBeNull();
  });

  it('duplicateScript calls invoke with scriptId', async () => {
    const { result } = renderHook(() => useSshScripts());
    await waitFor(() => expect(result.current.loading).toBe(false));
    let dup: any;
    await act(async () => {
      dup = await result.current.duplicateScript('sc1');
    });
    expect(invoke).toHaveBeenCalledWith('ssh_scripts_duplicate_script', { scriptId: 'sc1' });
    expect(dup.id).toBe('sc-dup');
  });

  it('toggleScript enables/disables a script', async () => {
    const { result } = renderHook(() => useSshScripts());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.toggleScript('sc1', false);
    });
    expect(invoke).toHaveBeenCalledWith('ssh_scripts_toggle_script', { scriptId: 'sc1', enabled: false });
  });

  it('runScript adds execution to pendingExecutions', async () => {
    const { result } = renderHook(() => useSshScripts());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const req = { scriptId: 'sc1', sessionId: 'sess1' };
    await act(async () => {
      await result.current.runScript(req as any);
    });
    expect(result.current.pendingExecutions).toHaveLength(1);
    expect(result.current.pendingExecutions[0].executionId).toBe('exec1');
  });

  it('queryHistory fetches and sets history', async () => {
    const { result } = renderHook(() => useSshScripts());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.queryHistory({ limit: 10, offset: 0 } as any);
    });
    expect(result.current.history).toHaveLength(1);
    expect(result.current.historyTotal).toBe(1);
  });

  it('clearHistory empties history state', async () => {
    const { result } = renderHook(() => useSshScripts());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.queryHistory({ limit: 10, offset: 0 } as any);
    });
    expect(result.current.history).toHaveLength(1);
    await act(async () => {
      await result.current.clearHistory();
    });
    expect(result.current.history).toHaveLength(0);
    expect(result.current.historyTotal).toBe(0);
  });

  it('filters scripts by search query', async () => {
    const { result } = renderHook(() => useSshScripts());
    await waitFor(() => expect(result.current.scripts).toHaveLength(2));
    act(() => result.current.setSearchFilter('Startup'));
    expect(result.current.scripts).toHaveLength(1);
    expect(result.current.scripts[0].id).toBe('sc1');
  });

  it('filters scripts by trigger type', async () => {
    const { result } = renderHook(() => useSshScripts());
    await waitFor(() => expect(result.current.scripts).toHaveLength(2));
    act(() => result.current.setTriggerFilter('logout'));
    expect(result.current.scripts).toHaveLength(1);
    expect(result.current.scripts[0].id).toBe('sc2');
  });

  it('exportScripts calls correct invoke command', async () => {
    const { result } = renderHook(() => useSshScripts());
    await waitFor(() => expect(result.current.loading).toBe(false));
    let bundle: any;
    await act(async () => {
      bundle = await result.current.exportScripts();
    });
    expect(invoke).toHaveBeenCalledWith('ssh_scripts_export');
    expect(bundle.scripts).toHaveLength(1);
    expect(bundle.chains).toHaveLength(1);
  });

  it('importScripts calls invoke and refreshes', async () => {
    const { result } = renderHook(() => useSshScripts());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const bundle = { scripts: [mockScript], chains: [mockChain], version: 1 };
    let importResult: any;
    await act(async () => {
      importResult = await result.current.importScripts(bundle as any);
    });
    expect(invoke).toHaveBeenCalledWith('ssh_scripts_import', { bundle });
    expect(importResult.scriptsImported).toBe(1);
  });

  it('handles refresh errors gracefully', async () => {
    (invoke as Mock).mockRejectedValueOnce(new Error('backend down'));
    const { result } = renderHook(() => useSshScripts());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Error: backend down');
  });

  it('bulkDelete calls invoke with script IDs', async () => {
    const { result } = renderHook(() => useSshScripts());
    await waitFor(() => expect(result.current.loading).toBe(false));
    let count: number | undefined;
    await act(async () => {
      count = await result.current.bulkDelete(['sc1', 'sc2']);
    });
    expect(invoke).toHaveBeenCalledWith('ssh_scripts_bulk_delete', { scriptIds: ['sc1', 'sc2'] });
    expect(count).toBe(2);
  });

  it('bulkEnable calls invoke with script IDs and enabled flag', async () => {
    const { result } = renderHook(() => useSshScripts());
    await waitFor(() => expect(result.current.loading).toBe(false));
    let count: number | undefined;
    await act(async () => {
      count = await result.current.bulkEnable(['sc1'], true);
    });
    expect(invoke).toHaveBeenCalledWith('ssh_scripts_bulk_enable', { scriptIds: ['sc1'], enabled: true });
    expect(count).toBe(1);
  });

  it('filters scripts by category', async () => {
    const { result } = renderHook(() => useSshScripts());
    await waitFor(() => expect(result.current.scripts).toHaveLength(2));
    act(() => result.current.setCategoryFilter('maintenance'));
    expect(result.current.scripts).toHaveLength(1);
    expect(result.current.scripts[0].id).toBe('sc2');
  });
});
