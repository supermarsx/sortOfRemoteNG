import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock generateId
let idCounter = 0;
vi.mock('../../src/utils/core/id', () => ({
  generateId: () => `gen-${++idCounter}`,
}));

import { useSSHCommandHistory } from '../../src/hooks/ssh/useSSHCommandHistory';
import type { CommandExecution } from '../../src/types/ssh/sshCommandHistory';

// ── Helpers ───────────────────────────────────────────────────

function makeExecution(overrides: Partial<CommandExecution> = {}): CommandExecution {
  return {
    sessionId: 'sess-1',
    sessionName: 'my-server',
    hostname: '10.0.0.1',
    status: 'success',
    output: 'ok',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe('useSSHCommandHistory – extended', () => {
  beforeEach(() => {
    idCounter = 0;
    localStorage.clear();
  });

  // ── Initial state ──────────────────────────────────────────

  it('starts with empty entries when localStorage is empty', () => {
    const { result } = renderHook(() => useSSHCommandHistory());
    expect(result.current.entries).toEqual([]);
    expect(result.current.stats.totalCommands).toBe(0);
  });

  it('loads config defaults', () => {
    const { result } = renderHook(() => useSSHCommandHistory());
    expect(result.current.config.maxEntries).toBe(1000);
    expect(result.current.config.retentionDays).toBe(90);
    expect(result.current.config.persistEnabled).toBe(true);
    expect(result.current.config.autoCategorize).toBe(true);
  });

  // ── addEntry ───────────────────────────────────────────────

  it('adds a command and creates an entry', () => {
    const { result } = renderHook(() => useSSHCommandHistory());

    act(() => {
      result.current.addEntry('ls -la', [makeExecution()]);
    });

    expect(result.current.allEntries).toHaveLength(1);
    expect(result.current.allEntries[0].command).toBe('ls -la');
    expect(result.current.allEntries[0].executionCount).toBe(1);
  });

  it('auto-detects docker category', () => {
    const { result } = renderHook(() => useSSHCommandHistory());

    act(() => {
      result.current.addEntry('docker ps -a', [makeExecution()]);
    });

    expect(result.current.allEntries[0].category).toBe('docker');
  });

  it('auto-detects git category', () => {
    const { result } = renderHook(() => useSSHCommandHistory());

    act(() => {
      result.current.addEntry('git status', [makeExecution()]);
    });

    expect(result.current.allEntries[0].category).toBe('git');
  });

  it('auto-detects network category', () => {
    const { result } = renderHook(() => useSSHCommandHistory());

    act(() => {
      result.current.addEntry('ping 8.8.8.8', [makeExecution()]);
    });

    expect(result.current.allEntries[0].category).toBe('network');
  });

  it('auto-detects kubernetes category', () => {
    const { result } = renderHook(() => useSSHCommandHistory());

    act(() => {
      result.current.addEntry('kubectl get pods', [makeExecution()]);
    });

    expect(result.current.allEntries[0].category).toBe('kubernetes');
  });

  it('auto-detects database category', () => {
    const { result } = renderHook(() => useSSHCommandHistory());

    act(() => {
      result.current.addEntry('psql -U admin mydb', [makeExecution()]);
    });

    expect(result.current.allEntries[0].category).toBe('database');
  });

  it('auto-detects service category', () => {
    const { result } = renderHook(() => useSSHCommandHistory());

    act(() => {
      result.current.addEntry('systemctl restart nginx', [makeExecution()]);
    });

    expect(result.current.allEntries[0].category).toBe('service');
  });

  it('classifies unknown commands as "unknown"', () => {
    const { result } = renderHook(() => useSSHCommandHistory());

    act(() => {
      result.current.addEntry('myCustomBinary --flag', [makeExecution()]);
    });

    expect(result.current.allEntries[0].category).toBe('unknown');
  });

  it('increments executionCount for duplicate commands', () => {
    const { result } = renderHook(() => useSSHCommandHistory());

    act(() => {
      result.current.addEntry('uptime', [makeExecution()]);
    });
    act(() => {
      result.current.addEntry('uptime', [makeExecution()]);
    });

    expect(result.current.allEntries).toHaveLength(1);
    expect(result.current.allEntries[0].executionCount).toBe(2);
  });

  // ── toggleStar ─────────────────────────────────────────────

  it('stars and unstars an entry', () => {
    const { result } = renderHook(() => useSSHCommandHistory());

    act(() => {
      result.current.addEntry('echo hi', [makeExecution()]);
    });

    const id = result.current.allEntries[0].id;
    expect(result.current.allEntries[0].starred).toBe(false);

    act(() => {
      result.current.toggleStar(id);
    });
    expect(result.current.allEntries[0].starred).toBe(true);

    act(() => {
      result.current.toggleStar(id);
    });
    expect(result.current.allEntries[0].starred).toBe(false);
  });

  // ── deleteEntry ────────────────────────────────────────────

  it('deletes an entry by id', () => {
    const { result } = renderHook(() => useSSHCommandHistory());

    act(() => {
      result.current.addEntry('cmd1', [makeExecution()]);
    });
    act(() => {
      result.current.addEntry('cmd2', [makeExecution()]);
    });

    expect(result.current.allEntries).toHaveLength(2);

    const idToDelete = result.current.allEntries[0].id;

    act(() => {
      result.current.deleteEntry(idToDelete);
    });

    expect(result.current.allEntries).toHaveLength(1);
    expect(result.current.allEntries.find((e) => e.id === idToDelete)).toBeUndefined();
  });

  // ── clearHistory ───────────────────────────────────────────

  it('clears all entries when keepStarred=false', () => {
    const { result } = renderHook(() => useSSHCommandHistory());

    act(() => {
      result.current.addEntry('a', [makeExecution()]);
      result.current.addEntry('b', [makeExecution()]);
    });

    act(() => {
      result.current.clearHistory(false);
    });

    expect(result.current.allEntries).toEqual([]);
  });

  it('clears only non-starred entries by default', () => {
    const { result } = renderHook(() => useSSHCommandHistory());

    act(() => {
      result.current.addEntry('keep', [makeExecution()]);
    });
    act(() => {
      result.current.addEntry('remove', [makeExecution()]);
    });

    const keepId = result.current.allEntries.find((e) => e.command === 'keep')!.id;

    act(() => {
      result.current.toggleStar(keepId);
    });

    act(() => {
      result.current.clearHistory();
    });

    expect(result.current.allEntries).toHaveLength(1);
    expect(result.current.allEntries[0].command).toBe('keep');
  });

  // ── Filter by search text ─────────────────────────────────

  it('filters entries by search query (fuzzy)', () => {
    const { result } = renderHook(() => useSSHCommandHistory());

    act(() => {
      result.current.addEntry('docker ps', [makeExecution()]);
    });
    act(() => {
      result.current.addEntry('git status', [makeExecution()]);
    });
    act(() => {
      result.current.addEntry('docker compose up', [makeExecution()]);
    });

    act(() => {
      result.current.updateFilter({ searchQuery: 'docker' });
    });

    expect(result.current.entries).toHaveLength(2);
    expect(result.current.entries.every((e) => e.command.includes('docker'))).toBe(true);
  });

  // ── Filter by category ────────────────────────────────────

  it('filters entries by category', () => {
    const { result } = renderHook(() => useSSHCommandHistory());

    act(() => {
      result.current.addEntry('docker ps', [makeExecution()]);
    });
    act(() => {
      result.current.addEntry('git log', [makeExecution()]);
    });

    act(() => {
      result.current.updateFilter({ category: 'git' });
    });

    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].command).toBe('git log');
  });

  // ── Export JSON ────────────────────────────────────────────

  it('exports history as JSON with metadata', () => {
    const { result } = renderHook(() => useSSHCommandHistory());

    act(() => {
      result.current.addEntry('whoami', [makeExecution()]);
    });

    let exported = '';
    act(() => {
      exported = result.current.exportHistory({
        format: 'json',
        includeOutput: false,
        includeMetadata: true,
        starredOnly: false,
      });
    });

    const parsed = JSON.parse(exported);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].command).toBe('whoami');
    expect(parsed[0].id).toBeDefined();
  });

  it('exports JSON without metadata', () => {
    const { result } = renderHook(() => useSSHCommandHistory());

    act(() => {
      result.current.addEntry('date', [makeExecution()]);
    });

    let exported = '';
    act(() => {
      exported = result.current.exportHistory({
        format: 'json',
        includeOutput: false,
        includeMetadata: false,
        starredOnly: false,
      });
    });

    const parsed = JSON.parse(exported);
    expect(parsed[0].id).toBeUndefined();
    expect(parsed[0].command).toBe('date');
  });

  // ── Export shell ───────────────────────────────────────────

  it('exports history as shell script', () => {
    const { result } = renderHook(() => useSSHCommandHistory());

    act(() => {
      result.current.addEntry('echo hello', [makeExecution()]);
    });

    let exported = '';
    act(() => {
      exported = result.current.exportHistory({
        format: 'shell',
        includeOutput: false,
        includeMetadata: false,
        starredOnly: false,
      });
    });

    expect(exported).toContain('#!/usr/bin/env bash');
    expect(exported).toContain('echo hello');
  });

  // ── Export CSV ─────────────────────────────────────────────

  it('exports history as CSV', () => {
    const { result } = renderHook(() => useSSHCommandHistory());

    act(() => {
      result.current.addEntry('free -m', [makeExecution()]);
    });

    let exported = '';
    act(() => {
      exported = result.current.exportHistory({
        format: 'csv',
        includeOutput: false,
        includeMetadata: false,
        starredOnly: false,
      });
    });

    const lines = exported.split('\n');
    expect(lines[0]).toContain('command');
    expect(lines[0]).toContain('category');
    expect(lines[1]).toContain('free -m');
  });

  // ── Import ─────────────────────────────────────────────────

  it('imports JSON history', () => {
    const { result } = renderHook(() => useSSHCommandHistory());

    const data = JSON.stringify([{ command: 'imported-cmd', executionCount: 3 }]);

    let importResult: { imported: number; duplicatesSkipped: number };
    act(() => {
      importResult = result.current.importHistory(data);
    });

    expect(importResult!.imported).toBe(1);
    expect(result.current.allEntries.find((e) => e.command === 'imported-cmd')).toBeDefined();
  });

  it('skips duplicate commands on import', () => {
    const { result } = renderHook(() => useSSHCommandHistory());

    act(() => {
      result.current.addEntry('existing', [makeExecution()]);
    });

    const data = JSON.stringify([{ command: 'existing' }, { command: 'new-one' }]);

    let importResult: { imported: number; duplicatesSkipped: number };
    act(() => {
      importResult = result.current.importHistory(data);
    });

    expect(importResult!.imported).toBe(1);
    expect(importResult!.duplicatesSkipped).toBe(1);
  });

  // ── Config update ──────────────────────────────────────────

  it('updates and persists config to localStorage', () => {
    const { result } = renderHook(() => useSSHCommandHistory());

    act(() => {
      result.current.updateConfig({ maxEntries: 500 });
    });

    expect(result.current.config.maxEntries).toBe(500);
    const stored = JSON.parse(localStorage.getItem('sshCommandHistoryConfig')!);
    expect(stored.maxEntries).toBe(500);
  });

  // ── Starred entries survive retention ──────────────────────

  it('preserves starred entries during retention enforcement', () => {
    const { result } = renderHook(() => useSSHCommandHistory());

    act(() => {
      result.current.updateConfig({ maxEntries: 2 });
    });

    act(() => {
      result.current.addEntry('cmd-a', [makeExecution()]);
    });
    act(() => {
      result.current.addEntry('cmd-b', [makeExecution()]);
    });

    const starId = result.current.allEntries.find((e) => e.command === 'cmd-a')!.id;
    act(() => {
      result.current.toggleStar(starId);
    });

    act(() => {
      result.current.addEntry('cmd-c', [makeExecution()]);
    });

    expect(result.current.allEntries.find((e) => e.command === 'cmd-a')).toBeDefined();
    expect(result.current.allEntries.find((e) => e.command === 'cmd-a')!.starred).toBe(true);
  });

  // ── Stats ──────────────────────────────────────────────────

  it('computes stats correctly', () => {
    const { result } = renderHook(() => useSSHCommandHistory());

    act(() => {
      result.current.addEntry('docker ps', [makeExecution()]);
    });
    act(() => {
      result.current.addEntry('git log', [makeExecution({ status: 'error' })]);
    });

    expect(result.current.stats.totalCommands).toBe(2);
    expect(result.current.stats.totalExecutions).toBe(2);
    expect(result.current.stats.categoryBreakdown.docker).toBe(1);
    expect(result.current.stats.categoryBreakdown.git).toBe(1);
  });

  // ── Panel toggle ───────────────────────────────────────────

  it('toggles panel visibility', () => {
    const { result } = renderHook(() => useSSHCommandHistory());

    expect(result.current.isOpen).toBe(false);

    act(() => result.current.togglePanel());
    expect(result.current.isOpen).toBe(true);

    act(() => result.current.togglePanel());
    expect(result.current.isOpen).toBe(false);
  });

  // ── Reset filter ───────────────────────────────────────────

  it('resets filter to defaults', () => {
    const { result } = renderHook(() => useSSHCommandHistory());

    act(() => {
      result.current.updateFilter({ searchQuery: 'test', category: 'docker' });
    });
    expect(result.current.filter.searchQuery).toBe('test');

    act(() => {
      result.current.resetFilter();
    });

    expect(result.current.filter.searchQuery).toBe('');
    expect(result.current.filter.category).toBe('all');
  });
});
