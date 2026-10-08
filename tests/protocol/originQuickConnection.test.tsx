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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import type { DatabaseAvailability } from "../../src/contexts/ConnectionContextTypes";
import type {
  OriginBrowserIdentity,
  OriginBrowserSnapshot,
} from "../../src/types/protocols/originBrowser";

const f = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  captureProof: vi.fn(),
  updateSettings: vi.fn(),
  dispatchAndFlush: vi.fn(),
  automation: vi.fn(),
  connections: [] as Connection[],
  availability: { status: "none", generation: 0 } as DatabaseAvailability,
  databaseId: undefined as string | undefined,
  currentListeners: new Set<() => void>(),
  accessListeners: new Set<(event: { databaseId: string }) => void>(),
  showBookmarksBar: true,
  serial: 0,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: f.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: f.listen }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "quick-connect-owner" }),
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { connections: f.connections },
    databaseAvailability: f.availability,
    dispatchAndFlush: f.dispatchAndFlush,
    getCurrentConnections: () => f.connections,
  }),
}));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({
    settings: { webBrowser: { showBookmarksBar: f.showBookmarksBar } },
    settingsReady: true,
    updateSettings: f.updateSettings,
  }),
}));
vi.mock("../../src/contexts/SessionRenderActivityContext", () => ({
  useSessionRenderActivity: () => ({ isActive: true }),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  onDatabaseAccessChange: (
    callback: (event: { databaseId: string }) => void,
  ) => {
    f.accessListeners.add(callback);
    return () => f.accessListeners.delete(callback);
  },
  DatabaseManager: {
    getInstance: () => ({
      getCurrentDatabase: () => (f.databaseId ? { id: f.databaseId } : null),
      captureOriginBrowserOwnerProof: f.captureProof,
      onCurrentDatabaseChange: (callback: () => void) => {
        f.currentListeners.add(callback);
        return () => f.currentListeners.delete(callback);
      },
      onDatabaseAccessChange: (
        callback: (event: { databaseId: string }) => void,
      ) => {
        f.accessListeners.add(callback);
        return () => f.accessListeners.delete(callback);
      },
    }),
  },
}));
// Saved-only surfaces are sentinels. Ownership, the browser controller, native
// viewport and navigation run together without mocking their lifecycle.
vi.mock("../../src/hooks/protocol/useOriginWebsiteAutomation", () => ({
  useOriginWebsiteAutomation: f.automation,
}));
vi.mock(
  "../../src/components/protocol/webBrowser/OriginAutomationControls",
  () => ({
    default: () => <button>Save favorite</button>,
  }),
);
vi.mock("../../src/components/protocol/webBrowser/OriginBookmarkBar", () => ({
  default: () => <button>Add bookmark</button>,
}));

import OriginConnectionBrowser from "../../src/components/protocol/webBrowser/OriginConnectionBrowser";
import { useOriginQuickConnection } from "../../src/hooks/protocol/useOriginQuickConnection";
import {
  clearRuntimeConnectionsForTests,
  getQuickConnectConnection,
  registerQuickConnectConnection,
  registerRuntimeConnection,
  releaseRuntimeConnection,
} from "../../src/utils/session/runtimeConnectionRegistry";
import { serializePersistedConnectionSession } from "../../src/utils/session/sessionPersistence";

const connection = (patch: Partial<Connection> = {}): Connection => ({
  id: "quick-website",
  name: "Temporary website",
  protocol: "https",
  hostname: "quick.invalid",
  port: 443,
  isGroup: false,
  createdAt: "2026-10-08T00:00:00Z",
  updatedAt: "2026-10-08T00:00:00Z",
  ...patch,
});
const session = (
  patch: Partial<ConnectionSession> = {},
): ConnectionSession => ({
  id: "quick-tab",
  connectionId: "quick-website",
  name: "Temporary website",
  protocol: "https",
  hostname: "quick.invalid",
  status: "connected",
  startTime: new Date("2026-10-08T00:00:00Z"),
  ...patch,
});
const snapshot = (identity: OriginBrowserIdentity): OriginBrowserSnapshot => ({
  identity,
  sequence: 0,
  phase: "attached",
  displayUrl: "https://quick.invalid/",
  currentUrl: "https://quick.invalid/",
  title: "Native Quick Connect",
  loading: false,
  canGoBack: true,
  canGoForward: true,
});
const calls = (command: string) =>
  f.invoke.mock.calls.filter(([name]) => name === command);

beforeEach(() => {
  clearRuntimeConnectionsForTests();
  f.connections = [];
  f.availability = { status: "none", generation: 0 };
  f.databaseId = undefined;
  f.currentListeners.clear();
  f.accessListeners.clear();
  f.showBookmarksBar = true;
  f.serial = 0;
  f.captureProof.mockImplementation(() => {
    throw new Error("No managed database proof");
  });
  f.automation.mockReturnValue({});
  f.listen.mockResolvedValue(() => {});
  f.invoke.mockImplementation(async (command, { request }) => {
    if (command === "origin_browser_popup") {
      if (request.action.kind === "downloads") return [];
      return {
        sourceIdentity: request.sourceIdentity,
        sequence: 0,
        sourceClosed: false,
        views: [],
      };
    }
    if (command === "origin_browser_downloads") return [];
    if (command === "origin_browser_status")
      return {
        capability: { availability: "available" },
        snapshot: request.identity ? snapshot(request.identity) : null,
      };
    if (command === "origin_browser_create")
      return {
        requestId: request.requestId,
        snapshot: snapshot({
          ...request.owner,
          attemptId: `attempt-${++f.serial}`,
        }),
      };
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 100,
    left: 0,
    top: 100,
    right: 800,
    bottom: 600,
    width: 800,
    height: 500,
    toJSON: () => ({}),
  });
});
afterEach(() => {
  cleanup();
  clearRuntimeConnectionsForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function attached(tab = session()) {
  const view = render(<OriginConnectionBrowser session={tab} />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Reload" })).toBeEnabled(),
  );
  return view;
}

describe("native Quick Connect shell", () => {
  it.each(["none", "suspended", "ready"] as const)(
    "attaches without database proof when database availability is %s",
    async (status) => {
      f.availability = { status, databaseId: "unrelated-db", generation: 1 };
      registerQuickConnectConnection(connection());
      await attached();
      expect(f.captureProof).not.toHaveBeenCalled();
      expect(calls("origin_browser_create")).toHaveLength(1);
      expect(calls("origin_browser_create")[0][1].request).toMatchObject({
        owner: {
          ownerDatabaseId: "quick-connect:quick-tab",
          connectionId: "quick-website",
          sessionId: "quick-tab",
        },
        sourceSessionId: "quick-tab",
        expectedSecurityRevision: "quick-connect",
        initialUrl: "https://quick.invalid/",
        quickConnect: {
          protocol: "https",
          hostname: "quick.invalid",
          port: 443,
          httpVerifySsl: true,
        },
        visible: false,
        policy: {
          darkMode: "forced",
          autoLogin: { consent: { kind: "required" } },
        },
      });
      expect(screen.getByText(/Temporary Quick Connect/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      fireEvent.click(screen.getByRole("button", { name: "Reload" }));
      fireEvent.change(
        screen.getByRole("textbox", { name: "Website address" }),
        {
          target: { value: "https://quick.invalid/next" },
        },
      );
      fireEvent.click(screen.getByRole("button", { name: "Go" }));
      await waitFor(() =>
        expect(calls("origin_browser_navigate")).toHaveLength(1),
      );
      expect(
        calls("origin_browser_control").map(
          ([, args]) => args.request.action.kind,
        ),
      ).toEqual(expect.arrayContaining(["presentation", "back", "reload"]));
      expect(document.querySelector("iframe")).toBeNull();
      expect(
        f.invoke.mock.calls.every(([name]) =>
          name.startsWith("origin_browser_"),
        ),
      ).toBe(true);
    },
  );

  it("ignores database selection/access changes for an attached temporary tab", async () => {
    registerQuickConnectConnection(connection());
    const tab = session();
    const view = await attached(tab);
    act(() => {
      f.databaseId = "new-db";
      f.availability = { status: "ready", databaseId: "new-db", generation: 2 };
      f.currentListeners.forEach((callback) => callback());
      f.accessListeners.forEach((callback) =>
        callback({ databaseId: "new-db" }),
      );
    });
    view.rerender(<OriginConnectionBrowser session={tab} />);
    await act(async () => {});
    expect(calls("origin_browser_close")).toHaveLength(0);
    expect(calls("origin_browser_create")).toHaveLength(1);
    expect(f.captureProof).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Reload" })).toBeEnabled();
  });

  it.each([true, false])(
    "gates saved-only actions with bookmarks bar preference %s",
    async (showBookmarksBar) => {
      f.showBookmarksBar = showBookmarksBar;
      registerQuickConnectConnection(connection());
      await attached();
      expect(
        screen.getByRole("button", { name: "Browser settings" }),
      ).toBeDisabled();
      expect(screen.queryByRole("button", { name: "Add bookmark" })).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Save favorite" }),
      ).toBeNull();
      expect(f.automation.mock.lastCall?.[0]).toMatchObject({
        blocked: true,
        connection: undefined,
        ownerDatabaseId: undefined,
      });
      await expect(
        f.automation.mock.lastCall?.[0].updateConnection(connection()),
      ).rejects.toThrow(/Save a connection/);
      expect(f.dispatchAndFlush).not.toHaveBeenCalled();
      expect(f.updateSettings).not.toHaveBeenCalled();
      fireEvent.click(
        screen.getByRole("button", { name: "More browser actions" }),
      );
      expect(
        await screen.findByRole("menuitem", { name: "Copy credentials…" }),
      ).toBeDisabled();
    },
  );

  it("passes only explicit volatile credentials to create and never serializes them onto a session", async () => {
    const temporary = connection({
      basicAuthUsername: "volatile-user",
      basicAuthPassword: "volatile-secret",
      httpVerifySsl: false,
      username: "other-user",
      password: "other-secret",
      httpBookmarks: [{ name: "Ignored", path: "https://ignored.invalid/" }],
    });
    registerQuickConnectConnection(temporary);
    const tab = Object.freeze(session());
    const before = JSON.stringify(tab);
    const localWrite = vi.spyOn(window.localStorage, "setItem");
    const sessionWrite = vi.spyOn(window.sessionStorage, "setItem");
    await attached(tab);
    const create = calls("origin_browser_create")[0][1].request;
    expect(create.quickConnect).toEqual({
      protocol: "https",
      hostname: "quick.invalid",
      port: 443,
      httpVerifySsl: false,
      basicAuthUsername: "volatile-user",
      basicAuthPassword: "volatile-secret",
    });
    expect(JSON.stringify(tab)).toBe(before);
    expect(
      JSON.stringify(serializePersistedConnectionSession(tab)),
    ).not.toMatch(/volatile-|other-|basicAuth|quickConnect/);
    expect(
      JSON.stringify(
        f.invoke.mock.calls.filter(
          ([name]) => name !== "origin_browser_create",
        ),
      ),
    ).not.toMatch(/volatile-|other-/);
    expect(localWrite).not.toHaveBeenCalled();
    expect(sessionWrite).not.toHaveBeenCalled();
    expect(f.dispatchAndFlush).not.toHaveBeenCalled();
    expect(f.updateSettings).not.toHaveBeenCalled();
  });

  it.each([
    "missing saved",
    "duplicate saved",
    "runtime redirect",
    "restored session",
  ])("never falls back to temporary authority for %s", async (kind) => {
    const record = connection();
    if (kind === "runtime redirect") registerRuntimeConnection(record);
    else registerQuickConnectConnection(record);
    if (kind === "duplicate saved") f.connections = [record, { ...record }];
    const tab = session({
      ...(kind === "missing saved" && { ownerDatabaseId: "saved-db" }),
      ...(kind === "restored session" && { reattachOnly: true }),
    });
    render(<OriginConnectionBrowser session={tab} />);
    await act(async () => {});
    expect(calls("origin_browser_create")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Reload" })).toBeDisabled();
  });

  it("uses a unique saved record on collision, and refuses missing saved proof", async () => {
    registerQuickConnectConnection(
      connection({ basicAuthPassword: "must-not-fallback" }),
    );
    f.connections = [connection()];
    f.availability = { status: "ready", databaseId: "saved-db", generation: 1 };
    f.databaseId = "saved-db";
    const tab = session({ ownerDatabaseId: "saved-db" });
    const view = render(<OriginConnectionBrowser session={tab} />);
    await act(async () => {});
    expect(f.captureProof).toHaveBeenCalled();
    expect(calls("origin_browser_create")).toHaveLength(0);
    f.captureProof.mockReturnValue({
      ownerDatabaseId: "saved-db",
      expectedSecurityRevision: "saved-revision",
      sourceSessionId: "saved-unlock",
      assertCurrent: () => {},
    });
    act(() => f.currentListeners.forEach((callback) => callback()));
    view.rerender(<OriginConnectionBrowser session={tab} />);
    await waitFor(() => expect(calls("origin_browser_create")).toHaveLength(1));
    const create = calls("origin_browser_create")[0][1].request;
    expect(create.owner.ownerDatabaseId).toBe("saved-db");
    expect(create.sourceSessionId).toBe("saved-unlock");
    expect(create).not.toHaveProperty("quickConnect");
  });

  it("closes an attached native browser when the registry entry disappears without a parent render", async () => {
    registerQuickConnectConnection(connection());
    await attached();
    act(() => releaseRuntimeConnection("quick-website"));
    await waitFor(() => expect(calls("origin_browser_close")).toHaveLength(1));
    expect(
      calls("origin_browser_close")[0][1].request.identity.ownerDatabaseId,
    ).toBe("quick-connect:quick-tab");
    expect(screen.getByRole("button", { name: "Reload" })).toBeDisabled();
    expect(calls("origin_browser_create")).toHaveLength(1);
  });

  it("opens HTTP with its explicit port and a fresh synthetic owner on session change", async () => {
    registerQuickConnectConnection(
      connection({ protocol: "http", port: 8080 }),
    );
    const tab = session({ protocol: "http" });
    const view = await attached(tab);
    expect(calls("origin_browser_create")[0][1].request).toMatchObject({
      initialUrl: "http://quick.invalid:8080/",
      quickConnect: { protocol: "http", port: 8080 },
    });
    view.rerender(
      <OriginConnectionBrowser session={{ ...tab, id: "next-tab" }} />,
    );
    await waitFor(() => expect(calls("origin_browser_create")).toHaveLength(2));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Reload" })).toBeEnabled(),
    );
    expect(calls("origin_browser_close")).toHaveLength(1);
    expect(calls("origin_browser_close")[0][1].request.identity.sessionId).toBe(
      "quick-tab",
    );
    expect(calls("origin_browser_create")[1][1].request).toMatchObject({
      owner: {
        ownerDatabaseId: "quick-connect:next-tab",
        sessionId: "next-tab",
      },
      sourceSessionId: "next-tab",
    });
  });

  it("closes a late native create reply after its temporary definition was removed", async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise((done) => {
      resolve = done;
    });
    const originalInvoke = f.invoke.getMockImplementation()!;
    f.invoke.mockImplementation((command, args) =>
      command === "origin_browser_create"
        ? pending
        : originalInvoke(command, args),
    );
    registerQuickConnectConnection(connection());
    const tab = session();
    const view = render(<OriginConnectionBrowser session={tab} />);
    await waitFor(() => expect(calls("origin_browser_create")).toHaveLength(1));
    const request = calls("origin_browser_create")[0][1].request;
    act(() => releaseRuntimeConnection(tab.connectionId));
    view.rerender(<OriginConnectionBrowser session={tab} />);
    await act(async () =>
      resolve({
        requestId: request.requestId,
        snapshot: snapshot({ ...request.owner, attemptId: "late-attempt" }),
      }),
    );
    await waitFor(() => expect(calls("origin_browser_close")).toHaveLength(1));
    expect(calls("origin_browser_close")[0][1].request.identity.attemptId).toBe(
      "late-attempt",
    );
    expect(screen.getByRole("button", { name: "Reload" })).toBeDisabled();
    expect(calls("origin_browser_create")).toHaveLength(1);
  });
});

describe("temporary owner lease", () => {
  function fixture() {
    const record = connection();
    registerQuickConnectConnection(record);
    const close = vi.fn(async () => {});
    const closeRef = { current: close };
    const tab = session();
    const hook = renderHook(
      ({ tab, saved }) => useOriginQuickConnection(tab, saved, closeRef),
      { initialProps: { tab, saved: [] as Connection[] } },
    );
    return { ...hook, record, close, tab };
  }

  it("keeps its proof stable across unrelated renders and never borrows other credential fields", () => {
    const f = fixture();
    const proof = f.result.current!.proof;
    f.record.username = "not-basic-auth";
    f.record.password = "not-a-basic-secret";
    f.rerender({ tab: { ...f.tab, status: "connecting" }, saved: [] });
    expect(f.result.current!.proof).toBe(proof);
    expect(f.result.current!.quickConnect).not.toHaveProperty(
      "basicAuthUsername",
    );
    expect(f.result.current!.quickConnect).not.toHaveProperty(
      "basicAuthPassword",
    );
    expect(proof.assertCurrent).not.toThrow();
    expect(f.close).not.toHaveBeenCalled();
  });

  it.each(["remove", "redirect replacement", "credentials changed"])(
    "revokes on %s before another native command can run",
    (change) => {
      vi.useFakeTimers();
      const f = fixture();
      const proof = f.result.current!.proof;
      act(() => {
        if (change === "remove") releaseRuntimeConnection(f.record.id);
        if (change === "redirect replacement")
          registerRuntimeConnection(connection());
        if (change === "credentials changed")
          f.record.basicAuthPassword = "changed";
      });
      expect(proof.assertCurrent).toThrow(/no longer available/);
      act(() => vi.advanceTimersByTime(250));
      expect(f.result.current).toBeNull();
      expect(f.close).toHaveBeenCalledTimes(1);
    },
  );

  it("revokes old proofs on session change and unmount", () => {
    const f = fixture();
    const old = f.result.current!.proof;
    f.rerender({ tab: { ...f.tab, id: "next-tab" }, saved: [] });
    expect(old.assertCurrent).toThrow();
    const next = f.result.current!.proof;
    expect(next.ownerDatabaseId).toBe("quick-connect:next-tab");
    expect(next.sourceSessionId).toBe("next-tab");
    expect(next.assertCurrent).not.toThrow();
    expect(f.close).toHaveBeenCalledTimes(1);
    f.unmount();
    expect(next.assertCurrent).toThrow();
    expect(f.close).toHaveBeenCalledTimes(2);
  });

  it("cannot revive an observed revoked proof by re-registering its old object", () => {
    vi.useFakeTimers();
    const f = fixture();
    const proof = f.result.current!.proof;
    act(() => releaseRuntimeConnection(f.record.id));
    expect(proof.assertCurrent).toThrow();
    act(() => registerQuickConnectConnection(f.record));
    expect(proof.assertCurrent).toThrow();
    act(() => vi.advanceTimersByTime(250));
    expect(f.result.current).toBeNull();
    expect(f.close).toHaveBeenCalledTimes(1);
  });

  it("revokes on a saved collision and cannot recover a released definition from serialized session data", () => {
    const f = fixture();
    const proof = f.result.current!.proof;
    f.rerender({ tab: f.tab, saved: [connection()] });
    expect(f.result.current).toBeNull();
    expect(proof.assertCurrent).toThrow();
    act(() => clearRuntimeConnectionsForTests());
    f.rerender({ tab: f.tab, saved: [] });
    expect(f.result.current).toBeNull();
    expect(getQuickConnectConnection(f.tab.connectionId)).toBeUndefined();
  });
});
