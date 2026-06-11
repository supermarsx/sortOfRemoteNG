import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// @ts-expect-error - no type declarations for jsdom
import { JSDOM } from 'jsdom';
import {
  SettingsManager,
  _resetInMemorySettingsStore,
} from '../../src/utils/settings/settingsManager';
import { _resetInvokeCache } from '../../src/utils/tauri/invoke';
import { IndexedDbService } from '../../src/utils/storage/indexedDbService';

/**
 * t21 — Settings writer resilience (frontend layer).
 *
 * These tests assert the end-to-end frontend contract after the IndexedDB
 * write-fallback was removed (see `.orchestration/logs/t21-e2.md`):
 *  - a failing `write_app_settings` invoke is RETRIED up to a bounded number
 *    of attempts (3 = 1 initial + 2 retries);
 *  - each failed attempt dispatches a `settings-write-failed` window
 *    CustomEvent with detail `{ error, attempt, maxAttempts, willRetry }`,
 *    where `willRetry` is true on every non-final attempt and false on the
 *    last;
 *  - the IndexedDB settings path is NEVER touched on the Tauri write path;
 *  - the user's changed values are retained in memory after a failed write;
 *  - a fail-then-succeed sequence dispatches `settings-write-recovered`.
 *
 * The retry uses a small real backoff (150ms, then 300ms). We let it run on
 * real timers — ~450ms worst case — to avoid the fragility of interleaving
 * fake timers with the internal async retry loop.
 */

/** Retry params mirror the production constants in settingsManager.ts. */
const MAX_ATTEMPTS = 3;

let dom: JSDOM;

interface WriteFailedDetail {
  error: string;
  attempt: number;
  maxAttempts: number;
  willRetry: boolean;
}
interface WriteRecoveredDetail {
  attempt: number;
  maxAttempts: number;
}

/** Captured `settings-write-failed` event details, in dispatch order. */
let failedEvents: WriteFailedDetail[];
/** Captured `settings-write-recovered` event details, in dispatch order. */
let recoveredEvents: WriteRecoveredDetail[];

function onFailed(e: Event): void {
  failedEvents.push((e as CustomEvent<WriteFailedDetail>).detail);
}
function onRecovered(e: Event): void {
  recoveredEvents.push((e as CustomEvent<WriteRecoveredDetail>).detail);
}

/**
 * Install a fake `window.__TAURI__.core.invoke`. `getInvoke()` checks the
 * legacy global first (never cached), so this puts the manager on the Tauri
 * disk-write path. The caller supplies the `write_app_settings` behaviour.
 */
function installFakeTauri(
  writeImpl: (
    patch: Record<string, unknown>,
  ) => Promise<unknown> | unknown,
): { writeCalls: number } {
  const counter = { writeCalls: 0 };
  const invoke = async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === 'read_app_settings') return null;
    if (cmd === 'write_app_settings') {
      counter.writeCalls += 1;
      return writeImpl((args?.patch ?? {}) as Record<string, unknown>);
    }
    return null;
  };
  (globalThis as any).__TAURI__ = { core: { invoke } };
  return counter;
}

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>');
  (global as any).window = dom.window;
  (global as any).document = dom.window.document;

  failedEvents = [];
  recoveredEvents = [];
  dom.window.addEventListener('settings-write-failed', onFailed);
  dom.window.addEventListener('settings-write-recovered', onRecovered);

  SettingsManager.resetInstance();
  _resetInMemorySettingsStore();
  _resetInvokeCache();
  vi.restoreAllMocks();
});

afterEach(() => {
  delete (globalThis as any).__TAURI__;
});

describe('SettingsManager write-failure resilience (t21)', () => {
  it('retries the bounded number of attempts and dispatches failed events with the right shape', async () => {
    const setItemSpy = vi.spyOn(IndexedDbService, 'setItem');
    // Every attempt rejects → exhausts retries and rethrows.
    const counter = installFakeTauri(() => {
      throw new Error('os error 2');
    });

    const manager = SettingsManager.getInstance();
    await manager.loadSettings();

    await expect(
      manager.saveSettings({ colorScheme: 'green' }),
    ).rejects.toThrow('os error 2');

    // Exactly MAX_ATTEMPTS write invocations (1 initial + 2 retries).
    expect(counter.writeCalls).toBe(MAX_ATTEMPTS);

    // One failed event per attempt.
    expect(failedEvents).toHaveLength(MAX_ATTEMPTS);
    failedEvents.forEach((detail, i) => {
      const attempt = i + 1;
      expect(detail.error).toBe('os error 2');
      expect(detail.attempt).toBe(attempt);
      expect(detail.maxAttempts).toBe(MAX_ATTEMPTS);
      // willRetry is true on every non-final attempt, false on the last.
      expect(detail.willRetry).toBe(attempt < MAX_ATTEMPTS);
    });
    // The final attempt's event must explicitly say willRetry: false.
    expect(failedEvents[failedEvents.length - 1].willRetry).toBe(false);

    // No recovery event on a total failure.
    expect(recoveredEvents).toHaveLength(0);

    // The settings IndexedDB path is NEVER used for the Tauri write.
    const settingsIdbWrites = setItemSpy.mock.calls.filter(
      ([key]) => key === 'mremote-settings',
    );
    expect(settingsIdbWrites).toHaveLength(0);
  });

  it('never writes settings to IndexedDB on a failed Tauri write', async () => {
    const setItemSpy = vi.spyOn(IndexedDbService, 'setItem');
    installFakeTauri(() => {
      throw new Error('disk gone');
    });

    const manager = SettingsManager.getInstance();
    await manager.loadSettings();
    await expect(
      manager.saveSettings({ theme: 'light' }),
    ).rejects.toThrow('disk gone');

    // No call to IndexedDbService.setItem used the settings key.
    for (const [key] of setItemSpy.mock.calls) {
      expect(key).not.toBe('mremote-settings');
    }
  });

  it('retains the user-changed values in memory after a failed write', async () => {
    installFakeTauri(() => {
      throw new Error('write failed');
    });

    const manager = SettingsManager.getInstance();
    await manager.loadSettings();

    await expect(
      manager.saveSettings({ colorScheme: 'green', theme: 'light' }),
    ).rejects.toThrow('write failed');

    // The just-changed values survive in memory even though persistence failed.
    const live = manager.getSettings();
    expect(live.colorScheme).toBe('green');
    expect(live.theme).toBe('light');
  });

  it('dispatches settings-write-recovered when a retry succeeds after a failure', async () => {
    let calls = 0;
    const counter = installFakeTauri(() => {
      calls += 1;
      if (calls === 1) {
        // First attempt fails, the retry succeeds.
        throw new Error('transient');
      }
      return null;
    });

    const manager = SettingsManager.getInstance();
    await manager.loadSettings();

    // Should resolve (recovered on the second attempt).
    await expect(
      manager.saveSettings({ colorScheme: 'green' }),
    ).resolves.toBeUndefined();

    // Two write invocations: one failed, one succeeded.
    expect(counter.writeCalls).toBe(2);

    // Exactly one failed event (attempt 1, willRetry true) ...
    expect(failedEvents).toHaveLength(1);
    expect(failedEvents[0]).toMatchObject({
      attempt: 1,
      maxAttempts: MAX_ATTEMPTS,
      willRetry: true,
    });

    // ... and exactly one recovered event for the successful retry (attempt 2).
    expect(recoveredEvents).toHaveLength(1);
    expect(recoveredEvents[0]).toMatchObject({
      attempt: 2,
      maxAttempts: MAX_ATTEMPTS,
    });

    // The recovered value is the live in-memory value.
    expect(manager.getSettings().colorScheme).toBe('green');
  });

  it('does not dispatch any failure event when the write succeeds first try', async () => {
    const counter = installFakeTauri(() => null);

    const manager = SettingsManager.getInstance();
    await manager.loadSettings();
    await expect(
      manager.saveSettings({ colorScheme: 'green' }),
    ).resolves.toBeUndefined();

    expect(counter.writeCalls).toBe(1);
    expect(failedEvents).toHaveLength(0);
    expect(recoveredEvents).toHaveLength(0);
  });
});
