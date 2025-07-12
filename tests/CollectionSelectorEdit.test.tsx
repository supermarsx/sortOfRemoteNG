import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, screen, act } from '@testing-library/react';
import { CollectionSelector } from '../src/components/CollectionSelector';
import { CollectionManager } from '../src/utils/collectionManager';
import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { IndexedDbService } from '../src/utils/indexedDbService';

// simple i18n mock for components using react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}));

describe('CollectionSelector editing', () => {
  let manager: CollectionManager;
  let collectionId: string;

  beforeEach(async () => {
    await IndexedDbService.init();
    const db = await openDB('mremote-keyval', 1);
    await db.clear('keyval');
    (CollectionManager as any).instance = undefined;
    manager = CollectionManager.getInstance();
    const col = await manager.createCollection('First', 'desc');
    collectionId = col.id;
  });

  it('persists edited name and description', async () => {
    await act(async () => {
      render(
        <CollectionSelector isOpen onCollectionSelect={() => {}} onClose={() => {}} />
      );
    });

    const editButton = await screen.findByTitle('Edit');
    await act(async () => {
      fireEvent.click(editButton);
    });

    const [nameInput, descInput] = screen.getAllByRole('textbox');
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: 'Renamed' } });
      fireEvent.change(descInput, { target: { value: 'updated' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Update'));
    });

    const stored = await IndexedDbService.getItem<any[]>('mremote-collections');
    expect(stored![0].name).toBe('Renamed');
    expect(stored![0].description).toBe('updated');
  });
});
