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

// ── Mocks to prevent OOM from transitive dependency graph ──

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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

    fireEvent.click(await screen.findByTitle('Edit'));

    const [nameInput, descInput] = screen.getAllByRole('textbox');
    fireEvent.change(nameInput, { target: { value: 'Renamed' } });
    fireEvent.change(descInput, { target: { value: 'updated' } });

    fireEvent.click(screen.getByText('Update'));

    await waitFor(async () => {
      const stored = await IndexedDbService.getItem<ConnectionCollection[]>('mremote-collections');
      expect(stored[0].name).toBe('Renamed');
      expect(stored[0].description).toBe('updated');
    });
  });
});
