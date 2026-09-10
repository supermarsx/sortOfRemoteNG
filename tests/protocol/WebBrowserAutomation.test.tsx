import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  dispatch: vi.fn(),
  connections: [] as Connection[],
  locked: false,
  settings: {
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
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async () => () => undefined,
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => native.invoke,
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { connections: native.connections },
    dispatch: native.dispatch,
    dispatchAndFlush: native.dispatch,
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
vi.mock("../../src/utils/connection/databaseManager", () => ({
  onCurrentDatabaseChange: () => () => undefined,
  onDatabaseAccessChange: () => () => undefined,
  DatabaseManager: {
    getInstance: () => ({
      getCurrentDatabase: () => ({ id: "owned-demo" }),
      onCurrentDatabaseChange: () => () => undefined,
      captureCurrentDatabaseDataTarget: () => ({
        databaseId: "owned-demo",
        assertAccessible: () => {
          if (native.locked) throw new Error("locked");
        },
      }),
    }),
  },
}));
import { WebBrowser } from "../../src/components/protocol/WebBrowser";
import { normalizeWebAutomationLibrary } from "../../src/utils/recording/webAutomationLibrary";
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
  document.addEventListener("load", holdFrameLoad, true);
  native.locked = false;
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
  native.invoke.mockReset().mockImplementation(async (command) => {
    if (command === "start_basic_auth_proxy") return proxy;
    if (command === "stop_basic_auth_proxy") return undefined;
    if (command === "read_macro_library")
      return JSON.stringify(
        normalizeWebAutomationLibrary({
          version: 1,
          scripts: [script],
          macros: [],
        }),
      );
    throw new Error(`Unexpected native command ${command}`);
  });
});
afterEach(() => {
  cleanup();
  document.removeEventListener("load", holdFrameLoad, true);
  vi.restoreAllMocks();
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
  const view = render(<WebBrowser session={session} />);
  const iframe = screen.getByTitle(connection.name) as HTMLIFrameElement;
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
describe("real WebBrowser iframe and website automation integration", () => {
  it("opens the web-only 2FA panel in an anchored portal without moving the browser header or exposing seed-management actions", async () => {
    const { container } = await mount();
    const button = screen.getByRole("button", { name: "2FA Codes" });
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
    expect(iframe).not.toHaveAttribute("inert");
    expect(
      post.mock.calls.some(
        ([data]) => data.action === "dark" && data.payload.enabled === true,
      ),
    ).toBe(true);
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
    ).toBe(true);
  });
});
