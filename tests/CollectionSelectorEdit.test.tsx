import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { CollectionSelector } from '../src/components/CollectionSelector';
import { CollectionManager } from '../src/utils/collectionManager';
import { LocalStorageService } from '../src/utils/localStorageService';
import { ConnectionCollection } from '../src/types/connection';

// simple i18n mock for components using react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}));

describe('CollectionSelector editing', () => {
  let manager: CollectionManager;

  beforeEach(async () => {
    localStorage.clear();
    CollectionManager.resetInstance();
    manager = CollectionManager.getInstance();
    await manager.createCollection('First', 'desc');
  });

  it('persists edited name and description', async () => {
    render(
      <CollectionSelector isOpen onCollectionSelect={() => {}} onClose={() => {}} />
    );

    fireEvent.click(screen.getByTitle('Edit'));

    const [nameInput, descInput] = screen.getAllByRole('textbox');
    fireEvent.change(nameInput, { target: { value: 'Renamed' } });
    fireEvent.change(descInput, { target: { value: 'updated' } });

    fireEvent.click(screen.getByText('Update'));

    const stored = await LocalStorageService.getItem<ConnectionCollection[]>('mremote-collections');
    expect(stored[0].name).toBe('Renamed');
    expect(stored[0].description).toBe('updated');
  });
});
