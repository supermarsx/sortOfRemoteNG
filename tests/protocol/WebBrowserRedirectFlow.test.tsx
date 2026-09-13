import React, { useState } from "react";
import { flushSync } from "react-dom";
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
import { DEFAULT_HTTP_PROXY_POLICY } from "../../src/types/connection/httpProxyPolicy";
import {
  clearRuntimeConnectionsForTests,
  getRuntimeWebNavigation,
  resolveRuntimeConnection,
  registerRuntimeConnection,
} from "../../src/utils/session/runtimeConnectionRegistry";
import type { HttpRedirectReview } from "../../src/utils/protocol/httpRedirectReview";
import { normalizeAdvancedProtocolConnection } from "../../src/utils/connection/normalizeAdvancedProtocolConnection";
import { mergeLocalSessionUpdate } from "../../src/utils/session/sessionLifecycle";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  dispatch: vi.fn(),
  verify: vi.fn(),
  activate: vi.fn(),
  readCurrent: vi.fn(),
  flushPendingSave: vi.fn(),
  dispatchAndFlush: vi.fn(),
  connections: [] as Connection[],
  persistedConnections: [] as Connection[],
  runtimeStart: null as Connection | null,
  failSave: false,
  failSaveAfterDispatch: false,
  sessions: [] as ConnectionSession[],
  settingsReady: true,
  locked: false,
  availabilityGeneration: 1,
  networkGuardStatus: {
    platform: "windows",
    frameNavigation: "enforced",
    allNetworkRequestsMediated: false,
  },
  settings: {
    httpsTrustPolicy: "always-ask",
    proxyKeepaliveEnabled: false,
    webRecording: { autoRecordWebSessions: false },
  },
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, ...args: unknown[]) =>
    command === "web_network_guard_status"
      ? Promise.resolve(h.networkGuardStatus)
      : command === "activate_proxy_network_document"
        ? h.activate(...args)
        : h.invoke(command, ...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async () => () => undefined,
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => h.invoke,
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { connections: h.connections, sessions: h.sessions },
    dispatch: h.dispatch,
    dispatchAndFlush: h.dispatchAndFlush,
    flushPendingSave: h.flushPendingSave,
    databaseAvailability: {
      status: "ready",
      databaseId: "owned",
      generation: h.availabilityGeneration,
    },
    recycleBin: { snapshot: { scope: { databaseId: "owned", generation: 1 } } },
  }),
}));
vi.mock("../../src/contexts/SettingsContext", async (original) => ({
  ...(await original<typeof import("../../src/contexts/SettingsContext")>()),
  useSettings: () => ({ settings: h.settings, settingsReady: h.settingsReady }),
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
vi.mock("../../src/utils/auth/trustStore", async (original) => ({
  ...(await original<typeof import("../../src/utils/auth/trustStore")>()),
  verifyIdentity: h.verify,
  trustIdentity: vi.fn(),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  onCurrentDatabaseChange: () => () => undefined,
  onDatabaseAccessChange: () => () => undefined,
  DatabaseManager: {
    getInstance: () => ({
      getCurrentDatabase: () => ({ id: "owned" }),
      onCurrentDatabaseChange: () => () => undefined,
      captureCurrentDatabaseDataTarget: () => ({
        databaseId: "owned",
        assertAccessible: () => {
          if (h.locked) throw new Error("locked");
        },
        readCurrent: h.readCurrent,
      }),
    }),
  },
}));
import { WebBrowser } from "../../src/components/protocol/WebBrowser";

const receipts = new Map<string, HttpRedirectReview>();
const proxies: Array<{
  session_id: string;
  proxy_url: string;
  target: string;
}> = [];
const holdFrameLoad = (event: Event) => {
  if (event.target instanceof HTMLIFrameElement)
    event.stopImmediatePropagation();
};
const initialSession = (): ConnectionSession => ({
  id: "web-tab",
  connectionId: (h.runtimeStart ?? h.connections[0]).id,
  name: "NAS website",
  hostname: (h.runtimeStart ?? h.connections[0]).hostname,
  protocol: (h.runtimeStart ?? h.connections[0]).protocol,
  ownerDatabaseId: "owned",
  status: "connected",
  startTime: new Date(),
});
function Harness() {
  const [session, setSession] = useState(initialSession);
  const [, setRevision] = useState(0);
  h.sessions = [session];
  h.dispatch.mockImplementation(
    (action: { type: string; payload: ConnectionSession | Connection }) => {
      if (action.type === "UPDATE_SESSION")
        setSession((current) =>
          mergeLocalSessionUpdate(current, action.payload as ConnectionSession),
        );
      if (action.type === "UPDATE_CONNECTION") {
        const row = action.payload as Connection;
        h.connections = h.connections.map((current) =>
          current.id === row.id ? row : current,
        );
        setRevision((value) => value + 1);
      }
    },
  );
  return <WebBrowser key={session.connectionId} session={session} />;
}
beforeEach(() => {
  h.activate.mockReset().mockResolvedValue(false);
  h.availabilityGeneration = 1;
  h.networkGuardStatus = {
    platform: "windows",
    frameNavigation: "enforced",
    allNetworkRequestsMediated: false,
  };
  clearRuntimeConnectionsForTests();
  receipts.clear();
  proxies.length = 0;
  h.settingsReady = true;
  h.locked = false;
  h.failSave = false;
  h.failSaveAfterDispatch = false;
  h.runtimeStart = null;
  h.dispatch.mockReset();
  h.connections = [
    {
      id: "saved-nas",
      name: "NAS website",
      hostname: "quickconnect.example.test",
      port: 443,
      protocol: "https",
      isGroup: false,
      createdAt: "2026-09-10",
      updatedAt: "2026-09-10",
      httpApplication: { version: 1, id: "synology-dsm", loginMode: "manual" },
      httpProxyPolicy: {
        ...DEFAULT_HTTP_PROXY_POLICY,
        allowCrossOriginRedirects: true,
      },
    },
  ];
  h.persistedConnections = structuredClone(h.connections);
  h.readCurrent.mockReset().mockImplementation(async () => ({
    connections: structuredClone(h.persistedConnections),
  }));
  h.flushPendingSave.mockReset().mockImplementation(async () => {
    if (h.failSave) throw new Error("Synthetic save refused");
    h.persistedConnections = structuredClone(h.connections);
  });
  h.dispatchAndFlush.mockReset().mockImplementation(async (action) => {
    flushSync(() => h.dispatch(action));
    if (h.failSave || h.failSaveAfterDispatch)
      throw new Error("Synthetic save refused");
    h.persistedConnections = structuredClone(h.connections);
  });
  h.verify.mockReset().mockResolvedValue({ status: "trusted" });
  h.invoke
    .mockReset()
    .mockImplementation(
      async (command: string, args: Record<string, unknown>) => {
        if (command === "get_tls_certificate_info")
          return {
            fingerprint: "AA:BB:CC",
            subject: null,
            issuer: null,
            san: [],
            chain: [],
          };
        if (command === "start_basic_auth_proxy") {
          const index = proxies.length + 1;
          const config = args.config as { target_url: string };
          const proxy = {
            session_id: `proxy-${index}`,
            local_port: 43080 + index,
            proxy_url: `http://p${index.toString(16).padStart(32, "0")}.localhost:${43080 + index}/`,
            target: config.target_url,
          };
          proxies.push(proxy);
          return proxy;
        }
        if (command === "review_proxy_redirect")
          return receipts.get(args.sessionId as string) ?? null;
        if (
          command === "stop_basic_auth_proxy" ||
          command === "cancel_proxy_continuation"
        )
          return undefined;
        throw new Error(`Unexpected fixture command: ${command}`);
      },
    );
  document.addEventListener("load", holdFrameLoad, true);
});
afterEach(() => {
  cleanup();
  document.removeEventListener("load", holdFrameLoad, true);
  clearRuntimeConnectionsForTests();
  vi.restoreAllMocks();
});
async function mounted() {
  h.persistedConnections = structuredClone(h.connections);
  const view = render(<Harness />);
  await waitFor(() =>
    expect(
      proxies,
      `${h.invoke.mock.calls.map(([command]) => command).join(", ")} / ${view.container.textContent}`,
    ).toHaveLength(1),
  );
  await waitFor(() =>
    expect(view.container.querySelector("iframe")?.src).toContain(
      proxies[0].proxy_url,
    ),
  );
  return view;
}

async function inspectWebsiteNotifications() {
  const trigger = screen.getByRole("button", { name: "Website notifications" });
  if (trigger.getAttribute("aria-expanded") !== "true")
    await act(async () => {
      fireEvent.click(trigger);
    });
  await waitFor(() =>
    expect(
      screen.getByRole("dialog", { name: "Website notifications" }),
    ).toBeVisible(),
  );
}

describe("mounted website network boundary", () => {
  it.each(["missing", "legacy", "mismatch", "current"] as const)(
    "uses only fenced primary readiness for %s routing-module diagnostics",
    async (status) => {
      const view = await mounted();
      await inspectWebsiteNotifications();
      const iframe = view.container.querySelector("iframe")!;
      const url = new URL(iframe.src);
      const navigationToken = url.searchParams.get("__sorng_navigation_v1");
      url.searchParams.delete("__sorng_navigation_v1");
      const data = {
        version: 1,
        type: "proxy_document_start",
        sessionId: "proxy-1",
        documentToken: "d".repeat(32),
        documentSequence: 1,
        navigationToken,
        url: url.href,
        networkRouting:
          status === "missing"
            ? undefined
            : {
                version: status === "legacy" ? 3 : 4,
                quickConnectNavigation: status === "current",
                quickConnectDiscovery: false,
                quickConnectDiscovered: false,
                quickConnectDirectNavigation: false,
                quickConnectRegionalNavigation: false,
              },
      };
      const send = (source: MessageEventSource | null, payload = data) =>
        act(async () => {
          window.dispatchEvent(
            new MessageEvent("message", {
              source,
              origin: url.origin,
              data: payload,
            }),
          );
        });
      await send(window);
      await send(iframe.contentWindow, {
        ...data,
        navigationToken: "e".repeat(32),
      });
      expect(screen.queryByTestId("web-network-routing-status")).toBeNull();
      await send(iframe.contentWindow);
      await inspectWebsiteNotifications();
      expect(
        screen.getByTestId("web-network-routing-status"),
      ).toHaveTextContent(
        status === "missing" || status === "legacy"
          ? "Restart the desktop application"
          : status === "mismatch"
            ? "differ from the current connection settings"
            : "Page routing module v4 reported",
      );
      expect(proxies).toHaveLength(1);
      await act(async () => {
        h.availabilityGeneration++;
        view.rerender(<Harness />);
      });
      await inspectWebsiteNotifications();
      expect(screen.queryByTestId("web-network-routing-status")).toBeNull();
      await send(iframe.contentWindow);
      expect(screen.queryByTestId("web-network-routing-status")).toBeNull();
    },
  );
  it.each(["initializing", "failed"])(
    "blocks %s native guard before certificate or proxy requests",
    async (state) => {
      h.networkGuardStatus.frameNavigation = state;
      const view = render(<Harness />);
      await waitFor(() =>
        expect(view.container.textContent).toContain(
          state === "failed"
            ? "Website navigation protection failed"
            : "Website navigation protection is still starting",
        ),
      );
      expect(proxies).toHaveLength(0);
      expect(h.verify).not.toHaveBeenCalled();
      expect(h.invoke).not.toHaveBeenCalledWith(
        "get_tls_certificate_info",
        expect.anything(),
      );
      expect(view.container.querySelector("iframe")).toBeNull();
    },
  );
  it("discloses unsupported platform enforcement without claiming every request is mediated", async () => {
    h.networkGuardStatus = {
      platform: "linux",
      frameNavigation: "unsupported",
      allNetworkRequestsMediated: false,
    };
    await mounted();
    await inspectWebsiteNotifications();
    expect(
      screen.getByText(/Native frame navigation protection is not available/),
    ).toBeInTheDocument();
  });
  it.each(["owner", "navigation"])(
    "only displays current primary-document origin reports and clears on %s changes",
    async (change) => {
      const view = await mounted();
      const iframe = view.container.querySelector("iframe")!;
      const url = new URL(iframe.src),
        navigationToken = url.searchParams.get("__sorng_navigation_v1");
      url.searchParams.delete("__sorng_navigation_v1");
      const identity = {
        version: 1,
        sessionId: "proxy-1",
        documentToken: "d".repeat(32),
        documentSequence: 1,
        navigationToken,
        url: url.href,
      };
      const send = (
        data: Record<string, unknown>,
        source: MessageEventSource | null = iframe.contentWindow,
        origin = url.origin,
      ) =>
        act(() =>
          window.dispatchEvent(
            new MessageEvent("message", { source, origin, data }),
          ),
        );
      send({ ...identity, type: "proxy_document_start" });
      send({ ...identity, type: "proxy_dom_ready" });
      await inspectWebsiteNotifications();
      expect(h.activate).toHaveBeenCalledWith({
        sessionId: "proxy-1",
        documentSequence: 1,
      });
      expect(h.activate).toHaveBeenCalledOnce();
      const report = {
        ...identity,
        type: "sorng_web_network_blocked",
        kind: "fetch",
        reason: "origin-not-approved",
        origin: "https://blocked.example",
      };
      send(report, window);
      send(report, iframe.contentWindow, "https://foreign.example");
      send({ ...report, documentSequence: 9 });
      send({ ...report, origin: "https://blocked.example/?secret=hidden" });
      expect(
        screen.queryByText("https://blocked.example"),
      ).not.toBeInTheDocument();
      send(report);
      send(report);
      expect(screen.getByText("https://blocked.example")).toBeInTheDocument();
      expect(screen.getAllByText("https://blocked.example")).toHaveLength(1);
      if (change === "owner") {
        h.availabilityGeneration++;
        view.rerender(<Harness />);
      } else send({ ...identity, type: "proxy_navigation_start" });
      await inspectWebsiteNotifications();
      expect(
        screen.queryByText("https://blocked.example"),
      ).not.toBeInTheDocument();
      send(report);
      expect(
        screen.queryByText("https://blocked.example"),
      ).not.toBeInTheDocument();
      expect(view.container.textContent).not.toContain("secret=hidden");
    },
  );
});
describe("primary network document activation lifecycle", () => {
  it.each([false, true])(
    "handles deferred activation failure with owner change=%s",
    async (changeOwner) => {
      let reject!: (error: Error) => void;
      const pending = new Promise<boolean>((_, fail) => {
        reject = fail;
      });
      h.activate.mockReturnValueOnce(pending);
      const view = await mounted(),
        iframe = view.container.querySelector("iframe")!;
      const url = new URL(iframe.src),
        navigationToken = url.searchParams.get("__sorng_navigation_v1");
      url.searchParams.delete("__sorng_navigation_v1");
      const data = {
        version: 1,
        type: "proxy_document_start",
        sessionId: "proxy-1",
        documentToken: "d".repeat(32),
        documentSequence: 1,
        navigationToken,
        url: url.href,
      };
      // A different window cannot select a native document, even with known tokens.
      act(() =>
        window.dispatchEvent(
          new MessageEvent("message", {
            source: window,
            origin: url.origin,
            data,
          }),
        ),
      );
      expect(h.activate).not.toHaveBeenCalled();
      act(() =>
        window.dispatchEvent(
          new MessageEvent("message", {
            source: iframe.contentWindow,
            origin: url.origin,
            data,
          }),
        ),
      );
      expect(h.activate).toHaveBeenCalledOnce();
      if (changeOwner) {
        h.availabilityGeneration++;
        view.rerender(<Harness />);
      }
      await act(async () => {
        reject(new Error("Synthetic activation failure"));
        await pending.catch(() => undefined);
      });
      await inspectWebsiteNotifications();
      if (changeOwner)
        expect(
          screen.queryByRole("button", { name: "Reload page" }),
        ).not.toBeInTheDocument();
      else
        expect(
          screen.getByRole("button", { name: "Reload page" }),
        ).toBeInTheDocument();
      expect(view.container.textContent).not.toContain(
        "Synthetic activation failure",
      );
      expect(proxies).toHaveLength(1);
    },
  );
});

function redirect(
  iframe: HTMLIFrameElement,
  destination: string,
  postMessage = true,
  status = 403,
) {
  const proxy = proxies[proxies.length - 1]!;
  const review: HttpRedirectReview = {
    receiptId: `${proxies.length.toString(16).padStart(8, "0")}-aaaa-aaaa-aaaa-aaaaaaaaaaaa`,
    sessionId: proxy.session_id,
    sourceOrigin: new URL(proxy.target).origin,
    destinationUrl: destination,
    documentSequence: 1,
    removedQuery: false,
    navigationToken: new URL(iframe.src).searchParams.get(
      "__sorng_navigation_v1",
    ),
  };
  receipts.set(proxy.session_id, review);
  const failedUrl = new URL(proxy.target);
  const frameUrl = new URL(iframe.src);
  failedUrl.pathname = frameUrl.pathname;
  frameUrl.searchParams.delete("__sorng_navigation_v1");
  failedUrl.search = frameUrl.search;
  if (postMessage)
    act(() =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source: iframe.contentWindow,
          origin: new URL(proxy.proxy_url).origin,
          data: {
            type: "sorng_proxy_failure",
            version: 1,
            sessionId: proxy.session_id,
            kind: "redirect_review",
            status,
            title: "redirect_review_required",
            url: failedUrl.toString(),
            reason: "Legacy native reason",
            detail: "Legacy native detail",
          },
        }),
      ),
    );
  return review;
}

describe("actual website redirect review integration", () => {
  const continuationId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const continuationDestination =
    "https://example-nas.de2.quickconnect.to/webman/";

  async function mountContinuation(holdCertificate = false) {
    h.connections = [
      {
        ...h.connections[0],
        hostname: "example-nas.fr3.quickconnect.to",
        httpProxyPolicy: { ...DEFAULT_HTTP_PROXY_POLICY },
      },
    ];
    const view = await mounted();
    const invoke = h.invoke.getMockImplementation()!;
    let resumeCertificate: (() => void) | undefined;
    let certificateHeld = false;
    h.invoke.mockImplementation(async (command, args) => {
      if (
        command === "get_tls_certificate_info" &&
        holdCertificate &&
        !certificateHeld
      ) {
        certificateHeld = true;
        await new Promise<void>((resolve) => {
          resumeCertificate = resolve;
        });
      }
      const result = await invoke(command, args);
      return command === "review_proxy_redirect" && args.receiptId && result
        ? { ...result, continuationId }
        : result;
    });
    redirect(
      view.container.querySelector("iframe")!,
      continuationDestination,
      true,
      202,
    );
    if (holdCertificate)
      await waitFor(() => expect(resumeCertificate).toBeTypeOf("function"));
    return { view, resumeCertificate: () => resumeCertificate?.() };
  }

  it("redeems a pathful continuation exactly once with the full reviewed URL and anonymous startup", async () => {
    const { view } = await mountContinuation();
    await waitFor(() => expect(proxies).toHaveLength(2));
    const starts = h.invoke.mock.calls.filter(
      ([command]) => command === "start_basic_auth_proxy",
    );
    expect(starts[1][1].config).toMatchObject({
      target_url: continuationDestination,
      continuation_id: continuationId,
      username: "",
      password: "",
      http_auto_login: false,
      accepted_cert_fingerprint: "AA:BB:CC",
    });
    expect(h.invoke).toHaveBeenCalledWith("stop_basic_auth_proxy", {
      sessionId: "proxy-1",
      continuationId,
    });
    await waitFor(() =>
      expect(
        new URL(view.container.querySelector("iframe")!.src).pathname,
      ).toBe("/webman/"),
    );
    expect(
      getRuntimeWebNavigation(h.sessions[0].connectionId)?.nativeContinuation,
    ).toBeUndefined();
    expect(
      starts.filter(
        ([, args]) => args.config.continuation_id === continuationId,
      ),
    ).toHaveLength(1);
  });

  it("clears a continuation while TLS is pending before reopening without the previous session capability", async () => {
    const { view, resumeCertificate } = await mountContinuation(true);
    expect(proxies).toHaveLength(1);
    expect(
      getRuntimeWebNavigation(h.sessions[0].connectionId)?.nativeContinuation
        ?.id,
    ).toBe(continuationId);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Clear session data" }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Clear and reopen" }));
    });
    await waitFor(() => expect(proxies).toHaveLength(2));
    await act(async () => {
      resumeCertificate();
    });
    const starts = h.invoke.mock.calls.filter(
      ([command]) => command === "start_basic_auth_proxy",
    );
    expect(starts).toHaveLength(2);
    expect(starts[1][1].config).not.toHaveProperty("continuation_id");
    expect(starts[1][1].config).toMatchObject({ username: "", password: "" });
    const cancellation = h.invoke.mock.calls.findIndex(
      ([command, args]) =>
        command === "cancel_proxy_continuation" &&
        args.continuationId === continuationId,
    );
    const freshStart = h.invoke.mock.calls.findIndex(
      ([command, args]) =>
        command === "start_basic_auth_proxy" && args === starts[1][1],
    );
    expect(cancellation).toBeGreaterThan(-1);
    expect(cancellation).toBeLessThan(freshStart);
    expect(
      h.invoke.mock.calls.filter(
        ([command, args]) =>
          command === "cancel_proxy_continuation" &&
          args.continuationId === continuationId,
      ),
    ).toHaveLength(1);
    expect(
      getRuntimeWebNavigation(h.sessions[0].connectionId)?.nativeContinuation,
    ).toBeUndefined();
    await waitFor(() =>
      expect(view.container.querySelector("iframe")?.src).toContain(
        proxies[1].proxy_url,
      ),
    );
  });

  it("does not redeem a continuation after its owning database changes during TLS inspection", async () => {
    const { view, resumeCertificate } = await mountContinuation(true);
    await act(async () => {
      h.locked = true;
      h.availabilityGeneration++;
      view.rerender(<Harness />);
    });
    await act(async () => {
      resumeCertificate();
    });
    expect(proxies).toHaveLength(1);
    expect(
      h.invoke.mock.calls.filter(
        ([command]) => command === "start_basic_auth_proxy",
      ),
    ).toHaveLength(1);
    expect(view.container.querySelector("iframe")).toBeNull();
  });

  it("offers retry instead of indefinite pending progress when a reported 202 has no native receipt", async () => {
    h.connections = [
      {
        ...h.connections[0],
        hostname: "example-nas.fr3.quickconnect.to",
        httpProxyPolicy: { ...DEFAULT_HTTP_PROXY_POLICY },
      },
    ];
    const view = await mounted();
    const invoke = h.invoke.getMockImplementation()!;
    h.invoke.mockImplementation(async (command, args) =>
      command === "review_proxy_redirect" ? null : invoke(command, args),
    );
    redirect(
      view.container.querySelector("iframe")!,
      "https://example-nas.de2.quickconnect.to/",
      true,
      202,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Redirect review" }),
      ).toHaveTextContent("No current redirect destination"),
    );
    expect(
      screen.getByRole("button", { name: "Reload source page" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("region", { name: "Redirect continuation" }),
    ).toBeNull();
    expect(proxies).toHaveLength(1);
  });
  it("automatically returns from the portal through selected-NAS regions without changing the original owner or alias", async () => {
    h.connections = [
      {
        ...h.connections[0],
        hostname: "example-nas.fr3.quickconnect.to",
        httpProxyPolicy: { ...DEFAULT_HTTP_PROXY_POLICY, httpsOnly: true },
      },
    ];
    const view = await mounted();
    const invoke = h.invoke.getMockImplementation()!;
    let resume: (() => void) | undefined;
    h.invoke.mockImplementation(async (command, args) => {
      if (command === "review_proxy_redirect" && args.receiptId)
        await new Promise<void>((resolve) => {
          resume = resolve;
        });
      return invoke(command, args);
    });
    for (const [index, destination] of [
      "https://global.quickconnect.to/",
      "https://example-nas.de2.quickconnect.to/",
      "https://example-nas.fr3.quickconnect.to/",
    ].entries()) {
      resume = undefined;
      redirect(view.container.querySelector("iframe")!, destination, true, 202);
      await waitFor(() =>
        expect(
          screen.getByRole("region", { name: "Redirect continuation" }),
        ).toBeVisible(),
      );
      expect(
        screen.queryByRole("region", { name: "Redirect review" }),
      ).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(proxies).toHaveLength(index + 1);
      // The neutral UI can appear before this hop reaches native consumption.
      // Never resolve the previous hop's already-completed callback.
      await waitFor(() => expect(resume).toBeTypeOf("function"));
      await act(async () => {
        resume!();
      });
      await waitFor(() => expect(proxies).toHaveLength(index + 2));
      await waitFor(() =>
        expect(view.container.querySelector("iframe")?.src).toContain(
          proxies[index + 1].proxy_url,
        ),
      );
      expect(
        screen.queryByRole("region", { name: "Redirect review" }),
      ).toBeNull();
    }
    const starts = h.invoke.mock.calls.filter(
      ([name]) => name === "start_basic_auth_proxy",
    );
    for (const [, args] of starts)
      expect(args.config.proxy_policy).toMatchObject({
        allowCrossOriginRedirects: false,
        httpsOnly: true,
        synologyQuickConnectDefaults: {
          version: 1,
          originalOrigin: "https://example-nas.fr3.quickconnect.to",
        },
      });
    expect(
      h.invoke.mock.calls.filter(
        ([name]) => name === "get_tls_certificate_info",
      ),
    ).toHaveLength(4);
    expect(h.connections[0].hostname).toBe("example-nas.fr3.quickconnect.to");
  });
  it("restores actionable review when an approved default receipt cannot be consumed", async () => {
    h.connections = [
      {
        ...h.connections[0],
        hostname: "example-nas.fr3.quickconnect.to",
        httpProxyPolicy: { ...DEFAULT_HTTP_PROXY_POLICY },
      },
    ];
    const view = await mounted();
    const invoke = h.invoke.getMockImplementation()!;
    let fail: (() => void) | undefined;
    h.invoke.mockImplementation(async (command, args) => {
      if (command === "review_proxy_redirect" && args.receiptId)
        await new Promise<void>((_resolve, reject) => {
          fail = () => reject(new Error("Synthetic expired receipt"));
        });
      return invoke(command, args);
    });
    redirect(
      view.container.querySelector("iframe")!,
      "https://example-nas.de2.quickconnect.to/",
      true,
      202,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Redirect continuation" }),
      ).toBeVisible(),
    );
    await act(async () => {
      fail!();
    });
    expect(
      screen.getByRole("region", { name: "Redirect review" }),
    ).toHaveTextContent("No destination was opened");
    expect(
      screen.queryByRole("region", { name: "Redirect continuation" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: /Reload/ })).toBeEnabled();
    expect(proxies).toHaveLength(1);
  });
  it("retains original context through regional to HTTPS alias and portal with Require HTTPS enabled", async () => {
    h.connections = [
      {
        ...h.connections[0],
        hostname: "example-nas.fr3.quickconnect.to",
        httpProxyPolicy: { ...DEFAULT_HTTP_PROXY_POLICY, httpsOnly: true },
      },
    ];
    const view = await mounted();
    for (const [index, destination] of [
      "https://example-nas.quickconnect.to/",
      "https://192-168-50-100.example-nas.direct.quickconnect.to:5002/webman/",
      "https://global.quickconnect.to/",
    ].entries()) {
      redirect(view.container.querySelector("iframe")!, destination);
      await waitFor(() => expect(proxies).toHaveLength(index + 2));
      await waitFor(() =>
        expect(view.container.querySelector("iframe")?.src).toContain(
          proxies[index + 1].proxy_url,
        ),
      );
      expect(
        screen.queryByRole("region", { name: "Redirect review" }),
      ).toBeNull();
    }
    for (const [, args] of h.invoke.mock.calls.filter(
      ([name]) => name === "start_basic_auth_proxy",
    ))
      expect(args.config.proxy_policy).toMatchObject({
        httpsOnly: true,
        allowCrossOriginRedirects: false,
        synologyQuickConnectDefaults: {
          version: 1,
          originalOrigin: "https://example-nas.fr3.quickconnect.to",
        },
      });
    expect(
      h.invoke.mock.calls.filter(
        ([name]) => name === "get_tls_certificate_info",
      ),
    ).toHaveLength(4);
  });
  it("labels built-in destinations separately and keeps configured login forwarding behind explicit review", async () => {
    h.connections = [
      {
        ...h.connections[0],
        hostname: "example-nas.fr3.quickconnect.to",
        httpProxyPolicy: { ...DEFAULT_HTTP_PROXY_POLICY },
        httpRedirectAuthentication: {
          version: 1,
          mode: "saved-login",
          allowInsecureHttp: false,
        },
      },
    ];
    const view = await mounted();
    redirect(
      view.container.querySelector("iframe")!,
      "https://global.quickconnect.to/",
    );
    expect(
      await screen.findByText("Built-in Synology destination"),
    ).toBeVisible();
    expect(screen.queryByText("Trusted for this saved connection")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Continue in this tab" }),
    ).toBeVisible();
    expect(proxies).toHaveLength(1);
    expect(h.invoke).not.toHaveBeenCalledWith("stop_basic_auth_proxy", {
      sessionId: "proxy-1",
    });
  });
  it("does not launch a default destination after opt-out while native receipt consumption is pending", async () => {
    h.connections = [
      {
        ...h.connections[0],
        hostname: "example-nas.fr3.quickconnect.to",
        httpProxyPolicy: { ...DEFAULT_HTTP_PROXY_POLICY },
      },
    ];
    const view = await mounted();
    const originalInvoke = h.invoke.getMockImplementation()!;
    let finish!: (review: HttpRedirectReview) => void;
    const pending = new Promise<HttpRedirectReview>((resolve) => {
      finish = resolve;
    });
    let consuming = false;
    h.invoke.mockImplementation(
      (command: string, args: Record<string, unknown>) => {
        if (command === "review_proxy_redirect" && args.receiptId) {
          consuming = true;
          return pending;
        }
        return originalInvoke(command, args);
      },
    );
    const review = redirect(
      view.container.querySelector("iframe")!,
      "http://example-nas.quickconnect.to/",
    );
    await waitFor(() => expect(consuming).toBe(true));
    h.connections = [
      {
        ...h.connections[0],
        synologySettings: {
          version: 1,
          useHttps: true,
          useDefaultRedirectDestinations: false,
        },
      },
    ];
    h.persistedConnections = structuredClone(h.connections);
    view.rerender(<Harness />);
    await act(async () => {
      finish(review);
    });
    expect(proxies).toHaveLength(1);
    expect(h.sessions[0].connectionId).toBe("saved-nas");
    expect(
      screen.queryByRole("region", { name: "Redirect review" }),
    ).toBeNull();
  });
  it.each([true, false])(
    "carries original built-in defaults through three anonymous proxy handoffs (saved=%s)",
    async (saved) => {
      const original: Connection = {
        ...h.connections[0],
        hostname: "example-nas.fr3.quickconnect.to",
        httpProxyPolicy: { ...DEFAULT_HTTP_PROXY_POLICY },
        basicAuthUsername: "private-user",
        basicAuthPassword: "private-password",
      };
      if (saved) h.connections = [original];
      else {
        h.connections = [];
        h.runtimeStart = { ...original, id: "unsaved-qc" };
        registerRuntimeConnection(h.runtimeStart);
      }
      const view = await mounted();
      const destinations = [
        "http://example-nas.quickconnect.to/",
        "https://global.quickconnect.to/",
        "https://www.quickconnect.to/",
      ];
      for (const [index, destination] of destinations.entries()) {
        redirect(view.container.querySelector("iframe")!, destination);
        await waitFor(() => expect(proxies).toHaveLength(index + 2));
        await waitFor(() =>
          expect(view.container.querySelector("iframe")?.src).toContain(
            proxies[index + 1].proxy_url,
          ),
        );
        expect(
          screen.queryByRole("region", { name: "Redirect review" }),
        ).toBeNull();
        const runtime = resolveRuntimeConnection(
          [],
          h.sessions[0].connectionId,
        )!;
        expect(runtime.httpProxyPolicy).toMatchObject({
          allowCrossOriginRedirects: false,
          allowHttpDowngradeRedirects: false,
          queryParameters: [],
        });
        expect(runtime.httpProxyPolicy).not.toHaveProperty(
          "synologyQuickConnectDefaults",
        );
        expect(JSON.stringify(runtime)).not.toContain("private-");
        expect(
          getRuntimeWebNavigation(runtime.id)?.synologyRedirectSource
            ?.originalOrigin,
        ).toBe("https://example-nas.fr3.quickconnect.to");
      }
      const starts = h.invoke.mock.calls.filter(
        ([name]) => name === "start_basic_auth_proxy",
      );
      expect(starts).toHaveLength(4);
      for (const [, args] of starts)
        expect(args.config.redirect_profile).toBe("synology");
      for (const [, args] of starts)
        expect(args.config.proxy_policy).toMatchObject({
          allowCrossOriginRedirects: false,
          allowHttpDowngradeRedirects: false,
          synologyQuickConnectDefaults: {
            version: 1,
            originalOrigin: "https://example-nas.fr3.quickconnect.to",
          },
        });
      expect(
        h.invoke.mock.calls.filter(
          ([name]) => name === "get_tls_certificate_info",
        ),
      ).toHaveLength(3);
      expect(h.dispatchAndFlush).not.toHaveBeenCalled();
    },
  );
  it("revokes a later portal proxy when original defaults are disabled and reloads without the exception", async () => {
    h.connections = [
      {
        ...h.connections[0],
        hostname: "example-nas.fr3.quickconnect.to",
        httpProxyPolicy: { ...DEFAULT_HTTP_PROXY_POLICY },
      },
    ];
    const view = await mounted();
    redirect(
      view.container.querySelector("iframe")!,
      "https://global.quickconnect.to/",
    );
    await waitFor(() => expect(proxies).toHaveLength(2));
    await waitFor(() =>
      expect(view.container.querySelector("iframe")?.src).toContain(
        proxies[1].proxy_url,
      ),
    );
    h.connections = [
      {
        ...h.connections[0],
        synologySettings: {
          version: 1,
          useHttps: true,
          useDefaultRedirectDestinations: false,
        },
      },
    ];
    h.persistedConnections = structuredClone(h.connections);
    view.rerender(<Harness />);
    await waitFor(() =>
      expect(h.invoke).toHaveBeenCalledWith("stop_basic_auth_proxy", {
        sessionId: "proxy-2",
      }),
    );
    expect(view.container.querySelector("iframe")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(proxies).toHaveLength(3));
    const starts = h.invoke.mock.calls.filter(
      ([name]) => name === "start_basic_auth_proxy",
    );
    expect(starts[2][1].config.proxy_policy).not.toHaveProperty(
      "synologyQuickConnectDefaults",
    );
    expect(starts[2][1].config.proxy_policy.allowCrossOriginRedirects).toBe(
      false,
    );
  });
  it.each(["valid", "missing", "replaced"] as const)(
    "discovers a %s native receipt after a pathful page ignores the redacted origin-root failure URL",
    async (receiptState) => {
      h.connections[0].httpApplication = {
        version: 1,
        id: "joomla",
        loginMode: "manual",
        loginPath: "/portal/",
      };
      const view = await mounted();
      const iframe = view.container.querySelector("iframe")!;
      const frameUrl = new URL(iframe.src);
      expect(frameUrl.pathname).toBe("/portal/");
      const navigationToken = frameUrl.searchParams.get(
        "__sorng_navigation_v1",
      );
      frameUrl.searchParams.delete("__sorng_navigation_v1");
      const currentDocument = {
        version: 1,
        sessionId: "proxy-1",
        documentToken: "d".repeat(32),
        documentSequence: 1,
        navigationToken,
        url: frameUrl.toString(),
      };
      // Establish the real current document before the portal's subsequent
      // reserved redirect response. Its bridge redacts paths/query to '/'.
      for (const type of ["proxy_document_start", "proxy_dom_ready"]) {
        act(() =>
          window.dispatchEvent(
            new MessageEvent("message", {
              source: iframe.contentWindow,
              origin: frameUrl.origin,
              data: { ...currentDocument, type },
            }),
          ),
        );
      }
      expect(iframe.parentElement).toHaveAttribute("aria-busy", "false");
      const readsBefore = h.invoke.mock.calls.filter(
        ([name]) => name === "review_proxy_redirect",
      ).length;
      if (receiptState !== "missing") {
        const receipt = redirect(
          iframe,
          "https://relay.example.test/admin/",
          false,
        );
        receipts.set("proxy-1", {
          ...receipt,
          navigationToken: null,
          documentSequence: 2,
        });
      }
      act(() =>
        window.dispatchEvent(
          new MessageEvent("message", {
            source: iframe.contentWindow,
            origin: frameUrl.origin,
            data: {
              type: "sorng_proxy_failure",
              version: 1,
              sessionId: "proxy-1",
              kind: "redirect_review",
              status: 403,
              title: "Redirect needs review",
              url: `${new URL(proxies[0].target).origin}/`,
              reason: "Review the destination address.",
              detail: "No destination query is exposed.",
            },
          }),
        ),
      );
      await act(async () => {});
      expect(
        screen.queryByRole("region", { name: "Redirect review" }),
      ).toBeNull();
      expect(screen.queryByTestId("web-navigation-error-screen")).toBeNull();
      expect(
        h.invoke.mock.calls.filter(
          ([name]) => name === "review_proxy_redirect",
        ),
      ).toHaveLength(readsBefore);
      document.removeEventListener("load", holdFrameLoad, true);
      fireEvent.load(iframe);
      await waitFor(() =>
        expect(
          h.invoke.mock.calls.filter(
            ([name]) => name === "review_proxy_redirect",
          ).length,
        ).toBeGreaterThan(readsBefore),
      );
      await act(async () => {});
      if (receiptState === "missing") {
        expect(
          screen.queryByRole("region", { name: "Redirect review" }),
        ).toBeNull();
        expect(screen.queryByTestId("web-navigation-error-screen")).toBeNull();
        expect(iframe).not.toHaveAttribute("inert");
      } else {
        const accept = await screen.findByRole("button", {
          name: "Continue in this tab",
        });
        expect(proxies).toHaveLength(1);
        if (receiptState === "replaced") receipts.delete("proxy-1");
        fireEvent.click(accept);
        if (receiptState === "valid") {
          await waitFor(() => expect(proxies).toHaveLength(2));
          expect(proxies[1].target).toBe("https://relay.example.test/");
          expect(
            getRuntimeWebNavigation(h.sessions[0].connectionId)?.initialUrl,
          ).toBe("https://relay.example.test/admin/");
          return;
        }
        await screen.findByText(/redirect expired or access changed/i);
      }
      expect(proxies).toHaveLength(1);
      expect(
        h.invoke.mock.calls.filter(
          ([name]) => name === "stop_basic_auth_proxy",
        ),
      ).toHaveLength(0);
    },
  );
  it.each([undefined, false, true])(
    "automatically continues two trusted HTTPS hops with legacy autoContinue=%s and no source credentials",
    async (autoContinue) => {
      h.connections[0] = {
        ...h.connections[0],
        basicAuthUsername: "private-user",
        basicAuthPassword: "private-password",
        httpTrustedRedirectDestinations: {
          version: 1,
          ...(autoContinue === undefined ? {} : { autoContinue }),
          origins: [
            "https://relay-1.example.test",
            "https://relay-2.example.test",
          ],
        },
      };
      const view = await mounted();
      for (let hop = 1; hop <= 2; hop++) {
        redirect(
          view.container.querySelector("iframe")!,
          `https://relay-${hop}.example.test/admin/`,
        );
        await waitFor(() =>
          expect(
            proxies,
            `${view.container.textContent} / reads=${h.readCurrent.mock.calls.length} / ${h.invoke.mock.calls.map(([name, args]) => `${name}${args?.receiptId ? ":consume" : ""}`).join(",")}`,
          ).toHaveLength(hop + 1),
        );
        await waitFor(() =>
          expect(view.container.querySelector("iframe")?.src).toContain(
            proxies[hop].proxy_url,
          ),
        );
        const target = resolveRuntimeConnection(
          [],
          h.sessions[0].connectionId,
        )!;
        expect(target).not.toHaveProperty("basicAuthUsername");
        expect(target).not.toHaveProperty("basicAuthPassword");
        expect(target).not.toHaveProperty("password");
        expect(target).not.toHaveProperty("httpTrustedRedirectDestinations");
        expect(
          getRuntimeWebNavigation(target.id)?.trustedRedirectSource
            ?.savedConnectionId,
        ).toBe("saved-nas");
        expect(getRuntimeWebNavigation(target.id)?.redirectHops).toBe(hop);
        expect(h.sessions[0]).toMatchObject({
          id: "web-tab",
          ownerDatabaseId: "owned",
        });
      }
      const destinationStarts = h.invoke.mock.calls
        .filter(([name]) => name === "start_basic_auth_proxy")
        .slice(1);
      for (const [, args] of destinationStarts) {
        expect(JSON.stringify(args)).not.toContain("private-user");
        expect(JSON.stringify(args)).not.toContain("private-password");
        expect(args.config).toMatchObject({ username: "", password: "" });
      }
      expect(h.readCurrent.mock.calls.length).toBeGreaterThanOrEqual(4);
      expect(
        h.invoke.mock.calls.filter(
          ([name]) => name === "get_tls_certificate_info",
        ),
      ).toHaveLength(3);
      expect(h.dispatchAndFlush).not.toHaveBeenCalled();
      expect(h.persistedConnections).toHaveLength(1);
    },
  );
  it.each(["http", "https"] as const)(
    "automatically opens a trusted HTTP destination from %s only with the existing policy",
    async (protocol) => {
      h.connections[0] = {
        ...h.connections[0],
        protocol,
        port: protocol === "https" ? 443 : 80,
        httpApplication: { version: 1, id: "custom", loginMode: "manual" },
        basicAuthUsername: "private-user",
        basicAuthPassword: "private-password",
        httpProxyPolicy: {
          ...DEFAULT_HTTP_PROXY_POLICY,
          allowCrossOriginRedirects: true,
          allowHttpDowngradeRedirects: true,
        },
        httpTrustedRedirectDestinations: {
          version: 1,
          origins: ["http://relay.example.test"],
          autoContinue: false,
        },
      };
      const view = await mounted();
      redirect(
        view.container.querySelector("iframe")!,
        "http://relay.example.test/admin/",
      );
      await waitFor(() => expect(proxies).toHaveLength(2));
      await waitFor(() =>
        expect(view.container.querySelector("iframe")?.src).toContain(
          proxies[1].proxy_url,
        ),
      );
      expect(proxies[1].target).toContain("http://relay.example.test");
      const target = resolveRuntimeConnection([], h.sessions[0].connectionId)!;
      expect(target.protocol).toBe("http");
      expect(target).not.toHaveProperty("basicAuthPassword");
      const starts = h.invoke.mock.calls.filter(
        ([name]) => name === "start_basic_auth_proxy",
      );
      expect(JSON.stringify(starts[1][1])).not.toContain("private-");
      expect(starts[1][1].config).toMatchObject({ username: "", password: "" });
      expect(h.dispatchAndFlush).not.toHaveBeenCalled();
    },
  );
  it("does not auto-continue using an optimistic unsaved trusted list", async () => {
    const view = await mounted();
    h.connections = [
      {
        ...h.connections[0],
        httpTrustedRedirectDestinations: {
          version: 1,
          autoContinue: true,
          origins: ["https://relay.example.test"],
        },
      },
    ];
    view.rerender(<Harness />);
    redirect(
      view.container.querySelector("iframe")!,
      "https://relay.example.test/",
    );
    await screen.findByRole("button", { name: "Continue in this tab" });
    await act(async () => {});
    expect(h.readCurrent).toHaveBeenCalled();
    expect(proxies).toHaveLength(1);
    expect(
      h.invoke.mock.calls.filter(
        ([name, args]) => name === "review_proxy_redirect" && args.receiptId,
      ),
    ).toHaveLength(0);
    expect(h.persistedConnections[0]).not.toHaveProperty(
      "httpTrustedRedirectDestinations",
    );
  });
  it("never authorizes a remembered destination when its optimistic save fails", async () => {
    h.connections[0].httpTrustedRedirectDestinations = {
      version: 1,
      autoContinue: true,
      origins: [],
    };
    const view = await mounted();
    redirect(
      view.container.querySelector("iframe")!,
      "https://relay.example.test/",
    );
    const remember = await screen.findByRole("button", {
      name: "Trust destination",
    });
    h.failSaveAfterDispatch = true;
    fireEvent.click(remember);
    await screen.findByText(/destination could not be saved and verified/i);
    expect(h.connections[0].httpTrustedRedirectDestinations?.origins).toEqual([
      "https://relay.example.test",
    ]);
    expect(
      h.persistedConnections[0].httpTrustedRedirectDestinations?.origins,
    ).toEqual([]);
    expect(proxies).toHaveLength(1);
    expect(
      h.invoke.mock.calls.filter(
        ([name, args]) => name === "review_proxy_redirect" && args.receiptId,
      ),
    ).toHaveLength(0);
    expect(screen.queryByText("Trusted for this saved connection")).toBeNull();
  });
  it("remembers a second-hop destination on the original saved connection, not its anonymous runtime record", async () => {
    const view = await mounted();
    redirect(
      view.container.querySelector("iframe")!,
      "https://relay-1.example.test/",
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Continue in this tab" }),
    );
    await waitFor(() => expect(proxies).toHaveLength(2));
    await waitFor(() =>
      expect(view.container.querySelector("iframe")?.src).toContain(
        proxies[1].proxy_url,
      ),
    );
    const runtimeId = h.sessions[0].connectionId;
    redirect(
      view.container.querySelector("iframe")!,
      "https://relay-2.example.test/admin/",
    );
    const remember = await screen.findByRole("button", {
      name: "Trust destination",
    });
    expect(remember).toBeEnabled();
    fireEvent.click(remember);
    await waitFor(() =>
      expect(h.persistedConnections[0].httpTrustedRedirectDestinations).toEqual(
        {
          version: 1,
          origins: ["https://relay-2.example.test"],
        },
      ),
    );
    expect(h.dispatchAndFlush).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "UPDATE_CONNECTION",
        payload: expect.objectContaining({ id: "saved-nas" }),
      }),
    );
    expect(h.persistedConnections).toHaveLength(1);
    expect(resolveRuntimeConnection([], runtimeId)).not.toHaveProperty(
      "httpTrustedRedirectDestinations",
    );
    expect(proxies).toHaveLength(2);
    expect(
      await screen.findByText("Trusted for this saved connection"),
    ).toBeVisible();
  });
  it.each(["manual", "form"] as const)(
    "does not stop a %s login proxy after an equivalent native-storage round trip",
    async (loginMode) => {
      h.connections = [
        {
          ...h.connections[0],
          basicAuthUsername: "fixture-user",
          basicAuthPassword: "fixture-password",
          httpApplication: { version: 1, id: "synology-dsm", loginMode },
        },
      ];
      const view = await mounted();
      const iframe = view.container.querySelector("iframe")!;
      redirect(iframe, "https://relay.example.test/");
      await screen.findByRole("region", { name: "Redirect review" });
      const source = iframe.src;
      // Native StorageData uses serde_json::Value sorted object maps; provider
      // SET_CONNECTIONS applies this normalizer to every rehydrated connection.
      const nativeClone = JSON.parse(
        JSON.stringify(h.connections[0], (_key, value: unknown) =>
          value && typeof value === "object" && !Array.isArray(value)
            ? Object.fromEntries(
                Object.entries(value).sort(([left], [right]) =>
                  left.localeCompare(right),
                ),
              )
            : value,
        ),
      ) as Connection;
      h.connections = [normalizeAdvancedProtocolConnection(nativeClone)];
      view.rerender(<Harness />);
      await act(async () => {});
      expect(
        h.invoke.mock.calls.filter(
          ([name]) => name === "stop_basic_auth_proxy",
        ),
      ).toHaveLength(0);
      expect(proxies).toHaveLength(1);
      expect(view.container.querySelector("iframe")).toBe(iframe);
      expect(iframe.src).toBe(source);
      expect(
        screen.getByRole("button", { name: "Continue in this tab" }),
      ).toBeVisible();
    },
  );
  it("keeps the review through the automatic connection-completion bookkeeping update", async () => {
    const view = await mounted();
    redirect(
      view.container.querySelector("iframe")!,
      "https://relay.example.test/",
    );
    await screen.findByRole("region", { name: "Redirect review" });
    const reads = h.invoke.mock.calls.filter(
      ([name]) => name === "review_proxy_redirect",
    ).length;
    // This is the UPDATE_CONNECTION payload from connectSession's 2s timer.
    h.connections = [
      {
        ...h.connections[0],
        lastConnected: new Date().toISOString(),
        connectionCount: 1,
      },
    ];
    view.rerender(<Harness />);
    await act(async () => {});
    expect(
      screen.getByRole("button", { name: "Continue in this tab" }),
    ).toBeVisible();
    expect(
      h.invoke.mock.calls.filter(([name]) => name === "review_proxy_redirect"),
    ).toHaveLength(reads);
  });
  it.each(["password", "target"])(
    "still stops the proxy when its actual %s changes",
    async (change) => {
      h.connections = [
        {
          ...h.connections[0],
          basicAuthUsername: "fixture-user",
          basicAuthPassword: "fixture-password",
          httpApplication: {
            version: 1,
            id: "synology-dsm",
            loginMode: "form",
          },
        },
      ];
      const view = await mounted();
      redirect(
        view.container.querySelector("iframe")!,
        "https://relay.example.test/",
      );
      await screen.findByRole("region", { name: "Redirect review" });
      h.connections = [
        {
          ...h.connections[0],
          ...(change === "password"
            ? { basicAuthPassword: "changed-password" }
            : { hostname: "changed.example.test" }),
        },
      ];
      view.rerender(<Harness />);
      await waitFor(() =>
        expect(h.invoke).toHaveBeenCalledWith("stop_basic_auth_proxy", {
          sessionId: "proxy-1",
        }),
      );
      expect(
        screen.queryByRole("button", { name: "Continue in this tab" }),
      ).toBeNull();
      expect(proxies).toHaveLength(1);
    },
  );
  it("replays the retained redirect failure once settings readiness arrives, without another page message", async () => {
    h.settingsReady = false;
    const view = await mounted();
    redirect(
      view.container.querySelector("iframe")!,
      "https://relay.example.test/",
    );
    expect(
      screen.queryByRole("region", { name: "Redirect review" }),
    ).toBeNull();
    h.settingsReady = true;
    view.rerender(<Harness />);
    expect(
      await screen.findByRole("button", { name: "Continue in this tab" }),
    ).toBeVisible();
  });
  it("finds a native receipt on iframe load when its failure bridge was not accepted", async () => {
    const view = await mounted();
    const iframe = view.container.querySelector("iframe")!;
    redirect(iframe, "https://relay.example.test/", false);
    document.removeEventListener("load", holdFrameLoad, true);
    fireEvent.load(iframe);
    expect(
      await screen.findByRole("button", { name: "Continue in this tab" }),
    ).toBeVisible();
  });
  it("does not replace an ordinary page when optional receipt discovery fails", async () => {
    const view = await mounted();
    const iframe = view.container.querySelector("iframe")!;
    const invoke = h.invoke.getMockImplementation()!;
    h.invoke.mockImplementation(
      (command: string, args: Record<string, unknown>) => {
        if (command === "review_proxy_redirect") throw new Error("unavailable");
        return invoke(command, args);
      },
    );
    document.removeEventListener("load", holdFrameLoad, true);
    fireEvent.load(iframe);
    await act(async () => {});
    expect(
      screen.queryByRole("region", { name: "Redirect review" }),
    ).toBeNull();
    expect(screen.queryByTestId("web-navigation-error-screen")).toBeNull();
    expect(iframe).not.toHaveAttribute("inert");
    expect(iframe).not.toHaveClass("invisible");
  });
  it("continues three reviewed same-tab hops with fresh proxy, trust and native receipt per hop", async () => {
    const view = await mounted();
    for (let hop = 1; hop <= 3; hop++) {
      const oldConnectionId = h.sessions[0].connectionId;
      const iframe = view.container.querySelector("iframe")!;
      redirect(iframe, `https://relay-${hop}.example.test/admin/`);
      expect(
        await screen.findByRole("button", { name: "Continue in this tab" }),
      ).toBeVisible();
      expect(
        screen.getByText(new RegExp(`^Redirect ${hop} of 20 maximum`)),
      ).toBeVisible();
      fireEvent.click(
        screen.getByRole("button", { name: "Continue in this tab" }),
      );
      await waitFor(() => expect(proxies).toHaveLength(hop + 1));
      await waitFor(() =>
        expect(view.container.querySelector("iframe")?.src).toContain(
          proxies[hop].proxy_url,
        ),
      );
      expect(view.container.querySelector("iframe")).not.toBe(iframe);
      const session = h.sessions[0];
      expect(session).toMatchObject({
        id: "web-tab",
        ownerDatabaseId: "owned",
        hostname: `relay-${hop}.example.test`,
      });
      const target = resolveRuntimeConnection([], session.connectionId)!;
      expect(target.httpProxyPolicy?.allowCrossOriginRedirects).toBe(true);
      expect(getRuntimeWebNavigation(target.id)?.redirectHops).toBe(hop);
      expect(getRuntimeWebNavigation(target.id)?.initialUrl).toBe(
        `https://relay-${hop}.example.test/admin/`,
      );
      if (hop > 1)
        expect(resolveRuntimeConnection([], oldConnectionId)).toBeUndefined();
      expect(h.invoke).toHaveBeenCalledWith("stop_basic_auth_proxy", {
        sessionId: `proxy-${hop}`,
      });
    }
    expect(
      h.invoke.mock.calls.filter(
        ([name]) => name === "get_tls_certificate_info",
      ),
    ).toHaveLength(4);
  });
  it("revokes the review and source session when redirect security policy changes", async () => {
    const view = await mounted();
    redirect(
      view.container.querySelector("iframe")!,
      "https://relay.example.test/",
    );
    await screen.findByRole("region", { name: "Redirect review" });
    h.connections = [
      {
        ...h.connections[0],
        httpProxyPolicy: { ...DEFAULT_HTTP_PROXY_POLICY },
      },
    ];
    view.rerender(<Harness />);
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Continue in this tab" }),
      ).toBeNull(),
    );
    expect(h.invoke).toHaveBeenCalledWith("stop_basic_auth_proxy", {
      sessionId: "proxy-1",
    });
    expect(proxies).toHaveLength(1);
  });
});
