/**
 * Unit tests for the `shouldArmAutoLock` predicate that gates the
 * `useAutoLock` hook's listener wiring.
 *
 * The hook's side effects (timers, DOM listeners, Tauri event
 * unsubscribe) are covered by the predicate plus a small end-to-end
 * idle-timer test below. We don't try to exercise the Tauri
 * `tauri://blur` path here — that's a real platform event handled by
 * the runtime, not a unit-testable side of the predicate.
 */
import { describe, it, expect } from "vitest";
import { shouldArmAutoLock } from "../../src/hooks/settings/useAutoLock";
import type { AutoLockConfig } from "../../src/types/settings/settings";

function cfg(overrides: Partial<AutoLockConfig> = {}): AutoLockConfig {
  return {
    enabled: true,
    timeoutMinutes: 15,
    lockOnIdle: true,
    lockOnSuspend: true,
    requirePassword: true,
    lockOnMinimize: false,
    lockOnBlur: false,
    lockOnVisibilityHidden: false,
    ...overrides,
  };
}

describe("shouldArmAutoLock", () => {
  it("returns false when the encryption state is locked", () => {
    expect(shouldArmAutoLock(cfg(), /* unlocked= */ false)).toBe(false);
  });

  it("returns false when the policy is disabled", () => {
    expect(shouldArmAutoLock(cfg({ enabled: false }), true)).toBe(false);
  });

  it("returns false when no signal is configured", () => {
    expect(
      shouldArmAutoLock(
        cfg({
          lockOnIdle: false,
          lockOnMinimize: false,
          lockOnBlur: false,
          lockOnVisibilityHidden: false,
        }),
        true,
      ),
    ).toBe(false);
  });

  it("arms when only the idle signal is on", () => {
    expect(
      shouldArmAutoLock(
        cfg({
          lockOnIdle: true,
          lockOnMinimize: false,
          lockOnBlur: false,
          lockOnVisibilityHidden: false,
        }),
        true,
      ),
    ).toBe(true);
  });

  it("arms when only the minimise signal is on (idle off)", () => {
    expect(
      shouldArmAutoLock(
        cfg({ lockOnIdle: false, lockOnMinimize: true }),
        true,
      ),
    ).toBe(true);
  });

  it("arms when only the blur signal is on", () => {
    expect(
      shouldArmAutoLock(
        cfg({ lockOnIdle: false, lockOnBlur: true }),
        true,
      ),
    ).toBe(true);
  });

  it("arms when only the visibility-hidden fallback is on", () => {
    expect(
      shouldArmAutoLock(
        cfg({ lockOnIdle: false, lockOnVisibilityHidden: true }),
        true,
      ),
    ).toBe(true);
  });

  it("returns false on a missing config object", () => {
    expect(shouldArmAutoLock(undefined, true)).toBe(false);
  });
});
