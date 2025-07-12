import { describe, it, expect, beforeEach } from 'vitest';
import { LocalStorageService } from '../localStorageService';

beforeEach(() => {
  localStorage.clear();
});

describe('LocalStorageService', () => {
  it('stores and retrieves objects', async () => {
    const value = { a: 1, b: 'two' };
    await LocalStorageService.setItem('obj', value);
    const result = await LocalStorageService.getItem<typeof value>('obj');
    expect(result).toEqual(value);
  });

  it('returns null for invalid JSON', async () => {
    localStorage.setItem('bad', 'notjson');
    const result = await LocalStorageService.getItem('bad');
    expect(result).toBeNull();
  });
});
