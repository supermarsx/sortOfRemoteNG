import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateId } from '../src/utils/id';

describe('generateId', () => {
  const originalRandomUUID = globalThis.crypto?.randomUUID;

  afterEach(() => {
    if (originalRandomUUID) {
      globalThis.crypto.randomUUID = originalRandomUUID;
    } else {
      delete (globalThis.crypto as any).randomUUID;
    }
    vi.restoreAllMocks();
  });

  it('uses crypto.randomUUID when available', () => {
    const mock = vi.fn().mockReturnValue('test-id');
    globalThis.crypto.randomUUID = mock as any;
    const id = generateId();
    expect(id).toBe('test-id');
    expect(mock).toHaveBeenCalled();
  });

  it('falls back to Math.random when crypto.randomUUID is unavailable', () => {
    (globalThis.crypto as any).randomUUID = undefined;
    const randomValue = 0.123456789;
    const nowValue = 1710000000000;
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(randomValue);
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(nowValue);
    const expected = randomValue.toString(36).slice(2) + nowValue.toString(36);
    const id = generateId();
    expect(id).toBe(expected);
    expect(randomSpy).toHaveBeenCalled();
    expect(nowSpy).toHaveBeenCalled();
  });
});
