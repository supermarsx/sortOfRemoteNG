import React, {
  useCallback,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../src/contexts/ToastContext";
import {
  ConnectionContext,
  type ConnectionAction,
  type ConnectionContextType,
  type ConnectionState,
} from "../../src/contexts/ConnectionContextTypes";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import type { OriginBrowserSnapshot } from "../../src/types/protocols/originBrowser";
import {
  ORIGIN_BROWSER_LIFECYCLE,
  resetOriginBrowserLifecycleForTests,
} from "../../src/hooks/protocol/useOriginBrowser";
import {
  useNativeBrowserExtensions,
  type NativeBrowserExtensionsOptions,
} from "../../src/hooks/protocol/useNativeBrowserExtensions";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  legacy: vi.fn(),
  settings: {} as any,
  updateSettings: vi.fn(),
  manager: {} as any,
  stateListeners: new Set<(event: { payload: unknown }) => void>(),
  serial: 0,
  /** The rows of the last completed database write: what native reads. */
  disk: [] as any[],
  /** The database write. Resolves at once unless a test replaces it. */
  save: vi.fn(),
  /** Every native create: the requested source and the row then on disk. */
  creates: [] as Array<{ initialUrl: string; row: any }>,
  /** Native and persistence steps in the order they happened. */
  order: [] as string[],
  statuses: [] as string[],
  /** Further work of a database write before it returns to its caller. */
  afterWrite: null as null | (() => Promise<void>),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: h.listen }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "owner-window" }),
}));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({
    settings: h.settings,
    settingsReady: true,
    updateSettings: h.updateSettings,
  }),
}));
vi.mock("../../src/contexts/SessionRenderActivityContext", () => ({
  useSessionRenderActivity: () => ({ isActive: true }),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: { getInstance: () => h.manager },
  onDatabaseAccessChange: (listener: (event: any) => void) =>
    h.manager.onDatabaseAccessChange(listener),
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => null,
}));
vi.mock("../../src/utils/recording/webAutomationLibrary", async (original) => ({
  ...(await original<
    typeof import("../../src/utils/recording/webAutomationLibrary")
  >()),
  webAutomationStore: {
    load: async () => ({ value: { version: 1, scripts: [], macros: [] } }),
  },
}));
vi.mock("../../src/hooks/protocol/useWebBrowser", () => ({
  useWebBrowser: h.legacy,
}));
vi.mock("../../src/components/protocol/webBrowser/NavigationBar", () => ({
  default: () => null,
}));
vi.mock("../../src/components/protocol/webBrowser/SecurityInfoBar", () => ({
  default: () => null,
}));
vi.mock("../../src/components/protocol/webBrowser/BookmarkBar", () => ({
  default: () => null,
}));
vi.mock("../../src/components/protocol/webBrowser/ContentArea", () => ({
  default: () => null,
}));
vi.mock("../../src/components/protocol/webBrowser/BrowserDialogs", () => ({
  default: () => null,
}));

// The real reducer and the real mount gate: no mocked dispatch, no mocked
// useConnections. A status the tab publishes really decides whether
// SessionViewer keeps the browser mounted.
import { connectionReducer } from "../../src/contexts/ConnectionProvider";
import { SessionViewer } from "../../src/components/session/SessionViewer";
// SessionViewer loads the browser lazily; loading it here keeps that first
// import out of the first test's waiting time.
import "../../src/components/protocol/WebBrowser";
import { normalizeWebBrowserSettings } from "../../src/utils/settings/webBrowserSettings";

// Every wait here is for a state, never for a duration. The whole shell and
// the session viewer render in each test, so a loaded machine gets room.
configure({ asyncUtilTimeout: 3_000 });
vi.setConfig({ testTimeout: 15_000 });

const session = {
  id: "tab-1",
  connectionId: "connection-1",
  ownerDatabaseId: "database-1",
  protocol: "https",
  hostname: "fixture.invalid",
  name: "Fixture",
  status: "connecting",
  startTime: new Date("2026-10-12T09:00:00.000Z"),
} as ConnectionSession;
const row = {
  id: session.connectionId,
  name: "Fixture",
  protocol: "https",
  hostname: "fixture.invalid",
  port: 443,
  isGroup: false,
  password: "first-secret",
  createdAt: "2026-10-12T09:00:00.000Z",
  updatedAt: "2026-10-12T09:00:00.000Z",
} as Connection;
const snapshot = (
  attemptId: string,
  overrides: Partial<OriginBrowserSnapshot> = {},
): OriginBrowserSnapshot => ({
  identity: {
    ownerDatabaseId: "database-1",
    connectionId: "connection-1",
    sessionId: "tab-1",
    attemptId,
  },
  sequence: 0,
  phase: "attached",
  displayUrl: "https://fixture.invalid/",
  title: "Fixture native",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  ...overrides,
});
/** Native builds the source from the row on disk, never from the request. */
const savedSource = (saved: Connection | undefined) =>
  saved && (saved.protocol === "http" || saved.protocol === "https")
    ? new URL(`${saved.protocol}://${saved.hostname}:${saved.port}/`).href
    : null;

interface Shell {
  state: ConnectionState;
  dispatch: (action: ConnectionAction) => void;
  /** The provider's debounced autosave coming due. */
  flush: () => Promise<void>;
}
const shell: { current: Shell | null } = { current: null };

/** ConnectionProvider reduced to what a tab sees of it: the real reducer,
 * rows current synchronously, and a database write that completes later. */
function Harness({ connections }: { connections: Connection[] }) {
  const [state, baseDispatch] = useReducer(connectionReducer, {
    connections,
    sessions: [session],
    selectedConnection: null,
    selectedConnectionIds: new Set<string>(),
    filter: {
      searchTerm: "",
      protocols: [],
      tags: [],
      colorTags: [],
      showRecent: false,
      showFavorites: false,
      sortBy: "custom",
      sortDirection: "asc",
    },
    isLoading: false,
    sidebarCollapsed: false,
    tabGroups: [],
  } satisfies ConnectionState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [persistence, setPersistence] = useState({
    dirty: false,
    saving: false,
    error: null as string | null,
  });
  const dirtyRevision = useRef(0);
  const persistedRevision = useRef(0);
  const saveLoop = useRef<Promise<void> | null>(null);
  const dispatch = useCallback((action: ConnectionAction) => {
    const next = connectionReducer(stateRef.current, action);
    if (next.connections !== stateRef.current.connections) {
      dirtyRevision.current += 1;
      setPersistence((current) => ({ ...current, dirty: true }));
    }
    stateRef.current = next;
    baseDispatch(action);
  }, []);
  const flushPendingSave = useCallback(async () => {
    if (saveLoop.current) return saveLoop.current;
    if (dirtyRevision.current <= persistedRevision.current) return;
    const loop = (async () => {
      while (dirtyRevision.current > persistedRevision.current) {
        const revision = dirtyRevision.current;
        const rows = stateRef.current.connections;
        setPersistence({ dirty: true, saving: true, error: null });
        try {
          await h.save(rows);
        } catch (error) {
          setPersistence({ dirty: true, saving: false, error: String(error) });
          throw error;
        }
        h.disk = rows;
        h.order.push("save");
        persistedRevision.current = revision;
        const dirty = dirtyRevision.current > persistedRevision.current;
        setPersistence({ dirty, saving: dirty, error: null });
      }
    })();
    saveLoop.current = loop;
    try {
      await loop;
    } finally {
      if (saveLoop.current === loop) saveLoop.current = null;
    }
  }, []);
  const dispatchAndFlush = useCallback(
    async (action: ConnectionAction) => {
      dispatch(action);
      await flushPendingSave();
      await h.afterWrite?.();
    },
    [dispatch, flushPendingSave],
  );
  const getCurrentConnections = useCallback(
    () => stateRef.current.connections,
    [],
  );
  const value = useMemo(
    () =>
      ({
        state,
        dispatch,
        dispatchAndFlush,
        persistence,
        saveData: flushPendingSave,
        flushPendingSave,
        loadData: async () => true,
        getCurrentConnections,
        databaseAvailability: {
          status: "ready",
          databaseId: "database-1",
          generation: 1,
        },
      }) satisfies ConnectionContextType,
    [
      state,
      dispatch,
      dispatchAndFlush,
      persistence,
      flushPendingSave,
      getCurrentConnections,
    ],
  );
  shell.current = { state, dispatch, flush: flushPendingSave };
  const tab = state.sessions.find((item) => item.id === session.id);
  if (tab && h.statuses[h.statuses.length - 1] !== tab.status) {
    h.statuses.push(tab.status);
    h.order.push(`status:${tab.status}`);
  }
  return (
    <ConnectionContext.Provider value={value}>
      {tab && <SessionViewer session={tab} />}
    </ConnectionContext.Provider>
  );
}

beforeEach(() => {
  h.serial = 0;
  h.disk = [row];
  h.creates = [];
  h.order = [];
  h.statuses = [];
  h.afterWrite = null;
  h.stateListeners.clear();
  h.save.mockReset().mockResolvedValue(undefined);
  h.settings = {
    webBrowser: normalizeWebBrowserSettings({ engine: "real-origin" }),
  };
  h.updateSettings.mockReset().mockImplementation(async () => {
    h.order.push("settings");
  });
  h.manager = {
    getCurrentDatabase: () => ({ id: "database-1" }),
    captureCurrentDatabaseDataTarget: () => ({
      databaseId: "database-1",
      assertAccessible: () => undefined,
      readCurrent: async () => ({ connections: structuredClone(h.disk) }),
    }),
    captureOriginBrowserOwnerProof: () => ({
      ownerDatabaseId: "database-1",
      expectedSecurityRevision: "revision-1",
      sourceSessionId: "unlock-1",
      assertCurrent: () => undefined,
    }),
    onCurrentDatabaseChange: () => vi.fn(),
    onDatabaseAccessChange: () => vi.fn(),
  };
  h.listen.mockReset().mockImplementation(async (name, callback) => {
    if (name !== "origin-browser-state") return vi.fn();
    h.stateListeners.add(callback);
    return () => h.stateListeners.delete(callback);
  });
  h.invoke.mockReset().mockImplementation(async (command, { request }) => {
    if (command === "origin_browser_popup") {
      if (request.action.kind === "downloads") return [];
      return {
        sourceIdentity: request.sourceIdentity,
        sequence: 0,
        sourceClosed: false,
        views: [],
      };
    }
    if (command === "origin_browser_status")
      return {
        capability: { availability: "available" },
        snapshot: request.identity
          ? snapshot(request.identity.attemptId)
          : null,
      };
    if (command === "origin_browser_close") h.order.push("close");
    // Native confirms the app-extension gates of the attempt it is asked about.
    if (command === "origin_browser_extensions")
      return {
        version: 1,
        identity: request.identity,
        appControls: true,
        appEnabled: true,
        forcedDark: true,
        chromium: "unsupportedPrivateContext",
      };
    if (command === "origin_browser_create") {
      const saved = h.disk.find(
        (item) => item.id === request.owner.connectionId,
      );
      h.creates.push({ initialUrl: request.initialUrl, row: saved });
      h.order.push("create");
      if (savedSource(saved) !== request.initialUrl)
        throw new Error("Browser initial URL does not match its saved source");
      return {
        requestId: request.requestId,
        snapshot: snapshot(`attempt-${++h.serial}`),
      };
    }
  });
  h.legacy.mockReturnValue({ browserSettings: { showBookmarksBar: false } });
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
afterEach(async () => {
  await act(async () => {});
  cleanup();
  await act(async () => {});
  vi.useRealTimers();
  shell.current = null;
  resetOriginBrowserLifecycleForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const calls = (name: string) =>
  h.invoke.mock.calls.filter(([command]) => command === name);
const tab = () => shell.current!.state.sessions[0];
const saved = () => shell.current!.state.connections[0];
const browserShell = () =>
  document.querySelector('[data-browser-engine="real-origin"]');
/** Let every queued continuation of the mocked IPC chain and its renders run. */
const settle = () =>
  act(async () => {
    for (let turn = 0; turn < 80; turn++) await Promise.resolve();
  });
async function openTab(connections: Connection[] = [row]) {
  h.disk = connections;
  render(<Harness connections={connections} />, { wrapper: ToastProvider });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Reload" })).toBeEnabled(),
  );
  await waitFor(() => expect(tab().status).toBe("connected"));
  expect(calls("origin_browser_create")).toHaveLength(1);
  return browserShell();
}
/** An edit made elsewhere in the app, such as in the connection editor. */
const edit = (change: Partial<Connection>) =>
  act(() =>
    shell.current!.dispatch({
      type: "UPDATE_CONNECTION",
      payload: { ...saved(), ...change },
    }),
  );
const flush = () =>
  act(async () => {
    await shell.current!.flush().catch(() => undefined);
  });
const emit = (event: OriginBrowserSnapshot) =>
  act(() =>
    [...h.stateListeners].forEach((listener) => listener({ payload: event })),
  );
const notice = () =>
  screen.queryByRole("status", { name: "Browser reconnection" });
const reattached = (creates: number) =>
  waitFor(() => {
    expect(calls("origin_browser_create")).toHaveLength(creates);
    expect(tab().status).toBe("connected");
    expect(screen.getByRole("button", { name: "Reload" })).toBeEnabled();
  });
/** As `reattached`, while a dialog still fences the toolbar. */
const reconnected = (creates: number) =>
  waitFor(() => {
    expect(calls("origin_browser_create")).toHaveLength(creates);
    expect(tab().status).toBe("connected");
  });
/** Opens the tab's settings dialog and adds one per-connection override. */
function editPermissions() {
  fireEvent.click(screen.getByRole("button", { name: "Browser settings" }));
  const dialog = screen.getByRole("dialog", {
    name: "Browser request permissions",
  });
  const overrides = within(dialog).getByRole("region", {
    name: "Connection website request overrides",
  });
  fireEvent.change(within(overrides).getByLabelText("New website origin"), {
    target: { value: "https://fixture.invalid" },
  });
  fireEvent.click(
    within(overrides).getByRole("button", { name: "Add website" }),
  );
  return { dialog, overrides };
}
const override = { origin: "https://fixture.invalid" };

describe("opening a native tab", () => {
  it("publishes connecting, then connected, and never a passing error", async () => {
    await openTab();
    await settle();
    // The hook's ownerless state from before the proof arrived is not a
    // failure of this session, and session.connectFailed must not fire.
    expect(h.statuses).toEqual(["connecting", "connected"]);
    expect(tab().errorMessage).toBeUndefined();
  });
});

describe("in-tab Save and reconnect (R2)", () => {
  it("keeps the browser mounted, saves the permissions and creates again", async () => {
    const mounted = await openTab();
    editPermissions();
    fireEvent.click(screen.getByRole("button", { name: "Save and reconnect" }));
    await waitFor(() => expect(calls("origin_browser_close")).toHaveLength(1));
    await settle();
    // Closing its own page must not end the tab: the mount gate keeps the
    // same shell in the document, or nothing after this could be saved.
    expect(screen.queryByText("Session ended")).toBeNull();
    expect(browserShell()).toBe(mounted);
    await reattached(2);
    expect(browserShell()).toBe(mounted);
    expect(h.statuses).toEqual([
      "connecting",
      "connected",
      "reconnecting",
      "connected",
    ]);
    // Both scopes reached their stores, after the close and before the create.
    expect(h.disk[0].websiteDomainPermissions.websites).toMatchObject([
      override,
    ]);
    expect(h.updateSettings).toHaveBeenCalledOnce();
    expect(h.order.filter((step) => !step.startsWith("status:"))).toEqual([
      "create",
      "close",
      "save",
      "settings",
      "create",
    ]);
    expect(h.creates[1].row.websiteDomainPermissions.websites).toMatchObject([
      override,
    ]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(notice()).toHaveTextContent(
      "Browser settings saved. This tab reconnected to apply them.",
    );
    // Its own save is not answered with a second, automatic reconnect.
    await flush();
    await settle();
    expect(calls("origin_browser_create")).toHaveLength(2);
    expect(calls("origin_browser_close")).toHaveLength(1);
  });

  it("does not reconnect twice when the write is rendered before it returns", async () => {
    await openTab();
    // The shell renders that the write finished while the save that made it
    // is still on its way back to the dialog.
    h.afterWrite = () => new Promise((resolve) => setTimeout(resolve, 60));
    editPermissions();
    fireEvent.click(screen.getByRole("button", { name: "Save and reconnect" }));
    await reattached(2);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await flush();
    await settle();
    expect(h.disk[0].websiteDomainPermissions.websites).toMatchObject([
      override,
    ]);
    expect(calls("origin_browser_create")).toHaveLength(2);
    expect(calls("origin_browser_close")).toHaveLength(1);
  });

  it("reports a failed save in the dialog, keeps the edits and saves on the next try", async () => {
    const mounted = await openTab();
    h.save.mockRejectedValueOnce(new Error("disk write secret"));
    const { dialog, overrides } = editPermissions();
    fireEvent.click(screen.getByRole("button", { name: "Save and reconnect" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "The settings could not be fully saved.",
    );
    await reconnected(2);
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "This tab was restarted with what is saved now. Check database access, then save again. Your changes are still in this form.",
    );
    expect(h.disk[0].websiteDomainPermissions).toBeUndefined();
    expect(h.updateSettings).not.toHaveBeenCalled();
    expect(browserShell()).toBe(mounted);
    expect(h.statuses).not.toContain("disconnected");
    expect(screen.queryByText(/disk write secret/)).toBeNull();
    expect(screen.queryByText(/Browser settings saved/)).toBeNull();
    // The form is still open with what was entered.
    expect(dialog).toBeInTheDocument();
    expect(
      within(overrides).getByRole("combobox", { name: "Website origin" }),
    ).toHaveTextContent("https://fixture.invalid");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Save and reconnect" }),
    );
    await reattached(3);
    expect(h.disk[0].websiteDomainPermissions.websites).toMatchObject([
      override,
    ]);
    expect(h.updateSettings).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await flush();
    await settle();
    expect(calls("origin_browser_create")).toHaveLength(3);
  });

  it("saves nothing and says so when the open page cannot be closed first", async () => {
    await openTab();
    const native = h.invoke.getMockImplementation()!;
    h.invoke.mockImplementation((command, args) =>
      command === "origin_browser_close"
        ? Promise.reject(new Error("native secret"))
        : native(command, args),
    );
    const { dialog } = editPermissions();
    fireEvent.click(screen.getByRole("button", { name: "Save and reconnect" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Nothing was saved.",
    );
    expect(h.save).not.toHaveBeenCalled();
    expect(saved().websiteDomainPermissions).toBeUndefined();
    expect(h.updateSettings).not.toHaveBeenCalled();
    expect(calls("origin_browser_create")).toHaveLength(1);
    expect(screen.queryByText(/native secret/)).toBeNull();
    expect(screen.queryByText(/Browser settings saved/)).toBeNull();
    expect(screen.queryByText("Session ended")).toBeNull();
  });
});

describe("in-tab Save and reconnect when native never answers the close", () => {
  it("saves nothing, says so, and leaves the tab at Retry instead of ended", async () => {
    const mounted = await openTab();
    const native = h.invoke.getMockImplementation()!;
    h.invoke.mockImplementation((command, args) =>
      command === "origin_browser_close"
        ? new Promise(() => {})
        : native(command, args),
    );
    const { dialog, overrides } = editPermissions();
    vi.useFakeTimers();
    try {
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Save and reconnect" }),
      );
      // The hook gives one close this long, then counts it as unconfirmed.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(
          ORIGIN_BROWSER_LIFECYCLE.closeTimeoutMs + 1_000,
        );
      });
      await settle();
    } finally {
      vi.useRealTimers();
    }
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Nothing was saved.",
    );
    expect(h.save).not.toHaveBeenCalled();
    expect(saved().websiteDomainPermissions).toBeUndefined();
    expect(h.updateSettings).not.toHaveBeenCalled();
    expect(calls("origin_browser_create")).toHaveLength(1);
    // The session reads as failed, never as ended, so the tab is still there.
    expect(h.statuses.slice(2)).toEqual(["reconnecting", "error"]);
    expect(browserShell()).toBe(mounted);
    expect(screen.queryByText("Session ended")).toBeNull();
    expect(
      within(overrides).getByRole("combobox", { name: "Website origin" }),
    ).toHaveTextContent("https://fixture.invalid");
    expect(screen.queryByText(/Browser settings saved/)).toBeNull();
  });
});

describe("in-tab Save for next connection", () => {
  it("closes the page, saves both scopes, then ends the tab", async () => {
    await openTab();
    editPermissions();
    fireEvent.click(
      screen.getByRole("button", { name: "Save for next connection" }),
    );
    expect(await screen.findByText("Session ended")).toBeVisible();
    expect(h.disk[0].websiteDomainPermissions.websites).toMatchObject([
      override,
    ]);
    expect(h.updateSettings).toHaveBeenCalledOnce();
    // The tab ends only once the save has finished, and nothing reconnects.
    expect(h.order.slice(-4)).toEqual([
      "close",
      "save",
      "settings",
      "status:disconnected",
    ]);
    await flush();
    await settle();
    expect(calls("origin_browser_create")).toHaveLength(1);
  });

  it("keeps the tab and the form while a failed save is on screen", async () => {
    await openTab();
    h.save.mockRejectedValueOnce(new Error("disk write secret"));
    const { dialog, overrides } = editPermissions();
    fireEvent.click(
      screen.getByRole("button", { name: "Save for next connection" }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "The settings could not be fully saved, and this tab's page is already closed.",
    );
    await settle();
    expect(screen.queryByText("Session ended")).toBeNull();
    expect(h.statuses).not.toContain("disconnected");
    expect(h.disk[0].websiteDomainPermissions).toBeUndefined();
    expect(
      within(overrides).getByRole("combobox", { name: "Website origin" }),
    ).toHaveTextContent("https://fixture.invalid");
    // Leaving the form ends the tab whose page was already closed.
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("Session ended")).toBeVisible();
    expect(calls("origin_browser_create")).toHaveLength(1);
  });

  it("can still save and reconnect from the form after that failed save", async () => {
    const mounted = await openTab();
    h.save.mockRejectedValueOnce(new Error("disk write secret"));
    const { dialog } = editPermissions();
    fireEvent.click(
      screen.getByRole("button", { name: "Save for next connection" }),
    );
    await within(dialog).findByRole("alert");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Save and reconnect" }),
    );
    await reattached(2);
    await settle();
    // The page that was closed for the first try is replaced in the same tab.
    expect(screen.queryByText("Session ended")).toBeNull();
    expect(browserShell()).toBe(mounted);
    expect(h.statuses).not.toContain("disconnected");
    expect(h.disk[0].websiteDomainPermissions.websites).toMatchObject([
      override,
    ]);
    expect(h.updateSettings).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls("origin_browser_create")).toHaveLength(2);
  });
});

describe("in-tab session restart", () => {
  it("clears the session and reconnects in the same tab", async () => {
    const mounted = await openTab();
    fireEvent.click(
      screen.getByRole("button", { name: "More browser actions" }),
    );
    fireEvent.click(screen.getByText("Clear session…"));
    fireEvent.click(screen.getByRole("button", { name: "Clear and restart" }));
    await reattached(2);
    expect(screen.queryByText("Session ended")).toBeNull();
    expect(browserShell()).toBe(mounted);
    expect(h.statuses).toEqual([
      "connecting",
      "connected",
      "reconnecting",
      "connected",
    ]);
    expect(h.save).not.toHaveBeenCalled();
    expect(notice()).toHaveTextContent(
      "Browser session cleared. This tab reconnected with a new one.",
    );
  });
});

describe("a saved connection edited while its tab is open (K2)", () => {
  it("restarts nothing for a rename or any other presentation or display edit", async () => {
    const mounted = await openTab();
    await edit({
      name: "Renamed",
      description: "A note",
      tags: ["lab"],
      icon: "globe",
      colorTag: "red",
      tabColor: "#ff0000",
      favorite: true,
      order: 4,
      parentId: "folder-1",
      lastConnected: "2026-10-12T10:00:00.000Z",
      connectionCount: 9,
      updatedAt: "2026-10-12T10:00:00.000Z",
      httpBookmarks: [{ name: "Docs", path: "/docs" }],
      // The first display override also creates the override object.
      browserSession: { version: 1, defaultZoomPercent: 150 },
    } as Partial<Connection>);
    await flush();
    await settle();
    expect(h.disk[0].name).toBe("Renamed");
    expect(calls("origin_browser_create")).toHaveLength(1);
    expect(calls("origin_browser_close")).toHaveLength(0);
    expect(h.statuses).toEqual(["connecting", "connected"]);
    expect(browserShell()).toBe(mounted);
    expect(notice()).toBeNull();
  });

  it("restarts once for a changed port, and only after the save is flushed", async () => {
    const mounted = await openTab();
    await edit({ port: 8443 });
    await settle();
    // The row native reads still has the old port: nothing may move yet.
    expect(h.disk[0].port).toBe(443);
    expect(calls("origin_browser_create")).toHaveLength(1);
    expect(calls("origin_browser_close")).toHaveLength(0);
    expect(h.statuses).toEqual(["connecting", "connected"]);
    await flush();
    await reattached(2);
    await settle();
    expect(calls("origin_browser_create")).toHaveLength(2);
    expect(calls("origin_browser_close")).toHaveLength(1);
    expect(h.creates[1]).toMatchObject({
      initialUrl: "https://fixture.invalid:8443/",
      row: { port: 8443 },
    });
    expect(h.statuses).toEqual([
      "connecting",
      "connected",
      "reconnecting",
      "connected",
    ]);
    expect(browserShell()).toBe(mounted);
    expect(notice()).toHaveTextContent(
      "This connection's saved settings changed, so this tab reconnected to apply them.",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss reconnection notice" }),
    );
    expect(notice()).toBeNull();
  });

  it("restarts once for an edit that leaves the address alone", async () => {
    await openTab();
    await edit({ password: "second-secret" });
    await settle();
    expect(calls("origin_browser_create")).toHaveLength(1);
    await flush();
    await reattached(2);
    await settle();
    expect(calls("origin_browser_create")).toHaveLength(2);
    expect(h.creates[1].row.password).toBe("second-secret");
    expect(h.statuses).not.toContain("disconnected");
    expect(notice()).toHaveTextContent("saved settings changed");
  });

  it("does not claim the reconnect before the replacement is attached", async () => {
    await openTab();
    const native = h.invoke.getMockImplementation()!;
    let attach!: () => void;
    h.invoke.mockImplementation((command, args) =>
      command === "origin_browser_create"
        ? new Promise<void>((resolve) => {
            attach = resolve;
          }).then(() => native(command, args))
        : native(command, args),
    );
    await edit({ password: "second-secret" });
    await flush();
    await waitFor(() => expect(attach).toBeDefined());
    expect(notice()).toHaveTextContent(
      "This connection's saved settings changed. Reconnecting this tab to apply them…",
    );
    expect(notice()).not.toHaveTextContent("reconnected");
    expect(tab().status).toBe("reconnecting");
    await act(async () => attach());
    await reattached(2);
    expect(notice()).toHaveTextContent("so this tab reconnected");
  });

  it("waits for a failed save to be written before it restarts", async () => {
    await openTab();
    h.save.mockRejectedValueOnce(new Error("disk write secret"));
    await edit({ password: "second-secret" });
    await flush();
    await settle();
    expect(h.disk[0].password).toBe("first-secret");
    expect(calls("origin_browser_create")).toHaveLength(1);
    expect(calls("origin_browser_close")).toHaveLength(0);
    await flush();
    await reattached(2);
    expect(h.creates[1].row.password).toBe("second-secret");
  });

  it("shows the notice for a restart native asked for, without restarting twice", async () => {
    await openTab();
    // The wire value of BrowserSessionFailure::SourceChanged (contract K1).
    await emit(
      snapshot("attempt-1", {
        sequence: 5,
        phase: "failed",
        failureReason: "source-changed",
      }),
    );
    await reattached(2);
    await settle();
    expect(notice()).toHaveTextContent(
      "This connection's saved settings changed, so this tab reconnected to apply them.",
    );
    expect(calls("origin_browser_create")).toHaveLength(2);
    expect(h.statuses).not.toContain("disconnected");
    expect(h.statuses).not.toContain("error");
  });

  it("serves native's restart and its own with one replacement while the old page is still closing", async () => {
    await openTab();
    await edit({ password: "second-secret" });
    const native = h.invoke.getMockImplementation()!;
    let finishClose!: () => void;
    h.invoke.mockImplementation((command, args) =>
      command === "origin_browser_close"
        ? new Promise<void>((resolve) => {
            finishClose = resolve;
          })
        : native(command, args),
    );
    let finishWrite!: () => void;
    h.save.mockImplementationOnce(async (rows) => {
      h.disk = rows;
      await new Promise<void>((resolve) => {
        finishWrite = resolve;
      });
    });
    let flushing!: Promise<void>;
    act(() => {
      flushing = shell.current!.flush();
    });
    // The row is on disk and native ends the attempt for it, while the shell
    // still waits for its own write to return.
    await emit(
      snapshot("attempt-1", {
        sequence: 5,
        phase: "failed",
        failureReason: "source-changed",
      }),
    );
    await waitFor(() => expect(finishClose).toBeDefined());
    await act(async () => {
      finishWrite();
      await flushing;
    });
    await settle();
    // The shell's own request joined the restart that had not created yet.
    expect(calls("origin_browser_create")).toHaveLength(1);
    await act(async () => finishClose());
    await reattached(2);
    await settle();
    expect(calls("origin_browser_create")).toHaveLength(2);
    expect(calls("origin_browser_close")).toHaveLength(1);
    expect(h.creates[1].row.password).toBe("second-secret");
  });

  it("reconnects once more when native's replacement was up before the write was seen to finish", async () => {
    await openTab();
    await edit({ password: "second-secret" });
    let finishWrite!: () => void;
    h.save.mockImplementationOnce(async (rows) => {
      h.disk = rows;
      await new Promise<void>((resolve) => {
        finishWrite = resolve;
      });
    });
    let flushing!: Promise<void>;
    act(() => {
      flushing = shell.current!.flush();
    });
    await emit(
      snapshot("attempt-1", {
        sequence: 5,
        phase: "failed",
        failureReason: "source-changed",
      }),
    );
    await reattached(2);
    await act(async () => {
      finishWrite();
      await flushing;
    });
    // The shell cannot know which row that replacement read (the two tests
    // below are the cases where it read an older one), so it applies its own
    // write with one more restart instead of trusting it.
    await reattached(3);
    await settle();
    expect(calls("origin_browser_create")).toHaveLength(3);
    expect(h.creates[2].row.password).toBe("second-secret");
    expect(h.statuses).not.toContain("error");
    expect(tab().status).toBe("connected");
  });

  it("applies a second edit whose write lands after native restarted the tab for the first", async () => {
    await openTab();
    await edit({ password: "second-secret" });
    let finishFirst!: () => void;
    h.save.mockImplementationOnce(async (rows) => {
      h.disk = rows;
      await new Promise<void>((resolve) => {
        finishFirst = resolve;
      });
    });
    let flushing!: Promise<void>;
    act(() => {
      flushing = shell.current!.flush();
    });
    // The first write is on disk. Before the shell sees it return, the user
    // saves a second edit, and native restarts the tab for the first.
    await edit({ password: "third-secret" });
    await emit(
      snapshot("attempt-1", {
        sequence: 5,
        phase: "failed",
        failureReason: "source-changed",
      }),
    );
    await reattached(2);
    expect(h.creates[1].row.password).toBe("second-secret");
    // Now the first write returns and the second one is written after it.
    await act(async () => {
      finishFirst();
      await flushing;
    });
    expect(h.disk[0].password).toBe("third-secret");
    await reattached(3);
    await settle();
    // Exactly one further restart, and it runs from the second edit.
    expect(calls("origin_browser_create")).toHaveLength(3);
    expect(h.creates[2].row.password).toBe("third-secret");
    expect(h.statuses).not.toContain("error");
    expect(tab().status).toBe("connected");
  });

  it("applies an unwritten edit after native restarted the tab for a change the shell cannot see", async () => {
    await openTab();
    await edit({ password: "second-secret" });
    // For example a route record this connection depends on: native reports
    // the same reason, and the replacement reads the row still on disk.
    await emit(
      snapshot("attempt-1", {
        sequence: 5,
        phase: "failed",
        failureReason: "source-changed",
      }),
    );
    await reattached(2);
    expect(h.creates[1].row.password).toBe("first-secret");
    await flush();
    await reattached(3);
    await settle();
    expect(calls("origin_browser_create")).toHaveLength(3);
    expect(h.creates[2].row.password).toBe("second-secret");
    expect(h.statuses).not.toContain("error");
  });

  it("reconnects once after an extension setting is saved from the tab itself", async () => {
    const mounted = await openTab();
    fireEvent.click(screen.getByRole("button", { name: "Website extensions" }));
    const panel = await screen.findByRole("dialog", {
      name: "Native website extensions",
    });
    // What the panel promises is what the rest of this test observes.
    expect(panel).toHaveTextContent(
      "After a change is saved, this tab reconnects by itself to apply it.",
    );
    const scripts = within(panel).getByRole("checkbox", {
      name: "User scripts",
    });
    await waitFor(() => expect(scripts).toBeEnabled());
    fireEvent.click(scripts);
    await reconnected(2);
    await settle();
    expect(h.disk[0].httpAutomation.scriptInjectionEnabled).toBe(true);
    expect(h.creates[1].row.httpAutomation.scriptInjectionEnabled).toBe(true);
    expect(calls("origin_browser_create")).toHaveLength(2);
    expect(calls("origin_browser_close")).toHaveLength(1);
    expect(browserShell()).toBe(mounted);
    expect(h.statuses).toEqual([
      "connecting",
      "connected",
      "reconnecting",
      "connected",
    ]);
    expect(notice()).toHaveTextContent(
      "This connection's saved settings changed, so this tab reconnected to apply them.",
    );
    expect(screen.queryByText(/were not confirmed saved/)).toBeNull();
  });

  it("keeps the extension panel open with its saved line while the tab reconnects to apply the change", async () => {
    await openTab();
    fireEvent.click(screen.getByRole("button", { name: "Website extensions" }));
    const panel = await screen.findByRole("dialog", {
      name: "Native website extensions",
    });
    const scripts = () =>
      within(panel).getByRole("checkbox", { name: "User scripts" });
    await waitFor(() => expect(scripts()).toBeEnabled());
    expect(scripts()).not.toBeChecked();
    // The replacement stays unanswered, so the reconnect the save causes is
    // still running when the panel is looked at.
    const native = h.invoke.getMockImplementation()!;
    let attach!: () => void;
    h.invoke.mockImplementation((command, args) =>
      command === "origin_browser_create"
        ? new Promise<void>((resolve) => {
            attach = resolve;
          }).then(() => native(command, args))
        : native(command, args),
    );
    fireEvent.click(scripts());
    await waitFor(() => expect(attach).toBeDefined());
    await settle();
    expect(tab().status).toBe("reconnecting");
    const savedLine =
      "Saved to this connection. This tab now reconnects by itself to apply the change.";
    expect(panel).toBeInTheDocument();
    expect(within(panel).getByText(savedLine)).toBeVisible();
    expect(scripts()).toBeDisabled();
    expect(
      within(panel).queryByText(/unavailable while this session is blocked/),
    ).toBeNull();
    expect(within(panel).queryByRole("alert")).toBeNull();
    await act(async () => attach());
    await reconnected(2);
    // The replacement is ready for the controls again: they show the saved
    // value, and the line about a reconnect that is over is gone.
    await waitFor(() => expect(scripts()).toBeEnabled());
    expect(scripts()).toBeChecked();
    expect(panel).toBeInTheDocument();
    expect(within(panel).queryByText(savedLine)).toBeNull();
    expect(notice()).toHaveTextContent(
      "This connection's saved settings changed, so this tab reconnected to apply them.",
    );
    expect(calls("origin_browser_create")).toHaveLength(2);
  });

  it("reconnects once after the tab's appearance is saved, with a notice that is not an error", async () => {
    await openTab();
    fireEvent.click(screen.getByRole("button", { name: "Website extensions" }));
    const panel = await screen.findByRole("dialog", {
      name: "Native website extensions",
    });
    const defaults = within(panel).getByRole("checkbox", {
      name: "Use global website appearance defaults",
    });
    await waitFor(() => expect(defaults).toBeEnabled());
    fireEvent.click(defaults);
    fireEvent.click(
      within(panel).getByRole("checkbox", { name: "Follow app theme colors" }),
    );
    fireEvent.change(within(panel).getByLabelText("Background color"), {
      target: { value: "#223344" },
    });
    fireEvent.click(
      within(panel).getByRole("button", { name: "Save appearance" }),
    );
    await reconnected(2);
    await settle();
    // Native fixes the appearance when it creates a tab, so the saved one
    // reaches the page through one reconnect.
    expect(h.disk[0].httpAutomation.darkMode).toMatchObject({
      useGlobalDefaults: false,
      theme: { backgroundColor: "#223344" },
    });
    expect(h.creates[1].row.httpAutomation.darkMode).toMatchObject({
      useGlobalDefaults: false,
    });
    expect(calls("origin_browser_create")).toHaveLength(2);
    expect(calls("origin_browser_close")).toHaveLength(1);
    expect(h.statuses).not.toContain("error");
    // One calm line: a status, not an alert, and not styled as a warning.
    const line = notice()!;
    expect(line).toHaveTextContent(
      "This connection's saved settings changed, so this tab reconnected to apply them.",
    );
    expect(line).toHaveAttribute("role", "status");
    expect(line.className).not.toMatch(/sor-alert/);
    expect(screen.queryByText(/was not saved/)).toBeNull();
    expect(screen.queryByText(/were not confirmed saved/)).toBeNull();
  });

  it("toasts a recovered unreachable proxy once after a real page load, without duplicating the banner", async () => {
    await openTab();
    const native = h.invoke.getMockImplementation()!;
    h.invoke.mockImplementation(async (command, args) => {
      const result = await native(command, args);
      if (
        (command === "origin_browser_create" ||
          command === "origin_browser_status") &&
        result?.snapshot?.identity.attemptId === "attempt-2"
      )
        return { ...result, snapshot: { ...result.snapshot, loading: true } };
      return result;
    });
    await emit(
      snapshot("attempt-1", {
        sequence: 5,
        loadFailure: { code: -130, category: "proxy" },
      }),
    );
    await waitFor(() => expect(calls("origin_browser_create")).toHaveLength(2));
    await settle();
    const message = "This tab reconnected with a fresh private proxy.";
    expect(screen.queryByText(message)).toBeNull();
    await emit(
      snapshot("attempt-2", { sequence: 5, displayUrl: "about:blank" }),
    );
    await settle();
    expect(screen.queryByText(message)).toBeNull();
    await emit(snapshot("attempt-2", { sequence: 6, documentLoaded: false }));
    await settle();
    expect(screen.queryByText(message)).toBeNull();
    await emit(snapshot("attempt-2", { sequence: 7, documentLoaded: true }));
    await settle();
    await waitFor(() => expect(screen.getAllByText(message)).toHaveLength(1));
    expect(notice()).toBeNull();
    expect(
      screen.getByText(message).closest('[role="status"]'),
    ).not.toHaveAttribute("aria-label", "Browser reconnection");
    await emit(
      snapshot("attempt-2", {
        sequence: 8,
        documentLoaded: true,
        title: "Updated title",
      }),
    );
    await settle();
    expect(screen.getAllByText(message)).toHaveLength(1);
  });

  it("does not toast success when the fresh proxy still fails, and retains failure diagnostics", async () => {
    await openTab();
    const native = h.invoke.getMockImplementation()!;
    h.invoke.mockImplementation(async (command, args) => {
      const result = await native(command, args);
      if (
        (command === "origin_browser_create" ||
          command === "origin_browser_status") &&
        result?.snapshot?.identity.attemptId === "attempt-2"
      )
        return { ...result, snapshot: { ...result.snapshot, loading: true } };
      return result;
    });
    await emit(
      snapshot("attempt-1", {
        sequence: 5,
        loadFailure: { code: -130, category: "proxy" },
      }),
    );
    await waitFor(() => expect(calls("origin_browser_create")).toHaveLength(2));
    await emit(
      snapshot("attempt-2", {
        sequence: 5,
        loadFailure: { code: -130, category: "proxy" },
      }),
    );
    await settle();
    expect(
      screen.queryByText("This tab reconnected with a fresh private proxy."),
    ).toBeNull();
    expect(
      screen.getByText(/fresh private proxy could not load the website/),
    ).toBeInTheDocument();
  });

  it("says so in plain words when the tab reconnects because its private proxy stopped", async () => {
    const mounted = await openTab();
    // What native publishes when the private relay of an attached tab ends.
    await emit(
      snapshot("attempt-1", {
        sequence: 5,
        phase: "failed",
        failureReason: "private-proxy",
      }),
    );
    await reattached(2);
    await settle();
    expect(browserShell()).toBe(mounted);
    expect(calls("origin_browser_create")).toHaveLength(2);
    expect(h.statuses).toEqual([
      "connecting",
      "connected",
      "reconnecting",
      "connected",
    ]);
    const line = notice()!;
    expect(line).toHaveTextContent(
      "The app's private proxy for this tab stopped, so this tab reconnected with a new one.",
    );
    expect(line.className).not.toMatch(/sor-alert/);
  });

  it("still restarts for a written edit after the tab reconnected by itself for another reason", async () => {
    await openTab();
    await edit({ password: "second-secret" });
    // The tab's private proxy ends before the edit is written: the tab
    // reconnects by itself, and its replacement reads the row still on disk.
    await emit(
      snapshot("attempt-1", {
        sequence: 5,
        phase: "failed",
        failureReason: "private-proxy",
      }),
    );
    await reattached(2);
    expect(h.creates[1].row.password).toBe("first-secret");
    await flush();
    await reattached(3);
    await settle();
    expect(calls("origin_browser_create")).toHaveLength(3);
    expect(h.creates[2].row.password).toBe("second-secret");
    expect(h.statuses).not.toContain("error");
    expect(notice()).toHaveTextContent(
      "This connection's saved settings changed, so this tab reconnected to apply them.",
    );
  });

  it("leaves a failed tab to its Retry instead of starting it again", async () => {
    await openTab();
    await emit(
      snapshot("attempt-1", {
        sequence: 5,
        phase: "failed",
        failureReason: "renderer",
      }),
    );
    await waitFor(() => expect(tab().status).toBe("error"));
    await edit({ password: "second-secret" });
    await flush();
    await settle();
    expect(calls("origin_browser_create")).toHaveLength(1);
    expect(notice()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry browser" }));
    await reattached(2);
    expect(h.creates[1].row.password).toBe("second-secret");
  });
});

describe("a saved host or scheme edited while its tab is open", () => {
  it("makes the session row and the new attempt follow the saved host", async () => {
    await openTab();
    await edit({ hostname: "renamed.invalid" });
    await flush();
    await reattached(2);
    await settle();
    expect(calls("origin_browser_create")).toHaveLength(2);
    expect(h.creates[1].initialUrl).toBe("https://renamed.invalid/");
    expect(tab()).toMatchObject({
      hostname: "renamed.invalid",
      protocol: "https",
      status: "connected",
    });
    expect(h.statuses).not.toContain("error");
  });

  it("makes the session row and the new attempt follow the saved scheme", async () => {
    await openTab();
    await edit({ protocol: "http", port: 80 });
    await flush();
    await reattached(2);
    await settle();
    expect(calls("origin_browser_create")).toHaveLength(2);
    expect(h.creates[1].initialUrl).toBe("http://fixture.invalid/");
    expect(tab()).toMatchObject({
      hostname: "fixture.invalid",
      protocol: "http",
    });
  });

  it("explains a connection that is no longer a website instead of retrying it", async () => {
    await openTab();
    await edit({ protocol: "ssh", port: 22 });
    await flush();
    await settle();
    expect(
      await screen.findByText(
        /This saved connection is no longer a website connection/,
      ),
    ).toBeVisible();
    // The row keeps its web scheme so the tab stays mounted to say so.
    expect(tab().protocol).toBe("https");
    expect(calls("origin_browser_create")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Retry browser" }),
    ).toBeDisabled();
  });
});

describe("an extension setting saved from the tab it reconnects", () => {
  const identity = {
    ownerDatabaseId: "database-1",
    connectionId: "connection-1",
    sessionId: "tab-1",
    attemptId: "attempt-1",
  };
  /** The hook alone, with a confirmation read the test can hold open. */
  function extensions() {
    let rows = [row];
    let locked = false;
    let holdReads = false;
    const reads: Array<() => void> = [];
    h.manager.captureCurrentDatabaseDataTarget = () => ({
      databaseId: "database-1",
      assertAccessible: () => {
        if (locked) throw new Error("locked");
      },
      readCurrent: async () => {
        if (holdReads)
          await new Promise<void>((resolve) => {
            reads.push(resolve);
          });
        return { connections: structuredClone(h.disk) };
      },
    });
    const updateConnection = vi.fn(async (connection: Connection) => {
      rows = [connection];
      h.disk = rows;
      holdReads = true;
    });
    const receipt = {
      version: 1,
      identity,
      appControls: true,
      appEnabled: true,
      forcedDark: true,
      chromium: "unsupportedPrivateContext",
    } as const;
    let props: NativeBrowserExtensionsOptions = {
      connection: row,
      ownerDatabaseId: "database-1",
      identity,
      receipt,
      webBrowserSettings: undefined,
      settingsReady: true,
      blocked: false,
      updateConnection,
    };
    const hook = renderHook(() => useNativeBrowserExtensions(props), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <ConnectionContext.Provider
          value={
            {
              state: { connections: rows },
              databaseAvailability: {
                status: "ready",
                databaseId: "database-1",
                generation: 1,
              },
              getCurrentConnections: () => rows,
            } as unknown as ConnectionContextType
          }
        >
          {children}
        </ConnectionContext.Provider>
      ),
    });
    return {
      hook,
      updateConnection,
      waitingReads: () => reads.length,
      /** The write is on disk, so the tab reconnects to apply it: the attempt
       * this save started from is gone before the save is confirmed. */
      reconnect() {
        props = {
          ...props,
          connection: rows[0],
          identity: null,
          receipt: null,
          blocked: true,
        };
        hook.rerender();
      },
      lock() {
        locked = true;
      },
      confirm: () => reads.splice(0).forEach((resolve) => resolve()),
      /** The attempt that replaced the saving one is ready for the controls. */
      attach(attemptId: string) {
        const next = { ...identity, attemptId };
        props = {
          ...props,
          connection: rows[0],
          identity: next,
          receipt: { ...receipt, identity: next },
          blocked: false,
        };
        hook.rerender();
      },
      /** The same controls are handed another saved connection, whose own
       * tab is still starting unless `attached`. */
      other(attached = false) {
        const next = { ...identity, connectionId: "connection-2" };
        rows = [{ ...rows[0], id: next.connectionId }];
        props = {
          ...props,
          connection: rows[0],
          identity: attached ? next : null,
          receipt: attached ? { ...receipt, identity: next } : null,
          blocked: !attached,
        };
        hook.rerender();
      },
    };
  }
  async function saveThenReconnect(t: ReturnType<typeof extensions>) {
    let pending!: Promise<boolean>;
    act(() => {
      pending = t.hook.result.current.save({ kind: "scripts", enabled: true });
    });
    await waitFor(() => expect(t.waitingReads()).toBe(1));
    expect(t.updateConnection).toHaveBeenCalledOnce();
    expect(h.disk[0].httpAutomation.scriptInjectionEnabled).toBe(true);
    t.reconnect();
    expect(t.hook.result.current.available).toBe(false);
    // Wrapped: returning the promise itself would wait for the save here.
    return { pending };
  }

  it("confirms the save although the attempt it started from was replaced", async () => {
    const t = extensions();
    const { pending } = await saveThenReconnect(t);
    let saved = false;
    await act(async () => {
      t.confirm();
      saved = await pending;
    });
    expect(saved).toBe(true);
    // The line about the save outlives the attempt the save started from ...
    expect(t.hook.result.current.saved).toBe(true);
    expect(t.hook.result.current.error).toBeUndefined();
    // ... and goes once the attempt that replaced it is ready: it is applied.
    t.attach("attempt-2");
    expect(t.hook.result.current.available).toBe(true);
    expect(t.hook.result.current.saved).toBe(false);
  });

  it("shows neither line for another connection", async () => {
    const t = extensions();
    const { pending } = await saveThenReconnect(t);
    await act(async () => {
      t.confirm();
      await pending;
    });
    expect(t.hook.result.current.saved).toBe(true);
    // Not that connection's save, although its tab is not ready either.
    t.other();
    expect(t.hook.result.current.available).toBe(false);
    expect(t.hook.result.current.saved).toBe(false);
    expect(t.hook.result.current.error).toBeUndefined();
    t.other(true);
    expect(t.hook.result.current.available).toBe(true);
    expect(t.hook.result.current.saved).toBe(false);
  });

  it("still refuses to confirm once the owning database is locked", async () => {
    const t = extensions();
    const { pending } = await saveThenReconnect(t);
    t.lock();
    let saved = true;
    await act(async () => {
      t.confirm();
      saved = await pending;
    });
    expect(saved).toBe(false);
    // The failure is said, although the tab is already reconnecting.
    expect(t.hook.result.current.saved).toBe(false);
    expect(t.hook.result.current.error).toMatch(/were not confirmed saved/);
    // It does not follow the controls to another connection either.
    t.other();
    expect(t.hook.result.current.error).toBeUndefined();
  });
});
