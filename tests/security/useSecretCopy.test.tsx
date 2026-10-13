import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSecretCopy } from "../../src/hooks/security/useSecretCopy";
import type { CredentialOutcome } from "../../src/utils/security/credentialFailure";
import {
  advance,
  closingSentence,
  expiredSentence,
  installSecureClipboard,
  lockedSentence,
  settle,
  watchConsole,
  type SecureClipboardFake,
} from "./secretCopyHarness";

const bridge = vi.hoisted(() => ({ getInvoke: vi.fn() }));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: bridge.getInvoke,
}));

// Synthetic values; NOW is an arbitrary fixed clock.
const SEED = "SEEDSYNTHETIC234";
const CODE = "135790";
const NOW = Date.parse("2026-09-11T00:00:10Z");

let clipboard: SecureClipboardFake;
let logs: ReturnType<typeof watchConsole>;

function mount() {
  return renderHook(() => useSecretCopy());
}
type Hook = ReturnType<typeof mount>;
type Request = Parameters<Hook["result"]["current"]["copy"]>;
/** Ask for a copy; the caller settles it. */
function start(hook: Hook, ...request: Request) {
  let outcome!: Promise<CredentialOutcome | null>;
  act(() => {
    outcome = hook.result.current.copy(...request);
  });
  return outcome;
}
/** Ask for a copy and let it run as far as it can. */
async function copy(hook: Hook, ...request: Request) {
  const outcome = start(hook, ...request);
  await settle();
  return outcome;
}

describe("useSecretCopy", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    clipboard = installSecureClipboard(bridge.getInvoke);
    logs = watchConsole();
  });
  afterEach(() => {
    try {
      clipboard.expectNoRawClipboard();
      logs.expectSilentAbout(SEED, CODE);
    } finally {
      cleanup();
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it("writes through the secure clipboard with the given kind and ticks that key for 1.5 s", async () => {
    const hook = mount();
    expect(hook.result.current).toMatchObject({ copied: null, error: null });
    await expect(copy(hook, "seed", SEED, "secret")).resolves.toEqual({
      ok: true,
    });
    clipboard.expectOnlyCopy({
      value: SEED,
      kind: "genericSecret",
      field: "secret",
    });
    expect(hook.result.current).toMatchObject({ copied: "seed", error: null });
    await advance(1499);
    expect(hook.result.current.copied).toBe("seed");
    await advance(1);
    expect(hook.result.current.copied).toBeNull();
  });

  it("keeps the value out of its state", async () => {
    const hook = mount();
    await copy(hook, "seed", SEED, "secret");
    expect(JSON.stringify(hook.result.current)).not.toContain(SEED);
    clipboard.secureCopy.mockRejectedValueOnce("locked");
    await advance(1500);
    await copy(hook, "seed", SEED, "secret");
    expect(JSON.stringify(hook.result.current)).not.toContain(SEED);
  });

  it("shows nothing until the write has settled", async () => {
    const hook = mount();
    const write = clipboard.hold();
    const outcome = start(hook, "seed", SEED, "secret");
    await settle();
    expect(clipboard.secureCopy).toHaveBeenCalledOnce();
    expect(hook.result.current).toMatchObject({ copied: null, error: null });
    write.release();
    await settle();
    await expect(outcome).resolves.toEqual({ ok: true });
    expect(hook.result.current.copied).toBe("seed");
  });

  it("reports a refused write as its cause, with no tick, until the next outcome", async () => {
    const hook = mount();
    clipboard.secureCopy.mockRejectedValueOnce("locked");
    await expect(copy(hook, "seed", SEED, "secret")).resolves.toEqual({
      ok: false,
      code: "clipboard-locked",
      message: lockedSentence,
    });
    expect(hook.result.current).toMatchObject({
      copied: null,
      error: lockedSentence,
    });
    await advance(60_000);
    expect(hook.result.current.error).toBe(lockedSentence);
    await copy(hook, "other", SEED, "secret");
    expect(hook.result.current).toMatchObject({ copied: "other", error: null });
  });

  it("clears a showing tick when the next write is refused", async () => {
    const hook = mount();
    await copy(hook, "first", SEED, "secret");
    clipboard.secureCopy.mockRejectedValueOnce("busy");
    await copy(hook, "second", SEED, "secret");
    expect(hook.result.current.copied).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores a request made while a write is pending", async () => {
    const hook = mount();
    const write = clipboard.hold();
    const first = start(hook, "first", SEED, "secret");
    await settle();
    await expect(copy(hook, "second", CODE, "totpCode")).resolves.toBeNull();
    expect(clipboard.secureCopy).toHaveBeenCalledOnce();
    expect(hook.result.current).toMatchObject({ copied: null, error: null });
    write.release();
    await settle();
    await expect(first).resolves.toEqual({ ok: true });
    // The outcome belongs to the one write that was made.
    expect(clipboard.secureCopy).toHaveBeenCalledOnce();
    expect(hook.result.current.copied).toBe("first");
    // The next request is accepted as soon as the first has settled.
    await copy(hook, "second", CODE, "totpCode");
    expect(clipboard.secureCopy).toHaveBeenCalledTimes(2);
    expect(hook.result.current.copied).toBe("second");
  });

  it("accepts the next request after a refused write too", async () => {
    const hook = mount();
    clipboard.secureCopy.mockRejectedValueOnce("locked");
    await copy(hook, "first", SEED, "secret");
    await expect(copy(hook, "second", SEED, "secret")).resolves.toEqual({
      ok: true,
    });
  });

  it("keeps a later tick for its full time when an earlier one was still showing", async () => {
    const hook = mount();
    await copy(hook, "first", SEED, "secret");
    await advance(1000);
    await copy(hook, "second", SEED, "secret");
    // 1.5 s after the first copy: its timer must not clear the second tick.
    await advance(600);
    expect(hook.result.current.copied).toBe("second");
    await advance(900);
    expect(hook.result.current.copied).toBeNull();
  });

  it("lets a one-time code leave the clipboard with its time step", async () => {
    const hook = mount();
    await copy(hook, "code", CODE, "totpCode", NOW + 20_000);
    clipboard.expectOnlyCopy({
      value: CODE,
      kind: "totpCode",
      field: "totpCode",
      clearAfterSecs: 20,
    });
    expect(hook.result.current.copied).toBe("code");
  });

  it("copies a one-time code with exactly 3 s of its time step left", async () => {
    const hook = mount();
    await expect(
      copy(hook, "code", CODE, "totpCode", NOW + 3000),
    ).resolves.toEqual({ ok: true });
    clipboard.expectOnlyCopy({
      value: CODE,
      kind: "totpCode",
      field: "totpCode",
      clearAfterSecs: 3,
    });
  });

  it.each([
    ["with under 3 s left", NOW + 2999, "code-window-closing", closingSentence],
    ["whose time step has ended", NOW, "code-expired", expiredSentence],
  ])(
    "does not write a one-time code %s, and says why",
    async (_title, expires, code, sentence) => {
      const hook = mount();
      await expect(
        copy(hook, "code", CODE, "totpCode", expires),
      ).resolves.toEqual({ ok: false, code, message: sentence });
      expect(clipboard.secureCopy).not.toHaveBeenCalled();
      expect(hook.result.current).toMatchObject({
        copied: null,
        error: sentence,
      });
      // A refusal does not block the next request.
      await expect(copy(hook, "seed", SEED, "secret")).resolves.toEqual({
        ok: true,
      });
    },
  );

  it("releases a showing tick's timer on unmount", async () => {
    const hook = mount();
    await copy(hook, "seed", SEED, "secret");
    expect(vi.getTimerCount()).toBe(1);
    hook.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("still resolves a refused write that settles after unmount", async () => {
    const hook = mount();
    const write = clipboard.hold();
    const pending = start(hook, "seed", SEED, "secret");
    await settle();
    hook.unmount();
    write.refuse("locked");
    await settle();
    await expect(pending).resolves.toMatchObject({
      ok: false,
      message: lockedSentence,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("starts no tick timer for a write that succeeds after unmount", async () => {
    const hook = mount();
    const write = clipboard.hold();
    const pending = start(hook, "seed", SEED, "secret");
    await settle();
    hook.unmount();
    write.release();
    await settle();
    await expect(pending).resolves.toEqual({ ok: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("hands out one stable copy function", () => {
    const hook = mount();
    const first = hook.result.current.copy;
    hook.rerender();
    expect(hook.result.current.copy).toBe(first);
  });
});
