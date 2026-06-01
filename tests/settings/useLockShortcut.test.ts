/**
 * Unit tests for `shouldFireLockShortcut` — the predicate that
 * decides whether a keydown event should trigger `encryption_lock`.
 *
 * The DOM-driven side of `useLockShortcut` (listener attachment,
 * `preventDefault`, ref unwrapping) is left to integration tests; the
 * predicate captures every interesting decision the hook makes.
 */
import { describe, it, expect } from "vitest";
import { shouldFireLockShortcut } from "../../src/hooks/settings/useLockShortcut";

/** Convenience to build the predicate args from a partial set. */
function fire(
  overrides: Partial<{
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    editable: boolean;
    unlocked: boolean;
  }> = {},
): boolean {
  const args = {
    key: "l",
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    editable: false,
    unlocked: true,
    ...overrides,
  };
  return shouldFireLockShortcut(
    args.key,
    args.ctrlKey,
    args.metaKey,
    args.shiftKey,
    args.altKey,
    args.editable,
    args.unlocked,
  );
}

describe("shouldFireLockShortcut", () => {
  it("fires for Ctrl+L on Windows/Linux", () => {
    expect(fire()).toBe(true);
  });

  it("fires for ⌘+L on macOS", () => {
    expect(fire({ ctrlKey: false, metaKey: true })).toBe(true);
  });

  it("accepts uppercase L (CapsLock or Shift-released)", () => {
    expect(fire({ key: "L" })).toBe(true);
  });

  it("ignores keys other than L", () => {
    expect(fire({ key: "k" })).toBe(false);
    expect(fire({ key: "Enter" })).toBe(false);
  });

  it("rejects when no Ctrl or Meta is held", () => {
    expect(fire({ ctrlKey: false, metaKey: false })).toBe(false);
  });

  it("rejects Shift+L (dev-tools toggle in some browsers)", () => {
    expect(fire({ shiftKey: true })).toBe(false);
    // Even Ctrl+Shift+L stays off — the cmd-palette / dev-tools
    // shortcut wins.
    expect(fire({ shiftKey: true, metaKey: true, ctrlKey: false })).toBe(false);
  });

  it("rejects Alt+L (locale switchers / WinKey combos)", () => {
    expect(fire({ altKey: true })).toBe(false);
  });

  it("rejects when both Ctrl and Meta are held simultaneously", () => {
    // Avoid stealing weird Ctrl+Cmd shortcuts a power user might bind.
    expect(fire({ ctrlKey: true, metaKey: true })).toBe(false);
  });

  it("never fires while the encryption state is locked", () => {
    expect(fire({ unlocked: false })).toBe(false);
  });

  it("does not steal the shortcut from a focused text input", () => {
    expect(fire({ editable: true })).toBe(false);
  });
});
