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
import progressStyles from "../../src/components/protocol/webBrowser/NavigationProgress.module.css";
import {
  registerQuickConnectConnection,
  releaseRuntimeConnection,
} from "../../src/utils/session/runtimeConnectionRegistry";

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
  popupListener: null as null | ((event: any) => void),
  revoked: false,
  serial: 0,
  clipboard: vi.fn(),
  navigationError: undefined as string | null | undefined,
  automationLibrary: { version: 1, scripts: [] as any[], macros: [] as any[] },
  mfaRepair: vi.fn(),
}));
vi.mock(
  "../../src/components/protocol/webBrowser/OriginMfaOriginRepair",
  () => ({
    default: (props: unknown) => {
      f.mfaRepair(props);
      return <button type="button">Review MFA origin repair</button>;
    },
  }),
);
vi.mock("@tauri-apps/api/core", () => ({ invoke: f.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: f.listen }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "owner-window" }),
}));
vi.mock("../../src/hooks/protocol/useOriginBrowser", async (original) => {
  const actual =
    await original<
      typeof import("../../src/hooks/protocol/useOriginBrowser")
    >();
  return {
    ...actual,
    useOriginBrowser: (...args: Parameters<typeof actual.useOriginBrowser>) => {
      const browser = actual.useOriginBrowser(...args);
      return f.navigationError === undefined
        ? browser
        : {
            ...browser,
            state: { ...browser.state, navigationError: f.navigationError },
          };
    },
  };
});
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
  f.navigationError = undefined;
  f.serial = 0;
  f.automationLibrary = { version: 1, scripts: [], macros: [] };
  f.active = true;
  f.settingsReady = true;
  f.noticeListener = null;
  f.popupListener = null;
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
    if (name === "origin-browser-popups") f.popupListener = callback;
    return vi.fn();
  });
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
  // Settle queued capability/browser replies while their mounted components
  // and owner-scoped mocks still exist, before unmounting and restoring them.
  await act(async () => {});
  cleanup();
  releaseRuntimeConnection(connection.id);
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
  const mfaMismatch =
    "Saved automatic two-factor authentication consent does not match the reviewed login origin. In Application settings, review the authenticator and HTTPS login origin, re-enable automatic codes, and save the connection. Your password and authenticator are unchanged.";
  const failStartup = (message = mfaMismatch) => {
    const nativeInvoke = f.invoke.getMockImplementation()!;
    f.invoke.mockImplementation((command, args) =>
      command === "origin_browser_create"
        ? Promise.reject(new Error(message))
        : nativeInvoke(command, args),
    );
  };
  it("integrates confirmed MFA repair outside the viewport without dismissing the error or retrying", async () => {
    failStartup();
    render(<WebBrowser session={session} />);
    const repair = await screen.findByRole("button", {
      name: "Review MFA origin repair",
    });
    const viewport = screen.getByRole("region");
    expect(viewport).not.toContainElement(repair);
    const props = f.mfaRepair.mock.lastCall![0];
    expect(props.session).toBe(session);
    expect(props.connection).toBe(connection);
    expect(props.onOverlayChange).toEqual(expect.any(Function));
    expect(() => props.assertOwner()).not.toThrow();
    // The component owns confirmation + durable save/readback. Its completed
    // callback only dismisses that repair control, never the failure or consent.
    await act(async () => props.onRepaired());
    expect(
      screen.queryByRole("button", { name: "Review MFA origin repair" }),
    ).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(mfaMismatch);
    expect(screen.getByRole("button", { name: "Retry browser" })).toBeEnabled();
    expect(calls("origin_browser_create")).toHaveLength(1);
    expect(calls("origin_browser_login")).toHaveLength(0);
    expect(f.context.dispatchAndFlush).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry browser" }));
    await screen.findByRole("button", { name: "Review MFA origin repair" });
    expect(calls("origin_browser_create")).toHaveLength(2);
  });
  it.each(["inactive", "owner-revoked"])(
    "removes the MFA repair integration when %s",
    async (gate) => {
      failStartup();
      const view = render(<WebBrowser session={session} />);
      await screen.findByRole("button", { name: "Review MFA origin repair" });
      const props = f.mfaRepair.mock.lastCall![0];
      if (gate === "inactive") {
        f.active = false;
        view.rerender(<WebBrowser session={session} />);
      } else {
        f.revoked = true;
        await act(async () =>
          f.currentListeners.forEach((listener) => listener()),
        );
      }
      expect(
        screen.queryByRole("button", { name: "Review MFA origin repair" }),
      ).toBeNull();
      expect(() => props.assertOwner()).toThrow();
      expect(calls("origin_browser_create")).toHaveLength(1);
      expect(f.context.dispatchAndFlush).not.toHaveBeenCalled();
    },
  );
  it.each(["temporary", "unclassified failure"])(
    "never offers MFA repair for %s",
    async (scope) => {
      failStartup(scope === "temporary" ? mfaMismatch : "unclassified failure");
      if (scope === "temporary") {
        f.context.state.connections = [];
        registerQuickConnectConnection(connection);
      }
      render(
        <WebBrowser
          session={
            scope === "temporary"
              ? { ...session, ownerDatabaseId: undefined }
              : session
          }
        />,
      );
      await screen.findByRole("button", { name: "Retry browser" });
      expect(
        screen.queryByRole("button", { name: "Review MFA origin repair" }),
      ).toBeNull();
      expect(f.mfaRepair).not.toHaveBeenCalled();
      expect(f.context.dispatchAndFlush).not.toHaveBeenCalled();
    },
  );
  it("reserves a thin loading line outside native bounds and keeps status below the viewport", async () => {
    const view = await attached();
    const viewport = screen.getByRole("region", { name: "Fixture native" });
    const slot = screen.getByTestId("origin-navigation-progress-slot");
    const status = screen.getByRole("status", { name: "Browser status" });
    expect(slot).toHaveClass("relative", "h-[2px]", "shrink-0");
    expect(slot.nextElementSibling).toBe(viewport);
    expect(viewport.nextElementSibling).toBe(status);
    expect(status).toHaveClass("border-t", "shrink-0");
    expect(status).not.toHaveClass("border-b");
    expect(screen.queryByRole("progressbar")).toBeNull();
    await act(async () =>
      f.snapshotListener?.({
        payload: snapshot("attempt-1", { sequence: 2, loading: true }),
      }),
    );
    const progress = screen.getByRole("progressbar", { name: "Loading page" });
    expect(progress.parentElement).toBe(slot);
    expect(viewport).not.toContainElement(progress);
    expect(progress).toHaveClass(progressStyles.track);
    expect(progress.firstElementChild).toHaveClass(progressStyles.segment);
    expect(progress).not.toHaveAttribute("aria-valuenow");
    expect(progress).toHaveAttribute(
      "aria-valuetext",
      "Waiting for the page to become ready",
    );
    expect(view.container.querySelector(".animate-spin")).toBeNull();
    expect(status).toHaveTextContent("Fixture native · Loading");
    await act(async () =>
      f.snapshotListener?.({
        payload: snapshot("attempt-1", { sequence: 3, loading: false }),
      }),
    );
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByTestId("origin-navigation-progress-slot")).toBe(slot);
    expect(status).toHaveTextContent("Fixture native");
    expect(status).not.toHaveTextContent("Loading");
  });
  it.each([true, false])(
    "uses only the shell loading line during startup when progress is %s",
    async (enabled) => {
      f.settings.webBrowser.showLoadingProgress = enabled;
      const nativeInvoke = f.invoke.getMockImplementation()!;
      let completeCreate!: () => void;
      f.invoke.mockImplementation((command, args) => {
        if (command === "origin_browser_create")
          return new Promise((resolve) => {
            completeCreate = () => resolve(nativeInvoke(command, args));
          });
        return nativeInvoke(command, args);
      });
      const view = render(<WebBrowser session={session} />);
      await waitFor(() =>
        expect(calls("origin_browser_create")).toHaveLength(1),
      );
      expect(!!screen.queryByRole("progressbar")).toBe(enabled);
      expect(screen.getByRole("region")).toHaveAttribute("aria-busy", "true");
      expect(view.container.querySelector(".animate-spin")).toBeNull();
      expect(screen.queryByText("Starting native browser…")).toBeNull();
      await act(async () => completeCreate());
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Reload" })).toBeEnabled(),
      );
      expect(screen.queryByRole("progressbar")).toBeNull();
    },
  );
  it.each([true, false])(
    "tracks the selected popup loading=%s rather than the hidden root",
    async (childLoading) => {
      await attached();
      await waitFor(() => expect(f.popupListener).not.toBeNull());
      act(() => {
        f.snapshotListener?.({
          payload: snapshot("attempt-1", {
            sequence: 2,
            loading: !childLoading,
          }),
        });
        f.popupListener?.({
          payload: {
            sourceIdentity: snapshot().identity,
            sequence: 2,
            sourceClosed: false,
            views: [
              {
                viewId: "child-1",
                disposition: "background",
                phase: "adopted",
                title: "Popup child",
                snapshot: snapshot("attempt-1", {
                  sequence: 2,
                  title: "Popup child",
                  currentUrl: "https://fixture.invalid/child",
                  loading: childLoading,
                }),
              },
            ],
          },
        });
      });
      fireEvent.click(await screen.findByRole("tab", { name: "Popup child" }));
      await waitFor(() =>
        expect(
          screen.getByRole("tab", { name: "Popup child" }),
        ).toHaveAttribute("aria-selected", "true"),
      );
      expect(!!screen.queryByRole("progressbar")).toBe(childLoading);
      expect(
        screen.getByRole("region", { name: "Popup child" }),
      ).toHaveAttribute("aria-busy", String(childLoading));
      expect(
        screen.getByRole("status", { name: "Browser status" }),
      ).toHaveTextContent(
        childLoading ? "Popup child · Loading" : "Popup child",
      );
      fireEvent.click(screen.getByRole("tab", { name: "Fixture native" }));
      await waitFor(() =>
        expect(
          screen.getByRole("tab", { name: "Fixture native" }),
        ).toHaveAttribute("aria-selected", "true"),
      );
      expect(!!screen.queryByRole("progressbar")).toBe(!childLoading);
      expect(
        screen.getByRole("region", { name: "Fixture native" }),
      ).toHaveAttribute("aria-busy", String(!childLoading));
      expect(calls("origin_browser_create")).toHaveLength(1);
    },
  );
  it("hides loading animation for inactive tabs and revoked owners", async () => {
    const view = await attached();
    act(() =>
      f.snapshotListener?.({
        payload: snapshot("attempt-1", { sequence: 2, loading: true }),
      }),
    );
    expect(screen.getByRole("progressbar")).toBeVisible();
    f.active = false;
    view.rerender(<WebBrowser session={session} />);
    expect(screen.queryByRole("progressbar")).toBeNull();
    f.active = true;
    view.rerender(<WebBrowser session={session} />);
    expect(screen.getByRole("progressbar")).toBeVisible();
    f.revoked = true;
    await act(async () => f.currentListeners.forEach((listener) => listener()));
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
  it("retries failed startup from the viewport using a new authorized create", async () => {
    const nativeInvoke = f.invoke.getMockImplementation()!;
    let failCreate = true;
    f.invoke.mockImplementation((command, args) => {
      if (command === "origin_browser_create" && failCreate) {
        failCreate = false;
        return Promise.reject(new Error("unknown startup failure"));
      }
      return nativeInvoke(command, args);
    });
    render(<WebBrowser session={session} />);
    const retry = await screen.findByRole("button", { name: "Retry browser" });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Native browser startup failed (create)",
    );
    expect(calls("origin_browser_create")).toHaveLength(1);
    expect(f.updateSettings).not.toHaveBeenCalled();
    fireEvent.click(retry);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Reload" })).toBeEnabled(),
    );
    const requests = calls("origin_browser_create").map(
      ([, args]) => args.request,
    );
    expect(requests).toHaveLength(2);
    expect(requests[1].requestId).not.toBe(requests[0].requestId);
    expect(requests[1]).toMatchObject({
      owner: requests[0].owner,
      expectedSecurityRevision: "revision-1",
      sourceSessionId: "unlock-1",
      policy: { autoLogin: { consent: { kind: "required" } } },
    });
    expect(screen.queryByRole("button", { name: "Retry browser" })).toBeNull();
    expect(calls("origin_browser_navigate")).toHaveLength(0);
    expect(calls("origin_browser_login")).toHaveLength(0);
    expect(f.updateSettings).not.toHaveBeenCalled();
  });
  it("offers explicit retry after a native failed snapshot without retrying automatically", async () => {
    await attached();
    act(() =>
      f.snapshotListener?.({
        payload: snapshot("attempt-1", {
          sequence: 4,
          phase: "failed",
          loading: true,
          failureReason: "renderer",
        }),
      }),
    );
    const retry = await screen.findByRole("button", { name: "Retry browser" });
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByRole("region")).toHaveAttribute("aria-busy", "false");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Native browser session failed: the page renderer stopped or its native communication bridge failed.",
    );
    expect(calls("origin_browser_create")).toHaveLength(1);
    fireEvent.click(retry);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Reload" })).toBeEnabled(),
    );
    expect(calls("origin_browser_create")).toHaveLength(2);
    expect(calls("origin_browser_close")).toContainEqual([
      "origin_browser_close",
      { request: { identity: snapshot().identity } },
    ]);
    expect(calls("origin_browser_login")).toHaveLength(0);
  });
  it("native navigation denial renders the hook message once and clears when the hook clears it", async () => {
    const view = await attached();
    const denied =
      "Navigation was blocked by this connection's destination policy. The current page is unchanged.";
    f.navigationError = denied;
    view.rerender(<WebBrowser session={session} />);
    expect(screen.getAllByText(denied)).toHaveLength(1);
    expect(screen.getByText(denied)).toHaveAttribute("role", "alert");
    expect(screen.getByRole("button", { name: "Reload" })).toBeEnabled();
    expect(calls("origin_browser_close")).toHaveLength(0);
    f.navigationError = null;
    view.rerender(<WebBrowser session={session} />);
    expect(screen.queryByText(denied)).toBeNull();
    expect(calls("origin_browser_create")).toHaveLength(1);
  });
  it("native feature menu prints only after overlay closure and focus acknowledgement", async () => {
    await attached();
    fireEvent.click(
      screen.getByRole("button", { name: "More browser actions" }),
    );
    for (const name of [
      "Print / Save as PDF…",
      "History menu",
      "Recording",
      "Open in new tab",
      "Find in page",
    ])
      expect(screen.getByRole("menuitem", { name })).toBeEnabled();
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Print / Save as PDF…" }),
    );
    await waitFor(() =>
      expect(calls("origin_browser_page_menu")).toHaveLength(1),
    );
    expect(
      screen.queryByRole("menu", { name: "More browser actions" }),
    ).toBeNull();
    expect(calls("origin_browser_page_menu")[0][1].request).toEqual({
      identity: snapshot().identity,
      viewId: null,
      action: { kind: "print" },
    });
    const print = f.invoke.mock.calls.findIndex(
      ([cmd]) => cmd === "origin_browser_page_menu",
    );
    const focus = f.invoke.mock.calls.findIndex(
      ([cmd, args]) =>
        cmd === "origin_browser_popup" &&
        args.request.action.action?.kind === "focus",
    );
    expect(focus).toBeGreaterThan(-1);
    expect(focus).toBeLessThan(print);
  });
  it("native feature menu opens a real native tab without creating another context", async () => {
    await attached();
    fireEvent.click(
      screen.getByRole("button", { name: "More browser actions" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Open in new tab" }));
    await waitFor(() =>
      expect(
        calls("origin_browser_popup").some(
          ([, a]) => a.request.action.kind === "open-tab",
        ),
      ).toBe(true),
    );
    const request = calls("origin_browser_popup").find(
      ([, a]) => a.request.action.kind === "open-tab",
    )![1].request;
    expect(request.sourceIdentity).toEqual(snapshot().identity);
    expect(request.action.viewId).toBeNull();
    expect(request.action.presentationRevision).toBeGreaterThan(0);
    expect(calls("origin_browser_create")).toHaveLength(1);
  });
  it("native feature menu opens the new Find field and focuses it", async () => {
    await attached();
    fireEvent.click(
      screen.getByRole("button", { name: "More browser actions" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Find in page" }));
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Find text" })).toHaveFocus(),
    );
  });
  it("native feature menu lists and jumps native history from the back dropdown", async () => {
    await attached();
    const original = f.invoke.getMockImplementation()!;
    f.invoke.mockImplementation((cmd, args) =>
      cmd === "origin_browser_page_menu" &&
      args.request.action.kind === "history"
        ? Promise.resolve({
            snapshotId: "22",
            currentIndex: 1,
            entries: [
              {
                index: 0,
                url: "https://fixture.invalid/before",
                title: "Before page",
              },
              { index: 1, url: "https://fixture.invalid/", title: "Now page" },
            ],
          })
        : original(cmd, args),
    );
    act(() =>
      f.snapshotListener?.({
        payload: snapshot("attempt-1", { sequence: 2, canGoBack: true }),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Back history" }));
    await waitFor(() =>
      expect(
        screen.getByRole("menuitem", { name: /Before page/ }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /Before page/ }));
    await waitFor(() =>
      expect(calls("origin_browser_page_menu")).toHaveLength(2),
    );
    expect(calls("origin_browser_page_menu")[1][1].request.action).toEqual({
      kind: "historyJump",
      snapshotId: "22",
      index: 0,
    });
    expect(calls("origin_browser_navigate")).toHaveLength(0);
  });
  it("native feature recording controls stay mounted across panel close and reopen", async () => {
    await attached();
    const original = f.invoke.getMockImplementation()!;
    f.invoke.mockImplementation((cmd, args) =>
      cmd === "origin_browser_recording"
        ? Promise.resolve({
            snapshot: {
              identity: snapshot().identity,
              recordingId: "abc-123",
              metadataOnly: true,
              phase: "recording",
              durationMs: 0,
              entryCount: 0,
              droppedEntries: 0,
            },
            har: null,
          })
        : original(cmd, args),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "More browser actions" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Recording" }));
    expect(screen.getByRole("button", { name: "Start HAR" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Start video" })).toBeDisabled(); // no capture API in jsdom
    fireEvent.click(screen.getByRole("button", { name: "Start HAR" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Stop HAR" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "More browser actions" }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "More browser actions" }),
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Recording · active" }),
    );
    expect(screen.getByRole("button", { name: "Stop HAR" })).toBeEnabled();
    expect(
      calls("origin_browser_recording").filter(
        ([, a]) => a.request.operation.kind === "start",
      ),
    ).toHaveLength(1);
    expect(
      calls("origin_browser_recording").some(
        ([, a]) => a.request.operation.kind === "discard",
      ),
    ).toBe(false);
  });
  it("uses a compact reconnect rotation icon distinct from the reload icon", async () => {
    await attached();
    const reconnect = screen.getByRole("button", { name: "Reconnect" });
    expect(reconnect).toHaveClass("sor-btn", "sor-icon-btn-sm");
    expect(reconnect).toHaveAttribute("data-tooltip", "Reconnect");
    expect(reconnect.querySelector("svg")).toHaveClass("lucide-rotate-cw");
    expect(reconnect.querySelector("svg")).toHaveAttribute("width", "16");
    expect(
      screen.getByRole("button", { name: "Reload" }).querySelector("svg"),
    ).toHaveClass("lucide-rotate-ccw");
  });
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
  it("native feature menu preserves compact title and themed interactive actions", async () => {
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
    for (const name of [
      "Print / Save as PDF…",
      "History menu",
      "Recording",
      "Open in new tab",
      "Find in page",
    ])
      expect(within(menu).getByRole("menuitem", { name })).toBeEnabled();
    const presentations = calls("origin_browser_control").filter(
      ([, args]) => args.request.action.kind === "presentation",
    );
    expect(presentations.slice(-1)[0][1].request.action).toMatchObject({
      visible: true,
      inputBlocked: true,
    });
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
      await act(async () => {});
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
    await act(async () => {});
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
      await act(async () =>
        f.snapshotListener?.({
          payload: snapshot("attempt-1", { sequence: 2, loading: true }),
        }),
      );
      expect(!!screen.queryByText("Fixture native · Loading")).toBe(visible);
      expect(!!screen.queryByRole("progressbar")).toBe(visible);
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
      await act(async () =>
        f.snapshotListener?.({
          payload: snapshot("attempt-1", { sequence: 2, loading: true }),
        }),
      );
      expect(!!screen.queryByText("Fixture native · Loading")).toBe(visible);
      expect(!!screen.queryByRole("progressbar")).toBe(visible);
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
      expect(actions.slice(-1)[0]).toMatchObject({
        visible: true,
        inputBlocked: true,
      });
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
    await act(async () => {});
  });
  it("reviews and saves current-page bookmarks while blocking native input, without reconnecting", async () => {
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
    expect(presentations.slice(-1)[0][1].request.action).toMatchObject({
      visible: true,
      inputBlocked: true,
    });
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
    await act(async () => {});
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
    await act(async () => {});
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
    await act(async () => {});
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
    await act(async () => {});
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
    // Keep the immediate revocation assertions above synchronous, then settle
    // the newly mounted capability notice before the runner yields the test.
    await act(async () => {});
  });
  it("hides inactive tabs and clips shell dialogs while blocking native input, then restores it", async () => {
    const view = await attached();
    const presentation = () =>
      calls("origin_browser_control")
        .filter(([, args]) => args.request.action.kind === "presentation")
        .slice(-1)[0]?.[1].request.action;
    const visible = () => presentation()?.visible;
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
    try {
      await waitFor(() =>
        expect(presentation()).toMatchObject({
          visible: true,
          inputBlocked: true,
        }),
      );
      expect(presentation().occlusions.length).toBeGreaterThan(0);
      expect(screen.getByRole("button", { name: "Reload" })).toBeDisabled();
    } finally {
      act(() => dialog.remove());
    }
    await waitFor(() =>
      expect(presentation()).toMatchObject({
        visible: true,
        inputBlocked: false,
      }),
    );
    expect(screen.getByRole("button", { name: "Reload" })).toBeEnabled();
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
