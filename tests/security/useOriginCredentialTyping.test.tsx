import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useOriginCredentialTyping,
  type OriginCredentialTypingOptions,
} from "../../src/hooks/security/useOriginCredentialTyping";
import type {
  OriginCredentialInputReply,
  OriginCredentialInputRequest,
} from "../../src/types/protocols/originCredentialTyping";

function setup(overrides: Partial<OriginCredentialTypingOptions> = {}) {
  const transport = vi.fn(
    async (
      request: OriginCredentialInputRequest,
    ): Promise<OriginCredentialInputReply> => ({
      status:
        request.action.kind === "capture"
          ? "captured"
          : request.action.kind === "type"
            ? "complete"
            : "cancelled",
      captureId: "capture-1",
    }),
  );
  const owner = vi.fn();
  const runInteractive = vi.fn(async (_identity, _view, check, mutate) => {
    check();
    return mutate(7);
  });
  let options: OriginCredentialTypingOptions = {
    sessionId: "tab",
    identity: {
      ownerDatabaseId: "db",
      connectionId: "connection",
      sessionId: "tab",
      attemptId: "attempt",
    },
    viewId: "selected-child",
    documentKey: "page-1",
    enabled: true,
    interactive: true,
    open: false,
    assertOwner: owner,
    runInteractive,
    transport,
    ...overrides,
  };
  const hook = renderHook((props) => useOriginCredentialTyping(props), {
    initialProps: options,
  });
  const update = (next: Partial<OriginCredentialTypingOptions>) => {
    options = { ...options, ...next };
    hook.rerender(options);
  };
  const open = () => update({ open: true });
  return { ...hook, transport, owner, runInteractive, update, open };
}
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function start(
  test: ReturnType<typeof setup>,
  action: () => Promise<void>,
) {
  let pending!: Promise<void>;
  await act(async () => {
    pending = test.result.current.run(action);
  });
  return { pending };
}
async function finish(pending: Promise<void>) {
  await act(async () => {
    await pending;
  });
}

describe("native manual credential typing", () => {
  it("does not capture on opening; a stable proxy gates disclosure until the overlay releases native input", async () => {
    const test = setup({ interactive: false });
    const target = test.result.current.target!;
    test.open();
    expect(test.result.current.target).toBe(target);
    expect(() => target.assertCurrent()).toThrow();
    expect(test.transport).not.toHaveBeenCalled();
    const action = vi.fn(() => target.type("private-value", () => {}));
    const { pending } = await start(test, action);
    expect(test.result.current.suspended).toBe(true);
    expect(test.result.current.phase).toBe("waiting");
    expect(test.transport).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
    test.update({ interactive: true });
    await finish(pending);
    expect(test.transport.mock.calls[0][0]).toMatchObject({
      viewId: "selected-child",
      action: { kind: "capture" },
    });
    expect(test.runInteractive).toHaveBeenCalledTimes(2);
    expect(
      test.transport.mock.calls.find(([r]) => r.action.kind === "type")?.[0]
        .action,
    ).toEqual({
      kind: "type",
      captureId: "capture-1",
      text: "private-value",
      credentialKind: "credential",
      restoreFocus: true,
      typingMode: "simulated",
    });
    expect(action).toHaveBeenCalledOnce();
    expect(test.result.current.target).toBe(target);
    expect(() => target.assertCurrent()).toThrow();
    expect(test.result.current.finished).toBe(1);
    expect(JSON.stringify(test.result.current)).not.toContain("private-value");
  });
  it("waits for the native presentation acknowledgement before requesting capture", async () => {
    let presented!: () => void;
    const test = setup();
    test.runInteractive.mockImplementationOnce(
      async (_identity, _view, check, mutate) => {
        await new Promise<void>((resolve) => {
          presented = resolve;
        });
        check();
        return mutate(7);
      },
    );
    test.open();
    const action = vi.fn(async () => {});
    const { pending } = await start(test, action);
    expect(test.transport).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
    await act(async () => {
      presented();
      await pending;
    });
    expect(action).toHaveBeenCalledOnce();
  });
  it("polls only secret-free waiting receipts, then resolves using the pre-click stable proxy", async () => {
    vi.useFakeTimers();
    const test = setup();
    test.transport.mockResolvedValueOnce({ status: "waiting", captureId: "" });
    test.transport.mockResolvedValueOnce({ status: "waiting", captureId: "" });
    test.open();
    const target = test.result.current.target!;
    const action = vi.fn(() => target.type("secret", () => {}));
    const { pending } = await start(test, action);
    expect(action).not.toHaveBeenCalled();
    expect(() => target.assertCurrent()).toThrow();
    expect(test.transport).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(599);
    });
    expect(action).not.toHaveBeenCalled();
    expect(test.transport).toHaveBeenCalledTimes(2);
    expect(test.result.current.target).toBe(target);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await pending;
    });
    expect(action).toHaveBeenCalledOnce();
    expect(
      test.transport.mock.calls.filter(([r]) => r.action.kind === "capture"),
    ).toHaveLength(3);
  });
  it("bounds field polling to 30s and never reads a credential without capture", async () => {
    vi.useFakeTimers();
    const test = setup();
    test.transport.mockResolvedValue({ status: "waiting", captureId: "" });
    test.open();
    const action = vi.fn(async () => {});
    const { pending } = await start(test, action);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
      await pending;
    });
    expect(action).not.toHaveBeenCalled();
    expect(test.result.current.phase).toBe("idle");
    expect(test.result.current.notice).toContain("timed out");
    expect(test.transport).toHaveBeenCalledTimes(100);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(test.transport).toHaveBeenCalledTimes(100);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([
    "HTTP",
    "owner",
    "input-blocked",
    "unknown-origin",
    "malformed-waiting",
  ])(
    "does not retry a hard %s failure or disclose backend errors",
    async (reason) => {
      vi.useFakeTimers();
      const test = setup();
      if (reason === "malformed-waiting")
        test.transport.mockResolvedValueOnce({
          status: "waiting",
          captureId: "invalid",
        });
      else
        test.transport.mockRejectedValueOnce(
          new Error("sensitive backend " + reason),
        );
      test.open();
      const action = vi.fn(async () => {});
      const { pending } = await start(test, action);
      await finish(pending);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30000);
      });
      expect(test.transport).toHaveBeenCalledTimes(1);
      expect(action).not.toHaveBeenCalled();
      expect(test.result.current.notice).toContain("Choose Type");
      expect(test.result.current.notice).not.toContain("sensitive backend");
    },
  );
  it("honors the selected mode and resolves a fresh TOTP only after the countdown and capture", async () => {
    vi.useFakeTimers();
    const test = setup();
    test.open();
    act(() => {
      test.result.current.setMode("instant");
      test.result.current.setDelaySeconds(3);
    });
    const target = test.result.current.target!;
    let validity!: { starts: number; expires: number };
    const action = vi.fn(async () => {
      validity = { starts: Date.now() - 100, expires: Date.now() + 10000 };
      await target.type("123456", () => {}, validity);
    });
    const { pending } = await start(test, action);
    expect(test.result.current.remaining).toBe(3);
    expect(test.result.current.suspended).toBe(true);
    expect(test.transport).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(test.result.current.remaining).toBe(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
      await pending;
    });
    expect(action).toHaveBeenCalledOnce();
    expect(
      test.transport.mock.calls.find(([r]) => r.action.kind === "type")?.[0]
        .action,
    ).toMatchObject({
      typingMode: "instant",
      credentialKind: "totp",
      startsAtUnixMs: validity.starts,
      expiresAtUnixMs: validity.expires,
    });
  });
  it("cancels the countdown before capture or credential read", async () => {
    vi.useFakeTimers();
    const test = setup();
    test.open();
    act(() => test.result.current.setDelaySeconds(5));
    const action = vi.fn(async () => {});
    const { pending } = await start(test, action);
    act(() => test.result.current.cancel());
    await finish(pending);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(action).not.toHaveBeenCalled();
    expect(test.transport).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([
    "document",
    "child",
    "attempt",
    "owner",
    "tab",
    "disabled",
    "close",
    "hidden",
    "escape",
    "unmount",
  ])("cancels waiting without disclosure on %s change", async (reason) => {
    vi.useFakeTimers();
    const test = setup();
    test.transport.mockResolvedValue({ status: "waiting", captureId: "" });
    test.open();
    const old = test.result.current.target!;
    const action = vi.fn(async () => {});
    const { pending } = await start(test, action);
    if (reason === "document") test.update({ documentKey: "page-2" });
    if (reason === "child") test.update({ viewId: null });
    if (reason === "attempt")
      test.update({
        identity: {
          ...test.transport.mock.calls[0][0].identity,
          attemptId: "next",
        },
      });
    if (reason === "owner")
      test.owner.mockImplementation(() => {
        throw new Error("owner lost");
      });
    if (reason === "tab") test.update({ sessionId: "other-tab" });
    if (reason === "disabled") test.update({ enabled: false });
    if (reason === "close") test.update({ open: false });
    if (reason === "hidden") {
      vi.spyOn(document, "hidden", "get").mockReturnValue(true);
      act(() => document.dispatchEvent(new Event("visibilitychange")));
    }
    if (reason === "escape")
      act(() =>
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
      );
    if (reason === "unmount") test.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
      await pending;
    });
    expect(() => old.assertCurrent()).toThrow();
    expect(action).not.toHaveBeenCalled();
    expect(test.transport).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["timeout", "child", "cancel", "unmount"])(
    "revokes a receipt that arrives after %s without disclosure",
    async (reason) => {
      vi.useFakeTimers();
      let resolve!: (reply: OriginCredentialInputReply) => void;
      const test = setup();
      test.transport.mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      );
      test.open();
      const action = vi.fn(async () => {});
      const { pending } = await start(test, action);
      if (reason === "child") test.update({ viewId: "other" });
      if (reason === "cancel") act(() => test.result.current.cancel());
      if (reason === "unmount") test.unmount();
      if (reason === "timeout")
        await act(async () => {
          await vi.advanceTimersByTimeAsync(30000);
        });
      await finish(pending);
      expect(action).not.toHaveBeenCalled();
      await act(async () => {
        resolve({ status: "captured", captureId: "late" });
      });
      expect(
        test.transport.mock.calls.filter(([r]) => r.action.kind === "cancel"),
      ).toEqual([
        [
          {
            identity: test.transport.mock.calls[0][0].identity,
            viewId: "selected-child",
            action: { kind: "cancel", captureId: "late" },
          },
        ],
      ]);
      expect(action).not.toHaveBeenCalled();
    },
  );
  it("serializes an old disclosure after cancel so its stable proxy cannot use a new receipt", async () => {
    const test = setup();
    test.open();
    const target = test.result.current.target!;
    let resume!: () => void;
    const { pending } = await start(test, async () => {
      await new Promise<void>((resolve) => {
        resume = resolve;
      });
      await target.type("old-secret", () => {});
    });
    act(() => test.result.current.cancel());
    const other = vi.fn(async () => {});
    await act(async () => {
      await test.result.current.run(other);
    });
    expect(other).not.toHaveBeenCalled();
    await act(async () => {
      resume();
      await pending;
    });
    expect(
      test.transport.mock.calls.some(([r]) => r.action.kind === "type"),
    ).toBe(false);
    const next = await start(test, () => target.type("new-secret", () => {}));
    await finish(next.pending);
    expect(
      test.transport.mock.calls.filter(([r]) => r.action.kind === "type"),
    ).toHaveLength(1);
    expect(
      test.transport.mock.calls.find(([r]) => r.action.kind === "type")?.[0]
        .action,
    ).toMatchObject({ text: "new-secret" });
  });
  it("cancels a native type in flight and ignores its late acknowledgement", async () => {
    const test = setup();
    test.open();
    let resolve!: (reply: OriginCredentialInputReply) => void;
    test.transport.mockImplementation(async (request) =>
      request.action.kind === "type"
        ? new Promise((r) => {
            resolve = r;
          })
        : {
            status:
              request.action.kind === "capture" ? "captured" : "cancelled",
            captureId: "capture-1",
          },
    );
    const target = test.result.current.target!;
    const { pending } = await start(test, () =>
      target.type("secret", () => {}),
    );
    act(() => test.result.current.cancel());
    expect(
      test.transport.mock.calls[test.transport.mock.calls.length - 1]?.[0]
        .action.kind,
    ).toBe("cancel");
    await act(async () => {
      resolve({ status: "complete", captureId: "capture-1" });
      await pending;
    });
    expect(test.result.current.finished).toBe(0);
    expect(() => target.assertCurrent()).toThrow();
  });
  it.each([
    "expired",
    "future",
    "owner-after-capture",
    "mismatched-reply",
    "control-text",
    "reblocked",
  ])("fails closed for %s after capture", async (reason) => {
    const test = setup();
    test.open();
    const target = test.result.current.target!;
    const validity =
      reason === "expired"
        ? { starts: Date.now() - 1000, expires: Date.now() - 1 }
        : reason === "future"
          ? { starts: Date.now() + 1000, expires: Date.now() + 2000 }
          : undefined;
    if (reason === "mismatched-reply")
      test.transport.mockImplementation(async (r) => ({
        status:
          r.action.kind === "capture"
            ? "captured"
            : r.action.kind === "type"
              ? "complete"
              : "cancelled",
        captureId: r.action.kind === "type" ? "wrong" : "capture-1",
      }));
    const { pending } = await start(test, async () => {
      if (reason === "owner-after-capture")
        test.owner.mockImplementation(() => {
          throw new Error("secret error");
        });
      if (reason === "reblocked") test.update({ interactive: false });
      await target.type(
        reason === "control-text" ? "bad\nvalue" : "123456",
        () => {},
        validity,
      );
    });
    await finish(pending);
    expect(() => target.assertCurrent()).toThrow();
    expect(test.result.current.finished).toBe(0);
    if (reason !== "mismatched-reply")
      expect(
        test.transport.mock.calls.some(([r]) => r.action.kind === "type"),
      ).toBe(false);
    expect(test.result.current.notice).not.toContain("secret error");
    expect(
      test.transport.mock.calls.filter(([r]) => r.action.kind === "cancel"),
    ).toHaveLength(1);
  });
  it("bounds presentation waiting without capture or disclosure", async () => {
    vi.useFakeTimers();
    const test = setup({ interactive: false });
    test.open();
    const action = vi.fn(async () => {});
    const { pending } = await start(test, action);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
      await pending;
    });
    expect(test.transport).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
    expect(test.result.current.notice).toContain("timed out");
  });
});
