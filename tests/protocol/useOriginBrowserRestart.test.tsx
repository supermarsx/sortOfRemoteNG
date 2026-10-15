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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OriginBrowserViewport } from "../../src/components/protocol/webBrowser/OriginBrowserViewport";
import { getOriginBrowserFailureDetails } from "../../src/hooks/protocol/originBrowserFailureDetails";
import {
  originBrowserSessionError,
  originBrowserSourceChangesExhausted,
} from "../../src/hooks/protocol/originBrowserSessionError";
import {
  ORIGIN_BROWSER_LIFECYCLE,
  resetOriginBrowserLifecycleForTests,
  setOriginBrowserQuietPeriodForTests,
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

// Most tests here are about what a restart does, not when it begins: they run
// without the quiet period after a saved change. Its own tests switch it on.
beforeEach(() => {
  setOriginBrowserQuietPeriodForTests(0);
});

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
    documentLoaded: true,
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
function mount(options: UseOriginBrowserOptions, View = Shell) {
  const statuses: Browser["connectionStatus"][] = [];
  const latest: { browser: Browser | null } = { browser: null };
  const seen = (browser: Browser) => {
    latest.browser = browser;
    statuses.push(browser.connectionStatus);
  };
  const view = render(<View options={options} seen={seen} />);
  return {
    /** Every connection status the shell rendered, in order. */
    statuses,
    get browser() {
      return latest.browser!;
    },
    rerender: (next: UseOriginBrowserOptions) =>
      view.rerender(<View options={next} seen={seen} />),
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
async function attached(
  overrides: Partial<UseOriginBrowserOptions> = {},
  View = Shell,
) {
  const f = fixture(overrides);
  const shell = mount(f.options, View);
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
type Report = (serial: number) => OriginBrowserSnapshot;
/** The same reports for a second tab of the same connection. */
const tab2 = { ...owner, sessionId: "tab-2" };
const endedInTab2 =
  (failureReason: Reason): Report =>
  (serial) =>
    snapshot(serial, {
      identity: identity(serial, tab2),
      sequence: 1,
      phase: "failed",
      failureReason,
    });
/** Automatic restarts for saved changes `first` to `last`, five seconds apart. */
const followed = async (
  t: Tab,
  first: number,
  last: number,
  report: Report = sourceChanged,
) => {
  for (let serial = first; serial <= last; serial++) {
    t.emit(report(serial));
    // Sixty of these: run the mocked IPC chain out instead of polling for it.
    await turns();
    expect(t.shell.browser.state.phase).toBe("attached");
    expect(t.shell.browser.state.snapshot?.identity.attemptId).toBe(
      `native-attempt-${serial + 1}`,
    );
    later(5_000);
  }
};
/** Three automatic relay restarts in a row, each after the loop window. */
const threeRelayEnds = async (
  t: Tab,
  report: Report = (serial) => ended(serial, "private-proxy"),
) => {
  for (const serial of [1, 2, 3]) {
    t.emit(report(serial));
    await reattached(t, serial + 1);
    later(10_000);
  }
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
  it("restarts for a source-changed report, and again when the replacement reports another", async () => {
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
    // The replacement reports another change straight away: followed as well.
    t.emit(sourceChanged(2));
    await reattached(t, 3);
    expect(t.transport.create).toHaveBeenCalledTimes(3);
    expect(t.transport.close.mock.calls).toEqual([
      [{ identity: identity(1) }],
      [{ identity: identity(2) }],
    ]);
    expect(new Set(t.shell.statuses)).toEqual(
      new Set(["reconnecting", "connected"]),
    );
    expect(t.shell.browser.lastRestart).toMatchObject({
      reason: "source-changed",
      automatic: true,
      serial: 2,
    });
  });

  it.each([undefined, "signature-1"])(
    "follows a report seconds after the last restart and one hours later alike (row signature %s, unchanged)",
    async (authoritySignature) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const t = await attached({ authoritySignature });
      t.shell.statuses.length = 0;
      t.emit(sourceChanged(1));
      await reattached(t, 2);
      later(9_999);
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
        serial: 3,
      });
    },
  );

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

describe("saved changes are followed, not rationed", () => {
  it("applies a second saved change that lands seconds after the tab reconnected for the first", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t = await attached();
    t.shell.statuses.length = 0;
    t.emit(ended(1, "source-changed"));
    await reattached(t, 2);
    later(3_000);
    t.emit(ended(2, "source-changed"));
    await reattached(t, 3);
    expect(t.shell.statuses).not.toContain("error");
    expect(t.shell.statuses).not.toContain("disconnected");
  });

  it("applies every one of eight saved changes made inside ten minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t = await attached();
    t.shell.statuses.length = 0;
    for (let serial = 1; serial <= 8; serial++) {
      t.emit(ended(serial, "source-changed"));
      await reattached(t, serial + 1);
      later(45_000);
    }
    expect(t.transport.create).toHaveBeenCalledTimes(9);
    expect(t.shell.statuses).not.toContain("error");
  });

  it("follows a change that lands while the replacement is starting with one more restart, and shows no error in between", async () => {
    const t = await attached();
    t.shell.statuses.length = 0;
    // Native answers the replacement's resync with the newer change.
    t.transport.status.mockImplementation(async (request) => ({
      capability: { availability: "available" },
      snapshot: !request.identity
        ? null
        : request.identity.attemptId === "native-attempt-2"
          ? sourceChanged(2)
          : snapshot(0, { identity: request.identity }),
    }));
    t.emit(sourceChanged(1));
    await reattached(t, 3);
    expect(t.transport.close.mock.calls).toEqual([
      [{ identity: identity(1) }],
      [{ identity: identity(2) }],
    ]);
    expect(new Set(t.shell.statuses)).toEqual(
      new Set(["reconnecting", "connected"]),
    );
    expect(t.shell.browser.lastRestart).toMatchObject({
      reason: "source-changed",
      automatic: true,
      serial: 2,
    });
    // One restart for the one change that landed, and nothing more by itself.
    await turns();
    expect(t.transport.create).toHaveBeenCalledTimes(3);
  });

  it.each(["source-changed", "private-proxy"] as const)(
    "folds a %s report about the attempt a restart is already replacing into that restart",
    async (failureReason) => {
      const t = await attached();
      t.shell.statuses.length = 0;
      act(() => {
        void t.shell.browser.restart("source-changed");
        // Native reports on the same attempt before React renders the restart.
        t.emit(ended(1, failureReason));
      });
      await reattached(t, 2);
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
        automatic: false,
        serial: 1,
      });
    },
  );

  it("stops following at the sixty-first automatic restart inside ten minutes, says so, and Retry starts a new count", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.useFakeTimers({ toFake: ["Date"] });
    const t = await attached({}, Visible);
    t.shell.statuses.length = 0;
    await followed(t, 1, 60);
    expect(t.shell.statuses).not.toContain("error");
    t.emit(sourceChanged(61));
    await stopped(t, 61);
    expect(t.shell.statuses).not.toContain("disconnected");
    const error = t.shell.browser.state.error!;
    expect(error).toBe(originBrowserSourceChangesExhausted(60, 10));
    expect(error).toMatch(/^Native browser session failed: /);
    expect(error).toContain("kept changing while this tab was open");
    expect(error).toContain(
      "restarted automatically 60 times within 10 minutes",
    );
    expect(error).toContain(
      "Use Retry browser to start again with the current settings",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(error);
    // Retry works from here, and the user has seen the tab: a new count.
    const retry = screen.getByRole("button", { name: "Retry browser" });
    expect(retry).toBeEnabled();
    fireEvent.click(retry);
    await reattached(t, 62);
    t.emit(sourceChanged(62));
    await reattached(t, 63);
  });

  it("counts the automatic restarts of the last ten minutes only", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t = await attached();
    // The first of sixty began five minutes before the last one came up.
    await followed(t, 1, 60);
    later(600_000 - 300_000 - 1);
    t.emit(sourceChanged(61));
    await stopped(t, 61);

    const other = await attached({ owner: tab2 });
    await followed(other, 1, 60, endedInTab2("source-changed"));
    // Ten minutes after the first of them, that one no longer counts.
    later(600_000 - 300_000);
    other.emit(endedInTab2("source-changed")(61));
    await reattached(other, 62);
    // The second began five seconds later and still does.
    other.emit(endedInTab2("source-changed")(62));
    await stopped(other, 62);
  });

  it("counts neither the shell's own source-changed restart nor a relay restart, and neither clears the count", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t = await attached();
    await followed(t, 1, 59);
    act(() => {
      void t.shell.browser.restart("source-changed");
    });
    await reattached(t, 61);
    t.emit(ended(61, "private-proxy"));
    await reattached(t, 62);
    // The sixtieth saved change is still followed; the one after it is not.
    t.emit(sourceChanged(62));
    await reattached(t, 63);
    t.emit(sourceChanged(63));
    await stopped(t, 63);
  });

  it("starts a new count when the user asks for a restart", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t = await attached();
    await followed(t, 1, 60);
    act(() => {
      void t.shell.browser.restart("requested");
    });
    await reattached(t, 62);
    t.emit(sourceChanged(62));
    await reattached(t, 63);
  });

  it("repairs a relay that ends seconds after the tab reconnected for a saved change", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t = await attached();
    t.shell.statuses.length = 0;
    t.emit(ended(1, "source-changed"));
    await reattached(t, 2);
    later(3_000);
    t.emit(ended(2, "private-proxy"));
    await reattached(t, 3);
    expect(t.shell.statuses).not.toContain("error");
    expect(t.shell.browser.lastRestart).toMatchObject({
      reason: "relay-ended",
      automatic: true,
    });
  });

  it.each([
    [["source-changed", "private-proxy", "source-changed", "private-proxy"]],
    [["private-proxy", "source-changed", "private-proxy", "source-changed"]],
  ] as const)(
    "keeps a count for each cause, so %j is four restarts and leaves the relay its third",
    async (causes) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const t = await attached();
      t.shell.statuses.length = 0;
      for (const [index, cause] of causes.entries()) {
        t.emit(ended(index + 1, cause));
        await reattached(t, index + 2);
        later(10_000);
      }
      expect(t.shell.statuses).not.toContain("error");
      // The relay's own run is two long: one more, and then it stops.
      t.emit(ended(5, "private-proxy"));
      await reattached(t, 6);
      later(10_000);
      t.emit(ended(6, "private-proxy"));
      await stopped(t, 6, "private-proxy");
      expect(t.shell.statuses).not.toContain("disconnected");
    },
  );

  it("follows a saved change after the relay's run is used up, which does not renew that run", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t = await attached();
    await threeRelayEnds(t);
    t.emit(sourceChanged(4));
    await reattached(t, 5);
    later(10_000);
    t.emit(ended(5, "private-proxy"));
    await stopped(t, 5, "private-proxy");
  });
});

describe("a quiet period before the replacement for a saved change", () => {
  const { sourceChangedQuietMs: quiet, sourceChangedQuietCapMs: cap } =
    ORIGIN_BROWSER_LIFECYCLE;
  /** Full fake timers, the real quiet period, a tab that is up. */
  async function up() {
    vi.useFakeTimers();
    resetOriginBrowserLifecycleForTests();
    const f = fixture();
    const shell = mount(f.options);
    act(() => shell.browser.setViewport(bounds));
    await advance();
    expect(shell.browser.state.phase).toBe("attached");
    shell.statuses.length = 0;
    return { ...f, shell };
  }

  it("uses 1.5 s after the last saved change, and 5 s from the first at most", () => {
    expect(quiet).toBe(1_500);
    expect(cap).toBe(5_000);
  });

  it("shows reconnecting at once and creates the replacement when the saved change has settled", async () => {
    const t = await up();
    t.emit(sourceChanged(1));
    expect(t.shell.browser.connectionStatus).toBe("reconnecting");
    expect(t.shell.browser.state.restart).toBe("source-changed");
    await advance(quiet - 1);
    // The ended page is closed at once; only its replacement waits.
    expect(t.transport.close).toHaveBeenCalledExactlyOnceWith({
      identity: identity(1),
    });
    expect(t.transport.create).toHaveBeenCalledOnce();
    expect(t.shell.browser.connectionStatus).toBe("reconnecting");
    await advance(1);
    expect(t.transport.create).toHaveBeenCalledTimes(2);
    expect(t.shell.browser.state.phase).toBe("attached");
    expect(t.shell.statuses).not.toContain("error");
    expect(t.shell.statuses).not.toContain("disconnected");
  });

  it("waits again after each further saved change, and makes one replacement for all of them", async () => {
    const t = await up();
    t.emit(sourceChanged(1));
    await advance(1_000);
    // Nothing runs for native to report on: the shell's restart for the next
    // write it saw finish is what the hook can see.
    act(() => {
      void t.shell.browser.restart("source-changed");
    });
    await advance(quiet - 1);
    expect(t.transport.create).toHaveBeenCalledOnce();
    await advance(1);
    expect(t.transport.create).toHaveBeenCalledTimes(2);
    await advance(60_000);
    expect(t.transport.create).toHaveBeenCalledTimes(2);
    expect(t.transport.close).toHaveBeenCalledOnce();
    expect(t.shell.browser.lastRestart).toMatchObject({
      reason: "source-changed",
      automatic: true,
      serial: 1,
    });
  });

  it("is not postponed past 5 s from the first saved change by a steady trickle of them", async () => {
    const t = await up();
    t.emit(sourceChanged(1));
    for (let at = 1_000; at < cap; at += 1_000) {
      await advance(1_000);
      act(() => {
        void t.shell.browser.restart("source-changed");
      });
    }
    await advance(cap - 4_000 - 1);
    expect(t.transport.create).toHaveBeenCalledOnce();
    await advance(1);
    expect(t.transport.create).toHaveBeenCalledTimes(2);
  });

  it("does not open a quiet period for the shell's own restart for a saved change", async () => {
    const t = await up();
    act(() => {
      void t.shell.browser.restart("source-changed");
    });
    await advance();
    expect(t.transport.create).toHaveBeenCalledTimes(2);
    expect(t.shell.browser.state.phase).toBe("attached");
    // Nor does a native report about the attempt that restart is replacing.
    act(() => {
      void t.shell.browser.restart("source-changed");
      t.emit(sourceChanged(2));
    });
    await advance();
    expect(t.transport.create).toHaveBeenCalledTimes(3);
  });

  it.each(["requested", "settings-saved", "session-cleared"] as const)(
    "ends the wait for a restart the user asks for (%s)",
    async (reason) => {
      const t = await up();
      t.emit(sourceChanged(1));
      await advance(500);
      act(() => {
        void t.shell.browser.restart(reason);
        // A saved change after the user asked does not open the wait again.
        void t.shell.browser.restart("source-changed");
      });
      await advance();
      expect(t.transport.create).toHaveBeenCalledTimes(2);
      expect(t.shell.browser.state.phase).toBe("attached");
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("ends the wait for Retry", async () => {
    const t = await up();
    t.emit(sourceChanged(1));
    await advance(500);
    act(() => t.shell.browser.reconnect());
    await advance();
    expect(t.transport.create).toHaveBeenCalledTimes(2);
    expect(t.shell.browser.state.phase).toBe("attached");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never waits for a relay that ended", async () => {
    const t = await up();
    t.emit(ended(1, "private-proxy"));
    await advance();
    expect(t.transport.create).toHaveBeenCalledTimes(2);
  });

  it("creates nothing for a tab closed during the wait, and leaves no timer", async () => {
    const t = await up();
    t.emit(sourceChanged(1));
    await advance(500);
    let replaced!: Promise<boolean>;
    act(() => {
      replaced = t.shell.browser.restart("source-changed");
    });
    act(() => {
      void t.shell.browser.close();
    });
    await advance();
    // The shell learns that nothing replaced the closed tab.
    expect(await replaced).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    await advance(60_000);
    expect(t.transport.create).toHaveBeenCalledOnce();
    // Not even the replacement's first request to native is made.
    expect(t.transport.listen).toHaveBeenCalledOnce();
    expect(t.shell.browser.state.phase).toBe("closed");
    expect(t.shell.browser.connectionStatus).toBe("disconnected");
  });

  it("creates nothing for a tab unmounted during the wait, and leaves no timer", async () => {
    const t = await up();
    t.emit(sourceChanged(1));
    await advance(500);
    const rendered = t.shell.statuses.length;
    t.shell.unmount();
    await advance();
    expect(vi.getTimerCount()).toBe(0);
    await advance(60_000);
    expect(t.transport.create).toHaveBeenCalledOnce();
    expect(t.transport.listen).toHaveBeenCalledOnce();
    expect(t.shell.statuses).toHaveLength(rendered);
  });

  it("keeps waiting, without a second replacement, when the address changes during the wait", async () => {
    const t = await up();
    t.emit(sourceChanged(1));
    await advance(1_000);
    t.shell.rerender({
      ...t.options,
      initialUrl: "https://fixture.invalid/other",
    });
    await advance(quiet - 1_000 - 1);
    expect(t.transport.create).toHaveBeenCalledOnce();
    await advance(1);
    expect(t.transport.create).toHaveBeenCalledTimes(2);
    expect(t.transport.create.mock.calls[1][0].initialUrl).toBe(
      "https://fixture.invalid/other",
    );
    await advance(60_000);
    expect(t.transport.create).toHaveBeenCalledTimes(2);
  });
});

describe("a live tab whose private relay ended (loop protection: ten seconds, three in a row, ten minutes)", () => {
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

  it("stops a slow loop at the fourth automatic restart in a row, and Retry starts a new run", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t = await attached();
    await threeRelayEnds(t);
    t.emit(ended(4, "private-proxy"));
    await stopped(t, 4, "private-proxy");
    // The user looked at it: the count starts again.
    act(() => t.shell.browser.reconnect());
    await reattached(t, 5);
    later(10_000);
    t.emit(ended(5, "private-proxy"));
    await reattached(t, 6);
  });

  it("ends the run once a replacement has stayed up for ten minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t = await attached();
    await threeRelayEnds(t);
    later(600_000 - 10_000 - 1);
    t.emit(ended(4, "private-proxy"));
    await stopped(t, 4, "private-proxy");

    const other = await attached({ owner: tab2 });
    await threeRelayEnds(other, endedInTab2("private-proxy"));
    later(600_000 - 10_000);
    other.emit(endedInTab2("private-proxy")(4));
    await reattached(other, 5);
    expect(other.shell.statuses).not.toContain("error");
  });

  it("ends the run when the user asks for a restart, but not for the shell's own source-changed restart", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t = await attached();
    await threeRelayEnds(t);
    // The shell following a saved row is not the user looking at the relay.
    act(() => {
      void t.shell.browser.restart("source-changed");
    });
    await reattached(t, 5);
    later(10_000);
    t.emit(ended(5, "private-proxy"));
    await stopped(t, 5, "private-proxy");
    // A restart that was refused changes nothing either.
    const stale = t.shell.browser;
    act(() => t.shell.browser.reconnect());
    await reattached(t, 6);
    await act(async () => expect(await stale.restart("requested")).toBe(false));

    const other = await attached({ owner: tab2 });
    await threeRelayEnds(other, endedInTab2("private-proxy"));
    act(() => {
      void other.shell.browser.restart("requested");
    });
    await reattached(other, 5);
    later(10_000);
    other.emit(endedInTab2("private-proxy")(5));
    await reattached(other, 6);
  });

  it("counts the repeat window from when the replacement came up, not from a slow create", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t = await attached();
    const creating = deferred<OriginBrowserCreateResult>();
    t.transport.create.mockReturnValueOnce(creating.promise);
    t.emit(ended(1, "private-proxy"));
    await waitFor(() => expect(t.transport.create).toHaveBeenCalledTimes(2));
    vi.setSystemTime(Date.now() + 60_000);
    await act(async () =>
      creating.resolve({
        requestId: t.transport.create.mock.calls[1][0].requestId,
        snapshot: snapshot(2),
      }),
    );
    await waitFor(() => expect(t.shell.browser.state.phase).toBe("attached"));
    // It ends again as soon as it is up: still a loop, not a fresh failure.
    t.emit(ended(2, "private-proxy"));
    await turns();
    expect(t.shell.browser.state.phase).toBe("error");
    expect(t.transport.create).toHaveBeenCalledTimes(2);
  });

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

describe("a pause between two creates ends with the start it belongs to", () => {
  /** A start whose relay ended `pauses` times before a page was shown: it is
   * now inside the pause before its next create. */
  async function paused(pauses: 1 | 2) {
    const f = starting();
    const shell = mount(f.options);
    await advance();
    f.emit(ended(1, "private-proxy"));
    if (pauses === 2) {
      await advance(500);
      f.emit(ended(2, "private-proxy"));
    }
    await advance(100);
    expect(f.transport.create).toHaveBeenCalledTimes(pauses);
    expect(shell.browser.state.phase).toBe("starting");
    return { ...f, shell };
  }
  const closes = (f: ReturnType<typeof fixture>, serials: number[]) =>
    expect(f.transport.close.mock.calls).toEqual(
      serials.map((serial) => [{ identity: identity(serial) }]),
    );

  it.each([1, 2] as const)(
    "closing the tab during pause %i issues no create, leaves no view, no timer and no later render",
    async (pauses) => {
      vi.useFakeTimers();
      const t = await paused(pauses);
      const rendered = t.shell.statuses.length;
      t.shell.unmount();
      await advance();
      // Cancelled, not merely ignored when it fires.
      expect(vi.getTimerCount()).toBe(0);
      await advance(60_000);
      expect(t.transport.create).toHaveBeenCalledTimes(pauses);
      closes(t, pauses === 1 ? [1] : [1, 2]);
      expect(t.shell.statuses).toHaveLength(rendered);
    },
  );

  it("closing the tab exactly as the pause ends issues no create and leaves no view", async () => {
    vi.useFakeTimers();
    const t = await paused(1);
    await advance(399);
    const rendered = t.shell.statuses.length;
    act(() => {
      vi.advanceTimersByTime(1);
      t.shell.unmount();
    });
    await advance(60_000);
    expect(t.transport.create).toHaveBeenCalledOnce();
    closes(t, [1]);
    expect(vi.getTimerCount()).toBe(0);
    // At most the render of the retry itself, none after the tab was closed.
    expect(t.shell.statuses.length - rendered).toBeLessThanOrEqual(1);
  });

  it("follows a create that was already issued when the tab closed with its close", async () => {
    vi.useFakeTimers();
    const t = await paused(1);
    const late = deferred<OriginBrowserCreateResult>();
    t.transport.create.mockReturnValueOnce(late.promise);
    await advance(400);
    expect(t.transport.create).toHaveBeenCalledTimes(2);
    t.shell.unmount();
    await act(async () =>
      late.resolve({
        requestId: t.transport.create.mock.calls[1][0].requestId,
        snapshot: snapshot(2, { phase: "starting" }),
      }),
    );
    await advance(60_000);
    closes(t, [1, 2]);
    expect(t.transport.create).toHaveBeenCalledTimes(2);
    expect(t.transport.control).not.toHaveBeenCalled();
  });

  it("retries the start only after the ended view is confirmed closed, and does not ask twice by itself", async () => {
    vi.useFakeTimers();
    const f = starting();
    f.transport.close.mockRejectedValueOnce(new Error("native secret"));
    const shell = mount(f.options);
    await advance();
    f.emit(ended(1, "private-proxy"));
    await advance(60_000);
    // The retry of the start found the first view unconfirmed and stopped.
    expect(f.transport.create).toHaveBeenCalledOnce();
    closes(f, [1]);
    expect(shell.browser.state).toMatchObject({
      phase: "unavailable",
      unavailableReason: "host-unavailable",
      operationFailure: "cleanup",
    });
    expect(JSON.stringify(shell.browser.state)).not.toContain("secret");
    // The user's Retry asks again, and then the start goes on.
    act(() => shell.browser.reconnect());
    await advance();
    closes(f, [1, 1]);
    expect(f.transport.create).toHaveBeenCalledTimes(2);
  });

  it.each([1, 2] as const)(
    "a final close during pause %i is final: no create follows and the tab ends closed",
    async (pauses) => {
      vi.useFakeTimers();
      const t = await paused(pauses);
      act(() => {
        void t.shell.browser.close();
      });
      await advance();
      const pending = vi.getTimerCount();
      await advance(60_000);
      // The closed tab does not come back.
      expect(t.transport.create).toHaveBeenCalledTimes(pauses);
      expect(t.shell.browser.state.phase).toBe("closed");
      expect(t.shell.browser.connectionStatus).toBe("disconnected");
      closes(t, pauses === 1 ? [1] : [1, 2]);
      expect(pending).toBe(0);
    },
  );

  it("a final close exactly as the pause ends is still final", async () => {
    vi.useFakeTimers();
    const t = await paused(1);
    await advance(399);
    act(() => {
      vi.advanceTimersByTime(1);
      void t.shell.browser.close();
    });
    await advance(60_000);
    expect(t.transport.create).toHaveBeenCalledOnce();
    expect(t.shell.browser.state.phase).toBe("closed");
    expect(t.shell.browser.connectionStatus).toBe("disconnected");
    closes(t, [1]);
  });

  it.each(["requested", "source-changed", "relay-ended"] as const)(
    "a %s restart asked for during the pause is the only next start, even if the pause ends before React renders it",
    async (reason) => {
      vi.useFakeTimers();
      const t = await paused(1);
      act(() => {
        void t.shell.browser.restart(reason);
        // The pause ended with the request, not with a later render.
        expect(vi.getTimerCount()).toBe(0);
        vi.advanceTimersByTime(400);
      });
      await advance(60_000);
      expect(t.transport.create).toHaveBeenCalledTimes(2);
      closes(t, [1]);
      // It is that restart, not a silent continuation of the old start.
      expect(t.shell.browser.state.restart).toBe(reason);
      expect(t.shell.browser.connectionStatus).toBe("reconnecting");
      expect(t.shell.browser.lastRestart).toMatchObject({
        reason,
        automatic: false,
      });
      expect(t.shell.statuses).not.toContain("disconnected");
      expect(t.shell.statuses).not.toContain("error");
    },
  );

  it("a Retry asked for during the pause is a new start with its own three creates, even if the pause ends first", async () => {
    vi.useFakeTimers();
    const t = await paused(1);
    act(() => {
      t.shell.browser.reconnect();
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(400);
    });
    await advance();
    expect(t.transport.create).toHaveBeenCalledTimes(2);
    t.emit(ended(2, "private-proxy"));
    await advance(500);
    expect(t.transport.create).toHaveBeenCalledTimes(3);
    t.emit(ended(3, "private-proxy"));
    await advance(2_000);
    // The third create of the user's own start, not the end of the old one.
    expect(t.transport.create).toHaveBeenCalledTimes(4);
    expect(t.shell.statuses).not.toContain("error");
    t.emit(ended(4, "private-proxy"));
    await advance(60_000);
    expect(t.transport.create).toHaveBeenCalledTimes(4);
    expect(t.shell.browser.state.phase).toBe("error");
  });

  it.each([
    [1, 100],
    [2, 600],
  ] as const)(
    "closing the tab while create %i waits to be retried cancels that wait",
    async (creates, elapsed) => {
      vi.useFakeTimers();
      const f = fixture();
      f.transport.create.mockRejectedValue(engineStarting);
      const shell = mount(f.options);
      await advance(elapsed);
      expect(f.transport.create).toHaveBeenCalledTimes(creates);
      const rendered = shell.statuses.length;
      shell.unmount();
      await advance();
      expect(vi.getTimerCount()).toBe(0);
      await advance(60_000);
      expect(f.transport.create).toHaveBeenCalledTimes(creates);
      expect(f.transport.close).not.toHaveBeenCalled();
      expect(shell.statuses).toHaveLength(rendered);
    },
  );

  it("a Retry while a create waits to be retried replaces the start without an extra create", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.transport.create.mockRejectedValueOnce(engineStarting);
    const shell = mount(f.options);
    await advance(100);
    expect(f.transport.create).toHaveBeenCalledOnce();
    act(() => shell.browser.reconnect());
    await advance();
    expect(f.transport.create).toHaveBeenCalledTimes(2);
    expect(shell.browser.state.phase).toBe("attached");
    await advance(60_000);
    expect(f.transport.create).toHaveBeenCalledTimes(2);
    expect(f.transport.close).not.toHaveBeenCalled();
  });

  it("a final close while a create waits to be retried does not wait the pause out", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.transport.create.mockRejectedValue(engineStarting);
    const shell = mount(f.options);
    await advance(100);
    expect(f.transport.create).toHaveBeenCalledOnce();
    act(() => {
      void shell.browser.close();
    });
    await advance();
    // Closed at once, not when the pause would have ended.
    expect(shell.browser.state.phase).toBe("closed");
    expect(vi.getTimerCount()).toBe(0);
    await advance(60_000);
    expect(f.transport.create).toHaveBeenCalledOnce();
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
describe("a Chromium proxy binding failure", () => {
  const failed = (serial: number, sequence = 1, code = -130) =>
    snapshot(serial, { sequence, loadFailure: { code, category: "proxy" } });
  it.each([-111, -130])(
    "keeps fresh relay recovery pending until navigation, then preserves failure %s without another automatic loop",
    async (code) => {
      const t = await attached();
      t.transport.create.mockImplementationOnce(async (request) => ({
        requestId: request.requestId,
        snapshot: snapshot(2, { loading: true, documentLoaded: false }),
      }));
      t.transport.status.mockResolvedValueOnce({
        capability: { availability: "available" },
        snapshot: snapshot(2, { loading: true, documentLoaded: false }),
      });
      t.emit(failed(1));
      await waitFor(() =>
        expect(t.shell.browser.state.snapshot?.identity.attemptId).toBe(
          "native-attempt-2",
        ),
      );
      expect(t.shell.browser.state.restart).toBe("proxy-unreachable");
      expect(t.shell.browser.connectionStatus).toBe("reconnecting");
      t.emit(
        snapshot(2, { sequence: 1, displayUrl: "about:blank", loading: false }),
      );
      expect(t.shell.browser.state.restart).toBe("proxy-unreachable");
      t.emit(failed(2, 2, code));
      expect(t.shell.browser.state.phase).toBe("error");
      expect(t.shell.browser.state.restart).toBeNull();
      t.emit(snapshot(1, { sequence: 999, loading: false }));
      t.emit(failed(2, 3));
      await turns();
      expect(t.transport.create).toHaveBeenCalledTimes(2);
      expect(t.shell.browser.state.phase).toBe("error");
      expect(t.shell.browser.connectionStatus).toBe("error");
    },
  );
  it("completes fresh relay recovery only for the current completed HTTP page, without reopening it for later navigation", async () => {
    const t = await attached();
    t.transport.create.mockImplementationOnce(async (request) => ({
      requestId: request.requestId,
      snapshot: snapshot(2, { loading: false, documentLoaded: false }),
    }));
    t.transport.status.mockResolvedValueOnce({
      capability: { availability: "available" },
      snapshot: snapshot(2, { loading: false, documentLoaded: false }),
    });
    t.emit(failed(1));
    await waitFor(() =>
      expect(t.shell.browser.state.snapshot?.identity.attemptId).toBe(
        "native-attempt-2",
      ),
    );
    expect(t.shell.browser.state.restart).toBe("proxy-unreachable");
    t.emit(snapshot(1, { sequence: 999, loading: false }));
    expect(t.shell.browser.state.restart).toBe("proxy-unreachable");
    t.emit(snapshot(2, { sequence: 1, loading: false, documentLoaded: false }));
    expect(t.shell.browser.state.restart).toBe("proxy-unreachable");
    t.emit(snapshot(2, { sequence: 2, loading: false, documentLoaded: true }));
    expect(t.shell.browser.state.restart).toBeNull();
    expect(t.shell.browser.connectionStatus).toBe("connected");
    t.emit(snapshot(2, { sequence: 3, loading: true, documentLoaded: false }));
    expect(t.shell.browser.state.restart).toBeNull();
    expect(t.shell.browser.connectionStatus).toBe("connected");
  });
  it("replaces the authenticated relay once and keeps a repeated failure visible", async () => {
    const t = await attached();
    t.emit(failed(1));
    expect(t.shell.browser.state.restart).toBe("proxy-unreachable");
    await reattached(t, 2);
    t.emit(failed(2));
    await waitFor(() => expect(t.shell.browser.state.phase).toBe("error"));
    expect(t.transport.create).toHaveBeenCalledTimes(2);
    expect(t.shell.browser.state.snapshot?.loadFailure?.code).toBe(-130);
    act(() => t.shell.browser.reconnect());
    await reattached(t, 3);
    t.emit(failed(3));
    await reattached(t, 4);
  });
  it("does not repair other proxy errors or expose an interim blank/error surface", async () => {
    const t = await attached();
    t.emit(failed(1, 1, -131));
    await waitFor(() => expect(t.shell.browser.state.phase).toBe("error"));
    t.emit(
      snapshot(1, { sequence: 2, displayUrl: "about:blank", loading: true }),
    );
    expect(t.shell.browser.state.phase).toBe("error");
    expect(t.transport.create).toHaveBeenCalledOnce();
    t.emit(
      snapshot(1, {
        sequence: 3,
        displayUrl: "https://fixture.invalid/ready",
        loading: false,
      }),
    );
    await waitFor(() => expect(t.shell.browser.state.phase).toBe("attached"));
  });
});

describe("independent private-proxy recovery failures", () => {
  const proxyFailure = (serial: number, sequence = 1) =>
    snapshot(serial, {
      sequence,
      documentLoaded: false,
      loadFailure: { code: -130, category: "proxy" },
    });
  it("repairs a proxy failure after an earlier settings restart already completed", async () => {
    const t = await attached();
    let requested!: Promise<boolean>;
    act(() => {
      requested = t.shell.browser.restart("settings-saved");
    });
    await reattached(t, 2);
    expect(await requested).toBe(true);
    t.emit(proxyFailure(2));
    await reattached(t, 3);
    expect(t.transport.create).toHaveBeenCalledTimes(3);
  });
  it("repairs a later independent failure after a genuinely completed page has stayed healthy", async () => {
    let now = 100000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      const t = await attached();
      t.emit(proxyFailure(1));
      await reattached(t, 2);
      now += 10001;
      t.emit(
        snapshot(2, { sequence: 1, loading: true, documentLoaded: false }),
      );
      t.emit(proxyFailure(2, 2));
      await reattached(t, 3);
      expect(t.transport.create).toHaveBeenCalledTimes(3);
    } finally {
      clock.mockRestore();
    }
  });
  it("bounds independent repairs and only resets the run after ten healthy minutes", async () => {
    let now = 100000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      const t = await attached();
      for (let serial = 1; serial <= 3; serial++) {
        t.emit(proxyFailure(serial));
        await reattached(t, serial + 1);
        now += ORIGIN_BROWSER_LIFECYCLE.proxyRepairQuietMs + 1;
      }
      t.emit(proxyFailure(4));
      await turns();
      expect(t.transport.create).toHaveBeenCalledTimes(4);
      expect(t.shell.browser.state.phase).toBe("error");
      // A later actual completed document begins a new healthy interval.
      t.emit(snapshot(4, { sequence: 2 }));
      now += ORIGIN_BROWSER_LIFECYCLE.proxyRepairRunResetMs + 1;
      t.emit(proxyFailure(4, 3));
      await reattached(t, 5);
      expect(t.transport.create).toHaveBeenCalledTimes(5);
    } finally {
      clock.mockRestore();
    }
  });
  it("does not count a provisional navigation as a healthy quiet period", async () => {
    let now = 100000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      const t = await attached();
      t.emit(proxyFailure(1));
      await reattached(t, 2);
      now += 1000;
      t.emit(
        snapshot(2, { sequence: 1, loading: true, documentLoaded: false }),
      );
      now += ORIGIN_BROWSER_LIFECYCLE.proxyRepairRunResetMs + 1;
      t.emit(proxyFailure(2, 2));
      await turns();
      expect(t.transport.create).toHaveBeenCalledTimes(2);
      expect(t.shell.browser.state.phase).toBe("error");
    } finally {
      clock.mockRestore();
    }
  });
  it.each([
    { documentLoaded: false },
    { loading: true, documentLoaded: false },
    { displayUrl: "about:blank" },
  ])("does not rearm from an incomplete replacement %j", async (incomplete) => {
    let now = 100000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      const t = await attached();
      const create = t.transport.create.getMockImplementation()!;
      t.transport.create.mockImplementation(async (...args) => {
        const result = await create(...args);
        return { ...result, snapshot: { ...result.snapshot, ...incomplete } };
      });
      const status = t.transport.status.getMockImplementation()!;
      t.transport.status.mockImplementation(async (...args) => {
        const result = await status(...args);
        return result.snapshot
          ? { ...result, snapshot: { ...result.snapshot, ...incomplete } }
          : result;
      });
      t.emit(proxyFailure(1));
      await turns();
      now += ORIGIN_BROWSER_LIFECYCLE.proxyRepairRunResetMs + 1;
      t.emit(proxyFailure(2));
      await turns();
      expect(t.transport.create).toHaveBeenCalledTimes(2);
      expect(t.shell.browser.state.phase).toBe("error");
    } finally {
      clock.mockRestore();
    }
  });
  it("does not automatically replay a load timeout, and manual Retry creates a fresh attempt", async () => {
    const t = await attached({}, Visible);
    t.emit(
      snapshot(1, {
        sequence: 1,
        documentLoaded: false,
        loadFailure: { code: -118, category: "timeout" },
      }),
    );
    await turns();
    expect(t.transport.create).toHaveBeenCalledTimes(1);
    expect(t.shell.browser.state.snapshot?.loadFailure?.code).toBe(-118);
    fireEvent.click(screen.getByRole("button", { name: "Retry browser" }));
    await reattached(t, 2);
    expect(t.transport.create.mock.calls[1][0].initialUrl).toBe(
      t.options.initialUrl,
    );
    expect(t.transport.navigate).not.toHaveBeenCalled();
  });
});
