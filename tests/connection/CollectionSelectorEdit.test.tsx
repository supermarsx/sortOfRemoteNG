import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { CollectionSelector } from '../../src/components/connection/CollectionSelector';
import { CollectionManager } from '../../src/utils/connection/collectionManager';
import { IndexedDbService } from '../../src/utils/storage/indexedDbService';
import { openDB } from 'idb';
import { ConnectionCollection } from '../../src/types/connection/connection';

const DB_NAME = 'mremote-keyval';
const STORE_NAME = 'keyval';

const translations: Record<string, string> = {
  'collectionCenter.actions.clone': 'Clone',
  'collectionCenter.actions.edit': 'Edit',
  'collectionCenter.collections.actionsLabel': 'Actions for {{name}}',
  'collectionCenter.collections.updateAction': 'Update',
  'collectionCenter.collections.cloneAction': 'Clone Collection',
  'collectionCenter.collections.cloneTitle': 'Clone Collection: {{name}}',
  'collectionCenter.collections.sourcePasswordPlaceholder': 'Enter source collection password',
};

const interpolate = (template: string, options?: Record<string, unknown>) =>
  template.replace(/{{(\w+)}}/g, (_, key: string) => String(options?.[key] ?? ''));

// ── Mocks to prevent OOM from transitive dependency graph ──

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      interpolate(translations[key] ?? key, options),
  }),
}));

vi.mock('../../src/utils/settings/settingsManager', () => ({
  SettingsManager: {
    getInstance: () => ({
      logAction: vi.fn(),
      getSettings: vi.fn().mockReturnValue({}),
      loadSettings: vi.fn().mockResolvedValue({}),
      saveSettings: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock('../../src/contexts/useConnections', () => ({
  useConnections: () => ({
    state: { connections: [], sessions: [], selectedConnection: null },
    dispatch: vi.fn(),
    saveData: vi.fn().mockResolvedValue(undefined),
    loadData: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../../src/contexts/ToastContext', () => ({
  useToastContext: () => ({
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../src/utils/settings/themeManager', () => ({
  ThemeManager: {
    getInstance: () => ({
      applyTheme: vi.fn(),
      getCurrentTheme: vi.fn().mockReturnValue('dark'),
    }),
  },
}));

describe('CollectionSelector editing', () => {
  let manager: CollectionManager;

  beforeEach(async () => {
    await IndexedDbService.init();
    const db = await openDB(DB_NAME, 1);
    await db.clear(STORE_NAME);
    CollectionManager.resetInstance();
    manager = CollectionManager.getInstance();
    await manager.createCollection('First', 'desc');
  });

  it('persists edited name and description', async () => {
    render(
      <CollectionSelector isOpen onCollectionSelect={() => {}} onClose={() => {}} />
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'Actions for First' }),
    );
    fireEvent.click(await screen.findByText('Edit'));

    const [nameInput, descInput] = screen.getAllByRole('textbox');
    fireEvent.change(nameInput, { target: { value: 'Renamed' } });
    fireEvent.change(descInput, { target: { value: 'updated' } });

    fireEvent.click(screen.getByText('Update'));

    await waitFor(async () => {
      const stored = await IndexedDbService.getItem<ConnectionCollection[]>('mremote-collections');
      expect(stored![0].name).toBe('Renamed');
      expect(stored![0].description).toBe('updated');
    });
  });

  it('clones a collection from the overflow menu', async () => {
    render(
      <CollectionSelector isOpen onCollectionSelect={() => {}} onClose={() => {}} />,
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'Actions for First' }),
    );
    fireEvent.click(await screen.findByText('Clone'));

    await waitFor(async () => {
      const stored = await IndexedDbService.getItem<ConnectionCollection[]>('mremote-collections');
      expect(stored).toHaveLength(2);
      expect(stored?.[1].name).toBe('First (Copy)');
    });

    expect(await screen.findByText('First (Copy)')).toBeInTheDocument();
    expect(screen.getByTestId('collection-selector')).toBeInTheDocument();
  });

  it('prompts for the source password before cloning another encrypted collection', async () => {
    const secure = await manager.createCollection('Secure', 'sealed', true, 'secret');
    await manager.saveCollectionData(
      secure.id,
      {
        connections: [{ id: 'secure-1', name: 'Locked' } as any],
        settings: { favoriteOnly: true },
        timestamp: 99,
      } as any,
      'secret',
    );

    render(
      <CollectionSelector isOpen onCollectionSelect={() => {}} onClose={() => {}} />,
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'Actions for Secure' }),
    );
    fireEvent.click(await screen.findByText('Clone'));

    expect(await screen.findByText('Clone Collection: Secure')).toBeInTheDocument();

    fireEvent.change(
      screen.getByPlaceholderText('Enter source collection password'),
      { target: { value: 'secret' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clone Collection' }));

    await waitFor(async () => {
      const stored = await IndexedDbService.getItem<ConnectionCollection[]>('mremote-collections');
      expect(stored?.map((collection) => collection.name)).toEqual([
        'First',
        'Secure',
        'Secure (Copy)',
      ]);
    });

    expect(await screen.findByText('Secure (Copy)')).toBeInTheDocument();
  });
});
