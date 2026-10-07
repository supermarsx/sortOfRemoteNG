import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import type { OriginBrowserSnapshot } from "../../src/types/protocols/originBrowser";

const f = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  legacy: vi.fn(),
  settings: {} as any,
  context: {} as any,
  manager: {} as any,
  active: true,
  settingsReady: true,
  updateSettings: vi.fn(),
  accessListeners: [] as Array<(event: any) => void>,
  currentListeners: [] as Array<() => void>,
  snapshotListener: null as null | ((event: any) => void),
  noticeListener: null as null | ((event: any) => void),
  revoked: false,
  serial: 0,
  clipboard: vi.fn(),
  automationLibrary: { version: 1, scripts: [] as any[], macros: [] as any[] },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: f.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: f.listen }));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => f.context,
}));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({
    settings: f.settings,
    settingsReady: f.settingsReady,
    updateSettings: f.updateSettings,
  }),
}));
vi.mock("../../src/contexts/SessionRenderActivityContext", () => ({
  useSessionRenderActivity: () => ({ isActive: f.active }),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: { getInstance: () => f.manager },
  onDatabaseAccessChange: (listener: (event: any) => void) =>
    f.manager.onDatabaseAccessChange(listener),
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => null,
}));
vi.mock("../../src/utils/recording/webAutomationLibrary", async (original) => ({
  ...(await original<
    typeof import("../../src/utils/recording/webAutomationLibrary")
  >()),
  webAutomationStore: { load: async () => ({ value: f.automationLibrary }) },
}));
vi.mock("../../src/hooks/protocol/useWebBrowser", () => ({
  useWebBrowser: f.legacy,
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
  default: () => <p>Legacy content</p>,
}));
vi.mock("../../src/components/protocol/webBrowser/BrowserDialogs", () => ({
  default: () => null,
}));

import { WebBrowser } from "../../src/components/protocol/WebBrowser";
import { SessionViewer } from "../../src/components/session/SessionViewer";
import { normalizeWebBrowserSettings } from "../../src/utils/settings/webBrowserSettings";

const session = {
  id: "tab-1",
  connectionId: "connection-1",
  ownerDatabaseId: "database-1",
  protocol: "https",
  hostname: "fixture.invalid",
  name: "Fixture",
} as ConnectionSession;
const connection = {
  id: session.connectionId,
  hostname: session.hostname,
  protocol: "https",
  port: 443,
  name: "Fixture",
} as Connection;
const snapshot = (
  attemptId = "attempt-1",
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
beforeEach(() => {
  f.clipboard.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: f.clipboard },
  });
  f.revoked = false;
  f.serial = 0;
  f.automationLibrary = { version: 1, scripts: [], macros: [] };
  f.active = true;
  f.settingsReady = true;
  f.noticeListener = null;
  f.accessListeners = [];
  f.currentListeners = [];
  f.settings = {
    webBrowser: normalizeWebBrowserSettings({ engine: "real-origin" }),
  };
  f.context = {
    state: { connections: [connection] },
    databaseAvailability: {
      status: "ready",
      databaseId: "database-1",
      generation: 1,
    },
    getCurrentConnections: vi.fn(() => f.context.state.connections),
    dispatchAndFlush: vi.fn(async (action: any) => {
      f.context.state.connections = [action.payload];
    }),
  };
  const assertCurrent = () => {
    if (f.revoked) throw new Error("locked");
  };
  f.manager = {
    getCurrentDatabase: () => ({ id: "database-1" }),
    captureCurrentDatabaseDataTarget: () => ({
      databaseId: "database-1",
      assertAccessible: assertCurrent,
    }),
    captureOriginBrowserOwnerProof: () => ({
      ownerDatabaseId: "database-1",
      expectedSecurityRevision: "revision-1",
      sourceSessionId: "unlock-1",
      assertCurrent,
    }),
    onCurrentDatabaseChange: (callback: () => void) => {
      f.currentListeners.push(callback);
      return vi.fn();
    },
    onDatabaseAccessChange: (callback: (event: any) => void) => {
      f.accessListeners.push(callback);
      return vi.fn();
    },
  };
  f.listen.mockImplementation(async (name, callback) => {
    if (name === "origin-browser-state") f.snapshotListener = callback;
    if (name === "origin-browser-notice") f.noticeListener = callback;
    return vi.fn();
  });
  f.invoke.mockImplementation(async (command, { request }) => {
    if (command === "origin_browser_automation") {
      const operation = request.operation;
      // Mirror the canonical envelope rather than ACKing arbitrary renderer
      // payloads; otherwise an obsolete frontend DTO can make this gate pass.
      if (
        Object.keys(request).some(
          (key) => !["identity", "operation"].includes(key),
        ) ||
        !request.identity ||
        !operation ||
        ![
          "document",
          "script",
          "step",
          "recordStart",
          "recordStop",
          "cancel",
        ].includes(operation.action)
      )
        throw new Error("Invalid automation fixture envelope");
      if (
        operation.action === "document" &&
        Object.keys(operation).length !== 1
      )
        throw new Error("Invalid automation document request");
      if (operation.action !== "document") {
        const fields = [
          "action",
          "documentToken",
          "origin",
          "requestId",
          ...(operation.action === "script"
            ? ["code"]
            : operation.action === "step"
              ? ["step", "value"]
              : []),
        ];
        if (
          Object.keys(operation).some((key) => !fields.includes(key)) ||
          operation.documentToken !== `doc-${request.identity.attemptId}` ||
          operation.origin !== "https://fixture.invalid" ||
          typeof operation.requestId !== "string" ||
          !/^[A-Za-z0-9_:-]{1,128}$/.test(operation.requestId) ||
          (operation.action === "script" && typeof operation.code !== "string")
        )
          throw new Error("Invalid automation mutation receipt");
      }
      if (operation.action === "document")
        return {
          status: "document",
          documentToken: `doc-${request.identity.attemptId}`,
          origin: "https://fixture.invalid",
        };
      if (operation.action === "recordStop")
        return {
          status: "recordingStopped",
          requestId: operation.requestId,
          steps: [
            { kind: "click", selector: "html > body > button:nth-of-type(1)" },
          ],
          truncated: false,
        };
      return { status: "completed", requestId: operation.requestId };
    }
    if (command === "origin_browser_status")
      return {
        capability: { availability: "available" },
        snapshot: request.identity
          ? snapshot(request.identity.attemptId)
          : null,
      };
    if (command === "origin_browser_create")
      return {
        requestId: request.requestId,
        snapshot: snapshot(`attempt-${++f.serial}`),
      };
  });
  f.legacy.mockReturnValue({ browserSettings: { showBookmarksBar: false } });
  f.updateSettings.mockResolvedValue(undefined);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const calls = (name: string) =>
  f.invoke.mock.calls.filter(([command]) => command === name);
async function attached() {
  const view = render(<WebBrowser session={session} />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Reload" })).toBeEnabled(),
  );
  return view;
}

describe("real-origin connection-tab integration", () => {
  it("handles native document timeout with a scoped Reload action even when loading presentation is hidden", async () => {
    f.context.state.connections = [
      {
        ...connection,
        browserSession: { version: 1, showLoadingProgress: false },
      },
    ];
    await attached();
    await waitFor(() => expect(f.noticeListener).not.toBeNull());
    act(() =>
      f.noticeListener?.({
        payload: {
          identity: snapshot().identity,
          kind: "document-load-timeout",
          url: "https://private.invalid/?token=SECRET",
        },
      }),
    );
    expect(
      screen.getByRole("status", { name: "Browser notifications" }),
    ).toHaveTextContent("Loading was stopped");
    expect(
      screen.getByRole("status", { name: "Browser notifications" }),
    ).not.toHaveTextContent(/SECRET|private/);
    fireEvent.click(screen.getByRole("button", { name: "Reload page" }));
    await waitFor(() =>
      expect(
        calls("origin_browser_control").filter(
          ([, args]) => args.request.action.kind === "reload",
        ),
      ).toHaveLength(1),
    );
    expect(
      calls("origin_browser_control").find(
        ([, args]) => args.request.action.kind === "reload",
      )?.[1].request.identity,
    ).toEqual(snapshot().identity);
    await waitFor(() =>
      expect(
        screen.queryByRole("status", { name: "Browser notifications" }),
      ).toBeNull(),
    );
  });
  it("does not retarget timeout notices after reconnect", async () => {
    await attached();
    await waitFor(() => expect(f.noticeListener).not.toBeNull());
    const old = f.noticeListener!;
    act(() =>
      old({
        payload: {
          identity: snapshot().identity,
          kind: "document-load-timeout",
        },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    await waitFor(() => expect(calls("origin_browser_create")).toHaveLength(2));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Reload" })).toBeEnabled(),
    );
    act(() =>
      old({
        payload: {
          identity: snapshot().identity,
          kind: "document-load-timeout",
        },
      }),
    );
    act(() =>
      f.noticeListener?.({
        payload: {
          identity: snapshot().identity,
          kind: "document-load-timeout",
        },
      }),
    );
    expect(
      screen.queryByRole("status", { name: "Browser notifications" }),
    ).toBeNull();
    expect(
      calls("origin_browser_control").filter(
        ([, args]) => args.request.action.kind === "reload",
      ),
    ).toHaveLength(0);
  });
  it("rejects obsolete automation envelopes and documentId in the mounted IPC fixture", async () => {
    for (const request of [
      {
        identity: snapshot().identity,
        operation: { kind: "script", code: "document.title" },
      },
      {
        identity: snapshot().identity,
        expectedDocumentId: "old",
        expectedOrigin: "https://fixture.invalid",
        requestId: "old",
        operation: { kind: "script", code: "document.title" },
      },
      {
        identity: snapshot().identity,
        operation: {
          action: "script",
          documentId: "doc-attempt-1",
          origin: "https://fixture.invalid",
          requestId: "old",
          code: "document.title",
        },
      },
      {
        identity: snapshot().identity,
        operation: { action: "document", documentToken: "renderer-supplied" },
      },
    ])
      await expect(
        f.invoke("origin_browser_automation", { request }),
      ).rejects.toThrow("Invalid automation");
  });
  const enableAutomation = () => {
    f.settings.sessionQuickActions = {
      httpEnabled: true,
      sshEnabled: true,
      allowWebMacros: true,
      allowWebScriptInjection: true,
      allowWebForceDark: true,
      confirmBeforeScriptRun: true,
    };
    f.settings.macros = { confirmBeforeReplay: true };
    f.context.state.connections = [
      {
        ...connection,
        httpAutomation: {
          version: 1,
          scriptInjectionEnabled: true,
          interactionMacrosEnabled: true,
          forceDark: true,
          items: [{ kind: "script", id: "native-script" }],
        },
      },
    ];
    f.automationLibrary.scripts = [
      {
        kind: "script",
        id: "native-script",
        name: "Mounted native script",
        description: "",
        code: "document.title",
        createdAt: "2026-10-07T00:00:00Z",
        updatedAt: "2026-10-07T00:00:00Z",
      },
    ];
  };
  it.each(["script", "macro"] as const)(
    "opens the %s assignment library from the native bookmark menu without executing",
    async (kind) => {
      enableAutomation();
      await attached();
      await waitFor(() =>
        expect(
          screen.getByRole("button", {
            name: "Website macros & JavaScript library",
          }),
        ).toBeEnabled(),
      );
      fireEvent.click(screen.getByRole("button", { name: "Manage bookmarks" }));
      fireEvent.click(screen.getByRole("menuitem", { name: `Assign ${kind}` }));
      const library = await screen.findByRole("dialog", {
        name: "Website automation library",
      });
      expect(screen.queryByRole("menu")).toBeNull();
      expect(
        within(library).getByRole("combobox", { name: "Item type" }),
      ).toHaveValue(kind);
      expect(screen.getByRole("button", { name: "Reload" })).toBeDisabled();
      expect(
        calls("origin_browser_automation").filter(
          ([, args]) => args.request.operation.action !== "document",
        ),
      ).toHaveLength(0);
      fireEvent.click(
        within(library).getByRole("button", { name: "Close library" }),
      );
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Reload" })).toBeEnabled(),
      );
    },
  );
  it.each([true, false])(
    "mounts actual native automation with bookmarks visible=%s and preserves confirmation across its own overlay",
    async (showBookmarksBar) => {
      enableAutomation();
      f.settings.webBrowser.showBookmarksBar = showBookmarksBar;
      await attached();
      expect(screen.getAllByTestId("origin-automation-controls")).toHaveLength(
        1,
      );
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Mounted native script" }),
        ).toBeEnabled(),
      );
      const getter = calls("origin_browser_automation").find(
        ([, args]) => args.request.operation.action === "document",
      );
      expect(getter?.[1].request).toEqual({
        identity: snapshot().identity,
        operation: { action: "document" },
      });
      fireEvent.click(
        screen.getByRole("button", { name: "Mounted native script" }),
      );
      const confirm = await screen.findByRole("button", {
        name: "Run on current page",
      });
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Reload" })).toBeDisabled(),
      );
      expect(confirm).toBeEnabled();
      expect(
        calls("origin_browser_automation").filter(
          ([, args]) => args.request.operation.action === "script",
        ),
      ).toHaveLength(0);
      fireEvent.click(confirm);
      await waitFor(() =>
        expect(
          calls("origin_browser_automation").some(
            ([, args]) => args.request.operation.action === "script",
          ),
        ).toBe(true),
      );
      const dispatched = calls("origin_browser_automation").find(
        ([, args]) => args.request.operation.action === "script",
      )![1].request;
      expect(dispatched).toMatchObject({
        identity: snapshot().identity,
        operation: {
          action: "script",
          documentToken: "doc-attempt-1",
          origin: "https://fixture.invalid",
          code: "document.title",
        },
      });
      expect(screen.getByText(/completion is unverified/)).toBeVisible();
      expect(f.legacy).not.toHaveBeenCalled();
      expect(document.querySelector("iframe")).toBeNull();
    },
  );
  it("assigns and removes a script favorite through mounted menus while preserving bookmarks", async () => {
    enableAutomation();
    f.context.state.connections[0].httpAutomation.items = [];
    f.context.state.connections[0].httpBookmarks = [
      { name: "Saved bookmark", path: "/saved" },
    ];
    const view = await attached();
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Website macros & JavaScript library",
        }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Manage bookmarks" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Assign script" }));
    const library = await screen.findByRole("dialog", {
      name: "Website automation library",
    });
    fireEvent.click(
      within(library).getByRole("button", {
        name: "JS · Mounted native script · App-wide",
      }),
    );
    fireEvent.click(
      within(library).getByRole("button", { name: "Add to favorites" }),
    );
    await waitFor(() =>
      expect(f.context.dispatchAndFlush).toHaveBeenCalledOnce(),
    );
    expect(f.context.state.connections[0].httpAutomation.items).toEqual([
      { kind: "script", id: "native-script" },
    ]);
    expect(f.context.state.connections[0].httpBookmarks).toEqual([
      { name: "Saved bookmark", path: "/saved" },
    ]);
    view.rerender(<WebBrowser session={session} />);
    fireEvent.click(
      within(library).getByRole("button", { name: "Close library" }),
    );
    const favorite = await screen.findByRole("button", {
      name: "Mounted native script",
    });
    await waitFor(() => expect(favorite).toBeEnabled());
    fireEvent.keyDown(favorite, { key: "F10", shiftKey: true });
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove favorite" }));
    await waitFor(() =>
      expect(f.context.dispatchAndFlush).toHaveBeenCalledTimes(2),
    );
    expect(f.context.state.connections[0].httpAutomation.items).toEqual([]);
    for (const [, args] of calls("origin_browser_automation"))
      expect(args.request.operation.action).toMatch(/^(document|cancel)$/);
  });
  it("records through native Stop batch and reviews structural steps without an event stream", async () => {
    enableAutomation();
    await attached();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Record macro" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Record macro" }));
    const stop = await screen.findByRole("button", {
      name: "Stop recording and review macro",
    });
    expect(screen.getByText(/there is no live step count/)).toBeVisible();
    fireEvent.click(stop);
    await screen.findByRole("dialog", { name: "Website automation library" });
    expect(
      calls("origin_browser_automation").some(
        ([, args]) => args.request.operation.action === "recordStop",
      ),
    ).toBe(true);
    expect(screen.getByText(/html > body > button:nth-of-type/)).toBeVisible();
    expect(
      f.listen.mock.calls.some(
        ([event]) => event === "origin-browser-automation",
      ),
    ).toBe(false);
  });
  it("does not run a reviewed script after owner revocation", async () => {
    enableAutomation();
    const view = await attached();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Mounted native script" }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Mounted native script" }),
    );
    await screen.findByRole("button", { name: "Run on current page" });
    f.revoked = true;
    view.rerender(<WebBrowser session={session} />);
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Run on current page" }),
      ).toBeNull(),
    );
    expect(
      calls("origin_browser_automation").filter(
        ([, args]) => args.request.operation.action === "script",
      ),
    ).toHaveLength(0);
  });
  it.each(["success", "failure"])(
    "fences delayed clipboard %s to the menu opening that requested it",
    async (outcome) => {
      await attached();
      act(() =>
        f.snapshotListener?.({
          payload: snapshot("attempt-1", {
            sequence: 2,
            currentUrl: "https://fixture.invalid/?token=copy",
          }),
        }),
      );
      let finish!: () => void;
      f.clipboard.mockImplementationOnce(
        () =>
          new Promise<void>((resolve, reject) => {
            finish = () =>
              outcome === "success"
                ? resolve()
                : reject(new Error("old failure"));
          }),
      );
      const toggle = screen.getByRole("button", {
        name: "More browser actions",
      });
      fireEvent.click(toggle);
      fireEvent.click(
        screen.getByRole("menuitem", { name: "Copy current address" }),
      );
      expect(f.clipboard).toHaveBeenCalledTimes(1);
      fireEvent.click(toggle);
      await waitFor(() => expect(toggle).toBeEnabled());
      fireEvent.click(toggle);
      const reopened = screen.getByRole("menu", {
        name: "More browser actions",
      });
      await act(async () => finish());
      expect(within(reopened).queryByRole("status")).toBeNull();
      expect(
        screen.queryByText(
          /Address copied\.|Could not copy the current address\./,
        ),
      ).toBeNull();
      const copy = within(reopened).getByRole("menuitem", {
        name: "Copy current address",
      });
      expect(copy).toBeEnabled();
      fireEvent.click(copy);
      await waitFor(() =>
        expect(within(reopened).getByRole("status")).toHaveTextContent(
          "Address copied.",
        ),
      );
      expect(f.clipboard).toHaveBeenCalledTimes(2);
    },
  );
  it("keeps the clipboard warning inside More and shell menu actions enabled while native is hidden", async () => {
    await attached();
    act(() =>
      f.snapshotListener?.({
        payload: snapshot("attempt-1", {
          sequence: 2,
          currentUrl: "https://fixture.invalid/?private=value",
        }),
      }),
    );
    const warning = /Copying includes sensitive query and fragment values/;
    expect(screen.queryByText(warning)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "More browser actions" }),
    );
    const menu = screen.getByRole("menu", { name: "More browser actions" });
    expect(within(menu).getByText(warning)).toBeVisible();
    expect(screen.getByRole("button", { name: "Reload" })).toBeDisabled();
    for (const name of [
      "Copy current address",
      "Open in system browser…",
      "Clear session…",
      "Copy credentials…",
    ])
      expect(within(menu).getByRole("menuitem", { name })).toBeEnabled();
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: "Open in system browser…" }),
    );
    expect(screen.queryByText(warning)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Open in system browser" }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reload" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Reload" })).toBeEnabled(),
    );
    expect(screen.queryByText(warning)).toBeNull();
  });
  it("uses a compact page title and policy tooltip, with unsupported actions only in the themed More menu", async () => {
    await attached();
    expect(
      screen.queryByText(/Native browser attached|Required policy:/),
    ).toBeNull();
    expect(screen.getByLabelText("Browser policy")).toHaveAttribute(
      "data-tooltip",
      expect.stringContaining("Forced dark"),
    );
    const trigger = screen.getByRole("button", {
      name: "More browser actions",
    });
    expect(trigger).toHaveClass("sor-btn", "sor-icon-btn-sm");
    expect(trigger).toHaveAttribute("data-tooltip", "More browser actions");
    expect(trigger).not.toHaveAttribute("title");
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu", { name: "More browser actions" });
    expect(menu).toHaveClass("sor-menu-surface");
    for (const name of ["Print", "Downloads", "History menu", "Recording"])
      expect(within(menu).getByRole("menuitem", { name })).toBeDisabled();
    const presentations = calls("origin_browser_control").filter(
      ([, args]) => args.request.action.kind === "presentation",
    );
    expect(presentations.slice(-1)[0][1].request.action.visible).toBe(false);
    expect(screen.getByRole("button", { name: "Reload" })).toBeDisabled();
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Reload" })).toBeEnabled(),
    );
  });
  it("copies only the full native address, never the edited or diagnostic address", async () => {
    await attached();
    fireEvent.click(
      screen.getByRole("button", { name: "More browser actions" }),
    );
    expect(
      screen.getByRole("menuitem", { name: "Copy current address" }),
    ).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    const url = "https://fixture.invalid/path?token=sensitive#fragment";
    act(() =>
      f.snapshotListener?.({
        payload: snapshot("attempt-1", { sequence: 2, currentUrl: url }),
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "Website address" }),
      ).toBeEnabled(),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Website address" }), {
      target: { value: "https://draft.invalid/" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "More browser actions" }),
    );
    const menu = screen.getByRole("menu");
    expect(menu).not.toHaveTextContent(url);
    fireEvent.click(within(menu).getByText("Copy current address"));
    await waitFor(() =>
      expect(f.clipboard).toHaveBeenCalledExactlyOnceWith(url),
    );
    expect(f.updateSettings).not.toHaveBeenCalled();
    expect(f.context.dispatchAndFlush).not.toHaveBeenCalled();
  });
  it("reviews external opening with full query and route warnings, and uses only the app opener", async () => {
    await attached();
    const url = "https://fixture.invalid/?token=external-secret#part";
    act(() =>
      f.snapshotListener?.({
        payload: snapshot("attempt-1", { sequence: 2, currentUrl: url }),
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "More browser actions" }),
    );
    fireEvent.click(screen.getByText("Open in system browser…"));
    const dialog = screen.getByRole("dialog", {
      name: "Open in system browser?",
    });
    expect(dialog).toHaveTextContent(url);
    expect(dialog).toHaveTextContent("outside this app's private proxy route");
    expect(dialog).toHaveTextContent("sensitive query or fragment");
    expect(calls("open_url_external")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Reload" })).toBeDisabled();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Open in system browser" }),
    );
    await waitFor(() =>
      expect(calls("open_url_external")).toEqual([
        ["open_url_external", { url }],
      ]),
    );
    expect(f.clipboard).not.toHaveBeenCalled();
  });
  it.each(["url", "owner", "inactive"])(
    "revokes external review on %s change and fences stale confirmation",
    async (change) => {
      const view = await attached();
      act(() =>
        f.snapshotListener?.({
          payload: snapshot("attempt-1", {
            sequence: 2,
            currentUrl: "https://fixture.invalid/?secret=first",
          }),
        }),
      );
      fireEvent.click(
        screen.getByRole("button", { name: "More browser actions" }),
      );
      fireEvent.click(screen.getByText("Open in system browser…"));
      const confirm = screen.getByRole("button", {
        name: "Open in system browser",
      });
      act(() => {
        if (change === "url")
          f.snapshotListener?.({
            payload: snapshot("attempt-1", {
              sequence: 3,
              currentUrl: "https://fixture.invalid/?secret=second",
            }),
          });
        else if (change === "owner") {
          f.revoked = true;
          f.accessListeners.forEach((callback) =>
            callback({ databaseId: "database-1", status: "suspended" }),
          );
        } else f.active = false;
      });
      view.rerender(<WebBrowser session={session} />);
      expect(
        screen.queryByRole("dialog", { name: "Open in system browser?" }),
      ).toBeNull();
      fireEvent.click(confirm);
      expect(calls("open_url_external")).toHaveLength(0);
    },
  );
  it("confirms ephemeral clear and waits for close acknowledgement before recreating", async () => {
    await attached();
    let finish!: () => void;
    const original = f.invoke.getMockImplementation()!;
    f.invoke.mockImplementation((command, args) =>
      command === "origin_browser_close"
        ? new Promise<void>((resolve) => {
            finish = resolve;
          })
        : original(command, args),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "More browser actions" }),
    );
    fireEvent.click(screen.getByText("Clear session…"));
    const dialog = screen.getByRole("dialog", {
      name: "Clear this browser session?",
    });
    expect(dialog).toHaveTextContent("new ephemeral browser context");
    expect(dialog).toHaveTextContent(
      "does not delete persistent browser profiles",
    );
    expect(calls("origin_browser_close")).toHaveLength(0);
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Clear and restart" }),
    );
    await waitFor(() => expect(calls("origin_browser_close")).toHaveLength(1));
    expect(calls("origin_browser_create")).toHaveLength(1);
    await act(async () => finish());
    await waitFor(() => expect(calls("origin_browser_create")).toHaveLength(2));
    expect(
      calls("origin_browser_create")[1][1].request.policy.autoLogin.consent,
    ).toEqual({ kind: "required" });
    expect(f.context.dispatchAndFlush).not.toHaveBeenCalled();
  });
  it("mounts scoped copy-only credentials and removes the panel on owner loss", async () => {
    await attached();
    fireEvent.click(
      screen.getByRole("button", { name: "More browser actions" }),
    );
    fireEvent.click(screen.getByText("Copy credentials…"));
    const dialog = screen.getByRole("dialog", {
      name: "Copy connection credentials",
    });
    expect(
      within(dialog).getByRole("button", { name: "Copy username" }),
    ).toHaveAttribute("data-tooltip", "Copy username");
    expect(
      within(dialog).getByRole("button", { name: "Copy password" }),
    ).not.toHaveAttribute("title");
    expect(within(dialog).queryByRole("button", { name: /Type/ })).toBeNull();
    expect(f.clipboard).not.toHaveBeenCalled();
    act(() => {
      f.revoked = true;
      f.accessListeners.forEach((callback) =>
        callback({ databaseId: "database-1", status: "suspended" }),
      );
    });
    expect(
      screen.queryByRole("dialog", { name: "Copy connection credentials" }),
    ).toBeNull();
  });
  it("copies a freshly resolved credential through the existing owner-scoped hook, not page state", async () => {
    const capture = f.manager.captureCurrentDatabaseDataTarget;
    f.manager.captureCurrentDatabaseDataTarget = () => ({
      ...capture(),
      verifyCurrent: async () => {},
      readCurrent: async () => ({
        connections: [
          {
            ...connection,
            basicAuthUsername: "fresh-user",
            basicAuthPassword: "fresh-secret",
          },
        ],
      }),
    });
    await attached();
    fireEvent.click(
      screen.getByRole("button", { name: "More browser actions" }),
    );
    fireEvent.click(screen.getByText("Copy credentials…"));
    expect(f.clipboard).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Copy password" }));
    await waitFor(() =>
      expect(f.clipboard).toHaveBeenCalledExactlyOnceWith("fresh-secret"),
    );
    expect(screen.queryByText("fresh-secret")).toBeNull();
    expect(f.updateSettings).not.toHaveBeenCalled();
  });
  it("does not recreate an ephemeral context after owner revocation during close", async () => {
    await attached();
    let finish!: () => void;
    const original = f.invoke.getMockImplementation()!;
    f.invoke.mockImplementation((command, args) =>
      command === "origin_browser_close"
        ? new Promise<void>((resolve) => {
            finish = resolve;
          })
        : original(command, args),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "More browser actions" }),
    );
    fireEvent.click(screen.getByText("Clear session…"));
    fireEvent.click(screen.getByRole("button", { name: "Clear and restart" }));
    await waitFor(() => expect(finish).toBeDefined());
    act(() => {
      f.revoked = true;
      f.accessListeners.forEach((callback) =>
        callback({ databaseId: "database-1", status: "suspended" }),
      );
    });
    await act(async () => finish());
    expect(calls("origin_browser_create")).toHaveLength(1);
  });
  it("sanitizes opener errors without fallback and rechecks owner before clipboard access", async () => {
    await attached();
    act(() =>
      f.snapshotListener?.({
        payload: snapshot("attempt-1", {
          sequence: 2,
          currentUrl: "https://fixture.invalid/?token=private",
        }),
      }),
    );
    const fallback = vi.spyOn(window, "open").mockImplementation(() => null);
    const original = f.invoke.getMockImplementation()!;
    f.invoke.mockImplementation((command, args) =>
      command === "open_url_external"
        ? Promise.reject(new Error("SECRET_NATIVE_ERROR"))
        : original(command, args),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "More browser actions" }),
    );
    fireEvent.click(screen.getByText("Open in system browser…"));
    fireEvent.click(
      screen.getByRole("button", { name: "Open in system browser" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "The action could not be completed",
      ),
    );
    expect(screen.queryByText("SECRET_NATIVE_ERROR")).toBeNull();
    expect(fallback).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "More browser actions" }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "More browser actions" }),
    );
    f.revoked = true;
    fireEvent.click(screen.getByText("Copy current address"));
    expect(f.clipboard).not.toHaveBeenCalled();
  });
  it("applies configured native zoom and wires themed zoom controls with current presentation revisions", async () => {
    f.settings.webBrowser.defaultZoomPercent = 150;
    await attached();
    const reset = screen.getByRole("button", { name: "Reset zoom" });
    await waitFor(() => expect(reset).toHaveTextContent("150%"));
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await waitFor(() => expect(reset).toHaveTextContent("175%"));
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    await waitFor(() => expect(reset).toHaveTextContent("150%"));
    fireEvent.click(reset);
    await waitFor(() => expect(reset).toHaveTextContent("100%"));
    const requests = calls("origin_browser_control").map(
      ([, args]) => args.request.action,
    );
    expect(
      requests
        .filter((action) => action.kind === "zoom")
        .map((action) => action.percent),
    ).toEqual([150, 175, 150, 100]);
    for (const action of requests.filter((action) => action.kind === "zoom"))
      expect(action.presentationRevision).toBeGreaterThan(0);
    for (const name of [
      "Zoom in",
      "Zoom out",
      "Reset zoom",
      "Find in page",
      "Connection start page",
    ]) {
      const button = screen.getByRole("button", { name });
      expect(button).toHaveAttribute("data-tooltip");
      expect(button).not.toHaveAttribute("title");
      expect(button).toHaveClass("sor-btn");
    }
  });
  it.each([true, false])(
    "inherits global visibility and loading preferences (%s) with no connection overrides",
    async (visible) => {
      f.settings.webBrowser = {
        ...f.settings.webBrowser,
        showBookmarksBar: visible,
        showSecurityInfo: visible,
        showLoadingProgress: visible,
        defaultZoomPercent: 125,
      };
      await attached();
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Reset zoom" }),
        ).toHaveTextContent("125%"),
      );
      expect(
        !!screen.queryByRole("group", { name: "Saved website bookmarks" }),
      ).toBe(visible);
      expect(!!screen.queryByLabelText("Browser policy")).toBe(visible);
      act(() =>
        f.snapshotListener?.({
          payload: snapshot("attempt-1", { sequence: 2, loading: true }),
        }),
      );
      expect(!!screen.queryByText("Fixture native · Loading")).toBe(visible);
      expect(
        screen.getByRole("region", { name: "Fixture native" }),
      ).toHaveAttribute("aria-busy", "true");
      expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled();
      expect(f.context.dispatchAndFlush).not.toHaveBeenCalled();
      expect(f.updateSettings).not.toHaveBeenCalled();
    },
  );
  it.each([true, false])(
    "prefers explicit connection display overrides (%s) to global defaults",
    async (visible) => {
      f.settings.webBrowser = {
        ...f.settings.webBrowser,
        showBookmarksBar: !visible,
        showSecurityInfo: !visible,
        showLoadingProgress: !visible,
        defaultZoomPercent: 100,
      };
      const browserSession = {
        version: 1,
        showBookmarksBar: visible,
        showSecurityInfo: visible,
        showLoadingProgress: visible,
        defaultZoomPercent: 175,
      };
      f.context.state.connections = [{ ...connection, browserSession }];
      await attached();
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Reset zoom" }),
        ).toHaveTextContent("175%"),
      );
      expect(
        !!screen.queryByRole("group", { name: "Saved website bookmarks" }),
      ).toBe(visible);
      expect(!!screen.queryByLabelText("Browser policy")).toBe(visible);
      act(() =>
        f.snapshotListener?.({
          payload: snapshot("attempt-1", { sequence: 2, loading: true }),
        }),
      );
      expect(!!screen.queryByText("Fixture native · Loading")).toBe(visible);
      expect(calls("origin_browser_create")[0][1].request.policy).toEqual({
        darkMode: "forced",
        autoLogin: { enabled: true, consent: { kind: "required" } },
      });
      expect(f.context.state.connections[0].browserSession).toEqual(
        browserSession,
      );
      expect(f.context.dispatchAndFlush).not.toHaveBeenCalled();
      expect(f.updateSettings).not.toHaveBeenCalled();
    },
  );
  it("keeps sparse overrides while inheriting live global changes and re-inherits removed zoom overrides", async () => {
    const browserSession = { version: 1, showBookmarksBar: false };
    f.context.state.connections = [{ ...connection, browserSession }];
    const view = await attached();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Reset zoom" }),
      ).toHaveTextContent("100%"),
    );
    f.settings.webBrowser = {
      ...f.settings.webBrowser,
      defaultZoomPercent: 150,
      showSecurityInfo: false,
    };
    view.rerender(<WebBrowser session={session} />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Reset zoom" }),
      ).toHaveTextContent("150%"),
    );
    expect(screen.queryByLabelText("Browser policy")).toBeNull();
    expect(
      screen.queryByRole("group", { name: "Saved website bookmarks" }),
    ).toBeNull();
    f.context.state.connections = [
      {
        ...connection,
        browserSession: { ...browserSession, defaultZoomPercent: 200 },
      },
    ];
    view.rerender(<WebBrowser session={session} />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Reset zoom" }),
      ).toHaveTextContent("200%"),
    );
    f.settings.webBrowser = {
      ...f.settings.webBrowser,
      defaultZoomPercent: 125,
    };
    view.rerender(<WebBrowser session={session} />);
    expect(
      screen.getByRole("button", { name: "Reset zoom" }),
    ).toHaveTextContent("200%");
    f.context.state.connections = [{ ...connection, browserSession }];
    view.rerender(<WebBrowser session={session} />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Reset zoom" }),
      ).toHaveTextContent("125%"),
    );
    expect(calls("origin_browser_create")).toHaveLength(1);
    expect(f.context.dispatchAndFlush).not.toHaveBeenCalled();
    expect(f.context.state.connections[0].browserSession).toEqual({
      version: 1,
      showBookmarksBar: false,
    });
  });
  it("does not promote connection display overrides when saving global request permissions", async () => {
    f.settings.webBrowser.defaultZoomPercent = 125;
    const browserSession = {
      version: 1,
      defaultZoomPercent: 200,
      showBookmarksBar: false,
    };
    f.context.state.connections = [{ ...connection, browserSession }];
    await attached();
    fireEvent.click(screen.getByRole("button", { name: "Browser settings" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Save for next connection" }),
    );
    await waitFor(() => expect(f.updateSettings).toHaveBeenCalledOnce());
    expect(
      f.updateSettings.mock.calls[0][0].webBrowser.defaultZoomPercent,
    ).toBe(125);
    expect(f.updateSettings.mock.calls[0][0].webBrowser.showBookmarksBar).toBe(
      true,
    );
    expect(f.context.state.connections[0].browserSession).toEqual(
      browserSession,
    );
  });
  it("keeps malformed override errors static and disables page tools without crashing the shell", async () => {
    f.context.state.connections = [
      {
        ...connection,
        browserSession: {
          version: 1,
          defaultZoomPercent: "secret-invalid-value",
        },
      },
    ];
    await attached();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Saved browser display preferences are invalid",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(
      "secret-invalid-value",
    );
    expect(screen.getByRole("button", { name: "Reset zoom" })).toBeDisabled();
    expect(
      calls("origin_browser_control").filter(
        ([, args]) => args.request.action.kind === "zoom",
      ),
    ).toHaveLength(0);
  });
  it("finds forwards/backwards with case controls, no fabricated counts and native selection cleanup", async () => {
    await attached();
    fireEvent.click(screen.getByRole("button", { name: "Find in page" }));
    const input = screen.getByRole("textbox", { name: "Find text" });
    expect(input).toHaveFocus();
    expect(input).toHaveClass("sor-form-input-sm");
    expect(screen.getByRole("button", { name: "Next match" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "needle" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Previous match" }),
      ).toBeEnabled(),
    );
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: "Match case" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Match case" }));
    fireEvent.click(screen.getByRole("button", { name: "Next match" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Close find" })).toBeEnabled(),
    );
    const actions = calls("origin_browser_control")
      .map(([, args]) => args.request.action)
      .filter((action) => action.kind === "find");
    expect(actions).toEqual([
      expect.objectContaining({
        text: "needle",
        forward: true,
        matchCase: false,
        findNext: false,
      }),
      expect.objectContaining({
        text: "needle",
        forward: false,
        matchCase: false,
        findNext: true,
      }),
      expect.objectContaining({
        text: "needle",
        forward: true,
        matchCase: true,
        findNext: false,
      }),
    ]);
    for (const action of actions)
      expect(action.presentationRevision).toBeGreaterThan(0);
    expect(screen.queryByText(/\d+ of \d+|no results|0 matches/i)).toBeNull();
    expect(calls("origin_browser_navigate")).toHaveLength(0);
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Find text" })).toBeNull(),
    );
    expect(
      calls("origin_browser_control").some(
        ([, args]) =>
          args.request.action.kind === "stop-find" &&
          args.request.action.clearSelection === true,
      ),
    ).toBe(true);
    expect(screen.getByRole("button", { name: "Find in page" })).toHaveFocus();
    expect(f.updateSettings).not.toHaveBeenCalled();
  });
  it("rejects oversized UTF-8 find text and fences controls behind overlays or owner lock", async () => {
    const view = await attached();
    fireEvent.click(screen.getByRole("button", { name: "Find in page" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Find text" }), {
      target: { value: "é".repeat(513) },
    });
    expect(screen.getByRole("button", { name: "Next match" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Browser settings" }));
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Find in page" })).toBeDisabled();
    await waitFor(() => {
      const actions = calls("origin_browser_control")
        .map(([, args]) => args.request.action)
        .filter((action) => action.kind === "presentation");
      expect(actions.slice(-1)[0].visible).toBe(false);
    });
    act(() => {
      f.revoked = true;
      f.accessListeners.forEach((callback) =>
        callback({ databaseId: "database-1", status: "suspended" }),
      );
    });
    view.rerender(<WebBrowser session={session} />);
    expect(screen.queryByRole("textbox", { name: "Find text" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Connection start page" }),
    ).toBeDisabled();
    expect(
      calls("origin_browser_control").filter(
        ([, args]) => args.request.action.kind === "find",
      ),
    ).toHaveLength(0);
  });
  it("reviews and saves current-page bookmarks while hiding native, without reconnecting", async () => {
    const view = await attached();
    act(() =>
      f.snapshotListener?.({
        payload: snapshot("attempt-1", {
          sequence: 1,
          currentUrl: "https://fixture.invalid/report?private=token#part",
        }),
      }),
    );
    const closes = calls("origin_browser_close").length;
    fireEvent.click(screen.getByRole("button", { name: "Manage bookmarks" }));
    expect(screen.getByRole("button", { name: "Reload" })).toBeDisabled();
    const presentations = calls("origin_browser_control").filter(
      ([, args]) => args.request.action.kind === "presentation",
    );
    expect(presentations.slice(-1)[0][1].request.action.visible).toBe(false);
    expect(
      screen.getByRole("menuitem", { name: "Bookmark this page" }),
    ).toBeEnabled();
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Bookmark this page" }),
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Bookmark URL or path" }),
      { target: { value: "/report" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save bookmark" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    view.rerender(<WebBrowser session={session} />);
    expect(f.context.state.connections[0].httpBookmarks).toEqual([
      { name: "Fixture native", path: "/report" },
    ]);
    expect(calls("origin_browser_close")).toHaveLength(closes);
    expect(calls("origin_browser_create")).toHaveLength(1);
    expect(JSON.stringify(f.context.dispatchAndFlush.mock.calls)).not.toContain(
      "private=token",
    );
    expect(
      screen.getByRole("button", { name: "Fixture native" }),
    ).toBeEnabled();
  });
  it("does not save a bookmark after the database locks while its editor is open", async () => {
    await attached();
    fireEvent.click(screen.getByRole("button", { name: "Manage bookmarks" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Add bookmark" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Bookmark name" }), {
      target: { value: "Late" },
    });
    fireEvent.change(
      screen.getByRole("textbox", { name: "Bookmark URL or path" }),
      { target: { value: "/late" } },
    );
    // Native access can change before its renderer notification arrives.
    f.revoked = true;
    fireEvent.click(screen.getByRole("button", { name: "Save bookmark" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "Reload" })).toBeDisabled();
    expect(f.context.dispatchAndFlush).not.toHaveBeenCalled();
    expect(calls("origin_browser_navigate")).toHaveLength(0);
  });
  it("drops a folder navigation when ownership is revoked before the overlay retires", async () => {
    f.context.state.connections = [
      {
        ...connection,
        httpBookmarks: [
          {
            name: "Tools",
            isFolder: true,
            children: [{ name: "Dashboard", path: "/dashboard" }],
          },
        ],
      },
    ];
    await attached();
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    act(() => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Dashboard" }));
      f.revoked = true;
    });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(calls("origin_browser_navigate")).toHaveLength(0);
  });
  it("opens saved bookmarks and home through native navigation without persisting the current URL", async () => {
    f.context.state.connections = [
      {
        ...connection,
        httpBookmarks: [
          {
            id: "folder",
            name: "Tools",
            isFolder: true,
            children: [
              {
                id: "saved",
                name: "Dashboard",
                path: "/dashboard?mode=small#panel",
              },
            ],
          },
          { id: "unsafe", name: "Invalid", path: "javascript:alert(1)" },
        ],
      },
    ];
    await attached();
    expect(screen.getByRole("button", { name: "Invalid" })).toBeDisabled();
    const folder = screen.getByRole("button", { name: "Tools" });
    expect(folder).toHaveAttribute("data-tooltip", "Tools");
    fireEvent.click(folder);
    expect(screen.getByRole("button", { name: "Reload" })).toBeDisabled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Dashboard" }));
    await waitFor(() =>
      expect(calls("origin_browser_navigate").slice(-1)[0][1].request.url).toBe(
        "https://fixture.invalid/dashboard?mode=small#panel",
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Connection start page" }),
    );
    await waitFor(() =>
      expect(calls("origin_browser_navigate").slice(-1)[0][1].request.url).toBe(
        "https://fixture.invalid/",
      ),
    );
    expect(f.updateSettings).not.toHaveBeenCalled();
    expect(f.context.dispatchAndFlush).not.toHaveBeenCalled();
    act(() => {
      f.revoked = true;
      f.accessListeners.forEach((callback) =>
        callback({ databaseId: "database-1", status: "suspended" }),
      );
    });
    expect(
      screen.queryByRole("group", { name: "Saved website bookmarks" }),
    ).toBeNull();
  });
  it("uses themed compact toolbar icons and single app tooltips without an engine selector", async () => {
    const view = await attached();
    const toolbar = screen.getByRole("form", {
      name: "Native browser navigation",
    });
    expect(toolbar).toHaveClass("flex-wrap", "bg-[var(--color-surface)]");
    for (const name of [
      "Back",
      "Forward",
      "Reload",
      "Go",
      "Reconnect",
      "Browser settings",
    ]) {
      const button = within(toolbar).getByRole("button", { name });
      expect(button).toHaveClass("sor-btn", "sor-icon-btn-sm");
      expect(button).toHaveAttribute("data-tooltip", name);
      expect(button).not.toHaveAttribute("title");
      expect(button.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    }
    expect(within(toolbar).getByRole("textbox")).toHaveClass(
      "sor-form-input-sm",
      "min-w-0",
    );
    expect(view.container.querySelector("select")).toBeNull();
    act(() =>
      f.snapshotListener?.({
        payload: snapshot("attempt-1", { sequence: 9, loading: true }),
      }),
    );
    expect(screen.getByRole("button", { name: "Stop" })).toHaveAttribute(
      "data-tooltip",
      "Stop",
    );
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
  });

  it("uses shared modal sections and themed actions while fencing dismissal during pending save", async () => {
    await attached();
    const previous = f.invoke.getMockImplementation()!;
    let finishClose!: () => void;
    f.invoke.mockImplementation((command, args) =>
      command === "origin_browser_close"
        ? new Promise<void>((resolve) => {
            finishClose = resolve;
          })
        : previous(command, args),
    );
    fireEvent.click(screen.getByRole("button", { name: "Browser settings" }));
    const dialog = screen.getByRole("dialog", {
      name: "Browser request permissions",
    });
    expect(dialog.querySelector(".sor-modal-header")).not.toBeNull();
    expect(dialog.querySelector(".sor-modal-body")).toHaveClass(
      "overflow-y-auto",
      "min-h-0",
    );
    expect(dialog.querySelector(".sor-modal-footer")).toHaveClass(
      "flex-wrap",
      "shrink-0",
    );
    expect(dialog.querySelectorAll(".sor-settings-card")).toHaveLength(2);
    expect(
      within(dialog).queryByRole("combobox", { name: /browser engine/i }),
    ).toBeNull();
    for (const name of [
      "Save for next connection",
      "Save and reconnect",
      "Cancel",
    ])
      expect(within(dialog).getByRole("button", { name })).toHaveClass(
        "sor-btn",
      );
    expect(
      within(dialog).getByRole("button", { name: "Save and reconnect" }),
    ).toHaveClass("sor-btn-primary");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Save for next connection" }),
    );
    expect(within(dialog).getByRole("status")).toHaveTextContent(
      "Saving permissions",
    );
    expect(within(dialog).queryByRole("button", { name: "Close" })).toBeNull();
    for (const name of [
      "Save for next connection",
      "Save and reconnect",
      "Cancel",
    ])
      expect(within(dialog).getByRole("button", { name })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(dialog).toBeInTheDocument();
    expect(f.context.dispatchAndFlush).not.toHaveBeenCalled();
    await act(async () => finishClose());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls("origin_browser_create")).toHaveLength(1);
  });
  it("mounts the native controller with saved-owner proof, forced dark and consent without starting legacy", async () => {
    const view = await attached();
    expect(f.legacy).not.toHaveBeenCalled();
    expect(view.container.querySelector("iframe")).toBeNull();
    expect(calls("origin_browser_create")[0][1].request).toMatchObject({
      owner: {
        ownerDatabaseId: "database-1",
        connectionId: "connection-1",
        sessionId: "tab-1",
      },
      sourceSessionId: "unlock-1",
      expectedSecurityRevision: "revision-1",
      initialUrl: "https://fixture.invalid/",
      visible: false,
      policy: {
        darkMode: "forced",
        autoLogin: { enabled: true, consent: { kind: "required" } },
      },
    });
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    act(() =>
      f.snapshotListener?.({
        payload: snapshot("attempt-1", {
          sequence: 3,
          canGoBack: true,
          loading: true,
          displayUrl: "https://fixture.invalid/account?token=secret#code",
        }),
      }),
    );
    expect(
      screen.getByRole("textbox", { name: "Website address" }),
    ).toHaveValue("https://fixture.invalid/account");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(
      calls("origin_browser_control")
        .slice(-2)
        .map(([, args]) => args.request.action.kind),
    ).toEqual(["back", "stop"]);
  });
  it("reports capability failure without fallback or an in-tab engine selector", async () => {
    f.invoke.mockImplementation(async (command) =>
      command === "origin_browser_status"
        ? {
            capability: {
              availability: "unavailable",
              reason: "runtime-missing",
            },
            snapshot: null,
          }
        : undefined,
    );
    render(<WebBrowser session={session} />);
    await screen.findByText(/runtime is missing/);
    expect(screen.getByText(/runtime is missing/)).toHaveTextContent(
      "Experimental native browser unavailable",
    );
    expect(f.legacy).not.toHaveBeenCalled();
    expect(calls("origin_browser_create")).toHaveLength(0);
    expect(
      screen.queryByRole("combobox", { name: /browser engine/i }),
    ).toBeNull();
  });
  it.each([
    ["http", "runtime-missing"],
    ["http", "policy-unavailable"],
    ["https", "runtime-missing"],
    ["https", "policy-unavailable"],
  ] as const)(
    "opens Web Browser settings through SessionViewer for %s %s warnings",
    async (protocol, reason) => {
      f.context.state.connections = [{ ...connection, protocol }];
      f.invoke.mockImplementation(async (command) =>
        command === "origin_browser_status"
          ? {
              capability: { availability: "unavailable", reason },
              snapshot: null,
            }
          : undefined,
      );
      const onOpenSettings = vi.fn();
      const connectedSession: ConnectionSession = {
        ...session,
        protocol,
        status: "connected",
      };
      render(
        <SessionViewer
          session={connectedSession}
          onOpenSettings={onOpenSettings}
        />,
      );

      const button = await screen.findByRole("button", {
        name: "Open Web Browser settings",
      });
      expect(button).toBeVisible();
      expect(button).toBeEnabled();
      expect(button).toHaveClass("sor-btn", "sor-btn-secondary");
      expect(button).not.toHaveAttribute("title");
      expect(onOpenSettings).not.toHaveBeenCalled();
      fireEvent.click(button);
      expect(onOpenSettings).toHaveBeenCalledExactlyOnceWith("webBrowser");
      expect(f.updateSettings).not.toHaveBeenCalled();
      expect(f.context.dispatchAndFlush).not.toHaveBeenCalled();
      expect(f.legacy).not.toHaveBeenCalled();
      expect(calls("origin_browser_create")).toHaveLength(0);
      expect(calls("origin_browser_navigate")).toHaveLength(0);
      expect(calls("origin_browser_control")).toHaveLength(0);
    },
  );
  it("fails closed when the managed proof accessor is absent", async () => {
    delete f.manager.captureOriginBrowserOwnerProof;
    render(<WebBrowser session={session} />);
    await screen.findByText(/Unlock the owning database/);
    expect(calls("origin_browser_create")).toHaveLength(0);
    expect(f.legacy).not.toHaveBeenCalled();
  });
  it("still reports actual native unavailability when owner proof cannot be captured", async () => {
    delete f.manager.captureOriginBrowserOwnerProof;
    f.invoke.mockImplementation(async (command) =>
      command === "origin_browser_status"
        ? {
            capability: {
              availability: "unavailable",
              reason: "containment-unverified",
            },
            snapshot: null,
          }
        : undefined,
    );
    render(<WebBrowser session={session} />);
    await waitFor(() =>
      expect(screen.getByTestId("origin-browser-capability")).toHaveTextContent(
        "network containment unverified",
      ),
    );
    expect(screen.getByTestId("origin-browser-capability")).toHaveClass(
      "sor-alert-warning",
      "text-[var(--color-text)]",
    );
    expect(calls("origin_browser_status").length).toBeGreaterThan(0);
    expect(calls("origin_browser_create")).toHaveLength(0);
    expect(f.legacy).not.toHaveBeenCalled();
  });
  it("never submits a redacted display address until the user edits it", async () => {
    await attached();
    expect(screen.getByRole("button", { name: "Go" })).toBeDisabled();
    fireEvent.submit(
      screen.getByRole("form", { name: "Native browser navigation" }),
    );
    expect(calls("origin_browser_navigate")).toHaveLength(0);
    fireEvent.change(screen.getByRole("textbox", { name: "Website address" }), {
      target: { value: "https://fixture.invalid/next" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    await waitFor(() =>
      expect(calls("origin_browser_navigate")).toHaveLength(1),
    );
    expect(calls("origin_browser_navigate")[0][1].request).toMatchObject({
      identity: { attemptId: "attempt-1" },
      url: "https://fixture.invalid/next",
    });
  });
  it("uses a semantic capability error notice without reflecting native error details", async () => {
    delete f.manager.captureOriginBrowserOwnerProof;
    f.invoke.mockRejectedValue(new Error("private-native-error"));
    render(<WebBrowser session={session} />);
    await waitFor(() =>
      expect(screen.getByTestId("origin-browser-capability")).toHaveTextContent(
        "capability check failed",
      ),
    );
    expect(screen.getByTestId("origin-browser-capability")).toHaveClass(
      "sor-alert-error",
      "text-[var(--color-text)]",
    );
    expect(screen.queryByText(/private-native-error/)).toBeNull();
    expect(calls("origin_browser_create")).toHaveLength(0);
  });
  it.each([
    "https://fixture.invalid/?token=private-reason",
    "toString",
    "__proto__",
  ])(
    "uses fixed capability wording for unknown native reasons (%s)",
    async (reason) => {
      delete f.manager.captureOriginBrowserOwnerProof;
      f.invoke.mockImplementation(async (command) =>
        command === "origin_browser_status"
          ? {
              capability: { availability: "unavailable", reason },
              snapshot: null,
            }
          : undefined,
      );
      render(<WebBrowser session={session} />);
      await waitFor(() =>
        expect(
          screen.getByTestId("origin-browser-capability"),
        ).toHaveTextContent(
          "Experimental native browser unavailable: host unavailable.",
        ),
      );
      expect(document.body.textContent).not.toMatch(
        /private-reason|toString|__proto__/,
      );
      expect(calls("origin_browser_create")).toHaveLength(0);
    },
  );
  it("uses the full current address only in the address bar and explicit native navigation, never logs or persistence", async () => {
    const view = await attached();
    const logs = ["log", "info", "warn", "error", "debug"] as const;
    const spies = logs.map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    const storage = vi.spyOn(Storage.prototype, "setItem");
    const currentUrl =
      "https://fixture.invalid/account?token=address-only&next=%2Fhome#fragment-only";
    act(() =>
      f.snapshotListener?.({
        payload: snapshot("attempt-1", {
          sequence: 8,
          currentUrl,
          displayUrl: "https://fixture.invalid/account",
        }),
      }),
    );
    const address = screen.getByRole("textbox", { name: "Website address" });
    expect(address).toHaveValue(currentUrl);
    expect(address).toHaveAccessibleDescription(/sensitive query or fragment/);
    const outsideAddress = view.container.cloneNode(true) as HTMLElement;
    outsideAddress.querySelector('[aria-label="Website address"]')?.remove();
    expect(outsideAddress.outerHTML).not.toMatch(/address-only|fragment-only/);
    expect(JSON.stringify(f.invoke.mock.calls)).not.toContain("address-only");
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    await waitFor(() =>
      expect(calls("origin_browser_navigate")).toHaveLength(1),
    );
    expect(calls("origin_browser_navigate")[0][1].request.url).toBe(currentUrl);
    expect(f.updateSettings).not.toHaveBeenCalled();
    expect(f.context.dispatchAndFlush).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
  it("does not fall back to a diagnostic address when native explicitly reports an empty current address", async () => {
    await attached();
    act(() =>
      f.snapshotListener?.({
        payload: snapshot("attempt-1", {
          sequence: 8,
          currentUrl: "",
          displayUrl: "https://fixture.invalid/stale-path",
        }),
      }),
    );
    expect(
      screen.getByRole("textbox", { name: "Website address" }),
    ).toHaveValue("");
    expect(screen.getByRole("button", { name: "Go" })).toBeDisabled();
  });
  it("never exposes a native navigation rejection containing a full sensitive address", async () => {
    await attached();
    const currentUrl =
      "https://fixture.invalid/?token=private-rejection#private-fragment";
    const previous = f.invoke.getMockImplementation()!;
    f.invoke.mockImplementation((command, args) =>
      command === "origin_browser_navigate"
        ? Promise.reject(new Error(currentUrl))
        : previous(command, args),
    );
    act(() =>
      f.snapshotListener?.({
        payload: snapshot("attempt-1", { sequence: 8, currentUrl }),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    await screen.findByText("Native browser operation failed.");
    expect(
      screen.getByRole("textbox", { name: "Website address" }),
    ).toHaveValue("");
    expect(document.body.textContent).not.toMatch(
      /private-rejection|private-fragment/,
    );
    expect(f.legacy).not.toHaveBeenCalled();
  });
  it("does not switch an open native tab when the global engine default changes", async () => {
    const view = await attached();
    f.settings = {
      webBrowser: normalizeWebBrowserSettings({ engine: "legacy" }),
    };
    view.rerender(<WebBrowser session={session} />);
    expect(
      screen.getByRole("region", { name: "Fixture native" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: /browser engine/i }),
    ).toBeNull();
    expect(f.legacy).not.toHaveBeenCalled();
    expect(calls("origin_browser_create")).toHaveLength(1);
  });
  it("does not expose native query values or invent a title when native redacts both", async () => {
    await attached();
    act(() =>
      f.snapshotListener?.({
        payload: snapshot("attempt-1", {
          sequence: 5,
          title: "",
          displayUrl: "https://fixture.invalid/",
        }),
      }),
    );
    expect(screen.getByRole("region", { name: "Fixture" })).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Website address" }),
    ).toHaveValue("https://fixture.invalid/");
  });
  it("closes immediately on owner revocation and ignores delayed events", async () => {
    await attached();
    act(() =>
      f.snapshotListener?.({
        payload: snapshot("attempt-1", {
          sequence: 8,
          currentUrl:
            "https://fixture.invalid/?token=owner-secret#owner-fragment",
        }),
      }),
    );
    act(() => {
      f.revoked = true;
      f.accessListeners.forEach((callback) =>
        callback({ databaseId: "database-1", status: "suspended" }),
      );
    });
    expect(calls("origin_browser_close")).toHaveLength(1);
    act(() =>
      f.snapshotListener?.({
        payload: snapshot("attempt-1", {
          sequence: 99,
          title: "Stale title",
          currentUrl: "https://fixture.invalid/?token=stale-secret",
        }),
      }),
    );
    expect(screen.queryByText(/Stale title/)).toBeNull();
    expect(
      screen.getByRole("textbox", { name: "Website address" }),
    ).toHaveValue("");
    expect(screen.getByRole("button", { name: "Go" })).toBeDisabled();
  });
  it("hides the native child for inactive tabs and shell portal dialogs, then restores it", async () => {
    const view = await attached();
    const visible = () =>
      calls("origin_browser_control")
        .filter(([, args]) => args.request.action.kind === "presentation")
        .slice(-1)[0]?.[1].request.action.visible;
    await waitFor(() => expect(visible()).toBe(true));
    f.active = false;
    view.rerender(<WebBrowser session={session} />);
    await waitFor(() => expect(visible()).toBe(false));
    f.active = true;
    view.rerender(<WebBrowser session={session} />);
    await waitFor(() => expect(visible()).toBe(true));
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    act(() => document.body.append(dialog));
    await waitFor(() => expect(visible()).toBe(false));
    act(() => dialog.remove());
    await waitFor(() => expect(visible()).toBe(true));
  });
  it("mounts both permission scopes and closes before persisting and reconnecting", async () => {
    await attached();
    fireEvent.click(screen.getByRole("button", { name: "Browser settings" }));
    expect(
      screen.queryByRole("combobox", { name: /browser engine/i }),
    ).toBeNull();
    expect(
      screen.getByRole("heading", {
        name: "Shared website request permissions",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", {
        name: "Connection website request overrides",
      }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Save and reconnect" }));
    await waitFor(() => expect(calls("origin_browser_create")).toHaveLength(2));
    for (const [, args] of calls("origin_browser_create"))
      expect(args.request.policy.autoLogin.consent).toEqual({
        kind: "required",
      });
    expect(screen.getByLabelText("Browser policy")).toHaveAttribute(
      "data-tooltip",
      expect.stringContaining("fresh native consent for each attempt"),
    );
    const closeOrder =
      f.invoke.mock.invocationCallOrder[
        f.invoke.mock.calls.findIndex(([cmd]) => cmd === "origin_browser_close")
      ];
    expect(closeOrder).toBeLessThan(
      f.context.dispatchAndFlush.mock.invocationCallOrder[0],
    );
    expect(f.context.dispatchAndFlush.mock.invocationCallOrder[0]).toBeLessThan(
      f.updateSettings.mock.invocationCallOrder[0],
    );
  });
  it("does not save permissions or reconnect when native close is unconfirmed", async () => {
    await attached();
    const previous = f.invoke.getMockImplementation()!;
    f.invoke.mockImplementation((command, args) =>
      command === "origin_browser_close"
        ? Promise.reject(new Error("native secret"))
        : previous(command, args),
    );
    fireEvent.click(screen.getByRole("button", { name: "Browser settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Save and reconnect" }));
    await screen.findByText(/Settings could not be fully saved/);
    expect(f.context.dispatchAndFlush).not.toHaveBeenCalled();
    expect(calls("origin_browser_create")).toHaveLength(1);
    expect(screen.queryByText(/native secret/)).toBeNull();
  });
});

describe("engine preference normalization", () => {
  it("defaults missing preferences to real-origin and preserves every stored legacy choice", () => {
    expect(normalizeWebBrowserSettings(undefined).engine).toBe("real-origin");
    expect(normalizeWebBrowserSettings({}).engine).toBe("real-origin");
    expect(
      normalizeWebBrowserSettings({ version: 1, showBookmarksBar: false })
        .engine,
    ).toBe("real-origin");
    expect(normalizeWebBrowserSettings({ engine: "legacy" }).engine).toBe(
      "legacy",
    );
    expect(() =>
      normalizeWebBrowserSettings({ engine: "auto-fallback" }),
    ).toThrow();
  });
  it("preserves saved legacy sessions without rendering an engine selector", () => {
    f.settings = {
      webBrowser: normalizeWebBrowserSettings({ engine: "legacy" }),
    };
    render(<WebBrowser session={session} />);
    expect(
      screen.queryByRole("combobox", { name: /browser engine/i }),
    ).toBeNull();
    expect(f.legacy).toHaveBeenCalled();
    expect(f.invoke).not.toHaveBeenCalled();
  });
  it.each([undefined, {}, { version: 1 }])(
    "mounts native for missing engine preferences (%j)",
    async (webBrowser) => {
      f.settings = { webBrowser };
      await attached();
      expect(calls("origin_browser_create")).toHaveLength(1);
      expect(f.legacy).not.toHaveBeenCalled();
      expect(
        screen.queryByRole("combobox", { name: /browser engine/i }),
      ).toBeNull();
    },
  );
  it("does not create native before persisted legacy settings have loaded", async () => {
    f.settings = {};
    f.settingsReady = false;
    const view = render(<WebBrowser session={session} />);
    await act(async () => {});
    expect(calls("origin_browser_create")).toHaveLength(0);
    f.settings = { webBrowser: { engine: "legacy" } };
    f.settingsReady = true;
    view.rerender(<WebBrowser session={session} />);
    expect(screen.getByText("Legacy content")).toBeVisible();
    expect(calls("origin_browser_create")).toHaveLength(0);
  });
  it("keeps a legacy tab stable and applies global native selection to a newly opened tab", async () => {
    f.settings = { webBrowser: { engine: "legacy" } };
    const view = render(<WebBrowser session={session} />);
    f.settings = { webBrowser: { engine: "real-origin" } };
    view.rerender(<WebBrowser session={session} />);
    expect(screen.getByText("Legacy content")).toBeVisible();
    expect(calls("origin_browser_create")).toHaveLength(0);
    view.unmount();
    await attached();
    expect(calls("origin_browser_create")).toHaveLength(1);
    expect(screen.queryByText("Legacy content")).toBeNull();
  });
});
