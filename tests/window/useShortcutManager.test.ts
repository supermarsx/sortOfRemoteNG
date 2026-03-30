import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, f?: string) => f || k }),
}));

vi.mock('../../src/contexts/useConnections', () => ({
  useConnections: () => ({
    state: { connections: [], sessions: [] },
  }),
}));

const mockCollectionManager = {
  getAllCollections: vi.fn().mockResolvedValue([]),
};

vi.mock('../../src/utils/connection/collectionManager', () => ({
  CollectionManager: {
    getInstance: () => mockCollectionManager,
  },
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}));

// ── Storage key used by hook ─────────────────────────────────────

const STORAGE_KEY = 'sortofremoteng-shortcuts';

// Lazily import the hook to avoid OOM from heavy static module graph
async function getHook() {
  const mod = await import('../../src/hooks/window/useShortcutManager');
  return mod.useShortcutManager;
}

// ── Tests ──────────────────────────────────────────────────────────

describe('useShortcutManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('initializes with empty shortcuts when localStorage is empty', async () => {
    const useShortcutManager = await getHook();
    const { result } = renderHook(() => useShortcutManager(true));
    expect(result.current.shortcuts).toEqual([]);
  });

  it('loads persisted shortcuts from localStorage', async () => {
    const stored = [
      { id: '1', name: 'Test', path: 'C:\\test.lnk', createdAt: '2025-01-01', exists: true },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    const useShortcutManager = await getHook();
    const { result } = renderHook(() => useShortcutManager(true));
    await waitFor(() => {
      expect(result.current.shortcuts.length).toBe(1);
      expect(result.current.shortcuts[0].name).toBe('Test');
    });
  });

  it('exposes form state setters', async () => {
    const useShortcutManager = await getHook();
    const { result } = renderHook(() => useShortcutManager(true));
    expect(typeof result.current.setShortcutName).toBe('function');
    expect(typeof result.current.setSelectedCollectionId).toBe('function');
    expect(typeof result.current.setSelectedConnectionId).toBe('function');
    expect(typeof result.current.setSelectedFolder).toBe('function');
    expect(typeof result.current.setCustomFolderPath).toBe('function');
  });

  it('shortcutName defaults to empty string', async () => {
    const useShortcutManager = await getHook();
    const { result } = renderHook(() => useShortcutManager(true));
    expect(result.current.shortcutName).toBe('');
  });

  it('selectedFolder defaults to desktop', async () => {
    const useShortcutManager = await getHook();
    const { result } = renderHook(() => useShortcutManager(true));
    expect(result.current.selectedFolder).toBe('desktop');
  });

  it('updating shortcutName reflects in state', async () => {
    const useShortcutManager = await getHook();
    const { result } = renderHook(() => useShortcutManager(true));
    act(() => {
      result.current.setShortcutName('My Shortcut');
    });
    expect(result.current.shortcutName).toBe('My Shortcut');
  });

  it('cleanup removes missing shortcuts from localStorage', async () => {
    const stored = [
      { id: '1', name: 'Exists', path: 'C:\\exists.lnk', createdAt: '2025-01-01', exists: true },
      { id: '2', name: 'Gone', path: 'C:\\gone.lnk', createdAt: '2025-01-01', exists: false },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    const useShortcutManager = await getHook();
    const { result } = renderHook(() => useShortcutManager(true));
    await waitFor(() => expect(result.current.shortcuts.length).toBe(2));

    act(() => {
      result.current.cleanupShortcuts();
    });

    await waitFor(() => {
      expect(result.current.shortcuts.length).toBe(1);
      expect(result.current.shortcuts[0].name).toBe('Exists');
    });
  });

  it('does not load data when isOpen is false', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([
      { id: '1', name: 'X', path: 'C:\\x.lnk', createdAt: '2025-01-01', exists: true },
    ]));

    const useShortcutManager = await getHook();
    const { result } = renderHook(() => useShortcutManager(false));
    expect(result.current.shortcuts).toEqual([]);
  });

  it('statusMessage and errorMessage default to empty', async () => {
    const useShortcutManager = await getHook();
    const { result } = renderHook(() => useShortcutManager(true));
    expect(result.current.statusMessage).toBe('');
    expect(result.current.errorMessage).toBe('');
  });

  it('handleEditShortcut populates form fields', async () => {
    const stored = [
      { id: '1', name: 'Edit Me', path: 'C:\\edit.lnk', collectionId: 'col1', connectionId: 'conn1', createdAt: '2025-01-01', exists: true },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    const useShortcutManager = await getHook();
    const { result } = renderHook(() => useShortcutManager(true));
    await waitFor(() => expect(result.current.shortcuts.length).toBe(1));

    act(() => {
      result.current.handleEditShortcut(result.current.shortcuts[0]);
    });

    expect(result.current.shortcutName).toBe('Edit Me');
    expect(result.current.editingShortcut).toBeDefined();
    expect(result.current.editingShortcut!.id).toBe('1');
  });

  it('cancelEditing clears editing state and form', async () => {
    const stored = [
      { id: '1', name: 'X', path: 'C:\\x.lnk', createdAt: '2025-01-01', exists: true },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    const useShortcutManager = await getHook();
    const { result } = renderHook(() => useShortcutManager(true));
    await waitFor(() => expect(result.current.shortcuts.length).toBe(1));

    act(() => {
      result.current.handleEditShortcut(result.current.shortcuts[0]);
    });
    expect(result.current.editingShortcut).not.toBeNull();

    act(() => {
      result.current.cancelEditing();
    });
    expect(result.current.editingShortcut).toBeNull();
    expect(result.current.shortcutName).toBe('');
  });
});
