import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  useOriginCertificateReview,
  nativeCertificateReviewTransport,
} from "../../src/hooks/protocol/useOriginCertificateReview";
import { OriginBrowserCertificateReview } from "../../src/components/security/OriginBrowserCertificateReview";
import { useOriginBrowserOverlays } from "../../src/hooks/protocol/useOriginBrowserOverlays";
import {
  readOriginCertificateReview,
  type OriginCertificatePrompt,
  type OriginCertificateReviewSnapshot,
  type OriginCertificateReviewTransport,
} from "../../src/types/protocols/originBrowserCertificateReview";

const event = vi.hoisted(() => ({ listen: vi.fn(), windowLabel: "main" }));
vi.mock("@tauri-apps/api/event", () => ({ listen: event.listen }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: event.windowLabel }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const prompt = (
  requestId = "a".repeat(32),
  overrides: Partial<OriginCertificatePrompt> = {},
): OriginCertificatePrompt => ({
  requestId,
  identity: {
    ownerDatabaseId: "database-a",
    connectionId: "website-a",
    sessionId: "session-a",
    attemptId: "attempt-a",
  },
  origin: "https://example.test:8443",
  fingerprint: "ab".repeat(32),
  reason: "The certificate is not trusted.",
  temporary: false,
  expiresAtUnixMs: Date.now() + 90_000,
  ...overrides,
});
const snapshot = (
  revision: number,
  value: OriginCertificatePrompt | null,
): OriginCertificateReviewSnapshot => ({ revision, prompt: value });
function backend(initial = snapshot(1, prompt())) {
  let listener: (value: unknown) => void = () => {};
  const off = vi.fn();
  const request = vi
    .fn<OriginCertificateReviewTransport["request"]>()
    .mockResolvedValue(initial);
  const listen = vi
    .fn<OriginCertificateReviewTransport["listen"]>()
    .mockImplementation(async (fn) => {
      listener = fn;
      return off;
    });
  return {
    transport: { request, listen },
    request,
    listen,
    off,
    emit: (value: unknown) => act(() => listener(value)),
  };
}
afterEach(() => {
  cleanup();
  event.windowLabel = "main";
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("native certificate review lifecycle", () => {
  it("uses the exact native command envelope and full-snapshot event", async () => {
    await nativeCertificateReviewTransport.request({ action: "pending" });
    expect(invoke).toHaveBeenCalledWith("origin_browser_certificate_review", {
      request: { action: "pending" },
    });
    event.listen.mockResolvedValueOnce(() => {});
    const receive = vi.fn();
    await nativeCertificateReviewTransport.listen(receive);
    expect(event.listen.mock.lastCall?.[0]).toBe(
      "origin-browser-certificate-review",
    );
    const value = snapshot(9, null);
    event.listen.mock.lastCall?.[1]({ payload: value });
    expect(receive).toHaveBeenCalledWith(value);
  });
  it.each(["main", "detached-session-7"])(
    "matches the native WebviewWindow event target for %s rather than Any or Window",
    async (label) => {
      event.windowLabel = label;
      const off = vi.fn(),
        receive = vi.fn();
      event.listen.mockResolvedValueOnce(off);
      const unsubscribe =
        await nativeCertificateReviewTransport.listen(receive);
      expect(event.listen).toHaveBeenLastCalledWith(
        "origin-browser-certificate-review",
        expect.any(Function),
        { target: { kind: "WebviewWindow", label } },
      );
      const [, callback, options] = event.listen.mock.lastCall!;
      const emitTo = (
        target: { kind: string; label: string },
        payload: unknown,
      ) => {
        if (
          target.kind === options.target.kind &&
          target.label === options.target.label
        )
          callback({ payload });
      };
      const value = snapshot(3, prompt());
      emitTo({ kind: "WebviewWindow", label: "another-window" }, value);
      emitTo({ kind: "Window", label }, value);
      expect(receive).not.toHaveBeenCalled();
      emitTo({ kind: "WebviewWindow", label }, value);
      expect(receive).toHaveBeenCalledExactlyOnceWith(value);
      unsubscribe();
      expect(off).toHaveBeenCalledOnce();
    },
  );
  it("subscribes before querying and rejects a delayed older inventory and duplicate events", async () => {
    const b = backend();
    const subscribed = deferred<() => void>(),
      pending = deferred<unknown>();
    let receive!: (value: unknown) => void;
    b.listen.mockImplementationOnce((fn) => {
      receive = fn;
      return subscribed.promise;
    });
    b.request.mockImplementationOnce(() => pending.promise);
    const { result } = renderHook(() =>
      useOriginCertificateReview({ transport: b.transport }),
    );
    expect(b.request).not.toHaveBeenCalled();
    await act(async () => subscribed.resolve(b.off));
    expect(b.request).toHaveBeenCalledWith({ action: "pending" });
    const newer = prompt("b".repeat(32));
    act(() => receive(snapshot(5, newer)));
    const accepted = result.current.prompt;
    await act(async () => pending.resolve(snapshot(2, prompt())));
    act(() => receive(snapshot(5, null)));
    expect(result.current.prompt).toBe(accepted);
    act(() => receive(snapshot(6, null)));
    expect(result.current.prompt).toBeNull();
    act(() => receive(snapshot(5, newer)));
    expect(result.current.prompt).toBeNull();
  });
  it.each(["allow-once", "remember", "cancel"] as const)(
    "sends only the exact receipt and explicit %s decision",
    async (decision) => {
      const b = backend();
      const { result } = renderHook(() =>
        useOriginCertificateReview({ transport: b.transport }),
      );
      await waitFor(() => expect(result.current.prompt).not.toBeNull());
      const reviewed = result.current.prompt!;
      b.request.mockResolvedValueOnce(snapshot(2, null));
      await act(async () => {
        expect(await result.current.respond(reviewed, decision)).toBe(true);
      });
      expect(b.request.mock.lastCall?.[0]).toEqual({
        action: "respond",
        requestId: reviewed.requestId,
        identity: reviewed.identity,
        decision,
      });
      expect(result.current.prompt).toBeNull();
    },
  );
  it("never retargets an old A callback after an A-B-A replacement", async () => {
    const a = prompt(),
      b = backend(snapshot(1, a));
    const { result } = renderHook(() =>
      useOriginCertificateReview({ transport: b.transport }),
    );
    await waitFor(() => expect(result.current.prompt).not.toBeNull());
    const oldA = result.current.prompt!;
    b.emit(snapshot(2, prompt("b".repeat(32))));
    b.emit(snapshot(3, a));
    await act(async () =>
      expect(await result.current.respond(oldA, "remember")).toBe(false),
    );
    expect(b.request).toHaveBeenCalledTimes(1);
  });
  it("single-flights decisions and does not let an older response close a successor prompt", async () => {
    const b = backend(),
      reply = deferred<unknown>();
    const { result } = renderHook(() =>
      useOriginCertificateReview({ transport: b.transport }),
    );
    await waitFor(() => expect(result.current.prompt).not.toBeNull());
    const reviewed = result.current.prompt!;
    b.request.mockImplementationOnce(() => reply.promise);
    let response!: Promise<boolean>;
    act(() => {
      response = result.current.respond(reviewed, "allow-once");
    });
    await act(async () =>
      expect(await result.current.respond(reviewed, "remember")).toBe(false),
    );
    const successor = prompt("b".repeat(32));
    b.emit(snapshot(4, successor));
    await act(async () => {
      reply.resolve(snapshot(2, null));
      await response;
    });
    expect(result.current.prompt?.requestId).toBe(successor.requestId);
    expect(result.current.submitting).toBe(false);
  });
  it("refreshes pending once on a stale response without retrying approval", async () => {
    const b = backend();
    const { result } = renderHook(() =>
      useOriginCertificateReview({ transport: b.transport }),
    );
    await waitFor(() => expect(result.current.prompt).not.toBeNull());
    b.request
      .mockRejectedValueOnce(new Error("private raw native detail"))
      .mockResolvedValueOnce(snapshot(2, null));
    await act(async () =>
      expect(
        await result.current.respond(result.current.prompt!, "remember"),
      ).toBe(false),
    );
    expect(b.request.mock.calls.map(([value]) => value.action)).toEqual([
      "pending",
      "respond",
      "pending",
    ]);
    expect(result.current.prompt).toBeNull();
  });
  it("scopes fixed error text to the reviewed prompt and never displays raw errors", async () => {
    const initial = snapshot(1, prompt()),
      b = backend(initial);
    const { result } = renderHook(() =>
      useOriginCertificateReview({ transport: b.transport }),
    );
    await waitFor(() => expect(result.current.prompt).not.toBeNull());
    b.request.mockRejectedValueOnce(new Error("secret token"));
    await act(async () => {
      await result.current.respond(result.current.prompt!, "allow-once");
    });
    expect(result.current.error).toMatch(/No automatic retry/);
    expect(result.current.error).not.toContain("secret");
    expect(result.current.submitting).toBe(false);
    b.emit(snapshot(2, prompt("b".repeat(32))));
    expect(result.current.error).toBeNull();
  });
  it("queues a fresh pending read when a stale decision races an older in-flight query", async () => {
    const b = backend(),
      initial = deferred<unknown>();
    b.request.mockImplementationOnce(() => initial.promise);
    const { result } = renderHook(() =>
      useOriginCertificateReview({ transport: b.transport }),
    );
    await waitFor(() => expect(b.request).toHaveBeenCalledOnce());
    b.emit(snapshot(2, prompt()));
    b.request
      .mockRejectedValueOnce(new Error("stale token"))
      .mockResolvedValueOnce(snapshot(3, null));
    await act(async () => {
      expect(
        await result.current.respond(result.current.prompt!, "remember"),
      ).toBe(false);
    });
    await act(async () => initial.resolve(snapshot(1, null)));
    expect(b.request.mock.calls.map(([value]) => value.action)).toEqual([
      "pending",
      "respond",
      "pending",
    ]);
    expect(result.current.prompt).toBeNull();
  });
  it("checks absolute expiry again at mutation time even if the timer has not fired", async () => {
    vi.useFakeTimers();
    const value = prompt(),
      b = backend(snapshot(1, value));
    const { result } = renderHook(() =>
      useOriginCertificateReview({ transport: b.transport }),
    );
    await act(async () => {});
    const reviewed = result.current.prompt!;
    vi.setSystemTime(value.expiresAtUnixMs + 1);
    await act(async () =>
      expect(await result.current.respond(reviewed, "allow-once")).toBe(false),
    );
    expect(result.current.prompt).toBeNull();
    expect(b.request.mock.lastCall?.[0]).toMatchObject({ decision: "cancel" });
  });
  it("closes and denies on local expiry without polling", async () => {
    vi.useFakeTimers();
    const b = backend(
      snapshot(1, prompt(undefined, { expiresAtUnixMs: Date.now() + 1000 })),
    );
    const { result } = renderHook(() =>
      useOriginCertificateReview({ transport: b.transport }),
    );
    await act(async () => {});
    expect(result.current.prompt).not.toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(1001));
    expect(result.current.prompt).toBeNull();
    expect(b.request.mock.calls.map(([value]) => value.action)).toEqual([
      "pending",
      "respond",
    ]);
    expect(b.request.mock.lastCall?.[0]).toMatchObject({ decision: "cancel" });
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(b.request).toHaveBeenCalledTimes(2);
  });
  it("never shows or approves an already expired receipt", async () => {
    const b = backend(
      snapshot(1, prompt(undefined, { expiresAtUnixMs: Date.now() - 1 })),
    );
    const { result } = renderHook(() =>
      useOriginCertificateReview({ transport: b.transport }),
    );
    await waitFor(() => expect(b.request).toHaveBeenCalledTimes(2));
    expect(result.current.prompt).toBeNull();
    expect(b.request.mock.lastCall?.[0]).toMatchObject({ decision: "cancel" });
  });
  it("cancels on unmount and rejects an old lifecycle's delayed response", async () => {
    const b = backend(),
      reply = deferred<unknown>();
    const old = renderHook(() =>
      useOriginCertificateReview({ transport: b.transport }),
    );
    await waitFor(() => expect(old.result.current.prompt).not.toBeNull());
    const reviewed = old.result.current.prompt!;
    b.request.mockImplementationOnce(() => reply.promise);
    let response!: Promise<boolean>;
    act(() => {
      response = old.result.current.respond(reviewed, "allow-once");
    });
    old.unmount();
    expect(b.off).toHaveBeenCalledOnce();
    expect(b.request.mock.lastCall?.[0]).toMatchObject({
      action: "respond",
      decision: "cancel",
      requestId: reviewed.requestId,
    });
    const next = backend(snapshot(1, prompt("b".repeat(32))));
    const current = renderHook(() =>
      useOriginCertificateReview({ transport: next.transport }),
    );
    await waitFor(() => expect(current.result.current.prompt).not.toBeNull());
    await act(async () => {
      reply.resolve(snapshot(100, null));
      await response;
    });
    expect(current.result.current.prompt?.requestId).toBe("b".repeat(32));
  });
  it("denies a pending snapshot that arrives after unmount", async () => {
    const b = backend(),
      pending = deferred<unknown>();
    b.request.mockImplementationOnce(() => pending.promise);
    const view = renderHook(() =>
      useOriginCertificateReview({ transport: b.transport }),
    );
    await waitFor(() => expect(b.request).toHaveBeenCalledOnce());
    view.unmount();
    await act(async () => pending.resolve(snapshot(1, prompt())));
    expect(b.request.mock.lastCall?.[0]).toMatchObject({ decision: "cancel" });
  });
  it("unsubscribes a late listener without starting an inventory query", async () => {
    const b = backend(),
      subscribed = deferred<() => void>();
    b.listen.mockImplementationOnce(() => subscribed.promise);
    const view = renderHook(() =>
      useOriginCertificateReview({ transport: b.transport }),
    );
    view.unmount();
    await act(async () => subscribed.resolve(b.off));
    expect(b.off).toHaveBeenCalledOnce();
    expect(b.request).not.toHaveBeenCalled();
  });
  it("recovers on focus, coalescing overlapping pending reads", async () => {
    const b = backend(snapshot(1, null));
    const { result } = renderHook(() =>
      useOriginCertificateReview({ transport: b.transport }),
    );
    await waitFor(() => expect(b.request).toHaveBeenCalledOnce());
    const pending = deferred<unknown>();
    b.request.mockImplementationOnce(() => pending.promise);
    act(() => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("focus"));
    });
    expect(b.request).toHaveBeenCalledTimes(2);
    await act(async () => pending.resolve(snapshot(2, prompt())));
    expect(result.current.prompt).not.toBeNull();
  });
});

describe("themed certificate review", () => {
  it.each([false, true])(
    "uses the shell Modal, defaults to Cancel, and accurately scopes temporary=%s trust",
    async (temporary) => {
      const value = prompt(undefined, { temporary }),
        b = backend(snapshot(1, value));
      const view = render(
        <OriginBrowserCertificateReview transport={b.transport} />,
      );
      const dialog = await screen.findByRole("dialog", {
        name: "Review website certificate",
      });
      expect(view.container).not.toContainElement(dialog);
      expect(dialog.closest(".sor-modal-backdrop")).not.toBeNull();
      expect(dialog.querySelector("iframe")).toBeNull();
      expect(dialog).toHaveTextContent(value.origin);
      expect(dialog).toHaveTextContent(value.fingerprint);
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus(),
      );
      expect(
        screen.getByRole("button", {
          name: temporary ? "Trust for this attempt" : "Remember and continue",
        }),
      ).toBeEnabled();
      expect(dialog).toHaveTextContent(
        temporary ? "Nothing is remembered in a database" : "owning database",
      );
      expect(b.request).toHaveBeenCalledTimes(1);
      b.request.mockResolvedValueOnce(snapshot(2, null));
      fireEvent.keyDown(document, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(b.request.mock.lastCall?.[0]).toMatchObject({
        decision: "cancel",
      });
    },
  );
  it("is detected by existing global native clipping", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 10,
      y: 10,
      left: 10,
      top: 10,
      right: 510,
      bottom: 410,
      width: 500,
      height: 400,
      toJSON() {},
    });
    const b = backend();
    render(<OriginBrowserCertificateReview transport={b.transport} />);
    await screen.findByRole("dialog");
    const { result } = renderHook(() => useOriginBrowserOverlays(true));
    expect(result.current.blocked).toBe(true);
    expect(result.current.rectangles.length).toBeGreaterThan(0);
  });
  it("closes on native revocation and does not approve through backdrop clicks", async () => {
    const b = backend();
    render(<OriginBrowserCertificateReview transport={b.transport} />);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByTestId("origin-certificate-review"));
    expect(b.request).toHaveBeenCalledTimes(1);
    b.emit(snapshot(2, null));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(b.request).toHaveBeenCalledTimes(1);
  });
  it("rejects unsafe origins and copies only the bounded display contract", () => {
    const value = prompt();
    for (const origin of [
      "http://example.test",
      "https://user:secret@example.test",
      "https://example.test/path",
    ]) {
      expect(
        readOriginCertificateReview(snapshot(1, { ...value, origin })),
      ).toBeNull();
    }
    expect(
      readOriginCertificateReview({ revision: -1, prompt: null }),
    ).toBeNull();
    expect(
      readOriginCertificateReview({
        revision: 1,
        prompt: { ...value, reason: "x".repeat(2049) },
      }),
    ).toBeNull();
    const parsed = readOriginCertificateReview({
      ...snapshot(1, value),
      credentials: "never-copy",
      prompt: { ...value, credentials: "never-copy" },
    });
    expect(JSON.stringify(parsed)).not.toContain("never-copy");
  });
});
