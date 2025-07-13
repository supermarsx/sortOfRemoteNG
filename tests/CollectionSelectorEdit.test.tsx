import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { CollectionSelector } from '../src/components/CollectionSelector';
import { CollectionManager } from '../src/utils/collectionManager';
import { IndexedDbService } from '../src/utils/indexedDbService';
import { openDB } from 'idb';
import { ConnectionCollection } from '../src/types/connection';

const DB_NAME = 'mremote-keyval';
const STORE_NAME = 'keyval';

// simple i18n mock for components using react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
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
