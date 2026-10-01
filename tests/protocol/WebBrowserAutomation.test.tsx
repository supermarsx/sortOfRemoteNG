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
  HttpBookmarkItem,
} from "../../src/types/connection/connection";
import type { DatabaseCredentialVaultApi } from "../../src/types/security/databaseCredentialVault";
import type { GlobalSettings } from "../../src/types/settings/settings";
import * as redirectHooks from "../../src/hooks/protocol/useHttpRedirectReview";
import { browserSessionPolicy } from "../../src/hooks/protocol/useBrowserRuntimeSettings";
import { normalizeHttpProxyPolicy } from "../../src/utils/connection/httpProxyPolicy";
import { normalizeWebBrowserSettings } from "../../src/utils/settings/webBrowserSettings";
import {
  clearRuntimeConnectionsForTests,
  registerRuntimeConnection,
  resolveRuntimeConnection,
} from "../../src/utils/session/runtimeConnectionRegistry";
const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  activate: vi.fn(async () => false),
  dispatch: vi.fn(),
  connections: [] as Connection[],
  persistedConnections: undefined as Connection[] | undefined,
  sessions: [] as ConnectionSession[],
  locked: false,
  vaultApi: undefined as DatabaseCredentialVaultApi | undefined,
  // Production holds this lease in state. A fresh object per render would
  // restart the async proxy-palette effect indefinitely inside async act().
  databaseAvailability: {
    status: "ready" as const,
    databaseId: "owned-demo",
    generation: 1,
  },
  settings: {
    webBrowser: undefined as GlobalSettings["webBrowser"],
    proxyKeepaliveEnabled: false,
    webRecording: { autoRecordWebSessions: false },
    sessionQuickActions: {
      httpEnabled: true,
      sshEnabled: true,
      allowWebMacros: true,
      allowWebScriptInjection: true,
      allowWebForceDark: true,
      confirmBeforeScriptRun: true,
    },
    macros: { confirmBeforeReplay: true },
  },
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, ...args: unknown[]) =>
    command === "web_network_guard_status"
      ? Promise.resolve({
          platform: "windows",
          frameNavigation: "enforced",
          allNetworkRequestsMediated: false,
        })
      : command === "activate_proxy_network_document"
        ? native.activate()
        : native.invoke(command, ...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async () => () => undefined,
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => native.invoke,
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { connections: native.connections, sessions: native.sessions },
    dispatch: native.dispatch,
    dispatchAndFlush: native.dispatch,
    credentialVault: native.vaultApi,
    databaseAvailability: native.databaseAvailability,
    recycleBin: {
      snapshot: { scope: { databaseId: "owned-demo", generation: 1 } },
    },
  }),
}));
vi.mock("../../src/contexts/SettingsContext", async (original) => ({
  ...(await original<typeof import("../../src/contexts/SettingsContext")>()),
  useSettings: () => ({ settings: native.settings, settingsReady: true }),
}));
vi.mock("../../src/contexts/ToastContext", () => ({
  useToastContext: () => ({
    toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
  }),
}));
vi.mock("../../src/hooks/recording/useWebRecorder", () => ({
  useWebRecorder: () => ({ state: {} }),
}));
vi.mock("../../src/hooks/recording/useDisplayRecorder", () => ({
  useDisplayRecorder: () => ({ state: {} }),
}));
vi.mock("../../src/utils/recording/macroService", () => ({}));
vi.mock("../../src/hooks/integration/httpProxy", () => ({
  getGlobalHttpProxyUrl: () => undefined,
}));
vi.mock("../../src/utils/connection/databaseManager", () => {
  // Match the production singleton so render dependencies retain their identity.
  const manager = {
    getCurrentDatabase: () => ({ id: "owned-demo" }),
    onCurrentDatabaseChange: () => () => undefined,
    captureCurrentDatabaseDataTarget: () => ({
      databaseId: "owned-demo",
      assertAccessible: () => {
        if (native.locked) throw new Error("locked");
      },
      verifyCurrent: async () => {
        if (native.locked) throw new Error("locked");
      },
      readCurrent: async () => ({
        connections: native.persistedConnections ?? native.connections,
      }),
    }),
  };
  return {
    onCurrentDatabaseChange: () => () => undefined,
    onDatabaseAccessChange: () => () => undefined,
    DatabaseManager: { getInstance: () => manager },
  };
});
import { WebBrowser } from "../../src/components/protocol/WebBrowser";
import { useWebBrowser } from "../../src/hooks/protocol/useWebBrowser";
import { webPopupTabs } from "../../src/utils/protocol/webPopupTabs";
import { normalizeWebAutomationLibrary } from "../../src/utils/recording/webAutomationLibrary";
import {
  normalizeWebsiteDarkModeConfig,
  normalizeWebsiteDarkModeSettings,
} from "../../src/utils/connection/websiteDarkMode";
const proxy = {
  session_id: "automation-proxy",
  local_port: 43081,
  proxy_url: "http://p0123456789abcdef0123456789abcdef.localhost:43081/",
};
const stamp = "2026-09-09T12:00:00Z";
const script = {
  kind: "script",
  id: "example",
  name: "Demo page action",
  description: "Fixture only",
  code: "document.title = 'Demo';",
  createdAt: stamp,
  updatedAt: stamp,
};
const holdFrameLoad = (event: Event) => {
  if (event.target instanceof HTMLIFrameElement)
    event.stopImmediatePropagation();
};
beforeEach(() => {
  native.activate.mockClear();
  document.addEventListener("load", holdFrameLoad, true);
  native.locked = false;
  Object.assign(native.settings, {
    webBrowser: undefined,
    websiteDarkMode: normalizeWebsiteDarkModeSettings(undefined),
  });
  native.vaultApi = undefined;
  native.sessions = [];
  clearRuntimeConnectionsForTests();
  native.connections = [
    {
      id: "automation-demo",
      name: "Demo admin panel",
      protocol: "http",
      hostname: "panel.example.test",
      port: 81,
      isGroup: false,
      createdAt: stamp,
      updatedAt: stamp,
      httpAutomation: {
        version: 1,
        interactionMacrosEnabled: true,
        scriptInjectionEnabled: true,
        forceDark: true,
        items: [{ kind: "script", id: "example" }],
      },
    },
  ];
  native.persistedConnections = undefined;
  let library = JSON.stringify(
    normalizeWebAutomationLibrary({
      version: 1,
      scripts: [script],
      macros: [],
    }),
  );
  native.invoke.mockReset().mockImplementation(async (command, args) => {
    if (command === "start_basic_auth_proxy") return proxy;
    if (command === "stop_basic_auth_proxy") return undefined;
    if (command === "update_proxy_website_dark_mode") return undefined;
    if (command === "read_macro_library") return library;
    if (command === "compare_and_swap_macro_library") {
      if (args.expected !== library) return false;
      library = args.replacement;
      return true;
    }
    throw new Error(`Unexpected native command ${command}`);
  });
});
afterEach(() => {
  cleanup();
  webPopupTabs.revokeSource("shared-source");
  browserSessionPolicy.release("shared-source", proxy.session_id);
  document.removeEventListener("load", holdFrameLoad, true);
  vi.restoreAllMocks();
  clearRuntimeConnectionsForTests();
});
async function mount() {
  const connection = native.connections[0];
  const session: ConnectionSession = {
    id: "web-session",
    connectionId: connection.id,
    ownerDatabaseId: "owned-demo",
    name: connection.name,
    hostname: connection.hostname,
    protocol: "http",
    status: "connected",
    startTime: new Date(),
  };
  native.sessions = [session];
  const view = render(<WebBrowser session={session} />);
  const iframe = (await screen.findByTitle(
    connection.name,
  )) as HTMLIFrameElement;
  await waitFor(() => expect(iframe.src).toContain(proxy.proxy_url));
  const post = vi
    .spyOn(iframe.contentWindow!, "postMessage")
    .mockImplementation(() => undefined);
  const raw = new URL(iframe.src);
  const identity = {
    version: 1,
    sessionId: proxy.session_id,
    documentToken: "d".repeat(32),
    documentSequence: 1,
    navigationToken: raw.searchParams.get("__sorng_navigation_v1"),
    url: iframe.src.replace(
      /[?&]__sorng_navigation_v1=[a-f0-9]{32}(?=#|$)/,
      "",
    ),
  };
  const emit = (
    type: string,
    values = {},
    source: MessageEventSource = iframe.contentWindow!,
    origin = raw.origin,
  ) =>
    act(() =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source,
          origin,
          data: { ...identity, ...values, type },
        }),
      ),
    );
  return { ...view, iframe, post, identity, emit };
}
it("restricts the old page before stopping its listener on browser teardown", async () => {
  const view = await mount();
  const invokeBefore = native.invoke.getMockImplementation()!;
  let stoppedAfterBlank = false;
  native.invoke.mockImplementation(async (command, args) => {
    if (command === "stop_basic_auth_proxy")
      stoppedAfterBlank =
        view.iframe.getAttribute("src") === "about:blank" &&
        view.iframe.getAttribute("sandbox") === "";
    return invokeBefore(command, args);
  });
  view.unmount();
  expect(stoppedAfterBlank).toBe(true);
});

describe("source-owned full browser tabs", () => {
  async function shared(strict = false) {
    const connection = native.connections[0];
    const source: ConnectionSession = {
      id: "shared-source",
      connectionId: connection.id,
      ownerDatabaseId: "owned-demo",
      name: connection.name,
      hostname: connection.hostname,
      protocol: "http",
      status: "connected",
      startTime: new Date(),
    };
    const root = {
      generation: 1,
      sessionId: proxy.session_id,
      sequence: 1,
      token: "a".repeat(32),
      navigationToken: null,
    };
    let current = true;
    browserSessionPolicy.bind(
      source.id,
      proxy.session_id,
      normalizeHttpProxyPolicy(connection.httpProxyPolicy),
    );
    const child = webPopupTabs.open({
      source,
      document: root,
      proxyUrl: proxy.proxy_url,
      url: `${proxy.proxy_url}takecontrol/agent-one?__sorng_popup_parent_v1=1`,
      isCurrent: () => current,
    });
    native.sessions = [source, child];
    const session = {
      ...source,
      ...child,
      connectionId: source.connectionId,
      hostname: source.hostname,
      protocol: source.protocol,
    };
    const element = <WebBrowser session={session} sharedPopupId={child.id} />;
    const view = render(
      strict ? <React.StrictMode>{element}</React.StrictMode> : element,
    );
    const iframe = (await screen.findByTitle(child.name)) as HTMLIFrameElement;
    await waitFor(() => expect(iframe.src).toContain("takecontrol/agent-one"));
    const post = vi
      .spyOn(iframe.contentWindow!, "postMessage")
      .mockImplementation(() => undefined);
    const identity = {
      version: 1,
      sessionId: root.sessionId,
      documentSequence: 2,
      documentToken: "b".repeat(32),
      navigationToken: null,
      popupParentSequence: 1,
      url: iframe.src,
    };
    const emit = (type: string, values = {}) =>
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            source: iframe.contentWindow!,
            origin: new URL(proxy.proxy_url).origin,
            data: { ...identity, ...values, type },
          }),
        );
      });
    return {
      ...view,
      iframe,
      post,
      emit,
      identity,
      child,
      source,
      expire: () => {
        current = false;
        webPopupTabs.revokeSource(source.id);
      },
    };
  }
  const assertNoProxyOwnership = () => {
    expect(
      native.invoke.mock.calls.filter(([name]) =>
        [
          "start_basic_auth_proxy",
          "stop_basic_auth_proxy",
          "restart_proxy_session",
          "update_proxy_website_dark_mode",
        ].includes(name),
      ),
    ).toEqual([]);
    expect(native.activate).not.toHaveBeenCalled();
  };
  it.each([false, true])(
    "uses the complete browser chrome without taking proxy ownership (StrictMode=%s)",
    async (strict) => {
      const view = await shared(strict);
      expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
      expect(screen.getByPlaceholderText("Enter URL...")).toHaveValue(
        "http://panel.example.test:81/takecontrol/agent-one",
      );
      expect(screen.getByTitle("Print / Save as PDF")).toBeVisible();
      expect(
        screen.getByRole("button", { name: "Clear session data" }),
      ).toBeDisabled();
      expect(screen.getByText(/Shared browser session/)).toBeVisible();
      expect(view.iframe.src).not.toContain("__sorng_navigation_v1");
      view.emit("proxy_document_start");
      view.emit("proxy_dom_ready");
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled(),
      );
      view.emit("proxy_web_popup_title", {
        title: "PC-WEST-01 - Client - Site | Take Control",
      });
      expect(native.dispatch).toHaveBeenCalledWith({
        type: "UPDATE_SESSION",
        payload: {
          id: view.child.id,
          name: "PC-WEST-01 — Take Control",
        },
      });
      assertNoProxyOwnership();
      view.unmount();
      await act(async () => {
        await Promise.resolve();
      });
      expect(webPopupTabs.getSnapshot(view.child.id)).toBeNull();
      assertNoProxyOwnership();
    },
  );
  it("refreshes and navigates history on the shared listener while rejecting foreign addresses", async () => {
    const view = await shared();
    view.emit("proxy_document_start");
    view.emit("proxy_dom_ready");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(
      new URL(view.iframe.src).searchParams.get("__sorng_popup_parent_v1"),
    ).toBe("1");
    view.emit("proxy_document_start", { documentSequence: 3 });
    view.emit("proxy_dom_ready", { documentSequence: 3 });
    const input = screen.getByPlaceholderText("Enter URL...");
    fireEvent.change(input, {
      target: {
        value:
          "http://panel.example.test:81/takecontrol/agent-two?opaque=a%2fb+",
      },
    });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() =>
      expect(view.iframe.src).toContain(
        "takecontrol/agent-two?opaque=a%2fb+&__sorng_popup_parent_v1=1",
      ),
    );
    view.emit("proxy_document_start", {
      documentSequence: 4,
      url: view.iframe.src,
    });
    view.emit("proxy_dom_ready", { documentSequence: 4, url: view.iframe.src });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() =>
      expect(view.iframe.src).toContain(
        "takecontrol/agent-one?__sorng_popup_parent_v1=1",
      ),
    );
    fireEvent.change(input, {
      target: { value: "https://unapproved.example.test/" },
    });
    fireEvent.submit(input.closest("form")!);
    expect(view.iframe.src).not.toContain("unapproved");
    expect(
      screen.getByText("Shared browser navigation unavailable"),
    ).toBeVisible();
    assertNoProxyOwnership();
  });
  it("rejects root/wrong-parent reports without activating or completing the child", async () => {
    const view = await shared();
    view.emit("proxy_document_start", { popupParentSequence: 9 });
    view.emit("proxy_dom_ready", { popupParentSequence: 9 });
    view.emit("proxy_document_start", { documentSequence: 1 });
    view.emit("proxy_dom_ready", { documentSequence: 1 });
    expect(screen.getByRole("button", { name: "Stop loading" })).toBeEnabled();
    assertNoProxyOwnership();
  });
  it("sends page actions to the accepted child identity and rejects them after source revocation", async () => {
    const view = await shared();
    view.emit("proxy_document_start");
    view.emit("proxy_dom_ready");
    view.emit("proxy_dark_ready");
    fireEvent.click(screen.getByTitle("Print / Save as PDF"));
    await waitFor(() =>
      expect(view.post).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "print",
          documentSequence: 2,
          documentToken: "b".repeat(32),
          sessionId: proxy.session_id,
        }),
        new URL(proxy.proxy_url).origin,
      ),
    );
    const request = view.post.mock.calls.find(
      ([value]) => value.action === "print",
    )![0];
    view.emit("proxy_web_automation", {
      ...request,
      type: "proxy_web_automation",
      status: "ok",
    });
    act(() => view.expire());
    view.post.mockClear();
    fireEvent.click(screen.getByTitle("Print / Save as PDF"));
    expect(
      view.post.mock.calls.filter(([value]) => value.action === "print"),
    ).toEqual([]);
    assertNoProxyOwnership();
  });
});

describe("live website bookmark editor", () => {
  async function editor() {
    native.connections[0].httpBookmarks = [
      { name: "Home", path: "/" },
      {
        name: "Tools",
        isFolder: true,
        children: [{ name: "Files", path: "/files" }],
      },
    ];
    const connection = native.connections[0];
    const session: ConnectionSession = {
      id: "bookmark-session",
      connectionId: connection.id,
      ownerDatabaseId: "owned-demo",
      name: connection.name,
      hostname: connection.hostname,
      protocol: "http",
      status: "connected",
      startTime: new Date(),
    };
    native.sessions = [session];
    const hook = renderHook(() => useWebBrowser(session));
    await waitFor(() =>
      expect(native.invoke).toHaveBeenCalledWith(
        "start_basic_auth_proxy",
        expect.anything(),
      ),
    );
    native.dispatch.mockClear();
    return hook;
  }
  it.each([false, true])(
    "saves the name and URL without navigating (inside folder=%s)",
    async (nested) => {
      const hook = await editor();
      act(() =>
        hook.result.current.beginEditBookmark(
          nested ? 1 : 0,
          nested ? 0 : undefined,
        ),
      );
      act(() =>
        hook.result.current.setBookmarkEdit(
          (draft) =>
            draft && {
              ...draft,
              name: " New title ",
              path: " https://other.example.test/new?q=1#files ",
            },
        ),
      );
      native.invoke.mockClear();
      const before = structuredClone(native.connections[0]);
      act(() => hook.result.current.saveBookmarkEdit());
      const action = native.dispatch.mock.calls.find(
        ([value]) => value.type === "UPDATE_CONNECTION",
      )?.[0];
      expect(action).toBeDefined();
      const saved = nested
        ? action.payload.httpBookmarks[1].children[0]
        : action.payload.httpBookmarks[0];
      expect(saved).toEqual({
        name: "New title",
        path: "https://other.example.test/new?q=1#files",
      });
      expect(native.connections[0]).toEqual(before);
      expect(hook.result.current.bookmarkEdit).toBeNull();
      expect(
        native.invoke.mock.calls.filter(([command]) =>
          [
            "start_basic_auth_proxy",
            "stop_basic_auth_proxy",
            "navigate_proxy_session",
          ].includes(command),
        ),
      ).toEqual([]);
    },
  );
  it.each([
    "javascript:alert(1)",
    "https://user:password@host.test/",
    "",
    "file:///file",
  ])("refuses unsafe or empty URL %j without saving", async (path) => {
    const hook = await editor();
    act(() => hook.result.current.beginEditBookmark(0));
    act(() =>
      hook.result.current.setBookmarkEdit(
        (draft) => draft && { ...draft, path },
      ),
    );
    act(() => hook.result.current.saveBookmarkEdit());
    expect(hook.result.current.bookmarkEdit?.error).toMatch(/valid HTTP/);
    expect(native.dispatch).not.toHaveBeenCalled();
  });
  it("does not overwrite a different bookmark if the list changes while editing", async () => {
    const hook = await editor();
    act(() => hook.result.current.beginEditBookmark(0));
    native.connections = [
      {
        ...native.connections[0],
        httpBookmarks: [
          { name: "Someone else's new bookmark", path: "/other" },
        ],
      },
    ];
    hook.rerender();
    act(() => hook.result.current.saveBookmarkEdit());
    expect(hook.result.current.bookmarkEdit?.error).toMatch(
      /bookmarks or owning database changed/,
    );
    expect(native.dispatch).not.toHaveBeenCalled();
  });
  it("cancels an edit without changing connection data", async () => {
    const hook = await editor();
    act(() => hook.result.current.beginEditBookmark(0));
    act(() => hook.result.current.setBookmarkEdit(null));
    act(() => hook.result.current.saveBookmarkEdit());
    expect(native.dispatch).not.toHaveBeenCalled();
  });
  it("refuses to save a draft after the owning database lease changes", async () => {
    const hook = await editor();
    act(() => hook.result.current.beginEditBookmark(0));
    const original = native.databaseAvailability;
    try {
      native.databaseAvailability = {
        ...original,
        generation: original.generation + 1,
      };
      hook.rerender();
      native.dispatch.mockClear();
      act(() => hook.result.current.saveBookmarkEdit());
      expect(hook.result.current.bookmarkEdit?.error).toMatch(
        /owning database changed/,
      );
      expect(native.dispatch).not.toHaveBeenCalled();
    } finally {
      hook.unmount();
      native.databaseAvailability = original;
    }
  });
});
describe("live website bookmark drag and drop", () => {
  const home = { name: "Home", path: "/" };
  const files = { name: "Files", path: "/files" };
  const logs = { name: "Logs", path: "/logs" };
  const folder = (
    name: string,
    children: HttpBookmarkItem[] = [],
  ): HttpBookmarkItem => ({
    name,
    isFolder: true,
    children,
  });
  function dragEvent() {
    const data = new Map<string, string>();
    return {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: {
        get types() {
          return [...data.keys()];
        },
        files: [],
        effectAllowed: "none",
        dropEffect: "none",
        setData: vi.fn((type: string, value: string) => data.set(type, value)),
        getData: vi.fn((type: string) => data.get(type) ?? ""),
      },
    } as unknown as React.DragEvent;
  }
  async function dragHook(items: HttpBookmarkItem[]) {
    native.connections[0].httpBookmarks = structuredClone(items);
    const connection = native.connections[0];
    const session: ConnectionSession = {
      id: "bookmark-drag-session",
      connectionId: connection.id,
      ownerDatabaseId: "owned-demo",
      name: connection.name,
      hostname: connection.hostname,
      protocol: "http",
      status: "connected",
      startTime: new Date(),
    };
    native.sessions = [session];
    const hook = renderHook(({ session }) => useWebBrowser(session), {
      initialProps: { session },
    });
    await waitFor(() =>
      expect(native.invoke).toHaveBeenCalledWith(
        "start_basic_auth_proxy",
        expect.anything(),
      ),
    );
    native.dispatch.mockClear();
    return { ...hook, session };
  }
  function expectBookmarkOnlyEdit(
    before: Connection,
    expected: HttpBookmarkItem[],
  ) {
    expect(native.dispatch).toHaveBeenCalledTimes(1);
    expect(native.dispatch).toHaveBeenCalledWith({
      type: "UPDATE_CONNECTION",
      payload: { ...before, httpBookmarks: expected },
    });
    expect(native.connections[0]).toEqual(before);
  }

  it.each([
    { before: true, filled: false },
    { before: true, filled: true },
    { before: false, filled: false },
    { before: false, filled: true },
  ])(
    "dispatches only a bookmark edit for root-to-folder (source before=$before, filled=$filled)",
    async ({ before, filled }) => {
      const children = filled ? [files] : [];
      const tools = folder("Tools", children);
      const hook = await dragHook(before ? [home, tools] : [tools, home]);
      const connection = structuredClone(native.connections[0]);
      const event = dragEvent();
      act(() => hook.result.current.handleDragStart(before ? 0 : 1)(event));
      act(() => hook.result.current.handleDragOver(before ? 1 : 0)(event));
      act(() => hook.result.current.handleDrop(before ? 1 : 0)(event));
      expectBookmarkOnlyEdit(connection, [
        folder("Tools", [...children, home]),
      ]);
      expect(hook.result.current.dragOverIdx).toBeNull();
      native.dispatch.mockClear();
      act(() => hook.result.current.handleDrop(null)(event));
      expect(native.dispatch).not.toHaveBeenCalled();
    },
  );

  it.each([
    "external",
    "cancelled",
    "self",
    "same folder",
    "invalid source",
    "invalid target",
  ])("ignores %s drops", async (kind) => {
    const hook = await dragHook([home, folder("Tools", [files])]);
    const event = dragEvent();
    event.dataTransfer.setData("text/plain", "0");
    if (kind !== "external") {
      act(() =>
        hook.result.current.handleDragStart(
          kind === "invalid source" ? 99 : kind === "same folder" ? 1 : 0,
          kind === "same folder" ? 0 : undefined,
        )(event),
      );
    }
    if (kind === "cancelled") act(() => hook.result.current.handleDragEnd());
    act(() =>
      hook.result.current.handleDrop(
        kind === "self" ? 0 : kind === "invalid target" ? 99 : 1,
      )(event),
    );
    expect(native.dispatch).not.toHaveBeenCalled();
    expect(hook.result.current.dragOverIdx).toBeNull();
  });

  it.each(["connection", "owner", "lease", "bookmarks"])(
    "rejects a drag after its %s changes",
    async (changed) => {
      const hook = await dragHook([home, folder("Tools", [files])]);
      const event = dragEvent();
      act(() => hook.result.current.handleDragStart(0)(event));
      const availability = native.databaseAvailability;
      let session = hook.session;
      try {
        if (changed === "connection") {
          native.connections = [
            { ...native.connections[0], id: "replacement" },
          ];
          session = { ...session, connectionId: "replacement" };
        } else if (changed === "owner") {
          session = { ...session, ownerDatabaseId: "another-database" };
        } else if (changed === "lease") {
          native.databaseAvailability = {
            ...availability,
            generation: availability.generation + 1,
          };
        } else {
          // Even an in-place edit must invalidate the serialized drag snapshot.
          native.connections[0].httpBookmarks![0].name =
            "Changed while dragging";
        }
        hook.rerender({ session });
        native.dispatch.mockClear();
        act(() => hook.result.current.handleDrop(1)(event));
        expect(native.dispatch).not.toHaveBeenCalled();
      } finally {
        hook.unmount();
        native.databaseAvailability = availability;
      }
    },
  );

  it("accepts an equivalent bookmark snapshot after an unrelated connection edit", async () => {
    const hook = await dragHook([home, folder("Tools", [files])]);
    const event = dragEvent();
    act(() => hook.result.current.handleDragStart(0)(event));
    native.connections = [
      { ...structuredClone(native.connections[0]), name: "New label" },
    ];
    hook.rerender({ session: hook.session });
    const before = structuredClone(native.connections[0]);
    act(() => hook.result.current.handleDrop(1)(event));
    expectBookmarkOnlyEdit(before, [folder("Tools", [files, home])]);
  });

  it.each([false, true])(
    "drops onto an open folder dropdown (filled=%s)",
    async (filled) => {
      native.connections[0].httpBookmarks = [
        home,
        folder("Tools", filled ? [files] : []),
      ];
      await mount();
      fireEvent.click(screen.getByRole("button", { name: "Tools" }));
      const target = filled
        ? await screen.findByRole("button", { name: "Files" })
        : screen.getByText("Empty folder");
      await waitFor(() => expect(target).toBeVisible());
      const event = dragEvent();
      native.dispatch.mockClear();
      const before = structuredClone(native.connections[0]);
      fireEvent.dragStart(screen.getByRole("button", { name: "Home" }), event);
      fireEvent.dragOver(target, event);
      fireEvent.drop(target, event);
      expectBookmarkOnlyEdit(before, [
        folder("Tools", filled ? [files, home] : [home]),
      ]);
    },
  );

  it.each(["folder", "bookmark", "bar"])(
    "drags a dropdown child onto a root %s",
    async (target) => {
      native.connections[0].httpBookmarks = [
        home,
        folder("Source", [files]),
        folder("Target", [logs]),
      ];
      await mount();
      fireEvent.click(screen.getByRole("button", { name: "Source" }));
      const child = await screen.findByRole("button", { name: "Files" });
      expect(child).toHaveAttribute("draggable", "true");
      const destination =
        target === "folder"
          ? screen.getByRole("button", { name: "Target" })
          : target === "bookmark"
            ? screen.getByRole("button", { name: "Home" })
            : screen.getByTestId("web-bookmark-scroll");
      const event = dragEvent();
      native.dispatch.mockClear();
      const before = structuredClone(native.connections[0]);
      fireEvent.dragStart(child, event);
      fireEvent.dragOver(destination, event);
      fireEvent.drop(destination, event);
      expectBookmarkOnlyEdit(
        before,
        target === "folder"
          ? [home, folder("Source"), folder("Target", [logs, files])]
          : target === "bookmark"
            ? [files, home, folder("Source"), folder("Target", [logs])]
            : [home, folder("Source"), folder("Target", [logs]), files],
      );
    },
  );

  it.each([
    { type: "text/uri-list", destination: "bar" },
    { type: "text/uri-list", destination: "folder" },
    { type: "text/uri-list", destination: "bookmark" },
    { type: "text/uri-list", destination: "scroll lane" },
    { type: "text/uri-list", destination: "empty bar" },
    { type: "text/plain", destination: "bar" },
  ])(
    "imports an external $type URL onto the $destination without moving existing bookmarks or navigating",
    async ({ type, destination }) => {
      native.connections[0].httpBookmarks = [
        home,
        folder("Tools", [files]),
        logs,
      ];
      if (destination === "empty bar") native.connections[0].httpBookmarks = [];
      const { iframe, post, rerender } = await mount();
      const src = iframe.src;
      const before = structuredClone(native.connections[0]);
      native.persistedConnections = structuredClone(native.connections);
      const event = dragEvent();
      event.dataTransfer.setData(
        type,
        "https://EXTERNAL.example.test:443/reports/../files?q=1#latest",
      );
      const target =
        destination === "bar" || destination === "empty bar"
          ? screen.getByTestId("web-bookmark-bar")
          : destination === "scroll lane"
            ? screen.getByTestId("web-bookmark-scroll")
            : screen.getByRole("button", {
                name: destination === "folder" ? "Tools" : "Logs",
              });
      native.dispatch.mockClear();
      native.invoke.mockClear();
      post.mockClear();
      fireEvent.dragOver(target, event);
      fireEvent.drop(target, event);
      const imported = {
        name: "external.example.test",
        path: "https://external.example.test/files?q=1#latest",
      };
      expectBookmarkOnlyEdit(
        before,
        destination === "empty bar"
          ? [imported]
          : destination === "bar" || destination === "scroll lane"
            ? [home, folder("Tools", [files]), logs, imported]
            : destination === "folder"
              ? [home, folder("Tools", [files, imported]), logs]
              : [home, folder("Tools", [files]), imported, logs],
      );
      native.connections = [native.dispatch.mock.calls[0][0].payload];
      await act(async () =>
        rerender(<WebBrowser session={native.sessions[0]} />),
      );
      expect(document.querySelector("iframe")).toBe(iframe);
      expect(iframe.src).toBe(src);
      expect(
        native.invoke.mock.calls.filter(([command]) =>
          [
            "start_basic_auth_proxy",
            "stop_basic_auth_proxy",
            "navigate_proxy_session",
          ].includes(command),
        ),
      ).toEqual([]);
      expect(post).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      label: "plain prose",
      type: "text/plain",
      value: "Read the latest report",
    },
    { label: "malformed URL", type: "text/plain", value: "https://" },
    { label: "script", type: "text/uri-list", value: "javascript:alert(1)" },
    {
      label: "file URL",
      type: "text/uri-list",
      value: "file:///C:/report.html",
    },
    { label: "file-typed drag", type: "Files", value: "report.html" },
    {
      label: "internal marker without local source",
      type: "application/x-sorng-http-bookmark",
      value: "0",
    },
  ])("ignores an external $label drop", async ({ label, type, value }) => {
    native.connections[0].httpBookmarks = [
      home,
      folder("Tools", [files]),
      logs,
    ];
    const { iframe } = await mount();
    const before = structuredClone(native.connections[0]);
    const src = iframe.src;
    const event = dragEvent();
    event.dataTransfer.setData(type, value);
    if (
      label === "file-typed drag" ||
      label === "internal marker without local source"
    ) {
      event.dataTransfer.setData(
        "text/uri-list",
        "https://external.example.test/files",
      );
      event.dataTransfer.setData(
        "text/plain",
        "https://external.example.test/files",
      );
    }
    native.dispatch.mockClear();
    native.invoke.mockClear();
    const bar = screen.getByTestId("web-bookmark-bar");
    fireEvent.dragOver(bar, event);
    fireEvent.drop(bar, event);
    expect(native.dispatch).not.toHaveBeenCalled();
    expect(native.connections[0]).toEqual(before);
    expect(iframe.src).toBe(src);
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it("imports an iframe proxy alias as its upstream URL without navigation or generation tokens", async () => {
    native.connections[0].httpBookmarks = [home, folder("Tools", [files])];
    const { iframe } = await mount();
    const src = iframe.src;
    const before = structuredClone(native.connections[0]);
    const url = new URL(
      "/reports/latest?q=1&__sorng_generation_v1=42&__sorng_navigation_v1=" +
        "a".repeat(32) +
        "&view=full#summary",
      iframe.src,
    );
    const event = dragEvent();
    event.dataTransfer.setData("text/uri-list", url.href);
    native.dispatch.mockClear();
    native.invoke.mockClear();
    const bar = screen.getByTestId("web-bookmark-bar");
    fireEvent.dragOver(bar, event);
    fireEvent.drop(bar, event);
    expectBookmarkOnlyEdit(before, [
      home,
      folder("Tools", [files]),
      {
        name: "panel.example.test:81",
        path: "http://panel.example.test:81/reports/latest?q=1&view=full#summary",
      },
    ]);
    expect(iframe.src).toBe(src);
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it("reorders folder chips without nesting", async () => {
    const source = folder("Source", [files]);
    const target = folder("Target", [logs]);
    native.connections[0].httpBookmarks = [source, target];
    await mount();
    native.dispatch.mockClear();
    const before = structuredClone(native.connections[0]);
    const event = dragEvent();
    fireEvent.dragStart(screen.getByRole("button", { name: "Source" }), event);
    fireEvent.drop(screen.getByRole("button", { name: "Target" }), event);
    expectBookmarkOnlyEdit(before, [target, source]);
  });

  it("keeps the active iframe and dark mode through a real drop and pending bookmark persistence", async () => {
    native.connections[0].httpBookmarks = [home, folder("Tools", [files])];
    const { iframe, post, emit, rerender } = await mount();
    emit("proxy_document_start");
    emit("proxy_dom_ready");
    await waitFor(() =>
      expect(
        post.mock.calls.some(
          ([data]) => data.action === "dark" && data.payload.enabled,
        ),
      ).toBe(true),
    );
    for (const [data] of [...post.mock.calls])
      if (data.action === "dark")
        emit("proxy_web_automation", { ...data, status: "ok" });
    emit("proxy_dark_ready");
    const src = iframe.src;
    native.persistedConnections = structuredClone(native.connections);
    const before = structuredClone(native.connections[0]);
    native.dispatch.mockClear();
    native.invoke.mockClear();
    post.mockClear();
    const event = dragEvent();
    fireEvent.dragStart(screen.getByRole("button", { name: "Home" }), event);
    fireEvent.drop(screen.getByRole("button", { name: "Tools" }), event);
    expectBookmarkOnlyEdit(before, [folder("Tools", [files, home])]);
    native.connections = [native.dispatch.mock.calls[0][0].payload];
    await act(async () =>
      rerender(<WebBrowser session={native.sessions[0]} />),
    );
    expect(document.querySelector("iframe")).toBe(iframe);
    expect(iframe.src).toBe(src);
    expect(iframe).not.toHaveAttribute("inert");
    expect(screen.queryByTestId("web-dark-paint-shield")).toBeNull();
    expect(
      post.mock.calls.filter(
        ([data]) => data.action === "dark" && data.payload.enabled === false,
      ),
    ).toEqual([]);
    expect(
      native.invoke.mock.calls.filter(([command]) =>
        [
          "start_basic_auth_proxy",
          "stop_basic_auth_proxy",
          "navigate_proxy_session",
        ].includes(command),
      ),
    ).toEqual([]);
  });
});

describe("cPanel session-aware bookmarks", () => {
  const saved = "/cpsess111111/frontend/jupiter/";
  const live = "/cpsess222222/frontend/jupiter/";
  async function panel() {
    native.connections[0].httpBookmarks = [
      {
        name: "File Manager",
        path: `${saved}filemanager/index.html?dir=%2Fhome#files`,
      },
      {
        name: "cPanel tools",
        isFolder: true,
        children: [{ name: "Databases", path: `${saved}sql/index.html` }],
      },
    ];
    const view = await mount();
    view.emit("proxy_document_start");
    view.emit("proxy_dom_ready");
    const arrived = {
      documentToken: "e".repeat(32),
      documentSequence: 2,
      navigationToken: null,
      url: new URL(`${live}index.html`, proxy.proxy_url).href,
    };
    view.emit("proxy_document_start", arrived);
    view.emit("proxy_dom_ready", arrived);
    await waitFor(() =>
      expect(screen.getByPlaceholderText("Enter URL...")).toHaveValue(
        `http://panel.example.test:81${live}index.html`,
      ),
    );
    native.dispatch.mockClear();
    return view;
  }

  it.each([false, true])(
    "opens a saved bookmark with the live slug without replacing its proxy (folder=%s)",
    async (nested) => {
      const { iframe } = await panel();
      const savedBookmarks = structuredClone(
        native.connections[0].httpBookmarks,
      );
      // A draft in the address bar is not a new session.
      fireEvent.change(screen.getByPlaceholderText("Enter URL..."), {
        target: { value: "http://panel.example.test:81/cpsess999999/" },
      });
      if (nested)
        fireEvent.click(screen.getByRole("button", { name: "cPanel tools" }));
      fireEvent.click(
        await screen.findByRole("button", {
          name: nested ? "Databases" : "File Manager",
        }),
      );
      await waitFor(() =>
        expect(new URL(iframe.src).pathname).toBe(
          `${live}${nested ? "sql/index.html" : "filemanager/index.html"}`,
        ),
      );
      if (!nested) {
        expect(iframe.src).toContain("dir=%2Fhome");
        expect(new URL(iframe.src).hash).toBe("#files");
      }
      expect(document.querySelector("iframe")).toBe(iframe);
      expect(
        native.invoke.mock.calls.filter(
          ([command]) => command === "start_basic_auth_proxy",
        ),
      ).toHaveLength(1);
      expect(
        native.invoke.mock.calls.filter(
          ([command]) => command === "stop_basic_auth_proxy",
        ),
      ).toHaveLength(0);
      expect(native.connections[0].httpBookmarks).toEqual(savedBookmarks);
      expect(
        native.dispatch.mock.calls.filter(
          ([action]) => action.type === "UPDATE_CONNECTION",
        ),
      ).toEqual([]);
    },
  );

  it("updates copied URLs after another login and forgets the slug on logout", async () => {
    const { emit } = await panel();
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "clipboard",
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    try {
      for (const [sequence, path, expected] of [
        [3, "/cpsess333333/frontend/jupiter/index.html", "/cpsess333333"],
        [4, "/login/", "/cpsess111111"],
      ] as const) {
        const arrived = {
          documentToken: sequence.toString().repeat(32),
          documentSequence: sequence,
          navigationToken: null,
          url: new URL(path, proxy.proxy_url).href,
        };
        emit("proxy_document_start", arrived);
        emit("proxy_dom_ready", arrived);
        fireEvent.contextMenu(
          screen.getByRole("button", { name: "File Manager" }),
        );
        fireEvent.click(screen.getByRole("button", { name: "Copy URL" }));
        expect(writeText).toHaveBeenLastCalledWith(
          `http://panel.example.test:81${expected}/frontend/jupiter/filemanager/index.html?dir=%2Fhome#files`,
        );
      }
    } finally {
      if (clipboardDescriptor)
        Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("recognizes an old-session bookmark as current and does not save a duplicate", async () => {
    const { emit } = await panel();
    const arrived = {
      documentToken: "f".repeat(32),
      documentSequence: 3,
      navigationToken: null,
      url: new URL(
        `${live}filemanager/index.html?dir=%2Fhome#files`,
        proxy.proxy_url,
      ).href,
    };
    emit("proxy_document_start", arrived);
    emit("proxy_dom_ready", arrived);
    expect(screen.getByRole("button", { name: "File Manager" })).toHaveClass(
      "font-semibold",
    );
    fireEvent.click(screen.getByTitle("Page is bookmarked"));
    expect(
      native.dispatch.mock.calls.filter(
        ([action]) => action.type === "UPDATE_CONNECTION",
      ),
    ).toEqual([]);
  });

  it("keeps double-slash page paths on the current host when adding a bookmark", async () => {
    const { emit } = await panel();
    const arrived = {
      documentToken: "f".repeat(32),
      documentSequence: 3,
      navigationToken: null,
      url: `${proxy.proxy_url}/files?view=list#home`,
    };
    emit("proxy_document_start", arrived);
    emit("proxy_dom_ready", arrived);
    fireEvent.click(screen.getByTitle("Bookmark this page"));
    const saved = native.dispatch.mock.calls
      .find(([action]) => action.type === "UPDATE_CONNECTION")?.[0]
      .payload.httpBookmarks.at(-1);
    expect(saved?.path).toBe(
      "http://panel.example.test:81//files?view=list#home",
    );
  });
});

describe("real WebBrowser iframe and website automation integration", () => {
  it("keeps the live document and dark mode when labels and bookmark URLs change before their save finishes", async () => {
    const { iframe, post, emit, rerender } = await mount();
    emit("proxy_document_start");
    emit("proxy_dom_ready");
    await waitFor(() =>
      expect(
        post.mock.calls.some(
          ([data]) => data.action === "dark" && data.payload.enabled,
        ),
      ).toBe(true),
    );
    for (const [data] of [...post.mock.calls])
      if (data.action === "dark")
        emit("proxy_web_automation", { ...data, status: "ok" });
    emit("proxy_dark_ready");
    const src = iframe.src;
    native.persistedConnections = structuredClone(native.connections);
    post.mockClear();
    native.invoke.mockClear();
    for (const changes of [
      { name: "Renamed panel" },
      { httpBookmarks: [{ name: "Files", path: "/files" }] },
      {
        httpBookmarks: [
          { name: "Renamed files", path: "https://other.example.test/files" },
        ],
      },
      { httpBookmarks: [] },
      {
        httpAutomation: { ...native.connections[0].httpAutomation!, items: [] },
      },
    ]) {
      native.connections = [
        { ...native.connections[0], ...changes, updatedAt: "2026-09-26" },
      ];
      await act(async () =>
        rerender(<WebBrowser session={native.sessions[0]} />),
      );
      expect(document.querySelector("iframe")).toBe(iframe);
      expect(iframe.src).toBe(src);
      expect(screen.queryByTestId("web-dark-paint-shield")).toBeNull();
      expect(
        post.mock.calls.filter(
          ([data]) => data.action === "dark" && !data.payload.enabled,
        ),
      ).toEqual([]);
      expect(
        native.invoke.mock.calls.filter(([command]) =>
          ["start_basic_auth_proxy", "stop_basic_auth_proxy"].includes(command),
        ),
      ).toEqual([]);
      expect(
        native.invoke.mock.calls.filter(
          ([command, args]) =>
            command === "update_proxy_website_dark_mode" &&
            args.palette === null,
        ),
      ).toEqual([]);
    }
  });
  it("never sends dark-off while restoring saved appearance on successive website documents", async () => {
    const { iframe, post, emit, identity } = await mount();
    const firstSrc = iframe.src;
    for (let sequence = 1; sequence <= 3; sequence++) {
      if (sequence > 1) {
        emit("proxy_navigation_start", {
          documentSequence: sequence - 1,
          documentToken: (sequence - 1).toString(16).repeat(32),
          navigationToken: sequence === 2 ? identity.navigationToken : null,
        });
      }
      const documentIdentity = {
        documentSequence: sequence,
        documentToken: sequence.toString(16).repeat(32),
        navigationToken: sequence === 1 ? identity.navigationToken : null,
      };
      emit("proxy_document_start", documentIdentity);
      emit("proxy_dom_ready", documentIdentity);
      await waitFor(() =>
        expect(
          post.mock.calls.some(
            ([data]) =>
              data.documentSequence === sequence &&
              data.action === "dark" &&
              data.payload.enabled === true,
          ),
        ).toBe(true),
      );
      await act(async () => {
        for (const [data] of [...post.mock.calls])
          if (data.documentSequence === sequence && data.action === "dark")
            emit("proxy_web_automation", { ...data, status: "ok" });
        emit("proxy_dark_ready", documentIdentity);
      });
      expect(screen.queryByTestId("web-dark-paint-shield")).toBeNull();
    }
    expect(
      post.mock.calls.filter(
        ([data]) => data.action === "dark" && data.payload.enabled === false,
      ),
    ).toEqual([]);
    expect(iframe.src).toBe(firstSrc);
    expect(
      native.invoke.mock.calls.filter(
        ([command]) => command === "start_basic_auth_proxy",
      ),
    ).toHaveLength(1);
  });

  it("reapplies saved appearance and global defaults without replacing the iframe or restarting authentication", async () => {
    const { iframe, post, emit, rerender } = await mount();
    expect(native.invoke).toHaveBeenCalledWith("start_basic_auth_proxy", {
      config: expect.objectContaining({
        website_dark_mode: {
          backgroundColor: "#181a1b",
          textColor: "#e8e6e3",
        },
      }),
    });
    emit("proxy_document_start");
    emit("proxy_dom_ready");
    await waitFor(() =>
      expect(
        post.mock.calls.some(
          ([data]) => data.action === "dark" && data.payload.enabled,
        ),
      ).toBe(true),
    );
    const session = native.sessions[0];
    for (const [data] of post.mock.calls)
      if (data.action === "dark")
        emit("proxy_web_automation", { ...data, status: "ok" });
    const started = native.invoke.mock.calls.filter(
      ([command]) => command === "start_basic_auth_proxy",
    ).length;
    native.connections = [
      {
        ...native.connections[0],
        httpAutomation: {
          ...native.connections[0].httpAutomation!,
          darkMode: {
            ...normalizeWebsiteDarkModeConfig(undefined),
            useGlobalDefaults: false,
            theme: {
              ...normalizeWebsiteDarkModeConfig(undefined).theme,
              brightness: 72,
              backgroundColor: "#101112",
            },
          },
        },
      },
    ];
    native.persistedConnections = structuredClone(native.connections);
    rerender(<WebBrowser session={session} />);
    await waitFor(() =>
      expect(
        post.mock.calls.some(
          ([data]) =>
            data.action === "dark" &&
            data.payload.enabled &&
            data.payload.theme.brightness === 72,
        ),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(native.invoke).toHaveBeenCalledWith(
        "update_proxy_website_dark_mode",
        {
          sessionId: proxy.session_id,
          palette: {
            backgroundColor: "#101112",
            textColor: "#e8e6e3",
          },
        },
      ),
    );
    for (const [data] of post.mock.calls)
      if (data.action === "dark")
        emit("proxy_web_automation", { ...data, status: "ok" });
    native.connections = [
      {
        ...native.connections[0],
        httpAutomation: {
          ...native.connections[0].httpAutomation!,
          darkMode: normalizeWebsiteDarkModeConfig(undefined),
        },
      },
    ];
    native.persistedConnections = structuredClone(native.connections);
    const global = normalizeWebsiteDarkModeSettings(undefined);
    global.defaults.brightness = 83;
    global.defaults.backgroundColor = "#202122";
    Object.assign(native.settings, { websiteDarkMode: global });
    rerender(<WebBrowser session={session} />);
    await waitFor(() =>
      expect(
        post.mock.calls.some(
          ([data]) =>
            data.action === "dark" &&
            data.payload.enabled &&
            data.payload.theme.brightness === 83,
        ),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(native.invoke).toHaveBeenCalledWith(
        "update_proxy_website_dark_mode",
        {
          sessionId: proxy.session_id,
          palette: {
            backgroundColor: "#202122",
            textColor: "#e8e6e3",
          },
        },
      ),
    );
    expect(screen.getByTitle(session.name)).toBe(iframe);
    expect(
      native.invoke.mock.calls.filter(
        ([command]) => command === "start_basic_auth_proxy",
      ),
    ).toHaveLength(started);
    expect(
      native.invoke.mock.calls.some(
        ([command]) => command === "stop_basic_auth_proxy",
      ),
    ).toBe(false);
  });

  it("does not send an optimistic unsaved dark palette to the proxy", async () => {
    const { rerender } = await mount();
    // Startup passes the durable palette with allocation, not a redundant
    // update that depended on a new mock database lease on every render.
    expect(native.invoke).toHaveBeenCalledWith("start_basic_auth_proxy", {
      config: expect.objectContaining({
        website_dark_mode: {
          backgroundColor: "#181a1b",
          textColor: "#e8e6e3",
        },
      }),
    });
    native.invoke.mockClear();
    native.persistedConnections = structuredClone(native.connections);
    native.connections = [
      {
        ...native.connections[0],
        httpAutomation: {
          ...native.connections[0].httpAutomation!,
          darkMode: {
            ...normalizeWebsiteDarkModeConfig(undefined),
            useGlobalDefaults: false,
            theme: {
              ...normalizeWebsiteDarkModeConfig(undefined).theme,
              backgroundColor: "#abcdef",
            },
          },
        },
      },
    ];
    rerender(<WebBrowser session={native.sessions[0]} />);
    await waitFor(() =>
      expect(native.invoke).toHaveBeenCalledWith(
        "update_proxy_website_dark_mode",
        {
          sessionId: proxy.session_id,
          palette: {
            backgroundColor: "#181a1b",
            textColor: "#e8e6e3",
          },
        },
      ),
    );
    expect(native.invoke).not.toHaveBeenCalledWith(
      "update_proxy_website_dark_mode",
      expect.objectContaining({
        palette: expect.objectContaining({ backgroundColor: "#abcdef" }),
      }),
    );
  });
  it.each([false, true])(
    "releases a replaced redirect registry only when no other tab owns it (other owner=%s)",
    async (otherOwner) => {
      const original = redirectHooks.useHttpRedirectReview;
      let replace: ((connection: Connection) => void) | undefined;
      vi.spyOn(redirectHooks, "useHttpRedirectReview").mockImplementation(
        (options) => {
          replace = options.continueInTab;
          return original(options);
        },
      );
      const source = native.connections[0];
      registerRuntimeConnection(source);
      const view = await mount();
      if (otherOwner)
        native.sessions.push({ ...native.sessions[0], id: "other-tab" });
      const target = {
        ...source,
        id: "new-redirect",
        hostname: "new.example.test",
      };
      act(() => replace!(target));
      expect(native.dispatch).toHaveBeenCalledWith({
        type: "UPDATE_SESSION",
        payload: expect.objectContaining({
          id: "web-session",
          connectionId: target.id,
        }),
      });
      expect(resolveRuntimeConnection([], source.id)).toBe(
        otherOwner ? source : undefined,
      );
      expect(native.connections[0]).toBe(source);
      view.unmount();
    },
  );
  function configureVault(): DatabaseCredentialVaultApi {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    Object.assign(native.connections[0], {
      credentialSource: { kind: "vault", credentialId: id },
      authType: "basic",
      username: "IGNORED_USER",
      password: "IGNORED_PASSWORD",
      basicAuthUsername: "OLD_BASIC",
      basicAuthPassword: "OLD_BASIC_PASSWORD",
    });
    native.vaultApi = {
      scope: { databaseId: "owned-demo", generation: 1 },
      changeRevision: 1,
      list: vi.fn<DatabaseCredentialVaultApi["list"]>(async () => ({
        scope: { databaseId: "owned-demo", generation: 1 },
        revision: 1,
        receipt: "vault-review",
        entries: [
          {
            id,
            name: "Fixture login",
            createdAt: stamp,
            updatedAt: stamp,
            availableFacets: ["username", "password"],
          },
        ],
      })),
      resolve: vi.fn(async () => ({
        username: "VAULT_WEB_USER",
        password: "VAULT_WEB_PASSWORD",
      })),
      compareAndSwap: vi.fn(),
    };
    return native.vaultApi;
  }
  it("resolves a vault pair only for native start and never persists it or revives dedicated local Basic credentials", async () => {
    const api = configureVault();
    const view = await mount();
    expect(api.resolve).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      ["username", "password"],
    );
    expect(native.invoke).toHaveBeenCalledWith("start_basic_auth_proxy", {
      config: expect.objectContaining({
        username: "VAULT_WEB_USER",
        password: "VAULT_WEB_PASSWORD",
      }),
    });
    expect(JSON.stringify(native.dispatch.mock.calls)).not.toContain(
      "VAULT_WEB_PASSWORD",
    );
    expect(native.connections[0].password).toBe("IGNORED_PASSWORD");
    view.unmount();
  });
  it("refuses a deferred vault password if database access was revoked before native start", async () => {
    const api = configureVault();
    let finish!: (value: { username: string; password: string }) => void;
    vi.mocked(api.resolve).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const connection = native.connections[0];
    const view = render(
      <WebBrowser
        session={{
          id: "vault-web",
          connectionId: connection.id,
          ownerDatabaseId: "owned-demo",
          hostname: connection.hostname,
          name: connection.name,
          protocol: "http",
          status: "connecting",
          startTime: new Date(),
        }}
      />,
    );
    await waitFor(() => expect(api.resolve).toHaveBeenCalled());
    native.locked = true;
    await act(async () =>
      finish({ username: "VAULT_WEB_USER", password: "VAULT_WEB_PASSWORD" }),
    );
    expect(
      native.invoke.mock.calls.some(
        ([command]) => command === "start_basic_auth_proxy",
      ),
    ).toBe(false);
    expect(JSON.stringify(native.dispatch.mock.calls)).not.toContain(
      "VAULT_WEB_PASSWORD",
    );
    view.unmount();
  });
  it("mounts the automatic MFA guard and retains manual fallback for a non-HTTPS session", async () => {
    const consoleError = vi.spyOn(console, "error");
    native.connections[0].httpApplication = {
      version: 1,
      id: "wordpress",
      loginMode: "manual",
    };
    native.connections[0].httpAutoMfa = {
      version: 1,
      enabled: true,
      origin: "https://panel.example.test",
      challengeId: "wordpress-two-factor-totp",
      totpConfigId: "auth",
    };
    native.connections[0].totpConfigs = [];
    const view = await mount();
    view.emit("proxy_document_start");
    view.emit("proxy_dom_ready");
    fireEvent.click(screen.getByRole("button", { name: "Credentials & 2FA" }));
    expect(
      await screen.findByText(/Automatic 2FA stopped/),
    ).toBeInTheDocument();
    expect(
      native.invoke.mock.calls.some(
        ([command]) => command === "totp_compute_code",
      ),
    ).toBe(false);
    expect(
      view.post.mock.calls.some(([message]) => message.action === "totpSubmit"),
    ).toBe(false);
    expect(
      consoleError.mock.calls.some((args) =>
        args.some(
          (message) =>
            typeof message === "string" &&
            message.includes("Maximum update depth exceeded"),
        ),
      ),
    ).toBe(false);
  });
  it("opens the web-only 2FA panel in an anchored portal without moving the browser header or exposing seed-management actions", async () => {
    const { container } = await mount();
    const button = screen.getByRole("button", { name: "Credentials & 2FA" });
    expect(screen.queryByTestId("web-totp-popover")).not.toBeInTheDocument();
    fireEvent.click(button);
    const popover = await screen.findByTestId("web-totp-popover");
    expect(document.body).toContainElement(popover);
    expect(container).not.toContainElement(popover);
    expect(button.parentElement).not.toContainElement(popover);
    expect(screen.getByText(/Protocol → Recovery/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: /generate.*backup|export.*secret|auto.?type/i,
      }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByTestId("web-totp-popover")).not.toBeInTheDocument(),
    );
  });
  it("pins the labelled recorder outside the long bookmark scroll lane and preserves bookmark menus", async () => {
    native.connections[0].httpBookmarks = Array.from(
      { length: 40 },
      (_, index) => ({
        name: `Bookmark ${index + 1}`,
        path: `/page-${index + 1}`,
      }),
    );
    const { post, emit } = await mount();
    const controls = screen.getByTestId("web-macro-recording-controls");
    const lane = screen.getByTestId("web-bookmark-scroll");
    expect(lane).not.toContainElement(controls);
    expect(lane).toHaveClass("overflow-x-auto", "min-w-0");
    expect(screen.getByTestId("web-bookmark-bar")).not.toHaveClass(
      "overflow-x-auto",
    );
    expect(screen.getByRole("button", { name: "Record macro" })).toBeDisabled();
    emit("proxy_document_start");
    emit("proxy_dom_ready");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Record macro" }),
      ).toBeEnabled(),
    );
    expect(
      post.mock.calls.some(([data]) => data.action === "recordStart"),
    ).toBe(false);
    fireEvent.contextMenu(screen.getByRole("button", { name: "Bookmark 40" }), {
      clientX: 20,
      clientY: 40,
    });
    expect(screen.getByTestId("web-browser-bookmark-menu")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.contextMenu(lane, { clientX: 30, clientY: 40 });
    expect(
      screen.getByTestId("web-browser-bookmark-bar-menu"),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("web-macro-recording-controls")).toHaveLength(
      1,
    );
  });
  it("keeps manual scripts and macros blocked by the tab's effective browser default", async () => {
    native.settings.webBrowser = {
      ...normalizeWebBrowserSettings(undefined),
      defaultPolicy: normalizeHttpProxyPolicy({
        ...normalizeHttpProxyPolicy(undefined),
        pageScripts: "block",
      }),
    };
    native.connections[0].httpAutomation!.forceDark = false;
    const { post, emit } = await mount();
    const action = await screen.findByRole("button", {
      name: "Demo page action",
    });
    emit("proxy_document_start");
    emit("proxy_dom_ready");
    expect(action).toBeDisabled();
    expect(screen.getByRole("button", { name: "Record macro" })).toBeDisabled();
    fireEvent.click(action);
    expect(
      post.mock.calls.some(([message]) =>
        ["script", "step", "recordStart"].includes(message.action),
      ),
    ).toBe(false);
    expect(native.connections[0].httpProxyPolicy).toBeUndefined();
    expect(
      native.invoke.mock.calls.find(
        ([name]) => name === "start_basic_auth_proxy",
      )?.[1].config.proxy_policy.pageScripts,
    ).toBe("block");
  });

  it("exposes chips but arms no script or forced dark before authenticated document readiness", async () => {
    const { iframe, post, emit } = await mount();
    await screen.findByRole("button", { name: "Demo page action" });
    expect(
      screen.getByRole("button", { name: "Demo page action" }),
    ).toBeDisabled();
    expect(
      post.mock.calls.some(([data]) =>
        ["script", "dark"].includes(data.action),
      ),
    ).toBe(false);
    emit("proxy_document_start", {}, window);
    emit("proxy_dom_ready", {}, window);
    expect(
      screen.getByRole("button", { name: "Demo page action" }),
    ).toBeDisabled();
    emit("proxy_document_start");
    emit("proxy_dom_ready");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Demo page action" }),
      ).toBeEnabled(),
    );
    // DOM readiness enables automation; interaction waits for authenticated paint.
    expect(iframe).toHaveAttribute("inert");
    emit("proxy_dark_ready", {}, window);
    expect(iframe).toHaveAttribute("inert");
    emit("proxy_dark_ready");
    expect(iframe).not.toHaveAttribute("inert");
    await waitFor(() =>
      expect(
        post.mock.calls.some(
          ([data]) => data.action === "dark" && data.payload.enabled === true,
        ),
      ).toBe(true),
    );
    fireEvent.click(screen.getByRole("button", { name: "Demo page action" }));
    expect(post.mock.calls.some(([data]) => data.action === "script")).toBe(
      false,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Run on current page" }),
    );
    const request = await waitFor(() => {
      const call = post.mock.calls.find(([data]) => data.action === "script");
      expect(call).toBeDefined();
      return call![0];
    });
    emit("proxy_web_automation", { ...request, status: "ok" });
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Stop website action" }),
      ).toBeNull(),
    );
    expect(native.invoke.mock.calls.map(([command]) => command)).not.toContain(
      "execute_script",
    );
  });
  it("cancels a running action on actual internal document navigation, without reusing an old reply", async () => {
    const { post, emit, identity } = await mount();
    emit("proxy_document_start");
    emit("proxy_dom_ready");
    const chip = await screen.findByRole("button", {
      name: "Demo page action",
    });
    await waitFor(() => expect(chip).toBeEnabled());
    fireEvent.click(chip);
    fireEvent.click(
      await screen.findByRole("button", { name: "Run on current page" }),
    );
    const request = await waitFor(() => {
      const call = post.mock.calls.find(([data]) => data.action === "script");
      expect(call).toBeDefined();
      return call![0];
    });
    emit("proxy_navigation_start");
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Stop website action" }),
      ).toBeNull(),
    );
    expect(chip).toBeDisabled();
    emit("proxy_web_automation", { ...identity, ...request, status: "ok" });
    expect(chip).toBeDisabled();
    expect(
      post.mock.calls.some(
        ([data]) => data.action === "dark" && data.payload.enabled === false,
      ),
    ).toBe(false);
  });
});
