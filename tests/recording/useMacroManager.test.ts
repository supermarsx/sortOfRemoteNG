import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useMacroManager } from '../../src/hooks/recording/useMacroManager';
import type { TerminalMacro, SavedRecording } from '../../src/types/recording/macroTypes';

// ── Service mock ───────────────────────────────────────────────────

const mockMacros: TerminalMacro[] = [
  {
    id: 'm1',
    name: 'Deploy',
    description: 'Deploy to production',
    category: 'DevOps',
    steps: [{ command: 'git pull', delayMs: 200, sendNewline: true }],
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    tags: ['deploy', 'git'],
  },
  {
    id: 'm2',
    name: 'Cleanup',
    description: 'Clean temp files',
    category: 'Maintenance',
    steps: [{ command: 'rm -rf /tmp/*', delayMs: 100, sendNewline: true }],
    createdAt: '2025-02-01T00:00:00Z',
    updatedAt: '2025-02-01T00:00:00Z',
    tags: ['cleanup'],
  },
];

const mockRecordings: SavedRecording[] = [
  {
    id: 'r1',
    name: 'Session 1',
    recording: {
      metadata: {
        session_id: 'sess1',
        start_time: '2025-01-01T00:00:00Z',
        end_time: '2025-01-01T00:01:00Z',
        host: 'server1.example.com',
        username: 'admin',
        cols: 80,
        rows: 24,
        duration_ms: 60000,
        entry_count: 50,
      },
      entries: [],
    },
    savedAt: '2025-01-01T00:02:00Z',
    tags: ['prod'],
  },
];

vi.mock('../../src/utils/recording/macroService', () => ({
  loadMacros: vi.fn().mockResolvedValue([]),
  loadRecordings: vi.fn().mockResolvedValue([]),
  saveMacro: vi.fn().mockResolvedValue(undefined),
  deleteMacro: vi.fn().mockResolvedValue(undefined),
  deleteRecording: vi.fn().mockResolvedValue(undefined),
  saveRecording: vi.fn().mockResolvedValue(undefined),
  exportRecording: vi.fn().mockResolvedValue('{}'),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, f?: string) => f || k }),
}));

import * as macroService from '../../src/utils/recording/macroService';

// ── Tests ──────────────────────────────────────────────────────────

describe('useMacroManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (macroService.loadMacros as Mock).mockResolvedValue([...mockMacros]);
    (macroService.loadRecordings as Mock).mockResolvedValue([...mockRecordings]);
  });

  it('loads macros and recordings when isOpen is true', async () => {
    const { result } = renderHook(() => useMacroManager(true));
    await waitFor(() => {
      expect(result.current.macros).toHaveLength(2);
      expect(result.current.recordings).toHaveLength(1);
    });
  });

  it('does not load when isOpen is false', async () => {
    renderHook(() => useMacroManager(false));
    expect(macroService.loadMacros).not.toHaveBeenCalled();
  });

  it('defaults to macros tab', () => {
    const { result } = renderHook(() => useMacroManager(true));
    expect(result.current.activeTab).toBe('macros');
  });

  it('switches active tab', () => {
    const { result } = renderHook(() => useMacroManager(true));
    act(() => {
      result.current.setActiveTab('recordings');
    });
    expect(result.current.activeTab).toBe('recordings');
  });

  it('filters macros by search query', async () => {
    const { result } = renderHook(() => useMacroManager(true));
    await waitFor(() => expect(result.current.macros).toHaveLength(2));

    act(() => {
      result.current.setSearchQuery('deploy');
    });

    expect(result.current.filteredMacros).toHaveLength(1);
    expect(result.current.filteredMacros[0].name).toBe('Deploy');
  });

  it('filters macros by tag', async () => {
    const { result } = renderHook(() => useMacroManager(true));
    await waitFor(() => expect(result.current.macros).toHaveLength(2));

    act(() => {
      result.current.setSearchQuery('cleanup');
    });

    expect(result.current.filteredMacros).toHaveLength(1);
    expect(result.current.filteredMacros[0].id).toBe('m2');
  });

  it('groups macros by category', async () => {
    const { result } = renderHook(() => useMacroManager(true));
    await waitFor(() => expect(result.current.macros).toHaveLength(2));

    expect(result.current.macrosByCategory['DevOps']).toHaveLength(1);
    expect(result.current.macrosByCategory['Maintenance']).toHaveLength(1);
  });

  it('handleNewMacro creates a blank macro in editing state', async () => {
    const { result } = renderHook(() => useMacroManager(true));
    await waitFor(() => expect(result.current.macros).toHaveLength(2));

    act(() => {
      result.current.handleNewMacro();
    });

    expect(result.current.editingMacro).not.toBeNull();
    expect(result.current.editingMacro!.name).toBe('New Macro');
    expect(result.current.editingMacro!.steps).toHaveLength(1);
  });

  it('handleSaveMacro calls service and clears editing state', async () => {
    const { result } = renderHook(() => useMacroManager(true));
    await waitFor(() => expect(result.current.macros).toHaveLength(2));

    act(() => {
      result.current.handleNewMacro();
    });

    await act(async () => {
      await result.current.handleSaveMacro(result.current.editingMacro!);
    });

    expect(macroService.saveMacro).toHaveBeenCalled();
    expect(result.current.editingMacro).toBeNull();
  });

  it('handleDeleteMacro removes macro via service and reloads', async () => {
    const { result } = renderHook(() => useMacroManager(true));
    await waitFor(() => expect(result.current.macros).toHaveLength(2));

    await act(async () => {
      await result.current.handleDeleteMacro('m1');
    });

    expect(macroService.deleteMacro).toHaveBeenCalledWith('m1');
    expect(macroService.loadMacros).toHaveBeenCalledTimes(2); // initial + reload
  });

  it('handleDuplicateMacro creates a copy with new id', async () => {
    const { result } = renderHook(() => useMacroManager(true));
    await waitFor(() => expect(result.current.macros).toHaveLength(2));

    await act(async () => {
      await result.current.handleDuplicateMacro(result.current.macros[0]);
    });

    expect(macroService.saveMacro).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Deploy (Copy)',
      }),
    );
  });

  it('handleDeleteRecording removes recording via service', async () => {
    const { result } = renderHook(() => useMacroManager(true));
    await waitFor(() => expect(result.current.recordings).toHaveLength(1));

    await act(async () => {
      await result.current.handleDeleteRecording('r1');
    });

    expect(macroService.deleteRecording).toHaveBeenCalledWith('r1');
  });

  it('handleRenameRecording updates the recording name', async () => {
    const { result } = renderHook(() => useMacroManager(true));
    await waitFor(() => expect(result.current.recordings).toHaveLength(1));

    await act(async () => {
      await result.current.handleRenameRecording(result.current.recordings[0], 'Renamed');
    });

    expect(macroService.saveRecording).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Renamed' }),
    );
  });

  it('returns empty filtered lists when search matches nothing', async () => {
    const { result } = renderHook(() => useMacroManager(true));
    await waitFor(() => expect(result.current.macros).toHaveLength(2));

    act(() => {
      result.current.setSearchQuery('zzz-no-match-zzz');
    });

    expect(result.current.filteredMacros).toHaveLength(0);
    expect(result.current.filteredRecordings).toHaveLength(0);
  });
});
