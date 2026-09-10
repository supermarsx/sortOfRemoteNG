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
} from "../../src/utils/session/runtimeConnectionRegistry";
import type { HttpRedirectReview } from "../../src/utils/protocol/httpRedirectReview";
import { normalizeAdvancedProtocolConnection } from "../../src/utils/connection/normalizeAdvancedProtocolConnection";
import { mergeLocalSessionUpdate } from "../../src/utils/session/sessionLifecycle";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  dispatch: vi.fn(),
  verify: vi.fn(),
  readCurrent: vi.fn(),
  flushPendingSave: vi.fn(),
  dispatchAndFlush: vi.fn(),
  connections: [] as Connection[],
  persistedConnections: [] as Connection[],
  failSave: false,
  failSaveAfterDispatch: false,
  sessions: [] as ConnectionSession[],
  settingsReady: true,
  locked: false,
  settings: {
    httpsTrustPolicy: "always-ask",
    proxyKeepaliveEnabled: false,
    webRecording: { autoRecordWebSessions: false },
  },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
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
      generation: 1,
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
  connectionId: h.connections[0].id,
  name: "NAS website",
  hostname: "quickconnect.example.test",
  protocol: h.connections[0].protocol,
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
  clearRuntimeConnectionsForTests();
  receipts.clear();
  proxies.length = 0;
  h.settingsReady = true;
  h.locked = false;
  h.failSave = false;
  h.failSaveAfterDispatch = false;
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
        if (command === "stop_basic_auth_proxy") return undefined;
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
function redirect(
  iframe: HTMLIFrameElement,
  destination: string,
  postMessage = true,
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
            status: 403,
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
        screen.getByText(new RegExp(`^Redirect ${hop} of 5 maximum`)),
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
