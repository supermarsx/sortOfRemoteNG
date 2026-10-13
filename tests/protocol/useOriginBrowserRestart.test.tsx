import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { readFileSync } from "node:fs";
import { useLayoutEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OriginBrowserViewport } from "../../src/components/protocol/webBrowser/OriginBrowserViewport";
import { getOriginBrowserFailureDetails } from "../../src/hooks/protocol/originBrowserFailureDetails";
import { originBrowserSessionError } from "../../src/hooks/protocol/originBrowserSessionError";
import {
  resetOriginBrowserLifecycleForTests,
  useOriginBrowser,
  type UseOriginBrowserOptions,
} from "../../src/hooks/protocol/useOriginBrowser";
import type {
  OriginBrowserAction,
  OriginBrowserCreateResult,
  OriginBrowserOwner,
  OriginBrowserSnapshot,
  OriginBrowserStatusResult,
  OriginBrowserTransport,
} from "../../src/types/protocols/originBrowser";

type Browser = ReturnType<typeof useOriginBrowser>;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetOriginBrowserLifecycleForTests();
  vi.clearAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const owner: OriginBrowserOwner = {
  ownerDatabaseId: "database-1",
  connectionId: "connection-1",
  sessionId: "tab-1",
};
const identity = (serial: number, of: OriginBrowserOwner = owner) => ({
  ownerDatabaseId: of.ownerDatabaseId,
  connectionId: of.connectionId,
  sessionId: of.sessionId,
  attemptId: `native-attempt-${serial}`,
});
const bounds = { x: 20, y: 80, width: 800, height: 600 };
function snapshot(
  serial: number,
  overrides: Partial<OriginBrowserSnapshot> = {},
): OriginBrowserSnapshot {
  return {
    identity: identity(serial),
    sequence: 0,
    phase: "attached",
    displayUrl: "https://fixture.invalid/login",
    title: "Fixture",
    loading: false,
    canGoBack: false,
    canGoForward: false,
    ...overrides,
  };
}
const sourceChanged = (serial: number, sequence = 1) =>
  snapshot(serial, {
    sequence,
    phase: "failed",
    // The wire value of BrowserSessionFailure::SourceChanged (contract K1).
    failureReason: "source-changed",
  });

function fixture(overrides: Partial<UseOriginBrowserOptions> = {}) {
  const listeners = new Set<(event: OriginBrowserSnapshot) => void>();
  // The nth create call answers as native attempt n, also after an override.
  const create = vi.fn<OriginBrowserTransport["create"]>();
  create.mockImplementation(async (request) => ({
    requestId: request.requestId,
    snapshot: snapshot(0, {
      identity: identity(create.mock.calls.length, request.owner),
    }),
  }));
  const transport = {
    create,
    navigate: vi
      .fn<OriginBrowserTransport["navigate"]>()
      .mockResolvedValue(undefined),
    control: vi
      .fn<OriginBrowserTransport["control"]>()
      .mockResolvedValue(undefined),
    close: vi
      .fn<OriginBrowserTransport["close"]>()
      .mockResolvedValue(undefined),
    status: vi.fn<OriginBrowserTransport["status"]>(async (request) => ({
      capability: { availability: "available" },
      snapshot: request.identity
        ? snapshot(0, { identity: request.identity })
        : null,
    })),
    listen: vi.fn<OriginBrowserTransport["listen"]>(async (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
  };
  const options: UseOriginBrowserOptions = {
    owner,
    expectedSecurityRevision: "revision-7",
    sourceSessionId: "unlock-1",
    initialUrl: "https://fixture.invalid/login",
    enabled: true,
    ownerAvailable: true,
    active: true,
    dialogOpen: false,
    consent: { kind: "required" },
    transport,
    ...overrides,
  };
  const emit = (event: OriginBrowserSnapshot) =>
    act(() => [...listeners].forEach((listener) => listener(event)));
  return { transport, options, emit };
}

/** Mirrors OriginBrowserViewport: a child disposes the previous controller's
 * `close` whenever a new attempt scope replaces it, before the hook's effects. */
function Viewport({ close }: { close: Browser["close"] }) {
  useLayoutEffect(
    () => () => {
      void close();
    },
    [close],
  );
  return null;
}
function Shell({
  options,
  seen,
}: {
  options: UseOriginBrowserOptions;
  seen: (browser: Browser) => void;
}) {
  const browser = useOriginBrowser(options);
  seen(browser);
  return <Viewport close={browser.close} />;
}
function mount(options: UseOriginBrowserOptions) {
  const statuses: Browser["connectionStatus"][] = [];
  const latest: { browser: Browser | null } = { browser: null };
  const seen = (browser: Browser) => {
    latest.browser = browser;
    statuses.push(browser.connectionStatus);
  };
  const view = render(<Shell options={options} seen={seen} />);
  return {
    /** Every connection status the shell rendered, in order. */
    statuses,
    get browser() {
      return latest.browser!;
    },
    rerender: (next: UseOriginBrowserOptions) =>
      view.rerender(<Shell options={next} seen={seen} />),
    unmount: view.unmount,
  };
}
/** The real viewport: what the user is shown, and what they can press. */
function Visible({
  options,
  seen,
}: {
  options: UseOriginBrowserOptions;
  seen: (browser: Browser) => void;
}) {
  const browser = useOriginBrowser(options);
  seen(browser);
  return (
    <OriginBrowserViewport
      controller={browser}
      active={options.active}
      ownerAvailable={options.ownerAvailable}
      dialogOpen={options.dialogOpen}
      title="Fixture"
    />
  );
}
async function attached(overrides: Partial<UseOriginBrowserOptions> = {}) {
  const f = fixture(overrides);
  const shell = mount(f.options);
  act(() => shell.browser.setViewport(bounds));
  await waitFor(() => expect(shell.browser.state.phase).toBe("attached"));
  return { ...f, shell };
}
/** Real timers: run every queued continuation of the mocked IPC chain. */
const turns = () =>
  act(async () => {
    for (let turn = 0; turn < 60; turn++) await Promise.resolve();
  });
/** Fake timers: advance, then run the continuations that the timers released. */
const advance = (ms = 0) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    for (let turn = 0; turn < 60; turn++) await Promise.resolve();
  });

// The two start failures that pass by themselves, read from native so a
// reworded constant cannot silently stop being retried.
const runtime = readFileSync("src-tauri/src/origin_browser_runtime.rs", "utf8");
const native = (name: string) =>
  runtime.match(new RegExp(`const ${name}: &str = "([^"]+)";`))![1];
const engineStarting = native("STARTUP_TIMED_OUT");
const relayBind = native("PROXY_FAILED");
const engineFailed = native("STARTUP_FAILED");
// A lease lost while the tab was starting: usually the saved row was edited.
const stale = native("STALE");

describe("restart in place (K2)", () => {
  it("closes, then creates, reporting reconnecting and never disconnected", async () => {
    const t = await attached();
    const closing = deferred<void>();
    t.transport.close.mockReturnValueOnce(closing.promise);
    t.shell.statuses.length = 0;
    let restarted!: Promise<boolean>;
    act(() => {
      restarted = t.shell.browser.restart("settings-saved");
    });
    await waitFor(() =>
      expect(t.transport.close).toHaveBeenCalledExactlyOnceWith({
        identity: identity(1),
      }),
    );
    await turns();
    expect(t.shell.browser.connectionStatus).toBe("reconnecting");
    expect(t.shell.browser.state.restart).toBe("settings-saved");
    // The replacement is not requested while the close is unacknowledged.
    expect(t.transport.create).toHaveBeenCalledOnce();
    await act(async () => {
      closing.resolve();
      expect(await restarted).toBe(true);
    });
    await waitFor(() =>
      expect(t.shell.browser.connectionStatus).toBe("connected"),
    );
    expect(t.transport.create).toHaveBeenCalledTimes(2);
    expect(t.shell.browser.state.snapshot?.identity.attemptId).toBe(
      "native-attempt-2",
    );
    expect(t.shell.browser.state.restart ?? null).toBeNull();
    expect(new Set(t.shell.statuses)).toEqual(
      new Set(["connected", "reconnecting"]),
    );
    expect(t.shell.browser.lastRestart).toMatchObject({
      reason: "settings-saved",
      automatic: false,
    });
  });

  it("still reads as reconnecting when native answers the replacement before its page is attached", async () => {
    const t = await attached();
    t.transport.create.mockImplementationOnce(async (request) => ({
      requestId: request.requestId,
      snapshot: snapshot(0, {
        identity: identity(2, request.owner),
        phase: "starting",
      }),
    }));
    t.transport.status.mockImplementation(async () => ({
      capability: { availability: "available" },
      snapshot: null,
    }));
    t.shell.statuses.length = 0;
    let restarted!: Promise<boolean>;
    act(() => {
      restarted = t.shell.browser.restart("settings-saved");
    });
    await act(async () => expect(await restarted).toBe(true));
    await waitFor(() =>
      expect(t.shell.browser.state.snapshot?.identity.attemptId).toBe(
        "native-attempt-2",
      ),
    );
    expect(t.shell.browser.state.phase).toBe("starting");
    expect(t.shell.browser.connectionStatus).toBe("reconnecting");
    expect(t.shell.browser.state.restart).toBe("settings-saved");
    t.emit(snapshot(2, { sequence: 1 }));
    expect(t.shell.browser.connectionStatus).toBe("connected");
    expect(t.shell.browser.state.restart ?? null).toBeNull();
    expect(new Set(t.shell.statuses)).toEqual(
      new Set(["connected", "reconnecting"]),
    );
  });

  it("runs caller work after the confirmed close and before the create", async () => {
    const t = await attached();
    const closing = deferred<void>();
    t.transport.close.mockReturnValueOnce(closing.promise);
    const work = deferred<void>();
    const beforeCreate = vi.fn(() => work.promise);
    let restarted!: Promise<boolean>;
    act(() => {
      restarted = t.shell.browser.restart("settings-saved", { beforeCreate });
    });
    await waitFor(() => expect(t.transport.close).toHaveBeenCalledOnce());
    await turns();
    expect(beforeCreate).not.toHaveBeenCalled();
    await act(async () => closing.resolve());
    await waitFor(() => expect(beforeCreate).toHaveBeenCalledOnce());
    await turns();
    expect(t.transport.create).toHaveBeenCalledOnce();
    expect(t.shell.browser.connectionStatus).toBe("reconnecting");
    await act(async () => {
      work.resolve();
      expect(await restarted).toBe(true);
    });
    await waitFor(() => expect(t.shell.browser.state.phase).toBe("attached"));
    expect(t.transport.create).toHaveBeenCalledTimes(2);
    expect(t.shell.statuses).not.toContain("disconnected");
  });

  it("still replaces the tab when caller work fails, and hands that failure to the caller", async () => {
    const t = await attached();
    const failure = new Error("save failed");
    // Started in its own scope: its result needs the commit that scope ends in.
    let outcome!: Promise<unknown>;
    act(() => {
      outcome = t.shell.browser
        .restart("settings-saved", {
          beforeCreate: () => {
            throw failure;
          },
        })
        .catch((error: unknown) => error);
    });
    await act(async () => expect(await outcome).toBe(failure));
    await waitFor(() =>
      expect(t.shell.browser.state.snapshot?.identity.attemptId).toBe(
        "native-attempt-2",
      ),
    );
    expect(t.shell.browser.connectionStatus).toBe("connected");
    expect(t.shell.statuses).not.toContain("disconnected");
    expect(JSON.stringify(t.shell.browser.state)).not.toContain("save failed");
  });

  it("neither runs caller work nor creates when the close is not confirmed", async () => {
    const t = await attached();
    t.transport.close.mockRejectedValue(new Error("native secret"));
    const beforeCreate = vi.fn();
    let restarted!: Promise<boolean>;
    act(() => {
      restarted = t.shell.browser.restart("session-cleared", { beforeCreate });
    });
    await act(async () => expect(await restarted).toBe(false));
    expect(beforeCreate).not.toHaveBeenCalled();
    expect(t.transport.create).toHaveBeenCalledOnce();
    expect(t.shell.browser.state.operationFailure).toBe("cleanup");
    expect(t.shell.browser.connectionStatus).toBe("error");
    expect(t.shell.statuses).not.toContain("disconnected");
    expect(JSON.stringify(t.shell.browser.state)).not.toContain("secret");
    // Retry checks the close again and only then starts the replacement.
    t.transport.close.mockResolvedValue(undefined);
    act(() => t.shell.browser.reconnect());
    await waitFor(() => expect(t.shell.browser.state.phase).toBe("attached"));
    expect(t.transport.close).toHaveBeenCalledTimes(2);
    expect(t.transport.create).toHaveBeenCalledTimes(2);
  });

  it("coalesces requests until the replacement create is issued, then starts a new cycle", async () => {
    const t = await attached();
    const closing = deferred<void>();
    t.transport.close.mockReturnValueOnce(closing.promise);
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = t.shell.browser.restart("source-changed");
    });
    await waitFor(() => expect(t.transport.close).toHaveBeenCalledOnce());
    act(() => {
      second = t.shell.browser.restart("source-changed");
    });
    await act(async () => {
      closing.resolve();
      expect(await first).toBe(true);
      expect(await second).toBe(true);
    });
    await waitFor(() => expect(t.shell.browser.state.phase).toBe("attached"));
    expect(t.transport.close).toHaveBeenCalledOnce();
    expect(t.transport.create).toHaveBeenCalledTimes(2);
    // The attached replacement may already predate a later save: restart again.
    let third!: Promise<boolean>;
    act(() => {
      third = t.shell.browser.restart("requested");
    });
    await act(async () => expect(await third).toBe(true));
    await waitFor(() =>
      expect(t.shell.browser.state.snapshot?.identity.attemptId).toBe(
        "native-attempt-3",
      ),
    );
    expect(t.transport.close).toHaveBeenCalledTimes(2);
    expect(t.shell.statuses).not.toContain("disconnected");
  });

  it("keeps a restart, and runs its caller work once, across a scope change", async () => {
    const t = await attached();
    const work = deferred<void>();
    const beforeCreate = vi.fn(() => work.promise);
    let restarted!: Promise<boolean>;
    act(() => {
      restarted = t.shell.browser.restart("settings-saved", { beforeCreate });
    });
    await waitFor(() => expect(beforeCreate).toHaveBeenCalledOnce());
    t.shell.statuses.length = 0;
    // The save the caller is running replaces the owner proof underneath it.
    t.shell.rerender({ ...t.options, expectedSecurityRevision: "revision-8" });
    await turns();
    expect(t.shell.browser.connectionStatus).toBe("reconnecting");
    expect(t.transport.create).toHaveBeenCalledOnce();
    await act(async () => {
      work.resolve();
      expect(await restarted).toBe(true);
    });
    await waitFor(() => expect(t.shell.browser.state.phase).toBe("attached"));
    expect(beforeCreate).toHaveBeenCalledOnce();
    expect(t.transport.create).toHaveBeenCalledTimes(2);
    expect(t.transport.create.mock.calls[1][0].expectedSecurityRevision).toBe(
      "revision-8",
    );
    expect(new Set(t.shell.statuses)).toEqual(
      new Set(["reconnecting", "connected"]),
    );
  });

  it("refuses a restart it cannot perform", async () => {
    const t = await attached();
    const stale = t.shell.browser;
    t.shell.rerender({ ...t.options, ownerAvailable: false });
    const beforeCreate = vi.fn();
    await act(async () => {
      expect(await stale.restart("requested", { beforeCreate })).toBe(false);
      expect(await t.shell.browser.restart("requested", { beforeCreate })).toBe(
        false,
      );
    });
    expect(beforeCreate).not.toHaveBeenCalled();
    expect(t.transport.create).toHaveBeenCalledOnce();
  });

  it("ends a pending restart when the owner goes away or the tab is disposed", async () => {
    const t = await attached();
    const closing = deferred<void>();
    t.transport.close.mockReturnValue(closing.promise);
    const beforeCreate = vi.fn();
    let lost!: Promise<boolean>;
    act(() => {
      lost = t.shell.browser.restart("requested", { beforeCreate });
    });
    await waitFor(() => expect(t.transport.close).toHaveBeenCalledOnce());
    t.shell.rerender({ ...t.options, ownerAvailable: false });
    await act(async () => expect(await lost).toBe(false));
    expect(t.shell.browser.connectionStatus).toBe("error");

    t.shell.rerender(t.options);
    await turns();
    let disposed!: Promise<boolean>;
    act(() => {
      disposed = t.shell.browser.restart("requested", { beforeCreate });
    });
    t.shell.unmount();
    await act(async () => expect(await disposed).toBe(false));
    expect(beforeCreate).not.toHaveBeenCalled();
    expect(t.transport.create).toHaveBeenCalledOnce();
  });

  it("keeps a final close mapped to disconnected", async () => {
    const t = await attached();
    await act(async () => t.shell.browser.close());
    expect(t.shell.browser.state.phase).toBe("closed");
    expect(t.shell.browser.connectionStatus).toBe("disconnected");
  });

  it("lets a final close end a restart that is waiting", async () => {
    const t = await attached();
    const closing = deferred<void>();
    t.transport.close.mockReturnValueOnce(closing.promise);
    let restarted!: Promise<boolean>;
    act(() => {
      restarted = t.shell.browser.restart("requested");
    });
    await waitFor(() => expect(t.transport.close).toHaveBeenCalledOnce());
    await turns();
    let closed!: Promise<void>;
    act(() => {
      closed = t.shell.browser.close();
    });
    await act(async () => {
      closing.resolve();
      expect(await restarted).toBe(false);
      await closed;
    });
    expect(t.shell.browser.state.phase).toBe("closed");
    expect(t.shell.browser.connectionStatus).toBe("disconnected");
    expect(t.transport.create).toHaveBeenCalledOnce();
  });
});

describe("close-before-create across remounts (R3)", () => {
  it("makes a remounted tab wait for its predecessor's close before creating", async () => {
    const t = await attached();
    const closing = deferred<void>();
    t.transport.close.mockReturnValueOnce(closing.promise);
    t.shell.unmount();
    expect(t.transport.close).toHaveBeenCalledExactlyOnceWith({
      identity: identity(1),
    });
    const remounted = mount(t.options);
    await turns();
    expect(t.transport.create).toHaveBeenCalledOnce();
    expect(remounted.browser.connectionStatus).toBe("connecting");
    await act(async () => closing.resolve());
    await waitFor(() => expect(remounted.browser.state.phase).toBe("attached"));
    expect(t.transport.create).toHaveBeenCalledTimes(2);
    expect(t.transport.close).toHaveBeenCalledOnce();
  });

  it("waits for a predecessor's unanswered create and closes what it returns", async () => {
    const f = fixture();
    const creating = deferred<OriginBrowserCreateResult>();
    f.transport.create.mockReturnValueOnce(creating.promise);
    const first = mount(f.options);
    await waitFor(() => expect(f.transport.create).toHaveBeenCalledOnce());
    first.unmount();
    const remounted = mount(f.options);
    await turns();
    expect(f.transport.create).toHaveBeenCalledOnce();
    expect(f.transport.close).not.toHaveBeenCalled();
    await act(async () =>
      creating.resolve({
        requestId: f.transport.create.mock.calls[0][0].requestId,
        snapshot: snapshot(1),
      }),
    );
    await waitFor(() => expect(remounted.browser.state.phase).toBe("attached"));
    expect(f.transport.close).toHaveBeenCalledExactlyOnceWith({
      identity: identity(1),
    });
    expect(f.transport.close.mock.invocationCallOrder[0]).toBeLessThan(
      f.transport.create.mock.invocationCallOrder[1],
    );
    expect(remounted.browser.state.snapshot?.identity.attemptId).toBe(
      "native-attempt-2",
    );
  });

  it("lets the remounted tab retry a predecessor close that was rejected", async () => {
    const t = await attached();
    const closing = deferred<void>();
    t.transport.close.mockReturnValueOnce(closing.promise);
    t.shell.unmount();
    const remounted = mount(t.options);
    await act(async () => closing.reject(new Error("native secret")));
    await waitFor(() =>
      expect(remounted.browser.state.operationFailure).toBe("cleanup"),
    );
    expect(t.transport.create).toHaveBeenCalledOnce();
    expect(JSON.stringify(remounted.browser.state)).not.toContain("secret");
    act(() => remounted.browser.reconnect());
    await waitFor(() => expect(remounted.browser.state.phase).toBe("attached"));
    expect(t.transport.close.mock.calls).toEqual([
      [{ identity: identity(1) }],
      [{ identity: identity(1) }],
    ]);
    expect(t.transport.create).toHaveBeenCalledTimes(2);
  });

  it("does not keep a rejected close once no tab is left to retry it", async () => {
    const t = await attached();
    t.transport.close.mockRejectedValueOnce(new Error("native secret"));
    t.shell.unmount();
    await turns();
    const later = mount(t.options);
    await waitFor(() => expect(later.browser.state.phase).toBe("attached"));
    expect(t.transport.close).toHaveBeenCalledOnce();
    expect(t.transport.create).toHaveBeenCalledTimes(2);
  });

  it("does not make another tab wait", async () => {
    const t = await attached();
    t.transport.close.mockReturnValueOnce(new Promise(() => {}));
    t.shell.unmount();
    const other = fixture({ owner: { ...owner, sessionId: "tab-2" } });
    const shell = mount(other.options);
    await waitFor(() => expect(shell.browser.state.phase).toBe("attached"));
  });
});

describe("a predecessor that never answers (bound on the R3 wait)", () => {
  const unanswered = () => new Promise<void>(() => {});

  it("shows the remounted tab an error with Retry enabled after a bounded wait, and Retry asks native again", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const f = fixture();
    const latest: { browser: Browser | null } = { browser: null };
    const seen = (browser: Browser) => {
      latest.browser = browser;
    };
    const first = render(<Visible options={f.options} seen={seen} />);
    await waitFor(() => expect(latest.browser?.state.phase).toBe("attached"));
    vi.useFakeTimers();
    // Native never answers the close that the unmounting tab issues.
    f.transport.close.mockReturnValueOnce(unanswered());
    first.unmount();
    expect(f.transport.close).toHaveBeenCalledExactlyOnceWith({
      identity: identity(1),
    });
    render(<Visible options={f.options} seen={seen} />);
    await advance(29_999);
    expect(latest.browser!.state.phase).toBe("starting");
    expect(screen.queryByRole("button", { name: "Retry browser" })).toBeNull();
    await advance(1);
    expect(latest.browser!.state).toMatchObject({
      phase: "unavailable",
      unavailableReason: "host-unavailable",
      operationFailure: "cleanup",
    });
    expect(latest.browser!.connectionStatus).toBe("error");
    expect(f.transport.create).toHaveBeenCalledOnce();
    const retry = screen.getByRole("button", { name: "Retry browser" });
    expect(retry).toBeEnabled();
    // Retry asks native again instead of waiting on the lost reply.
    fireEvent.click(retry);
    await advance();
    expect(f.transport.close.mock.calls).toEqual([
      [{ identity: identity(1) }],
      [{ identity: identity(1) }],
    ]);
    expect(latest.browser!.state.phase).toBe("attached");
    expect(f.transport.create).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Retry browser" })).toBeNull();
  });

  it("accepts an acknowledgement that arrives after the deadline, without asking again", async () => {
    const t = await attached();
    vi.useFakeTimers();
    const late = deferred<void>();
    t.transport.close.mockReturnValueOnce(late.promise);
    t.shell.unmount();
    const remounted = mount(t.options);
    await advance(30_000);
    expect(remounted.browser.state.operationFailure).toBe("cleanup");
    await act(async () => late.resolve());
    act(() => remounted.browser.reconnect());
    await advance();
    expect(remounted.browser.state.phase).toBe("attached");
    expect(t.transport.close).toHaveBeenCalledOnce();
    expect(t.transport.create).toHaveBeenCalledTimes(2);
  });

  it("does not make a tab mounted after the deadline wait at all", async () => {
    const t = await attached();
    vi.useFakeTimers();
    t.transport.close.mockReturnValueOnce(unanswered());
    t.shell.unmount();
    await advance(30_000);
    const later = mount(t.options);
    await advance();
    expect(later.browser.state.phase).toBe("attached");
    expect(t.transport.close).toHaveBeenCalledOnce();
    expect(t.transport.create).toHaveBeenCalledTimes(2);
  });

  it("reports a predecessor create that is never answered, without creating over it", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.transport.create.mockReturnValueOnce(
      new Promise<OriginBrowserCreateResult>(() => {}),
    );
    const first = mount(f.options);
    await advance();
    expect(f.transport.create).toHaveBeenCalledOnce();
    first.unmount();
    const remounted = mount(f.options);
    await advance(209_999);
    expect(remounted.browser.state.phase).toBe("starting");
    await advance(1);
    expect(remounted.browser.state).toMatchObject({
      phase: "unavailable",
      unavailableReason: "host-unavailable",
      operationFailure: "cleanup",
    });
    expect(remounted.browser.connectionStatus).toBe("error");
    expect(f.transport.create).toHaveBeenCalledOnce();
    expect(f.transport.close).not.toHaveBeenCalled();
  });

  it("ends a restart whose close is never answered, without ever reading as disconnected", async () => {
    const t = await attached();
    vi.useFakeTimers();
    t.shell.statuses.length = 0;
    t.transport.close.mockReturnValueOnce(unanswered());
    let restarted!: Promise<boolean>;
    act(() => {
      restarted = t.shell.browser.restart("settings-saved");
    });
    await advance(29_999);
    expect(t.shell.browser.connectionStatus).toBe("reconnecting");
    await advance(1);
    expect(await restarted).toBe(false);
    expect(t.shell.browser.state.operationFailure).toBe("cleanup");
    expect(t.shell.browser.connectionStatus).toBe("error");
    expect(t.transport.create).toHaveBeenCalledOnce();
    act(() => t.shell.browser.reconnect());
    await advance();
    expect(t.shell.browser.state.snapshot?.identity.attemptId).toBe(
      "native-attempt-2",
    );
    expect(t.transport.close).toHaveBeenCalledTimes(2);
    expect(t.shell.statuses).not.toContain("disconnected");
  });

  it("ends a final close as unconfirmed instead of leaving it closing", async () => {
    const t = await attached();
    vi.useFakeTimers();
    t.transport.close.mockReturnValueOnce(unanswered());
    let closed!: Promise<void>;
    act(() => {
      closed = t.shell.browser.close();
    });
    await advance(29_999);
    expect(t.shell.browser.state.phase).toBe("closing");
    await advance(1);
    await act(async () => closed);
    expect(t.shell.browser.state).toMatchObject({
      phase: "error",
      operationFailure: "cleanup",
    });
    expect(t.shell.browser.connectionStatus).toBe("error");
  });
});

type Tab = Awaited<ReturnType<typeof attached>>;
type Reason = NonNullable<OriginBrowserSnapshot["failureReason"]>;
/** Native ended the attempt and says why. */
const ended = (serial: number, failureReason: Reason, sequence = 1) =>
  snapshot(serial, { sequence, phase: "failed", failureReason });
/** A replacement that came up, for the automatic restart counted so far. */
const reattached = (t: Tab, serial: number) =>
  waitFor(() => {
    expect(t.shell.browser.state.phase).toBe("attached");
    expect(t.shell.browser.state.snapshot?.identity.attemptId).toBe(
      `native-attempt-${serial}`,
    );
  });
const later = (ms: number) => vi.setSystemTime(Date.now() + ms);
/** Not restarted: the error for that cause, and nothing created for it. */
const stopped = async (
  t: Tab,
  creates: number,
  reason: Reason = "source-changed",
) => {
  await turns();
  expect(t.shell.browser.state.phase).toBe("error");
  expect(t.shell.browser.state.snapshot?.failureReason).toBe(reason);
  expect(t.shell.browser.connectionStatus).toBe("error");
  expect(t.transport.create).toHaveBeenCalledTimes(creates);
};
/** Native answers each create before its page is attached. */
function answersBeforeAttach(
  transport: ReturnType<typeof fixture>["transport"],
) {
  transport.create.mockImplementation(async (request) => ({
    requestId: request.requestId,
    snapshot: snapshot(0, {
      identity: identity(transport.create.mock.calls.length, request.owner),
      phase: "starting",
    }),
  }));
  transport.status.mockImplementation(async () => ({
    capability: { availability: "available" },
    snapshot: null,
  }));
}
function starting() {
  const f = fixture();
  answersBeforeAttach(f.transport);
  return f;
}

describe("saved connection changed (K1, K2)", () => {
  it("restarts once for a source-changed report, and stops on a second one", async () => {
    const t = await attached();
    t.shell.statuses.length = 0;
    t.emit(sourceChanged(1));
    expect(t.shell.browser.connectionStatus).toBe("reconnecting");
    await waitFor(() =>
      expect(t.shell.browser.state.snapshot?.identity.attemptId).toBe(
        "native-attempt-2",
      ),
    );
    // Late duplicates about the retired attempt change nothing.
    t.emit(sourceChanged(1, 2));
    await turns();
    expect(t.transport.create).toHaveBeenCalledTimes(2);
    expect(t.transport.close).toHaveBeenCalledExactlyOnceWith({
      identity: identity(1),
    });
    expect(new Set(t.shell.statuses)).toEqual(
      new Set(["reconnecting", "connected"]),
    );
    expect(t.shell.browser.lastRestart).toMatchObject({
      reason: "source-changed",
      automatic: true,
    });
    // The replacement reports the same cause straight away: no restart loop.
    t.emit(sourceChanged(2));
    await turns();
    expect(t.transport.create).toHaveBeenCalledTimes(2);
    expect(t.shell.browser.state.phase).toBe("error");
    expect(t.shell.browser.state.snapshot?.failureReason).toBe(
      "source-changed",
    );
    expect(t.shell.browser.state.error).toContain("saved connection");
    expect(t.shell.browser.connectionStatus).toBe("error");
    // Retry stays available.
    act(() => t.shell.browser.reconnect());
    await waitFor(() =>
      expect(t.shell.browser.state.snapshot?.identity.attemptId).toBe(
        "native-attempt-3",
      ),
    );
  });

  /** Three automatic restarts in a row, each after the loop window. */
  const threeInARow = async (t: Tab) => {
    for (const serial of [1, 2, 3]) {
      t.emit(sourceChanged(serial));
      await reattached(t, serial + 1);
      later(10_000);
    }
  };

  it.each([undefined, "signature-1"])(
    "treats a report after the loop window as a fresh change and restarts again (row signature %s, unchanged)",
    async (authoritySignature) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const t = await attached({ authoritySignature });
      t.emit(sourceChanged(1));
      await reattached(t, 2);
      later(10_000);
      t.emit(sourceChanged(2));
      await reattached(t, 3);
      // Hours later, the same record again: a real change, not rationed.
      later(6 * 60 * 60_000);
      t.emit(sourceChanged(3));
      await reattached(t, 4);
      expect(t.shell.statuses).not.toContain("disconnected");
      expect(t.shell.statuses).not.toContain("error");
      expect(t.shell.browser.lastRestart).toMatchObject({
        reason: "source-changed",
        automatic: true,
      });
    },
  );

  it.each([undefined, "signature-1"])(
    "stops for a report inside the loop window (row signature %s)",
    async (authoritySignature) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const t = await attached({ authoritySignature });
      t.emit(sourceChanged(1));
      await reattached(t, 2);
      later(9_999);
      // A changed row signature does not excuse a repeat this fast either.
      t.shell.rerender({ ...t.options, authoritySignature: "signature-2" });
      t.emit(sourceChanged(2));
      await stopped(t, 2);
    },
  );

  it("stops a slow loop at the fourth automatic restart in a row, and Retry starts a new run", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t = await attached();
    await threeInARow(t);
    t.emit(sourceChanged(4));
    await stopped(t, 4);
    expect(t.shell.browser.state.error).toContain("saved connection");
    // The user looked at it: the count starts again.
    act(() => t.shell.browser.reconnect());
    await reattached(t, 5);
    later(10_000);
    t.emit(sourceChanged(5));
    await reattached(t, 6);
  });

  it("ends the run once a replacement has stayed up for ten minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t = await attached();
    await threeInARow(t);
    later(600_000 - 10_000 - 1);
    t.emit(sourceChanged(4));
    await stopped(t, 4);

    const other = await attached({ owner: { ...owner, sessionId: "tab-2" } });
    const second = (serial: number) =>
      snapshot(serial, {
        identity: identity(serial, { ...owner, sessionId: "tab-2" }),
        sequence: 1,
        phase: "failed",
        failureReason: "source-changed",
      });
    for (const serial of [1, 2, 3]) {
      other.emit(second(serial));
      await reattached(other, serial + 1);
      later(10_000);
    }
    later(600_000 - 10_000);
    other.emit(second(4));
    await reattached(other, 5);
    expect(other.shell.statuses).not.toContain("error");
  });

  it("ends the run when the user asks for a restart, but not for the shell's own source-changed restart", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t = await attached();
    await threeInARow(t);
    // The shell following a saved row is the same cause, not a user action.
    act(() => {
      void t.shell.browser.restart("source-changed");
    });
    await reattached(t, 5);
    later(10_000);
    t.emit(sourceChanged(5));
    await stopped(t, 5);
    // A restart that was refused changes nothing either.
    const stale = t.shell.browser;
    act(() => t.shell.browser.reconnect());
    await reattached(t, 6);
    await act(async () => expect(await stale.restart("requested")).toBe(false));

    const other = await attached({ owner: { ...owner, sessionId: "tab-2" } });
    const second = (serial: number) =>
      snapshot(serial, {
        identity: identity(serial, { ...owner, sessionId: "tab-2" }),
        sequence: 1,
        phase: "failed",
        failureReason: "source-changed",
      });
    for (const serial of [1, 2, 3]) {
      other.emit(second(serial));
      await reattached(other, serial + 1);
      later(10_000);
    }
    act(() => {
      void other.shell.browser.restart("requested");
    });
    await reattached(other, 5);
    later(10_000);
    other.emit(second(5));
    await reattached(other, 6);
  });

  it("counts the repeat window from when the replacement came up, not from a slow create", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t = await attached();
    const creating = deferred<OriginBrowserCreateResult>();
    t.transport.create.mockReturnValueOnce(creating.promise);
    t.emit(sourceChanged(1));
    await waitFor(() => expect(t.transport.create).toHaveBeenCalledTimes(2));
    vi.setSystemTime(Date.now() + 60_000);
    await act(async () =>
      creating.resolve({
        requestId: t.transport.create.mock.calls[1][0].requestId,
        snapshot: snapshot(2),
      }),
    );
    await waitFor(() => expect(t.shell.browser.state.phase).toBe("attached"));
    // It reports the same cause as soon as it is up: still a loop, not a change.
    t.emit(sourceChanged(2));
    await turns();
    expect(t.shell.browser.state.phase).toBe("error");
    expect(t.transport.create).toHaveBeenCalledTimes(2);
  });

  it("lets the native report explain a rejected navigation instead of failing the tab", async () => {
    const t = await attached();
    vi.useFakeTimers();
    t.shell.statuses.length = 0;
    t.transport.navigate.mockRejectedValueOnce("stale authority");
    let navigated!: Promise<boolean>;
    act(() => {
      navigated = t.shell.browser.navigate("https://fixture.invalid/next");
    });
    await advance();
    // The command's rejection arrives before the event that names the cause.
    expect(t.shell.browser.state.phase).toBe("attached");
    t.emit(sourceChanged(1));
    await advance(250);
    expect(await navigated).toBe(false);
    await advance();
    expect(t.shell.browser.state.snapshot?.identity.attemptId).toBe(
      "native-attempt-2",
    );
    expect(t.transport.navigate).toHaveBeenCalledOnce();
    expect(t.shell.statuses).not.toContain("error");
    expect(t.shell.statuses).not.toContain("disconnected");
    // Without a native report the request is sent once more, then it ends
    // the attempt.
    t.transport.navigate
      .mockRejectedValueOnce("native secret")
      .mockRejectedValueOnce("native secret");
    act(() => {
      navigated = t.shell.browser.navigate("https://fixture.invalid/next");
    });
    await advance(250);
    expect(t.transport.navigate).toHaveBeenCalledTimes(3);
    expect(t.shell.browser.state.phase).toBe("attached");
    await advance(250);
    expect(await navigated).toBe(false);
    expect(t.shell.browser.state.operationFailure).toBe("navigation");
    expect(JSON.stringify(t.shell.browser.state)).not.toContain("secret");
  });
});

describe("start watchdog and bounded retry (K3, S5)", () => {
  it("surfaces a hung create as an error with Retry available, never overlapping it", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const hung = deferred<OriginBrowserCreateResult>();
    f.transport.create.mockReturnValueOnce(hung.promise);
    const shell = mount(f.options);
    await advance();
    expect(f.transport.create).toHaveBeenCalledOnce();
    await advance(179_999);
    expect(shell.browser.state.phase).toBe("starting");
    await advance(1);
    expect(shell.browser.state.phase).toBe("error");
    expect(shell.browser.connectionStatus).toBe("error");
    expect(shell.browser.state.startupFailure).toEqual({
      stage: "create",
      category: "ipc",
      code: "start-timeout",
    });
    expect(shell.browser.state.error).toContain("did not answer");
    // Retry is accepted but waits for the unanswered create; it reports the
    // wait as unconfirmed cleanup instead of hanging, and stays retryable.
    act(() => shell.browser.reconnect());
    await advance();
    expect(shell.browser.state.phase).toBe("starting");
    await advance(210_000);
    expect(f.transport.create).toHaveBeenCalledOnce();
    expect(shell.browser.state).toMatchObject({
      phase: "unavailable",
      unavailableReason: "host-unavailable",
      operationFailure: "cleanup",
    });
    act(() => shell.browser.reconnect());
    await advance();
    // The late reply is closed first; only then is the replacement created.
    await act(async () =>
      hung.resolve({
        requestId: f.transport.create.mock.calls[0][0].requestId,
        snapshot: snapshot(1),
      }),
    );
    await advance();
    expect(f.transport.close).toHaveBeenCalledExactlyOnceWith({
      identity: identity(1),
    });
    expect(f.transport.create).toHaveBeenCalledTimes(2);
    expect(shell.browser.state.phase).toBe("attached");
    expect(shell.browser.state.snapshot?.identity.attemptId).toBe(
      "native-attempt-2",
    );
  });

  it("uses the caller's create deadline when one is supplied", async () => {
    vi.useFakeTimers();
    const f = fixture({ startTimeoutMs: 40_000 });
    f.transport.create.mockReturnValueOnce(
      deferred<OriginBrowserCreateResult>().promise,
    );
    const shell = mount(f.options);
    await advance(39_999);
    expect(shell.browser.state.phase).toBe("starting");
    await advance(1);
    expect(shell.browser.state.startupFailure?.code).toBe("start-timeout");
  });

  it("surfaces a hung capability lookup too", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.transport.status.mockReturnValueOnce(
      new Promise<OriginBrowserStatusResult>(() => {}),
    );
    const shell = mount(f.options);
    await advance(29_999);
    expect(shell.browser.state.phase).toBe("starting");
    await advance(1);
    expect(shell.browser.state.startupFailure).toEqual({
      stage: "status",
      category: "ipc",
      code: "start-timeout",
    });
    expect(f.transport.create).not.toHaveBeenCalled();
    // Nothing native was requested, so Retry starts straight away.
    act(() => shell.browser.reconnect());
    await advance();
    expect(shell.browser.state.phase).toBe("attached");
  });

  it("stops waiting for caller work that outlasts the deadline, and Retry does not wait for it", async () => {
    const t = await attached();
    vi.useFakeTimers();
    const work = deferred<void>();
    const beforeCreate = vi.fn(() => work.promise);
    let restarted!: Promise<boolean>;
    act(() => {
      restarted = t.shell.browser.restart("settings-saved", { beforeCreate });
    });
    await advance(29_999);
    expect(t.shell.browser.connectionStatus).toBe("reconnecting");
    await advance(1);
    expect(t.shell.browser.state.startupFailure).toEqual({
      stage: "listen",
      category: "ipc",
      code: "start-timeout",
    });
    expect(t.shell.browser.connectionStatus).toBe("error");
    expect(t.transport.create).toHaveBeenCalledOnce();
    act(() => t.shell.browser.reconnect());
    await advance();
    expect(t.shell.browser.state.snapshot?.identity.attemptId).toBe(
      "native-attempt-2",
    );
    // The late work replaced nothing: Retry did, and its caller is told so.
    await act(async () => {
      work.resolve();
      expect(await restarted).toBe(false);
    });
    await advance(60_000);
    expect(beforeCreate).toHaveBeenCalledOnce();
    expect(t.transport.create).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["engine still starting", engineStarting],
    ["relay bind", relayBind],
  ])(
    "retries a retryable start failure with backoff: %s",
    async (_, message) => {
      vi.useFakeTimers();
      const f = fixture();
      f.transport.create
        .mockRejectedValueOnce(message)
        .mockRejectedValueOnce(message);
      const shell = mount(f.options);
      await advance();
      expect(f.transport.create).toHaveBeenCalledTimes(1);
      expect(shell.browser.state.phase).toBe("starting");
      await advance(499);
      expect(f.transport.create).toHaveBeenCalledTimes(1);
      await advance(1);
      expect(f.transport.create).toHaveBeenCalledTimes(2);
      await advance(1_999);
      expect(f.transport.create).toHaveBeenCalledTimes(2);
      await advance(1);
      expect(f.transport.create).toHaveBeenCalledTimes(3);
      expect(shell.browser.state.phase).toBe("attached");
      expect(shell.statuses).not.toContain("error");
      expect(
        new Set(f.transport.create.mock.calls.map(([r]) => r.requestId)).size,
      ).toBe(3);
    },
  );

  it("stops after three tries and says so", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.transport.create.mockRejectedValue(engineStarting);
    const shell = mount(f.options);
    await advance(2_500);
    expect(shell.browser.state.phase).toBe("error");
    expect(f.transport.create).toHaveBeenCalledTimes(3);
    expect(shell.browser.state.startupFailure).toEqual({
      stage: "create",
      category: "runtime",
      code: "runtime-timeout",
    });
    expect(shell.browser.state.error).toContain("after 3 attempts");
    // What is true now: slow, retried, Retry available. Native's own sentence
    // still asks for an app restart, which a slow start no longer needs.
    expect(shell.browser.state.error).toContain("took too long");
    expect(shell.browser.state.error).toContain("use Retry browser");
    expect(shell.browser.state.error).not.toMatch(/restart the app/i);
    expect(engineStarting).toContain("restart the app");
    await advance(60_000);
    expect(f.transport.create).toHaveBeenCalledTimes(3);
  });

  it("gives a start that lost its lease to an edit one fresh attempt", async () => {
    vi.useFakeTimers();
    const assertOwner = vi.fn();
    const f = fixture({ assertOwner });
    f.transport.create.mockRejectedValueOnce(stale);
    const shell = mount(f.options);
    await advance();
    expect(f.transport.create).toHaveBeenCalledOnce();
    expect(shell.browser.state.phase).toBe("starting");
    await advance(499);
    expect(f.transport.create).toHaveBeenCalledOnce();
    await advance(1);
    expect(f.transport.create).toHaveBeenCalledTimes(2);
    expect(shell.browser.state.phase).toBe("attached");
    expect(shell.statuses).not.toContain("error");
    // A new request, which native authorizes from the saved row again, sent
    // only after the local owner proof was checked again.
    const [first, second] = f.transport.create.mock.calls.map(([r]) => r);
    expect(second.requestId).not.toBe(first.requestId);
    expect(assertOwner).toHaveBeenCalledTimes(2);
  });

  it("reports a start that is stale a second time and never tries a third", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.transport.create.mockRejectedValue(stale);
    const shell = mount(f.options);
    await advance(500);
    expect(f.transport.create).toHaveBeenCalledTimes(2);
    expect(shell.browser.state.phase).toBe("error");
    expect(shell.browser.connectionStatus).toBe("error");
    expect(shell.browser.state.startupFailure).toEqual({
      stage: "create",
      category: "connection",
      code: "session-stale",
    });
    expect(shell.browser.state.error).toContain("after 2 attempts");
    await advance(60_000);
    expect(f.transport.create).toHaveBeenCalledTimes(2);
  });

  it("does not spend the fresh attempt once the owner is gone, or the tab was closed or replaced", async () => {
    vi.useFakeTimers();
    const assertOwner = vi.fn();
    const f = fixture({ assertOwner });
    f.transport.create.mockRejectedValue(stale);
    const shell = mount(f.options);
    await advance();
    expect(f.transport.create).toHaveBeenCalledOnce();
    assertOwner.mockImplementation(() => {
      throw new Error("owner revoked");
    });
    await advance(500);
    expect(f.transport.create).toHaveBeenCalledOnce();
    expect(shell.browser.state.startupFailure?.stage).toBe("owner-check");

    const closedTab = fixture({ owner: { ...owner, sessionId: "tab-2" } });
    closedTab.transport.create.mockRejectedValue(stale);
    const closed = mount(closedTab.options);
    await advance();
    expect(closedTab.transport.create).toHaveBeenCalledOnce();
    closed.unmount();
    await advance(60_000);
    expect(closedTab.transport.create).toHaveBeenCalledOnce();

    const replacedTab = fixture({ owner: { ...owner, sessionId: "tab-3" } });
    replacedTab.transport.create.mockRejectedValueOnce(stale);
    const replaced = mount(replacedTab.options);
    await advance();
    expect(replacedTab.transport.create).toHaveBeenCalledOnce();
    // A new owner proof replaces the attempt; only its successor creates.
    replaced.rerender({
      ...replacedTab.options,
      expectedSecurityRevision: "revision-8",
    });
    await advance(60_000);
    expect(replacedTab.transport.create).toHaveBeenCalledTimes(2);
    expect(
      replacedTab.transport.create.mock.calls[1][0].expectedSecurityRevision,
    ).toBe("revision-8");
    expect(replaced.browser.state.phase).toBe("attached");
  });

  it("does not take the same text from another stage for a lost lease", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.transport.status.mockRejectedValue(stale);
    const shell = mount(f.options);
    await advance(60_000);
    expect(shell.browser.state.phase).toBe("error");
    expect(shell.browser.state.startupFailure?.stage).toBe("status");
    expect(shell.browser.state.startupFailure?.code).toBeUndefined();
    expect(f.transport.status).toHaveBeenCalledOnce();
    expect(f.transport.create).not.toHaveBeenCalled();
  });

  it("counts the fresh attempt within the three creates of one start", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.transport.create
      .mockRejectedValueOnce(engineStarting)
      .mockRejectedValueOnce(stale)
      .mockRejectedValueOnce(stale);
    const shell = mount(f.options);
    await advance(2_500);
    expect(f.transport.create).toHaveBeenCalledTimes(3);
    expect(shell.browser.state.startupFailure?.code).toBe("session-stale");
    await advance(60_000);
    expect(f.transport.create).toHaveBeenCalledTimes(3);
  });

  it("does not retry a start failure that is not transient", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.transport.create.mockRejectedValue(engineFailed);
    const shell = mount(f.options);
    await advance();
    expect(shell.browser.state.phase).toBe("error");
    await advance(60_000);
    expect(f.transport.create).toHaveBeenCalledOnce();
    expect(shell.browser.state.error).not.toContain("attempts");
  });

  it("checks the owner again before each retry and stops when the tab is retired", async () => {
    vi.useFakeTimers();
    const assertOwner = vi.fn();
    const f = fixture({ assertOwner });
    f.transport.create.mockRejectedValue(relayBind);
    const shell = mount(f.options);
    await advance();
    expect(f.transport.create).toHaveBeenCalledOnce();
    assertOwner.mockImplementation(() => {
      throw new Error("owner revoked");
    });
    await advance(500);
    expect(f.transport.create).toHaveBeenCalledOnce();
    expect(shell.browser.state.startupFailure?.stage).toBe("owner-check");

    const other = fixture({ owner: { ...owner, sessionId: "tab-2" } });
    other.transport.create.mockRejectedValue(relayBind);
    const retired = mount(other.options);
    await advance();
    expect(other.transport.create).toHaveBeenCalledOnce();
    retired.unmount();
    await advance(60_000);
    expect(other.transport.create).toHaveBeenCalledOnce();
  });
});

describe("a live tab whose private relay ended (same loop protection as a saved change)", () => {
  it("restarts the tab once, as its own reason, after the ended attempt is closed", async () => {
    const t = await attached();
    t.shell.statuses.length = 0;
    t.emit(ended(1, "private-proxy"));
    expect(t.shell.browser.connectionStatus).toBe("reconnecting");
    expect(t.shell.browser.state.restart).toBe("relay-ended");
    await reattached(t, 2);
    expect(t.transport.close).toHaveBeenCalledExactlyOnceWith({
      identity: identity(1),
    });
    expect(t.transport.close.mock.invocationCallOrder[0]).toBeLessThan(
      t.transport.create.mock.invocationCallOrder[1],
    );
    expect(new Set(t.shell.statuses)).toEqual(
      new Set(["reconnecting", "connected"]),
    );
    expect(t.shell.browser.lastRestart).toMatchObject({
      reason: "relay-ended",
      automatic: true,
    });
  });

  it("stops with Retry when the relay ends again inside the loop window", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t = await attached();
    t.emit(ended(1, "private-proxy"));
    await reattached(t, 2);
    later(9_999);
    t.emit(ended(2, "private-proxy"));
    await stopped(t, 2, "private-proxy");
    expect(t.shell.browser.state.error).toContain(
      "private browser proxy was unavailable",
    );
    expect(t.shell.browser.state.error).toContain("Use Retry browser");
    act(() => t.shell.browser.reconnect());
    await reattached(t, 3);
    // Past the window it is a fresh failure again.
    later(10_000);
    t.emit(ended(3, "private-proxy"));
    await reattached(t, 4);
  });

  it.each([
    [["source-changed", "private-proxy", "source-changed", "private-proxy"]],
    [["private-proxy", "source-changed", "private-proxy", "source-changed"]],
  ] as const)(
    "counts both causes in one run, so %j stops at the fourth",
    async (causes) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const t = await attached();
      for (const [index, cause] of causes.slice(0, 3).entries()) {
        t.emit(ended(index + 1, cause));
        await reattached(t, index + 2);
        later(10_000);
      }
      t.emit(ended(4, causes[3]));
      await stopped(t, 4, causes[3]);
      expect(t.shell.statuses).not.toContain("disconnected");
    },
  );

  it.each([
    "database-owner",
    "owner-window",
    "watchdog",
    "runtime-unavailable",
    "certificate-bridge",
  ] as const)(
    "never restarts by itself for %s, however long the tab had been up",
    async (reason) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const t = await attached();
      t.emit(ended(1, reason));
      await stopped(t, 1, reason);
      act(() => t.shell.browser.reconnect());
      await reattached(t, 2);
      // Nor after an automatic restart that is long past its window.
      t.emit(ended(2, "private-proxy"));
      await reattached(t, 3);
      later(60 * 60_000);
      t.emit(ended(3, reason));
      await stopped(t, 3, reason);
      expect(t.shell.browser.lastRestart).toMatchObject({
        reason: "relay-ended",
        serial: 1,
      });
    },
  );

  it("leaves a relay that ended during the start to the start's own retry and counts no restart for it", async () => {
    vi.useFakeTimers();
    const f = starting();
    const shell = mount(f.options);
    await advance();
    f.emit(ended(1, "private-proxy"));
    // An automatic restart would not wait for the start's retry pause.
    await advance(499);
    expect(f.transport.create).toHaveBeenCalledOnce();
    await advance(1);
    expect(f.transport.create).toHaveBeenCalledTimes(2);
    expect(shell.browser.lastRestart).toBeNull();
    f.emit(snapshot(2, { sequence: 1 }));
    await advance();
    expect(shell.browser.connectionStatus).toBe("connected");
    // Live now: the same failure restarts the tab, as the first of its run.
    f.emit(ended(2, "private-proxy", 2));
    await advance();
    expect(f.transport.create).toHaveBeenCalledTimes(3);
    expect(shell.browser.lastRestart).toMatchObject({
      reason: "relay-ended",
      automatic: true,
      serial: 1,
    });
  });

  it("hands a replacement whose relay ends before it shows a page to the start's retry, not to a second restart", async () => {
    const t = await attached();
    vi.useFakeTimers();
    answersBeforeAttach(t.transport);
    t.shell.statuses.length = 0;
    t.emit(ended(1, "private-proxy"));
    await advance();
    expect(t.transport.create).toHaveBeenCalledTimes(2);
    expect(t.shell.browser.lastRestart?.serial).toBe(1);
    t.emit(ended(2, "private-proxy"));
    await advance(499);
    expect(t.transport.create).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(t.transport.create).toHaveBeenCalledTimes(3);
    expect(t.shell.browser.lastRestart?.serial).toBe(1);
    t.emit(snapshot(3, { sequence: 1 }));
    await advance();
    expect(t.shell.browser.connectionStatus).toBe("connected");
    expect(new Set(t.shell.statuses)).toEqual(
      new Set(["connected", "reconnecting"]),
    );
  });

  it("does not end the run for the shell's own relay-ended restart", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t = await attached();
    for (const serial of [1, 2, 3]) {
      t.emit(ended(serial, "private-proxy"));
      await reattached(t, serial + 1);
      later(10_000);
    }
    act(() => {
      void t.shell.browser.restart("relay-ended");
    });
    await reattached(t, 5);
    expect(t.shell.browser.lastRestart).toMatchObject({
      reason: "relay-ended",
      automatic: false,
    });
    later(10_000);
    t.emit(ended(5, "private-proxy"));
    await stopped(t, 5, "private-proxy");
  });
});

describe("reasons native publishes for a tab it ended", () => {
  it.each([
    ["source-changed", "source-changed", ""],
    ["private-proxy", "relay-ended", ""],
    [
      "database-owner",
      "retry",
      "database-session authorization is no longer current",
    ],
    [
      "owner-window",
      "retry",
      "app window or document that owned this browser session is no longer current",
    ],
    [
      "watchdog",
      "retry",
      "UI callback did not complete before the watchdog deadline",
    ],
    [
      "runtime-unavailable",
      "retry",
      "native browser runtime was no longer available",
    ],
    [
      "certificate-bridge",
      "retry",
      "TLS admission bridge for this private session failed",
    ],
  ] as const)(
    "ends an attached tab for %s with a status, a plain message and the right way on (%s)",
    async (failureReason, way, sentence) => {
      vi.stubGlobal(
        "ResizeObserver",
        class {
          observe() {}
          unobserve() {}
          disconnect() {}
        },
      );
      const f = fixture();
      const statuses: Browser["connectionStatus"][] = [];
      const latest: { browser: Browser | null } = { browser: null };
      render(
        <Visible
          options={f.options}
          seen={(browser) => {
            latest.browser = browser;
            statuses.push(browser.connectionStatus);
          }}
        />,
      );
      await waitFor(() => expect(latest.browser?.state.phase).toBe("attached"));
      statuses.length = 0;
      f.emit(ended(1, failureReason));
      await turns();
      // Never the session-ended reading a bare `closing` used to give.
      expect(statuses).not.toContain("disconnected");
      if (way !== "retry") {
        await waitFor(() =>
          expect(latest.browser!.state.snapshot?.identity.attemptId).toBe(
            "native-attempt-2",
          ),
        );
        expect(statuses).not.toContain("error");
        expect(statuses).toContain("reconnecting");
        expect(latest.browser!.lastRestart).toMatchObject({
          reason: way,
          automatic: true,
        });
        expect(
          screen.queryByRole("button", { name: "Retry browser" }),
        ).toBeNull();
        expect(f.transport.create).toHaveBeenCalledTimes(2);
        return;
      }
      const browser = latest.browser!;
      expect(browser.connectionStatus).toBe("error");
      expect(browser.state.snapshot?.failureReason).toBe(failureReason);
      expect(browser.state.error).toBe(
        originBrowserSessionError(failureReason),
      );
      expect(browser.state.error).toMatch(/^Native browser session failed: /);
      expect(browser.state.error).toContain(sentence);
      expect(browser.state.error).not.toContain("No cause was provided");
      expect(screen.getByRole("alert")).toHaveTextContent(browser.state.error!);
      const [detail] = getOriginBrowserFailureDetails(browser.state);
      expect(detail.code).toBe(`native-${failureReason}`);
      expect(detail.problem).not.toContain("No supported structured cause");
      // Nothing happens by itself, and nothing is left hanging.
      expect(f.transport.create).toHaveBeenCalledOnce();
      expect(f.transport.close).toHaveBeenCalledExactlyOnceWith({
        identity: identity(1),
      });
      const retry = screen.getByRole("button", { name: "Retry browser" });
      expect(retry).toBeEnabled();
      fireEvent.click(retry);
      await waitFor(() =>
        expect(latest.browser!.state.snapshot?.identity.attemptId).toBe(
          "native-attempt-2",
        ),
      );
      expect(latest.browser!.connectionStatus).toBe("connected");
    },
  );

  it("retries a relay that ends before the start showed a page, within the start's three creates", async () => {
    vi.useFakeTimers();
    const f = starting();
    const shell = mount(f.options);
    await advance();
    expect(shell.browser.state.phase).toBe("starting");
    f.emit(ended(1, "private-proxy"));
    await advance();
    expect(shell.browser.state.phase).toBe("starting");
    expect(f.transport.close).toHaveBeenCalledExactlyOnceWith({
      identity: identity(1),
    });
    await advance(499);
    expect(f.transport.create).toHaveBeenCalledOnce();
    await advance(1);
    expect(f.transport.create).toHaveBeenCalledTimes(2);
    f.emit(ended(2, "private-proxy"));
    await advance(1_999);
    expect(f.transport.create).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(f.transport.create).toHaveBeenCalledTimes(3);
    expect(shell.statuses).not.toContain("error");
    expect(shell.statuses).not.toContain("disconnected");
    // The third one is reported, with Retry.
    f.emit(ended(3, "private-proxy"));
    await advance(60_000);
    expect(f.transport.create).toHaveBeenCalledTimes(3);
    expect(shell.browser.state.phase).toBe("error");
    expect(shell.browser.connectionStatus).toBe("error");
    expect(shell.browser.state.snapshot?.failureReason).toBe("private-proxy");
    expect(shell.browser.state.error).toContain(
      "private browser proxy was unavailable",
    );
    expect(shell.browser.state.error).toContain("after 3 attempts");
    // Retry is a new start with its own three creates.
    act(() => shell.browser.reconnect());
    await advance();
    expect(f.transport.create).toHaveBeenCalledTimes(4);
    f.emit(ended(4, "private-proxy"));
    await advance(500);
    expect(f.transport.create).toHaveBeenCalledTimes(5);
    f.emit(snapshot(5, { sequence: 1 }));
    await advance();
    expect(shell.browser.connectionStatus).toBe("connected");
  });

  it("keeps a restart reading as reconnecting while its start is retried", async () => {
    const t = await attached();
    vi.useFakeTimers();
    t.transport.create.mockImplementation(async (request) => ({
      requestId: request.requestId,
      snapshot: snapshot(0, {
        identity: identity(t.transport.create.mock.calls.length, request.owner),
        phase: "starting",
      }),
    }));
    t.transport.status.mockImplementation(async () => ({
      capability: { availability: "available" },
      snapshot: null,
    }));
    t.shell.statuses.length = 0;
    act(() => {
      void t.shell.browser.restart("settings-saved");
    });
    await advance();
    expect(t.transport.create).toHaveBeenCalledTimes(2);
    t.emit(ended(2, "private-proxy"));
    await advance(500);
    expect(t.transport.create).toHaveBeenCalledTimes(3);
    t.emit(snapshot(3, { sequence: 1 }));
    await advance();
    expect(t.shell.browser.connectionStatus).toBe("connected");
    expect(new Set(t.shell.statuses)).toEqual(
      new Set(["connected", "reconnecting"]),
    );
  });

  it("does not retry a relay that ends in the pause when the user retried first, or the tab was closed", async () => {
    vi.useFakeTimers();
    const f = starting();
    const shell = mount(f.options);
    await advance();
    f.emit(ended(1, "private-proxy"));
    await advance(100);
    // The user's own Retry is the next start; the pending retry adds none.
    act(() => shell.browser.reconnect());
    await advance(60_000);
    expect(f.transport.create).toHaveBeenCalledTimes(2);

    const other = starting();
    other.options.owner = { ...owner, sessionId: "tab-2" };
    const closed = mount(other.options);
    await advance();
    other.emit(
      snapshot(1, {
        identity: identity(1, other.options.owner),
        sequence: 1,
        phase: "failed",
        failureReason: "private-proxy",
      }),
    );
    await advance(100);
    closed.unmount();
    await advance(60_000);
    expect(other.transport.create).toHaveBeenCalledOnce();
  });
});

describe("born-hidden creation size (B1, K5)", () => {
  it("creates at the last known viewport and never at 1x1", async () => {
    const f = fixture();
    const shell = mount(f.options);
    await waitFor(() => expect(shell.browser.state.phase).toBe("attached"));
    // Nothing measured yet: the shell content size stands in.
    expect(f.transport.create.mock.calls[0][0].bounds).toEqual({
      x: 0,
      y: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    });
    act(() => shell.browser.setViewport(bounds));
    // The tab is hidden again (inactive, or the app document is hidden).
    act(() => shell.browser.setViewport(null));
    act(() => shell.browser.reconnect());
    await waitFor(() => expect(f.transport.create).toHaveBeenCalledTimes(2));
    expect(f.transport.create.mock.calls[1][0].bounds).toEqual(bounds);

    // A tab that was never shown is created at the shell's last known slot.
    const background = fixture({
      owner: { ...owner, sessionId: "tab-2" },
      active: false,
    });
    const hidden = mount(background.options);
    await waitFor(() => expect(hidden.browser.state.phase).toBe("attached"));
    expect(background.transport.create.mock.calls[0][0].bounds).toEqual(bounds);
    for (const [request] of [
      ...f.transport.create.mock.calls,
      ...background.transport.create.mock.calls,
    ]) {
      expect(request.visible).toBe(false);
      expect(request.bounds.width * request.bounds.height).toBeGreaterThan(1);
    }
  });
});

describe("one retry for a rejected presentation or control IPC (1.7)", () => {
  const presentations = (transport: ReturnType<typeof fixture>["transport"]) =>
    transport.control.mock.calls
      .map(([request]) => request.action)
      .filter(
        (
          action,
        ): action is Extract<OriginBrowserAction, { kind: "presentation" }> =>
          action.kind === "presentation",
      );

  it("does not fail the attempt for one rejected presentation IPC, but does for two", async () => {
    const t = await attached();
    vi.useFakeTimers();
    t.transport.control.mockClear();
    t.transport.control.mockRejectedValueOnce(new Error("native secret"));
    const wider = { ...bounds, width: 900 };
    act(() => t.shell.browser.setViewport(wider));
    await advance();
    expect(t.shell.browser.state.phase).toBe("attached");
    expect(presentations(t.transport)).toHaveLength(1);
    await advance(250);
    // Resent with a newer revision: native ignores a revision it has seen.
    const sent = presentations(t.transport);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ bounds: wider, visible: true });
    expect(sent[1].revision).toBeGreaterThan(sent[0].revision);
    await advance(60_000);
    expect(t.shell.browser.state.phase).toBe("attached");
    expect(t.transport.close).not.toHaveBeenCalled();

    t.transport.control
      .mockRejectedValueOnce(new Error("native secret"))
      .mockRejectedValueOnce(new Error("native secret"));
    act(() => t.shell.browser.setViewport({ ...bounds, width: 950 }));
    await advance(250);
    expect(presentations(t.transport)).toHaveLength(4);
    expect(t.shell.browser.state.phase).toBe("attached");
    await advance(250);
    expect(presentations(t.transport)).toHaveLength(4);
    expect(t.shell.browser.state.phase).toBe("error");
    expect(t.shell.browser.state.operationFailure).toBe("presentation");
    expect(t.transport.close).toHaveBeenCalledExactlyOnceWith({
      identity: identity(1),
    });
    expect(JSON.stringify(t.shell.browser.state)).not.toContain("secret");
  });

  it("retries a rejected control IPC once before failing the attempt", async () => {
    const t = await attached();
    vi.useFakeTimers();
    t.transport.control.mockClear();
    t.transport.control.mockRejectedValueOnce(new Error("native secret"));
    let reloaded!: Promise<boolean>;
    act(() => {
      reloaded = t.shell.browser.reload();
    });
    await advance(249);
    expect(t.transport.control).toHaveBeenCalledOnce();
    await advance(1);
    expect(await reloaded).toBe(true);
    expect(t.transport.control.mock.calls.map(([r]) => r.action)).toEqual([
      { kind: "reload" },
      { kind: "reload" },
    ]);
    expect(t.shell.browser.state.phase).toBe("attached");

    t.transport.control.mockClear();
    t.transport.control
      .mockRejectedValueOnce(new Error("native secret"))
      .mockRejectedValueOnce(new Error("native secret"));
    let zoomed!: Promise<boolean>;
    act(() => {
      zoomed = t.shell.browser.zoom(125);
    });
    await advance(500);
    expect(await zoomed).toBe(false);
    expect(t.transport.control).toHaveBeenCalledTimes(2);
    expect(t.shell.browser.state.operationFailure).toBe("control");
    expect(JSON.stringify(t.shell.browser.state)).not.toContain("secret");
  });

  it("does not resend a control behind a dialog that opened during the delay", async () => {
    const t = await attached();
    vi.useFakeTimers();
    t.transport.control.mockClear();
    t.transport.control.mockRejectedValueOnce(new Error("native secret"));
    let went!: Promise<boolean>;
    act(() => {
      went = t.shell.browser.back();
    });
    await advance();
    t.shell.rerender({ ...t.options, dialogOpen: true });
    await advance(250);
    expect(await went).toBe(false);
    expect(
      t.transport.control.mock.calls.filter(
        ([request]) => request.action.kind === "back",
      ),
    ).toHaveLength(1);
    expect(t.shell.browser.state.phase).toBe("attached");
  });
});
