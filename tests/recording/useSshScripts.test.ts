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
  description: 'Full deploy',
  enabled: true,
  steps: [{ scriptId: 'sc1', continueOnFailure: false, delayMs: 0, overrideVariables: {} }],
  abortOnFailure: true,
  tags: ['deploy'],
  category: 'devops',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
};

const mockSummary: SshScriptsSummary = {
  totalScripts: 2,
  enabledScripts: 1,
  totalChains: 1,
  totalExecutions: 10,
  recentExecutions: [],
} as any;

const mockStats: Record<string, ScriptStats> = {
  sc1: { totalRuns: 5, successes: 4, failures: 1, timeouts: 0, averageDurationMs: 500 },
};

function setupDefaultMocks() {
  (invoke as Mock).mockImplementation((cmd: string) => {
    switch (cmd) {
      case 'ssh_scripts_list_scripts':
        return Promise.resolve([mockScript, mockScript2]);
      case 'ssh_scripts_list_chains':
        return Promise.resolve([mockChain]);
      case 'ssh_scripts_get_tags':
        return Promise.resolve(['startup', 'cleanup', 'deploy']);
      case 'ssh_scripts_get_categories':
        return Promise.resolve(['init', 'maintenance', 'devops']);
      case 'ssh_scripts_get_summary':
        return Promise.resolve(mockSummary);
      case 'ssh_scripts_get_all_stats':
        return Promise.resolve(mockStats);
      case 'ssh_scripts_scheduler_tick':
        return Promise.resolve([]);
      default:
        return Promise.resolve(undefined);
    }
  });
}

// ── Tests ──────────────────────────────────────────────────────────

describe('useSshScripts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  afterEach(() => {
  });

  it('loads scripts, chains, tags, categories on mount', async () => {
    const { result } = renderHook(() => useSshScripts());
    await waitFor(() => {
      expect(result.current.scripts).toHaveLength(2);
      expect(result.current.chains).toHaveLength(1);
      expect(result.current.tags).toContain('startup');
      expect(result.current.categories).toContain('init');
    });
  });

  it('summary and stats are loaded on mount', async () => {
    const { result } = renderHook(() => useSshScripts());
    await waitFor(() => {
      expect(result.current.summary).toEqual(mockSummary);
      expect(result.current.stats).toEqual(mockStats);
    });
  });

  it('createScript calls invoke and refreshes', async () => {
    const newScript = { ...mockScript, id: 'sc3', name: 'New' };

    const { result } = renderHook(() => useSshScripts());
    await waitFor(() => expect(result.current.scripts).toHaveLength(2));

    // Set up mocks for create + subsequent refresh
    (invoke as Mock)
      .mockResolvedValueOnce(newScript) // create
      .mockResolvedValueOnce([mockScript, mockScript2, newScript]) // list_scripts
      .mockResolvedValueOnce([mockChain])
      .mockResolvedValueOnce(['startup', 'cleanup', 'deploy'])
      .mockResolvedValueOnce(['init', 'maintenance', 'devops'])
      .mockResolvedValueOnce(mockSummary)
      .mockResolvedValueOnce(mockStats);

    await act(async () => {
      const created = await result.current.createScript({
        name: 'New',
        content: 'echo new',
        language: 'bash',
        trigger: { type: 'manual' },
      });
      expect(created.name).toBe('New');
    });
  });

  it('deleteScript calls invoke and clears selected if matching', async () => {
    const { result } = renderHook(() => useSshScripts());
    await waitFor(() => expect(result.current.scripts).toHaveLength(2));

    act(() => {
      result.current.selectScript(mockScript);
    });
    expect(result.current.selectedScript?.id).toBe('sc1');

    (invoke as Mock)
      .mockResolvedValueOnce(undefined) // delete
      .mockResolvedValueOnce([mockScript2])
      .mockResolvedValueOnce([mockChain])
      .mockResolvedValueOnce(['cleanup'])
      .mockResolvedValueOnce(['maintenance'])
      .mockResolvedValueOnce(mockSummary)
      .mockResolvedValueOnce(mockStats);

    await act(async () => {
      await result.current.deleteScript('sc1');
    });

    expect(result.current.selectedScript).toBeNull();
  });

  it('duplicateScript calls invoke with scriptId', async () => {
    const duped = { ...mockScript, id: 'sc1-dup', name: 'Startup Script (copy)' };

    const { result } = renderHook(() => useSshScripts());
    await waitFor(() => expect(result.current.scripts).toHaveLength(2));

    // Set up mocks for duplicate + subsequent refresh
    (invoke as Mock)
      .mockResolvedValueOnce(duped)
      .mockResolvedValueOnce([mockScript, mockScript2, duped])
      .mockResolvedValueOnce([mockChain])
      .mockResolvedValueOnce(['startup', 'cleanup'])
      .mockResolvedValueOnce(['init', 'maintenance'])
      .mockResolvedValueOnce(mockSummary)
      .mockResolvedValueOnce(mockStats);

    await act(async () => {
      const created = await result.current.duplicateScript('sc1');
      expect(created.id).toBe('sc1-dup');
    });
  });

  it('toggleScript enables/disables a script', async () => {
    const { result } = renderHook(() => useSshScripts());
    await waitFor(() => expect(result.current.loading).toBe(false));

    (invoke as Mock)
      .mockResolvedValueOnce(undefined) // toggle
      .mockResolvedValueOnce([mockScript, mockScript2])
      .mockResolvedValueOnce([mockChain])
      .mockResolvedValueOnce(['startup', 'cleanup'])
      .mockResolvedValueOnce(['init', 'maintenance'])
      .mockResolvedValueOnce(mockSummary)
      .mockResolvedValueOnce(mockStats);

    await act(async () => {
      await result.current.toggleScript('sc1', false);
    });

    expect(invoke).toHaveBeenCalledWith('ssh_scripts_toggle_script', { scriptId: 'sc1', enabled: false });
  });

  it('runScript adds execution to pendingExecutions', async () => {
    const pending: PendingExecution = {
      executionId: 'ex1',
      scriptId: 'sc1',
      scriptName: 'Startup Script',
      sessionId: 'sess1',
      triggerType: 'manual',
      content: 'echo hello',
      language: 'bash',
      executionMode: 'shell',
      timeoutMs: 30000,
      environment: {},
      resolvedVariables: {},
      onFailure: 'continue',
      maxRetries: 0,
      retryDelayMs: 1000,
    };

    const { result } = renderHook(() => useSshScripts());
    await waitFor(() => expect(result.current.loading).toBe(false));

    (invoke as Mock).mockResolvedValueOnce(pending);

    await act(async () => {
      const exec = await result.current.runScript({ scriptId: 'sc1', sessionId: 'sess1' });
      expect(exec.executionId).toBe('ex1');
    });

    expect(result.current.pendingExecutions).toHaveLength(1);
  });

  it('queryHistory fetches and sets history', async () => {
    const histResponse: HistoryResponse = {
      records: [
        {
          id: 'h1', scriptId: 'sc1', scriptName: 'Startup Script',
          triggerType: 'manual', status: 'success', exitCode: 0,
          stdout: 'hello', stderr: '', startedAt: '2025-01-01', durationMs: 100,
          attempt: 1, variables: {}, environment: {},
        },
      ],
      total: 1,
      offset: 0,
      limit: 50,
    };

    const { result } = renderHook(() => useSshScripts());
    await waitFor(() => expect(result.current.loading).toBe(false));

    (invoke as Mock).mockResolvedValueOnce(histResponse);

    await act(async () => {
      const res = await result.current.queryHistory({ offset: 0, limit: 50 });
      expect(res.total).toBe(1);
    });

    expect(result.current.history).toHaveLength(1);
    expect(result.current.historyTotal).toBe(1);
  });

  it('clearHistory empties history state', async () => {
    const { result } = renderHook(() => useSshScripts());
    await waitFor(() => expect(result.current.loading).toBe(false));

    (invoke as Mock).mockResolvedValueOnce(undefined);

    await act(async () => {
      await result.current.clearHistory();
    });

    expect(invoke).toHaveBeenCalledWith('ssh_scripts_clear_history');
    expect(result.current.history).toEqual([]);
    expect(result.current.historyTotal).toBe(0);
  });

  it('filters scripts by search query', async () => {
    const { result } = renderHook(() => useSshScripts());
    await waitFor(() => expect(result.current.scripts).toHaveLength(2));

    act(() => {
      result.current.setSearchFilter('Startup');
    });

    expect(result.current.scripts).toHaveLength(1);
    expect(result.current.scripts[0].name).toBe('Startup Script');
  });

  it('filters scripts by trigger type', async () => {
    const { result } = renderHook(() => useSshScripts());
    await waitFor(() => expect(result.current.scripts).toHaveLength(2));

    act(() => {
      result.current.setTriggerFilter('login');
    });

    expect(result.current.scripts).toHaveLength(1);
    expect(result.current.scripts[0].id).toBe('sc1');
  });

  it('exportScripts calls correct invoke command', async () => {
    const bundle: ScriptBundle = {
      version: '1.0',
      exportedAt: '2025-01-01',
      scripts: [mockScript],
      chains: [mockChain],
    };

    const { result } = renderHook(() => useSshScripts());
    await waitFor(() => expect(result.current.loading).toBe(false));

    (invoke as Mock).mockResolvedValueOnce(bundle);

    await act(async () => {
      const exported = await result.current.exportScripts();
      expect(exported.scripts).toHaveLength(1);
    });

    expect(invoke).toHaveBeenCalledWith('ssh_scripts_export');
  });

  it('importScripts calls invoke and refreshes', async () => {
    const importResult: ImportResult = {
      scriptsImported: 2,
      chainsImported: 1,
      scriptsSkipped: 0,
      chainsSkipped: 0,
    };

    const bundle: ScriptBundle = {
      version: '1.0',
      exportedAt: '2025-01-01',
      scripts: [mockScript],
      chains: [mockChain],
    };

    const { result } = renderHook(() => useSshScripts());
    await waitFor(() => expect(result.current.loading).toBe(false));

    (invoke as Mock)
      .mockResolvedValueOnce(importResult) // import
      .mockResolvedValueOnce([mockScript, mockScript2])
      .mockResolvedValueOnce([mockChain])
      .mockResolvedValueOnce(['startup', 'cleanup'])
      .mockResolvedValueOnce(['init', 'maintenance'])
      .mockResolvedValueOnce(mockSummary)
      .mockResolvedValueOnce(mockStats);

    await act(async () => {
      const res = await result.current.importScripts(bundle);
      expect(res.scriptsImported).toBe(2);
    });
  });

  it('handles refresh errors gracefully', async () => {
    (invoke as Mock).mockRejectedValue(new Error('backend down'));

    const { result } = renderHook(() => useSshScripts());

    await waitFor(() => {
      expect(result.current.error).toBe('Error: backend down');
      expect(result.current.loading).toBe(false);
    });
  });

  it('bulkDelete calls invoke with script IDs', async () => {
    const { result } = renderHook(() => useSshScripts());
    await waitFor(() => expect(result.current.loading).toBe(false));

    (invoke as Mock)
      .mockResolvedValueOnce(2) // bulkDelete
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([mockChain])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(mockSummary)
      .mockResolvedValueOnce({});

    await act(async () => {
      const count = await result.current.bulkDelete(['sc1', 'sc2']);
      expect(count).toBe(2);
    });

    expect(invoke).toHaveBeenCalledWith('ssh_scripts_bulk_delete', { scriptIds: ['sc1', 'sc2'] });
  });
});
