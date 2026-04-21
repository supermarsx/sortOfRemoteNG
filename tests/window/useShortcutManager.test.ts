import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, f?: string) => f || k }),
}));

vi.mock('../../src/contexts/useConnections', () => ({
  useConnections: () => ({
    state: {
      connections: [
        { id: 'c1', name: 'Server Alpha' },
        { id: 'c2', name: 'Server Beta' },
      ],
      sessions: [],
    },
  }),
}));

const mockCollectionManager = {
  getAllCollections: vi.fn().mockResolvedValue([
    { id: 'col1', name: 'Collection A' },
    { id: 'col2', name: 'Collection B' },
  ]),
};

vi.mock('../../src/utils/connection/collectionManager', () => ({
  CollectionManager: {
    getInstance: () => mockCollectionManager,
  },
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}));

// ── Helpers ────────────────────────────────────────────────────────

const STORAGE_KEY = 'sortofremoteng-shortcuts';

async function getHook() {
  const mod = await import('../../src/hooks/window/useShortcutManager');
  return mod.useShortcutManager;
}

function makeShortcut(overrides: Record<string, any> = {}) {
  return {
    id: '1',
    name: 'My Shortcut',
    path: 'C:\\Users\\Desktop\\shortcut.lnk',
    createdAt: '2025-01-01T00:00:00Z',
    exists: true,
    ...overrides,
  };
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

  it('loads persisted shortcuts from localStorage on open', async () => {
    const stored = [makeShortcut()];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    const useShortcutManager = await getHook();
    const { result } = renderHook(() => useShortcutManager(true));
    await waitFor(() => {
      expect(result.current.shortcuts.length).toBe(1);
      expect(result.current.shortcuts[0].name).toBe('My Shortcut');
    });
  });

  it('form defaults: shortcutName is empty, selectedFolder is desktop', async () => {
    const useShortcutManager = await getHook();
    const { result } = renderHook(() => useShortcutManager(true));
    expect(result.current.shortcutName).toBe('');
    expect(result.current.selectedFolder).toBe('desktop');
  });

  it('selectedCollectionId and selectedConnectionId default to empty strings', async () => {
    const useShortcutManager = await getHook();
    const { result } = renderHook(() => useShortcutManager(true));
    expect(result.current.selectedCollectionId).toBe('');
    expect(result.current.selectedConnectionId).toBe('');
  });

  it('statusMessage and errorMessage default to empty', async () => {
    const useShortcutManager = await getHook();
    const { result } = renderHook(() => useShortcutManager(true));
    expect(result.current.statusMessage).toBe('');
    expect(result.current.errorMessage).toBe('');
  });

  it('does not load data when isOpen is false', async () => {
    const useShortcutManager = await getHook();
    const spy = mockCollectionManager.getAllCollections;
    spy.mockClear();
    renderHook(() => useShortcutManager(false));
    await new Promise((r) => setTimeout(r, 50));
    expect(spy).not.toHaveBeenCalled();
  });

  it('exposes form state setters that update form values', async () => {
    const useShortcutManager = await getHook();
    const { result } = renderHook(() => useShortcutManager(true));
    act(() => result.current.setShortcutName('New Name'));
    expect(result.current.shortcutName).toBe('New Name');
    act(() => result.current.setSelectedFolder('documents'));
    expect(result.current.selectedFolder).toBe('documents');
  });

  it('handleEditShortcut populates form fields from shortcut', async () => {
    const shortcut = makeShortcut({ collectionId: 'col1', connectionId: 'c1' });
    localStorage.setItem(STORAGE_KEY, JSON.stringify([shortcut]));
    const useShortcutManager = await getHook();
    const { result } = renderHook(() => useShortcutManager(true));
    await waitFor(() => expect(result.current.shortcuts.length).toBe(1));
    act(() => result.current.handleEditShortcut(shortcut as any));
    expect(result.current.shortcutName).toBe('My Shortcut');
    expect(result.current.selectedCollectionId).toBe('col1');
    expect(result.current.selectedConnectionId).toBe('c1');
    expect(result.current.editingShortcut).not.toBeNull();
  });

  it('cancelEditing clears editing state and resets form', async () => {
    const shortcut = makeShortcut({ collectionId: 'col1' });
    localStorage.setItem(STORAGE_KEY, JSON.stringify([shortcut]));
    const useShortcutManager = await getHook();
    const { result } = renderHook(() => useShortcutManager(true));
    await waitFor(() => expect(result.current.shortcuts.length).toBe(1));
    act(() => result.current.handleEditShortcut(shortcut as any));
    expect(result.current.editingShortcut).not.toBeNull();
    act(() => result.current.cancelEditing());
    expect(result.current.editingShortcut).toBeNull();
    expect(result.current.shortcutName).toBe('');
  });

  it('cleanupShortcuts removes shortcuts where exists=false', async () => {
    const stored = [
      makeShortcut({ id: '1', exists: true }),
      makeShortcut({ id: '2', name: 'Dead', exists: false }),
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    const useShortcutManager = await getHook();
    const { result } = renderHook(() => useShortcutManager(true));
    await waitFor(() => expect(result.current.shortcuts.length).toBe(2));
    act(() => result.current.cleanupShortcuts());
    expect(result.current.shortcuts.length).toBe(1);
    expect(result.current.shortcuts[0].id).toBe('1');
  });

  it('getConnectionName resolves connection id to name', async () => {
    const useShortcutManager = await getHook();
    const { result } = renderHook(() => useShortcutManager(true));
    expect(result.current.getConnectionName('c1')).toBe('Server Alpha');
    expect(result.current.getConnectionName('nonexistent')).toBe('Unknown');
    expect(result.current.getConnectionName(undefined)).toBeNull();
  });

  it('getCollectionName resolves collection id to name', async () => {
    const useShortcutManager = await getHook();
    const { result } = renderHook(() => useShortcutManager(true));
    await waitFor(() => expect(result.current.collections.length).toBe(2));
    expect(result.current.getCollectionName('col1')).toBe('Collection A');
    expect(result.current.getCollectionName(undefined)).toBeNull();
  });
});
