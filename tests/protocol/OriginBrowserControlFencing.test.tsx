import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useOriginBrowser,
  type UseOriginBrowserOptions,
} from "../../src/hooks/protocol/useOriginBrowser";
import type {
  OriginBrowserTransport,
  OriginBrowserSnapshot,
} from "../../src/types/protocols/originBrowser";

afterEach(cleanup);
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture() {
  let serial = 0;
  const transport: OriginBrowserTransport = {
    listen: vi.fn(async () => () => {}),
    status: vi.fn<OriginBrowserTransport["status"]>(async () => ({
      capability: { availability: "available" },
      snapshot: null,
    })),
    create: vi.fn(async (request) => ({
      requestId: request.requestId,
      snapshot: {
        identity: { ...request.owner, attemptId: `attempt-${++serial}` },
        sequence: 0,
        phase: "attached",
        displayUrl: "https://fixture.invalid/",
        title: "",
        loading: false,
        canGoBack: true,
        canGoForward: true,
      } as OriginBrowserSnapshot,
    })),
    close: vi.fn(async () => {}),
    navigate: vi.fn(async () => {}),
    control: vi.fn(async () => {}),
  };
  const options: UseOriginBrowserOptions = {
    owner: {
      ownerDatabaseId: "db",
      sessionId: "tab",
      connectionId: "connection",
    },
    expectedSecurityRevision: "revision",
    sourceSessionId: "unlock",
    initialUrl: "https://fixture.invalid/",
    enabled: true,
    ownerAvailable: true,
    active: true,
    dialogOpen: false,
    consent: { kind: "required" },
    transport,
  };
  const hook = renderHook((props) => useOriginBrowser(props), {
    initialProps: options,
  });
  await waitFor(() => expect(hook.result.current.state.phase).toBe("attached"));
  return { ...hook, transport, options };
}
describe("native controls are fenced to the issuing attempt", () => {
  it("opens DevTools only on explicit request for the current visible attempt", async () => {
    const f = await fixture();
    expect(
      vi
        .mocked(f.transport.control)
        .mock.calls.some(([request]) => request.action.kind === "devtools"),
    ).toBe(false);
    await act(async () =>
      expect(await f.result.current.openDevTools()).toBe(false),
    );
    act(() =>
      f.result.current.setViewport({ x: 0, y: 0, width: 800, height: 500 }),
    );
    const action = vi.mocked(f.transport.control).mock.lastCall![0].action;
    expect(action.kind).toBe("presentation");
    await act(async () =>
      expect(await f.result.current.openDevTools()).toBe(true),
    );
    expect(f.transport.control).toHaveBeenLastCalledWith({
      identity: f.result.current.state.snapshot!.identity,
      action: {
        kind: "devtools",
        presentationRevision:
          action.kind === "presentation" ? action.revision : 0,
      },
    });
  });

  it("keeps the page alive when opening DevTools fails", async () => {
    const f = await fixture();
    act(() =>
      f.result.current.setViewport({ x: 0, y: 0, width: 800, height: 500 }),
    );
    vi.mocked(f.transport.control).mockRejectedValueOnce(
      new Error("private native detail"),
    );
    await act(async () =>
      expect(await f.result.current.openDevTools()).toBe(false),
    );
    expect(f.result.current.state.phase).toBe("attached");
    expect(f.result.current.state.error).toBeNull();
    expect(f.transport.close).not.toHaveBeenCalled();
    await act(async () =>
      expect(await f.result.current.openDevTools()).toBe(true),
    );
  });

  it("still revokes DevTools attempts if the owner guard rejects them", async () => {
    const f = await fixture();
    act(() =>
      f.result.current.setViewport({ x: 0, y: 0, width: 800, height: 500 }),
    );
    f.rerender({
      ...f.options,
      assertOwner: () => {
        throw new Error("owner locked");
      },
    });
    await act(async () =>
      expect(await f.result.current.openDevTools()).toBe(false),
    );
    expect(f.transport.close).toHaveBeenCalledOnce();
    expect(
      vi
        .mocked(f.transport.control)
        .mock.calls.some(([request]) => request.action.kind === "devtools"),
    ).toBe(false);
  });

  it("does not accept a delayed inspector result after presentation changes", async () => {
    const f = await fixture();
    act(() =>
      f.result.current.setViewport({ x: 0, y: 0, width: 800, height: 500 }),
    );
    const pending = deferred();
    vi.mocked(f.transport.control).mockReturnValueOnce(pending.promise);
    let result!: Promise<boolean>;
    act(() => {
      result = f.result.current.openDevTools();
    });
    f.rerender({ ...f.options, active: false });
    await act(async () => {
      pending.resolve();
      expect(await result).toBe(false);
    });
    expect(f.result.current.state.phase).toBe("attached");
  });

  it("supplies the current visible revision for zoom, find and stop-find", async () => {
    const f = await fixture();
    act(() =>
      f.result.current.setViewport({ x: 0, y: 0, width: 800, height: 500 }),
    );
    const presentation = vi
      .mocked(f.transport.control)
      .mock.calls.slice(-1)[0][0].action;
    expect(presentation.kind).toBe("presentation");
    const revision =
      presentation.kind === "presentation" ? presentation.revision : 0;
    await act(async () => {
      expect(await f.result.current.zoom(125)).toBe(true);
      expect(await f.result.current.find("é", false, true, true)).toBe(true);
      expect(await f.result.current.stopFind(true)).toBe(true);
    });
    const actions = vi
      .mocked(f.transport.control)
      .mock.calls.slice(-3)
      .map(([r]) => r.action);
    expect(actions).toEqual([
      { kind: "zoom", percent: 125, presentationRevision: revision },
      {
        kind: "find",
        text: "é",
        forward: false,
        matchCase: true,
        findNext: true,
        presentationRevision: revision,
      },
      {
        kind: "stop-find",
        clearSelection: true,
        presentationRevision: revision,
      },
    ]);
  });
  it("validates zoom bounds and find UTF-8 bytes before IPC", async () => {
    const f = await fixture();
    act(() =>
      f.result.current.setViewport({ x: 0, y: 0, width: 800, height: 500 }),
    );
    vi.mocked(f.transport.control).mockClear();
    await act(async () => {
      for (const value of [NaN, Infinity, -Infinity, 24, 501])
        expect(await f.result.current.zoom(value)).toBe(false);
      for (const value of ["", "bad\0text", "é".repeat(513)])
        expect(await f.result.current.find(value)).toBe(false);
      expect(f.transport.control).not.toHaveBeenCalled();
      expect(await f.result.current.zoom(25)).toBe(true);
      expect(await f.result.current.zoom(500)).toBe(true);
      expect(await f.result.current.find("é".repeat(512))).toBe(true);
    });
  });
  it("rejects page controls with no viewport, hidden presentation, modal, lock or successor", async () => {
    const f = await fixture();
    const check = async (controller = f.result.current) => {
      expect(await controller.zoom(125)).toBe(false);
      expect(await controller.find("query")).toBe(false);
      expect(await controller.stopFind()).toBe(false);
      expect(await controller.openDevTools()).toBe(false);
    };
    await act(async () => check());
    act(() =>
      f.result.current.setViewport({ x: 0, y: 0, width: 800, height: 500 }),
    );
    for (const flags of [{ active: false }, { dialogOpen: true }]) {
      f.rerender({ ...f.options, ...flags });
      await act(async () => check());
    }
    f.rerender(f.options);
    const old = f.result.current;
    act(() => old.reconnect());
    await waitFor(() =>
      expect(f.result.current.state.snapshot?.identity.attemptId).toBe(
        "attempt-2",
      ),
    );
    await act(async () => check(old));
    f.rerender({ ...f.options, ownerAvailable: false });
    await act(async () => check());
    expect(
      vi
        .mocked(f.transport.control)
        .mock.calls.filter(([r]) => r.action.kind !== "presentation"),
    ).toHaveLength(0);
  });
  it("does not accept a delayed page-control result after its presentation changes", async () => {
    const f = await fixture();
    act(() =>
      f.result.current.setViewport({ x: 0, y: 0, width: 800, height: 500 }),
    );
    const pending = deferred();
    vi.mocked(f.transport.control).mockReturnValueOnce(pending.promise);
    let result!: Promise<boolean>;
    act(() => {
      result = f.result.current.find("private text");
    });
    f.rerender({ ...f.options, dialogOpen: true });
    await act(async () => {
      pending.resolve();
      expect(await result).toBe(false);
    });
    expect(f.result.current.state.phase).toBe("attached");
  });
  it("checks the owner lease for page controls and sanitizes native failures", async () => {
    const f = await fixture();
    act(() =>
      f.result.current.setViewport({ x: 0, y: 0, width: 800, height: 500 }),
    );
    f.rerender({
      ...f.options,
      assertOwner: () => {
        throw new Error("secret");
      },
    });
    await act(async () => expect(await f.result.current.zoom(150)).toBe(false));
    expect(f.transport.close).toHaveBeenCalledOnce();
    expect(f.result.current.state.error).toBe(
      "Native browser operation failed.",
    );
    expect(
      vi
        .mocked(f.transport.control)
        .mock.calls.filter(([r]) => r.action.kind === "zoom"),
    ).toHaveLength(0);
  });
  it("rejects captured controls after reconnect and keeps the current controller usable", async () => {
    const f = await fixture();
    const old = f.result.current;
    act(() => old.reconnect());
    await waitFor(() =>
      expect(f.result.current.state.snapshot?.identity.attemptId).toBe(
        "attempt-2",
      ),
    );
    await act(async () => {
      expect(await old.back()).toBe(false);
      expect(await old.navigate("https://fixture.invalid/old")).toBe(false);
      await old.close();
      old.reconnect();
      expect(await f.result.current.back()).toBe(true);
    });
    expect(f.transport.navigate).not.toHaveBeenCalled();
    expect(f.transport.create).toHaveBeenCalledTimes(2);
    expect(f.transport.close).toHaveBeenCalledTimes(1);
    expect(f.transport.control).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: expect.objectContaining({ attemptId: "attempt-2" }),
        action: { kind: "back" },
      }),
    );
  });
  it("waits for same-tab cleanup before creating its successor", async () => {
    const f = await fixture();
    const close = deferred();
    vi.mocked(f.transport.close).mockReturnValueOnce(close.promise);
    act(() => f.result.current.reconnect());
    await act(async () => {});
    expect(f.transport.create).toHaveBeenCalledTimes(1);
    await act(async () => close.resolve());
    await waitFor(() => expect(f.transport.create).toHaveBeenCalledTimes(2));
  });
  it("refuses a successor when cleanup is unconfirmed", async () => {
    const f = await fixture();
    vi.mocked(f.transport.close).mockRejectedValueOnce(
      new Error("unconfirmed"),
    );
    act(() => f.result.current.reconnect());
    await waitFor(() =>
      expect(f.result.current.state.phase).toBe("unavailable"),
    );
    expect(f.transport.create).toHaveBeenCalledTimes(1);
    act(() => f.result.current.reconnect());
    await waitFor(() =>
      expect(f.result.current.state.phase).toBe("unavailable"),
    );
    expect(f.transport.create).toHaveBeenCalledTimes(1);
  });
  it("does not send stale toolbar actions behind a modal or from an inactive tab", async () => {
    const f = await fixture();
    const old = f.result.current;
    f.rerender({ ...f.options, dialogOpen: true });
    await act(async () => {
      expect(await old.back()).toBe(false);
      expect(await old.navigate("https://fixture.invalid/next")).toBe(false);
    });
    f.rerender({ ...f.options, active: false });
    await act(async () => {
      expect(await old.reload()).toBe(false);
    });
    expect(f.transport.navigate).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(f.transport.control)
        .mock.calls.filter(
          ([request]) => request.action.kind !== "presentation",
        ),
    ).toHaveLength(0);
  });
  it("checks the captured owner lease immediately before sending a command", async () => {
    const f = await fixture();
    f.rerender({
      ...f.options,
      assertOwner: () => {
        throw new Error("revoked");
      },
    });
    await act(async () => {
      expect(await f.result.current.reload()).toBe(false);
    });
    expect(f.transport.close).toHaveBeenCalledOnce();
    expect(
      vi
        .mocked(f.transport.control)
        .mock.calls.filter(([request]) => request.action.kind === "reload"),
    ).toHaveLength(0);
  });
});
