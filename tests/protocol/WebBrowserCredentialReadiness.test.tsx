import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import { useWebBrowser } from "../../src/hooks/protocol/useWebBrowser";
import { useCredentialTyping } from "../../src/hooks/security/useCredentialTyping";
import { normalizeWebsiteDarkModeSettings } from "../../src/utils/connection/websiteDarkMode";
import { normalizeWebAutomationLibrary } from "../../src/utils/recording/webAutomationLibrary";
import { clearRuntimeConnectionsForTests } from "../../src/utils/session/runtimeConnectionRegistry";

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  connection: null as Connection | null,
  settings: {} as Record<string, unknown>,
  availability: { status: "ready", databaseId: "owner", generation: 1 },
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, ...args: unknown[]) =>
    native.invoke(command, ...args),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => native.invoke,
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { connections: [native.connection], sessions: [] },
    databaseAvailability: native.availability,
    dispatch: vi.fn(),
    dispatchAndFlush: vi.fn(),
    recycleBin: { snapshot: { scope: { databaseId: "owner", generation: 1 } } },
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
  const manager = {
    getCurrentDatabase: () => ({ id: "owner" }),
    onCurrentDatabaseChange: () => () => {},
    captureCurrentDatabaseDataTarget: () => ({
      databaseId: "owner",
      assertAccessible: () => {},
      verifyCurrent: async () => {},
      readCurrent: async () => ({ connections: [native.connection] }),
    }),
  };
  return {
    DatabaseManager: { getInstance: () => manager },
    onCurrentDatabaseChange: () => () => {},
    onDatabaseAccessChange: () => () => {},
  };
});
const session: ConnectionSession = {
  id: "web-session",
  connectionId: "saved",
  ownerDatabaseId: "owner",
  name: "Session",
  hostname: "panel.example.test",
  protocol: "http",
  status: "connected",
  startTime: new Date(),
};
function Harness() {
  const browser = useWebBrowser(session);
  const typing = useCredentialTyping(
    browser.showTotpPanel,
    browser.captureCredentialTarget,
  );
  return (
    <>
      {browser.shouldMountIframe && (
        <iframe title="Session" ref={browser.attachIframe} />
      )}
      <output>{browser.pageInteractionBlocked ? "Blocked" : "Ready"}</output>
      <button
        onPointerDown={typing.onPointerDown}
        onClick={() => browser.setShowTotpPanel(!browser.showTotpPanel)}
      >
        Credentials
      </button>
      {browser.showTotpPanel && (
        <div ref={typing.popupRef}>
          <button
            disabled={!typing.target}
            onClick={() => void typing.target?.type("test-password", () => {})}
          >
            Type password
          </button>
        </div>
      )}
    </>
  );
}
const holdFrameLoad = (event: Event) => {
  if (event.target instanceof HTMLIFrameElement)
    event.stopImmediatePropagation();
};
beforeEach(() => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.stubGlobal("PointerEvent", MouseEvent);
  document.addEventListener("load", holdFrameLoad, true);
  clearRuntimeConnectionsForTests();
  native.connection = {
    id: "saved",
    name: "Session",
    hostname: session.hostname,
    protocol: "http",
    port: 81,
    isGroup: false,
    createdAt: "2026-09-29T00:00:00Z",
    updatedAt: "2026-09-29T00:00:00Z",
    httpAutomation: {
      version: 1,
      interactionMacrosEnabled: true,
      scriptInjectionEnabled: true,
      forceDark: true,
      items: [],
    },
  };
  native.settings = {
    websiteDarkMode: normalizeWebsiteDarkModeSettings(undefined),
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
  };
  native.invoke.mockReset().mockImplementation(async (command) => {
    if (command === "start_basic_auth_proxy")
      return {
        session_id: "proxy",
        local_port: 43081,
        proxy_url: "http://p0123456789abcdef0123456789abcdef.localhost:43081/",
      };
    if (
      ["stop_basic_auth_proxy", "update_proxy_website_dark_mode"].includes(
        command,
      )
    )
      return;
    if (command === "web_network_guard_status")
      return {
        platform: "windows",
        frameNavigation: "enforced",
        allNetworkRequestsMediated: false,
      };
    if (command === "activate_proxy_network_document") return false;
    if (command === "read_macro_library")
      return JSON.stringify(
        normalizeWebAutomationLibrary({ version: 1, scripts: [], macros: [] }),
      );
    throw new Error(`Unexpected native command ${command}`);
  });
});
afterEach(() => {
  cleanup();
  document.removeEventListener("load", holdFrameLoad, true);
  clearRuntimeConnectionsForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("rearms focus reporting after dark-paint readiness and routes focus -> popup -> Type through the real browser hook", async () => {
  render(<Harness />);
  const iframe = (await screen.findByTitle("Session")) as HTMLIFrameElement;
  await waitFor(() => expect(iframe.src).toContain(":43081/"));
  const post = vi
    .spyOn(iframe.contentWindow!, "postMessage")
    .mockImplementation(() => {});
  const raw = new URL(iframe.src);
  const identity = {
    version: 1,
    sessionId: "proxy",
    documentToken: "d".repeat(32),
    documentSequence: 1,
    navigationToken: raw.searchParams.get("__sorng_navigation_v1"),
    url: iframe.src.replace(
      /[?&]__sorng_navigation_v1=[a-f0-9]{32}(?=#|$)/,
      "",
    ),
  };
  const emit = (type: string) =>
    act(() =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source: iframe.contentWindow,
          origin: raw.origin,
          data: { ...identity, type },
        }),
      ),
    );
  emit("proxy_document_start");
  emit("proxy_dom_ready");
  await act(async () => {});
  expect(screen.getByText("Blocked")).toBeInTheDocument();
  expect(
    post.mock.calls.some(([message]) => message.action === "credentialWatch"),
  ).toBe(false);
  emit("proxy_dark_ready");
  expect(screen.getByText("Ready")).toBeInTheDocument();
  await waitFor(() =>
    expect(
      post.mock.calls.some(([message]) => message.action === "credentialWatch"),
    ).toBe(true),
  );
  const watch = post.mock.calls.find(
    ([message]) => message.action === "credentialWatch",
  )![0];
  const reply = (
    request: Record<string, unknown>,
    status: string,
    extra = {},
  ) =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: iframe.contentWindow,
          origin: raw.origin,
          data: { ...request, type: "proxy_web_automation", status, ...extra },
        }),
      );
    });
  iframe.focus();
  reply(watch, "credentialFocusState", {
    focusRevision: 1,
    focusToken: "f".repeat(32),
  });
  reply(watch, "ok");
  const trigger = screen.getByRole("button", { name: "Credentials" });
  fireEvent.pointerDown(trigger, { button: 0 });
  fireEvent.click(trigger);
  const capture = post.mock.calls.find(
    ([message]) => message.action === "credentialFocus",
  )![0];
  expect(capture.payload).toMatchObject({
    focusRevision: 1,
    focusToken: "f".repeat(32),
  });
  reply(capture, "ok");
  await act(async () => {});
  const type = screen.getByRole("button", { name: "Type password" });
  expect(type).toBeEnabled();
  type.focus();
  fireEvent.click(type);
  const dispatch = post.mock.calls.find(
    ([message]) => message.action === "credentialType",
  )!;
  expect(dispatch[0].payload).toMatchObject({
    nonce: capture.payload.nonce,
    value: "test-password",
  });
  expect(dispatch[1]).toBe(raw.origin);
  reply(dispatch[0], "ok");
  await act(async () => {});
  expect(type).toBeDisabled();
});
