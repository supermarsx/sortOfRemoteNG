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
        canGoBack: false,
        canGoForward: false,
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
  const hook = renderHook(
    (props: UseOriginBrowserOptions) => useOriginBrowser(props),
    {
      initialProps: options,
    },
  );
  await waitFor(() => expect(hook.result.current.state.phase).toBe("attached"));
  return { ...hook, transport, options };
}

const lastPresentation = (transport: OriginBrowserTransport) => {
  const all = presentations(transport);
  return all[all.length - 1] as (typeof all)[number] & { bounds?: unknown };
};

const presentations = (transport: OriginBrowserTransport) =>
  vi
    .mocked(transport.control)
    .mock.calls.map(([request]) => request.action)
    .filter((action) => action.kind === "presentation") as Array<{
    kind: "presentation";
    visible: boolean;
    revision: number;
  }>;

const slot = { x: 10, y: 20, width: 800, height: 500 };

describe("a native page survives being backgrounded and shown again", () => {
  it("hides and re-shows the same instance across tab switches without create, navigate or close", async () => {
    const f = await fixture();
    const identity = f.result.current.state.snapshot!.identity;
    act(() => f.result.current.setViewport(slot));
    expect(lastPresentation(f.transport)?.visible).toBe(true);
    for (let cycle = 0; cycle < 3; cycle += 1) {
      f.rerender({ ...f.options, active: false });
      expect(lastPresentation(f.transport)?.visible).toBe(false);
      f.rerender({ ...f.options, active: true });
      expect(lastPresentation(f.transport)?.visible).toBe(true);
    }
    expect(f.transport.create).toHaveBeenCalledOnce();
    expect(f.transport.navigate).not.toHaveBeenCalled();
    expect(f.transport.close).not.toHaveBeenCalled();
    expect(f.result.current.state.snapshot!.identity).toEqual(identity);
  });

  it("hides under a dialog and re-shows without touching the page", async () => {
    const f = await fixture();
    act(() => f.result.current.setViewport(slot));
    f.rerender({ ...f.options, dialogOpen: true });
    expect(lastPresentation(f.transport)?.visible).toBe(false);
    f.rerender({ ...f.options, dialogOpen: false });
    expect(lastPresentation(f.transport)?.visible).toBe(true);
    expect(f.transport.create).toHaveBeenCalledOnce();
    expect(f.transport.navigate).not.toHaveBeenCalled();
    expect(f.transport.close).not.toHaveBeenCalled();
  });

  it("re-bounds the same instance when its slot moves or the viewport detaches and returns", async () => {
    const f = await fixture();
    act(() => f.result.current.setViewport(slot));
    act(() => f.result.current.setViewport(null));
    expect(lastPresentation(f.transport)?.visible).toBe(false);
    act(() => f.result.current.setViewport({ ...slot, x: 300, width: 600 }));
    const last = lastPresentation(f.transport);
    expect(last.visible).toBe(true);
    expect(last.bounds).toEqual({ ...slot, x: 300, width: 600 });
    expect(f.transport.create).toHaveBeenCalledOnce();
    expect(f.transport.navigate).not.toHaveBeenCalled();
    expect(f.transport.close).not.toHaveBeenCalled();
  });

  it("rerenders with equal-valued option objects keep the instance", async () => {
    const f = await fixture();
    const identity = f.result.current.state.snapshot!.identity;
    f.rerender({
      ...f.options,
      owner: { ...f.options.owner },
      consent: { kind: "required" },
      occlusions: [],
    });
    expect(f.transport.create).toHaveBeenCalledOnce();
    expect(f.transport.close).not.toHaveBeenCalled();
    expect(f.result.current.state.snapshot!.identity).toEqual(identity);
  });

  it("closes only on explicit close or unmount of the tab", async () => {
    const f = await fixture();
    f.rerender({ ...f.options, active: false });
    expect(f.transport.close).not.toHaveBeenCalled();
    f.unmount();
    await waitFor(() => expect(f.transport.close).toHaveBeenCalledOnce());
  });

  it("closes the attempt on an explicit close request", async () => {
    const f = await fixture();
    await act(async () => {
      await f.result.current.close();
    });
    expect(f.transport.close).toHaveBeenCalledOnce();
  });
});
