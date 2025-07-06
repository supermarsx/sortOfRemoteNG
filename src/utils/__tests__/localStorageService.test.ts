import { describe, it, expect, beforeEach } from 'vitest';
import { LocalStorageService } from '../localStorageService';

beforeEach(() => {
  localStorage.clear();
});

describe('LocalStorageService', () => {
  it('stores and retrieves objects', () => {
    const value = { a: 1, b: 'two' };
    LocalStorageService.setItem('obj', value);
    const result = LocalStorageService.getItem<typeof value>('obj');
    expect(result).toEqual(value);
  });

  it('returns null for invalid JSON', () => {
    localStorage.setItem('bad', 'notjson');
    const result = LocalStorageService.getItem('bad');
    expect(result).toBeNull();
  });
});
